// Regression tests for johnhenry/window-algebra#11: a minimized window keeps its leaf in a stored
// tree/bsp (so it comes back where it was), but resize-split and to-tree address and size what is
// *rendered*, so a splitter handle's `path`/`weights` always apply.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createState, update, derive, replay, treeIds } from "../src/index.mjs";

const findResize = (n) => {
  if (n?.options?.resize) return n.options.resize;
  for (const c of n?.children ?? []) {
    const f = findResize(c);
    if (f) return f;
  }
  return n?.child ? findResize(n.child) : undefined;
};
const allResizes = (n, out = []) => {
  if (n?.options?.resize) out.push(n.options.resize);
  for (const c of n?.children ?? []) allResizes(c, out);
  if (n?.child) allResizes(n.child, out);
  return out;
};
const rejects = (out) => out.events.filter((e) => e.type === "command/rejected");
const make = (layout, ids) => replay(createState({ layout }), ids.map((id) => ({ type: "window/create", id, focus: false })));
const run = (s, cmd) => update(s, cmd).state;
const layoutOf = (s) => s.workspaces[s.activeWorkspace].layout;

describe("#11: a splitter drag with a minimized window (tree)", () => {
  test("the issue: to-tree then resize-split with the handle's own path and weights is accepted", () => {
    let s = make({ type: "columns" }, ["a", "b", "c"]);
    s = run(s, { type: "window/minimize", id: "c" });
    s = run(s, { type: "layout/to-tree" });
    const handle = findResize(derive(s));
    assert.deepEqual(handle, { path: "", weights: [1, 1] });
    const out = update(s, { type: "layout/resize-split", path: handle.path, weights: [1, 3] });
    assert.deepEqual(rejects(out), []);
    assert.deepEqual(findResize(derive(out.state)).weights, [1, 3]);
  });

  test("a stored tree that keeps the minimized leaf: weights apply to the visible children, the dormant child keeps its weight and its place", () => {
    let s = make({ type: "tree", tree: { type: "row", children: ["a", "c", "b"], sizes: [2, 5, 1] } }, ["a", "b", "c"]);
    s = run(s, { type: "window/minimize", id: "c" });
    const handle = findResize(derive(s));
    assert.deepEqual(handle, { path: "", weights: [2, 1] });
    const out = update(s, { type: "layout/resize-split", path: "", weights: [1, 3] });
    assert.deepEqual(rejects(out), []);
    assert.deepEqual(layoutOf(out.state).tree, { type: "row", children: ["a", "c", "b"], sizes: [1, 5, 3] });
    // restoring puts c back between a and b, at the weight it had
    const back = run(out.state, { type: "window/restore", id: "c" });
    assert.deepEqual(findResize(derive(back)), { path: "", weights: [1, 5, 3] });
  });

  test("delta works on the visible neighbours, skipping the dormant child", () => {
    let s = make({ type: "tree", tree: { type: "row", children: ["a", "c", "b"], sizes: [2, 5, 2] } }, ["a", "b", "c"]);
    s = run(s, { type: "window/minimize", id: "c" });
    const out = update(s, { type: "layout/resize-split", path: "", index: 0, delta: 1 });
    assert.deepEqual(rejects(out), []);
    assert.deepEqual(layoutOf(out.state).tree.sizes, [3, 5, 1]);
    assert.equal(update(s, { type: "layout/resize-split", path: "", index: 1, delta: 1 }).events[0].reason, "invalid-index");
  });

  test("a wrong number of weights is still rejected: it must match the rendered children, not the stored ones", () => {
    let s = make({ type: "tree", tree: { type: "row", children: ["a", "c", "b"] } }, ["a", "b", "c"]);
    s = run(s, { type: "window/minimize", id: "c" });
    assert.equal(rejects(update(s, { type: "layout/resize-split", path: "", weights: [1, 1, 1] }))[0].reason, "invalid-weights");
  });

  test("paths are the rendered paths: a pruned sibling and a collapsed container shift stored indices", () => {
    // stored: row[ x, column[ p, q, r ], y ]; x and p are minimized => rendered row[ column[q, r], y ]
    const tree = { type: "row", children: ["x", { type: "column", children: ["p", "q", "r"], sizes: [1, 2, 3] }, "y"], sizes: [1, 1, 1] };
    let s = make({ type: "tree", tree }, ["x", "p", "q", "r", "y"]);
    s = run(s, { type: "window/minimize", id: "x" });
    s = run(s, { type: "window/minimize", id: "p" });
    const handles = allResizes(derive(s));
    assert.deepEqual(handles, [
      { path: "", weights: [1, 1] },
      { path: "0", weights: [2, 3] },
    ]);
    const out = update(s, { type: "layout/resize-split", path: "0", weights: [1, 1] });
    assert.deepEqual(rejects(out), []);
    assert.deepEqual(layoutOf(out.state).tree.children[1].sizes, [1, 1, 1]);
    assert.deepEqual(allResizes(derive(out.state))[1], { path: "0", weights: [1, 1] });
    // the outer splitter too: it is the root even though the stored root has three children
    const outer = update(s, { type: "layout/resize-split", path: "", weights: [3, 1] });
    assert.deepEqual(rejects(outer), []);
    assert.deepEqual(layoutOf(outer.state).tree.sizes, [1, 3, 1]);
  });

  test("a container whose only visible child collapses has no splitter of its own", () => {
    const tree = { type: "row", children: ["a", { type: "column", children: ["p", "q"] }] };
    let s = make({ type: "tree", tree }, ["a", "p", "q"]);
    s = run(s, { type: "window/minimize", id: "q" });
    assert.equal(rejects(update(s, { type: "layout/resize-split", path: "1", weights: [1, 1] }))[0].reason, "unknown-split");
    assert.deepEqual(rejects(update(s, { type: "layout/resize-split", path: "", weights: [1, 2] })), []);
  });

  test("a closed window's stale leaf is dormant too", () => {
    let s = make({ type: "tree", tree: { type: "row", children: ["a", "ghost", "b"] } }, ["a", "b"]);
    const out = update(s, { type: "layout/resize-split", path: "", weights: [1, 3] });
    assert.deepEqual(rejects(out), []);
    assert.deepEqual(layoutOf(out.state).tree.sizes, [1, 1, 3]);
  });

  test("a visible window the stored tree lacks counts as a rendered child (treeReconcile appends it)", () => {
    let s = make({ type: "tree", tree: { type: "row", children: ["a", "b"] } }, ["a", "b", "c"]);
    assert.deepEqual(findResize(derive(s)).weights, [1, 1, 1]);
    const out = update(s, { type: "layout/resize-split", path: "", weights: [1, 2, 3] });
    assert.deepEqual(rejects(out), []);
    assert.deepEqual(layoutOf(out.state).tree, { type: "row", children: ["a", "b", "c"], sizes: [1, 2, 3] });
  });

  test("with nothing minimized nothing changes: weights must match the stored children", () => {
    const s = make({ type: "tree", tree: { type: "row", children: ["a", "b"] } }, ["a", "b"]);
    assert.equal(rejects(update(s, { type: "layout/resize-split", path: "", weights: [1, 2, 3] }))[0].reason, "invalid-weights");
  });
});

describe("#11: a splitter drag with a minimized window (bsp)", () => {
  test("a minimized leaf collapses its split in the rendered tree; paths are rendered paths", () => {
    let s = make({ type: "bsp" }, ["a", "b", "c", "d"]);
    s = run(s, { type: "window/minimize", id: "d" }); // d shares the deepest split with c
    const handles = allResizes(derive(s));
    for (const h of handles) {
      const out = update(s, { type: "layout/resize-split", path: h.path, weights: [1, 3] });
      assert.deepEqual(rejects(out), [], `path ${JSON.stringify(h.path)}`);
      const after = allResizes(derive(out.state)).find((x) => x.path === h.path);
      assert.deepEqual(after.weights, [0.25, 0.75]);
    }
    assert.equal(handles.length, 2, "three visible windows have two splitters");
  });

  test("a whole minimized subtree: the sibling takes the parent's place, and restore puts it back", () => {
    let s = make({ type: "bsp" }, ["a", "b", "c"]);
    // a | (b / c)
    s = run(s, { type: "window/minimize", id: "b" });
    s = run(s, { type: "window/minimize", id: "c" });
    assert.deepEqual(allResizes(derive(s)), []);
    s = run(s, { type: "window/restore", id: "b" });
    const [h] = allResizes(derive(s));
    assert.equal(h.path, "");
    const out = update(s, { type: "layout/resize-split", path: "", weights: [1, 3] });
    assert.deepEqual(rejects(out), []);
    assert.equal(layoutOf(out.state).tree.ratio, 0.25);
    const back = run(out.state, { type: "window/restore", id: "c" });
    const handles = allResizes(derive(back));
    assert.deepEqual(handles.map((x) => x.path), ["", "1"]);
    assert.deepEqual(handles[0].weights, [0.25, 0.75]);
  });

  test("delta on a rendered path", () => {
    let s = make({ type: "bsp" }, ["a", "b", "c"]);
    s = run(s, { type: "window/minimize", id: "a" }); // root split now collapses; the rendered root is the b/c split
    const out = update(s, { type: "layout/resize-split", path: "", delta: 0.2 });
    assert.deepEqual(rejects(out), []);
    assert.equal(layoutOf(out.state).tree.second.ratio, 0.7);
  });
});

describe("#11: layout/to-tree builds from the rendered windows", () => {
  for (const [type, container] of [["columns", "row"], ["rows", "column"]]) {
    test(`${type}: stored sizes survive a minimized window, and the minimized window gets no leaf`, () => {
      let s = make({ type }, ["a", "b", "c"]);
      s = run(s, { type: "window/minimize", id: "c" });
      s = run(s, { type: "layout/resize-split", weights: [1, 3] });
      s = run(s, { type: "layout/to-tree" });
      assert.deepEqual(layoutOf(s).tree, { type: container, children: ["a", "b"], sizes: [1, 3] });
      // c is appended when it comes back (treeReconcile), and the splitter then has three weights
      const back = run(s, { type: "window/restore", id: "c" });
      assert.deepEqual(findResize(derive(back)).weights, [1, 3, 2]);
    });
  }

  test("a single visible window is a bare leaf", () => {
    let s = make({ type: "columns" }, ["a", "b"]);
    s = run(s, { type: "window/minimize", id: "b" });
    assert.equal(layoutOf(run(s, { type: "layout/to-tree" })).tree, "a");
  });

  test("master-stack counts only visible windows against masterCount", () => {
    let s = make({ type: "master-stack", masterCount: 1 }, ["a", "b", "c"]);
    s = run(s, { type: "window/minimize", id: "c" });
    assert.deepEqual(treeIds(layoutOf(run(s, { type: "layout/to-tree" })).tree), ["a", "b"]);
  });

  test("bsp keeps the minimized window's leaf (its slot is stored) with its ratios", () => {
    let s = make({ type: "bsp" }, ["a", "b", "c"]);
    s = run(s, { type: "window/minimize", id: "c" });
    const tree = layoutOf(run(s, { type: "layout/to-tree" })).tree;
    assert.deepEqual(treeIds(tree), ["a", "b", "c"]);
    // and the rendered splitter is addressable
    const t = run(s, { type: "layout/to-tree" });
    for (const h of allResizes(derive(t))) assert.deepEqual(rejects(update(t, { type: "layout/resize-split", path: h.path, weights: h.weights.map((w) => w + 1) })), []);
  });
});

describe("#11: drops keep a minimized window's leaf in a stored tree", () => {
  test("a drop between two visible windows does not prune the minimized window's slot", () => {
    let s = make({ type: "tree", tree: { type: "row", children: ["a", "c", "b"] } }, ["a", "b", "c"]);
    s = run(s, { type: "window/minimize", id: "c" });
    s = run(s, { type: "window/drop", id: "a", target: "b", zone: "bottom" });
    assert.deepEqual(treeIds(layoutOf(s).tree).sort(), ["a", "b", "c"]);
    s = run(s, { type: "window/restore", id: "c" });
    assert.deepEqual(treeIds(derive(s) ? layoutOf(s).tree : null).sort(), ["a", "b", "c"]);
  });
});
