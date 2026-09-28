import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  createWindowManager,
  update,
  reduce,
  replay,
  derive,
  views,
  validate,
  row,
  COMMANDS,
  DROPS,
  treeIds,
  treeReconcile,
  treeRemove,
  treeSwap,
  treeSplit,
  treeAddTab,
  treeInsertTab,
  treeNodeAt,
  treeSetSizesAt,
  treeToLayout,
  treeFrom,
  treeFromBsp,
  treeParentType,
  bspFrom,
  bspSetRatio,
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

describe("docking tree: pure helpers (src/layouts/tree.mjs)", () => {
  test("treeIds walks leaves in order, nested containers included", () => {
    const tree = { type: "row", children: ["a", { type: "column", children: ["b", "c"] }] };
    assert.deepEqual(treeIds(tree), ["a", "b", "c"]);
    assert.deepEqual(treeIds(null), []);
    assert.deepEqual(treeIds("solo"), ["solo"]);
  });

  test("treeFrom: a single id is a bare leaf, none is null, otherwise a flat container", () => {
    assert.equal(treeFrom([]), null);
    assert.equal(treeFrom(["a"]), "a");
    assert.deepEqual(treeFrom(["a", "b"]), { type: "tabs", children: ["a", "b"] });
    assert.deepEqual(treeFrom(["a", "b"], { type: "row" }), { type: "row", children: ["a", "b"] });
  });

  test("treeRemove collapses an emptied or single-child container", () => {
    const tree = { type: "row", children: ["a", "b"], sizes: [0.3, 0.7] };
    assert.equal(treeRemove(tree, "a"), "b");
    assert.equal(treeRemove("a", "a"), null);
    assert.equal(treeRemove(null, "a"), null);
    // A leaf elsewhere in the tree is untouched.
    const nested = { type: "row", children: ["a", { type: "column", children: ["b", "c"] }] };
    assert.deepEqual(treeRemove(nested, "b"), { type: "row", children: ["a", "c"] });
  });

  test("treeRemove keeps sizes parallel to the surviving children", () => {
    const tree = { type: "row", children: ["a", "b", "c"], sizes: [1, 2, 3] };
    assert.deepEqual(treeRemove(tree, "b"), { type: "row", children: ["a", "c"], sizes: [1, 3] });
    // Stale/mismatched sizes are dropped rather than misapplied.
    const stale = { type: "row", children: ["a", "b", "c"], sizes: [1, 2] };
    assert.deepEqual(treeRemove(stale, "b"), { type: "row", children: ["a", "c"] });
  });

  test("treeSwap exchanges leaves wherever they sit", () => {
    const tree = { type: "row", children: ["a", { type: "column", children: ["b", "c"] }] };
    assert.deepEqual(treeSwap(tree, "a", "c"), { type: "row", children: ["c", { type: "column", children: ["b", "a"] }] });
    assert.equal(treeSwap(null, "a", "b"), null);
  });

  test("treeSplit wraps the target leaf into a new row/column with the dragged id on the given side", () => {
    assert.deepEqual(treeSplit("a", { id: "z", target: "a", side: "left" }), { type: "row", children: ["z", "a"], sizes: [0.5, 0.5] });
    assert.deepEqual(treeSplit("a", { id: "z", target: "a", side: "right" }), { type: "row", children: ["a", "z"], sizes: [0.5, 0.5] });
    assert.deepEqual(treeSplit("a", { id: "z", target: "a", side: "top" }), { type: "column", children: ["z", "a"], sizes: [0.5, 0.5] });
    assert.deepEqual(treeSplit("a", { id: "z", target: "a", side: "bottom" }), { type: "column", children: ["a", "z"], sizes: [0.5, 0.5] });
    // A ratio biases the new split.
    assert.deepEqual(treeSplit("a", { id: "z", target: "a", side: "left", ratio: 0.25 }).sizes, [0.25, 0.75]);
    // Nested targets are found and wrapped in place.
    const tree = { type: "row", children: ["a", "b"] };
    assert.deepEqual(treeSplit(tree, { id: "z", target: "b", side: "top" }), {
      type: "row",
      children: ["a", { type: "column", children: ["z", "b"], sizes: [0.5, 0.5] }],
    });
  });

  test("treeAddTab wraps a target, or joins an existing tabs container right after it", () => {
    assert.deepEqual(treeAddTab("a", { id: "z", target: "a" }), { type: "tabs", children: ["a", "z"] });
    const withTabs = { type: "row", children: [{ type: "tabs", children: ["a", "b"] }, "c"] };
    assert.deepEqual(treeAddTab(withTabs, { id: "z", target: "a" }), {
      type: "row",
      children: [{ type: "tabs", children: ["a", "z", "b"] }, "c"],
    });
  });

  test("treeInsertTab inserts before/after a target within its tabs container", () => {
    const tabs = { type: "tabs", children: ["a", "b", "c"] };
    assert.deepEqual(treeInsertTab(tabs, { id: "z", target: "b", position: "before" }), { type: "tabs", children: ["a", "z", "b", "c"] });
    assert.deepEqual(treeInsertTab(tabs, { id: "z", target: "b", position: "after" }), { type: "tabs", children: ["a", "b", "z", "c"] });
    // Falls back to wrapping when the target isn't in a tabs container.
    assert.deepEqual(treeInsertTab("a", { id: "z", target: "a", position: "before" }), { type: "tabs", children: ["a", "z"] });
  });

  test("treeReconcile drops missing leaves (collapsing) and appends new ones sensibly", () => {
    assert.equal(treeReconcile(null, []), null);
    assert.deepEqual(treeReconcile(null, ["a", "b"]), { type: "tabs", children: ["a", "b"] });
    assert.equal(treeReconcile(null, ["a"]), "a");
    // A bare leaf root gains a sibling as a tabs pair.
    assert.deepEqual(treeReconcile("a", ["a", "b"]), { type: "tabs", children: ["a", "b"] });
    // An existing container gains new ids as extra children.
    const row_ = { type: "row", children: ["a", "b"], sizes: [0.4, 0.6] };
    assert.deepEqual(treeReconcile(row_, ["a", "b", "c"]).children, ["a", "b", "c"]);
    // Closed windows are pruned, collapsing empty containers.
    const three = { type: "row", children: ["a", { type: "column", children: ["b", "c"] }] };
    assert.equal(treeReconcile(three, ["a"]), "a");
    assert.deepEqual(treeReconcile(three, ["a", "c"]), { type: "row", children: ["a", "c"] });
  });

  test("treeParentType finds the direct container type of a leaf, or null for the root/absent", () => {
    const tree = { type: "row", children: ["a", { type: "tabs", children: ["b", "c"] }] };
    assert.equal(treeParentType(tree, "a"), "row");
    assert.equal(treeParentType(tree, "b"), "tabs");
    assert.equal(treeParentType(tree, "zz"), null);
    assert.equal(treeParentType("a", "a"), null);
  });

  test("treeNodeAt / treeSetSizesAt address a container by a comma-joined index path", () => {
    const tree = { type: "row", children: ["a", { type: "column", children: ["b", "c"], sizes: [0.5, 0.5] }] };
    assert.equal(treeNodeAt(tree, ""), tree);
    assert.deepEqual(treeNodeAt(tree, "1"), tree.children[1]);
    assert.equal(treeNodeAt(tree, "0"), null); // "a" is a leaf, not a container
    assert.equal(treeNodeAt(tree, "9"), null); // out of range
    assert.equal(treeNodeAt(tree, "1,9"), null);
    const resized = treeSetSizesAt(tree, "1", [0.2, 0.8]);
    assert.deepEqual(resized.children[1].sizes, [0.2, 0.8]);
    // A mismatched-length weights array is a no-op.
    assert.deepEqual(treeSetSizesAt(tree, "1", [1, 1, 1]).children[1], tree.children[1]);
  });

  test("treeToLayout renders rows/columns with resize metadata and tabs with active-child tracking", () => {
    const tree = { type: "row", children: ["a", { type: "tabs", children: ["b", "c"] }], sizes: [0.4, 0.6] };
    const layout = treeToLayout(tree, { focused: "c" });
    assert.equal(validate(layout).ok, true);
    assert.deepEqual([...views(layout)].sort(), ["a", "b", "c"]);
    assert.equal(layout.type, "row");
    assert.deepEqual(layout.options.resize, { path: "", weights: [0.4, 0.6] });
    const tabsNode = layout.children[1].child;
    assert.equal(tabsNode.options.chrome, "tabs");
    assert.equal(tabsNode.options.active, "c"); // focused window's tab is active
    // Without a focused window inside the group, the first child is active.
    assert.equal(treeToLayout(tree, {}).children[1].child.options.active, "b");
    // A single-child row has no splitter.
    assert.equal(treeToLayout({ type: "row", children: ["a"] }, {}).options.resize, undefined);
    assert.deepEqual(treeToLayout(null, {}), row({}));
  });

  test("treeFromBsp mirrors a BSP tree's structure and ratios exactly", () => {
    const bsp = bspSetRatio(bspFrom(["a", "b", "c"]), "a", 0.6);
    const tree = treeFromBsp(bsp);
    assert.deepEqual(treeIds(tree), ["a", "b", "c"]);
    assert.equal(tree.type, "row");
    assert.deepEqual(tree.sizes, [0.6, 0.4]);
    assert.equal(tree.children[1].type, "column");
    assert.equal(treeFromBsp(null), null);
  });
});

describe("derive(): the tree layout", () => {
  test("renders nested containers and prunes/collapses missing windows", () => {
    const tree = { type: "row", children: ["a", { type: "column", children: ["b", "c"] }] };
    const state = withWindows(["a", "b"], { layout: { type: "tree", tree } });
    const layout = derive(state);
    assert.deepEqual([...views(layout)].sort(), ["a", "b"]);
  });

  test("an unseeded tree spec derives from whatever windows exist", () => {
    const state = withWindows(["a", "b", "c"], { layout: { type: "tree" } });
    assert.deepEqual([...views(derive(state))].sort(), ["a", "b", "c"]);
  });
});

describe("layout/set and layout/to-tree", () => {
  test("layout/set seeds an empty tree spec from the current tiled order (as tabs)", () => {
    const state = reduce(withWindows(["a", "b", "c"]), { type: "layout/set", layout: { type: "tree" } });
    assert.deepEqual(state.workspaces.main.layout.tree, { type: "tabs", children: ["a", "b", "c"] });
    // A single window seeds a bare leaf.
    const one = reduce(withWindows(["a"]), { type: "layout/set", layout: { type: "tree" } });
    assert.equal(one.workspaces.main.layout.tree, "a");
    // An explicit tree is left alone.
    const explicit = reduce(withWindows(["a", "b"]), { type: "layout/set", layout: { type: "tree", tree: "a" } });
    assert.equal(explicit.workspaces.main.layout.tree, "a");
  });

  test("layout/to-tree converts BSP exactly, preserving ratios", () => {
    let state = withWindows(["a", "b", "c"], { layout: { type: "bsp" } });
    state = reduce(state, { type: "layout/resize-split", path: "", weights: [0.3, 0.7] });
    const converted = reduce(state, { type: "layout/to-tree" });
    assert.equal(converted.workspaces.main.layout.type, "tree");
    const tree = converted.workspaces.main.layout.tree;
    assert.deepEqual(treeIds(tree), ["a", "b", "c"]);
    assert.deepEqual(tree.sizes, [0.3, 0.7]);
    assert.deepEqual([...views(derive(converted))].sort(), ["a", "b", "c"]);
  });

  test("layout/to-tree converts columns/rows into a single row/column, carrying stored sizes", () => {
    let cols = withWindows(["a", "b", "c"], { layout: { type: "columns" } });
    cols = reduce(cols, { type: "layout/resize-split", index: 0, weights: [1, 2, 3] });
    const tree1 = reduce(cols, { type: "layout/to-tree" }).workspaces.main.layout.tree;
    assert.deepEqual(tree1, { type: "row", children: ["a", "b", "c"], sizes: [1, 2, 3] });

    const rows = withWindows(["a", "b"], { layout: { type: "rows" } });
    const tree2 = reduce(rows, { type: "layout/to-tree" }).workspaces.main.layout.tree;
    assert.deepEqual(tree2, { type: "column", children: ["a", "b"] });
  });

  test("layout/to-tree converts master-stack into a two-way row, honouring masterCount and side", () => {
    let ms = withWindows(["a", "b", "c"], { layout: { type: "master-stack", ratio: 0.6 } });
    const tree = reduce(ms, { type: "layout/to-tree" }).workspaces.main.layout.tree;
    assert.deepEqual(tree, { type: "row", children: ["a", { type: "column", children: ["b", "c"] }], sizes: [0.6, 0.4] });

    const right = withWindows(["a", "b"], { layout: { type: "master-stack", side: "right", ratio: 0.5 } });
    const treeRight = reduce(right, { type: "layout/to-tree" }).workspaces.main.layout.tree;
    assert.deepEqual(treeRight, { type: "row", children: ["b", "a"], sizes: [0.5, 0.5] });

    const under = withWindows(["a"], { layout: { type: "master-stack" } });
    assert.equal(reduce(under, { type: "layout/to-tree" }).workspaces.main.layout.tree, "a");
  });

  test("layout/to-tree converts tabs/monocle into a tabs container, and anything else into a flat row", () => {
    const tabsState = withWindows(["a", "b"], { layout: { type: "tabs" } });
    assert.deepEqual(reduce(tabsState, { type: "layout/to-tree" }).workspaces.main.layout.tree, { type: "tabs", children: ["a", "b"] });
    const spiralState = withWindows(["a", "b"], { layout: { type: "spiral" } });
    assert.deepEqual(reduce(spiralState, { type: "layout/to-tree" }).workspaces.main.layout.tree, { type: "row", children: ["a", "b"] });
  });

  test("layout/to-tree rejects an unknown workspace", () => {
    const state = withWindows(["a"]);
    assert.equal(update(state, { type: "layout/to-tree", workspace: "nope" }).events[0].reason, "unknown-workspace");
  });

  test("COMMANDS lists layout/to-tree", () => {
    assert.ok(COMMANDS.includes("layout/to-tree"));
  });
});

describe("layout/resize-split: tree", () => {
  test("addresses a row/column node by its comma-joined path", () => {
    const tree = { type: "row", children: ["a", { type: "column", children: ["b", "c"] }] };
    let state = withWindows(["a", "b", "c"], { layout: { type: "tree", tree } });
    state = reduce(state, { type: "layout/resize-split", path: "1", weights: [0.25, 0.75] });
    assert.deepEqual(state.workspaces.main.layout.tree.children[1].sizes, [0.25, 0.75]);
    // A delta nudges the addressed pair once sizes exist.
    state = reduce(state, { type: "layout/resize-split", path: "1", index: 0, delta: 0.1 });
    assert.deepEqual(state.workspaces.main.layout.tree.children[1].sizes, [0.35, 0.65]);
  });

  test("rejections: a tabs container, an out-of-range/leaf path, or a malformed path", () => {
    const tree = { type: "row", children: ["a", { type: "tabs", children: ["b", "c"] }] };
    const state = withWindows(["a", "b", "c"], { layout: { type: "tree", tree } });
    const reason = (command) => update(state, command).events[0].reason;
    assert.equal(reason({ type: "layout/resize-split", path: "1", weights: [0.5, 0.5] }), "unknown-split"); // tabs, not resizable
    assert.equal(reason({ type: "layout/resize-split", path: "0", weights: [0.5, 0.5] }), "unknown-split"); // "a" is a leaf
    assert.equal(reason({ type: "layout/resize-split", path: "9", weights: [0.5, 0.5] }), "unknown-split");
    assert.equal(reason({ type: "layout/resize-split", path: "x", weights: [0.5, 0.5] }), "invalid-path");
    assert.equal(reason({ type: "layout/resize-split", path: "", weights: [0.1, 0.2, 0.7] }), "invalid-weights"); // root has 2 children
    assert.equal(reason({ type: "layout/resize-split", path: "" }), "missing-value");
  });

  test("never throws and never mutates state", () => {
    const tree = { type: "row", children: ["a", "b"] };
    const state = deepFreeze(withWindows(["a", "b", "c"], { layout: { type: "tree", tree } }));
    for (const command of [
      { type: "layout/resize-split", path: "", delta: 0.1 },
      { type: "layout/resize-split", path: "nope", weights: [0.1, 0.9] },
      { type: "layout/resize-split" },
      { type: "layout/resize-split", weights: null },
    ]) {
      assert.doesNotThrow(() => update(state, command));
    }
  });
});

describe("window/drop: docking tree", () => {
  const make = (tree) => withWindows(["a", "b", "c", "d"], { layout: { type: "tree", tree } });
  const drop = (state, id, target, zone, rest = {}) => update(state, { type: "window/drop", id, target, zone, ...rest });
  const treeOf = (out) => out.state.workspaces.main.layout.tree;

  test("edge zones split the target leaf, creating a row/column with the dragged window on that side", () => {
    const s = make({ type: "row", children: ["a", "b"] });
    for (const [zone, expect] of [
      ["left", { type: "row", children: ["c", "a"], sizes: [0.5, 0.5] }],
      ["right", { type: "row", children: ["a", "c"], sizes: [0.5, 0.5] }],
      ["top", { type: "column", children: ["c", "a"], sizes: [0.5, 0.5] }],
      ["bottom", { type: "column", children: ["a", "c"], sizes: [0.5, 0.5] }],
    ]) {
      const out = drop(s, "c", "a", zone);
      assert.deepEqual(treeOf(out).children[0], expect, zone);
      assert.deepEqual(out.effects, [{ type: "render" }]);
      const event = out.events.find((e) => e.type === "window/dropped");
      assert.equal(event.op, "split");
    }
  });

  test("center adds the dragged window as a tab with the target", () => {
    const s = make({ type: "row", children: ["a", "b"] });
    const out = drop(s, "c", "a", "center");
    assert.deepEqual(treeOf(out).children[0], { type: "tabs", children: ["a", "c"] });
    assert.equal(out.events.find((e) => e.type === "window/dropped").op, "tab");
  });

  test("spec.tabMode: 'swap' exchanges the two leaves instead of tabbing", () => {
    // A tree covering every tiled window, so no reconcile-time append is in play.
    const s = make({ type: "row", children: ["a", "b", "c", "d"] });
    const swapped = { ...s, workspaces: { ...s.workspaces, main: { ...s.workspaces.main, layout: { ...s.workspaces.main.layout, tabMode: "swap" } } } };
    const out = drop(swapped, "c", "a", "center");
    assert.deepEqual(treeOf(out), { type: "row", children: ["c", "b", "a", "d"] }); // a and c trade places
    assert.equal(out.events.find((e) => e.type === "window/dropped").op, "swap");
  });

  test("a floating window has no slot to trade: 'swap' degrades to adding it as a tab", () => {
    const base = make({ type: "row", children: ["a", "b", "c", "d"] });
    const floated = update(base, { type: "window/set-mode", id: "c", mode: "floating" }).state;
    const swapMode = { ...floated, workspaces: { ...floated.workspaces, main: { ...floated.workspaces.main, layout: { ...floated.workspaces.main.layout, tabMode: "swap" } } } };
    const out = drop(swapMode, "c", "a", "center");
    assert.deepEqual(treeOf(out).children[0], { type: "tabs", children: ["a", "c"] });
  });

  test("dropping onto a tab strip (left/right of a target inside one) inserts at that index", () => {
    const s = make({ type: "row", children: [{ type: "tabs", children: ["a", "b"] }, "d"] });
    const before = drop(s, "c", "b", "left");
    assert.deepEqual(treeOf(before).children[0], { type: "tabs", children: ["a", "c", "b"] });
    assert.equal(before.events.find((e) => e.type === "window/dropped").op, "before");
    const after = drop(s, "c", "b", "right");
    assert.deepEqual(treeOf(after).children[0], { type: "tabs", children: ["a", "b", "c"] });
    assert.equal(after.events.find((e) => e.type === "window/dropped").op, "after");
  });

  test("top/bottom on a tabbed target still splits, pulling that one tab out", () => {
    const s = make({ type: "tabs", children: ["a", "b", "c", "d"] });
    const out = drop(s, "c", "a", "top");
    assert.deepEqual(treeOf(out), { type: "tabs", children: [{ type: "column", children: ["c", "a"], sizes: [0.5, 0.5] }, "b", "d"] });
  });

  test("a stale tree (drifted from the workspace order) is reconciled before the drop", () => {
    const s = make({ type: "row", children: ["a", "b"] }); // c, d are tiled but missing from the tree
    const out = drop(s, "d", "a", "left");
    assert.deepEqual([...treeIds(treeOf(out))].sort(), ["a", "b", "c", "d"]);
    assert.ok(treeIds(treeOf(out)).includes("d"));
  });

  test("DROPS.tree.ops depends on the target's direct-parent container", () => {
    const tree = { type: "row", children: ["a", { type: "tabs", children: ["b", "c"] }] };
    const rowOps = DROPS.tree.ops({ tree }, ["a", "b", "c"], "a");
    assert.deepEqual(rowOps, { center: "tab", left: "split", right: "split", top: "split", bottom: "split" });
    const tabOps = DROPS.tree.ops({ tree }, ["a", "b", "c"], "b");
    assert.deepEqual(tabOps, { center: "tab", left: "before", right: "after", top: "split", bottom: "split" });
  });

  test("rejections carry over from the shared drop machinery", () => {
    const s = make({ type: "row", children: ["a", "b"] });
    const reason = (out) => out.events.find((e) => e.type === "command/rejected")?.reason;
    assert.equal(reason(drop(s, "a", "a", "center")), "same-window");
    assert.equal(reason(drop(s, "zz", "a", "center")), "unknown-window");
    assert.equal(reason(drop(s, "a", "b", "nowhere")), "unknown-zone");
  });
});

describe("docking tree: undo, replay, and serialization", () => {
  test("drops and resizes are one undo step each and replay to the same state", () => {
    const wm = createWindowManager({
      state: createState({ layout: { type: "tree", tree: { type: "row", children: ["a", "b"] } } }),
      history: true,
    });
    ["a", "b", "c"].forEach((id) => wm.create({ id }));
    wm.dispatch({ type: "window/drop", id: "c", target: "a", zone: "left" });
    wm.dispatch({ type: "layout/resize-split", path: "0", weights: [0.2, 0.8] });
    const afterResize = wm.state;
    wm.undo();
    assert.notDeepEqual(wm.state.workspaces.main.layout.tree, afterResize.workspaces.main.layout.tree);
    wm.redo();
    assert.deepEqual(wm.state.workspaces.main.layout.tree, afterResize.workspaces.main.layout.tree);
    assert.deepEqual(replay(wm.origin, wm.log), wm.state);
  });

  test("serialize/load round-trips a docking tree exactly", () => {
    const wm = createWindowManager({ state: createState({ layout: { type: "tree" } }) });
    ["a", "b", "c"].forEach((id) => wm.create({ id }));
    wm.dispatch({ type: "window/drop", id: "c", target: "a", zone: "top" });
    const json = wm.serialize();
    const other = createWindowManager({ state: createState() });
    other.load(json);
    assert.deepEqual(other.state, wm.state);
  });
});
