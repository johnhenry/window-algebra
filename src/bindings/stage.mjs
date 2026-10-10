/**
 * `attachStage(host, options)`: the reusable, DOM-shaped core behind `<wa-stage>` and the React `WindowManagerStage`.
 * It wires a window manager, a `createDomRenderer`, `attachInput`, and the optional extras (cross-tab `sync`, a
 * command `palette`, pop-outs, direction following) onto a host element, and returns every handle it made so
 * a caller can reach them. It only needs `host.ownerDocument` and the usual Element methods (the real DOM, or the
 * fake one under test/helpers/fake-dom.mjs).
 */
import { createWindowManager } from "../manager.mjs";
import { createDomRenderer } from "../browser/dom.mjs";
import { attachInput } from "../browser/input.mjs";
import { createFrameScheduler } from "../browser/scheduler.mjs";
import { attachSync } from "../browser/sync.mjs";
import { createPalette } from "../browser/palette.mjs";
import { attachDirection } from "../browser/direction.mjs";
import { attachPopouts } from "../browser/popouts.mjs";
import { DEFAULT_CHROME_BUTTONS } from "../browser/chrome.mjs";

/**
 * @param {Element} host mount point (usually the custom element itself)
 * @param {object} [options]
 * @param {object} [options.wm] a window manager to use as-is, instead of creating one
 * @param {object} [options.manager] options forwarded to `createWindowManager` when `wm` is not given
 * @param {boolean} [options.anchorFallback] forwarded to `createDomRenderer`
 * @param {boolean|object} [options.chrome] built-in window chrome (title bar, buttons, resize grips) around every
 *   window's surface: `true`, or `{ buttons, icon, icons, labels, for }` as for `createDomRenderer`. Off by default.
 * @param {boolean|object} [options.popouts] pop-outs: `true`, or options for `attachPopouts` (`open`). Switched on
 *   by itself when `chrome.buttons` is a list that includes `"popout"`, since that button needs it. Off otherwise.
 * @param {(id: string) => object} [options.surfaceFor] forwarded to `createDomRenderer`
 * @param {object} [options.input] extra options merged into `attachInput`
 * @param {boolean|object} [options.sync] keep this stage's window manager in step with other tabs: `true`, or
 *   options for `attachSync` (`channel`, `id`, ...). Off by default.
 * @param {"auto"|"ltr"|"rtl"|false} [options.direction] right-to-left layout: `"auto"` (default) follows an explicit
 *   `dir` on the stage or any ancestor (an element with no `dir` anywhere leaves `config.direction` as it is);
 *   `"ltr"`/`"rtl"` set it once; `false` never touches it.
 * @param {boolean|object} [options.palette] a command palette (Ctrl/Cmd+Shift+P) for this stage's window
 *   manager: `true`, or options for `createPalette` (`shortcut`, `exclude`, ...). Off by default.
 * @param {{ toStage(clientX: number, clientY: number): { x: number, y: number }, scale?: () => number }} [options.coordinates]
 *   a stage the application transforms (a pannable, zoomable canvas): forwarded to `createDomRenderer` and
 *   `attachInput` (see `browser/coordinates.mjs`).
 * @param {(task: () => void) => void} [options.schedule] when commits run after a state change; default
 *   `createFrameScheduler()` (many commands, one commit per frame). Pass `immediateScheduler` to commit synchronously.
 * @returns {{ wm: object, renderer: object, sync: object|null, palette: object|null, popouts: object|null, detach(): void }}
 */
export const attachStage = (host, options = {}) => {
  const { wm = createWindowManager(options.manager), anchorFallback, surfaceFor, input, sync, palette, chrome, popouts, direction = "auto", schedule = createFrameScheduler(), coordinates } = options;
  if (direction === "ltr" || direction === "rtl") {
    if (wm.getState().config?.direction !== direction) wm.dispatch({ type: "config/set", direction });
  }
  const directionHandle = direction === "auto" ? attachDirection({ wm, element: host }) : null;
  const renderer = createDomRenderer({ root: host, document: host.ownerDocument, anchorFallback, surfaceFor, chrome, ...(coordinates ? { coordinates } : {}) });
  let live = true;
  const commit = () => live && renderer.commit(wm.present().render);
  commit();
  const unsubscribe = wm.subscribe(() => schedule(commit));
  const wantsPopouts = popouts || (chrome && Array.isArray(chrome.buttons ?? DEFAULT_CHROME_BUTTONS) && (chrome.buttons ?? DEFAULT_CHROME_BUTTONS).includes("popout"));
  const popoutsHandle = wantsPopouts ? attachPopouts({ wm, renderer, ...(popouts === true ? {} : popouts) }) : null;
  const detachInput = attachInput({ root: host, wm, ...(popoutsHandle ? { popouts: popoutsHandle } : {}), ...(coordinates ? { coordinates } : {}), ...input });
  const syncHandle = sync ? attachSync({ wm, ...(sync === true ? {} : sync) }) : null;
  const paletteHandle = palette ? createPalette({ wm, document: host.ownerDocument, ...(popoutsHandle ? { popouts: popoutsHandle } : {}), ...(palette === true ? {} : palette) }) : null;
  return {
    wm,
    renderer,
    sync: syncHandle,
    palette: paletteHandle,
    popouts: popoutsHandle,
    detach() {
      popoutsHandle?.detach();
      syncHandle?.detach();
      paletteHandle?.detach();
      directionHandle?.detach();
      live = false; // a commit still queued for the next frame must not touch the torn-down renderer
      unsubscribe();
      detachInput();
      renderer.destroy?.();
    },
  };
};
