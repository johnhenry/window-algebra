# State

[API reference](./README.md) › State

Logical (intent) state is one plain, JSON-serializable object. It describes what the user asked for: which windows exist, where they belong, what layout each workspace uses and who has focus. It holds no pixels for tiled windows and no DOM. `update` produces new states from old ones; `derive` turns a state into a presentation. Source: `src/state/create.mjs`.

## Contents

- [State shape](#state-shape)
- [Window record](#window-record)
- [Workspace record](#workspace-record)
- [Output record](#output-record)
- [Constants](#constants)
- [Configuration (`config`)](#configuration-config)
- [Constructors](#constructors)

## State shape

`createState()` returns (with `STATE_VERSION` 2):

```js
{
  version: 2,                       // STATE_VERSION; see versioning.md
  config: { ...DEFAULT_CONFIG },    // see "Configuration" below
  windows: { [id]: WindowRecord },
  workspaces: { [id]: WorkspaceRecord },
  workspaceOrder: ["main"],         // every workspace id, in creation order
  activeWorkspace: "main",          // mirrors outputs[focusedOutput].activeWorkspace
  outputs: { primary: OutputRecord },
  outputOrder: ["primary"],
  focusedOutput: "primary",         // the output with input focus
  focus: { window: null, history: [] }, // focused id (or null); history oldest → newest, no duplicates
  stack: { background: [], normal: [], top: [], modal: [], popover: [], notification: [], system: [] },
  lastScratchpad: null,             // default target of `scratchpad/toggle {}`
  urgent: [],                       // urgent window ids, oldest first
}
```

| Field | Meaning |
| --- | --- |
| `version` | The shape version. `migrate` upgrades older states. See [Versioning](./versioning.md). |
| `config` | Policy settings. See [Configuration](#configuration-config). |
| `windows` | Window records keyed by id. See [Window record](#window-record). |
| `workspaces` | Workspace records keyed by id. |
| `workspaceOrder` | All workspace ids across all outputs, in creation order. |
| `activeWorkspace` | The active workspace **of the focused output**. It always equals `outputs[focusedOutput].activeWorkspace`, and it is kept so that single-output code never has to think about outputs. |
| `outputs` | Output records keyed by id. Every workspace belongs to exactly one output, and every output has at least one workspace. |
| `outputOrder` | Output ids in order. `focus/next`/`focus/previous` walk outputs in this order. |
| `focusedOutput` | The output that has input focus. |
| `focus.window` | The focused window id, or `null`. |
| `focus.history` | Focus history, oldest first, each id at most once. Used to pick the next window when the focused one disappears (close, minimize, move away, scratchpad, pop-out, unstick). |
| `stack` | Stacking order **within each layer**, bottom to top. Every window appears in exactly one layer's list (its `layer`). A tiled window's position here does not affect painting (see `paintOrder` in [Queries](./queries.md)). |
| `lastScratchpad` | The most recently hidden or shown scratchpad window, used when `scratchpad/toggle` has no `id`. |
| `urgent` | Ids with an urgency hint, oldest first. |

## Window record

`window/create` normalizes its payload into this record (via `createWindowRecord`, below):

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | required | Non-empty and unique. |
| `title` | string | `""` | Used for `aria-label`, tab text, announcements. |
| `role` | one of `ROLES` | `"window"` | Semantic role. `derive` decides presentation from it. |
| `parent` | id \| `null` | `null` | Parent window. Children close, move and raise with their parent. |
| `modal` | boolean | `false` | An open (not minimized, not popped-out) modal child blocks its parent. |
| `mode` | `"tiled"` \| `"floating"` | `"tiled"` for role `window`, else `"floating"` | Only `role: "window"` can take part in a tiled layout. |
| `placement` | `{ x, y, width, height }` | `config.defaultPlacement` merged with the given placement | **Requested** geometry. `derive` honours it only for floating windows. `x`/`y` may be numbers (px) or CSS strings; `"center"` centres (used by the scratchpad). |
| `constraints` | object | `{}` | `minWidth`, `minHeight`, `maxWidth`, `maxHeight`, `aspectRatio` (number, or `{ min, max }`, as width / height), `widthIncrement`, `heightIncrement`, `baseWidth`, `baseHeight`. See `constrainSize` in [Geometry](./geometry.md). |
| `status` | one of `STATUSES` | `"normal"` | Set by the status commands. |
| `layer` | one of `LAYERS` | by role (see below) | Stacking layer. |
| `anchor` | object \| `null` | `null` | Anchor options for popover-like roles: `to` (defaults to the parent) plus `side`, `align`, `offset`, `inside`, `x`, `y`, `gravity`, `flip`, `slide`, `resize`. See [`anchor`](./algebra.md#anchoroptions-child). |
| `workspace` | id \| `null` | the parent's workspace, else the active workspace | `null` only while hidden in the scratchpad. |
| `data` | any | absent | Stored only when given. Application data, never read by the library. |
| `draggable` | `false` | absent | Only the `false` exception is stored. A pinned window cannot be dragged or swapped away. |
| `app` | string | absent | Stored only when given. An application or window-class id (like `WM_CLASS`), matched by rules. |
| `sticky` | `true` | absent | Set by `window/set-sticky`. The window is visible on every workspace of its output. |
| `scratchpad` | `true` | absent | Set by `window/to-scratchpad`. Cleared when the window is moved to a workspace directly. |

Default layer by role: `notification` → `"notification"`; `popover`, `menu`, `tooltip` → `"popover"`; any other role with `modal: true` → `"modal"`; `panel` → `"top"`; everything else → `"normal"`.

The initial `placement` is **not** clamped to the create command's own `constraints`. Rule-supplied `constraints` are clamped; see [`window/create`](./commands.md#windowcreate). `window/resize` and `window/set-constraints` clamp.

## Workspace record

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `windows` | id[] | The workspace order. Order-based layouts read the tiled subset of it. Drops and swaps rewrite it. |
| `layout` | layout spec | A plain object `{ type, ...options, modifiers? }` or a function `(spec, ids, context) → tree`. Defaults to `{ type: "master-stack", ratio: 0.5 }`. See [Layouts](./layouts.md). |
| `output` | id | The output this workspace belongs to. |
| `toggleLayouts` | `[a, b]` | Present after the first `layout/toggle`. |

## Output record

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | |
| `workspaces` | id[] | The workspaces on this output, in order. Never empty. |
| `activeWorkspace` | id | The workspace this output currently shows. |

A window is visible when its workspace is the active workspace **of its own output**, whichever output has focus. So every output's stage can be rendered at the same time with `derive(state, { output })`.

## Constants

| Export | Value |
| --- | --- |
| `LAYERS` | `["background", "normal", "top", "modal", "popover", "notification", "system"]`, bottom to top. Frozen. |
| `ROLES` | `["window", "dialog", "sheet", "popover", "menu", "tooltip", "panel", "notification"]`. Frozen. |
| `STATUSES` | `["normal", "minimized", "maximized", "fullscreen", "popped-out"]`. Frozen. |
| `STATE_VERSION` | `2` |
| `DEFAULT_OUTPUT` | `"primary"`, the id of the output every fresh state starts with. |
| `DEFAULT_CONFIG` | The frozen default configuration below. |

How each role is presented (by `derive`, for windows not in the tiled base):

| Role | Presentation |
| --- | --- |
| `window`, `panel` | Floating at `placement` (`floating({ x, y, width, height })`). A tiled `window` is laid out by the workspace layout instead. |
| `dialog` | Anchored to the centre of `anchor.to` or the visible parent; centred in the stage with no anchor. |
| `sheet` | Anchored inside the top of its parent, centred, with content height; centred in the stage with no anchor. |
| `popover`, `menu`, `tooltip` | Anchored by side (default `side: "bottom"`, `align: "start"`, `offset: 4`) to `anchor.to` or the visible parent. Every other anchor option passes through. With no anchor, floating at `placement`. |
| `notification` | Stacked in the bottom-right corner (`right: 16`, each successive one `height + 8` px higher). |

Any window with `status: "maximized"` fills the stage (`place({ top: 0, right: 0, bottom: 0, left: 0 })`). A `"fullscreen"` window is presented alone. `"minimized"` and `"popped-out"` windows are not presented.

## Configuration (`config`)

`createState({ config })` merges the given keys over `DEFAULT_CONFIG`; `drag`, `urgency` and `snap` merge one level deep. At runtime, change it with [`config/set`](./commands.md#configset), which also merges plain-object values one level deep and validates `drag`, `rules`, `urgency` and `snap`.

| Key | Default | Meaning | Validated by `config/set` |
| --- | --- | --- | --- |
| `focusRaises` | `true` | Focusing a window also raises it (and its descendants) within its layer. | no |
| `gap` | `0` | Gap in px between tiled siblings. It wraps every container in the tiled base, unless a `smart-gaps`/`no-gaps` modifier suppresses it. | no |
| `inset` | `0` | Padding in px around the tiled base, suppressed the same way. | no |
| `defaultPlacement` | `{ x: 40, y: 40, width: 480, height: 320 }` | Placement for new windows that give none. | no |
| `drag.tiled` | `"swap-or-insert"` | Which drops a tiled window may make: `"swap-or-insert"`, `"swap"`, `"insert"` or `"off"` (`DRAG_MODES`). A layout spec's own `drag` overrides it for that workspace. | must be in `DRAG_MODES` |
| `drag.edgeZone` | `0.25` | The fraction of a target's width/height that counts as an edge zone. | `0 ≤ n ≤ 0.5` |
| `drag.preview` | `true` | Draw the ghost preview while dragging. | no |
| `drag.tooSmall` | `"allow"` | `"reject"` refuses a drop whose resulting slot violates the dragged or target window's min/max constraints (needs the `geometry` estimate the input adapter sends). | `"allow"` \| `"reject"` |
| `drag.toFloating` | `"modifier"` | How a dragged tiled window detaches as floating: `"modifier"` (modifier key held), `"threshold"` (dragged outside the stage) or `"off"`. `"off"` also makes `window/detach` reject with `drag-disabled`. | one of the three |
| `drag.toTiled` | `"modifier"` | When a dragged floating window may drop into the layout: `"modifier"`, `"always"` or `"off"`. The pure `window/drop` accepts a floating window unless this is `"off"`. | one of the three |
| `drag.crossWorkspace` | `true` | Dropping on a `[data-wm-workspace-target]` element moves the window to that workspace. | no |
| `drag.follow` | `false` | A cross-workspace drop also activates the target workspace (`follow: true`). | no |
| `rules` | `[]` | Declarative window rules, applied at `window/create`. See [`rules/set`](./commands.md#rulesset) and [Queries › Rules](./queries.md#rules). | `validRules` |
| `urgency.clearOnFocus` | `true` | Focusing an urgent window clears its hint. | boolean |
| `snap.edges` | `true` | While dragging a floating window, approaching a stage edge or corner previews a half, quarter or maximize placement and applies it on release. | boolean |
| `snap.threshold` | `16` | How close in px the pointer must be to a stage edge or corner. | `≥ 0` |
| `snap.magnet` | `8` | During a floating move or resize, edges within this many px snap onto other visible windows' edges and the stage. `0` disables magnetism. | `≥ 0` |
| `snap.zones` | `"halves-quarters"` | `"halves-quarters"`, `"halves"` (edges only), `"quarters"` (corners only) or `"off"`. | one of the four |

Keys `config/set` does not validate are stored as given. Unknown keys are kept (and serialized) but ignored by the library.

## Constructors

### `createState(options?)`

```js
createState({ workspaces = ["main"], layout, config = {} } = {}) → State
```

- `workspaces`: workspace ids, or `{ id, layout?, windows? }` objects. At least one is required. **Throws `TypeError`** on an empty list.
- `layout`: the default layout spec for workspaces given by id (and for objects without their own `layout`). When omitted, `createWorkspace`'s default applies (`{ type: "master-stack", ratio: 0.5 }`).
- `config`: overrides for `DEFAULT_CONFIG`. `drag`, `urgency` and `snap` merge one level deep; every other key replaces.

All workspaces go on one output, `DEFAULT_OUTPUT`, and the first workspace is active. Create more outputs with [`output/create`](./commands.md#outputcreate).

### `createWorkspace({ id, layout?, windows?, output? })`

Returns a workspace record. Defaults: `layout = { type: "master-stack", ratio: 0.5 }`, `windows = []` (copied), `output = DEFAULT_OUTPUT`. It does not add the workspace to any state. Use `workspace/create` or `output/create` for that.

### `createOutput({ id, workspaces?, activeWorkspace? })`

Returns an output record. `activeWorkspace` defaults to the first workspace. It does not add the output to any state.

### `createWindowRecord(description, state)`

Normalizes a `window/create` payload into a [window record](#window-record) using `state.config.defaultPlacement`, the parent's workspace and `state.activeWorkspace`. It applies the role defaults above, but not rules. `update` uses it internally. It is exported for tools that want to preview a record.
