# Commands

[API reference](./README.md) › Commands

A command is a plain object that expresses intent: `{ type: "window/focus", id: "editor" }`. `update` applies one command to a state and reports what actually happened. Policy may redirect a command (focus goes to a modal dialog instead) or refuse it, so the events can differ from the command. Sources: `src/state/update.mjs` (most commands) and `src/state/drops.mjs` (the drag-and-drop commands).

## Contents

- [The update protocol](#the-update-protocol)
- [Shared behaviour](#shared-behaviour)
- [Window lifecycle and focus](#window-lifecycle-and-focus): [`window/create`](#windowcreate), [`window/close`](#windowclose), [`window/focus`](#windowfocus), [`window/blur`](#windowblur), [`focus/next`](#focusnext), [`focus/previous`](#focusprevious), [`focus/urgent`](#focusurgent), [`window/set-urgent`](#windowset-urgent)
- [Stacking](#stacking): [`window/raise`](#windowraise), [`window/lower`](#windowlower), [`window/set-layer`](#windowset-layer)
- [Geometry and mode](#geometry-and-mode): [`window/move`](#windowmove), [`window/resize`](#windowresize), [`window/set-mode`](#windowset-mode), [`window/detach`](#windowdetach), [`window/toggle-floating`](#windowtoggle-floating), [`window/set-constraints`](#windowset-constraints)
- [Status](#status): [`window/minimize`](#windowminimize), [`window/maximize`](#windowmaximize), [`window/fullscreen`](#windowfullscreen), [`window/restore`](#windowrestore), [`window/toggle-maximize`](#windowtoggle-maximize), [`window/toggle-fullscreen`](#windowtoggle-fullscreen), [`window/pop-out`](#windowpop-out), [`window/pop-in`](#windowpop-in)
- [Properties](#properties): [`window/set-title`](#windowset-title), [`window/set-draggable`](#windowset-draggable), [`window/set-sticky`](#windowset-sticky), [`window/toggle-sticky`](#windowtoggle-sticky)
- [Order within a layout](#order-within-a-layout): [`window/swap`](#windowswap), [`window/promote`](#windowpromote), [`window/drop`](#windowdrop), [`window/swap-next`](#windowswap-next), [`window/swap-previous`](#windowswap-previous), [`window/move-before`](#windowmove-before), [`window/move-after`](#windowmove-after)
- [Workspaces and the scratchpad](#workspaces-and-the-scratchpad): [`window/move-to-workspace`](#windowmove-to-workspace), [`window/to-scratchpad`](#windowto-scratchpad), [`scratchpad/toggle`](#scratchpadtoggle), [`window/from-scratchpad`](#windowfrom-scratchpad), [`workspace/create`](#workspacecreate), [`workspace/activate`](#workspaceactivate), [`workspace/remove`](#workspaceremove), [`workspace/rename`](#workspacerename), [`workspace/reorder`](#workspacereorder), [`workspace/move-to-output`](#workspacemove-to-output)
- [Outputs](#outputs): [`output/create`](#outputcreate), [`output/remove`](#outputremove), [`output/focus`](#outputfocus), [`output/reorder`](#outputreorder)
- [Layout](#layout): [`layout/set`](#layoutset), [`layout/to-tree`](#layoutto-tree), [`layout/set-ratio`](#layoutset-ratio), [`layout/rotate-split`](#layoutrotate-split), [`layout/resize-split`](#layoutresize-split), [`layout/toggle`](#layouttoggle)
- [Configuration and rules](#configuration-and-rules): [`config/set`](#configset), [`rules/set`](#rulesset)
- [Custom commands](#custom-commands)

## The update protocol

```js
import { update, reduce, replay, COMMANDS } from "@johnhenry/window-algebra";

update(state, command, extensions?) → { state, events, effects }
reduce(state, command, extensions?) → state          // update(...).state
replay(state, commands, extensions?) → state         // migrate(state), then reduce each command
COMMANDS                                              // frozen array of the 58 built-in command types
```

- `state`: the next state. When nothing changed it is **the same reference** as the input.
- `events`: an array of event objects recording what happened, in order. See [Events](./events.md).
- `effects`: an array of effect values for the effectful shell. There are only two types, `{ type: "render" }` and `{ type: "focus", id }` (`id` may be `null`). Effects are de-duplicated by `type`, keeping the **last** occurrence, so a command that focuses twice yields one `focus` effect naming the final target.
- `extensions`: optional `{ [type]: (state, command) => ({ state, events?, effects? }) }`. An extension handler **overrides** a built-in of the same type. Missing `events`/`effects` default to `[]`. A handler that throws (or returns something that is not `{ state, ... }`) makes the command a `handler-threw` rejection instead of propagating the exception.
- A `null`/non-object command, or one without a string `type`, is rejected as `invalid-command`. An unknown `type` is rejected as `unknown-command`. A command whose `id`, `target`, `to`, `parent`, `workspace`, `output` or `fallback` is an `Object.prototype` key (`__proto__`, `constructor`, `toString`, ...) is rejected as `invalid-id`, so those names can never be window, workspace or output ids.
- `replay` migrates its starting state first (see [Versioning](./versioning.md)). If migration fails, it replays from the state as given.

`COMMANDS` is `Object.keys` of the built-in handler table, 58 entries, in the order the sections below follow.

## Shared behaviour

**Rejections.** A refused command returns the input state unchanged, one event `{ type: "command/rejected", command: <type>, id: <command.id>, reason }` and no effects. The `id` field is copied from the command even for commands whose subject is not `id`. Every reason is listed per command below and collected in [Errors](./errors.md).

**Focus policy (`applyFocus`).** It is used by every command that focuses a window: `window/create`, `window/focus`, `focus/*`, `scratchpad/toggle`, `window/move-to-workspace { follow }`, `output/focus`, and refocus. In order:

1. **Modal redirection.** The target becomes `modalTarget(state, id)`, the deepest open modal descendant.
2. **Output switch.** If the target's workspace is on another output, `focusedOutput` changes and `output/focused { id, previous }` is emitted.
3. **Workspace switch.** If the target is not on the active workspace (and is not sticky), that workspace is activated and `workspace/activated { id, previous }` is emitted.
4. **Restore.** A minimized target is restored to `normal` and `window/restored { id }` is emitted.
5. **Raise.** With `config.focusRaises`, the target and its descendants are raised in their layers.
6. **Urgency.** With `config.urgency.clearOnFocus` (default), an urgent target loses its hint and `window/urgent-changed { id, urgent: false }` is emitted.
7. `focus.window` is set and the id moves to the end of `focus.history`.
8. `focus/redirected { requested, id }` is emitted if modal redirection changed the target. `window/focused { id, previous }` is emitted if the focused window changed.

9. **Focus is only given to what is shown.** A target that is hidden in the scratchpad, popped out, or has such an ancestor can never be focused, and one that would still be invisible after steps 2 to 4 is skipped too. Commands that name their target (`window/focus`, `focus/urgent`) reject with `not-on-workspace`, `popped-out` or `not-visible`; the others (a create, a `follow`) simply do not focus. The invariant is that `focus.window` is `null` or a visible window.
10. **Fullscreen.** While a window is fullscreen, only it and its descendants are presented. Cycling (`focus/next`, `focus/previous`) stays inside that set; creating a window does not focus one outside it. An explicit `window/focus` (or `focus/urgent`, a `follow`, showing a scratchpad window) of a window beneath the fullscreen one ends that fullscreen first (`window/status-changed { status: "normal", previous: "fullscreen" }`).

Minimized ancestors of the target are restored along with it (step 4 applies to the whole chain).

Effects: `render`, `{ type: "focus", id: target }`.

**Refocus.** It runs after commands that can hide the focused window: close, minimize, pop-out, move to another workspace, scratchpad, unstick, workspace and output changes. If the focused window is still visible, nothing happens. Otherwise focus goes to the most recent window in `focus.history` that is still focusable, through `applyFocus`. If none is left, focus becomes `null`, `window/blurred { id }` is emitted (when something was focused), and the effect is `{ type: "focus", id: null }`.

**Tiled.** "Tiled" below means `role: "window"` and `mode: "tiled"`. "Droppable" (the drag-and-drop commands) additionally requires the window to be in its workspace's tiled base (not sticky, not maximized, the layout not `floating`) and `status: "normal"`.

**BSP bookkeeping.** On a `bsp` workspace, commands that add or remove tiled windows (create, close, set-mode, detach, move-to-workspace, scratchpad, workspace/remove) keep `layout.tree` in sync. Docking `tree` workspaces are reconciled lazily by `derive` and the drop interpreter instead; see [Layouts](./layouts.md#tree).

---

## Window lifecycle and focus

### `window/create`

```js
{ type: "window/create", id, title?, role?, parent?, modal?, mode?, placement?, constraints?,
  layer?, anchor?, workspace?, data?, draggable?, app?, focus? }
```

Creates a window. The fields become the [window record](./state.md#window-record); defaults come from the role and `config`. Then the [window rules](./queries.md#rules) in `config.rules` are applied. A rule only fills in fields the command did **not** set explicitly (an own property of the command, even if its value is `undefined`). Rules apply in order, a later rule overrides an earlier one field by field, and `placement`/`constraints` merge one level deep. If a rule set `constraints`, the placement is re-clamped with `constrainSize`.

The window is appended to its workspace's `windows`, inserted into its BSP tree (splitting the currently focused window's leaf) when the workspace is `bsp` and the window is tiled, and pushed on top of its layer's stack.

It is then focused through the focus policy, **unless** `focus: false` is given or the window landed on a workspace other than the active one.

- **Events:** `window/created { id, rules? }` (`rules` is the array of matched rule indices, present only when at least one matched), followed by the focus events.
- **Effects:** `render`, plus `focus` when focused.
- **Rejections:** `missing-id` (not a non-empty string), `duplicate-id`, `unknown-parent`, `hidden-parent` (the parent is hidden in the scratchpad), `parent-on-other-workspace` (a modal dialog on another workspace than its parent), `unknown-role` (not in `ROLES`), `unknown-layer` (not in `LAYERS`), `unknown-mode` (not `tiled` or `floating`), `unknown-workspace` (after rules: a rule may send the window to a workspace that does not exist).

### `window/close`

```js
{ type: "window/close", id }
```

Removes the window **and all its descendants** (children close first, deepest first). Each one leaves its workspace's `windows`, its BSP tree, the stack, focus history, `urgent`, and `lastScratchpad` if it was that. Then [refocus](#shared-behaviour).

- **Events:** one `window/closed { id }` per removed window (descendants first, the requested window last), then the refocus events.
- **Effects:** `render`, plus `focus` from refocus.
- **Rejections:** `unknown-window`.

### `window/focus`

```js
{ type: "window/focus", id }
```

Focuses a window through the full [focus policy](#shared-behaviour): modal redirection, output and workspace switch, restore from minimized, raise, urgency clear. Focusing the already-focused window re-raises it and emits no `window/focused`.

- **Events:** as the focus policy.
- **Effects:** `render`, `{ type: "focus", id: <final target> }`.
- **Rejections:** `unknown-window`, `not-on-workspace` (hidden in the scratchpad, or a child of such a window), `popped-out` (a popped-out window, or a child of one), `not-visible` (the target would still not be shown, for example a child whose parent is on another workspace).

### `window/blur`

```js
{ type: "window/blur" }
```

Clears `focus.window` (history is kept). A no-op when nothing is focused.

- **Events:** `window/blurred { id: <previous> }`.
- **Effects:** `render`, `{ type: "focus", id: null }`.
- **Rejections:** none.

### `focus/next`

```js
{ type: "focus/next" }
```

Focuses the next focusable window. The cycle is every output's `focusable(state, output)` list concatenated in `outputOrder`, and it wraps. So on the last window of one output it moves to the first focusable window of the next output (emitting `output/focused`). With nothing focused (or the focused window not in the cycle) it focuses the first entry. It is a no-op when nothing is focusable.

- **Events:** `output/focused` when crossing outputs, then the focus-policy events.
- **Effects:** `render`, `focus`.
- **Rejections:** none.

### `focus/previous`

```js
{ type: "focus/previous" }
```

Like `focus/next`, backwards.

### `focus/urgent`

```js
{ type: "focus/urgent" }
```

Focuses the **oldest** urgent window that can be focused (first in `state.urgent`; urgent windows hidden in the scratchpad or popped out are skipped), switching output and workspace as needed. With `config.urgency.clearOnFocus` its urgency is cleared.

- **Events:** the focus-policy events, including `window/urgent-changed { urgent: false }`.
- **Effects:** `render`, `focus`.
- **Rejections:** `no-urgent-window`.

### `window/set-urgent`

```js
{ type: "window/set-urgent", id, urgent? = true }
```

Marks or clears a window's urgency hint (EWMH/X11 style). A newly urgent window goes to the end of `state.urgent`. It is a no-op when the window is already in the requested state. Setting urgency on the focused window keeps it urgent until it is focused again (clear-on-focus happens during focus, not at mark time).

- **Events:** `window/urgent-changed { id, urgent }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`, `invalid-urgent` (`urgent` given but not a boolean). A missing `urgent` means `true`, as a missing `sticky` does for `window/set-sticky`.

## Stacking

### `window/raise`

```js
{ type: "window/raise", id }
```

Moves the window to the top of its layer, then raises its descendants above it (keeping their relative order), so a child is never painted beneath its parent. An anchored child must also follow its anchor for CSS anchor positioning to apply.

- **Events:** `window/raised { id }` (emitted even if it was already on top).
- **Effects:** `render`.
- **Rejections:** `unknown-window`.

### `window/lower`

```js
{ type: "window/lower", id }
```

Moves the window to the bottom of its layer. Descendants are not moved.

- **Events:** `window/lowered { id }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`.

### `window/set-layer`

```js
{ type: "window/set-layer", id, layer }
```

Moves the window to the top of another layer (or of its own). Its descendants (dialogs, sheets, popovers) that are in the window's old layer move with it, keeping their relative order, so a child is never left painted beneath its parent; a descendant deliberately on another layer stays put.

- **Events:** `window/layer-changed { id, layer }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`, `unknown-layer` (not in `LAYERS`).

## Geometry and mode

### `window/move`

```js
{ type: "window/move", id, x?, y? }
```

Stores the **requested** position, whatever the mode. `derive` uses it only while the window is floating. Omitted coordinates keep their current values. `x` and `y` must each be a finite number or `"center"`. Constraints are not applied (a move changes no size).

- **Events:** `window/moved { id, placement }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`, `invalid-geometry` (a non-finite or non-number coordinate).

The manager coalesces a run of absolute moves (both `x` and `y` given) sharing a `gesture` token into one log entry. See [The manager › Gestures](./manager.md#gestures).

### `window/resize`

```js
{ type: "window/resize", id, width?, height?, x?, y? }
```

Stores a requested size (and optionally position) after `constrainSize(size, win.constraints)`: min/max clamp, aspect ratio and size increments. Omitted fields keep their values. `width` and `height` must be finite numbers ≥ 0; `x` and `y` finite numbers or `"center"`.

- **Events:** `window/resized { id, placement }` (the constrained placement).
- **Effects:** `render`.
- **Rejections:** `unknown-window`, `invalid-geometry`.

### `window/set-mode`

```js
{ type: "window/set-mode", id, mode: "tiled" | "floating" }
```

Switches a window between the tiled layout and floating. On a `bsp` workspace the window is inserted into (next to the focused window) or removed from the tree. It is a no-op when the mode is unchanged.

- **Events:** `window/mode-changed { id, mode }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`, `unknown-mode`.

### `window/detach`

```js
{ type: "window/detach", id, x?, y?, width?, height? }
```

The drag-to-float gesture as one command (one undo step). It turns a droppable tiled window into a floating window at the given position. Width and height default to its stored floating size and are passed through `constrainSize`. The window leaves the BSP tree and is raised.

- **Events:** `window/detached { id, placement }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`, `drag-disabled` (`config.drag.toFloating === "off"`), `not-draggable` (`draggable: false`), `not-tiled` (not droppable), `blocked` (a modal child is open).

### `window/toggle-floating`

```js
{ type: "window/toggle-floating", id }
```

`window/set-mode` with the other mode. Same events and effects.

- **Rejections:** `unknown-window`.

### `window/set-constraints`

```js
{ type: "window/set-constraints", id, constraints }
```

Merges `constraints` into the window's constraints (keys not given are kept) and re-clamps its placement's size with `constrainSize`. Tiled windows get CSS `min-*`/`max-*` and, for an exact `aspectRatio`, CSS `aspect-ratio`.

`constraints` must be a plain object of the documented keys: `minWidth`, `minHeight`, `baseWidth`, `baseHeight` (finite numbers ≥ 0), `maxWidth`, `maxHeight` (a number ≥ 0 or `Infinity`), `widthIncrement`, `heightIncrement` (finite numbers > 0), and `aspectRatio` (a number > 0, or `{ min?, max? }` with at least one). `undefined`/`null` clears a key. Unknown keys are rejected.

- **Events:** `window/constrained { id, constraints }` (the merged constraints).
- **Effects:** `render`.
- **Rejections:** `unknown-window`, `invalid-constraints`.

## Status

The four status setters share one implementation. Each is a no-op when the window already has that status. Only `window/minimize` refocuses.

### `window/minimize`

```js
{ type: "window/minimize", id }
```

Sets `status: "minimized"`. The window leaves the presentation and stops blocking its parent if it was a modal. Then [refocus](#shared-behaviour). Focusing a minimized window later restores it.

- **Events:** `window/status-changed { id, status: "minimized", previous }`, then the refocus events.
- **Effects:** `render`, plus `focus` from refocus.
- **Rejections:** `unknown-window`.

### `window/maximize`

```js
{ type: "window/maximize", id }
```

Sets `status: "maximized"`. The window leaves the tiled base (if it was in it) and fills the stage in its layer. If the window is currently shown, it is also focused (through the focus policy, so a modal child takes the focus instead); a window on another workspace is not, so maximizing never switches workspace.

- **Events:** `window/status-changed { id, status: "maximized", previous }`, then the focus events.
- **Effects:** `render`, plus `focus`.
- **Rejections:** `unknown-window`.

### `window/fullscreen`

```js
{ type: "window/fullscreen", id }
```

Sets `status: "fullscreen"`. While a visible window is fullscreen, `derive` presents it and its **descendants** (its own dialogs, sheets and popovers, which stay above it) and nothing else, and `paintOrder` is the window followed by those descendants. So fullscreening a parent with an open modal dialog does not strand the dialog: it stays painted and focused. As with `window/maximize`, a window that is currently shown also takes focus; one on another workspace does not. There is at most one fullscreen window per output: fullscreening a window restores any other fullscreen window shown on its output (one `window/status-changed` event each). If a workspace switch still brings two into view, the one covering the focused window is presented, else the topmost.

- **Events:** `window/status-changed { id, status: "fullscreen", previous }`, then the focus events.
- **Effects:** `render`, plus `focus`.
- **Rejections:** `unknown-window`.

### `window/restore`

```js
{ type: "window/restore", id }
```

Sets `status: "normal"` from any other status, including `"popped-out"`. When a window is restored from `popped-out` this way, `attachPopouts` closes the popup, but the surface remounts fresh in the main document. Use `popIn` to carry the live DOM back.

- **Events:** `window/status-changed { id, status: "normal", previous }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`.

### `window/toggle-maximize`

```js
{ type: "window/toggle-maximize", id }
```

`window/maximize`, or `window/restore` when the window is already maximized. Same events, effects and rejections as those.

### `window/toggle-fullscreen`

```js
{ type: "window/toggle-fullscreen", id }
```

`window/fullscreen`, or `window/restore` when the window is already fullscreen. Same events, effects and rejections as those.

### `window/pop-out`

```js
{ type: "window/pop-out", id }
```

Sets `status: "popped-out"`, so the window leaves the layout to live in a separate browser window. In pure-state terms this is exactly like minimize: it is not visible or focusable and does not block its parent. The distinct status lets the browser shell ([`attachPopouts`](./browser.md#attachpopouts)) open and close the real popup. It is a no-op when the window is already popped out. Then [refocus](#shared-behaviour).

- **Events:** `window/status-changed { id, status: "popped-out", previous }`, then the refocus events.
- **Effects:** `render`, plus `focus` from refocus.
- **Rejections:** `unknown-window`, `blocked` (an open modal child blocks the window). The browser helper adds `popup-blocked`.

### `window/pop-in`

```js
{ type: "window/pop-in", id }
```

Reverses `window/pop-out` (`status: "normal"`). Like `window/restore` and the other status setters, a window that is not popped out is a **no-op** (it used to be rejected as `not-popped-out`). Unlike `window/restore` it only ever undoes a pop-out: a minimized or maximized window is left alone.

- **Events:** `window/status-changed { id, status: "normal", previous: "popped-out" }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`.

## Properties

### `window/set-title`

```js
{ type: "window/set-title", id, title }
```

Stores `String(title ?? "")`. The event carries `command.title` exactly as given (so `undefined` stays `undefined` in the event while the stored title is `""`).

- **Events:** `window/retitled { id, title }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`.

### `window/set-draggable`

```js
{ type: "window/set-draggable", id, draggable? }
```

Pins (`draggable: false`) or unpins (anything else, including omitted) a window. Only the `false` exception is stored. A pinned window cannot be dragged, detached or swapped away, but other windows may be inserted beside it. It is a no-op when unchanged.

- **Events:** `window/draggable-changed { id, draggable }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`.

### `window/set-sticky`

```js
{ type: "window/set-sticky", id, sticky? = true }
```

EWMH-style sticky: the window is visible on every workspace of its own output. It is never part of a tiled base (it is always presented as a floating overlay, even with `mode: "tiled"`), it keeps its place in `state.stack`, and focusing it never switches workspace. Only `sticky: true` is stored. A missing `sticky` means `true` (as for `window/set-urgent`). Stickiness is inherited by descendants: a dialog or popover of a sticky window is shown wherever its parent is. It is a no-op when unchanged. Then [refocus](#shared-behaviour): unsticking the focused window while its home workspace is inactive moves focus off it.

- **Events:** `window/sticky-changed { id, sticky }`, then the refocus events.
- **Effects:** `render`, plus `focus` from refocus.
- **Rejections:** `unknown-window`, `invalid-sticky` (`sticky` given but not a boolean).

### `window/toggle-sticky`

```js
{ type: "window/toggle-sticky", id }
```

Flips the window's own `sticky` flag. Same events, effects and rejections as `window/set-sticky`.

## Order within a layout

### `window/swap`

```js
{ type: "window/swap", id, target }
```

Exchanges two windows' positions in their workspace's `windows` order, and in the stored tree for `bsp` and docking `tree` workspaces. Any two windows on the same workspace can be swapped; no droppability checks apply. Swapping a window with itself is a no-op.

- **Events:** `window/swapped { id, target }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window` (either missing), `not-on-workspace` (either is hidden in the scratchpad), `different-workspaces`.

### `window/promote`

```js
{ type: "window/promote", id }
```

Swaps a tiled window with the first tiled window of its workspace (the master position). It is a no-op when the window is not tiled or already first.

- **Events:** `window/swapped { a: id, b: <previous master> }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window`, `not-on-workspace` (a window hidden in the scratchpad has no workspace, so no master slot).

### `window/drop`

```js
{ type: "window/drop", id, target, zone: "center" | "left" | "right" | "top" | "bottom", geometry? }
```

Drops window `id` onto `target`. What the zone means depends on the target workspace's layout, through the drop interpreter registry. See [Drag and drop](./drops.md) for the per-layout table. The resolved **op** is one of `"swap"`, `"before"`, `"after"`, `"split"` (bsp, tree) or `"tab"` (tree center). Only the order of droppable windows changes; every other window keeps its slot in `windows`.

The dragged window may also be a **floating** top-level `role: "window"` with `status: "normal"` (dropping it into the layout) unless `config.drag.toTiled` is `"off"`. It becomes tiled, and since it has no slot to trade, its `"swap"` inserts it in the target's place.

`geometry` is an optional `{ [id]: { width, height } }` estimate of slot sizes **after** the drop. With `config.drag.tooSmall: "reject"`, a drop that would put `id` or `target` in a slot violating its min/max constraints is refused. Without `geometry` the setting is advisory: the pure core has no pixels. The input adapter measures its preview and sends it.

- **Events:** `window/dropped { id, target, zone, op, workspace, tiled? }`. `tiled: true` is present when a floating window was dropped into the layout. Dropping a window where it already is emits the event but returns the unchanged state and no effects.
- **Effects:** `render` (when something changed).
- **Rejections, in check order:** `unknown-window`, `unknown-zone` (not a `DROP_ZONES` value), `same-window`, `different-workspaces`, `drag-disabled` (the effective drag mode is `"off"`), `not-draggable` (the dragged window is pinned), `not-tiled` (the target is not droppable, or the dragged window is neither droppable nor an allowed floating window), `blocked` (either window is blocked by a modal), `unknown-zone` (the interpreter maps the zone to no op), `zone-disabled` (the drag mode forbids that op: `"swap"` mode forbids inserts, splits and tabs; `"insert"` mode forbids swaps), `not-draggable` (a swap with a pinned target), `too-small`.

### `window/swap-next`

```js
{ type: "window/swap-next", id? }
```

Swaps a droppable window (default: the focused one) with the next window in on-screen order, wrapping. The order is the leaf order for `bsp` and docking `tree` workspaces and the tiled workspace order otherwise. It is a no-op with fewer than two tiled windows.

- **Events:** `window/swapped { a: id, b: other }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window` (no such window, or no `id` and nothing focused), `not-tiled`.

### `window/swap-previous`

```js
{ type: "window/swap-previous", id? }
```

Like `window/swap-next`, backwards.

### `window/move-before`

```js
{ type: "window/move-before", id?, target? }
```

Moves a droppable window (default: the focused one) one slot earlier, or directly before `target`. How depends on the layout:

- **bsp:** the window is placed next to the target, splitting the target's leaf along its parent split's own direction (the top side for a vertical split, the left side otherwise).
- **tree:** if the target's parent is a `tabs` container, the window is inserted before it in the tab strip. Otherwise it splits the target along the parent container's axis (column: top; row or root: left).
- **Anything else:** a reading-order insert before the target.

It is a no-op when there is no earlier neighbour and no `target`.

- **Events:** `window/reordered { id, target, position: "before" }`.
- **Effects:** `render`.
- **Rejections:** `unknown-window` (the subject or `target`), `not-tiled` (the subject or `target`), `same-window`, `different-workspaces`.

### `window/move-after`

```js
{ type: "window/move-after", id?, target? }
```

The mirror of `window/move-before` (bottom/right, after, the next neighbour). The event has `position: "after"`.

## Workspaces and the scratchpad

### `window/move-to-workspace`

```js
{ type: "window/move-to-workspace", id, workspace, follow? }
```

Moves a window **and its descendants** to another workspace (appended to its `windows`, re-inserted into a `bsp` tree there). A floating window keeps its placement. Moving a scratchpad window (shown or hidden) onto a workspace directly takes it out of the scratchpad permanently. With `follow: true`, the window is then focused (activating its new workspace, and output if different). Otherwise [refocus](#shared-behaviour) runs. It is a no-op when the window is already on that workspace. A window with a parent cannot be moved on its own (that would strand a dialog away from the window it blocks): move its root ancestor instead and the descendants follow.

- **Events:** `window/workspace-changed { id, workspace }` (the requested window only), then the focus or refocus events.
- **Effects:** `render`, plus `focus`.
- **Rejections:** `unknown-window`, `unknown-workspace`, `has-parent`.

### `window/to-scratchpad`

```js
{ type: "window/to-scratchpad", id }
```

i3-style scratchpad. It hides the window off every workspace: `workspace: null`, removed from its workspace and BSP tree, forced to `mode: "floating"`, marked `scratchpad: true`, and recorded as `lastScratchpad`. Then [refocus](#shared-behaviour). It is a no-op when the window is already hidden. Children stay on their workspace but become invisible, because visibility requires a visible parent; `scratchpad/toggle` brings them along when it shows the window again. A window that has a parent cannot be sent to the scratchpad on its own.

- **Events:** `scratchpad/hidden { id }` (the same event `scratchpad/toggle` emits when it hides), then the refocus events.
- **Effects:** `render`, plus `focus` from refocus.
- **Rejections:** `unknown-window`, `has-parent`.

### `scratchpad/toggle`

```js
{ type: "scratchpad/toggle", id? }
```

Shows or hides a scratchpad window (default: `lastScratchpad`).

- **Hidden → shown:** placed on the active workspace (with its descendants), floating and centred (`placement.x`/`y` become `"center"`, resolved purely in CSS), then focused (ending a fullscreen window beneath it, if any).
- **Shown → hidden:** back to `workspace: null`, then refocus.

Either way it becomes `lastScratchpad`.

- **Events:** `scratchpad/shown { id }` then the focus events, or `scratchpad/hidden { id }` then the refocus events.
- **Effects:** `render`, `focus`.
- **Rejections:** `empty-scratchpad` (no `id` and no `lastScratchpad`), `unknown-window`, `not-scratchpad` (the window was never sent to the scratchpad, or was pulled out of it).

### `window/from-scratchpad`

```js
{ type: "window/from-scratchpad", id }
```

The inverse of `window/to-scratchpad`: the window stops being a scratchpad window (the `scratchpad` flag is cleared, and `lastScratchpad` too if it was this window). A **hidden** one is placed on the active workspace (with its descendants), keeps its floating mode, and is focused (ending a fullscreen window beneath it, if any). A **shown** one simply loses the flag and stays where it is.

- **Events:** `scratchpad/removed { id }`, then (for a hidden window) the focus events.
- **Effects:** `render`, plus `focus` for a hidden window.
- **Rejections:** `unknown-window`, `not-scratchpad`.

### `workspace/create`

```js
{ type: "workspace/create", id, layout?, output?, activate? }
```

Creates an empty workspace on `output` (default: the focused output), appended to `workspaceOrder` and the output's `workspaces`. `layout` defaults to a copy of the active workspace's layout **without** anything that describes that workspace's windows: `tree`, `sizes`, `ratios` (and a copied `bsp` spec gets `tree: null`), so no foreign window id leaks into the new workspace. With `activate: true` it is then activated.

- **Events:** `workspace/created { id, output }`, then (with `activate`) the `workspace/activate` events.
- **Effects:** `render`, plus `focus` with `activate`.
- **Rejections:** `missing-id`, `duplicate-id`, `unknown-output`. The manager adds `unknown-layout` (see [manager](./manager.md#rejections-the-manager-adds)).

### `workspace/activate`

```js
{ type: "workspace/activate", id }
```

Shows a workspace on its own output and focuses that output. `focus.window` is cleared and then [refocus](#shared-behaviour) picks the most recent focusable window from history. If there is none, focus stays `null`; because focus was cleared first, no `window/blurred` event is emitted in that case. It is a no-op when the workspace is already active on the already-focused output.

- **Events:** `output/focused { id, previous }` if its output was not focused, `workspace/activated { id, previous }` if it was not already that output's active workspace, then the refocus events.
- **Effects:** `render`, `focus`.
- **Rejections:** `unknown-workspace`.

### `workspace/remove`

```js
{ type: "workspace/remove", id, fallback? }
```

Removes a workspace. Its top-level windows (and so their descendants) move to `fallback`, as do child windows whose parent lives on another workspace (their descendants follow too), so no window is left pointing at the removed workspace (default: the first other workspace in `workspaceOrder`, which may be on another output). If the removed workspace was active on its output, the next remaining workspace **on the same output** becomes active there. Then [refocus](#shared-behaviour).

- **Events:** `workspace/removed { id, fallback }`, then the refocus events. The window moves are silent: no `window/workspace-changed`.
- **Effects:** `render`, plus `focus`.
- **Rejections:** `unknown-workspace` (the workspace, or an invalid or identical `fallback`), `last-workspace` (the only workspace anywhere), `last-workspace-on-output` (the only workspace on its output).

### `workspace/rename`

```js
{ type: "workspace/rename", id, to }
```

Changes a workspace's id and every reference to it: the `workspaces` map and the record's own `id`, its windows' `workspace`, `workspaceOrder`, its output's `workspaces` and `activeWorkspace`, and `activeWorkspace`. `config.rules` whose `set.workspace` names the old id are left as written. Renaming to the same id is a no-op.

- **Events:** `workspace/renamed { id, to }`.
- **Effects:** `render`.
- **Rejections:** `unknown-workspace`, `missing-id` (`to` is not a non-empty string), `duplicate-id` (`to` exists).

### `workspace/reorder`

```js
{ type: "workspace/reorder", id, index }
```

Moves a workspace to `index` (a non-negative integer, clamped to the last position) among its output's `workspaces`. `workspaceOrder` follows: the output's workspaces keep the slots of it they occupied, in their new order, and other outputs' workspaces do not move. A move to the current position is a no-op.

- **Events:** `workspace/reordered { id, index }` (the clamped index).
- **Effects:** `render`.
- **Rejections:** `unknown-workspace`, `invalid-index`.

### `workspace/move-to-output`

```js
{ type: "workspace/move-to-output", id, output, activate? }
```

Moves a workspace (and everything on it) to another output. If it was active on its old output, the next workspace there becomes active. With `activate: true` it is then activated (focusing its new output). Otherwise [refocus](#shared-behaviour) runs. It is a no-op when the workspace is already on that output.

- **Events:** `workspace/moved-to-output { id, output, from }`, then the activate or refocus events.
- **Effects:** `render`, plus `focus`.
- **Rejections:** `unknown-workspace`, `unknown-output`, `last-workspace-on-output` (an output always keeps at least one workspace).

## Outputs

sway-style outputs: multiple displays or stages, each showing one of its own workspaces. A fresh state has one output, `DEFAULT_OUTPUT` (`"primary"`).

### `output/create`

```js
{ type: "output/create", id, workspaces?, focus? }
```

Adds an output with new workspaces. `workspaces` takes ids or `{ id, layout? }` objects, like `createState`, and defaults to `["<id>-1"]`. The first becomes the output's active workspace. With `focus: true`, the new output is then focused (`output/focus`).

- **Events:** `output/created { id, workspaces }`, then (with `focus`) the `output/focus` events.
- **Effects:** `render`, plus `focus` with `focus: true`.
- **Rejections:** `missing-id` (the output id, or a workspace entry without a string id), `duplicate-id` (the output id, or a workspace id that exists or repeats), `missing-workspaces` (an empty or non-array `workspaces`).

### `output/remove`

```js
{ type: "output/remove", id, fallback? }
```

Removes an output. All its workspaces (with their windows) are appended to `fallback` (default: the first other output in `outputOrder`). The fallback's active workspace does not change. If the removed output was focused, the fallback becomes focused. Then [refocus](#shared-behaviour).

- **Events:** `output/removed { id, fallback, workspaces }` (the moved workspace ids), then the refocus events.
- **Effects:** `render`, plus `focus`.
- **Rejections:** `unknown-output` (the output, or an invalid or identical `fallback`), `last-output`.

### `output/focus`

```js
{ type: "output/focus", id }
```

Gives input focus to another output (`activeWorkspace` follows). Keyboard focus follows too, unless the focused window is already on that output. It goes to the most-recently-focused focusable window on the output (falling back to the last one in workspace order). With none focusable, focus is cleared. It is a no-op when the output is already focused.

- **Events:** `output/focused { id, previous }`, then either the focus-policy events or `window/blurred { id }`.
- **Effects:** `render`, `focus` (when focus moved or cleared).
- **Rejections:** `unknown-output`.

### `output/reorder`

```js
{ type: "output/reorder", id, index }
```

Moves an output to `index` (a non-negative integer, clamped) in `outputOrder`, which focus cycling (`focus/next`, `focus/previous`) follows. A move to the current position is a no-op.

- **Events:** `output/reordered { id, index }`.
- **Effects:** `render`.
- **Rejections:** `unknown-output`, `invalid-index`.

## Layout

Every layout command takes an optional `workspace` (default: the active workspace). Layout specs are described in [Layouts](./layouts.md).

### `layout/set`

```js
{ type: "layout/set", layout, workspace? }
```

Replaces a workspace's layout spec. A `bsp` spec without a `tree` is seeded from the workspace's current tiled order, and so is a `tree` spec whose `tree` is `undefined`. A spec is valid if it is a function, or an object with a string `type` and, if present, a valid `modifiers` list (an array of objects with string `type`). The pure `update` cannot know which custom interpreters you will pass to `derive`, so it accepts any string `type`; `derive` falls back to `columns` for a type it has no interpreter for, and the manager rejects it up front (`unknown-layout`).

- **Events:** `layout/changed { workspace, layout }` (the seeded spec).
- **Effects:** `render`.
- **Rejections:** `unknown-workspace`, `invalid-layout`. The manager adds `unknown-layout`.

### `layout/to-tree`

```js
{ type: "layout/to-tree", workspace? }
```

Converts whatever layout the workspace has into an equivalent docking tree (`{ type: "tree", tree }`), so a user can start docking from any layout:

| Current layout | Resulting tree |
| --- | --- |
| `bsp` | the same splits (`treeFromBsp`), every ratio preserved |
| `columns` / `rows` | one `row` / `column` of the tiled windows, keeping stored `sizes[""]` if it matches the count |
| `master-stack` | a two-way `row` of master(s) and the stack (sides and `ratio` preserved); a single `column` when there are no more windows than `masterCount` |
| `tabs` / `monocle` | one `tabs` container |
| anything else (`spiral`, `grid`, `floating`, a function spec, custom types) | a flat `row` in the current tiled order |

A single window becomes a bare leaf and no windows becomes `null`. Modifiers and `drag` on the old spec are dropped.

- **Events:** `layout/changed { workspace, layout }`.
- **Effects:** `render`.
- **Rejections:** `unknown-workspace`.

### `layout/set-ratio`

```js
{ type: "layout/set-ratio", ratio, workspace?, id? }
```

Sets a ratio, clamped to `[0.05, 0.95]`. On a `bsp` workspace it sets the ratio of the split **directly containing** leaf `id` (default: the focused window); if that leaf has no split parent the tree is unchanged. On `master-stack` and `spiral` it sets `layout.ratio`. Any other layout (a function spec, `columns`, `rows`, `grid`, `tabs`, `monocle`, `floating`, `tree`, custom types) is rejected.

- **Events:** `layout/ratio-changed { workspace, ratio }` (the clamped ratio).
- **Effects:** `render`.
- **Rejections:** `unknown-workspace`, `not-resizable` (not `master-stack`, `spiral` or `bsp`), `invalid-ratio` (`ratio` is not a finite number; strings are not coerced).

### `layout/rotate-split`

```js
{ type: "layout/rotate-split", workspace?, id? }
```

BSP only. Flips the split directly containing leaf `id` (default: the focused window) between horizontal and vertical.

- **Events:** `layout/split-rotated { workspace }`.
- **Effects:** `render`.
- **Rejections:** `not-bsp` (also returned for an unknown workspace).

### `layout/resize-split`

```js
{ type: "layout/resize-split", workspace?, path?, index?, delta? , weights? }
```

Resizes a persistent split and stores it in the layout spec. `path` (default `""`) is layout-specific:

| Layout | `path` | Stored in | `weights` | `delta` |
| --- | --- | --- | --- | --- |
| `columns`, `rows` | `""` only | `spec.sizes[""]`, one weight per child | the whole array (≥ 2 entries) | nudges the pair at `index`/`index + 1`; **requires** stored sizes (`missing-weights` otherwise) |
| `master-stack` | `""` only | `spec.ratio` | `[a, b]` in visual order (mirrored for `side: "right"`) | nudges the ratio in the visual direction |
| `bsp` | `"0"`/`"1"` steps from the root (`""` = root split) | the node's `ratio` | `[a, b]` → `a / (a + b)` | nudges the node's ratio |
| `spiral` | the split depth as a string (`"0"` = outermost) | `spec.ratios[depth]` | `[a, b]` | nudges `ratios[depth]` (or the shared `ratio` when unset) |
| `tree` | comma-joined child indices (`"0,1"`; `""` = root) | that `row`/`column` container's `sizes` | exactly one weight per child | nudges the pair at `index`/`index + 1` (missing sizes count as equal weights) |

`index` defaults to `0`. Ratios are clamped to `[0.05, 0.95]`, and a nudged pair keeps at least 5% of its shared total on each side. Weights must be finite and positive. Exactly one of `delta` and `weights` is needed; if both are given, `weights` wins. For `columns`/`rows` the length of `weights` is not checked against the child count. A mismatched array is stored, but the layout ignores it and falls back to equal weights until the counts agree.

- **Events:** `layout/split-resized { workspace, path }`.
- **Effects:** `render`.
- **Rejections:** `unknown-workspace`, `not-resizable` (a function spec or a layout type not in the table, including `grid`, `tabs` and `monocle`), `invalid-weights` (fewer than 2, non-positive or non-finite; for `tree`, the wrong count), `missing-value` (neither a finite `delta` nor `weights`), `unknown-split` (a non-empty `path` on columns/rows/master-stack, a BSP path that does not reach a split, a tree path that does not reach a container or reaches a `tabs` container), `invalid-path` (a BSP path with characters other than `0`/`1`, a spiral path that is not a non-negative integer, a malformed tree path), `invalid-index` (negative for columns/rows; out of range for a tree `delta`), `missing-weights`.

`compile` renders a draggable splitter carrying exactly the `path`/`index` this command expects. See [compile › Splitters](./compile.md#splitters).

### `layout/toggle`

```js
{ type: "layout/toggle", a?, b?, workspace? }
```

xmonad `ToggleLayouts`. It flips a workspace between two layout specs. The current layout is compared to `a` **by `type` only** (functions by identity): if it matches, the workspace switches to `b`, otherwise to `a`. The pair is stored on the workspace as `toggleLayouts`, so later calls may omit `a`/`b`. `bsp` and `tree` targets are seeded like `layout/set`.

- **Events:** `layout/toggled { workspace, layout }`.
- **Effects:** `render`.
- **Rejections:** `unknown-workspace`, `invalid-layout` (no valid pair given or stored). The manager adds `unknown-layout` when `a` or `b` has an unknown type.

## Configuration and rules

### `config/set`

```js
{ type: "config/set", ...patch }
```

Shallow-patches `state.config` with every field of the command except `type`. A plain-object value merges one level deep into a plain-object existing value (`{ drag: { tiled: "swap" } }` keeps the other drag settings). Anything else replaces. Validation (all or nothing; any failure rejects the whole patch):

- `drag`: a plain object; `tiled` in `DRAG_MODES`; `tooSmall` in `"allow"`/`"reject"`; `edgeZone` a number in `[0, 0.5]`; `toFloating` in `"modifier"`/`"threshold"`/`"off"`; `toTiled` in `"modifier"`/`"always"`/`"off"`.
- `rules`: `validRules(rules)`.
- `urgency`: a plain object; `clearOnFocus` a boolean.
- `snap`: a plain object; `edges` a boolean; `threshold` and `magnet` numbers ≥ 0; `zones` in `"halves-quarters"`/`"halves"`/`"quarters"`/`"off"`.

- `gap`, `inset`: finite numbers ≥ 0. `focusRaises`: a boolean. `direction`: `"ltr"` or `"rtl"`. `bounds`: `"stage"` or `"none"`.
- `defaultPlacement`: a plain object with only `x`, `y` (finite number or `"center"`) and `width`, `height` (finite numbers ≥ 0).
- Any other key is rejected: `config` has a fixed set of keys (`focusRaises`, `gap`, `inset`, `defaultPlacement`, `drag`, `rules`, `urgency`, `snap`, `direction`, `bounds`).

- **Events:** `config/changed { patch }` (the patch as given, without `type`).
- **Effects:** `render`.
- **Rejections:** `invalid-config`.

### `rules/set`

```js
{ type: "rules/set", rules }
```

Replaces `config.rules` wholesale (it is shorthand for `config/set { rules }`). Rules apply to windows created afterwards, not to existing ones. See [Queries › Rules](./queries.md#rules) for the rule shape.

- **Events:** `rules/changed { rules }`.
- **Effects:** `render`.
- **Rejections:** `invalid-rules`.

## Custom commands

Add or override handlers per call:

```js
const handlers = {
  "window/center"(state, { id }) {
    const win = state.windows[id];
    if (!win) return { state, events: [{ type: "command/rejected", command: "window/center", id, reason: "unknown-window" }] };
    const placement = { ...win.placement, x: "center", y: "center" };
    const next = { ...state, windows: { ...state.windows, [id]: { ...win, placement } } };
    return { state: next, events: [{ type: "window/moved", id, placement }], effects: [{ type: "render" }] };
  },
};
update(state, { type: "window/center", id: "calc" }, handlers);
createWindowManager({ extensions: handlers }); // or once, for every dispatch
```

A handler must stay pure: return a new state, never mutate the input, and return the same reference for a no-op. An extension can override a built-in (`"window/close": myClose`); `COMMANDS` still lists only the built-ins. To change what `window/drop` means for a layout, don't override the command. Register a drop interpreter instead (see [Drag and drop](./drops.md)).
