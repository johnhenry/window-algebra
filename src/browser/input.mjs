/**
 * Browser input adapter: pointer events in, commands out. The geometry math
 * lives in the pure interaction primitives; this only wires events.
 *
 * Markup contract (inside a surface):
 *   data-wm-handle="move"                 drag to move a floating window
 *   data-wm-handle="resize-se" (n/s/e/w/ne/nw/se/sw)  drag to resize
 *   data-wm-command="window/close"        click to dispatch { type, id }
 * Tab buttons rendered by the compiler carry data-wm-tab="<id>".
 */
import { createDrag, updateDrag, createResize, updateResize } from "../interaction/drag.mjs";
import { isBlocked } from "../state/queries.mjs";

/** Elements that handle their own pointer input, even inside a drag handle. */
const INTERACTIVE = "[data-wm-command], button, a, input, select, textarea, label, [contenteditable]";

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
 * @returns {() => void} detach
 */
export const attachInput = ({ root, getState, dispatch, snap, subscribe, afterRender }) => {
  let gesture = null;
  const doc = root.ownerDocument;
  const lastFocused = new Map(); // view id → element last focused inside it

  const viewOf = (target) => target.closest?.("wm-view[data-view]");

  const onPointerDown = (event) => {
    const tab = event.target.closest?.("[data-wm-tab]");
    if (tab) {
      dispatch({ type: "window/focus", id: tab.getAttribute("data-wm-tab") });
      return;
    }
    const viewElement = viewOf(event.target);
    if (!viewElement) return;
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
    if (!handle || win.mode !== "floating" || win.status !== "normal") return;
    // Controls inside a handle (title-bar buttons, inputs) must keep their own
    // click: starting a gesture would capture the pointer on the handle and
    // retarget pointerup/click away from the control.
    const control = event.target.closest?.(INTERACTIVE);
    if (control && control !== handle && control.closest?.("[data-wm-handle]") === handle) return;
    const kind = handle.getAttribute("data-wm-handle");
    const origin = { x: event.clientX, y: event.clientY };
    if (kind === "move") {
      gesture = { id, op: createDrag({ origin, bounds: win.placement }) };
    } else if (kind.startsWith("resize-")) {
      gesture = {
        id,
        op: createResize({ origin, bounds: win.placement, edge: kind.slice(7), constraints: win.constraints }),
      };
    } else {
      return;
    }
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!gesture) return;
    const pointer = { x: event.clientX, y: event.clientY };
    if (gesture.op.kind === "move") {
      dispatch({ type: "window/move", id: gesture.id, ...updateDrag(gesture.op, pointer, { snap }) });
    } else {
      dispatch({ type: "window/resize", id: gesture.id, ...updateResize(gesture.op, pointer) });
    }
  };

  const onPointerUp = () => {
    gesture = null;
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
  root.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("click", onClick);
  root.addEventListener("focusin", onFocusIn);
  return () => {
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerup", onPointerUp);
    root.removeEventListener("pointercancel", onPointerUp);
    root.removeEventListener("click", onClick);
    root.removeEventListener("focusin", onFocusIn);
    unsubscribe?.();
  };
};
