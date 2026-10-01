/**
 * Theming tokens: the small, documented set of CSS custom properties
 * (`--wa-*`) that every visual value in the library's own CSS reads, plus a
 * light and a dark default and a `prefers-contrast: more` variant.
 *
 * Override any of them on `:root` (or on any ancestor of the stage, to theme
 * one stage) and the library follows; nothing else in `BASE_CSS`, the drag
 * ghost, the drop zone or the command palette carries a literal colour,
 * radius, spacing, shadow or outline width.
 *
 * The defaults are declared inside `:where()`, so they have zero specificity:
 * a plain `:root { --wa-color-accent: hotpink }` wins wherever it sits in the
 * cascade.
 *
 * Choosing a scheme: the OS preference (`prefers-color-scheme`) decides, and
 * `data-theme="light"` / `data-theme="dark"` on `<html>` (or on any element
 * wrapping a stage) forces one. `prefers-contrast: more` swaps in the
 * high-contrast values for whichever scheme is active.
 */

/**
 * Every token: `{ light, dark, hc: { light, dark } }`. A token with no `hc`
 * entry keeps its scheme value under `prefers-contrast: more`; `description`
 * is what docs/api/theming.md prints.
 */
export const THEME_TOKENS = Object.freeze({
  // ---- colours
  "--wa-color-bg": { description: "Stage background", light: "#f4f5f7", dark: "#101216", hc: { light: "#ffffff", dark: "#000000" } },
  "--wa-color-surface": { description: "A window's background", light: "#ffffff", dark: "#1a1d23", hc: { light: "#ffffff", dark: "#000000" } },
  "--wa-color-surface-raised": { description: "Popovers, menus and the command palette", light: "#ffffff", dark: "#22262e", hc: { light: "#ffffff", dark: "#000000" } },
  "--wa-color-fg": { description: "Text", light: "#14171c", dark: "#e8eaee", hc: { light: "#000000", dark: "#ffffff" } },
  "--wa-color-fg-muted": { description: "Secondary text", light: "#4f5865", dark: "#a3abb8", hc: { light: "#1a1a1a", dark: "#f0f0f0" } },
  "--wa-border-width": { description: "Hairline thickness (tab strip, panels)", light: "1px", dark: "1px", hc: { light: "2px", dark: "2px" } },
  "--wa-color-border": { description: "Hairlines and outlines", light: "#c9ced6", dark: "#363c46", hc: { light: "#000000", dark: "#ffffff" } },
  "--wa-color-accent": { description: "Selection, active tab, drop targets", light: "#1d4ed8", dark: "#7aa2ff", hc: { light: "#0033a0", dark: "#9fc0ff" } },
  "--wa-color-accent-fg": { description: "Text on the accent colour", light: "#ffffff", dark: "#0b1020", hc: { light: "#ffffff", dark: "#000000" } },
  "--wa-color-accent-soft": { description: "A tint of the accent for backgrounds", light: "rgb(29 78 216 / 0.12)", dark: "rgb(122 162 255 / 0.18)", hc: { light: "rgb(0 51 160 / 0.2)", dark: "rgb(159 192 255 / 0.3)" } },
  "--wa-color-danger": { description: "Errors and refused drops", light: "#c2372c", dark: "#ff8a80", hc: { light: "#a00000", dark: "#ffb0a8" } },
  "--wa-color-urgent": { description: "Urgent windows and tabs", light: "#c2410c", dark: "#fb923c", hc: { light: "#8a2c00", dark: "#ffb36b" } },
  "--wa-color-overlay": { description: "The backdrop behind a modal surface (the palette)", light: "rgb(15 23 42 / 0.45)", dark: "rgb(0 0 0 / 0.6)", hc: { light: "rgb(0 0 0 / 0.7)", dark: "rgb(0 0 0 / 0.8)" } },
  // ---- radii
  "--wa-radius-sm": { description: "Small controls, tabs, the focus-ring corner", light: "4px", dark: "4px" },
  "--wa-radius-md": { description: "Windows, panels, the palette", light: "8px", dark: "8px" },
  "--wa-radius-pill": { description: "Pills and badges", light: "999px", dark: "999px" },
  // ---- spacing
  "--wa-space-xs": { description: "Tightest gap", light: "4px", dark: "4px" },
  "--wa-space-sm": { description: "Small gap and padding", light: "8px", dark: "8px" },
  "--wa-space-md": { description: "Default padding", light: "12px", dark: "12px" },
  "--wa-space-lg": { description: "Large padding", light: "16px", dark: "16px" },
  // ---- focus ring
  "--wa-focus-ring-color": { description: "The `:focus-visible` ring", light: "#1d4ed8", dark: "#9fc0ff", hc: { light: "#000000", dark: "#ffffff" } },
  "--wa-focus-ring-halo": { description: "A thin contrasting line outside the ring", light: "#ffffff", dark: "#101216", hc: { light: "#ffffff", dark: "#000000" } },
  "--wa-focus-ring-width": { description: "Ring thickness", light: "3px", dark: "3px", hc: { light: "4px", dark: "4px" } },
  "--wa-focus-ring-offset": { description: "Gap between the element and its ring", light: "2px", dark: "2px" },
  // ---- splitter
  "--wa-splitter-fill": { description: "A splitter at rest", light: "transparent", dark: "transparent" },
  "--wa-splitter-line": { description: "The hairline in the middle of a splitter", light: "rgb(0 0 0 / 0.12)", dark: "rgb(255 255 255 / 0.16)", hc: { light: "#000000", dark: "#ffffff" } },
  "--wa-splitter-line-width": { description: "Thickness of that hairline", light: "1px", dark: "1px", hc: { light: "2px", dark: "2px" } },
  "--wa-splitter-fill-active": { description: "A splitter hovered, focused or dragged", light: "rgb(29 78 216 / 0.35)", dark: "rgb(122 162 255 / 0.4)", hc: { light: "rgb(0 51 160 / 0.55)", dark: "rgb(159 192 255 / 0.6)" } },
  // ---- title bar (the tab strip, and any chrome you style with these)
  "--wa-titlebar-bg": { description: "Title bar / tab strip background", light: "#eceef2", dark: "#262b33", hc: { light: "#ffffff", dark: "#000000" } },
  "--wa-titlebar-fg": { description: "Title bar text", light: "#14171c", dark: "#e8eaee", hc: { light: "#000000", dark: "#ffffff" } },
  "--wa-titlebar-border": { description: "Line under the title bar", light: "#c9ced6", dark: "#363c46", hc: { light: "#000000", dark: "#ffffff" } },
  "--wa-titlebar-active-bg": { description: "The selected tab, or a focused window's title bar", light: "#ffffff", dark: "#1a1d23", hc: { light: "#ffffff", dark: "#000000" } },
  "--wa-titlebar-padding": { description: "Padding inside a title bar", light: "4px 8px", dark: "4px 8px" },
  "--wa-titlebar-font-weight": { description: "Weight of the selected tab", light: "600", dark: "600", hc: { light: "700", dark: "700" } },
  // ---- shadows
  "--wa-shadow-window": { description: "A floating window", light: "0 1px 2px rgb(16 24 40 / 0.1), 0 6px 20px rgb(16 24 40 / 0.16)", dark: "0 1px 2px rgb(0 0 0 / 0.5), 0 6px 20px rgb(0 0 0 / 0.5)", hc: { light: "none", dark: "none" } },
  "--wa-shadow-overlay": { description: "A popover, menu or the command palette", light: "0 2px 4px rgb(16 24 40 / 0.1), 0 18px 48px rgb(16 24 40 / 0.28)", dark: "0 2px 4px rgb(0 0 0 / 0.5), 0 18px 48px rgb(0 0 0 / 0.65)", hc: { light: "none", dark: "none" } },
  // ---- drag preview
  "--wa-ghost-fill": { description: "A ghost slot while dragging", light: "rgb(29 78 216 / 0.1)", dark: "rgb(122 162 255 / 0.14)", hc: { light: "rgb(0 51 160 / 0.18)", dark: "rgb(159 192 255 / 0.26)" } },
  "--wa-ghost-fill-strong": { description: "The dragged window's ghost slot", light: "rgb(29 78 216 / 0.24)", dark: "rgb(122 162 255 / 0.3)", hc: { light: "rgb(0 51 160 / 0.35)", dark: "rgb(159 192 255 / 0.45)" } },
  "--wa-ghost-line": { description: "Ghost outline and label background", light: "#1d4ed8", dark: "#7aa2ff", hc: { light: "#0033a0", dark: "#9fc0ff" } },
  "--wa-ghost-line-width": { description: "Ghost and drop-zone outline thickness", light: "2px", dark: "2px", hc: { light: "3px", dark: "3px" } },
  "--wa-ghost-label-fg": { description: "Ghost label text", light: "#ffffff", dark: "#0b1020", hc: { light: "#ffffff", dark: "#000000" } },
  "--wa-ghost-bad": { description: "A slot that violates constraints; a denied drag", light: "#c2372c", dark: "#ff8a80", hc: { light: "#a00000", dark: "#ffb0a8" } },
  "--wa-zone-fill": { description: "The drop-zone highlight", light: "rgb(29 78 216 / 0.18)", dark: "rgb(122 162 255 / 0.24)", hc: { light: "rgb(0 51 160 / 0.3)", dark: "rgb(159 192 255 / 0.4)" } },
  "--wa-zone-line": { description: "Drop-zone outline, tab insertion line, workspace target", light: "#1d4ed8", dark: "#7aa2ff", hc: { light: "#0033a0", dark: "#9fc0ff" } },
  // ---- misc
  "--wa-blocked-filter": { description: "Applied to windows an open modal blocks", light: "saturate(0.6)", dark: "saturate(0.6)", hc: { light: "none", dark: "none" } },
  "--wa-font": { description: "Font for the library's own text (tabs, ghost label, palette)", light: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", dark: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  "--wa-font-size": { description: "Base size for the library's own text", light: "14px", dark: "14px" },
  "--wa-font-size-sm": { description: "Small text (ghost label, palette hints)", light: "12px", dark: "12px" },
  "--wa-palette-width": { description: "Command palette width (it shrinks to fit narrow screens)", light: "40rem", dark: "40rem" },
  "--wa-palette-max-height": { description: "Command palette maximum height", light: "32rem", dark: "32rem" },
  "--wa-palette-top": { description: "Gap above the command palette", light: "12vh", dark: "12vh" },
  "--wa-transition-duration": { description: "View Transition animations (set by the renderer's `animate` option)", light: "0.25s", dark: "0.25s" },
  "--wa-transition-easing": { description: "Easing for those animations", light: "ease", dark: "ease" },
});

const declarations = (scheme, contrast) =>
  Object.entries(THEME_TOKENS)
    .map(([name, token]) => {
      const value = contrast ? token.hc?.[scheme] : token[scheme];
      return value === undefined ? null : `${name}: ${value};`;
    })
    .filter(Boolean)
    .join(" ");

/**
 * The default theme as a stylesheet: light, dark (OS preference or
 * `data-theme="dark"`), and a `prefers-contrast: more` variant of each.
 */
export const THEME_CSS = `
:where(:root, [data-theme="light"]) { color-scheme: light; ${declarations("light")} }
@media (prefers-color-scheme: dark) {
  :where(:root:not([data-theme="light"])) { color-scheme: dark; ${declarations("dark")} }
}
:where([data-theme="dark"]) { color-scheme: dark; ${declarations("dark")} }
@media (prefers-contrast: more) {
  :where(:root, [data-theme="light"]) { ${declarations("light", true)} }
}
@media (prefers-contrast: more) and (prefers-color-scheme: dark) {
  :where(:root:not([data-theme="light"])) { ${declarations("dark", true)} }
}
@media (prefers-contrast: more) {
  :where([data-theme="dark"]) { ${declarations("dark", true)} }
}
`.trim();
