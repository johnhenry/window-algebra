/**
 * Pure read-only queries over state.
 */
import { LAYERS } from "./create.mjs";
export { matchRules, validRules, MATCH_FIELDS, SET_FIELDS } from "./rules.mjs";

export const getWindow = (state, id) => state.windows[id];

export const activeWorkspace = (state) => state.workspaces[state.activeWorkspace];

export const focusedWindow = (state) => (state.focus.window ? state.windows[state.focus.window] : undefined);

/** Windows of a workspace in workspace order. */
export const windowsIn = (state, workspaceId = state.activeWorkspace) =>
  (state.workspaces[workspaceId]?.windows ?? []).map((id) => state.windows[id]).filter(Boolean);

export const isVisible = (state, id) => {
  const win = state.windows[id];
  if (!win || win.status === "minimized") return false;
  // A scratchpad window not currently shown belongs to no workspace.
  if (win.workspace === null) return false;
  // Sticky windows skip the active-workspace check: they are visible everywhere.
  if (win.workspace !== state.activeWorkspace && !win.sticky) return false;
  return win.parent ? isVisible(state, win.parent) : true;
};

/**
 * Visible windows of the active workspace: its own windows, plus any sticky
 * window that lives on another workspace (visible everywhere).
 */
export const visibleWindows = (state) => {
  const local = windowsIn(state).filter((win) => isVisible(state, win.id));
  const stickyElsewhere = Object.values(state.windows).filter(
    (win) => win.sticky && win.workspace !== state.activeWorkspace && isVisible(state, win.id),
  );
  return [...local, ...stickyElsewhere];
};

/** Windows currently hidden in the scratchpad (sent there, not shown). */
export const scratchpadWindows = (state) => Object.values(state.windows).filter((win) => win.scratchpad);

/** Is this window a scratchpad window that is currently hidden (not on any workspace)? */
export const isScratchpadHidden = (state, id) => state.windows[id]?.scratchpad === true && state.windows[id]?.workspace === null;

/** Windows marked sticky (visible on every workspace). */
export const stickyWindows = (state) => Object.values(state.windows).filter((win) => win.sticky);

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

/** Ids currently marked urgent (EWMH/X11-style hint), oldest first. */
export const urgentWindows = (state) => state.urgent.filter((id) => state.windows[id]);

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

/**
 * Is a window part of its workspace's tiled base? Tiled windows are laid out
 * by the layout and painted beneath every non-tiled window except the
 * background layer, whatever their position in `state.stack`.
 */
export const inTiledBase = (state, win) =>
  Boolean(win) &&
  // Sticky windows are always presented as floating overlays, regardless of
  // mode: the tiled base is inherently workspace-local, sticky is not.
  !win.sticky &&
  state.workspaces[win.workspace]?.layout?.type !== "floating" &&
  win.role === "window" &&
  win.mode === "tiled" &&
  win.status !== "maximized";

/**
 * Visible windows of the active workspace in the order they are painted,
 * bottom to top — what `derive` produces, as opposed to `stackingOrder`, the
 * logical stack across all workspaces:
 *   background-layer windows → the tiled base → every other layer by stack.
 * A fullscreen window is painted alone.
 */
export const paintOrder = (state) => {
  const visible = visibleWindows(state);
  const fullscreen = visible.find((win) => win.status === "fullscreen");
  if (fullscreen) return [fullscreen.id];
  const rank = new Map(stackingOrder(state).map((id, i) => [id, i]));
  const tiled = visible.filter((win) => inTiledBase(state, win)).map((win) => win.id);
  const upper = visible
    .filter((win) => !inTiledBase(state, win))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [
    ...upper.filter((win) => win.layer === "background").map((win) => win.id),
    ...tiled,
    ...upper.filter((win) => win.layer !== "background").map((win) => win.id),
  ];
};
