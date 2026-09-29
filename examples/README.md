# window-algebra examples

Two kinds of example live in this repository.

- **`examples/` (this directory):** runnable, self-verifying Node scripts. Each one asserts the behavior it demonstrates and exits 0 on success, so `npm run examples` doubles as a smoke test (CI runs it). They exercise the pure core only (`update`, `derive`, `compile`, the manager, geometry). That is the same code that runs in the browser; only the DOM renderer and the pointer adapter are left out.
- **[`demo/`](../demo/):** interactive browser pages. They exercise the DOM renderer, the input adapter, surfaces, pop-outs and the framework bindings, which need a real browser. They are listed [below](#browser-demos-demo) and are **not** part of `npm run examples`.

| Example | Demonstrates |
| --- | --- |
| [`01-state-derives-a-tree-that-compiles-to-css.mjs`](./01-state-derives-a-tree-that-compiles-to-css.mjs) | The whole pure pipeline runs in Node: `update` returns `{ state, events, effects }` and leaves the old state alone, `derive` produces a JSON layout tree, and `compile` turns a master-stack into `flex: 0.6 1 0` / `0.4 1 0` weights and a grid into `repeat(auto-fit, minmax(240px, 1fr))`. It produces CSS relationships, not pixel rectangles. |
| [`02-bad-commands-are-rejected-and-history-replays.mjs`](./02-bad-commands-are-rejected-and-history-replays.mjs) | Bad input (a duplicate id, an unknown window, command or layer, a `null` command, a layout no interpreter knows) becomes a `command/rejected` event and leaves state untouched (same reference). Nothing is thrown. A drag of 11 `window/move` commands sharing a `gesture` token undoes in one step. `replay(wm.origin, wm.log)` equals `wm.getState()`. `simulate()` changes nothing. |
| [`03-a-drop-edits-structure-per-layout.mjs`](./03-a-drop-edits-structure-per-layout.mjs) | `window/drop` means different things per layout: insert before/after in `columns`/`rows`, split in `bsp`, add-as-tab in the docking `tree`. A `reflect-x` modifier flips `left` to mean "after". `config.drag.tiled: "swap"` rejects inserts (`zone-disabled`), a pinned window rejects the drag (`not-draggable`), and a custom layout gets its own interpreter via `createDropHandler`. |
| [`04-saved-state-migrates-and-newer-state-is-refused.mjs`](./04-saved-state-migrates-and-newer-state-is-refused.mjs) | `serialize()`/`load()` round-trips exactly. An unversioned (version 0) state migrates through `0 → 1 → 2`: drag settings, the urgent list and a single default output are backfilled, and the result works with `update`. A state from a newer build is refused (`future-version`), as is invalid JSON; `wm.load()` then fires `state/load-rejected` and keeps its current state. |
| [`05-rules-scratchpad-urgency-and-outputs-are-pure-policy.mjs`](./05-rules-scratchpad-urgency-and-outputs-are-pure-policy.mjs) | Policy is decided in the pure core. Window rules fill in fields at `window/create`, and the caller's explicit fields win. Malformed rules are rejected. The scratchpad hides a window and brings it back floating and centered. `focus/urgent` crosses workspaces and clears the hint. Focusing a window behind a modal is redirected to the modal. Two outputs each derive their own workspace, and an output cannot give away its last workspace. |
| [`06-popup-snap-and-size-hint-math-needs-no-dom.mjs`](./06-popup-snap-and-size-hint-math-needs-no-dom.mjs) | `positionPopup` flips a menu above an anchor near the bottom edge only when `flip` allows that axis; `slide` and `resize` move it back into the stage or shrink it to fit. Snap zones resolve to halves and quarters, magnetism pulls an edge within 8 px onto a neighbour, and terminal-style size increments round 650×390 to 81×24 cells. Resizing a 16:9 window from its east edge adjusts the height. |

## Running

```sh
npm run examples      # run all in sequence
npm run example:01    # run one
node examples/01-state-derives-a-tree-that-compiles-to-css.mjs
```

The examples import the package by its own name (`@johnhenry/window-algebra`). Node resolves that to this checkout through the `exports` field (package self-reference), so they run unchanged when copied into a project that has the package installed.

## Runtime requirements (honest edition)

These examples run under **plain Node >= 26**, with no browser and no dependencies. They cover everything in the pure core. They deliberately do **not** cover the DOM renderer (`createDomRenderer`), the pointer/keyboard adapter (`attachInput`), pop-outs (`attachPopouts`), animation (View Transitions) or the React and custom-element bindings. Those need a real `document`, pointer events and layout. The unit tests cover their logic headlessly against a small fake DOM (`test/helpers/fake-dom.mjs`; see `test/browser.test.mjs`, `test/drag-input.test.mjs`, `test/popouts.test.mjs`, `test/react-bindings.test.mjs`, `test/element-bindings.test.mjs`), and the browser demos below exercise them for real.

## Browser demos (`demo/`)

Serve the repository root with any static server (for example `python3 -m http.server`) and open `/demo/`. ES modules don't load from `file://`. The hub page, `demo/index.html`, links every page and renders a capability checklist (`demo/shared/coverage.mjs`) showing which page exercises each primitive, transform, layout, command, rejection, policy, surface and event. Every page except `react.html` works offline.

| Example | Demonstrates |
| --- | --- |
| [`demo/index.html`](../demo/index.html) | The hub: links every page and computes the capability checklist from what each page declares it covers. |
| [`demo/basic.html`](../demo/basic.html) | The minimal quick start: a manager, a DOM renderer, the input adapter and lazy surfaces. |
| [`demo/playground.html`](../demo/playground.html) | Edit a layout tree as JSON or with constructors, apply every transform, and read the compiled CSS, `toHTML` output and render tree beside a live preview. |
| [`demo/layouts.html`](../demo/layouts.html) | Every derived layout (plus two custom interpreters) switchable live, small multiples of all of them at once, and divider drag via `updateRatio`. |
| [`demo/desktop.html`](../demo/desktop.html) | Workspaces, floating and tiled windows, dock panels, the 7 stacking layers, focus vs raise, nested modals with focus redirection, every role, keyboard shortcuts, snap zones, pop-out (with a "block next pop-out" toggle for the `popup-blocked` path) and the `animate` toggle. |
| [`demo/console.html`](../demo/console.html) | Compose any command, see a gallery of every rejection and the events and effects of each dispatch, plus undo/redo, a replay scrubber, serialize/restore, versioning and migration. |
| [`demo/surfaces.html`](../demo/surfaces.html) | html, lazy, iframe (`srcdoc`) and canvas surfaces keep their state while windows move through layouts. |
| [`demo/geometry.html`](../demo/geometry.html) | Requested vs measured geometry, constraints on tiled windows, size hints (aspect ratio, width/height increments) with a live "80×24" cell readout, container queries, CSS anchors vs the forced JS fallback, and positioner rules (`gravity`/`flip`/`slide`/`resize`) with a "pin near a corner" overflow trigger. |
| [`demo/ide.html`](../demo/ide.html) | A realistic IDE built from the pieces: a custom grid-areas layout, tab stacks, a command palette, context menus, toasts, three workspaces and session persistence. |
| [`demo/outputs.html`](../demo/outputs.html) | Multiple outputs (sway-style displays): two stages side by side, each with its own workspaces, renderer and input adapter (`output` option), driven by one manager. Move workspaces between outputs and watch `focus/next` cross both. |
| [`demo/element.html`](../demo/element.html) | The `<wa-stage>` custom element: no framework, no build step, fully offline. |
| [`demo/react.html`](../demo/react.html) | The React bindings: `useWindowManager`, `useWindowState`, and `WindowManagerStage` with window content as React portals. **Loads React from esm.sh, so it needs network access.** |

`demo/shared/kit.mjs`, `demo/shared/style.css` and `demo/shared/coverage.mjs` are the demos' shared chrome, stylesheet (light/dark, phone-width layouts, reduced-motion-aware transitions) and checklist data.
