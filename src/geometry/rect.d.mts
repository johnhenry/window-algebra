import type { Constraints, Point, Rect, Size } from "../types/state.mjs";

/** A rect. */
export function rect(x?: number, y?: number, width?: number, height?: number): Rect;
export function right(r: Rect): number;
export function bottom(r: Rect): number;
export function center(r: Rect): Point;
/** Left/top inclusive, right/bottom exclusive. */
export function contains(r: Rect, point: Point): boolean;
/** Whether two rects overlap with positive area. */
export function intersects(a: Rect, b: Rect): boolean;
export function intersection(a: Rect, b: Rect): Rect | null;
export function union(a: Rect, b: Rect): Rect;
/** Shrink (positive) or grow (negative) a rect on every side. */
export function inset(r: Rect, amount: number | { top?: number; right?: number; bottom?: number; left?: number }): Rect;
/**
 * Clamp a size into min/max, then honour `aspectRatio` and width/height increments.
 * `preserve` picks the dimension the aspect-ratio adjustment holds fixed.
 */
export function constrainSize(size: Size, constraints?: Constraints, options?: { preserve?: "width" | "height" }): Size;
/** The size in character cells for a window with increments set, or `null` when neither increment is. */
export function sizeToCells(size: Size, constraints?: Constraints): { cols: number | null; rows: number | null } | null;
/** Keep `r` inside `container`; with `keepVisible: n` only `n` px must stay visible. */
export function clamp(r: Rect, container: Rect, options?: { keepVisible?: number }): Rect;
export function translate(r: Rect, dx: number, dy: number): Rect;
export function equalRects(a: Rect | null | undefined, b: Rect | null | undefined): boolean;
