/**
 * The stage's coordinate space, for a stage the application transforms (a pannable, zoomable canvas: the
 * renderer's root inside a "world" element with `transform: translate(x, y) scale(z)`).
 *
 * The browser reports pointer positions and `getBoundingClientRect()` in screen pixels, while a floating window's
 * `placement` is in the stage's own, untransformed CSS pixels ("stage units"). Without a hook the adapters treat
 * the two as the same (screen pixels relative to the root's box), which is exact for an untransformed stage. With
 * `coordinates: { toStage(clientX, clientY), scale() }` they convert every pointer position and measured rect
 * through it instead. Only translation and a uniform scale are supported (no rotation or skew).
 */

/**
 * Normalize the `coordinates` option of `createDomRenderer` / `attachInput`. `null` when absent: callers then keep
 * their screen-pixel math exactly as it was.
 *
 * @param {{ toStage(clientX: number, clientY: number): { x: number, y: number }, scale?: () => number } | null | undefined} coordinates
 * @returns {null | { point(clientX: number, clientY: number): { x: number, y: number }, scale(): number, rect(r: DOMRectReadOnly): { x: number, y: number, width: number, height: number }, size(r: DOMRectReadOnly): { width: number, height: number } }}
 */
export const coordinateSpace = (coordinates) => {
  if (coordinates == null || coordinates === false) return null;
  if (typeof coordinates.toStage !== "function") throw new TypeError("coordinates.toStage(clientX, clientY) must be a function.");
  const toStage = (x, y) => {
    const p = coordinates.toStage(x, y);
    return { x: Number(p?.x), y: Number(p?.y) };
  };
  /** Screen pixels per stage unit: the hook's `scale()`, else read off `toStage` (one screen pixel, in stage units). */
  const scale = () => {
    let s;
    if (typeof coordinates.scale === "function") s = Number(coordinates.scale());
    else {
      const a = toStage(0, 0);
      const b = toStage(1, 0);
      s = 1 / (b.x - a.x);
    }
    return Number.isFinite(s) && s > 0 ? s : 1;
  };
  return {
    point: toStage,
    scale,
    /** A client rect (from `getBoundingClientRect`) in stage units, relative to the root's origin. */
    rect(r) {
      const p = toStage(r.left, r.top);
      const s = scale();
      return { x: p.x, y: p.y, width: r.width / s, height: r.height / s };
    },
    /** Only the size of a client rect, in stage units. */
    size(r) {
      const s = scale();
      return { width: r.width / s, height: r.height / s };
    },
  };
};
