import type { LayoutNode, ViewNode } from "../types/tree.mjs";

/** Bottom-up structural map: `fn(node, path)` sees each node after its children were mapped. Returning `null` removes the node. */
export function transform(tree: LayoutNode, fn: (node: LayoutNode, path: string) => LayoutNode | null, path?: string): LayoutNode;
/** Depth-first pre-order traversal. */
export function walk(tree: LayoutNode, fn: (node: LayoutNode, path: string, parent: LayoutNode | null) => void, path?: string, parent?: LayoutNode | null): void;
/** Reduce over every node in pre-order. */
export function fold<T>(tree: LayoutNode, fn: (acc: T, node: LayoutNode, path: string, parent: LayoutNode | null) => T, initial: T): T;
/** View ids in document order, duplicates preserved. */
export function views(tree: LayoutNode): string[];
/** The first node matching a predicate, or the view with that id. */
export function find(tree: LayoutNode, predicate: string | ((node: LayoutNode) => boolean)): LayoutNode | undefined;
/** Map every view through `fn`. */
export function mapViews(tree: LayoutNode, fn: (view: ViewNode) => LayoutNode): LayoutNode;
/** Replace nodes matching `predicate` (a function or a view id). */
export function replace(tree: LayoutNode, predicate: string | ((node: LayoutNode) => boolean), replacement: LayoutNode | ((node: LayoutNode) => LayoutNode)): LayoutNode;
/** Remove every occurrence of a view. */
export function remove(tree: LayoutNode, id: string): LayoutNode;
/** Reverse the children of every row (left-right reflection). */
export function mirror(tree: LayoutNode): LayoutNode;
/** Reverse the children of every column (top-bottom reflection). */
export function flip(tree: LayoutNode): LayoutNode;
/** A quarter turn: every row becomes a column and vice versa. */
export function rotate(tree: LayoutNode): LayoutNode;
/** Reverse the children of every container. */
export function reverse(tree: LayoutNode): LayoutNode;
/** Swap two view ids wherever they appear. */
export function swap(tree: LayoutNode, a: string, b: string): LayoutNode;
/** The number of nodes. */
export function count(tree: LayoutNode): number;
/** Structural equality (JSON comparison: option key order matters). */
export function equals(a: LayoutNode, b: LayoutNode): boolean;
