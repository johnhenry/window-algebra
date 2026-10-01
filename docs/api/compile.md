# compile and CSS

[API reference](./README.md) › compile and CSS

`compile` is a pure compiler from a layout-algebra tree to a **render tree**: a plain description of elements, attributes and CSS declarations. CSS (flex, grid, anchor positioning, container queries) is the constraint solver; `compile` only translates relationships into declarations. There is no DOM access, so it runs and is tested in Node. Source: `src/css/compile.mjs` (also available as `@johnhenry/window-algebra/css`).

## Contents

- [compile](#compiletree-context-options)
- [Render-tree shape and keys](#render-tree-shape-and-keys)
- [CSS mapping](#css-mapping)
- [Views](#views)
- [Anchors](#anchors)
- [Tabs](#tabs)
- [Splitters](#splitters)
- [Accessibility attributes](#accessibility-attributes)
- [Helpers](#helpers)
- [BASE_CSS and custom properties](#base_css-and-custom-properties)

## `compile(tree, context?, options?)`

```js
compile(tree, presentationContext(state), { key: "root" }) → RenderNode
```

- `tree`: a layout-algebra tree (usually from `derive`).
- `context`: from [`presentationContext(state)`](./queries.md#presentationcontextstate) (`{ focused, blocked, titles, modes, statuses, roles, pinned, sticky, urgent, modal }`). Every field is optional. Without a context, `compile` still produces valid layout, just without state attributes.
- `options.key`: the key prefix of the root element (default `"root"`).

## Render-tree shape and keys

```js
{ tag, key, attrs: { name: string }, style: { "kebab-case-prop": string }, children: RenderNode[],
  view?: id, primary?: boolean,   // view elements only
  text?: string }                 // tab buttons only
```

| Element | `tag` | `key` |
| --- | --- | --- |
| root container | `wm-<kind>` | `root:<kind>` (or `<options.key>:<kind>`) |
| nested container | `wm-row`, `wm-column`, `wm-grid`, `wm-stack`, `wm-overlay` | `<parentKey>/<childIndex>:<kind>` |
| view (primary) | `wm-view` | `view:<id>` |
| view (projection, n-th occurrence) | `wm-view` | `view:<id>#<n>` |
| tab strip | `wm-tabs` | `<stackKey>/tabs` |
| tab button | `button` | `<stackKey>/tab:<id>` |
| splitter | `wm-splitter` | `<containerKey>/splitter:<index>` |

Views are keyed by window id alone, **not** by their position. That is what lets the DOM renderer keep a window's element, and its mounted surface, when a layout change moves it into a different container. Modifiers produce no elements; their declarations land on the element they wrap.

## CSS mapping

| Node | Declarations |
| --- | --- |
| every container | `box-sizing: border-box; min-width: 0; min-height: 0`, plus `data-layout="<kind>"` |
| `row` / `column` | `display: flex; flex-direction: row \| column`; `align-items` (`align`); `justify-content` (`distribute`); `flex-wrap: wrap` (`wrap`) |
| `grid` | `display: grid`; `grid-template-columns`/`grid-template-rows` via [`tracks`](#helpers); `grid-template-areas`; `grid-auto-flow`; `grid-auto-rows` |
| `stack` | `display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr)` (`auto minmax(0, 1fr)` with tabs chrome). Children share `grid-area: 1 / 1` (`2 / 1` under tabs), `z-index` = index, `position: relative`. Inactive children: `visibility: hidden`, `inert`, `aria-hidden="true"`. |
| `overlay` | the same single-cell grid plus `position: relative; overflow: hidden`. Children stack by `z-index` = index. |
| child of `row`/`column` | `flex: 1 1 0` unless `size` overrides |
| `size` | `weight` → `flex: w 1 0`; main-axis `width`/`height` → `flex: 0 0 auto` + the extent; `min`/`max` → main-axis `min-*`/`max-*`; `preferred` → `flex-basis` (and `flex: 1 1 <preferred>` without a weight); cross-axis `width`/`height`; `minWidth`… → `min-width`…; `aspectRatio` → `aspect-ratio`. `"content"` → `max-content`. |
| `place` | grid parent: `grid-area`/`grid-row`/`grid-column`; flex parent: `align-self`; `x`/`y` keywords → `justify-self`/`align-self`; numeric or other string `x`/`y` → `position: absolute; inset-inline-start: 0; inset-block-start: 0; translate: x y` (x negated when `context.direction` is `"rtl"`); `top`/`right`/`bottom`/`left` → `position: absolute` + the logical insets `inset-block-start`, `inset-inline-end`, `inset-block-end`, `inset-inline-start` (`left`/`right` are the inline edges) |
| `gap` (on a container) | `gap`, or `row-gap`/`column-gap`, or `gap` + `padding` for `inner`/`outer` |
| `inset` | `padding` |
| `anchor` | see [Anchors](#anchors) |

Numbers become `px` ([`px`](#helpers)); strings pass through.

## Views

A view element gets `display: block; box-sizing: border-box; min-width: 0; min-height: 0; overflow: hidden; container-type: size; container-name: wm-view` (declarations from wrapping modifiers win).

Every view is a **size container named `wm-view`**, so window content adapts with container queries without knowing whether it was tiled, tabbed or resized by hand:

```css
@container wm-view (width < 400px) { .sidebar { display: none; } }
```

Size containment ignores content, so an axis sized by its content (`width`/`height` of `max-content`, `min-content` or `fit-content`) is not contained. A content-sized width gives `container-type: normal`, and a content-sized height gives `inline-size`. Without this, sheets (`height: "content"`) collapsed to 0 px.

View attributes:

| Attribute | When |
| --- | --- |
| `data-view="<id>"` | always |
| `data-view-projection="<n>"` | 2nd and later occurrences of the same id (they get no surface) |
| `data-focused` | `context.focused === id` |
| `data-wm-blocked`, `aria-disabled="true"` | blocked by an open modal descendant. The DOM renderer makes the view's **contents** `inert` but keeps the view hit-testable, so a click is redirected instead of falling through. |
| `data-wm-urgent` | urgent |
| `data-mode="tiled \| floating"`, `data-role="<role>"` | from context |
| `data-status="<status>"` | the window's status when it is not `normal`: `maximized`, `minimized`, `fullscreen`, `popped-out` (from `context.statuses`). The built-in [window chrome](./browser.md#window-chrome) shows its restore button and hides its grips from it. |
| `data-wm-draggable="false"` | pinned |
| `data-wm-sticky` | sticky |
| `anchor-name: --wm-<id>` (style) | the first occurrence of a view that some `anchor` targets |

## Direction

`compile(tree, context)` reads `context.direction` (`"ltr"` default, or `"rtl"`, from `presentationContext(state)`). In `"rtl"` the **root** element gets `dir="rtl"`, so flex rows, grids and tab strips run right to left by themselves and the compiled styles stay identical to the left-to-right ones. The only styles that change are the physical ones: a numeric `place` `x` is negated, and an `anchor`'s horizontal side, gravity and (along the horizontal axis) alignment are mirrored, so `position-area` and `data-wm-anchor-opts` are always the physical truth. No compiled style contains `left`, `right`, `margin-left` or `padding-right` except the anchor offset margin, which faces the already-mirrored side. See [Layouts › Right-to-left](./layouts.md#right-to-left).

## Anchors

An `anchor` modifier compiles to `position: absolute; position-anchor: --wm-<to>` plus:

- **Inside form** (`inside`, or `x`/`y` without `side`): `position-area: center` with `justify-self`/`align-self` from `x`/`y`.
- **Side form** (`side`, `align`, `offset`): `position-area` from the side and alignment (for example `bottom` + `start` → `bottom span-right`), `margin-<opposite side>: <offset>`, and `position-try-fallbacks: flip-block, flip-inline`, filtered by `flip` (default both; `[]` omits it). `y` is the block axis for a `top`/`bottom` side and `x` for `left`/`right`. A `gravity` **opposite** `side` selects the opposite `position-area`. A same-side gravity has no CSS keyword and is ignored on this path.

The anchored element also carries `data-wm-anchor="<to>"`, `data-wm-positioned="anchor"`, and, for the side form, `data-wm-anchor-opts` (JSON of `side`, `align`, `offset`, `gravity`, `flip`, `slide`, `resize`). The DOM renderer's JS fallback re-derives full `xdg_positioner` semantics from those, **including `slide` and `resize`, which CSS anchor positioning cannot express** (`position-try-fallbacks` only swaps between discrete alternatives). A popup that needs `slide`/`resize` everywhere should force `anchorFallback: true`.

## Tabs

A `stack` with `chrome: "tabs"` gets a `wm-tabs` child first (`role="tablist"`, `grid-area: 1 / 1`, `display: flex`), holding one `button` per child, labelled with the first view in that child:

```html
<button type="button" role="tab" id="wm-tab-editor" data-wm-tab="editor"
        aria-selected="true" aria-controls="wm-panel-editor">Editor</button>
```

`data-wm-urgent` is added for urgent windows. `aria-selected` compares with the stack's `active`. The tabs use a **roving tabindex**: the selected tab has `tabindex="0"`, the others `"-1"`, and `attachInput` implements the WAI-ARIA keys (arrows, Home/End, Enter/Space). The corresponding view becomes `role="tabpanel"`, `id="wm-panel-<id>"`, `aria-labelledby="wm-tab-<id>"`. `attachInput` focuses a window when its tab is pressed and drags tabs along the strip.

## Splitters

A `row`/`column` whose options carry `resize: { path, weights }` (with `weights.length === children.length`) gets a `wm-splitter` element between each pair of children:

| Attribute | Value |
| --- | --- |
| `data-wm-splitter` | present |
| `data-wm-path` | `resize.path`: exactly what `layout/resize-split` expects |
| `data-wm-index` | the index of the child before the splitter |
| `data-wm-count` | the container's child count (so the adapter can build a full weights array) |
| `role="separator"`, `aria-orientation` | `vertical` for a row's splitters, `horizontal` for a column's |
| `aria-label`, `aria-controls` | `Resize <title A> and <title B>` (the first view of each neighbour; a window without a title is named by its id), and the panel ids (`wm-panel-<id>`) of those two views |
| `tabindex="0"` | splitters are keyboard-focusable; arrows nudge them |
| `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"` | the pair's split as 0–100 |
| `tabindex="0"` | focusable, and arrow keys resize |

Style: `flex: 0 0 <SPLITTER_SIZE>px; align-self: stretch; cursor: col-resize | row-resize; touch-action: none`. Splitters sit between views, never inside one, so they don't compete with title-bar handles. A mismatched `weights` array renders no splitter, rather than risk addressing the wrong pair.

## Accessibility attributes

| Element | ARIA |
| --- | --- |
| ordinary window view | `role="group"`, `aria-label` = title, or the id when the title is empty. Every primary view also gets `id="wm-panel-<id>"` |
| `dialog`/`sheet` view | `role="dialog"`, `aria-modal="true"` when modal, `aria-label` = title (or id) |
| tab panel view | `role="tabpanel"`, `aria-labelledby` (no `aria-label`) |
| tab strip / tab | `role="tablist"` / `role="tab"`, `aria-selected`, `aria-controls` |
| splitter | `role="separator"`, label, `aria-controls`, orientation and value attributes |
| blocked view | `aria-disabled="true"` (the contents are made `inert` by the renderer) |
| inactive stack child | `inert`, `aria-hidden="true"` |

## Helpers

| Export | Description |
| --- | --- |
| `toHTML(renderNode, { slot?, indent? })` | Serializes a render tree to HTML for server rendering, snapshots or debugging. `slot(viewId)` may return inner HTML for **primary** views. Attribute values and text are escaped; `slot` output is not. |
| `styleText(style)` | A style object → `"prop: value; …"`, dropping empty values. |
| `tracks(value)` | A grid track option → `grid-template-*` syntax (see [grid](./algebra.md#gridoptions-children)). |
| `px(value)` | Numbers → `"<n>px"`; everything else unchanged. |
| `anchorName(id)` | `--wm-<id>` with every character outside `[a-zA-Z0-9_-]` replaced by `_`. |
| `tabId(id)`, `panelId(id)` | `wm-tab-<id>` / `wm-panel-<id>`, sanitized the same way. These are page-scoped ids, so two stages on one page showing the same window id would collide. |
| `SPLITTER_SIZE` | `6`: the splitter's thickness in px. Override with CSS on `[data-wm-splitter]`. |

## `BASE_CSS` and custom properties

`BASE_CSS` is an optional stylesheet string: `THEME_CSS` (the default theme, see [Theming](./theming.md)) followed by `RULES_CSS` (the rules). Inject it once (`<style>` or `adoptedStyleSheets`). The rules set host sizing (`[data-wm-root]` and its root `wm-overlay` fill the host, with the stage background and font), floating windows' shadow and radius, the blocked/inert tint, the tab strip's title-bar look and the selected-tab weight, the urgent outline, drag cursors, the ghost label, pinned and denied affordances, workspace-target highlighting, `touch-action: none` on `[data-wm-handle]` (with `pan-x` on tab strips, so window content keeps scrolling; `data-wm-touch` tokens switch on the [touch](./browser.md#touch-and-pen) rules), splitter visuals, a visible focus ring (a `:focus-visible` outline on views, tabs, splitters and handles; focus is never hidden), and View Transition timing. Under `prefers-reduced-motion: reduce` the view transitions are off and so are CSS transitions and animations on the library's elements (the DOM renderer also skips `startViewTransition`). Logical properties (`inline-size`, `inset-inline-start`, `border-start-start-radius`, ...) are used throughout so the rules mirror in right-to-left.

Every colour, radius, spacing, shadow and outline width in those rules is a `--wa-*` custom property; the full table, with light, dark and high-contrast defaults, is on the [Theming](./theming.md) page. `RULES_CSS` includes `CHROME_CSS`, the rules for the opt-in [window chrome](./browser.md#window-chrome) (also exported on its own). Exports: `BASE_CSS`, `RULES_CSS`, `CHROME_CSS`, `THEME_CSS`, `THEME_TOKENS`.
