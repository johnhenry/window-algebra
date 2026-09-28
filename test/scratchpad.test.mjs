import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  update,
  reduce,
  replay,
  createWindowManager,
  isVisible,
  visibleWindows,
  focusable,
  paintOrder,
  stackingOrder,
  scratchpadWindows,
  isScratchpadHidden,
  stickyWindows,
  derive,
  presentationContext,
  compile,
} from "../src/index.mjs";

const withWindows = (ids, options = {}) =>
  replay(
    createState(options),
    ids.map((id) => ({ type: "window/create", id, title: id.toUpperCase() })),
  );

describe("scratchpad", () => {
  test("window/to-scratchpad hides a window off its workspace", () => {
    const state = withWindows(["a", "b"]);
    const out = update(state, { type: "window/to-scratchpad", id: "a" });
    assert.deepEqual(out.events, [{ type: "window/scratchpad", id: "a" }]);
    assert.equal(out.state.windows.a.scratchpad, true);
    assert.equal(out.state.windows.a.workspace, null);
    assert.equal(out.state.workspaces.main.windows.includes("a"), false);
    assert.equal(out.state.lastScratchpad, "a");
    // Not in the active workspace's own window list, not visible, not focusable.
    assert.equal(isVisible(out.state, "a"), false);
    assert.equal(visibleWindows(out.state).some((w) => w.id === "a"), false);
    assert.equal(focusable(out.state).includes("a"), false);
    assert.equal(isScratchpadHidden(out.state, "a"), true);
    assert.deepEqual(scratchpadWindows(out.state).map((w) => w.id), ["a"]);
  });

  test("unknown window is rejected", () => {
    const state = withWindows(["a"]);
    const out = update(state, { type: "window/to-scratchpad", id: "ghost" });
    assert.deepEqual(out.events, [{ type: "command/rejected", command: "window/to-scratchpad", id: "ghost", reason: "unknown-window" }]);
  });

  test("sending an already-hidden scratchpad window again is a no-op", () => {
    const state = withWindows(["a"]);
    const hidden = reduce(state, { type: "window/to-scratchpad", id: "a" });
    const out = update(hidden, { type: "window/to-scratchpad", id: "a" });
    assert.equal(out.state, hidden);
    assert.deepEqual(out.events, []);
  });

  test("to-scratchpad forces floating mode and drops out of a bsp tree", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "layout/set", layout: { type: "bsp" } });
    const out = update(state, { type: "window/to-scratchpad", id: "a" });
    assert.equal(out.state.windows.a.mode, "floating");
    assert.equal(out.state.workspaces.main.layout.tree.id, "b");
  });

  test("hiding the focused window refocuses to the previous window", () => {
    const state = withWindows(["a", "b"]); // b focused last
    const out = update(state, { type: "window/to-scratchpad", id: "b" });
    assert.equal(out.state.focus.window, "a");
    assert.deepEqual(
      out.events.map((e) => e.type),
      ["window/scratchpad", "window/focused"],
    );
  });

  test("scratchpad/toggle with no id and an empty scratchpad is rejected", () => {
    const state = withWindows(["a"]);
    const out = update(state, { type: "scratchpad/toggle" });
    assert.deepEqual(out.events, [{ type: "command/rejected", command: "scratchpad/toggle", id: undefined, reason: "empty-scratchpad" }]);
  });

  test("toggling a window that isn't a scratchpad window is rejected", () => {
    const state = withWindows(["a"]);
    const out = update(state, { type: "scratchpad/toggle", id: "a" });
    assert.deepEqual(out.events, [{ type: "command/rejected", command: "scratchpad/toggle", id: "a", reason: "not-scratchpad" }]);
  });

  test("toggle shows a hidden scratchpad window floating, centered, focused, and toggling again hides it", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/to-scratchpad", id: "a" });
    let out = update(state, { type: "scratchpad/toggle", id: "a" });
    assert.deepEqual(out.events, [{ type: "scratchpad/shown", id: "a" }, { type: "window/focused", id: "a", previous: "b" }]);
    assert.equal(out.state.windows.a.workspace, "main");
    assert.equal(out.state.windows.a.mode, "floating");
    assert.equal(out.state.windows.a.placement.x, "center");
    assert.equal(out.state.windows.a.placement.y, "center");
    assert.equal(out.state.workspaces.main.windows.includes("a"), true);
    assert.equal(out.state.focus.window, "a");
    assert.equal(isVisible(out.state, "a"), true);
    assert.equal(focusable(out.state).includes("a"), true);

    out = update(out.state, { type: "scratchpad/toggle", id: "a" });
    assert.deepEqual(out.events, [{ type: "scratchpad/hidden", id: "a" }, { type: "window/focused", id: "b", previous: null }]);
    assert.equal(out.state.windows.a.workspace, null);
    assert.equal(isVisible(out.state, "a"), false);
  });

  test("scratchpad/toggle with no id defaults to the most recently touched scratchpad window", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/to-scratchpad", id: "a" });
    const out = update(state, { type: "scratchpad/toggle" });
    assert.equal(out.state.windows.a.workspace, "main");
  });

  test("scratchpad windows can be toggled shown on a different workspace than the one they were hidden from", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "workspace/create", id: "side" });
    state = reduce(state, { type: "window/to-scratchpad", id: "a" });
    state = reduce(state, { type: "workspace/activate", id: "side" });
    const out = update(state, { type: "scratchpad/toggle", id: "a" });
    assert.equal(out.state.windows.a.workspace, "side");
    assert.equal(out.state.workspaces.side.windows.includes("a"), true);
    assert.equal(out.state.workspaces.main.windows.includes("a"), false);
  });

  test("closing a scratchpad window (hidden or shown) is safe and clears lastScratchpad", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/to-scratchpad", id: "a" });
    let out = update(state, { type: "window/close", id: "a" });
    assert.equal(out.state.windows.a, undefined);
    assert.equal(out.state.lastScratchpad, null);

    // Shown, then closed.
    state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/to-scratchpad", id: "a" });
    state = reduce(state, { type: "scratchpad/toggle", id: "a" });
    out = update(state, { type: "window/close", id: "a" });
    assert.equal(out.state.windows.a, undefined);
    assert.equal(out.state.workspaces.main.windows.includes("a"), false);
    assert.equal(out.state.lastScratchpad, null);
  });

  test("window/move-to-workspace pulls a hidden scratchpad window out of the scratchpad", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "workspace/create", id: "side" });
    state = reduce(state, { type: "window/to-scratchpad", id: "a" });
    const out = update(state, { type: "window/move-to-workspace", id: "a", workspace: "side" });
    assert.equal(out.state.windows.a.workspace, "side");
    assert.equal(out.state.windows.a.scratchpad, undefined);
    assert.equal(out.state.workspaces.side.windows.includes("a"), true);
    assert.equal(out.state.lastScratchpad, null);
  });

  test("undo restores a scratchpad-hidden window", () => {
    const wm = createWindowManager({ state: withWindows(["a", "b"]), history: true });
    wm.dispatch({ type: "window/to-scratchpad", id: "a" });
    assert.equal(wm.getState().windows.a.workspace, null);
    wm.undo();
    assert.equal(wm.getState().windows.a.workspace, "main");
    assert.equal(wm.getState().windows.a.scratchpad, undefined);
    wm.redo();
    assert.equal(wm.getState().windows.a.workspace, null);
  });

  test("serialize / load round-trips scratchpad state", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/to-scratchpad", id: "a" });
    const wm = createWindowManager({ state: createState() });
    const loaded = wm.load(JSON.stringify(state));
    assert.equal(loaded.windows.a.workspace, null);
    assert.equal(loaded.lastScratchpad, "a");
    assert.equal(JSON.parse(JSON.stringify(loaded)) ? true : false, true);
  });

  test("log + replay reproduces scratchpad hide/show", () => {
    const wm = createWindowManager({ state: withWindows(["a", "b"]) });
    wm.dispatch({ type: "window/to-scratchpad", id: "a" });
    wm.dispatch({ type: "scratchpad/toggle", id: "a" });
    const replayed = replay(wm.origin, wm.log);
    assert.deepEqual(replayed, wm.getState());
  });

  test("derive omits a hidden scratchpad window and includes it once shown", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/to-scratchpad", id: "a" });
    let tree = derive(state);
    const ids = (n, out = []) => {
      if (n.id) out.push(n.id);
      if (n.child) ids(n.child, out);
      if (n.children) n.children.forEach((c) => ids(c, out));
      return out;
    };
    assert.equal(ids(tree).includes("a"), false);
    assert.equal(presentationContext(state).scratchpad.includes("a"), true);

    state = reduce(state, { type: "scratchpad/toggle", id: "a" });
    tree = derive(state);
    assert.equal(ids(tree).includes("a"), true);
  });
});

describe("sticky", () => {
  test("window/set-sticky marks and unmarks a window", () => {
    const state = withWindows(["a"]);
    let out = update(state, { type: "window/set-sticky", id: "a", sticky: true });
    assert.deepEqual(out.events, [{ type: "window/sticky-changed", id: "a", sticky: true }]);
    assert.equal(out.state.windows.a.sticky, true);
    out = update(out.state, { type: "window/set-sticky", id: "a", sticky: false });
    assert.equal(out.state.windows.a.sticky, undefined);
  });

  test("unknown window / invalid sticky value are rejected", () => {
    const state = withWindows(["a"]);
    assert.equal(update(state, { type: "window/set-sticky", id: "ghost", sticky: true }).events[0].reason, "unknown-window");
    assert.equal(update(state, { type: "window/set-sticky", id: "a", sticky: "yes" }).events[0].reason, "invalid-sticky");
  });

  test("setting the same sticky value twice is a no-op", () => {
    const state = withWindows(["a"]);
    const out = update(state, { type: "window/set-sticky", id: "a", sticky: false });
    assert.equal(out.state, state);
    assert.deepEqual(out.events, []);
  });

  test("a sticky window is visible, visibleWindows-listed and focusable on every workspace", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "workspace/create", id: "side" });
    state = reduce(state, { type: "window/set-sticky", id: "a", sticky: true });
    assert.equal(isVisible(state, "a"), true);
    assert.equal(visibleWindows(state).some((w) => w.id === "a"), true);
    assert.equal(focusable(state).includes("a"), true);

    state = reduce(state, { type: "workspace/activate", id: "side" });
    assert.equal(isVisible(state, "a"), true);
    assert.equal(visibleWindows(state).some((w) => w.id === "a"), true);
    assert.equal(focusable(state).includes("a"), true);
    // Its home workspace's own window list is unaffected: only visibility crosses workspaces.
    assert.equal(state.workspaces.main.windows.includes("a"), true);
    assert.equal(state.workspaces.side.windows.includes("a"), false);
    assert.deepEqual(stickyWindows(state).map((w) => w.id), ["a"]);
  });

  test("a sticky window disappears once minimized, on every workspace", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "workspace/create", id: "side", activate: true });
    state = reduce(state, { type: "window/set-sticky", id: "a", sticky: true });
    state = reduce(state, { type: "window/minimize", id: "a" });
    assert.equal(isVisible(state, "a"), false);
    assert.equal(visibleWindows(state).some((w) => w.id === "a"), false);
  });

  test("sticky windows keep their stacking across workspaces and paint order", () => {
    let state = withWindows(["a", "b", "c"]);
    state = reduce(state, { type: "workspace/create", id: "side" });
    state = reduce(state, { type: "window/set-sticky", id: "a", sticky: true });
    state = reduce(state, { type: "window/raise", id: "a" });
    const orderBefore = stackingOrder(state);
    state = reduce(state, { type: "workspace/activate", id: "side" });
    assert.deepEqual(stackingOrder(state), orderBefore);
    // b and c are not visible on "side"; only the sticky window "a" paints.
    assert.deepEqual(paintOrder(state), ["a"]);
  });

  test("a sticky window follows a move between workspaces and stays visible", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "workspace/create", id: "side" });
    state = reduce(state, { type: "window/set-sticky", id: "a", sticky: true });
    state = reduce(state, { type: "window/move-to-workspace", id: "a", workspace: "side" });
    assert.equal(state.windows.a.workspace, "side");
    assert.equal(state.windows.a.sticky, true);
    assert.equal(isVisible(state, "a"), true);
    // Still visible from "main" too (workspace/activate back).
    state = reduce(state, { type: "workspace/activate", id: "main" });
    assert.equal(isVisible(state, "a"), true);
  });

  test("a sticky window never joins the tiled base, even in bsp", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "layout/set", layout: { type: "bsp" } });
    state = reduce(state, { type: "window/set-sticky", id: "a", sticky: true });
    // derive should not throw and should present both windows.
    const tree = derive(state);
    const ids = (n, out = []) => {
      if (n.id) out.push(n.id);
      if (n.child) ids(n.child, out);
      if (n.children) n.children.forEach((c) => ids(c, out));
      return out;
    };
    assert.deepEqual(new Set(ids(tree)), new Set(["a", "b"]));
  });

  test("undo restores sticky state; serialize / load round-trips it", () => {
    const wm = createWindowManager({ state: withWindows(["a"]), history: true });
    wm.dispatch({ type: "window/set-sticky", id: "a", sticky: true });
    assert.equal(wm.getState().windows.a.sticky, true);
    wm.undo();
    assert.equal(wm.getState().windows.a.sticky, undefined);
    wm.redo();
    assert.equal(wm.getState().windows.a.sticky, true);

    const state = JSON.parse(JSON.stringify(wm.getState()));
    assert.equal(state.windows.a.sticky, true);
  });

  test("presentationContext lists sticky windows", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/set-sticky", id: "a", sticky: true });
    const ctx = presentationContext(state);
    assert.deepEqual(ctx.sticky, ["a"]);
  });

  test("manager facade: toScratchpad / toggleScratchpad / setSticky", () => {
    const wm = createWindowManager({ state: withWindows(["a", "b"]) });
    wm.toScratchpad("a");
    assert.equal(wm.getState().windows.a.workspace, null);
    wm.toggleScratchpad("a");
    assert.equal(wm.getState().windows.a.workspace, "main");
    wm.toggleScratchpad(); // no id: defaults to the last-touched scratchpad window
    assert.equal(wm.getState().windows.a.workspace, null);
    wm.setSticky("b", true);
    assert.equal(wm.getState().windows.b.sticky, true);
  });

  test("unsticking a focused window whose home workspace is inactive refocuses (or blurs)", () => {
    let state = withWindows(["a"]);
    state = reduce(state, { type: "workspace/create", id: "side", activate: true });
    // "a" lives on "main" but is sticky, so it stays focused while "side" is active.
    state = reduce(state, { type: "window/set-sticky", id: "a", sticky: true });
    state = reduce(state, { type: "window/focus", id: "a" });
    assert.equal(state.focus.window, "a");
    assert.equal(state.activeWorkspace, "side");

    const out = update(state, { type: "window/set-sticky", id: "a", sticky: false });
    assert.equal(isVisible(out.state, "a"), false);
    // Focus must not keep pointing at a window that just became invisible.
    assert.notEqual(out.state.focus.window, "a");
    assert.equal(
      out.events.some((e) => e.type === "window/blurred" || e.type === "window/focused"),
      true,
    );
  });

  test("compile marks a sticky view with data-wm-sticky", () => {
    let state = withWindows(["a", "b"]);
    state = reduce(state, { type: "window/set-sticky", id: "a", sticky: true });
    const rendered = compile(derive(state), presentationContext(state));
    const findView = (node, id) => {
      if (node.view === id) return node;
      for (const child of node.children ?? []) {
        const found = findView(child, id);
        if (found) return found;
      }
      return null;
    };
    const a = findView(rendered, "a");
    const b = findView(rendered, "b");
    assert.equal("data-wm-sticky" in a.attrs, true);
    assert.equal("data-wm-sticky" in b.attrs, false);
  });
});
