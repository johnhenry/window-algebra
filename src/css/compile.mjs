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

const OPPOSITE_SIDE = { top: "bottom", bottom: "top", left: "right", right: "left" };

/** True for the "inside the anchor" placement mode (as opposed to attached to one of its sides). */
const isInsideAnchor = (options) => Boolean(options.inside || (!options.side && (options.x || options.y)));

/**
 * CSS anchor positioning for an anchored element — the "positioner rules"
 * (`flip`/`slide`/`resize`/`gravity`) mapped as far as `position-try-fallbacks`
 * and `position-area` can express them.
 *
 * - `flip` (default both axes): becomes `flip-block`/`flip-inline` fallbacks.
 *   `y` is the block axis for a `top`/`bottom` anchor's side, `x` for
 *   `left`/`right` (matching a horizontal writing mode, which is all this
 *   compiler targets).
 * - `gravity`: only representable when it names the side opposite `side` —
 *   CSS's `position-area` keywords bake the anchor edge and growth direction
 *   together (e.g. "bottom" always means "below the anchor, growing down"),
 *   so a same-side gravity (attach at the bottom edge but grow upward, back
 *   over the anchor) has no CSS keyword and is ignored here.
 * - `slide` and `resize`: CSS anchor positioning has no built-in for either —
 *   `position-try-fallbacks` only swaps between discrete alternatives, it
 *   can't clamp a position continuously into the viewport or shrink a box to
 *   fit. Both are JS-anchor-fallback-only (`src/browser/dom.mjs`); a page
 *   relying on them should render with `anchorFallback: true`.
 */
const anchorStyle = (options) => {
  const { to, side, align = "center", offset, x, y, inside, gravity, flip } = options;
  const style = { position: "absolute", "position-anchor": anchorName(to) };
  if (isInsideAnchor(options)) {
    style["position-area"] = "center";
    const jx = selfAlign(x) ?? (side === "left" ? "start" : side === "right" ? "end" : selfAlign(align) ?? "center");
    const jy = selfAlign(y) ?? (side === "top" ? "start" : side === "bottom" ? "end" : "center");
    style["justify-self"] = jx;
    style["align-self"] = jy;
  } else {
    const s = side ?? "bottom";
    const g = gravity === OPPOSITE_SIDE[s] ? gravity : s;
    style["position-area"] = AREA_BY_SIDE[g]?.[align] ?? AREA_BY_SIDE.bottom.start;
    const flipAxes = new Set(flip ?? ["x", "y"]);
    const fallbacks = [];
    if (flipAxes.has("y")) fallbacks.push("flip-block");
    if (flipAxes.has("x")) fallbacks.push("flip-inline");
    if (fallbacks.length) style["position-try-fallbacks"] = fallbacks.join(", ");
    if (offset !== undefined) {
      style[`margin-${OPPOSITE_SIDE[s]}`] = px(offset);
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

/** Default cross-axis thickness (px) of a rendered splitter handle. Override with CSS on `[data-wm-splitter]`. */
export const SPLITTER_SIZE = 6;

/**
 * A splitter render node between `target.children[index]` and `[index + 1]`,
 * or `null` when `target` is not a resizable row/column, `index` is not
 * followed by another child, or the weights don't line up with the children
 * (a mismatched custom interpreter — render without a splitter rather than
 * risk addressing the wrong pair).
 *
 * `data-wm-path`/`data-wm-index` are exactly what `layout/resize-split`
 * expects back; `data-wm-count` is the container's live child count, so the
 * input adapter can rebuild a full `weights` array before its first resize.
 */
const splitterAfter = (target, index, elementKey) => {
  if (target.type !== "row" && target.type !== "column") return null;
  const resize = target.options.resize;
  if (!resize || !Array.isArray(resize.weights)) return null;
  const { weights, path } = resize;
  if (weights.length !== target.children.length || index >= weights.length - 1) return null;
  const [a, b] = [weights[index], weights[index + 1]];
  const total = a + b;
  const now = total > 0 ? Math.round((a / total) * 100) : 50;
  return {
    tag: "wm-splitter",
    key: `${elementKey}/splitter:${index}`,
    attrs: {
      "data-wm-splitter": "",
      "data-wm-path": path,
      "data-wm-index": String(index),
      "data-wm-count": String(weights.length),
      role: "separator",
      "aria-orientation": target.type === "row" ? "vertical" : "horizontal",
      "aria-valuenow": String(now),
      "aria-valuemin": "0",
      "aria-valuemax": "100",
      tabindex: "0",
    },
    style: {
      flex: `0 0 ${SPLITTER_SIZE}px`,
      "align-self": "stretch",
      cursor: target.type === "row" ? "col-resize" : "row-resize",
      "touch-action": "none",
      "box-sizing": "border-box",
    },
    children: [],
  };
};

/**
 * Compile a layout tree into a render tree.
 *
 * @param {object} tree layout-algebra tree
 * @param {object} [context] from `presentationContext(state)`: { focused, blocked, titles, modes, roles, urgent }
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
  const urgent = new Set(context.urgent ?? []);
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
      // The JS anchor fallback (src/browser/dom.mjs) re-derives full
      // positioner semantics — including `slide`/`resize`, which CSS cannot
      // express — from these, rather than from the CSS declarations above.
      if (!isInsideAnchor(anchorMod.options)) {
        const { side, align, offset, gravity, flip, slide, resize } = anchorMod.options;
        attrs["data-wm-anchor-opts"] = JSON.stringify({ side, align, offset, gravity, flip, slide, resize });
      }
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
      // Size containment ignores content, so an axis sized by its content
      // ("content", "fit-content", …) must not be contained: fall back to
      // inline-size containment (height from content) or none (width from content).
      const fromContent = (value) => value === "max-content" || value === "min-content" || value === "fit-content";
      if (fromContent(style.width)) style["container-type"] = "normal";
      else if (fromContent(style.height)) style["container-type"] = "inline-size";
      if (anchored.has(id) && occurrence === 1) style["anchor-name"] = anchorName(id);
      Object.assign(attrs, { "data-view": id });
      if (occurrence > 1) attrs["data-view-projection"] = String(occurrence);
      if (context.focused === id) attrs["data-focused"] = "";
      // Blocked by a modal: the renderer makes the contents inert but keeps the
      // view itself hit-testable, so a click on it is not passed through to
      // whatever lies underneath (inert elements are skipped by hit-testing).
      if (blocked.has(id)) Object.assign(attrs, { "data-wm-blocked": "", "aria-disabled": "true" });
      if (urgent.has(id)) attrs["data-wm-urgent"] = "";
      if (context.modes?.[id]) attrs["data-mode"] = context.modes[id];
      if (context.roles?.[id]) attrs["data-role"] = context.roles[id];
      if (context.titles?.[id]) attrs["aria-label"] = context.titles[id];
      if (context.pinned?.includes(id)) attrs["data-wm-draggable"] = "false";
      if (context.sticky?.includes(id)) attrs["data-wm-sticky"] = "";
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
                ...(urgent.has(id) ? { "data-wm-urgent": "" } : {}),
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
      const splitter = splitterAfter(target, childIndex, elementKey);
      if (splitter) element.children.push(splitter);
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
wm-view[inert], wm-view[data-wm-blocked] { filter: saturate(0.6); }
wm-tabs > button[aria-selected="true"] { font-weight: 600; }
wm-view[data-wm-urgent], wm-tabs > button[data-wm-urgent] { outline: 2px solid var(--wm-urgent-line, rgb(234 88 12)); outline-offset: -2px; }
[data-wm-dragging], [data-wm-dragging] * { cursor: grabbing !important; user-select: none; }
[data-wm-ghost-label]::after { content: attr(data-wm-ghost-label); position: absolute; left: 50%; top: 50%; translate: -50% -50%; max-width: calc(100% - 16px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 2px 10px; border-radius: 999px; font: 600 12px/1.4 system-ui, sans-serif; color: var(--wm-ghost-label-fg, #fff); background: var(--wm-ghost-line, rgb(59 130 246)); }
wm-view[data-wm-draggable="false"] [data-wm-handle="move"], [data-wm-drag-denied] { cursor: not-allowed; }
wm-view[data-wm-drag-denied] { outline: 2px solid var(--wm-ghost-bad, rgb(220 38 38 / 0.9)); outline-offset: -2px; }
[data-wm-workspace-target][data-wm-drop-active] { outline: 2px solid var(--wm-zone-line, rgb(59 130 246)); outline-offset: 1px; }
[data-wm-handle] { touch-action: none; }
wm-tabs { touch-action: pan-x; }
[data-wm-splitter] { background: var(--wm-splitter-fill, transparent); position: relative; z-index: 1; }
[data-wm-splitter]::after { content: ""; position: absolute; inset: 0; margin: auto; }
[data-wm-splitter][aria-orientation="vertical"]::after { width: 1px; height: 100%; background: var(--wm-splitter-line, rgb(0 0 0 / 0.08)); }
[data-wm-splitter][aria-orientation="horizontal"]::after { height: 1px; width: 100%; background: var(--wm-splitter-line, rgb(0 0 0 / 0.08)); }
[data-wm-splitter]:hover, [data-wm-splitter]:focus-visible, [data-wm-splitter][data-wm-active] { background: var(--wm-splitter-fill-active, rgb(59 130 246 / 0.35)); }
[data-wm-splitter]:focus-visible { outline: none; }
`.trim();
