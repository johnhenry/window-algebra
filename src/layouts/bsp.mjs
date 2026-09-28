/**
 * Binary space partitioning: a *stateful* layout expressed functionally.
 * The BSP tree is plain data kept in workspace state; these pure functions
 * return new trees, and `bspToLayout` interprets one into the algebra.
 *
 *   leaf:  { type: "leaf", id }
 *   split: { type: "split", direction: "horizontal" | "vertical", ratio, first, second }
 *
 * "horizontal" places first|second side by side (a row); "vertical" stacks
 * them (a column).
 */
import { view, row, column, size } from "../algebra/nodes.mjs";

export const bspLeaf = (id) => ({ type: "leaf", id });

export const bspSplit = (direction, ratio, first, second) => ({ type: "split", direction, ratio, first, second });

/** Ids of all leaves, in order. */
export const bspIds = (tree) =>
  !tree ? [] : tree.type === "leaf" ? [tree.id] : [...bspIds(tree.first), ...bspIds(tree.second)];

const depthOf = (tree, id, depth = 0) => {
  if (!tree) return -1;
  if (tree.type === "leaf") return tree.id === id ? depth : -1;
  const a = depthOf(tree.first, id, depth + 1);
  return a >= 0 ? a : depthOf(tree.second, id, depth + 1);
};

/**
 * Insert `id` by splitting the leaf `target` (defaults to the last leaf).
 * When `direction` is omitted it alternates with depth, dwindle-style.
 */
export const bspInsert = (tree, { id, target, direction, ratio = 0.5 }) => {
  if (!tree) return bspLeaf(id);
  const ids = bspIds(tree);
  if (ids.includes(id)) return tree;
  const goal = target && ids.includes(target) ? target : ids[ids.length - 1];
  const dir = direction ?? (depthOf(tree, goal) % 2 === 0 ? "horizontal" : "vertical");
  const visit = (node) => {
    if (node.type === "leaf") return node.id === goal ? bspSplit(dir, ratio, node, bspLeaf(id)) : node;
    return { ...node, first: visit(node.first), second: visit(node.second) };
  };
  return visit(tree);
};

/** Remove a leaf; its sibling takes the parent's place. */
export const bspRemove = (tree, id) => {
  if (!tree) return tree;
  if (tree.type === "leaf") return tree.id === id ? null : tree;
  const first = bspRemove(tree.first, id);
  const second = bspRemove(tree.second, id);
  if (!first) return second;
  if (!second) return first;
  return { ...tree, first, second };
};

/** Set the ratio of the split that directly contains `id`. */
export const bspSetRatio = (tree, id, ratio) => {
  if (!tree || tree.type === "leaf") return tree;
  const clamped = Math.min(0.95, Math.max(0.05, ratio));
  if ((tree.first.type === "leaf" && tree.first.id === id) || (tree.second.type === "leaf" && tree.second.id === id)) {
    return { ...tree, ratio: clamped };
  }
  return { ...tree, first: bspSetRatio(tree.first, id, ratio), second: bspSetRatio(tree.second, id, ratio) };
};

/** Toggle the direction of the split that directly contains `id`. */
export const bspRotate = (tree, id) => {
  if (!tree || tree.type === "leaf") return tree;
  if ([tree.first, tree.second].some((child) => child.type === "leaf" && child.id === id)) {
    return { ...tree, direction: tree.direction === "horizontal" ? "vertical" : "horizontal" };
  }
  return { ...tree, first: bspRotate(tree.first, id), second: bspRotate(tree.second, id) };
};

/** Interpret a BSP tree as a layout-algebra tree. */
export const bspToLayout = (tree) => {
  if (!tree) return row({});
  if (tree.type === "leaf") return view(tree.id);
  const make = tree.direction === "vertical" ? column : row;
  const r = Math.round(tree.ratio * 1000) / 1000;
  return make(
    {},
    size({ weight: r }, bspToLayout(tree.first)),
    size({ weight: Math.round((1 - r) * 1000) / 1000 }, bspToLayout(tree.second)),
  );
};

/** Build a BSP tree by inserting ids in order. */
export const bspFrom = (ids, options = {}) => ids.reduce((tree, id) => bspInsert(tree, { ...options, id }), null);
