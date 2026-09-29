# Layouts and modifiers

[API reference](./README.md) › Layouts and modifiers

A workspace's `layout` is a **spec**: plain data such as `{ type: "master-stack", ratio: 0.6 }`, interpreted by `derive` through the `LAYOUTS` registry. Specs stay serializable. Stateful layouts (`bsp`, the docking `tree`) keep their tree inside the spec. Sources: `src/state/derive.mjs`, `src/layouts/index.mjs`, `src/layouts/bsp.mjs`, `src/layouts/tree.mjs`, `src/state/modifiers.mjs`.

## Contents

- [derive](#derivestate-options)
- [Layout specs (`LAYOUTS`)](#layout-specs-layouts)
- [Custom layouts](#custom-layouts)
- [Derived-layout functions](#derived-layout-functions)
- [BSP](#bsp)
- [Tree](#tree)
- [Split sizing](#split-sizing)
- [Layout modifiers](#layout-modifiers)

## `derive(state, options?)`

```js
derive(state, { layouts = {}, modifiers = {}, output } = {}) → overlay node
```

This is pure policy. It turns logical state into a layout-algebra tree for one output's active workspace (default `state.focusedOutput`).

1. If a visible window is `fullscreen`, the result is `overlay({}, view(thatId))` and nothing else.
2. The **tiled base**: the visible windows that are [`inTiledBase`](./queries.md#stacking-and-painting), in workspace order, are passed as `ids` to the workspace's layout interpreter, wrapped by its [modifiers](#layout-modifiers). The interpreter comes from `{ ...LAYOUTS, ...layouts }[spec.type]`, or it *is* the spec when the spec is a function.
3. Tiled windows with `minWidth`/`minHeight`/`maxWidth`/`maxHeight` or an exact numeric `aspectRatio` get wrapped in `size(...)` so CSS honours them. Ranges and increments are advisory for tiled windows.
4. `config.gap` wraps **every container** of the base in `gap({ all })`, and `config.inset` wraps the base in `inset({ all })`, unless a `smart-gaps`/`no-gaps` modifier suppresses them.
5. Every other visible window is presented by role (see [State › role presentation](./state.md#constants)) and layered in stacking order. Background-layer windows go **beneath** the base and everything else above it.

The result is `overlay({}, ...background, base, ...upper)`.

`options.layouts` and `options.modifiers` extend or override the registries for this call. **Throws `TypeError`** when no interpreter exists for the spec's type, or when an interpreter returns something that is not a node. The manager guards `layout/set` against unknown types so this does not happen on every render.

## Layout specs (`LAYOUTS`)

`LAYOUTS` is a frozen map of interpreters `(spec, ids, context) → tree`, where `context` is `{ state, workspace, focused }`. Every spec may also carry:

- `modifiers`: `[{ type, ...options }]`, see [Layout modifiers](#layout-modifiers).
- `drag`: one of `DRAG_MODES`, which overrides `config.drag.tiled` for this workspace (see [Drag and drop](./drops.md#drag-modes)).

| `type` | Spec options (defaults) | Produces | Resizable (`layout/resize-split`) |
| --- | --- | --- | --- |
| `master-stack` | `ratio` (0.5), `masterCount` (1), `side` (`"left"` \| `"right"`) | A row: the master(s) (in a column if more than one) weighted `ratio`, and the rest in a column weighted `1 - ratio`. With `ids.length <= masterCount`, a single view or a column. | yes, path `""` → `ratio` |
| `columns` | `sizes` (`{ "": weights }`), `align`, `distribute` | An equal-width row, or weighted by `sizes[""]` once it matches the count. | yes, path `""` → `sizes[""]` |
| `rows` | same as `columns` | An equal-height column. | yes, path `""` → `sizes[""]` |
| `monocle` | `active` | `stack({ active })`: one window at a time. The active one is `spec.active` if tiled here, else the focused window if tiled, else the first. | no |
| `tabs` | `active` | `stack({ active, chrome: "tabs" })`: monocle plus a tab strip. | no |
| `grid` | `columns` (a count → fixed grid, with optional `rows`); otherwise `min` (300), `max` (`"1fr"`), `repeat` (`"auto-fit"`) | A fixed-column grid, or a responsive `repeat(auto-fit, minmax(min, max))` grid. | no |
| `spiral` | `ratio` (0.5), `ratios` (per-depth overrides) | Dwindle: each window splits the remaining space, alternating row/column, with the first window weighted `ratios[depth] ?? ratio`. | yes, path = depth → `ratios[depth]` |
| `bsp` | `tree` (a BSP tree, seeded by `layout/set`) | The stored binary tree, reconciled with the windows present. | yes, path = `0`/`1` steps → node `ratio` |
| `tree` | `tree` (a docking tree, seeded by `layout/set`), `tabMode` (`"swap"` makes center drops swap instead of tab) | The stored n-ary row/column/tabs tree, reconciled. | yes, path = comma-joined indices → container `sizes` |
| `floating` | none | An empty base (`row({})`): every window floats. Nothing is in the tiled base. | no |

A layout's `ids` are always the droppable tiled windows present. A stored tree that mentions closed windows, or misses new ones, is reconciled on every derive, so a hand-edited tree cannot break rendering.

## Custom layouts

Add an interpreter under a new `type`. It receives the spec, the tiled ids and the context, and returns any layout-algebra node:

```js
import { row, column, size, view, derive, createWindowManager } from "@johnhenry/window-algebra";

const layouts = {
  coding: (spec, ids) =>
    ids.length === 0 ? row({}) : row({}, size({ weight: spec.weight ?? 3 }, view(ids[0])), column({}, ...ids.slice(1).map(view))),
};

derive(state, { layouts });                 // per call
const wm = createWindowManager({ layouts }); // or for a manager (also accepted by layout/set)
wm.setLayout({ type: "coding", weight: 2 });
```

A spec may also be a **function** used directly as the interpreter (`layout/set { layout: fn }`). That works, but a function spec is not serializable, so `wm.serialize()` loses it.

Custom types get the `default` drop interpreter (reading order) unless you register one. See [Drag and drop](./drops.md#custom-drop-interpreters). They are not resizable by `layout/resize-split`. To render splitters, put `resize: { path, weights }` on a row/column and persist the weights yourself with an extension command.

## Derived-layout functions

These are plain functions `(options, ids) → tree` that `LAYOUTS` calls. They are also exported so you can compose them in your own interpreters. `ids` entries may be id strings or ready-made nodes.

| Export | Signature and behaviour |
| --- | --- |
| `masterStack(options, ids)` | `{ ratio = 0.5, masterCount = 1, side = "left" }`. Weights are rounded to 3 decimals, and the row carries `resize: { path: "", weights }` in visual order. |
| `columns(spec, ids)` / `rows(spec, ids)` | Row/column. `spec.sizes[""]` weights apply only when its length matches. The container gets `resize` when there are two or more children. `align`/`distribute` are forwarded. |
| `monocle({ active }, ids)` | `stack({ active: active ?? ids[0] })`. |
| `tabs({ active }, ids)` | `stack({ active, chrome: "tabs" })`. |
| `autoGrid({ min = 300, max = "1fr", repeat = "auto-fit" }, ids)` | Responsive grid. |
| `fixedGrid({ columns = 2, rows }, ids)` | Fixed tracks. |
| `spiral({ ratio = 0.5, ratios }, ids)` | Dwindle. Each split carries `resize: { path: String(depth), weights }`. |
| `floating({ x = 0, y = 0, width, height }, child)` | Sugar: `place({ x, y }, size({ width, height }, child))`. |
| `centered({ width, height }, child)` | Sugar: `place({ x: "center", y: "center" }, size(...))`. |
| `dock({ side = "left", extent = 240 }, child, rest)` | Sugar: `child` docked at one side with a fixed `extent`, and `rest` filling the remainder. |
| `hybrid(tiled, floatingNodes = [])` | Sugar: `overlay({}, tiled, ...floatingNodes)`. |

## BSP

Binary space partitioning: a stateful layout expressed functionally. The tree is plain data in `spec.tree`:

```js
{ type: "leaf", id }
{ type: "split", direction: "horizontal" | "vertical", ratio, first, second }
// "horizontal" = side by side (a row), "vertical" = stacked (a column)
```

| Export | Description |
| --- | --- |
| `bspLeaf(id)`, `bspSplit(direction, ratio, first, second)` | Node constructors. |
| `bspIds(tree)` | Leaf ids in order (`[]` for `null`). |
| `bspInsert(tree, { id, target?, direction?, ratio = 0.5 })` | Splits leaf `target` (default: the last leaf) with `id` in the second position. The direction alternates with depth (dwindle) unless given. Returns `bspLeaf(id)` for an empty tree, and the tree unchanged if `id` is already present. |
| `bspPlace(tree, { id, target, side?, ratio = 0.5 })` | Inserts `id` beside `target` on a side (`left`/`right` → horizontal, `top`/`bottom` → vertical, with `id` on that side). Without `side` this is `bspInsert`. The tree is unchanged if `target` is missing or `id` is present. |
| `bspRemove(tree, id)` | Removes a leaf; its sibling takes the parent's place. |
| `bspSwap(tree, a, b)` | Exchanges two leaves. |
| `bspReconcile(tree, ids)` | Drops leaves not in `ids` and appends missing ids. |
| `bspSetRatio(tree, id, ratio)` | Sets the ratio (clamped to [0.05, 0.95]) of the split **directly containing** leaf `id`. |
| `bspRotate(tree, id)` | Toggles the direction of the split directly containing `id`. |
| `bspParentDirection(tree, id)` | The direction of that split, or `null`. |
| `bspNodeAt(tree, path)` | The split reached by `"0"`/`"1"` steps (`""` = root), or `null` when the path hits a leaf or runs off the tree. |
| `bspSetRatioAt(tree, path, ratio)` | Sets the ratio (clamped) of the split at `path`. |
| `bspToLayout(tree, path = "")` | Interprets the tree as rows/columns with weights, each split carrying `resize: { path, weights }`. `null` → `row({})`. |
| `bspFrom(ids, options?)` | Builds a tree by inserting ids in order. |

Commands that keep the stored BSP tree in sync: `window/create`, `window/close`, `window/set-mode`, `window/detach`, `window/move-to-workspace`, `window/to-scratchpad`, `scratchpad/toggle`, `window/swap`, `window/drop`, `layout/set-ratio`, `layout/rotate-split`, `layout/resize-split`.

## Tree

The docking tree is the n-ary counterpart to BSP, in the style of i3, Dockview and GoldenLayout. `spec.tree` is:

```js
"editor"                                                    // a leaf: a window id
{ type: "row" | "column" | "tabs", children: [...], sizes? } // a container
```

`children` mixes leaves and containers freely. `sizes` (rows and columns only) holds positive weights parallel to `children`. Missing or invalid sizes mean equal weights. A `tabs` container shows the child containing the focused window, else the first.

| Export | Description |
| --- | --- |
| `treeIds(node)` | Leaf ids in order. |
| `treeParentType(node, id)` | `"row"`/`"column"`/`"tabs"` of the container directly holding leaf `id`, or `null` (root or absent). |
| `treeRemove(node, id)` | Removes a leaf and collapses as it goes: an emptied container disappears, and a one-child container is replaced by its child. Surviving `sizes` are kept. |
| `treeSwap(node, a, b)` | Exchanges two leaves. |
| `treeSplit(tree, { id, target, side, ratio = 0.5 })` | Replaces leaf `target` with a new `row` (`left`/`right`) or `column` (`top`/`bottom`) holding `id` on that side. `id` must already be absent. |
| `treeAddTab(tree, { id, target })` | Adds `id` as a tab right after `target`: it joins `target`'s `tabs` parent, or wraps `target` in a new `tabs`. |
| `treeInsertTab(tree, { id, target, position })` | Inserts `id` before or after `target` inside its `tabs` parent. It falls back to `treeAddTab` if `target` is not in a `tabs` container. |
| `treeReconcile(tree, ids)` | Drops leaves not in `ids`. Missing ids are appended to the root container's children, or wrapped with a lone-leaf root in a new `tabs`, or become a `tabs` container when the tree is empty. |
| `treeNodeAt(tree, path)` | The container at comma-joined child indices (`""` = root), or `null`. |
| `treeSetSizesAt(tree, path, weights)` | Sets the `sizes` of the container at `path`, only when `weights.length` matches its child count. |
| `treeToLayout(tree, { focused }?)` | Interprets the tree: rows/columns with weights (and `resize: { path, weights }` when they have two or more children), and `tabs` as `stack({ active, chrome: "tabs" })`. |
| `treeFrom(ids, { type = "tabs" }?)` | A flat container of `type`, a bare leaf for one id, or `null` for none. |
| `treeFromBsp(bspTree)` | The equivalent docking tree, preserving every ratio as `sizes`. |
| `isTreeContainer(node)` | A row/column/tabs object with a `children` array. |

`layout/to-tree` converts any layout into a tree. See [Commands](./commands.md#layoutto-tree).

## Split sizing

Resizable splits persist in the layout spec, each layout keeping its sizes wherever is most natural for it. One command covers every case: [`layout/resize-split { workspace?, path, index?, delta | weights }`](./commands.md#layoutresize-split). The resizable interpreters put `resize: { path, weights }` on each resizable row or column. `compile` turns that into `[data-wm-splitter]` handles carrying `data-wm-path`, `data-wm-index` and `data-wm-count`, and `attachInput` turns a handle drag or an arrow key into `layout/resize-split`. Grid tracks, tabs and monocle are not resizable. The full scheme is in [`docs/PRD.md`, "Split sizing"](../PRD.md#split-sizing).

## Layout modifiers

These are xmonad-style decorators over a layout interpreter, kept serializable. A spec carries them as `modifiers: [{ type, ...options }]`. `derive` applies them **in list order** around the base interpreter.

```js
{ type: "columns", modifiers: [{ type: "smart-gaps" }, { type: "max-windows", n: 3 }, { type: "mirror" }] }
```

| Modifier | Effect | Changes drop zones? |
| --- | --- | --- |
| `smart-gaps` | No configured gap or inset when the tiled base holds at most one window. | no |
| `no-gaps` | Never apply the configured gap or inset to the tiled base. | no |
| `mirror` | xmonad `Mirror`: transposes the layout (every row becomes a column and vice versa; `rotate`). | yes: `top`↔`left`, `right`↔`bottom` |
| `reflect-x` | Reverses the children of every row (`mirror` transform). | yes: `left`↔`right` |
| `reflect-y` | Reverses the children of every column (`flip` transform). | yes: `top`↔`bottom` |
| `max-windows` `{ n }` | Only the first `n` (≥ 1, default 1) tiled windows get their own slot. The rest share the last slot as a hidden stack, which shows the focused window when focus is on one of the hidden ones and the slot's own window otherwise. Every window stays in the tree. | no |

An unknown modifier type is **ignored** by `derive` (the registry has no entry), but `layout/set` still requires every entry to be an object with a string `type`.

| Export | Description |
| --- | --- |
| `MODIFIERS` | The frozen registry: `{ [type]: (modifierSpec) => (interpreter) => (spec, ids, context) => tree }`. `smart-gaps`/`no-gaps` are identity decorators here; their effect lives in `suppressesGaps`. |
| `MODIFIER_TYPES` | `["smart-gaps", "no-gaps", "mirror", "reflect-x", "reflect-y", "max-windows"]`. |
| `withModifiers(interpreter, mods = [], registry = MODIFIERS)` | Composes `mods` over `interpreter`, in order. |
| `suppressesGaps(mods, { tiledIds })` | Whether the list suppresses the gap and inset wrap for this context. |
| `applyModifiersToOps(ops, mods)` | Remaps a drop interpreter's zone→op map to match the axes `mirror`/`reflect-*` painted. `dropInterpreterFor` uses it. |
| `validModifiers(mods)` | The shape check used by `layout/set` and `layout/toggle`: an array of objects with string `type`. |

Write your own the same way, and pass it as `modifiers` to `derive` or `createWindowManager`:

```js
const modifiers = {
  center: () => (interpreter) => (spec, ids, context) => centered({}, interpreter(spec, ids, context)),
};
createWindowManager({ modifiers });
wm.setLayout({ type: "columns", modifiers: [{ type: "center" }] });
```

A custom modifier that changes screen axes does not remap drop zones automatically. `applyModifiersToOps` only knows the built-ins. To toggle between two whole layouts rather than decorate one, use [`layout/toggle`](./commands.md#layouttoggle).
