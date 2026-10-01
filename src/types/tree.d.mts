/**
 * The layout algebra: eleven primitives, options-first, deep-frozen and
 * JSON-serializable. A *node* is one of the shapes below.
 */
import type { Align, Axis, Side } from "./state.mjs";

export type ContainerKind = "row" | "column" | "grid" | "stack" | "overlay";
export type ModifierKind = "place" | "size" | "gap" | "inset" | "anchor";
export type NodeKind = "view" | ContainerKind | ModifierKind;

// ------------------------------------------------------------------ options

/** `row`/`column` options. `resize` makes `compile` render a splitter between each pair of children. */
export interface FlexOptions {
  /** Cross-axis alignment: a keyword or any `align-items` value. */
  align?: Align | "stretch" | (string & {});
  /** Main-axis distribution: any `justify-content` value. */
  distribute?: string;
  wrap?: boolean;
  resize?: { path: string; weights: number[] };
}

/** A grid track list: a count, an array (numbers are `fr`), an auto-fit object, or a CSS string. */
export type GridTracks = number | Array<number | string> | { repeat?: string; min?: number | string; max?: number | string } | string;

export interface GridOptions {
  columns?: GridTracks;
  rows?: GridTracks;
  /** `grid-template-areas`: one string per row, or one newline-separated string. */
  areas?: string[] | string;
  autoFlow?: string;
  autoRows?: GridTracks;
}

export interface StackOptions {
  /** The view id to show; inactive children stay mounted but hidden and inert. */
  active?: string;
  chrome?: "tabs";
}

export interface OverlayOptions {}

export interface PlaceOptions {
  area?: string;
  row?: string | number;
  column?: string | number;
  align?: Align | "stretch" | (string & {});
  /** A keyword aligns; a number or other string positions absolutely (measured from the inline-start edge). */
  x?: Align | "stretch" | "center" | number | (string & {});
  y?: Align | "stretch" | "center" | number | (string & {});
  /** `left`/`right` are the inline edges (they mirror under `rtl`). */
  top?: number | string;
  right?: number | string;
  bottom?: number | string;
  left?: number | string;
}

export interface SizeOptions {
  weight?: number;
  width?: number | "content" | "min-content" | "max-content" | "fit-content" | (string & {});
  height?: number | "content" | "min-content" | "max-content" | "fit-content" | (string & {});
  min?: number | string;
  max?: number | string;
  preferred?: number | string;
  minWidth?: number | string;
  maxWidth?: number | string;
  minHeight?: number | string;
  maxHeight?: number | string;
  aspectRatio?: number | string;
}

export interface GapOptions {
  all?: number | string;
  row?: number | string;
  column?: number | string;
  inner?: number | string;
  outer?: number | string;
}

export interface InsetOptions {
  all?: number | string;
  top?: number | string;
  right?: number | string;
  bottom?: number | string;
  left?: number | string;
  x?: number | string;
  y?: number | string;
}

export interface AnchorNodeOptions {
  /** The view id to anchor against. Required. */
  to: string;
  side?: Side;
  align?: Align;
  offset?: number;
  inside?: boolean;
  x?: Align | "stretch";
  y?: Align | "stretch";
  gravity?: Side;
  flip?: Axis[];
  slide?: Axis[];
  resize?: Axis[];
}

// ------------------------------------------------------------------ nodes

export interface ViewNode {
  readonly type: "view";
  readonly id: string;
}

export interface RowNode {
  readonly type: "row";
  readonly options: Readonly<FlexOptions>;
  readonly children: readonly LayoutNode[];
}
export interface ColumnNode {
  readonly type: "column";
  readonly options: Readonly<FlexOptions>;
  readonly children: readonly LayoutNode[];
}
export interface GridNode {
  readonly type: "grid";
  readonly options: Readonly<GridOptions>;
  readonly children: readonly LayoutNode[];
}
export interface StackNode {
  readonly type: "stack";
  readonly options: Readonly<StackOptions>;
  readonly children: readonly LayoutNode[];
}
export interface OverlayNode {
  readonly type: "overlay";
  readonly options: Readonly<OverlayOptions>;
  readonly children: readonly LayoutNode[];
}
export type ContainerNode = RowNode | ColumnNode | GridNode | StackNode | OverlayNode;

export interface PlaceNode {
  readonly type: "place";
  readonly options: Readonly<PlaceOptions>;
  readonly child: LayoutNode;
}
export interface SizeNode {
  readonly type: "size";
  readonly options: Readonly<SizeOptions>;
  readonly child: LayoutNode;
}
export interface GapNode {
  readonly type: "gap";
  readonly options: Readonly<GapOptions>;
  readonly child: LayoutNode;
}
export interface InsetNode {
  readonly type: "inset";
  readonly options: Readonly<InsetOptions>;
  readonly child: LayoutNode;
}
export interface AnchorNode {
  readonly type: "anchor";
  readonly options: Readonly<AnchorNodeOptions>;
  readonly child: LayoutNode;
}
export type ModifierNode = PlaceNode | SizeNode | GapNode | InsetNode | AnchorNode;

/** Any node of the layout algebra. */
export type LayoutNode = ViewNode | ContainerNode | ModifierNode;

/** A child argument: a node, nested arrays of them, or a dropped `null`/`undefined`/`false`. */
export type NodeChild = LayoutNode | null | undefined | false | readonly NodeChild[];

/** `validate`'s result. */
export type ValidationResult = { ok: true } | { ok: false; errors: Array<{ path: string; message: string }> };

export type OptionsOf<K extends ContainerKind | ModifierKind> = K extends "row" | "column"
  ? FlexOptions
  : K extends "grid"
    ? GridOptions
    : K extends "stack"
      ? StackOptions
      : K extends "overlay"
        ? OverlayOptions
        : K extends "place"
          ? PlaceOptions
          : K extends "size"
            ? SizeOptions
            : K extends "gap"
              ? GapOptions | number
              : K extends "inset"
                ? InsetOptions | number
                : K extends "anchor"
                  ? AnchorNodeOptions
                  : never;
