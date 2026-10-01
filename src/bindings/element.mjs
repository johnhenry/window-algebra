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
import { createWindowManager } from "../manager.mjs";
import { createDomRenderer } from "../browser/dom.mjs";
import { attachInput } from "../browser/input.mjs";
import { createFrameScheduler } from "../browser/scheduler.mjs";

/**
 * @param {Element} host mount point (usually the custom element itself)
 * @param {object} [options]
 * @param {object} [options.wm] a window manager to use as-is, instead of creating one
 * @param {object} [options.manager] options forwarded to `createWindowManager` when `wm` is not given
 * @param {boolean} [options.anchorFallback] forwarded to `createDomRenderer`
 * @param {(id: string) => object} [options.surfaceFor] forwarded to `createDomRenderer`
 * @param {object} [options.input] extra options merged into `attachInput`
 * @param {(task: () => void) => void} [options.schedule] when commits run after a state change; default
 *   `createFrameScheduler()` (many commands, one commit per frame). Pass `immediateScheduler` to commit synchronously.
 * @returns {{ wm: object, renderer: object, detach(): void }}
 */
export const attachStage = (host, options = {}) => {
  const { wm = createWindowManager(options.manager), anchorFallback, surfaceFor, input, schedule = createFrameScheduler() } = options;
  const renderer = createDomRenderer({ root: host, document: host.ownerDocument, anchorFallback, surfaceFor });
  let live = true;
  const commit = () => live && renderer.commit(wm.present().render);
  commit();
  const unsubscribe = wm.subscribe(() => schedule(commit));
  const detachInput = attachInput({ root: host, wm, ...input });
  return {
    wm,
    renderer,
    detach() {
      live = false; // a commit still queued for the next frame must not touch the torn-down renderer
      unsubscribe();
      detachInput();
      renderer.destroy?.();
    },
  };
};

/**
 * Defines (and returns) a `<name>` custom element class. Call `.configure(options)`
 * on an instance (any time — before or after it is connected) to set or
 * replace its window manager and renderer/input options; omit it to get a
 * plain default-configured stage. The element exposes `.wm`, live for as
 * long as it is connected (`null` otherwise).
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
  }

  registry.define(name, WindowAlgebraStage);
  return WindowAlgebraStage;
};
