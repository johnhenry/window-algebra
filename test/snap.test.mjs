import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { snapZoneAt, snapZoneRect, magnetize, magnetizeResize, SNAP_ZONES } from "../src/interaction/snap.mjs";

const stage = { x: 0, y: 0, width: 400, height: 200 };

describe("snapZoneAt", () => {
  test("near an edge (not a corner) returns the edge zone", () => {
    assert.equal(snapZoneAt(stage, { x: 200, y: 5 }, {}), "maximize"); // top
    assert.equal(snapZoneAt(stage, { x: 5, y: 100 }, {}), "left");
    assert.equal(snapZoneAt(stage, { x: 395, y: 100 }, {}), "right");
    assert.equal(snapZoneAt(stage, { x: 200, y: 195 }, {}), "bottom");
  });

  test("near a corner returns the quarter, taking priority over the plain edge", () => {
    assert.equal(snapZoneAt(stage, { x: 5, y: 5 }, {}), "top-left");
    assert.equal(snapZoneAt(stage, { x: 395, y: 5 }, {}), "top-right");
    assert.equal(snapZoneAt(stage, { x: 5, y: 195 }, {}), "bottom-left");
    assert.equal(snapZoneAt(stage, { x: 395, y: 195 }, {}), "bottom-right");
  });

  test("outside every band returns null", () => {
    assert.equal(snapZoneAt(stage, { x: 200, y: 100 }, {}), null);
  });

  test("a point a little outside the stage is still zoned (a captured pointer mid-drag can overshoot)", () => {
    assert.equal(snapZoneAt(stage, { x: -10, y: 100 }, {}), "left");
  });

  test("a point far outside the stage is not zoned (no unlimited overshoot)", () => {
    assert.equal(snapZoneAt(stage, { x: -60, y: 100 }, {}), null);
  });

  test("threshold widens or narrows the band", () => {
    assert.equal(snapZoneAt(stage, { x: 50, y: 100 }, { threshold: 60 }), "left");
    assert.equal(snapZoneAt(stage, { x: 50, y: 100 }, { threshold: 4 }), null);
  });

  test("edges: false disables it entirely", () => {
    assert.equal(snapZoneAt(stage, { x: 0, y: 0 }, { edges: false }), null);
  });

  test('zones: "halves" never returns a corner quarter, only the plain edge', () => {
    assert.equal(snapZoneAt(stage, { x: 5, y: 5 }, { zones: "halves" }), "maximize");
  });

  test('zones: "quarters" never returns a plain edge', () => {
    assert.equal(snapZoneAt(stage, { x: 200, y: 5 }, { zones: "quarters" }), null);
    assert.equal(snapZoneAt(stage, { x: 5, y: 5 }, { zones: "quarters" }), "top-left");
  });

  test('zones: "off" (or false) disables it like edges: false', () => {
    assert.equal(snapZoneAt(stage, { x: 0, y: 0 }, { zones: "off" }), null);
    assert.equal(snapZoneAt(stage, { x: 0, y: 0 }, { zones: false }), null);
  });

  test("null stage or point is handled", () => {
    assert.equal(snapZoneAt(null, { x: 0, y: 0 }), null);
    assert.equal(snapZoneAt(stage, null), null);
  });
});

describe("snapZoneRect", () => {
  test("maximize fills the stage", () => {
    assert.deepEqual(snapZoneRect(stage, "maximize"), { x: 0, y: 0, width: 400, height: 200 });
  });

  test("left/right/bottom are halves", () => {
    assert.deepEqual(snapZoneRect(stage, "left"), { x: 0, y: 0, width: 200, height: 200 });
    assert.deepEqual(snapZoneRect(stage, "right"), { x: 200, y: 0, width: 200, height: 200 });
    assert.deepEqual(snapZoneRect(stage, "bottom"), { x: 0, y: 100, width: 400, height: 100 });
  });

  test("corners are quarters", () => {
    assert.deepEqual(snapZoneRect(stage, "top-left"), { x: 0, y: 0, width: 200, height: 100 });
    assert.deepEqual(snapZoneRect(stage, "top-right"), { x: 200, y: 0, width: 200, height: 100 });
    assert.deepEqual(snapZoneRect(stage, "bottom-left"), { x: 0, y: 100, width: 200, height: 100 });
    assert.deepEqual(snapZoneRect(stage, "bottom-right"), { x: 200, y: 100, width: 200, height: 100 });
  });

  test("an offset stage carries its origin through", () => {
    assert.deepEqual(snapZoneRect({ x: 10, y: 20, width: 100, height: 50 }, "right"), { x: 60, y: 20, width: 50, height: 50 });
  });

  test("an unknown zone or missing stage returns null", () => {
    assert.equal(snapZoneRect(stage, "nope"), null);
    assert.equal(snapZoneRect(null, "left"), null);
  });

  test("SNAP_ZONES lists every zone snapZoneRect understands", () => {
    for (const zone of SNAP_ZONES) assert.ok(snapZoneRect(stage, zone));
  });
});

describe("magnetize (move)", () => {
  test("snaps the left edge onto another window's right edge within magnet px", () => {
    const moving = { x: 106, y: 50, width: 80, height: 40 };
    const other = { x: 0, y: 0, width: 100, height: 100 };
    assert.deepEqual(magnetize(moving, [other], { magnet: 8 }), { x: 100, y: 50, width: 80, height: 40 });
  });

  test("snaps left-to-left too (aligning, not just touching)", () => {
    const moving = { x: 4, y: 50, width: 80, height: 40 };
    const other = { x: 0, y: 200, width: 100, height: 100 };
    assert.deepEqual(magnetize(moving, [other], { magnet: 8 }).x, 0);
  });

  test("x and y snap independently", () => {
    const moving = { x: 106, y: 203, width: 80, height: 40 };
    const other = { x: 0, y: 0, width: 100, height: 200 };
    assert.deepEqual(magnetize(moving, [other], { magnet: 8 }), { x: 100, y: 200, width: 80, height: 40 });
  });

  test("beyond magnet distance: no change", () => {
    const moving = { x: 150, y: 50, width: 80, height: 40 };
    const other = { x: 0, y: 0, width: 100, height: 100 };
    assert.deepEqual(magnetize(moving, [other], { magnet: 8 }), { ...moving });
  });

  test("picks the closest candidate among several others", () => {
    const moving = { x: 103, y: 0, width: 10, height: 10 };
    const near = { x: 100, y: 0, width: 0, height: 0 }; // its right edge is at 100, distance 3
    const far = { x: 90, y: 0, width: 0, height: 0 }; // distance 13, out of range anyway
    assert.equal(magnetize(moving, [far, near], { magnet: 8 }).x, 100);
  });

  test("the stage rect attracts like any other rect (pass it in `others`)", () => {
    const moving = { x: 396, y: 50, width: 80, height: 40 };
    assert.deepEqual(magnetize(moving, [stage], { magnet: 8 }), { x: 400, y: 50, width: 80, height: 40 });
  });

  test("magnet: 0 disables it", () => {
    const moving = { x: 100, y: 50, width: 80, height: 40 };
    assert.deepEqual(magnetize(moving, [stage], { magnet: 0 }), { ...moving });
  });

  test("no others: unchanged", () => {
    const moving = { x: 100, y: 50, width: 80, height: 40 };
    assert.deepEqual(magnetize(moving, [], { magnet: 8 }), { ...moving });
  });

  test("null/undefined rects in `others` are ignored", () => {
    const moving = { x: 100, y: 50, width: 80, height: 40 };
    assert.deepEqual(magnetize(moving, [null, undefined, stage], { magnet: 8 }).x, 100);
  });

  test("a falsy rect passed in returns it unchanged (guards against a null moving rect)", () => {
    assert.equal(magnetize(null, [stage], {}), null);
  });
});

describe("magnetizeResize", () => {
  test('edge "e": only the right edge (width) snaps', () => {
    const rect = { x: 0, y: 0, width: 96, height: 50 };
    const other = { x: 100, y: 0, width: 50, height: 50 };
    assert.deepEqual(magnetizeResize(rect, [other], "e", { magnet: 8 }), { x: 0, y: 0, width: 100, height: 50 });
  });

  test('edge "w": the left edge moves and width adjusts, right edge fixed', () => {
    const rect = { x: 54, y: 0, width: 50, height: 50 }; // right edge at 104
    const other = { x: 0, y: 0, width: 50, height: 50 }; // right edge at 50
    assert.deepEqual(magnetizeResize(rect, [other], "w", { magnet: 8 }), { x: 50, y: 0, width: 54, height: 50 });
  });

  test('edge "s": only height snaps', () => {
    const rect = { x: 0, y: 0, width: 50, height: 96 };
    const other = { x: 0, y: 100, width: 50, height: 50 };
    assert.deepEqual(magnetizeResize(rect, [other], "s", { magnet: 8 }), { x: 0, y: 0, width: 50, height: 100 });
  });

  test('edge "n": the top edge moves, bottom fixed', () => {
    const rect = { x: 0, y: 54, width: 50, height: 50 }; // bottom at 104
    const other = { x: 0, y: 0, width: 50, height: 50 }; // bottom at 50
    assert.deepEqual(magnetizeResize(rect, [other], "n", { magnet: 8 }), { x: 0, y: 50, width: 50, height: 54 });
  });

  test('a corner edge (e.g. "se") snaps both moving edges independently', () => {
    const rect = { x: 0, y: 0, width: 96, height: 96 };
    const other = { x: 100, y: 0, width: 0, height: 0 };
    const other2 = { x: 0, y: 100, width: 0, height: 0 };
    assert.deepEqual(magnetizeResize(rect, [other, other2], "se", { magnet: 8 }), { x: 0, y: 0, width: 100, height: 100 });
  });

  test("width/height never go negative", () => {
    const rect = { x: 90, y: 0, width: 10, height: 10 };
    const other = { x: 200, y: 0, width: 0, height: 0 }; // far beyond magnet: no snap anyway, but exercise the clamp
    const out = magnetizeResize(rect, [other], "w", { magnet: 1000 });
    assert.ok(out.width >= 0);
  });

  test("beyond magnet: unchanged", () => {
    const rect = { x: 0, y: 0, width: 50, height: 50 };
    const other = { x: 200, y: 0, width: 10, height: 10 };
    assert.deepEqual(magnetizeResize(rect, [other], "se", { magnet: 8 }), rect);
  });

  test("magnet: 0 disables it", () => {
    const rect = { x: 0, y: 0, width: 96, height: 50 };
    const other = { x: 100, y: 0, width: 50, height: 50 };
    assert.deepEqual(magnetizeResize(rect, [other], "e", { magnet: 0 }), rect);
  });

  test("a falsy rect is returned unchanged", () => {
    assert.equal(magnetizeResize(null, [], "se", {}), null);
  });
});
