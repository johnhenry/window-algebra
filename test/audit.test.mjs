/**
 * Regression tests for the full audit (see CHANGELOG, "Audit fixes"). Each
 * describe block names the finding it pins; every test here failed before the fix.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createState, update, derive, compile, presentationContext, isVisible, focusable, paintOrder, views } from "../src/index.mjs";

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

describe("1, 6: focus is only ever given to a window that is shown", () => {
  test("window/focus on a hidden scratchpad window is rejected and leaves the workspace alone", () => {
    const state = run(withWindows(["a", "b"]), { type: "window/to-scratchpad", id: "b" });
    assert.equal(reason(state, { type: "window/focus", id: "b" }), "not-on-workspace");
    // The old behaviour set activeWorkspace to null, after which every create failed.
    const after = run(state, { type: "window/create", id: "c" });
    assert.ok(after.windows.c);
    assert.equal(after.activeWorkspace, "main");
  });

  test("focus/urgent skips an urgent window that cannot be focused", () => {
    let state = run(withWindows(["a", "b", "c"]), { type: "window/set-urgent", id: "b" }, { type: "window/set-urgent", id: "c" }, { type: "window/to-scratchpad", id: "b" }, { type: "window/focus", id: "a" });
    state = run(state, { type: "focus/urgent" });
    assert.equal(state.focus.window, "c");
    const onlyHidden = run(withWindows(["a", "b"]), { type: "window/set-urgent", id: "b" }, { type: "window/to-scratchpad", id: "b" });
    assert.equal(reason(onlyHidden, { type: "focus/urgent" }), "no-urgent-window");
  });

  test("window/focus on a popped-out window is rejected", () => {
    const state = run(withWindows(["a", "b"]), { type: "window/pop-out", id: "b" });
    assert.equal(reason(state, { type: "window/focus", id: "b" }), "popped-out");
  });

  test("window/create with a hidden-scratchpad parent is rejected", () => {
    const state = run(withWindows(["a"]), { type: "window/to-scratchpad", id: "a" });
    assert.equal(reason(state, { type: "window/create", id: "d", parent: "a", role: "dialog", modal: true }), "hidden-parent");
  });

  test("a dialog created under a popped-out parent is not focused (it is not shown)", () => {
    const state = run(withWindows(["a", "b"]), { type: "window/pop-out", id: "a" }, { type: "window/create", id: "d", parent: "a", role: "dialog" });
    assert.ok(state.windows.d);
    assert.ok(isVisible(state, state.focus.window ?? "b"));
    assert.notEqual(state.focus.window, "d");
  });

  test("window/move-to-workspace and window/to-scratchpad on a child are rejected (has-parent)", () => {
    const state = run(createState({ workspaces: ["main", "two"] }), { type: "window/create", id: "a" }, { type: "window/create", id: "d", parent: "a", role: "dialog", modal: true });
    assert.equal(reason(state, { type: "window/move-to-workspace", id: "d", workspace: "two" }), "has-parent");
    assert.equal(reason(state, { type: "window/to-scratchpad", id: "d" }), "has-parent");
    // Moving the parent takes the dialog along and focus follows the dialog.
    const moved = run(state, { type: "window/move-to-workspace", id: "a", workspace: "two", follow: true });
    assert.equal(moved.windows.d.workspace, "two");
    assert.equal(moved.focus.window, "d");
  });

  test("a modal dialog cannot be created on another workspace than its parent", () => {
    const state = run(createState({ workspaces: ["main", "two"] }), { type: "window/create", id: "a" });
    assert.equal(reason(state, { type: "window/create", id: "d", parent: "a", role: "dialog", modal: true, workspace: "two" }), "parent-on-other-workspace");
  });

  test("showing a scratchpad window brings its children with it", () => {
    let state = run(createState({ workspaces: ["main", "two"] }), { type: "window/create", id: "a" }, { type: "window/create", id: "d", parent: "a", role: "dialog" }, { type: "window/to-scratchpad", id: "a" });
    state = run(state, { type: "workspace/activate", id: "two" }, { type: "scratchpad/toggle", id: "a" });
    assert.equal(state.windows.d.workspace, "two");
    assert.ok(isVisible(state, "d"));
  });

  test("moving a popped-out window with follow does not focus it", () => {
    const state = run(createState({ workspaces: ["main", "two"] }), { type: "window/create", id: "a" }, { type: "window/pop-out", id: "a" }, { type: "window/move-to-workspace", id: "a", workspace: "two", follow: true });
    assert.equal(state.focus.window, null);
    assert.equal(state.activeWorkspace, "main");
  });
});

describe("3: window/swap on hidden windows", () => {
  test("two hidden scratchpad windows are rejected, not thrown", () => {
    const state = run(withWindows(["a", "b"]), { type: "window/to-scratchpad", id: "a" }, { type: "window/to-scratchpad", id: "b" });
    assert.equal(reason(state, { type: "window/swap", a: "a", b: "b" }), "not-on-workspace");
    assert.equal(reason(state, { type: "window/swap", a: "a", b: "a" }), "not-on-workspace");
  });
  test("swapping a window with itself is a no-op", () => {
    const state = withWindows(["a", "b"]);
    const out = update(state, { type: "window/swap", a: "a", b: "a" });
    assert.equal(out.state, state);
    assert.deepEqual(out.events, []);
  });
  test("a hidden window that was made tiled never throws in the keyboard moves", () => {
    const state = run(withWindows(["a", "b"]), { type: "window/to-scratchpad", id: "b" }, { type: "window/set-mode", id: "b", mode: "tiled" });
    for (const type of ["window/move-before", "window/move-after", "window/swap-next", "window/swap-previous"]) {
      assert.equal(reason(state, { type, id: "b" }), "not-tiled");
    }
  });
});

describe("4, 5: fullscreen and maximize", () => {
  const withDialog = () => run(withWindows(["a", "b"]), { type: "window/create", id: "dlg", parent: "a", role: "dialog", modal: true });

  test("fullscreening a parent with an open modal child still presents the dialog", () => {
    const state = run(withDialog(), { type: "window/fullscreen", id: "a" });
    assert.equal(state.focus.window, "dlg");
    assert.deepEqual(views(derive(state)).sort(), ["a", "dlg"]);
    assert.deepEqual(paintOrder(state), ["a", "dlg"]);
  });

  test("fullscreen and maximize take focus", () => {
    let state = withWindows(["a", "b"]);
    assert.equal(state.focus.window, "b");
    state = run(state, { type: "window/fullscreen", id: "a" });
    assert.equal(state.focus.window, "a");
    state = run(state, { type: "window/restore", id: "a" }, { type: "window/focus", id: "b" }, { type: "window/maximize", id: "a" });
    assert.equal(state.focus.window, "a");
  });

  test("fullscreening a window that is not on screen does not steal focus or switch workspace", () => {
    const state = run(createState({ workspaces: ["main", "two"] }), { type: "window/create", id: "a" }, { type: "window/create", id: "z", workspace: "two" }, { type: "window/fullscreen", id: "z" });
    assert.equal(state.focus.window, "a");
    assert.equal(state.activeWorkspace, "main");
  });

  test("focus cycling stays inside a fullscreen window's family; an explicit focus elsewhere ends the fullscreen", () => {
    let state = run(withWindows(["a", "b", "c"]), { type: "window/fullscreen", id: "a" });
    assert.deepEqual(focusable(state), ["a"]);
    state = run(state, { type: "focus/next" });
    assert.equal(state.focus.window, "a");
    state = run(state, { type: "window/focus", id: "b" });
    assert.equal(state.windows.a.status, "normal");
    assert.equal(state.focus.window, "b");
  });

  test("a window created while another is fullscreen does not end the fullscreen", () => {
    const state = run(withWindows(["a"]), { type: "window/fullscreen", id: "a" }, { type: "window/create", id: "n", role: "notification" });
    assert.equal(state.windows.a.status, "fullscreen");
    assert.equal(state.focus.window, "a");
  });
});
