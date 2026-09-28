import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { geometry, createDrag, updateDrag, createResize, updateResize, updateRatio } from "../src/index.mjs";

const { rect, contains, intersects, intersection, union, inset, constrainSize, clamp, translate, equalRects } = geometry;

describe("geometry", () => {
  test("contains is half-open", () => {
    const r = rect(0, 0, 10, 10);
    assert.ok(contains(r, { x: 0, y: 0 }));
    assert.ok(!contains(r, { x: 10, y: 5 }));
  });

  test("intersection and union", () => {
    const a = rect(0, 0, 10, 10);
    const b = rect(5, 5, 10, 10);
    assert.ok(intersects(a, b));
    assert.deepEqual(intersection(a, b), rect(5, 5, 5, 5));
    assert.equal(intersection(a, rect(20, 20, 1, 1)), null);
    assert.deepEqual(union(a, b), rect(0, 0, 15, 15));
  });

  test("inset by number or per side", () => {
    assert.deepEqual(inset(rect(0, 0, 100, 50), 10), rect(10, 10, 80, 30));
    assert.deepEqual(inset(rect(0, 0, 100, 50), { left: 5 }), rect(5, 0, 95, 50));
  });

  test("constrainSize clamps into min/max", () => {
    assert.deepEqual(constrainSize({ width: 100, height: 900 }, { minWidth: 320, maxHeight: 600 }), {
      width: 320,
      height: 600,
    });
  });

  test("clamp keeps a rect inside, or partially visible", () => {
    const area = rect(0, 0, 800, 600);
    assert.deepEqual(clamp(rect(700, -20, 200, 100), area), rect(600, 0, 200, 100));
    assert.deepEqual(clamp(rect(-500, 50, 200, 100), area, { keepVisible: 40 }), rect(-160, 50, 200, 100));
  });

  test("translate and equality", () => {
    assert.ok(equalRects(translate(rect(1, 2, 3, 4), 1, 1), rect(2, 3, 3, 4)));
  });
});

describe("interaction primitives", () => {
  test("drag follows the pointer delta", () => {
    const drag = createDrag({ origin: { x: 100, y: 100 }, bounds: rect(40, 60, 500, 300) });
    assert.deepEqual(updateDrag(drag, { x: 150, y: 90 }), { x: 90, y: 50 });
    assert.deepEqual(updateDrag(drag, { x: 153, y: 90 }, { snap: 10 }), { x: 90, y: 50 });
  });

  test("resize from the south-east corner", () => {
    const resize = createResize({ origin: { x: 0, y: 0 }, bounds: rect(10, 10, 200, 100), edge: "se" });
    assert.deepEqual(updateResize(resize, { x: 50, y: 20 }), { x: 10, y: 10, width: 250, height: 120 });
  });

  test("resize from the north-west keeps the opposite corner fixed and honours constraints", () => {
    const resize = createResize({
      origin: { x: 0, y: 0 },
      bounds: rect(100, 100, 200, 200),
      edge: "nw",
      constraints: { minWidth: 150, minHeight: 150 },
    });
    assert.deepEqual(updateResize(resize, { x: 100, y: 100 }), { x: 150, y: 150, width: 150, height: 150 });
  });

  test("unknown edge is rejected", () => {
    assert.throws(() => createResize({ origin: { x: 0, y: 0 }, bounds: rect(), edge: "up" }), /unknown edge/);
  });

  test("divider drag adjusts a ratio within bounds", () => {
    const ratio = updateRatio({ ratio: 0.5, origin: { x: 500, y: 0 }, total: 1000 }, { x: 650, y: 0 });
    assert.equal(ratio, 0.65);
    assert.equal(updateRatio({ ratio: 0.5, origin: { x: 0, y: 0 }, total: 100 }, { x: 1000, y: 0 }), 0.95);
  });
});
