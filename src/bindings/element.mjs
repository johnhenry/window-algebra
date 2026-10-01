/**
 * A framework-agnostic custom element: `<wa-stage>` owns a window manager,
 * a `createDomRenderer`, and `attachInput`, wired together for as long as
 * the element is connected. Any app that can register a custom element can
 * host a window-algebra stage this way, with no framework and no
 * dependency beyond the platform's own Custom Elements API.
 *
 * `attachStage(host, options)` below is the reusable, DOM-shaped core (it
 * only needs `host.ownerDocument` and the usual Element methods — the real
 * DOM, or the fake one under test/helpers/fake-dom.mjs). The custom element
 * class is a thin lifecycle wrapper around it, kept separate so the wiring
 * can be unit-tested without a real `customElements` registry.
 */
import { attachStage } from "./stage.mjs";
import { createPalette } from "../browser/palette.mjs";

export { attachStage };

/**
 * Defines (and returns) a `<name>` custom element class. Call `.configure(options)`
 * on an instance (any time — before or after it is connected) to set or
 * replace its window manager and renderer/input options; omit it to get a
 * plain default-configured stage. The element exposes the handles `attachStage`
 * made, live for as long as it is connected (`null` otherwise): `.wm`, `.renderer`,
 * `.palette` and `.sync` (each also `null` when its option is off), and `.popouts`.
 *
 * @param {string} [name] tag name, must contain a hyphen
 * @param {object} [deps] for testing outside a browser: `{ customElements, HTMLElement }`
 */
export const defineWindowAlgebraElement = (
  name = "wa-stage",
  { customElements: registry = globalThis.customElements, HTMLElement: Base = globalThis.HTMLElement } = {},
) => {
  if (!registry || !Base) {
    throw new Error(
      "defineWindowAlgebraElement: no customElements registry / HTMLElement available; pass { customElements, HTMLElement } explicitly outside a browser",
    );
  }

  const existing = registry.get?.(name);
  if (existing) return existing;

  class WindowAlgebraStage extends Base {
    #stage = null;
    #options = {};

    connectedCallback() {
      this.#stage = attachStage(this, this.#options);
    }

    disconnectedCallback() {
      this.#stage?.detach();
      this.#stage = null;
    }

    /** Set (or replace) this stage's options; re-attaches immediately if already connected. */
    configure(options) {
      this.#options = options ?? {};
      if (this.#stage) {
        this.#stage.detach();
        this.#stage = attachStage(this, this.#options);
      }
      return this;
    }

    /** The live window manager, or `null` while disconnected. */
    get wm() {
      return this.#stage?.wm ?? null;
    }

    /** The live DOM renderer, or `null` while disconnected. */
    get renderer() {
      return this.#stage?.renderer ?? null;
    }

    /**
     * The command palette handle (`open()`, `close()`, `toggle()`, `isOpen`) when the `palette` option is on,
     * else `null`; `null` too while disconnected. A button can call `stage.palette?.open()`.
     */
    get palette() {
      return this.#stage?.palette ?? null;
    }

    /**
     * The cross-tab sync handle (`peers()`, `flush()`, `detach()`, ...) when the `sync` option is on, else
     * `null`; `null` too while disconnected.
     */
    get sync() {
      return this.#stage?.sync ?? null;
    }

    /** The `attachPopouts` handle when the stage has one (see `popouts` and `chrome` options), else `null`. */
    get popouts() {
      return this.#stage?.popouts ?? null;
    }
  }

  registry.define(name, WindowAlgebraStage);
  return WindowAlgebraStage;
};

/**
 * Defines (and returns) a `<name>` custom element (default `wa-palette`) that
 * hosts a command palette: `el.configure({ wm, shortcut, ... })` (or `el.wm = wm`)
 * once, then it opens on the shortcut, or with `el.open()`, `el.close()` and
 * `el.toggle()`. The palette lives as long as the element is connected. Pass
 * `options` (anything `createPalette` takes) through `configure`.
 *
 * @param {string} [name] tag name, must contain a hyphen
 * @param {object} [deps] for testing outside a browser: `{ customElements, HTMLElement }`
 */
export const defineCommandPaletteElement = (
  name = "wa-palette",
  { customElements: registry = globalThis.customElements, HTMLElement: Base = globalThis.HTMLElement } = {},
) => {
  if (!registry || !Base) {
    throw new Error(
      "defineCommandPaletteElement: no customElements registry / HTMLElement available; pass { customElements, HTMLElement } explicitly outside a browser",
    );
  }
  const existing = registry.get?.(name);
  if (existing) return existing;

  class CommandPaletteElement extends Base {
    #palette = null;
    #options = {};
    #connected = false;

    connectedCallback() {
      this.#connected = true;
      this.#mount();
    }

    disconnectedCallback() {
      this.#connected = false;
      this.#palette?.detach();
      this.#palette = null;
    }

    #mount() {
      this.#palette?.detach();
      this.#palette = this.#options.wm ? createPalette({ document: this.ownerDocument, ...this.#options }) : null;
    }

    /** Set (or replace) the palette's options (`wm` is required); re-mounts immediately if connected. */
    configure(options) {
      this.#options = options ?? {};
      if (this.#connected) this.#mount();
      return this;
    }

    set wm(wm) {
      this.configure({ ...this.#options, wm });
    }

    get wm() {
      return this.#options.wm ?? null;
    }

    open(options) {
      this.#palette?.open(options);
    }

    close() {
      this.#palette?.close();
    }

    toggle() {
      this.#palette?.toggle();
    }

    get isOpen() {
      return this.#palette?.isOpen ?? false;
    }
  }

  registry.define(name, CommandPaletteElement);
  return CommandPaletteElement;
};
