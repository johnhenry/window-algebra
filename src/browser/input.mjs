/**
 * Browser input adapter: pointer events in, commands out. The geometry math
 * lives in the pure interaction primitives; this only wires events.
 *
 * Markup contract (inside a surface):
 *   data-wm-handle="move"                 drag to move a floating window, or to
 *                                         drag a tiled window to a new slot
 *   data-wm-handle="resize-se" (n/s/e/w/ne/nw/se/sw)  drag to resize
 *   data-wm-command="window/close"        click to dispatch { type, id }
 * Tab buttons rendered by the compiler carry data-wm-tab="<id>".
 *
 * While a tiled window is dragged, an overlay inside `root`
 * ([data-wm-drag-overlay]) shields iframes from the pointer and holds the
 * preview: the hypothetical next state rendered through the same
 * derive → compile pipeline into ghost outlines ([data-wm-ghost]), plus the
 * highlighted drop zone ([data-wm-drop-zone]).
 */
import { createDrag, updateDrag, createResize, updateResize } from "../interaction/drag.mjs";
import { dropTargetAt, previewDrop, zoneRect } from "../interaction/drop.mjs";
import { isBlocked } from "../state/queries.mjs";
import { dragMode, isDroppable, tiledOrder } from "../state/drops.mjs";
import { derive, presentationContext } from "../state/derive.mjs";
import { compile } from "../css/compile.mjs";
import { createDomRenderer } from "./dom.mjs";

/** Elements that handle their own pointer input, even inside a drag handle. */
const INTERACTIVE = "[data-wm-command], button, a, input, select, textarea, label, [contenteditable]";

let gestureSeq = 0;
const gestureToken = () => `g${Date.now().toString(36)}.${++gestureSeq}`;

const GHOST_STYLE = {
  background: "var(--wm-ghost-fill, rgb(59 130 246 / 0.10))",
  outline: "2px dashed var(--wm-ghost-line, rgb(59 130 246 / 0.75))",
  "outline-offset": "-2px",
  "border-radius": "var(--wm-ghost-radius, 6px)",
  "box-shadow": "none",
  border: "0",
  position: "relative",
};
const GHOST_DRAGGED_STYLE = {
  ...GHOST_STYLE,
  background: "var(--wm-ghost-fill-strong, rgb(59 130 246 / 0.24))",
  outline: "2px solid var(--wm-ghost-line, rgb(59 130 246 / 0.9))",
};
const GHOST_TOO_SMALL_STYLE = { outline: "2px solid var(--wm-ghost-bad, rgb(220 38 38 / 0.9))" };

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
 * Turn a compiled render tree into ghost outlines: tiled-base views become
 * translucent boxes (the dragged one emphasised), everything else is hidden.
 */
const ghostify = (node, { base, dragged, titles }) => {
  if (node.view !== undefined) {
    const inBase = node.primary && base.has(node.view);
    const attrs = { "data-view": node.view };
    if (inBase) {
      attrs["data-wm-ghost"] = node.view === dragged ? "dragged" : "";
      attrs["data-wm-ghost-label"] = titles[node.view] || node.view;
    }
    const style = inBase ? { ...node.style, ...(node.view === dragged ? GHOST_DRAGGED_STYLE : GHOST_STYLE) } : { ...node.style, display: "none" };
    return { ...node, attrs, style, primary: false };
  }
  const style = node.tag === "wm-tabs" ? { ...node.style, visibility: "hidden" } : node.style;
  const attrs = { ...node.attrs };
  delete attrs.inert;
  return { ...node, attrs, style, children: node.children.map((child) => ghostify(child, { base, dragged, titles })) };
};

/**
 * @param {object} options
 * @param {Element} options.root
 * @param {() => object} options.getState
 * @param {(command: object) => unknown} options.dispatch
 * @param {number} [options.snap] snap floating moves to a grid
 * @param {(listener: (state: object, events: object[]) => void) => () => void} [options.subscribe]
 *   the manager's `subscribe`. When given, keyboard focus follows WM focus: after
 *   a window is focused by command (shortcut, taskbar, API), DOM focus moves into
 *   it, back to the element last focused there, else the view itself. Focus is
 *   never taken from a text field outside `root`.
 * @param {(task: () => void) => void} [options.afterRender] when to move DOM focus
 *   after a focus change (default: next animation frame, i.e. after the commit)
 * @param {number} [options.threshold] pointer travel (px) before a press on a
 *   tiled window's move handle becomes a drag (default 5), so clicks stay clicks
 * @param {(state: object) => { render: object }} [options.present] derive + compile
 *   for the drag preview; pass the manager's `wm.present` so custom layouts work
 * @param {(command: object, state: object) => { state, events }} [options.simulate]
 *   pure dry run of a command; pass `wm.simulate` so custom drop interpreters and
 *   extensions apply (default: the built-in `update`)
 * @param {(ctx: object) => void} [options.dragPreview] custom preview renderer, called
 *   whenever the drop under the pointer changes and once with `phase: "end"`:
 *   `{ phase, overlay, state, drop, preview, geometry, point }`. It replaces the
 *   built-in ghost (the zone highlight stays).
 * @returns {() => void} detach
 */
export const attachInput = ({
  root,
  getState,
  dispatch,
  snap,
  subscribe,
  afterRender,
  threshold = 5,
  present,
  simulate,
  dragPreview,
}) => {
  let gesture = null; // floating move/resize in progress
  let pending = null; // press on a tiled window's handle, not yet a drag
  let drag = null; // tiled drag in progress
  const doc = root.ownerDocument;
  const lastFocused = new Map(); // view id → element last focused inside it

  const viewOf = (target) => target.closest?.("wm-view[data-view]");

  const presentState =
    present ?? ((state) => ({ render: compile(derive(state), presentationContext(state)) }));
  const preview = (state, drop) =>
    simulate
      ? (() => {
          const out = simulate({ type: "window/drop", id: drop.id, target: drop.target, zone: drop.zone }, state);
          return out.events.some((event) => event.type === "command/rejected") ? null : out.state;
        })()
      : previewDrop(state, drop);

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

  const onPointerDown = (event) => {
    // A second pointer (or a lost pointerup) never stacks gestures.
    if (drag) endDrag(false);
    pending = null;
    const tab = event.target.closest?.("[data-wm-tab]");
    if (tab) {
      dispatch({ type: "window/focus", id: tab.getAttribute("data-wm-tab") });
      return;
    }
    const viewElement = viewOf(event.target);
    if (!viewElement || viewElement.closest?.("[data-wm-drag-overlay]")) return;
    const id = viewElement.getAttribute("data-view");
    const state = getState();
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

    if (win.mode === "floating" && win.status === "normal") {
      if (kind === "move") {
        gesture = { id, token: gestureToken(), op: createDrag({ origin, bounds: win.placement }) };
      } else if (kind.startsWith("resize-")) {
        gesture = {
          id,
          token: gestureToken(),
          op: createResize({ origin, bounds: win.placement, edge: kind.slice(7), constraints: win.constraints }),
        };
      } else {
        return;
      }
      handle.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }

    // A tiled window's title bar: a potential drag, decided by the threshold.
    if (kind === "move" && isDroppable(state, win) && win.draggable !== false && dragMode(state, win.workspace) !== "off") {
      pending = { id, origin, pointerId: event.pointerId };
      event.preventDefault();
    }
  };

  // ------------------------------------------------------------ tiled drag

  const startDrag = (event) => {
    const { id, pointerId } = pending;
    pending = null;
    const state = getState();
    const geometry = measureViews();
    const overlay = doc.createElement("div");
    overlay.setAttribute("data-wm-drag-overlay", "");
    overlay.setAttribute("aria-hidden", "true");
    // The overlay is also the iframe shield: it covers every surface in root,
    // so pointer events keep coming to this document during the drag.
    for (const [prop, value] of Object.entries({
      position: "absolute",
      inset: "0",
      "z-index": "2147483000",
      background: "transparent",
      "pointer-events": "auto",
      "touch-action": "none",
    })) overlay.style.setProperty(prop, value);
    const ghostHost = doc.createElement("div");
    ghostHost.setAttribute("data-wm-drag-ghost", "");
    for (const [prop, value] of Object.entries({ position: "absolute", inset: "0", "pointer-events": "none" })) {
      ghostHost.style.setProperty(prop, value);
    }
    const zoneEl = doc.createElement("div");
    zoneEl.setAttribute("data-wm-drop-zone", "");
    for (const [prop, value] of Object.entries({
      position: "absolute",
      display: "none",
      "pointer-events": "none",
      background: "var(--wm-zone-fill, rgb(59 130 246 / 0.18))",
      outline: "2px solid var(--wm-zone-line, rgb(59 130 246 / 0.9))",
      "outline-offset": "-2px",
      "border-radius": "var(--wm-ghost-radius, 6px)",
    })) zoneEl.style.setProperty(prop, value);
    overlay.append(ghostHost, zoneEl);
    const view = doc.defaultView;
    if (view?.getComputedStyle && view.getComputedStyle(root).position === "static") root.style.setProperty("position", "relative");
    root.appendChild(overlay);
    root.setAttribute("data-wm-dragging", "");
    const source = root.querySelector?.(`wm-view[data-view="${id.replace(/["\\]/g, "\\$&")}"]`);
    source?.setAttribute("data-wm-drag-source", "");
    try {
      root.setPointerCapture?.(pointerId);
    } catch {
      // A synthetic or already-released pointer: the overlay still shields.
    }
    doc.addEventListener?.("keydown", onKeyDown, true);
    drag = { id, pointerId, geometry, overlay, ghostHost, zoneEl, ghost: null, source, drop: null, next: null, ghostGeometry: null };
    moveDrag(event, state);
  };

  const renderZone = (drop) => {
    const { zoneEl, geometry } = drag;
    if (!drop) {
      zoneEl.style.setProperty("display", "none");
      zoneEl.removeAttribute("data-zone");
      return;
    }
    // A swap takes the whole target; an insert or split, the edge half it lands in.
    const r = drop.op === "swap" ? { ...geometry[drop.target] } : zoneRect(geometry[drop.target], drop.zone);
    zoneEl.setAttribute("data-zone", drop.zone);
    zoneEl.setAttribute("data-op", drop.op);
    zoneEl.setAttribute("data-target", drop.target);
    zoneEl.style.setProperty("display", "block");
    zoneEl.style.setProperty("left", `${r.x}px`);
    zoneEl.style.setProperty("top", `${r.y}px`);
    zoneEl.style.setProperty("width", `${r.width}px`);
    zoneEl.style.setProperty("height", `${r.height}px`);
  };

  const renderGhost = (state, next) => {
    drag.ghostGeometry = null;
    if (!next || state.config.drag?.preview === false) {
      drag.ghost?.destroy();
      drag.ghost = null;
      return;
    }
    let render;
    try {
      render = presentState(unconstrained(next)).render;
    } catch {
      return; // e.g. a custom layout the default `present` cannot derive
    }
    const base = new Set(tiledOrder(next, next.activeWorkspace));
    const titles = Object.fromEntries(Object.values(next.windows).map((win) => [win.id, win.title]));
    drag.ghost ??= createDomRenderer({ root: drag.ghostHost, document: doc, anchorFallback: false });
    drag.ghost.commit(ghostify(render, { base, dragged: drag.id, titles }));
    drag.ghostGeometry = drag.ghost.measure();
    // Flag slots that would violate a window's min/max constraints.
    for (const id of base) {
      const r = drag.ghostGeometry[id];
      const el = drag.ghost.elementFor(id);
      if (!r || !el) continue;
      if (violates(next.windows[id].constraints, r)) {
        el.setAttribute("data-wm-too-small", "");
        for (const [prop, value] of Object.entries(GHOST_TOO_SMALL_STYLE)) el.style.setProperty(prop, value);
      }
    }
  };

  const moveDrag = (event, state = getState()) => {
    const point = localPoint(event);
    const found = dropTargetAt(state, drag.geometry, point, drag.id);
    const drop = found ? { id: drag.id, ...found } : null;
    const same = drop?.target === drag.drop?.target && drop?.zone === drag.drop?.zone;
    if (same) return;
    const next = drop ? preview(state, drop) : null;
    drag.drop = next ? drop : null;
    drag.next = next;
    renderZone(drag.drop);
    if (dragPreview) dragPreview({ phase: "update", overlay: drag.overlay, state, drop: drag.drop, preview: next, geometry: drag.geometry, point });
    else renderGhost(state, next);
  };

  const endDrag = (commit) => {
    const current = drag;
    drag = null;
    doc.removeEventListener?.("keydown", onKeyDown, true);
    try {
      root.releasePointerCapture?.(current.pointerId);
    } catch {
      // Already released.
    }
    if (dragPreview) dragPreview({ phase: "end", overlay: current.overlay, state: getState(), drop: commit ? current.drop : null, preview: null, geometry: current.geometry, point: null });
    current.ghost?.destroy();
    current.overlay.remove();
    root.removeAttribute("data-wm-dragging");
    current.source?.removeAttribute("data-wm-drag-source");
    if (!commit || !current.drop) return;
    const { id, target, zone } = current.drop;
    const command = { type: "window/drop", id, target, zone };
    const state = getState();
    if (state.config.drag?.tooSmall === "reject" && current.ghostGeometry) {
      command.geometry = Object.fromEntries(
        [id, target].filter((wid) => current.ghostGeometry[wid]).map((wid) => [wid, { width: current.ghostGeometry[wid].width, height: current.ghostGeometry[wid].height }]),
      );
    }
    dispatch(command);
  };

  const onKeyDown = (event) => {
    if (event.key !== "Escape" || !drag) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    endDrag(false);
  };

  // ------------------------------------------------------------ pointer stream

  const onPointerMove = (event) => {
    if (gesture) {
      const pointer = { x: event.clientX, y: event.clientY };
      if (gesture.op.kind === "move") {
        dispatch({ type: "window/move", id: gesture.id, ...updateDrag(gesture.op, pointer, { snap }), gesture: gesture.token });
      } else {
        dispatch({ type: "window/resize", id: gesture.id, ...updateResize(gesture.op, pointer), gesture: gesture.token });
      }
      return;
    }
    if (pending) {
      if (event.pointerId !== pending.pointerId) return;
      const dx = event.clientX - pending.origin.x;
      const dy = event.clientY - pending.origin.y;
      if (Math.hypot(dx, dy) < threshold) return;
      startDrag(event);
      return;
    }
    if (drag && event.pointerId === drag.pointerId) moveDrag(event);
  };

  const onPointerUp = (event) => {
    gesture = null;
    pending = null;
    if (drag && (event?.pointerId === undefined || event.pointerId === drag.pointerId)) endDrag(true);
  };

  const onPointerCancel = () => {
    gesture = null;
    pending = null;
    if (drag) endDrag(false);
  };

  const onClick = (event) => {
    const button = event.target.closest?.("[data-wm-command]");
    if (!button) return;
    const viewElement = viewOf(button);
    const id = button.getAttribute("data-wm-target") ?? viewElement?.getAttribute("data-view");
    dispatch({ type: button.getAttribute("data-wm-command"), id });
  };

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
    const viewElement = root.querySelector?.(`wm-view[data-view="${id.replace(/["\\]/g, "\\$&")}"]`);
    if (!viewElement || viewElement.contains?.(doc?.activeElement) || !mayTakeFocus()) return;
    const remembered = lastFocused.get(id);
    if (remembered?.isConnected && viewElement.contains?.(remembered) && !remembered.closest?.("[inert]")) {
      remembered.focus?.({ preventScroll: true });
      if (doc.activeElement === remembered) return;
    }
    if (!viewElement.hasAttribute("tabindex")) viewElement.setAttribute("tabindex", "-1");
    viewElement.focus?.({ preventScroll: true });
  };

  const schedule = afterRender ?? ((task) => (doc?.defaultView?.requestAnimationFrame ?? setTimeout)(task));
  const unsubscribe = subscribe?.((state, events = []) => {
    const focused = events.findLast?.((event) => event.type === "window/focused");
    if (focused?.id) schedule(() => getState().focus.window === focused.id && moveFocusInto(focused.id));
  });

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerCancel);
  root.addEventListener("click", onClick);
  root.addEventListener("focusin", onFocusIn);
  return () => {
    if (drag) endDrag(false);
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerup", onPointerUp);
    root.removeEventListener("pointercancel", onPointerCancel);
    root.removeEventListener("click", onClick);
    root.removeEventListener("focusin", onFocusIn);
    unsubscribe?.();
  };
};
