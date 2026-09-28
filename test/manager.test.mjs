import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, replay, views } from "../src/index.mjs";
import { createFrameScheduler } from "../src/browser/index.mjs";

describe("createWindowManager facade", () => {
  test("imperative sugar over the pure core", () => {
    const wm = createWindowManager();
    wm.create({ id: "a", title: "A" });
    wm.create({ id: "b" });
    wm.focus("a");
    assert.equal(wm.state.focus.window, "a");
    wm.setMode("b", "floating");
    wm.move("b", 50, 60);
    assert.deepEqual([wm.state.windows.b.placement.x, wm.state.windows.b.placement.y], [50, 60]);
    wm.close("a");
    assert.deepEqual(Object.keys(wm.state.windows), ["b"]);
  });

  test("subscribers receive state, events and the command", () => {
    const wm = createWindowManager();
    const seen = [];
    const off = wm.subscribe((state, events, command) => seen.push([command.type, events.map((e) => e.type)]));
    wm.create({ id: "a" });
    off();
    wm.create({ id: "b" });
    assert.deepEqual(seen, [["window/create", ["window/created", "window/focused"]]]);
  });

  test("renderer receives compiled render trees on render effects", () => {
    const commits = [];
    const wm = createWindowManager({ renderer: { commit: (tree) => commits.push(tree) } });
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    assert.equal(commits.length, 2);
    assert.equal(commits.at(-1).tag, "wm-overlay");
  });

  test("a frame scheduler coalesces many commands into one commit", () => {
    const frames = [];
    const commits = [];
    const wm = createWindowManager({
      renderer: { commit: (tree) => commits.push(tree) },
      schedule: createFrameScheduler((fn) => frames.push(fn)),
    });
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    wm.create({ id: "c" });
    assert.equal(frames.length, 1);
    frames[0]();
    assert.equal(commits.length, 1);
    assert.equal(commits[0].children[0].children.length, 2); // master + stack column
  });

  test("non-render effects go to onEffect", () => {
    const effects = [];
    const wm = createWindowManager({ onEffect: (effect) => effects.push(effect) });
    wm.create({ id: "a" });
    assert.deepEqual(effects, [{ type: "focus", id: "a" }]);
  });

  test("undo/redo covers window management itself", () => {
    const wm = createWindowManager({ history: true });
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    wm.close("b");
    assert.ok(wm.canUndo);
    wm.undo();
    assert.ok(wm.state.windows.b);
    wm.undo();
    assert.ok(!wm.state.windows.b);
    wm.redo();
    assert.ok(wm.state.windows.b);
    assert.ok(wm.canRedo);
  });

  test("rejected commands do not create history entries", () => {
    const wm = createWindowManager({ history: true });
    wm.close("nope");
    assert.ok(!wm.canUndo);
  });

  test("the command log replays to the same state", () => {
    const wm = createWindowManager();
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    wm.setLayout({ type: "bsp" });
    wm.swap("a", "b");
    assert.deepEqual(replay(createState(), wm.log), wm.state);
  });

  test("serialize/load restores a session", () => {
    const wm = createWindowManager();
    wm.create({ id: "a" });
    wm.setLayout({ type: "columns" });
    const saved = wm.serialize();
    const other = createWindowManager();
    other.load(saved);
    assert.deepEqual(other.state, wm.state);
    assert.deepEqual(views(other.present().tree), ["a"]);
  });

  test("setUrgent / focusUrgent, and log/replay + serialize preserve urgency", () => {
    const wm = createWindowManager({ history: true });
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    wm.setUrgent("b");
    assert.deepEqual(wm.state.urgent, ["b"]);
    wm.focusUrgent();
    assert.equal(wm.state.focus.window, "b");
    assert.deepEqual(wm.state.urgent, []);

    assert.deepEqual(replay(createState(), wm.log), wm.state);

    const saved = wm.serialize();
    const other = createWindowManager();
    other.load(saved);
    assert.deepEqual(other.state, wm.state);

    wm.setUrgent("a", true);
    wm.undo();
    assert.deepEqual(wm.state.urgent, []);
    wm.redo();
    assert.deepEqual(wm.state.urgent, ["a"]);
  });

  test("measure delegates to the renderer", () => {
    const wm = createWindowManager({ renderer: { commit() {}, measure: () => ({ a: { x: 0, y: 0, width: 1, height: 1 } }) } });
    assert.deepEqual(wm.measure().a.width, 1);
    assert.deepEqual(createWindowManager().measure(), {});
  });

  test("setRules dispatches rules/set and window/create matches them", () => {
    const wm = createWindowManager();
    wm.setRules([{ match: { idPrefix: "term-" }, set: { layer: "top" } }]);
    assert.deepEqual(wm.state.config.rules, [{ match: { idPrefix: "term-" }, set: { layer: "top" } }]);
    wm.create({ id: "term-1" });
    assert.equal(wm.state.windows["term-1"].layer, "top");
  });
});
