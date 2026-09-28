/**
 * Pure interaction primitives. They never listen for events; an adapter
 * feeds them pointer positions (mouse, touch, pen, synthetic, remote, or an
 * agent) and turns the results into commands.
 */
import { constrainSize } from "../geometry/rect.mjs";

/** Begin a move. `origin` is the pointer position, `bounds` the window rect. */
export const createDrag = ({ origin, bounds }) => ({ kind: "move", origin: { ...origin }, start: { ...bounds } });

/** Current window position for a pointer position. Optional grid snapping. */
export const updateDrag = (drag, pointer, { snap } = {}) => {
  let x = drag.start.x + (pointer.x - drag.origin.x);
  let y = drag.start.y + (pointer.y - drag.origin.y);
  if (snap) {
    x = Math.round(x / snap) * snap;
    y = Math.round(y / snap) * snap;
  }
  return { x, y };
};

export const EDGES = Object.freeze(["n", "s", "e", "w", "ne", "nw", "se", "sw"]);

/** Begin a resize from an edge or corner ("n", "se", ...). */
export const createResize = ({ origin, bounds, edge = "se", constraints = {} }) => {
  if (!EDGES.includes(edge)) throw new TypeError(`createResize(): unknown edge "${edge}".`);
  return { kind: "resize", origin: { ...origin }, start: { ...bounds }, edge, constraints };
};

/** Resulting bounds for a pointer position, honouring constraints. */
export const updateResize = (resize, pointer) => {
  const { start, origin, edge, constraints } = resize;
  const dx = pointer.x - origin.x;
  const dy = pointer.y - origin.y;
  let width = start.width;
  let height = start.height;
  if (edge.includes("e")) width = start.width + dx;
  if (edge.includes("w")) width = start.width - dx;
  if (edge.includes("s")) height = start.height + dy;
  if (edge.includes("n")) height = start.height - dy;
  // A single-axis edge (n/s/e/w) drives one dimension; an aspect ratio should
  // adjust the other one, not fight the axis the pointer is actually moving.
  const preserve = edge === "n" || edge === "s" ? "height" : edge === "e" || edge === "w" ? "width" : undefined;
  const constrained = constrainSize({ width, height }, constraints, { preserve });
  const x = edge.includes("w") ? start.x + (start.width - constrained.width) : start.x;
  const y = edge.includes("n") ? start.y + (start.height - constrained.height) : start.y;
  return { x, y, width: constrained.width, height: constrained.height };
};

/** Change in a split ratio when dragging a divider across an extent of `total` pixels. */
export const updateRatio = ({ ratio, origin, total }, pointer, axis = "x") => {
  const delta = (pointer[axis] - origin[axis]) / total;
  return Math.min(0.95, Math.max(0.05, ratio + delta));
};
