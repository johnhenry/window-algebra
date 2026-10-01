# Cross-tab sync

[API reference](./README.md) › Cross-tab sync

`attachSync` keeps the window managers of several tabs of one origin in step over a [`BroadcastChannel`](https://developer.mozilla.org/docs/Web/API/BroadcastChannel). It is opt-in: nothing syncs unless you call it. Exported from `@johnhenry/window-algebra/browser`; source `src/browser/sync.mjs`. `attachStage` (and so `<wa-stage>`) accepts a `sync` option as shorthand.

## Design decisions

| Question | Choice | Why |
| --- | --- | --- |
| Share commands or state? | **State snapshots** (the whole logical state, after every local change). | Commands would need every tab to apply the same commands in the same order from the same origin. A tab that opened late, missed a message, or lacks an extension handler would diverge for good. A snapshot is self-healing, lets a late joiner catch up from one message, and is already versioned and migratable (`wm.load`). State is small plain JSON, so the cost is one structured clone per change. |
| Conflict policy | **Last writer wins, ordered by a Lamport clock**, ties broken by tab id. | No leader election, no coordination, no tab is special, and every tab picks the same winner. |
| Echo loops | A snapshot applied from a peer is never re-broadcast, and one is only applied when it is strictly newer than the newest this tab sent or applied. | |
| Undo and redo | Ordinary local changes: they are broadcast like any other. | See below. |
| Pop-outs | **Per tab**: a popped-out window is a real browser window owned by the tab that opened it. | See below. |

### The clock

Every message carries `(clock, from)`. A tab raises its clock to the highest clock it has seen before it sends, so a change made *after observing* another change always wins. Two **concurrent** changes (each made before the tab saw the other) have the same clock, and the larger tab id wins, in every tab. The loser's concurrent change is discarded whole; snapshots are not merged. If that is too coarse for your app, serialize edits through one tab or use the command log (`wm.log`) with your own transport.

### Late joiners

A new tab announces itself (`hello`). A tab that has ever sent or applied a change answers with its current snapshot, which the newcomer applies (it is newer than the newcomer's clock 0). Two tabs that have never changed anything share nothing: seed them identically.

### Undo and redo

`wm.undo()` and `wm.redo()` change state, so the result is broadcast: undo in tab A removes the window in tab B too. A snapshot applied from a peer is recorded as a history step in the receiving tab (it goes through `wm.load`), so undo in a tab that just received a peer's change steps back over that change, and that revert propagates. In other words, each tab's history is the sequence of states that tab observed. `wm.log` starts a new origin at every applied snapshot (as for any `load`).

### Pop-outs

A popped-out window lives in the tab that opened it. On the wire it is `minimized`, so other tabs show it hidden and never open a popup (they could not: popups need a user gesture). An incoming snapshot never pops a locally popped-out window back in or closes its popup, unless the peer closed the window or restored it (`window/restore`), in which case the popup closes here. The `toSnapshot`/`fromSnapshot` helpers implement this.

### Focus and effects

Focus travels with the state, so focusing a window in one tab focuses it in the others (an applied snapshot reports `window/focused` and a `focus` effect, like `load`). Surfaces, DOM and `onEffect` handlers are local: only logical state is shared, so give each tab a `surfaceFor` that can build a window's content from its id.

## `attachSync(options)`

```js
import { attachSync } from "@johnhenry/window-algebra/browser";

const sync = attachSync({ wm, channel: "my-app" });
```

| Option | Description |
| --- | --- |
| `wm` | Required. The window manager to keep in sync. |
| `channel` | A `BroadcastChannel` (or any object with `postMessage` and `addEventListener("message")`/`onmessage`), or a channel name (default `"window-algebra"`; the channel is then created and closed by `attachSync`). |
| `id` | This tab's id (default a random UUID); also the clock tie-break. |
| `schedule` | How a **gesture** (a drag's stream of `window/move`) is coalesced before broadcasting; default `createFrameScheduler()`, one snapshot per frame. Every other command is broadcast synchronously. |
| `onSync({ direction, clock, from, applied })` | Called for every snapshot sent (`"out"`) or received (`"in"`; `applied` is false when it lost). |
| `onError(error)` | A snapshot that could not be posted (for example state holding something uncloneable) or applied. The local change still happened. |

Returns `{ id, clock, peers(), flush(), detach() }`: `peers()` lists the tab ids heard from since attach (and not yet `bye`); `flush()` sends a pending gesture snapshot now; `detach()` flushes, announces `bye`, stops listening and closes a channel it created.

`toSnapshot(state)` and `fromSnapshot(snapshot, localState)` are the (pure) wire transforms: popped-out windows become `minimized`, and a function layout spec (which cannot be cloned) becomes `null` and is restored from the receiving tab's own state, or `{ type: "columns" }` if it has none.

## What it does not do

- It is **same-origin, same-browser** only (`BroadcastChannel`). It is not collaboration between users, and there is no persistence: a tab that opens when no other is open starts from its own state.
- It does not merge concurrent edits; the loser's change is dropped.
- It does not sync surfaces, DOM, scroll positions or per-tab effects.
- A state from a newer `STATE_VERSION` is refused by `wm.load` (`state/load-rejected`, reason `future-version`) and ignored.
- Snapshots are whole states. A very large state (thousands of windows) costs a clone per change; for a drag, `schedule` limits that to one per frame.
