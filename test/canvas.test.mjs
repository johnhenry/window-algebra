import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, replay, update, compile, derive, presentationContext, boundsOf, DEFAULT_CONFIG, BASE_CSS, SPLITTER_SIZE, migrate, overlay, row, view, anchor, size } from "../src/index.mjs";
import { createDomRenderer, attachInput } from "../src/browser/index.mjs";
import { attachStage } from "../src/bindings/element.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

// A spatial notebook (a natto.dev-style canvas) puts the renderer's root inside a "world" element it pans and zooms
// with `transform: translate(x, y) scale(z)`. Pointer events and getBoundingClientRect() are then in screen pixels,
// while placements are in the world's own units. `coordinates: { toStage, scale }` tells the adapters how to convert;
// `config.bounds: "none"` makes the stage an unbounded canvas.

/**
 * A pannable, zoomable world inside a viewport whose top-left corner is at client (vx, vy). Mutable: a test can
 * pan or zoom mid-way, and the hook reads the live values like a real app's would.
 */
const createWorld = ({ z = 1, px = 0, py = 0, vx = 10, vy = 20 } = {}) => {
  const w = { z, px, py, vx, vy };
  w.toClient = (x, y) => ({ clientX: w.vx + w.px + x * w.z, clientY: w.vy + w.py + y * w.z });
  w.clientRect = (r) => ({ left: w.vx + w.px + r.x * w.z, top: w.vy + w.py + r.y * w.z, width: r.width * w.z, height: r.height * w.z });
  w.coordinates = { toStage: (cx, cy) => ({ x: (cx - w.vx - w.px) / w.z, y: (cy - w.vy - w.py) / w.z }), scale: () => w.z };
  return w;
};

/** A 600×400 (stage units) world with floating windows; `hook: false` attaches the adapters without `coordinates`. */
const setup = ({ z = 1, config, state, hook = true, input = {}, stage = { width: 600, height: 400 }, world: given } = {}) => {
  const world = given ?? createWorld({ z });
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  doc.body.append(root);
  const coordinates = hook ? world.coordinates : undefined;
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, coordinates });
  const wm = createWindowManager({ state: state ?? createState({ config }), renderer, history: true });
  const commands = [];
  const dispatch = (command) => {
    commands.push(command);
    return wm.dispatch(command);
  };
  const detach = attachInput({ root, getState: wm.getState, dispatch, present: wm.present, simulate: wm.simulate, coordinates, ...input });
  /** The fake DOM does no layout: give the root and every rendered floating view the client rect the world implies. */
  const layout = () => {
    root.rect = world.clientRect({ x: 0, y: 0, ...stage });
    for (const win of Object.values(wm.getState().windows)) {
      const el = renderer.elementFor(win.id);
      const p = win.placement;
      if (el && win.mode === "floating" && Number.isFinite(p.x)) el.rect = world.clientRect(p);
    }
  };
  layout();
  const handle = (id, kind = "move") => {
    const el = renderer.elementFor(id);
    let h = el.querySelector(`[data-wm-handle="${kind}"]`);
    if (!h) {
      h = doc.createElement(kind === "move" ? "header" : "div");
      h.setAttribute("data-wm-handle", kind);
      el.append(h);
    }
    return h;
  };
  let cursor = null;
  const ev = (point, extra = {}) => ({ ...point, pointerId: 1, button: 0, pointerType: "mouse", preventDefault() {}, ...extra });
  /** Press at a stage point (converted to the client point a user would click). */
  const downAt = (target, x, y, extra) => {
    cursor = world.toClient(x, y);
    root.dispatch("pointerdown", { target, ...ev(cursor, extra) });
  };
  /** Move the cursor by screen pixels (what the user's hand does), in `steps` events. */
  const moveBy = (dx, dy, { steps = 3, ...extra } = {}) => {
    const from = cursor;
    for (let i = 1; i <= steps; i++) {
      cursor = { clientX: from.clientX + (dx * i) / steps, clientY: from.clientY + (dy * i) / steps };
      root.dispatch("pointermove", ev(cursor, extra));
      layout();
    }
  };
  /** Move the cursor to a stage point. */
  const moveTo = (x, y, extra) => {
    cursor = world.toClient(x, y);
    root.dispatch("pointermove", ev(cursor, extra));
    layout();
  };
  const up = (extra) => root.dispatch("pointerup", ev(cursor, extra));
  const placement = (id) => wm.getState().windows[id].placement;
  /** The drop/snap zone preview while it is shown, else null. */
  const zoneEl = () => {
    const zone = root.querySelector("[data-wm-drag-overlay]")?.querySelector("[data-wm-drop-zone]");
    return zone && zone.style.getPropertyValue("display") !== "none" ? zone : null;
  };
  return { world, doc, root, renderer, wm, commands, detach, layout, handle, downAt, moveBy, moveTo, up, placement, zoneEl, cursor: () => cursor };
};

const floating = (id, x, y, width = 120, height = 80) => ({ id, mode: "floating", placement: { x, y, width, height } });

describe("coordinates: a zoomed stage tracks the cursor 1:1 in screen space", () => {
  for (const z of [0.5, 2]) {
    test(`zoom ${z}: a floating move keeps the grabbed point under the cursor at every step`, () => {
      const t = setup({ z });
      t.wm.create(floating("a", 200, 150));
      t.layout();
      t.downAt(t.handle("a"), 220, 160); // grab 20, 10 stage units into the window
      for (const [dx, dy] of [[30, 15], [30, 15], [30, 15]]) {
        t.moveBy(dx, dy, { steps: 1 });
        const under = t.world.coordinates.toStage(t.cursor().clientX, t.cursor().clientY);
        const p = t.placement("a");
        assert.deepEqual([under.x - p.x, under.y - p.y], [20, 10], "the grabbed point stays under the cursor");
      }
      t.up();
      // 90 × 45 screen pixels of travel are 90/z × 45/z stage units.
      assert.deepEqual([t.placement("a").x, t.placement("a").y], [200 + 90 / z, 150 + 45 / z]);
      // On screen, the window moved exactly as far as the cursor did.
      const before = t.world.clientRect({ x: 200, y: 150, width: 120, height: 80 });
      const after = t.world.clientRect(t.placement("a"));
      assert.deepEqual([after.left - before.left, after.top - before.top], [90, 45]);
      // One gesture: one undo step.
      t.wm.undo();
      assert.deepEqual([t.placement("a").x, t.placement("a").y], [200, 150]);
    });

    test(`zoom ${z}: resize grips follow the cursor (se and nw)`, () => {
      const t = setup({ z });
      t.wm.create(floating("a", 200, 150));
      t.layout();
      t.downAt(t.handle("a", "resize-se"), 320, 230);
      t.moveBy(40, 20);
      t.up();
      assert.deepEqual(t.placement("a"), { x: 200, y: 150, width: 120 + 40 / z, height: 80 + 20 / z });
      t.downAt(t.handle("a", "resize-nw"), 200, 150);
      t.moveBy(-30, -10);
      t.up();
      const p = t.placement("a");
      assert.deepEqual([p.x, p.y], [200 - 30 / z, 150 - 10 / z]);
      assert.deepEqual([p.width, p.height], [120 + 40 / z + 30 / z, 80 + 20 / z + 10 / z]);
    });
  }

  test("the hook is read live: panning and zooming between gestures changes nothing about the math", () => {
    const t = setup({ z: 1 });
    t.wm.create(floating("a", 200, 150));
    t.layout();
    Object.assign(t.world, { z: 1.5, px: -340, py: 75 });
    t.layout();
    t.downAt(t.handle("a"), 210, 160);
    t.moveBy(60, -30);
    t.up();
    assert.deepEqual([t.placement("a").x, t.placement("a").y], [240, 130]);
  });

  test("scale() is optional: it is read off toStage", () => {
    const world = createWorld({ z: 2 });
    const { toStage } = world.coordinates;
    const t = setup({ world: { ...world, coordinates: { toStage } } });
    t.wm.create(floating("a", 200, 150));
    t.layout();
    t.downAt(t.handle("a", "resize-se"), 320, 230);
    t.moveBy(40, 20);
    t.up();
    assert.deepEqual([t.placement("a").width, t.placement("a").height], [140, 90]);
  });
});

describe("coordinates: snap distances stay constant in screen pixels", () => {
  // a's right edge ends 6 stage units left of b's left edge: 12 screen px at zoom 2 (outside the default 8 px
  // magnet), 3 screen px at zoom 0.5 (inside it).
  const dragNextTo = (z) => {
    const t = setup({ z });
    t.wm.create(floating("a", 100, 100, 100, 60));
    t.wm.create(floating("b", 300, 100, 100, 60));
    t.layout();
    t.downAt(t.handle("a"), 110, 110);
    t.moveTo(110 + 94, 110);
    t.up();
    return t.placement("a").x;
  };

  test("magnet: 8 screen px, whatever the zoom", () => {
    assert.equal(dragNextTo(2), 194, "12 screen px away: no snap");
    assert.equal(dragNextTo(0.5), 200, "3 screen px away: snaps onto b's left edge");
  });

  test("snap-zone threshold: 16 screen px from a stage edge, whatever the zoom", () => {
    for (const [z, zone] of [[2, null], [0.5, "maximize"]]) {
      const t = setup({ z });
      t.wm.create(floating("a", 200, 150));
      t.layout();
      t.downAt(t.handle("a"), 250, 160);
      t.moveTo(300, 10); // 10 stage units below the top edge: 20 screen px at zoom 2, 5 at zoom 0.5
      assert.equal(t.zoneEl()?.getAttribute("data-zone") ?? null, zone, `zoom ${z}`);
      if (zone) {
        // The preview lives in the root's (untransformed) space: stage units.
        assert.deepEqual(["left", "top", "width", "height"].map((p) => t.zoneEl().style.getPropertyValue(p)), ["0px", "0px", "600px", "400px"]);
        t.up();
        assert.deepEqual(t.placement("a"), { x: 0, y: 0, width: 600, height: 400 });
      } else t.up();
    }
  });
});

describe("coordinates: renderer measurements are in stage units", () => {
  test("measure() converts client rects through the hook; without it, it is unchanged", () => {
    const t = setup({ z: 2 });
    t.wm.create(floating("a", -40, 30, 100, 50));
    t.layout();
    assert.deepEqual(t.renderer.measure().a, { x: -40, y: 30, width: 100, height: 50 });
    const plain = setup({ z: 2, hook: false });
    plain.wm.create(floating("a", -40, 30, 100, 50));
    plain.layout();
    // Screen pixels relative to the root's (transformed) box: the old behaviour, which is right for an unzoomed stage.
    assert.deepEqual(plain.renderer.measure().a, { x: -80, y: 60, width: 200, height: 100 });
  });

  test("the JS anchor fallback positions in stage units", () => {
    const world = createWorld({ z: 2, px: 50, py: -30 });
    const doc = createFakeDocument();
    const root = doc.createElement("div");
    doc.body.append(root);
    root.rect = world.clientRect({ x: 0, y: 0, width: 600, height: 400 });
    const renderer = createDomRenderer({ root, document: doc, anchorFallback: true, coordinates: world.coordinates });
    const tree = overlay({}, row({}, view("host")), anchor({ to: "host", side: "bottom", align: "start" }, size({ width: 50, height: 20 }, view("menu"))));
    renderer.commit(compile(tree));
    renderer.elementFor("host").rect = world.clientRect({ x: 100, y: 50, width: 200, height: 100 });
    renderer.elementFor("menu").rect = world.clientRect({ x: 0, y: 0, width: 50, height: 20 });
    renderer.reposition();
    // Below the host, aligned to its start edge, in the root's own units.
    assert.equal(renderer.elementFor("menu").style.getPropertyValue("left"), "100px");
    assert.equal(renderer.elementFor("menu").style.getPropertyValue("top"), "150px");
  });

  test("a splitter drag clamps against constraints in stage units", () => {
    const world = createWorld({ z: 2 });
    const doc = createFakeDocument();
    const root = doc.createElement("div");
    doc.body.append(root);
    root.rect = world.clientRect({ x: 0, y: 0, width: 300, height: 100 });
    const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, coordinates: world.coordinates });
    const wm = createWindowManager({ state: createState({ layout: { type: "columns" } }), renderer });
    for (const id of ["a", "b", "c"]) wm.create({ id });
    wm.dispatch({ type: "window/set-constraints", id: "b", constraints: { minWidth: 80 } });
    attachInput({ root, wm, coordinates: world.coordinates });
    const container = root.querySelector('[data-layout="row"]');
    let pos = 0;
    for (const kid of container.childNodes) {
      const extent = kid.hasAttribute("data-wm-splitter") ? SPLITTER_SIZE : 100;
      kid.rect = world.clientRect({ x: pos, y: 0, width: extent, height: 100 });
      pos += extent;
    }
    container.rect = world.clientRect({ x: 0, y: 0, width: pos, height: 100 });
    const splitter = root.querySelector('[data-wm-splitter][data-wm-index="0"]');
    const at = world.toClient(100, 50);
    const ev = (clientX) => ({ target: splitter, clientX, clientY: at.clientY, pointerId: 1, button: 0, preventDefault() {} });
    root.dispatch("pointerdown", ev(at.clientX));
    root.dispatch("pointermove", ev(at.clientX + 400)); // far toward c: only b's 20 stage units of give count
    root.dispatch("pointerup", ev(at.clientX + 400));
    const mainSize = pos - 2 * SPLITTER_SIZE;
    const weights = wm.getState().workspaces.main.layout.sizes[""];
    assert.ok(Math.abs(weights[1] - (1 - (20 * 2) / mainSize)) < 1e-9, `b's weight ${weights[1]}`);
  });
});

describe("coordinates: touch distances stay screen pixels", () => {
  const swipeSetup = (z) => {
    const world = createWorld({ z });
    const doc = createFakeDocument();
    doc.defaultView = class { static CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } }; };
    const root = doc.createElement("div");
    root.rect = world.clientRect({ x: 0, y: 0, width: 600, height: 400 });
    doc.body.append(root);
    const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, coordinates: world.coordinates });
    const wm = createWindowManager({ state: createState({ layout: { type: "monocle" } }), renderer });
    for (const id of ["a", "b"]) wm.create({ id });
    wm.focus("a");
    attachInput({ root, wm, touch: { swipe: { windows: true } }, afterRender: () => {}, coordinates: world.coordinates });
    const swipe = (screenDx) => {
      const el = renderer.elementFor(wm.getState().focus.window);
      const start = world.toClient(300, 100);
      const ptr = (type, dx) => root.dispatch(type, { target: el, clientX: start.clientX + dx, clientY: start.clientY, pointerId: 7, pointerType: "touch", button: 0, preventDefault() {} });
      ptr("pointerdown", 0);
      ptr("pointermove", screenDx / 2);
      ptr("pointermove", screenDx);
      ptr("pointerup", screenDx);
      return wm.getState().focus.window;
    };
    return swipe;
  };

  test("a window swipe needs swipeDistance (48) screen px at any zoom", () => {
    assert.equal(swipeSetup(2)(-60), "b", "60 screen px is 30 stage units at zoom 2: still a swipe");
    assert.equal(swipeSetup(0.5)(-40), "a", "40 screen px is 80 stage units at zoom 0.5: still too short");
  });
});

describe("coordinates: no hook means exactly the old behaviour", () => {
  // An identity-like hook (client point minus the root's origin, scale 1) must produce the very same commands as
  // no hook at all, on a root that is offset in the page.
  const script = (hook) => {
    const world = createWorld({ z: 1, vx: 37, vy: 11 });
    const t = setup({ world, hook });
    t.wm.create(floating("a", 100, 100, 100, 60));
    t.wm.create(floating("b", 300, 100, 100, 60));
    t.layout();
    t.downAt(t.handle("a"), 110, 110);
    t.moveTo(203, 113); // magnetized onto b
    t.moveTo(300, 8); // a snap zone
    t.up();
    t.downAt(t.handle("b", "resize-se"), 400, 160);
    t.moveBy(-37, 21);
    t.up();
    return { commands: t.commands, state: t.wm.getState() };
  };

  test("the same gestures dispatch the same commands with and without a scale-1 hook", () => {
    const plain = script(false);
    const hooked = script(true);
    assert.deepEqual(hooked.commands.map(({ gesture, ...c }) => c), plain.commands.map(({ gesture, ...c }) => c));
    assert.deepEqual(hooked.state.windows, plain.state.windows);
  });

  test("attachStage forwards coordinates to the renderer and the input adapter", () => {
    const world = createWorld({ z: 2 });
    const doc = createFakeDocument();
    const host = doc.createElement("div");
    doc.body.append(host);
    host.rect = world.clientRect({ x: 0, y: 0, width: 600, height: 400 });
    const stage = attachStage(host, { coordinates: world.coordinates, direction: false, schedule: (task) => task() });
    stage.wm.create(floating("a", 200, 150));
    const el = stage.renderer.elementFor("a");
    el.rect = world.clientRect(stage.wm.getState().windows.a.placement);
    assert.deepEqual(stage.renderer.measure().a, { x: 200, y: 150, width: 120, height: 80 });
    const bar = doc.createElement("header");
    bar.setAttribute("data-wm-handle", "move");
    el.append(bar);
    const from = world.toClient(210, 160);
    const ev = (dx) => ({ target: bar, clientX: from.clientX + dx, clientY: from.clientY, pointerId: 1, button: 0, preventDefault() {} });
    host.dispatch("pointerdown", ev(0));
    host.dispatch("pointermove", ev(50));
    host.dispatch("pointerup", ev(50));
    assert.equal(stage.wm.getState().windows.a.placement.x, 225);
    stage.detach();
  });
});

describe("config.bounds: an unbounded canvas", () => {
  test('defaults to "stage"; config/set takes "stage" or "none"; boundsOf reads it (missing means "stage")', () => {
    const state = createState();
    assert.equal(state.config.bounds, "stage");
    assert.equal(DEFAULT_CONFIG.bounds, "stage");
    assert.equal(boundsOf(state), "stage");
    const out = update(state, { type: "config/set", bounds: "none" });
    assert.equal(out.state.config.bounds, "none");
    assert.equal(boundsOf(out.state), "none");
    for (const bad of ["infinite", true, null, 0]) {
      assert.equal(update(state, { type: "config/set", bounds: bad }).events[0].reason, "invalid-config", String(bad));
    }
    const { bounds: _drop, ...older } = state.config;
    assert.equal(boundsOf({ ...state, config: older }), "stage");
    assert.equal(boundsOf({ ...state, config: undefined }), "stage");
    // A state saved before the key existed loads as it is (no migration needed: it is read with a fallback).
    assert.equal(migrate({ ...state, config: older }).state.config.bounds, undefined);
  });

  test("compile marks the root and lets it overflow; BASE_CSS unclips the host", () => {
    const state = update(createState({ config: { bounds: "none" } }), { type: "window/create", id: "a", mode: "floating", placement: { x: -500, y: -300, width: 200, height: 100 } }).state;
    const render = compile(derive(state), presentationContext(state));
    assert.equal(render.attrs["data-wm-bounds"], "none");
    assert.equal(render.style.overflow, "visible");
    const a = render.children.find((child) => child.view === "a");
    assert.equal(a.style.translate, "-500px -300px");
    const bounded = createState();
    const plain = compile(derive(bounded), presentationContext(bounded));
    assert.equal("data-wm-bounds" in plain.attrs, false);
    assert.equal(plain.style.overflow, "hidden");
    assert.ok(BASE_CSS.includes('[data-wm-root]:has(> [data-wm-bounds="none"]) { overflow: visible;'));
  });

  test("negative and far-away placements survive serialize and load, and replay", () => {
    const t = setup({ config: { bounds: "none" } });
    t.wm.create(floating("a", -1200, -340));
    t.wm.create(floating("b", 98000, 4500));
    t.layout();
    t.downAt(t.handle("a"), -1190, -330);
    t.moveBy(-500, -250);
    t.up();
    const json = t.wm.serialize();
    const other = createWindowManager({ state: createState() });
    other.load(json);
    assert.deepEqual(other.getState().windows.a.placement, { x: -1700, y: -590, width: 120, height: 80 });
    assert.deepEqual(other.getState().windows.b.placement, { x: 98000, y: 4500, width: 120, height: 80 });
    assert.equal(other.getState().config.bounds, "none");
    assert.deepEqual(replay(t.wm.origin, t.wm.log), t.wm.getState());
  });

  for (const z of [1, 0.5]) {
    test(`zoom ${z}: no snap zone and no maximize at the stage edges or corners, and the window goes past them`, () => {
      const t = setup({ z, config: { bounds: "none" } });
      t.wm.create(floating("a", 200, 150));
      t.layout();
      t.downAt(t.handle("a"), 220, 160);
      for (const [x, y] of [[300, 2], [2, 200], [598, 200], [300, 398], [1, 1], [599, 399], [-400, -300]]) {
        t.moveTo(x, y);
        assert.equal(t.zoneEl(), null, `no zone at ${x},${y}`);
      }
      t.up();
      assert.deepEqual(t.placement("a"), { x: -420, y: -310, width: 120, height: 80 });
      assert.equal(t.commands.some((c) => c.type === "window/resize"), false, "nothing snapped or maximized");
    });
  }

  test("the stage edges do not attract, other windows still do", () => {
    const near = (config) => {
      const t = setup({ config });
      t.wm.create(floating("a", 200, 150, 100, 60));
      t.wm.create(floating("b", 400, 300, 100, 60));
      t.layout();
      t.downAt(t.handle("a"), 210, 160);
      t.moveTo(13, 160); // a.x = 3: 3 px from the stage's left edge
      t.up();
      const stageMagnet = t.placement("a").x;
      t.downAt(t.handle("a"), stageMagnet + 10, 160);
      t.moveTo(400 - 100 - 3 + 10, 160); // a's right edge 3 px from b's left edge
      t.up();
      return [stageMagnet, t.placement("a").x];
    };
    assert.deepEqual(near(undefined), [0, 300], "a bounded stage attracts to its edge");
    assert.deepEqual(near({ bounds: "none" }), [3, 300], "an unbounded one does not; b still attracts");
  });

  test("snap.edges is not needed: bounds none switches the zones off even when snap.edges is true", () => {
    const t = setup({ config: { bounds: "none", snap: { edges: true, zones: "halves-quarters" } } });
    t.wm.create(floating("a", 200, 150));
    t.layout();
    t.downAt(t.handle("a"), 220, 160);
    t.moveTo(300, 1);
    assert.equal(t.zoneEl(), null);
    t.up();
    assert.equal(t.wm.getState().windows.a.status, "normal");
  });

  test("a tiled window dragged out as floating lands at the pointer, unclamped (and the grab offset is in stage units)", () => {
    const detachAt = (config, [x, y]) => {
      const world = createWorld({ z: 2 });
      const doc = createFakeDocument();
      const root = doc.createElement("div");
      doc.body.append(root);
      root.rect = world.clientRect({ x: 0, y: 0, width: 400, height: 100 });
      const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, coordinates: world.coordinates });
      const wm = createWindowManager({ state: createState({ layout: { type: "columns" }, config }), renderer });
      for (const id of ["a", "b", "c", "d"]) wm.create({ id });
      wm.resize("b", 100, 40);
      ["a", "b", "c", "d"].forEach((id, i) => (renderer.elementFor(id).rect = world.clientRect({ x: i * 100, y: 0, width: 100, height: 100 })));
      const bar = doc.createElement("header");
      bar.setAttribute("data-wm-handle", "move");
      renderer.elementFor("b").append(bar);
      const commands = [];
      attachInput({ root, getState: wm.getState, dispatch: (c) => (commands.push(c), wm.dispatch(c)), present: wm.present, simulate: wm.simulate, coordinates: world.coordinates });
      const ev = (sx, sy, extra = {}) => ({ target: bar, ...world.toClient(sx, sy), pointerId: 1, button: 0, preventDefault() {}, ...extra });
      root.dispatch("pointerdown", ev(150, 10)); // grab b 50, 10 stage units in
      root.dispatch("pointermove", ev(160, 10));
      root.dispatch("pointermove", ev(x, y, { shiftKey: true }));
      root.dispatch("pointerup", ev(x, y, { shiftKey: true }));
      return commands.find((c) => c.type === "window/detach");
    };
    assert.deepEqual(detachAt(undefined, [250, 60]), { type: "window/detach", id: "b", x: 200, y: 50 });
    assert.deepEqual(detachAt(undefined, [-100, -50]), { type: "window/detach", id: "b", x: 0, y: 0 }, "a bounded stage clamps");
    assert.deepEqual(detachAt({ bounds: "none" }, [-100, -50]), { type: "window/detach", id: "b", x: -150, y: -60 }, "a canvas does not");
  });
});
