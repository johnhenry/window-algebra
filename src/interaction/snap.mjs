/**
 * Pure snap-zone and magnetism helpers for floating windows (Windows
 * Snap / macOS-tiling / WM-magnetism style). Like the other interaction
 * primitives, they never touch the DOM or dispatch commands: an adapter
 * feeds them a stage rect, a pointer position and other windows' rects, and
 * turns the answers into `window/resize` commands.
 *
 * Governed by `config.snap = { edges, threshold, magnet, zones }` (see
 * `state/create.mjs` for the defaults):
 * - `edges`: master switch for the edge/corner zone preview (`snapZoneAt`).
 * - `threshold`: how close (px) the pointer must be to a stage edge/corner
 *   to trigger a zone.
 * - `zones`: "halves-quarters" (default, both), "halves" (edges only, no
 *   corner quarters), "quarters" (corners only) or "off"/false (same as
 *   `edges: false`).
 * - `magnet`: how close (px) a moving/resizing rect's edge must be to
 *   another rect's edge to snap onto it (0 disables magnetism).
 */

/** Every zone `snapZoneAt` can return, and `snapZoneRect` understands. */
export const SNAP_ZONES = Object.freeze(["maximize", "left", "right", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"]);

/**
 * Which snap zone the pointer is near, given a stage rect and a point in
 * the same coordinate space (both edge-relative, e.g. root-relative). Null
 * outside every zone, or when `edges` is off. A corner (within `threshold`
 * of two adjacent edges) wins over a plain edge; `zones` narrows the set:
 * "halves" never returns a corner, "quarters" never returns a plain edge.
 */
export const snapZoneAt = (stage, point, cfg = {}) => {
  if (!stage || !point) return null;
  const { edges = true, threshold = 16, zones = "halves-quarters" } = cfg;
  if (!edges || zones === false || zones === "off") return null;
  const band = Math.max(0, Number(threshold) || 0);
  // Symmetric around the boundary line: a pointer a little outside the stage
  // (still captured mid-drag) counts too, but one far outside does not.
  const nearLeft = Math.abs(point.x - stage.x) <= band;
  const nearRight = Math.abs(stage.x + stage.width - point.x) <= band;
  const nearTop = Math.abs(point.y - stage.y) <= band;
  const nearBottom = Math.abs(stage.y + stage.height - point.y) <= band;
  const wantCorners = zones !== "halves";
  const wantEdges = zones !== "quarters";
  if (wantCorners) {
    if (nearTop && nearLeft) return "top-left";
    if (nearTop && nearRight) return "top-right";
    if (nearBottom && nearLeft) return "bottom-left";
    if (nearBottom && nearRight) return "bottom-right";
  }
  if (wantEdges) {
    if (nearTop) return "maximize";
    if (nearLeft) return "left";
    if (nearRight) return "right";
    if (nearBottom) return "bottom";
  }
  return null;
};

/** The placement rect a snap zone resolves to within `stage`: a half, a quarter, or the whole stage. */
export const snapZoneRect = (stage, zone) => {
  if (!stage || !SNAP_ZONES.includes(zone)) return null;
  const { x, y, width, height } = stage;
  const halfW = width / 2;
  const halfH = height / 2;
  switch (zone) {
    case "maximize":
      return { x, y, width, height };
    case "left":
      return { x, y, width: halfW, height };
    case "right":
      return { x: x + halfW, y, width: halfW, height };
    case "bottom":
      return { x, y: y + halfH, width, height: halfH };
    case "top-left":
      return { x, y, width: halfW, height: halfH };
    case "top-right":
      return { x: x + halfW, y, width: halfW, height: halfH };
    case "bottom-left":
      return { x, y: y + halfH, width: halfW, height: halfH };
    case "bottom-right":
      return { x: x + halfW, y: y + halfH, width: halfW, height: halfH };
    default:
      return null;
  }
};

/** The smallest-magnitude candidate delta within `magnet`, or 0. */
const bestDelta = (candidates, magnet) => {
  let best = magnet + 1;
  let delta = 0;
  for (const cand of candidates) {
    const d = Math.abs(cand);
    if (d <= magnet && d < best) {
      best = d;
      delta = cand;
    }
  }
  return delta;
};

/**
 * Magnetism for a move: translate `rect` (unchanged size) so its left/right
 * edges snap onto the nearest matching edge among `others` within
 * `cfg.magnet` px (and independently for top/bottom), else left as given.
 * `others` should include the stage rect itself when the stage should also
 * attract, and exclude the window being moved.
 */
export const magnetize = (rect, others = [], cfg = {}) => {
  const magnet = Number(cfg.magnet ?? 8);
  if (!rect) return rect;
  if (!(magnet > 0) || !others.length) return { ...rect };
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  const xCandidates = [];
  const yCandidates = [];
  for (const other of others) {
    if (!other) continue;
    const oLeft = other.x;
    const oRight = other.x + other.width;
    const oTop = other.y;
    const oBottom = other.y + other.height;
    xCandidates.push(oLeft - left, oRight - left, oLeft - right, oRight - right);
    yCandidates.push(oTop - top, oBottom - top, oTop - bottom, oBottom - bottom);
  }
  const dx = bestDelta(xCandidates, magnet);
  const dy = bestDelta(yCandidates, magnet);
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
};

/**
 * Magnetism for a resize: like `magnetize`, but only the edge(s) `edge`
 * (an `EDGES` value from `interaction/drag.mjs`: "n"/"s"/"e"/"w" or a
 * corner) moves, snapping onto the nearest matching edge among `others`
 * within `cfg.magnet` px. Width/height never go negative.
 */
export const magnetizeResize = (rect, others = [], edge = "se", cfg = {}) => {
  const magnet = Number(cfg.magnet ?? 8);
  if (!rect) return rect;
  let { x, y, width, height } = rect;
  if (!(magnet > 0) || !others.length) return { x, y, width, height };
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  if (edge.includes("e")) {
    const dx = bestDelta(others.filter(Boolean).flatMap((o) => [o.x - right, o.x + o.width - right]), magnet);
    width = Math.max(0, right + dx - x);
  }
  if (edge.includes("w")) {
    const dx = bestDelta(others.filter(Boolean).flatMap((o) => [o.x - left, o.x + o.width - left]), magnet);
    const snapped = left + dx;
    width = Math.max(0, right - snapped);
    x = right - width;
  }
  if (edge.includes("s")) {
    const dy = bestDelta(others.filter(Boolean).flatMap((o) => [o.y - bottom, o.y + o.height - bottom]), magnet);
    height = Math.max(0, bottom + dy - y);
  }
  if (edge.includes("n")) {
    const dy = bestDelta(others.filter(Boolean).flatMap((o) => [o.y - top, o.y + o.height - top]), magnet);
    const snapped = top + dy;
    height = Math.max(0, bottom - snapped);
    y = bottom - height;
  }
  return { x, y, width, height };
};
