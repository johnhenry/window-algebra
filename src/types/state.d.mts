/**
 * The logical state and the vocabulary around it: records, layout specs,
 * configuration. Plain JSON-serializable data throughout.
 */
import type { LayoutNode } from "./tree.mjs";

/** A rectangle in CSS pixels. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Stacking layers, bottom to top. */
export type Layer = "background" | "normal" | "top" | "modal" | "popover" | "notification" | "system";
/** Semantic roles; `derive` decides how each is presented. */
export type Role = "window" | "dialog" | "sheet" | "popover" | "menu" | "tooltip" | "panel" | "notification";
export type Status = "normal" | "minimized" | "maximized" | "fullscreen" | "popped-out";
export type Mode = "tiled" | "floating";
export type Direction = "ltr" | "rtl";
export type DropZone = "center" | "left" | "right" | "top" | "bottom";
/** What a drop does: exchange slots, move before/after, split (BSP, tree) or add as a tab (tree). */
export type DropOp = "swap" | "before" | "after" | "split" | "tab";
export type DragMode = "swap-or-insert" | "swap" | "insert" | "off";

/** A coordinate: pixels, a CSS length, or `"center"`. */
export type Coordinate = number | string;

/** A window's requested geometry. `x` is measured from the inline-start edge (the right edge under `rtl`). */
export interface Placement {
  x: Coordinate;
  y: Coordinate;
  width: number;
  height: number;
}

export interface AspectRatioRange {
  min?: number;
  max?: number;
}

/** Size hints (ICCCM `WM_NORMAL_HINTS` style). */
export interface Constraints {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  baseWidth?: number;
  baseHeight?: number;
  widthIncrement?: number;
  heightIncrement?: number;
  /** width / height, exact or as a range. */
  aspectRatio?: number | AspectRatioRange;
}

export type Side = "top" | "bottom" | "left" | "right";
export type Align = "start" | "center" | "end";
export type Axis = "x" | "y";

/** Anchor options of a popover-like window (see the `anchor` modifier). */
export interface AnchorOptions {
  to?: string;
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

/** A window record (what `window/create` normalizes its payload into). */
export interface WindowRecord {
  id: string;
  title: string;
  role: Role;
  parent: string | null;
  modal: boolean;
  mode: Mode;
  placement: Placement;
  constraints: Constraints;
  status: Status;
  layer: Layer;
  anchor: AnchorOptions | null;
  /** The workspace id, or `null` while hidden in the scratchpad. */
  workspace: string | null;
  /** Application data, never read by the library. Present only when given. */
  data?: unknown;
  /** Only the `false` exception is stored: a pinned window. */
  draggable?: false;
  /** An application or window-class id, matched by rules. */
  app?: string;
  /** Visible on every workspace of its output. */
  sticky?: true;
  scratchpad?: true;
}

// ------------------------------------------------------------------ layouts

export type LayoutModifier =
  | { type: "smart-gaps" }
  | { type: "no-gaps" }
  | { type: "mirror" }
  | { type: "reflect-x" }
  | { type: "reflect-y" }
  | { type: "max-windows"; n?: number }
  | { type: string; [option: string]: unknown };

interface SpecBase {
  modifiers?: LayoutModifier[];
  /** Overrides `config.drag.tiled` for this workspace. */
  drag?: DragMode;
}

export interface MasterStackSpec extends SpecBase {
  type: "master-stack";
  ratio?: number;
  masterCount?: number;
  /** `"left"`/`"right"` are the inline start/end: the master is on the right under `rtl` unless `side: "right"`. */
  side?: "left" | "right";
}

export interface ColumnsSpec extends SpecBase {
  type: "columns";
  /** Weights per child, keyed by the container path (`""` is the root). Written by `layout/resize-split`. */
  sizes?: Record<string, number[]>;
  align?: string;
  distribute?: string;
}

export interface RowsSpec extends SpecBase {
  type: "rows";
  sizes?: Record<string, number[]>;
  align?: string;
  distribute?: string;
}

export interface MonocleSpec extends SpecBase {
  type: "monocle";
  active?: string;
}

export interface TabsSpec extends SpecBase {
  type: "tabs";
  active?: string;
}

export interface GridSpec extends SpecBase {
  type: "grid";
  /** With `columns`, a fixed grid; without, a responsive auto-fit grid. */
  columns?: number;
  rows?: number;
  min?: number | string;
  max?: number | string;
  repeat?: "auto-fit" | "auto-fill";
}

export interface SpiralSpec extends SpecBase {
  type: "spiral";
  ratio?: number;
  /** Per-depth ratios (0 is the outermost split). */
  ratios?: number[];
}

export type BspTree = BspLeaf | BspSplit;
export interface BspLeaf {
  type: "leaf";
  id: string;
}
export interface BspSplit {
  type: "split";
  /** "horizontal" is side by side (a row), "vertical" is stacked (a column). */
  direction: "horizontal" | "vertical";
  ratio: number;
  first: BspTree;
  second: BspTree;
}

export interface BspSpec extends SpecBase {
  type: "bsp";
  tree?: BspTree | null;
}

/** A docking-tree node: a window id, or a row/column/tabs container. */
export type TreeNode = string | TreeContainer;
export interface TreeContainer {
  type: "row" | "column" | "tabs";
  children: TreeNode[];
  sizes?: number[];
}

export interface TreeSpec extends SpecBase {
  type: "tree";
  tree?: TreeNode | null;
  /** `"swap"`: a drop on the center exchanges leaves instead of adding a tab. */
  tabMode?: "swap" | "tab";
}

export interface FloatingSpec extends SpecBase {
  type: "floating";
}

export type BuiltInLayoutSpec =
  | MasterStackSpec
  | ColumnsSpec
  | RowsSpec
  | MonocleSpec
  | TabsSpec
  | GridSpec
  | SpiralSpec
  | BspSpec
  | TreeSpec
  | FloatingSpec;

/** A layout registered under another `type` through the manager's (or `derive`'s) `layouts` option. */
export interface CustomLayoutSpec extends SpecBase {
  type: string;
  [option: string]: unknown;
}

/** What `derive` hands an interpreter besides the spec and the tiled ids. */
export interface LayoutContext {
  state: State;
  workspace: WorkspaceRecord;
  focused: string | null;
}

/** A layout interpreter: `(spec, tiledIds, context) → tree`. A function as a workspace's layout is used directly. */
export type LayoutInterpreter<Spec = LayoutSpec> = (spec: Spec, ids: string[], context: LayoutContext) => LayoutNode;

export type LayoutSpec = BuiltInLayoutSpec | CustomLayoutSpec | LayoutInterpreter<any>;

// ------------------------------------------------------------------ records

export interface WorkspaceRecord {
  id: string;
  /** The workspace order: order-based layouts read its tiled subset. */
  windows: string[];
  layout: LayoutSpec;
  output: string;
  /** Present after the first `layout/toggle`. */
  toggleLayouts?: [LayoutSpec, LayoutSpec];
}

export interface OutputRecord {
  id: string;
  workspaces: string[];
  activeWorkspace: string;
}

// ------------------------------------------------------------------ rules

export interface RuleMatch {
  role?: Role;
  id?: string;
  idPrefix?: string;
  title?: string;
  /** A regex source string, compiled on every check so rules stay serializable. */
  titleRegex?: string;
  app?: string;
  parent?: string;
}

export interface RuleSet {
  mode?: Mode;
  layer?: Layer;
  workspace?: string;
  placement?: Partial<Placement>;
  status?: Status;
  draggable?: boolean;
  constraints?: Constraints;
  anchor?: AnchorOptions | null;
}

export interface Rule {
  match?: RuleMatch;
  set?: RuleSet;
}

// ------------------------------------------------------------------ config

export interface DragConfig {
  tiled: DragMode;
  edgeZone: number;
  preview: boolean;
  tooSmall: "allow" | "reject";
  toFloating: "modifier" | "threshold" | "off";
  toTiled: "modifier" | "always" | "off";
  crossWorkspace: boolean;
  follow: boolean;
}

export type SnapZones = "halves-quarters" | "halves" | "quarters" | "off";

export interface SnapConfig {
  edges: boolean;
  threshold: number;
  magnet: number;
  zones: SnapZones;
}

export interface Config {
  /** Reading direction. May be missing on an old saved state: read it as `"ltr"` (`directionOf`). */
  direction: Direction;
  focusRaises: boolean;
  gap: number;
  inset: number;
  defaultPlacement: Placement;
  drag: DragConfig;
  rules: Rule[];
  urgency: { clearOnFocus: boolean };
  snap: SnapConfig;
}

/** What `createState({ config })` accepts: any subset, the nested objects merged one level deep. */
export type ConfigInput = Partial<Omit<Config, "drag" | "urgency" | "snap">> & {
  drag?: Partial<DragConfig>;
  urgency?: Partial<Config["urgency"]>;
  snap?: Partial<SnapConfig>;
};

/** What `config/set` accepts: the same shape. */
export type ConfigPatch = ConfigInput;

// ------------------------------------------------------------------ state

export interface State {
  /** `STATE_VERSION`; `migrate` upgrades older ones. */
  version: number;
  config: Config;
  windows: Record<string, WindowRecord>;
  workspaces: Record<string, WorkspaceRecord>;
  /** Every workspace id, in creation order. */
  workspaceOrder: string[];
  /** Mirrors `outputs[focusedOutput].activeWorkspace`. */
  activeWorkspace: string;
  outputs: Record<string, OutputRecord>;
  outputOrder: string[];
  focusedOutput: string;
  focus: { window: string | null; history: string[] };
  /** Stacking order within each layer, bottom to top. */
  stack: Record<Layer, string[]>;
  /** The default target of `scratchpad/toggle` with no id. */
  lastScratchpad: string | null;
  /** Urgent window ids, oldest first. */
  urgent: string[];
}

export interface WorkspaceInput {
  id: string;
  layout?: LayoutSpec;
  windows?: string[];
  output?: string;
}

export interface CreateStateOptions {
  /** Workspace ids, or `{ id, layout }` objects. Default `["main"]`; at least one is required. */
  workspaces?: Array<string | WorkspaceInput>;
  /** The default layout for workspaces given by id. */
  layout?: LayoutSpec;
  config?: ConfigInput;
}

/** The input of `createWindowRecord` (a `window/create` payload without its `type`). */
export interface WindowInput {
  id: string;
  title?: string;
  role?: Role;
  parent?: string | null;
  modal?: boolean;
  mode?: Mode;
  placement?: Partial<Placement>;
  constraints?: Constraints;
  layer?: Layer;
  anchor?: AnchorOptions | null;
  workspace?: string;
  data?: unknown;
  draggable?: boolean;
  app?: string;
}
