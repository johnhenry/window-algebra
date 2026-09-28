import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { geometry, createDrag, updateDrag, createResize, updateResize, updateRatio } from "../src/index.mjs";

const { rect, contains, intersects, intersection, union, inset, constrainSize, sizeToCells, clamp, translate, equalRects } = geometry;

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

  describe("constrainSize: size hints", () => {
    test("exact aspectRatio adjusts whichever dimension changes least", () => {
      // 200x100 is already 2:1 wider than a 1:1 target — height changes less (0 vs 100), so width follows height.
      assert.deepEqual(constrainSize({ width: 200, height: 100 }, { aspectRatio: 1 }), { width: 100, height: 100 });
      // 100x100 into 2:1 — width changes less this time, height is recomputed from width.
      assert.deepEqual(constrainSize({ width: 100, height: 100 }, { aspectRatio: 2 }), { width: 100, height: 50 });
    });

    test("aspectRatio range only kicks in outside [min, max]", () => {
      const constraints = { aspectRatio: { min: 1, max: 2 } };
      assert.deepEqual(constrainSize({ width: 150, height: 100 }, constraints), { width: 150, height: 100 });
      assert.deepEqual(constrainSize({ width: 400, height: 100 }, constraints), { width: 400, height: 200 });
      assert.deepEqual(constrainSize({ width: 50, height: 100 }, constraints), { width: 100, height: 100 });
    });

    test("preserve pins one dimension while the other follows the ratio", () => {
      assert.deepEqual(constrainSize({ width: 300, height: 100 }, { aspectRatio: 1 }, { preserve: "height" }), {
        width: 100,
        height: 100,
      });
      assert.deepEqual(constrainSize({ width: 300, height: 100 }, { aspectRatio: 1 }, { preserve: "width" }), {
        width: 300,
        height: 300,
      });
    });

    test("aspectRatio is re-clamped into min/max after adjustment", () => {
      assert.deepEqual(constrainSize({ width: 500, height: 100 }, { aspectRatio: 1, maxWidth: 300 }), {
        width: 100,
        height: 100,
      });
    });

    test("non-positive or missing aspectRatio bounds are ignored", () => {
      assert.deepEqual(constrainSize({ width: 200, height: 100 }, { aspectRatio: 0 }), { width: 200, height: 100 });
      assert.deepEqual(constrainSize({ width: 200, height: 100 }, { aspectRatio: { min: -1, max: 0 } }), {
        width: 200,
        height: 100,
      });
    });

    test("increments snap onto base + n * increment", () => {
      assert.deepEqual(constrainSize({ width: 87, height: 42 }, { widthIncrement: 10, heightIncrement: 20 }), {
        width: 90,
        height: 40,
      });
    });

    test("increments honour baseWidth/baseHeight (terminal-style cells)", () => {
      const constraints = { widthIncrement: 10, heightIncrement: 20, baseWidth: 4, baseHeight: 8 };
      assert.deepEqual(constrainSize({ width: 84, height: 28 }, constraints), { width: 84, height: 28 });
      assert.deepEqual(constrainSize({ width: 88, height: 30 }, constraints), { width: 84, height: 28 });
    });

    test("without an explicit base, increments default to minWidth/minHeight", () => {
      const constraints = { minWidth: 100, minHeight: 50, widthIncrement: 10, heightIncrement: 10 };
      assert.deepEqual(constrainSize({ width: 104, height: 54 }, constraints), { width: 100, height: 50 });
      assert.deepEqual(constrainSize({ width: 116, height: 56 }, constraints), { width: 120, height: 60 });
    });

    test("increment rounding is re-clamped into min/max", () => {
      assert.deepEqual(constrainSize({ width: 96, height: 0 }, { maxWidth: 100, widthIncrement: 10 }), {
        width: 100,
        height: 0,
      });
    });

    test("a non-positive or non-finite increment is a no-op", () => {
      assert.deepEqual(constrainSize({ width: 87, height: 42 }, { widthIncrement: 0, heightIncrement: -5 }), {
        width: 87,
        height: 42,
      });
    });
  });

  describe("sizeToCells", () => {
    test("null without any increment", () => {
      assert.equal(sizeToCells({ width: 800, height: 480 }, {}), null);
      assert.equal(sizeToCells({ width: 800, height: 480 }), null);
    });

    test("reports cols/rows from base + n * increment", () => {
      assert.deepEqual(sizeToCells({ width: 800, height: 480 }, { widthIncrement: 10, heightIncrement: 20 }), {
        cols: 80,
        rows: 24,
      });
    });

    test("honours a non-zero base, and leaves the other axis null when only one increment is set", () => {
      assert.deepEqual(
        sizeToCells({ width: 84, height: 28 }, { widthIncrement: 10, baseWidth: 4 }),
        { cols: 8, rows: null },
      );
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

  test("resize honours an exact aspectRatio, adjusting the axis the edge isn't dragging", () => {
    // Dragging east only changes width; height follows to keep aspectRatio: 1.
    const east = createResize({ origin: { x: 0, y: 0 }, bounds: rect(0, 0, 100, 100), edge: "e", constraints: { aspectRatio: 1 } });
    assert.deepEqual(updateResize(east, { x: 100, y: 0 }), { x: 0, y: 0, width: 200, height: 200 });
    // Dragging south only changes height; width follows.
    const south = createResize({ origin: { x: 0, y: 0 }, bounds: rect(0, 0, 100, 100), edge: "s", constraints: { aspectRatio: 1 } });
    assert.deepEqual(updateResize(south, { x: 0, y: 50 }), { x: 0, y: 0, width: 150, height: 150 });
  });

  test("resize honours widthIncrement/heightIncrement (terminal-style cells)", () => {
    const resize = createResize({
      origin: { x: 0, y: 0 },
      bounds: rect(0, 0, 100, 100),
      edge: "se",
      constraints: { widthIncrement: 10, heightIncrement: 20 },
    });
    assert.deepEqual(updateResize(resize, { x: 24, y: 24 }), { x: 0, y: 0, width: 120, height: 120 });
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
