# window-algebra

A functional window manager for browser applications. It is not a drop-in desktop replacement. It is a small set of pieces you can put together into a floating, tiling, tabbed, or hybrid window manager.

```
command → update (pure) → state → derive (pure) → layout tree → compile (pure) → CSS → DOM
```

- **State is immutable data.** `update(state, command)` returns `{ state, events, effects }` and never touches the DOM, timers, or randomness.
- **Layout is an algebra.** Eleven primitives build a JSON tree. Named layouts such as `masterStack` and `bsp` are ordinary functions that return those primitives.
- **CSS is the layout engine.** Tiled windows get flex weights, grid tracks, and anchor relationships instead of pixel rectangles. The browser works out the actual geometry.
- **The DOM is an effectful backend, not the source of truth.** The renderer reconciles a keyed render tree, so a window keeps its element and its mounted surface when the layout changes around it.

Zero dependencies. ESM only. The core runs in Node, workers, and browsers.

## Install

The package is not published yet. Import it from source:

```js
import { createWindowManager } from "./src/index.mjs";
import { createDomRenderer, attachInput } from "./src/browser/index.mjs";
```

## Quick start

```js
import { createWindowManager, createState } from "@johnhenry/window-algebra";
import {
  createDomRenderer,
  attachInput,
  htmlSurface,
  createSurfaceRegistry,
  createFrameScheduler,
} from "@johnhenry/window-algebra/browser";

const root = document.querySelector("#desktop");
const surfaces = createSurfaceRegistry();
const wm = createWindowManager({
  state: createState({ layout: { type: "master-stack", ratio: 0.6 }, config: { gap: 6 } }),
  renderer: createDomRenderer({ root, surfaceFor: surfaces }),
  schedule: createFrameScheduler(), // many commands → one commit per frame
  history: true, // undo/redo for window management
});
attachInput({ root, getState: wm.getState, dispatch: wm.dispatch });

surfaces.set("editor", htmlSurface(editorElement));
wm.create({ id: "editor", title: "Editor" });
wm.create({ id: "terminal", title: "Terminal" });
wm.create({ id: "calc", title: "Calculator", mode: "floating", placement: { x: 200, y: 100, width: 320, height: 240 } });

wm.setLayout({ type: "bsp" });
wm.undo();
```

To run the demo, serve the repository root with any static server and open `/demo/`. ES modules don't load from `file://`.

## The layout algebra

Every container and modifier takes an **options object first**, then its child or children. `view(id)` is the only exception.

| Kind      | Primitive                         | Meaning                                          | CSS realization                            |
| --------- | --------------------------------- | ------------------------------------------------ | ------------------------------------------ |
| Leaf      | `view(id)`                        | a presentation of a window/surface               | `<wm-view>` with `container-type: size`    |
| Container | `row(options, ...children)`       | horizontal composition                           | flex row                                   |
| Container | `column(options, ...children)`    | vertical composition                             | flex column                                |
| Container | `grid(options, ...children)`      | two-dimensional constraint space                 | CSS Grid (tracks, areas, auto-fit)         |
| Container | `stack(options, ...children)`     | children share one allocation (`active`, `chrome: "tabs"`) | single grid cell; inactive children `visibility: hidden` + `inert` |
| Container | `overlay(options, ...children)`   | independent layers of the same region            | single grid cell, z-ordered                |
| Modifier  | `place(options, child)`           | position within the parent's allocation          | `translate`, insets, grid lines/areas, self-alignment |
| Modifier  | `size(options, child)`            | allocation constraint (`weight`, `width`, `min`, `aspectRatio`, …) | flex, width/height, min/max, aspect-ratio |
| Modifier  | `gap(options, child)`             | separation between siblings                      | `gap`                                      |
| Modifier  | `inset(options, child)`           | padding around an allocation                     | `padding`                                  |
| Modifier  | `anchor(options, child)`          | position relative to another view                | CSS anchor positioning, with a JS fallback |

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
  anchor({ to: "editor", x: "center", y: "center" },
    size({ width: 480, height: "content" }, view("dialog")),
  ),
);
```

The algebra has three layers, and keeping them apart stops convenience helpers from turning into primitives:

1. **Primitive constructors**: the eleven above.
2. **Derived layouts** (`src/layouts/`): `masterStack`, `columns`, `rows`, `monocle`, `tabs`, `autoGrid`, `fixedGrid`, `spiral`, `bspToLayout`, and the sugar helpers `floating`, `centered`, `dock`, `hybrid`.
3. **Tree transformations** (`src/algebra/transforms.mjs`): `mirror`, `flip`, `rotate`, `reverse`, `mapViews`, `replace`, `remove`, `swap`, `find`, `views`, `walk`, `fold`, `transform`.

Every tree can be serialized. `fromJSON` and `validate` round-trip a tree and report invalid ones by path.

## Logical state and commands

```js
import { createState, update, reduce, replay, derive } from "@johnhenry/window-algebra";

let state = createState({ workspaces: ["main", "dev"] });
const out = update(state, { type: "window/create", id: "editor" });
// out.events  → [{ type: "window/created", ... }, { type: "window/focused", ... }]
// out.effects → [{ type: "render" }, { type: "focus", id: "editor" }]
```

Built-in commands (see `COMMANDS`):

- **Windows:** `window/create`, `window/close` (cascades to child windows), `window/focus`, `window/blur`, `focus/next`, `focus/previous`, `window/raise`, `window/lower`, `window/set-layer`, `window/move`, `window/resize`, `window/set-mode`, `window/toggle-floating`, `window/minimize`, `window/maximize`, `window/fullscreen`, `window/restore`, `window/set-title`, `window/set-constraints`, `window/swap`, `window/promote`, `window/move-to-workspace`
- **Workspaces:** `workspace/create`, `workspace/activate`, `workspace/remove`
- **Layout:** `layout/set`, `layout/set-ratio`, `layout/rotate-split`
- **Config:** `config/set`

The policy decisions baked into these commands:

- **Commands versus events.** The manager can say no. A duplicate id, an unknown parent, or a malformed command produces a `command/rejected` event. It never throws.
- **Requested versus actual geometry.** `window/move` and `window/resize` store the requested placement. `derive` uses it only when a window is floating.
- **Focus is not stacking.** Raising on focus is a policy (`config.focusRaises`). Stacking uses per-layer order: `background`, `normal`, `top`, `modal`, `popover`, `notification`, `system`.
- **The modal graph.** Focusing a window that has an open modal descendant sends focus to the deepest modal. Blocked windows render with `inert`.
- **Roles are semantic.** `dialog` anchors to its parent's center, `menu`/`popover`/`tooltip` anchor by side, and `notification` sits in a corner. `derive` decides the presentation, not the application.
- **BSP is a stateful layout expressed functionally.** Its tree lives in workspace state and is kept in sync as windows are created, closed, floated, or moved.

Add your own commands with `update(state, command, { "my/command": handler })`, or pass `extensions` to `createWindowManager`.

## derive: from state to presentation

`derive(state, { layouts })` returns an `overlay` for the active workspace. The tiled base comes first, and floating windows, dialogs, popovers, and notifications are layered above it in stacking order. Layout specs are plain data (`{ type: "master-stack", ratio }`, `{ type: "bsp", tree }`, `{ type: "grid", min: 300 }`, …). You can add interpreters:

```js
derive(state, {
  layouts: {
    coding: (spec, ids) => row({}, size({ weight: 3 }, view(ids[0])), column({}, ...ids.slice(1).map(view))),
  },
});
```

## compile: from layout tree to CSS

`compile(tree, presentationContext(state))` returns a render tree of `{ tag, key, attrs, style, children }`. `toHTML()` serializes it for server rendering or snapshots. View elements are keyed `view:<id>`, so a layout change moves elements instead of recreating them. When a view appears more than once, the extra copies become non-primary projections.

## Browser adapters

- `createDomRenderer({ root, surfaceFor })` reconciles the keyed DOM, mounts and unmounts surfaces, measures realized geometry with `measure()`, and positions anchors with JS when CSS anchor positioning isn't supported.
- `attachInput({ root, getState, dispatch })` turns pointer events into commands. The markup contract is: `data-wm-handle="move"`, `data-wm-handle="resize-se"` (any edge or corner), `data-wm-command="window/close"`, and tab buttons with `data-wm-tab`.
- Surfaces share one contract, `{ mount(target), unmount() }`. Provided implementations: `htmlSurface`, `lazySurface`, `iframeSurface`, and `canvasSurface` (an html-in-canvas style surface that repaints when its size changes).
- `createFrameScheduler()` coalesces many commands into one commit per animation frame.

Because every view is a size container, applications adapt with container queries. They don't need to know whether they were tiled, tabbed, or resized by hand.

```css
@container wm-view (width < 400px) { .sidebar { display: none; } }
```

## Scripts

```sh
npm test   # node --test test/*.test.mjs
```

## Design notes

`docs/PRD.md` covers the rationale, the prior art (xmonad's StackSet, River's policy/compositor split, AwesomeWM's stateless and stateful layouts, Elm's update loop), and the open questions.

## License

MIT
