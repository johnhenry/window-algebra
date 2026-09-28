import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, replay } from "../src/index.mjs";
import { createDomRenderer, attachInput } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

/** A single 600×400 stage; windows are floating and set up individually per test. */
const setup = ({ config, stageRect = { left: 0, top: 0, width: 600, height: 400 } } = {}) => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  root.rect = stageRect;
  doc.body.append(root);
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false });
  const wm = createWindowManager({ state: createState({ config }), renderer, history: true });
  const commands = [];
  const dispatch = (command) => {
    commands.push(command);
    return wm.dispatch(command);
  };
  const detach = attachInput({ root, getState: wm.getState, dispatch, present: wm.present, simulate: wm.simulate });
  const handleFor = (id) => {
    const el = renderer.elementFor(id);
    const handle = doc.createElement("header");
    handle.setAttribute("data-wm-handle", "move");
    el.append(handle);
    return handle;
  };
  const resizeHandleFor = (id, edge = "se") => {
    const el = renderer.elementFor(id);
    const handle = doc.createElement("div");
    handle.setAttribute("data-wm-handle", `resize-${edge}`);
    el.append(handle);
    return handle;
  };
  const at = (x, y, extra = {}) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {}, ...extra });
  const down = (target, x, y) => root.dispatch("pointerdown", { target, ...at(x, y) });
  const move = (x, y) => root.dispatch("pointermove", at(x, y));
  const up = (x, y) => root.dispatch("pointerup", at(x, y));
  const overlay = () => root.querySelector("[data-wm-drag-overlay]");
  const zoneEl = () => overlay()?.querySelector("[data-wm-drop-zone]");
  const resizes = () => commands.filter((c) => c.type === "window/resize");
  const moves = () => commands.filter((c) => c.type === "window/move");
  return { doc, root, renderer, wm, commands, detach, down, move, up, overlay, zoneEl, handleFor, resizeHandleFor, resizes, moves };
};

describe("snap zones: half/quarter/maximize preview and apply", () => {
  test("near the top edge previews and applies maximize, as one undo step", () => {
    const t = setup();
    t.wm.create({ id: "b", mode: "floating", placement: { x: 150, y: 150, width: 80, height: 60 } });
    const handle = t.handleFor("b");
    t.down(handle, 190, 160);
    t.move(230, 15); // pointer near the top edge (within the default 16px threshold), x central
    const zone = t.zoneEl();
    assert.equal(zone.getAttribute("data-zone"), "maximize");
    assert.equal(zone.getAttribute("data-op"), "snap");
    assert.deepEqual(
      [zone.style.getPropertyValue("left"), zone.style.getPropertyValue("top"), zone.style.getPropertyValue("width"), zone.style.getPropertyValue("height")],
      ["0px", "0px", "600px", "400px"],
    );
    t.up(230, 15);
    assert.deepEqual(t.wm.state.windows.b.placement, { x: 0, y: 0, width: 600, height: 400 });
    assert.equal(t.resizes().length, 1, "the zone is applied as one window/resize");
    assert.deepEqual(replay(t.wm.origin, t.wm.log), t.wm.getState());
    // The whole gesture (the moves during the drag, plus the final snap on release)
    // is a single undo step, however many commands it dispatched along the way.
    t.wm.undo();
    assert.deepEqual(t.wm.state.windows.b.placement, { x: 150, y: 150, width: 80, height: 60 });
  });

  test("near the left edge previews and applies the left half", () => {
    const t = setup();
    t.wm.create({ id: "b", mode: "floating", placement: { x: 250, y: 150, width: 80, height: 60 } });
    const handle = t.handleFor("b");
    t.down(handle, 280, 170);
    t.move(5, 200); // pointer near the left edge, y central: not a corner
    assert.equal(t.zoneEl().getAttribute("data-zone"), "left");
    t.up(5, 200);
    assert.deepEqual(t.wm.state.windows.b.placement, { x: 0, y: 0, width: 300, height: 400 });
  });

  test("near a corner previews and applies the quarter, taking priority over the plain edge", () => {
    const t = setup();
    t.wm.create({ id: "b", mode: "floating", placement: { x: 250, y: 150, width: 80, height: 60 } });
    const handle = t.handleFor("b");
    t.down(handle, 280, 170);
    t.move(595, 395); // bottom-right corner
    assert.equal(t.zoneEl().getAttribute("data-zone"), "bottom-right");
    t.up(595, 395);
    assert.deepEqual(t.wm.state.windows.b.placement, { x: 300, y: 200, width: 300, height: 200 });
  });

  test("away from every edge: no zone, an ordinary move", () => {
    const t = setup();
    t.wm.create({ id: "b", mode: "floating", placement: { x: 250, y: 150, width: 80, height: 60 } });
    const handle = t.handleFor("b");
    t.down(handle, 280, 170);
    t.move(300, 200);
    assert.equal(t.overlay(), null);
    t.up(300, 200);
    assert.equal(t.resizes().length, 0);
    assert.deepEqual([t.wm.state.windows.b.placement.x, t.wm.state.windows.b.placement.y], [270, 180]);
  });

  test("a window's constraints still clamp the applied zone size", () => {
    const t = setup();
    t.wm.create({
      id: "b",
      mode: "floating",
      placement: { x: 250, y: 150, width: 80, height: 60 },
      constraints: { minWidth: 400 },
    });
    const handle = t.handleFor("b");
    t.down(handle, 280, 170);
    t.move(5, 200); // → left half, width 300, below minWidth
    t.up(5, 200);
    assert.equal(t.wm.state.windows.b.placement.width, 400, "constrainSize (in window/resize) clamps below the zone's width");
  });

  test("config.snap.edges: false disables the preview and the apply; magnet: 0 keeps the raw position", () => {
    const t = setup({ config: { snap: { edges: false, magnet: 0 } } });
    t.wm.create({ id: "b", mode: "floating", placement: { x: 150, y: 150, width: 80, height: 60 } });
    const handle = t.handleFor("b");
    t.down(handle, 190, 160);
    t.move(230, 15);
    assert.equal(t.overlay(), null, "no zone preview when edges is disabled");
    t.up(230, 15);
    assert.equal(t.resizes().length, 0);
    assert.deepEqual([t.wm.state.windows.b.placement.x, t.wm.state.windows.b.placement.y], [190, 5]);
  });

  test('zones: "halves" never shows a corner quarter near a corner', () => {
    const t = setup({ config: { snap: { zones: "halves" } } });
    t.wm.create({ id: "b", mode: "floating", placement: { x: 250, y: 150, width: 80, height: 60 } });
    const handle = t.handleFor("b");
    t.down(handle, 280, 170);
    // Near the bottom-right corner, but zones: "halves" never offers a quarter: with no corner
    // check, the first matching plain edge (checked top, left, right, bottom) wins.
    t.move(595, 395);
    assert.equal(t.zoneEl().getAttribute("data-zone"), "right");
  });

  test("Escape cancels: the window goes back, no zone applied", () => {
    const t = setup();
    t.wm.create({ id: "b", mode: "floating", placement: { x: 150, y: 150, width: 80, height: 60 } });
    const handle = t.handleFor("b");
    t.down(handle, 190, 160);
    t.move(230, 15);
    assert.equal(t.zoneEl().getAttribute("data-zone"), "maximize");
    t.doc.dispatch("keydown", { key: "Escape", type: "keydown", preventDefault() {}, stopPropagation() {} });
    assert.deepEqual([t.wm.state.windows.b.placement.x, t.wm.state.windows.b.placement.y], [150, 150]);
    assert.equal(t.overlay(), null);
    t.up(230, 15);
    assert.equal(t.resizes().length, 0);
  });
});

describe("magnetism: floating move/resize snaps to other windows' edges and the stage", () => {
  test("a moving window's left edge snaps onto another window's right edge within config.snap.magnet", () => {
    const t = setup();
    t.wm.create({ id: "anchor", mode: "floating", placement: { x: 0, y: 0, width: 150, height: 150 } });
    t.wm.create({ id: "b", mode: "floating", placement: { x: 200, y: 170, width: 60, height: 40 } });
    const handle = t.handleFor("b");
    t.down(handle, 300, 200);
    t.move(254, 200); // raw target x=154 (4px right of anchor's edge at 150), y=170 unchanged
    assert.equal(t.wm.state.windows.b.placement.x, 150, "snapped onto the anchor's right edge");
    assert.equal(t.wm.state.windows.b.placement.y, 170, "y unaffected: no nearby edge on that axis");
    t.up(254, 200);
  });

  test("beyond the magnet distance: no snap", () => {
    const t = setup();
    t.wm.create({ id: "anchor", mode: "floating", placement: { x: 0, y: 0, width: 150, height: 150 } });
    t.wm.create({ id: "b", mode: "floating", placement: { x: 200, y: 170, width: 60, height: 40 } });
    const handle = t.handleFor("b");
    t.down(handle, 300, 200);
    t.move(280, 200); // raw target x=180: 30px away, beyond the default 8px magnet
    assert.equal(t.wm.state.windows.b.placement.x, 180);
    t.up(280, 200);
  });

  test("config.snap.magnet: 0 disables magnetism", () => {
    const t = setup({ config: { snap: { magnet: 0 } } });
    t.wm.create({ id: "anchor", mode: "floating", placement: { x: 0, y: 0, width: 150, height: 150 } });
    t.wm.create({ id: "b", mode: "floating", placement: { x: 200, y: 170, width: 60, height: 40 } });
    const handle = t.handleFor("b");
    t.down(handle, 300, 200);
    t.move(254, 200);
    assert.equal(t.wm.state.windows.b.placement.x, 154, "magnetism off: the raw position stands");
    t.up(254, 200);
  });

  test("the stage attracts too (moving a window flush against it)", () => {
    const t = setup(); // a 600×400 stage
    t.wm.create({ id: "b", mode: "floating", placement: { x: 300, y: 300, width: 60, height: 40 } });
    const handle = t.handleFor("b");
    t.down(handle, 320, 320);
    // The pointer itself stays >16px from every stage edge (no zone preview), but the raw
    // target rect {x:536,y:356,w:60,h:40} has its right edge 4px from 600 and its bottom edge
    // 4px from 400 — both within the default 8px magnet.
    t.move(556, 376);
    assert.deepEqual([t.wm.state.windows.b.placement.x, t.wm.state.windows.b.placement.y], [540, 360]);
    t.up(556, 376);
  });

  test("resizing an edge snaps that edge onto another window's edge", () => {
    const t = setup();
    t.wm.create({ id: "b", mode: "floating", placement: { x: 0, y: 0, width: 100, height: 100 } });
    t.wm.create({ id: "edge", mode: "floating", placement: { x: 196, y: 0, width: 50, height: 50 } });
    const grip = t.resizeHandleFor("b", "se");
    t.down(grip, 50, 50);
    t.move(142, 50); // raw width = 100 + 92 = 192: 4px short of the other window's left edge at 196
    assert.equal(t.wm.state.windows.b.placement.width, 196);
    assert.equal(t.wm.state.windows.b.placement.height, 100);
    t.up(142, 50);
  });

  test("resizing the opposite edge (w) moves x and keeps the far edge fixed", () => {
    const t = setup();
    t.wm.create({ id: "b", mode: "floating", placement: { x: 100, y: 0, width: 100, height: 100 } }); // right edge at 200
    t.wm.create({ id: "edge", mode: "floating", placement: { x: 46, y: 0, width: 4, height: 50 } }); // right edge at 50
    const grip = t.resizeHandleFor("b", "w");
    t.down(grip, 100, 0);
    t.move(96, 0); // raw left edge = 96: 4px from the other window's right edge at 50? no — from 96 itself
    // raw left = 100 + (96-100) = 96; nearest candidate is this window's own history irrelevant; snap onto 50 is 46px away (out of range),
    // so nothing to snap onto here — assert the resize still applied the raw (unsnapped) value.
    assert.equal(t.wm.state.windows.b.placement.width, 104);
    assert.equal(t.wm.state.windows.b.placement.x, 96);
    t.up(96, 0);
  });

  test("resize magnetism is disabled by config.snap.magnet: 0", () => {
    const t = setup({ config: { snap: { magnet: 0 } } });
    t.wm.create({ id: "b", mode: "floating", placement: { x: 0, y: 0, width: 100, height: 100 } });
    t.wm.create({ id: "edge", mode: "floating", placement: { x: 196, y: 0, width: 50, height: 50 } });
    const grip = t.resizeHandleFor("b", "se");
    t.down(grip, 50, 50);
    t.move(142, 50);
    assert.equal(t.wm.state.windows.b.placement.width, 192, "no snap: the raw resize stands");
    t.up(142, 50);
  });
});
