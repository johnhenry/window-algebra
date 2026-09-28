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
| `console.html` | Compose any command, a gallery of every rejection, events and effects per dispatch, undo/redo, replay scrubber, serialize/restore, versioning and migration. |
| `surfaces.html` | html, lazy, iframe (`srcdoc`) and canvas surfaces keeping their state while windows move through layouts. |
| `geometry.html` | Requested vs measured geometry, constraints on tiled windows, size hints (aspect ratio, width/height increments) with a live "80×24" cell readout, container queries, CSS anchors vs the forced JS fallback, positioner rules (`gravity`/`flip`/`slide`/`resize`) with a "pin near a corner" overflow trigger, geometry helpers. |
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
| Modifier  | `anchor(options, child)`          | position relative to another view, with `xdg_positioner`-style constraint adjustment (`flip`/`slide`/`resize`/`gravity`) | CSS anchor positioning, with a JS fallback |

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

- **Windows:** `window/create`, `window/close` (cascades to child windows), `window/focus`, `window/blur`, `focus/next`, `focus/previous`, `window/raise`, `window/lower`, `window/set-layer`, `window/move`, `window/resize`, `window/set-mode`, `window/toggle-floating`, `window/minimize`, `window/maximize`, `window/fullscreen`, `window/restore`, `window/set-title`, `window/set-constraints`, `window/swap`, `window/promote`, `window/move-to-workspace`, `window/set-urgent`, `focus/urgent`
- **Drag and drop:** `window/drop`, `window/detach`, `window/swap-next`, `window/swap-previous`, `window/move-before`, `window/move-after`, `window/set-draggable` (and `window/move-to-workspace` takes `follow: true`)
- **Scratchpad and sticky:** `window/to-scratchpad`, `scratchpad/toggle`, `window/set-sticky`
- **Workspaces:** `workspace/create`, `workspace/activate`, `workspace/remove`
- **Layout:** `layout/set`, `layout/set-ratio`, `layout/rotate-split`, `layout/resize-split`, `layout/toggle`
- **Config:** `config/set`
- **Rules:** `rules/set`

The policy decisions baked into these commands:

- **Commands versus events.** The manager can say no. A duplicate id, an unknown parent, or a malformed command produces a `command/rejected` event. It never throws. `createWindowManager` also rejects a `layout/set` or `workspace/create` whose layout type no interpreter knows (`unknown-layout`), since `update` cannot see the interpreter registry.
- **Requested versus actual geometry.** `window/move` and `window/resize` store the requested placement. `derive` uses it only when a window is floating. Size constraints (`minWidth`, `maxHeight`, …) apply to tiled windows too, as CSS min/max sizes.
- **Size hints beyond min/max (ICCCM `WM_NORMAL_HINTS`-style).** `constraints.aspectRatio` (a number, or `{ min, max }`, as `width / height`) and `constraints.widthIncrement`/`heightIncrement` with `constraints.baseWidth`/`baseHeight` (terminal-style character cells: only sizes `base + n × increment` are allowed) are honoured by the pure `constrainSize(size, constraints, { preserve })` for floating move/resize (including the resize gesture, which picks `preserve` from the dragged edge so the aspect ratio adjusts the *other* axis) and `window/resize`/`window/set-constraints`. Tiled windows get CSS `aspect-ratio` when `aspectRatio` is an exact number (a range has no single CSS value); increments are advisory for tiled windows since CSS decides their size. `geometry.sizeToCells(size, constraints)` reports `{ cols, rows }` (or `null` without increments) for a live "80×24" readout.
- **Focus is not stacking.** Raising on focus is a policy (`config.focusRaises`). Stacking uses per-layer order: `background`, `normal`, `top`, `modal`, `popover`, `notification`, `system`. Raising a window raises its descendants above it, so a child is never painted beneath its parent (and an anchored child always follows its anchor, which CSS anchor positioning requires).
- **The modal graph.** Focusing a window that has an open modal descendant sends focus to the deepest modal. A blocked window renders with `data-wm-blocked`: its contents are `inert` (no focus, no input, hidden from assistive tech), but the window itself stays hit-testable, so clicking it redirects focus to the modal instead of falling through to the window underneath. It cannot be dragged or resized.
- **Keyboard focus follows WM focus, and vice versa.** Pass the manager's `subscribe` to `attachInput({ root, getState, dispatch, subscribe })`. When a window is focused by a command (a shortcut, a taskbar, the API), DOM focus moves into it: back to the element last focused there, otherwise the view itself (`tabindex="-1"`). Focus is never taken from a text field outside `root`. In the other direction, keyboard focus entering a window (Tab, `.focus()`) focuses and raises it, just as a click does.
- **Paint order.** Tiled windows form the base of the normal layer: they are painted above the `background` layer and beneath every other non-tiled window, whatever their position in `state.stack`. `stackingOrder(state)` is the logical stack; `paintOrder(state)` is the visual order of the active workspace, bottom to top, exactly as `derive` paints it.
- **Scratchpad (i3-style).** `window/to-scratchpad { id }` hides a window off every workspace: it is stored with `workspace: null`, dropped from any BSP tree, forced to floating mode, and marked `scratchpad: true` for as long as it remains one. `scratchpad/toggle { id? }` shows the given (or, with no `id`, the most recently touched) scratchpad window floating and centered (`placement: { x: "center", y: "center" }`, resolved purely in CSS) on the active workspace, focusing it; toggling the same window again hides it. Hiding the focused window refocuses from history, same as `window/close`. Moving a scratchpad window to a workspace directly (`window/move-to-workspace`) pulls it out of the scratchpad for good. `scratchpadWindows(state)` lists every scratchpad window (shown or hidden); `isScratchpadHidden(state, id)` tells which.
- **Sticky (EWMH-style).** `window/set-sticky { id, sticky }` makes a window visible on every workspace: `isVisible`, `visibleWindows`, `focusable`, `derive` and `paintOrder` all agree, without needing the window to be duplicated into every workspace's own window list. A sticky window keeps its place in `state.stack` (its stacking is untouched by which workspace is active), is never counted into a layout's tiled base (it is always presented as a floating overlay, even if its `mode` is `"tiled"`), and focusing it never switches the active workspace. `window/move-to-workspace` still moves its "home" workspace (relevant if it is ever unstuck); it stays visible everywhere regardless. `stickyWindows(state)` lists every sticky window.
- **Roles are semantic.** `dialog` anchors to its parent's center, `menu`/`popover`/`tooltip` anchor by side, and `notification` sits in a corner. `derive` decides the presentation, not the application. A window's `anchor` option passes every anchor setting through (`side`, `align`, `offset`, `inside`, `x`, `y`, `gravity`, `flip`, `slide`, `resize`; see "Positioner rules for anchored popups" below).
- **The log is replayable.** `wm.log` holds the commands applied since `wm.origin` (the initial state, or the last `load()`); undo and redo keep it in step, so `replay(wm.origin, wm.log)` always equals `wm.getState()`.
- **Gestures are one step.** Commands that carry the same `gesture` token in a row (the input adapter tags every `window/move` / `window/resize` of one floating drag) form one history entry and one log entry: runs of absolute setters collapse to their last command, so a drag undoes in one step and still replays exactly.
- **BSP is a stateful layout expressed functionally.** Its tree lives in workspace state and is kept in sync as windows are created, closed, floated, or moved.
- **Persistent, resizable splits.** `layout/resize-split { workspace?, path, index?, delta | weights }` resizes a split and stores it in the layout spec, wherever that layout keeps its sizes: `spec.sizes[""]` (an array of weights, one per child) for `columns`/`rows`; the existing `spec.ratio` for `master-stack`; the existing per-node `tree.ratio` for `bsp`, addressed by a `path` of `"0"`/`"1"` steps from the root (`bspNodeAt`/`bspSetRatioAt`); a new `spec.ratios` array indexed by split depth for `spiral`. `compile` renders a handle between every pair of children of a resizable row/column (`[data-wm-splitter]`, `role="separator"`, `aria-orientation`, `aria-valuenow`, `data-wm-path`/`data-wm-index`/`data-wm-count`); `attachInput` drags one (pointer capture, min/max constraints respected where a side is a single window, one undo step) and answers the arrow key along its axis when it has focus (`splitterStep`, a fraction of the pair's total, default `0.05`). See `docs/PRD.md`, "Split sizing", for the full scheme; grid tracks aren't resizable yet.
- **Urgency hints (EWMH/X11-style).** `window/set-urgent { id, urgent }` marks or clears a window's urgency (`urgent` defaults to `true`); `presentationContext(state).urgent` lists the ids in the order they became urgent, and `compile` marks their views `data-wm-urgent` and their tab-strip buttons the same way. Urgency clears automatically when the window is focused (`config.urgency.clearOnFocus`, default `true`) and emits `window/urgent-changed`. `focus/urgent` focuses the oldest urgent window, switching workspace if needed (`focus/redirected` / `workspace/activated` apply as usual); it is rejected (`no-urgent-window`) when nothing is urgent.

Add your own commands with `update(state, command, { "my/command": handler })`, or pass `extensions` to `createWindowManager`.

- **`layout/toggle { a, b, workspace? }`** — xmonad's `ToggleLayouts`: flips a workspace between two layout specs. The current layout is compared to `a` by `type` alone (a BSP tree, a ratio, or `modifiers` may have drifted since); whatever isn't `a` becomes `a`. `a`/`b` are optional after the first call — the pair is stored on the workspace (`toggleLayouts`), so `dispatch({ type: "layout/toggle" })` with no arguments keeps flipping the same two. Toggling into `bsp` seeds its tree the same way `layout/set` does. Rejected as `invalid-layout` when neither a stored pair nor valid `a`/`b` are available, `unknown-workspace` otherwise. The manager exposes `wm.toggleLayout(a, b, workspace?)`.

## Window rules

Declarative window placement, in the spirit of xmonad's `ManageHooks`, i3's `for_window`, or EWMH window types: `config.rules` is an ordered array of `{ match, set }` rules, matched against every window at `window/create`.

```js
update(state, {
  type: "rules/set",
  rules: [
    { match: { role: "dialog" }, set: { layer: "modal" } },
    { match: { idPrefix: "term-" }, set: { layer: "top", mode: "floating" } },
    { match: { titleRegex: "^Log " }, set: { status: "minimized" } },
  ],
});
```

- `match` (all present fields must agree; an absent or empty `match` matches every window): `role`, `id`, `idPrefix`, `title`, `titleRegex` (a regex *source* string, compiled fresh each check — rules stay JSON-serializable), `app` (an optional identifier a create command may set, like a WM_CLASS), `parent`.
- `set`: `mode`, `layer`, `workspace`, `placement`, `status`, `draggable`, `constraints`, `anchor` — the same fields a create command can set. `placement` and `constraints` merge one level deep.
- Rules apply in array order; a later rule overrides an earlier one on the same field. Whatever fields the `window/create` command sets explicitly always win over every rule (a rule only fills in what the caller left unspecified).
- `matchRules(state, window)` is the pure query behind it: the indices of `config.rules` a window (or a window-shaped object) matches, in order, without applying anything.
- The `window/created` event lists which rules applied: `{ type: "window/created", id, rules: [0, 2] }` (omitted when none matched).
- Set the whole list with `rules/set { rules }` or `config/set { rules }`; both validate the same way and reject malformed rules as `invalid-rules` / `invalid-config` without throwing. A rule that sends a window to an unknown workspace still rejects the `window/create` itself with `unknown-workspace`.
- `MATCH_FIELDS` / `SET_FIELDS` list the recognised keys; `validRules(rules)` checks a rule list is well-formed. The manager exposes `wm.setRules(rules)`.

### Versioned state and migrations

Every state carries a `version` (the constant `STATE_VERSION`), and `wm.serialize()` includes it, so a state saved by one build can be told apart from one saved by another.

```js
import { createState, migrate, STATE_VERSION } from "@johnhenry/window-algebra";

createState().version; // === STATE_VERSION

const result = migrate(savedState);
// result.ok === true  → result.state is at STATE_VERSION (unchanged if it already was)
// result.ok === false → result.reason is "invalid-state" | "future-version" | "no-migration-path"
```

- **Unversioned states are version 0.** A state with no `version` field predates this feature — the shape `createState()` produced before `STATE_VERSION` existed — and is treated as version 0.
- **`migrate(state)` never throws.** It walks `MIGRATIONS`, a registry of step functions keyed by the version they upgrade *from*, chaining as many steps as it takes to reach `STATE_VERSION`. On success it returns `{ ok: true, state, version }`; a state already at `STATE_VERSION` passes through unchanged (same reference). On failure it returns `{ ok: false, state: null, reason, version? }`.
- **A newer version is refused, not guessed at.** A state whose `version` is greater than `STATE_VERSION` — saved by a newer build than the one running — fails with `reason: "future-version"` rather than being loaded partially or incorrectly.
- **`wm.load()` and `replay()` both migrate.** `wm.load(state)` runs `migrate` before installing the state; a rejection (a future version, invalid JSON, or a gap in the migration chain) fires a `state/load-rejected` event with a `reason` and leaves the manager's current state untouched, instead of throwing. `replay(state, commands)` migrates its starting state the same way, so `replay(wm.origin, wm.log)` still equals `wm.getState()` even when `wm.origin` predates versioning.

**Adding a migration**, when a future change to the state shape needs one:

1. Bump `STATE_VERSION` (in `src/state/create.mjs`) by one.
2. Add a step to `MIGRATIONS` (in `src/state/migrate.mjs`), keyed by the version it upgrades *from*: `MIGRATIONS[oldVersion] = (state) => ({ ...state, version: oldVersion + 1, /* ...fixes */ })`. The step must set `version` to `oldVersion + 1` and return a complete, valid state.
3. `migrate` chains steps automatically — a state several versions behind runs through each step in turn.
4. Add a test: build a state at the old version (or omit `version` for 0) and assert `migrate` upgrades it to match what `createState()` produces at the new version for the same intent.

The one migration shipped so far, `0 → 1`, backfills `config.drag` (added after some sessions were already saved without it) and drops a redundant explicit `draggable: true` (only the `draggable: false` exception is ever stored).

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

`derive(state, { layouts, modifiers })` returns an `overlay` for the active workspace. The tiled base comes first, and floating windows, dialogs, popovers, and notifications are layered above it in stacking order. Layout specs are plain data (`{ type: "master-stack", ratio }`, `{ type: "bsp", tree }`, `{ type: "grid", min: 300 }`, …), optionally carrying `modifiers` (see *Layout modifiers*, below). You can add interpreters:

```js
derive(state, {
  layouts: {
    coding: (spec, ids) => row({}, size({ weight: 3 }, view(ids[0])), column({}, ...ids.slice(1).map(view))),
  },
});
```

## Layout modifiers

xmonad-style decorators over a layout interpreter, kept serializable: a layout spec may carry `modifiers: [{ type, ... }]`, interpreted by a `MODIFIERS` registry parallel to `LAYOUTS` and applied by `derive` around the base layout (`derive(state, { modifiers })` extends/overrides it, exactly like `{ layouts }`).

```js
derive(state, {
  // ws.layout: { type: "columns", modifiers: [{ type: "smart-gaps" }, { type: "mirror" }] }
});
```

Built-in modifiers:

- **`smart-gaps`** — no gap/inset around the tiled base when it holds a single window (there is nothing to separate it from).
- **`no-gaps`** — never gap/inset the tiled base, regardless of window count.
- **`mirror`** — xmonad's `Mirror`: transposes the layout (every row becomes a column and vice versa).
- **`reflect-x`** — flips left-right (reverses the children of every row).
- **`reflect-y`** — flips top-bottom (reverses the children of every column).
- **`max-windows { n }`** — only the first `n` tiled windows get their own slot from the wrapped layout; the rest share the last slot as a hidden stack (one painted at a time, the others mounted but inert — the same presentation `monocle`/`tabs` already use). The overflow stack shows the focused window when focus lands on one of the hidden ones, otherwise the slot's own window. Every tiled window stays in the tree (just nested), so the tiled set, `paintOrder`, and drops over the flat workspace order all still agree with what's on screen.

Modifiers apply in list order — `withModifiers(interpreter, mods, registry?)` is the underlying combinator, a plain functional decorator: `(spec, ids, context) → tree`, wrapped by each modifier in turn (registry defaults to `MODIFIERS`; use your own to add or override entries). Write your own the same way:

```js
const MODIFIERS = {
  center: () => (interpreter) => (spec, ids, context) => centered({}, interpreter(spec, ids, context)),
};
derive(state, { modifiers: MODIFIERS });
```

`mirror`/`reflect-x`/`reflect-y` also remap the affected layout's drop-zone semantics (`applyModifiersToOps`, used by `dropInterpreterFor`), so dragging still matches what got painted — a reflected `columns` layout's `left` zone means what its unreflected `right` zone would have. `smart-gaps`/`no-gaps`/`max-windows` don't change a layout's screen axes, so its drop interpreter is untouched. `suppressesGaps(mods, { tiledIds })` is the pure query `derive` uses to decide whether to skip the configured gap/inset wrap.

Toggle between two full layouts (rather than decorating one) with `layout/toggle` (see *Logical state and commands*) — xmonad's `ToggleLayouts`, distinct from a modifier.

## compile: from layout tree to CSS

`compile(tree, presentationContext(state))` returns a render tree of `{ tag, key, attrs, style, children }`. Views are `container-type: size`, except on an axis sized by its content (`height: "content"`), where they fall back to `inline-size` (or no containment) so the content can size them. `toHTML()` serializes it for server rendering or snapshots. View elements are keyed `view:<id>`, so a layout change moves elements instead of recreating them. When a view appears more than once, the extra copies become non-primary projections.

### Positioner rules for anchored popups

`anchor()`'s side-attached form (`{ to, side, align, offset }` — used by menus, popovers, tooltips and side-anchored dialogs) accepts Wayland `xdg_positioner`-style constraint adjustment for when the popup would overflow the stage:

- **`gravity`** (default: `side`) — which way the popup grows from its attach point on the anchor's `side` edge. A `gravity` opposite `side` (e.g. `side: "bottom", gravity: "top"`) grows the popup back over the space just past the anchor instead of away from it; any other value falls back to `side`.
- **`flip: ["x","y"]`** — axes allowed to flip to the opposite side (primary axis) or alignment (cross axis) instead of overflowing. Default: both axes.
- **`slide: ["x","y"]`** — axes allowed to translate, unresized, back into the stage. Default: neither.
- **`resize: ["x","y"]`** — axes allowed to shrink so the popup fits the stage, keeping the edge nearest its anchor point fixed. Default: neither.

Each axis tries flip, then slide, then resize, in that order, using only the adjustments it was opted into; an axis with none of the three left alone can overflow the stage. The placement math is `positionPopup(anchorRect, popupSize, stage, options)` in `src/geometry/positioner.mjs` — a pure function with no DOM dependency, safe to call from a demo, a test, or your own layout code.

`compile` maps as much of this to CSS anchor positioning as it can: `flip` becomes `position-try-fallbacks: flip-block, flip-inline` (whichever axes are included — `y` is the block axis for a `top`/`bottom` `side`, `x` for `left`/`right`), and a `gravity` opposite `side` picks a different `position-area`. `slide` and `resize` have no CSS anchor-positioning equivalent — `position-try-fallbacks` only swaps between discrete alternatives, it can't continuously clamp a position or shrink a box — so they only take effect under the JS anchor fallback (`anchorFallback: true`, or automatically wherever `CSS.supports("anchor-name: ...")` is false). A popup that needs `slide`/`resize` to look right everywhere should force the JS fallback rather than rely on native CSS anchor positioning.

## Browser adapters

- `createDomRenderer({ root, surfaceFor })` reconciles the keyed DOM, mounts and unmounts surfaces, measures realized geometry with `measure()`, and positions anchors with JS when CSS anchor positioning isn't supported (force it with `anchorFallback: true`; `reposition()` re-runs it). Reconciliation is top-down and moves views with `moveBefore()` where the browser has it, so an iframe, a playing animation or a focused input survives a layout change.
- `attachInput({ root, getState, dispatch })` turns pointer events into commands. The markup contract is: `data-wm-handle="move"` (moves a floating window; drags a tiled one to a new slot), `data-wm-handle="resize-se"` (any edge or corner), `data-wm-command="window/close"`, tab buttons with `data-wm-tab`, and `[data-wm-splitter]` (compiled in automatically between a resizable row/column's children — drag it, or focus it and press the arrow key along its axis). Options: `subscribe`, `snap`, `threshold`, `present`, `simulate`, `dragPreview`, `splitterStep` (see *Drag and drop in layouts*).
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
