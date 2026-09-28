import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, replay } from "../src/index.mjs";
import { createDomRenderer, attachInput } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

/**
 * Four tiled columns a|b|c|d, each 100×100, in a 400×100 root. Every view gets
 * a title bar (move handle) with a button inside, like real chrome.
 */
const setup = ({ layout = { type: "columns" }, config, windows = ["a", "b", "c", "d"], history = true, input = {} } = {}) => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  root.rect = { left: 0, top: 0, width: 400, height: 100 };
  doc.body.append(root);
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false });
  const wm = createWindowManager({ state: createState({ layout, config }), renderer, history });
  for (const id of windows) wm.create({ id, title: id.toUpperCase() });
  const bars = {};
  const buttons = {};
  const chrome = () => {
    windows.forEach((id, i) => {
      const el = renderer.elementFor(id);
      if (!el) return;
      el.rect = { left: i * 100, top: 0, width: 100, height: 100 };
      if (bars[id]?.parentNode === el) return;
      bars[id] = doc.createElement("header");
      bars[id].setAttribute("data-wm-handle", "move");
      buttons[id] = doc.createElement("button");
      buttons[id].setAttribute("data-wm-command", "window/minimize");
      bars[id].append(buttons[id]);
      el.append(bars[id]);
    });
  };
  chrome();
  const commands = [];
  const dispatch = (command) => {
    commands.push(command);
    return wm.dispatch(command);
  };
  const detach = attachInput({ root, getState: wm.getState, dispatch, present: wm.present, simulate: wm.simulate, ...input });
  const at = (x, y = 50, extra = {}) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {}, ...extra });
  const down = (target, x, y) => root.dispatch("pointerdown", { target, ...at(x, y) });
  const move = (x, y) => root.dispatch("pointermove", at(x, y));
  const up = (x, y) => root.dispatch("pointerup", at(x, y));
  const overlay = () => root.querySelector("[data-wm-drag-overlay]");
  const order = () => wm.state.workspaces[wm.state.activeWorkspace].windows.join("");
  const drops = () => commands.filter((c) => c.type === "window/drop");
  return { doc, root, renderer, wm, bars, buttons, chrome, commands, drops, detach, down, move, up, overlay, order };
};

describe("tiled drag: threshold, overlay and one command per drop", () => {
  test("a press below the threshold stays a click: no overlay, no drop", () => {
    const t = setup();
    t.down(t.bars.a, 50, 10);
    t.move(53, 11);
    assert.equal(t.overlay(), null);
    t.up(53, 11);
    assert.equal(t.drops().length, 0);
    assert.equal(t.wm.state.focus.window, "a");
  });

  test("past the threshold: overlay shields, ghost previews, zone highlights; pointerup dispatches exactly one window/drop", () => {
    const t = setup();
    t.down(t.bars.a, 50, 10);
    t.move(60, 10); // starts the drag (over a itself: no target yet)
    const overlay = t.overlay();
    assert.ok(overlay, "overlay created");
    assert.equal(overlay.style.getPropertyValue("pointer-events"), "auto"); // iframe shield
    assert.ok(t.root.hasAttribute("data-wm-dragging"));
    assert.ok(t.renderer.elementFor("a").hasAttribute("data-wm-drag-source"));
    t.move(150, 50); // center of b → swap
    const zone = overlay.querySelector("[data-wm-drop-zone]");
    assert.equal(zone.getAttribute("data-zone"), "center");
    assert.equal(zone.getAttribute("data-target"), "b");
    assert.equal(zone.getAttribute("data-op"), "swap");
    assert.equal(zone.style.getPropertyValue("width"), "100px", "a swap highlights the whole target");
    const ghosts = overlay.querySelectorAll("wm-view[data-wm-ghost]");
    assert.equal(ghosts.length, 4, "every tiled window has a ghost slot");
    assert.equal(overlay.querySelector('wm-view[data-wm-ghost="dragged"]').getAttribute("data-view"), "a");
    t.move(195, 50); // right edge of b → after
    assert.equal(zone.getAttribute("data-zone"), "right");
    assert.deepEqual([zone.style.getPropertyValue("left"), zone.style.getPropertyValue("width")], ["150px", "50px"], "an insert highlights the edge half");
    assert.equal(t.order(), "abcd", "nothing dispatched while dragging");
    t.up(195, 50);
    assert.deepEqual(t.drops(), [{ type: "window/drop", id: "a", target: "b", zone: "right" }]);
    assert.equal(t.order(), "bacd");
    assert.equal(t.overlay(), null, "overlay removed");
    assert.ok(!t.root.hasAttribute("data-wm-dragging"));
    assert.equal(t.commands.filter((c) => c.type !== "window/focus").length, 1);
  });

  test("the whole drop is one undo step", () => {
    const t = setup();
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    t.move(250, 50);
    t.up(250, 50);
    assert.equal(t.order(), "cbad");
    t.wm.undo();
    assert.equal(t.order(), "abcd");
  });

  test("releasing over nothing (or an invalid spot) dispatches nothing", () => {
    const t = setup();
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    t.move(50, 50); // back over itself
    assert.equal(t.overlay().querySelector("[data-wm-drop-zone]").style.getPropertyValue("display"), "none");
    t.up(50, 50);
    assert.equal(t.drops().length, 0);
  });

  test("Escape aborts the drag; the following pointerup does nothing", () => {
    const t = setup();
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    let stopped = false;
    t.doc.dispatch("keydown", { key: "Escape", preventDefault() {}, stopPropagation: () => (stopped = true) });
    assert.ok(stopped, "Escape is consumed by the drag");
    assert.equal(t.overlay(), null);
    t.up(150, 50);
    assert.equal(t.drops().length, 0);
    assert.equal(t.order(), "abcd");
    assert.equal(t.doc.listeners.get("keydown").size, 0, "key listener removed");
  });

  test("pointercancel aborts too", () => {
    const t = setup();
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    t.root.dispatch("pointercancel", { pointerId: 1 });
    assert.equal(t.overlay(), null);
    assert.equal(t.drops().length, 0);
  });

  test("blocked and pinned windows do not drag", () => {
    const t = setup();
    t.wm.create({ id: "m", role: "dialog", modal: true, parent: "b", focus: false });
    t.chrome();
    t.down(t.bars.b, 150, 10);
    t.move(250, 50);
    assert.equal(t.overlay(), null, "blocked");
    t.up(250, 50);
    t.wm.setDraggable("c", false);
    t.chrome();
    t.down(t.bars.c, 250, 10);
    t.move(350, 50);
    assert.equal(t.overlay(), null, "pinned");
    t.up(350, 50);
    assert.equal(t.drops().length, 0);
    assert.equal(t.renderer.elementFor("c").getAttribute("data-wm-draggable"), "false");
  });

  test("drag mode off disables tiled drags", () => {
    const t = setup({ config: { drag: { tiled: "off" } } });
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    assert.equal(t.overlay(), null);
  });

  test("buttons inside the title bar keep their click", () => {
    const t = setup();
    t.down(t.buttons.b, 150, 10);
    t.move(250, 50);
    assert.equal(t.overlay(), null);
    t.up(250, 50);
    t.root.dispatch("click", { target: t.buttons.b });
    assert.equal(t.wm.state.windows.b.status, "minimized");
  });

  test("preview: false skips the ghost; the zone still highlights", () => {
    const t = setup({ config: { drag: { preview: false } } });
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    assert.equal(t.overlay().querySelectorAll("wm-view").length, 0);
    assert.equal(t.overlay().querySelector("[data-wm-drop-zone]").getAttribute("data-zone"), "center");
    t.up(150, 50);
    assert.equal(t.drops().length, 1);
  });

  test("a custom dragPreview replaces the ghost and sees each change once", () => {
    const calls = [];
    const t = setup({ input: { dragPreview: (ctx) => calls.push([ctx.phase, ctx.drop?.target ?? null, ctx.drop?.zone ?? null, Boolean(ctx.preview)]) } });
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    t.move(151, 50); // same zone: no call
    t.move(105, 50);
    t.up(105, 50);
    assert.deepEqual(calls, [
      ["update", "b", "center", true],
      ["update", "b", "left", true],
      ["end", "b", "left", false],
    ]);
    assert.equal(t.overlay(), null);
  });

  test("tooSmall: reject sends the measured ghost slot sizes with the drop", () => {
    const t = setup({ config: { drag: { tooSmall: "reject" } } });
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    t.up(150, 50);
    assert.deepEqual(t.drops()[0].geometry, { a: { width: 100, height: 100 }, b: { width: 100, height: 100 } });
  });

  test("a new press during a drag aborts it instead of stacking overlays", () => {
    const t = setup();
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    t.down(t.bars.c, 250, 10);
    assert.equal(t.root.querySelectorAll("[data-wm-drag-overlay]").length, 0);
    t.move(350, 50);
    assert.equal(t.root.querySelectorAll("[data-wm-drag-overlay]").length, 1);
    t.up(350, 50);
    assert.deepEqual(t.drops(), [{ type: "window/drop", id: "c", target: "d", zone: "center" }]);
  });

  test("detach during a drag cleans up", () => {
    const t = setup();
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    t.detach();
    assert.equal(t.overlay(), null);
    assert.equal(t.drops().length, 0);
  });
});

describe("floating drags coalesce into one history step", () => {
  const floating = () => {
    const t = setup({ windows: ["a"] });
    t.wm.setMode("a", "floating");
    t.wm.move("a", 10, 10);
    return t;
  };

  test("many pointermoves, one undo step, one log entry", () => {
    const t = floating();
    const logBefore = t.wm.log.length;
    t.down(t.bars.a, 20, 20);
    for (let i = 1; i <= 5; i++) t.move(20 + i * 10, 20 + i);
    t.up(70, 25);
    assert.deepEqual([t.wm.state.windows.a.placement.x, t.wm.state.windows.a.placement.y], [60, 15]);
    assert.equal(t.commands.filter((c) => c.type === "window/move").length, 5);
    assert.equal(t.wm.log.length, logBefore + 1, "the drag logs as one command");
    assert.deepEqual(replay(t.wm.origin, t.wm.log), t.wm.getState());
    t.wm.undo();
    assert.deepEqual([t.wm.state.windows.a.placement.x, t.wm.state.windows.a.placement.y], [10, 10]);
    t.wm.redo();
    assert.deepEqual([t.wm.state.windows.a.placement.x, t.wm.state.windows.a.placement.y], [60, 15]);
    assert.deepEqual(replay(t.wm.origin, t.wm.log), t.wm.getState());
  });

  test("two drags are two steps; a resize drag is one step", () => {
    const t = floating();
    t.down(t.bars.a, 20, 20);
    t.move(30, 20);
    t.move(40, 20);
    t.up(40, 20);
    t.down(t.bars.a, 40, 20);
    t.move(50, 30);
    t.up(50, 30);
    const grip = t.doc.createElement("div");
    grip.setAttribute("data-wm-handle", "resize-se");
    t.renderer.elementFor("a").append(grip);
    t.down(grip, 0, 0);
    t.move(10, 10);
    t.move(20, 20);
    t.up(20, 20);
    const p = () => t.wm.state.windows.a.placement;
    assert.equal(p().width, 500);
    t.wm.undo();
    assert.equal(p().width, 480);
    assert.deepEqual([p().x, p().y], [40, 20]);
    t.wm.undo();
    assert.deepEqual([p().x, p().y], [30, 10]);
    t.wm.undo();
    assert.deepEqual([p().x, p().y], [10, 10]);
    assert.deepEqual(replay(t.wm.origin, t.wm.log), t.wm.getState());
  });

  test("the manager coalesces any gesture-tagged run, keeping non-absolute commands", () => {
    const wm = createWindowManager({ history: true });
    wm.create({ id: "a", mode: "floating" });
    wm.dispatch({ type: "window/move", id: "a", x: 1, y: 1, gesture: "g" });
    wm.dispatch({ type: "window/move", id: "a", x: 2, y: 2, gesture: "g" });
    wm.dispatch({ type: "window/set-title", id: "a", title: "moved", gesture: "g" });
    wm.dispatch({ type: "window/move", id: "a", x: 3, y: 3, gesture: "g" });
    assert.deepEqual(wm.log.map((c) => c.type), ["window/create", "window/move", "window/set-title", "window/move"]);
    assert.deepEqual(replay(createState(), wm.log), wm.state);
    wm.undo();
    assert.equal(wm.state.windows.a.title, "");
    assert.equal(wm.state.windows.a.placement.x, 40);
    // After an undo, the same token starts a fresh entry.
    wm.dispatch({ type: "window/move", id: "a", x: 9, y: 9, gesture: "g" });
    assert.equal(wm.log.length, 2);
    assert.deepEqual(replay(createState(), wm.log), wm.state);
  });
});

// ---------------------------------------------------------------- phase 2

import { update as pureUpdate, derive, find, BASE_CSS, bspIds } from "../src/index.mjs";


const shift = { shiftKey: true };

describe("tiled ↔ floating", () => {
  test("window/detach floats a tiled window at a position (pure): one command, BSP leaf removed, raised", () => {
    let s = replay(createState({ layout: { type: "bsp" } }), ["a", "b", "c"].map((id) => ({ type: "window/create", id })));
    const out = pureUpdate(s, { type: "window/detach", id: "b", x: 30, y: 40 });
    assert.deepEqual(out.events, [{ type: "window/detached", id: "b", placement: { ...s.windows.b.placement, x: 30, y: 40 } }]);
    assert.equal(out.state.windows.b.mode, "floating");
    assert.deepEqual(bspIds(out.state.workspaces.main.layout.tree), ["a", "c"]);
    assert.equal(out.state.stack.normal.at(-1), "b");
    const reason = (o) => o.events[0]?.reason;
    assert.equal(reason(pureUpdate(s, { type: "window/detach", id: "zz", x: 0, y: 0 })), "unknown-window");
    assert.equal(reason(pureUpdate(out.state, { type: "window/detach", id: "b", x: 0, y: 0 })), "not-tiled");
    const pinned = pureUpdate(s, { type: "window/set-draggable", id: "a", draggable: false }).state;
    assert.equal(reason(pureUpdate(pinned, { type: "window/detach", id: "a", x: 0, y: 0 })), "not-draggable");
    const off = pureUpdate(s, { type: "config/set", drag: { toFloating: "off" } }).state;
    assert.equal(reason(pureUpdate(off, { type: "window/detach", id: "a", x: 0, y: 0 })), "drag-disabled");
    const blocked = pureUpdate(s, { type: "window/create", id: "m", role: "dialog", modal: true, parent: "a" }).state;
    assert.equal(reason(pureUpdate(blocked, { type: "window/detach", id: "a", x: 0, y: 0 })), "blocked");
  });

  test("a floating window dropped on a tiled one becomes tiled at that position (pure)", () => {
    const s = replay(createState({ layout: { type: "columns" } }), [
      ...["a", "b", "c"].map((id) => ({ type: "window/create", id })),
      { type: "window/create", id: "f", mode: "floating" },
    ]);
    const out = pureUpdate(s, { type: "window/drop", id: "f", target: "b", zone: "right" });
    assert.equal(out.state.windows.f.mode, "tiled");
    assert.deepEqual(derive(out.state).children[0].children.map((n) => n.id), ["a", "b", "f", "c"]);
    assert.equal(out.events[0].tiled, true);
    // center inserts in the target's place (a floating window has no slot to trade)
    assert.deepEqual(derive(pureUpdate(s, { type: "window/drop", id: "f", target: "b", zone: "center" }).state).children[0].children.map((n) => n.id), ["a", "f", "b", "c"]);
    const bsp = pureUpdate(s, { type: "layout/set", layout: { type: "bsp" } }).state;
    const split = pureUpdate(bsp, { type: "window/drop", id: "f", target: "a", zone: "top" }).state;
    assert.deepEqual(bspIds(split.workspaces.main.layout.tree).slice(0, 2), ["f", "a"]);
    const off = pureUpdate(s, { type: "config/set", drag: { toTiled: "off" } }).state;
    assert.equal(pureUpdate(off, { type: "window/drop", id: "f", target: "b", zone: "right" }).events[0].reason, "not-tiled");
  });

  test("dragging a tiled window with the modifier detaches it at the pointer: one window/detach, one undo step", () => {
    const t = setup();
    t.wm.resize("b", 100, 40); // its floating size (requested geometry), used when it detaches
    t.down(t.bars.b, 150, 10); // grab b's title bar 50px in, 10px down
    t.move(160, 10);
    t.root.dispatch("pointermove", { clientX: 250, clientY: 60, pointerId: 1, ...shift });
    const ghost = t.overlay().querySelector('[data-wm-ghost="dragged"]');
    assert.equal(ghost.getAttribute("data-view"), "b", "the floating ghost follows the pointer");
    assert.equal(t.overlay().querySelectorAll("[data-wm-ghost]").length, 4);
    t.root.dispatch("pointerup", { clientX: 250, clientY: 60, pointerId: 1, ...shift });
    assert.deepEqual(t.commands.filter((c) => c.type !== "window/focus"), [{ type: "window/detach", id: "b", x: 200, y: 50 }]);
    assert.equal(t.wm.state.windows.b.mode, "floating");
    t.wm.undo();
    assert.equal(t.wm.state.windows.b.mode, "tiled");
    // Near an edge the window is kept inside the stage.
    t.down(t.bars.b, 150, 10);
    t.root.dispatch("pointermove", { clientX: 395, clientY: 95, pointerId: 1, ...shift });
    t.root.dispatch("pointerup", { clientX: 395, clientY: 95, pointerId: 1, ...shift });
    assert.deepEqual([t.wm.state.windows.b.placement.x, t.wm.state.windows.b.placement.y], [300, 60]);
  });

  test("the modifier can be pressed and released mid-drag without moving", () => {
    const t = setup();
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    assert.equal(t.overlay().querySelector("[data-wm-drop-zone]").getAttribute("data-zone"), "center");
    t.doc.dispatch("keydown", { key: "Shift", type: "keydown" });
    assert.equal(t.overlay().querySelector("[data-wm-drop-zone]").style.getPropertyValue("display"), "none");
    t.doc.dispatch("keyup", { key: "Shift", type: "keyup" });
    t.up(150, 50);
    assert.equal(t.drops().length, 1);
  });

  test("toFloating: threshold detaches outside the layout; off never detaches", () => {
    const t = setup({ config: { drag: { toFloating: "threshold" } } });
    t.down(t.bars.a, 50, 10);
    t.move(150, 50);
    t.move(150, 160); // 60px below the 100px-tall root
    t.up(150, 160);
    assert.equal(t.commands.at(-1).type, "window/detach");
    const off = setup({ config: { drag: { toFloating: "off" } } });
    off.down(off.bars.a, 50, 10);
    off.root.dispatch("pointermove", { clientX: 150, clientY: 50, pointerId: 1, ...shift });
    off.root.dispatch("pointerup", { clientX: 150, clientY: 50, pointerId: 1, ...shift });
    assert.equal(off.commands.at(-1).type, "window/drop");
  });

  test("a floating window dragged onto a tiled one with the modifier tiles there: moves + drop are one undo step", () => {
    const t = setup({ windows: ["a", "b", "c", "f"] });
    t.wm.setMode("f", "floating");
    t.wm.move("f", 10, 10);
    t.chrome();
    t.renderer.elementFor("f").rect = { left: 10, top: 10, width: 80, height: 40 };
    const before = t.wm.getState();
    const logBefore = t.wm.log.length;
    t.down(t.bars.f, 20, 20);
    t.move(120, 50); // no modifier: just a floating move
    assert.equal(t.overlay(), null);
    t.root.dispatch("pointermove", { clientX: 190, clientY: 50, pointerId: 1, ...shift });
    assert.equal(t.overlay().querySelector("[data-wm-drop-zone]").getAttribute("data-target"), "b");
    t.root.dispatch("pointerup", { clientX: 190, clientY: 50, pointerId: 1, ...shift });
    assert.equal(t.wm.state.windows.f.mode, "tiled");
    assert.deepEqual(t.wm.log.slice(logBefore).map((c) => c.type), ["window/move", "window/drop"]);
    assert.deepEqual(replay(t.wm.origin, t.wm.log), t.wm.getState());
    t.wm.undo();
    assert.deepEqual(t.wm.getState(), before);
  });

  test("toTiled: always needs no modifier; off never tiles", () => {
    const run = (toTiled, extra = {}) => {
      const t = setup({ windows: ["a", "b", "f"], config: { drag: { toTiled } } });
      t.wm.setMode("f", "floating");
      t.chrome();
      t.renderer.elementFor("f").rect = { left: 250, top: 0, width: 50, height: 30 };
      t.down(t.bars.f, 260, 10);
      t.root.dispatch("pointermove", { clientX: 150, clientY: 50, pointerId: 1, ...extra });
      t.root.dispatch("pointerup", { clientX: 150, clientY: 50, pointerId: 1, ...extra });
      return t.wm.state.windows.f.mode;
    };
    assert.equal(run("always"), "tiled");
    assert.equal(run("modifier"), "floating");
    assert.equal(run("off", shift), "floating");
  });

  test("Escape during a floating drag puts the window back in the same undo step", () => {
    const t = setup({ windows: ["a", "f"] });
    t.wm.setMode("f", "floating");
    t.wm.move("f", 10, 10);
    t.chrome();
    const logBefore = t.wm.log.length;
    t.down(t.bars.f, 20, 20);
    t.move(80, 60);
    t.doc.dispatch("keydown", { key: "Escape", type: "keydown", preventDefault() {}, stopPropagation() {} });
    assert.deepEqual([t.wm.state.windows.f.placement.x, t.wm.state.windows.f.placement.y], [10, 10]);
    assert.equal(t.wm.log.length, logBefore + 1); // one (coalesced) entry, which restores the start
    t.up(80, 60);
  });
});

describe("across workspaces", () => {
  const withTabs = (options) => {
    const t = setup({ ...options });
    t.wm.createWorkspace("web");
    const tab = t.doc.createElement("button");
    tab.setAttribute("data-wm-workspace-target", "web");
    t.doc.body.append(tab);
    let over = null;
    t.doc.elementsFromPoint = (x, y) => (y > 150 ? [over] : []);
    over = tab;
    return { ...t, tab };
  };

  test("dropping a tiled window on a workspace target moves it there (one command); follow goes with it", () => {
    const t = withTabs();
    t.down(t.bars.b, 150, 10);
    t.move(150, 50);
    t.move(150, 200); // over the workspace tab (outside root)
    assert.ok(t.tab.hasAttribute("data-wm-drop-active"));
    t.up(150, 200);
    assert.ok(!t.tab.hasAttribute("data-wm-drop-active"));
    assert.deepEqual(t.commands.at(-1), { type: "window/move-to-workspace", id: "b", workspace: "web" });
    assert.equal(t.wm.state.windows.b.workspace, "web");
    assert.equal(t.wm.state.activeWorkspace, "main");

    const f = withTabs({ config: { drag: { follow: true } } });
    f.down(f.bars.b, 150, 10);
    f.move(150, 200);
    f.up(150, 200);
    assert.equal(f.commands.at(-1).follow, true);
    assert.equal(f.wm.state.activeWorkspace, "web");
    assert.equal(f.wm.state.focus.window, "b");
  });

  test("a press that leaves the stage before the threshold still becomes a drag (document listeners)", () => {
    const t = withTabs();
    t.down(t.bars.b, 150, 10);
    // One jump straight to the workspace tab: the event targets the tab, outside root.
    t.doc.dispatch("pointermove", { target: t.tab, clientX: 150, clientY: 200, pointerId: 1 });
    assert.ok(t.overlay(), "drag started");
    t.doc.dispatch("pointerup", { target: t.tab, clientX: 150, clientY: 200, pointerId: 1 });
    assert.equal(t.wm.state.windows.b.workspace, "web");
    assert.equal(t.doc.listeners.get("pointermove").size, 0, "document listeners removed");
    // Events inside root are left to the root listeners (no double handling).
    t.down(t.bars.a, 50, 10);
    t.doc.dispatch("pointermove", { target: t.bars.a, clientX: 150, clientY: 50, pointerId: 1 });
    assert.equal(t.overlay(), null);
    t.up(50, 10);
  });

  test("a floating window keeps its placement and moves in one undo step; crossWorkspace: false ignores targets", () => {
    const t = withTabs({ windows: ["a", "f"] });
    t.wm.setMode("f", "floating");
    t.wm.move("f", 10, 10);
    t.chrome();
    const before = t.wm.getState();
    t.down(t.bars.f, 20, 20);
    t.move(100, 120);
    t.move(100, 200);
    t.up(100, 200);
    assert.equal(t.wm.state.windows.f.workspace, "web");
    assert.deepEqual([t.wm.state.windows.f.placement.x, t.wm.state.windows.f.placement.y], [10, 10]);
    t.wm.undo();
    assert.deepEqual(t.wm.getState(), before);
    assert.deepEqual(replay(t.wm.origin, t.wm.log), t.wm.getState());

    const off = withTabs({ config: { drag: { crossWorkspace: false } } });
    off.down(off.bars.b, 150, 10);
    off.move(150, 200);
    off.up(150, 200);
    assert.equal(off.wm.state.windows.b.workspace, "main");
  });
});

describe("tab strip reordering", () => {
  const tabsSetup = () => {
    const t = setup({ layout: { type: "tabs" } });
    const tabs = Object.fromEntries(t.root.querySelectorAll("button[data-wm-tab]").map((el, i) => {
      el.rect = { left: i * 60, top: 0, width: 60, height: 20 };
      return [el.getAttribute("data-wm-tab"), el];
    }));
    return { ...t, tabs };
  };

  test("drag a tab past the threshold, drop on another tab's right half → window/drop after it", () => {
    const t = tabsSetup();
    t.down(t.tabs.a, 30, 10);
    assert.equal(t.wm.state.focus.window, "a");
    t.move(40, 10);
    t.move(170, 10); // right half of c (120..180)
    const line = t.overlay().querySelector("[data-wm-drop-line]");
    assert.equal(line.style.getPropertyValue("left"), "178.5px");
    assert.ok(t.tabs.a.hasAttribute("data-wm-drag-source"));
    t.up(170, 10);
    assert.deepEqual(t.drops(), [{ type: "window/drop", id: "a", target: "c", zone: "right" }]);
    assert.equal(t.order(), "bcad");
    assert.ok(!t.tabs.a.hasAttribute("data-wm-drag-source"));
  });

  test("past the end of the strip means last; over itself means nothing", () => {
    const t = tabsSetup();
    t.down(t.tabs.a, 30, 10);
    t.move(40, 10);
    assert.equal(t.overlay(), null, "over its own tab: no target yet");
    t.move(390, 12);
    t.up(390, 12);
    assert.deepEqual(t.drops(), [{ type: "window/drop", id: "a", target: "d", zone: "right" }]);
    assert.equal(t.order(), "bcda");
  });

  test("a click on a tab only focuses it", () => {
    const t = tabsSetup();
    t.down(t.tabs.c, 150, 10);
    t.up(150, 10);
    assert.equal(t.wm.state.focus.window, "c");
    assert.equal(t.drops().length, 0);
    assert.equal(t.overlay(), null);
  });
});

describe("children travel with their parent", () => {
  test("a non-modal dialog stays anchored to its parent through drop, detach and a workspace move", () => {
    const t = setup();
    t.wm.create({ id: "dlg", role: "dialog", parent: "b", focus: false });
    const anchoredToB = () => Boolean(find(t.wm.present().tree, (n) => n.type === "anchor" && n.options.to === "b" && n.child.child?.id === "dlg"));
    assert.ok(anchoredToB());
    t.wm.drop("b", "d", "right");
    assert.ok(anchoredToB());
    t.wm.dispatch({ type: "window/detach", id: "b", x: 5, y: 5 });
    assert.ok(anchoredToB());
    t.wm.createWorkspace("web");
    t.wm.dispatch({ type: "window/move-to-workspace", id: "b", workspace: "web", follow: true });
    assert.equal(t.wm.state.windows.dlg.workspace, "web");
    assert.ok(anchoredToB());
  });
});

describe("pinned windows", () => {
  test("pressing a pinned window's title bar shows not-allowed for the press, and nothing drags", () => {
    const messages = [];
    const t = setup({ input: { announce: (m) => messages.push(m) } });
    t.wm.setDraggable("b", false);
    t.chrome();
    t.down(t.bars.b, 150, 10);
    assert.ok(t.renderer.elementFor("b").hasAttribute("data-wm-drag-denied"));
    t.move(250, 50);
    assert.equal(t.overlay(), null);
    t.up(250, 50);
    assert.ok(!t.renderer.elementFor("b").hasAttribute("data-wm-drag-denied"));
    assert.equal(t.drops().length, 0);
    assert.ok(messages.some((m) => /pinned/.test(m)));
  });

  test("a pinned floating window does not move either", () => {
    const t = setup({ windows: ["f"] });
    t.wm.setMode("f", "floating");
    t.wm.setDraggable("f", false);
    t.chrome();
    const { x, y } = t.wm.state.windows.f.placement;
    t.down(t.bars.f, 20, 20);
    t.move(90, 90);
    t.up(90, 90);
    assert.deepEqual([t.wm.state.windows.f.placement.x, t.wm.state.windows.f.placement.y], [x, y]);
  });
});

describe("touch", () => {
  test("a long press starts the drag; moving first leaves the gesture to the browser", (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const s = setup();
    const touch = (type, x, y) => s.root.dispatch(type, { target: s.bars.a, clientX: x, clientY: y, pointerId: 5, pointerType: "touch", button: 0, preventDefault() {} });
    touch("pointerdown", 50, 10);
    touch("pointermove", 52, 11); // jitter below the threshold
    assert.equal(s.overlay(), null);
    let prevented = false;
    s.root.dispatch("contextmenu", { preventDefault: () => (prevented = true) });
    assert.ok(prevented, "no context menu during a long press");
    t.mock.timers.tick(400);
    assert.ok(s.overlay(), "drag started by the long press");
    touch("pointermove", 150, 50);
    touch("pointerup", 150, 50);
    assert.deepEqual(s.drops(), [{ type: "window/drop", id: "a", target: "b", zone: "center" }]);

    touch("pointerdown", 50, 10);
    touch("pointermove", 50, 60); // a swipe: not a drag
    t.mock.timers.tick(500);
    assert.equal(s.overlay(), null);
    touch("pointerup", 50, 60);
    assert.equal(s.drops().length, 1);
  });

  test("only handles opt out of touch panning; window content keeps scrolling", () => {
    assert.match(BASE_CSS, /\[data-wm-handle\] \{ touch-action: none; \}/);
    assert.doesNotMatch(BASE_CSS, /wm-view[^{]*\{[^}]*touch-action/);
  });
});

describe("accessibility", () => {
  test("announce: true creates an aria-live region and narrates start, target, drop and cancel", () => {
    const t = setup({ input: { announce: true, subscribe: undefined } });
    const region = t.root.querySelector("[data-wm-announcer]");
    assert.equal(region.getAttribute("aria-live"), "polite");
    t.down(t.bars.a, 50, 10);
    t.move(60, 10);
    assert.match(region.textContent, /Dragging A/);
    t.move(195, 50);
    assert.equal(region.textContent, "Release to move after B.");
    t.up(195, 50);
    assert.equal(region.textContent, "A moved after B.");
    t.down(t.bars.a, 150, 10);
    t.move(250, 50);
    t.root.dispatch("pointercancel", {});
    assert.equal(region.textContent, "Drag cancelled.");
    t.detach();
    assert.equal(t.root.querySelector("[data-wm-announcer]"), null);
  });

  test("keyboard: true moves the focused window with Alt+Shift+arrows, announced via subscribe", () => {
    const messages = [];
    const t = setup({ input: { keyboard: true, announce: (m) => messages.push(m), subscribe: undefined } });
    t.wm.focus("a");
    const key = (k) => t.root.dispatch("keydown", { key: k, altKey: true, shiftKey: true, preventDefault() {} });
    key("ArrowRight");
    assert.equal(t.order(), "bacd");
    key("PageDown");
    assert.equal(t.order(), "bcad");
    key("ArrowLeft");
    assert.equal(t.order(), "bacd");
    assert.deepEqual(messages, ["A moved after B.", "A swapped with C.", "A moved before C."]);
    t.root.dispatch("keydown", { key: "ArrowRight", preventDefault() {} }); // no modifiers: ignored
    assert.equal(t.order(), "bacd");
  });
});
