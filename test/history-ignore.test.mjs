// History that leaves chosen commands out of undo (#10): `history: { ignore }`
// and the per-command `history: false` flag.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, replay } from "../src/index.mjs";

const FOCUS_AND_STACKING = ["window/focus", "window/blur", "window/raise", "window/lower", "focus/next", "focus/previous"];

const floating = (history) => {
  const wm = createWindowManager({ history, state: createState({ layout: { type: "floating" } }) });
  wm.create({ id: "a", mode: "floating", placement: { x: 0, y: 0, width: 100, height: 100 } });
  wm.create({ id: "b", mode: "floating", placement: { x: 200, y: 0, width: 100, height: 100 } });
  return wm;
};

const replays = (wm) => assert.deepEqual(replay(wm.origin, wm.log), wm.getState());

const undoSteps = (wm) => {
  let steps = 0;
  while (wm.canUndo) {
    wm.undo();
    steps += 1;
  }
  return steps;
};

describe("history: { ignore }", () => {
  test("a focus between two moves leaves exactly two undo steps after them", () => {
    const wm = floating({ ignore: FOCUS_AND_STACKING });
    const created = wm.getState();
    wm.move("a", 10, 10);
    wm.focus("a");
    wm.move("b", 300, 50);
    replays(wm);
    // Two creates, two moves; the focus is not a step.
    assert.equal(undoSteps(wm) - 2, 2);
    assert.equal(wm.getState().windows.a, undefined);

    const again = floating({ ignore: FOCUS_AND_STACKING });
    again.move("a", 10, 10);
    again.focus("a");
    again.move("b", 300, 50);
    again.undo();
    again.undo();
    assert.deepEqual(again.getState(), created);
    replays(again);
  });

  test("undo after a focus-only change undoes the last move, and redo brings both back", () => {
    const wm = floating({ ignore: FOCUS_AND_STACKING });
    wm.move("b", 300, 50);
    const moved = wm.getState();
    wm.focus("a");
    wm.raise("a");
    const focused = wm.getState();
    assert.equal(focused.focus.window, "a");
    assert.notDeepEqual(focused.windows.b.placement, { x: 200, y: 0, width: 100, height: 100 });

    wm.undo();
    // The move is gone (and with it the focus made after it: history holds whole states).
    assert.deepEqual(wm.getState().windows.b.placement, { x: 200, y: 0, width: 100, height: 100 });
    assert.equal(wm.getState().focus.window, "b");
    assert.ok(wm.canRedo);
    replays(wm);

    wm.redo();
    assert.deepEqual(wm.getState(), focused);
    assert.notEqual(wm.getState(), moved);
    replays(wm);
  });

  test("the ignored command is applied, logged and notified like any other", () => {
    const wm = floating({ ignore: ["window/focus"] });
    const seen = [];
    wm.subscribe((state, events, command) => seen.push(command?.type));
    const before = wm.log.length;
    const out = wm.focus("a");
    assert.equal(out.state.focus.window, "a");
    assert.equal(wm.getState().focus.window, "a");
    assert.deepEqual(wm.log.slice(before), [{ type: "window/focus", id: "a" }]);
    assert.deepEqual(seen, ["window/focus"]);
    replays(wm);
  });

  test("an ignored command keeps the redo stack, and redo lands on the exact undone state", () => {
    const wm = floating({ ignore: FOCUS_AND_STACKING });
    wm.move("a", 10, 10);
    wm.move("b", 300, 50);
    const last = wm.getState();
    wm.undo();
    wm.focus("a");
    wm.raise("a");
    assert.ok(wm.canRedo);
    replays(wm);

    wm.redo();
    assert.deepEqual(wm.getState(), last);
    replays(wm);
    assert.ok(!wm.canRedo);
  });

  test("undo after ignored changes made since an undo steps back from the undone state", () => {
    const wm = floating({ ignore: FOCUS_AND_STACKING });
    const created = wm.getState();
    wm.move("a", 10, 10);
    const first = wm.getState();
    wm.move("b", 300, 50);
    const second = wm.getState();
    wm.undo();
    wm.focus("a");
    wm.undo();
    assert.deepEqual(wm.getState(), created);
    replays(wm);
    wm.redo();
    assert.deepEqual(wm.getState(), first);
    replays(wm);
    wm.redo();
    assert.deepEqual(wm.getState(), second);
    replays(wm);
  });

  test("a recorded command after an undo still clears redo, and keeps the ignored changes before it", () => {
    const wm = floating({ ignore: FOCUS_AND_STACKING });
    wm.move("a", 10, 10);
    wm.undo();
    wm.focus("a");
    wm.move("b", 300, 50);
    assert.ok(!wm.canRedo);
    assert.equal(wm.getState().focus.window, "a");
    replays(wm);
    wm.undo();
    assert.equal(wm.getState().focus.window, "a");
    replays(wm);
  });

  test("ignored commands at the origin are not undoable but stay in the log", () => {
    const wm = createWindowManager({
      history: { ignore: ["window/focus"] },
      state: floating(false).getState(),
    });
    wm.focus("a");
    assert.ok(!wm.canUndo);
    assert.equal(wm.undo().focus.window, "a");
    assert.deepEqual(wm.log, [{ type: "window/focus", id: "a" }]);
    replays(wm);
  });

  test("`limit` in the object form bounds history", () => {
    const wm = floating({ limit: 2, ignore: ["window/focus"] });
    wm.move("a", 1, 1);
    wm.focus("b");
    wm.move("a", 2, 2);
    wm.move("a", 3, 3);
    assert.equal(undoSteps(wm), 2);
    assert.deepEqual(wm.getState().windows.a.placement.x, 1);
    replays(wm);
  });

  test("an empty object enables history like `true`", () => {
    const wm = floating({});
    wm.focus("a");
    assert.ok(wm.canUndo);
    wm.undo();
    assert.equal(wm.getState().focus.window, "b");
  });

  test("without `ignore`, focus is an undo step as before", () => {
    const wm = floating(true);
    wm.move("a", 10, 10);
    wm.focus("a");
    wm.undo();
    assert.equal(wm.getState().focus.window, "b");
    assert.equal(wm.getState().windows.a.placement.x, 10);
    replays(wm);
  });
});

describe("history: false on a command", () => {
  test("keeps that command out of undo without an ignore list", () => {
    const wm = floating(true);
    wm.move("a", 10, 10);
    wm.focus("a", { history: false });
    wm.dispatch({ type: "window/raise", id: "a", history: false });
    wm.undo();
    assert.equal(wm.getState().windows.a.placement.x, 0);
    replays(wm);
    wm.redo();
    assert.equal(wm.getState().focus.window, "a");
    replays(wm);
  });

  test("history: true on a command records an ignored type", () => {
    const wm = floating({ ignore: ["window/focus"] });
    wm.move("a", 10, 10);
    wm.focus("a", { history: true });
    wm.undo();
    assert.equal(wm.getState().focus.window, "b");
    assert.equal(wm.getState().windows.a.placement.x, 10);
    replays(wm);
  });

  test("is inert without the history option: the log is kept as before", () => {
    const wm = floating(false);
    wm.focus("a", { history: false });
    assert.ok(!wm.canUndo);
    assert.deepEqual(wm.log.at(-1), { type: "window/focus", id: "a", history: false });
    replays(wm);
  });
});

describe("ignored commands and gesture tokens", () => {
  test("an ignored raise that opens a drag is not part of the drag's step", () => {
    const wm = floating({ ignore: FOCUS_AND_STACKING });
    wm.dispatch({ type: "window/raise", id: "a", gesture: "g1" });
    const raised = wm.getState();
    wm.dispatch({ type: "window/move", id: "a", x: 5, y: 5, gesture: "g1" });
    wm.dispatch({ type: "window/move", id: "a", x: 9, y: 9, gesture: "g1" });
    replays(wm);
    wm.undo();
    assert.deepEqual(wm.getState(), raised);
    replays(wm);
    wm.redo();
    assert.equal(wm.getState().windows.a.placement.x, 9);
    replays(wm);
  });

  test("a plain click (a lone ignored command with a token) leaves no undo step", () => {
    const wm = floating({ ignore: FOCUS_AND_STACKING });
    wm.move("b", 300, 50);
    wm.dispatch({ type: "window/raise", id: "a", gesture: "click" });
    wm.dispatch({ type: "window/focus", id: "a", gesture: "click" });
    wm.undo();
    assert.equal(wm.getState().windows.b.placement.x, 200);
    replays(wm);
  });

  test("an ignored command carrying an open gesture's token joins that gesture", () => {
    const wm = floating({ ignore: FOCUS_AND_STACKING });
    const before = wm.getState();
    wm.dispatch({ type: "window/move", id: "a", x: 5, y: 5, gesture: "g2" });
    wm.dispatch({ type: "window/raise", id: "a", gesture: "g2" });
    wm.dispatch({ type: "window/move", id: "a", x: 9, y: 9, gesture: "g2" });
    replays(wm);
    wm.undo();
    assert.deepEqual(wm.getState(), before);
    replays(wm);
  });
});

test("replay(origin, log) equals the state through random commands, undo, redo and load", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (list) => list[Math.floor(random() * list.length)];
  for (let run = 0; run < 40; run += 1) {
    const wm = floating({ limit: 6, ignore: FOCUS_AND_STACKING });
    let token = 0;
    for (let i = 0; i < 60; i += 1) {
      const id = pick(["a", "b"]);
      const action = pick(["move", "move", "focus", "raise", "lower", "blur", "flag", "gesture", "undo", "undo", "redo", "redo", "load"]);
      if (action === "move") wm.move(id, Math.floor(random() * 50), Math.floor(random() * 50));
      else if (action === "focus") wm.focus(id);
      else if (action === "raise") wm.raise(id);
      else if (action === "lower") wm.lower(id);
      else if (action === "blur") wm.blur();
      else if (action === "flag") wm.dispatch({ type: "window/resize", id, width: 100 + Math.floor(random() * 50), height: 100, history: false });
      else if (action === "gesture") {
        const g = `g${(token += 1)}`;
        if (random() < 0.5) wm.dispatch({ type: "window/raise", id, gesture: g });
        wm.dispatch({ type: "window/move", id, x: 1, y: 1, gesture: g });
        if (random() < 0.5) wm.dispatch({ type: "window/focus", id, gesture: g });
        wm.dispatch({ type: "window/move", id, x: Math.floor(random() * 50), y: 2, gesture: g });
      } else if (action === "undo") wm.undo();
      else if (action === "redo") wm.redo();
      else if (action === "load") wm.load(wm.serialize());
      replays(wm);
    }
  }
});
