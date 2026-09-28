/**
 * Pure drag-and-drop helpers for tiled windows. Like the move/resize
 * primitives they never listen for events: an adapter feeds them measured
 * rectangles and pointer positions and turns the answers into one
 * `window/drop` command.
 */
import { update } from "../state/update.mjs";
import { paintOrder, isVisible, descendantsOf } from "../state/queries.mjs";
import { DROPS, DROP_ZONES, dragMode, opAllowed, dropInterpreterFor, tiledOrder, isDroppable, resolveDrop } from "../state/drops.mjs";

export { DROP_ZONES };

const contains = (rect, point) =>
  Boolean(rect) && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

/** Normalized distance (0 at the edge, 0.5 at the middle) from a point to each edge of a rect. */
const edgeDistances = (rect, point) => {
  const fx = rect.width > 0 ? (point.x - rect.x) / rect.width : 0.5;
  const fy = rect.height > 0 ? (point.y - rect.y) / rect.height : 0.5;
  return { left: fx, right: 1 - fx, top: fy, bottom: 1 - fy };
};

/**
 * Which zone of `rect` a point is in: an edge ("left", "right", "top",
 * "bottom") when it lies within `edgeZone` (a fraction of the width or height)
 * of that edge, the nearest edge in a corner, else "center". Null outside.
 */
export const dropZoneAt = (rect, point, edgeZone = 0.25) => {
  if (!contains(rect, point)) return null;
  const band = Math.min(0.5, Math.max(0, Number(edgeZone) || 0));
  let best = null;
  for (const [zone, distance] of Object.entries(edgeDistances(rect, point))) {
    if (distance < band && (best === null || distance < best.distance)) best = { zone, distance };
  }
  return best ? best.zone : "center";
};

/** Rect of the part of a target a zone refers to (for highlighting): an edge half, or the whole. */
export const zoneRect = (rect, zone) => {
  const { x, y, width: w, height: h } = rect;
  if (zone === "left") return { x, y, width: w / 2, height: h };
  if (zone === "right") return { x: x + w / 2, y, width: w / 2, height: h };
  if (zone === "top") return { x, y, width: w, height: h / 2 };
  if (zone === "bottom") return { x, y: y + h / 2, width: w, height: h / 2 };
  return { ...rect };
};

/** Tiled windows actually shown: a monocle/tabs stack shows only its active window. */
const shownTiled = (state, ids) => {
  const spec = state.workspaces[state.activeWorkspace].layout;
  if (spec?.type !== "monocle" && spec?.type !== "tabs") return ids;
  const focused = state.focus.window;
  const active = ids.includes(spec.active) ? spec.active : ids.includes(focused) ? focused : ids[0];
  return active === undefined ? [] : [active];
};

/**
 * Find the drop under a pointer.
 *
 * @param {object} state
 * @param {Record<string, {x,y,width,height}>} geometry measured rects (same
 *   coordinate space as `point`), e.g. `renderer.measure()`. Floating windows'
 *   rects matter too: a point covered by one is not a drop.
 * @param {{x: number, y: number}} point
 * @param {string} draggedId
 * @param {object} [options]
 * @param {object} [options.drops] drop-interpreter registry (default DROPS)
 * @param {boolean} [options.allowFloating] the dragged window may be floating (dropping it into the layout)
 * @returns {{ target: string, zone: string, op: string } | null}
 *
 * Settings are respected: `config.drag.edgeZone`; the effective mode (a zone
 * whose op the mode forbids falls back to the nearest permitted zone — the
 * center in "swap" mode, the nearest insert edge in "insert" mode); pinned
 * (`draggable: false`) windows neither drag nor trade places.
 */
export const dropTargetAt = (state, geometry, point, draggedId, { drops = DROPS, allowFloating = false } = {}) => {
  const dragged = state.windows[draggedId];
  if (!dragged || dragged.workspace !== state.activeWorkspace || !point) return null;
  const mode = dragMode(state);
  if (mode === "off" || dragged.draggable === false) return null;
  const ids = tiledOrder(state, state.activeWorkspace);
  const shown = new Set(shownTiled(state, ids).filter((id) => isVisible(state, id)));
  const skip = new Set([draggedId, ...descendantsOf(state, draggedId)]);
  const tiled = new Set(ids);

  // Topmost window under the pointer, in paint order; hidden stack children do not count.
  let target = null;
  const order = paintOrder(state);
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    if (skip.has(id) || (tiled.has(id) && !shown.has(id)) || !contains(geometry[id], point)) continue;
    if (!shown.has(id)) return null; // covered by a floating window
    target = id;
    break;
  }
  if (!target) return null;

  const spec = state.workspaces[state.activeWorkspace].layout;
  const ops = dropInterpreterFor(drops, spec).ops(spec, ids, target) ?? {};
  const pinnedTarget = state.windows[target].draggable === false && ids.includes(draggedId);
  const permitted = (zone) => opAllowed(mode, ops[zone]) && !(ops[zone] === "swap" && pinnedTarget);
  const rect = geometry[target];
  let zone = dropZoneAt(rect, point, state.config.drag?.edgeZone ?? 0.25);
  if (!permitted(zone)) {
    const distances = edgeDistances(rect, point);
    const fallbacks = [
      ...(zone !== "center" ? ["center"] : []),
      ...Object.keys(distances).sort((a, b) => distances[a] - distances[b]),
    ];
    zone = fallbacks.find(permitted) ?? null;
    if (!zone) return null;
  }
  const resolved = resolveDrop(state, { id: draggedId, target, zone }, drops, { allowFloating });
  return resolved.reason ? null : { target, zone, op: resolved.op };
};

/**
 * The state a drop would produce — `update` on the (immutable) state, nothing
 * else — or null when the drop would be rejected. `extensions` are passed to
 * `update` (e.g. `{ "window/drop": createDropHandler(myDrops) }`).
 */
export const previewDrop = (state, drop, { extensions } = {}) => {
  if (!drop) return null;
  const { id, target, zone, geometry } = drop;
  const command = { type: "window/drop", id, target, zone };
  if (geometry) command.geometry = geometry;
  const out = update(state, command, extensions);
  return out.events.some((event) => event.type === "command/rejected") ? null : out.state;
};

export { isDroppable };
