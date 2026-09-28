import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  update,
  reduce,
  replay,
  COMMANDS,
  focusedWindow,
  stackingOrder,
  isBlocked,
  windowsIn,
  bspIds,
} from "../src/index.mjs";

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};

const withWindows = (ids, options = {}) =>
  replay(
    createState(options),
    ids.map((id) => ({ type: "window/create", id, title: id.toUpperCase() })),
  );

describe("update: purity and protocol", () => {
  test("update never mutates its input", () => {
    const state = deepFreeze(withWindows(["a", "b"]));
    for (const command of [
      { type: "window/create", id: "c" },
      { type: "window/close", id: "a" },
      { type: "window/focus", id: "a" },
      { type: "window/move", id: "a", x: 5, y: 5 },
      { type: "window/set-mode", id: "a", mode: "floating" },
      { type: "layout/set", layout: { type: "bsp" } },
      { type: "workspace/create", id: "dev", activate: true },
    ]) {
      assert.doesNotThrow(() => update(state, command), command.type);
    }
  });

  test("returns state, events and effects", () => {
    const out = update(createState(), { type: "window/create", id: "a" });
    assert.ok(out.state.windows.a);
    assert.deepEqual(
      out.events.map((e) => e.type),
      ["window/created", "window/focused"],
    );
    assert.deepEqual(out.effects, [{ type: "render" }, { type: "focus", id: "a" }]);
  });

  test("unknown and malformed commands are rejected, not thrown", () => {
    const state = createState();
    const out = update(state, { type: "nope" });
    assert.equal(out.state, state);
    assert.deepEqual(out.events, [{ type: "command/rejected", command: "nope", id: undefined, reason: "unknown-command" }]);
    assert.equal(update(state, null).events[0].reason, "invalid-command");
  });

  test("extensions can add commands", () => {
    const out = update(createState(), { type: "custom/hello" }, {
      "custom/hello": (state) => ({ state: { ...state, hello: true } }),
    });
    assert.equal(out.state.hello, true);
  });

  test("state is JSON-serializable and replay is deterministic", () => {
    const commands = [
      { type: "window/create", id: "a" },
      { type: "window/create", id: "b" },
      { type: "window/set-mode", id: "b", mode: "floating" },
      { type: "window/move", id: "b", x: 10, y: 20 },
      { type: "layout/set-ratio", ratio: 0.7 },
    ];
    const one = replay(createState(), commands);
    const two = replay(createState(), commands);
    assert.deepEqual(one, two);
    assert.deepEqual(JSON.parse(JSON.stringify(one)), one);
  });

  test("COMMANDS lists the built-in vocabulary", () => {
    assert.ok(COMMANDS.includes("window/create"));
    assert.ok(COMMANDS.includes("layout/set-ratio"));
  });
});

describe("windows", () => {
  test("create appends to the workspace, stacks and focuses", () => {
    const state = withWindows(["a", "b"]);
    assert.deepEqual(state.workspaces.main.windows, ["a", "b"]);
    assert.deepEqual(state.stack.normal, ["a", "b"]);
    assert.equal(focusedWindow(state).id, "b");
    assert.equal(state.windows.a.mode, "tiled");
  });

  test("duplicate ids, unknown parents and unknown workspaces are rejected", () => {
    const state = withWindows(["a"]);
    assert.equal(update(state, { type: "window/create", id: "a" }).events[0].reason, "duplicate-id");
    assert.equal(update(state, { type: "window/create", id: "x", parent: "zz" }).events[0].reason, "unknown-parent");
    assert.equal(update(state, { type: "window/create", id: "x", workspace: "zz" }).events[0].reason, "unknown-workspace");
    assert.equal(update(state, { type: "window/create" }).events[0].reason, "missing-id");
  });

  test("focus: false creates without focusing", () => {
    const state = reduce(withWindows(["a"]), { type: "window/create", id: "b", focus: false });
    assert.equal(state.focus.window, "a");
  });

  test("close falls back to the previously focused window", () => {
    let state = withWindows(["a", "b", "c"]);
    state = reduce(state, { type: "window/focus", id: "a" });
    state = reduce(state, { type: "window/focus", id: "c" });
    state = reduce(state, { type: "window/close", id: "c" });
    assert.equal(state.focus.window, "a");
    assert.deepEqual(state.workspaces.main.windows, ["a", "b"]);
    assert.ok(!stackingOrder(state).includes("c"));
  });

  test("closing a parent cascades to its children", () => {
    let state = withWindows(["editor"]);
    state = reduce(state, { type: "window/create", id: "save", role: "dialog", parent: "editor", modal: true });
    state = reduce(state, { type: "window/create", id: "confirm", role: "dialog", parent: "save", modal: true });
    const out = update(state, { type: "window/close", id: "editor" });
    assert.deepEqual(Object.keys(out.state.windows), []);
    assert.deepEqual(
      out.events.filter((e) => e.type === "window/closed").map((e) => e.id),
      ["confirm", "save", "editor"],
    );
    assert.equal(out.state.focus.window, null);
  });

  test("move and resize store requested geometry; resize honours constraints", () => {
    let state = reduce(createState(), {
      type: "window/create",
      id: "a",
      mode: "floating",
      constraints: { minWidth: 320, maxHeight: 400 },
    });
    state = reduce(state, { type: "window/move", id: "a", x: 12, y: 34 });
    state = reduce(state, { type: "window/resize", id: "a", width: 100, height: 900 });
    assert.deepEqual(state.windows.a.placement, { x: 12, y: 34, width: 320, height: 400 });
  });

  test("status changes; minimizing refocuses", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/minimize", id: "b" });
    assert.equal(state.windows.b.status, "minimized");
    assert.equal(state.focus.window, "a");
    state = reduce(state, { type: "window/focus", id: "b" });
    assert.equal(state.windows.b.status, "normal");
    state = reduce(state, { type: "window/maximize", id: "b" });
    assert.equal(state.windows.b.status, "maximized");
    state = reduce(state, { type: "window/restore", id: "b" });
    assert.equal(state.windows.b.status, "normal");
  });

  test("swap and promote reorder the workspace", () => {
    let state = withWindows(["a", "b", "c"]);
    state = reduce(state, { type: "window/swap", a: "a", b: "c" });
    assert.deepEqual(state.workspaces.main.windows, ["c", "b", "a"]);
    state = reduce(state, { type: "window/promote", id: "b" });
    assert.deepEqual(state.workspaces.main.windows, ["b", "c", "a"]);
  });

  test("set-title and set-constraints", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "window/set-title", id: "a", title: "Terminal" });
    state = reduce(state, { type: "window/set-constraints", id: "a", constraints: { maxWidth: 100 } });
    assert.equal(state.windows.a.title, "Terminal");
    assert.equal(state.windows.a.placement.width, 100);
  });
});

describe("focus, stacking and modality", () => {
  test("focus is not the same as stacking unless policy says so", () => {
    let state = withWindows(["a", "b"], { config: { focusRaises: false } });
    state = reduce(state, { type: "window/focus", id: "a" });
    assert.equal(state.focus.window, "a");
    assert.deepEqual(state.stack.normal, ["a", "b"]);
    state = reduce(state, { type: "window/raise", id: "a" });
    assert.deepEqual(state.stack.normal, ["b", "a"]);
    state = reduce(state, { type: "window/lower", id: "a" });
    assert.deepEqual(state.stack.normal, ["a", "b"]);
  });

  test("focusRaises policy raises on focus", () => {
    const state = reduce(withWindows(["a", "b"]), { type: "window/focus", id: "a" });
    assert.deepEqual(state.stack.normal, ["b", "a"]);
  });

  test("layers order stacking independently of creation", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "window/create", id: "note", role: "notification" });
    state = reduce(state, { type: "window/create", id: "b" });
    assert.deepEqual(stackingOrder(state), ["a", "b", "note"]);
    state = reduce(state, { type: "window/set-layer", id: "b", layer: "system" });
    assert.deepEqual(stackingOrder(state), ["a", "note", "b"]);
    assert.equal(update(state, { type: "window/set-layer", id: "b", layer: "nope" }).events[0].reason, "unknown-layer");
  });

  test("modal graph redirects focus to the deepest modal descendant", () => {
    let state = withWindows(["editor", "other"]);
    state = reduce(state, { type: "window/create", id: "save", role: "dialog", parent: "editor", modal: true });
    state = reduce(state, { type: "window/create", id: "confirm", role: "dialog", parent: "save", modal: true });
    assert.ok(isBlocked(state, "editor"));
    assert.ok(isBlocked(state, "save"));
    assert.ok(!isBlocked(state, "confirm"));
    state = reduce(state, { type: "window/focus", id: "other" });
    const out = update(state, { type: "window/focus", id: "editor" });
    assert.equal(out.state.focus.window, "confirm");
    assert.ok(out.events.some((e) => e.type === "focus/redirected" && e.requested === "editor"));
  });

  test("dialogs and popovers default to floating in higher layers", () => {
    let state = withWindows(["editor"]);
    state = reduce(state, { type: "window/create", id: "save", role: "dialog", parent: "editor", modal: true });
    state = reduce(state, { type: "window/create", id: "menu", role: "menu", parent: "editor" });
    assert.equal(state.windows.save.mode, "floating");
    assert.equal(state.windows.save.layer, "modal");
    assert.equal(state.windows.menu.layer, "popover");
  });

  test("focus cycles through focusable windows, skipping blocked ones", () => {
    let state = withWindows(["a", "b", "c"]);
    state = reduce(state, { type: "focus/next" });
    assert.equal(state.focus.window, "a");
    state = reduce(state, { type: "focus/previous" });
    assert.equal(state.focus.window, "c");
    state = reduce(state, { type: "window/create", id: "d", role: "dialog", parent: "a", modal: true });
    state = reduce(state, { type: "window/focus", id: "b" });
    state = reduce(state, { type: "focus/previous" });
    assert.equal(state.focus.window, "d");
  });

  test("blur clears focus", () => {
    const state = reduce(withWindows(["a"]), { type: "window/blur" });
    assert.equal(state.focus.window, null);
  });
});

describe("workspaces", () => {
  test("create, activate, and move windows between workspaces", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "workspace/create", id: "dev" });
    assert.deepEqual(state.workspaceOrder, ["main", "dev"]);
    state = reduce(state, { type: "window/move-to-workspace", id: "b", workspace: "dev" });
    assert.deepEqual(state.workspaces.main.windows, ["a"]);
    assert.deepEqual(state.workspaces.dev.windows, ["b"]);
    assert.equal(state.focus.window, "a");
    state = reduce(state, { type: "workspace/activate", id: "dev" });
    assert.equal(state.activeWorkspace, "dev");
    assert.equal(state.focus.window, "b");
  });

  test("focusing a window on another workspace activates it", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "workspace/create", id: "dev" });
    state = reduce(state, { type: "window/create", id: "x", workspace: "dev" });
    assert.equal(state.focus.window, "a");
    state = reduce(state, { type: "window/focus", id: "x" });
    assert.equal(state.activeWorkspace, "dev");
  });

  test("children move with their parent", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "window/create", id: "d", role: "dialog", parent: "a" });
    state = reduce(state, { type: "workspace/create", id: "dev" });
    state = reduce(state, { type: "window/move-to-workspace", id: "a", workspace: "dev" });
    assert.deepEqual(windowsIn(state, "dev").map((w) => w.id), ["a", "d"]);
  });

  test("removing a workspace moves its windows to a fallback", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "workspace/create", id: "dev", activate: true });
    state = reduce(state, { type: "window/create", id: "x" });
    state = reduce(state, { type: "workspace/remove", id: "dev" });
    assert.deepEqual(state.workspaceOrder, ["main"]);
    assert.deepEqual(state.workspaces.main.windows, ["a", "x"]);
    assert.equal(state.activeWorkspace, "main");
    assert.equal(update(state, { type: "workspace/remove", id: "main" }).events[0].reason, "last-workspace");
  });
});

describe("layouts in state", () => {
  test("set-ratio updates master-stack ratio (clamped)", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "layout/set-ratio", ratio: 0.65 });
    assert.equal(state.workspaces.main.layout.ratio, 0.65);
    state = reduce(state, { type: "layout/set-ratio", ratio: 5 });
    assert.equal(state.workspaces.main.layout.ratio, 0.95);
  });

  test("switching to bsp seeds a tree; create/close/float maintain it", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "layout/set", layout: { type: "bsp" } });
    assert.deepEqual(bspIds(state.workspaces.main.layout.tree), ["a", "b"]);
    state = reduce(state, { type: "window/create", id: "c" });
    assert.deepEqual(bspIds(state.workspaces.main.layout.tree), ["a", "b", "c"]);
    state = reduce(state, { type: "window/set-mode", id: "b", mode: "floating" });
    assert.deepEqual(bspIds(state.workspaces.main.layout.tree), ["a", "c"]);
    state = reduce(state, { type: "window/toggle-floating", id: "b" });
    assert.ok(bspIds(state.workspaces.main.layout.tree).includes("b"));
    state = reduce(state, { type: "window/close", id: "a" });
    assert.ok(!bspIds(state.workspaces.main.layout.tree).includes("a"));
    state = reduce(state, { type: "layout/set-ratio", id: "c", ratio: 0.3 });
    state = reduce(state, { type: "layout/rotate-split", id: "c" });
    assert.equal(state.workspaces.main.layout.tree.ratio, 0.3);
  });

  test("invalid layouts are rejected", () => {
    assert.equal(update(createState(), { type: "layout/set", layout: {} }).events[0].reason, "invalid-layout");
    assert.equal(update(createState(), { type: "layout/rotate-split" }).events[0].reason, "not-bsp");
  });

  test("config/set merges configuration", () => {
    const state = reduce(createState(), { type: "config/set", gap: 8 });
    assert.equal(state.config.gap, 8);
    assert.equal(state.config.focusRaises, true);
  });
});
