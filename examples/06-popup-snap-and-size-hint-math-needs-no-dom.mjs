// The geometry behind popups, snap zones, magnetism, size hints and pointer
// gestures is pure: feed it rects and points, read back rects. The browser
// adapter only measures and dispatches.
import assert from "node:assert/strict";
import {
  positionPopup,
  snapZoneAt,
  snapZoneRect,
  magnetize,
  geometry,
  createResize,
  updateResize,
  createState,
  update,
} from "@johnhenry/window-algebra";

const stage = { x: 0, y: 0, width: 1000, height: 600 };

// --- xdg_positioner-style popups: a menu below an anchor near the bottom edge
// would overflow, so with `flip: ["y"]` it flips above the anchor.
const anchorRect = { x: 100, y: 560, width: 80, height: 30 };
const plain = positionPopup(anchorRect, { width: 200, height: 150 }, stage, { side: "bottom", align: "start", flip: [] });
assert.equal(plain.y, 590); // overflows: nothing was allowed to adjust
const flipped = positionPopup(anchorRect, { width: 200, height: 150 }, stage, { side: "bottom", align: "start", flip: ["y"] });
assert.equal(flipped.side, "top");
assert.equal(flipped.y, 410);
assert.deepEqual(flipped.flipped, { x: false, y: true });
// `slide` translates back into the stage instead; `resize` shrinks to fit.
const slid = positionPopup(anchorRect, { width: 200, height: 150 }, stage, { side: "bottom", slide: ["y"] });
assert.equal(slid.y, 450);
const shrunk = positionPopup(anchorRect, { width: 200, height: 150 }, stage, { side: "bottom", resize: ["y"] });
assert.equal(shrunk.height, 10);

// --- Snap zones: near the left edge -> left half; near a corner -> that quarter.
assert.equal(snapZoneAt(stage, { x: 4, y: 300 }), "left");
assert.equal(snapZoneAt(stage, { x: 995, y: 5 }), "top-right");
assert.equal(snapZoneAt(stage, { x: 500, y: 300 }), null);
assert.equal(snapZoneAt(stage, { x: 995, y: 5 }, { zones: "halves" }), "maximize"); // corners disabled: top edge wins
assert.deepEqual(snapZoneRect(stage, "top-right"), { x: 500, y: 0, width: 500, height: 300 });

// --- Magnetism: an edge within `magnet` px snaps onto another rect's edge.
const other = { x: 0, y: 0, width: 300, height: 600 };
assert.deepEqual(magnetize({ x: 305, y: 100, width: 200, height: 100 }, [other], { magnet: 8 }), { x: 300, y: 100, width: 200, height: 100 });

// --- Size hints (ICCCM WM_NORMAL_HINTS-style): aspect ratio and terminal cells.
const terminal = { widthIncrement: 8, heightIncrement: 16, baseWidth: 4, baseHeight: 4 };
const cells = geometry.constrainSize({ width: 650, height: 390 }, terminal);
assert.deepEqual(cells, { width: 652, height: 388 }); // 4 + 81*8, 4 + 24*16
assert.deepEqual(geometry.sizeToCells(cells, terminal), { cols: 81, rows: 24 });
assert.deepEqual(geometry.constrainSize({ width: 400, height: 400 }, { aspectRatio: 2 }, { preserve: "width" }), { width: 400, height: 200 });

// Dragging the east edge of a window that must stay 16:9 adjusts its height, not the width you dragged.
const resize = createResize({ origin: { x: 0, y: 0 }, bounds: { x: 0, y: 0, width: 320, height: 180 }, edge: "e", constraints: { aspectRatio: 16 / 9 } });
assert.deepEqual(updateResize(resize, { x: 160, y: 0 }), { x: 0, y: 0, width: 480, height: 270 });

// The same constraints apply to the window/resize command.
let s = update(createState(), { type: "window/create", id: "t", mode: "floating", constraints: terminal }).state;
s = update(s, { type: "window/resize", id: "t", width: 650, height: 390 }).state;
assert.equal(s.windows.t.placement.width, 652);

console.log("06 ok: popup placement, snap zones, magnetism and size hints computed without a DOM");
