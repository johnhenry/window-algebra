import type { LayoutNode } from "../types/tree.mjs";
import type { BspSplit, BspTree, TreeContainer, TreeNode } from "../types/state.mjs";

/** A layout argument: a window id, or a ready-made node. */
export type LayoutItem = string | LayoutNode;

/** Sugar for a floating window: `place({ x, y }, size({ width, height }, child))`. */
export function floating(options: { x?: number | string; y?: number | string; width?: number | string; height?: number | string } | undefined, child: LayoutItem): LayoutNode;
/** Sugar: centre a child within its allocation. */
export function centered(options: { width?: number | string; height?: number | string } | undefined, child: LayoutItem): LayoutNode;
/** Sugar: dock a child at one side with a fixed extent; `rest` fills the remainder. */
export function dock(options: { side?: "left" | "right" | "top" | "bottom"; extent?: number } | undefined, child: LayoutItem, rest: LayoutItem): LayoutNode;
/** Master on one side, the rest stacked in a column. `side` is the inline start/end. */
export function masterStack(options: { ratio?: number; masterCount?: number; side?: "left" | "right" } | undefined, ids: LayoutItem[]): LayoutNode;
/** Equal-width columns, or `spec.sizes[""]`-weighted once resized. */
export function columns(spec: { sizes?: Record<string, number[]>; align?: string; distribute?: string } | undefined, ids: LayoutItem[]): LayoutNode;
/** Equal-height rows, or `spec.sizes[""]`-weighted. */
export function rows(spec: { sizes?: Record<string, number[]>; align?: string; distribute?: string } | undefined, ids: LayoutItem[]): LayoutNode;
/** One visible view at a time. */
export function monocle(options: { active?: string } | undefined, ids: LayoutItem[]): LayoutNode;
/** Monocle plus a tab strip. */
export function tabs(options: { active?: string } | undefined, ids: LayoutItem[]): LayoutNode;
/** Responsive grid: as many columns of at least `min` as fit. */
export function autoGrid(options: { min?: number | string; max?: number | string; repeat?: string } | undefined, ids: LayoutItem[]): LayoutNode;
/** Fixed-column grid. */
export function fixedGrid(options: { columns?: number; rows?: number } | undefined, ids: LayoutItem[]): LayoutNode;
/** Floating windows over a tiled base. */
export function hybrid(tiled: LayoutNode, floatingNodes?: LayoutNode[]): LayoutNode;
/** Spiral / dwindle: each window splits the remaining space, alternating direction. */
export function spiral(options: { ratio?: number; ratios?: number[] } | undefined, ids: LayoutItem[]): LayoutNode;

// ------------------------------------------------------------------ BSP

export function bspLeaf(id: string): BspTree;
export function bspSplit(direction: "horizontal" | "vertical", ratio: number, first: BspTree, second: BspTree): BspSplit;
/** Leaf ids in order. */
export function bspIds(tree: BspTree | null | undefined): string[];
/** Split leaf `target` (default: the last leaf) with `id` in the second position; the direction alternates with depth unless given. */
export function bspInsert(tree: BspTree | null | undefined, options: { id: string; target?: string; direction?: "horizontal" | "vertical"; ratio?: number }): BspTree;
/** Insert `id` beside `target` on a side (`left`/`right` split horizontally, `top`/`bottom` vertically). */
export function bspPlace(tree: BspTree | null | undefined, options: { id: string; target: string; side?: "left" | "right" | "top" | "bottom"; ratio?: number }): BspTree;
/** Remove a leaf; its sibling takes the parent's place. */
export function bspRemove(tree: BspTree | null | undefined, id: string): BspTree | null;
export function bspSwap(tree: BspTree | null | undefined, a: string, b: string): BspTree | null;
/** Drop leaves not in `ids` and append the missing ones. */
export function bspReconcile(tree: BspTree | null | undefined, ids: string[]): BspTree | null;
/** Set the ratio (clamped to 0.05..0.95) of the split directly containing leaf `id`. */
export function bspSetRatio(tree: BspTree | null | undefined, id: string, ratio: number): BspTree | null;
/** Toggle the direction of the split directly containing `id`. */
export function bspRotate(tree: BspTree | null | undefined, id: string): BspTree | null;
export function bspParentDirection(tree: BspTree | null | undefined, id: string): "horizontal" | "vertical" | null;
/** The split reached by `"0"`/`"1"` steps (`""` is the root), or `null`. */
export function bspNodeAt(tree: BspTree | null | undefined, path: string): BspSplit | null;
/**
 * The stored path of the split a splitter's rendered `path` addresses, given the `shown` ids: dormant leaves (a minimized window's) are not
 * rendered and a split with one side wholly dormant collapses into the other. `null` when `path` addresses no rendered split.
 */
export function bspResolveShown(tree: BspTree | null | undefined, shown: ReadonlySet<string>, path: string): string | null;
export function bspSetRatioAt(tree: BspTree | null | undefined, path: string, ratio: number): BspTree | null;
/** Interpret a tree as rows/columns with weights, each split carrying `resize: { path, weights }`. */
export function bspToLayout(tree: BspTree | null | undefined, path?: string): LayoutNode;
/** A tree built by inserting ids in order. */
export function bspFrom(ids: string[], options?: { direction?: "horizontal" | "vertical"; ratio?: number }): BspTree | null;

// ------------------------------------------------------------------ docking tree

/** Leaf ids in order. */
export function treeIds(node: TreeNode | null | undefined): string[];
/** `"row"`/`"column"`/`"tabs"` of the container directly holding leaf `id`, or `null`. */
export function treeParentType(node: TreeNode | null | undefined, id: string): "row" | "column" | "tabs" | null;
/** Remove a leaf, collapsing emptied and one-child containers. */
export function treeRemove(node: TreeNode | null | undefined, id: string): TreeNode | null;
export function treeSwap(node: TreeNode | null | undefined, a: string, b: string): TreeNode | null;
/** Replace leaf `target` with a new row (`left`/`right`) or column (`top`/`bottom`) holding `id` on that side. */
export function treeSplit(tree: TreeNode | null | undefined, options: { id: string; target: string; side: "left" | "right" | "top" | "bottom"; ratio?: number }): TreeNode | null;
/** Add `id` as a tab right after `target`. */
export function treeAddTab(tree: TreeNode | null | undefined, options: { id: string; target: string }): TreeNode | null;
/** Insert `id` before or after `target` inside its `tabs` parent. */
export function treeInsertTab(tree: TreeNode | null | undefined, options: { id: string; target: string; position: "before" | "after" }): TreeNode | null;
/** Drop leaves not in `ids` and append the missing ones (a root with valid `sizes` keeps them; an appended child takes the mean weight). */
export function treeReconcile(tree: TreeNode | null | undefined, ids: string[]): TreeNode | null;
/** The container at comma-joined child indices (`""` is the root), or `null`. */
export function treeNodeAt(tree: TreeNode | null | undefined, path: string): TreeContainer | null;
/**
 * Resolve a splitter's rendered `path` against a stored tree, given the `shown` ids: `path` is the stored path of the same container,
 * `node` that container and `shown` the indices of its rendered children (dormant leaves, a minimized window's, are skipped and a
 * container with one rendered child collapses into it). `null` when `path` addresses no rendered container.
 */
export function treeResolveShown(
  tree: TreeNode | null | undefined,
  shown: ReadonlySet<string>,
  path: string,
): { path: string; node: TreeContainer; shown: number[] } | null;
/** Set the `sizes` of the container at `path` when the count matches. */
export function treeSetSizesAt(tree: TreeNode | null | undefined, path: string, weights: number[]): TreeNode | null;
/** Interpret the tree: rows/columns with weights, and `tabs` as a tabbed stack. */
export function treeToLayout(tree: TreeNode | null | undefined, context?: { focused?: string | null }): LayoutNode;
/** A flat container of `type`, a bare leaf for one id, or `null` for none. */
export function treeFrom(ids: string[], options?: { type?: "row" | "column" | "tabs" }): TreeNode | null;
/** The equivalent docking tree of a BSP tree. */
export function treeFromBsp(node: BspTree | null | undefined): TreeNode | null;
export function isTreeContainer(node: unknown): node is TreeContainer;
