/**
 * Drop interpreters: what dropping one tiled window onto another *means* for
 * each layout type. Tiled windows own no geometry, so a drop never edits
 * pixels; it edits logical structure — the workspace order, or the BSP tree.
 *
 * An interpreter is `{ ops(spec, ids, target) → zoneMap, apply?(spec, ids, drop) → { ids, layout? } }`:
 *   - `ops` maps each zone ("center", "left", "right", "top", "bottom") to an
 *     op: "swap", "before", "after" (order edits) or "split" (BSP), or null
 *     when the zone means nothing for that target.
 *   - `apply` (optional) performs the op and returns the new tiled order and,
 *     for stateful layouts, the new spec. Without it the generic order edit runs.
 * `ids` is the workspace's tiled order (see `tiledOrder`).
 *
 * `DROPS` is keyed by layout type like `LAYOUTS`; custom layout types fall back
 * to `DROPS.default` (reading order). Override or extend it with
 * `createDropHandler({ ...DROPS, mine })` or the manager's `drops` option.
 */
import { bspIds, bspPlace, bspReconcile, bspRemove, bspSwap, bspInsert, bspParentDirection } from "../layouts/bsp.mjs";
import { inTiledBase, isBlocked } from "./queries.mjs";

export const DROP_ZONES = Object.freeze(["center", "left", "right", "top", "bottom"]);
export const DRAG_MODES = Object.freeze(["swap-or-insert", "swap", "insert", "off"]);

const RENDER = Object.freeze({ type: "render" });
const result = (state, events = [], effects = []) => ({ state, events, effects });
const rejected = (state, command, reason) =>
  result(state, [{ type: "command/rejected", command: command.type, id: command.id, reason }]);

const setWorkspace = (state, id, patch) => ({
  ...state,
  workspaces: { ...state.workspaces, [id]: { ...state.workspaces[id], ...patch } },
});

/** Can this window take part in tiled drops (as dragged window or target)? */
export const isDroppable = (state, win) => inTiledBase(state, win) && win.status === "normal";

/** The workspace's tiled windows in order: the ids a layout interpreter receives. */
export const tiledOrder = (state, workspaceId) =>
  (state.workspaces[workspaceId]?.windows ?? []).filter((id) => isDroppable(state, state.windows[id]));

/** The effective tiled-drag mode: a layout spec's `drag` overrides `config.drag.tiled`. */
export const dragMode = (state, workspaceId = state.activeWorkspace) => {
  const spec = state.workspaces[workspaceId]?.layout;
  const own = spec && typeof spec === "object" ? spec.drag : undefined;
  return DRAG_MODES.includes(own) ? own : state.config.drag?.tiled ?? "swap-or-insert";
};

/** Is an op permitted by a drag mode? Swaps need "swap*"; inserts and splits need "*insert". */
export const opAllowed = (mode, op) =>
  Boolean(op) && mode !== "off" && (op === "swap" ? mode !== "insert" : mode !== "swap");

/**
 * Build an order-based interpreter. `axis(spec, ids, target)` names how the
 * target's order neighbours sit around it: "x" (previous on the left, next on
 * the right), "y" (above / below), "-x" / "-y" (mirrored), or "both" (reading
 * order: left and top insert before, right and bottom after). With a single
 * axis, the two cross-axis edges swap, like the center.
 */
export const orderDrops = (axis) => ({
  ops(spec, ids, target) {
    const a = axis(spec, ids, target);
    if (a === "both") return { center: "swap", left: "before", top: "before", right: "after", bottom: "after" };
    const flip = a.startsWith("-");
    const [low, high, crossA, crossB] = a.endsWith("x") ? ["left", "right", "top", "bottom"] : ["top", "bottom", "left", "right"];
    return {
      center: "swap",
      [low]: flip ? "after" : "before",
      [high]: flip ? "before" : "after",
      [crossA]: "swap",
      [crossB]: "swap",
    };
  },
});

/** master-stack: a lone master sits beside the stack (x, mirrored for side "right"); everything else is in a column. */
const masterStackAxis = (spec, ids, target) => {
  const count = spec.masterCount ?? 1;
  const index = ids.indexOf(target);
  if (ids.length <= count || index >= count || count > 1) return "y";
  return spec.side === "right" ? "-x" : "x";
};

/** spiral: window i splits with the rest in a row when i is even, a column when odd; the last shares its predecessor's split. */
const spiralAxis = (spec, ids, target) => {
  const index = ids.indexOf(target);
  const depth = index === ids.length - 1 ? index - 1 : index;
  return depth % 2 === 0 ? "x" : "y";
};

const bspDrops = {
  ops: () => ({ center: "swap", left: "split", right: "split", top: "split", bottom: "split" }),
  apply(spec, ids, { id, target, zone, op }) {
    let tree = bspReconcile(spec.tree, ids);
    if (op === "swap" && bspIds(tree).includes(id)) tree = bspSwap(tree, id, target);
    else {
      tree = bspRemove(tree, id);
      tree = zone === "center" ? bspInsert(tree, { id, target }) : bspPlace(tree, { id, target, side: zone });
    }
    return { ids: bspIds(tree), layout: { ...spec, tree } };
  },
};

/**
 * Built-in drop interpreters. The order-based axes:
 *   columns, grid, tabs, monocle  x      (grid: reading order runs along rows)
 *   rows                          y
 *   master-stack                  x for a lone master (-x with side "right"), else y
 *   spiral                        alternates x / y with depth
 *   default (custom layouts)      both   (reading order)
 */
export const DROPS = Object.freeze({
  "master-stack": orderDrops(masterStackAxis),
  columns: orderDrops(() => "x"),
  rows: orderDrops(() => "y"),
  grid: orderDrops(() => "x"),
  spiral: orderDrops(spiralAxis),
  monocle: orderDrops(() => "x"),
  tabs: orderDrops(() => "x"),
  bsp: bspDrops,
  default: orderDrops(() => "both"),
});

/** The interpreter for a layout spec (function specs and unknown types use `default`). */
export const dropInterpreterFor = (drops, spec) =>
  (spec && typeof spec === "object" && drops[spec.type]) || drops.default || DROPS.default;

/** Generic order edit. A dragged window missing from `ids` (floating) is inserted; its "swap" becomes "before". */
export const reorder = (ids, id, target, op) => {
  if (op === "swap" && ids.includes(id)) return ids.map((x) => (x === id ? target : x === target ? id : x));
  const rest = ids.filter((x) => x !== id);
  const index = rest.indexOf(target) + (op === "after" ? 1 : 0);
  return [...rest.slice(0, index), id, ...rest.slice(index)];
};

/** Write a new tiled order back into the full workspace list, keeping every other window's slot. */
const writeOrder = (all, next) => {
  const moving = new Set(next);
  let k = 0;
  return all.map((x) => (moving.has(x) ? next[k++] : x));
};

/** Swap two windows in their workspace order and, for BSP, in the tree. */
export const swapWindows = (state, a, b) => {
  const ws = state.workspaces[state.windows[a].workspace];
  let next = setWorkspace(state, ws.id, { windows: ws.windows.map((id) => (id === a ? b : id === b ? a : id)) });
  if (ws.layout?.type === "bsp" && ws.layout.tree) {
    next = setWorkspace(next, ws.id, { layout: { ...ws.layout, tree: bspSwap(ws.layout.tree, a, b) } });
  }
  return next;
};

const violates = (constraints = {}, slot) =>
  Boolean(slot) &&
  ((Number.isFinite(constraints.minWidth) && slot.width < constraints.minWidth) ||
    (Number.isFinite(constraints.maxWidth) && slot.width > constraints.maxWidth) ||
    (Number.isFinite(constraints.minHeight) && slot.height < constraints.minHeight) ||
    (Number.isFinite(constraints.maxHeight) && slot.height > constraints.maxHeight));

/**
 * Apply an op to a workspace. Shared by drops and the keyboard commands.
 * The dragged window becomes tiled if it was not (a floating window dropped into the layout).
 */
const applyOp = (state, drops, { id, target, zone, op }) => {
  const ws = state.workspaces[state.windows[target].workspace];
  const ids = tiledOrder(state, ws.id);
  const interpreter = dropInterpreterFor(drops, ws.layout);
  let next = state;
  if (state.windows[id].mode !== "tiled") {
    next = { ...next, windows: { ...next.windows, [id]: { ...next.windows[id], mode: "tiled" } } };
  }
  const out = interpreter.apply
    ? interpreter.apply(ws.layout, ids, { id, target, zone, op })
    : { ids: reorder(ids, id, target, op) };
  const patch = { windows: writeOrder(ws.windows, out.ids) };
  if (out.layout) patch.layout = out.layout;
  return setWorkspace(next, ws.id, patch);
};

const unchanged = (before, after, wsId, id) =>
  before.windows[id] === after.windows[id] &&
  JSON.stringify(before.workspaces[wsId]) === JSON.stringify(after.workspaces[wsId]);

/**
 * Validate and resolve a drop. Returns `{ reason }` or `{ op, workspace }`.
 * Exported so the pure helpers and the input adapter share one set of rules.
 */
export const resolveDrop = (state, { id, target, zone }, drops = DROPS, { allowFloating = false } = {}) => {
  const win = state.windows[id];
  const tgt = state.windows[target];
  if (!win || !tgt) return { reason: "unknown-window" };
  if (!DROP_ZONES.includes(zone)) return { reason: "unknown-zone" };
  if (id === target) return { reason: "same-window" };
  if (win.workspace !== tgt.workspace) return { reason: "different-workspaces" };
  const ws = state.workspaces[win.workspace];
  const mode = dragMode(state, ws.id);
  if (mode === "off") return { reason: "drag-disabled" };
  if (win.draggable === false) return { reason: "not-draggable" };
  const floatingIn = allowFloating && win.role === "window" && win.mode === "floating" && win.status === "normal" && !win.parent;
  if (!isDroppable(state, tgt) || (!isDroppable(state, win) && !floatingIn)) return { reason: "not-tiled" };
  if (isBlocked(state, id) || isBlocked(state, target)) return { reason: "blocked" };
  const ids = tiledOrder(state, ws.id);
  const op = dropInterpreterFor(drops, ws.layout).ops(ws.layout, ids, target)?.[zone] ?? null;
  if (!op) return { reason: "unknown-zone" };
  if (!opAllowed(mode, op)) return { reason: "zone-disabled" };
  if (op === "swap" && tgt.draggable === false && ids.includes(id)) return { reason: "not-draggable" };
  return { op, workspace: ws.id, mode };
};

/**
 * The `window/drop` handler over a drop-interpreter registry.
 *
 *   { type: "window/drop", id, target, zone, geometry? }
 *
 * The dragged window may also be a floating top-level window (dropped into
 * the layout; it becomes tiled) unless `config.drag.toTiled` is "off". A
 * floating window has no slot to trade, so its "swap" inserts it in the
 * target's place instead.
 *
 * `geometry` (optional) is `{ [id]: { width, height } }`: estimated slot sizes
 * *after* the drop (the input adapter measures its preview). With
 * `config.drag.tooSmall: "reject"` a drop whose slot would violate the dragged
 * or target window's min/max constraints is refused. Without geometry the
 * setting is advisory: the pure core has no pixels to check.
 */
export const createDropHandler = (drops = DROPS) => (state, command) => {
  // A floating window may be dropped into the layout unless config.drag.toTiled is "off".
  const resolved = resolveDrop(state, command, drops, { allowFloating: state.config.drag?.toTiled !== "off" });
  if (resolved.reason) return rejected(state, command, resolved.reason);
  const { id, target, zone, geometry } = command;
  if (state.config.drag?.tooSmall === "reject" && geometry) {
    for (const wid of [id, target]) {
      if (violates(state.windows[wid].constraints, geometry[wid])) return rejected(state, command, "too-small");
    }
  }
  const next = applyOp(state, drops, { id, target, zone, op: resolved.op });
  const event = { type: "window/dropped", id, target, zone, op: resolved.op, workspace: resolved.workspace };
  if (state.windows[id].mode !== "tiled") event.tiled = true;
  // Dropping a window where it already is reports the drop but changes nothing.
  if (unchanged(state, next, resolved.workspace, id)) return result(state, [event]);
  return result(next, [event], [RENDER]);
};

/** Order used by the keyboard commands: the BSP tree's leaf order, else the workspace order. */
const neighbourOrder = (state, wsId) => {
  const ws = state.workspaces[wsId];
  const ids = tiledOrder(state, wsId);
  return ws.layout?.type === "bsp" ? bspIds(bspReconcile(ws.layout.tree, ids)) : ids;
};

const subjectOf = (state, command) => {
  const id = command.id ?? state.focus.window;
  const win = state.windows[id];
  if (!win) return { reason: "unknown-window" };
  if (!isDroppable(state, win)) return { reason: "not-tiled" };
  return { id, win };
};

const swapAdjacent = (direction) => (state, command) => {
  const subject = subjectOf(state, command);
  if (subject.reason) return rejected(state, command, subject.reason);
  const ids = neighbourOrder(state, subject.win.workspace);
  if (ids.length < 2) return result(state);
  const other = ids[(ids.indexOf(subject.id) + direction + ids.length) % ids.length];
  return result(swapWindows(state, subject.id, other), [{ type: "window/swapped", a: subject.id, b: other }], [RENDER]);
};

const moveRelative = (position) => (drops) => (state, command) => {
  const subject = subjectOf(state, command);
  if (subject.reason) return rejected(state, command, subject.reason);
  const ids = neighbourOrder(state, subject.win.workspace);
  const index = ids.indexOf(subject.id);
  const target = command.target ?? ids[index + (position === "before" ? -1 : 1)];
  if (target === undefined) return result(state); // already first / last
  const tgt = state.windows[target];
  if (!tgt) return rejected(state, command, "unknown-window");
  if (target === subject.id) return rejected(state, command, "same-window");
  if (tgt.workspace !== subject.win.workspace) return rejected(state, command, "different-workspaces");
  if (!isDroppable(state, tgt)) return rejected(state, command, "not-tiled");
  const ws = state.workspaces[subject.win.workspace];
  let next;
  if (ws.layout?.type === "bsp") {
    // Split the target along its own split's direction, on the requested side.
    const tree = bspReconcile(ws.layout.tree, tiledOrder(state, ws.id));
    const vertical = bspParentDirection(tree, target) === "vertical";
    const zone = position === "before" ? (vertical ? "top" : "left") : vertical ? "bottom" : "right";
    next = applyOp(state, drops, { id: subject.id, target, zone, op: "split" });
  } else {
    next = applyOp(state, drops, { id: subject.id, target, zone: position === "before" ? "left" : "right", op: position });
  }
  return result(next, [{ type: "window/reordered", id: subject.id, target, position }], [RENDER]);
};

/** Toggle whether a window can be dragged (pinned windows cannot). */
const setDraggable = (state, command) => {
  const win = state.windows[command.id];
  if (!win) return rejected(state, command, "unknown-window");
  const draggable = command.draggable !== false;
  if ((win.draggable !== false) === draggable) return result(state);
  const { draggable: _old, ...rest } = win;
  const record = draggable ? rest : { ...rest, draggable: false };
  return result({ ...state, windows: { ...state.windows, [win.id]: record } }, [
    { type: "window/draggable-changed", id: win.id, draggable },
  ], [RENDER]);
};

/** Command handlers contributed by this module (merged into `update`'s built-ins). */
export const dropHandlers = (drops = DROPS) => ({
  "window/drop": createDropHandler(drops),
  "window/swap-next": swapAdjacent(1),
  "window/swap-previous": swapAdjacent(-1),
  "window/move-before": moveRelative("before")(drops),
  "window/move-after": moveRelative("after")(drops),
  "window/set-draggable": setDraggable,
});
