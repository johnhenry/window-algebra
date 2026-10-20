// Hooks Viaframe needs (#14): ignore patterns, a filtered undo/redo, onRejected,
// and a pure snapshot()/diffStates() API.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, replay, snapshot, diffStates } from "../src/index.mjs";

const floating = (options = {}) => {
  const wm = createWindowManager({ state: createState({ layout: { type: "floating" } }), ...options });
  wm.create({ id: "a", mode: "floating", placement: { x: 0, y: 0, width: 100, height: 100 } });
  wm.create({ id: "b", mode: "floating", placement: { x: 200, y: 0, width: 100, height: 100 } });
  return wm;
};
const replays = (wm) => assert.deepEqual(replay(wm.origin, wm.log), wm.getState());
const isMove = (commands) => commands.some((c) => c.type === "window/move");

describe("history.ignore patterns", () => {
  test("a trailing * ignores a whole family of command types", () => {
    const wm = floating({ history: { ignore: ["focus/*", "window/focus"] } });
    wm.move("a", 5, 5);
    wm.focusNext();
    wm.focus("b");
    wm.undo();
    assert.equal(wm.getState().windows.a.placement.x, 0);
    replays(wm);
  });

  test("a predicate ignores the commands it accepts", () => {
    const wm = floating({ history: { ignore: [(command) => command.type.startsWith("window/") && command.id === "b"] } });
    wm.move("a", 5, 5);
    wm.move("b", 50, 50);
    wm.undo();
    // b's move was ignored, so it rolled back with the step before it.
    assert.equal(wm.getState().windows.a.placement.x, 0);
    assert.equal(wm.getState().windows.b.placement.x, 200);
    replays(wm);
  });
});

describe("undo/redo with a filter", () => {
  const setup = () => {
    const wm = floating({ history: true });
    wm.move("a", 10, 10);
    wm.setUrgent("b");
    wm.move("b", 300, 50);
    wm.setUrgent("a");
    return wm;
  };

  test("undo({ where }) steps back to before the nearest matching step", () => {
    const wm = setup();
    wm.undo({ where: isMove });
    // The urgent hint of a (after the last move) and the move of b are both undone.
    assert.equal(wm.getState().windows.b.placement.x, 200);
    assert.deepEqual(wm.getState().urgent, ["b"]);
    assert.equal(wm.getState().windows.a.placement.x, 10);
    replays(wm);
  });

  test("redo({ where }) goes forward through the next matching step", () => {
    const wm = setup();
    wm.undo({ where: isMove });
    wm.undo({ where: isMove });
    assert.equal(wm.getState().windows.a.placement.x, 0);
    const seen = [];
    wm.subscribe((_s, events) => seen.push(...events.map((e) => e.type)));
    wm.redo({ where: isMove });
    assert.equal(wm.getState().windows.a.placement.x, 10);
    assert.equal(wm.getState().windows.b.placement.x, 200);
    assert.deepEqual(seen.filter((t) => t === "history/changed"), ["history/changed"]);
    wm.redo({ where: isMove });
    assert.equal(wm.getState().windows.b.placement.x, 300);
    replays(wm);
  });

  test("no matching step is a no-op", () => {
    const wm = floating({ history: true });
    wm.setUrgent("a");
    const before = wm.getState();
    assert.equal(wm.undo({ where: isMove }), before);
    assert.equal(wm.canUndoWhere(isMove), false);
    assert.equal(wm.canUndoWhere(() => true), true);
    assert.equal(wm.canRedoWhere(() => true), false);
  });

  test("a gesture is one step whose commands are all offered to the filter", () => {
    const wm = floating({ history: true });
    wm.dispatch({ type: "window/move", id: "a", x: 1, y: 1, gesture: "g" });
    wm.dispatch({ type: "window/move", id: "a", x: 2, y: 2, gesture: "g" });
    wm.setUrgent("b");
    wm.undo({ where: isMove });
    assert.equal(wm.getState().windows.a.placement.x, 0);
    assert.equal(wm.canRedoWhere(isMove), true);
    replays(wm);
  });

  test("plain undo() is unchanged", () => {
    const wm = setup();
    wm.undo();
    assert.deepEqual(wm.getState().urgent, ["b"]);
    assert.equal(wm.getState().windows.b.placement.x, 300);
  });
});

describe("onRejected", () => {
  test("is called with the rejection, the command and the manager", () => {
    const calls = [];
    const wm = floating({ onRejected: (rejection, command, manager) => calls.push([rejection, command, manager]) });
    const command = { type: "window/focus", id: "nope" };
    wm.dispatch(command);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0].type, "command/rejected");
    assert.equal(calls[0][0].reason, "unknown-window");
    assert.equal(calls[0][1], command);
    assert.equal(calls[0][2], wm);
  });

  test("covers the manager's own unknown-layout rejection and is silent on success", () => {
    const reasons = [];
    const wm = floating({ onRejected: (r) => reasons.push(r.reason) });
    wm.focus("a");
    wm.setLayout({ type: "no-such-layout" });
    assert.deepEqual(reasons, ["unknown-layout"]);
  });
});

describe("snapshot and diffStates", () => {
  test("snapshot is a detached plain copy", () => {
    const wm = floating();
    const snap = snapshot(wm.getState());
    assert.deepEqual(snap, JSON.parse(JSON.stringify(wm.getState())));
    snap.windows.a.placement.x = 999;
    assert.equal(wm.getState().windows.a.placement.x, 0);
  });

  test("an unchanged state diffs empty", () => {
    const state = floating().getState();
    const d = diffStates(state, state);
    assert.equal(d.empty, true);
    assert.deepEqual(d.changes, []);
  });

  test("reports added, removed and changed windows with the fields that changed", () => {
    const wm = floating();
    const before = wm.getState();
    wm.move("a", 10, 20);
    wm.close("b");
    wm.create({ id: "c", mode: "floating", placement: { x: 0, y: 0, width: 10, height: 10 } });
    const d = diffStates(before, wm.getState());
    assert.deepEqual(d.windows.added, ["c"]);
    assert.deepEqual(d.windows.removed, ["b"]);
    assert.ok(d.windows.changed.a.includes("placement"));
    assert.equal(d.empty, false);
    const move = d.changes.find((c) => c.path.join(".") === "windows.a.placement.x");
    assert.deepEqual(move, { path: ["windows", "a", "placement", "x"], op: "replace", before: 0, after: 10 });
  });

  test("reports focus, the active workspace and layout changes", () => {
    const wm = floating();
    const before = wm.getState();
    wm.focus("a");
    wm.createWorkspace("two", { activate: true });
    wm.setLayout({ type: "columns" }, "two");
    const d = diffStates(before, wm.getState());
    assert.deepEqual(d.workspaces.added, ["two"]);
    assert.deepEqual(d.activeWorkspace, { before: before.activeWorkspace, after: "two" });
    assert.deepEqual(d.focus, { before: before.focus.window ?? null, after: wm.getState().focus.window ?? null });
  });

  test("works on snapshots too and is symmetric about add/remove", () => {
    const wm = floating();
    const a = snapshot(wm.getState());
    wm.close("b");
    const b = snapshot(wm.getState());
    assert.deepEqual(diffStates(a, b).windows.removed, ["b"]);
    assert.deepEqual(diffStates(b, a).windows.added, ["b"]);
  });
});
