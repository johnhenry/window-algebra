/**
 * Surfaces: anything that can be displayed inside a view. The window manager
 * never knows which kind it is dealing with; it only calls mount/unmount.
 */

/** Wrap an existing element. */
export const htmlSurface = (element) => ({
  kind: "html",
  mount(target) {
    target.append(element);
  },
  unmount() {
    element.remove();
  },
});

/** Build content lazily on first mount. `render(target)` may return a cleanup function. */
export const lazySurface = (render) => {
  let cleanup;
  return {
    kind: "lazy",
    mount(target) {
      cleanup = render(target);
    },
    unmount() {
      if (typeof cleanup === "function") cleanup();
      cleanup = undefined;
    },
  };
};

/** An iframe surface. */
export const iframeSurface = (src, { document: doc = globalThis.document, attributes = {} } = {}) => {
  const frame = doc.createElement("iframe");
  frame.src = src;
  frame.style.cssText = "border: 0; width: 100%; height: 100%; display: block;";
  for (const [name, value] of Object.entries(attributes)) frame.setAttribute(name, value);
  return htmlSurface(frame);
};

/**
 * An html-in-canvas style surface: `draw(canvas, size)` repaints whenever the
 * view's allocated size changes. The WM sees the same mount/unmount contract.
 */
export const canvasSurface = (draw, { document: doc = globalThis.document } = {}) => {
  const canvas = doc.createElement("canvas");
  canvas.style.cssText = "width: 100%; height: 100%; display: block;";
  let observer;
  return {
    kind: "canvas",
    canvas,
    mount(target) {
      target.append(canvas);
      const Observer = doc.defaultView?.ResizeObserver;
      const paint = () => {
        const ratio = doc.defaultView?.devicePixelRatio ?? 1;
        const { width, height } = target.getBoundingClientRect();
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        draw(canvas, { width, height, ratio });
      };
      if (Observer) {
        observer = new Observer(paint);
        observer.observe(target);
      } else {
        paint();
      }
    },
    unmount() {
      observer?.disconnect();
      canvas.remove();
    },
  };
};

/** A registry mapping view ids to surfaces, usable as `surfaceFor`. */
export const createSurfaceRegistry = (initial = {}) => {
  const surfaces = new Map(Object.entries(initial));
  const lookup = (id) => surfaces.get(id);
  lookup.set = (id, surface) => {
    surfaces.set(id, surface);
    return lookup;
  };
  lookup.delete = (id) => surfaces.delete(id);
  lookup.has = (id) => surfaces.has(id);
  return lookup;
};
