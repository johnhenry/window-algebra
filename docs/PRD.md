# PRD: window-algebra

This PRD was written from the design conversation "Design Window Manager APIs". The conversation ended with a request to create the PRD, which was never answered there. This document is that PRD, and it reflects what version 0 implements.

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
- Multi-user collaborative synchronization. Determinism and the command log make it possible, but it isn't built. (Syncing one user's tabs is `attachSync`: whole-state snapshots, last writer wins.)

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
- Modifiers: `place`, `size`, `gap`, `inset`, `anchor` (`anchor`'s side-attached form takes Wayland `xdg_positioner`-style constraint adjustment: `gravity`, `flip`, `slide`, `resize` — see `docs/api/algebra.md`, "anchor", and `docs/api/geometry.md`, "positionPopup")

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
- **docking tree** (n-ary, nested, stateful): each row/column container's own `sizes` array, one weight per child, the same convention as columns/rows. A container is addressed by a `path` of comma-joined child indices from the root (`"0,1"` = `children[0].children[1]`; `""` is the root) — `treeNodeAt`/`treeSetSizesAt` in `src/layouts/tree.mjs`, parallel to BSP's `bspNodeAt`/`bspSetRatioAt`. `tabs` containers aren't resizable (`unknown-split`).
- **grid** is not resizable yet (tracks don't map onto a splitter between two DOM children the way a flex row/column's do); `autoGrid`'s tracks are responsive by design either way.

One command covers every case: `layout/resize-split { workspace?, path, index?, delta | weights }` (the docking tree, above, is one more case it covers). `path` is the layout-specific address above (`""` for columns/rows/master-stack, an L/R string for BSP, a depth string for spiral); `index` (default 0) selects which of a flat container's N − 1 splitters, and is ignored by the binary layouts. `weights` replaces the addressed pair (or, for columns/rows, the whole array) outright; `delta` nudges the current ratio (binary layouts) or the addressed pair (columns/rows — which must already have `sizes` stored, from an earlier `weights` resize, since a bare delta has nothing to be relative to). Both keep at least 5% of a pair's shared total on each side. It is pure and validated like every other command: an unresizable layout, an unresolvable path, or a malformed value is rejected (`not-resizable`, `invalid-path`, `unknown-split`, `invalid-weights`, `missing-value`, `missing-weights`), never thrown.

`compile()` renders a splitter between every pair of children of a row/column carrying this `resize` metadata: `[data-wm-splitter]`, `role="separator"`, `aria-orientation` (vertical for a row's splitters, horizontal for a column's), `aria-valuenow` (the pair's split as 0–100), and `data-wm-path`/`data-wm-index`/`data-wm-count` — exactly what `layout/resize-split` expects back. `attachInput` drags one with pointer capture (converting pixel movement to a weight delta via the container's measured size, clamped so neither side crosses a directly-wrapped window's min/max constraints) and answers the arrow key along its axis when it has focus; either way the whole gesture is one undo step, via the same `gesture` token mechanism as a floating drag.

## Multiple outputs

sway-style outputs: `state.outputs` (id → `{ workspaces, activeWorkspace }`) partitions workspaces across displays/stages, with `state.outputOrder` and `state.focusedOutput` alongside it. `state.activeWorkspace` always mirrors `outputs[focusedOutput].activeWorkspace`, so it — and every single-output query and command that reads it (`activeWorkspace`, `workspace/activate`, `derive(state)`, `isVisible`/`visibleWindows`/`focusable`/`paintOrder`, …) — keeps meaning exactly what it always did when there is only one output, which is what `createState()` still produces (one output, `DEFAULT_OUTPUT`, holding every workspace).

- `output/create { id, workspaces?, focus? }` adds an output with its own workspace(s) (same shape as `createState`'s `workspaces` option; default a single `"<id>-1"`).
- `output/remove { id, fallback? }` moves an output's workspaces (and their windows) onto another output; rejected (`last-output`) when it is the only one.
- `workspace/move-to-output { id, output, activate? }` moves one workspace between outputs; rejected (`last-workspace-on-output`) when it is the only workspace its current output has — every output keeps at least one, the same invariant `workspace/remove`'s `last-workspace-on-output` (alongside the pre-existing global `last-workspace`) now also enforces.
- `output/focus { id }` switches which output has input focus. Keyboard focus follows: to a focusable window on the newly focused output (most-recently-focused first), or clears if it has none.
- Focus crosses outputs on its own: `window/focus` (and the modal graph redirecting to a window on another output) switches `focusedOutput` first, the same way it already switches `activeWorkspace` for a window on another workspace; `focus/next`/`focus/previous` wrap from the last focusable window of one output straight into the first of the next, walking `outputOrder`.
- Visibility, `focusable` and `paintOrder` are resolved *per output*: a window is visible when its workspace is the active workspace of *that workspace's own output*, independent of which output currently has focus — so every output's stage always shows the right windows, not just the focused one's. Sticky windows are visible on every workspace of their own output, not across outputs.
- `derive(state, { output })` derives any output's own active workspace (default: `state.focusedOutput`). The manager can drive several renderers — one per output — via `wm.setRenderer(outputId, renderer)` / `wm.measureOutput(outputId)`, each fed that output's own presentation tree; pairing each with its own `attachInput({ present: (state) => wm.present(state, { output: outputId }) })` keeps drag/resize previews correct on every stage, not just the focused one. See `demo/outputs.html`.
- A pre-outputs (version 1) saved state is migrated (`1 → 2`) by backfilling a single default output that owns every workspace, focused — the implicit single output such a state always had.

## Requirements implemented in v0

| Area | Requirement |
| --- | --- |
| State | Plain JSON. Windows, workspaces, focus with history, and per-layer stacking. |
| Commands | 58 built-in commands (`COMMANDS`; each is documented in `docs/api/commands.md`). Bad commands are rejected, never thrown. Extensions are supported. |
| Policy | Modal-graph focus redirection, optional focus-raises, cascading close, refocus from history, EWMH/X11-style urgency hints (`window/set-urgent`, `focus/urgent`, `config.urgency.clearOnFocus`). |
| Layouts | master-stack, columns, rows, grid (auto-fit/fixed), spiral, monocle, tabs, floating, BSP (stateful), docking tree (stateful, n-ary row/column/tabs; `layout/to-tree` converts any other layout into one), and custom interpreters. |
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
| Animation | `createDomRenderer({ animate })` runs commits inside `document.startViewTransition`, giving each primary view a unique, id-derived `view-transition-name`; a no-op without browser support, under `prefers-reduced-motion: reduce`, during a gesture (or an explicit `immediate` commit), or while an earlier transition is still in flight (rapid commits coalesce onto it instead of stacking). `setAnimate()` reconfigures it live. |
| Pop-out windows | GoldenLayout/Dockview-style: `window/pop-out`/`window/pop-in` add a `"popped-out"` status — pure-state, the window leaves the layout like `window/minimize` but is "visible elsewhere" (`isVisible`, `isBlocked`, `isPoppedOut`). `attachPopouts({ wm, renderer, surfaceFor?, open? })` opens a real popup window, copies stylesheets, moves the view's live DOM with `adoptNode` (via the renderer's `release`/`adopt`, so the surface stays mounted), syncs title and WM focus, and pops back in on `window/pop-in`, the popup closing itself, or `window/close`. A blocked popup rejects with an event (`popup-blocked`) rather than throwing. |

## Open questions

- Should the five container kinds collapse into one internal `container(strategy, …)` node? The constructors already go through that function, but the node `type` still records the kind.
- Should struts / `reserve()` for panels be a primitive or live in `Output.workArea`?
- Should views split into authoritative views and synchronized projections? Today the second occurrence of a view is rendered but receives no surface.
- Should the tab strip become a general presentation node for chrome that isn't a window?
