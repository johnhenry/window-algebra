/**
 * Touch and pen gestures for `attachInput({ touch })`: pinch to resize a
 * floating window, swipe between tabs or workspaces, long-press for a context
 * action. Pointer-event based and `pointerType`-aware: mouse input is never
 * touched by anything here, pinch and the two-finger workspace swipe are
 * touch-only (a pen is one pointer), and the single-pointer gestures serve
 * touch and pen alike.
 *
 * Moving and docking a window by touch is the existing drag machinery in
 * `input.mjs` (a floating title bar drags at once, a tiled one after a held
 * `longPress`); this module adds what a mouse has no equivalent for. It holds
 * no state of its own beyond the live pointers: every decision is a pure
 * helper (`interaction/pinch.mjs`) and the result is an ordinary command.
 *
 * `touch-action` is how the browser is told to leave a gesture to the page,
 * so each recognizer sets a token in `data-wm-touch` on the root, and
 * `BASE_CSS` maps the tokens to the CSS the gesture needs:
 *   pinch             floating windows: `touch-action: none` (the browser must not pinch-zoom)
 *   swipe-tabs        tab strips: `touch-action: pan-y` (horizontal strokes are ours, vertical ones scroll)
 *   swipe-workspaces  the whole stage: `touch-action: pan-y` (horizontal two-finger strokes are ours)
 *   swipe-windows     the whole stage: `touch-action: pan-y` (horizontal one-finger strokes on a monocle/tabs window are ours)
 *   context           windows: `-webkit-touch-callout: none` (no native long-press menu)
 */
import { createPinch, updatePinch, swipeOf } from "../interaction/pinch.mjs";

/** Elements that handle their own pointer input (kept in step with `INTERACTIVE` in input.mjs). */
const INTERACTIVE = "[data-wm-command], button, a, input, select, textarea, label, [contenteditable]";

const TOUCHLIKE = new Set(["touch", "pen"]);

/** Normalise the `touch` option. `true` turns on pinch, tab swipes and the context event. */
export const touchOptions = (touch) => {
  if (!touch) return null;
  const o = touch === true ? {} : touch;
  const swipe = o.swipe === undefined || o.swipe === true ? { tabs: true, workspaces: false, windows: false } : o.swipe === false ? {} : o.swipe;
  return {
    pinch: o.pinch !== false,
    swipeTabs: swipe.tabs === true,
    swipeWorkspaces: swipe.workspaces === true,
    swipeWindows: swipe.windows === true,
    // true: dispatch a `wm-contextmenu` DOM event; a function: called with the press; a string: a command type for { type, id }.
    contextMenu: o.contextMenu === undefined ? true : o.contextMenu,
    contextDelay: o.contextDelay ?? 500,
    slop: o.slop ?? 10,
    swipeDistance: o.swipeDistance ?? 48,
    workspaceSwipeDistance: o.workspaceSwipeDistance ?? 64,
  };
};

/** The tokens `data-wm-touch` carries for a normalised option set. */
export const touchTokens = (options) =>
  [options.pinch && "pinch", options.swipeTabs && "swipe-tabs", options.swipeWorkspaces && "swipe-workspaces", options.swipeWindows && "swipe-windows", options.contextMenu && "context"]
    .filter(Boolean)
    .join(" ");

/**
 * @param {object} ctx what the input adapter lends it
 * @param {object} ctx.options normalised `touch` options (see `touchOptions`)
 * @param {Element} ctx.root
 * @param {() => object} ctx.getState
 * @param {(command: object) => unknown} ctx.dispatch
 * @param {(command: object) => unknown} ctx.send dispatch with announcements
 * @param {(event: object) => {x: number, y: number}} ctx.local pointer position relative to the root
 * @param {() => number} [ctx.unit] screen pixels per unit of `local` (a zoomed stage; default 1): `slop` and the
 *   swipe distances are screen pixels, so travel in `local` units is multiplied by it before they are compared
 * @param {(target: Element) => Element|null} ctx.viewOf the wm-view element a target is in
 * @param {(id: string) => ({x: number, y: number, width: number, height: number}|null)} ctx.floatRect a pinchable window's rect, or null if it cannot be pinched
 * @param {(rect: object) => object} [ctx.mirror] maps a rect between a window's own (inline-start) x and the
 *   screen's, and back; the identity in a left-to-right stage
 * @param {(state: object) => string} ctx.rootWorkspace the workspace this root shows
 * @param {(state: object) => string[]|null} [ctx.stackOrder] the windows the stage's active stack (a monocle or
 *   tabs layout) can show, in order, or null when the layout is not a stack; needed by `swipe.windows`
 * @param {() => number} ctx.direction 1 for left-to-right, -1 for right-to-left
 * @param {() => boolean} ctx.busy a drag/move/splitter gesture is in progress
 * @param {() => void} ctx.cancelOthers abandon any single-pointer gesture
 * @param {{set(fn, ms): unknown, clear(id): void}} ctx.timers
 * @param {() => string} ctx.token a fresh gesture token
 */
export const createTouchGestures = (ctx) => {
  const { options, root, getState, dispatch, send, local, viewOf, floatRect, rootWorkspace, stackOrder = () => null, direction, busy, cancelOthers, timers, token, mirror = (rect) => rect, unit = () => 1 } = ctx;
  const pointers = new Map(); // touch pointerId -> { x, y, target, view }
  let single = null; // { pointerId, type, x0, y0, t0, x, y, tabs, press: timer, viewEl, moved }
  let multi = null; // pinch or two-finger swipe in progress
  let lastContext = -Infinity;
  const now = () => globalThis.performance?.now?.() ?? Date.now();

  const clearPress = () => {
    if (single?.press !== undefined) timers.clear(single.press);
    if (single) single.press = undefined;
  };

  const fireContext = (press) => {
    if (single !== press || press.moved || busy() || multi) return;
    const state = getState();
    const id = press.viewEl.getAttribute("data-view");
    if (!state.windows[id]) return;
    lastContext = now();
    cancelOthers(); // a floating window's un-moved press, a denied press
    const o = options.contextMenu;
    const info = { id, x: press.x, y: press.y, clientX: press.clientX, clientY: press.clientY, pointerType: press.type, target: press.target };
    if (typeof o === "function") o(info);
    else if (typeof o === "string") send({ type: o, id });
    else {
      const win = root.ownerDocument?.defaultView;
      if (win?.CustomEvent && press.viewEl.dispatchEvent) {
        press.viewEl.dispatchEvent(new win.CustomEvent("wm-contextmenu", { bubbles: true, cancelable: true, detail: info }));
      }
    }
  };

  // ------------------------------------------------------------ pinch / two-finger swipe

  const pair = () => [...pointers.values()].slice(0, 2);

  const startMulti = () => {
    const [a, b] = pair();
    const state = getState();
    if (options.pinch && a.view && a.view === b.view) {
      const id = a.view.getAttribute("data-view");
      const rect = floatRect(id);
      if (rect) {
        multi = {
          kind: "pinch",
          id,
          token: token(),
          start: rect,
          // Pinch runs on screen coordinates; `rect` (the window's own x) is what a cancel restores.
          op: createPinch({ points: [a, b], bounds: mirror(rect), constraints: state.windows[id]?.constraints }),
        };
        return true;
      }
    }
    if (options.swipeWorkspaces) {
      multi = { kind: "swipe", c0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, t0: now() };
      return true;
    }
    return false;
  };

  const endMulti = (cancelled) => {
    const session = multi;
    multi = null;
    if (!session) return;
    if (session.kind === "pinch") {
      if (cancelled) dispatch({ type: "window/resize", id: session.id, ...session.start, gesture: session.token });
      return;
    }
    if (cancelled) return;
    const s = unit();
    const dx = (session.c.x - session.c0.x) * s;
    const dy = (session.c.y - session.c0.y) * s;
    const verdict = swipeOf({ dx, dy, duration: now() - session.t0 }, { distance: options.workspaceSwipeDistance, maxDuration: 900 });
    if (verdict === "left" || verdict === "right") stepWorkspace(verdict === "left" ? 1 : -1);
  };

  /** Activate the workspace `step` away (in reading order) from the one this stage shows. */
  const stepWorkspace = (step) => {
    const state = getState();
    const shown = rootWorkspace(state);
    const output = state.workspaces[shown]?.output;
    const order = state.outputs?.[output]?.workspaces ?? state.workspaceOrder;
    const at = order.indexOf(shown);
    const next = order[at + step * direction()];
    if (at >= 0 && next !== undefined) send({ type: "workspace/activate", id: next });
  };

  // ------------------------------------------------------------ tab swipes

  const stepTab = (strip, step) => {
    const tabs = [...(strip.querySelectorAll?.("[data-wm-tab]") ?? [])];
    const at = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    const next = tabs[at + step * direction()];
    if (at >= 0 && next) send({ type: "window/focus", id: next.getAttribute("data-wm-tab") });
  };

  // ------------------------------------------------------------ window swipes (monocle / tabs)

  /** A text field or a horizontally scrolling element under the finger keeps its stroke. */
  const keepsStroke = (target, viewEl) => {
    if (target.closest?.("input, textarea, select, [contenteditable]")) return true;
    const style = root.ownerDocument?.defaultView?.getComputedStyle;
    for (let el = target; el && el !== viewEl?.parentNode && el.nodeType !== 9; el = el.parentNode) {
      if (!(el.scrollWidth > el.clientWidth + 1)) continue;
      const overflow = style ? style.call(root.ownerDocument.defaultView, el).overflowX : "";
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    return false;
  };

  const stepWindow = (step) => {
    const state = getState();
    const order = stackOrder(state);
    if (!order?.length) return;
    const spec = state.workspaces[rootWorkspace(state)]?.layout;
    const focused = state.focus.window;
    const shown = order.includes(spec?.active) ? spec.active : order.includes(focused) ? focused : order[0];
    const next = order[order.indexOf(shown) + step * direction()];
    if (next !== undefined) send({ type: "window/focus", id: next });
  };

  // ------------------------------------------------------------ the pointer stream

  /** Returns true when the gesture is a multi-finger one this module now owns. */
  const down = (event) => {
    const type = event.pointerType;
    if (!TOUCHLIKE.has(type)) return false;
    const target = event.target;
    const viewEl = viewOf(target);
    const p = { x: local(event).x, y: local(event).y, clientX: event.clientX, clientY: event.clientY, target, view: viewEl };
    if (type === "touch") {
      pointers.set(event.pointerId, p);
      if (pointers.size >= 2) {
        clearPress();
        single = null;
        if (!multi && pointers.size === 2 && startMulti()) {
          cancelOthers();
          return true;
        }
        return Boolean(multi);
      }
    }
    // Single pointer: a candidate for a tab swipe or a context long-press.
    clearPress();
    single = { pointerId: event.pointerId, type, x0: p.x, y0: p.y, x: p.x, y: p.y, clientX: p.clientX, clientY: p.clientY, t0: now(), target, viewEl, moved: false, strip: null, press: undefined };
    const strip = options.swipeTabs ? target.closest?.("wm-tabs, [data-wm-tab]") : null;
    if (strip) single.strip = strip.localName === "wm-tabs" ? strip : strip.parentNode;
    else if (options.swipeWindows && viewEl && !viewEl.closest?.("[data-wm-drag-overlay]") && !target.closest?.("[data-wm-handle], [data-wm-splitter]") && !keepsStroke(target, viewEl)) {
      const order = stackOrder(getState());
      if (order?.includes(viewEl.getAttribute("data-view"))) single.windows = true;
    }
    // A press on a control (button, text field, link) keeps its own long-press behaviour.
    const eligible =
      options.contextMenu &&
      viewEl &&
      !viewEl.closest?.("[data-wm-drag-overlay]") &&
      !target.closest?.("[data-wm-tab], [data-wm-splitter]") &&
      !target.closest?.(INTERACTIVE);
    if (eligible) {
      const press = single;
      press.press = timers.set(() => fireContext(press), options.contextDelay);
    }
    return false;
  };

  const move = (event) => {
    const type = event.pointerType;
    if (!TOUCHLIKE.has(type)) return false;
    const p = pointers.get(event.pointerId);
    if (p) {
      const at = local(event);
      p.x = at.x;
      p.y = at.y;
    }
    if (single && event.pointerId === single.pointerId) {
      const at = local(event);
      single.x = at.x;
      single.y = at.y;
      if (!single.moved && Math.hypot(at.x - single.x0, at.y - single.y0) * unit() > options.slop) {
        single.moved = true;
        clearPress();
      }
    }
    if (!multi) return false;
    if (multi.kind === "pinch" && pointers.size >= 2) {
      const rect = mirror(updatePinch(multi.op, pair()));
      dispatch({ type: "window/resize", id: multi.id, ...rect, gesture: multi.token });
    } else if (multi.kind === "swipe" && pointers.size >= 2) {
      const [a, b] = pair();
      multi.c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    return true;
  };

  const up = (event, cancelled = false) => {
    const type = event.pointerType;
    if (!TOUCHLIKE.has(type)) return false;
    const had = pointers.delete(event.pointerId);
    if (multi && had && pointers.size < 2) endMulti(cancelled);
    if (single && event.pointerId === single.pointerId) {
      const session = single;
      clearPress();
      single = null;
      if (!cancelled && (session.strip || session.windows) && !multi) {
        const s = unit();
        const verdict = swipeOf({ dx: (session.x - session.x0) * s, dy: (session.y - session.y0) * s, duration: now() - session.t0 }, { distance: options.swipeDistance });
        if (verdict === "left" || verdict === "right") {
          if (session.strip) stepTab(session.strip, verdict === "left" ? 1 : -1);
          else stepWindow(verdict === "left" ? 1 : -1);
        }
      }
    }
    return false;
  };

  return {
    down,
    move,
    up,
    /** A native contextmenu right after one of ours would stack two menus. */
    recentContext: () => now() - lastContext < 800,
    /** Is a multi-finger gesture in progress? */
    get active() {
      return Boolean(multi);
    },
    detach() {
      clearPress();
      if (multi) endMulti(true);
      pointers.clear();
      single = null;
    },
  };
};
