/**
 * Pure read-only queries over state.
 */
import { LAYERS } from "./create.mjs";

export const getWindow = (state, id) => state.windows[id];

export const activeWorkspace = (state) => state.workspaces[state.activeWorkspace];

export const focusedWindow = (state) => (state.focus.window ? state.windows[state.focus.window] : undefined);

/** Windows of a workspace in workspace order. */
export const windowsIn = (state, workspaceId = state.activeWorkspace) =>
  (state.workspaces[workspaceId]?.windows ?? []).map((id) => state.windows[id]).filter(Boolean);

export const isVisible = (state, id) => {
  const win = state.windows[id];
  if (!win || win.status === "minimized") return false;
  if (win.workspace !== state.activeWorkspace) return false;
  return win.parent ? isVisible(state, win.parent) : true;
};

export const visibleWindows = (state) => windowsIn(state).filter((win) => isVisible(state, win.id));

/** Direct children of a window (dialogs, popovers, ...). */
export const childrenOf = (state, id) => Object.values(state.windows).filter((win) => win.parent === id);

/** The deepest open modal descendant of a window, following the modal graph. */
export const modalTarget = (state, id) => {
  const modal = childrenOf(state, id).find((child) => child.modal && child.status !== "minimized");
  return modal ? modalTarget(state, modal.id) : id;
};

/** A window is blocked from input when a modal descendant is open. */
export const isBlocked = (state, id) => modalTarget(state, id) !== id;

export const blockedWindows = (state) => Object.keys(state.windows).filter((id) => isBlocked(state, id));

/** Every window id, bottom to top, across all layers. */
export const stackingOrder = (state) => LAYERS.flatMap((layer) => state.stack[layer] ?? []);

/** Windows that may receive focus in the active workspace, in workspace order. */
export const focusable = (state) =>
  visibleWindows(state)
    .map((win) => win.id)
    .filter((id) => !isBlocked(state, id));

/** Descendants (children, grandchildren, ...) of a window. */
export const descendantsOf = (state, id) =>
  childrenOf(state, id).flatMap((child) => [child.id, ...descendantsOf(state, child.id)]);
