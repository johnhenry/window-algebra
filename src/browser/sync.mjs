/**
 * Cross-tab sync over `BroadcastChannel`. Opt-in: nothing here runs unless you
 * call `attachSync`.
 *
 * Design (see docs/api/sync.md for the long form):
 *
 * - **State snapshots, not commands.** Every tab broadcasts its whole logical
 *   state after a local change. Commands would need every tab to apply the
 *   same commands in the same order from the same origin (a tab that opened
 *   late, missed a message or ran an extension handler the others lack would
 *   diverge for good); a snapshot is self-healing and lets a late joiner catch
 *   up from a single message. State is small, plain JSON, and versioned
 *   (`wm.load` migrates it), so the cost is a structured clone per change.
 * - **Last writer wins, ordered by a Lamport clock.** Each message carries
 *   `(clock, tabId)`. A tab bumps its clock past every clock it has seen
 *   before it sends, so a change made after observing another change always
 *   wins over it. Two *concurrent* changes tie on the clock and are broken by
 *   the tab id, so every tab picks the same winner. The loser's concurrent
 *   change is discarded whole (no merging); that is the documented trade-off.
 * - **No echo loops.** A snapshot applied from a peer is loaded without being
 *   re-broadcast, and a snapshot is only applied when it is strictly newer
 *   than the newest one this tab sent or applied.
 * - **Undo/redo** are local-history steps whose results are ordinary state
 *   changes: they are broadcast like any other. A tab records each snapshot it
 *   applies as a history step, so undo in a tab that just received a peer's
 *   change steps back over that change (and the result propagates).
 * - **Reading direction is per tab** (it follows the page's `dir`): `config.direction` is neither sent nor applied.
 * - **Pop-outs are per tab.** A popped-out window is a real browser window
 *   owned by the tab that opened it. It is broadcast as `minimized` (other
 *   tabs show it hidden, never opening a popup), and an incoming snapshot never
 *   pops a locally popped-out window back in.
 */
import { createFrameScheduler } from "./scheduler.mjs";

export const SYNC_CHANNEL = "window-algebra";
const PROTOCOL = 1;

const after = (a, b) => a.clock > b.clock || (a.clock === b.clock && a.from > b.from);

const randomId = () =>
  globalThis.crypto?.randomUUID?.() ?? `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * What goes over the wire: the state with tab-local parts neutralised.
 * Popped-out windows travel as `minimized`; function layout specs (which
 * cannot be cloned) travel as `null` and keep each tab's own.
 */
export const toSnapshot = (state) => ({
  ...state,
  // Reading direction belongs to the tab's page (its `dir`), not to the shared state.
  config: Object.fromEntries(Object.entries(state.config ?? {}).filter(([key]) => key !== "direction")),
  windows: Object.fromEntries(
    Object.entries(state.windows).map(([id, win]) => [id, win.status === "popped-out" ? { ...win, status: "minimized" } : win]),
  ),
  workspaces: Object.fromEntries(
    Object.entries(state.workspaces).map(([id, ws]) => [id, typeof ws.layout === "function" ? { ...ws, layout: null } : ws]),
  ),
});

/** An incoming snapshot with this tab's local parts put back (see `toSnapshot`). */
export const fromSnapshot = (snapshot, local) => {
  let next = snapshot;
  if (local.config?.direction !== undefined) next = { ...next, config: { ...next.config, direction: local.config.direction } };
  for (const [id, ws] of Object.entries(snapshot.workspaces ?? {})) {
    if (ws.layout !== null) continue;
    const mine = local.workspaces[id]?.layout;
    next = { ...next, workspaces: { ...next.workspaces, [id]: { ...ws, layout: typeof mine === "function" ? mine : { type: "columns" } } } };
  }
  for (const [id, win] of Object.entries(snapshot.windows ?? {})) {
    const mine = local.windows[id];
    if (mine?.status === "popped-out" && win.status === "minimized" && win.workspace !== null && !win.scratchpad) {
      next = { ...next, windows: { ...next.windows, [id]: { ...win, status: "popped-out" } } };
    }
  }
  return next;
};

/**
 * @param {object} options
 * @param {object} options.wm the window manager to keep in sync
 * @param {BroadcastChannel|string} [options.channel] a `BroadcastChannel` (or anything with `postMessage`,
 *   `addEventListener("message")` and `close`), or a channel name (default "window-algebra")
 * @param {string} [options.id] this tab's id (default: random); also the Lamport tie-break
 * @param {(task: () => void) => void} [options.schedule] how gesture commands (a drag's stream of moves) are
 *   coalesced before broadcasting (default `createFrameScheduler()`: one snapshot per frame). Every other
 *   command is broadcast synchronously.
 * @param {(info: { direction: "in"|"out", clock: number, from: string, applied?: boolean }) => void} [options.onSync]
 * @param {(error: Error) => void} [options.onError] a snapshot that could not be posted or applied
 * @param {EventTarget|false} [options.lifecycle] where `pagehide` / `pageshow` fire (default `globalThis` when it is an
 *   event target, i.e. in a window). On `pagehide` the tab announces `bye` so peers stop counting it; on a `pageshow`
 *   that restores the page from the back/forward cache it announces itself again. `false` leaves that to you.
 * @returns {{ id: string, clock: number, peers(): string[], flush(): void, detach(): void }}
 */
export const attachSync = ({ wm, channel = SYNC_CHANNEL, id = randomId(), schedule = createFrameScheduler(), onSync, onError, lifecycle = globalThis } = {}) => {
  if (!wm) throw new TypeError("attachSync: `wm` is required");
  const ownsChannel = typeof channel === "string";
  const port = ownsChannel ? new globalThis.BroadcastChannel(channel) : channel;
  let clock = 0;
  let last = { clock: 0, from: id }; // the newest state this tab sent or applied
  let known = wm.getState(); // the last state we sent or applied: a notification for it is no news
  let dirty = false;
  let applying = false;
  let live = true;
  const peers = new Set();

  const post = (message) => {
    try {
      port.postMessage({ v: PROTOCOL, from: id, ...message });
    } catch (error) {
      onError?.(error);
    }
  };

  const send = () => {
    if (!dirty || !live) return;
    dirty = false;
    const state = wm.getState();
    known = state;
    clock += 1;
    last = { clock, from: id };
    post({ kind: "state", clock, state: toSnapshot(state) });
    onSync?.({ direction: "out", clock, from: id });
  };

  const apply = (message) => {
    const local = wm.getState();
    const incoming = fromSnapshot(message.state, local);
    // Already there (a hello reply relaying a state this tab holds): adopt the key, skip the history step.
    if (JSON.stringify(toSnapshot(local)) === JSON.stringify(message.state)) {
      dirty = false;
      last = { clock: message.clock, from: message.from };
      return true;
    }
    applying = true;
    let loaded;
    try {
      loaded = wm.load(incoming);
    } catch (error) {
      onError?.(error);
    } finally {
      applying = false;
    }
    if (!loaded) return false; // refused (a newer state version than this build knows)
    known = wm.getState();
    dirty = false;
    // A listener may have changed state (and sent it) while the load was being announced: keep the newer key.
    if (after(message, last)) last = { clock: message.clock, from: message.from };
    return true;
  };

  const onMessage = (event) => {
    const message = event?.data;
    if (!live || !message || message.v !== PROTOCOL || message.from === id || typeof message.from !== "string") return;
    if (message.kind === "bye") {
      peers.delete(message.from);
      return;
    }
    if (message.kind === "hello") {
      if (message.to !== undefined && message.to !== id) return;
      peers.add(message.from);
      if (message.reply) return; // an answer to our own hello: all it tells us is that the sender is here
      // A newcomer: hand it the current state if this tab has any history to share ...
      send();
      if (last.clock > 0) post({ kind: "state", clock: last.clock, state: toSnapshot(wm.getState()), to: message.from });
      // ... and tell it we exist, so it counts us even when we have nothing to send (peers() would be one-sided).
      post({ kind: "hello", clock, reply: true, to: message.from });
      return;
    }
    if (message.kind !== "state" || !Number.isFinite(message.clock) || !message.state || typeof message.state !== "object") return;
    if (message.to !== undefined && message.to !== id) return;
    peers.add(message.from);
    clock = Math.max(clock, message.clock);
    // An unsent local change would go out as clock + 1: it beats a peer's concurrent one.
    const mine = dirty ? { clock: clock + 1, from: id } : last;
    if (!after(message, mine)) return;
    const applied = apply(message);
    onSync?.({ direction: "in", clock: message.clock, from: message.from, applied });
  };

  const unsubscribe = wm.subscribe((state, events = [], command) => {
    // The notification for a snapshot this tab just applied is no news. A listener that reacts to it by
    // dispatching is a local change like any other, so only the load's own notification is swallowed.
    if (applying && events.some((event) => event.type === "state/loaded")) {
      known = state;
      return;
    }
    if (state === known) return;
    dirty = true;
    if (command?.gesture != null) schedule(send);
    else send();
  });

  if (typeof port.addEventListener === "function") port.addEventListener("message", onMessage);
  else port.onmessage = onMessage;
  post({ kind: "hello", clock });

  // A tab that is closed never calls detach(), and its peers would count it for ever. The channel stays open
  // across pagehide: the page may come back from the back/forward cache, and then it says hello again.
  const pageEvents = lifecycle && typeof lifecycle.addEventListener === "function" ? lifecycle : null;
  const onPageHide = () => {
    if (!live) return;
    send();
    post({ kind: "bye" });
  };
  const onPageShow = (event) => {
    if (live && event?.persisted) post({ kind: "hello", clock });
  };
  pageEvents?.addEventListener("pagehide", onPageHide);
  pageEvents?.addEventListener("pageshow", onPageShow);

  return {
    id,
    get clock() {
      return clock;
    },
    peers: () => [...peers],
    flush: send,
    detach() {
      if (!live) return;
      send();
      live = false;
      unsubscribe();
      pageEvents?.removeEventListener("pagehide", onPageHide);
      pageEvents?.removeEventListener("pageshow", onPageShow);
      post({ kind: "bye" });
      if (typeof port.removeEventListener === "function") port.removeEventListener("message", onMessage);
      else if (port.onmessage === onMessage) port.onmessage = null;
      if (ownsChannel) port.close?.();
    },
  };
};
