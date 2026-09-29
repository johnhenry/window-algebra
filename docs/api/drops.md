# Drag and drop

[API reference](./README.md) › Drag and drop

Tiled windows own no geometry: their slots come from the workspace order (or the stored tree) plus the layout interpreter. Dragging a tiled window therefore edits **logical structure**, never pixels, through one pure command, [`window/drop`](./commands.md#windowdrop). What a drop zone means depends on the layout, through a registry of **drop interpreters** (`DROPS`) parallel to `LAYOUTS`. Sources: `src/state/drops.mjs`, `src/interaction/drop.mjs`.

## Contents

- [Zones and ops](#zones-and-ops)
- [Semantics per layout](#semantics-per-layout)
- [Drag modes](#drag-modes)
- [Custom drop interpreters](#custom-drop-interpreters)
- [Registry helpers](#registry-helpers)
- [Pure pointer helpers](#pure-pointer-helpers)
- [Keyboard equivalents](#keyboard-equivalents)

## Zones and ops

`DROP_ZONES` is `["center", "left", "right", "top", "bottom"]`. An interpreter maps each zone to an **op**:

| Op | Meaning |
| --- | --- |
| `swap` | Exchange slots with the target. A floating window that is dropped in has no slot, so it takes the target's place (inserted before it) instead. |
| `before` / `after` | Move to just before or after the target in the workspace order (or the tab strip, for `tree`). |
| `split` | `bsp`/`tree`: split the target's leaf, with the dragged window on the zone's side. |
| `tab` | `tree`: add as a tab alongside the target. |
| `null` | The zone means nothing for this target (the drop is rejected as `unknown-zone`). |

"Before/after" is position in `workspace.windows`. Only the droppable (tiled) windows are reordered; every other window keeps its slot in the list.

## Semantics per layout

| Layout | center | edges |
| --- | --- | --- |
| `columns`, `grid`, `tabs`, `monocle` | swap | `left` = before, `right` = after; `top`/`bottom` swap (grids read along rows) |
| `rows` | swap | `top` = before, `bottom` = after; `left`/`right` swap |
| `master-stack` | swap | A lone master (single `masterCount`, more windows than masters) reads horizontally: `left` = before, `right` = after, mirrored for `side: "right"`. Every other target (masters when `masterCount > 1`, the stack column) reads vertically. |
| `spiral` | swap | Window *i* reads horizontally when *i* is even and vertically when odd; the last window shares its predecessor's split. |
| `bsp` | swap leaves | Remove the dragged leaf and split the target on that side (`left`/`right` horizontally, `top`/`bottom` vertically). |
| `tree` | add as a tab (`tab`), or `swap` with `spec.tabMode: "swap"` (degrading to `tab` for a window with no slot) | Split the target's leaf on that side. **If the target's direct parent is already a `tabs` container**, `left`/`right` instead reorder within the strip (`before`/`after`), which is also what dragging a tab resolves to; `top`/`bottom` still split it out. |
| custom types (`default`) | swap | Reading order: `left`/`top` before, `right`/`bottom` after. |

`mirror`, `reflect-x` and `reflect-y` modifiers remap the zones to match what they painted (for example a reflected `columns` layout's `left` means `after`). See [Layouts › modifiers](./layouts.md#layout-modifiers).

## Drag modes

`DRAG_MODES` is `["swap-or-insert", "swap", "insert", "off"]`. The effective mode for a workspace is its layout spec's own `drag` when that is valid, else `config.drag.tiled`.

| Mode | Allowed ops |
| --- | --- |
| `swap-or-insert` (default) | all |
| `swap` | `swap` only (inserts, splits and tabs are `zone-disabled`) |
| `insert` | everything but `swap` |
| `off` | none (`drag-disabled`) |

Other settings that shape drops, all in [`config.drag`](./state.md#configuration-config): `edgeZone`, `tooSmall`, `toTiled`, and per-window `draggable: false` (a pinned window can't be dragged, and can't be swapped away, though inserting beside it is fine).

## Custom drop interpreters

An interpreter is:

```js
{
  ops(spec, ids, target) → { center, left, right, top, bottom },   // zone → op (or null)
  apply?(spec, ids, { id, target, zone, op }) → { ids, layout? },   // optional
}
```

`ids` is the workspace's tiled order ([`tiledOrder`](#registry-helpers)). Without `apply`, the generic order edit ([`reorder`](#registry-helpers)) runs. With it, return the new tiled order and, for a stateful layout, the new spec.

```js
import { createWindowManager, orderDrops, createDropHandler, DROPS, update } from "@johnhenry/window-algebra";

const drops = { stacked: orderDrops(() => "y") };   // "stacked" layout reads top to bottom
createWindowManager({ drops, layouts: { stacked: myStackedInterpreter } });

// Or against the pure core:
update(state, cmd, { "window/drop": createDropHandler({ ...DROPS, ...drops }) });
```

Passing `drops` to the manager also rebuilds `window/swap-next`, `swap-previous`, `move-before`, `move-after` and `set-draggable` over the merged registry. Pass the manager (or `drops: wm.drops`) to `attachInput` so the pointer adapter finds targets with the same rules.

## Registry helpers

| Export | Description |
| --- | --- |
| `DROPS` | The frozen built-in registry: `master-stack`, `columns`, `rows`, `grid`, `spiral`, `monocle`, `tabs`, `bsp`, `tree`, `default`. |
| `orderDrops(axis)` | Builds an order-based interpreter. `axis(spec, ids, target)` returns `"x"` (previous on the left, next on the right), `"y"` (above/below), `"-x"`/`"-y"` (mirrored) or `"both"` (reading order). With a single axis, the two cross-axis edges swap like the center. |
| `createDropHandler(drops = DROPS)` | Returns a `window/drop` command handler over a registry, for use as an `update` extension. |
| `dropInterpreterFor(drops, spec)` | The interpreter for a spec (`drops[spec.type]`, else `drops.default`, else `DROPS.default`), with its `ops` remapped for the spec's modifiers. |
| `dragMode(state, workspaceId = state.activeWorkspace)` | The effective drag mode. |
| `opAllowed(mode, op)` | Whether a mode permits an op. |
| `tiledOrder(state, workspaceId)` | The workspace's droppable windows, in order: what an interpreter receives. |
| `isDroppable(state, win)` | `inTiledBase(state, win) && win.status === "normal"`. |
| `reorder(ids, id, target, op)` | The generic order edit. A missing `id` (a floating window) is inserted, and its `swap` becomes `before`. |

## Pure pointer helpers

These never listen for events. An adapter feeds them measured rects and pointer positions and turns the answer into one `window/drop`.

### `dropZoneAt(rect, point, edgeZone = 0.25)`

Returns the zone of `rect` that a point is in: the nearest edge when within `edgeZone` (a fraction, clamped to [0, 0.5]) of it, `"center"` otherwise, and `null` outside the rect.

### `zoneRect(rect, zone)`

The part of a target a zone refers to, for highlighting: the edge half for `left`/`right`/`top`/`bottom`, and the whole rect otherwise.

### `dropTargetAt(state, geometry, point, draggedId, { drops = DROPS, allowFloating = false }?)`

Finds the drop under a pointer on the **active workspace**. `geometry` is `{ [id]: rect }` in the same coordinate space as `point` (for example `renderer.measure()`). Returns `{ target, zone, op }` or `null`.

- It walks `paintOrder` top-down and skips the dragged window and its descendants. Hidden children of a `monocle`/`tabs` stack don't count. A floating window covering the point blocks the drop (returns `null`).
- It respects `config.drag.edgeZone` and the drag mode: a zone whose op the mode forbids falls back to the nearest permitted zone (the center in `swap` mode, the nearest insert edge in `insert` mode). It returns `null` if none is permitted.
- It returns `null` when the drag mode is `off`, the dragged window is pinned, or it is not on the active workspace.
- The final answer is checked with the same rules as `window/drop`.

### `previewDrop(state, drop, { extensions }?)`

The state a drop would produce (`update` on the immutable state) or `null` if it would be rejected. `drop` is `{ id, target, zone, geometry? }`. Pass `extensions` (for example `{ "window/drop": createDropHandler(myDrops) }`) for custom interpreters.

## Keyboard equivalents

[`window/swap-next`](./commands.md#windowswap-next), [`window/swap-previous`](./commands.md#windowswap-previous), [`window/move-before`](./commands.md#windowmove-before) and [`window/move-after`](./commands.md#windowmove-after) move a window through the same machinery, following on-screen (leaf) order for `bsp` and `tree`. `attachInput({ keyboard: true })` binds them to <kbd>Alt</kbd>+<kbd>Shift</kbd>+arrows and <kbd>PageUp</kbd>/<kbd>PageDown</kbd>. See [Browser › keyboard](./browser.md#keyboard).
