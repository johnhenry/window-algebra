/**
 * The logical (intent) state of the windowing world. Plain, serializable data.
 */

/** Stacking layers, bottom to top. Ordering within a layer lives in `state.stack`. */
export const LAYERS = Object.freeze(["background", "normal", "top", "modal", "popover", "notification", "system"]);

/** Semantic roles. Policy (derive) decides how each is presented. */
export const ROLES = Object.freeze(["window", "dialog", "sheet", "popover", "menu", "tooltip", "panel", "notification"]);

export const STATUSES = Object.freeze(["normal", "minimized", "maximized", "fullscreen"]);

export const DEFAULT_CONFIG = Object.freeze({
  /** Focusing a window also raises it within its layer. */
  focusRaises: true,
  /** Gap between tiled siblings (px), 0 for none. */
  gap: 0,
  /** Inset around the tiled area (px), 0 for none. */
  inset: 0,
  /** Default placement for newly created floating windows. */
  defaultPlacement: { x: 40, y: 40, width: 480, height: 320 },
});

const emptyStack = () => Object.fromEntries(LAYERS.map((layer) => [layer, []]));

export const createWorkspace = ({ id, layout = { type: "master-stack", ratio: 0.5 }, windows = [] }) => ({
  id,
  windows: [...windows],
  layout,
});

/**
 * Create an initial state.
 *
 * @param {object} [options]
 * @param {Array<string|object>} [options.workspaces] workspace ids or `{ id, layout }` objects
 * @param {object} [options.layout] default layout spec for workspaces given by id
 * @param {object} [options.config] overrides for DEFAULT_CONFIG
 */
export const createState = ({ workspaces = ["main"], layout, config = {} } = {}) => {
  const list = workspaces.map((ws) =>
    typeof ws === "string" ? createWorkspace({ id: ws, layout }) : createWorkspace({ layout, ...ws }),
  );
  if (list.length === 0) throw new TypeError("createState(): at least one workspace is required.");
  return {
    version: 1,
    config: { ...DEFAULT_CONFIG, ...config },
    windows: {},
    workspaces: Object.fromEntries(list.map((ws) => [ws.id, ws])),
    workspaceOrder: list.map((ws) => ws.id),
    activeWorkspace: list[0].id,
    focus: { window: null, history: [] },
    stack: emptyStack(),
  };
};

/** Normalise a window description into a full window record. */
export const createWindowRecord = (
  {
    id,
    title = "",
    role = "window",
    parent = null,
    modal = false,
    mode,
    placement,
    constraints = {},
    layer,
    anchor = null,
    workspace,
    data,
  },
  state,
) => {
  const defaultMode = role === "window" ? "tiled" : "floating";
  const defaultLayer =
    role === "notification"
      ? "notification"
      : role === "popover" || role === "menu" || role === "tooltip"
        ? "popover"
        : modal
          ? "modal"
          : role === "panel"
            ? "top"
            : "normal";
  const record = {
    id,
    title,
    role,
    parent,
    modal: Boolean(modal),
    mode: mode ?? defaultMode,
    placement: { ...state.config.defaultPlacement, ...(placement ?? {}) },
    constraints: { ...constraints },
    status: "normal",
    layer: layer ?? defaultLayer,
    anchor,
    workspace: workspace ?? (parent && state.windows[parent]?.workspace) ?? state.activeWorkspace,
  };
  if (data !== undefined) record.data = data;
  return record;
};
