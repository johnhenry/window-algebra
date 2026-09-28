/**
 * The logical (intent) state of the windowing world. Plain, serializable data.
 */

/** Stacking layers, bottom to top. Ordering within a layer lives in `state.stack`. */
export const LAYERS = Object.freeze(["background", "normal", "top", "modal", "popover", "notification", "system"]);

/** Semantic roles. Policy (derive) decides how each is presented. */
export const ROLES = Object.freeze(["window", "dialog", "sheet", "popover", "menu", "tooltip", "panel", "notification"]);

export const STATUSES = Object.freeze(["normal", "minimized", "maximized", "fullscreen"]);

/**
 * The current state shape's version. Bump this and add a step to `MIGRATIONS`
 * (see `state/migrate.mjs`) whenever a change to the state shape needs one.
 */
export const STATE_VERSION = 1;

export const DEFAULT_CONFIG = Object.freeze({
  /** Focusing a window also raises it within its layer. */
  focusRaises: true,
  /** Gap between tiled siblings (px), 0 for none. */
  gap: 0,
  /** Inset around the tiled area (px), 0 for none. */
  inset: 0,
  /** Default placement for newly created floating windows. */
  defaultPlacement: { x: 40, y: 40, width: 480, height: 320 },
  /**
   * Dragging windows within layouts.
   * - tiled: "swap-or-insert" | "swap" | "insert" | "off" — which drops a tiled
   *   window may make (a layout spec's own `drag` overrides it)
   * - edgeZone: fraction of a target's width/height that counts as an edge
   * - preview: show where every window would land while dragging
   * - tooSmall: "allow" | "reject" — refuse drops whose resulting slot violates
   *   min/max constraints (needs the geometry estimate the adapter supplies)
   * - toFloating: "modifier" | "threshold" | "off" — how a dragged tiled window
   *   detaches as floating (modifier held, or dragged outside the layout)
   * - toTiled: "modifier" | "always" | "off" — when a dragged floating window
   *   may be dropped into the layout
   * - crossWorkspace: dropping on a [data-wm-workspace-target] moves the window there
   * - follow: ...and activates that workspace
   */
  drag: Object.freeze({
    tiled: "swap-or-insert",
    edgeZone: 0.25,
    preview: true,
    tooSmall: "allow",
    toFloating: "modifier",
    toTiled: "modifier",
    crossWorkspace: true,
    follow: false,
  }),
  /**
   * Declarative window rules, applied in order at `window/create`; see
   * `rules.mjs`. Settable wholesale (`rules/set`) or via `config/set`.
   */
  rules: Object.freeze([]),
  /**
   * EWMH/X11-style urgency hints.
   * - clearOnFocus: focusing an urgent window clears its urgency automatically.
   */
  urgency: Object.freeze({
    clearOnFocus: true,
  }),
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
    version: STATE_VERSION,
    config: {
      ...DEFAULT_CONFIG,
      ...config,
      drag: { ...DEFAULT_CONFIG.drag, ...config.drag },
      urgency: { ...DEFAULT_CONFIG.urgency, ...config.urgency },
    },
    windows: {},
    workspaces: Object.fromEntries(list.map((ws) => [ws.id, ws])),
    workspaceOrder: list.map((ws) => ws.id),
    activeWorkspace: list[0].id,
    focus: { window: null, history: [] },
    stack: emptyStack(),
    // The most recently hidden-to or shown-from scratchpad window id, used as
    // the default target of `scratchpad/toggle {}` (no id given).
    lastScratchpad: null,
    /** Ids of windows currently marked urgent, oldest first. */
    urgent: [],
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
    draggable,
    app,
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
  // Only the exception is stored: windows are draggable unless pinned.
  if (draggable === false) record.draggable = false;
  // An app/window-class identifier for rule matching (EWMH WM_CLASS-like); not otherwise used.
  if (app !== undefined) record.app = app;
  return record;
};
