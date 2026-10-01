/**
 * Pure read-only queries over state.
 */
import { LAYERS } from "./create.mjs";
export { matchRules, validRules, MATCH_FIELDS, SET_FIELDS } from "./rules.mjs";

export const getWindow = (state, id) => state.windows[id];

export const activeWorkspace = (state) => state.workspaces[state.activeWorkspace];

/** The output that currently has input focus. */
export const focusedOutput = (state) => state.outputs?.[state.focusedOutput];

/** Every output, in `outputOrder`. */
export const outputsList = (state) => (state.outputOrder ?? []).map((id) => state.outputs[id]).filter(Boolean);

/** The active workspace of a given output (default: the focused one). */
export const outputActiveWorkspace = (state, outputId = state.focusedOutput) => state.outputs?.[outputId]?.activeWorkspace;

/** The output a workspace belongs to. */
export const outputOf = (state, workspaceId) => state.workspaces[workspaceId]?.output;

/** The workspaces belonging to a given output, in workspace order. */
export const workspacesOf = (state, outputId) =>
  (state.outputs?.[outputId]?.workspaces ?? []).map((id) => state.workspaces[id]).filter(Boolean);

export const focusedWindow = (state) => (state.focus.window ? state.windows[state.focus.window] : undefined);

/** Windows of a workspace in workspace order. */
export const windowsIn = (state, workspaceId = state.activeWorkspace) =>
  (state.workspaces[workspaceId]?.windows ?? []).map((id) => state.windows[id]).filter(Boolean);

/**
 * A window is visible when its workspace is the *active workspace of that
 * workspace's own output* — which output currently has focus is irrelevant,
 * since every output renders its own active workspace regardless. Sticky
 * windows skip that check: they are visible on every workspace of their own
 * output.
 */
export const isVisible = (state, id) => {
  const win = state.windows[id];
  // Popped-out windows, like minimized ones, leave the layout — they are
  // "visible elsewhere" (a separate browser window; see `browser/popouts.mjs`).
  if (!win || win.status === "minimized" || win.status === "popped-out") return false;
  // A scratchpad window not currently shown belongs to no workspace.
  if (win.workspace === null) return false;
  const ws = state.workspaces[win.workspace];
  if (!ws) return false;
  const active = state.outputs?.[ws.output]?.activeWorkspace ?? state.activeWorkspace;
  if (win.workspace !== active && !win.sticky) return false;
  return win.parent ? isVisible(state, win.parent) : true;
};

/**
 * Visible windows of an output's active workspace (default: the focused
 * output, so single-output callers see exactly the old behaviour): its own
 * windows, plus any sticky window that lives on another workspace of the
 * *same* output (visible everywhere on that output).
 */
export const visibleWindows = (state, outputId = state.focusedOutput) => {
  const activeWs = state.outputs?.[outputId]?.activeWorkspace ?? state.activeWorkspace;
  const local = windowsIn(state, activeWs).filter((win) => isVisible(state, win.id));
  const stickyElsewhere = Object.values(state.windows).filter(
    (win) =>
      win.sticky &&
      win.workspace !== activeWs &&
      state.workspaces[win.workspace]?.output === outputId &&
      isVisible(state, win.id),
  );
  return [...local, ...stickyElsewhere];
};

/** Is this window currently popped out into a separate browser window? */
export const isPoppedOut = (state, id) => state.windows[id]?.status === "popped-out";

/** Windows currently popped out (see `window/pop-out`, `browser/popouts.mjs`). */
export const poppedOutWindows = (state) => Object.values(state.windows).filter((win) => win.status === "popped-out");

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
  const modal = childrenOf(state, id).find((child) => child.modal && child.status !== "minimized" && child.status !== "popped-out");
  return modal ? modalTarget(state, modal.id) : id;
};

/** A window is blocked from input when a modal descendant is open. */
export const isBlocked = (state, id) => modalTarget(state, id) !== id;

export const blockedWindows = (state) => Object.keys(state.windows).filter((id) => isBlocked(state, id));

/** Ids currently marked urgent (EWMH/X11-style hint), oldest first. */
export const urgentWindows = (state) => state.urgent.filter((id) => state.windows[id]);

/** Every window id, bottom to top, across all layers. */
export const stackingOrder = (state) => LAYERS.flatMap((layer) => state.stack[layer] ?? []);

/** Is `id` a descendant (child, grandchild, ...) of `ancestor`? */
export const isDescendantOf = (state, id, ancestor) => {
  for (let win = state.windows[id]; win?.parent; win = state.windows[win.parent]) {
    if (win.parent === ancestor) return true;
  }
  return false;
};

/**
 * The visible window that is fullscreen on an output, if any. While one is,
 * only it and its descendants are presented (see `presentedWindows`).
 */
export const fullscreenWindow = (state, outputId = state.focusedOutput) =>
  visibleWindows(state, outputId).find((win) => win.status === "fullscreen");

/**
 * The visible windows of an output that are actually presented: all of them,
 * or, while a window is fullscreen, just that window and its descendants (a
 * fullscreen app's own dialogs and popovers still show; nothing else does).
 */
export const presentedWindows = (state, outputId = state.focusedOutput) => {
  const visible = visibleWindows(state, outputId);
  const fullscreen = visible.find((win) => win.status === "fullscreen");
  if (!fullscreen) return visible;
  return visible.filter((win) => win.id === fullscreen.id || isDescendantOf(state, win.id, fullscreen.id));
};

/** Windows that may receive focus on an output's active workspace, in workspace order. */
export const focusable = (state, outputId = state.focusedOutput) =>
  presentedWindows(state, outputId)
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
  // A window hidden in the scratchpad belongs to no workspace, so to no tiled base.
  win.workspace !== null &&
  // Sticky windows are always presented as floating overlays, regardless of
  // mode: the tiled base is inherently workspace-local, sticky is not.
  !win.sticky &&
  state.workspaces[win.workspace]?.layout?.type !== "floating" &&
  win.role === "window" &&
  win.mode === "tiled" &&
  win.status !== "maximized";

/**
 * Visible windows of an output's active workspace in the order they are
 * painted, bottom to top — what `derive` produces, as opposed to
 * `stackingOrder`, the logical stack across all workspaces:
 *   background-layer windows → the tiled base → every other layer by stack.
 * A fullscreen window is painted first, with its descendants (dialogs, popovers) above it, and nothing else.
 */
export const paintOrder = (state, outputId = state.focusedOutput) => {
  const visible = presentedWindows(state, outputId);
  const fullscreen = visible.find((win) => win.status === "fullscreen");
  const rank = new Map(stackingOrder(state).map((id, i) => [id, i]));
  if (fullscreen) {
    const rest = visible.filter((win) => win.id !== fullscreen.id).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
    return [fullscreen.id, ...rest.map((win) => win.id)];
  }
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
