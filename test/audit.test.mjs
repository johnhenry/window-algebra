/**
 * Regression tests for the full audit (see CHANGELOG, "Audit fixes"). Each
 * describe block names the finding it pins; every test here failed before the fix.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { columns, createWindowManager, createState, update, derive, compile, presentationContext, presentedWindows, isVisible, focusable, paintOrder, views } from "../src/index.mjs";

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
    assert.equal(reason(state, { type: "window/swap", id: "a", target: "b" }), "not-on-workspace");
    assert.equal(reason(state, { type: "window/swap", id: "a", target: "a" }), "not-on-workspace");
  });
  test("swapping a window with itself is a no-op", () => {
    const state = withWindows(["a", "b"]);
    const out = update(state, { type: "window/swap", id: "a", target: "a" });
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

describe("7: undo, redo and load re-sync focus", () => {
  test("undo reports the focus change as an event and a focus effect", () => {
    const effects = [];
    const events = [];
    const wm = createWindowManager({ history: true, onEffect: (effect) => effects.push(effect) });
    wm.subscribe((_state, evs) => events.push(...evs));
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    effects.length = 0;
    events.length = 0;
    wm.undo(); // b never existed: focus goes back to a
    assert.equal(wm.state.focus.window, "a");
    assert.deepEqual(effects, [{ type: "focus", id: "a" }]);
    assert.ok(events.some((e) => e.type === "window/focused" && e.id === "a"));
    effects.length = 0;
    wm.redo();
    assert.deepEqual(effects, [{ type: "focus", id: "b" }]);
    effects.length = 0;
    wm.undo();
    wm.undo(); // back to no windows: blurred
    assert.deepEqual(effects.at(-1), { type: "focus", id: null });
    assert.ok(events.some((e) => e.type === "window/blurred"));
  });
  test("an undo that does not move focus emits no focus effect", () => {
    const effects = [];
    const wm = createWindowManager({ history: true, onEffect: (effect) => effects.push(effect) });
    wm.create({ id: "a" });
    wm.resize("a", 300, 200);
    effects.length = 0;
    wm.undo();
    assert.deepEqual(effects, []);
  });
});

describe("8: layout/set-ratio", () => {
  test("a function layout is not resizable (it used to become { ratio } and make derive throw)", () => {
    const state = run(withWindows(["a", "b"]), { type: "layout/set", layout: (spec, ids) => columns({}, ids) });
    assert.equal(reason(state, { type: "layout/set-ratio", ratio: 0.3 }), "not-resizable");
  });
  test("layouts without a ratio are not resizable", () => {
    for (const type of ["columns", "rows", "grid", "tabs", "monocle", "floating", "tree"]) {
      const state = run(withWindows(["a", "b"]), { type: "layout/set", layout: { type } });
      assert.equal(reason(state, { type: "layout/set-ratio", ratio: 0.3 }), "not-resizable", type);
    }
  });
  test("master-stack, spiral and bsp still take a ratio", () => {
    for (const type of ["master-stack", "spiral", "bsp"]) {
      const state = run(withWindows(["a", "b"]), { type: "layout/set", layout: { type } });
      const out = update(state, { type: "layout/set-ratio", ratio: 0.3 });
      assert.equal(out.events[0].type, "layout/ratio-changed", type);
    }
  });
  test("the ratio must be a finite number", () => {
    const state = withWindows(["a", "b"]);
    for (const ratio of [undefined, null, "0.5", NaN, Infinity, {}, [0.5]]) assert.equal(reason(state, { type: "layout/set-ratio", ratio }), "invalid-ratio");
  });
});

describe("9: geometry, config and constraints are validated", () => {
  const state = withWindows(["a"]);
  test("window/move and window/resize reject non-finite, non-numeric and negative values", () => {
    for (const bad of [NaN, Infinity, "10", null, {}]) {
      assert.equal(reason(state, { type: "window/move", id: "a", x: bad }), "invalid-geometry");
      assert.equal(reason(state, { type: "window/move", id: "a", y: bad }), "invalid-geometry");
      assert.equal(reason(state, { type: "window/resize", id: "a", width: bad }), "invalid-geometry");
      assert.equal(reason(state, { type: "window/resize", id: "a", height: bad }), "invalid-geometry");
    }
    assert.equal(reason(state, { type: "window/resize", id: "a", width: -1 }), "invalid-geometry");
    assert.equal(reason(state, { type: "window/resize", id: "a", x: "left" }), "invalid-geometry");
  });
  test('"center" is a legal coordinate and omitted fields are fine', () => {
    const moved = run(state, { type: "window/move", id: "a", x: "center", y: 5 });
    assert.deepEqual([moved.windows.a.placement.x, moved.windows.a.placement.y], ["center", 5]);
    assert.equal(run(state, { type: "window/resize", id: "a", width: 200 }).windows.a.placement.width, 200);
    assert.equal(run(state, { type: "window/resize", id: "a", x: -50, y: -20 }).windows.a.placement.x, -50);
  });
  test("config/set rejects a negative gap, unknown keys and a bad defaultPlacement", () => {
    for (const patch of [{ gap: -4 }, { gap: NaN }, { inset: "8" }, { bogus: 1 }, { focusRaises: "yes" }, { defaultPlacement: 5 }, { defaultPlacement: { width: -1 } }, { defaultPlacement: { x: NaN } }, { defaultPlacement: { depth: 1 } }]) {
      assert.equal(reason(state, { type: "config/set", ...patch }), "invalid-config", JSON.stringify(patch));
    }
    const ok = run(state, { type: "config/set", gap: 8, defaultPlacement: { x: "center", width: 300 } });
    assert.equal(ok.config.gap, 8);
    assert.deepEqual(ok.config.defaultPlacement, { x: "center", y: 40, width: 300, height: 320 });
  });
  test("window/set-constraints rejects anything but the documented keys and values", () => {
    for (const constraints of [undefined, null, 5, "x", [], { minWidth: -1 }, { minWidth: "100" }, { maxWidth: NaN }, { widthIncrement: 0 }, { aspectRatio: -1 }, { aspectRatio: {} }, { aspectRatio: "wide" }, { bogus: 1 }]) {
      assert.equal(reason(state, { type: "window/set-constraints", id: "a", constraints }), "invalid-constraints", JSON.stringify(constraints));
    }
    const ok = run(state, { type: "window/set-constraints", id: "a", constraints: { minWidth: 100, maxWidth: Infinity, aspectRatio: { min: 1, max: 2 }, widthIncrement: 10 } });
    assert.equal(ok.windows.a.constraints.minWidth, 100);
  });
});

describe("10: window/set-layer moves descendants along", () => {
  test("a child that shared the parent's layer is not left beneath it", () => {
    const state = run(withWindows(["a", "b"]), { type: "window/create", id: "dlg", parent: "a", role: "dialog", layer: "normal" }, { type: "window/set-layer", id: "a", layer: "top" });
    assert.equal(state.windows.dlg.layer, "top");
    const order = paintOrder(state);
    assert.ok(order.indexOf("a") < order.indexOf("dlg"), `a before dlg in ${order}`);
  });
  test("a child that was put on another layer stays there", () => {
    const state = run(withWindows(["a"]), { type: "window/create", id: "dlg", parent: "a", role: "dialog" }, { type: "window/set-layer", id: "dlg", layer: "popover" }, { type: "window/set-layer", id: "a", layer: "top" });
    assert.equal(state.windows.dlg.layer, "popover");
  });
});

describe("11: unknown layouts and copied trees", () => {
  test("derive falls back to columns for a layout type nothing interprets", () => {
    const state = run(withWindows(["a", "b"]), { type: "layout/set", layout: { type: "no-such-layout" } });
    assert.deepEqual(views(derive(state)), ["a", "b"]);
    present(state);
  });
  test("the manager still rejects an unknown layout type up front", () => {
    const wm = createWindowManager();
    const events = [];
    wm.subscribe((_s, evs) => events.push(...evs));
    wm.dispatch({ type: "layout/set", layout: { type: "no-such-layout" } });
    assert.ok(events.some((e) => e.type === "command/rejected" && e.reason === "unknown-layout"));
  });
  test("workspace/create does not copy the active workspace's tree, sizes or ratios", () => {
    for (const layout of [{ type: "tree" }, { type: "bsp" }, { type: "columns", sizes: { "": [1, 2] } }, { type: "spiral", ratios: [0.3] }]) {
      let state = run(withWindows(["a", "b", "c"]), { type: "layout/set", layout });
      state = run(state, { type: "layout/resize-split", path: "", weights: [1, 2, 3] });
      state = run(state, { type: "workspace/create", id: "two", activate: true });
      const copied = state.workspaces.two.layout;
      assert.equal(copied.type, layout.type);
      assert.ok(!copied.tree || JSON.stringify(copied.tree).indexOf('"a"') < 0, `${layout.type}: no foreign ids`);
      assert.equal(copied.sizes, undefined, layout.type);
      assert.equal(copied.ratios, undefined, layout.type);
      present(state);
    }
  });
});

describe("12: command-set consistency", () => {
  test("toggle-maximize, toggle-fullscreen and toggle-sticky flip their state", () => {
    let state = withWindows(["a", "b"]);
    state = run(state, { type: "window/toggle-maximize", id: "a" });
    assert.equal(state.windows.a.status, "maximized");
    state = run(state, { type: "window/toggle-maximize", id: "a" });
    assert.equal(state.windows.a.status, "normal");
    state = run(state, { type: "window/toggle-fullscreen", id: "a" });
    assert.equal(state.windows.a.status, "fullscreen");
    state = run(state, { type: "window/toggle-fullscreen", id: "a" });
    assert.equal(state.windows.a.status, "normal");
    state = run(state, { type: "window/toggle-sticky", id: "a" });
    assert.equal(state.windows.a.sticky, true);
    state = run(state, { type: "window/toggle-sticky", id: "a" });
    assert.equal(state.windows.a.sticky, undefined);
    for (const type of ["window/toggle-maximize", "window/toggle-fullscreen", "window/toggle-sticky"]) assert.equal(reason(state, { type, id: "zz" }), "unknown-window");
  });

  test("set-urgent and set-sticky agree: a missing boolean means true, a non-boolean is rejected", () => {
    const state = withWindows(["a"]);
    assert.equal(run(state, { type: "window/set-sticky", id: "a" }).windows.a.sticky, true);
    assert.deepEqual(run(state, { type: "window/set-urgent", id: "a" }).urgent, ["a"]);
    assert.equal(reason(state, { type: "window/set-sticky", id: "a", sticky: "yes" }), "invalid-sticky");
    assert.equal(reason(state, { type: "window/set-urgent", id: "a", urgent: "yes" }), "invalid-urgent");
  });

  test("workspace/rename updates every reference", () => {
    let state = run(withWindows(["a", "b"], { workspaces: ["main", "two"] }), { type: "window/create", id: "z", workspace: "two" }, { type: "workspace/rename", id: "main", to: "home" });
    assert.equal(state.activeWorkspace, "home");
    assert.equal(state.windows.a.workspace, "home");
    assert.equal(state.workspaces.home.id, "home");
    assert.equal(state.workspaces.main, undefined);
    assert.deepEqual(state.workspaceOrder, ["home", "two"]);
    assert.deepEqual(state.outputs.primary.workspaces, ["home", "two"]);
    assert.equal(state.outputs.primary.activeWorkspace, "home");
    present(state);
    assert.equal(reason(state, { type: "workspace/rename", id: "home", to: "two" }), "duplicate-id");
    assert.equal(reason(state, { type: "workspace/rename", id: "home", to: "" }), "missing-id");
    assert.equal(reason(state, { type: "workspace/rename", id: "nope", to: "x" }), "unknown-workspace");
    assert.equal(update(state, { type: "workspace/rename", id: "home", to: "home" }).state, state);
  });

  test("workspace/reorder and output/reorder", () => {
    let state = createState({ workspaces: ["a", "b", "c"] });
    state = run(state, { type: "workspace/reorder", id: "c", index: 0 });
    assert.deepEqual(state.outputs.primary.workspaces, ["c", "a", "b"]);
    assert.deepEqual(state.workspaceOrder, ["c", "a", "b"]);
    assert.deepEqual(run(state, { type: "workspace/reorder", id: "c", index: 99 }).workspaceOrder, ["a", "b", "c"]);
    assert.equal(reason(state, { type: "workspace/reorder", id: "c", index: -1 }), "invalid-index");
    assert.equal(reason(state, { type: "workspace/reorder", id: "zz", index: 0 }), "unknown-workspace");
    state = run(state, { type: "output/create", id: "right", workspaces: ["r1"] }, { type: "output/reorder", id: "right", index: 0 });
    assert.deepEqual(state.outputOrder, ["right", "primary"]);
    assert.equal(reason(state, { type: "output/reorder", id: "nope", index: 0 }), "unknown-output");
    assert.equal(reason(state, { type: "output/reorder", id: "right", index: 1.5 }), "invalid-index");
  });

  test("window/from-scratchpad: hidden windows land on the active workspace, shown ones just stop being scratchpad windows", () => {
    let state = run(withWindows(["a", "b"]), { type: "window/to-scratchpad", id: "b" });
    const hidden = update(state, { type: "window/from-scratchpad", id: "b" });
    assert.equal(hidden.state.windows.b.scratchpad, undefined);
    assert.equal(hidden.state.windows.b.workspace, "main");
    assert.equal(hidden.state.focus.window, "b");
    assert.equal(hidden.events[0].type, "scratchpad/removed");
    state = run(state, { type: "scratchpad/toggle", id: "b" });
    const shown = update(state, { type: "window/from-scratchpad", id: "b" });
    assert.equal(shown.state.windows.b.scratchpad, undefined);
    assert.equal(shown.state.lastScratchpad, null);
    assert.equal(reason(shown.state, { type: "window/from-scratchpad", id: "b" }), "not-scratchpad");
  });

  test("hiding a window names the same event whichever command hid it", () => {
    let state = withWindows(["a"]);
    assert.equal(update(state, { type: "window/to-scratchpad", id: "a" }).events[0].type, "scratchpad/hidden");
    state = run(state, { type: "window/to-scratchpad", id: "a" }, { type: "scratchpad/toggle", id: "a" });
    assert.equal(update(state, { type: "scratchpad/toggle", id: "a" }).events[0].type, "scratchpad/hidden");
  });

  test("window/swap names its windows id and target, like window/drop", () => {
    const state = run(withWindows(["a", "b"]), { type: "window/swap", id: "a", target: "b" });
    assert.deepEqual(update(withWindows(["a", "b"]), { type: "window/swap", id: "a", target: "b" }).events, [{ type: "window/swapped", id: "a", target: "b" }]);
    assert.deepEqual(state.workspaces.main.windows, ["b", "a"]);
  });

  test("window/pop-in on a window that is not popped out is a no-op, like window/restore", () => {
    const state = withWindows(["a"]);
    assert.equal(update(state, { type: "window/pop-in", id: "a" }).state, state);
    assert.equal(update(state, { type: "window/restore", id: "a" }).state, state);
    const maximized = run(state, { type: "window/maximize", id: "a" });
    assert.equal(update(maximized, { type: "window/pop-in", id: "a" }).state, maximized, "pop-in only undoes a pop-out");
  });

  test("an extension handler that throws, or returns junk, becomes a handler-threw rejection", () => {
    const state = withWindows(["a"]);
    const out = update(state, { type: "my/boom", id: "a" }, { "my/boom": () => { throw new Error("nope"); } });
    assert.equal(out.state, state);
    assert.deepEqual(out.events, [{ type: "command/rejected", command: "my/boom", id: "a", reason: "handler-threw" }]);
    assert.equal(update(state, { type: "my/junk" }, { "my/junk": () => null }).events[0].reason, "handler-threw");
    assert.equal(update(state, { type: "my/ok" }, { "my/ok": (s) => ({ state: s }) }).events.length, 0);
  });
});

describe("found by the fuzz test while adding the 12 commands", () => {
  test("window/create rejects a falsy non-null parent such as NaN", () => {
    assert.equal(reason(withWindows(["a"]), { type: "window/create", id: "x", parent: NaN }), "unknown-parent");
  });
  test("fullscreening a window ends any other fullscreen window on its output", () => {
    const state = run(withWindows(["a", "b"]), { type: "window/fullscreen", id: "a" }, { type: "window/fullscreen", id: "b" });
    assert.equal(state.windows.a.status, "normal");
    assert.equal(state.windows.b.status, "fullscreen");
    assert.equal(state.focus.window, "b");
  });
  test("when a workspace switch brings two fullscreen windows into view, the one covering focus is presented", () => {
    let state = run(withWindows(["a", "s"], { workspaces: ["main", "two"] }), { type: "window/set-sticky", id: "s" }, { type: "window/fullscreen", id: "s" });
    state = run(state, { type: "window/create", id: "z", workspace: "two" });
    state = { ...state, windows: { ...state.windows, z: { ...state.windows.z, status: "fullscreen" } } };
    state = run(state, { type: "workspace/activate", id: "two" });
    assert.equal(views(derive(state)).length, 1);
    assert.ok(presentedWindows(state).some((w) => w.id === state.focus.window) || state.focus.window === null);
  });
  test("a modal child of a sticky window stays visible wherever its parent is", () => {
    let state = run(withWindows(["a"], { workspaces: ["main", "two"] }), { type: "window/create", id: "dlg", parent: "a", role: "dialog", modal: true }, { type: "window/set-sticky", id: "a" }, { type: "workspace/activate", id: "two" });
    assert.ok(isVisible(state, "dlg"));
    assert.deepEqual(views(derive(state)).sort(), ["a", "dlg"]);
  });
});

describe("15: derive and presentationContext do not rescan the window set per window", () => {
  test("the number of whole-window-set scans does not grow with the number of windows", () => {
    const scans = (n) => {
      let state = createState();
      for (let i = 0; i < n; i++) {
        state = mk(state, `w${i}`);
        state = mk(state, `d${i}`, { parent: `w${i}`, role: "dialog", modal: i % 2 === 0, mode: "floating" });
      }
      let count = 0;
      const counted = { ...state, windows: new Proxy(state.windows, { ownKeys(target) { count++; return Reflect.ownKeys(target); } }) };
      derive(counted);
      presentationContext(counted);
      return count;
    };
    const small = scans(10);
    const large = scans(100);
    assert.equal(large, small, `scans grew from ${small} to ${large}`);
    assert.ok(large < 40, `${large} scans`);
  });
  test("childrenOf and the modal graph still answer correctly", () => {
    const state = run(withWindows(["a"]), { type: "window/create", id: "d", parent: "a", role: "dialog", modal: true }, { type: "window/create", id: "d2", parent: "d", role: "dialog", modal: true });
    assert.deepEqual(presentationContext(state).blocked.sort(), ["a", "d"]);
  });
});
