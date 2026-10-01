import type { WindowManager, WindowManagerOptions } from "../index.mjs";
import type { AttachInputOptions, AttachPopoutsOptions, AttachSyncOptions, ChromeOptions, DomRenderer, PaletteOptions, Palette, Popouts, Sync, SurfaceFor } from "../browser/index.mjs";
import type { Scheduler } from "../index.mjs";

export interface StageOptions {
  /** Use this manager as-is instead of creating one. */
  wm?: WindowManager<any>;
  /** Options for `createWindowManager` when `wm` is not given. */
  manager?: WindowManagerOptions<any>;
  anchorFallback?: boolean;
  surfaceFor?: SurfaceFor;
  /** The built-in window chrome (title bar, buttons, resize grips) around every window: `true`, or options. Off by default. */
  chrome?: boolean | ChromeOptions;
  /**
   * Pop-outs: `true`, or `attachPopouts` options. Switched on by itself when `chrome.buttons` is a list that
   * includes `"popout"`. Off otherwise.
   */
  popouts?: boolean | Omit<AttachPopoutsOptions, "wm" | "renderer">;
  /** Merged into `attachInput`'s options. */
  input?: Partial<Omit<AttachInputOptions, "root">>;
  /** When commits run after a state change (default one commit per frame). */
  schedule?: Scheduler;
  /** `true` or `attachSync` options: keep the stage in step with other tabs (off by default). */
  sync?: boolean | Omit<AttachSyncOptions, "wm">;
  /** `true` or `createPalette` options: a command palette for the stage's manager (off by default). */
  palette?: boolean | Omit<PaletteOptions, "wm">;
  /** Right-to-left: `"auto"` (default) follows an explicit `dir`; `"ltr"`/`"rtl"` set it once; `false` never touches it. */
  direction?: "auto" | "ltr" | "rtl" | false;
}

export interface Stage {
  wm: WindowManager<any>;
  renderer: DomRenderer;
  sync: Sync | null;
  palette: Palette | null;
  /** The pop-out handle, when `popouts` (or a `"popout"` chrome button) switched it on. */
  popouts: Popouts | null;
  detach(): void;
}

/** The reusable core of `<wa-stage>`: a manager, a DOM renderer and an input adapter on a host element. */
export function attachStage(host: Element, options?: StageOptions): Stage;

/** The class `defineWindowAlgebraElement` registers. */
export interface WindowAlgebraElement extends HTMLElement {
  /** Set (or replace) the stage options; re-attaches immediately if connected. */
  configure(options?: StageOptions): this;
  /** The live window manager while connected, `null` otherwise. */
  readonly wm: WindowManager<any> | null;
}
export interface CommandPaletteElement extends HTMLElement {
  configure(options?: PaletteOptions): this;
  wm: WindowManager<any> | null;
  open(options?: { query?: string }): void;
  close(): void;
  toggle(): void;
  readonly isOpen: boolean;
}

export interface ElementDeps {
  customElements?: { define(name: string, ctor: unknown): void; get?(name: string): unknown };
  HTMLElement?: unknown;
}
/** Define (and return) the `<wa-stage>` element class. Throws when there is no `customElements` registry. */
export function defineWindowAlgebraElement(name?: string, deps?: ElementDeps): { new (): WindowAlgebraElement };
/** Define (and return) the `<wa-palette>` element class. */
export function defineCommandPaletteElement(name?: string, deps?: ElementDeps): { new (): CommandPaletteElement };
