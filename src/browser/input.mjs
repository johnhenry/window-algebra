/**
 * Browser input adapter: pointer events in, commands out. The geometry math
 * lives in the pure interaction primitives; this only wires events.
 *
 * Markup contract (inside a surface):
 *   data-wm-handle="move"                 drag to move a floating window, or to
 *                                         drag a tiled window to a new slot
 *   data-wm-handle="resize-se" (n/s/e/w/ne/nw/se/sw)  drag to resize
 *   data-wm-command="window/close"        click to dispatch { type, id }
 *   data-wm-dblclick="window/toggle-maximize"  double-click to dispatch { type, id } (the built-in
 *                                         chrome puts it on the title bar); a control inside keeps its own click
 * Tab buttons rendered by the compiler carry data-wm-tab="<id>"; drag one
 * along its strip to reorder.
 * Anywhere on the page (usually a workspace switcher):
 *   data-wm-workspace-target="<id>"       drop a dragged window here to move it
 *                                         to that workspace (config.drag.crossWorkspace)
 * The compiler renders a splitter between every pair of children of a
 * resizable row/column ([data-wm-splitter], role="separator", with
 * data-wm-path/data-wm-index/data-wm-count identifying which split — see
 * docs/PRD.md, "Split sizing"). Dragging one dispatches `layout/resize-split`
 * (pointer capture, one undo step); with it focused (it is a tabindex="0"
 * separator), the arrow key along its axis nudges the split the same way.
 * It sits beside the view elements, never inside one, so it never competes
 * with a title bar's drag handle or buttons.
 *
 * While a window is dragged, an overlay inside `root` ([data-wm-drag-overlay])
 * shields iframes from the pointer and holds the preview: the hypothetical
 * next state rendered through the same derive → compile pipeline into ghost
 * outlines ([data-wm-ghost]), plus the highlighted drop zone
 * ([data-wm-drop-zone]) or, for tabs, an insertion line ([data-wm-drop-line]).
 *
 * One gesture is one history step: a tiled drag dispatches a single command
 * (window/drop, window/detach or window/move-to-workspace) on release; a
 * floating drag's commands share a `gesture` token the manager coalesces.
 */
import { createDrag, updateDrag, createResize, updateResize } from "../interaction/drag.mjs";
import { dropTargetAt, zoneRect } from "../interaction/drop.mjs";
import { snapZoneAt, snapZoneRect, magnetize, magnetizeResize } from "../interaction/snap.mjs";
import { isBlocked, isVisible, inTiledBase, outputActiveWorkspace } from "../state/queries.mjs";
import { update } from "../state/update.mjs";
import { DROPS, dragMode, isDroppable, tiledOrder } from "../state/drops.mjs";
import { derive, presentationContext } from "../state/derive.mjs";
import { compile, SPLITTER_SIZE } from "../css/compile.mjs";
import { bspNodeAt } from "../layouts/bsp.mjs";
import { DEFAULT_CONFIG } from "../state/create.mjs";
import { createDomRenderer } from "./dom.mjs";
import { createTouchGestures, touchOptions, touchTokens } from "./touch.mjs";

/** Elements that handle their own pointer input, even inside a drag handle. */
const INTERACTIVE = "[data-wm-command], button, a, input, select, textarea, label, [contenteditable]";

let gestureSeq = 0;
const gestureToken = () => `g${Date.now().toString(36)}.${++gestureSeq}`;

const GHOST_STYLE = {
  background: "var(--wa-ghost-fill)",
  outline: "var(--wa-ghost-line-width) dashed var(--wa-ghost-line)",
  "outline-offset": "calc(-1 * var(--wa-ghost-line-width))",
  "border-radius": "var(--wa-radius-md)",
  "box-shadow": "none",
  border: "0",
};
const GHOST_DRAGGED_STYLE = {
  ...GHOST_STYLE,
  background: "var(--wa-ghost-fill-strong)",
  outline: "var(--wa-ghost-line-width) solid var(--wa-ghost-line)",
};
const GHOST_TOO_SMALL_STYLE = { outline: "var(--wa-ghost-line-width) solid var(--wa-ghost-bad)" };
const HIDDEN_TEXT_STYLE = {
  position: "absolute",
  width: "1px",
  height: "1px",
  margin: "-1px",
  padding: "0",
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  "white-space": "nowrap",
  border: "0",
};

const setStyles = (element, styles) => {
  for (const [prop, value] of Object.entries(styles)) element.style.setProperty(prop, value);
};

/** Remove size constraints so the ghost shows each window's *slot*, not its clamped size. */
const unconstrained = (state) => ({
  ...state,
  windows: Object.fromEntries(Object.entries(state.windows).map(([id, win]) => [id, { ...win, constraints: {} }])),
});

const violates = (c = {}, r) =>
  (Number.isFinite(c.minWidth) && r.width < c.minWidth) ||
  (Number.isFinite(c.maxWidth) && r.width > c.maxWidth) ||
  (Number.isFinite(c.minHeight) && r.height < c.minHeight) ||
  (Number.isFinite(c.maxHeight) && r.height > c.maxHeight);

/**
 * Turn a compiled render tree into ghost outlines: the shown views become
 * translucent boxes (the dragged one emphasised), everything else is hidden.
 */
const ghostify = (node, { shown, dragged, titles }) => {
  if (node.view !== undefined) {
    const visible = node.primary && shown.has(node.view);
    const attrs = { "data-view": node.view };
    if (visible) {
      attrs["data-wm-ghost"] = node.view === dragged ? "dragged" : "";
      attrs["data-wm-ghost-label"] = titles[node.view] || node.view;
    }
    const style = visible ? { ...node.style, ...(node.view === dragged ? GHOST_DRAGGED_STYLE : GHOST_STYLE) } : { ...node.style, display: "none" };
    return { ...node, attrs, style, primary: false };
  }
  const style = node.tag === "wm-tabs" ? { ...node.style, visibility: "hidden" } : node.style;
  const attrs = { ...node.attrs };
  delete attrs.inert;
  return { ...node, attrs, style, children: node.children.map((child) => ghostify(child, { shown, dragged, titles })) };
};

const MODIFIERS = { shift: "shiftKey", alt: "altKey", ctrl: "ctrlKey", control: "ctrlKey", meta: "metaKey" };
const MODIFIER_KEYS = { shift: "Shift", alt: "Alt", ctrl: "Control", control: "Control", meta: "Meta" };

/** Default keymap for `keyboard: true` (active while focus is inside `root`). */
export const DEFAULT_MOVE_KEYS = Object.freeze({
  "Alt+Shift+ArrowLeft": "window/move-before",
  "Alt+Shift+ArrowUp": "window/move-before",
  "Alt+Shift+ArrowRight": "window/move-after",
  "Alt+Shift+ArrowDown": "window/move-after",
  "Alt+Shift+PageUp": "window/swap-previous",
  "Alt+Shift+PageDown": "window/swap-next",
});

const comboOf = (event) =>
  [event.ctrlKey && "Ctrl", event.metaKey && "Meta", event.altKey && "Alt", event.shiftKey && "Shift", event.key].filter(Boolean).join("+");

/**
 * @param {object} options
 * @param {Element} options.root
 * @param {() => object} options.getState
 * @param {(command: object) => unknown} options.dispatch
 * @param {object} [options.wm] a window manager: shorthand for getState,
 *   dispatch, subscribe, present, simulate and drops
 * @param {number} [options.snap] snap floating moves to a grid
 * @param {(listener: (state: object, events: object[]) => void) => () => void} [options.subscribe]
 *   the manager's `subscribe`. When given, keyboard focus follows WM focus: after
 *   a window is focused by command (shortcut, taskbar, API), DOM focus moves into
 *   it, back to the element last focused there, else the view itself. Focus is
 *   never taken from a text field outside `root`.
 * @param {(task: () => void) => void} [options.afterRender] when to move DOM focus
 *   after a focus change (default: next animation frame, i.e. after the commit)
 * @param {number} [options.threshold] pointer travel (px) before a press on a
 *   tiled window's move handle or a tab becomes a drag (default 5), so clicks stay clicks
 * @param {number} [options.longPress] touch pointers start a drag by holding still
 *   this long (ms, default 400); moving first leaves the gesture to the browser
 * @param {"shift"|"alt"|"ctrl"|"meta"} [options.modifier] the key for
 *   toFloating/toTiled "modifier" (default "shift")
 * @param {number} [options.detachDistance] toFloating "threshold": how far (px)
 *   outside `root` the pointer must go to detach a tiled window (default 24)
 * @param {(state: object) => { render: object }} [options.present] derive + compile
 *   for the drag preview; pass the manager's `wm.present` so custom layouts work
 * @param {(command: object, state: object) => { state, events }} [options.simulate]
 *   pure dry run of a command; pass `wm.simulate` so custom drop interpreters and
 *   extensions apply (default: the built-in `update`)
 * @param {object} [options.drops] drop-interpreter registry for finding targets (wm.drops)
 * @param {(ctx: object) => void} [options.dragPreview] custom preview renderer, called
 *   whenever the intent under the pointer changes and once with `phase: "end"`:
 *   `{ phase, overlay, state, intent, drop, preview, geometry, point }`. It replaces
 *   the built-in ghost (the zone highlight stays).
 * @param {boolean|Element|((message: string) => void)} [options.announce] opt-in
 *   announcements of drag start, target, drop and cancel; and, of any command
 *   dispatched through `send`/`dispatch` (focus changes, window open/close,
 *   moves, …) — via `subscribe` when given, else straight from the returned
 *   events: `true` creates a visually hidden aria-live region inside `root`;
 *   an element is used as the region; a function receives each message.
 * @param {boolean|Record<string, string>} [options.keyboard] opt-in keyboard moving
 *   of the focused window: `true` uses DEFAULT_MOVE_KEYS, or pass a
 *   `{ "Alt+Shift+ArrowLeft": "window/move-before", … }` map. Either form also
 *   enables F6 / Shift+F6 to cycle WM focus forward/backward (`focus/next` /
 *   `focus/previous`), the desktop-app convention for moving between windows
 *   without a mouse. Independent of this option, Tab is trapped within the
 *   focused window's element whenever that window is modal (`win.modal`):
 *   Tab past the last focusable element wraps to the first, Shift+Tab past
 *   the first wraps to the last — background windows are already `inert`
 *   (see `dom.mjs`) and never receive focus.
 * @param {{ popOut(id: string): unknown, popIn(id: string): unknown }} [options.popouts] an `attachPopouts`
 *   handle: a `data-wm-command="window/pop-out"` (or `window/pop-in`) button then opens (or closes) the real
 *   browser window instead of only dispatching the command, which is what the chrome's pop-out button needs.
 * @param {number} [options.splitterStep] fraction of a split's total weight
 *   an arrow key nudges a focused splitter by (default 0.05)
 * @param {number} [options.floatStep] px a keyboard move/resize of a floating window changes it by (default 10)
 * @param {boolean|object} [options.touch] opt-in touch and pen gestures (see `touch.mjs` and docs/api/browser.md):
 *   `true` turns on pinch-to-resize for floating windows (two touches), a horizontal swipe on a tab strip to
 *   switch tabs, and a long-press context event. An object picks: `pinch` (default true), `swipe`
 *   (`{ tabs, workspaces, windows }`: a two-finger swipe switching workspaces, a one-finger swipe between the windows of a monocle or tabs stack; `false` for none), `contextMenu`
 *   (`true` dispatches a `wm-contextmenu` event on the window, a function receives
 *   `{ id, x, y, clientX, clientY, pointerType, target }`, a string is a command type dispatched with
 *   `{ type, id }`; `false` turns it off), `contextDelay` (ms, default 500), `slop`, `swipeDistance`,
 *   `workspaceSwipeDistance`. It sets `data-wm-touch` on `root`, which `BASE_CSS` maps to the `touch-action`
 *   each gesture needs.
 * @returns {() => void} detach
 */
export const attachInput = (options) => {
  const { wm } = options;
  const {
    root,
    getState = wm?.getState,
    dispatch = wm?.dispatch,
    snap,
    subscribe = wm?.subscribe,
    afterRender,
    threshold = 5,
    longPress = 400,
    modifier = "shift",
    detachDistance = 24,
    present = wm?.present,
    simulate = wm?.simulate,
    drops = wm?.drops ?? DROPS,
    dragPreview,
    announce,
    keyboard,
    splitterStep = 0.05,
    popouts,
    floatStep = 10,
    output,
    touch,
  } = options;
  // The workspace this root's stage actually shows: the given output's own
  // active workspace when this input is bound to one output (multi-output
  // rigs, one `attachInput` per stage), otherwise the globally focused
  // output's active workspace, matching this root's single-output rendering.
  const rootWorkspace = (state) => (output !== undefined ? outputActiveWorkspace(state, output) : state.activeWorkspace);
  let gesture = null; // floating move/resize in progress
  let pending = null; // press on a handle or tab, not yet a drag
  let drag = null; // tiled or tab drag in progress
  let splitter = null; // splitter drag in progress
  const doc = root.ownerDocument;
  const view = doc?.defaultView;
  const timers = {
    set: (fn, ms) => (view?.setTimeout ?? setTimeout)(fn, ms),
    clear: (id) => (view?.clearTimeout ?? clearTimeout)(id),
  };
  const lastFocused = new Map(); // view id → element last focused inside it
  const modifierProp = MODIFIERS[modifier] ?? "shiftKey";
  const modifierKey = MODIFIER_KEYS[modifier] ?? "Shift";

  const viewOf = (target) => target.closest?.("wm-view[data-view]");
  const viewElementFor = (id) => root.querySelector?.(`wm-view[data-view="${id.replace(/["\\]/g, "\\$&")}"]`);
  // Remembers every window's last-known title, so an announcement about a
  // window/closed event (whose id is already gone from state by the time the
  // event is announced) can still name it instead of falling back to its id.
  const knownTitles = new Map();
  const titleOf = (state, id) => state.windows[id]?.title || knownTitles.get(id) || id;

  const presentState = present ?? ((state) => ({ render: compile(derive(state), presentationContext(state)) }));
  const dryRun = (command, state) => {
    const out = simulate ? simulate(command, state) : update(state, command);
    return out.events.some((event) => event.type === "command/rejected") ? null : out.state;
  };

  // ------------------------------------------------------------ announcements

  let region = null;
  let ownRegion = false;
  if (announce === true) {
    region = doc.createElement("div");
    region.setAttribute("data-wm-announcer", "");
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    setStyles(region, HIDDEN_TEXT_STYLE);
    root.appendChild(region);
    ownRegion = true;
  } else if (announce && typeof announce === "object") {
    region = announce;
    if (!region.hasAttribute?.("aria-live")) region.setAttribute?.("aria-live", "polite");
  }
  const say = (message) => {
    if (!announce || !message) return;
    if (typeof announce === "function") announce(message);
    else if (region) region.textContent = message;
  };
  const describeEvent = (state, event) => {
    const t = (id) => titleOf(state, id);
    switch (event.type) {
      case "window/dropped":
        return event.op === "split"
          ? `${t(event.id)} placed ${event.zone} of ${t(event.target)}.`
          : event.op === "swap" && !event.tiled
            ? `${t(event.id)} swapped with ${t(event.target)}.`
            : `${t(event.id)} moved ${event.op === "after" ? "after" : "before"} ${t(event.target)}.`;
      case "window/swapped":
        return `${t(event.id)} swapped with ${t(event.target)}.`;
      case "window/reordered":
        return `${t(event.id)} moved ${event.position} ${t(event.target)}.`;
      case "window/detached":
        return `${t(event.id)} is now floating.`;
      case "window/workspace-changed":
        return `${t(event.id)} moved to workspace ${event.workspace}.`;
      // a11y: focus changes and open/close, narrated the same way as drag events
      // (only via `announce`; nothing here fires unless that option is set).
      case "window/focused":
        return event.id ? `${t(event.id)} focused.` : null;
      case "window/created":
        return `${t(event.id)} opened.`;
      case "window/closed":
        return `${t(event.id)} closed.`;
      default:
        return null;
    }
  };
  const announceEvents = (events = []) => {
    const state = getState();
    for (const win of Object.values(state.windows)) knownTitles.set(win.id, win.title);
    const messages = events.map((event) => describeEvent(state, event)).filter(Boolean);
    if (messages.length) say(messages.join(" "));
  };
  /** Dispatch; without `subscribe`, announce from the returned events. */
  const send = (command) => {
    const out = dispatch(command);
    if (!subscribe) announceEvents(out?.events);
    return out;
  };

  // ------------------------------------------------------------ geometry helpers

  /** Realized rects of the views actually shown (not hidden stack children or projections), root-relative. */
  const measureViews = () => {
    const origin = root.getBoundingClientRect();
    const out = {};
    for (const element of root.querySelectorAll("wm-view[data-view]")) {
      if (element.hasAttribute("data-view-projection") || element.closest("[data-wm-drag-overlay]")) continue;
      if (element.closest("[inert]") && !element.hasAttribute("data-wm-blocked")) continue;
      const r = element.getBoundingClientRect();
      out[element.getAttribute("data-view")] = { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
    }
    return out;
  };

  const localPoint = (event) => {
    const origin = root.getBoundingClientRect();
    return { x: event.clientX - origin.left, y: event.clientY - origin.top };
  };

  /** `root`'s own rect, root-relative — the "stage" snap zones are measured against. */
  const stageRect = () => {
    const r = root.getBoundingClientRect();
    return { x: 0, y: 0, width: r.width, height: r.height };
  };

  // ------------------------------------------------------------ right-to-left
  // `config.direction: "rtl"` mirrors the horizontal axis. Pointer positions are always physical, but a
  // floating window's `x` is measured from the right edge in RTL, so floating gestures run in physical
  // space (mirrored in on the way in, and back out on the way to the command). `mirrorRect` is its own inverse.
  const isRtlNow = () => getState().config?.direction === "rtl";
  const mirrorRect = (r) => {
    if (!isRtlNow() || !r || !Number.isFinite(r.x) || !Number.isFinite(r.width)) return r;
    return { ...r, x: stageRect().width - r.x - r.width };
  };
  /** 1 in a left-to-right stage, -1 in a right-to-left one: the sign of a horizontal "forward". */
  const flow = () => (isRtlNow() ? -1 : 1);

  /** Effective `config.snap`, defaulting fields a state saved before this feature omits. */
  const snapConfigOf = (state) => ({ ...DEFAULT_CONFIG.snap, ...state.config.snap });

  /**
   * Rects (root-relative) of every window visible on the active workspace but `selfId`,
   * plus the stage. `isVisible` already treats a sticky window on another workspace as
   * visible here (see state/queries.mjs) — it really is on-screen, magnetism should snap
   * onto it too, so this doesn't re-filter by `win.workspace`.
   */
  const otherRects = (state, selfId, geometry) => {
    const rects = [stageRect()];
    for (const win of Object.values(state.windows)) {
      if (win.id === selfId || !isVisible(state, win.id)) continue;
      const r = win.mode === "floating" ? mirrorRect(win.placement) : geometry?.[win.id];
      if (r) rects.push(r);
    }
    return rects;
  };

  /** The workspace target under the pointer, anywhere on the page. */
  const workspaceTargetAt = (event) => {
    const stack = doc.elementsFromPoint?.(event.clientX, event.clientY) ?? [];
    for (const element of stack) {
      const target = element.closest?.("[data-wm-workspace-target]");
      if (target) return { id: target.getAttribute("data-wm-workspace-target"), element: target };
    }
    return null;
  };

  const outsideRoot = (event, distance) => {
    const r = root.getBoundingClientRect();
    return (
      event.clientX < r.left - distance ||
      event.clientX > r.left + r.width + distance ||
      event.clientY < r.top - distance ||
      event.clientY > r.top + r.height + distance
    );
  };

  // ------------------------------------------------------------ splitters

  /** The current weights of the split at `path` (full array), matching the layout's own defaults when unset. */
  const readSplitWeights = (state, workspaceId, path, count) => {
    const spec = state.workspaces[workspaceId]?.layout;
    if (!spec) return new Array(count).fill(1);
    if (spec.type === "master-stack") {
      const ratio = typeof spec.ratio === "number" ? spec.ratio : 0.5;
      return spec.side === "right" ? [1 - ratio, ratio] : [ratio, 1 - ratio];
    }
    if (spec.type === "bsp") {
      const ratio = bspNodeAt(spec.tree ?? null, path)?.ratio ?? 0.5;
      return [ratio, 1 - ratio];
    }
    if (spec.type === "spiral") {
      const depth = Number(path);
      const ratio = Array.isArray(spec.ratios) && typeof spec.ratios[depth] === "number" ? spec.ratios[depth] : spec.ratio ?? 0.5;
      return [ratio, 1 - ratio];
    }
    const stored = spec.sizes?.[""];
    return Array.isArray(stored) && stored.length === count ? stored.slice() : new Array(count).fill(1);
  };

  /** The view id of an element's single window, if it wraps exactly one (for constraint clamping). */
  const singleViewId = (el) => {
    if (!el || el.nodeType !== 1) return null;
    if (el.getAttribute?.("data-view")) return el.getAttribute("data-view");
    const views = el.querySelectorAll?.("wm-view[data-view]") ?? [];
    return views.length === 1 ? views[0].getAttribute("data-view") : null;
  };

  /**
   * Shrink `pixelDelta` (toward zero, never past it) so neither adjacent pane
   * would cross a min/max constraint — best-effort: it only sees a constraint
   * when a side wraps a single window directly (the common case for
   * columns/rows/master-stack/bsp; a nested container is not narrowed).
   */
  const clampSplitterPixelDelta = (session, pixelDelta) => {
    const state = getState();
    const axis = session.axis;
    const minKey = axis === "x" ? "minWidth" : "minHeight";
    const maxKey = axis === "x" ? "maxWidth" : "maxHeight";
    let delta = pixelDelta;
    const prevC = state.windows[session.prevId]?.constraints;
    if (prevC && session.prevSize !== undefined) {
      if (Number.isFinite(prevC[minKey])) delta = Math.max(delta, prevC[minKey] - session.prevSize);
      if (Number.isFinite(prevC[maxKey])) delta = Math.min(delta, prevC[maxKey] - session.prevSize);
    }
    const nextC = state.windows[session.nextId]?.constraints;
    if (nextC && session.nextSize !== undefined) {
      if (Number.isFinite(nextC[minKey])) delta = Math.min(delta, session.nextSize - nextC[minKey]);
      if (Number.isFinite(nextC[maxKey])) delta = Math.max(delta, session.nextSize - nextC[maxKey]);
    }
    return delta;
  };

  /** New [a, b] for a pair given a weight delta, keeping each side at least 5% of the pair. */
  const nudgePair = (a0, b0, weightDelta) => {
    const total = a0 + b0;
    const minShare = total * 0.05;
    const a = Math.min(total - minShare, Math.max(minShare, a0 + weightDelta));
    return [a, total - a];
  };

  const startSplitter = (el, event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const path = el.getAttribute("data-wm-path") ?? "";
    const index = Number(el.getAttribute("data-wm-index") ?? 0);
    const count = Number(el.getAttribute("data-wm-count") ?? 2);
    const axis = el.getAttribute("aria-orientation") === "vertical" ? "x" : "y";
    const state = getState();
    const workspace = rootWorkspace(state);
    const container = el.parentNode;
    const rect = container?.getBoundingClientRect?.() ?? { width: 0, height: 0 };
    const mainSize = Math.max(1, (axis === "x" ? rect.width : rect.height) - (count - 1) * SPLITTER_SIZE);
    const prevEl = el.previousSibling;
    const nextEl = el.nextSibling;
    const prevRect = prevEl?.getBoundingClientRect?.();
    const nextRect = nextEl?.getBoundingClientRect?.();
    splitter = {
      token: gestureToken(),
      workspace,
      path,
      index,
      axis,
      mainSize,
      baseline: readSplitWeights(state, workspace, path, count),
      pointerId: event.pointerId,
      origin: axis === "x" ? event.clientX : event.clientY,
      prevId: singleViewId(prevEl),
      nextId: singleViewId(nextEl),
      prevSize: axis === "x" ? prevRect?.width : prevRect?.height,
      nextSize: axis === "x" ? nextRect?.width : nextRect?.height,
      el,
    };
    el.setAttribute("data-wm-active", "");
    try {
      el.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic or already-released pointer.
    }
    listenKeys(true);
    syncWatch();
    event.preventDefault?.();
  };

  const updateSplitter = (event) => {
    const pos = splitter.axis === "x" ? event.clientX : event.clientY;
    // The first pane is on the right in RTL: moving the pointer right then shrinks it.
    const travel = splitter.axis === "x" ? (pos - splitter.origin) * flow() : pos - splitter.origin;
    const pixelDelta = clampSplitterPixelDelta(splitter, travel);
    const { baseline, index, mainSize } = splitter;
    const total = baseline[index] + baseline[index + 1];
    const weightDelta = mainSize > 0 ? (pixelDelta * total) / mainSize : 0;
    const weights = baseline.slice();
    [weights[index], weights[index + 1]] = nudgePair(baseline[index], baseline[index + 1], weightDelta);
    dispatch({ type: "layout/resize-split", workspace: splitter.workspace, path: splitter.path, index, weights, gesture: splitter.token });
  };

  const endSplitter = (commit) => {
    const session = splitter;
    splitter = null;
    listenKeys(false);
    syncWatch();
    session.el.removeAttribute("data-wm-active");
    try {
      session.el.releasePointerCapture?.(session.pointerId);
    } catch {
      // Already released.
    }
    if (!commit) {
      // Escape: put the split back, within the same gesture (one undo step).
      dispatch({
        type: "layout/resize-split",
        workspace: session.workspace,
        path: session.path,
        index: session.index,
        weights: session.baseline.slice(),
        gesture: session.token,
      });
    }
  };

  const ARROW_AXIS = { ArrowLeft: "x", ArrowRight: "x", ArrowUp: "y", ArrowDown: "y" };
  const ARROW_SIGN = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 };

  /** Arrow keys on a focused splitter nudge it by `splitterStep` of the pair's total. */
  const onSplitterKeyDown = (splitterEl, event) => {
    const axis = ARROW_AXIS[event.key];
    if (!axis) return false;
    if (axis !== (splitterEl.getAttribute("aria-orientation") === "vertical" ? "x" : "y")) return false;
    event.preventDefault?.();
    const path = splitterEl.getAttribute("data-wm-path") ?? "";
    const index = Number(splitterEl.getAttribute("data-wm-index") ?? 0);
    const count = Number(splitterEl.getAttribute("data-wm-count") ?? 2);
    const state = getState();
    const workspace = rootWorkspace(state);
    const weights = readSplitWeights(state, workspace, path, count);
    const total = weights[index] + weights[index + 1];
    // Right-to-left: the first pane is on the right, so the right arrow shrinks it.
    const sign = ARROW_SIGN[event.key] * (axis === "x" ? flow() : 1);
    [weights[index], weights[index + 1]] = nudgePair(weights[index], weights[index + 1], sign * total * splitterStep);
    send({ type: "layout/resize-split", workspace, path, index, weights });
    return true;
  };

  // ------------------------------------------------------------ visuals (overlay, ghost, zone, line)

  const createVisuals = () => {
    const overlay = doc.createElement("div");
    overlay.setAttribute("data-wm-drag-overlay", "");
    overlay.setAttribute("aria-hidden", "true");
    // The overlay is also the iframe shield: it covers every surface in root,
    // so pointer events keep coming to this document during the drag.
    setStyles(overlay, {
      position: "absolute",
      inset: "0",
      "z-index": "2147483000",
      background: "transparent",
      "pointer-events": "auto",
      "touch-action": "none",
    });
    const ghostHost = doc.createElement("div");
    ghostHost.setAttribute("data-wm-drag-ghost", "");
    setStyles(ghostHost, { position: "absolute", inset: "0", "pointer-events": "none" });
    const zoneEl = doc.createElement("div");
    zoneEl.setAttribute("data-wm-drop-zone", "");
    setStyles(zoneEl, {
      position: "absolute",
      display: "none",
      "pointer-events": "none",
      background: "var(--wa-zone-fill)",
      outline: "var(--wa-ghost-line-width) solid var(--wa-zone-line)",
      "outline-offset": "calc(-1 * var(--wa-ghost-line-width))",
      "border-radius": "var(--wa-radius-md)",
    });
    const lineEl = doc.createElement("div");
    lineEl.setAttribute("data-wm-drop-line", "");
    setStyles(lineEl, {
      position: "absolute",
      display: "none",
      width: "calc(var(--wa-ghost-line-width) * 1.5)",
      "pointer-events": "none",
      background: "var(--wa-zone-line)",
      "border-radius": "var(--wa-radius-sm)",
    });
    overlay.append(ghostHost, zoneEl, lineEl);
    if (view?.getComputedStyle && view.getComputedStyle(root).position === "static") root.style.setProperty("position", "relative");
    root.appendChild(overlay);
    return { overlay, ghostHost, zoneEl, lineEl, ghost: null, ghostGeometry: null, active: null };
  };

  const destroyVisuals = (visuals) => {
    if (!visuals) return;
    visuals.ghost?.destroy();
    visuals.overlay.remove();
    visuals.active?.removeAttribute("data-wm-drop-active");
  };

  const showZone = (visuals, geometry, drop) => {
    const { zoneEl } = visuals;
    if (!drop || !geometry[drop.target]) {
      zoneEl.style.setProperty("display", "none");
      zoneEl.removeAttribute("data-zone");
      zoneEl.removeAttribute("data-target");
      return;
    }
    // A swap takes the whole target; an insert or split, the edge half it lands in.
    const r = drop.op === "swap" ? { ...geometry[drop.target] } : zoneRect(geometry[drop.target], drop.zone);
    zoneEl.setAttribute("data-zone", drop.zone);
    zoneEl.setAttribute("data-op", drop.op);
    zoneEl.setAttribute("data-target", drop.target);
    setStyles(zoneEl, { display: "block", left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  };

  /** The half/quarter/maximize preview for a floating window nearing a stage edge or corner. */
  const showSnapZone = (visuals, rect, zone) => {
    const { zoneEl } = visuals;
    if (!rect) {
      zoneEl.style.setProperty("display", "none");
      zoneEl.removeAttribute("data-zone");
      return;
    }
    zoneEl.setAttribute("data-zone", zone);
    zoneEl.setAttribute("data-op", "snap");
    zoneEl.removeAttribute("data-target");
    setStyles(zoneEl, { display: "block", left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  };

  const showLine = (visuals, rect) => {
    if (!rect) {
      visuals.lineEl.style.setProperty("display", "none");
      return;
    }
    setStyles(visuals.lineEl, { display: "block", left: `${rect.x}px`, top: `${rect.y}px`, height: `${rect.height}px`, translate: "-50% 0" });
  };

  const showWorkspaceTarget = (visuals, element) => {
    if (visuals.active === element) return;
    visuals.active?.removeAttribute("data-wm-drop-active");
    visuals.active = element ?? null;
    element?.setAttribute("data-wm-drop-active", "");
  };

  const showGhost = (visuals, state, next, dragged) => {
    visuals.ghostGeometry = null;
    if (!next || state.config.drag?.preview === false) {
      visuals.ghost?.destroy();
      visuals.ghost = null;
      return;
    }
    let render;
    try {
      render = presentState(unconstrained(next)).render;
    } catch {
      return; // e.g. a custom layout the default `present` cannot derive
    }
    const workspace = rootWorkspace(next);
    const shown = new Set(tiledOrder(next, workspace));
    if (next.windows[dragged]?.workspace === workspace) shown.add(dragged);
    const titles = Object.fromEntries(Object.values(next.windows).map((win) => [win.id, win.title]));
    visuals.ghost ??= createDomRenderer({ root: visuals.ghostHost, document: doc, anchorFallback: false });
    visuals.ghost.commit(ghostify(render, { shown, dragged, titles }));
    visuals.ghostGeometry = visuals.ghost.measure();
    // Flag slots that would violate a window's min/max constraints.
    for (const id of shown) {
      const r = visuals.ghostGeometry[id];
      const el = visuals.ghost.elementFor(id);
      if (r && el && next.windows[id].mode === "tiled" && violates(next.windows[id].constraints, r)) {
        el.setAttribute("data-wm-too-small", "");
        setStyles(el, GHOST_TOO_SMALL_STYLE);
      }
    }
  };

  // ------------------------------------------------------------ intents

  /**
   * What releasing the pointer now would do, for a session
   * `{ kind: "tiled" | "tab" | "floating", id, geometry, ... }`:
   *   { type: "workspace", workspace, element } | { type: "detach", command }
   *   | { type: "drop", drop, line? } | null
   */
  const intentFor = (session, event) => {
    const state = getState();
    const settings = state.config.drag ?? {};
    const win = state.windows[session.id];
    if (!win) return null;
    if (settings.crossWorkspace !== false && !win.parent) {
      const ws = workspaceTargetAt(event);
      if (ws && state.workspaces[ws.id] && ws.id !== win.workspace) {
        return { type: "workspace", key: `ws:${ws.id}`, workspace: ws.id, element: ws.element };
      }
    }
    const point = localPoint(event);
    if (session.kind === "tab") {
      // The nearest tab along the strip (so past the last tab means "last"), within a band around it.
      const gap = (tab) => Math.max(tab.rect.x - point.x, 0, point.x - (tab.rect.x + tab.rect.width));
      const band = session.tabs.filter((tab) => point.y >= tab.rect.y - 24 && point.y <= tab.rect.y + tab.rect.height + 24);
      const hit = band.sort((a, b) => gap(a) - gap(b))[0];
      if (!hit || hit.id === session.id) return null;
      const zone = point.x < hit.rect.x + hit.rect.width / 2 ? "left" : "right";
      return {
        type: "drop",
        key: `tab:${hit.id}:${zone}`,
        // The strip runs right to left in RTL: the screen-left half of a tab is the later side of it.
        drop: { id: session.id, target: hit.id, zone, op: (zone === "left") === !isRtlNow() ? "before" : "after" },
        line: { x: zone === "left" ? hit.rect.x : hit.rect.x + hit.rect.width, y: hit.rect.y, height: hit.rect.height },
      };
    }
    const held = Boolean(event[modifierProp]);
    if (session.kind === "tiled") {
      const detaching =
        settings.toFloating === "modifier" ? held : settings.toFloating === "threshold" ? outsideRoot(event, detachDistance) : false;
      if (detaching) {
        // At the pointer (keeping the grab offset), clamped inside the stage when it fits.
        const rootRect = root.getBoundingClientRect();
        const { width, height } = win.placement;
        const grabX = Math.min(session.grab.x, Math.max(24, width - 24));
        // The window's left edge on screen follows the pointer (keeping the grab offset); its `x` is measured
        // from the inline-start edge, so in RTL that is the right edge. Clamped inside the stage when it fits.
        const left = point.x - grabX;
        const raw = isRtlNow() ? rootRect.width - left - width : left;
        const x = Math.round(Math.min(Math.max(raw, 0), Math.max(0, rootRect.width - width)));
        const y = Math.round(Math.min(Math.max(point.y - session.grab.y, 0), Math.max(0, rootRect.height - height)));
        return { type: "detach", key: "detach", command: { type: "window/detach", id: session.id, x, y } };
      }
    }
    if (session.kind === "floating") {
      const allowed = settings.toTiled === "always" || (settings.toTiled === "modifier" && held);
      const found = allowed ? dropTargetAt(state, session.geometry ?? {}, point, session.id, { drops, allowFloating: true }) : null;
      if (found) return { type: "drop", key: `drop:${found.target}:${found.zone}`, drop: { id: session.id, ...found } };
      const snapCfg = snapConfigOf(state);
      const zone = snapZoneAt(stageRect(), point, snapCfg);
      return zone ? { type: "snap", key: `snap:${zone}`, zone } : null;
    }
    const found = dropTargetAt(state, session.geometry ?? {}, point, session.id, { drops, allowFloating: session.kind === "floating" });
    return found ? { type: "drop", key: `drop:${found.target}:${found.zone}`, drop: { id: session.id, ...found } } : null;
  };

  const intentMessage = (state, intent) => {
    if (!intent) return "No drop target.";
    if (intent.type === "workspace") return `Release to move to workspace ${intent.workspace}.`;
    if (intent.type === "detach") return "Release to float.";
    if (intent.type === "snap") return `Release to snap ${intent.zone}.`;
    const { op, target, zone } = intent.drop;
    const t = titleOf(state, target);
    return op === "swap" ? `Release to swap with ${t}.` : op === "split" ? `Release to place ${zone} of ${t}.` : `Release to move ${op} ${t}.`;
  };

  /** Re-evaluate a session's intent and update the visuals when it changed. */
  const track = (session, event) => {
    session.last = { clientX: event.clientX, clientY: event.clientY, [modifierProp]: Boolean(event[modifierProp]) };
    const intent = intentFor(session, event);
    const key = intent?.key ?? null;
    // Same target and zone: nothing to redraw (a detach follows the pointer, so it always redraws;
    // a workspace switcher may have re-rendered its element).
    if (key === session.key && intent?.type !== "detach") {
      if (intent?.type === "workspace" && session.intent && session.visuals) {
        session.intent = { ...session.intent, element: intent.element };
        showWorkspaceTarget(session.visuals, intent.element);
      }
      return;
    }
    const state = getState();
    let next = null;
    if (intent?.type === "drop") next = dryRun({ type: "window/drop", id: intent.drop.id, target: intent.drop.target, zone: intent.drop.zone }, state);
    else if (intent?.type === "detach") next = dryRun(intent.command, state);
    else if (intent?.type === "workspace" || intent?.type === "snap") next = state;
    const valid = intent && next ? intent : null;
    const changed = (valid?.key ?? null) !== (session.intent?.key ?? null);
    session.key = key;
    session.intent = valid;
    if (valid && !session.visuals) session.visuals = createVisuals();
    const visuals = session.visuals;
    if (visuals) {
      const ghostState = (valid?.type === "drop" && !valid.line) || valid?.type === "detach" ? next : null;
      showWorkspaceTarget(visuals, valid?.type === "workspace" ? valid.element : null);
      if (valid?.type === "snap") showSnapZone(visuals, snapZoneRect(stageRect(), valid.zone), valid.zone);
      else showZone(visuals, session.geometry ?? {}, valid?.type === "drop" && !valid.line ? valid.drop : null);
      showLine(visuals, valid?.line);
      if (!dragPreview) showGhost(visuals, state, ghostState, session.id);
      else if (changed || valid?.type === "detach") {
        dragPreview({
          phase: "update",
          overlay: visuals.overlay,
          state,
          intent: valid,
          drop: valid?.type === "drop" ? valid.drop : null,
          preview: ghostState,
          geometry: session.geometry,
          point: localPoint(event),
        });
      }
    }
    if (changed) say(intentMessage(state, valid));
  };

  /** The command a session's intent commits to (none without an intent). */
  const commandsFor = (session) => {
    const intent = session.intent;
    if (!intent) return [];
    const state = getState();
    if (intent.type === "workspace") {
      return [{ type: "window/move-to-workspace", id: session.id, workspace: intent.workspace, ...(state.config.drag?.follow ? { follow: true } : {}) }];
    }
    if (intent.type === "detach") return [intent.command];
    if (intent.type === "snap") {
      const rect = mirrorRect(snapZoneRect(stageRect(), intent.zone));
      return [{ type: "window/resize", id: session.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
    }
    const { id, target, zone } = intent.drop;
    const command = { type: "window/drop", id, target, zone };
    const ghostGeometry = session.visuals?.ghostGeometry;
    if (state.config.drag?.tooSmall === "reject" && ghostGeometry) {
      command.geometry = Object.fromEntries(
        [id, target]
          .filter((wid) => ghostGeometry[wid])
          .map((wid) => [wid, { width: ghostGeometry[wid].width, height: ghostGeometry[wid].height }]),
      );
    }
    return [command];
  };

  const endVisuals = (session, commit) => {
    if (dragPreview && session.visuals) {
      dragPreview({
        phase: "end",
        overlay: session.visuals.overlay,
        state: getState(),
        intent: commit ? session.intent : null,
        drop: commit && session.intent?.type === "drop" ? session.intent.drop : null,
        preview: null,
        geometry: session.geometry,
        point: null,
      });
    }
    destroyVisuals(session.visuals);
    session.visuals = null;
  };

  /**
   * While a press or drag is live, also hear pointer events outside `root`:
   * the pointer may leave the stage (toward a workspace tab) before the drag
   * starts, i.e. before `root` captures it. Events inside `root` are left to
   * the root listeners.
   */
  let watching = false;
  const outside = (fn) => (event) => {
    if (!root.contains?.(event.target)) fn(event);
  };
  let docListeners = null;
  const syncWatch = () => {
    const want = Boolean(pending || drag || gesture || splitter);
    if (want === watching || !doc.addEventListener) return;
    watching = want;
    docListeners ??= { pointermove: outside(onPointerMove), pointerup: outside(onPointerUp), pointercancel: outside(onPointerCancel) };
    for (const [type, fn] of Object.entries(docListeners)) doc[want ? "addEventListener" : "removeEventListener"](type, fn, true);
  };

  const listenKeys = (on) => {
    const method = on ? "addEventListener" : "removeEventListener";
    doc[method]?.("keydown", onKeyDown, true);
    doc[method]?.("keyup", onKeyDown, true);
  };

  // ------------------------------------------------------------ tiled / tab drags

  const startDrag = (event) => {
    const { id, pointerId, kind, grab, tabs } = pending;
    clearPending();
    const state = getState();
    const session = {
      kind,
      id,
      pointerId,
      geometry: kind === "tiled" ? measureViews() : null,
      grab,
      tabs,
      intent: null,
      key: undefined,
      visuals: null,
    };
    if (kind === "tiled") session.visuals = createVisuals(); // the shield, from the first move
    root.setAttribute("data-wm-dragging", "");
    session.source = kind === "tab" ? tabs.find((tab) => tab.id === id)?.element : viewElementFor(id);
    session.source?.setAttribute("data-wm-drag-source", "");
    try {
      root.setPointerCapture?.(pointerId);
    } catch {
      // A synthetic or already-released pointer: the overlay still shields.
    }
    listenKeys(true);
    drag = session;
    syncWatch();
    say(`Dragging ${titleOf(state, id)}. Escape cancels.`);
    track(session, event);
  };

  const endDrag = (commit) => {
    const session = drag;
    drag = null;
    listenKeys(false);
    syncWatch();
    try {
      root.releasePointerCapture?.(session.pointerId);
    } catch {
      // Already released.
    }
    const commands = commit ? commandsFor(session) : []; // before the ghost (and its measurements) goes
    endVisuals(session, commit);
    root.removeAttribute("data-wm-dragging");
    session.source?.removeAttribute("data-wm-drag-source");
    if (!commit) {
      say("Drag cancelled.");
      return;
    }
    if (!commands.length) {
      say("Drag ended; nothing moved.");
      return;
    }
    for (const command of commands) send(command);
  };

  const clearPending = () => {
    if (pending?.timer !== undefined) timers.clear(pending.timer);
    pending?.denied?.removeAttribute("data-wm-drag-denied");
    pending = null;
    syncWatch();
  };

  /** Arm a press: mouse/pen start after `threshold` px, touch after a still `longPress`. */
  const arm = (event, press) => {
    pending = { ...press, origin: { x: event.clientX, y: event.clientY }, pointerId: event.pointerId, touch: event.pointerType === "touch", last: event };
    press.denied?.setAttribute("data-wm-drag-denied", "");
    syncWatch();
    if (pending.touch && press.kind !== "denied") {
      const armed = pending;
      armed.timer = timers.set(() => {
        if (pending !== armed) return;
        armed.timer = undefined;
        startDrag(armed.last);
      }, longPress);
    }
  };

  // ------------------------------------------------------------ floating gestures

  const endGesture = (commit) => {
    const session = gesture;
    gesture = null;
    syncWatch();
    if (!session || session.kind !== "floating") return;
    listenKeys(false);
    const intent = commit ? session.intent : null;
    const commands = intent ? commandsFor(session) : [];
    endVisuals(session, Boolean(intent));
    if (!commit) {
      // Escape or pointercancel: put the window back, within the same gesture (one undo step).
      if (session.moved) send({ type: "window/move", id: session.id, x: session.start.x, y: session.start.y, gesture: session.token });
      say("Drag cancelled.");
      return;
    }
    if (!intent) return;
    // Across workspaces the window keeps its place; into the layout it keeps its floating size.
    if (intent.type === "workspace") {
      send({ type: "window/move", id: session.id, x: session.start.x, y: session.start.y, gesture: session.token });
    }
    for (const command of commands) send({ ...command, gesture: session.token });
  };

  // ------------------------------------------------------------ pointer stream

  const onPointerDown = (event) => {
    // A second finger on the stage is a pinch or a swipe, not a stacked gesture.
    if (touchGestures?.down(event)) return;
    // A second pointer (or a lost pointerup) never stacks gestures.
    if (drag) endDrag(false);
    if (gesture) endGesture(false);
    if (splitter) endSplitter(false);
    clearPending();
    const state = getState();

    const splitterEl = event.target.closest?.("[data-wm-splitter]");
    if (splitterEl) {
      startSplitter(splitterEl, event);
      return;
    }

    const tab = event.target.closest?.("[data-wm-tab]");
    if (tab) {
      const id = tab.getAttribute("data-wm-tab");
      dispatch({ type: "window/focus", id });
      const win = state.windows[id];
      if (!win || (event.button !== undefined && event.button !== 0)) return;
      if (win.draggable === false) {
        arm(event, { kind: "denied", id, denied: tab });
        return;
      }
      if (!isDroppable(state, win) || isBlocked(state, id) || dragMode(state, win.workspace) === "off") return;
      const origin = root.getBoundingClientRect();
      const tabs = [...(tab.parentNode?.querySelectorAll?.("[data-wm-tab]") ?? [tab])].map((element) => {
        const r = element.getBoundingClientRect();
        return {
          id: element.getAttribute("data-wm-tab"),
          element,
          rect: { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height },
        };
      });
      arm(event, { kind: "tab", id, tabs });
      return;
    }

    const viewElement = viewOf(event.target);
    if (!viewElement || viewElement.closest?.("[data-wm-drag-overlay]")) return;
    const id = viewElement.getAttribute("data-view");
    const win = state.windows[id];
    if (!win) return;
    if (state.focus.window !== id) dispatch({ type: "window/focus", id });
    // A window blocked by a modal only redirects focus (above); no drags or resizes.
    if (isBlocked(state, id)) {
      event.preventDefault();
      return;
    }

    const handle = event.target.closest?.("[data-wm-handle]");
    if (!handle) return;
    // Controls inside a handle (title-bar buttons, inputs) must keep their own
    // click: starting a gesture would capture the pointer on the handle and
    // retarget pointerup/click away from the control.
    const control = event.target.closest?.(INTERACTIVE);
    if (control && control !== handle && control.closest?.("[data-wm-handle]") === handle) return;
    if (event.button !== undefined && event.button !== 0) return;
    const kind = handle.getAttribute("data-wm-handle");
    const origin = { x: event.clientX, y: event.clientY };

    // Pinned windows do not move: show "not allowed" for the length of the press.
    if (kind === "move" && win.draggable === false) {
      arm(event, { kind: "denied", id, denied: viewElement });
      event.preventDefault();
      return;
    }

    if (win.mode === "floating" && win.status === "normal") {
      if (kind === "move") {
        gesture = {
          kind: "floating",
          id,
          token: gestureToken(),
          op: createDrag({ origin, bounds: mirrorRect(win.placement) }),
          start: { ...win.placement },
          pointerId: event.pointerId,
          intent: null,
          key: undefined,
          visuals: null,
        };
      } else if (kind.startsWith("resize-")) {
        gesture = {
          kind: "resize",
          id,
          token: gestureToken(),
          op: createResize({ origin, bounds: mirrorRect(win.placement), edge: kind.slice(7), constraints: win.constraints }),
          pointerId: event.pointerId,
        };
      } else {
        return;
      }
      syncWatch();
      try {
        handle.setPointerCapture?.(event.pointerId);
      } catch {
        // No active pointer with that id (synthetic events): the document listeners still follow it.
      }
      event.preventDefault();
      return;
    }

    // A tiled window's title bar: a potential drag, decided by the threshold (or a long press).
    if (kind === "move" && isDroppable(state, win) && dragMode(state, win.workspace) !== "off") {
      const r = viewElement.getBoundingClientRect();
      arm(event, { kind: "tiled", id, grab: { x: event.clientX - r.left, y: event.clientY - r.top } });
      event.preventDefault();
    }
  };

  const onPointerMove = (event) => {
    if (touchGestures?.move(event)) return;
    if (splitter) {
      if (splitter.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== splitter.pointerId) return;
      updateSplitter(event);
      return;
    }
    if (gesture) {
      if (gesture.pointerId !== undefined && event.pointerId !== undefined && event.pointerId !== gesture.pointerId) return;
      const pointer = { x: event.clientX, y: event.clientY };
      if (gesture.kind === "floating") {
        // Other windows' rects do not change while a floating window moves: measure once.
        gesture.geometry ??= measureViews();
        const state = getState();
        const win = state.windows[gesture.id];
        const raw = updateDrag(gesture.op, pointer, { snap });
        const snapCfg = snapConfigOf(state);
        const moved = { ...raw, width: win?.placement.width ?? 0, height: win?.placement.height ?? 0 };
        const magnetized = snapCfg.magnet > 0 ? magnetize(moved, otherRects(state, gesture.id, gesture.geometry), snapCfg) : moved;
        const placed = mirrorRect(magnetized); // physical -> the window's own (inline-start) x
        dispatch({ type: "window/move", id: gesture.id, x: placed.x, y: placed.y, gesture: gesture.token });
        if (!gesture.moved) {
          gesture.moved = true;
          listenKeys(true);
        }
        track(gesture, event);
      } else {
        const state = getState();
        gesture.geometry ??= measureViews();
        const raw = updateResize(gesture.op, pointer);
        const snapCfg = snapConfigOf(state);
        const resized = mirrorRect(snapCfg.magnet > 0 ? magnetizeResize(raw, otherRects(state, gesture.id, gesture.geometry), gesture.op.edge, snapCfg) : raw);
        dispatch({ type: "window/resize", id: gesture.id, ...resized, gesture: gesture.token });
      }
      return;
    }
    if (pending) {
      if (event.pointerId !== pending.pointerId) return;
      pending.last = event;
      if (Math.hypot(event.clientX - pending.origin.x, event.clientY - pending.origin.y) < threshold) return;
      if (pending.kind === "denied") {
        if (!pending.said) say(`${titleOf(getState(), pending.id)} is pinned and cannot be moved.`);
        pending.said = true;
        return;
      }
      // Touch: moving before the long press fires hands the gesture back to the browser.
      if (pending.touch) {
        clearPending();
        return;
      }
      startDrag(event);
      return;
    }
    if (drag && event.pointerId === drag.pointerId) track(drag, event);
  };

  const onPointerUp = (event) => {
    touchGestures?.up(event);
    clearPending();
    if (splitter && (event?.pointerId === undefined || event.pointerId === splitter.pointerId)) endSplitter(true);
    if (gesture) endGesture(true);
    if (drag && (event?.pointerId === undefined || event.pointerId === drag.pointerId)) endDrag(true);
  };

  const onPointerCancel = (event) => {
    if (event) touchGestures?.up(event, true);
    clearPending();
    if (splitter) endSplitter(false);
    if (gesture) endGesture(false);
    if (drag) endDrag(false);
  };

  function onKeyDown(event) {
    if (splitter && event.key === "Escape" && event.type !== "keyup") {
      event.preventDefault?.();
      event.stopPropagation?.();
      endSplitter(false);
      return;
    }
    const session = drag ?? (gesture?.kind === "floating" ? gesture : null);
    if (!session) return;
    if (event.key === "Escape" && event.type !== "keyup") {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (drag) endDrag(false);
      else endGesture(false);
      return;
    }
    // The modifier pressed or released without moving the pointer.
    if (event.key === modifierKey && session.last) {
      track(session, { ...session.last, [modifierProp]: event.type !== "keyup" });
    }
  }

  const onContextMenu = (event) => {
    // A long press would otherwise open the context menu on touch devices.
    if (pending?.touch || drag || touchGestures?.recentContext()) event.preventDefault?.();
  };

  const onClick = (event) => {
    const button = event.target.closest?.("[data-wm-command]");
    if (!button) return;
    const viewElement = viewOf(button);
    const id = button.getAttribute("data-wm-target") ?? viewElement?.getAttribute("data-view");
    const type = button.getAttribute("data-wm-command");
    if (popouts && type === "window/pop-out") return void popouts.popOut(id);
    if (popouts && type === "window/pop-in") return void popouts.popIn(id);
    dispatch({ type, id });
  };

  // Double-click on a `data-wm-dblclick` element (the chrome's title bar) runs that command on its window.
  // A control inside it (a title-bar button, an input) keeps its own click and does not count.
  const onDblClick = (event) => {
    const target = event.target?.closest?.("[data-wm-dblclick]");
    if (!target) return;
    const control = event.target.closest?.(INTERACTIVE);
    if (control && control !== target && target.contains?.(control)) return;
    const viewElement = viewOf(target);
    const id = target.getAttribute("data-wm-target") ?? viewElement?.getAttribute("data-view");
    if (!id || isBlocked(getState(), id)) return;
    event.preventDefault?.();
    dispatch({ type: target.getAttribute("data-wm-dblclick"), id });
  };

  // ------------------------------------------------------------ keyboard moving (opt-in)

  const keymap = keyboard === true ? DEFAULT_MOVE_KEYS : keyboard && typeof keyboard === "object" ? keyboard : null;

  // ------------------------------------------------------------ focus trap (modal dialogs)

  /** Elements a "Tab" stop could land on; fake/real DOM alike. */
  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex], [contenteditable]';
  const isFocusable = (el) =>
    el.getAttribute("tabindex") !== "-1" &&
    !el.hasAttribute("disabled") &&
    !el.hasAttribute("inert") &&
    !el.closest?.("[inert]");

  /**
   * Tab wraps within the focused window's element when that window is modal
   * (a11y: focus never leaks to whatever lies behind a modal dialog). Returns
   * true when it handled the key.
   */
  const trapModalTab = (event) => {
    if (event.key !== "Tab" || event.type === "keyup") return false;
    const state = getState();
    const id = state.focus.window;
    const win = id && state.windows[id];
    if (!win?.modal) return false;
    const container = viewElementFor(id);
    if (!container) return false;
    const focusables = [...container.querySelectorAll(FOCUSABLE)].filter(isFocusable);
    if (!focusables.length) {
      event.preventDefault?.();
      if (!container.hasAttribute("tabindex")) container.setAttribute("tabindex", "-1");
      container.focus?.({ preventScroll: true });
      return true;
    }
    const active = doc?.activeElement;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!container.contains?.(active) || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
      event.preventDefault?.();
      (event.shiftKey ? last : first).focus?.({ preventScroll: true });
      return true;
    }
    return false;
  };

  /**
   * WAI-ARIA tabs, manual activation: Arrow keys and Home/End move focus
   * between the tabs of a strip (roving tabindex), Enter or Space activates
   * the focused one (`window/focus`, which also moves focus into its panel).
   */
  const onTabKeyDown = (tabEl, event) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault?.();
      dispatch({ type: "window/focus", id: tabEl.getAttribute("data-wm-tab") });
      return true;
    }
    const tabs = [...(tabEl.parentNode?.querySelectorAll?.("[data-wm-tab]") ?? [])];
    const at = tabs.indexOf(tabEl);
    if (at < 0) return false;
    // WAI-ARIA: in a right-to-left tab list the left arrow moves to the next tab (it is on the left).
    const forward = isRtlNow() ? "ArrowLeft" : "ArrowRight";
    const backward = isRtlNow() ? "ArrowRight" : "ArrowLeft";
    const next =
      event.key === forward || event.key === "ArrowDown"
        ? tabs[(at + 1) % tabs.length]
        : event.key === backward || event.key === "ArrowUp"
          ? tabs[(at - 1 + tabs.length) % tabs.length]
          : event.key === "Home"
            ? tabs[0]
            : event.key === "End"
              ? tabs[tabs.length - 1]
              : null;
    if (!next) return false;
    event.preventDefault?.();
    for (const tab of tabs) tab.setAttribute("tabindex", tab === next ? "0" : "-1");
    next.focus?.({ preventScroll: true });
    return true;
  };

  const FLOAT_ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  /** A floating window's rect in `root` coordinates, for a placement that is not a plain number (`"center"`). */
  const measuredRect = (id) => {
    const element = viewElementFor(id);
    if (!element) return null;
    const r = element.getBoundingClientRect();
    const o = root.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, width: r.width, height: r.height };
  };

  /**
   * Keyboard move and resize for the focused floating (non-tiled) window (opt-in with
   * `keyboard`, which is what makes it reachable without a pointer):
   * Alt+Shift+Arrow moves it by `floatStep` px, Ctrl+Alt+Shift+Arrow resizes
   * it (right/down grow). Tiled windows keep their reorder keys.
   */
  const onFloatingKey = (event) => {
    const dir = FLOAT_ARROWS[event.key];
    if (!dir || !event.altKey || !event.shiftKey || event.metaKey || event.type === "keyup") return false;
    const state = getState();
    const id = state.focus.window;
    const win = id && state.windows[id];
    // "Floating" here means positioned by its placement: not part of the tiled base (floating mode, a floating-layout workspace, a dialog, ...).
    if (!win || win.status !== "normal" || inTiledBase(state, win) || !isVisible(state, id) || isBlocked(state, id)) return false;
    const rect = mirrorRect(measuredRect(id)); // measured rects are physical; x is inline-start-based
    const num = (value, measured) => (Number.isFinite(value) ? value : measured ?? 0);
    const { placement } = win;
    event.preventDefault?.();
    // Arrow keys mean screen directions, so in RTL a physical "right" is the window's x getting smaller, and its
    // width (which grows toward the left, away from the fixed inline-start edge) getting smaller too.
    const dx = dir[0] * flow();
    if (event.ctrlKey) {
      send({
        type: "window/resize",
        id,
        width: Math.max(0, num(placement.width, rect?.width) + dx * floatStep),
        height: Math.max(0, num(placement.height, rect?.height) + dir[1] * floatStep),
      });
    } else {
      send({ type: "window/move", id, x: num(placement.x, rect?.x) + dx * floatStep, y: num(placement.y, rect?.y) + dir[1] * floatStep });
    }
    return true;
  };

  const onRootKeyDown = (event) => {
    const tabEl = !drag && !gesture && !splitter ? event.target?.closest?.("[data-wm-tab]") : null;
    if (tabEl && onTabKeyDown(tabEl, event)) return;
    if (keyboard && !drag && !gesture && !splitter && onFloatingKey(event)) return;
    const splitterEl = !drag && !gesture && !splitter ? event.target?.closest?.("[data-wm-splitter]") : null;
    if (splitterEl && onSplitterKeyDown(splitterEl, event)) return;
    if (!drag && trapModalTab(event)) return;
    if (keyboard && !drag) {
      const combo = comboOf(event);
      if (combo === "F6" || combo === "Shift+F6") {
        event.preventDefault?.();
        send({ type: combo === "F6" ? "focus/next" : "focus/previous" });
        return;
      }
    }
    if (!keymap || drag) return;
    // The keymap is written for left-to-right; in RTL the left and right arrows swap meaning.
    const combo = comboOf(event);
    const type = keymap[isRtlNow() ? combo.replace(/Arrow(Left|Right)$/, (_, side) => `Arrow${side === "Left" ? "Right" : "Left"}`) : combo];
    const id = getState().focus.window;
    if (!type || !id) return;
    event.preventDefault?.();
    send({ type, id });
  };

  // ------------------------------------------------------------ focus sync

  // Keyboard focus entering a window (Tab, a script calling .focus()) focuses it
  // in the WM too, so it is raised like a click would raise it.
  const onFocusIn = (event) => {
    const viewElement = viewOf(event.target);
    if (!viewElement) return;
    const id = viewElement.getAttribute("data-view");
    if (event.target !== viewElement) lastFocused.set(id, event.target);
    const state = getState();
    if (state.windows[id] && state.focus.window !== id && !isBlocked(state, id)) dispatch({ type: "window/focus", id });
  };

  /** Only move DOM focus when it is not somewhere the user is typing outside the WM. */
  const mayTakeFocus = () => {
    const active = doc?.activeElement;
    if (!active || active === doc.body || root.contains?.(active)) return true;
    const tag = active.localName;
    const type = (active.getAttribute?.("type") ?? "text").toLowerCase();
    const textEntry =
      tag === "textarea" ||
      tag === "select" ||
      active.isContentEditable === true ||
      (tag === "input" && !["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"].includes(type));
    return !textEntry;
  };

  const moveFocusInto = (id) => {
    const viewElement = viewElementFor(id);
    if (!viewElement || viewElement.contains?.(doc?.activeElement) || !mayTakeFocus()) return;
    const remembered = lastFocused.get(id);
    if (remembered?.isConnected && viewElement.contains?.(remembered) && !remembered.closest?.("[inert]")) {
      remembered.focus?.({ preventScroll: true });
      if (doc.activeElement === remembered) return;
    }
    if (!viewElement.hasAttribute("tabindex")) viewElement.setAttribute("tabindex", "-1");
    viewElement.focus?.({ preventScroll: true });
  };

  const schedule = afterRender ?? ((task) => (view?.requestAnimationFrame ?? setTimeout)(task));
  const unsubscribe = subscribe?.((state, events = []) => {
    const focused = events.findLast?.((event) => event.type === "window/focused");
    if (focused?.id) schedule(() => getState().focus.window === focused.id && moveFocusInto(focused.id));
    if (announce) announceEvents(events);
  });

  // ------------------------------------------------------------ touch and pen (opt-in)

  const touchOpts = touchOptions(touch);
  /** A floating window's rect in root coordinates when it may be pinched (the same windows the keyboard can move), else null. */
  const pinchRect = (id) => {
    const state = getState();
    const win = state.windows[id];
    if (!win || win.status !== "normal" || inTiledBase(state, win) || !isVisible(state, id) || isBlocked(state, id) || win.draggable === false) return null;
    const measured = mirrorRect(measuredRect(id));
    const num = (value, fallback) => (Number.isFinite(value) ? value : fallback ?? 0);
    const { placement } = win;
    return { x: num(placement.x, measured?.x), y: num(placement.y, measured?.y), width: num(placement.width, measured?.width), height: num(placement.height, measured?.height) };
  };
  const touchGestures = touchOpts
    ? createTouchGestures({
        options: touchOpts,
        root,
        getState,
        dispatch,
        send,
        local: localPoint,
        viewOf,
        floatRect: pinchRect,
        mirror: mirrorRect,
        rootWorkspace,
        stackOrder: (state) => {
          const workspace = rootWorkspace(state);
          const type = state.workspaces[workspace]?.layout?.type;
          return type === "monocle" || type === "tabs" ? tiledOrder(state, workspace) : null;
        },
        direction: () => (getState().config?.direction === "rtl" ? -1 : 1),
        busy: () => Boolean(drag || splitter || gesture?.moved || (pending && pending.kind !== "denied")),
        cancelOthers: () => {
          if (drag) endDrag(false);
          if (gesture) endGesture(false);
          if (splitter) endSplitter(false);
          clearPending();
        },
        timers,
        token: gestureToken,
      })
    : null;
  if (touchOpts) root.setAttribute("data-wm-touch", touchTokens(touchOpts));

  const listeners = {
    pointerdown: onPointerDown,
    pointermove: onPointerMove,
    pointerup: onPointerUp,
    pointercancel: onPointerCancel,
    click: onClick,
    dblclick: onDblClick,
    focusin: onFocusIn,
    contextmenu: onContextMenu,
    keydown: onRootKeyDown,
  };
  for (const [type, fn] of Object.entries(listeners)) root.addEventListener(type, fn);
  return () => {
    if (drag) endDrag(false);
    if (gesture) endGesture(false);
    if (splitter) endSplitter(false);
    clearPending();
    for (const [type, fn] of Object.entries(listeners)) root.removeEventListener(type, fn);
    if (ownRegion) region.remove();
    touchGestures?.detach();
    if (touchOpts) root.removeAttribute("data-wm-touch");
    unsubscribe?.();
  };
};
