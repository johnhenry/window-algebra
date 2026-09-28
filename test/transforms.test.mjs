import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  view,
  row,
  column,
  stack,
  size,
  place,
  views,
  find,
  mapViews,
  replace,
  remove,
  mirror,
  flip,
  rotate,
  reverse,
  swap,
  count,
  equals,
  fold,
  validate,
} from "../src/index.mjs";

const layout = row({}, view("a"), column({}, view("b"), view("c")));

describe("tree transformations", () => {
  test("views lists ids in document order", () => {
    assert.deepEqual(views(layout), ["a", "b", "c"]);
  });

  test("mirror reverses rows only", () => {
    const m = mirror(layout);
    assert.equal(m.children[0].type, "column");
    assert.deepEqual(views(m), ["b", "c", "a"]);
  });

  test("flip reverses columns only", () => {
    assert.deepEqual(views(flip(layout)), ["a", "c", "b"]);
  });

  test("rotate swaps rows and columns", () => {
    const r = rotate(layout);
    assert.equal(r.type, "column");
    assert.equal(r.children[1].type, "row");
    assert.ok(equals(rotate(r), layout));
  });

  test("reverse reverses every container", () => {
    assert.deepEqual(views(reverse(layout)), ["c", "b", "a"]);
  });

  test("mirror is an involution", () => {
    assert.ok(equals(mirror(mirror(layout)), layout));
  });

  test("transformations do not mutate the input", () => {
    const before = JSON.stringify(layout);
    mirror(layout);
    rotate(layout);
    remove(layout, "b");
    assert.equal(JSON.stringify(layout), before);
  });

  test("results are still valid trees", () => {
    for (const fn of [mirror, flip, rotate, reverse]) assert.deepEqual(validate(fn(layout)), { ok: true });
  });

  test("mapViews wraps every view", () => {
    const sized = mapViews(layout, (v) => size({ weight: 1 }, v));
    assert.equal(count(sized), count(layout) + 3);
    assert.equal(sized.children[0].type, "size");
  });

  test("replace by id", () => {
    const next = replace(layout, "b", stack({ active: "b" }, view("b"), view("x")));
    assert.deepEqual(views(next), ["a", "b", "x", "c"]);
  });

  test("remove drops a view and any modifiers wrapping it", () => {
    const tree = row({}, size({ weight: 2 }, view("a")), place({ x: 1 }, size({}, view("b"))));
    const next = remove(tree, "b");
    assert.equal(next.children.length, 1);
    assert.deepEqual(views(next), ["a"]);
  });

  test("swap exchanges two views", () => {
    assert.deepEqual(views(swap(layout, "a", "c")), ["c", "b", "a"]);
  });

  test("find by id or predicate", () => {
    assert.equal(find(layout, "c").id, "c");
    assert.equal(find(layout, (n) => n.type === "column").children.length, 2);
    assert.equal(find(layout, "zzz"), undefined);
  });

  test("fold visits nodes pre-order", () => {
    assert.deepEqual(
      fold(layout, (acc, node) => [...acc, node.type], []),
      ["row", "view", "column", "view", "view"],
    );
  });

  test("a view may appear more than once (projections)", () => {
    const tree = row({}, view("logs"), view("logs"));
    assert.deepEqual(views(tree), ["logs", "logs"]);
  });
});
