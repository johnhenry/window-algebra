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
  const retired = new Set(); // elements replaced by a same-key element of another tag
  const anchorSpecs = new Map(); // key → { to, area, justify, align } (JS anchor fallback only)
  let fallbackPositioned = new Set();
  const useFallback = anchorFallback ?? !supportsAnchors(doc.defaultView);
  root.setAttribute("data-wm-root", "");

  const create = (node) => {
    const element = doc.createElement(node.tag);
    elements.set(node.key, element);
    records.set(node.key, { attrs: {}, style: {} });
    return element;
  };

  /** Declarations the JS fallback replaces; left in place they would fight its coordinates. */
  const ANCHOR_PROPS = ["position-anchor", "position-area", "position-try-fallbacks", "justify-self", "align-self", "anchor-name"];

  const effectiveStyle = (node) => {
    if (!useFallback) return node.style;
    const to = node.attrs["data-wm-anchor"];
    if (to === undefined) {
      anchorSpecs.delete(node.key);
      if (!("anchor-name" in node.style)) return node.style;
    } else {
      anchorSpecs.set(node.key, {
        to,
        area: node.style["position-area"],
        justify: node.style["justify-self"],
        align: node.style["align-self"],
        // margin-right / margin-bottom do not move an element placed by left/top.
        gapBefore: parseFloat(node.style["margin-right"]) || 0,
        gapAbove: parseFloat(node.style["margin-bottom"]) || 0,
      });
    }
    const style = { ...node.style };
    for (const prop of ANCHOR_PROPS) if (to !== undefined || prop === "anchor-name") delete style[prop];
    return style;
  };

  const patch = (element, node) => {
    const record = records.get(node.key);
    const style = effectiveStyle(node);
    for (const name of Object.keys(record.attrs)) {
      if (!(name in node.attrs)) element.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(node.attrs)) {
      if (record.attrs[name] !== value) element.setAttribute(name, value);
    }
    for (const prop of Object.keys(record.style)) {
      if (!(prop in style)) element.style.removeProperty(prop);
    }
    for (const [prop, value] of Object.entries(style)) {
      if (record.style[prop] !== value) element.style.setProperty(prop, value);
    }
    if (node.text !== undefined && element.textContent !== node.text) element.textContent = node.text;
    records.set(node.key, { attrs: { ...node.attrs }, style: { ...style } });
  };

  /**
   * Move or insert `element` before `reference`. When both ends are in the
   * document and the browser supports `moveBefore`, the move preserves the
   * element's state (iframes do not reload, focus and media keep playing).
   */
  const place = (parent, element, reference) => {
    if (typeof parent.moveBefore === "function" && element.isConnected && parent.isConnected) {
      try {
        parent.moveBefore(element, reference);
        return;
      } catch {
        // Fall through to insertBefore (e.g. cross-document or unsupported node).
      }
    }
    parent.insertBefore(element, reference);
  };

  /**
   * Top-down: each element is placed in its (already connected) parent before
   * its own children are reconciled, so a view moving into a brand-new
   * container never leaves the document. Leftovers are not removed here;
   * `commit` sweeps elements whose keys are no longer live, after every view
   * has had the chance to move to its new parent.
   */
  const reconcileChildren = (parent, children, live) => {
    let previous = null;
    for (const child of children) {
      const element = ensure(child, live);
      const reference = previous ? previous.nextSibling : parent.firstChild;
      if (element !== reference) place(parent, element, reference);
      previous = element;
      if (child.view === undefined && child.text === undefined) reconcileChildren(element, child.children, live);
      else if (child.view !== undefined) {
        mountSurface(child, element);
        syncBlocked(element, "data-wm-blocked" in child.attrs);
      }
    }
  };

  /**
   * A view blocked by a modal keeps pointer hit-testing (so clicks land on it
   * and are redirected, not passed through to the window underneath) while its
   * contents are inert: no focus, no input, hidden from assistive tech.
   */
  const syncBlocked = (element, blocked) => {
    for (const child of element.children) {
      if (blocked) child.setAttribute("inert", "");
      else child.removeAttribute("inert");
    }
  };

  const ensure = (node, live) => {
    live.add(node.key);
    let element = elements.get(node.key);
    if (element && element.localName !== node.tag) {
      // Same key, different element type: retire the old one (removed at the end of commit).
      retired.add(element);
      element = undefined;
    }
    element ??= create(node);
    patch(element, node);
    return element;
  };

  const mountSurface = (node, element) => {
    if (node.primary && !mounted.has(node.view)) {
      const surface = surfaceFor(node.view);
      if (surface) {
        surface.mount(element);
        mounted.set(node.view, surface);
      }
    }
  };

  /** Resolve the anchor-positioning declarations of a record into a JS placement. */
  const positionAnchoredFallback = () => {
    const rootRect = root.getBoundingClientRect();
    const positioned = new Set();
    for (const [key, spec] of anchorSpecs) {
      const element = elements.get(key);
      if (!element) continue;
      const target = elements.get(`view:${spec.to}`);
      if (!target || !target.isConnected) continue;
      const t = target.getBoundingClientRect();
      const e = element.getBoundingClientRect();
      const area = spec.area ?? "";
      let left;
      let top;
      if (area === "center" || area === "") {
        // Inside the anchor, aligned by justify-self / align-self.
        const jx = spec.justify ?? "center";
        const jy = spec.align ?? "center";
        left = jx === "start" ? t.left : jx === "end" ? t.right - e.width : t.left + (t.width - e.width) / 2;
        top = jy === "start" ? t.top : jy === "end" ? t.bottom - e.height : t.top + (t.height - e.height) / 2;
      } else {
        left = t.left + (t.width - e.width) / 2;
        top = t.top + (t.height - e.height) / 2;
        if (area.startsWith("bottom")) top = t.bottom;
        if (area.startsWith("top")) top = t.top - e.height - spec.gapAbove;
        if (area.startsWith("right")) left = t.right;
        if (area.startsWith("left")) left = t.left - e.width - spec.gapBefore;
        if (area.includes("span-right")) left = t.left;
        if (area.includes("span-left")) left = t.right - e.width;
        if (area.includes("span-bottom")) top = t.top;
        if (area.includes("span-top")) top = t.bottom - e.height;
      }
      element.style.setProperty("left", `${left - rootRect.left}px`);
      element.style.setProperty("top", `${top - rootRect.top}px`);
      positioned.add(key);
    }
    // Elements that stopped being anchored lose the coordinates we gave them.
    for (const key of fallbackPositioned) {
      if (positioned.has(key)) continue;
      const element = elements.get(key);
      const style = records.get(key)?.style ?? {};
      if (element && !("left" in style)) element.style.removeProperty("left");
      if (element && !("top" in style)) element.style.removeProperty("top");
    }
    fallbackPositioned = positioned;
  };

  let observer;
  if (useFallback) {
    const Observer = doc.defaultView?.ResizeObserver;
    if (Observer) {
      observer = new Observer(() => positionAnchoredFallback());
      observer.observe(root);
    }
  }

  return {
    /** Apply a render tree. Unmounts surfaces whose views disappeared. */
    commit(renderTree) {
      const live = new Set();
      reconcileChildren(root, [renderTree], live);
      for (const element of retired) element.remove();
      retired.clear();
      for (const key of [...elements.keys()]) {
        if (live.has(key)) continue;
        elements.get(key).remove();
        elements.delete(key);
        records.delete(key);
        anchorSpecs.delete(key);
      }
      for (const [id, surface] of [...mounted]) {
        if (!live.has(`view:${id}`)) {
          surface.unmount?.();
          mounted.delete(id);
        }
      }
      if (useFallback) positionAnchoredFallback();
    },

    /** Whether anchored elements are positioned by JS instead of CSS anchor positioning. */
    anchorFallback: useFallback,

    /** Re-run the JS anchor fallback (e.g. after content changed size without a commit). */
    reposition() {
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
      observer?.disconnect();
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
