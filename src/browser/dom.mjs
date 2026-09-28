/**
 * The effectful edge: reconcile a render tree into real DOM.
 *
 * - Elements are keyed. View elements are keyed by view id, so a window keeps
 *   its element (and mounted surface) when the layout changes around it.
 * - Styles are diffed per property; attributes are diffed per name.
 * - Realized geometry is read back with `measure()`.
 *
 * Only this file (and input.mjs) touches `document`.
 */
import { styleText } from "../css/compile.mjs";

const supportsAnchors = (win) => {
  try {
    return Boolean(win?.CSS?.supports?.("anchor-name: --wm-test"));
  } catch {
    return false;
  }
};

/**
 * @param {object} options
 * @param {Element} options.root host element; the render tree is mounted inside it
 * @param {(id: string) => ({ mount(target: Element): void, unmount?(): void } | undefined)} [options.surfaceFor]
 * @param {Document} [options.document]
 * @param {boolean} [options.anchorFallback] position anchored elements with JS when CSS anchors are unsupported
 */
export const createDomRenderer = ({ root, surfaceFor = () => undefined, document: doc = root.ownerDocument, anchorFallback } = {}) => {
  const elements = new Map(); // key → Element
  const records = new Map(); // key → { attrs, style }
  const mounted = new Map(); // view id → surface
  const owned = new WeakSet(); // every element this renderer created
  const useFallback = anchorFallback ?? !supportsAnchors(doc.defaultView);
  root.setAttribute("data-wm-root", "");

  const create = (node) => {
    const element = doc.createElement(node.tag);
    owned.add(element);
    elements.set(node.key, element);
    records.set(node.key, { attrs: {}, style: {} });
    return element;
  };

  const patch = (element, node) => {
    const record = records.get(node.key);
    for (const name of Object.keys(record.attrs)) {
      if (!(name in node.attrs)) element.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(node.attrs)) {
      if (record.attrs[name] !== value) element.setAttribute(name, value);
    }
    for (const prop of Object.keys(record.style)) {
      if (!(prop in node.style)) element.style.removeProperty(prop);
    }
    for (const [prop, value] of Object.entries(node.style)) {
      if (record.style[prop] !== value) element.style.setProperty(prop, value);
    }
    if (node.text !== undefined && element.textContent !== node.text) element.textContent = node.text;
    records.set(node.key, { attrs: { ...node.attrs }, style: { ...node.style } });
  };

  const reconcileChildren = (parent, children, live) => {
    // Reconcile subtrees first (this may move elements between parents),
    // then put this parent's children in order.
    const ordered = children.map((child) => reconcile(child, live));
    let cursor = parent.firstChild;
    for (const element of ordered) {
      if (element !== cursor) parent.insertBefore(element, cursor);
      else cursor = cursor.nextSibling;
    }
    // Remove leftovers we created; foreign nodes (e.g. surface content) are left alone.
    while (cursor) {
      const next = cursor.nextSibling;
      if (owned.has(cursor)) parent.removeChild(cursor);
      cursor = next;
    }
  };

  const reconcile = (node, live) => {
    live.add(node.key);
    let element = elements.get(node.key);
    if (element && element.localName !== node.tag) {
      // Same key, different element type: retire the old one; the parent's
      // leftover sweep removes it from the DOM.
      element = undefined;
    }
    element ??= create(node);
    patch(element, node);
    if (node.view !== undefined) {
      if (node.primary && !mounted.has(node.view)) {
        const surface = surfaceFor(node.view);
        if (surface) {
          surface.mount(element);
          mounted.set(node.view, surface);
        }
      }
      return element;
    }
    if (node.text === undefined) reconcileChildren(element, node.children, live);
    return element;
  };

  const positionAnchoredFallback = () => {
    const rootRect = root.getBoundingClientRect();
    for (const element of root.querySelectorAll("[data-wm-anchor]")) {
      const target = root.querySelector(`wm-view[data-view="${CSS.escape(element.getAttribute("data-wm-anchor"))}"]`);
      if (!target) continue;
      const t = target.getBoundingClientRect();
      const e = element.getBoundingClientRect();
      const area = element.style.getPropertyValue("position-area");
      let left = t.left + (t.width - e.width) / 2;
      let top = t.top + (t.height - e.height) / 2;
      if (area.startsWith("bottom")) top = t.bottom;
      if (area.startsWith("top")) top = t.top - e.height;
      if (area.startsWith("right")) left = t.right;
      if (area.startsWith("left")) left = t.left - e.width;
      if (area.includes("span-right")) left = t.left;
      if (area.includes("span-left")) left = t.right - e.width;
      element.style.setProperty("left", `${left - rootRect.left}px`);
      element.style.setProperty("top", `${top - rootRect.top}px`);
    }
  };

  return {
    /** Apply a render tree. Unmounts surfaces whose views disappeared. */
    commit(renderTree) {
      const live = new Set();
      reconcileChildren(root, [renderTree], live);
      for (const key of [...elements.keys()]) {
        if (live.has(key)) continue;
        elements.get(key).remove();
        elements.delete(key);
        records.delete(key);
      }
      for (const [id, surface] of [...mounted]) {
        if (!live.has(`view:${id}`)) {
          surface.unmount?.();
          mounted.delete(id);
        }
      }
      if (useFallback) positionAnchoredFallback();
    },

    /** Realized geometry of every primary view, relative to the root. */
    measure() {
      const origin = root.getBoundingClientRect();
      const out = {};
      for (const [key, element] of elements) {
        if (!key.startsWith("view:") || key.includes("#")) continue;
        const r = element.getBoundingClientRect();
        out[key.slice(5)] = { x: r.left - origin.left, y: r.top - origin.top, width: r.width, height: r.height };
      }
      return out;
    },

    /** The element for a view id, if rendered. */
    elementFor(id) {
      return elements.get(`view:${id}`);
    },

    destroy() {
      for (const surface of mounted.values()) surface.unmount?.();
      mounted.clear();
      for (const element of elements.values()) element.remove();
      elements.clear();
      records.clear();
      root.removeAttribute("data-wm-root");
    },

    /** Debug helper: current inline style text of a keyed element. */
    styleOf(key) {
      const record = records.get(key);
      return record ? styleText(record.style) : undefined;
    },
  };
};
