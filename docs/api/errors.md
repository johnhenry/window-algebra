# Errors

[API reference](./README.md) › Errors

The library draws one line. **Runtime input is rejected with a value; programmer errors throw.** Commands, saved state, drops and popup blockers are runtime input: they can be wrong at any moment in a running app, so they come back as events or result objects and never as exceptions. Constructing an invalid layout node, or registering a layout interpreter that returns garbage, is a bug in code, so it throws immediately with a message saying what was expected.

## Contents

- [Rejected, not thrown](#rejected-not-thrown)
- [Every rejection reason](#every-rejection-reason)
- [What throws](#what-throws)

## Rejected, not thrown

| Where | Shape |
| --- | --- |
| `update` / `wm.dispatch` / `wm.simulate` | `{ state: <unchanged>, events: [{ type: "command/rejected", command, id, reason }], effects: [] }` |
| `wm.load` | returns `null`; subscribers get `state/load-rejected { reason, version? }` |
| `migrate` | `{ ok: false, state: null, reason, version? }` |
| `validate` (layout trees) | `{ ok: false, errors: [{ path, message }] }` |
| `previewDrop`, `dropTargetAt` | `null` |
| `attachPopouts().popOut` | a `command/rejected` result (`popup-blocked`, `unknown-window`, `blocked`), with state and DOM untouched |
| `matchRules` | an uncompilable `titleRegex` simply doesn't match |

## Every rejection reason

| Reason | Commands (or source) |
| --- | --- |
| `invalid-command` | `update`: a non-object command, or one without a string `type` |
| `unknown-command` | `update`: no handler for `type` |
| `missing-id` | `window/create`, `workspace/create`, `output/create` |
| `duplicate-id` | `window/create`, `workspace/create`, `output/create` |
| `unknown-parent` | `window/create` |
| `unknown-window` | nearly every `window/*` command; `scratchpad/toggle`; `focus` subjects of `swap-next`/`move-before`/…; `attachPopouts` |
| `unknown-workspace` | `window/create` (after rules), `window/move-to-workspace`, `workspace/activate`, `workspace/remove`, `workspace/move-to-output`, every `layout/*` command except `rotate-split` |
| `unknown-output` | `workspace/create`, `workspace/move-to-output`, `output/remove`, `output/focus` |
| `unknown-layer` | `window/set-layer` |
| `unknown-mode` | `window/set-mode` |
| `unknown-status` | the status setters (internal guard; not reachable through the built-in commands) |
| `unknown-zone` | `window/drop`: not a `DROP_ZONES` value, or the interpreter maps it to no op |
| `unknown-split` | `layout/resize-split` |
| `unknown-layout` | the manager: `layout/set`, `workspace/create`, `layout/toggle` with a type no interpreter knows |
| `invalid-layout` | `layout/set`, `layout/toggle` |
| `invalid-ratio` | `layout/set-ratio` |
| `invalid-path` | `layout/resize-split` |
| `invalid-index` | `layout/resize-split` |
| `invalid-weights` | `layout/resize-split` |
| `missing-value` | `layout/resize-split` |
| `missing-weights` | `layout/resize-split` (a `delta` on columns/rows before any sizes are stored) |
| `not-resizable` | `layout/resize-split` |
| `not-bsp` | `layout/rotate-split` |
| `invalid-config` | `config/set` |
| `invalid-rules` | `rules/set` |
| `invalid-urgent` | `window/set-urgent` |
| `invalid-sticky` | `window/set-sticky` |
| `no-urgent-window` | `focus/urgent` |
| `empty-scratchpad` | `scratchpad/toggle` |
| `not-scratchpad` | `scratchpad/toggle` |
| `not-popped-out` | `window/pop-in` |
| `not-on-workspace` | `window/promote` (a window hidden in the scratchpad) |
| `popup-blocked` | `attachPopouts().popOut` |
| `last-workspace` | `workspace/remove` |
| `last-workspace-on-output` | `workspace/remove`, `workspace/move-to-output` |
| `last-output` | `output/remove` |
| `missing-workspaces` | `output/create` |
| `different-workspaces` | `window/swap`, `window/drop`, `window/move-before`/`after` |
| `same-window` | `window/drop`, `window/move-before`/`after` |
| `not-tiled` | `window/drop`, `window/detach`, `window/swap-next`/`previous`, `window/move-before`/`after` |
| `not-draggable` | `window/drop`, `window/detach` |
| `drag-disabled` | `window/drop` (drag mode `off`), `window/detach` (`toFloating: "off"`) |
| `zone-disabled` | `window/drop` |
| `too-small` | `window/drop` (`tooSmall: "reject"` with `geometry`) |
| `blocked` | `window/drop`, `window/detach`, `window/pop-out` |
| `invalid-json`, `invalid-state`, `future-version`, `no-migration-path` | `wm.load` (`state/load-rejected`) and `migrate` (except `invalid-json`) |

## What throws

| Function | Throws | When |
| --- | --- | --- |
| `view` | `TypeError` | the id is not a non-empty string |
| `row`, `column`, `grid`, `stack`, `overlay`, `container` | `TypeError` | options are not a plain object (including "a node where options were expected": you forgot the options argument), a child is not a node, or the kind is unknown |
| `place`, `size`, `gap`, `inset`, `anchor`, `modifier` | `TypeError` | the same checks; `anchor` also requires a string `options.to` |
| `fromJSON` | `TypeError`, `SyntaxError` | an invalid tree (all errors listed), or invalid JSON text |
| `transform` (and every transform built on it) | `TypeError` | the input is not a node |
| `derive` / `wm.present` / a render | `TypeError` | no interpreter for the workspace's layout type, or an interpreter that returned a non-node. The manager rejects unknown types up front to prevent this. |
| `createState` | `TypeError` | `workspaces` is empty |
| `createResize` | `TypeError` | an unknown edge |
| `defineWindowAlgebraElement` | `Error` | no `customElements`/`HTMLElement` available and none passed in |
| an extension handler | whatever it throws | `update` does not catch exceptions from your handlers; keep them pure and total |

A built-in command handler that throws is a bug. The test suite asserts rejections for malformed input command by command, and explicitly asserts "never throws and never mutates state" (on deep-frozen state) for `layout/resize-split` and the docking-tree commands (`test/update.test.mjs`, `test/tree.test.mjs`).
