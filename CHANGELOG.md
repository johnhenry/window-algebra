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
- **Three bugs found while writing the API reference.** `window/promote` on a window hidden in the scratchpad threw a `TypeError` (it now rejects with `not-on-workspace`); `workspace/remove` left child windows whose parent lived on another workspace pointing at the removed workspace (they now move to the fallback); and an anchor without `flip` flipped on both axes under CSS anchor positioning but on neither under the JS fallback (the fallback now matches CSS). Fixed in the commit that adds this entry.
- **Splitters and the drag ghost act on their own stage's workspace in multi-output setups.** They resolved the globally focused output's workspace instead. `attachInput` gained an `output` option. Fixed in 2cfbc90.
- **Demo fixes:** title bars ellipsize before their controls give way (cbd5016); stateful title-bar buttons reflect window state (cb924b4); the outputs demo's workspace label (8b22031); the React demo's collapsed stage host (7f01c31).

### Audit fixes made before the first release

Found by a full audit and a seeded invariant fuzz (`test/invariants.test.mjs`, fe4c070), which runs every command with junk payloads on deep-frozen states and after random walks, and checks structural invariants (focus is on a presented window, a blocked window's blocker is presented, `derive` never throws, ...). Its known-violations list is now empty. The regression tests are in `test/audit.test.mjs`.

**Breaking changes** (none of this has been published): `window/swap` takes `{ id, target }` instead of `{ a, b }` and emits `window/swapped { id, target }`; `window/to-scratchpad` emits `scratchpad/hidden` instead of `window/scratchpad`; `window/pop-in` on a window that is not popped out is a no-op instead of a `not-popped-out` rejection; `window/set-sticky` without `sticky` means `true`; the bindings (`<wa-stage>`, `WindowManagerStage`) commit once per frame by default instead of synchronously.

- **Ids that are `Object.prototype` keys are rejected as `invalid-id`** (`__proto__`, `constructor`, ...), instead of throwing or corrupting state. Fixed in 4fc8eb1.
- **`window/create` rejects an unknown `layer`, `role` or `mode`** (`unknown-layer`, `unknown-role`, `unknown-mode`) instead of storing it and breaking the stack. Fixed in 07082f0.
- **Focus only goes to windows that are shown.** `window/focus` and `focus/urgent` reject hidden (scratchpad) and popped-out targets (`not-on-workspace`, `popped-out`, `not-visible`); a fullscreen window's own dialogs are painted and focusable (fullscreening a parent with an open modal child no longer deadlocks); `window/fullscreen` and `window/maximize` take focus; `window/swap` and the scratchpad commands no longer throw on hidden windows. Fixed in 42b8954.
- **Undo, redo and load keep the outside world in step.** They now report the focus change (`window/focused`/`window/blurred` plus a `focus` effect) so DOM focus follows, and `attachPopouts` reconciles popups with the state on every notification: undoing a pop-out closes the popup, and redoing it (or loading a state with a popped-out window) pops the window back in instead of leaving it invisible. Fixed in 013c8c1.
- **`layout/set-ratio` rejects layouts without a ratio** (`not-resizable`; it used to write `{ ratio }` over a function layout and make `derive` throw) and non-numbers (`invalid-ratio`); **`derive` falls back to `columns`** for a layout type nothing interprets instead of throwing; **`workspace/create` no longer copies** the active workspace's tree, sizes or ratios (which named another workspace's windows). **`window/move`, `window/resize`, `config/set` and `window/set-constraints` validate their input** (`invalid-geometry`, `invalid-config`, `invalid-constraints`): NaN, strings, negative sizes and gaps, unknown config keys and bad constraints are refused. **`window/set-layer` moves a window's descendants with it**, so a child is not left painted beneath its parent. Fixed in baade53.
- **A consistent command set.** New: `window/toggle-maximize`, `window/toggle-fullscreen`, `window/toggle-sticky`, `window/from-scratchpad`, `workspace/rename`, `workspace/reorder`, `output/reorder` (58 commands, up from 51). `window/set-urgent` and `window/set-sticky` agree on a missing boolean; the hidden-scratchpad event has one name; extension handlers that throw become `handler-threw` rejections. Found along the way by the fuzz: `window/fullscreen` now keeps one fullscreen window per output, a sticky window's dialogs are sticky too (a modal child could be stranded on another workspace, blocking a window with an invisible dialog), and `window/create` rejects a falsy non-null `parent` such as `NaN`. Fixed in 3f55216.
- **Accessibility.** Tabs use a roving `tabindex` with Arrow/Home/End navigation and Enter/Space activation; splitters have an `aria-label` ("Resize X and Y") and `aria-controls`; `:focus-visible { outline: none }` is replaced by a strong focus ring; windows with an empty title are named by their id; Alt+Shift+Arrow moves and Ctrl+Alt+Shift+Arrow resizes a floating window (`attachInput({ keyboard })`, `floatStep`); `prefers-reduced-motion` also switches off CSS transitions and animations. Checked in a real browser (the layouts demo). Fixed in 1c824bd.
- **Performance.** `<wa-stage>` and `WindowManagerStage` commit once per frame (`createFrameScheduler()`) by default; `derive` uses Sets; the window-tree queries share a parent-to-children index instead of rescanning every window per parent (`derive` plus `presentationContext` did O(n²) work). Fixed in 73c2f17.

### Adoption into the @johnhenry family

- Package identity (`@johnhenry/window-algebra`, `engines.node >=26.0.0`, `.nvmrc`, repository/homepage/bugs metadata, `publishConfig.access: public`, a committed lockfile) in 84ee344.
- Runnable, self-verifying examples (`examples/01`–`06`, `npm run examples`) and an index of the browser demos in 6791df0.
- CI (`ci.yml`: Node 26, concurrency block, examples smoke test, pack listing) and a release-triggered `publish.yml` (`npm view` guard, `--provenance --access public`) in 9e1ba22.
- The API reference (`docs/api/`) and the README reshaped to the family standard in 9df54a4.
