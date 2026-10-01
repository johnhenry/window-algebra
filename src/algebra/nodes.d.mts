import type {
  AnchorNode,
  AnchorNodeOptions,
  ColumnNode,
  ContainerKind,
  FlexOptions,
  GapNode,
  GapOptions,
  GridNode,
  GridOptions,
  InsetNode,
  InsetOptions,
  LayoutNode,
  ModifierKind,
  ModifierNode,
  ContainerNode,
  NodeChild,
  NodeKind,
  OptionsOf,
  OverlayNode,
  OverlayOptions,
  PlaceNode,
  PlaceOptions,
  RowNode,
  SizeNode,
  SizeOptions,
  StackNode,
  StackOptions,
  ValidationResult,
  ViewNode,
} from "../types/tree.mjs";

export type {
  AnchorNode,
  AnchorNodeOptions,
  ColumnNode,
  ContainerKind,
  ContainerNode,
  FlexOptions,
  GapNode,
  GapOptions,
  GridNode,
  GridOptions,
  GridTracks,
  InsetNode,
  InsetOptions,
  LayoutNode,
  ModifierKind,
  ModifierNode,
  NodeChild,
  NodeKind,
  OverlayNode,
  OverlayOptions,
  PlaceNode,
  PlaceOptions,
  RowNode,
  SizeNode,
  SizeOptions,
  StackNode,
  StackOptions,
  ValidationResult,
  ViewNode,
} from "../types/tree.mjs";

/** A presentation of a window or surface. Throws `TypeError` unless `id` is a non-empty string. */
export function view(id: string): ViewNode;

/** Horizontal composition (flexbox). Throws `TypeError` when `options` is not a plain object or a child is not a node. */
export function row(options: FlexOptions, ...children: NodeChild[]): RowNode;
/** Vertical composition (flexbox). */
export function column(options: FlexOptions, ...children: NodeChild[]): ColumnNode;
/** A two-dimensional constraint space (CSS Grid). */
export function grid(options: GridOptions, ...children: NodeChild[]): GridNode;
/** Children share one allocation, one shown at a time (`active`), optionally with a tab strip (`chrome: "tabs"`). */
export function stack(options: StackOptions, ...children: NodeChild[]): StackNode;
/** Children occupy independent layers of one region; later children are higher. */
export function overlay(options: OverlayOptions, ...children: NodeChild[]): OverlayNode;

/** Position within the parent's allocation, interpreted by the parent's kind. */
export function place(options: PlaceOptions, child: LayoutNode): PlaceNode;
/** Allocation constraints (weights, extents, min/max, aspect ratio). */
export function size(options: SizeOptions, child: LayoutNode): SizeNode;
/** Separation between a container's children. A number is `{ all: n }`. */
export function gap(options: GapOptions | number, child: LayoutNode): GapNode;
/** Padding around the wrapped allocation. A number is `{ all: n }`. */
export function inset(options: InsetOptions | number, child: LayoutNode): InsetNode;
/** Position the child relative to another view (CSS anchor positioning, or the JS fallback). `to` is required. */
export function anchor(options: AnchorNodeOptions, child: LayoutNode): AnchorNode;

/** The generic container constructor the named ones call. Throws on an unknown kind. */
export function container<K extends ContainerKind>(kind: K, options: OptionsOf<K>, children: readonly NodeChild[]): Extract<ContainerNode, { type: K }>;
/** The generic modifier constructor. Throws on an unknown kind. */
export function modifier<K extends ModifierKind>(kind: K, options: OptionsOf<K>, child: LayoutNode): Extract<ModifierNode, { type: K }>;

export function isNode(value: unknown): value is LayoutNode;
export function isContainer(node: unknown): node is ContainerNode;
export function isModifier(node: unknown): node is ModifierNode;
export function isView(node: unknown): node is ViewNode;

/** Check an arbitrary value (for example parsed JSON). Never throws. */
export function validate(tree: unknown): ValidationResult;
/** Validate a string or object and return a deep-frozen clone. Throws `TypeError` (invalid tree) or `SyntaxError` (bad JSON). */
export function fromJSON(json: string | object): LayoutNode;

export const NODE_KINDS: readonly NodeKind[];
export const CONTAINER_KINDS: readonly ContainerKind[];
export const MODIFIER_KINDS: readonly ModifierKind[];
