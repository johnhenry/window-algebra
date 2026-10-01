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
import { positionPopup } from "../geometry/positioner.mjs";

const supportsAnchors = (win) => {
  try {
    return Boolean(win?.CSS?.supports?.("anchor-name: --wm-test"));
  } catch {
    return false;
  }
};

const prefersReducedMotion = (win) => {
  try {
    return Boolean(win?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  } catch {
    return false;
  }
};

/** Renderer instances counted so their view-transition names never collide in one document. */
let rendererSeq = 0;

/** A valid, safe CSS custom-ident derived from an arbitrary view id: any non-ident character becomes `-`. */
const identSafe = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "-") || "x";

/**
 * @param {object} options
 * @param {Element} options.root host element; the render tree is mounted inside it
 * @param {(id: string) => ({ mount(target: Element): void, unmount?(): void } | undefined)} [options.surfaceFor]
 * @param {Document} [options.document]
 * @param {boolean} [options.anchorFallback] position anchored elements with JS when CSS anchors are unsupported
 * @param {boolean|{duration?: number|string, easing?: string}} [options.animate] animate commits with the View
 *   Transitions API when the browser supports it: `document.startViewTransition` wraps the reconcile, each primary
 *   view gets a unique `view-transition-name`, and `prefers-reduced-motion: reduce` or an unsupported browser make
 *   it a no-op (commits apply immediately, same as `animate` unset). `duration`/`easing` set
 *   `--wa-transition-duration`/`--wa-transition-easing`, which `BASE_CSS` reads. Pass `{ immediate: true }` to
 *   `commit()` to force a given commit to skip the transition (drag gestures; see `manager.mjs`); an animation
 *   already in flight makes later commits immediate too, so rapid commits coalesce instead of stacking transitions.
 */
export const createDomRenderer = ({ root, surfaceFor = () => undefined, document: doc = root.ownerDocument, anchorFallback, animate } = {}) => {
  const elements = new Map(); // key → Element
  const records = new Map(); // key → { attrs, style }
  const mounted = new Map(); // view id → surface
  const retired = new Set(); // elements replaced by a same-key element of another tag
  const anchorSpecs = new Map(); // key → { mode, to, ... } (JS anchor fallback only); see effectiveStyle()
  let fallbackPositioned = new Set();
  let fallbackSized = new Set(); // keys whose width/height the fallback's `resize` set directly
  const useFallback = anchorFallback ?? !supportsAnchors(doc.defaultView);
  root.setAttribute("data-wm-root", "");

  let animateConfig = null;
  const instanceId = `r${rendererSeq++}`;
  const transitionNames = new Map(); // view id → assigned view-transition-name
  const usedTransitionNames = new Set();
  const transitionName = (id) => {
    let name = transitionNames.get(id);
    if (name) return name;
    const base = `wm-${instanceId}-${identSafe(id)}`;
    name = base;
    for (let n = 1; usedTransitionNames.has(name); n++) name = `${base}-${n}`;
    usedTransitionNames.add(name);
    transitionNames.set(id, name);
    return name;
  };
  let pendingTransition = null; // the in-flight ViewTransition, if any (rapid commits coalesce onto it)

  /** Normalizes `animate`/`setAnimate`'s argument and applies duration/easing to the document element. */
  const configureAnimate = (value) => {
    animateConfig = value ? (value === true ? {} : value) : null;
    if (!animateConfig) return;
    const docEl = doc.documentElement ?? doc.body;
    if (animateConfig.duration != null) {
      docEl?.style?.setProperty("--wa-transition-duration", typeof animateConfig.duration === "number" ? `${animateConfig.duration}ms` : animateConfig.duration);
    }
    if (animateConfig.easing != null) docEl?.style?.setProperty("--wa-transition-easing", animateConfig.easing);
  };
  configureAnimate(animate);

  const create = (node) => {
    const element = doc.createElement(node.tag);
    elements.set(node.key, element);
    records.set(node.key, { attrs: {}, style: {} });
    return element;
  };

  /** Declarations the JS fallback replaces; left in place they would fight its coordinates. */
  const ANCHOR_PROPS = ["position-anchor", "position-area", "position-try-fallbacks", "justify-self", "align-self", "anchor-name"];

  const effectiveStyle = (node) => {
    let style = node.style;
    if (useFallback) {
      const to = node.attrs["data-wm-anchor"];
      if (to === undefined) {
        anchorSpecs.delete(node.key);
      } else {
        const raw = node.attrs["data-wm-anchor-opts"];
        let positioner = null;
        if (raw) {
          try {
            positioner = JSON.parse(raw);
          } catch {
            positioner = null;
          }
        }
        anchorSpecs.set(
          node.key,
          positioner
            ? { mode: "side", to, ...positioner }
            : {
                // "inside" mode (or an anchor without side/align/offset): positioned
                // by the CSS declarations compile.mjs derived for it.
                mode: "inside",
                to,
                area: node.style["position-area"],
                justify: node.style["justify-self"],
                align: node.style["align-self"],
                // margin-right / margin-bottom do not move an element placed by left/top.
                gapBefore: parseFloat(node.style["margin-right"]) || 0,
                gapAbove: parseFloat(node.style["margin-bottom"]) || 0,
              },
        );
      }
      if (to !== undefined || "anchor-name" in node.style) {
        style = { ...node.style };
        for (const prop of ANCHOR_PROPS) if (to !== undefined || prop === "anchor-name") delete style[prop];
      }
    }
    // Every primary view gets a stable, unique view-transition-name so a
    // `document.startViewTransition` commit can animate it individually.
    if (animateConfig && node.primary && node.view !== undefined) {
      style = { ...style, "view-transition-name": transitionName(node.view) };
    }
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

  /**
   * Resolve the anchor-positioning declarations of a record into a JS
   * placement. "side" mode (`side`/`align`/`offset`/`gravity`/`flip`/`slide`/
   * `resize`) runs the same `positionPopup` constraint adjustment the CSS
   * path can only partially express (see `anchorStyle` in `src/css/compile.mjs`);
   * "inside" mode keeps the simpler center-alignment math it always had.
   */
  const positionAnchoredFallback = () => {
    const rootRect = root.getBoundingClientRect();
    const stage = { x: 0, y: 0, width: rootRect.width, height: rootRect.height };
    const positioned = new Set();
    const sized = new Set();
    for (const [key, spec] of anchorSpecs) {
      const element = elements.get(key);
      if (!element) continue;
      const target = elements.get(`view:${spec.to}`);
      if (!target || !target.isConnected) continue;
      const t = target.getBoundingClientRect();
      const e = element.getBoundingClientRect();
      let left;
      let top;
      if (spec.mode === "side") {
        const anchorRect = { x: t.left - rootRect.left, y: t.top - rootRect.top, width: t.width, height: t.height };
        const placed = positionPopup(anchorRect, { width: e.width, height: e.height }, stage, {
          side: spec.side,
          align: spec.align,
          offset: spec.offset,
          gravity: spec.gravity,
          // Same default as the CSS path (compile.mjs): an anchor without `flip` flips on both axes.
          flip: spec.flip ?? ["x", "y"],
          slide: spec.slide,
          resize: spec.resize,
        });
        left = placed.x + rootRect.left;
        top = placed.y + rootRect.top;
        if (placed.resized.x || placed.resized.y) {
          if (placed.resized.x) element.style.setProperty("width", `${placed.width}px`);
          if (placed.resized.y) element.style.setProperty("height", `${placed.height}px`);
          sized.add(key);
        }
      } else {
        const area = spec.area ?? "";
        if (area === "center" || area === "") {
          // Inside the anchor, aligned by justify-self / align-self.
          const jx = spec.justify ?? "center";
          const jy = spec.align ?? "center";
          // start/end (LTR) and left/right (compile spells it that way in RTL) are physical here.
          left = jx === "start" || jx === "left" ? t.left : jx === "end" || jx === "right" ? t.right - e.width : t.left + (t.width - e.width) / 2;
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
      }
      element.style.setProperty("left", `${left - rootRect.left}px`);
      element.style.setProperty("top", `${top - rootRect.top}px`);
      positioned.add(key);
    }
    // Elements that stopped being anchored lose the coordinates (and, if a
    // resize had shrunk them, the size) we gave them.
    for (const key of fallbackPositioned) {
      if (positioned.has(key)) continue;
      const element = elements.get(key);
      const style = records.get(key)?.style ?? {};
      if (element && !("left" in style)) element.style.removeProperty("left");
      if (element && !("top" in style)) element.style.removeProperty("top");
    }
    for (const key of fallbackSized) {
      if (sized.has(key)) continue;
      const element = elements.get(key);
      const style = records.get(key)?.style ?? {};
      if (element && !("width" in style)) element.style.removeProperty("width");
      if (element && !("height" in style)) element.style.removeProperty("height");
    }
    fallbackPositioned = positioned;
    fallbackSized = sized;
  };

  let observer;
  if (useFallback) {
    const Observer = doc.defaultView?.ResizeObserver;
    if (Observer) {
      observer = new Observer(() => positionAnchoredFallback());
      observer.observe(root);
    }
  }

  const applyCommit = (renderTree) => {
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
  };

  return {
    /** The host element the render tree is mounted inside (the `root` option). */
    root,

    /**
     * Apply a render tree. Unmounts surfaces whose views disappeared.
     * `{ immediate: true }` (a drag gesture, say) always skips the
     * animation; so does a commit that lands while an earlier one is still
     * transitioning, which keeps rapid commits from stacking transitions.
     */
    commit(renderTree, { immediate = false } = {}) {
      const canAnimate = animateConfig && !immediate && !pendingTransition &&
        typeof doc.startViewTransition === "function" && !prefersReducedMotion(doc.defaultView);
      if (!canAnimate) {
        applyCommit(renderTree);
        return;
      }
      const transition = doc.startViewTransition(() => applyCommit(renderTree));
      pendingTransition = transition;
      const clear = () => {
        if (pendingTransition === transition) pendingTransition = null;
      };
      if (transition?.finished?.then) transition.finished.then(clear, clear);
      else clear();
    },

    /** Whether anchored elements are positioned by JS instead of CSS anchor positioning. */
    anchorFallback: useFallback,

    /** Whether this renderer was configured to animate commits (regardless of browser support). */
    get animate() {
      return Boolean(animateConfig);
    },

    /** Turn animated commits on/off (or reconfigure duration/easing) after creation, e.g. a demo toggle. */
    setAnimate(value) {
      configureAnimate(value);
    },

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

    /**
     * Detach a view's element from this renderer's bookkeeping without
     * touching the DOM or unmounting its surface, so a caller (see
     * `attachPopouts` in `popouts.mjs`) can move it elsewhere — another
     * document, say — and keep its content and state alive. The next
     * `commit` neither recreates nor sweeps it: it is simply gone from view
     * until `adopt()` gives it back. Returns `undefined` if the view id
     * isn't currently rendered.
     */
    release(id) {
      const key = `view:${id}`;
      const element = elements.get(key);
      if (!element) return undefined;
      elements.delete(key);
      records.delete(key);
      anchorSpecs.delete(key);
      fallbackPositioned.delete(key);
      fallbackSized.delete(key);
      const surface = mounted.get(id);
      mounted.delete(id);
      return { element, surface };
    },

    /**
     * The reverse of `release`: re-register `element` (and, if it was kept
     * alive elsewhere, its mounted `surface`) under `id` so the next
     * `commit` reuses it in place — patching it back to the current layout's
     * styles/attrs — instead of asking `surfaceFor` to mount a fresh one.
     */
    adopt(id, element, surface) {
      const key = `view:${id}`;
      elements.set(key, element);
      records.set(key, { attrs: {}, style: {} });
      if (surface) mounted.set(id, surface);
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
