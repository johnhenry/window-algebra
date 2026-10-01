# The manager

[API reference](./README.md) › The manager

`createWindowManager` is the imperative facade, `wm.focus("editor")`, over the pure core. It is a coordinator, not a god object. It holds the current state, runs `update`, keeps optional undo history and a command log, notifies subscribers, and hands the derived presentation to one or more renderers on a schedule. It runs anywhere: with no renderer it is a headless state machine. Source: `src/manager.mjs`.

## Contents

- [Options](#options)
- [State access and dispatch](#state-access-and-dispatch)
- [Rendering and outputs](#rendering-and-outputs)
- [Convenience methods](#convenience-methods)
- [History, log and replay](#history-log-and-replay)
- [Gestures](#gestures)
- [Serialize and load](#serialize-and-load)
- [Rejections the manager adds](#rejections-the-manager-adds)

## Options

```js
createWindowManager({
  state,       // initial state (default: createState())
  layouts,     // extra/override layout interpreters, used by derive and by the unknown-layout check
  modifiers,   // extra/override layout modifiers for derive
  extensions,  // extra/override command handlers for update
  drops,       // extra/override drop interpreters, keyed by layout type
  renderer,    // { commit(renderTree, opts?), measure?() }: renders the FOCUSED output
  renderers,   // { [outputId]: renderer }: one renderer per output
  schedule,    // (task) => void, default immediateScheduler; createFrameScheduler() coalesces per frame
  history,     // false (default) | true (limit 100) | number (limit)
  onEffect,    // (effect, wm) => void, for every non-render effect (i.e. { type: "focus", id })
} = {}) → wm
```

When `drops` is given, the drag-and-drop command handlers (`window/drop`, `swap-next`, `swap-previous`, `move-before`, `move-after`, `set-draggable`) are rebuilt over `{ ...DROPS, ...drops }`. Your own `extensions` still take precedence over them.

## State access and dispatch

| Member | Description |
| --- | --- |
| `getState()` / `state` (getter) | The current state. |
| `dispatch(command)` | Runs the command through `simulate` (so manager-level rejections apply), commits the new state if it changed, records history and the log, runs effects (`render` → the renderers; anything else → `onEffect`), notifies subscribers, and returns `{ state, events, effects }`. |
| `simulate(command, state = getState())` | A dry run: the same result `dispatch` would return, with no history, render, log or notification. The drag preview uses it so custom extensions and drops apply. |
| `subscribe(listener)` | `listener(state, events, command)` after every dispatch, and after undo, redo and load (with `command` = `null`). It is called even when a command was rejected (the rejection is in `events`). Returns an unsubscribe function. |
| `extensions` | The command handlers passed to `update`: your `extensions`, plus the rebuilt drop handlers when `drops` was given. |
| `drops` | The drop-interpreter registry in effect (`DROPS` plus `drops`). |

## Rendering and outputs

| Member | Description |
| --- | --- |
| `present(state = getState(), { output }?)` | `{ tree, render }`: `derive` (with the manager's `layouts`/`modifiers`) and `compile` (with `presentationContext`) for an output (default: the focused one). |
| `render(command?)` | Schedules a commit on every renderer: `renderer` gets the focused output's tree, and each `renderers[outputId]` gets its own output's tree. The commit options are `{ immediate: true }` when `command` carries a `gesture` token or `immediate: true`, so a drag never animates. |
| `setRenderer(outputId, renderer?)` | Attaches or replaces the renderer for one output, then renders. Passing no renderer detaches it. |
| `measure()` | The single `renderer`'s `measure()`, or `{}`. |
| `measureOutput(outputId)` | That output's renderer's `measure()`, or `{}`. |

To drive several stages, give each output its own renderer **and** its own input adapter bound to that output:

```js
wm.setRenderer("hdmi", createDomRenderer({ root: right }));
attachInput({ root: right, wm, output: "hdmi", present: (s) => wm.present(s, { output: "hdmi" }) });
```

## Convenience methods

Each is a thin `dispatch` of one command, and returns what `dispatch` returns.

| Method | Command |
| --- | --- |
| `create(options)` | `window/create` (`options` is the payload) |
| `close(id, rest?)` | `window/close` |
| `focus(id, rest?)` | `window/focus` |
| `blur()` | `window/blur` |
| `focusNext()`, `focusPrevious()` | `focus/next`, `focus/previous` |
| `focusUrgent()` | `focus/urgent` |
| `raise(id, rest?)`, `lower(id, rest?)` | `window/raise`, `window/lower` |
| `move(id, x, y)` | `window/move` |
| `resize(id, width, height)` | `window/resize` |
| `setMode(id, mode)` | `window/set-mode` |
| `toggleFloating(id, rest?)` | `window/toggle-floating` |
| `minimize(id)`, `maximize(id)`, `fullscreen(id)`, `restore(id)` | status commands |
| `toggleMaximize(id)`, `toggleFullscreen(id)` | `window/toggle-maximize`, `window/toggle-fullscreen` |
| `popOut(id)`, `popIn(id)` | `window/pop-out`, `window/pop-in` (state only; use [`attachPopouts`](./browser.md#attachpopouts) for the real popup) |
| `promote(id, rest?)` | `window/promote` |
| `swap(id, target)` | `window/swap` |
| `drop(id, target, zone, rest?)` | `window/drop` (`rest` may carry `geometry`, `gesture`) |
| `swapNext(id)`, `swapPrevious(id)` | `window/swap-next`, `window/swap-previous` |
| `moveBefore(id, target?)`, `moveAfter(id, target?)` | `window/move-before`, `window/move-after` |
| `setDraggable(id, draggable)` | `window/set-draggable` |
| `setUrgent(id, urgent = true)` | `window/set-urgent` |
| `moveToWorkspace(id, workspace)` | `window/move-to-workspace` (dispatch it yourself for `follow: true`) |
| `toScratchpad(id)` | `window/to-scratchpad` |
| `toggleScratchpad(id?)` | `scratchpad/toggle` |
| `setSticky(id, sticky = true)` | `window/set-sticky` |
| `toggleSticky(id)` | `window/toggle-sticky` |
| `createWorkspace(id, options?)` | `workspace/create` (`options`: `layout`, `output`, `activate`) |
| `activateWorkspace(id)` | `workspace/activate` |
| `createOutput(id, options?)` | `output/create` (`options`: `workspaces`, `focus`) |
| `removeOutput(id, options?)` | `output/remove` (`options`: `fallback`) |
| `focusOutput(id)` | `output/focus` |
| `moveWorkspaceToOutput(id, output, options?)` | `workspace/move-to-output` (`options`: `activate`) |
| `setLayout(layout, workspace?)` | `layout/set` |
| `setRatio(ratio, options?)` | `layout/set-ratio` (`options`: `workspace`, `id`) |
| `resizeSplit(path, { delta } \| { weights }, options?)` | `layout/resize-split` (`options`: `workspace`, `index`) |
| `toggleLayout(a?, b?, workspace?)` | `layout/toggle` |
| `setRules(rules)` | `rules/set` |

There is no convenience method for `window/set-layer`, `window/set-title`, `window/set-constraints`, `window/detach`, `workspace/remove`, `workspace/rename`, `workspace/reorder`, `output/reorder`, `window/from-scratchpad`, `layout/to-tree`, `layout/rotate-split` or `config/set`. Use `dispatch`.

## History, log and replay

| Member | Description |
| --- | --- |
| `undo()`, `redo()` | Step through history (requires the `history` option) and return the new state. When the state changes they render and notify `history/changed`, followed by `window/focused`/`window/blurred` (and a `focus` effect) if the restored state has a different focused window, so keyboard focus follows. |
| `canUndo`, `canRedo` (getters) | Whether a step is available. |
| `log` (getter) | The commands applied since `origin`, excluding undone ones. A gesture contributes its coalesced commands. |
| `origin` (getter) | The state `log` replays from: the initial state, or the last successfully `load()`ed one. |

The invariant: `replay(wm.origin, wm.log)` deep-equals `wm.getState()`, through undo, redo, gestures and loads. Without the `history` option there is no undo, but the log is still kept.

Only commands that change state are recorded: a rejected or no-op command leaves history and the log alone. History entries are whole states (`createHistory`/`record`/`undo`/`redo` are also exported for use with any reducer; see below). The default limit is 100 steps.

### History helpers (exported)

| Export | Description |
| --- | --- |
| `createHistory(present, { limit = 100 }?)` | `{ past: [], present, future: [], limit }` |
| `record(history, nextPresent)` | Pushes a new present and clears the future. It is a no-op (same history) when `nextPresent === history.present`. The oldest entry is dropped past `limit`. |
| `undo(history)`, `redo(history)` | Move one step. They return the same history when a step is unavailable. |
| `canUndo(history)`, `canRedo(history)` | Booleans. |

## Gestures

Commands that carry the same `gesture` token **consecutively** form **one history step and one log entry**. The input adapter tags every `window/move`/`window/resize` of a floating drag, every `layout/resize-split` of a splitter drag, and a floating window's final drop/snap/workspace move with the drag's token. Within a gesture, runs of **absolute** setters on the same window collapse to their last command: `window/move` with both `x` and `y`, or `window/resize` with `x`, `y`, `width` and `height`. So a whole drag logs as one command, and a replay still lands exactly. Any other command in the gesture is kept.

A token is only extended while nothing has been undone since. A gesture command dispatched right after an undo starts a new entry.

## Serialize and load

| Member | Description |
| --- | --- |
| `serialize()` | `JSON.stringify(getState())`. It includes `version`. A function layout spec does not survive. |
| `load(stateOrJSON)` | Accepts a state object or a JSON string. It parses and [migrates](./versioning.md) it, then installs it as the new present (recorded as an undo step when history is on), starts a new `origin`, renders, notifies `state/loaded`, and returns the loaded state. On failure it notifies `state/load-rejected { reason, version? }` (`invalid-json`, `invalid-state`, `future-version`, `no-migration-path`), leaves the current state untouched and returns `null`. It never throws. |

## Rejections the manager adds

`update` cannot see the interpreter registry, so the manager refuses a layout type no interpreter knows (anything not in `LAYOUTS` or the `layouts` option). Otherwise every later render would throw in `derive`:

| Command | Checked field | Reason |
| --- | --- | --- |
| `layout/set` | `layout` | `unknown-layout` |
| `workspace/create` | `layout` | `unknown-layout` |
| `layout/toggle` | `a`, `b` | `unknown-layout` |

A function spec is never "unknown". The check also runs in `simulate`.
