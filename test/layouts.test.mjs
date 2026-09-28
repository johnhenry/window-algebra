import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  view,
  row,
  overlay,
  views,
  validate,
  masterStack,
  columns,
  rows,
  monocle,
  tabs,
  autoGrid,
  fixedGrid,
  floating,
  centered,
  dock,
  hybrid,
  spiral,
  bspLeaf,
  bspInsert,
  bspRemove,
  bspSetRatio,
  bspRotate,
  bspIds,
  bspToLayout,
  bspFrom,
} from "../src/index.mjs";

const five = ["a", "b", "c", "d", "e"];

describe("derived layouts", () => {
  test("master-stack: master weighted, rest in a column", () => {
    const tree = masterStack({ ratio: 0.6 }, ["a", "b", "c"]);
    assert.equal(tree.type, "row");
    assert.deepEqual(tree.children[0], { type: "size", options: { weight: 0.6 }, child: view("a") });
    assert.equal(tree.children[1].options.weight, 0.4);
    assert.equal(tree.children[1].child.type, "column");
  });

  test("master-stack degenerates gracefully", () => {
    assert.deepEqual(masterStack({}, ["a"]), view("a"));
    assert.equal(masterStack({}, []).type, "row");
    assert.deepEqual(views(masterStack({ side: "right" }, ["a", "b"])), ["b", "a"]);
  });

  test("monocle and tabs are stacks with an active view", () => {
    assert.deepEqual(monocle({ active: "b" }, ["a", "b"]).options, { active: "b" });
    assert.deepEqual(tabs({}, ["a", "b"]).options, { active: "a", chrome: "tabs" });
  });

  test("grid layouts use the grid primitive", () => {
    assert.deepEqual(autoGrid({ min: 200 }, ["a"]).options, { columns: { repeat: "auto-fit", min: 200, max: "1fr" } });
    assert.deepEqual(fixedGrid({ columns: 3 }, ["a"]).options, { columns: 3 });
  });

  test("floating is sugar for place + size", () => {
    const node = floating({ x: 10, y: 20, width: 300, height: 200 }, "term");
    assert.equal(node.type, "place");
    assert.deepEqual(node.options, { x: 10, y: 20 });
    assert.deepEqual(node.child.options, { width: 300, height: 200 });
    assert.deepEqual(node.child.child, view("term"));
  });

  test("centered and dock", () => {
    assert.deepEqual(centered({ width: 500 }, "dlg").options, { x: "center", y: "center" });
    const docked = dock({ side: "left", extent: 240 }, "sidebar", view("main"));
    assert.equal(docked.type, "row");
    assert.deepEqual(docked.children[0].options, { width: 240 });
    assert.equal(dock({ side: "bottom", extent: 40 }, "panel", view("main")).type, "column");
  });

  test("hybrid overlays floating over tiled", () => {
    const tree = hybrid(columns({}, ["a", "b"]), [floating({ x: 1, y: 1 }, "c")]);
    assert.equal(tree.type, "overlay");
    assert.deepEqual(views(tree), ["a", "b", "c"]);
  });

  test("spiral alternates direction", () => {
    const tree = spiral({}, ["a", "b", "c"]);
    assert.equal(tree.type, "row");
    assert.equal(tree.children[1].child.type, "column");
  });

  test("the same five windows run through every layout without special cases", () => {
    const layouts = {
      floating: overlay({}, ...five.map((id, i) => floating({ x: i * 10, y: i * 10, width: 200, height: 100 }, id))),
      masterStack: masterStack({}, five),
      bsp: bspToLayout(bspFrom(five)),
      monocle: monocle({}, five),
      grid: autoGrid({ min: 300 }, five),
      columns: columns({}, five),
      rows: rows({}, five),
      tabs: tabs({}, five),
      spiral: spiral({}, five),
    };
    for (const [name, tree] of Object.entries(layouts)) {
      assert.deepEqual(validate(tree), { ok: true }, name);
      assert.deepEqual([...views(tree)].sort(), five, name);
    }
  });
});

describe("bsp (stateful layout, functional)", () => {
  test("insert splits the target leaf, alternating direction", () => {
    let tree = bspInsert(null, { id: "a" });
    assert.deepEqual(tree, bspLeaf("a"));
    tree = bspInsert(tree, { id: "b" });
    assert.equal(tree.type, "split");
    assert.equal(tree.direction, "horizontal");
    tree = bspInsert(tree, { id: "c", target: "b" });
    assert.equal(tree.second.direction, "vertical");
    assert.deepEqual(bspIds(tree), ["a", "b", "c"]);
  });

  test("insert is idempotent for existing ids", () => {
    const tree = bspFrom(["a", "b"]);
    assert.equal(bspInsert(tree, { id: "a" }), tree);
  });

  test("remove promotes the sibling", () => {
    const tree = bspFrom(["a", "b", "c"]);
    const next = bspRemove(tree, "b");
    assert.deepEqual(bspIds(next), ["a", "c"]);
    assert.deepEqual(bspRemove(bspLeaf("a"), "a"), null);
  });

  test("set ratio and rotate target the split containing a leaf", () => {
    const tree = bspFrom(["a", "b"]);
    assert.equal(bspSetRatio(tree, "b", 0.7).ratio, 0.7);
    assert.equal(bspSetRatio(tree, "b", 2).ratio, 0.95);
    assert.equal(bspRotate(tree, "a").direction, "vertical");
  });

  test("toLayout produces nested rows/columns with weights", () => {
    const tree = bspSetRatio(bspFrom(["a", "b", "c"]), "a", 0.6);
    const layout = bspToLayout(tree);
    assert.equal(layout.type, "row");
    assert.equal(layout.children[0].options.weight, 0.6);
    assert.equal(layout.children[1].child.type, "column");
    assert.deepEqual(bspToLayout(null), row({}));
  });
});
