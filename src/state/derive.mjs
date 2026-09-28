/**
 * `derive(state) → presentation tree`: pure policy that turns logical state
 * into a layout-algebra tree for the active workspace. No pixels are computed
 * for tiled windows; the renderer hands the tree to CSS.
 */
import { view, overlay, place, size, gap, inset, anchor, row, isNode, isContainer } from "../algebra/nodes.mjs";
import { transform, mapViews } from "../algebra/transforms.mjs";
import {
  masterStack,
  columns,
  rows,
  monocle,
  tabs,
  autoGrid,
  fixedGrid,
  spiral,
  floating,
  bspToLayout,
  bspReconcile,
} from "../layouts/index.mjs";
import { LAYERS } from "./create.mjs";
import { isVisible, isBlocked, inTiledBase, visibleWindows, urgentWindows } from "./queries.mjs";

const activeOf = (ids, focused, spec) => (ids.includes(spec.active) ? spec.active : ids.includes(focused) ? focused : ids[0]);

/**
 * Built-in layout interpreters: `(spec, ids, context) → tree`.
 * `context` is { state, workspace, focused }.
 */
export const LAYOUTS = Object.freeze({
  "master-stack": (spec, ids) => masterStack(spec, ids),
  columns: (spec, ids) => columns({}, ids),
  rows: (spec, ids) => rows({}, ids),
  monocle: (spec, ids, { focused }) => monocle({ active: activeOf(ids, focused, spec) }, ids),
  tabs: (spec, ids, { focused }) => tabs({ active: activeOf(ids, focused, spec) }, ids),
  grid: (spec, ids) => (spec.columns ? fixedGrid(spec, ids) : autoGrid(spec, ids)),
  spiral: (spec, ids) => spiral(spec, ids),
  // Reconcile the stored tree with the windows actually present.
  bsp: (spec, ids) => bspToLayout(bspReconcile(spec.tree, ids)),
  // Everything floats; the tiled base is empty.
  floating: () => row({}),
});

const placementOf = (win) => win.placement;

/** How a non-tiled window is presented, by role. Returns a node. */
const presentFloating = (win, state, index) => {
  const { x, y, width, height } = placementOf(win);
  const parentVisible = win.parent && isVisible(state, win.parent);
  const anchorTo = win.anchor?.to ?? (parentVisible ? win.parent : null);

  if (win.status === "maximized") return place({ top: 0, right: 0, bottom: 0, left: 0 }, view(win.id));

  switch (win.role) {
    case "dialog":
    case "sheet": {
      const sized = size({ width, height: win.role === "sheet" ? "content" : height }, view(win.id));
      if (anchorTo) {
        return anchor(
          win.role === "sheet" ? { to: anchorTo, side: "top", align: "center", inside: true } : { to: anchorTo, x: "center", y: "center" },
          sized,
        );
      }
      return place({ x: "center", y: "center" }, sized);
    }
    case "popover":
    case "menu":
    case "tooltip": {
      const sized = size({ width, height: height ?? "content" }, view(win.id));
      if (anchorTo) {
        // Every anchor option (inside, x, y, …) passes through; only `to` is resolved here.
        const { to: _to, side = "bottom", align = "start", offset = 4, ...rest } = win.anchor ?? {};
        return anchor({ ...rest, to: anchorTo, side, align, offset }, sized);
      }
      return floating({ x, y, width, height }, view(win.id));
    }
    case "notification":
      return place({ right: 16, bottom: 16 + index * ((height ?? 80) + 8) }, size({ width, height }, view(win.id)));
    default:
      return floating({ x, y, width, height }, view(win.id));
  }
};

/**
 * Derive the presentation tree for the active workspace.
 *
 * @param {object} state
 * @param {object} [options]
 * @param {object} [options.layouts] extra/override layout interpreters keyed by spec type
 */
export const derive = (state, { layouts = {} } = {}) => {
  const registry = { ...LAYOUTS, ...layouts };
  const ws = state.workspaces[state.activeWorkspace];
  const focused = state.focus.window;
  // The active workspace's own visible windows, plus any sticky window that
  // lives on another workspace (visible everywhere).
  const visible = visibleWindows(state);

  const fullscreen = visible.find((win) => win.status === "fullscreen");
  if (fullscreen) return overlay({}, view(fullscreen.id));

  const tiledIds = visible.filter((win) => inTiledBase(state, win)).map((w) => w.id);

  const interpreter = typeof ws.layout === "function" ? ws.layout : registry[ws.layout?.type];
  if (!interpreter) throw new TypeError(`derive(): no layout interpreter for "${ws.layout?.type}".`);
  let base = interpreter(ws.layout, tiledIds, { state, workspace: ws, focused });
  if (!isNode(base)) throw new TypeError(`derive(): layout "${ws.layout?.type}" did not return a layout node.`);

  // Size constraints are honoured for tiled windows too: CSS min/max sizes on the view.
  const constrained = (id) => {
    const c = state.windows[id]?.constraints ?? {};
    const picked = Object.fromEntries(
      ["minWidth", "minHeight", "maxWidth", "maxHeight"].filter((k) => Number.isFinite(c[k])).map((k) => [k, c[k]]),
    );
    return Object.keys(picked).length ? picked : null;
  };
  if (tiledIds.some(constrained)) {
    base = mapViews(base, (node) => (tiledIds.includes(node.id) && constrained(node.id) ? size(constrained(node.id), node) : node));
  }

  const { gap: gapSize, inset: insetSize } = state.config;
  // CSS gap applies per container, so the configured gap wraps every container in the base.
  if (gapSize) base = transform(base, (node) => (isContainer(node) ? gap({ all: gapSize }, node) : node));
  if (insetSize) base = inset({ all: insetSize }, base);

  // Everything not tiled is layered by the stacking model: the background layer
  // beneath the tiled base, every other layer above it (see `paintOrder`).
  const tiled = new Set(tiledIds);
  const upper = visible.filter((win) => !tiled.has(win.id));
  const rank = new Map(LAYERS.flatMap((layer) => state.stack[layer] ?? []).map((id, i) => [id, i]));
  upper.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  let notificationIndex = 0;
  const present = (win) => presentFloating(win, state, win.role === "notification" ? notificationIndex++ : 0);
  const below = upper.filter((win) => win.layer === "background").map(present);
  const above = upper.filter((win) => win.layer !== "background").map(present);

  return overlay({}, ...below, base, ...above);
};

/** Non-layout facts the renderer needs: focus and input eligibility. */
export const presentationContext = (state) => ({
  focused: state.focus.window,
  blocked: Object.keys(state.windows).filter((id) => isBlocked(state, id)),
  titles: Object.fromEntries(Object.values(state.windows).map((win) => [win.id, win.title])),
  modes: Object.fromEntries(Object.values(state.windows).map((win) => [win.id, win.mode])),
  roles: Object.fromEntries(Object.values(state.windows).map((win) => [win.id, win.role])),
  pinned: Object.values(state.windows).filter((win) => win.draggable === false).map((win) => win.id),
  sticky: Object.values(state.windows).filter((win) => win.sticky).map((win) => win.id),
  scratchpad: Object.values(state.windows).filter((win) => win.scratchpad).map((win) => win.id),
  /** Ids currently marked urgent (window/set-urgent); see focus/urgent. */
  urgent: urgentWindows(state),
});
