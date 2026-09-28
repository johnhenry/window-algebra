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
  isVisible,
  isPoppedOut,
  poppedOutWindows,
  windowsIn,
  bspIds,
  urgentWindows,
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

  test("pop-out/pop-in: leaves the layout like minimize, refocuses, round-trips", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/pop-out", id: "b" });
    assert.equal(state.windows.b.status, "popped-out");
    // Like minimizing: the popped-out window disappears and focus moves on.
    assert.equal(state.focus.window, "a");
    assert.deepEqual(windowsIn(state).filter((w) => isVisible(state, w.id)).map((w) => w.id), ["a"]);
    state = reduce(state, { type: "window/pop-in", id: "b" });
    assert.equal(state.windows.b.status, "normal");
  });

  test("pop-out: no-op when already popped out; rejects unknown-window and blocked", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/pop-out", id: "b" });
    const same = update(state, { type: "window/pop-out", id: "b" });
    assert.equal(same.state, state);
    assert.deepEqual(same.events, []);

    const missing = update(state, { type: "window/pop-out", id: "zz" });
    assert.deepEqual(missing.events, [{ type: "command/rejected", command: "window/pop-out", id: "zz", reason: "unknown-window" }]);

    const blockedState = reduce(state, { type: "window/create", id: "m", role: "dialog", modal: true, parent: "a" });
    const blocked = update(blockedState, { type: "window/pop-out", id: "a" });
    assert.deepEqual(blocked.events, [{ type: "command/rejected", command: "window/pop-out", id: "a", reason: "blocked" }]);
  });

  test("pop-in: rejects unknown-window and a window that is not popped out", () => {
    const state = withWindows(["a"]);
    const missing = update(state, { type: "window/pop-in", id: "zz" });
    assert.deepEqual(missing.events, [{ type: "command/rejected", command: "window/pop-in", id: "zz", reason: "unknown-window" }]);
    const notPopped = update(state, { type: "window/pop-in", id: "a" });
    assert.deepEqual(notPopped.events, [{ type: "command/rejected", command: "window/pop-in", id: "a", reason: "not-popped-out" }]);
  });

  test("popped-out windows are excluded from tiled drops, like minimized ones", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/pop-out", id: "b" });
    assert.equal(update(state, { type: "window/drop", id: "a", target: "b", zone: "center" }).events[0].reason, "not-tiled");
  });

  test("COMMANDS lists window/pop-out and window/pop-in", () => {
    assert.ok(COMMANDS.includes("window/pop-out"));
    assert.ok(COMMANDS.includes("window/pop-in"));
  });

  test("isPoppedOut / poppedOutWindows; a popped-out modal child no longer blocks its parent", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "window/create", id: "m", role: "dialog", modal: true, parent: "a" });
    assert.equal(isBlocked(state, "a"), true);
    assert.equal(isPoppedOut(state, "m"), false);
    state = reduce(state, { type: "window/pop-out", id: "m" });
    assert.equal(isPoppedOut(state, "m"), true);
    assert.deepEqual(poppedOutWindows(state).map((w) => w.id), ["m"]);
    assert.equal(isBlocked(state, "a"), false, "a popped-out modal is 'visible elsewhere', not blocking");
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

  test("size hints: window/resize honours aspectRatio and width/height increments", () => {
    let state = reduce(createState(), {
      type: "window/create",
      id: "a",
      mode: "floating",
      constraints: { widthIncrement: 10, heightIncrement: 20, baseWidth: 0, baseHeight: 0 },
    });
    state = reduce(state, { type: "window/resize", id: "a", width: 84, height: 28 });
    // 84 -> nearest multiple of 10 (80); 28 -> nearest multiple of 20 (20).
    assert.deepEqual(state.windows.a.placement.width, 80);
    assert.deepEqual(state.windows.a.placement.height, 20);

    state = reduce(state, {
      type: "window/set-constraints",
      id: "a",
      constraints: { aspectRatio: 1, widthIncrement: undefined, heightIncrement: undefined },
    });
    state = reduce(state, { type: "window/resize", id: "a", width: 200, height: 50 });
    // aspectRatio 1 forces a square; height changes less (50 -> 50 stays, width recomputed) or vice versa —
    // either way width and height end up equal.
    assert.equal(state.windows.a.placement.width, state.windows.a.placement.height);
  });

  test("size hints: window/set-constraints immediately re-clamps the stored placement", () => {
    let state = reduce(createState(), { type: "window/create", id: "a", mode: "floating", placement: { width: 87, height: 42 } });
    state = reduce(state, { type: "window/set-constraints", id: "a", constraints: { widthIncrement: 10, heightIncrement: 20 } });
    assert.deepEqual(state.windows.a.placement.width, 90);
    assert.deepEqual(state.windows.a.placement.height, 40);
  });

  test("size hints: window/detach honours aspectRatio too", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/set-constraints", id: "a", constraints: { aspectRatio: 1 } });
    state = reduce(state, { type: "window/detach", id: "a", width: 200, height: 50 });
    assert.equal(state.windows.a.mode, "floating");
    assert.equal(state.windows.a.placement.width, state.windows.a.placement.height);
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

describe("urgency hint", () => {
  test("window/set-urgent marks and clears; defaults to true", () => {
    let state = withWindows(["a", "b"]);
    let out = update(state, { type: "window/set-urgent", id: "a" });
    assert.deepEqual(urgentWindows(out.state), ["a"]);
    assert.ok(out.events.some((e) => e.type === "window/urgent-changed" && e.id === "a" && e.urgent === true));

    state = reduce(out.state, { type: "window/set-urgent", id: "b", urgent: true });
    assert.deepEqual(urgentWindows(state), ["a", "b"]);

    out = update(state, { type: "window/set-urgent", id: "a", urgent: false });
    assert.deepEqual(urgentWindows(out.state), ["b"]);
    assert.ok(out.events.some((e) => e.type === "window/urgent-changed" && e.id === "a" && e.urgent === false));
  });

  test("window/set-urgent is a no-op when the state would not change", () => {
    const state = withWindows(["a"]);
    const out = update(state, { type: "window/set-urgent", id: "a", urgent: false });
    assert.equal(out.state, state);
    assert.deepEqual(out.events, []);
  });

  test("window/set-urgent rejects unknown windows and non-boolean urgent", () => {
    const state = withWindows(["a"]);
    assert.equal(update(state, { type: "window/set-urgent", id: "nope" }).events[0].reason, "unknown-window");
    assert.equal(update(state, { type: "window/set-urgent", id: "a", urgent: "yes" }).events[0].reason, "invalid-urgent");
  });

  test("focusing an urgent window clears its urgency (config.urgency.clearOnFocus)", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/set-urgent", id: "b" });
    const out = update(state, { type: "window/focus", id: "b" });
    assert.deepEqual(urgentWindows(out.state), []);
    assert.ok(out.events.some((e) => e.type === "window/urgent-changed" && e.id === "b" && e.urgent === false));
  });

  test("config.urgency.clearOnFocus: false keeps the hint on focus", () => {
    let state = withWindows(["a", "b"], { config: { urgency: { clearOnFocus: false } } });
    state = reduce(state, { type: "window/set-urgent", id: "b" });
    const out = update(state, { type: "window/focus", id: "b" });
    assert.deepEqual(urgentWindows(out.state), ["b"]);
    assert.ok(!out.events.some((e) => e.type === "window/urgent-changed"));
  });

  test("focus/urgent focuses the oldest urgent window, switching workspace if needed", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "workspace/create", id: "side", activate: true });
    state = reduce(state, { type: "window/set-urgent", id: "a" });
    state = reduce(state, { type: "window/set-urgent", id: "b" });
    assert.equal(state.activeWorkspace, "side");

    const out = update(state, { type: "focus/urgent" });
    assert.equal(out.state.focus.window, "a");
    assert.equal(out.state.activeWorkspace, "main");
    assert.deepEqual(urgentWindows(out.state), ["b"]);
    assert.ok(out.events.some((e) => e.type === "workspace/activated" && e.id === "main"));
  });

  test("focus/urgent is rejected when nothing is urgent", () => {
    const state = withWindows(["a"]);
    assert.equal(update(state, { type: "focus/urgent" }).events[0].reason, "no-urgent-window");
  });

  test("closing an urgent window drops it from the urgent list", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/set-urgent", id: "a" });
    state = reduce(state, { type: "window/close", id: "a" });
    assert.deepEqual(urgentWindows(state), []);
  });

  test("invalid config.urgency is rejected", () => {
    assert.equal(update(createState(), { type: "config/set", urgency: "nope" }).events[0].reason, "invalid-config");
    assert.equal(
      update(createState(), { type: "config/set", urgency: { clearOnFocus: "nope" } }).events[0].reason,
      "invalid-config",
    );
  });

  test("config.snap defaults and merges one level deep, like drag and urgency", () => {
    assert.deepEqual(createState().config.snap, { edges: true, threshold: 16, magnet: 8, zones: "halves-quarters" });
    const out = update(createState(), { type: "config/set", snap: { magnet: 0 } });
    assert.deepEqual(out.state.config.snap, { edges: true, threshold: 16, magnet: 0, zones: "halves-quarters" });
  });

  test("invalid config.snap is rejected", () => {
    const reason = (patch) => update(createState(), { type: "config/set", snap: patch }).events[0].reason;
    assert.equal(update(createState(), { type: "config/set", snap: "nope" }).events[0].reason, "invalid-config");
    assert.equal(reason({ edges: "nope" }), "invalid-config");
    assert.equal(reason({ threshold: -1 }), "invalid-config");
    assert.equal(reason({ magnet: -1 }), "invalid-config");
    assert.equal(reason({ zones: "nope" }), "invalid-config");
    assert.equal(reason({ zones: "halves" }), undefined, "a valid zones value is accepted");
  });

  test("urgency survives serialization and replay", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/set-urgent", id: "b" });
    const restored = JSON.parse(JSON.stringify(state));
    assert.deepEqual(urgentWindows(restored), ["b"]);

    const commands = [
      { type: "window/create", id: "a" },
      { type: "window/create", id: "b" },
      { type: "window/set-urgent", id: "b" },
    ];
    const replayed = replay(createState(), commands);
    assert.deepEqual(urgentWindows(replayed), ["b"]);
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

describe("layout/resize-split", () => {
  test("master-stack: delta and weights both adjust spec.ratio, honouring side", () => {
    let state = withWindows(["a", "b"], { layout: { type: "master-stack", ratio: 0.5 } });
    state = reduce(state, { type: "layout/resize-split", path: "", delta: 0.1 });
    assert.equal(state.workspaces.main.layout.ratio, 0.6);
    state = reduce(state, { type: "layout/resize-split", path: "", weights: [0.3, 0.7] });
    assert.equal(state.workspaces.main.layout.ratio, 0.3);
    // Clamped to [0.05, 0.95].
    state = reduce(state, { type: "layout/resize-split", path: "", delta: -10 });
    assert.equal(state.workspaces.main.layout.ratio, 0.05);

    // side: "right" puts the master second in the DOM, so weights are [rest, master].
    let right = withWindows(["a", "b"], { layout: { type: "master-stack", ratio: 0.5, side: "right" } });
    right = reduce(right, { type: "layout/resize-split", path: "", weights: [0.8, 0.2] });
    assert.equal(right.workspaces.main.layout.ratio, 0.2);
    right = reduce(right, { type: "layout/resize-split", path: "", delta: 0.1 });
    // delta shifts the DOM-first (rest) side; for side: right that shrinks the master.
    assert.equal(right.workspaces.main.layout.ratio, 0.1);
  });

  test("bsp: resize-split addresses a split by its L/R path, independent of layout/set-ratio's id addressing", () => {
    let state = withWindows(["a", "b", "c"], { layout: { type: "bsp" } });
    // bspFrom(["a","b","c"]): root split first=a, second=split(first=b, second=c).
    state = reduce(state, { type: "layout/resize-split", path: "", delta: 0.2 });
    assert.equal(state.workspaces.main.layout.tree.ratio, 0.7);
    state = reduce(state, { type: "layout/resize-split", path: "1", weights: [0.2, 0.8] });
    assert.equal(state.workspaces.main.layout.tree.second.ratio, 0.2);
    // A path that runs into a leaf, or off the tree, is rejected.
    assert.equal(update(state, { type: "layout/resize-split", path: "11", delta: 0.1 }).events[0].reason, "unknown-split");
    assert.equal(update(state, { type: "layout/resize-split", path: "x", delta: 0.1 }).events[0].reason, "invalid-path");
  });

  test("spiral: per-depth ratios override the shared default once resized", () => {
    let state = withWindows(["a", "b", "c"], { layout: { type: "spiral", ratio: 0.5 } });
    state = reduce(state, { type: "layout/resize-split", path: "0", delta: 0.1 });
    assert.deepEqual(state.workspaces.main.layout.ratios, [0.6]);
    // Depth 1 has never been resized: it still falls back to the shared ratio (0.5), plus this delta.
    state = reduce(state, { type: "layout/resize-split", path: "1", delta: 0.1 });
    assert.deepEqual(state.workspaces.main.layout.ratios, [0.6, 0.6]);
    assert.equal(state.workspaces.main.layout.ratio, 0.5); // the shared default itself is untouched
    assert.equal(update(state, { type: "layout/resize-split", path: "-1", delta: 0.1 }).events[0].reason, "invalid-path");
  });

  test("columns/rows: weights replace the full array; delta needs a prior resize", () => {
    let state = withWindows(["a", "b", "c"], { layout: { type: "columns" } });
    // No stored sizes yet: a delta-only resize is rejected...
    assert.equal(update(state, { type: "layout/resize-split", index: 0, delta: 0.1 }).events[0].reason, "missing-weights");
    // ...but explicit weights seed it.
    state = reduce(state, { type: "layout/resize-split", index: 0, weights: [2, 1, 1] });
    assert.deepEqual(state.workspaces.main.layout.sizes, { "": [2, 1, 1] });
    // Now a delta nudges just the addressed pair.
    state = reduce(state, { type: "layout/resize-split", index: 1, delta: 0.5 });
    assert.deepEqual(state.workspaces.main.layout.sizes[""], [2, 1.5, 0.5]);
    // `rows` uses the same scheme.
    let rows = withWindows(["a", "b"], { layout: { type: "rows" } });
    rows = reduce(rows, { type: "layout/resize-split", weights: [3, 1] });
    assert.deepEqual(rows.workspaces.main.layout.sizes, { "": [3, 1] });
  });

  test("rejections: unresizable layouts, unknown workspace, malformed weights/values", () => {
    const state = withWindows(["a", "b"], { layout: { type: "monocle" } });
    const reason = (command) => update(state, command).events[0].reason;
    assert.equal(reason({ type: "layout/resize-split", weights: [1, 1] }), "not-resizable");
    assert.equal(reason({ type: "layout/resize-split", workspace: "nope", delta: 0.1 }), "unknown-workspace");
    assert.equal(reason({ type: "layout/resize-split" }), "missing-value");
    assert.equal(reason({ type: "layout/resize-split", weights: [1] }), "invalid-weights");
    assert.equal(reason({ type: "layout/resize-split", weights: [1, -1] }), "invalid-weights");
    assert.equal(reason({ type: "layout/resize-split", weights: ["x", 1] }), "invalid-weights");
    const cols = withWindows(["a", "b"], { layout: { type: "columns" } });
    assert.equal(update(cols, { type: "layout/resize-split", path: "nope", delta: 0.1 }).events[0].reason, "unknown-split");
  });

  test("never throws and never mutates state", () => {
    const state = deepFreeze(withWindows(["a", "b", "c"], { layout: { type: "bsp" } }));
    for (const command of [
      { type: "layout/resize-split", path: "", delta: 0.1 },
      { type: "layout/resize-split", path: "0", weights: [0.1, 0.9] },
      { type: "layout/resize-split" },
      { type: "layout/resize-split", weights: null },
    ]) {
      assert.doesNotThrow(() => update(state, command));
    }
  });

  test("COMMANDS lists layout/resize-split", () => {
    assert.ok(COMMANDS.includes("layout/resize-split"));
  });

  test("events and effects follow the update() protocol", () => {
    let state = withWindows(["a", "b"], { layout: { type: "master-stack" } });
    const before = state.workspaces.main.layout.ratio;
    const out = update(state, { type: "layout/resize-split", path: "", delta: 0.2 });
    assert.notEqual(out.state.workspaces.main.layout.ratio, before);
    assert.deepEqual(out.events, [{ type: "layout/split-resized", workspace: "main", path: "" }]);
    assert.deepEqual(out.effects, [{ type: "render" }]);
  });
});
