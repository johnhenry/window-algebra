# Theming

[API reference](./README.md) › Theming

Every visual value in the library's own CSS (`BASE_CSS`, the drag ghost and drop zone, the command palette) is a custom property from one small, documented set: `--wa-*`. Override any of them and the library follows. Source: `src/css/theme.mjs`; exported as `THEME_TOKENS` and `THEME_CSS` from the root and from `@johnhenry/window-algebra/css`.

## Using it

```html
<style id="wa-base"></style>
<script type="module">
  import { BASE_CSS } from "@johnhenry/window-algebra/css";
  document.getElementById("wa-base").textContent = BASE_CSS; // THEME_CSS + the rules
</script>
<style>
  :root { --wa-color-accent: #d6336c; --wa-radius-md: 14px; --wa-space-md: 16px; }
  /* or theme one stage only: */
  #inspector { --wa-titlebar-bg: #1b2b20; --wa-titlebar-fg: #d8f3dc; }
</style>
```

`BASE_CSS` is `THEME_CSS` (the default theme: the tokens below for light, dark and high contrast) followed by `RULES_CSS` (the rules that read them, including `CHROME_CSS` for the opt-in [window chrome](./browser.md#window-chrome)). Use `RULES_CSS` alone to supply every token yourself. The command palette injects `THEME_CSS` and its own rules the first time it opens, so it is themed the same way.

The defaults are declared inside `:where()`, so they have **zero specificity**: a plain `:root { --wa-color-accent: hotpink }` wins wherever it appears in the stylesheet order.

## Under a strict Content-Security-Policy

Setting `BASE_CSS` as a `<style>`'s `textContent` (the snippet above), and the `<style data-wm-palette-style>` that
`createPalette` injects, are inline styles, which `style-src 'self'` blocks. Everything else the library does to the DOM
goes through the CSSOM (`element.style.setProperty`), which a CSP allows, so the fix is only about these two sheets:
write `BASE_CSS` and `PALETTE_CSS` (both exported; `PALETTE_CSS` from `@johnhenry/window-algebra/browser`) to a `.css`
file at build time, link it, and pass `injectStyles: false` to `createPalette` (or to `<wa-palette>`'s `configure`).
Nothing else needs `'unsafe-inline'`. The archived [workbench](https://github.com/johnhenry/workbench) app did exactly this under
`require-trusted-types-for 'script'`.

## Light, dark and high contrast

| Condition | Result |
| --- | --- |
| nothing set | the OS preference (`prefers-color-scheme`) picks light or dark |
| `data-theme="light"` or `"dark"` on `<html>` (or any element wrapping a stage) | forces that scheme |
| `@media (prefers-contrast: more)` | the **High contrast** column below replaces the scheme's value for tokens that have one: black on white (or white on black) text, borders as strong as the text, no shadows, thicker focus rings and splitter lines |
| `@media (forced-colors: active)` | the focus ring uses `Highlight` and splitter lines `CanvasText` |

The defaults are checked in `test/theme.test.mjs`: text, muted text, accent, title bar, ghost label, danger and the focus ring meet WCAG contrast ratios (4.5:1 for text and 7:1 under `prefers-contrast: more`; 3:1 for the focus ring) in all four combinations.

## The tokens

| Token | Used for | Light | Dark | High contrast (light / dark) |
| --- | --- | --- | --- | --- |
| `--wa-color-bg` | Stage background | `#f4f5f7` | `#101216` | `#ffffff` / `#000000` |
| `--wa-color-surface` | A window's background | `#ffffff` | `#1a1d23` | `#ffffff` / `#000000` |
| `--wa-color-surface-raised` | Popovers, menus and the command palette | `#ffffff` | `#22262e` | `#ffffff` / `#000000` |
| `--wa-color-fg` | Text | `#14171c` | `#e8eaee` | `#000000` / `#ffffff` |
| `--wa-color-fg-muted` | Secondary text | `#4f5865` | `#a3abb8` | `#1a1a1a` / `#f0f0f0` |
| `--wa-border-width` | Hairline thickness (tab strip, panels) | `1px` | `1px` | `2px` / `2px` |
| `--wa-color-border` | Hairlines and outlines | `#c9ced6` | `#363c46` | `#000000` / `#ffffff` |
| `--wa-color-accent` | Selection, active tab, drop targets | `#1d4ed8` | `#7aa2ff` | `#0033a0` / `#9fc0ff` |
| `--wa-color-accent-fg` | Text on the accent colour | `#ffffff` | `#0b1020` | `#ffffff` / `#000000` |
| `--wa-color-accent-soft` | A tint of the accent for backgrounds | `rgb(29 78 216 / 0.12)` | `rgb(122 162 255 / 0.18)` | `rgb(0 51 160 / 0.2)` / `rgb(159 192 255 / 0.3)` |
| `--wa-color-danger` | Errors and refused drops | `#c2372c` | `#ff8a80` | `#a00000` / `#ffb0a8` |
| `--wa-color-urgent` | Urgent windows and tabs | `#c2410c` | `#fb923c` | `#8a2c00` / `#ffb36b` |
| `--wa-color-overlay` | The backdrop behind a modal surface (the palette) | `rgb(15 23 42 / 0.45)` | `rgb(0 0 0 / 0.6)` | `rgb(0 0 0 / 0.7)` / `rgb(0 0 0 / 0.8)` |
| `--wa-radius-sm` | Small controls, tabs, the focus-ring corner | `4px` | `4px` | same |
| `--wa-radius-md` | Windows, panels, the palette | `8px` | `8px` | same |
| `--wa-radius-pill` | Pills and badges | `999px` | `999px` | same |
| `--wa-space-xs` | Tightest gap | `4px` | `4px` | same |
| `--wa-space-sm` | Small gap and padding | `8px` | `8px` | same |
| `--wa-space-md` | Default padding | `12px` | `12px` | same |
| `--wa-space-lg` | Large padding | `16px` | `16px` | same |
| `--wa-focus-ring-color` | The `:focus-visible` ring | `#1d4ed8` | `#9fc0ff` | `#000000` / `#ffffff` |
| `--wa-focus-ring-halo` | A thin contrasting line outside the ring | `#ffffff` | `#101216` | `#ffffff` / `#000000` |
| `--wa-focus-ring-width` | Ring thickness | `3px` | `3px` | `4px` / `4px` |
| `--wa-focus-ring-offset` | Gap between the element and its ring | `2px` | `2px` | same |
| `--wa-splitter-fill` | A splitter at rest | `transparent` | `transparent` | same |
| `--wa-splitter-line` | The hairline in the middle of a splitter | `rgb(0 0 0 / 0.12)` | `rgb(255 255 255 / 0.16)` | `#000000` / `#ffffff` |
| `--wa-splitter-line-width` | Thickness of that hairline | `1px` | `1px` | `2px` / `2px` |
| `--wa-splitter-fill-active` | A splitter hovered, focused or dragged | `rgb(29 78 216 / 0.35)` | `rgb(122 162 255 / 0.4)` | `rgb(0 51 160 / 0.55)` / `rgb(159 192 255 / 0.6)` |
| `--wa-titlebar-bg` | Title bar / tab strip background | `#eceef2` | `#262b33` | `#ffffff` / `#000000` |
| `--wa-titlebar-fg` | Title bar text | `#14171c` | `#e8eaee` | `#000000` / `#ffffff` |
| `--wa-titlebar-border` | Line under the title bar | `#c9ced6` | `#363c46` | `#000000` / `#ffffff` |
| `--wa-titlebar-active-bg` | The selected tab, or a focused window's title bar | `#ffffff` | `#1a1d23` | `#ffffff` / `#000000` |
| `--wa-titlebar-padding` | Padding inside a title bar | `4px 8px` | `4px 8px` | same |
| `--wa-titlebar-font-weight` | Weight of the selected tab | `600` | `600` | `700` / `700` |
| `--wa-chrome-bar-height` | Window chrome: title bar height | `32px` | `32px` | same |
| `--wa-chrome-button-size` | Window chrome: title-bar button size (a square) | `26px` | `26px` | same |
| `--wa-chrome-touch-target` | Window chrome: bar height and button size on touch and pen (coarse pointers) | `44px` | `44px` | same |
| `--wa-chrome-grip-size` | Window chrome: resize grip thickness | `6px` | `6px` | same |
| `--wa-chrome-grip-touch` | Window chrome: resize grip thickness on touch and pen | `14px` | `14px` | same |
| `--wa-shadow-window` | A floating window | `0 1px 2px rgb(16 24 40 / 0.1), 0 6px 20px rgb(16 24 40 / 0.16)` | `0 1px 2px rgb(0 0 0 / 0.5), 0 6px 20px rgb(0 0 0 / 0.5)` | `none` / `none` |
| `--wa-shadow-overlay` | A popover, menu or the command palette | `0 2px 4px rgb(16 24 40 / 0.1), 0 18px 48px rgb(16 24 40 / 0.28)` | `0 2px 4px rgb(0 0 0 / 0.5), 0 18px 48px rgb(0 0 0 / 0.65)` | `none` / `none` |
| `--wa-ghost-fill` | A ghost slot while dragging | `rgb(29 78 216 / 0.1)` | `rgb(122 162 255 / 0.14)` | `rgb(0 51 160 / 0.18)` / `rgb(159 192 255 / 0.26)` |
| `--wa-ghost-fill-strong` | The dragged window's ghost slot | `rgb(29 78 216 / 0.24)` | `rgb(122 162 255 / 0.3)` | `rgb(0 51 160 / 0.35)` / `rgb(159 192 255 / 0.45)` |
| `--wa-ghost-line` | Ghost outline and label background | `#1d4ed8` | `#7aa2ff` | `#0033a0` / `#9fc0ff` |
| `--wa-ghost-line-width` | Ghost and drop-zone outline thickness | `2px` | `2px` | `3px` / `3px` |
| `--wa-ghost-label-fg` | Ghost label text | `#ffffff` | `#0b1020` | `#ffffff` / `#000000` |
| `--wa-ghost-bad` | A slot that violates constraints; a denied drag | `#c2372c` | `#ff8a80` | `#a00000` / `#ffb0a8` |
| `--wa-zone-fill` | The drop-zone highlight | `rgb(29 78 216 / 0.18)` | `rgb(122 162 255 / 0.24)` | `rgb(0 51 160 / 0.3)` / `rgb(159 192 255 / 0.4)` |
| `--wa-zone-line` | Drop-zone outline, tab insertion line, workspace target | `#1d4ed8` | `#7aa2ff` | `#0033a0` / `#9fc0ff` |
| `--wa-blocked-filter` | Applied to windows an open modal blocks | `saturate(0.6)` | `saturate(0.6)` | `none` / `none` |
| `--wa-font` | Font for the library's own text (tabs, ghost label, palette) | `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` | same |
| `--wa-font-size` | Base size for the library's own text | `14px` | `14px` | same |
| `--wa-font-size-sm` | Small text (ghost label, palette hints) | `12px` | `12px` | same |
| `--wa-transition-duration` | View Transition animations (set by the renderer's `animate` option) | `0.25s` | `0.25s` | same |
| `--wa-transition-easing` | Easing for those animations | `ease` | `ease` | same |

Groups: colours (`--wa-color-*`, `--wa-border-width`), radii (`--wa-radius-*`), spacing (`--wa-space-*`), the focus ring (`--wa-focus-ring-*`), splitters (`--wa-splitter-*`), the title bar (`--wa-titlebar-*`, used by the tab strip and the built-in [window chrome](./browser.md#window-chrome)), the window chrome's sizes (`--wa-chrome-*`), shadows (`--wa-shadow-*`), the drag preview (`--wa-ghost-*`, `--wa-zone-*`), type (`--wa-font*`) and motion (`--wa-transition-*`).

`THEME_TOKENS` is the same table as data: `{ [name]: { description, light, dark, hc?: { light, dark } } }`, so a theme editor (see `demo/theming.html`) can list and simulate them.

## Notes

- The legacy `--wm-*` properties are gone; `--wa-*` replaces them (`--wm-focus-ring` → `--wa-focus-ring-color`, `--wm-ghost-radius` → `--wa-radius-md`, `--wm-zone-line` → `--wa-zone-line`, `--wm-transition-duration` → `--wa-transition-duration`, and so on). `anchor-name: --wm-<id>` is a different thing (a CSS dashed ident for anchor positioning) and is unchanged.
- The compiled render tree (`compile`) carries **only layout** in its inline styles (flex, grid, positions); all colour, radius, shadow and spacing live in the stylesheet, so theming never needs a re-render.
- `--wa-splitter-line-width` changes the visible hairline, not the hit area: `SPLITTER_SIZE` (6 px) is the splitter's fixed thickness, which the pointer math uses.
- Floating windows get `--wa-shadow-window` and `--wa-radius-md`; tiled ones get neither (their chrome is yours).
