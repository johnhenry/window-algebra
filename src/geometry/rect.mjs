/**
 * Rectangle and constraint helpers. Nothing here knows about windows.
 * A rect is { x, y, width, height }.
 */

export const rect = (x = 0, y = 0, width = 0, height = 0) => ({ x, y, width, height });

export const right = (r) => r.x + r.width;
export const bottom = (r) => r.y + r.height;
export const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export const contains = ({ x, y, width, height }, point) =>
  point.x >= x && point.y >= y && point.x < x + width && point.y < y + height;

export const intersects = (a, b) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);

export const intersection = (a, b) => {
  if (!intersects(a, b)) return null;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return rect(x, y, Math.min(right(a), right(b)) - x, Math.min(bottom(a), bottom(b)) - y);
};

export const union = (a, b) => {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return rect(x, y, Math.max(right(a), right(b)) - x, Math.max(bottom(a), bottom(b)) - y);
};

/** Shrink (positive) or grow (negative) a rect on every side. */
export const inset = (r, amount) => {
  const { top = 0, right: rt = 0, bottom: bt = 0, left = 0 } =
    typeof amount === "number" ? { top: amount, right: amount, bottom: amount, left: amount } : amount;
  return rect(r.x + left, r.y + top, Math.max(0, r.width - left - rt), Math.max(0, r.height - top - bt));
};

/**
 * Adjust (width, height) to honour an ICCCM-style `aspectRatio` constraint
 * (a number, or a `{ min, max }` range — width / height). `preserve` says
 * which dimension to hold fixed while the other is recomputed: "width",
 * "height", or (the default) whichever needs the smaller change.
 */
const applyAspectRatio = (width, height, aspectRatio, preserve) => {
  if (aspectRatio === undefined || aspectRatio === null || !(height > 0) || !(width > 0)) return { width, height };
  const { min, max } = typeof aspectRatio === "number" ? { min: aspectRatio, max: aspectRatio } : aspectRatio;
  const lo = Number.isFinite(min) && min > 0 ? min : 0;
  const hi = Number.isFinite(max) && max > 0 ? max : Infinity;
  if (!(lo > 0) && hi === Infinity) return { width, height };
  const ratio = width / height;
  const target = ratio < lo ? lo : ratio > hi ? hi : ratio;
  if (target === ratio) return { width, height };
  if (preserve === "height") return { width: height * target, height };
  if (preserve === "width") return { width, height: width / target };
  const widthFor = height * target;
  const heightFor = width / target;
  return Math.abs(widthFor - width) <= Math.abs(heightFor - height) ? { width: widthFor, height } : { width, height: heightFor };
};

/** Snap `value` onto the grid `base + n * increment` (n integer); a no-op without a positive increment. */
const snapIncrement = (value, base, increment) =>
  Number.isFinite(increment) && increment > 0 ? (Number.isFinite(base) ? base : 0) + Math.round((value - (Number.isFinite(base) ? base : 0)) / increment) * increment : value;

/**
 * Clamp a size into [min, max] constraints, and honour ICCCM WM_NORMAL_HINTS-style
 * size hints beyond min/max:
 * - `aspectRatio`: width / height, as a number (exact) or `{ min, max }` (a range).
 * - `widthIncrement` / `heightIncrement`: only sizes `baseWidth/baseHeight + n * increment`
 *   are allowed (terminal-style character cells; `baseWidth`/`baseHeight` default to 0).
 *
 * `{ preserve }` picks which dimension the aspect-ratio adjustment holds fixed
 * ("width" or "height") when both could change; the default picks whichever
 * needs the smaller change. Order: clamp to min/max, apply aspect ratio,
 * re-clamp, snap to increments, re-clamp.
 */
export const constrainSize = (
  sizeValue,
  {
    minWidth = 0,
    minHeight = 0,
    maxWidth = Infinity,
    maxHeight = Infinity,
    aspectRatio,
    widthIncrement,
    heightIncrement,
    baseWidth,
    baseHeight,
  } = {},
  { preserve } = {},
) => {
  const clampBoth = (width, height) => ({
    width: Math.min(maxWidth, Math.max(minWidth, width)),
    height: Math.min(maxHeight, Math.max(minHeight, height)),
  });
  let { width, height } = clampBoth(sizeValue.width, sizeValue.height);
  ({ width, height } = applyAspectRatio(width, height, aspectRatio, preserve));
  ({ width, height } = clampBoth(width, height));
  width = snapIncrement(width, baseWidth ?? minWidth, widthIncrement);
  height = snapIncrement(height, baseHeight ?? minHeight, heightIncrement);
  return clampBoth(width, height);
};

/**
 * The size expressed in `{ cols, rows }` character cells for a window with
 * increments set (terminal-style hints), or `null` when neither increment is set.
 * `baseWidth`/`baseHeight` default to 0 (not `minWidth`/`minHeight`) so the
 * readout matches the raw ICCCM formula `size = base + n * increment`.
 */
export const sizeToCells = ({ width, height }, { widthIncrement, heightIncrement, baseWidth = 0, baseHeight = 0 } = {}) => {
  const hasWidth = Number.isFinite(widthIncrement) && widthIncrement > 0;
  const hasHeight = Number.isFinite(heightIncrement) && heightIncrement > 0;
  if (!hasWidth && !hasHeight) return null;
  return {
    cols: hasWidth ? Math.round((width - baseWidth) / widthIncrement) : null,
    rows: hasHeight ? Math.round((height - baseHeight) / heightIncrement) : null,
  };
};

/**
 * Keep `r` inside `container`. With `{ keepVisible: n }`, only require that
 * `n` pixels of the rect stay visible (typical for dragged windows).
 */
export const clamp = (r, container, { keepVisible } = {}) => {
  if (keepVisible !== undefined) {
    const x = Math.min(right(container) - keepVisible, Math.max(container.x - r.width + keepVisible, r.x));
    const y = Math.min(bottom(container) - keepVisible, Math.max(container.y, r.y));
    return rect(x, y, r.width, r.height);
  }
  const width = Math.min(r.width, container.width);
  const height = Math.min(r.height, container.height);
  const x = Math.min(right(container) - width, Math.max(container.x, r.x));
  const y = Math.min(bottom(container) - height, Math.max(container.y, r.y));
  return rect(x, y, width, height);
};

export const translate = (r, dx, dy) => rect(r.x + dx, r.y + dy, r.width, r.height);

export const equalRects = (a, b) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
