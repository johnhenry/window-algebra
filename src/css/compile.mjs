/**
 * Pure compiler from a layout-algebra tree to a *render tree*: a plain
 * description of elements, attributes and CSS declarations. CSS (flex, grid,
 * anchor positioning, container queries) is the constraint solver; this
 * module only translates relationships into declarations.
 *
 * Render node:
 *   { tag, key, attrs: {}, style: { "kebab-case": value }, children: [], view?, text? }
 *
 * No DOM access happens here, so it runs (and is tested) in Node.
 */
import { views } from "../algebra/transforms.mjs";
import { CONTAINER_KINDS } from "../algebra/nodes.mjs";

/** Numbers become px; strings pass through. */
export const px = (value) => (typeof value === "number" ? `${value}px` : value);

/** A CSS dashed-ident for anchoring against a view id. */
export const anchorName = (id) => `--wm-${String(id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;

const intrinsic = (value) =>
  value === "content" ? "max-content" : value === "min-content" || value === "max-content" || value === "fit-content" ? value : px(value);

/** Translate a grid track option into grid-template syntax. */
export const tracks = (value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return `repeat(${value}, minmax(0, 1fr))`;
  if (Array.isArray(value)) return value.map((v) => (typeof v === "number" ? `${v}fr` : v)).join(" ");
  if (typeof value === "object") {
    const { repeat = "auto-fit", min = 300, max = "1fr" } = value;
    return `repeat(${repeat}, minmax(${px(min)}, ${px(max)}))`;
  }
  return value;
};

const areas = (value) => {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.map((line) => `"${line}"`).join(" ");
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
};

const spacing = (value) => {
  if (typeof value === "number") return px(value);
  if (value.all !== undefined) return px(value.all);
  const { top, right, bottom, left, x, y } = value;
  return [top ?? y ?? 0, right ?? x ?? 0, bottom ?? y ?? 0, left ?? x ?? 0].map(px).join(" ");
};

const alignValue = (value) => ({ start: "start", center: "center", end: "end", stretch: "stretch" })[value] ?? value;

const containerStyle = (node) => {
  const o = node.options;
  const base = { "box-sizing": "border-box", "min-width": "0", "min-height": "0" };
  switch (node.type) {
    case "row":
    case "column":
      return {
        ...base,
        display: "flex",
        "flex-direction": node.type,
        ...(o.align ? { "align-items": alignValue(o.align) } : {}),
        ...(o.distribute ? { "justify-content": o.distribute } : {}),
        ...(o.wrap ? { "flex-wrap": "wrap" } : {}),
      };
    case "grid":
      return {
        ...base,
        display: "grid",
        ...(o.columns !== undefined ? { "grid-template-columns": tracks(o.columns) } : {}),
        ...(o.rows !== undefined ? { "grid-template-rows": tracks(o.rows) } : {}),
        ...(o.areas ? { "grid-template-areas": areas(o.areas) } : {}),
        ...(o.autoFlow ? { "grid-auto-flow": o.autoFlow } : {}),
        ...(o.autoRows ? { "grid-auto-rows": tracks(o.autoRows) } : {}),
      };
    case "stack":
      return {
        ...base,
        display: "grid",
        "grid-template-columns": "minmax(0, 1fr)",
        "grid-template-rows": o.chrome === "tabs" ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
      };
    case "overlay":
      return {
        ...base,
        display: "grid",
        "grid-template-columns": "minmax(0, 1fr)",
        "grid-template-rows": "minmax(0, 1fr)",
        position: "relative",
        overflow: "hidden",
      };
    default:
      return base;
  }
};

/** Styles for gap/inset modifiers applied to an element. */
const spacingStyle = (mods, isContainerElement) => {
  const style = {};
  for (const mod of mods) {
    if (mod.type === "gap" && isContainerElement) {
      const o = mod.options;
      if (o.inner !== undefined || o.outer !== undefined) {
        if (o.inner !== undefined) style.gap = px(o.inner);
        if (o.outer !== undefined) style.padding = px(o.outer);
      } else if (o.all !== undefined) {
        style.gap = px(o.all);
      } else {
        if (o.row !== undefined) style["row-gap"] = px(o.row);
        if (o.column !== undefined) style["column-gap"] = px(o.column);
      }
    }
    if (mod.type === "inset") style.padding = spacing(mod.options);
  }
  return style;
};

/** Sizing constraints relative to the parent's kind. */
const sizeStyle = (options, parentKind) => {
  const style = {};
  const main = parentKind === "row" ? "width" : parentKind === "column" ? "height" : null;
  const flexParent = main !== null;

  if (flexParent) {
    if (options.weight !== undefined) style.flex = `${options.weight} 1 0`;
    if (options[main] !== undefined) {
      style.flex = "0 0 auto";
      style[main] = intrinsic(options[main]);
    }
    if (options.min !== undefined) style[`min-${main}`] = px(options.min);
    if (options.max !== undefined) style[`max-${main}`] = px(options.max);
    if (options.preferred !== undefined) {
      style["flex-basis"] = px(options.preferred);
      if (options.weight === undefined) style.flex = `1 1 ${px(options.preferred)}`;
    }
  }
  for (const dim of ["width", "height"]) {
    if (options[dim] !== undefined && dim !== main) style[dim] = intrinsic(options[dim]);
  }
  for (const [key, prop] of [
    ["minWidth", "min-width"],
    ["maxWidth", "max-width"],
    ["minHeight", "min-height"],
    ["maxHeight", "max-height"],
  ]) {
    if (options[key] !== undefined) style[prop] = px(options[key]);
  }
  if (options.aspectRatio !== undefined) style["aspect-ratio"] = String(options.aspectRatio);
  return style;
};

const selfAlign = (value) => ({ start: "start", center: "center", end: "end", stretch: "stretch" })[value];

/** Placement relative to the parent's kind. */
const placeStyle = (options, parentKind) => {
  const style = {};
  if (parentKind === "grid") {
    if (options.area !== undefined) style["grid-area"] = String(options.area);
    if (options.row !== undefined) style["grid-row"] = String(options.row);
    if (options.column !== undefined) style["grid-column"] = String(options.column);
  }
  if (parentKind === "row" || parentKind === "column") {
    if (options.align !== undefined) style["align-self"] = selfAlign(options.align) ?? options.align;
  }
  const xAlign = selfAlign(options.x);
  const yAlign = selfAlign(options.y);
  if (xAlign) style["justify-self"] = xAlign;
  if (yAlign) style["align-self"] = yAlign;

  const numericX = typeof options.x === "number" || (typeof options.x === "string" && !xAlign);
  const numericY = typeof options.y === "number" || (typeof options.y === "string" && !yAlign);
  const edges = ["top", "right", "bottom", "left"].filter((edge) => options[edge] !== undefined);

  if (numericX || numericY || edges.length) {
    style.position = "absolute";
    if (numericX || numericY) {
      if (!edges.includes("left") && !edges.includes("right")) style.left = "0";
      if (!edges.includes("top") && !edges.includes("bottom")) style.top = "0";
      style.translate = `${px(numericX ? options.x : 0)} ${px(numericY ? options.y : 0)}`;
    }
    for (const edge of edges) style[edge] = px(options[edge]);
  }
  return style;
};

const AREA_BY_SIDE = {
  bottom: { start: "bottom span-right", center: "bottom", end: "bottom span-left" },
  top: { start: "top span-right", center: "top", end: "top span-left" },
  right: { start: "right span-bottom", center: "right", end: "right span-top" },
  left: { start: "left span-bottom", center: "left", end: "left span-top" },
};

/** CSS anchor positioning for an anchored element. */
const anchorStyle = (options) => {
  const { to, side, align = "center", offset, x, y, inside } = options;
  const style = { position: "absolute", "position-anchor": anchorName(to) };
  if (inside || (!side && (x || y))) {
    style["position-area"] = "center";
    const jx = selfAlign(x) ?? (side === "left" ? "start" : side === "right" ? "end" : selfAlign(align) ?? "center");
    const jy = selfAlign(y) ?? (side === "top" ? "start" : side === "bottom" ? "end" : "center");
    style["justify-self"] = jx;
    style["align-self"] = jy;
  } else {
    const s = side ?? "bottom";
    style["position-area"] = AREA_BY_SIDE[s]?.[align] ?? AREA_BY_SIDE.bottom.start;
    style["position-try-fallbacks"] = "flip-block, flip-inline";
    if (offset !== undefined) {
      const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" }[s];
      style[`margin-${opposite}`] = px(offset);
    }
  }
  return style;
};

/** The type of the element a node produces (modifiers do not produce elements). */
const elementType = (node) => {
  while (!CONTAINER_KINDS.includes(node.type) && node.type !== "view") node = node.child;
  return node.type;
};

const isActiveChild = (child, active) => active === undefined || views(child).includes(active);

/**
 * Compile a layout tree into a render tree.
 *
 * @param {object} tree layout-algebra tree
 * @param {object} [context] from `presentationContext(state)`: { focused, blocked, titles, modes, roles }
 * @param {object} [options]
 * @param {string} [options.key] key of the root element
 */
export const compile = (tree, context = {}, { key = "root" } = {}) => {
  const anchored = new Set();
  const collect = (node) => {
    if (node.type === "anchor") anchored.add(node.options.to);
    if (node.type === "view") return;
    (CONTAINER_KINDS.includes(node.type) ? node.children : [node.child]).forEach(collect);
  };
  collect(tree);

  const blocked = new Set(context.blocked ?? []);
  const seen = new Map();

  const visit = (node, parent, index, elementKey) => {
    // Gather modifiers until the next element-producing node (view or container).
    const mods = [];
    let target = node;
    while (!CONTAINER_KINDS.includes(target.type) && target.type !== "view") {
      mods.push(target);
      target = target.child;
    }
    const parentKind = parent?.type;
    const style = {};

    // Position within parent.
    if (parentKind === "stack" || parentKind === "overlay") {
      style["grid-area"] = parentKind === "stack" && parent.options.chrome === "tabs" ? "2 / 1" : "1 / 1";
      style["z-index"] = String(index);
      style.position = "relative";
    } else if (parentKind === "row" || parentKind === "column") {
      style.flex = "1 1 0";
    }

    let positioned = false;
    for (const mod of mods) {
      if (mod.type === "size") Object.assign(style, sizeStyle(mod.options, parentKind));
      if (mod.type === "place") Object.assign(style, placeStyle(mod.options, parentKind));
      if (mod.type === "anchor") {
        Object.assign(style, anchorStyle(mod.options));
        positioned = true;
      }
    }
    const isContainerElement = target.type !== "view";
    Object.assign(style, spacingStyle(mods, isContainerElement));

    const attrs = {};
    const anchorMod = mods.find((mod) => mod.type === "anchor");
    if (anchorMod) {
      attrs["data-wm-anchor"] = anchorMod.options.to;
    }
    if (positioned) attrs["data-wm-positioned"] = "anchor";

    // Stack visibility: inactive children stay mounted but hidden and inert.
    if (parentKind === "stack" && !isActiveChild(node, parent.options.active)) {
      style.visibility = "hidden";
      attrs.inert = "";
      attrs["aria-hidden"] = "true";
    }

    if (target.type === "view") {
      const id = target.id;
      const occurrence = (seen.get(id) ?? 0) + 1;
      seen.set(id, occurrence);
      Object.assign(style, {
        display: "block",
        "box-sizing": "border-box",
        "min-width": "0",
        "min-height": "0",
        overflow: "hidden",
        "container-type": "size",
        "container-name": "wm-view",
        ...style,
      });
      if (anchored.has(id) && occurrence === 1) style["anchor-name"] = anchorName(id);
      Object.assign(attrs, { "data-view": id });
      if (occurrence > 1) attrs["data-view-projection"] = String(occurrence);
      if (context.focused === id) attrs["data-focused"] = "";
      if (blocked.has(id)) attrs.inert = "";
      if (context.modes?.[id]) attrs["data-mode"] = context.modes[id];
      if (context.roles?.[id]) attrs["data-role"] = context.roles[id];
      if (context.titles?.[id]) attrs["aria-label"] = context.titles[id];
      return {
        tag: "wm-view",
        key: occurrence > 1 ? `view:${id}#${occurrence}` : `view:${id}`,
        attrs,
        style,
        children: [],
        view: id,
        primary: occurrence === 1,
      };
    }

    const own = containerStyle(target);
    const element = {
      tag: `wm-${target.type}`,
      key: elementKey,
      attrs: { ...attrs, "data-layout": target.type },
      style: { ...own, ...style },
      children: [],
    };
    // Children with ancestor-dependent styles need the element's own padding/gap preserved.
    if (target.type === "stack" && target.options.chrome === "tabs") {
      element.children.push({
        tag: "wm-tabs",
        key: `${elementKey}/tabs`,
        attrs: { role: "tablist" },
        style: { "grid-area": "1 / 1", display: "flex", "min-width": "0" },
        children: target.children.flatMap((child) =>
          views(child)
            .slice(0, 1)
            .map((id) => ({
              tag: "button",
              key: `${elementKey}/tab:${id}`,
              attrs: {
                type: "button",
                role: "tab",
                "data-wm-tab": id,
                "aria-selected": String(id === target.options.active),
              },
              style: {},
              children: [],
              text: context.titles?.[id] || id,
            })),
        ),
      });
    }
    target.children.forEach((child, childIndex) => {
      element.children.push(visit(child, target, childIndex, `${elementKey}/${childIndex}:${elementType(child)}`));
    });
    return element;
  };

  return visit(tree, null, 0, `${key}:${elementType(tree)}`);
};

/** Serialize a style object to a declaration string. */
export const styleText = (style) =>
  Object.entries(style)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([prop, value]) => `${prop}: ${value}`)
    .join("; ");

const escapeHTML = (value) =>
  String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/**
 * Render a render tree to an HTML string (server rendering, snapshots,
 * debugging). `slot(viewId)` may return inner HTML for a view.
 */
export const toHTML = (renderNode, { slot, indent = "" } = {}) => {
  const attrs = Object.entries(renderNode.attrs)
    .map(([name, value]) => (value === "" ? ` ${name}` : ` ${name}="${escapeHTML(value)}"`))
    .join("");
  const styleAttr = Object.keys(renderNode.style).length ? ` style="${escapeHTML(styleText(renderNode.style))}"` : "";
  const open = `${indent}<${renderNode.tag}${attrs}${styleAttr}>`;
  const close = `</${renderNode.tag}>`;
  if (renderNode.view !== undefined) {
    return `${open}${slot && renderNode.primary ? slot(renderNode.view) ?? "" : ""}${close}`;
  }
  if (renderNode.text !== undefined) return `${open}${escapeHTML(renderNode.text)}${close}`;
  if (!renderNode.children.length) return `${open}${close}`;
  const inner = renderNode.children.map((child) => toHTML(child, { slot, indent: `${indent}  ` })).join("\n");
  return `${open}\n${inner}\n${indent}${close}`;
};

/** Base stylesheet: host sizing plus a transition hook. Optional. */
export const BASE_CSS = `
wm-overlay, wm-row, wm-column, wm-grid, wm-stack { box-sizing: border-box; }
wm-root, [data-wm-root] { display: block; position: relative; overflow: hidden; }
[data-wm-root] > wm-overlay { width: 100%; height: 100%; }
wm-view[inert] { filter: saturate(0.6); }
wm-tabs > button[aria-selected="true"] { font-weight: 600; }
`.trim();
