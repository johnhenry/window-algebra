/**
 * Derived layouts: ordinary functions that compose the primitives.
 * None of these are privileged by the core; users write their own the same way.
 *
 * Convention: `layout(options, ids) → tree`.
 */
import { view, row, column, grid, stack, overlay, place, size } from "../algebra/nodes.mjs";

const toNode = (item) => (typeof item === "string" ? view(item) : item);

/**
 * A weights array for a resizable container: `stored` (from `spec.sizes`)
 * when it is valid and the right length, else `count` equal shares of 1.
 * See docs/PRD.md, "Split sizing", for the full scheme.
 */
const resizeWeights = (stored, count) =>
  Array.isArray(stored) && stored.length === count && stored.every((w) => typeof w === "number" && Number.isFinite(w) && w > 0)
    ? stored
    : new Array(count).fill(1);

/** Sugar for a floating window: place + size. */
export const floating = ({ x = 0, y = 0, width, height } = {}, child) => {
  const sizeOptions = {};
  if (width !== undefined) sizeOptions.width = width;
  if (height !== undefined) sizeOptions.height = height;
  return place({ x, y }, size(sizeOptions, toNode(child)));
};

/** Sugar: center a child within its allocation (dialogs, palettes). */
export const centered = ({ width, height } = {}, child) => {
  const sizeOptions = {};
  if (width !== undefined) sizeOptions.width = width;
  if (height !== undefined) sizeOptions.height = height;
  return place({ x: "center", y: "center" }, size(sizeOptions, toNode(child)));
};

/** Sugar: dock a child at one side of a row/column with a fixed extent. */
export const dock = ({ side = "left", extent = 240 } = {}, child, rest) => {
  const docked = size(side === "left" || side === "right" ? { width: extent } : { height: extent }, toNode(child));
  const body = toNode(rest);
  if (side === "left") return row({}, docked, body);
  if (side === "right") return row({}, body, docked);
  if (side === "top") return column({}, docked, body);
  return column({}, body, docked);
};

/**
 * Master on one side, the rest stacked in a column. The master/rest split is
 * persisted as `spec.ratio` (unchanged from before splitters existed);
 * `layout/resize-split` with `path: ""` adjusts it.
 */
export const masterStack = ({ ratio = 0.5, masterCount = 1, side = "left" } = {}, ids) => {
  const nodes = ids.map(toNode);
  if (nodes.length === 0) return row({});
  if (nodes.length <= masterCount) return nodes.length === 1 ? nodes[0] : column({}, ...nodes);
  const masters = nodes.slice(0, masterCount);
  const others = nodes.slice(masterCount);
  const weight = (value) => Math.round(value * 1000) / 1000;
  const master = size({ weight: weight(ratio) }, masters.length === 1 ? masters[0] : column({}, ...masters));
  const rest = size({ weight: weight(1 - ratio) }, others.length === 1 ? others[0] : column({}, ...others));
  // `resize.weights` always follows the visual (DOM) order, so a rendered
  // splitter and its aria-valuenow match what the pointer sees regardless of `side`.
  const resize = side === "right" ? { path: "", weights: [weight(1 - ratio), weight(ratio)] } : { path: "", weights: [weight(ratio), weight(1 - ratio)] };
  return side === "right" ? row({ resize }, rest, master) : row({ resize }, master, rest);
};

/**
 * Equal-width columns, or `spec.sizes[""]`-weighted once the caller has
 * resized one (children stay plain `view` nodes, as before, until then —
 * equal weights and the implicit default flex compile to the same CSS).
 * `spec` may also carry `align`/`distribute` (forwarded to the row).
 */
export const columns = (spec = {}, ids) => {
  const nodes = ids.map(toNode);
  const stored = spec.sizes?.[""];
  const resized = Array.isArray(stored) && stored.length === nodes.length;
  const weights = resizeWeights(stored, nodes.length);
  const children = resized ? nodes.map((node, i) => size({ weight: weights[i] }, node)) : nodes;
  const options = {};
  if (spec.align !== undefined) options.align = spec.align;
  if (spec.distribute !== undefined) options.distribute = spec.distribute;
  if (nodes.length > 1) options.resize = { path: "", weights };
  return row(options, ...children);
};

/** Equal-height rows, or `spec.sizes[""]`-weighted; see `columns`. */
export const rows = (spec = {}, ids) => {
  const nodes = ids.map(toNode);
  const stored = spec.sizes?.[""];
  const resized = Array.isArray(stored) && stored.length === nodes.length;
  const weights = resizeWeights(stored, nodes.length);
  const children = resized ? nodes.map((node, i) => size({ weight: weights[i] }, node)) : nodes;
  const options = {};
  if (spec.align !== undefined) options.align = spec.align;
  if (spec.distribute !== undefined) options.distribute = spec.distribute;
  if (nodes.length > 1) options.resize = { path: "", weights };
  return column(options, ...children);
};

/** One visible view at a time, sharing the full allocation. */
export const monocle = ({ active } = {}, ids) => stack({ active: active ?? ids[0] }, ...ids.map(toNode));

/** Monocle plus tab chrome. The tab strip is chrome, not a window. */
export const tabs = ({ active } = {}, ids) => stack({ active: active ?? ids[0], chrome: "tabs" }, ...ids.map(toNode));

/** Responsive grid: as many columns of at least `min` as fit. */
export const autoGrid = ({ min = 300, max = "1fr", repeat = "auto-fit" } = {}, ids) =>
  grid({ columns: { repeat, min, max } }, ...ids.map(toNode));

/** Fixed-column grid. */
export const fixedGrid = ({ columns: count = 2, rows: rowCount } = {}, ids) =>
  grid(rowCount ? { columns: count, rows: rowCount } : { columns: count }, ...ids.map(toNode));

/** Floating windows over a tiled base: the hybrid layout. */
export const hybrid = (tiled, floatingNodes = []) => overlay({}, tiled, ...floatingNodes);

/**
 * Spiral / dwindle: each new window splits the remaining space, alternating
 * direction. `ratio` is the shared default; `ratios[depth]` (0 = outermost
 * split) overrides it once that split has been resized — the natural place
 * for spiral's per-split sizes, parallel to BSP's per-node ratio.
 */
export const spiral = ({ ratio = 0.5, ratios } = {}, ids) => {
  const nodes = ids.map(toNode);
  const build = (items, horizontal, depth) => {
    if (items.length === 1) return items[0];
    const [first, ...rest] = items;
    const make = horizontal ? row : column;
    const r = typeof ratios?.[depth] === "number" ? ratios[depth] : ratio;
    const other = Math.round((1 - r) * 1000) / 1000;
    const resize = { path: String(depth), weights: [Math.round(r * 1000) / 1000, other] };
    return make({ resize }, size({ weight: r }, first), size({ weight: other }, build(rest, !horizontal, depth + 1)));
  };
  return nodes.length ? build(nodes, true, 0) : row({});
};

export * from "./bsp.mjs";
