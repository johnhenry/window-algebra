/**
 * Derived layouts: ordinary functions that compose the primitives.
 * None of these are privileged by the core; users write their own the same way.
 *
 * Convention: `layout(options, ids) → tree`.
 */
import { view, row, column, grid, stack, overlay, place, size } from "../algebra/nodes.mjs";

const toNode = (item) => (typeof item === "string" ? view(item) : item);

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

/** Master on one side, the rest stacked in a column. */
export const masterStack = ({ ratio = 0.5, masterCount = 1, side = "left" } = {}, ids) => {
  const nodes = ids.map(toNode);
  if (nodes.length === 0) return row({});
  if (nodes.length <= masterCount) return nodes.length === 1 ? nodes[0] : column({}, ...nodes);
  const masters = nodes.slice(0, masterCount);
  const others = nodes.slice(masterCount);
  const weight = (value) => Math.round(value * 1000) / 1000;
  const master = size({ weight: weight(ratio) }, masters.length === 1 ? masters[0] : column({}, ...masters));
  const rest = size({ weight: weight(1 - ratio) }, others.length === 1 ? others[0] : column({}, ...others));
  return side === "right" ? row({}, rest, master) : row({}, master, rest);
};

/** Equal-width columns. */
export const columns = (options = {}, ids) => row(options, ...ids.map(toNode));

/** Equal-height rows. */
export const rows = (options = {}, ids) => column(options, ...ids.map(toNode));

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

/** Spiral / dwindle: each new window splits the remaining space, alternating direction. */
export const spiral = ({ ratio = 0.5 } = {}, ids) => {
  const nodes = ids.map(toNode);
  const build = (items, horizontal) => {
    if (items.length === 1) return items[0];
    const [first, ...rest] = items;
    const make = horizontal ? row : column;
    return make({}, size({ weight: ratio }, first), size({ weight: 1 - ratio }, build(rest, !horizontal)));
  };
  return nodes.length ? build(nodes, true) : row({});
};

export * from "./bsp.mjs";
