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

/** Clamp a size into [min, max] constraints. */
export const constrainSize = (
  sizeValue,
  { minWidth = 0, minHeight = 0, maxWidth = Infinity, maxHeight = Infinity } = {},
) => ({
  width: Math.min(maxWidth, Math.max(minWidth, sizeValue.width)),
  height: Math.min(maxHeight, Math.max(minHeight, sizeValue.height)),
});

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
