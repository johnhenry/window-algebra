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
 * @returns {() => void} detach
 */
export const attachInput = ({ root, getState, dispatch, snap }) => {
  let gesture = null;

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

  root.addEventListener("pointerdown", onPointerDown);
  root.addEventListener("pointermove", onPointerMove);
  root.addEventListener("pointerup", onPointerUp);
  root.addEventListener("pointercancel", onPointerUp);
  root.addEventListener("click", onClick);
  return () => {
    root.removeEventListener("pointerdown", onPointerDown);
    root.removeEventListener("pointermove", onPointerMove);
    root.removeEventListener("pointerup", onPointerUp);
    root.removeEventListener("pointercancel", onPointerUp);
    root.removeEventListener("click", onClick);
  };
};
