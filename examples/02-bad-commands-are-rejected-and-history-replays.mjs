// Commands vs events: the manager can say no, and says it with an event,
// never an exception. History is plain data; the command log replays exactly.
import assert from "node:assert/strict";
import { createState, createWindowManager, update, replay, COMMANDS } from "@johnhenry/window-algebra";

const reasonOf = (out) => out.events.find((e) => e.type === "command/rejected")?.reason;

// --- The pure core rejects instead of throwing, and leaves state untouched.
const s0 = update(createState(), { type: "window/create", id: "a" }).state;
const dup = update(s0, { type: "window/create", id: "a" });
assert.equal(reasonOf(dup), "duplicate-id");
assert.equal(dup.state, s0); // same reference: nothing changed
assert.equal(reasonOf(update(s0, { type: "window/focus", id: "nope" })), "unknown-window");
assert.equal(reasonOf(update(s0, { type: "no/such-command" })), "unknown-command");
assert.equal(reasonOf(update(s0, null)), "invalid-command");
assert.equal(reasonOf(update(s0, { type: "window/set-layer", id: "a", layer: "attic" })), "unknown-layer");
assert.ok(COMMANDS.includes("window/create") && COMMANDS.length >= 51);

// --- The manager adds one rejection update() cannot: a layout no interpreter knows.
const wm = createWindowManager({ history: true });
const seen = [];
wm.subscribe((state, events) => seen.push(...events.map((e) => e.type)));
assert.equal(reasonOf(wm.setLayout({ type: "not-a-layout" })), "unknown-layout");

// --- Undo/redo, and the log that mirrors it.
wm.create({ id: "editor" });
wm.create({ id: "terminal" });
wm.create({ id: "calc", mode: "floating" });
assert.equal(Object.keys(wm.getState().windows).length, 3);
wm.undo();
assert.equal(wm.getState().windows.calc, undefined);
assert.equal(wm.log.length, 2); // the undone command left the log
wm.redo();
assert.ok(wm.getState().windows.calc);
assert.ok(seen.includes("history/changed"));

// --- A gesture: many commands sharing a token become one undo step and one log entry.
const before = wm.getState();
for (let x = 0; x <= 100; x += 10) wm.dispatch({ type: "window/move", id: "calc", x, y: x, gesture: "drag-1" });
assert.equal(wm.getState().windows.calc.placement.x, 100);
wm.undo();
assert.equal(wm.getState(), before); // the whole drag undid in one step
wm.redo();

// --- replay(origin, log) always reproduces the present state.
assert.deepEqual(replay(wm.origin, wm.log), wm.getState());

// --- simulate() is a dry run: no history, no render, no notification.
const count = seen.length;
const dry = wm.simulate({ type: "window/close", id: "editor" });
assert.equal(dry.state.windows.editor, undefined);
assert.ok(wm.getState().windows.editor);
assert.equal(seen.length, count);

console.log("02 ok: rejections are events, gestures undo in one step, replay(origin, log) equals state");
