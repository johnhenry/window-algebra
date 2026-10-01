// The window-manager topology is just data: serialize it, load it back, and
// upgrade states saved by older builds. A state from a newer build is refused
// with an event instead of being half-loaded.
import assert from "node:assert/strict";
import { createState, createWindowManager, migrate, MIGRATIONS, STATE_VERSION, DEFAULT_OUTPUT, update } from "@johnhenry/window-algebra";

// --- Round trip through JSON.
const wm = createWindowManager({ state: createState({ workspaces: ["main", "dev"] }) });
wm.create({ id: "editor", title: "Editor" });
wm.create({ id: "notes", mode: "floating" });
const saved = wm.serialize();
assert.equal(JSON.parse(saved).version, STATE_VERSION);

const restored = createWindowManager();
const events = [];
restored.subscribe((_state, evs) => events.push(...evs));
restored.load(saved);
assert.deepEqual(restored.getState(), wm.getState());
// Loading moves focus from nothing to the saved focus, and says so like any command would.
assert.deepEqual(events.map((e) => e.type), ["state/loaded", "window/focused"]);

// --- A version-0 state (no `version` field, no outputs, no config.drag) upgrades step by step.
const current = createState();
const legacy = {
  config: { focusRaises: true, gap: 0, inset: 0, defaultPlacement: { x: 40, y: 40, width: 480, height: 320 } },
  windows: {},
  workspaces: { main: { id: "main", windows: [], layout: { type: "columns" } } },
  workspaceOrder: ["main"],
  activeWorkspace: "main",
  focus: { window: null, history: [] },
  stack: current.stack,
  lastScratchpad: null,
};
const up = migrate(legacy);
assert.equal(up.ok, true);
assert.equal(up.state.version, STATE_VERSION);
assert.deepEqual(up.state.config.drag, current.config.drag); // 0 -> 1 backfilled drag settings
assert.deepEqual(up.state.urgent, []); // ...and the urgent list
assert.equal(up.state.focusedOutput, DEFAULT_OUTPUT); // 1 -> 2 backfilled a single output
assert.deepEqual(up.state.outputs[DEFAULT_OUTPUT].workspaces, ["main"]);
assert.ok(update(up.state, { type: "window/create", id: "x" }).state.windows.x); // and it works
assert.deepEqual(Object.keys(MIGRATIONS).map(Number), [0, 1]);

// A current state passes through as the same reference.
assert.equal(migrate(current).state, current);

// --- Refusals: never thrown, always explained.
assert.deepEqual(migrate({ ...current, version: STATE_VERSION + 1 }), {
  ok: false,
  state: null,
  version: STATE_VERSION + 1,
  reason: "future-version",
});
assert.equal(migrate("not an object").reason, "invalid-state");

events.length = 0;
const before = restored.getState();
assert.equal(restored.load({ ...current, version: 99 }), null);
assert.equal(restored.load("{ not json"), null);
assert.equal(restored.getState(), before); // untouched
assert.deepEqual(
  events.map((e) => [e.type, e.reason]),
  [
    ["state/load-rejected", "future-version"],
    ["state/load-rejected", "invalid-json"],
  ],
);

console.log("04 ok: serialize/load round-trips, old states migrate, newer states are refused with an event");
