import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  reduce,
  replay,
  derive,
  update,
  views,
  find,
  MODIFIERS,
  MODIFIER_TYPES,
  withModifiers,
  suppressesGaps,
  applyModifiersToOps,
  validModifiers,
  dropInterpreterFor,
  DROPS,
  columns,
  createWindowManager,
} from "../src/index.mjs";
import { resolveDrop } from "../src/state/drops.mjs";

const make = (commands, options) => replay(createState(options), commands);
const win = (id, extra = {}) => ({ type: "window/create", id, ...extra });

describe("layout modifiers: registry + combinator", () => {
  test("MODIFIERS carries every built-in type; withModifiers is identity with no mods", () => {
    for (const type of MODIFIER_TYPES) assert.equal(typeof MODIFIERS[type], "function");
    const base = (spec, ids) => columns({}, ids);
    assert.equal(withModifiers(base, []), base);
    assert.equal(withModifiers(base, undefined), base);
  });

  test("withModifiers composes in order and an unknown type is a no-op", () => {
    const base = (spec, ids) => columns({}, ids);
    const wrapped = withModifiers(base, [{ type: "reflect-x" }, { type: "reflect-y" }, { type: "not-a-real-modifier" }]);
    const tree = wrapped({}, ["a", "b", "c"], {});
    // reflect-x reverses row children; reflect-y then reverses column children, but this
    // stays a row (no columns), so the second pass is a no-op — net effect is reflect-x alone.
    assert.deepEqual(views(tree), ["c", "b", "a"]);
  });

  test("validModifiers accepts a list of {type} objects, rejects anything else", () => {
    assert.equal(validModifiers([]), true);
    assert.equal(validModifiers([{ type: "mirror" }, { type: "max-windows", n: 2 }]), true);
    assert.equal(validModifiers(undefined), false);
    assert.equal(validModifiers([{ n: 2 }]), false);
    assert.equal(validModifiers("mirror"), false);
    assert.equal(validModifiers([null]), false);
  });
});

describe("layout modifiers: smart-gaps / no-gaps", () => {
  const layout = (type, modifiers) => ({ type: "columns", modifiers: modifiers ? [{ type: modifiers }] : undefined });

  test("smart-gaps suppresses gap/inset with a single tiled window, restores with more", () => {
    let state = make([win("a")], { layout: layout("columns", "smart-gaps"), config: { gap: 8, inset: 8 } });
    let tree = derive(state);
    let base = tree.children[0];
    assert.equal(base.type, "row"); // no gap() wrapper, no inset() wrapper
    state = reduce(state, win("b"));
    tree = derive(state);
    base = tree.children[0];
    assert.equal(base.type, "inset");
    assert.equal(base.child.type, "gap");
  });

  test("no-gaps suppresses gap/inset regardless of window count", () => {
    const state = make([win("a"), win("b"), win("c")], { layout: layout("columns", "no-gaps"), config: { gap: 8, inset: 8 } });
    const tree = derive(state);
    assert.equal(tree.children[0].type, "row");
  });

  test("without a gap modifier, config gap/inset always wrap the base (baseline)", () => {
    const state = make([win("a")], { layout: { type: "columns" }, config: { gap: 8, inset: 8 } });
    const tree = derive(state);
    assert.equal(tree.children[0].type, "inset");
  });

  test("suppressesGaps is a pure query over a modifiers list + context", () => {
    assert.equal(suppressesGaps([{ type: "no-gaps" }], {}), true);
    assert.equal(suppressesGaps([{ type: "smart-gaps" }], { tiledIds: ["a"] }), true);
    assert.equal(suppressesGaps([{ type: "smart-gaps" }], { tiledIds: ["a", "b"] }), false);
    assert.equal(suppressesGaps([], { tiledIds: ["a"] }), false);
    assert.equal(suppressesGaps(undefined, {}), false);
  });
});

describe("layout modifiers: mirror / reflect-x / reflect-y", () => {
  test("mirror transposes rows and columns (xmonad Mirror)", () => {
    const state = make([win("a"), win("b"), win("c")], { layout: { type: "columns", modifiers: [{ type: "mirror" }] } });
    const tree = derive(state);
    assert.equal(tree.children[0].type, "column");
    assert.deepEqual(views(tree.children[0]), ["a", "b", "c"]);
  });

  test("reflect-x reverses left-right (row children)", () => {
    const state = make([win("a"), win("b"), win("c")], { layout: { type: "columns", modifiers: [{ type: "reflect-x" }] } });
    const tree = derive(state);
    assert.deepEqual(views(tree.children[0]), ["c", "b", "a"]);
  });

  test("reflect-y reverses top-bottom (column children)", () => {
    const state = make([win("a"), win("b"), win("c")], { layout: { type: "rows", modifiers: [{ type: "reflect-y" }] } });
    const tree = derive(state);
    assert.deepEqual(views(tree.children[0]), ["c", "b", "a"]);
  });

  test("mirror + reflect-x compose left to right", () => {
    const state = make([win("a"), win("b")], {
      layout: { type: "columns", modifiers: [{ type: "mirror" }, { type: "reflect-x" }] },
    });
    const tree = derive(state);
    // mirror: row -> column [a, b]; reflect-x on that (no rows inside) is a no-op.
    assert.equal(tree.children[0].type, "column");
    assert.deepEqual(views(tree.children[0]), ["a", "b"]);
  });

  test("every window is still present after mirror/reflect (paintOrder agrees)", () => {
    const state = make([win("a"), win("b"), win("c")], { layout: { type: "columns", modifiers: [{ type: "mirror" }] } });
    const tree = derive(state);
    assert.deepEqual(new Set(views(tree)), new Set(["a", "b", "c"]));
  });
});

describe("layout modifiers: max-windows(n)", () => {
  const layout = (n) => ({ type: "columns", modifiers: [{ type: "max-windows", n }] });

  test("n or fewer windows: no change", () => {
    const state = make([win("a"), win("b")], { layout: layout(3) });
    const tree = derive(state);
    assert.equal(tree.children[0].type, "row");
    assert.deepEqual(views(tree.children[0]), ["a", "b"]);
  });

  test("more than n: the last slot becomes a hidden stack holding the overflow", () => {
    const state = make([win("a"), win("b"), win("c"), win("d")], { layout: layout(2) });
    const tree = derive(state);
    const base = tree.children[0];
    assert.equal(base.type, "row");
    assert.equal(base.children.length, 2);
    assert.equal(base.children[0].type, "view");
    assert.equal(base.children[0].id, "a");
    const overflowStack = base.children[1];
    assert.equal(overflowStack.type, "stack");
    assert.deepEqual(views(overflowStack), ["b", "c", "d"]);
    // Every tiled window is still somewhere in the tree — paintOrder and the
    // tiled set stay in agreement with what max-windows actually painted.
    assert.deepEqual(new Set(views(tree)), new Set(["a", "b", "c", "d"]));
  });

  test("the overflow stack activates the focused window when focus is on a hidden window", () => {
    let state = make([win("a"), win("b"), win("c"), win("d")], { layout: layout(2) });
    state = reduce(state, { type: "window/focus", id: "d" });
    const tree = derive(state);
    const overflowStack = tree.children[0].children[1];
    assert.equal(overflowStack.options.active, "d");
  });

  test("the overflow stack defaults to the last visible slot's window when focus is elsewhere", () => {
    let state = make([win("a"), win("b"), win("c"), win("d")], { layout: layout(2) });
    state = reduce(state, { type: "window/focus", id: "a" });
    const tree = derive(state);
    const overflowStack = tree.children[0].children[1];
    assert.equal(overflowStack.options.active, "b");
  });

  test("n=1 caps everything but the first window into the stack", () => {
    const state = make([win("a"), win("b"), win("c")], { layout: layout(1) });
    const tree = derive(state);
    const base = tree.children[0];
    assert.equal(base.type, "row"); // columns still wraps its single slot in a row
    const stackNode = base.children[0];
    assert.equal(stackNode.type, "stack");
    assert.deepEqual(views(stackNode), ["a", "b", "c"]);
  });

  test("n <= 0 is clamped to 1", () => {
    const state = make([win("a"), win("b")], { layout: layout(0) });
    const tree = derive(state);
    assert.equal(tree.children[0].children[0].type, "stack");
  });

  test("undo/redo through max-windows: closing a window can drop it below the cap", () => {
    let state = make([win("a"), win("b"), win("c")], { layout: layout(2) });
    assert.equal(derive(state).children[0].children[1].type, "stack");
    state = reduce(state, { type: "window/close", id: "c" });
    assert.equal(derive(state).children[0].type, "row");
    assert.deepEqual(views(derive(state).children[0]), ["a", "b"]);
  });
});

describe("layout modifiers: composition with other layouts", () => {
  test("max-windows over master-stack still reserves the master slot", () => {
    const state = make([win("a"), win("b"), win("c"), win("d")], {
      layout: { type: "master-stack", ratio: 0.6, modifiers: [{ type: "max-windows", n: 3 }] },
    });
    const tree = derive(state);
    assert.deepEqual(new Set(views(tree.children[0])), new Set(["a", "b", "c", "d"]));
    const stackNode = find(tree.children[0], (n) => n.type === "stack");
    assert.ok(stackNode);
    assert.deepEqual(views(stackNode), ["c", "d"]);
  });

  test("smart-gaps + mirror compose: no gap/inset wrap, and mirror still transposes to a column", () => {
    const state = make([win("solo")], {
      layout: { type: "columns", modifiers: [{ type: "smart-gaps" }, { type: "mirror" }] },
      config: { gap: 8, inset: 8 },
    });
    const tree = derive(state);
    assert.equal(tree.children[0].type, "column"); // not inset(gap(...)) — smart-gaps suppressed both
    assert.deepEqual(views(tree.children[0]), ["solo"]);
  });

  test("derive({ modifiers }) overrides/extends the registry like derive({ layouts })", () => {
    const state = make([win("a"), win("b")], { layout: { type: "columns", modifiers: [{ type: "double" }] } });
    const custom = { double: () => (interpreter) => (spec, ids, ctx) => columns({}, [...ids, ...ids]) };
    const tree = derive(state, { modifiers: custom });
    assert.deepEqual(views(tree.children[0]), ["a", "b", "a", "b"]);
    // Without the override the unknown type is a no-op.
    assert.deepEqual(views(derive(state).children[0]), ["a", "b"]);
  });
});

describe("layout modifiers: drop-interpreter agreement", () => {
  test("applyModifiersToOps swaps zones to match reflect-x/reflect-y/mirror", () => {
    const ops = { center: "swap", left: "before", right: "after", top: "swap", bottom: "swap" };
    assert.deepEqual(applyModifiersToOps(ops, [{ type: "reflect-x" }]), { ...ops, left: "after", right: "before" });
    assert.deepEqual(applyModifiersToOps(ops, [{ type: "reflect-y" }]), { ...ops, top: "swap", bottom: "swap" });
    assert.deepEqual(applyModifiersToOps(ops, [{ type: "mirror" }]), { ...ops, top: "before", left: "swap", right: "swap", bottom: "after" });
    assert.equal(applyModifiersToOps(null, [{ type: "mirror" }]), null);
    assert.equal(applyModifiersToOps(ops, undefined), ops);
  });

  test("dropInterpreterFor remaps ops for a reflected columns layout, keeps apply/other zones", () => {
    const spec = { type: "columns", modifiers: [{ type: "reflect-x" }] };
    const interpreter = dropInterpreterFor(DROPS, spec);
    const plain = DROPS.columns.ops(spec, ["a", "b", "c"], "b");
    const reflected = interpreter.ops(spec, ["a", "b", "c"], "b");
    assert.equal(reflected.left, plain.right);
    assert.equal(reflected.right, plain.left);
    assert.equal(reflected.center, plain.center);
  });

  test("a window/drop still resolves and reorders correctly under a reflected layout", () => {
    let state = make([win("a"), win("b"), win("c")], { layout: { type: "columns", modifiers: [{ type: "reflect-x" }] } });
    const resolved = resolveDrop(state, { id: "a", target: "c", zone: "left" });
    assert.equal(resolved.reason, undefined);
    state = reduce(state, { type: "window/drop", id: "a", target: "c", zone: "left" });
    assert.deepEqual(state.workspaces[state.activeWorkspace].windows, ["b", "c", "a"]);
  });

  test("max-windows leaves drop resolution untouched (flat tiled order, like monocle)", () => {
    const state = make([win("a"), win("b"), win("c")], { layout: { type: "columns", modifiers: [{ type: "max-windows", n: 2 }] } });
    const resolved = resolveDrop(state, { id: "a", target: "c", zone: "left" });
    assert.equal(resolved.reason, undefined);
    assert.equal(resolved.op, "before");
  });
});

describe("layout/set validates modifiers", () => {
  test("a valid modifiers list is accepted and round-trips through the workspace", () => {
    const state = reduce(createState(), {
      type: "layout/set",
      layout: { type: "columns", modifiers: [{ type: "smart-gaps" }] },
    });
    assert.deepEqual(state.workspaces[state.activeWorkspace].layout.modifiers, [{ type: "smart-gaps" }]);
  });

  test("a non-array modifiers field is rejected as invalid-layout", () => {
    const out = update(createState(), { type: "layout/set", layout: { type: "columns", modifiers: "mirror" } });
    assert.equal(out.events[0].type, "command/rejected");
    assert.equal(out.events[0].reason, "invalid-layout");
  });

  test("a modifiers entry missing a type is rejected", () => {
    const out = update(createState(), { type: "layout/set", layout: { type: "columns", modifiers: [{ n: 2 }] } });
    assert.equal(out.events[0].reason, "invalid-layout");
  });

  test("function layouts (no .modifiers to validate) are still accepted", () => {
    const fn = () => columns({}, []);
    const out = update(createState(), { type: "layout/set", layout: fn });
    assert.equal(out.events[0].type, "layout/changed");
    assert.equal(out.state.workspaces[out.state.activeWorkspace].layout, fn);
  });
});

describe("layout/toggle: xmonad-style ToggleLayouts", () => {
  const a = { type: "master-stack", ratio: 0.5 };
  const b = { type: "monocle" };

  test("first call with {a, b} switches to b (current layout isn't a's exact object, but matches by type)", () => {
    const state = reduce(createState({ layout: a }), { type: "layout/toggle", a, b });
    assert.equal(state.workspaces[state.activeWorkspace].layout.type, "monocle");
  });

  test("toggling again switches back to a", () => {
    let state = reduce(createState({ layout: a }), { type: "layout/toggle", a, b });
    state = reduce(state, { type: "layout/toggle", a, b });
    assert.equal(state.workspaces[state.activeWorkspace].layout.type, "master-stack");
  });

  test("subsequent calls may omit a/b: the stored pair is reused", () => {
    let state = reduce(createState({ layout: a }), { type: "layout/toggle", a, b });
    state = reduce(state, { type: "layout/toggle" });
    assert.equal(state.workspaces[state.activeWorkspace].layout.type, "master-stack");
    state = reduce(state, { type: "layout/toggle" });
    assert.equal(state.workspaces[state.activeWorkspace].layout.type, "monocle");
  });

  test("starting from neither a nor b switches to a", () => {
    const state = reduce(createState({ layout: { type: "columns" } }), { type: "layout/toggle", a, b });
    assert.equal(state.workspaces[state.activeWorkspace].layout.type, "master-stack");
  });

  test("toggling to bsp seeds its tree from the current tiled order", () => {
    let state = make([win("a"), win("b"), win("c")], { layout: { type: "columns" } });
    state = reduce(state, { type: "layout/toggle", a: { type: "columns" }, b: { type: "bsp" } });
    assert.equal(state.workspaces[state.activeWorkspace].layout.type, "bsp");
    assert.ok(state.workspaces[state.activeWorkspace].layout.tree);
  });

  test("rejects when neither a stored pair nor a/b arguments are available", () => {
    const out = update(createState(), { type: "layout/toggle" });
    assert.equal(out.events[0].reason, "invalid-layout");
  });

  test("rejects an unknown workspace", () => {
    const out = update(createState(), { type: "layout/toggle", workspace: "nope", a, b });
    assert.equal(out.events[0].reason, "unknown-workspace");
  });

  test("rejects an invalid a or b", () => {
    assert.equal(update(createState(), { type: "layout/toggle", a: {}, b }).events[0].reason, "invalid-layout");
    assert.equal(update(createState(), { type: "layout/toggle", a, b: { type: "columns", modifiers: "nope" } }).events[0].reason, "invalid-layout");
  });

  test("layout/toggle is serializable, replays, and undoes/redoes as one step", () => {
    const commands = [win("a"), win("b"), { type: "layout/toggle", a, b }, { type: "layout/toggle" }];
    const state = replay(createState({ layout: a }), commands);
    assert.equal(JSON.parse(JSON.stringify(state)).workspaces[state.activeWorkspace].layout.type, "master-stack");
  });

  test("layout/toggled event carries the workspace and the new layout", () => {
    const out = update(createState({ layout: a }), { type: "layout/toggle", a, b });
    assert.equal(out.events[0].type, "layout/toggled");
    assert.equal(out.events[0].workspace, "main");
    assert.equal(out.events[0].layout.type, "monocle");
  });
});

describe("manager: modifiers option, wm.toggleLayout, unknown-layout guard", () => {
  test("wm.toggleLayout dispatches layout/toggle and flips back and forth", () => {
    const wm = createWindowManager({ state: createState({ layout: { type: "master-stack" } }) });
    wm.create({ id: "a" });
    wm.toggleLayout({ type: "master-stack" }, { type: "monocle" });
    assert.equal(wm.state.workspaces.main.layout.type, "monocle");
    wm.toggleLayout();
    assert.equal(wm.state.workspaces.main.layout.type, "master-stack");
  });

  test("layout/toggle to an unknown layout type is rejected before update sees it (unknown-layout)", () => {
    const wm = createWindowManager({ state: createState({ layout: { type: "columns" } }) });
    const out = wm.toggleLayout({ type: "columns" }, { type: "nope" });
    assert.deepEqual(out.events, [{ type: "command/rejected", command: "layout/toggle", id: undefined, reason: "unknown-layout" }]);
    assert.equal(wm.state.workspaces.main.layout.type, "columns");
  });

  test("layout/toggle to a custom (manager-registered) layout type is accepted", () => {
    const wm = createWindowManager({
      state: createState({ layout: { type: "columns" } }),
      layouts: { mine: () => columns({}, []) },
    });
    const out = wm.toggleLayout({ type: "columns" }, { type: "mine" });
    assert.equal(out.events[0].type, "layout/toggled");
    assert.doesNotThrow(() => wm.present());
  });

  test("createWindowManager({ modifiers }) reaches derive via wm.present()", () => {
    const wm = createWindowManager({
      state: createState({ layout: { type: "columns", modifiers: [{ type: "double" }] } }),
      modifiers: { double: () => (interpreter) => (spec, ids, ctx) => columns({}, [...ids, ...ids]) },
    });
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    const { tree } = wm.present();
    assert.deepEqual(views(tree.children[0]), ["a", "b", "a", "b"]);
  });

  test("modifiers round-trip through undo/redo and serialize/load", () => {
    const wm = createWindowManager({ state: createState({ layout: { type: "columns" } }), history: true });
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    wm.setLayout({ type: "columns", modifiers: [{ type: "reflect-x" }] });
    assert.deepEqual(views(wm.present().tree.children[0]), ["b", "a"]);
    wm.undo();
    assert.deepEqual(views(wm.present().tree.children[0]), ["a", "b"]);
    wm.redo();
    assert.deepEqual(views(wm.present().tree.children[0]), ["b", "a"]);
    const saved = wm.serialize();
    const wm2 = createWindowManager();
    wm2.load(JSON.parse(saved));
    assert.deepEqual(wm2.state.workspaces[wm2.state.activeWorkspace].layout.modifiers, [{ type: "reflect-x" }]);
  });
});
