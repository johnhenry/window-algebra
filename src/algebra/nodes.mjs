/**
 * The layout algebra: eleven primitives that build an immutable,
 * JSON-serializable presentation tree.
 *
 * Grammar rule: every container and modifier takes an options object
 * first, then its child or children. `view(id)` is the leaf constructor and
 * the only exception.
 *
 *   LEAF        view
 *   CONTAINERS  row, column, grid, stack, overlay
 *   MODIFIERS   place, size, gap, inset, anchor
 *
 * Internally every container is `container(kind, options, children)` and
 * every modifier is `modifier(kind, options, child)`. The named constructors
 * are a thin, friendlier layer over those two.
 */

export const CONTAINER_KINDS = Object.freeze(["row", "column", "grid", "stack", "overlay"]);
export const MODIFIER_KINDS = Object.freeze(["place", "size", "gap", "inset", "anchor"]);
export const NODE_KINDS = Object.freeze(["view", ...CONTAINER_KINDS, ...MODIFIER_KINDS]);

const isPlainObject = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

/** True when `value` looks like a node produced by this algebra. */
export const isNode = (value) =>
  isPlainObject(value) && typeof value.type === "string" && NODE_KINDS.includes(value.type);

export const isContainer = (node) => isNode(node) && CONTAINER_KINDS.includes(node.type);
export const isModifier = (node) => isNode(node) && MODIFIER_KINDS.includes(node.type);
export const isView = (node) => isNode(node) && node.type === "view";

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

const assertOptions = (kind, options) => {
  if (isNode(options)) {
    throw new TypeError(
      `${kind}(): options must come first. Received a "${options.type}" node where options were expected; pass {} if there are no options.`,
    );
  }
  if (!isPlainObject(options)) {
    throw new TypeError(`${kind}(): options must be a plain object, received ${typeof options}.`);
  }
};

const assertChild = (kind, child) => {
  if (!isNode(child)) {
    throw new TypeError(`${kind}(): expected a layout node as child, received ${JSON.stringify(child)}.`);
  }
};

/** Leaf: a presentation of a window/surface. */
export const view = (id) => {
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError("view(): id must be a non-empty string.");
  }
  return deepFreeze({ type: "view", id });
};

/** Generic container constructor. `children` may contain nested arrays; falsy entries are dropped. */
export const container = (kind, options, children) => {
  if (!CONTAINER_KINDS.includes(kind)) throw new TypeError(`Unknown container kind "${kind}".`);
  assertOptions(kind, options);
  const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false);
  flat.forEach((child) => assertChild(kind, child));
  return deepFreeze({ type: kind, options: { ...options }, children: flat });
};

/** Generic modifier constructor. Numbers are accepted as shorthand for `{ all: n }` on gap/inset. */
export const modifier = (kind, options, child) => {
  if (!MODIFIER_KINDS.includes(kind)) throw new TypeError(`Unknown modifier kind "${kind}".`);
  if ((kind === "gap" || kind === "inset") && typeof options === "number") options = { all: options };
  assertOptions(kind, options);
  assertChild(kind, child);
  if (kind === "anchor" && typeof options.to !== "string") {
    throw new TypeError('anchor(): options.to must name the view to anchor against.');
  }
  return deepFreeze({ type: kind, options: { ...options }, child });
};

// Containers ---------------------------------------------------------------

/** Horizontal composition. Options: { align, distribute }. */
export const row = (options, ...children) => container("row", options, children);
/** Vertical composition. Options: { align, distribute }. */
export const column = (options, ...children) => container("column", options, children);
/** Two-dimensional constraint space. Options: { columns, rows, areas, autoFlow }. */
export const grid = (options, ...children) => container("grid", options, children);
/** Children share one allocation. Options: { active, chrome }. */
export const stack = (options, ...children) => container("stack", options, children);
/** Children occupy independent layers of the same region (later = higher). */
export const overlay = (options, ...children) => container("overlay", options, children);

// Modifiers ----------------------------------------------------------------

/** Position within the parent's allocation; interpreted by the parent kind. */
export const place = (options, child) => modifier("place", options, child);
/** Allocation constraint: { weight, width, height, min, max, preferred, aspectRatio, ... }. */
export const size = (options, child) => modifier("size", options, child);
/** Separation between siblings of the wrapped container. */
export const gap = (options, child) => modifier("gap", options, child);
/** Padding around the wrapped allocation. */
export const inset = (options, child) => modifier("inset", options, child);
/** Position relative to another view: { to, side, align, x, y, offset }. */
export const anchor = (options, child) => modifier("anchor", options, child);

/**
 * Validate an arbitrary value (for example, parsed JSON) as a layout tree.
 * Returns `{ ok: true }` or `{ ok: false, errors: [{ path, message }] }`.
 */
export const validate = (tree) => {
  const errors = [];
  const visit = (node, path) => {
    if (!isNode(node)) {
      errors.push({ path, message: `not a layout node: ${JSON.stringify(node)}` });
      return;
    }
    if (node.type === "view") {
      if (typeof node.id !== "string" || !node.id) errors.push({ path, message: "view is missing an id" });
      return;
    }
    if (!isPlainObject(node.options)) errors.push({ path, message: `${node.type} is missing options` });
    if (CONTAINER_KINDS.includes(node.type)) {
      if (!Array.isArray(node.children)) {
        errors.push({ path, message: `${node.type} is missing children` });
        return;
      }
      node.children.forEach((child, index) => visit(child, `${path}.children[${index}]`));
    } else {
      if (node.type === "anchor" && typeof node.options?.to !== "string") {
        errors.push({ path, message: "anchor is missing options.to" });
      }
      visit(node.child, `${path}.child`);
    }
  };
  visit(tree, "$");
  return errors.length ? { ok: false, errors } : { ok: true };
};

/** Rebuild (and freeze) a tree from plain JSON, validating it on the way. */
export const fromJSON = (json) => {
  const value = typeof json === "string" ? JSON.parse(json) : json;
  const result = validate(value);
  if (!result.ok) {
    throw new TypeError(`Invalid layout tree: ${result.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  }
  return deepFreeze(structuredClone(value));
};
