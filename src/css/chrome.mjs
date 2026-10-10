/**
 * The stylesheet for the built-in window chrome (`src/browser/chrome.mjs`): a title bar, its buttons, the body
 * and the eight resize grips. Part of `RULES_CSS`, so `BASE_CSS` already carries it. Like the rest of the
 * rules it has no literal colour or length: everything is a `--wa-*` token, and every inline offset is a
 * logical property, so the bar flows right to left under `dir="rtl"` on its own.
 *
 * Which buttons show is decided here, from the attributes `compile` puts on the view (`data-mode`,
 * `data-status`), so the chrome needs no JavaScript to flip maximize/restore, float/tile or pop out/in, and
 * it keeps working inside a pop-out window, where no renderer is updating it.
 *
 * The grips are named for physical edges (`resize-e` is the right edge, `resize-n` the top), so they are
 * placed with physical offsets.
 */
const GRIP_EDGES = (size) => `
.wa-chrome-grip[data-wm-handle="resize-n"] { top: 0; left: calc(2 * ${size}); right: calc(2 * ${size}); height: ${size}; cursor: ns-resize; }
.wa-chrome-grip[data-wm-handle="resize-s"] { bottom: 0; left: calc(2 * ${size}); right: calc(2 * ${size}); height: ${size}; cursor: ns-resize; }
.wa-chrome-grip[data-wm-handle="resize-e"] { right: 0; top: calc(2 * ${size}); bottom: calc(2 * ${size}); width: ${size}; cursor: ew-resize; }
.wa-chrome-grip[data-wm-handle="resize-w"] { left: 0; top: calc(2 * ${size}); bottom: calc(2 * ${size}); width: ${size}; cursor: ew-resize; }
.wa-chrome-grip[data-wm-handle="resize-ne"] { right: 0; top: 0; width: calc(2 * ${size}); height: calc(2 * ${size}); cursor: nesw-resize; }
.wa-chrome-grip[data-wm-handle="resize-nw"] { left: 0; top: 0; width: calc(2 * ${size}); height: calc(2 * ${size}); cursor: nwse-resize; }
.wa-chrome-grip[data-wm-handle="resize-se"] { right: 0; bottom: 0; width: calc(2 * ${size}); height: calc(2 * ${size}); cursor: nwse-resize; }
.wa-chrome-grip[data-wm-handle="resize-sw"] { left: 0; bottom: 0; width: calc(2 * ${size}); height: calc(2 * ${size}); cursor: nesw-resize; }`;

export const CHROME_CSS = `
.wa-chrome { box-sizing: border-box; display: grid; grid-template-rows: auto minmax(0, 1fr); block-size: 100%; min-block-size: 0; position: relative; background: var(--wa-color-surface); color: var(--wa-color-fg); font: var(--wa-font-size)/1.4 var(--wa-font); }
.wa-chrome-bar { box-sizing: border-box; display: flex; align-items: center; gap: var(--wa-space-xs); min-inline-size: 0; min-block-size: var(--wa-chrome-bar-height); padding-inline: var(--wa-space-sm) var(--wa-space-xs); overflow: hidden; background: var(--wa-titlebar-bg); color: var(--wa-titlebar-fg); border-block-end: var(--wa-border-width) solid var(--wa-titlebar-border); cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none; }
.wa-chrome-bar[hidden] { display: none; }
wm-view[data-focused] .wa-chrome-bar { background: var(--wa-titlebar-active-bg); }
wm-view[data-status] .wa-chrome-bar { cursor: default; }
.wa-chrome-icon { display: inline-flex; flex: none; align-items: center; }
.wa-chrome-icon:empty { display: none; }
.wa-chrome-title { flex: 1 1 0; min-inline-size: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--wa-titlebar-font-weight); }
.wa-chrome-actions { display: flex; flex: none; align-items: center; }
.wa-chrome-btn { display: inline-grid; place-items: center; flex: none; inline-size: var(--wa-chrome-button-size); block-size: var(--wa-chrome-button-size); padding: 0; border: 0; border-radius: var(--wa-radius-sm); background: transparent; color: inherit; font: inherit; line-height: 1; cursor: pointer; }
.wa-chrome-btn:hover { background: var(--wa-color-accent-soft); }
.wa-chrome-btn[data-action="close"]:hover { color: var(--wa-color-danger); }
.wa-chrome-btn:focus-visible { outline: var(--wa-focus-ring-width) solid var(--wa-focus-ring-color); outline-offset: calc(-1 * var(--wa-focus-ring-width)); box-shadow: 0 0 0 calc(var(--wa-focus-ring-width) / 3) var(--wa-focus-ring-halo); }
.wa-chrome-btn [aria-hidden] { pointer-events: none; }
.wa-chrome-actions > [data-wa-show] { display: none; }
wm-view[data-mode="floating"] .wa-chrome-actions > [data-wa-show="floating"], wm-view[data-status="maximized"] .wa-chrome-actions > [data-wa-show="maximized"], wm-view[data-status="popped-out"] .wa-chrome-actions > [data-wa-show="popped-out"] { display: inline-grid; }
wm-view[data-mode="floating"] .wa-chrome-actions > [data-wa-hide~="floating"], wm-view[data-status="maximized"] .wa-chrome-actions > [data-wa-hide~="maximized"], wm-view[data-status="popped-out"] .wa-chrome-actions > [data-wa-hide~="popped-out"] { display: none; }
.wa-chrome-body { grid-row: 2; box-sizing: border-box; min-block-size: 0; min-inline-size: 0; overflow: auto; position: relative; }
[data-wm-touch~="swipe-windows"] .wa-chrome-body { touch-action: pan-y; }
.wa-chrome-body:focus-visible { outline: var(--wa-focus-ring-width) solid var(--wa-focus-ring-color); outline-offset: calc(-1 * var(--wa-focus-ring-width)); }
.wa-chrome-grip { position: absolute; z-index: 5; display: none; touch-action: none; }
wm-view[data-mode="floating"]:not([data-status]) > .wa-chrome > .wa-chrome-grip { display: block; }
${GRIP_EDGES("var(--wa-chrome-grip-size)")}
@media (pointer: coarse) {
  .wa-chrome-bar { min-block-size: var(--wa-chrome-touch-target); }
  .wa-chrome-btn { inline-size: var(--wa-chrome-touch-target); block-size: var(--wa-chrome-touch-target); }${GRIP_EDGES("var(--wa-chrome-grip-touch)").replaceAll("\n", "\n  ")}
}
@media (forced-colors: active) {
  .wa-chrome-btn { border: var(--wa-border-width) solid ButtonText; }
  .wa-chrome-btn:focus-visible, .wa-chrome-body:focus-visible { outline-color: Highlight; }
}
`.trim();
