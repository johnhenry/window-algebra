/**
 * Pure two-finger gesture math, in the same spirit as `drag.mjs`: an adapter
 * feeds pointer positions, these return rects or verdicts. No events, no DOM.
 */
import { constrainSize } from "../geometry/rect.mjs";

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The smallest width/height a pinch will shrink a window to, absent its own constraints. */
export const PINCH_MIN_SIZE = 48;

/**
 * Begin a pinch of a window. `points` are the two pointer positions, `bounds`
 * the window's rect (same coordinate space).
 */
export const createPinch = ({ points, bounds, constraints = {}, minSize = PINCH_MIN_SIZE }) => {
  const [a, b] = points;
  return {
    kind: "pinch",
    start: { ...bounds },
    centroid: midpoint(a, b),
    distance: Math.max(1, distance(a, b)),
    constraints: { minWidth: minSize, minHeight: minSize, ...constraints },
  };
};

/**
 * The window's rect for two pointer positions: its size scales with the
 * distance between the fingers (honouring constraints, aspect ratio included),
 * and the point of the window that started under the fingers' midpoint stays
 * under it, so the window follows the hand as well as growing.
 */
export const updatePinch = (pinch, points) => {
  const [a, b] = points;
  const scale = distance(a, b) / pinch.distance;
  const { start } = pinch;
  const size = constrainSize({ width: start.width * scale, height: start.height * scale }, pinch.constraints, {});
  const fx = start.width > 0 ? (pinch.centroid.x - start.x) / start.width : 0.5;
  const fy = start.height > 0 ? (pinch.centroid.y - start.y) / start.height : 0.5;
  const now = midpoint(a, b);
  return { x: now.x - fx * size.width, y: now.y - fy * size.height, width: size.width, height: size.height };
};

/**
 * Classify a finished single-pointer stroke as a swipe: `"left"`, `"right"`,
 * `"up"`, `"down"` or `null`. It must travel at least `distance` px, mostly
 * along one axis (`dominance` times the other), within `maxDuration` ms.
 */
export const swipeOf = ({ dx, dy, duration = 0 }, { distance: min = 48, dominance = 2, maxDuration = 700 } = {}) => {
  if (duration > maxDuration) return null;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= min && ax >= ay * dominance) return dx < 0 ? "left" : "right";
  if (ay >= min && ay >= ax * dominance) return dy < 0 ? "up" : "down";
  return null;
};
