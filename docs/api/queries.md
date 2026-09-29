# Queries

[API reference](./README.md) › Queries

Read-only, pure functions over a state. They never mutate their input. Every query that is "per output" defaults to `state.focusedOutput`, so single-output code never passes an output. Sources: `src/state/queries.mjs`, `src/state/rules.mjs`, `src/state/derive.mjs` (`presentationContext`).

## Contents

- [Lookup](#lookup)
- [Outputs](#outputs)
- [Visibility and focus](#visibility-and-focus)
- [The window graph](#the-window-graph)
- [Stacking and painting](#stacking-and-painting)
- [Status sets](#status-sets)
- [Rules](#rules)
- [presentationContext](#presentationcontextstate)

## Lookup

| Query | Returns |
| --- | --- |
| `getWindow(state, id)` | The window record, or `undefined`. |
| `activeWorkspace(state)` | The active workspace **record** of the focused output (not its id; the id is `state.activeWorkspace`). |
| `focusedWindow(state)` | The focused window record, or `undefined`. |
| `windowsIn(state, workspaceId = state.activeWorkspace)` | That workspace's window records in workspace order, including invisible ones (minimized, children of hidden parents). |

## Outputs

| Query | Returns |
| --- | --- |
| `focusedOutput(state)` | The focused output **record** (the id is `state.focusedOutput`). |
| `outputsList(state)` | Every output record, in `outputOrder`. |
| `outputActiveWorkspace(state, outputId = state.focusedOutput)` | The **id** of that output's active workspace. |
| `outputOf(state, workspaceId)` | The id of the output a workspace belongs to. |
| `workspacesOf(state, outputId)` | That output's workspace records, in the output's order. |

## Visibility and focus

| Query | Returns |
| --- | --- |
| `isVisible(state, id)` | `true` when the window exists; its status is not `"minimized"` or `"popped-out"`; it is not a hidden scratchpad window (`workspace: null`); its workspace is the active workspace **of that workspace's own output** (or the window is sticky); and its parent, if any, is visible (recursively). Which output has focus does not matter. |
| `visibleWindows(state, outputId = state.focusedOutput)` | Visible window records on that output: its active workspace's windows in workspace order, then sticky windows living on other workspaces of the same output. |
| `focusable(state, outputId = state.focusedOutput)` | Ids of `visibleWindows` that are not blocked by a modal, in the same order. `focus/next` cycles these. |
| `isPoppedOut(state, id)` | `status === "popped-out"`. |
| `isScratchpadHidden(state, id)` | A scratchpad window that is currently hidden (`scratchpad: true` and `workspace: null`). |

## The window graph

| Query | Returns |
| --- | --- |
| `childrenOf(state, id)` | Direct children (records whose `parent === id`). |
| `descendantsOf(state, id)` | Ids of every descendant, in pre-order (child, its descendants, next child, …). |
| `modalTarget(state, id)` | The deepest open modal descendant reached by following modal children (not minimized, not popped out), or `id` itself when there is none. This is where focus goes when `id` is focused. |
| `isBlocked(state, id)` | `modalTarget(state, id) !== id`: an open modal descendant blocks input to this window. |
| `blockedWindows(state)` | Ids of every blocked window. |

## Stacking and painting

| Query | Returns |
| --- | --- |
| `stackingOrder(state)` | Every window id, bottom to top, across all layers and workspaces: the **logical** stack (`LAYERS` order, then `state.stack[layer]` order). |
| `paintOrder(state, outputId = state.focusedOutput)` | The **visual** order of the output's visible windows, bottom to top, exactly as `derive` paints them: background-layer windows, then the tiled base (in workspace order), then every other visible window by stacking order. If a visible window is fullscreen, just `[thatId]`. |
| `inTiledBase(state, win)` | Takes a window **record**. It is `true` when the window is laid out by the workspace layout: `role: "window"`, `mode: "tiled"`, not sticky, not maximized, and the workspace layout is not `floating`. Tiled windows paint above the background layer and beneath everything else, whatever their position in `state.stack`. |

## Status sets

| Query | Returns |
| --- | --- |
| `poppedOutWindows(state)` | Popped-out window records. |
| `scratchpadWindows(state)` | Every scratchpad window record, shown **or** hidden. |
| `stickyWindows(state)` | Sticky window records. |
| `urgentWindows(state)` | Urgent ids that still exist, oldest first. |

## Rules

Declarative window rules, in the spirit of xmonad `ManageHooks`, i3 `for_window` and EWMH window types. `config.rules` is an ordered array of `{ match?, set? }`. The rules are applied by [`window/create`](./commands.md#windowcreate) and replaced by [`rules/set`](./commands.md#rulesset) or `config/set { rules }`.

```js
[
  { match: { role: "dialog" }, set: { layer: "modal" } },
  { match: { idPrefix: "term-" }, set: { layer: "top", mode: "floating" } },
  { match: { titleRegex: "^Log " }, set: { status: "minimized" } },
  { set: { constraints: { minWidth: 200 } } },          // no match: applies to every window
]
```

**`match`** (every present field must agree; absent or empty matches everything):

| Field | Matches when |
| --- | --- |
| `role` | `win.role === role` (must be one of `ROLES`) |
| `id` | `win.id === id` |
| `idPrefix` | `win.id` starts with it |
| `title` | `win.title === title` |
| `titleRegex` | `new RegExp(titleRegex).test(win.title)`. It is a regex **source string**, compiled on every check so rules stay JSON-serializable. |
| `app` | `win.app === app` |
| `parent` | `win.parent === parent` |

String fields must be strings. `titleRegex` must compile.

**`set`**: the fields a rule may fill in, the same ones a create command can set:

| Field | Constraint |
| --- | --- |
| `mode` | `"tiled"` or `"floating"` |
| `layer` | one of `LAYERS` |
| `workspace` | a string. An unknown workspace makes the `window/create` itself reject (`unknown-workspace`). |
| `placement` | plain object, merged one level deep |
| `status` | one of `STATUSES` |
| `draggable` | boolean (`false` pins; `true` clears a pin) |
| `constraints` | plain object, merged one level deep; the placement is re-clamped |
| `anchor` | plain object or `null` |

A rule with any other top-level key, or unknown `match`/`set` keys, is invalid.

| Export | Description |
| --- | --- |
| `matchRules(state, win)` | Indices of `state.config.rules` whose `match` accepts `win` (a record or any window-shaped object), in rule order. Applies nothing, and never throws: an uncompilable `titleRegex` simply fails to match. |
| `validRules(rules)` | `true` when `rules` is an array of well-formed rules. |
| `MATCH_FIELDS` | `["role", "id", "idPrefix", "title", "titleRegex", "app", "parent"]` |
| `SET_FIELDS` | `["mode", "layer", "workspace", "placement", "status", "draggable", "constraints", "anchor"]` |

Precedence at `window/create`: the role defaults come first, then the matched rules in order (a later rule wins field by field), then the command's own explicitly set fields, which always win.

## `presentationContext(state)`

The non-layout facts `compile` needs, as a plain object:

| Field | Contents | Used by `compile` for |
| --- | --- | --- |
| `focused` | `state.focus.window` | `data-focused` |
| `blocked` | ids blocked by a modal | `data-wm-blocked`, `aria-disabled` |
| `titles` | `{ id: title }` | `aria-label`, tab text |
| `modes` | `{ id: mode }` | `data-mode` |
| `roles` | `{ id: role }` | `data-role`, ARIA role |
| `pinned` | ids with `draggable: false` | `data-wm-draggable="false"` |
| `sticky` | sticky ids | `data-wm-sticky` |
| `scratchpad` | scratchpad ids | not used by `compile`; available to custom renderers |
| `urgent` | `urgentWindows(state)` | `data-wm-urgent` on views and tab buttons |
| `modal` | ids with `modal: true` | `aria-modal="true"` on dialogs |
