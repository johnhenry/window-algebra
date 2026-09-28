# PRD: window-algebra

This PRD was written from the design conversation "Design Window Manager APIs" (see `_chat-shares/6ab9f8e7/`). The conversation ended with a request to create the PRD, which was never answered there. This document is that PRD, and it reflects what version 0 implements.

## Problem

Browser applications that need multiple windows (IDEs, dashboards, browser-OS experiments, html-in-canvas environments) usually either reimplement a desktop window manager imperatively or hard-code one layout mode. Both approaches mix policy (who goes where) with mechanism (pixels and DOM), and neither takes advantage of the browser's own layout engine.

## Goals

1. Provide window-management primitives, not a finished window manager. Floating, tiling, tabbed, and hybrid managers should all come from the same parts.
2. Keep a pure, deterministic core: `update(state, command)` and `derive(state)` have no side effects.
3. Express layout as a small algebra of spatial relationships, and preserve those relationships down to CSS instead of reducing them to pixels early.
4. Treat CSS (flex, grid, anchor positioning, containment, container queries) as the constraint solver.
5. Keep surfaces, windows, and presentations as distinct identities, so the same manager can host HTML, iframes, canvas, or html-in-canvas surfaces.

## Non-goals (v0)

- Replacing an operating-system window manager or compositor.
- Multi-output (multiple displays or canvases). The state model leaves room for an `Output`, but there isn't one yet.
- Collaborative synchronization. Determinism and the command log make it possible, but it isn't built.
- Animated transitions. The keyed DOM makes View Transitions straightforward to add later.

## Architecture

```
EVENT/COMMAND ─▶ update (pure) ─▶ intent state ─▶ derive (pure) ─▶ layout tree
      ─▶ compile (pure) ─▶ render tree ─▶ commit (effectful) ─▶ DOM ─▶ measure ─▶ realized state
```

There are three kinds of state: **intent** (the logical model), **presentation** (the layout tree and its CSS declarations), and **realized** (the geometry the browser measured).

## Layout algebra

There are eleven primitives, and all of them except `view` take options first:

- Leaf: `view(id)`
- Containers: `row`, `column`, `grid`, `stack`, `overlay`
- Modifiers: `place`, `size`, `gap`, `inset`, `anchor`

These candidates were considered and rejected (or left as derived helpers):

- `flow`: `grid` with auto-fit columns covers it.
- `layer` / `z` / `top` / `portal`: these are policy or renderer concerns.
- `fit` / `clip` / `scroll` / `transform`: these are surface rendering, not layout.
- `repeat`: plain JavaScript already does this.
- `group`: this belongs to logical state.
- `dock`: this is sugar over `row` plus `size`.
- `align`: this folds into `place` as `{ x: "center" }`.
- `area`: this folds into `place` as `{ area }`.
- `aspect` / `limit`: these fold into `size`.
- `when`: plain JavaScript conditionals do this.

## Split sizing

Resizable splits persist in the layout spec itself, each layout using whichever place is most natural for it — the same principle as master-stack's pre-existing `ratio`:

- **columns / rows** (flat, N children): `spec.sizes[""]` is an array of N positive weights, one per child, in the same units as `size({ weight })` (so equal weights and *no* `sizes` compile to the identical CSS). Unset until the first resize.
- **master-stack** (binary): the existing `spec.ratio` (0–1, master's share). Unaffected by adding splitters — a splitter is just another way to move it.
- **BSP** (binary, nested, stateful): the existing per-node `tree.ratio`. A split is addressed by a `path` string of `"0"`/`"1"` steps from the root (`"0"` = into `first`, `"1"` = into `second`; `""` is the root split itself) — general addressing that reaches every split, including one with no leaf directly on either side (`bspNodeAt`/`bspSetRatioAt` in `src/layouts/bsp.mjs`). This is separate from `bspSetRatio`'s older leaf-id addressing, kept for `layout/set-ratio`.
- **spiral** (binary, nested, generated fresh each render): `spec.ratios`, an array indexed by split depth (`0` = outermost), overriding the shared `spec.ratio` once that depth has been resized — the same shape as BSP's per-node ratio, without needing a stored tree.
- **grid** is not resizable yet (tracks don't map onto a splitter between two DOM children the way a flex row/column's do); `autoGrid`'s tracks are responsive by design either way.

One command covers every case: `layout/resize-split { workspace?, path, index?, delta | weights }`. `path` is the layout-specific address above (`""` for columns/rows/master-stack, an L/R string for BSP, a depth string for spiral); `index` (default 0) selects which of a flat container's N − 1 splitters, and is ignored by the binary layouts. `weights` replaces the addressed pair (or, for columns/rows, the whole array) outright; `delta` nudges the current ratio (binary layouts) or the addressed pair (columns/rows — which must already have `sizes` stored, from an earlier `weights` resize, since a bare delta has nothing to be relative to). Both keep at least 5% of a pair's shared total on each side. It is pure and validated like every other command: an unresizable layout, an unresolvable path, or a malformed value is rejected (`not-resizable`, `invalid-path`, `unknown-split`, `invalid-weights`, `missing-value`, `missing-weights`), never thrown.

`compile()` renders a splitter between every pair of children of a row/column carrying this `resize` metadata: `[data-wm-splitter]`, `role="separator"`, `aria-orientation` (vertical for a row's splitters, horizontal for a column's), `aria-valuenow` (the pair's split as 0–100), and `data-wm-path`/`data-wm-index`/`data-wm-count` — exactly what `layout/resize-split` expects back. `attachInput` drags one with pointer capture (converting pixel movement to a weight delta via the container's measured size, clamped so neither side crosses a directly-wrapped window's min/max constraints) and answers the arrow key along its axis when it has focus; either way the whole gesture is one undo step, via the same `gesture` token mechanism as a floating drag.

## Requirements implemented in v0

| Area | Requirement |
| --- | --- |
| State | Plain JSON. Windows, workspaces, focus with history, and per-layer stacking. |
| Commands | 43 built-in commands. Bad commands are rejected, never thrown. Extensions are supported. |
| Policy | Modal-graph focus redirection, optional focus-raises, cascading close, refocus from history, EWMH/X11-style urgency hints (`window/set-urgent`, `focus/urgent`, `config.urgency.clearOnFocus`). |
| Layouts | master-stack, columns, rows, grid (auto-fit/fixed), spiral, monocle, tabs, floating, BSP (stateful), and custom interpreters. |
| Layout modifiers | xmonad-style, serializable (`spec.modifiers: [{ type, ... }]`): `smart-gaps`, `no-gaps`, `mirror`, `reflect-x`, `reflect-y`, `max-windows(n)` (overflow shares a hidden stack slot), applied via a `MODIFIERS` registry parallel to `LAYOUTS` and the `withModifiers(interpreter, mods)` combinator. `layout/toggle { a, b }` flips a workspace between two stored layouts (xmonad `ToggleLayouts`). Drop interpreters remap their zones to match `mirror`/`reflect-x`/`reflect-y` (`applyModifiersToOps`). |
| Hybrid | Tiled base plus floating, dialog, popover, and notification layers in a single overlay. |
| Transforms | mirror, flip, rotate, reverse, mapViews, replace, remove, swap, find, fold. |
| CSS | Flex weights, grid tracks and areas, stack visibility plus `inert`, overlay translate, anchor positioning, gap/padding, size containers. |
| DOM | Keyed reconciliation, stable view elements, surface mount/unmount, realized-geometry measurement, anchor fallback. |
| Input | Pure drag, resize, and ratio math, plus a pointer adapter with a markup contract. |
| Drag and drop | `window/drop` edits tiled structure (order or BSP tree) per layout through drop interpreters; `config.drag` modes, edge zone, preview, and a `tooSmall` check; pinned windows; keyboard equivalents; a ghost preview rendered by the same derive → compile pipeline. Tiled ↔ floating (`window/detach`, floating drops), drops onto workspace targets (with `follow`), tab-strip reordering, children that travel with their parent, pinned-window affordances, touch long-press, aria-live announcements, and opt-in keyboard moving. |
| History | Undo/redo of window management, a command log, replay, and serialize/load. A gesture (commands sharing a `gesture` token) is one undo step and one log entry. |
| Scratchpad and sticky | i3-style scratchpad (`window/to-scratchpad`, `scratchpad/toggle`): hide a window off every workspace, then show it floating and centered, focused, on the active workspace; toggle again to hide. EWMH-style sticky (`window/set-sticky`): visible on every workspace, keeping its stacking and never joining a tiled base. |
| Versioning | Every state carries `STATE_VERSION`; `migrate(state)` upgrades older (or unversioned) states through a `MIGRATIONS` registry and refuses states from a newer version. `wm.load()` and `replay()` both migrate their input. |
| Size hints | ICCCM `WM_NORMAL_HINTS`-style hints beyond min/max: `aspectRatio` (exact or `{ min, max }`) and `widthIncrement`/`heightIncrement` with `baseWidth`/`baseHeight` (terminal-style cells). Honoured by `constrainSize` for floating move/resize and `window/resize`; tiled windows get CSS `aspect-ratio` for an exact ratio, increments are advisory. |
| Split sizing | Persistent, resizable splits for columns/rows/master-stack/BSP/spiral (see "Split sizing" above): `layout/resize-split`, rendered `[data-wm-splitter]` handles, pointer drag and arrow-key resizing, one undo step per gesture, min/max constraints respected best-effort. |
| Snap zones | Windows-Snap/macOS-tiling-style edge/corner preview for floating windows (`config.snap.edges`/`threshold`/`zones`, pure `snapZoneAt`/`snapZoneRect`), applied on release as one `window/resize` (one undo step); magnetism (`config.snap.magnet`, pure `magnetize`/`magnetizeResize`) snaps floating move/resize to other visible windows' edges and the stage. Configurable, disable-able, constraint-respecting; does not interfere with tiled drag-and-drop or drag-to-tile. |

## Open questions

- Should the five container kinds collapse into one internal `container(strategy, …)` node? The constructors already go through that function, but the node `type` still records the kind.
- Should struts / `reserve()` for panels be a primitive or live in `Output.workArea`?
- Should views split into authoritative views and synchronized projections? Today the second occurrence of a view is rendered but receives no surface.
- Should the tab strip become a general presentation node for chrome that isn't a window?
