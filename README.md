# window-algebra

[![npm version](https://img.shields.io/npm/v/%40johnhenry%2Fwindow-algebra.svg)](https://www.npmjs.com/package/@johnhenry/window-algebra)
[![CI](https://github.com/johnhenry/window-algebra/actions/workflows/ci.yml/badge.svg)](https://github.com/johnhenry/window-algebra/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/%40johnhenry%2Fwindow-algebra.svg)](LICENSE)

Full documentation: [opensource.johnhenry.me/window-algebra](https://opensource.johnhenry.me/window-algebra/)

A functional window manager for browser applications. It is not a drop-in desktop replacement. It is a small set of parts you can put together into a floating, tiling, tabbed, docking or hybrid window manager.

```
command → update (pure) → state → derive (pure) → layout tree → compile (pure) → render tree → DOM
```

- **State is immutable data.** `update(state, command)` returns `{ state, events, effects }` and never touches the DOM, timers, the clock or randomness. A bad command is rejected with an event, never thrown.
- **Layout is an algebra.** Eleven primitives build a JSON tree. Named layouts such as `masterStack`, `bsp` and the docking `tree` are ordinary functions that return those primitives.
- **CSS is the layout engine.** Tiled windows get flex weights, grid tracks and anchor relationships instead of pixel rectangles. The browser works out the geometry, and every window is a container-query container.
- **The DOM is an effectful backend, not the source of truth.** The renderer reconciles a keyed render tree, so a window keeps its element, and its mounted surface, when the layout changes around it.

Zero dependencies. ESM only. The core runs in Node, workers and browsers.

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Examples](#examples)
- [The layout algebra](#the-layout-algebra)
- [State, commands and events](#state-commands-and-events)
- [Layouts, modifiers and drag-and-drop](#layouts-modifiers-and-drag-and-drop)
- [Policy at a glance](#policy-at-a-glance)
- [compile and the browser](#compile-and-the-browser)
- [Framework bindings](#framework-bindings)
- [API reference](#api-reference)
- [Adding a new layout](#adding-a-new-layout)
- [Honest limitations](#honest-limitations)
- [Family](#family)
- [License](#license)

## Install

```sh
npm install @johnhenry/window-algebra
```

**Provenance:** a new package, never published under another name. `0.0.0` is its first version under any name, not a sign of immaturity. Under npm's caret rules `^0.0.0` matches only `0.0.0`, so pin the exact version until a deliberate `0.1.0`.

Node ≥ 26 (`engines.node`) for the pure core in Node. In the browser, use it through a bundler, or with no build step through an import map. Import maps don't read `package.json` `exports`, so map each entry point you use to its file:

```html
<script type="importmap">
  {
    "imports": {
      "@johnhenry/window-algebra": "/node_modules/@johnhenry/window-algebra/src/index.mjs",
      "@johnhenry/window-algebra/browser": "/node_modules/@johnhenry/window-algebra/src/browser/index.mjs"
    }
  }
</script>
```

Entry points: `@johnhenry/window-algebra` (everything pure, plus the manager), `/browser` (renderer, input, surfaces, schedulers, pop-outs), `/react`, `/element`, and the narrower `/algebra`, `/transforms`, `/layouts` and `/css`. See [the entry-point table](docs/api/README.md#entry-points).

## Quick start

**The pure core**, anywhere (Node, a worker, a test):

```js
import { createState, update, derive, compile, presentationContext, toHTML } from "@johnhenry/window-algebra";

let state = createState({ layout: { type: "master-stack", ratio: 0.6 }, config: { gap: 8 } });
for (const id of ["editor", "terminal", "browser"]) state = update(state, { type: "window/create", id }).state;

const out = update(state, { type: "window/focus", id: "nope" });
// out.events → [{ type: "command/rejected", command: "window/focus", id: "nope", reason: "unknown-window" }]

const tree = derive(state);                                 // a JSON layout-algebra tree
const html = toHTML(compile(tree, presentationContext(state))); // flex: 0.6 1 0 …, no pixels
```

**In the browser**, the manager drives a DOM renderer and an input adapter:

```js
import { createWindowManager, createState, BASE_CSS } from "@johnhenry/window-algebra";
import {
  createDomRenderer, attachInput, htmlSurface, createSurfaceRegistry, createFrameScheduler,
} from "@johnhenry/window-algebra/browser";

document.head.append(Object.assign(document.createElement("style"), { textContent: BASE_CSS }));
const root = document.querySelector("#desktop");          // give it a size
const surfaces = createSurfaceRegistry();
const wm = createWindowManager({
  state: createState({ layout: { type: "master-stack", ratio: 0.6 }, config: { gap: 6 } }),
  renderer: createDomRenderer({ root, surfaceFor: surfaces }),
  schedule: createFrameScheduler(), // many commands → one commit per frame
  history: true,                    // undo/redo for window management
});
attachInput({ root, wm });          // pointer, keyboard focus sync, drag and drop

surfaces.set("editor", htmlSurface(editorElement));
wm.create({ id: "editor", title: "Editor" });
wm.create({ id: "terminal", title: "Terminal" });
wm.create({ id: "calc", title: "Calculator", mode: "floating", placement: { x: 200, y: 100, width: 320, height: 240 } });

wm.setLayout({ type: "bsp" });
wm.undo();
```

A surface's markup opts into the pointer adapter: `data-wm-handle="move"` on a title bar, `data-wm-handle="resize-se"` on a grip, `data-wm-command="window/close"` on a button. See [Browser adapters › Markup contract](docs/api/browser.md#markup-contract).

## Examples

- **[`examples/`](examples/)**: six self-verifying Node scripts over the pure core (`npm run examples`; CI runs them), from the pipeline to CSS through drop semantics, migration and the popup/snap geometry.
- **[`demo/`](demo/)**: interactive browser pages. Serve the repository root with any static server and open `/demo/` (ES modules don't load from `file://`). The hub renders a capability checklist of which page exercises each primitive, transform, layout, command, rejection, policy, surface and event. Pages: playground, layouts, desktop, console, surfaces, geometry, IDE, outputs, custom element, React (needs network for esm.sh), and the minimal quick start.

The [examples index](examples/README.md) says what each one demonstrates.

## The layout algebra

Every container and modifier takes an **options object first**, then its child or children. `view(id)` is the only exception.

| Kind | Primitive | Meaning | CSS realization |
| --- | --- | --- | --- |
| Leaf | `view(id)` | a presentation of a window/surface | `<wm-view>` with `container-type: size` |
| Container | `row(options, ...children)` | horizontal composition | flex row |
| Container | `column(options, ...children)` | vertical composition | flex column |
| Container | `grid(options, ...children)` | two-dimensional constraint space | CSS Grid (tracks, areas, auto-fit) |
| Container | `stack(options, ...children)` | children share one allocation (`active`, `chrome: "tabs"`) | one grid cell; inactive children `visibility: hidden` + `inert` |
| Container | `overlay(options, ...children)` | independent layers of the same region | one grid cell, z-ordered |
| Modifier | `place(options, child)` | position within the parent's allocation | `translate`, insets, grid lines/areas, self-alignment |
| Modifier | `size(options, child)` | allocation constraint (`weight`, `width`, `min`, `aspectRatio`, …) | flex, width/height, min/max, aspect-ratio |
| Modifier | `gap(options, child)` | separation between siblings | `gap` |
| Modifier | `inset(options, child)` | padding around an allocation | `padding` |
| Modifier | `anchor(options, child)` | position relative to another view, with `xdg_positioner`-style `flip`/`slide`/`resize`/`gravity` | CSS anchor positioning, with a JS fallback |

```js
import { overlay, inset, gap, row, column, size, anchor, view } from "@johnhenry/window-algebra";

const layout = overlay(
  {},
  inset({ all: 8 }, gap({ all: 8 },
    row({ align: "stretch" },
      size({ weight: 2 }, view("editor")),
      size({ weight: 1 }, column({}, view("browser"), view("terminal"))),
    ),
  )),
  anchor({ to: "editor", x: "center", y: "center" }, size({ width: 480, height: "content" }, view("dialog"))),
);
```

There are three layers, and keeping them apart stops convenience helpers from turning into primitives:

1. **Primitive constructors**: the eleven above.
2. **Derived layouts** (`src/layouts/`): `masterStack`, `columns`, `rows`, `monocle`, `tabs`, `autoGrid`, `fixedGrid`, `spiral`, `bspToLayout`, `treeToLayout`, and the sugar helpers `floating`, `centered`, `dock` and `hybrid`.
3. **Tree transforms**: `mirror`, `flip`, `rotate`, `reverse`, `mapViews`, `replace`, `remove`, `swap`, `find`, `views`, `walk`, `fold`, `transform`, `count`, `equals`.

Trees are deep-frozen and serializable; `validate` reports an invalid tree by path, and `fromJSON` round-trips one. Every option is in [Layout algebra](docs/api/algebra.md).

## State, commands and events

State is one plain object: windows, workspaces, outputs, focus with history, per-layer stacking, `config`. A **command** expresses intent. **Events** record what actually happened, which can differ: focus may be redirected to a modal, or a duplicate id rejected. **Effects** (`render`, `focus`) are values for the effectful shell.

```js
import { createState, update, reduce, replay, derive, COMMANDS } from "@johnhenry/window-algebra";

let state = createState({ workspaces: ["main", "dev"] });
const out = update(state, { type: "window/create", id: "editor" });
// out.events  → [{ type: "window/created", id: "editor" }, { type: "window/focused", id: "editor", previous: null }]
// out.effects → [{ type: "render" }, { type: "focus", id: "editor" }]
```

The 58 built-in commands (`COMMANDS`), each documented with payload, events, effects and rejections in [Commands](docs/api/commands.md):

- **Windows:** `window/create`, `window/close` (cascades to child windows), `window/focus`, `window/blur`, `focus/next`, `focus/previous`, `window/raise`, `window/lower`, `window/set-layer`, `window/move`, `window/resize`, `window/set-mode`, `window/toggle-floating`, `window/minimize`, `window/maximize`, `window/fullscreen`, `window/restore`, `window/toggle-maximize`, `window/toggle-fullscreen`, `window/pop-out`, `window/pop-in`, `window/set-title`, `window/set-constraints`, `window/swap`, `window/promote`, `window/move-to-workspace`, `window/set-urgent`, `focus/urgent`
- **Drag and drop:** `window/drop`, `window/detach`, `window/swap-next`, `window/swap-previous`, `window/move-before`, `window/move-after`, `window/set-draggable`
- **Scratchpad and sticky:** `window/to-scratchpad`, `scratchpad/toggle`, `window/from-scratchpad`, `window/set-sticky`, `window/toggle-sticky`
- **Workspaces:** `workspace/create`, `workspace/activate`, `workspace/remove`, `workspace/rename`, `workspace/reorder`
- **Outputs:** `output/create`, `output/remove`, `output/focus`, `output/reorder`, `workspace/move-to-output`
- **Layout:** `layout/set`, `layout/set-ratio`, `layout/rotate-split`, `layout/resize-split`, `layout/toggle`, `layout/to-tree`
- **Config and rules:** `config/set`, `rules/set`

Add your own with `update(state, command, { "my/command": handler })`, or pass `extensions` to `createWindowManager`. The 47 event types are catalogued in [Events](docs/api/events.md), and the read-only queries (`isVisible`, `focusable`, `paintOrder`, `modalTarget`, …) in [Queries](docs/api/queries.md).

`createWindowManager` wraps all of this imperatively: `wm.dispatch`, `wm.create`/`focus`/`close`/…, `subscribe`, undo/redo, a command log where `replay(wm.origin, wm.log)` always equals `wm.getState()`, `serialize`/`load` with [migration](docs/api/versioning.md), and one renderer per output. See [The manager](docs/api/manager.md).

## Layouts, modifiers and drag-and-drop

Layout specs are plain data: `{ type: "master-stack", ratio }`, `{ type: "columns" }`, `{ type: "rows" }`, `{ type: "grid", min: 300 }`, `{ type: "spiral" }`, `{ type: "monocle" }`, `{ type: "tabs" }`, `{ type: "floating" }`, and the two stateful ones, `{ type: "bsp", tree }` and the n-ary docking `{ type: "tree", tree }` (row/column/tabs containers, in the style of i3, Dockview and GoldenLayout; `layout/to-tree` converts any layout into one). Add your own interpreters with `derive(state, { layouts })` or the manager's `layouts` option.

- **Persistent, resizable splits.** `layout/resize-split` stores sizes in the spec (a ratio, a BSP node, per-depth spiral ratios, or `sizes` arrays). `compile` renders a `[data-wm-splitter]` handle between resizable children, which you drag or nudge with the arrow keys.
- **Layout modifiers**, xmonad-style and serializable: `modifiers: [{ type: "smart-gaps" | "no-gaps" | "mirror" | "reflect-x" | "reflect-y" | "max-windows", ... }]`. Toggle between two whole layouts with `layout/toggle`.
- **Drag and drop edits structure, not pixels.** `window/drop { id, target, zone }` means insert-before/after, swap, split or add-as-tab depending on the layout, through a `DROPS` registry of drop interpreters that you can extend. `config.drag` controls the modes, edge zone, preview, detaching to floating, dropping floating windows into the layout, cross-workspace drops and a too-small check. Pinned windows (`draggable: false`) stay put. Children travel with their parent.

Full detail: [Layouts and modifiers](docs/api/layouts.md) and [Drag and drop](docs/api/drops.md).

## Policy at a glance

The built-in commands encode window-manager policy borrowed from xmonad, i3/sway, EWMH, ICCCM and Wayland. The [commands reference](docs/api/commands.md#shared-behaviour) has the exact rules.

- **Requested vs actual geometry.** `window/move`/`window/resize` store a request; `derive` uses it only for floating windows. Constraints (`minWidth`, …) apply to tiled windows as CSS min/max.
- **Size hints (ICCCM).** `aspectRatio` (exact or `{ min, max }`) and terminal-style `widthIncrement`/`heightIncrement`, honoured by `constrainSize` for floating move/resize. `geometry.sizeToCells` gives a live "80×24".
- **Focus is not stacking.** Raising on focus is a policy (`config.focusRaises`). Stacking is per layer (`background`, `normal`, `top`, `modal`, `popover`, `notification`, `system`), and raising a window raises its descendants above it. Tiled windows paint above the background layer and beneath everything else (`paintOrder`).
- **The modal graph.** Focusing a window with an open modal descendant focuses the deepest modal instead. A blocked window's contents are `inert`, but the window itself stays hit-testable, so a click on it redirects focus instead of falling through.
- **Roles are semantic.** `dialog` anchors to its parent's centre, `menu`/`popover`/`tooltip` anchor by side, and `notification` sits in a corner: `derive` decides, not the application.
- **Rules** (`config.rules`, like `ManageHooks` or `for_window`) set `mode`, `layer`, `workspace`, … at `window/create`. The caller's explicit fields always win.
- **Scratchpad (i3), sticky (EWMH), urgency (EWMH/X11), pop-out (GoldenLayout/Dockview), multiple outputs (sway).** All of these are pure state: `window/to-scratchpad` + `scratchpad/toggle`; `window/set-sticky`; `window/set-urgent` + `focus/urgent`; `window/pop-out`/`pop-in`; and `output/*` with a per-output `derive(state, { output })`.
- **Gestures are one step.** Commands sharing a `gesture` token form one undo step and one log entry, so a whole drag undoes at once.
- **Versioned state.** Every state carries `STATE_VERSION`, `migrate` upgrades older ones, and a newer one is refused (`state/load-rejected`), never half-loaded.

## compile and the browser

`compile(tree, presentationContext(state))` returns a render tree of `{ tag, key, attrs, style, children }`. It carries ARIA roles (`group`, `dialog` + `aria-modal`, `tablist`/`tab`/`tabpanel`, `separator`), state attributes (`data-focused`, `data-wm-blocked`, `data-wm-urgent`, …) and view elements keyed `view:<id>`. `toHTML` serializes it for server rendering or snapshots. Because every view is a size container, applications adapt with container queries without knowing how they were laid out:

```css
@container wm-view (width < 400px) { .sidebar { display: none; } }
```

In the browser (`@johnhenry/window-algebra/browser`):

- **`createDomRenderer({ root, surfaceFor, anchorFallback?, animate? })`** reconciles top-down and moves views with `moveBefore()` where available, so iframes, focus and playing media survive layout changes. It measures geometry, positions anchors with JS where CSS anchor positioning is missing, and animates commits with View Transitions (`animate`), skipping gestures and `prefers-reduced-motion`.
- **`attachInput({ root, wm })`** turns pointer and keyboard input into commands: floating move/resize with magnetism and snap zones; tiled drags with a ghost preview rendered by the same derive → compile pipeline; tab and splitter drags; touch long-press; keyboard focus kept in sync with WM focus; a modal focus trap; and opt-in F6 cycling, keyboard moving and `aria-live` narration.
- **Surfaces** share one contract, `{ mount(target), unmount() }`: `htmlSurface`, `lazySurface`, `iframeSurface`, `canvasSurface`, plus `createSurfaceRegistry`.
- **`createFrameScheduler()`** coalesces commits to one per frame.
- **`attachInput({ touch: true })`** (opt-in) adds touch and pen gestures: pinch to resize a floating window, swipe between tabs or workspaces, long-press for a context action. See [Touch and pen](docs/api/browser.md#touch-and-pen).
- **`attachPopouts({ wm, renderer })`** pops a window out into a real browser window, carrying its live DOM there and back.
- **`attachSync({ wm, channel })`** (opt-in) keeps the tabs of one origin in step over a `BroadcastChannel`: whole-state snapshots, last writer wins by Lamport clock, undo/redo and pop-outs handled. See [Cross-tab sync](docs/api/sync.md).

**Theming.** Every colour, radius, spacing, focus ring, splitter, title bar and shadow in the library's CSS is a `--wa-*` custom property, with light and dark defaults (OS preference or `data-theme`) and a `prefers-contrast: more` variant; override any of them on `:root`. See [Theming](docs/api/theming.md) and `demo/theming.html`.

Every option and attribute is in [compile and CSS](docs/api/compile.md) and [Browser adapters](docs/api/browser.md).

## Framework bindings

Neither binding adds a dependency.

- **React** (`@johnhenry/window-algebra/react`): `createReactBindings(React)` returns `useWindowManager`, `useWindowState(wm, selector)` and `<WindowManagerStage wm renderSurface createPortal>`, which renders window content as React portals while the WM owns layout and chrome.
- **Custom element** (`@johnhenry/window-algebra/element`): `defineWindowAlgebraElement()` registers `<wa-stage>`, a manager, renderer and input adapter for as long as the element is connected. `.configure({ wm, surfaceFor })`, `.wm`. `attachStage(host, options)` is the reusable core.

See [Framework bindings](docs/api/bindings.md).

## API reference

[`docs/api/`](docs/api/README.md) documents every public export, verified against the source and tests:

| Page | |
| --- | --- |
| [State](docs/api/state.md) | state shape, records, constants, every `config` key and default |
| [Commands](docs/api/commands.md) | all 58 commands: payloads, events, effects, rejections |
| [Events](docs/api/events.md) | all 47 event types and the two effects |
| [Queries](docs/api/queries.md) | visibility, focus, stacking, rules, `presentationContext` |
| [Layout algebra](docs/api/algebra.md) | primitives, options, validation, transforms |
| [Layouts and modifiers](docs/api/layouts.md) | `derive`, every layout spec, BSP and docking-tree helpers, split sizing, modifiers |
| [Drag and drop](docs/api/drops.md) | drop semantics per layout, interpreters, pointer helpers |
| [compile and CSS](docs/api/compile.md) | render tree, CSS mapping, attributes, `BASE_CSS` custom properties |
| [Theming](docs/api/theming.md) | the `--wa-*` tokens, light/dark/high-contrast defaults |
| [Geometry and interaction](docs/api/geometry.md) | rects, size hints, `positionPopup`, gesture math, snap and magnetism |
| [The manager](docs/api/manager.md) | options, methods, gestures, log, load/serialize |
| [Browser adapters](docs/api/browser.md) | renderer, input, surfaces, schedulers, pop-outs |
| [Cross-tab sync](docs/api/sync.md) | `attachSync`, the snapshot and Lamport-clock design, undo/redo and pop-outs |
| [Framework bindings](docs/api/bindings.md) | React and `<wa-stage>` |
| [Versioning](docs/api/versioning.md) | `migrate`, `MIGRATIONS`, adding a migration |
| [Errors](docs/api/errors.md) | what is rejected vs thrown; every reason |

The design rationale, prior art (xmonad's StackSet, River's policy/compositor split, AwesomeWM's stateless and stateful layouts, Elm's update loop) and open questions are in [`docs/PRD.md`](docs/PRD.md).

## Adding a new layout

The docking tree (`{ type: "tree" }`, commit `7ef2291`, with a follow-up fix in `067191b`) is the best worked example in this package's own history. It is the most recent built-in layout, and it is the harder of the two kinds: it is **stateful**, like BSP, so its structure lives in the spec and has to stay in sync with the windows. Its tests are `test/tree.test.mjs`, and `demo/layouts.html` and `demo/desktop.html` show it running.

**Smallest: a custom interpreter, no core change.** If your layout is a pure function of the tiled ids, like "one big window and the rest in a column", register it under a new `type` with the manager's `layouts` option (or `derive(state, { layouts })`): `(spec, ids, context) → tree`, built from the primitives. `layout/set` accepts it, it serializes, drops fall back to reading order, and you can give it a drop interpreter with the `drops` option (`orderDrops(() => "y")`). The whole cost is the function. A built-in is warranted only when the layout needs **state that must survive between renders** (a tree, per-split sizes) or has to reach into commands the core owns (seeding, keyboard neighbour order, `layout/to-tree`, `layout/resize-split`).

**A genuinely new built-in layout: the docking `tree`.** Each existing layout follows the same small pattern:

1. **`src/layouts/<name>.mjs`**: the pure helpers. `treeToLayout` interprets the stored structure as primitives. A stateless layout needs only this function (see `columns` in `src/layouts/index.mjs`). Re-export it from `src/layouts/index.mjs`.
2. **`src/state/derive.mjs`**: a `LAYOUTS` entry, `(spec, ids, context) → tree`, a copy of `bsp`'s own.
3. **`src/state/drops.mjs`**: a `DROPS` entry, `orderDrops(axis)` for an order-based layout, or `{ ops, apply }` for a stateful one (`treeDrops` beside `bspDrops`).
4. **The one part that isn't boilerplate: keeping stored structure honest.** `treeReconcile(spec.tree, ids)` runs inside the interpreter and the drop interpreter, dropping leaves for windows that are gone and appending new ones. Because of it, `window/create`, `window/close`, `window/set-mode` and every other command need **zero** awareness that the tree exists: the stored tree is repaired lazily whenever it is read. BSP does the same thing eagerly (`bspAdd`/`bspDrop` in `src/state/update.mjs`), which is why it touches more commands. What remains in `src/state/update.mjs` is seeding (`layout/set` fills an absent `tree` from the current order), the `layout/to-tree` conversion, and a `layout/resize-split` branch if it is resizable (emit `resize: { path, weights }` on each row/column, and teach `readSplitWeights` in `src/browser/input.mjs` its path scheme).

Why the keyboard commands need care: `067191b` fixed `window/swap-next` and `window/move-before` on tree workspaces. `swapWindows` and `neighbourOrder` special-cased only `bsp`, so swaps reordered `ws.windows` but not the tree, and nothing visibly moved. A new stateful layout must add its branch to `swapWindows`, `neighbourOrder` and `moveRelative` in `src/state/drops.mjs`, and a test that swaps a nested leaf.

**Tests.** Everything above is pure, so `test/tree.test.mjs` runs in plain Node with no DOM: the helpers, `derive`, `layout/set` and `layout/to-tree`, `layout/resize-split`, `window/drop` per zone, the keyboard commands, and undo/replay/serialization. Add the layout to `demo/layouts.html` and to the checklist in `demo/shared/coverage.mjs`.

A layout **modifier** (`smart-gaps`, `mirror`, …) is the other extension point, for decorating an existing layout rather than adding one. It is one `MODIFIERS` entry, plus an `applyModifiersToOps` case if it changes screen axes. See [Layouts › Layout modifiers](docs/api/layouts.md#layout-modifiers).

## Honest limitations

- **Several browser features are progressive, and the fallbacks differ.** CSS anchor positioning covers `flip` and an opposite-side `gravity`, but it has no equivalent for `slide`/`resize`, which work only under the JS fallback (`anchorFallback: true`, automatic where `CSS.supports("anchor-name: …")` is false). Without `Element.prototype.moveBefore`, a view moving between containers is re-inserted, and an iframe inside it reloads. Without View Transitions, `animate` is a no-op (by design, as it is under `prefers-reduced-motion`).
- **Pop-outs depend on the popup window.** `window.open` is subject to pop-up blockers: call `popOut` from a user gesture. A blocked popup is reported as a `popup-blocked` rejection, not an exception. Most browsers reload an iframe adopted into another document, so iframe state resets on the way out. A popped-out window is never the WM's focused window (focus is only given to windows on the stage), so focusing its popup clears the WM focus. A pop-in that doesn't go through `attachPopouts` (`window/restore`, undo) remounts the surface fresh instead of carrying the DOM back. Undoing a pop-out closes the popup; redoing it (or loading a saved state with a popped-out window) cannot reopen one without a user gesture, so `attachPopouts` pops the window back in instead of leaving it invisible.
- **The pure core has no pixels.** Tiled sizes are CSS's decision, so `config.drag.tooSmall: "reject"` is only enforced when a `geometry` estimate is supplied (the input adapter measures its ghost), size increments are advisory for tiled windows, and grid tracks are not resizable. `derive` and the renderer only see the layout; content that changes size without a commit needs `renderer.reposition()` for JS-positioned anchors, whose `ResizeObserver` watches only the stage root.
- **Some surfaces and observers are lazy.** A `lazySurface` builds on first mount and is never re-asked while its view stays rendered, so swapping a registry entry does not replace a mounted surface. `canvasSurface` repaints on resize only where `ResizeObserver` exists (it paints once otherwise). `<wa-stage>` creates a fresh manager on each connect or `configure()` unless you pass your own `wm`.
- **The pure `update` cannot know your custom layouts.** `layout/set` accepts any string `type`; `derive` falls back to `columns` for a type with no interpreter instead of throwing, and only the manager rejects it up front (`unknown-layout`). Stickiness is inherited by dialogs and popovers, and a workspace switch can still bring two fullscreen windows into view (a sticky one and one on the new workspace); only one is presented.
- **Keyboard accessibility is opt-in and partial.** Tabs and splitters work from the keyboard always; moving and resizing a floating window (Alt+Shift+Arrow, Ctrl+Alt+Shift+Arrow) needs `attachInput({ keyboard })`. Tabs use manual activation (arrows move focus, Enter/Space activates). Moves are not announced, and `workspace/rename` leaves `config.rules` that name the old id untouched.
- **Cross-tab sync is same-origin and last-writer-wins.** `attachSync` shares whole logical states over a `BroadcastChannel`; it is not collaboration between users, it does not merge concurrent edits (the loser's change is dropped), it syncs no surfaces or DOM, and pop-outs stay in the tab that opened them (peers see the window minimized). Two tabs that never changed anything share nothing, so seed them identically.
- **Touch gestures are opt-in and trade scrolling for recognition.** Pinch needs `touch-action: none` on floating windows (their content cannot be panned by touch) and the two-finger workspace swipe needs `pan-y` on the stage (nothing inside scrolls horizontally by touch). Pinch and the workspace swipe are touch-only, a pen being one pointer. Moving or docking a tiled window by touch still needs a still long press, so it does not compete with scrolling.
- **The bindings commit once per animation frame.** `<wa-stage>` and `WindowManagerStage` coalesce commits with `createFrameScheduler()`, so a hidden tab (which never runs `requestAnimationFrame`) does not repaint until it is shown again. Pass `schedule: immediateScheduler` for synchronous commits.

## Family

window-algebra is one of three zero-build, browser-first ESM libraries in this family. None of them depends on another. They fit together at the page level:

- **[`@johnhenry/html-modules`](https://github.com/johnhenry/html-modules)**: declarative HTML modules. `<html-import src="./ui.html" as="ui">` turns each `<html-export>` in an ordinary HTML file into a native custom element (`<ui--card>`). Those elements are exactly what window-algebra's surfaces host: `htmlSurface(document.createElement("ui--card"))` (or a `lazySurface` that creates one on first mount) puts an HTML-module component in a window. window-algebra only ever calls `mount(target)`/`unmount()`, so it needs no knowledge of how the element was defined. Neither package depends on the other.
- **[`@johnhenry/mport`](https://github.com/johnhenry/mport)**: routes JavaScript imports across CDNs and compiles the result to a standard import map. A no-build page using window-algebra needs an import-map entry for each entry point it imports (see [Install](#install)), and for anything it loads alongside, such as React for the `/react` binding, which `demo/react.html` currently fetches from esm.sh by a hard-coded URL. mport can produce that map with fallback across mirrors, instead of hand-written URLs. There is no dependency in either direction; the browser only sees the resulting import map.

## License

MIT. See [LICENSE](LICENSE).
