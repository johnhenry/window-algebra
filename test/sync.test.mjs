import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, STATE_VERSION } from "../src/index.mjs";
import { attachSync, toSnapshot, fromSnapshot, attachPopouts } from "../src/browser/index.mjs";
import { immediateScheduler } from "../src/browser/scheduler.mjs";
import { createBroadcastHub } from "./helpers/fake-broadcast.mjs";
import { createFakeWindow, createFakeDocument } from "./helpers/fake-dom.mjs";

/** N tabs on one hub, each with its own manager (history on) and sync attached. */
const tabs = (ids = ["a", "b"], { sync = {}, state = () => createState() } = {}) => {
  const hub = createBroadcastHub();
  const out = ids.map((id) => {
    const wm = createWindowManager({ state: state(), history: true });
    const channel = new hub.BroadcastChannel("wa");
    const handle = attachSync({ wm, channel, id, schedule: immediateScheduler, ...sync });
    return { id, wm, channel, sync: handle };
  });
  hub.deliver(); // the hellos
  return { hub, ...Object.fromEntries(out.map((t) => [t.id, t])), all: out };
};
const titles = (wm) => Object.keys(wm.getState().windows).sort().join();

describe("attachSync: state snapshots over a BroadcastChannel", () => {
  test("a local change reaches the other tab, and nothing echoes back", () => {
    const { hub, a, b } = tabs();
    a.wm.create({ id: "w1", title: "One" });
    hub.deliver();
    assert.equal(titles(b.wm), "w1");
    assert.equal(b.wm.getState().windows.w1.title, "One");
    const stateMessages = hub.sent.filter((m) => m.kind === "state");
    assert.equal(stateMessages.length, 1, "B applied the snapshot without re-broadcasting it");
    assert.equal(hub.pending(), 0);
  });

  test("a no-op command (state unchanged) sends nothing", () => {
    const { hub, a } = tabs();
    a.wm.dispatch({ type: "window/focus", id: "nope" });
    a.wm.blur();
    hub.deliver();
    assert.equal(hub.sent.filter((m) => m.kind === "state").length, 0);
  });

  test("three tabs converge, and the relay is not an echo loop", () => {
    const { hub, a, b, c } = tabs(["a", "b", "c"]);
    a.wm.create({ id: "x" });
    hub.deliver();
    b.wm.create({ id: "y" });
    hub.deliver();
    c.wm.focus("x");
    hub.deliver();
    for (const t of [a, b, c]) {
      assert.equal(titles(t.wm), "x,y");
      assert.equal(t.wm.getState().focus.window, "x");
    }
  });

  test("a change made after seeing a peer's change wins over it (Lamport clock)", () => {
    const { hub, a, b } = tabs(["a", "b"]);
    a.wm.create({ id: "one" });
    hub.deliver();
    b.wm.create({ id: "two" }); // b saw a's change first
    hub.deliver();
    assert.equal(titles(a.wm), "one,two");
    assert.ok(b.sync.clock > 1);
    assert.equal(a.sync.clock, b.sync.clock);
  });

  test("concurrent changes: every tab picks the same winner (higher clock, then tab id)", () => {
    const { hub, a, b } = tabs(["a", "b"]);
    a.wm.create({ id: "from-a" });
    b.wm.create({ id: "from-b" }); // neither has seen the other: same clock, tie broken by id
    hub.deliver();
    assert.equal(titles(a.wm), "from-b");
    assert.equal(titles(b.wm), "from-b");
    assert.deepEqual(a.wm.getState(), b.wm.getState());
  });

  test("a higher clock beats the tie-break", () => {
    const { hub, a, b } = tabs(["a", "b"]);
    a.wm.create({ id: "1" });
    hub.deliver(); // both at clock 1
    a.wm.create({ id: "2" }); // a: clock 2
    b.wm.create({ id: "b-only" }); // b: clock 2 as well (concurrent), id b > a
    hub.deliver();
    assert.equal(titles(a.wm), titles(b.wm));
    assert.equal(titles(a.wm), "1,b-only");
    // a later change from a (having seen b's) wins for everyone
    a.wm.create({ id: "3" });
    hub.deliver();
    assert.equal(titles(b.wm), "1,3,b-only");
  });

  test("a late joiner is handed the current state by a hello reply", () => {
    const { hub, a } = tabs(["a"]);
    a.wm.create({ id: "early" });
    hub.deliver();
    const wm = createWindowManager({ history: true });
    const late = attachSync({ wm, channel: new hub.BroadcastChannel("wa"), id: "late", schedule: immediateScheduler });
    hub.deliver();
    assert.equal(titles(wm), "early");
    assert.deepEqual(a.sync.peers(), ["late"]);
    assert.deepEqual(late.peers(), ["a"]);
  });

  test("two tabs that never changed stay quiet on hello (nothing to share), but each counts the other as a peer", () => {
    const { hub, a, b } = tabs(["a", "b"]);
    hub.deliver();
    assert.equal(hub.sent.filter((m) => m.kind === "state").length, 0);
    // regression: the first tab answered hello with nothing when it had no history, so the newcomer never learned it
    // was there and peers() was one-sided (found by the workbench app's "Tabs: 2" indicator)
    assert.deepEqual(a.sync.peers(), ["b"]);
    assert.deepEqual(b.sync.peers(), ["a"]);
    // the answer is not answered in turn: two hellos, two replies, and the conversation ends
    const hellos = hub.sent.filter((m) => m.kind === "hello");
    assert.deepEqual(hellos.map((m) => Boolean(m.reply)), [false, false, true, true]);
    assert.equal(hub.pending(), 0);
  });

  test("undo and redo are ordinary changes: they propagate", () => {
    const { hub, a, b } = tabs();
    a.wm.create({ id: "w" });
    hub.deliver();
    a.wm.undo();
    hub.deliver();
    assert.equal(titles(b.wm), "");
    a.wm.redo();
    hub.deliver();
    assert.equal(titles(b.wm), "w");
  });

  test("undo in a tab that just received a peer's change steps back over it, and the revert propagates", () => {
    const { hub, a, b } = tabs();
    a.wm.create({ id: "w" });
    hub.deliver();
    assert.ok(b.wm.canUndo, "the applied snapshot is a history step in B");
    b.wm.undo();
    hub.deliver();
    assert.equal(titles(b.wm), "");
    assert.equal(titles(a.wm), "");
  });

  test("the applied snapshot reports focus like a load does (state/loaded + focus events)", () => {
    const { hub, a, b } = tabs();
    const seen = [];
    b.wm.subscribe((_s, events) => seen.push(...events.map((e) => e.type)));
    a.wm.create({ id: "w" });
    hub.deliver();
    assert.ok(seen.includes("state/loaded"));
    assert.ok(seen.includes("window/focused"));
  });

  test("a user listener that dispatches in reaction to a remote load is itself broadcast", () => {
    const { hub, a, b } = tabs();
    b.wm.subscribe((_s, events) => {
      if (events.some((e) => e.type === "state/loaded") && !b.wm.getState().windows.reply) b.wm.create({ id: "reply" });
    });
    a.wm.create({ id: "w" });
    hub.deliver();
    assert.equal(titles(a.wm), "reply,w");
    assert.equal(titles(b.wm), "reply,w");
  });

  test("gesture commands are coalesced through `schedule`; other commands go out immediately", () => {
    const hub = createBroadcastHub();
    let queued = null;
    const make = (id) => {
      const wm = createWindowManager({ state: createState(), history: true });
      attachSync({ wm, channel: new hub.BroadcastChannel("wa"), id, schedule: (task) => (queued = task) });
      return wm;
    };
    const a = make("a");
    const b = make("b");
    a.create({ id: "f", mode: "floating" });
    hub.deliver();
    const before = hub.sent.filter((m) => m.kind === "state").length;
    for (let x = 1; x <= 20; x++) a.dispatch({ type: "window/move", id: "f", x, y: 5, gesture: "g1" });
    assert.equal(hub.sent.filter((m) => m.kind === "state").length, before, "nothing sent while the gesture streams");
    queued();
    hub.deliver();
    assert.equal(hub.sent.filter((m) => m.kind === "state").length, before + 1, "one snapshot for the whole drag");
    assert.equal(b.getState().windows.f.placement.x, 20);
  });

  test("flush() sends a pending gesture snapshot now; detach() flushes too", () => {
    const hub = createBroadcastHub();
    const wmA = createWindowManager({ history: true });
    const wmB = createWindowManager({ history: true });
    const sa = attachSync({ wm: wmA, channel: new hub.BroadcastChannel("wa"), id: "a", schedule: () => {} });
    attachSync({ wm: wmB, channel: new hub.BroadcastChannel("wa"), id: "b", schedule: () => {} });
    hub.deliver();
    wmA.create({ id: "f", mode: "floating" });
    wmA.dispatch({ type: "window/move", id: "f", x: 7, y: 7, gesture: "g" });
    hub.deliver();
    assert.notEqual(wmB.getState().windows.f.placement.x, 7, "the gesture's snapshot is still queued");
    sa.flush();
    hub.deliver();
    assert.equal(wmB.getState().windows.f.placement.x, 7);
    wmA.dispatch({ type: "window/move", id: "f", x: 9, y: 9, gesture: "g" });
    sa.detach();
    hub.deliver();
    assert.equal(wmB.getState().windows.f.placement.x, 9);
  });

  test("popped-out windows are per tab: other tabs see them minimized and never open a popup", () => {
    const { hub, a, b } = tabs();
    a.wm.create({ id: "p" });
    a.wm.create({ id: "q" });
    hub.deliver();
    a.wm.popOut("p");
    hub.deliver();
    assert.equal(a.wm.getState().windows.p.status, "popped-out");
    assert.equal(b.wm.getState().windows.p.status, "minimized");
    // b changes something unrelated; a keeps its popped-out window
    b.wm.focus("q");
    hub.deliver();
    assert.equal(a.wm.getState().windows.p.status, "popped-out");
    assert.equal(b.wm.getState().windows.p.status, "minimized");
  });

  test("with attachPopouts: a peer's snapshot neither opens nor closes this tab's popup", () => {
    const { hub, a, b } = tabs();
    const opened = [];
    const doc = createFakeDocument();
    const root = doc.createElement("div");
    doc.body.append(root);
    const element = doc.createElement("div");
    root.append(element);
    const renderer = { root, elementFor: () => element, release: () => ({ element }), adopt() {} };
    const popouts = attachPopouts({ wm: a.wm, renderer, open: () => (opened.push(createFakeWindow()), opened.at(-1)) });
    attachPopouts({ wm: b.wm, renderer: null, open: () => assert.fail("tab b must not open a popup") });
    a.wm.create({ id: "p" });
    a.wm.create({ id: "q" });
    hub.deliver();
    popouts.popOut("p");
    hub.deliver();
    assert.equal(opened.length, 1);
    b.wm.focus("q");
    b.wm.create({ id: "r" });
    hub.deliver();
    assert.equal(opened[0].closed, false, "the popup survives the peer's change");
    assert.equal(a.wm.getState().windows.p.status, "popped-out");
    // closing the window in the other tab closes the popup here
    b.wm.close("p");
    hub.deliver();
    assert.equal(a.wm.getState().windows.p, undefined);
    assert.equal(opened[0].closed, true);
  });

  test("restoring a window a peer popped out brings it back everywhere (the popup closes)", () => {
    const { hub, a, b } = tabs();
    a.wm.create({ id: "p" });
    hub.deliver();
    a.wm.popOut("p");
    hub.deliver();
    b.wm.restore("p");
    hub.deliver();
    assert.equal(a.wm.getState().windows.p.status, "normal");
  });

  test("function layout specs cannot be cloned: they travel as null and each tab keeps its own", () => {
    const fn = (spec, ids) => ids.length;
    const { hub, a, b } = tabs(["a", "b"], { state: () => createState({ layout: fn }) });
    a.wm.create({ id: "w" });
    hub.deliver(); // does not throw DataCloneError
    assert.equal(titles(b.wm), "w");
    assert.equal(typeof b.wm.getState().workspaces.main.layout, "function", "b keeps its own function layout");
    b.wm.create({ id: "x" });
    hub.deliver();
    assert.equal(typeof a.wm.getState().workspaces.main.layout, "function", "a's own function layout survives b's snapshot");
    assert.equal(titles(a.wm), "w,x");
    // a tab with no function for that workspace falls back to columns
    const stranger = createWindowManager({ history: true });
    const hubless = fromSnapshot(toSnapshot(a.wm.getState()), stranger.getState());
    assert.deepEqual(hubless.workspaces.main.layout, { type: "columns" });
  });

  test("toSnapshot/fromSnapshot are inverses for what a tab owns", () => {
    const s = createState();
    const state = { ...s, windows: { p: { id: "p", status: "popped-out", workspace: "main" } } };
    const snap = toSnapshot(state);
    assert.equal(snap.windows.p.status, "minimized");
    assert.equal(fromSnapshot(snap, state).windows.p.status, "popped-out");
    assert.equal(fromSnapshot(snap, { ...state, windows: {} }).windows.p.status, "minimized");
  });

  test("a snapshot from a newer state version is refused and does not move the clock's winner", () => {
    const { hub, a, b } = tabs();
    const rejected = [];
    b.wm.subscribe((_s, events) => rejected.push(...events.filter((e) => e.type === "state/load-rejected")));
    const rogue = new hub.BroadcastChannel("wa");
    rogue.postMessage({ v: 1, from: "z", kind: "state", clock: 9, state: { ...a.wm.getState(), version: STATE_VERSION + 5 } });
    hub.deliver();
    assert.deepEqual(rejected.map((e) => e.reason), ["future-version"]);
    assert.equal(b.wm.getState().version, STATE_VERSION, "b's own state is untouched");
    a.wm.create({ id: "ok" }); // a's clock is below the refused clock 9: the refusal did not advance the winner
    hub.deliver();
    assert.equal(titles(b.wm), "ok");
  });

  test("ignores its own, malformed, unknown-protocol and wrongly addressed messages", () => {
    const { hub, a, b } = tabs();
    const rogue = new hub.BroadcastChannel("wa");
    const state = { ...a.wm.getState(), windows: {} };
    for (const data of [null, "x", { v: 99, from: "z", kind: "state", clock: 5, state }, { v: 1, from: "z", kind: "state", clock: "5", state }, { v: 1, from: "z", kind: "state", clock: 5 }, { v: 1, from: "z", kind: "state", clock: 5, state, to: "someone-else" }, { v: 1, kind: "state", clock: 5, state }]) {
      rogue.postMessage(data);
    }
    hub.deliver();
    assert.equal(b.sync.clock, 0);
    assert.deepEqual(b.sync.peers(), ["a"], "only the real peer, never the rogue sender");
    assert.deepEqual(b.wm.getState().windows, {});
  });

  test("a tab that is closed (pagehide) says bye without detach(); a bfcache restore says hello again", () => {
    // regression: peers() counted a closed tab for ever, because only detach() announced bye (found by the workbench app)
    const lifecycle = new EventTarget();
    const { hub, a, b } = tabs(["a", "b"]);
    const wm = createWindowManager();
    const chan = new hub.BroadcastChannel("wa");
    const closing = attachSync({ wm, channel: chan, id: "c", schedule: immediateScheduler, lifecycle });
    hub.deliver();
    assert.deepEqual(a.sync.peers().sort(), ["b", "c"]);
    assert.deepEqual(b.sync.peers().sort(), ["a", "c"]);
    lifecycle.dispatchEvent(new Event("pagehide"));
    hub.deliver();
    assert.deepEqual(a.sync.peers(), ["b"], "the closed tab is gone from its peers' list");
    assert.deepEqual(b.sync.peers(), ["a"]);
    // a page that is not restored from the cache (persisted false) stays quiet; one that is says hello again
    lifecycle.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    hub.deliver();
    assert.deepEqual(a.sync.peers(), ["b"]);
    lifecycle.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    hub.deliver();
    assert.deepEqual(a.sync.peers().sort(), ["b", "c"]);
    // detach removes the listeners: a later pagehide announces nothing
    closing.detach();
    hub.deliver();
    assert.deepEqual(a.sync.peers(), ["b"]);
    lifecycle.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    hub.deliver();
    assert.deepEqual(a.sync.peers(), ["b"]);
    // lifecycle: false opts out
    const quiet = new EventTarget();
    const other = attachSync({ wm: createWindowManager(), channel: new hub.BroadcastChannel("wa"), id: "d", schedule: immediateScheduler, lifecycle: false });
    hub.deliver();
    quiet.dispatchEvent(new Event("pagehide"));
    hub.deliver();
    assert.deepEqual(a.sync.peers().sort(), ["b", "d"]);
    other.detach();
  });

  test("detach stops listening, announces bye, and closes a channel it created", () => {
    const hub = createBroadcastHub();
    const saved = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = hub.BroadcastChannel;
    try {
      const wmA = createWindowManager();
      const wmB = createWindowManager();
      const sa = attachSync({ wm: wmA, channel: "named", id: "a", schedule: immediateScheduler });
      const sb = attachSync({ wm: wmB, channel: "named", id: "b", schedule: immediateScheduler });
      wmA.create({ id: "x" });
      hub.deliver();
      assert.equal(titles(wmB), "x");
      assert.deepEqual(sb.peers(), ["a"]);
      sa.detach();
      hub.deliver();
      assert.deepEqual(sb.peers(), []);
      wmA.create({ id: "y" });
      hub.deliver();
      assert.equal(titles(wmB), "x");
      sa.detach(); // idempotent
      sb.detach();
    } finally {
      globalThis.BroadcastChannel = saved;
    }
  });

  test("channels with onmessage only (no addEventListener) work", () => {
    const listeners = new Set();
    const mk = () => ({ onmessage: null, postMessage: (d) => listeners.forEach((fn) => fn !== mk.self && fn({ data: structuredClone(d) })), close() {} });
    const chA = { onmessage: null, postMessage: (d) => chB.onmessage?.({ data: structuredClone(d) }) };
    const chB = { onmessage: null, postMessage: (d) => chA.onmessage?.({ data: structuredClone(d) }) };
    void mk;
    const wmA = createWindowManager();
    const wmB = createWindowManager();
    const sa = attachSync({ wm: wmA, channel: chA, id: "a", schedule: immediateScheduler });
    attachSync({ wm: wmB, channel: chB, id: "b", schedule: immediateScheduler });
    wmA.create({ id: "k" });
    assert.equal(titles(wmB), "k");
    sa.detach();
    assert.equal(chA.onmessage, null);
  });

  test("onSync and onError hooks", () => {
    const hub = createBroadcastHub();
    const seen = [];
    const errors = [];
    const wmA = createWindowManager();
    const wmB = createWindowManager();
    attachSync({ wm: wmA, channel: new hub.BroadcastChannel("wa"), id: "a", schedule: immediateScheduler, onSync: (i) => seen.push(i), onError: (e) => errors.push(e) });
    attachSync({ wm: wmB, channel: new hub.BroadcastChannel("wa"), id: "b", schedule: immediateScheduler, onSync: (i) => seen.push(i) });
    hub.deliver();
    wmA.create({ id: "ok" });
    hub.deliver();
    assert.deepEqual(seen.map((i) => [i.direction, i.from, i.applied]), [["out", "a", undefined], ["in", "a", true]]);
    wmA.create({ id: "w", data: { fn() {} } }); // an uncloneable payload ends up in state
    assert.equal(errors.length, 1, "the DataCloneError is reported, not thrown");
    assert.equal(wmA.getState().windows.w.data.fn.name, "fn", "the local change still happened");
  });

  test("requires a window manager", () => {
    assert.throws(() => attachSync({}), TypeError);
  });
});
