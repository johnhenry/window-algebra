// Window-manager policy (rules, the scratchpad, urgency, modal focus, multiple
// outputs) lives in the pure core: every decision is visible in the returned
// state and events, testable without a browser.
import assert from "node:assert/strict";
import {
  createState,
  update,
  reduce,
  matchRules,
  isScratchpadHidden,
  isBlocked,
  focusable,
  derive,
  views,
} from "@johnhenry/window-algebra";

const run = (state, ...commands) => commands.reduce((s, c) => reduce(s, c), state);
const types = (out) => out.events.map((e) => e.type);

// --- Rules: declarative placement at window/create. Explicit command fields win.
let s = run(createState({ workspaces: ["main", "logs"] }), {
  type: "rules/set",
  rules: [
    { match: { idPrefix: "term-" }, set: { mode: "floating", layer: "top" } },
    { match: { titleRegex: "^Log " }, set: { workspace: "logs" } },
  ],
});
const created = update(s, { type: "window/create", id: "term-1" });
assert.deepEqual(created.events[0], { type: "window/created", id: "term-1", rules: [0] });
assert.equal(created.state.windows["term-1"].mode, "floating");
s = run(created.state, { type: "window/create", id: "term-2", mode: "tiled" });
assert.equal(s.windows["term-2"].mode, "tiled"); // the caller's own field beat the rule
s = run(s, { type: "window/create", id: "server", title: "Log server" });
assert.equal(s.windows.server.workspace, "logs");
assert.deepEqual(matchRules(s, s.windows.server), [1]);
assert.equal(update(s, { type: "rules/set", rules: [{ match: { colour: "red" } }] }).events[0].reason, "invalid-rules");

// --- Scratchpad (i3-style): hide off every workspace, toggle back floating and centered.
s = run(createState(), { type: "window/create", id: "editor" }, { type: "window/create", id: "calc" });
s = run(s, { type: "window/to-scratchpad", id: "calc" });
assert.ok(isScratchpadHidden(s, "calc"));
assert.equal(s.focus.window, "editor"); // focus fell back through history
const shown = update(s, { type: "scratchpad/toggle" });
assert.ok(types(shown).includes("scratchpad/shown"));
assert.deepEqual(shown.state.windows.calc.placement.x, "center");
assert.equal(shown.state.focus.window, "calc");

// --- Urgency: focus/urgent jumps to the oldest urgent window, across workspaces, and clears it.
s = run(createState({ workspaces: ["main", "chat"] }), { type: "window/create", id: "editor" });
s = run(s, { type: "window/create", id: "irc", workspace: "chat" }, { type: "window/set-urgent", id: "irc" });
assert.deepEqual(s.urgent, ["irc"]);
const jumped = update(s, { type: "focus/urgent" });
assert.equal(jumped.state.activeWorkspace, "chat");
assert.deepEqual(jumped.state.urgent, []);
assert.ok(types(jumped).includes("window/urgent-changed"));
assert.equal(update(jumped.state, { type: "focus/urgent" }).events[0].reason, "no-urgent-window");

// --- The modal graph: focusing a blocked parent is redirected to its modal child.
s = run(createState(), { type: "window/create", id: "doc" });
s = run(s, { type: "window/create", id: "save", role: "dialog", parent: "doc", modal: true });
assert.ok(isBlocked(s, "doc"));
const redirected = update(s, { type: "window/focus", id: "doc" });
assert.deepEqual(redirected.events.find((e) => e.type === "focus/redirected"), { type: "focus/redirected", requested: "doc", id: "save" });
assert.deepEqual(focusable(s), ["save"]);

// --- Multiple outputs (sway-style): each output shows its own active workspace.
s = run(createState(), { type: "window/create", id: "left-app" });
s = run(s, { type: "output/create", id: "hdmi", workspaces: ["side"] }, { type: "window/create", id: "right-app", workspace: "side" });
assert.deepEqual(views(derive(s, { output: "primary" })), ["left-app"]);
assert.deepEqual(views(derive(s, { output: "hdmi" })), ["right-app"]);
const crossed = update(s, { type: "window/focus", id: "right-app" });
assert.equal(crossed.state.focusedOutput, "hdmi");
assert.ok(types(crossed).includes("output/focused"));
assert.equal(update(s, { type: "workspace/move-to-output", id: "side", output: "primary" }).events[0].reason, "last-workspace-on-output");

console.log("05 ok: rules, scratchpad, urgency, modal redirection and outputs are decided by the pure core");
