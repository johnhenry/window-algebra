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

## Examples

Serve the repository root with any static server and open `/demo/`. ES modules don't load from `file://`. The hub page links every example and renders a capability checklist (`demo/shared/coverage.mjs`) showing which page exercises each primitive, transform, layout, command, rejection, policy, surface and event.

| Page | What it shows |
| --- | --- |
| `playground.html` | Edit a layout tree as JSON or with constructors, apply every transform, read the compiled CSS / `toHTML` / render tree beside a live preview. |
| `layouts.html` | Every derived layout (plus two custom interpreters) switchable live, small multiples of all of them at once, divider drag via `updateRatio`. |
| `desktop.html` | Workspaces, floating/tiled, dock panels, the 7 stacking layers, focus vs raise, nested modals with focus redirection, every role, keyboard shortcuts. |
| `console.html` | Compose any command, a gallery of every rejection, events and effects per dispatch, undo/redo, replay scrubber, serialize/restore. |
| `surfaces.html` | html, lazy, iframe (`srcdoc`) and canvas surfaces keeping their state while windows move through layouts. |
| `geometry.html` | Requested vs measured geometry, constraints on tiled windows, container queries, CSS anchors vs the forced JS fallback, geometry helpers. |
| `ide.html` | A realistic IDE built from the pieces: custom grid-areas layout, tab stacks, command palette, context menus, toasts, three workspaces, session persistence. |
| `basic.html` | The minimal quick start. |

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
- **Drag and drop:** `window/drop`, `window/detach`, `window/swap-next`, `window/swap-previous`, `window/move-before`, `window/move-after`, `window/set-draggable` (and `window/move-to-workspace` takes `follow: true`)
- **Workspaces:** `workspace/create`, `workspace/activate`, `workspace/remove`
- **Layout:** `layout/set`, `layout/set-ratio`, `layout/rotate-split`
- **Config:** `config/set`

The policy decisions baked into these commands:

- **Commands versus events.** The manager can say no. A duplicate id, an unknown parent, or a malformed command produces a `command/rejected` event. It never throws. `createWindowManager` also rejects a `layout/set` or `workspace/create` whose layout type no interpreter knows (`unknown-layout`), since `update` cannot see the interpreter registry.
- **Requested versus actual geometry.** `window/move` and `window/resize` store the requested placement. `derive` uses it only when a window is floating. Size constraints (`minWidth`, `maxHeight`, …) apply to tiled windows too, as CSS min/max sizes.
- **Focus is not stacking.** Raising on focus is a policy (`config.focusRaises`). Stacking uses per-layer order: `background`, `normal`, `top`, `modal`, `popover`, `notification`, `system`. Raising a window raises its descendants above it, so a child is never painted beneath its parent (and an anchored child always follows its anchor, which CSS anchor positioning requires).
- **The modal graph.** Focusing a window that has an open modal descendant sends focus to the deepest modal. A blocked window renders with `data-wm-blocked`: its contents are `inert` (no focus, no input, hidden from assistive tech), but the window itself stays hit-testable, so clicking it redirects focus to the modal instead of falling through to the window underneath. It cannot be dragged or resized.
- **Keyboard focus follows WM focus, and vice versa.** Pass the manager's `subscribe` to `attachInput({ root, getState, dispatch, subscribe })`. When a window is focused by a command (a shortcut, a taskbar, the API), DOM focus moves into it: back to the element last focused there, otherwise the view itself (`tabindex="-1"`). Focus is never taken from a text field outside `root`. In the other direction, keyboard focus entering a window (Tab, `.focus()`) focuses and raises it, just as a click does.
- **Paint order.** Tiled windows form the base of the normal layer: they are painted above the `background` layer and beneath every other non-tiled window, whatever their position in `state.stack`. `stackingOrder(state)` is the logical stack; `paintOrder(state)` is the visual order of the active workspace, bottom to top, exactly as `derive` paints it.
- **Roles are semantic.** `dialog` anchors to its parent's center, `menu`/`popover`/`tooltip` anchor by side, and `notification` sits in a corner. `derive` decides the presentation, not the application. A window's `anchor` option passes every anchor setting through (`side`, `align`, `offset`, `inside`, `x`, `y`).
- **The log is replayable.** `wm.log` holds the commands applied since `wm.origin` (the initial state, or the last `load()`); undo and redo keep it in step, so `replay(wm.origin, wm.log)` always equals `wm.getState()`.
- **Gestures are one step.** Commands that carry the same `gesture` token in a row (the input adapter tags every `window/move` / `window/resize` of one floating drag) form one history entry and one log entry: runs of absolute setters collapse to their last command, so a drag undoes in one step and still replays exactly.
- **BSP is a stateful layout expressed functionally.** Its tree lives in workspace state and is kept in sync as windows are created, closed, floated, or moved.

Add your own commands with `update(state, command, { "my/command": handler })`, or pass `extensions` to `createWindowManager`.

## Drag and drop in layouts

Tiled windows own no geometry: their slots come from the workspace order (or the BSP tree) plus the layout interpreter. Dragging a tiled window therefore edits *logical structure*, never pixels, through one pure command:

```js
update(state, { type: "window/drop", id: "b", target: "a", zone: "left" });
// zone: "center" | "left" | "right" | "top" | "bottom"
// → events [{ type: "window/dropped", id, target, zone, op, workspace }], effects [render]
```

What a zone means depends on the layout, through a registry of **drop interpreters** (`DROPS`) parallel to `LAYOUTS`:

| Layout | center | edges |
| --- | --- | --- |
| columns, grid, tabs, monocle | swap | left = insert before, right = insert after; top/bottom swap |
| rows | swap | top = before, bottom = after; left/right swap |
| master-stack | swap | a lone master reads horizontally (mirrored for `side: "right"`); masters and the stack column read vertically |
| spiral | swap | window *i* reads horizontally when *i* is even, vertically when odd (the last one shares its predecessor's split) |
| bsp | swap leaves | remove the dragged leaf and split the target on that side (`left`/`right` horizontally, `top`/`bottom` vertically) |
| custom types | swap | reading order: left/top before, right/bottom after |

"Before/after" is position in `ws.windows`; every other window keeps its slot. Grids read along rows, so only left/right insert there. Override or extend the registry with `createWindowManager({ drops: { mine: orderDrops((spec, ids, target) => "y") } })`, or build a handler for the pure core with `createDropHandler({ ...DROPS, mine })`. An interpreter is `{ ops(spec, ids, target) → { zone: op }, apply?(spec, ids, drop) → { ids, layout? } }`.

Rejections: `unknown-window`, `unknown-zone`, `same-window`, `different-workspaces`, `not-tiled` (floating, maximized, minimized, non-window roles, or the `floating` layout), `blocked` (by a modal), `drag-disabled`, `not-draggable`, `zone-disabled` (the mode forbids that op), `too-small`.

**Settings** (`config.drag`, set with `config/set { drag: { … } }`, which merges):

- `tiled`: `"swap-or-insert"` (default), `"swap"`, `"insert"`, or `"off"`. A layout spec's own `drag` (`{ type: "master-stack", drag: "swap" }`) overrides it for that workspace.
- `edgeZone`: fraction of a window's width/height that counts as an edge (default `0.25`).
- `preview`: draw the ghost preview while dragging (default `true`).
- `toFloating`: `"modifier"` (default: drag with <kbd>Shift</kbd> held), `"threshold"` (drag outside the stage), or `"off"`: how a dragged tiled window detaches as floating, with `window/detach { id, x, y }`.
- `toTiled`: `"modifier"` (default), `"always"`, or `"off"`: when a dragged floating window may be dropped into the layout. The pure `window/drop` accepts a floating dragged window unless this is `"off"`; its `center` inserts it in the target's place.
- `crossWorkspace` (default `true`): dropping on any element marked `data-wm-workspace-target="<id>"` moves the window (and its children) there. `follow` (default `false`) switches to that workspace too (`window/move-to-workspace { follow: true }`).
- `tooSmall`: `"allow"` (default) or `"reject"`, which refuses a drop whose resulting slot would violate the dragged or target window's min/max constraints. The pure core has no pixels, so the command takes an optional `geometry: { [id]: { width, height } }` estimate; the input adapter measures its preview and sends it. Without geometry the setting is advisory.
- Per window: `draggable: false` (at create time, or `window/set-draggable`) pins a window: it cannot be dragged, nor swapped away (inserting beside it is fine). Pinned views render `data-wm-draggable="false"`.

**Pure helpers** (`src/interaction/drop.mjs`): `dropZoneAt(rect, point, edgeZone)` → a zone; `dropTargetAt(state, geometry, point, draggedId)` → `{ target, zone, op } | null` from measured rects (a floating window covering the point blocks the drop; hidden stack children never count; a zone the mode forbids falls back to the nearest permitted one); `previewDrop(state, drop)` → the next state, or `null` if rejected. It is only `update` on the immutable state.

**Keyboard equivalents:** `window/swap-next` / `window/swap-previous` (wrapping; BSP uses leaf order) and `window/move-before` / `window/move-after` (one slot, or relative to a `target`; in BSP they split the neighbour along its own split). The manager exposes `drop`, `swapNext`, `swapPrevious`, `moveBefore`, `moveAfter`, and `setDraggable`.

**In the browser**, `attachInput` makes a tiled window's move handle (its title bar) draggable once the pointer travels `threshold` px (default 5), so clicks stay clicks. While dragging, an overlay inside `root` covers every surface, which keeps iframes from swallowing the pointer. It also holds the preview: the hypothetical next state goes through the same `derive → compile` pipeline into a second renderer, drawn as ghost outlines of where every window would land, plus a highlight of the drop zone. CSS solves the hypothetical layout exactly as it will solve the real one (weights, gaps, `auto-fit` grids, BSP ratios), so the ghost cannot drift from the result, and measuring the ghost gives the slot sizes `tooSmall` needs. Constraints are left out of the ghost so it shows each window's *slot*; slots that would violate a window's constraints are outlined in red. Pointerup dispatches exactly one `window/drop`; Escape or `pointercancel` aborts. Pass `wm` (or `present: wm.present, simulate: wm.simulate, drops: wm.drops`) so the preview uses your custom layouts and drop interpreters, and `dragPreview(ctx)` to draw your own preview. Theme the ghost with `--wm-ghost-line`, `--wm-ghost-fill`, `--wm-zone-fill` and friends.

The adapter also handles:

- **Tiled ↔ floating.** With the modifier held (or, with `toFloating: "threshold"`, outside the stage) a tiled drag previews the window floating at the pointer and, on release, dispatches one `window/detach` (kept inside the stage when it fits). A floating window dragged over a tiled one with the modifier (or always, per `toTiled`) previews the slot it would take; release dispatches `window/drop` with the drag's `gesture` token, so the floating moves and the drop are one undo step. Pressing or releasing the modifier mid-drag updates the preview without moving the pointer. Pick the key with `modifier: "shift" | "alt" | "ctrl" | "meta"`.
- **Across workspaces.** Hovering a `data-wm-workspace-target` element (anywhere on the page) marks it `data-wm-drop-active`; releasing dispatches `window/move-to-workspace`. A floating window keeps its placement. The pointer may leave the stage before the drag threshold: the adapter listens on the document while a press is live.
- **Tabs.** Drag a compiled tab button (`data-wm-tab`) along its strip; an insertion line shows where it lands, and release dispatches `window/drop` with zone `left`/`right` (past the last tab means last).
- **Children.** Dialogs, sheets and popovers are anchored to their parent, so they travel with it through every kind of drop, a detach, or a workspace move (`window/move-to-workspace` moves descendants).
- **Pinned windows** (`draggable: false`) get `cursor: not-allowed` on their move handle, and a press on it marks the view `data-wm-drag-denied` for its duration; nothing moves, floating or tiled.
- **Touch.** Touch pointers start a drag with a still long press (`longPress`, default 400 ms); moving first hands the gesture back to the browser, and the context menu is suppressed during the press. `BASE_CSS` sets `touch-action: none` only on `[data-wm-handle]` (and `pan-x` on tab strips), so content inside windows keeps scrolling.
- **Accessibility.** `announce: true` adds a visually hidden `aria-live` region inside `root` that narrates drag start, the current target ("Release to move before Terminal."), the drop ("Editor moved before Terminal.") and cancellation; pass an element to use your own region, or a function to receive the messages. With `subscribe`, moves made by command (keyboard shortcuts, the API) are announced too. `keyboard: true` moves the focused window with <kbd>Alt</kbd>+<kbd>Shift</kbd>+arrows (`window/move-before` / `window/move-after`) and <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>PageUp</kbd>/<kbd>PageDown</kbd> (swap), or pass your own `{ combo: commandType }` map (`DEFAULT_MOVE_KEYS` is the default).

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

`compile(tree, presentationContext(state))` returns a render tree of `{ tag, key, attrs, style, children }`. Views are `container-type: size`, except on an axis sized by its content (`height: "content"`), where they fall back to `inline-size` (or no containment) so the content can size them. `toHTML()` serializes it for server rendering or snapshots. View elements are keyed `view:<id>`, so a layout change moves elements instead of recreating them. When a view appears more than once, the extra copies become non-primary projections.

## Browser adapters

- `createDomRenderer({ root, surfaceFor })` reconciles the keyed DOM, mounts and unmounts surfaces, measures realized geometry with `measure()`, and positions anchors with JS when CSS anchor positioning isn't supported (force it with `anchorFallback: true`; `reposition()` re-runs it). Reconciliation is top-down and moves views with `moveBefore()` where the browser has it, so an iframe, a playing animation or a focused input survives a layout change.
- `attachInput({ root, getState, dispatch })` turns pointer events into commands. The markup contract is: `data-wm-handle="move"` (moves a floating window; drags a tiled one to a new slot), `data-wm-handle="resize-se"` (any edge or corner), `data-wm-command="window/close"`, and tab buttons with `data-wm-tab`. Options: `subscribe`, `snap`, `threshold`, `present`, `simulate`, `dragPreview` (see *Drag and drop in layouts*).
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
