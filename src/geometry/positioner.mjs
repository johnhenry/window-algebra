/**
 * Wayland `xdg_positioner`-style constraint adjustment for anchored popups
 * (popovers, menus, tooltips, dialogs). Pure geometry: no DOM, no state.
 *
 * The popup is placed relative to an anchor rect using an edge (`side`) and
 * a cross-axis alignment (`align`), then — if it would overflow the given
 * `stage` — nudged back into view along each axis independently, in the
 * order Wayland defines: flip, then slide, then resize. Any step is skipped
 * unless the caller opted that axis into it via the `flip`/`slide`/`resize`
 * option arrays.
 *
 * This mirrors what `anchor()` compiles to (see `src/css/compile.mjs` and
 * the JS anchor fallback in `src/browser/dom.mjs`), but as a standalone
 * function so the placement math can be tested, and reused, without a DOM.
 */

const OPPOSITE = Object.freeze({ top: "bottom", bottom: "top", left: "right", right: "left" });
export const SIDES = Object.freeze(["top", "bottom", "left", "right"]);

/** "top"/"bottom" move along y; "left"/"right" move along x. */
const axisOf = (side) => (side === "top" || side === "bottom" ? "y" : "x");

/** A gravity only makes sense on the same axis as `side`; otherwise it falls back to `side`. */
const resolveGravity = (gravity, side) => (gravity === side || gravity === OPPOSITE[side] ? gravity : side);

/**
 * Position of the popup's leading edge on the primary axis: the edge of
 * `anchorRect` named by `side`, pushed out by `offset`, then the popup laid
 * out from that point in the direction `gravity` says it should grow.
 */
const attachPoint = (side, gravity, anchorRect, size, offset) => {
  const axis = axisOf(side);
  const anchorStart = axis === "y" ? anchorRect.y : anchorRect.x;
  const anchorSize = axis === "y" ? anchorRect.height : anchorRect.width;
  const popupSize = axis === "y" ? size.height : size.width;
  const leading = side === "top" || side === "left";
  const edge = leading ? anchorStart : anchorStart + anchorSize;
  const point = leading ? edge - offset : edge + offset;
  return gravity === "top" || gravity === "left" ? point - popupSize : point;
};

/** Position of the popup's leading edge on the cross axis, per `align`. */
const crossPosition = (side, align, anchorRect, size) => {
  const axis = axisOf(side) === "y" ? "x" : "y";
  const anchorStart = axis === "x" ? anchorRect.x : anchorRect.y;
  const anchorSize = axis === "x" ? anchorRect.width : anchorRect.height;
  const popupSize = axis === "x" ? size.width : size.height;
  if (align === "start") return anchorStart;
  if (align === "end") return anchorStart + anchorSize - popupSize;
  return anchorStart + (anchorSize - popupSize) / 2;
};

/** `{ before, after }`: positive amounts by which `[pos, pos+size)` spills out of `[start, start+span)`. */
const overflowOf = (pos, size, start, span) => ({ before: start - pos, after: pos + size - (start + span) });
const bad = (o) => Math.max(o.before, 0) + Math.max(o.after, 0);

/**
 * Compute the popup's placement.
 *
 * @param {{x:number,y:number,width:number,height:number}} anchorRect anchor box, in stage coordinates
 * @param {{width:number,height:number}} popupSize the popup's natural (unconstrained) size
 * @param {{x?:number,y?:number,width:number,height:number}} stage the viewport/container to stay inside
 * @param {object} [options]
 * @param {"top"|"bottom"|"left"|"right"} [options.side="bottom"] which edge of the anchor to attach to
 * @param {"start"|"center"|"end"} [options.align="center"] alignment along the cross axis
 * @param {number} [options.offset=0] gap between the anchor's `side` edge and the popup
 * @param {"top"|"bottom"|"left"|"right"} [options.gravity=side] which way the popup grows from the attach point;
 *   must share an axis with `side` (top/bottom or left/right) or it is ignored
 * @param {Array<"x"|"y">} [options.flip=[]] axes allowed to flip to their opposite side/align when constrained
 * @param {Array<"x"|"y">} [options.slide=[]] axes allowed to slide (translate, unresized) back into the stage
 * @param {Array<"x"|"y">} [options.resize=[]] axes allowed to shrink so the popup fits the stage
 *
 * Like Wayland's `xdg_positioner`, no adjustment happens on an axis unless
 * that axis opts in; the plain placement is returned as-is (it may overflow
 * `stage`) when `flip`/`slide`/`resize` are all left empty.
 * @returns {{
 *   x:number, y:number, width:number, height:number,
 *   side:string, align:string, gravity:string,
 *   flipped:{x:boolean,y:boolean}, slid:{x:boolean,y:boolean}, resized:{x:boolean,y:boolean},
 *   constrained:{x:boolean,y:boolean}
 * }}
 */
export const positionPopup = (anchorRect, popupSize, stage, options = {}) => {
  const side0 = SIDES.includes(options.side) ? options.side : "bottom";
  const align0 = ["start", "center", "end"].includes(options.align) ? options.align : "center";
  const offset = Number.isFinite(options.offset) ? options.offset : 0;
  const gravity0 = resolveGravity(options.gravity ?? side0, side0);
  const flip = new Set(options.flip ?? []);
  const slide = new Set(options.slide ?? []);
  const resize = new Set(options.resize ?? []);

  const stageRect = { x: stage.x ?? 0, y: stage.y ?? 0, width: Math.max(0, stage.width ?? 0), height: Math.max(0, stage.height ?? 0) };
  let width = Math.max(0, popupSize?.width ?? 0);
  let height = Math.max(0, popupSize?.height ?? 0);

  const primaryAxis = axisOf(side0);
  const crossAxis = primaryAxis === "y" ? "x" : "y";

  let side = side0;
  let gravity = gravity0;
  let align = align0;

  let primaryPos = attachPoint(side, gravity, anchorRect, { width, height }, offset);
  let crossPos = crossPosition(side, align, anchorRect, { width, height });

  const stageStart = (axis) => (axis === "x" ? stageRect.x : stageRect.y);
  const stageSpan = (axis) => (axis === "x" ? stageRect.width : stageRect.height);
  const sizeOf = (axis) => (axis === "x" ? width : height);

  const flags = { flipped: { x: false, y: false }, slid: { x: false, y: false }, resized: { x: false, y: false } };

  // --- primary axis: flip (side+gravity), then slide, then resize --------
  {
    const start = stageStart(primaryAxis);
    const span = stageSpan(primaryAxis);
    let o = overflowOf(primaryPos, sizeOf(primaryAxis), start, span);
    if ((o.before > 0 || o.after > 0) && flip.has(primaryAxis)) {
      const altSide = OPPOSITE[side];
      const altGravity = OPPOSITE[gravity];
      const altPos = attachPoint(altSide, altGravity, anchorRect, { width, height }, offset);
      const altOverflow = overflowOf(altPos, sizeOf(primaryAxis), start, span);
      if (bad(altOverflow) < bad(o)) {
        side = altSide;
        gravity = altGravity;
        primaryPos = altPos;
        o = altOverflow;
        flags.flipped[primaryAxis] = true;
      }
    }
    if ((o.before > 0 || o.after > 0) && slide.has(primaryAxis)) {
      const size = sizeOf(primaryAxis);
      const maxPos = start + span - size;
      const clamped = size >= span ? start : Math.min(Math.max(primaryPos, start), maxPos);
      if (clamped !== primaryPos) {
        primaryPos = clamped;
        flags.slid[primaryAxis] = true;
      }
      o = overflowOf(primaryPos, size, start, span);
    }
    if ((o.before > 0 || o.after > 0) && resize.has(primaryAxis)) {
      const oldSize = sizeOf(primaryAxis);
      // The edge nearest the anchor (per gravity, i.e. the attach point) stays
      // put; the popup shrinks to whatever room remains between it and the
      // far edge of the stage.
      const anchoredAtFar = gravity === "top" || gravity === "left";
      const anchorEdge = anchoredAtFar ? primaryPos + oldSize : primaryPos;
      const available = anchoredAtFar ? anchorEdge - start : start + span - anchorEdge;
      const newSize = Math.min(oldSize, span, Math.max(0, available));
      let newPos = anchoredAtFar ? anchorEdge - newSize : anchorEdge;
      newPos = Math.min(Math.max(newPos, start), start + span - newSize);
      if (primaryAxis === "x") width = newSize;
      else height = newSize;
      primaryPos = newPos;
      flags.resized[primaryAxis] = true;
    }
  }

  // Re-derive the cross position: it depends on width/height, which resize may have changed.
  crossPos = crossPosition(side, align, anchorRect, { width, height });

  // --- cross axis: flip (align), then slide, then resize -----------------
  {
    const start = stageStart(crossAxis);
    const span = stageSpan(crossAxis);
    let o = overflowOf(crossPos, sizeOf(crossAxis), start, span);
    if ((o.before > 0 || o.after > 0) && flip.has(crossAxis) && align !== "center") {
      const altAlign = align === "start" ? "end" : "start";
      const altPos = crossPosition(side, altAlign, anchorRect, { width, height });
      const altOverflow = overflowOf(altPos, sizeOf(crossAxis), start, span);
      if (bad(altOverflow) < bad(o)) {
        align = altAlign;
        crossPos = altPos;
        o = altOverflow;
        flags.flipped[crossAxis] = true;
      }
    }
    if ((o.before > 0 || o.after > 0) && slide.has(crossAxis)) {
      const size = sizeOf(crossAxis);
      const maxPos = start + span - size;
      const clamped = size >= span ? start : Math.min(Math.max(crossPos, start), maxPos);
      if (clamped !== crossPos) {
        crossPos = clamped;
        flags.slid[crossAxis] = true;
      }
      o = overflowOf(crossPos, size, start, span);
    }
    if ((o.before > 0 || o.after > 0) && resize.has(crossAxis)) {
      const oldSize = sizeOf(crossAxis);
      const anchoredAtFar = align === "end";
      const anchorEdge = anchoredAtFar ? crossPos + oldSize : crossPos;
      const available = anchoredAtFar ? anchorEdge - start : start + span - anchorEdge;
      const newSize = Math.min(oldSize, span, Math.max(0, available));
      let newPos = anchoredAtFar ? anchorEdge - newSize : anchorEdge;
      newPos = Math.min(Math.max(newPos, start), start + span - newSize);
      if (crossAxis === "x") width = newSize;
      else height = newSize;
      crossPos = newPos;
      flags.resized[crossAxis] = true;
    }
  }

  const x = primaryAxis === "x" ? primaryPos : crossPos;
  const y = primaryAxis === "y" ? primaryPos : crossPos;
  const constrained = {
    x: flags.flipped.x || flags.slid.x || flags.resized.x,
    y: flags.flipped.y || flags.slid.y || flags.resized.y,
  };

  return { x, y, width, height, side, align, gravity, ...flags, constrained };
};
