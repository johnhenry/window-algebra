/**
 * The effectful edge: a keyed DOM renderer, the pointer/keyboard/touch input
 * adapter, surfaces, schedulers, pop-outs, cross-tab sync, the command
 * palette and direction following. Importing this touches no DOM; calling
 * the functions does. These types use the DOM lib (`Element`, `Document`).
 */
import type {
  Command,
  CommandType,
  Effect,
  Event,
  Extensions,
  DropRegistry,
  LayoutNode,
  Point,
  Rect,
  RenderNode,
  Scheduler,
  State,
  UpdateResult,
  WindowManager,
  Renderer,
} from "../index.mjs";

// ------------------------------------------------------------------ surfaces

/** Anything displayable inside a view. The WM only ever calls `mount`/`unmount`. */
export interface Surface {
  kind?: string;
  mount(target: Element): void;
  unmount?(): void;
}
export type SurfaceFor = (id: string) => Surface | undefined;

export function htmlSurface(element: Element): Surface;
/** Build content on first mount; `render(target)` may return a cleanup function. */
export function lazySurface(render: (target: Element) => void | (() => void)): Surface;
export function iframeSurface(src: string, options?: { document?: Document; attributes?: Record<string, string> }): Surface;
/** A surface that repaints whenever the view's allocated size changes. */
export function canvasSurface(
  draw: (canvas: HTMLCanvasElement, size: { width: number; height: number; ratio: number }) => void,
  options?: { document?: Document },
): Surface & { canvas: HTMLCanvasElement };

/** A registry of surfaces by view id, usable as `surfaceFor`. */
export interface SurfaceRegistry extends SurfaceFor {
  set(id: string, surface: Surface): SurfaceRegistry;
  delete(id: string): boolean;
  has(id: string): boolean;
}
export function createSurfaceRegistry(initial?: Record<string, Surface>): SurfaceRegistry;

// ------------------------------------------------------------------ schedulers

/** Coalesce commits to one per frame (only the most recently scheduled task runs). */
export function createFrameScheduler(requestFrame?: (task: () => void) => unknown): Scheduler;
/** Run tasks immediately. */
export function immediateScheduler(task: () => void): void;

// ------------------------------------------------------------------ window chrome

/** A button the chrome can show. `"popout"` needs `attachPopouts` (`attachInput`'s `popouts`; `attachStage` wires it). */
export type ChromeButton = "minimize" | "maximize" | "float" | "popout" | "close";
/** The chrome's actions, for `icons` and `labels`: a toggle has two (`maximize`/`restore`, `float`/`dock`, `popout`/`popin`). */
export type ChromeAction = "minimize" | "maximize" | "restore" | "float" | "dock" | "popout" | "popin" | "close";

export interface ChromeOptions {
  /** Which buttons, in order; or a function of the window id. Default `DEFAULT_CHROME_BUTTONS`. */
  buttons?: ChromeButton[] | ((id: string) => ChromeButton[]);
  /** The icon slot at the start of the title bar: a node, or text. */
  icon?: (id: string) => Node | string | null | undefined;
  /** A glyph per action (text or a node), replacing the default characters. */
  icons?: Partial<Record<ChromeAction, Node | string>>;
  /** Accessible names per action, and `actions` for the button group (translation). */
  labels?: Partial<Record<ChromeAction | "actions", string>>;
  /** Return `false` to leave a window bare (a tooltip, a toast). */
  for?: (id: string) => boolean;
}

/** Every chrome button, in default order. */
export const CHROME_BUTTONS: readonly ChromeButton[];
/** The buttons `chrome: true` shows: minimize, maximize, float, close. */
export const DEFAULT_CHROME_BUTTONS: readonly ChromeButton[];
/** The default accessible names. */
export const DEFAULT_CHROME_LABELS: Readonly<Record<ChromeAction | "actions", string>>;

export interface ChromeHandle {
  /** The whole chrome; place it inside the window's view element. */
  frame: Element;
  /** The title bar (the `data-wm-handle="move"` drag handle). */
  bar: Element;
  /** Where the window's content goes. */
  body: Element;
  titleId: string;
  setTitle(title: string): void;
  setBarVisible(visible: boolean): void;
  /** Make the body focusable when (and only when) it scrolls. */
  syncScrollable(): void;
  dispose(): void;
}
/** Build one window's chrome markup. Most callers want `createDomRenderer({ chrome })` or `chromeSurface` instead. */
export function buildChrome(doc: Document, options?: ChromeOptions & { id?: string; title?: string }): ChromeHandle;
/** Set a window chrome's title and its buttons' accessible names, wherever the element lives now (a pop-out). */
export function setChromeTitle(element: Element, title: string): void;
export interface ChromeSurfaceOptions extends Omit<ChromeOptions, "buttons" | "for"> {
  id: string;
  title?: string;
  /** The content: fill the body element (optionally returning a cleanup), or a surface to mount into it. */
  body?: ((element: Element) => void | (() => void)) | Surface;
  /** When given, the title follows `state.windows[id].title`. */
  wm?: Pick<WindowManager<any>, "getState" | "subscribe">;
  buttons?: ChromeButton[];
  document?: Document;
}
/** Wrap one window's content in the built-in chrome, as a surface (for a custom renderer). */
export function chromeSurface(options: ChromeSurfaceOptions): Surface;

// ------------------------------------------------------------------ the DOM renderer

export interface DomRendererOptions {
  /** The host; the render tree is mounted inside it (it gets `data-wm-root`). */
  root: Element;
  surfaceFor?: SurfaceFor;
  document?: Document;
  /** Position anchored elements with JS when CSS anchors are unsupported (default: automatic). */
  anchorFallback?: boolean;
  /** Animate commits with the View Transitions API (a no-op where unsupported or under reduced motion). */
  animate?: boolean | { duration?: number | string; easing?: string };
  /**
   * Wrap every window's surface in the built-in window chrome (a title bar, buttons, resize grips): `true`, or
   * options. Off by default; styled by `CHROME_CSS`, which `BASE_CSS` includes.
   */
  chrome?: boolean | ChromeOptions;
}

export interface DomRenderer extends Renderer {
  readonly root: Element;
  /** Apply a render tree. With `immediate`, never inside a view transition. */
  commit(renderTree: RenderNode, options?: { immediate?: boolean }): void;
  /** Realized geometry of every primary view, relative to `root`. */
  measure(): Record<string, Rect>;
  elementFor(id: string): Element | undefined;
  /** Where a view's content mounts: its chrome body when `chrome` is on, else `elementFor(id)`. */
  bodyFor(id: string): Element | undefined;
  readonly anchorFallback: boolean;
  /** Re-run the JS anchor fallback. */
  reposition(): void;
  readonly animate: boolean;
  setAnimate(value: DomRendererOptions["animate"]): void;
  /** Detach a view's element and surface from the renderer's bookkeeping (used by pop-outs). */
  release(id: string): { element: Element; surface?: Surface } | undefined;
  /** The reverse of `release`. */
  adopt(id: string, element: Element, surface?: Surface): void;
  destroy(): void;
  /** Debug: the inline style text recorded for a key. */
  styleOf(key: string): string | undefined;
}
export function createDomRenderer(options: DomRendererOptions): DomRenderer;

// ------------------------------------------------------------------ input

export interface TouchOptions {
  /** Two touches on a floating window resize it (default `true`). */
  pinch?: boolean;
  /** `false` for none; default tab swipes on. Workspace swipes (two fingers) and window swipes (one finger, between the windows of a monocle or tabs stack) are off unless asked. */
  swipe?: boolean | { tabs?: boolean; workspaces?: boolean; windows?: boolean };
  /**
   * What a long press does: `true` dispatches a bubbling `wm-contextmenu` event on the window,
   * a function receives the press, a string is a command type dispatched as `{ type, id }`, `false` is off.
   */
  contextMenu?: boolean | CommandType | ((press: ContextPress) => void);
  /** ms a long press must hold still (default 500). */
  contextDelay?: number;
  /** px of drift that cancels a long press (default 10). */
  slop?: number;
  /** px for a tab or window swipe (default 48). */
  swipeDistance?: number;
  /** px for a two-finger workspace swipe (default 64). */
  workspaceSwipeDistance?: number;
}

export interface ContextPress {
  id: string;
  /** Relative to `root`. */
  x: number;
  y: number;
  clientX: number;
  clientY: number;
  pointerType: "touch" | "pen";
  target: Element;
}

export interface DragPreviewContext {
  phase: "update" | "end";
  overlay: Element;
  state: State;
  intent: unknown;
  drop: { id: string; target: string; zone: string; op?: string } | null;
  preview: State | null;
  geometry: Record<string, Rect> | null;
  point: Point | null;
}

export interface AttachInputOptions {
  root: Element;
  /** A window manager: shorthand for `getState`, `dispatch`, `subscribe`, `present`, `simulate` and `drops`. */
  wm?: WindowManager<any>;
  getState?: () => State;
  dispatch?: (command: Command) => UpdateResult | unknown;
  /** The manager's `subscribe`: enables focus sync and command announcements. */
  subscribe?: (listener: (state: State, events: Event[]) => void) => () => void;
  /** Bind this adapter to one output's stage (multi-output rigs). */
  output?: string;
  present?: (state: State) => { render: RenderNode };
  simulate?: (command: Command, state: State) => UpdateResult;
  drops?: DropRegistry;
  /** Snap floating moves to an n-px grid. */
  snap?: number;
  /** When to move DOM focus after a focus change (default: next animation frame). */
  afterRender?: Scheduler;
  /** px of travel before a press on a tiled handle or tab becomes a drag (default 5). */
  threshold?: number;
  /** ms a touch pointer must hold still to start a drag (default 400). */
  longPress?: number;
  /** The key for `toFloating`/`toTiled` "modifier" (default `"shift"`). */
  modifier?: "shift" | "alt" | "ctrl" | "meta";
  detachDistance?: number;
  dragPreview?: (context: DragPreviewContext) => void;
  /** Narrate drags and commands: `true` creates a live region, an element is used, a function receives each message. */
  announce?: boolean | Element | ((message: string) => void);
  /** Keyboard moving of the focused window (`true` uses `DEFAULT_MOVE_KEYS`) plus F6 focus cycling. */
  keyboard?: boolean | Record<string, CommandType>;
  /** Fraction of a pair's weight an arrow key nudges a focused splitter by (default 0.05). */
  splitterStep?: number;
  /** px a keyboard move/resize of a floating window changes it by (default 10). */
  floatStep?: number;
  /** An `attachPopouts` handle: a `window/pop-out` or `window/pop-in` button then opens or closes the real window. */
  popouts?: Pick<Popouts, "popOut" | "popIn">;
  /** Opt-in touch and pen gestures. `true` is pinch, tab swipes and the `wm-contextmenu` event. */
  touch?: boolean | TouchOptions;
}
/** Wire pointer, keyboard and touch events inside `root` to commands. Returns `detach`. */
export function attachInput(options: AttachInputOptions): () => void;
/** The keymap `keyboard: true` uses. Written for left-to-right; the left/right arrows swap under `rtl`. */
export const DEFAULT_MOVE_KEYS: Readonly<Record<string, CommandType>>;

// ------------------------------------------------------------------ pop-outs

export interface Popouts {
  popOut(id: string, options?: { name?: string; features?: string }): UpdateResult;
  popIn(id: string): UpdateResult;
  isPoppedOut(id: string): boolean;
  detach(): void;
}
export interface AttachPopoutsOptions {
  wm: WindowManager<any>;
  renderer: Pick<DomRenderer, "elementFor" | "release" | "adopt" | "root"> | { elementFor?(id: string): Element | undefined; release?(id: string): { element: Element; surface?: Surface } | undefined; adopt?(id: string, element: Element, surface?: Surface): void; root?: Element };
  surfaceFor?: SurfaceFor;
  /** Overridable `window.open`; a falsy or already-closed result simulates a popup blocker. */
  open?: (url?: string, name?: string, features?: string) => Window | null | undefined;
}
/** GoldenLayout/Dockview-style pop-out: move a window's DOM into a real browser window and back. */
export function attachPopouts(options: AttachPopoutsOptions): Popouts;

// ------------------------------------------------------------------ cross-tab sync

/** What `attachSync` needs of a channel: a `BroadcastChannel` fits. */
export interface SyncChannel {
  postMessage(message: unknown): void;
  addEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
  removeEventListener?(type: "message", listener: (event: { data: unknown }) => void): void;
  onmessage?: ((event: { data: unknown }) => void) | null;
  close?(): void;
}
export interface SyncInfo {
  direction: "in" | "out";
  clock: number;
  from: string;
  /** For `"in"`: whether the snapshot won and was applied. */
  applied?: boolean;
}
export interface AttachSyncOptions {
  wm: WindowManager<any>;
  /** A channel, or a name for `new BroadcastChannel(name)` (default `"window-algebra"`). */
  channel?: SyncChannel | string;
  /** This tab's id (default random); also the Lamport tie-break. */
  id?: string;
  /** How a gesture's stream of commands is coalesced before sending (default one snapshot per frame). */
  schedule?: Scheduler;
  onSync?: (info: SyncInfo) => void;
  onError?: (error: Error) => void;
  /**
   * Where `pagehide` / `pageshow` fire (default `globalThis` when it is an event target). On `pagehide` the tab
   * announces `bye` so peers stop counting it; on a back/forward-cache `pageshow` it says hello again. `false` opts out.
   */
  lifecycle?: EventTarget | false;
}
export interface Sync {
  readonly id: string;
  /** This tab's Lamport clock. */
  readonly clock: number;
  /** Tab ids heard from since attach and not yet gone. */
  peers(): string[];
  /** Send a pending gesture snapshot now. */
  flush(): void;
  detach(): void;
}
/** Keep the window managers of several tabs in step: state snapshots, last writer wins by Lamport clock. */
export function attachSync(options: AttachSyncOptions): Sync;
export const SYNC_CHANNEL: string;
/** The state as it goes over the wire (popped-out windows as minimized, function layouts as null, no `direction`). */
export function toSnapshot(state: State): State;
/** An incoming snapshot with this tab's local parts put back. */
export function fromSnapshot(snapshot: State, local: State): State;

// ------------------------------------------------------------------ command palette

export interface PaletteLabels {
  title: string;
  input: string;
  placeholder: string;
  empty: string;
  hint: string;
  count(n: number): string;
  options(n: number): string;
  done(title: string): string;
  rejected(reason: string): string;
}
export interface PaletteOptions {
  wm: WindowManager<any>;
  document?: Document;
  /** Where the dialog is mounted (default `document.body`). */
  host?: Element;
  /** Default `"Mod+Shift+P"` (`Mod` is Ctrl or Cmd); a list, or `false` for none. */
  shortcut?: string | string[] | false;
  /** Extra or replacement catalog entries. */
  catalog?: Record<string, import("../index.mjs").PaletteCatalogEntry>;
  /** Command types to hide. */
  exclude?: string[];
  /** Extra layout type names to offer. */
  layouts?: string[];
  /** With an `attachPopouts` handle, pop out/in open and close the real window. */
  popouts?: Pick<Popouts, "popOut" | "popIn">;
  labels?: Partial<PaletteLabels>;
  /** Return focus where it was on close (default `true`). */
  restoreFocus?: boolean;
  /** Add the theme and palette CSS to the document (default `true`). */
  injectStyles?: boolean;
}
export interface Palette {
  open(options?: { query?: string }): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
  /** The backdrop element. */
  readonly element: Element;
  detach(): void;
}
/** A WAI-ARIA combobox/listbox command palette for a window manager. */
export function createPalette(options: PaletteOptions): Palette;
export interface ParsedShortcut {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  mod: boolean;
}
export function parseShortcut(shortcut: string): ParsedShortcut;
export function matchesShortcut(parsed: ParsedShortcut, event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean;
export const PALETTE_CSS: string;

// ------------------------------------------------------------------ direction

/** `"rtl"`/`"ltr"` if the page says so for `element` (an explicit `dir`, or computed direction), else `undefined`. */
export function pageDirection(element: Element): "rtl" | "ltr" | undefined;
export interface DirectionHandle {
  direction(): "rtl" | "ltr" | undefined;
  refresh(): void;
  detach(): void;
}
/** Keep `config.direction` in step with the page's `dir`. */
export function attachDirection(options: { wm: WindowManager<any>; element: Element; observe?: boolean }): DirectionHandle;

export type { Effect, Extensions, LayoutNode };
