/**
 * @johnhenry/window-algebra: everything pure (the layout algebra, transforms,
 * derived layouts, geometry, interaction math, state, commands, queries,
 * history, compile, the command palette's catalog) plus `createWindowManager`.
 * Runs in Node, workers and browsers.
 */
import type { LayoutNode, ViewNode } from "./types/tree.mjs";
import type {
  Bounds,
  BuiltInLayoutSpec,
  Config,
  Constraints,
  CreateStateOptions,
  Direction,
  DragMode,
  DropOp,
  DropZone,
  Layer,
  LayoutContext,
  LayoutInterpreter,
  LayoutModifier,
  LayoutSpec,
  Mode,
  OutputRecord,
  Placement,
  Point,
  Rect,
  Role,
  Rule,
  Size,
  State,
  Status,
  WindowInput,
  WindowRecord,
  WorkspaceInput,
  WorkspaceRecord,
} from "./types/state.mjs";
import type { Command, CommandType, CustomCommand } from "./types/commands.mjs";
import type { Effect, Event, ManagerEvent, UpdateEvent } from "./types/events.mjs";
import type { PresentationContext, RenderNode } from "./types/render.mjs";

export * from "./types/state.mjs";
export * from "./types/commands.mjs";
export * from "./types/events.mjs";
export * from "./types/tree.mjs";
export * from "./types/render.mjs";

// ------------------------------------------------------------------ algebra, transforms, layouts, css
export * from "./algebra/nodes.mjs";
export * from "./algebra/transforms.mjs";
export * from "./layouts/index.mjs";
export { compile, toHTML, styleText, tracks, px, anchorName, BASE_CSS, RULES_CSS, CHROME_CSS, THEME_CSS, THEME_TOKENS, SPLITTER_SIZE, tabId, panelId } from "./css/compile.mjs";
export type { ThemeToken } from "./css/compile.mjs";

// ------------------------------------------------------------------ geometry and interaction (pure)
export * as geometry from "./geometry/rect.mjs";

export type PopupSide = "top" | "bottom" | "left" | "right";
export interface PopupOptions {
  side?: PopupSide;
  align?: "start" | "center" | "end";
  offset?: number;
  gravity?: PopupSide;
  flip?: Array<"x" | "y">;
  slide?: Array<"x" | "y">;
  resize?: Array<"x" | "y">;
}
export interface PopupPlacement extends Rect {
  side: PopupSide;
  align: "start" | "center" | "end";
  gravity: PopupSide;
  flipped: { x: boolean; y: boolean };
  slid: { x: boolean; y: boolean };
  resized: { x: boolean; y: boolean };
  constrained: { x: boolean; y: boolean };
}
/** Wayland `xdg_positioner`-style placement of an anchored popup. */
export function positionPopup(anchorRect: Rect, popupSize: Size, stage: { x?: number; y?: number; width: number; height: number }, options?: PopupOptions): PopupPlacement;
export const POPUP_SIDES: readonly PopupSide[];

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const EDGES: readonly ResizeEdge[];
export interface DragSession {
  kind: "move";
  origin: Point;
  start: Rect;
}
export interface ResizeSession {
  kind: "resize";
  origin: Point;
  start: Rect;
  edge: ResizeEdge;
  constraints: Constraints;
}
export interface PinchSession {
  kind: "pinch";
  start: Rect;
  centroid: Point;
  distance: number;
  constraints: Constraints;
}
/** Begin a move: `origin` is the pointer, `bounds` the window rect. */
export function createDrag(options: { origin: Point; bounds: Rect }): DragSession;
/** The window position for a pointer position; `snap` rounds to a grid. */
export function updateDrag(drag: DragSession, pointer: Point, options?: { snap?: number }): Point;
/** Begin a resize from an edge or corner (throws `TypeError` for an unknown edge). */
export function createResize(options: { origin: Point; bounds: Rect; edge?: ResizeEdge; constraints?: Constraints }): ResizeSession;
export function updateResize(resize: ResizeSession, pointer: Point): Rect;
/** A split ratio after dragging a divider across `total` px, clamped to 0.05..0.95. */
export function updateRatio(session: { ratio: number; origin: Point; total: number }, pointer: Point, axis?: "x" | "y"): number;
/** Begin a two-finger resize. */
export function createPinch(options: { points: [Point, Point]; bounds: Rect; constraints?: Constraints; minSize?: number }): PinchSession;
/** The rect for two pointer positions: the size scales with the finger distance, the midpoint stays put. */
export function updatePinch(pinch: PinchSession, points: [Point, Point]): Rect;
/** Classify a finished stroke as a swipe. */
export function swipeOf(stroke: { dx: number; dy: number; duration?: number }, options?: { distance?: number; dominance?: number; maxDuration?: number }): "left" | "right" | "up" | "down" | null;
export const PINCH_MIN_SIZE: number;

export type SnapZone = "maximize" | "left" | "right" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export const SNAP_ZONES: readonly SnapZone[];
export interface SnapOptions {
  edges?: boolean;
  threshold?: number;
  zones?: "halves-quarters" | "halves" | "quarters" | "off" | false;
  magnet?: number;
}
export function snapZoneAt(stage: Rect, point: Point, options?: SnapOptions): SnapZone | null;
export function snapZoneRect(stage: Rect, zone: SnapZone): Rect | null;
export function magnetize(rect: Rect, others?: Rect[], options?: SnapOptions): Rect;
export function magnetizeResize(rect: Rect, others?: Rect[], edge?: ResizeEdge, options?: SnapOptions): Rect;

// ------------------------------------------------------------------ state
export const LAYERS: readonly Layer[];
export const ROLES: readonly Role[];
export const STATUSES: readonly Status[];
export const STATE_VERSION: number;
/** The id of the output every state starts with (`"primary"`). */
export const DEFAULT_OUTPUT: string;
export const DEFAULT_CONFIG: Readonly<Config>;
/** A fresh state. Throws `TypeError` when `workspaces` is empty. */
export function createState(options?: CreateStateOptions): State;
export function createWorkspace(input: WorkspaceInput): WorkspaceRecord;
export function createOutput(input: { id: string; workspaces?: string[]; activeWorkspace?: string }): OutputRecord;
/** Normalize a `window/create` payload into a window record (roles, layers and the active workspace decide defaults). */
export function createWindowRecord(input: WindowInput, state: State): WindowRecord;

export type MigrationResult =
  | { ok: true; state: State; version: number }
  | { ok: false; state: null; version?: number; reason: "invalid-state" | "future-version" | "no-migration-path" };
/** Upgrade a saved state to `STATE_VERSION`. Never throws. */
export function migrate(state: unknown): MigrationResult;
/** Migration steps keyed by the version they upgrade from. */
export const MIGRATIONS: Readonly<Record<number, (state: any) => any>>;

// ------------------------------------------------------------------ update
export interface UpdateResult {
  /** The next state; the same reference when nothing changed. */
  state: State;
  events: UpdateEvent[];
  effects: Effect[];
}
/** An extension handler: overrides (or adds) a command. A throw becomes a `handler-threw` rejection. */
export type CommandHandler<C = any> = (state: State, command: C) => { state: State; events?: Event[]; effects?: Effect[] };
export type Extensions = Record<string, CommandHandler>;

/** Apply one command. Unknown commands are rejected, never thrown. */
export function update(state: State, command: Command, extensions?: Extensions): UpdateResult;
/** A custom command, which needs the `extensions` that handle it. */
export function update(state: State, command: CustomCommand, extensions: Extensions): UpdateResult;
/** `update(...).state`. */
export function reduce(state: State, command: Command, extensions?: Extensions): State;
export function reduce(state: State, command: CustomCommand, extensions: Extensions): State;
/** Replay commands from a state (migrated first). */
export function replay(state: State, commands: ReadonlyArray<Command | CustomCommand>, extensions?: Extensions): State;
/** The 58 built-in command types, in the order the docs follow. */
export const COMMANDS: readonly CommandType[];

// ------------------------------------------------------------------ derive
export type LayoutRegistry = Record<string, LayoutInterpreter<any>>;
/** `(modifierSpec) => (interpreter) => interpreter`. */
export type ModifierFactory = (modifierSpec: LayoutModifier & Record<string, any>) => (interpreter: LayoutInterpreter<any>) => LayoutInterpreter<any>;
export type ModifierRegistry = Record<string, ModifierFactory>;

/** Derive an output's presentation tree (default: the focused output). */
export function derive(state: State, options?: { layouts?: LayoutRegistry; modifiers?: ModifierRegistry; output?: string }): LayoutNode;
/** The non-layout facts the renderer needs: focus, blocking, titles, modes, roles, direction. */
export function presentationContext(state: State): Required<PresentationContext>;
/** The built-in layout interpreters, keyed by spec type. */
export const LAYOUTS: Readonly<Record<BuiltInLayoutSpec["type"], LayoutInterpreter<any>>>;
export const MODIFIERS: Readonly<ModifierRegistry>;
export const MODIFIER_TYPES: readonly string[];
export function withModifiers(interpreter: LayoutInterpreter<any>, mods?: LayoutModifier[], registry?: ModifierRegistry): LayoutInterpreter<any>;
export function suppressesGaps(mods?: LayoutModifier[], context?: { tiledIds?: string[] }, registry?: Record<string, (mod: any, context: any) => boolean>): boolean;
/** Remap a zone-to-op map to match the axes `mirror`/`reflect-*` painted. */
export function applyModifiersToOps<T extends Partial<Record<DropZone, DropOp | null>>>(ops: T, mods?: LayoutModifier[]): T;
export function validModifiers(mods: unknown): mods is LayoutModifier[];

// ------------------------------------------------------------------ drops
export type ZoneOps = Partial<Record<DropZone, DropOp | null>>;
/** What dropping one tiled window onto another means for a layout type. */
export interface DropInterpreter {
  /** Maps each zone to an op for the target; `null` means the zone means nothing. */
  ops(spec: any, ids: string[], target: string): ZoneOps;
  /** Performs the op: the new tiled order and, for stateful layouts, the new spec. */
  apply?(spec: any, ids: string[], drop: { id: string; target: string; zone: DropZone; op: DropOp }): { ids: string[]; layout?: LayoutSpec };
}
export type DropRegistry = Record<string, DropInterpreter>;
export const DROPS: Readonly<DropRegistry>;
export const DROP_ZONES: readonly DropZone[];
export const DRAG_MODES: readonly DragMode[];
/** Build an order-based interpreter from the axis a target's neighbours sit along. */
export function orderDrops(axis: (spec: any, ids: string[], target: string) => "x" | "y" | "-x" | "-y" | "both"): DropInterpreter;
/** The `window/drop` command handler over a registry. */
export function createDropHandler(drops?: DropRegistry): CommandHandler;
/** The interpreter for a layout spec; `rtl` reads the zone-to-op map mirrored (zones are screen sides). */
export function dropInterpreterFor(drops: DropRegistry, spec: LayoutSpec | undefined, options?: { rtl?: boolean }): DropInterpreter;
/** A screen zone's mirror image in a right-to-left stage (`left` and `right` swap). */
export function mirrorZone(zone: DropZone): DropZone;
export function dragMode(state: State, workspaceId?: string): DragMode;
export function opAllowed(mode: DragMode, op: DropOp | null | undefined): boolean;
export function tiledOrder(state: State, workspaceId: string): string[];
export function isDroppable(state: State, win: WindowRecord): boolean;
/** The generic order edit: swap, or insert before/after the target. */
export function reorder(ids: string[], id: string, target: string, op: DropOp): string[];

/** Which zone of `rect` a point is in, or `null` outside it. */
export function dropZoneAt(rect: Rect, point: Point, edgeZone?: number): DropZone | null;
/** The rect of the part of a target a zone refers to. */
export function zoneRect(rect: Rect, zone: DropZone): Rect;
/** The drop under a pointer, or `null`. */
export function dropTargetAt(
  state: State,
  geometry: Record<string, Rect>,
  point: Point,
  draggedId: string,
  options?: { drops?: DropRegistry; allowFloating?: boolean },
): { target: string; zone: DropZone; op: DropOp } | null;
/** The state a drop would produce, or `null` when it would be rejected. */
export function previewDrop(
  state: State,
  drop: { id: string; target: string; zone: DropZone; geometry?: Record<string, Size> } | null | undefined,
  options?: { extensions?: Extensions },
): State | null;

// ------------------------------------------------------------------ queries
export function getWindow(state: State, id: string): WindowRecord | undefined;
export function activeWorkspace(state: State): WorkspaceRecord;
export function focusedOutput(state: State): OutputRecord;
export function outputsList(state: State): OutputRecord[];
export function outputActiveWorkspace(state: State, outputId?: string): string;
export function outputOf(state: State, workspaceId: string): string | undefined;
export function workspacesOf(state: State, outputId: string): WorkspaceRecord[];
export function focusedWindow(state: State): WindowRecord | undefined;
export function windowsIn(state: State, workspaceId?: string): WindowRecord[];
/** Sticky itself or through an ancestor. */
export function isSticky(state: State, win: WindowRecord): boolean;
export function isVisible(state: State, id: string): boolean;
export function visibleWindows(state: State, outputId?: string): WindowRecord[];
export function isPoppedOut(state: State, id: string): boolean;
export function poppedOutWindows(state: State): WindowRecord[];
export function scratchpadWindows(state: State): WindowRecord[];
export function isScratchpadHidden(state: State, id: string): boolean;
export function stickyWindows(state: State): WindowRecord[];
export function childrenOf(state: State, id: string): readonly WindowRecord[];
export function modalTarget(state: State, id: string): string;
export function isBlocked(state: State, id: string): boolean;
export function blockedWindows(state: State): string[];
export function urgentWindows(state: State): string[];
export function stackingOrder(state: State): string[];
export function isDescendantOf(state: State, id: string, ancestor: string): boolean;
export function fullscreenWindow(state: State, outputId?: string): WindowRecord | undefined;
export function presentedWindows(state: State, outputId?: string): WindowRecord[];
export function focusable(state: State, outputId?: string): string[];
export function descendantsOf(state: State, id: string): string[];
export function inTiledBase(state: State, win: WindowRecord): boolean;
export function paintOrder(state: State, outputId?: string): string[];
/** The stage's reading direction (`"ltr"` when `config.direction` is missing). */
export function directionOf(state: State): Direction;
export function isRtl(state: State): boolean;
/** What bounds floating windows (`"stage"` when `config.bounds` is missing). */
export function boundsOf(state: State): Bounds;
export function matchRules(state: State, win: Partial<WindowRecord> & { id: string }): number[];
export function validRules(rules: unknown): rules is Rule[];
export const MATCH_FIELDS: readonly string[];
export const SET_FIELDS: readonly string[];

// ------------------------------------------------------------------ history
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  limit: number;
}
export function createHistory<T>(present: T, options?: { limit?: number }): History<T>;
export function record<T>(history: History<T>, nextPresent: T): History<T>;
export function undo<T>(history: History<T>): History<T>;
export function redo<T>(history: History<T>): History<T>;
export function canUndo(history: History<unknown>): boolean;
export function canRedo(history: History<unknown>): boolean;

// ------------------------------------------------------------------ command palette (pure)
export type PaletteFieldKind = "window" | "workspace" | "output" | "new" | "text" | "number" | "boolean" | "choice" | "json" | "layout";
export interface PaletteField {
  name: string;
  kind: PaletteFieldKind;
  label: string;
  /** Optional fields are asked only when `ask` is set. */
  optional?: boolean;
  ask?: boolean;
  /** For `choice`. */
  choices?: readonly (string | number | boolean)[];
  /** For `window`: which windows are offered. */
  where?: "floating" | "tiled" | "shown" | "restorable" | "poppedOut" | "scratchpad" | "notScratchpad";
  /** For `new`: the id prefix. */
  prefix?: string;
  default?: unknown;
  /** For `json`: merge the parsed object into the command itself (`config/set`). */
  spread?: boolean;
}
export type PaletteRequirement = "window" | "windows2" | "focus" | "urgent" | "floating" | "tiled" | "restorable" | "poppedOut" | "scratchpad" | "workspace" | "workspaces2" | "outputs2";
export interface PaletteCatalogEntry {
  title: string;
  group: string;
  fields: readonly PaletteField[];
  requires?: readonly PaletteRequirement[];
  keywords?: string;
}
export interface PaletteEntry extends PaletteCatalogEntry {
  type: string;
  keywords: string;
  order: number;
  score: number;
  /** `[start, end)` index pairs into `title`, for highlighting. */
  ranges: Array<[number, number]>;
}
export interface PaletteChoice {
  value: string | number | boolean;
  label: string;
  detail: string;
}
/** One entry for each built-in command (a test keeps it equal to `COMMANDS`). */
export const COMMAND_CATALOG: Readonly<Record<CommandType, PaletteCatalogEntry>>;
export const REQUIREMENTS: Readonly<Record<PaletteRequirement, (state: State) => boolean>>;
/** The commands that make sense for a state, filtered and ranked by `query`. */
export function paletteEntries(state: State, options?: { query?: string; exclude?: string[]; catalog?: Record<string, PaletteCatalogEntry> }): PaletteEntry[];
export function isAvailable(state: State, type: string): boolean;
/** Subsequence match: `{ score, ranges }` or `null`. */
export function fuzzyMatch(query: string, text: string): { score: number; ranges: Array<[number, number]> } | null;
export function fieldChoices(state: State, field: PaletteField, options?: { layouts?: string[] }): PaletteChoice[] | null;
export function defaultValue(state: State, field: PaletteField): unknown;
export function isTextField(field: PaletteField): boolean;
export function parseField(field: PaletteField, input: unknown): { ok: true; value: unknown; skip?: undefined } | { ok: true; skip: true; value?: undefined } | { ok: false; error: string };
/** The command object for a catalog entry and the values collected for its fields. */
export function buildCommand(type: string, values?: Record<string, unknown>): { type: string; [field: string]: unknown };

// ------------------------------------------------------------------ the manager
/** Anything with `commit` can render; `measure` reports realized geometry. */
export interface Renderer {
  commit(renderTree: RenderNode, options?: { immediate?: boolean }): void;
  measure?(): Record<string, Rect>;
}
export type Scheduler = (task: () => void) => void;
export type Listener<C extends { type: string } = Command> = (state: State, events: Event[], command: C | null) => void;

export interface WindowManagerOptions<C extends { type: string } = never> {
  /** The initial state (default `createState()`). */
  state?: State;
  /** Extra or overriding layout interpreters, used by `derive` and by the `unknown-layout` check. */
  layouts?: LayoutRegistry;
  modifiers?: ModifierRegistry;
  /** Extra or overriding command handlers: the way to add commands of your own (their type goes in `C`). */
  extensions?: Extensions;
  drops?: DropRegistry;
  /** Renders the focused output. */
  renderer?: Renderer;
  /** One renderer per output id. */
  renderers?: Record<string, Renderer>;
  /** Commit scheduler (default: immediate). */
  schedule?: Scheduler;
  /** Enable undo/redo (a number is the limit; `true` is 100). */
  history?: boolean | number;
  /** Interpret every effect but `render`. */
  onEffect?: (effect: Effect, wm: WindowManager<C>) => void;
}

/** The imperative facade: `wm.focus("editor")` ergonomics over the pure core. */
export interface WindowManager<C extends { type: string } = never> {
  getState(): State;
  readonly state: State;
  /** Run a command: history, log, render and notification included. */
  dispatch(command: Command | C): UpdateResult;
  /** A dry run: what `dispatch` would return, without doing it. */
  simulate(command: Command | C, state?: State): UpdateResult;
  readonly drops: DropRegistry;
  readonly extensions: Extensions | undefined;
  subscribe(listener: Listener<Command | C>): () => void;
  /** Derived tree and compiled render tree for a state (default: the current one) and output. */
  present(state?: State, options?: { output?: string }): { tree: LayoutNode; render: RenderNode };
  render(command?: Command | C): void;
  setRenderer(outputId: string, renderer?: Renderer): void;
  measureOutput(outputId: string): Record<string, Rect>;
  /** Commands applied since `origin`, undone ones excluded. */
  readonly log: ReadonlyArray<Command | C>;
  /** The state `log` replays from. */
  readonly origin: State;
  measure(): Record<string, Rect>;

  create(options: Omit<import("./types/commands.mjs").WindowCreate, "type">): UpdateResult;
  close(id: string, rest?: Partial<Command>): UpdateResult;
  focus(id: string, rest?: Partial<Command>): UpdateResult;
  blur(): UpdateResult;
  focusNext(): UpdateResult;
  focusPrevious(): UpdateResult;
  focusUrgent(): UpdateResult;
  raise(id: string, rest?: Partial<Command>): UpdateResult;
  lower(id: string, rest?: Partial<Command>): UpdateResult;
  move(id: string, x: number | "center", y: number | "center"): UpdateResult;
  resize(id: string, width: number, height: number): UpdateResult;
  setMode(id: string, mode: Mode): UpdateResult;
  toggleFloating(id: string, rest?: Partial<Command>): UpdateResult;
  minimize(id: string, rest?: Partial<Command>): UpdateResult;
  maximize(id: string, rest?: Partial<Command>): UpdateResult;
  fullscreen(id: string, rest?: Partial<Command>): UpdateResult;
  restore(id: string, rest?: Partial<Command>): UpdateResult;
  toggleMaximize(id: string, rest?: Partial<Command>): UpdateResult;
  toggleFullscreen(id: string, rest?: Partial<Command>): UpdateResult;
  /** State only; use `attachPopouts` for the real popup. */
  popOut(id: string, rest?: Partial<Command>): UpdateResult;
  popIn(id: string, rest?: Partial<Command>): UpdateResult;
  promote(id: string, rest?: Partial<Command>): UpdateResult;
  swap(id: string, target: string): UpdateResult;
  drop(id: string, target: string, zone: DropZone, rest?: { geometry?: Record<string, Size>; gesture?: string }): UpdateResult;
  swapNext(id?: string): UpdateResult;
  swapPrevious(id?: string): UpdateResult;
  moveBefore(id?: string, target?: string): UpdateResult;
  moveAfter(id?: string, target?: string): UpdateResult;
  setDraggable(id: string, draggable?: boolean): UpdateResult;
  setUrgent(id: string, urgent?: boolean): UpdateResult;
  moveToWorkspace(id: string, workspace: string): UpdateResult;
  toScratchpad(id: string, rest?: Partial<Command>): UpdateResult;
  toggleScratchpad(id?: string): UpdateResult;
  setSticky(id: string, sticky?: boolean): UpdateResult;
  toggleSticky(id: string, rest?: Partial<Command>): UpdateResult;
  createWorkspace(id: string, options?: { layout?: LayoutSpec; output?: string; activate?: boolean }): UpdateResult;
  activateWorkspace(id: string, rest?: Partial<Command>): UpdateResult;
  createOutput(id: string, options?: { workspaces?: Array<string | { id: string; layout?: LayoutSpec }>; focus?: boolean }): UpdateResult;
  removeOutput(id: string, options?: { fallback?: string }): UpdateResult;
  focusOutput(id: string, rest?: Partial<Command>): UpdateResult;
  moveWorkspaceToOutput(id: string, output: string, options?: { activate?: boolean }): UpdateResult;
  setLayout(layout: LayoutSpec, workspace?: string): UpdateResult;
  setRatio(ratio: number, options?: { workspace?: string; id?: string }): UpdateResult;
  resizeSplit(path: string, change?: { delta?: number } | { weights?: number[] }, options?: { workspace?: string; index?: number }): UpdateResult;
  toggleLayout(a?: LayoutSpec, b?: LayoutSpec, workspace?: string): UpdateResult;
  setRules(rules: Rule[]): UpdateResult;

  /** Step back through history (needs the `history` option); returns the new state. */
  undo(): State;
  redo(): State;
  readonly canUndo: boolean;
  readonly canRedo: boolean;

  /** `JSON.stringify(getState())`. A function layout spec does not survive. */
  serialize(): string;
  /** Replace the state (a state object or JSON), migrated first. Returns the loaded state, or `null` after a `state/load-rejected` event. */
  load(state: State | string): State | null;
}

export function createWindowManager<C extends { type: string } = never>(options?: WindowManagerOptions<C>): WindowManager<C>;

export type { ManagerEvent };
