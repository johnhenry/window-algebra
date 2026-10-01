// @ts-self-types="./transforms.d.mts"
/**
 * Tree transformations. Each takes a layout tree and returns a new valid
 * layout tree (or a value derived from one). None of these are primitives;
 * they are ordinary functions over the data the primitives produce.
 */
import { container, modifier, view, isNode, CONTAINER_KINDS } from "./nodes.mjs";

const rebuild = (node, children) =>
  CONTAINER_KINDS.includes(node.type)
    ? container(node.type, node.options, children)
    : modifier(node.type, node.options, children[0]);

const childrenOf = (node) =>
  node.type === "view" ? [] : CONTAINER_KINDS.includes(node.type) ? node.children : [node.child];

/**
 * Bottom-up structural map. `fn(node, path)` receives each node after its
 * children were mapped and returns a replacement node (or the node itself).
 * Returning `null` removes the node from its parent container.
 */
export const transform = (tree, fn, path = "$") => {
  if (!isNode(tree)) throw new TypeError("transform(): expected a layout node.");
  if (tree.type === "view") return fn(tree, path);
  const mapped = childrenOf(tree)
    .map((child, index) =>
      transform(child, fn, CONTAINER_KINDS.includes(tree.type) ? `${path}.children[${index}]` : `${path}.child`),
    );
  // A modifier whose only child was removed disappears with it.
  if (!CONTAINER_KINDS.includes(tree.type) && mapped[0] === null) return null;
  const next = rebuild(tree, mapped.filter((child) => child !== null));
  return fn(next, path);
};

/** Depth-first pre-order traversal. `fn(node, path, parent)`. */
export const walk = (tree, fn, path = "$", parent = null) => {
  fn(tree, path, parent);
  if (tree.type === "view") return;
  if (CONTAINER_KINDS.includes(tree.type)) {
    tree.children.forEach((child, index) => walk(child, fn, `${path}.children[${index}]`, tree));
  } else {
    walk(tree.child, fn, `${path}.child`, tree);
  }
};

/** Reduce over every node in pre-order. */
export const fold = (tree, fn, initial) => {
  let acc = initial;
  walk(tree, (node, path, parent) => {
    acc = fn(acc, node, path, parent);
  });
  return acc;
};

/** Ids of every view in document order (duplicates preserved). */
export const views = (tree) => fold(tree, (ids, node) => (node.type === "view" ? [...ids, node.id] : ids), []);

/** First node matching `predicate` (or the view with that id), else undefined. */
export const find = (tree, predicate) => {
  const test = typeof predicate === "string" ? (node) => node.type === "view" && node.id === predicate : predicate;
  let found;
  walk(tree, (node) => {
    if (found === undefined && test(node)) found = node;
  });
  return found;
};

/** Map every view through `fn(view) → node`. */
export const mapViews = (tree, fn) => transform(tree, (node) => (node.type === "view" ? fn(node) : node));

/** Replace nodes matching `predicate` (or the view with that id) with `replacement` (node or fn). */
export const replace = (tree, predicate, replacement) => {
  const test = typeof predicate === "string" ? (node) => node.type === "view" && node.id === predicate : predicate;
  return transform(tree, (node) => {
    if (test(node)) return typeof replacement === "function" ? replacement(node) : replacement;
    return node;
  });
};

/**
 * Remove every occurrence of a view. Modifiers wrapping a removed view are
 * removed with it; containers left empty are kept (they are still valid).
 */
export const remove = (tree, id) => transform(tree, (node) => (node.type === "view" && node.id === id ? null : node));

/** Mirror horizontally: reverse the children of every row (and grid column order). */
export const mirror = (tree) =>
  transform(tree, (node) => {
    if (node.type === "row") return container("row", node.options, [...node.children].reverse());
    return node;
  });

/** Flip vertically: reverse the children of every column. */
export const flip = (tree) =>
  transform(tree, (node) => {
    if (node.type === "column") return container("column", node.options, [...node.children].reverse());
    return node;
  });

/** Rotate a quarter turn: rows become columns and columns become rows. */
export const rotate = (tree) =>
  transform(tree, (node) => {
    if (node.type === "row") return container("column", node.options, node.children);
    if (node.type === "column") return container("row", node.options, node.children);
    return node;
  });

/** Reverse the children of every container. */
export const reverse = (tree) =>
  transform(tree, (node) =>
    CONTAINER_KINDS.includes(node.type) ? container(node.type, node.options, [...node.children].reverse()) : node,
  );

/** Swap two views wherever they appear. */
export const swap = (tree, a, b) =>
  transform(tree, (node) => {
    if (node.type !== "view") return node;
    if (node.id === a) return view(b);
    if (node.id === b) return view(a);
    return node;
  });

/** Count of nodes in the tree. */
export const count = (tree) => fold(tree, (n) => n + 1, 0);

/** Structural equality of two trees. */
export const equals = (a, b) => JSON.stringify(a) === JSON.stringify(b);
