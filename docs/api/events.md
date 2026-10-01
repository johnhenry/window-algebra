# Events and effects

[API reference](./README.md) › Events and effects

**Events** record what actually happened. They are returned from `update` (and `wm.dispatch`) and passed to every `wm.subscribe` listener. **Effects** are values that describe work for the effectful shell. The manager runs `render` itself and hands every other effect to `onEffect`.

## Effects

| Effect | Meaning | Who handles it |
| --- | --- | --- |
| `{ type: "render" }` | The presentation may have changed. | The manager schedules `renderer.commit(present().render)` for its renderer(s). |
| `{ type: "focus", id }` | Keyboard/DOM focus should move to window `id`, or leave the stage when `id` is `null`. | The manager passes it to `onEffect(effect, wm)`. `attachInput({ subscribe })` performs the equivalent DOM focus move itself from the `window/focused` event, so most apps can ignore it. |

`update` de-duplicates effects by `type`, keeping the last one of each type.

## Event catalogue

The table lists every event type (47), grouped by subject. "Emitted by" names commands; *focus policy* and *refocus* are the shared steps described in [Commands › Shared behaviour](./commands.md#shared-behaviour), and can follow many commands.

### Rejections

| Event | Fields | Emitted by |
| --- | --- | --- |
| `command/rejected` | `command` (the command type), `id` (the command's `id`, possibly `undefined`), `reason` | any refused command; `update` for `invalid-command`/`unknown-command`; the manager for `unknown-layout`; `attachPopouts` for `popup-blocked` and its own `unknown-window` |

### Windows

| Event | Fields | Emitted by |
| --- | --- | --- |
| `window/created` | `id`, `rules?` (matched rule indices; present only if any matched) | `window/create` |
| `window/closed` | `id` | `window/close`, once per removed window, descendants first |
| `window/focused` | `id`, `previous` (id or `null`) | the focus policy, when the focused window changes |
| `focus/redirected` | `requested`, `id` (the modal that received focus instead) | the focus policy, when modal redirection applies |
| `window/blurred` | `id` | `window/blur`; refocus and `output/focus` when nothing is left to focus |
| `window/restored` | `id` | the focus policy, when focusing a minimized window |
| `window/raised` | `id` | `window/raise` |
| `window/lowered` | `id` | `window/lower` |
| `window/layer-changed` | `id`, `layer` | `window/set-layer` |
| `window/moved` | `id`, `placement` | `window/move` |
| `window/resized` | `id`, `placement` (after constraints) | `window/resize` |
| `window/mode-changed` | `id`, `mode` | `window/set-mode`, `window/toggle-floating` |
| `window/detached` | `id`, `placement` | `window/detach` |
| `window/status-changed` | `id`, `status`, `previous` | `window/minimize`, `window/maximize`, `window/fullscreen`, `window/restore`, `window/toggle-maximize`, `window/toggle-fullscreen`, `window/pop-out`, `window/pop-in`; also once per other fullscreen window that `window/fullscreen` restores, and for the fullscreen window an explicit focus elsewhere ends |
| `window/retitled` | `id`, `title` (as given in the command) | `window/set-title` |
| `window/constrained` | `id`, `constraints` (merged) | `window/set-constraints` |
| `window/swapped` | `id`, `target` | `window/swap`, `window/promote`, `window/swap-next`, `window/swap-previous` |
| `window/dropped` | `id`, `target`, `zone`, `op`, `workspace`, `tiled?` (`true` when a floating window joined the layout) | `window/drop` |
| `window/reordered` | `id`, `target`, `position` (`"before"`/`"after"`) | `window/move-before`, `window/move-after` |
| `window/draggable-changed` | `id`, `draggable` | `window/set-draggable` |
| `window/sticky-changed` | `id`, `sticky` | `window/set-sticky`, `window/toggle-sticky` |
| `window/urgent-changed` | `id`, `urgent` | `window/set-urgent`; the focus policy (`urgent: false`) when clearing on focus |
| `window/workspace-changed` | `id`, `workspace` | `window/move-to-workspace` (not emitted for the silent moves inside `workspace/remove`) |

### Scratchpad

| Event | Fields | Emitted by |
| --- | --- | --- |
| `scratchpad/shown` | `id` | `scratchpad/toggle` (showing) |
| `scratchpad/hidden` | `id` | `window/to-scratchpad`, `scratchpad/toggle` (hiding) |
| `scratchpad/removed` | `id` | `window/from-scratchpad` |

### Workspaces and outputs

| Event | Fields | Emitted by |
| --- | --- | --- |
| `workspace/created` | `id`, `output` | `workspace/create` |
| `workspace/activated` | `id`, `previous` | `workspace/activate`; the focus policy when focusing a window on another workspace |
| `workspace/removed` | `id`, `fallback` | `workspace/remove` |
| `workspace/renamed` | `id`, `to` | `workspace/rename` |
| `workspace/reordered` | `id`, `index` | `workspace/reorder` |
| `workspace/moved-to-output` | `id`, `output`, `from` | `workspace/move-to-output` |
| `output/created` | `id`, `workspaces` | `output/create` |
| `output/removed` | `id`, `fallback`, `workspaces` (moved ids) | `output/remove` |
| `output/reordered` | `id`, `index` | `output/reorder` |
| `output/focused` | `id`, `previous` | `output/focus`; `workspace/activate`; the focus policy and `focus/next`/`focus/previous` when crossing outputs |

### Layout and configuration

| Event | Fields | Emitted by |
| --- | --- | --- |
| `layout/changed` | `workspace`, `layout` | `layout/set`, `layout/to-tree` |
| `layout/ratio-changed` | `workspace`, `ratio` | `layout/set-ratio` |
| `layout/split-rotated` | `workspace` | `layout/rotate-split` |
| `layout/split-resized` | `workspace`, `path` | `layout/resize-split` |
| `layout/toggled` | `workspace`, `layout` | `layout/toggle` |
| `config/changed` | `patch` | `config/set` |
| `rules/changed` | `rules` | `rules/set` |

### Manager-only events

These never come from `update`. The manager sends them to subscribers with `command` set to `null`:

| Event | Fields | Emitted by |
| --- | --- | --- |
| `history/changed` | none | `wm.undo()` / `wm.redo()`, when the state actually changed. Followed by the `window/focused` / `window/blurred` event (and a `focus` effect to `onEffect`) when the restored state has a different focus |
| `state/loaded` | none | `wm.load()` on success (and the same focus events as above) |
| `state/load-rejected` | `reason` (`"invalid-json"`, `"invalid-state"`, `"future-version"`, `"no-migration-path"`), `version?` | `wm.load()` on failure; the state is left untouched |

## Ordering

Events are in causal order. Some typical sequences:

- **Creating a window on the active workspace:** `window/created`, then `window/focused`.
- **Focusing a window on another output's inactive workspace behind a modal:** `output/focused`, `workspace/activated`, `focus/redirected`, `window/focused`.
- **Closing a focused parent with a dialog:** `window/closed` (dialog), `window/closed` (parent), then `window/focused` for the next window from history, or `window/blurred`.
- **A floating drag on the manager:** many `window/moved`, one per `pointermove`, all sharing the command's `gesture` token. Subscribers see each event, but history and the log record one step.

A subscriber receives `(state, events, command)`. `command` is the dispatched command, or `null` for the manager-only events.
