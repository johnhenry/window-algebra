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

/**
 * Insert `id` next to the leaf `target` on a given side: "left"/"right" split
 * horizontally, "top"/"bottom" vertically, and `id` lands on that side. Without
 * a side this is `bspInsert`. A tree lacking `target` is returned unchanged.
 */
export const bspPlace = (tree, { id, target, side, ratio = 0.5 }) => {
  if (!side) return bspInsert(tree, { id, target, ratio });
  if (!tree || !bspIds(tree).includes(target) || bspIds(tree).includes(id)) return tree;
  const direction = side === "left" || side === "right" ? "horizontal" : "vertical";
  const first = side === "left" || side === "top";
  const visit = (node) => {
    if (node.type === "leaf") {
      if (node.id !== target) return node;
      return first ? bspSplit(direction, ratio, bspLeaf(id), node) : bspSplit(direction, ratio, node, bspLeaf(id));
    }
    return { ...node, first: visit(node.first), second: visit(node.second) };
  };
  return visit(tree);
};

/** Exchange two leaves' positions. */
export const bspSwap = (tree, a, b) => {
  if (!tree) return tree;
  if (tree.type === "leaf") return tree.id === a ? { ...tree, id: b } : tree.id === b ? { ...tree, id: a } : tree;
  return { ...tree, first: bspSwap(tree.first, a, b), second: bspSwap(tree.second, a, b) };
};

/** The direction of the split directly containing `id` (null for a lone leaf or a missing id). */
export const bspParentDirection = (tree, id) => {
  if (!tree || tree.type === "leaf") return null;
  if ([tree.first, tree.second].some((child) => child.type === "leaf" && child.id === id)) return tree.direction;
  return bspParentDirection(tree.first, id) ?? bspParentDirection(tree.second, id);
};

/** Make a stored tree agree with the windows present: drop missing leaves, append new ones. */
export const bspReconcile = (tree, ids) => {
  let next = tree ?? null;
  // Sets, not `includes` over a freshly built id list per id: reconciling a 500-window tree was cubic.
  const wanted = new Set(ids);
  for (const id of bspIds(next)) if (!wanted.has(id)) next = bspRemove(next, id);
  const present = new Set(bspIds(next));
  for (const id of ids) {
    if (present.has(id)) continue;
    next = bspInsert(next, { id });
    present.add(id);
  }
  return next;
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

const isSplit = (node) => Boolean(node) && node.type === "split";

/**
 * The split node reached by walking `path` from the root, one step per
 * character: "0" into `first`, "1" into `second`. `""` is the root split.
 * General addressing for `layout/resize-split`, independent of where the
 * leaves happen to fall (unlike `bspSetRatio`, which needs a leaf directly
 * on one side). Returns `null` for a path that runs into a leaf or off the
 * tree.
 */
export const bspNodeAt = (tree, path) => {
  let node = tree;
  for (const step of path) {
    if (!isSplit(node)) return null;
    node = step === "0" ? node.first : node.second;
  }
  return isSplit(node) ? node : null;
};

const hasLive = (node, live) => (node.type === "leaf" ? live.has(node.id) : hasLive(node.first, live) || hasLive(node.second, live));

/**
 * The stored path of a *rendered* split. A stored tree can hold leaves that are
 * not on screen (a minimized window keeps its slot); `derive` renders the tree
 * reconciled with the shown windows, where a split with one side wholly dormant
 * collapses into the other side, so a splitter's `path` is a path in that
 * rendered tree. `live` is the Set of shown ids. Returns the stored path of the
 * same split, or `null` when `path` addresses no rendered split. With every
 * leaf shown it is the identity.
 */
export const bspResolveShown = (tree, live, path) => {
  let node = tree ?? null;
  let stored = "";
  const collapse = () => {
    while (isSplit(node)) {
      const first = hasLive(node.first, live);
      const second = hasLive(node.second, live);
      if (first && second) return;
      if (!first && !second) {
        node = null;
        return;
      }
      stored += first ? "0" : "1";
      node = first ? node.first : node.second;
    }
  };
  collapse();
  for (const step of path) {
    if (!isSplit(node)) return null;
    stored += step === "0" ? "0" : "1";
    node = step === "0" ? node.first : node.second;
    collapse();
  }
  return isSplit(node) ? stored : null;
};

/** Set the ratio of the split at `path` (see `bspNodeAt`); other splits are untouched. */
export const bspSetRatioAt = (tree, path, ratio) => {
  const clamped = Math.min(0.95, Math.max(0.05, ratio));
  const visit = (node, remaining) => {
    if (!isSplit(node)) return node;
    if (remaining === "") return { ...node, ratio: clamped };
    const [step, ...rest] = remaining;
    return step === "0" ? { ...node, first: visit(node.first, rest.join("")) } : { ...node, second: visit(node.second, rest.join("")) };
  };
  return visit(tree, path);
};

/**
 * Interpret a BSP tree as a layout-algebra tree. Every split becomes a
 * row/column carrying `resize: { path, weights }` (see docs/PRD.md, "Split
 * sizing"), `path` built the same way `bspNodeAt`/`bspSetRatioAt` read it, so
 * a splitter rendered at that node addresses it directly.
 */
export const bspToLayout = (tree, path = "") => {
  if (!tree) return row({});
  if (tree.type === "leaf") return view(tree.id);
  const make = tree.direction === "vertical" ? column : row;
  const r = Math.round(tree.ratio * 1000) / 1000;
  const other = Math.round((1 - r) * 1000) / 1000;
  return make(
    { resize: { path, weights: [r, other] } },
    size({ weight: r }, bspToLayout(tree.first, `${path}0`)),
    size({ weight: other }, bspToLayout(tree.second, `${path}1`)),
  );
};

/** Build a BSP tree by inserting ids in order. */
export const bspFrom = (ids, options = {}) => ids.reduce((tree, id) => bspInsert(tree, { ...options, id }), null);
