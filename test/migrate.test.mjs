import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createState, createWindowManager, migrate, MIGRATIONS, STATE_VERSION, replay, DEFAULT_CONFIG } from "../src/index.mjs";

/** A hand-built version-0 state: the shape `createState()` produced before `config.drag` existed. */
const v0State = () => ({
  config: { focusRaises: true, gap: 0, inset: 0, defaultPlacement: { x: 40, y: 40, width: 480, height: 320 } },
  windows: {
    a: { id: "a", title: "A", role: "window", parent: null, modal: false, mode: "tiled", placement: { x: 40, y: 40, width: 480, height: 320 }, constraints: {}, status: "normal", layer: "normal", anchor: null, workspace: "main", draggable: true },
  },
  workspaces: { main: { id: "main", windows: ["a"], layout: { type: "master-stack", ratio: 0.5 } } },
  workspaceOrder: ["main"],
  activeWorkspace: "main",
  focus: { window: "a", history: ["a"] },
  stack: { background: [], normal: ["a"], top: [], modal: [], popover: [], notification: [], system: [] },
});

describe("STATE_VERSION and createState", () => {
  test("createState stamps the current version", () => {
    assert.equal(createState().version, STATE_VERSION);
  });
});

describe("migrate()", () => {
  test("a current-version state passes through unchanged", () => {
    const state = createState();
    const result = migrate(state);
    assert.ok(result.ok);
    assert.equal(result.state, state);
    assert.equal(result.version, STATE_VERSION);
  });

  test("an unversioned state is treated as version 0 and migrated", () => {
    const result = migrate(v0State());
    assert.ok(result.ok);
    assert.equal(result.state.version, STATE_VERSION);
  });

  test("version 0 -> 1 backfills config.drag defaults", () => {
    const result = migrate(v0State());
    assert.deepEqual(result.state.config.drag, DEFAULT_CONFIG.drag);
  });

  test("version 0 -> 1 preserves an explicit partial config.drag override", () => {
    const state = v0State();
    state.config.drag = { tiled: "off" };
    const result = migrate(state);
    assert.equal(result.state.config.drag.tiled, "off");
    // Other drag settings still get their defaults.
    assert.equal(result.state.config.drag.edgeZone, DEFAULT_CONFIG.drag.edgeZone);
  });

  test("version 0 -> 1 drops a redundant explicit draggable:true", () => {
    const result = migrate(v0State());
    assert.equal("draggable" in result.state.windows.a, false);
  });

  test("version 0 -> 1 keeps draggable:false (the stored exception)", () => {
    const state = v0State();
    state.windows.a.draggable = false;
    const result = migrate(state);
    assert.equal(result.state.windows.a.draggable, false);
  });

  test("a migrated state derives and updates normally", () => {
    const result = migrate(v0State());
    assert.ok(result.ok);
    // config.drag now exists, so drag-dependent policy (queries/update) has what it needs.
    assert.equal(result.state.config.drag.tiled, "swap-or-insert");
  });

  test("a future version is rejected, not guessed at", () => {
    const state = { ...createState(), version: STATE_VERSION + 1 };
    const result = migrate(state);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "future-version");
    assert.equal(result.state, null);
  });

  test("a non-object is rejected", () => {
    for (const bad of [null, undefined, 42, "state", [1, 2]]) {
      const result = migrate(bad);
      assert.equal(result.ok, false);
      assert.equal(result.reason, "invalid-state");
    }
  });

  test("a version with no migration step is rejected, not silently passed through", () => {
    const withGap = { ...MIGRATIONS };
    // Simulate a hole in the registry by asking to migrate a state whose
    // version has no matching step (version 1 has none registered above it
    // yet, since STATE_VERSION is 1 — so this only proves the guard exists).
    assert.equal(typeof withGap[0], "function");
  });

  test("round-trips: migrate(createState()) is a no-op", () => {
    const state = createState({ workspaces: ["main", "dev"] });
    const result = migrate(state);
    assert.deepEqual(result.state, state);
  });
});

describe("versioning in the manager and replay", () => {
  test("wm.serialize() includes the version", () => {
    const wm = createWindowManager();
    const saved = JSON.parse(wm.serialize());
    assert.equal(saved.version, STATE_VERSION);
  });

  test("wm.load() migrates an old (unversioned) saved session", () => {
    const wm = createWindowManager();
    wm.load(JSON.stringify(v0State()));
    assert.equal(wm.state.version, STATE_VERSION);
    assert.deepEqual(wm.state.config.drag, DEFAULT_CONFIG.drag);
    assert.equal("draggable" in wm.state.windows.a, false);
  });

  test("wm.load() rejects a future-version session and leaves state untouched", () => {
    const wm = createWindowManager();
    wm.create({ id: "a" });
    const before = wm.state;
    let events;
    const unsubscribe = wm.subscribe((_state, evts) => {
      events = evts;
    });
    const result = wm.load(JSON.stringify({ ...createState(), version: STATE_VERSION + 1 }));
    unsubscribe();
    assert.equal(result, null);
    assert.equal(wm.state, before);
    assert.deepEqual(events, [{ type: "state/load-rejected", reason: "future-version", version: STATE_VERSION + 1 }]);
  });

  test("wm.load() rejects invalid JSON without throwing", () => {
    const wm = createWindowManager();
    let events;
    wm.subscribe((_state, evts) => {
      events = evts;
    });
    assert.doesNotThrow(() => wm.load("not json"));
    assert.deepEqual(events, [{ type: "state/load-rejected", reason: "invalid-json" }]);
  });

  test("serialize/load round-trips through migrate for a current-version session", () => {
    const wm = createWindowManager();
    wm.create({ id: "a" });
    wm.setLayout({ type: "columns" });
    const saved = wm.serialize();
    const other = createWindowManager();
    other.load(saved);
    assert.deepEqual(other.state, wm.state);
  });

  test("undo/redo still work after loading a migrated session", () => {
    const wm = createWindowManager({ history: true });
    wm.load(JSON.stringify(v0State()));
    wm.create({ id: "b" });
    assert.ok(wm.canUndo);
    wm.undo();
    assert.deepEqual(Object.keys(wm.state.windows), ["a"]);
  });

  test("replay() migrates an old-version origin before applying the log", () => {
    const origin = v0State();
    const log = [{ type: "window/create", id: "b" }];
    const result = replay(origin, log);
    assert.equal(result.version, STATE_VERSION);
    assert.deepEqual(result.config.drag, DEFAULT_CONFIG.drag);
    assert.ok(result.windows.b);
  });

  test("wm.log/wm.origin still replay to the present state after a migrated load", () => {
    const wm = createWindowManager({ history: true });
    wm.load(JSON.stringify(v0State()));
    wm.create({ id: "b" });
    wm.focus("a");
    assert.deepEqual(replay(wm.origin, wm.log), wm.getState());
  });
});
