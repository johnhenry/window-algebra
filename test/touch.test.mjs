import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, createPinch, updatePinch, swipeOf, PINCH_MIN_SIZE, BASE_CSS } from "../src/index.mjs";
import { createDomRenderer, attachInput } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

describe("pinch and swipe math (pure)", () => {
  const bounds = { x: 100, y: 100, width: 200, height: 100 };
  const pinch = createPinch({ points: [{ x: 150, y: 150 }, { x: 250, y: 150 }], bounds });

  test("size scales with the finger distance", () => {
    const r = updatePinch(pinch, [{ x: 100, y: 150 }, { x: 300, y: 150 }]);
    assert.equal(r.width, 400);
    assert.equal(r.height, 200);
  });

  test("the point under the midpoint stays under it, and a drag of the pair moves the window", () => {
    const same = updatePinch(pinch, [{ x: 150, y: 150 }, { x: 250, y: 150 }]);
    assert.deepEqual(same, bounds);
    const moved = updatePinch(pinch, [{ x: 170, y: 160 }, { x: 270, y: 160 }]);
    assert.deepEqual(moved, { x: 120, y: 110, width: 200, height: 100 });
    // Scaling about the midpoint (200, 150): the window's centre-ish point keeps its relative place.
    const grown = updatePinch(pinch, [{ x: 100, y: 150 }, { x: 300, y: 150 }]);
    assert.equal(grown.x, 200 - ((200 - 100) / 200) * grown.width);
    assert.equal(grown.y, 150 - ((150 - 100) / 100) * grown.height);
  });

  test("honours constraints, the aspect ratio and a minimum size", () => {
    const capped = createPinch({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], bounds, constraints: { maxWidth: 250 } });
    assert.equal(updatePinch(capped, [{ x: 0, y: 0 }, { x: 900, y: 0 }]).width, 250);
    const tiny = updatePinch(pinch, [{ x: 200, y: 150 }, { x: 201, y: 150 }]);
    assert.equal(tiny.width, PINCH_MIN_SIZE);
    assert.equal(tiny.height, PINCH_MIN_SIZE);
    const ratio = createPinch({ points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], bounds, constraints: { aspectRatio: 2 } });
    const r = updatePinch(ratio, [{ x: 0, y: 0 }, { x: 200, y: 0 }]);
    assert.equal(r.width / r.height, 2);
  });

  test("swipeOf needs distance, a dominant axis and a short stroke", () => {
    assert.equal(swipeOf({ dx: -80, dy: 5, duration: 200 }), "left");
    assert.equal(swipeOf({ dx: 80, dy: -5, duration: 200 }), "right");
    assert.equal(swipeOf({ dx: 4, dy: -90, duration: 200 }), "up");
    assert.equal(swipeOf({ dx: 4, dy: 90, duration: 200 }), "down");
    assert.equal(swipeOf({ dx: 20, dy: 0, duration: 100 }), null, "too short");
    assert.equal(swipeOf({ dx: 80, dy: 70, duration: 100 }), null, "diagonal");
    assert.equal(swipeOf({ dx: 80, dy: 0, duration: 2000 }), null, "too slow");
    assert.equal(swipeOf({ dx: 30, dy: 0 }, { distance: 20 }), "right");
  });
});

/** A 600x400 stage with the given tiled/floating windows and `attachInput({ touch })`. */
const setup = ({ layout, touch = true, state, windows = [], input = {} } = {}) => {
  const doc = createFakeDocument();
  doc.defaultView.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  const root = doc.createElement("div");
  root.rect = { left: 0, top: 0, width: 600, height: 400 };
  doc.body.append(root);
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false });
  const wm = createWindowManager({ state: state ?? createState({ layout, workspaces: ["one", "two", "three"] }), renderer, history: true });
  for (const w of windows) wm.create(typeof w === "string" ? { id: w } : w);
  const commands = [];
  const dispatch = (command) => {
    commands.push(command);
    return wm.dispatch(command);
  };
  const detach = attachInput({ root, getState: wm.getState, dispatch, present: wm.present, simulate: wm.simulate, subscribe: wm.subscribe, touch, afterRender: () => {}, ...input });
  const chrome = (id) => {
    const el = renderer.elementFor(id);
    let bar = el.querySelector("[data-wm-handle]");
    if (!bar) {
      bar = doc.createElement("header");
      bar.setAttribute("data-wm-handle", "move");
      el.append(bar);
    }
    return bar;
  };
  const ptr = (type, pointerId, target, x, y, pointerType = "touch") => root.dispatch(type, { target, clientX: x, clientY: y, pointerId, pointerType, button: 0, preventDefault() {} });
  return { doc, root, renderer, wm, commands, detach, chrome, ptr };
};

describe("attachInput({ touch }) wiring", () => {
  test("off by default: no data-wm-touch, nothing recognised", () => {
    const t = setup({ touch: false, windows: [{ id: "f", mode: "floating", placement: { x: 100, y: 100, width: 200, height: 100 } }] });
    assert.equal(t.root.hasAttribute("data-wm-touch"), false);
    const el = t.renderer.elementFor("f");
    t.ptr("pointerdown", 1, el, 150, 130);
    t.ptr("pointerdown", 2, el, 250, 130);
    t.ptr("pointermove", 2, el, 350, 130);
    assert.equal(t.commands.filter((c) => c.type === "window/resize").length, 0);
  });

  test("touch: true sets the tokens BASE_CSS keys its touch-action rules on; detach removes them", () => {
    const t = setup();
    assert.equal(t.root.getAttribute("data-wm-touch"), "pinch swipe-tabs context");
    for (const token of ["pinch", "swipe-tabs", "swipe-workspaces", "context"]) assert.ok(BASE_CSS.includes(`[data-wm-touch~="${token}"]`), token);
    t.detach();
    assert.equal(t.root.hasAttribute("data-wm-touch"), false);
    const u = setup({ touch: { pinch: false, swipe: { workspaces: true, tabs: true }, contextMenu: false } });
    assert.equal(u.root.getAttribute("data-wm-touch"), "swipe-tabs swipe-workspaces");
  });
});

describe("pinch to resize a floating window", () => {
  const floating = { id: "f", mode: "floating", placement: { x: 100, y: 100, width: 200, height: 100 } };

  test("two touches on a floating window resize it; one gesture, one undo step, one log entry", () => {
    const t = setup({ windows: [floating] });
    const el = t.renderer.elementFor("f");
    t.ptr("pointerdown", 1, el, 150, 150);
    t.ptr("pointerdown", 2, el, 250, 150);
    t.ptr("pointermove", 2, el, 300, 150);
    t.ptr("pointermove", 1, el, 100, 150);
    t.ptr("pointerup", 2, el, 300, 150);
    t.ptr("pointerup", 1, el, 100, 150);
    const p = t.wm.getState().windows.f.placement;
    assert.equal(p.width, 400);
    assert.equal(p.height, 200);
    const resizes = t.commands.filter((c) => c.type === "window/resize");
    assert.ok(resizes.length >= 2);
    assert.equal(new Set(resizes.map((c) => c.gesture)).size, 1, "one gesture token");
    t.wm.undo();
    assert.equal(t.wm.getState().windows.f.placement.width, 200, "one undo step");
    assert.equal(t.wm.log.filter((c) => c.type === "window/resize").length, 0);
  });

  test("a first finger on the title bar does not start (or leave behind) a move", () => {
    const t = setup({ windows: [floating] });
    const bar = t.chrome("f");
    t.ptr("pointerdown", 1, bar, 150, 110);
    t.ptr("pointerdown", 2, bar, 250, 110);
    t.ptr("pointermove", 2, bar, 350, 110);
    t.ptr("pointerup", 2, bar, 350, 110);
    t.ptr("pointerup", 1, bar, 150, 110);
    assert.equal(t.commands.filter((c) => c.type === "window/move").length, 0);
    assert.ok(t.wm.getState().windows.f.placement.width > 200);
  });

  test("pointercancel puts the window back within the same gesture", () => {
    const t = setup({ windows: [floating] });
    const el = t.renderer.elementFor("f");
    t.ptr("pointerdown", 1, el, 150, 150);
    t.ptr("pointerdown", 2, el, 250, 150);
    t.ptr("pointermove", 2, el, 350, 150);
    assert.ok(t.wm.getState().windows.f.placement.width > 200);
    t.ptr("pointercancel", 2, el, 350, 150);
    assert.deepEqual(t.wm.getState().windows.f.placement, { x: 100, y: 100, width: 200, height: 100 });
  });

  test("respects the window's constraints", () => {
    const t = setup({ windows: [{ ...floating, constraints: { maxWidth: 260 } }] });
    const el = t.renderer.elementFor("f");
    t.ptr("pointerdown", 1, el, 150, 150);
    t.ptr("pointerdown", 2, el, 250, 150);
    t.ptr("pointermove", 2, el, 500, 150);
    assert.equal(t.wm.getState().windows.f.placement.width, 260);
  });

  test("pointerType is respected: two mouse pointers (or a pen and a mouse) never pinch", () => {
    const t = setup({ windows: [floating] });
    const el = t.renderer.elementFor("f");
    t.ptr("pointerdown", 1, el, 150, 150, "mouse");
    t.ptr("pointerdown", 2, el, 250, 150, "mouse");
    t.ptr("pointermove", 2, el, 350, 150, "mouse");
    t.ptr("pointerup", 2, el, 350, 150, "mouse");
    t.ptr("pointerup", 1, el, 150, 150, "mouse");
    t.ptr("pointerdown", 3, el, 150, 150, "pen");
    t.ptr("pointerdown", 4, el, 250, 150, "pen");
    t.ptr("pointermove", 4, el, 350, 150, "pen");
    assert.equal(t.wm.getState().windows.f.placement.width, 200);
  });

  test("a tiled window, a pinned one, two different windows and pinch: false are not pinched", () => {
    const t = setup({ windows: ["a", "b", { ...floating, id: "g", draggable: false }, floating] });
    const [a, b, g, f] = ["a", "b", "g", "f"].map((id) => t.renderer.elementFor(id));
    const before = JSON.stringify(t.wm.getState().windows);
    for (const [x, y] of [[a, a], [g, g], [f, a], [a, b]]) {
      t.ptr("pointerdown", 1, x, 150, 150);
      t.ptr("pointerdown", 2, y, 250, 150);
      t.ptr("pointermove", 2, y, 400, 150);
      t.ptr("pointerup", 2, y, 400, 150);
      t.ptr("pointerup", 1, x, 150, 150);
    }
    assert.equal(JSON.stringify(t.wm.getState().windows), before);
    const off = setup({ windows: [floating], touch: { pinch: false } });
    const el = off.renderer.elementFor("f");
    off.ptr("pointerdown", 1, el, 150, 150);
    off.ptr("pointerdown", 2, el, 250, 150);
    off.ptr("pointermove", 2, el, 400, 150);
    assert.equal(off.wm.getState().windows.f.placement.width, 200);
  });

  test("a floating window with a non-numeric placement pinches from its measured rect", () => {
    const t = setup({ windows: [{ ...floating, placement: { x: "center", y: "center", width: 200, height: 100 } }] });
    const el = t.renderer.elementFor("f");
    el.rect = { left: 200, top: 150, width: 200, height: 100 };
    t.ptr("pointerdown", 1, el, 250, 200);
    t.ptr("pointerdown", 2, el, 350, 200);
    t.ptr("pointermove", 2, el, 450, 200);
    const p = t.wm.getState().windows.f.placement;
    assert.equal(p.width, 400);
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
  });
});

describe("swipe between tabs", () => {
  const tabsSetup = (touch = true) => {
    const t = setup({ layout: { type: "tabs" }, windows: ["a", "b", "c"], touch });
    t.wm.focus("a");
    const strip = t.root.querySelector("wm-tabs");
    const tab = (id) => strip.querySelector(`[data-wm-tab="${id}"]`);
    const swipe = (id, from, to, type = "touch", y = 10) => {
      t.ptr("pointerdown", 7, tab(id), from, y, type);
      t.ptr("pointermove", 7, tab(id), (from + to) / 2, y, type);
      t.ptr("pointermove", 7, tab(id), to, y, type);
      t.ptr("pointerup", 7, tab(id), to, y, type);
    };
    return { ...t, strip, tab, swipe, focused: () => t.wm.getState().focus.window };
  };

  test("swiping left on the strip shows the next tab, right the previous one; the ends do not wrap", () => {
    const t = tabsSetup();
    assert.equal(t.focused(), "a");
    t.swipe("a", 300, 200);
    assert.equal(t.focused(), "b");
    t.swipe("b", 300, 200);
    assert.equal(t.focused(), "c");
    t.swipe("c", 300, 200);
    assert.equal(t.focused(), "c", "no wrap past the last tab");
    t.swipe("c", 200, 300);
    assert.equal(t.focused(), "b");
  });

  test("a pen swipes too; a mouse does not; short, slow, vertical and diagonal strokes do not", () => {
    const t = tabsSetup();
    t.swipe("a", 300, 200, "pen");
    assert.equal(t.focused(), "b");
    t.swipe("b", 300, 200, "mouse");
    assert.equal(t.focused(), "b");
    t.swipe("b", 300, 280);
    assert.equal(t.focused(), "b", "too short");
    t.ptr("pointerdown", 7, t.tab("b"), 300, 10);
    t.ptr("pointermove", 7, t.tab("b"), 300, 80);
    t.ptr("pointerup", 7, t.tab("b"), 300, 80);
    assert.equal(t.focused(), "b", "vertical");
  });

  test("a swipe that is cancelled (pointercancel) switches nothing", () => {
    const t = tabsSetup();
    t.ptr("pointerdown", 7, t.tab("a"), 300, 10);
    t.ptr("pointermove", 7, t.tab("a"), 200, 10);
    t.ptr("pointercancel", 7, t.tab("a"), 200, 10);
    assert.equal(t.focused(), "a");
  });

  test("off unless swipe.tabs is on", () => {
    const t = tabsSetup({ swipe: false });
    t.swipe("a", 300, 200);
    assert.equal(t.focused(), "a");
  });
});

describe("two-finger swipe between workspaces", () => {
  const wsSetup = (touch = { swipe: { workspaces: true } }) => {
    const t = setup({ windows: ["a"], touch });
    const el = t.root; // the stage itself: a window's element would be gone after the first switch
    const two = (dx, dy = 0, type = "touch") => {
      t.ptr("pointerdown", 1, el, 200, 200, type);
      t.ptr("pointerdown", 2, el, 260, 200, type);
      t.ptr("pointermove", 1, el, 200 + dx / 2, 200 + dy / 2, type);
      t.ptr("pointermove", 2, el, 260 + dx / 2, 200 + dy / 2, type);
      t.ptr("pointermove", 1, el, 200 + dx, 200 + dy, type);
      t.ptr("pointermove", 2, el, 260 + dx, 200 + dy, type);
      t.ptr("pointerup", 2, el, 260 + dx, 200 + dy, type);
      t.ptr("pointerup", 1, el, 200 + dx, 200 + dy, type);
    };
    return { ...t, two, active: () => t.wm.getState().activeWorkspace };
  };

  test("swipe left goes to the next workspace, right to the previous; the ends do not wrap", () => {
    const t = wsSetup();
    assert.equal(t.active(), "one");
    t.two(-120);
    assert.equal(t.active(), "two");
    t.two(-120);
    assert.equal(t.active(), "three");
    t.two(-120);
    assert.equal(t.active(), "three");
    t.two(120);
    assert.equal(t.active(), "two");
  });

  test("short or vertical strokes, and a pen or mouse pair, do nothing; off by default", () => {
    const t = wsSetup();
    t.two(-30);
    t.two(0, 120);
    t.two(-120, 0, "mouse");
    assert.equal(t.active(), "one");
    const off = wsSetup(true);
    off.two(-120);
    assert.equal(off.active(), "one");
  });
});

describe("long press for a context action", () => {
  const withTimers = (fn) => (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    return fn(t);
  };
  const body = (t, id) => {
    const el = t.renderer.elementFor(id);
    const content = t.doc.createElement("div");
    el.append(content);
    return content;
  };

  test("holding still on a window calls contextMenu with where and what", withTimers((tc) => {
    const calls = [];
    const t = setup({ windows: ["a", "b"], touch: { contextMenu: (info) => calls.push(info) } });
    const target = body(t, "b");
    t.ptr("pointerdown", 1, target, 150, 40);
    tc.mock.timers.tick(499);
    assert.equal(calls.length, 0);
    tc.mock.timers.tick(1);
    assert.equal(calls.length, 1);
    assert.deepEqual([calls[0].id, calls[0].x, calls[0].y, calls[0].pointerType, calls[0].target], ["b", 150, 40, "touch", target]);
    t.ptr("pointerup", 1, target, 150, 40);
    // the native menu that would follow is suppressed
    let prevented = false;
    t.root.dispatch("contextmenu", { preventDefault: () => (prevented = true) });
    assert.ok(prevented);
  }));

  test("moving, lifting early, a second finger, or a mouse cancels it", withTimers((tc) => {
    const calls = [];
    const t = setup({ windows: ["a"], touch: { contextMenu: (info) => calls.push(info) } });
    const target = body(t, "a");
    t.ptr("pointerdown", 1, target, 100, 40);
    t.ptr("pointermove", 1, target, 130, 40);
    tc.mock.timers.tick(600);
    t.ptr("pointerup", 1, target, 130, 40);
    t.ptr("pointerdown", 1, target, 100, 40);
    tc.mock.timers.tick(300);
    t.ptr("pointerup", 1, target, 100, 40);
    tc.mock.timers.tick(600);
    t.ptr("pointerdown", 1, target, 100, 40, "mouse");
    tc.mock.timers.tick(600);
    t.ptr("pointerup", 1, target, 100, 40, "mouse");
    t.ptr("pointerdown", 1, target, 100, 40);
    t.ptr("pointerdown", 2, target, 150, 40);
    tc.mock.timers.tick(600);
    assert.equal(calls.length, 0);
  }));

  test("a pen long-presses too; a press on a control or a tab keeps its own behaviour", withTimers((tc) => {
    const calls = [];
    const t = setup({ windows: ["a"], touch: { contextMenu: (info) => calls.push(info.pointerType) } });
    const target = body(t, "a");
    const button = t.doc.createElement("button");
    t.renderer.elementFor("a").append(button);
    t.ptr("pointerdown", 1, button, 100, 40);
    tc.mock.timers.tick(600);
    t.ptr("pointerup", 1, button, 100, 40);
    assert.deepEqual(calls, []);
    t.ptr("pointerdown", 1, target, 100, 40, "pen");
    tc.mock.timers.tick(600);
    assert.deepEqual(calls, ["pen"]);
  }));

  test("a string names a command dispatched for the window", withTimers((tc) => {
    const t = setup({ windows: ["a"], touch: { contextMenu: "window/toggle-floating" } });
    t.ptr("pointerdown", 1, body(t, "a"), 100, 40);
    tc.mock.timers.tick(500);
    assert.equal(t.wm.getState().windows.a.mode, "floating");
  }));

  test("the default dispatches a bubbling wm-contextmenu event on the window", withTimers((tc) => {
    const t = setup({ windows: ["a"] });
    const events = [];
    t.renderer.elementFor("a").dispatchEvent = (event) => events.push(event);
    t.ptr("pointerdown", 1, body(t, "a"), 100, 40);
    tc.mock.timers.tick(500);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "wm-contextmenu");
    assert.equal(events[0].bubbles, true);
    assert.equal(events[0].detail.id, "a");
  }));

  test("a held press on a floating title bar cancels the (unmoved) move and fires; a held press on a tiled title bar still starts a drag", withTimers((tc) => {
    const calls = [];
    const t = setup({ windows: ["a", "b", { id: "f", mode: "floating", placement: { x: 300, y: 200, width: 200, height: 100 } }], touch: { contextMenu: (info) => calls.push(info.id) }, input: { longPress: 400 } });
    t.ptr("pointerdown", 1, t.chrome("f"), 320, 210);
    tc.mock.timers.tick(500);
    assert.deepEqual(calls, ["f"]);
    t.ptr("pointerup", 1, t.chrome("f"), 320, 210);
    assert.equal(t.commands.filter((c) => c.type === "window/move").length, 0);
    t.ptr("pointerdown", 2, t.chrome("a"), 20, 20);
    tc.mock.timers.tick(400);
    assert.ok(t.root.querySelector("[data-wm-drag-overlay]"), "the long press started a drag, as before");
    tc.mock.timers.tick(200);
    assert.deepEqual(calls, ["f"], "and did not also fire the context action");
    t.ptr("pointerup", 2, t.chrome("a"), 20, 20);
  }));

  test("contextMenu: false turns it off", withTimers((tc) => {
    const t = setup({ windows: ["a"], touch: { contextMenu: false } });
    const events = [];
    t.renderer.elementFor("a").dispatchEvent = (event) => events.push(event);
    t.ptr("pointerdown", 1, body(t, "a"), 100, 40);
    tc.mock.timers.tick(900);
    assert.equal(events.length, 0);
  }));
});
