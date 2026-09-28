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
