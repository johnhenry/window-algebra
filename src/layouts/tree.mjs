/**
 * Docking tree: a *stateful* layout expressed functionally, the n-ary
 * counterpart to BSP (`src/layouts/bsp.mjs`). The tree itself is state, the
 * same shape a user hands to `layout/set { type: "tree", tree }` or gets back
 * from `layout/to-tree`:
 *
 *   leaf:      a window id (plain string)
 *   container: { type: "row" | "column" | "tabs", children: [...], sizes? }
 *
 * `children` may mix leaves and nested containers freely. `sizes` (row/column
 * only) is an array of positive weights parallel to `children`, the same
 * units as `size({ weight })` and the same convention `columns`/`rows` use
 * for `spec.sizes[""]` (see docs/PRD.md, "Split sizing") — missing/invalid
 * sizes fall back to equal weights. `tabs` containers have no `sizes`; the
 * active child is whichever one contains the focused window, else the first.
 */
import { view, row, column, stack, size } from "../algebra/nodes.mjs";

const isTreeContainer = (node) =>
  Boolean(node) && typeof node === "object" && ["row", "column", "tabs"].includes(node.type) && Array.isArray(node.children);

/** Ids of all leaves, in order. */
export const treeIds = (node) => (node == null ? [] : typeof node === "string" ? [node] : node.children.flatMap(treeIds));

const containsLeaf = (node, id) => (typeof node === "string" ? node === id : node.children.some((child) => containsLeaf(child, id)));

const firstLeaf = (node) => (typeof node === "string" ? node : firstLeaf(node.children[0]));

/** The type ("row" | "column" | "tabs") of the container directly containing leaf `id`, or `null` when `id` is the root or absent. */
export const treeParentType = (node, id) => {
  if (!isTreeContainer(node)) return null;
  for (const child of node.children) {
    if (typeof child === "string") {
      if (child === id) return node.type;
    } else {
      const found = treeParentType(child, id);
      if (found) return found;
    }
  }
  return null;
};

/** A validated positive-weight array parallel to `children`, or equal shares of 1. */
const resizeWeights = (stored, count) =>
  Array.isArray(stored) && stored.length === count && stored.every((w) => typeof w === "number" && Number.isFinite(w) && w > 0)
    ? stored
    : new Array(count).fill(1);

/**
 * Remove leaf `id`, collapsing containers as it goes: an emptied container
 * disappears, and a container left with exactly one child is replaced by
 * that child (a size-1 row/column/tabs means nothing).
 */
export const treeRemove = (node, id) => {
  if (node == null) return null;
  if (typeof node === "string") return node === id ? null : node;
  const removed = node.children.map((child) => treeRemove(child, id));
  const survivorIndex = [];
  const children = [];
  removed.forEach((child, i) => {
    if (child !== null) {
      children.push(child);
      survivorIndex.push(i);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  if (!Array.isArray(node.sizes) || node.sizes.length !== node.children.length) return { type: node.type, children };
  return { type: node.type, children, sizes: survivorIndex.map((i) => node.sizes[i]) };
};

/** Exchange two leaves' positions, wherever they sit in the tree. */
export const treeSwap = (node, a, b) => {
  if (node == null) return node;
  if (typeof node === "string") return node === a ? b : node === b ? a : node;
  return { ...node, children: node.children.map((child) => treeSwap(child, a, b)) };
};

/**
 * Split leaf `target` (wherever it sits) into a new row ("left"/"right") or
 * column ("top"/"bottom") with `id` on that side. `target` must already be
 * absent from elsewhere in the tree (callers `treeRemove(tree, id)` first).
 */
export const treeSplit = (tree, { id, target, side, ratio = 0.5 }) => {
  const direction = side === "left" || side === "right" ? "row" : "column";
  const idFirst = side === "left" || side === "top";
  const r = Math.min(0.95, Math.max(0.05, ratio));
  const sizes = idFirst ? [r, 1 - r] : [1 - r, r];
  const wrap = (node) => ({ type: direction, children: idFirst ? [id, node] : [node, id], sizes });
  const visit = (node) => (typeof node === "string" ? (node === target ? wrap(node) : node) : { ...node, children: node.children.map(visit) });
  return visit(tree);
};

/**
 * Add `id` as a tab alongside `target`: if `target`'s direct parent is
 * already a `tabs` container, `id` joins it right after `target`; otherwise
 * `target` is wrapped in a new `tabs` container with `id`. `target` must
 * already be absent from elsewhere (see `treeSplit`).
 */
export const treeAddTab = (tree, { id, target }) => {
  const visit = (node) => {
    if (typeof node === "string") return node === target ? { type: "tabs", children: [node, id] } : node;
    if (node.type === "tabs") {
      const index = node.children.findIndex((child) => child === target);
      if (index !== -1) {
        const children = node.children.slice();
        children.splice(index + 1, 0, id);
        return { type: "tabs", children };
      }
    }
    return { ...node, children: node.children.map(visit) };
  };
  return visit(tree);
};

/**
 * Insert `id` into `target`'s tab strip, immediately before or after it.
 * `target`'s direct parent must be a `tabs` container (guaranteed by
 * `treeDrops.ops`, which only offers "before"/"after" in that case); `target`
 * must already be absent from elsewhere. Falls back to `treeAddTab` if,
 * unexpectedly, `target` isn't in a `tabs` container.
 */
export const treeInsertTab = (tree, { id, target, position }) => {
  let placed = false;
  const visit = (node) => {
    if (typeof node === "string") return node;
    if (node.type === "tabs") {
      const index = node.children.findIndex((child) => child === target);
      if (index !== -1) {
        placed = true;
        const children = node.children.slice();
        children.splice(position === "before" ? index : index + 1, 0, id);
        return { type: "tabs", children };
      }
    }
    return { ...node, children: node.children.map(visit) };
  };
  const next = visit(tree);
  return placed ? next : treeAddTab(tree, { id, target });
};

/**
 * Make a stored tree agree with the windows present: leaves not in `ids` are
 * dropped (collapsing as `treeRemove` does), and any id present in `ids` but
 * missing from the tree is appended — to the root container's children when
 * the root already is one, wrapped alongside the sole leaf in a new `tabs`
 * container otherwise, or as a fresh `tabs` container when the tree is empty.
 */
export const treeReconcile = (tree, ids) => {
  let next = tree ?? null;
  for (const id of treeIds(next)) if (!ids.includes(id)) next = treeRemove(next, id);
  const present = treeIds(next);
  const missing = ids.filter((id) => !present.includes(id));
  if (missing.length === 0) return next;
  if (next == null) return missing.length === 1 ? missing[0] : { type: "tabs", children: missing };
  if (typeof next === "string") return { type: "tabs", children: [next, ...missing] };
  return { ...next, children: [...next.children, ...missing] };
};

/**
 * The node reached by walking `path` from the root, one step per
 * comma-separated child index (`"0,1"` = `children[0].children[1]`; `""` is
 * the root). Returns `null` for a path that runs into a leaf, an out-of-range
 * index, or off the tree — general addressing for `layout/resize-split`,
 * parallel to `bspNodeAt`.
 */
export const treeNodeAt = (tree, path) => {
  let node = tree;
  const steps = path === "" ? [] : path.split(",").map(Number);
  for (const i of steps) {
    if (!isTreeContainer(node) || !Number.isInteger(i) || i < 0 || i >= node.children.length) return null;
    node = node.children[i];
  }
  return isTreeContainer(node) ? node : null;
};

/** Set the `sizes` of the row/column container at `path` (see `treeNodeAt`); other containers are untouched. */
export const treeSetSizesAt = (tree, path, weights) => {
  const steps = path === "" ? [] : path.split(",").map(Number);
  const visit = (node, remaining) => {
    if (!isTreeContainer(node)) return node;
    if (remaining.length === 0) return weights.length === node.children.length ? { ...node, sizes: weights } : node;
    const [i, ...rest] = remaining;
    if (i < 0 || i >= node.children.length) return node;
    const children = node.children.slice();
    children[i] = visit(children[i], rest);
    return { ...node, children };
  };
  return visit(tree, steps);
};

/** Which child of a `tabs` container should be shown: the one containing `focused`, else the first. */
const activeIndex = (node, focused) => {
  if (typeof focused === "string") {
    const index = node.children.findIndex((child) => containsLeaf(child, focused));
    if (index !== -1) return index;
  }
  return 0;
};

/**
 * Interpret a docking tree as a layout-algebra tree. Every row/column becomes
 * a `row`/`column` carrying `resize: { path, weights }` when it has more
 * than one child (see docs/PRD.md, "Split sizing"); every `tabs` becomes a
 * `stack` with the existing tabs chrome. `context.focused` picks each tab
 * group's active child.
 */
export const treeToLayout = (tree, context = {}) => {
  const build = (node, path) => {
    if (node == null) return row({});
    if (typeof node === "string") return view(node);
    const kids = node.children.map((child, i) => build(child, path === "" ? String(i) : `${path},${i}`));
    if (node.type === "tabs") {
      const active = firstLeaf(node.children[activeIndex(node, context.focused)]);
      return stack({ active, chrome: "tabs" }, ...kids);
    }
    const make = node.type === "column" ? column : row;
    const n = node.children.length;
    const weights = resizeWeights(node.sizes, n);
    const sized = kids.map((kid, i) => size({ weight: weights[i] }, kid));
    return n > 1 ? make({ resize: { path, weights } }, ...sized) : make({}, ...sized);
  };
  return build(tree, "");
};

/** Build a flat container tree of `type` ("tabs" by default) from `ids`; a single id is a bare leaf. */
export const treeFrom = (ids, { type = "tabs" } = {}) => {
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  return { type, children: [...ids] };
};

/** Convert a BSP tree (`src/layouts/bsp.mjs`) into the equivalent docking tree, preserving each split's ratio. */
export const treeFromBsp = (node) => {
  if (!node) return null;
  if (node.type === "leaf") return node.id;
  const r = Math.round(node.ratio * 1000) / 1000;
  const other = Math.round((1 - r) * 1000) / 1000;
  return {
    type: node.direction === "vertical" ? "column" : "row",
    children: [treeFromBsp(node.first), treeFromBsp(node.second)],
    sizes: [r, other],
  };
};

export { isTreeContainer };
