# Changelog

## 0.0.0 — first release (2026-09-28)

**New package, never published under another name.** `@johnhenry/window-algebra` is the first npm distribution of this library, and `0.0.0` is its first version under any name. It follows the family convention that a package starts at `0.0.0`; the number is not a maturity claim. Under npm's caret rules `^0.0.0` matches only `0.0.0`, so consumers should pin exactly until a deliberate `0.1.0`.

The history below predates the GitHub repository, so entries cite commit SHAs only; there are no PR numbers to cite.

### The core

- **A functional window manager: pure `update`, pure `derive`, pure `compile`, and an effectful DOM edge.** `update(state, command) → { state, events, effects }` never touches the DOM, the clock or randomness. It rejects bad commands with a `command/rejected` event instead of throwing, and returns the same state reference for a no-op. `derive` turns logical state into a layout-algebra tree, and `compile` turns that into a render tree of CSS declarations (flex, grid, anchor positioning, size containers), so CSS, not the library, solves tiled geometry. Introduced in f30e845; command count corrected in 04b2f0a.
- **The layout algebra.** Eleven primitives (`view`; `row`, `column`, `grid`, `stack`, `overlay`; `place`, `size`, `gap`, `inset`, `anchor`), options-first, deep-frozen and JSON-serializable, with `validate`/`fromJSON` and a library of transforms (`mirror`, `flip`, `rotate`, `reverse`, `mapViews`, `replace`, `remove`, `swap`, `find`, `fold`, …). Introduced in f30e845.
- **Layouts:** master-stack, columns, rows, monocle, tabs, grid (auto-fit and fixed), spiral, floating, BSP (stateful), and custom interpreters. Introduced in f30e845.
- **The manager** (`createWindowManager`): dispatch, subscribe, frame-coalesced rendering, undo/redo, serialize/load, and a replayable command log. `replay(wm.origin, wm.log)` always equals the present state through undo, redo and load (147b10f), and a `gesture` token makes a whole drag one undo step and one log entry.
- **Browser adapters:** a keyed DOM reconciler that keeps a window's element and mounted surface across layout changes, a pointer adapter with a markup contract, and html/lazy/iframe/canvas surfaces. Introduced in f30e845.

### Features added before the first release

- **Drag and drop in layouts.** `window/drop` edits logical structure per layout through a `DROPS` registry of drop interpreters, with a ghost preview rendered by the same derive → compile pipeline (b7377de). Tiled ↔ floating (`window/detach`, floating drops), cross-workspace drops, tab-strip reordering, touch long-press, pinned windows, `aria-live` announcements and keyboard moving followed in af87db5.
- **Versioned state and migrations.** `STATE_VERSION`, `migrate`, `MIGRATIONS`; `wm.load()` and `replay()` migrate, and a state from a newer build is refused with `state/load-rejected` instead of half-loaded (5c9cc48). The `0 → 1` step also backfills the urgent list (9983620).
- **Urgency hints** (EWMH/X11): `window/set-urgent`, `focus/urgent`, `config.urgency.clearOnFocus` (cd75efa).
- **Size hints** (ICCCM `WM_NORMAL_HINTS`): `aspectRatio` and width/height increments in `constrainSize`, and `sizeToCells` (dac83c5).
- **Declarative window rules**: `config.rules`, `rules/set`, `matchRules` (f804e00).
- **Scratchpad (i3) and sticky windows (EWMH)**: `window/to-scratchpad`, `scratchpad/toggle`, `window/set-sticky` (c61d5f8).
- **Layout modifiers** (xmonad): `smart-gaps`, `no-gaps`, `mirror`, `reflect-x`, `reflect-y`, `max-windows`, drop zones remapped to match, and `layout/toggle` (e9fbea5).
- **Persistent, resizable splitters**: `layout/resize-split`, compiled `[data-wm-splitter]` handles, pointer and arrow-key resizing (c59b3a1).
- **Accessibility basics**: ARIA roles for windows, dialogs, tabs and splitters; F6 window cycling; a modal focus trap (91aa58f).
- **Snap zones and magnetism** for floating windows: `config.snap`, `snapZoneAt`, `snapZoneRect`, `magnetize`, `magnetizeResize` (69b4f27; review fixes in f234a67).
- **Positioner rules** (Wayland `xdg_positioner`) for anchored popups: `gravity`, `flip`, `slide`, `resize`, and the pure `positionPopup` (e764c52).
- **A docking tree layout** (`{ type: "tree" }`, row/column/tabs), `DROPS.tree` and `layout/to-tree` (7ef2291).
- **View Transitions-based animation** in the DOM renderer (`animate`, `setAnimate`) (356eeee).
- **Pop-out windows** (GoldenLayout/Dockview): `window/pop-out`/`window/pop-in` and `attachPopouts` (99423fb).
- **Multiple outputs** (sway): `output/create`, `output/remove`, `output/focus`, `workspace/move-to-output`, and a per-output `derive`, with a `1 → 2` migration (c7b145a).
- **Framework bindings**: React (`createReactBindings`) and a `<wa-stage>` custom element (a1e14d2).

### Fixes made before the first release

- **The DOM renderer now reconciles top-down and moves views with `moveBefore()`.** Before, a view moving into a brand-new container briefly left the document, so iframes reloaded and animations and focused inputs were lost on every layout change. The JS anchor fallback was also reworked to read the recorded spec rather than the unsupported CSS, and content-sized views stopped using size containment, which had collapsed sheets to 0 px. The manager began rejecting unknown layout types (`unknown-layout`) instead of throwing on every render. Fixed in 147b10f.
- **Title-bar buttons work on floating windows, clicks on modal-blocked windows no longer fall through, and background windows paint beneath the tiled base.** A press on a control inside a drag handle started a move gesture that captured the pointer, so the button's click never fired. Blocked windows were themselves `inert`, which removed them from hit-testing, so a click reached (and raised) the window underneath. Now only their contents are inert. Fixed in 4bbcc08.
- **Keyboard focus follows WM focus, and vice versa.** Focusing a window by shortcut or taskbar raised it but left DOM focus on `<body>`, so typing went nowhere. Fixed in f6fc3a8.
- **Unsticking a window refocuses.** `window/set-sticky { sticky: false }` could leave `focus.window` pointing at a window that was no longer visible anywhere. Fixed in f9058a0.
- **Keyboard swaps and moves work on docking-tree workspaces.** `window/swap-next`/`previous` and `window/move-before`/`after` special-cased only BSP, so on a tree workspace they emitted events but nothing moved. Fixed in 067191b.
- **Splitters and the drag ghost act on their own stage's workspace in multi-output setups.** They resolved the globally focused output's workspace instead. `attachInput` gained an `output` option. Fixed in 2cfbc90.
- **Demo fixes:** title bars ellipsize before their controls give way (cbd5016); stateful title-bar buttons reflect window state (cb924b4); the outputs demo's workspace label (8b22031); the React demo's collapsed stage host (7f01c31).

### Adoption into the @johnhenry family

- Package identity (`@johnhenry/window-algebra`, `engines.node >=26.0.0`, `.nvmrc`, repository/homepage/bugs metadata, `publishConfig.access: public`, a committed lockfile) in 84ee344.
- Runnable, self-verifying examples (`examples/01`–`06`, `npm run examples`) and an index of the browser demos in 6791df0.
- CI (`ci.yml`: Node 26, concurrency block, examples smoke test, pack listing) and a release-triggered `publish.yml` (`npm view` guard, `--provenance --access public`) in 9e1ba22.
- The API reference (`docs/api/`) and the README reshaped to the family standard in 9df54a4.
