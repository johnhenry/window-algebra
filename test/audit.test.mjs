/**
 * Regression tests for the full audit (see CHANGELOG, "Audit fixes"). Each
 * describe block names the finding it pins; every test here failed before the fix.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createState, update, derive, compile, presentationContext, isVisible, focusable } from "../src/index.mjs";

const run = (state, ...commands) => commands.reduce((s, c) => update(s, c).state, state);
const mk = (state, id, extra = {}) => run(state, { type: "window/create", id, ...extra });
const withWindows = (ids, options) => ids.reduce((s, id) => mk(s, id), createState(options));
const reason = (state, command) => {
  const out = update(state, command);
  assert.equal(out.state, state, `${command.type} should leave the state untouched`);
  assert.equal(out.events[0]?.type, "command/rejected", `${command.type} should be rejected`);
  return out.events[0].reason;
};
const present = (state) => {
  for (const output of state.outputOrder) compile(derive(state, { output }), presentationContext(state));
};

describe("reserved names are refused (found by the fuzz test)", () => {
  test("an id that is an Object.prototype key is not looked up as a window", () => {
    const state = withWindows(["a"]);
    for (const id of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
      for (const type of ["window/close", "window/focus", "window/move", "window/resize", "window/raise", "window/minimize", "workspace/activate", "workspace/remove", "output/focus", "output/remove", "window/to-scratchpad", "window/set-constraints"]) {
        assert.doesNotThrow(() => update(state, { type, id }), `${type} ${id}`);
        assert.equal(reason(state, { type, id }), "invalid-id");
      }
    }
    assert.equal(reason(state, { type: "window/create", id: "x", parent: "__proto__" }), "invalid-id");
    assert.equal(reason(state, { type: "window/move-to-workspace", id: "a", workspace: "constructor" }), "invalid-id");
  });
});

describe("2: window/create validates layer, role and mode", () => {
  test("bogus layer, role and mode are rejected, not thrown or stored", () => {
    const state = createState();
    assert.equal(reason(state, { type: "window/create", id: "a", layer: "bogus" }), "unknown-layer");
    assert.equal(reason(state, { type: "window/create", id: "a", layer: { type: "x" } }), "unknown-layer");
    assert.equal(reason(state, { type: "window/create", id: "a", role: "bogus" }), "unknown-role");
    assert.equal(reason(state, { type: "window/create", id: "a", mode: "bogus" }), "unknown-mode");
    assert.equal(reason(state, { type: "window/create", id: "a", mode: true }), "unknown-mode");
  });
  test("every real layer, role and mode still creates", () => {
    const state = createState();
    for (const layer of ["background", "normal", "top", "modal", "popover", "notification", "system"]) {
      assert.ok(run(state, { type: "window/create", id: "a", layer }).windows.a);
    }
    for (const role of ["window", "dialog", "sheet", "popover", "menu", "tooltip", "panel", "notification"]) {
      assert.ok(run(state, { type: "window/create", id: "a", role }).windows.a);
    }
  });
});
