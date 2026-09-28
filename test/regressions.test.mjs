import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createWindowManager,
  createState,
  row,
  column,
  overlay,
  size,
  anchor,
  view,
  compile,
  derive,
  update,
  replay,
  find,
  paintOrder,
  views,
} from "../src/index.mjs";
import { createDomRenderer, createSurfaceRegistry, attachInput } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

const setup = (options = {}) => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  doc.body.append(root);
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, ...options });
  return { doc, root, renderer };
};

describe("renderer: state-preserving moves (regression)", () => {
  test("a view moving into a brand-new container never leaves the document", () => {
    const { root, renderer } = setup();
    renderer.commit(compile(overlay({}, row({}, view("a"), view("b")))));
    const a = renderer.elementFor("a");
    assert.equal(a.disconnects, 0);
    // row → column creates a new container element; the view must move, not re-insert.
    renderer.commit(compile(overlay({}, column({}, view("b"), view("a")))));
    renderer.commit(compile(overlay({}, row({}, column({}, view("a")), view("b")))));
    assert.equal(renderer.elementFor("a"), a);
    assert.equal(a.disconnects, 0, "view element was detached (an iframe inside would reload)");
    assert.equal(root.querySelectorAll("wm-view").length, 2);
    assert.equal(root.querySelectorAll("wm-column").length, 1);
  });

  test("a view moving to a container processed later is not detached by an early sweep", () => {
    const { renderer } = setup();
    renderer.commit(compile(row({}, column({}, view("a"), view("b")), column({}, view("c")))));
    const a = renderer.elementFor("a");
    renderer.commit(compile(row({}, column({}, view("b")), column({}, view("c"), view("a")))));
    assert.equal(a.disconnects, 0);
    assert.equal(a.parentNode.children.map((el) => el.getAttribute("data-view")).join(), "c,a");
  });

  test("falls back to insertBefore when moveBefore is unavailable", () => {
    const { root, renderer } = setup();
    root.moveBefore = undefined;
    renderer.commit(compile(row({}, view("a"), view("b"))));
    renderer.commit(compile(row({}, view("b"), view("a"))));
    assert.deepEqual(root.children[0].children.map((el) => el.getAttribute("data-view")), ["b", "a"]);
  });
});

describe("renderer: explicit JS anchor fallback (regression)", () => {
  const tree = overlay(
    {},
    row({}, view("host")),
    anchor({ to: "host", side: "bottom", align: "start" }, size({ width: 50, height: 20 }, view("menu"))),
    anchor({ to: "host", side: "top", align: "center", inside: true }, size({ width: 40, height: 10 }, view("sheet"))),
  );

  test("strips CSS anchor declarations and positions from the recorded spec", () => {
    const { renderer } = setup({ anchorFallback: true });
    assert.equal(renderer.anchorFallback, true);
    renderer.commit(compile(tree));
    const menu = renderer.elementFor("menu");
    const host = renderer.elementFor("host");
    for (const prop of ["position-anchor", "position-area", "justify-self", "align-self"]) {
      assert.equal(menu.style.getPropertyValue(prop), "", `${prop} should not be applied under the fallback`);
    }
    assert.equal(host.style.getPropertyValue("anchor-name"), "");
    // Fake rects are 100×100 at the origin: "bottom span-right" → below the host, left-aligned.
    assert.equal(menu.style.getPropertyValue("left"), "0px");
    assert.equal(menu.style.getPropertyValue("top"), "100px");
    // Inside + y: start → top edge of the host (not centred).
    const sheet = renderer.elementFor("sheet");
    assert.equal(sheet.style.getPropertyValue("top"), "0px");
  });

  test("offsets on the top and left sides are honoured", () => {
    const { renderer } = setup({ anchorFallback: true });
    renderer.commit(
      compile(
        overlay(
          {},
          row({}, view("host")),
          anchor({ to: "host", side: "left", align: "center", offset: 6 }, size({ width: 50, height: 20 }, view("l"))),
          anchor({ to: "host", side: "top", align: "center", offset: 4 }, size({ width: 50, height: 20 }, view("t"))),
        ),
      ),
    );
    // Fake rects are 100×100: left side → 0 - 100 - 6; top side → 0 - 100 - 4.
    assert.equal(renderer.elementFor("l").style.getPropertyValue("left"), "-106px");
    assert.equal(renderer.elementFor("t").style.getPropertyValue("top"), "-104px");
  });

  test("coordinates are cleared when an element stops being anchored", () => {
    const { renderer } = setup({ anchorFallback: true });
    renderer.commit(compile(tree));
    renderer.commit(compile(overlay({}, row({}, view("host")), size({ width: 50 }, view("menu")))));
    const menu = renderer.elementFor("menu");
    assert.equal(menu.style.getPropertyValue("left"), "");
    assert.equal(menu.style.getPropertyValue("top"), "");
  });

  test("native mode keeps CSS anchor positioning", () => {
    const { renderer } = setup();
    renderer.commit(compile(tree));
    assert.equal(renderer.elementFor("menu").style.getPropertyValue("position-anchor"), "--wm-host");
    assert.equal(renderer.elementFor("menu").style.getPropertyValue("left"), "");
  });
});

describe("derive: constraints apply to tiled windows (regression)", () => {
  test("min/max constraints become size() on the tiled view", () => {
    let state = createState();
    state = update(state, { type: "window/create", id: "a" }).state;
    state = update(state, { type: "window/create", id: "b", constraints: { minWidth: 300, maxHeight: 500 } }).state;
    const tree = derive(state);
    const wrapper = find(tree, (node) => node.type === "size" && node.child.type === "view" && node.child.id === "b");
    assert.deepEqual(wrapper.options, { minWidth: 300, maxHeight: 500 });
    const rendered = JSON.stringify(compile(tree));
    assert.match(rendered, /"min-width":"300px"/);
    assert.ok(!find(tree, (node) => node.type === "size" && node.options.minWidth !== undefined && node.child.id === "a"));
  });
});

describe("manager: log stays replayable across undo/redo/load (regression)", () => {
  test("replay(origin, log) equals the present state", () => {
    const wm = createWindowManager({ history: true });
    const check = () => assert.deepEqual(replay(wm.origin, wm.log), wm.getState());
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    wm.setLayout({ type: "bsp" });
    check();
    wm.undo();
    assert.equal(wm.log.length, 2);
    check();
    wm.redo();
    assert.equal(wm.log.length, 3);
    check();
    wm.undo();
    wm.create({ id: "c" }); // new branch discards the undone command
    wm.redo();
    assert.deepEqual(wm.log.map((c) => c.id ?? c.type), ["a", "b", "c"]);
    check();
    const saved = wm.serialize();
    wm.close("a");
    wm.load(saved);
    assert.deepEqual(wm.log, []);
    assert.deepEqual(wm.origin, JSON.parse(saved));
    wm.close("b");
    check();
    wm.undo(); // back to the loaded state
    assert.deepEqual(wm.log, []);
    wm.undo(); // before the load: the previous log is back
    assert.deepEqual(wm.log.map((c) => c.type), ["window/create", "window/create", "window/create", "window/close"]);
    check();
  });
});

describe("compile: content-sized views are not size containers (regression)", () => {
  test("height: content keeps inline-size containment; width: content drops containment", () => {
    const tall = compile(overlay({}, size({ width: 300, height: "content" }, view("sheet")))).children[0];
    assert.equal(tall.style.height, "max-content");
    assert.equal(tall.style["container-type"], "inline-size");
    const wide = compile(overlay({}, size({ width: "fit-content", height: 40 }, view("chip")))).children[0];
    assert.equal(wide.style["container-type"], "normal");
    const fixed = compile(overlay({}, size({ width: 300, height: 200 }, view("box")))).children[0];
    assert.equal(fixed.style["container-type"], "size");
  });

  test("a sheet window derives to a view that can grow with its content", () => {
    let state = createState();
    state = update(state, { type: "window/create", id: "doc" }).state;
    state = update(state, { type: "window/create", id: "sheet", role: "sheet", parent: "doc", modal: true }).state;
    const rendered = compile(derive(state));
    const sheet = rendered.children.find((child) => child.view === "sheet");
    assert.equal(sheet.style["container-type"], "inline-size");
  });
});

describe("derive: popover anchor options pass through (regression)", () => {
  test("inside / x / y reach the anchor node", () => {
    let state = createState();
    state = update(state, { type: "window/create", id: "doc" }).state;
    state = update(state, {
      type: "window/create",
      id: "menu",
      role: "menu",
      parent: "doc",
      anchor: { to: "doc", side: "top", align: "start", inside: true },
    }).state;
    const node = find(derive(state), (n) => n.type === "anchor");
    assert.deepEqual(node.options, { inside: true, to: "doc", side: "top", align: "start", offset: 4 });
    const style = compile(derive(state)).children.find((child) => child.view === "menu").style;
    assert.equal(style["position-area"], "center");
    assert.equal(style["justify-self"], "start");
    assert.equal(style["align-self"], "start");
  });
});

describe("manager: unknown layout types are rejected (regression)", () => {
  test("layout/set and workspace/create refuse specs no interpreter can derive", () => {
    const commits = [];
    const wm = createWindowManager({ renderer: { commit: (tree) => commits.push(tree) }, layouts: { mine: () => row({}) } });
    wm.create({ id: "a" });
    const out = wm.setLayout({ type: "nope" });
    assert.deepEqual(out.events, [{ type: "command/rejected", command: "layout/set", id: undefined, reason: "unknown-layout" }]);
    assert.equal(wm.state.workspaces.main.layout.type, "master-stack");
    assert.doesNotThrow(() => wm.present());
    assert.equal(wm.createWorkspace("x", { layout: { type: "nope" } }).events[0].reason, "unknown-layout");
    // Built-in and custom interpreters are accepted.
    assert.equal(wm.setLayout({ type: "mine" }).events[0].type, "layout/changed");
    assert.equal(wm.setLayout({ type: "bsp" }).events[0].type, "layout/changed");
    assert.equal(wm.createWorkspace("y").events[0].type, "workspace/created");
  });
});

describe("input: title-bar buttons and modal blocking (regression)", () => {
  const withInput = () => {
    const { doc, root, renderer } = setup();
    const wm = createWindowManager({ renderer });
    const detach = attachInput({ root, getState: wm.getState, dispatch: wm.dispatch });
    return { doc, root, renderer, wm, detach };
  };

  test("a button inside a floating window's move handle neither starts a drag nor captures the pointer", () => {
    const { doc, root, renderer, wm } = withInput();
    wm.create({ id: "a" });
    wm.create({ id: "f", mode: "floating", placement: { x: 10, y: 10, width: 200, height: 100 } });
    wm.focus("a");
    const bar = doc.createElement("header");
    bar.setAttribute("data-wm-handle", "move");
    let captured = false;
    bar.setPointerCapture = () => { captured = true; };
    const min = doc.createElement("button");
    min.setAttribute("data-wm-command", "window/minimize");
    bar.append(min);
    renderer.elementFor("f").append(bar);

    // Before the fix, pointerdown started a move gesture and captured the pointer on
    // the title bar, so pointerup/click were retargeted and the button never fired.
    root.dispatch("pointerdown", { target: min, clientX: 50, clientY: 20, pointerId: 1, preventDefault() {} });
    assert.equal(captured, false);
    assert.equal(wm.state.focus.window, "f", "pressing a control still focuses its window");
    root.dispatch("pointermove", { clientX: 150, clientY: 120 });
    assert.equal(wm.state.windows.f.placement.x, 10, "no drag started");
    root.dispatch("click", { target: min });
    assert.equal(wm.state.windows.f.status, "minimized", "one click minimizes an unfocused window");
  });

  test("a blocked window stays hit-testable: its contents are inert, the view is not", () => {
    const { doc, renderer, wm } = withInput();
    wm.create({ id: "p", mode: "floating", placement: { x: 0, y: 0, width: 200, height: 200 } });
    renderer.elementFor("p").append(doc.createElement("div"));
    wm.create({ id: "d", role: "dialog", parent: "p", modal: true });
    const view = renderer.elementFor("p");
    assert.equal(view.getAttribute("inert"), null, "an inert view would let clicks fall through to the window below");
    assert.equal(view.getAttribute("data-wm-blocked"), "");
    assert.ok([...view.children].every((child) => child.getAttribute("inert") === ""));
    wm.close("d");
    assert.equal(view.getAttribute("data-wm-blocked"), null);
    assert.ok([...view.children].every((child) => child.getAttribute("inert") === null));
  });

  test("clicking a blocked window redirects focus to its modal and starts no gesture", () => {
    const { doc, root, renderer, wm } = withInput();
    wm.create({ id: "p", mode: "floating", placement: { x: 0, y: 0, width: 200, height: 200 } });
    wm.create({ id: "other", mode: "floating", placement: { x: 50, y: 50, width: 200, height: 200 } });
    wm.create({ id: "d", role: "dialog", parent: "p", modal: true });
    const bar = doc.createElement("header");
    bar.setAttribute("data-wm-handle", "move");
    renderer.elementFor("p").append(bar);
    const stackBefore = [...wm.state.stack.normal];

    root.dispatch("pointerdown", { target: bar, clientX: 60, clientY: 60, pointerId: 1, preventDefault() {} });
    assert.equal(wm.state.focus.window, "d");
    assert.deepEqual(wm.state.stack.normal, stackBefore, "neither the blocked window nor the one beneath is raised");
    root.dispatch("pointermove", { clientX: 160, clientY: 160 });
    assert.equal(wm.state.windows.p.placement.x, 0, "blocked windows cannot be dragged");
  });
});

describe("paint order: background beneath the tiled base (regression)", () => {
  const scene = () => {
    let state = createState();
    for (const cmd of [
      { type: "window/create", id: "t1" },
      { type: "window/create", id: "t2" },
      { type: "window/create", id: "float", mode: "floating", placement: { x: 0, y: 0, width: 100, height: 100 } },
      { type: "window/create", id: "wall", mode: "floating", placement: { x: 0, y: 0, width: 100, height: 100 } },
      { type: "window/set-layer", id: "wall", layer: "background" },
      { type: "window/focus", id: "t1" },
    ]) state = update(state, cmd).state;
    return state;
  };
  // Views in document order of the derived overlay = paint order, bottom to top.
  const painted = (state) => views(derive(state));

  test("background-layer windows are painted below tiled windows, not above them", () => {
    const state = scene();
    const order = painted(state);
    assert.ok(order.indexOf("wall") < order.indexOf("t1"), `background above the tiled base: ${order}`);
    assert.ok(order.indexOf("t1") < order.indexOf("float"));
  });

  test("paintOrder() reports what derive() paints; raising a tiled window can't lift it over a floating one", () => {
    const state = scene();
    assert.deepEqual(paintOrder(state), painted(state));
    assert.deepEqual(paintOrder(state), ["wall", "t1", "t2", "float"]);
    // t1 was focused (and so raised) last, yet it stays in the base beneath "float".
    assert.equal(state.stack.normal.at(-1), "t1");
    // As in the UI: pressing the maximize button focuses (and raises) the window first.
    const focused = update(state, { type: "window/focus", id: "t2" }).state;
    const maxed = update(focused, { type: "window/maximize", id: "t2" }).state;
    assert.deepEqual(paintOrder(maxed), painted(maxed));
    assert.equal(paintOrder(maxed).at(-1), "t2", "a maximized window leaves the base and stacks by rank");
  });
});

describe("input: keyboard focus and WM focus stay in sync (regression)", () => {
  const withSync = () => {
    const { doc, root, renderer } = setup();
    const wm = createWindowManager({ renderer });
    const tasks = [];
    attachInput({ root, getState: wm.getState, dispatch: wm.dispatch, subscribe: wm.subscribe, afterRender: (task) => tasks.push(task) });
    const flush = () => tasks.splice(0).forEach((task) => task());
    return { doc, root, renderer, wm, flush };
  };

  test("keyboard focus entering a window focuses (and raises) it in the WM", () => {
    const { doc, renderer, wm } = withSync();
    wm.create({ id: "a", mode: "floating", placement: { x: 0, y: 0, width: 100, height: 100 } });
    wm.create({ id: "b", mode: "floating", placement: { x: 0, y: 0, width: 100, height: 100 } });
    const field = doc.createElement("textarea");
    renderer.elementFor("a").append(field);
    assert.equal(wm.state.focus.window, "b");
    field.focus(); // e.g. Tab moved focus into a window that is behind
    assert.equal(wm.state.focus.window, "a");
    assert.equal(wm.state.stack.normal.at(-1), "a");
  });

  test("focusing a window by command moves keyboard focus into it, back to the last focused element", () => {
    const { doc, renderer, wm, flush } = withSync();
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    const field = doc.createElement("textarea");
    renderer.elementFor("a").append(field);
    field.focus();
    flush();
    wm.focus("b");
    flush();
    assert.equal(doc.activeElement, renderer.elementFor("b"), "a window with nothing focused yet gets focus on its view");
    assert.equal(renderer.elementFor("b").getAttribute("tabindex"), "-1");
    wm.focusPrevious(); // e.g. Alt+K
    flush();
    assert.equal(doc.activeElement, field, "returning to a window restores its last focused element");
  });

  test("focus is not taken from a text field outside the WM root", () => {
    const { doc, wm, flush } = withSync();
    wm.create({ id: "a" });
    const outside = doc.createElement("input");
    doc.body.append(outside);
    outside.focus();
    wm.create({ id: "b" }); // e.g. a command typed into the demo console
    flush();
    assert.equal(doc.activeElement, outside);
  });
});

describe("stacking: children stay above a raised parent (regression)", () => {
  test("focusing or detaching a parent keeps its non-modal dialog above it, so the anchor precedes it", () => {
    let s = replay(createState(), [
      { type: "window/create", id: "p", mode: "floating" },
      { type: "window/create", id: "other", mode: "floating" },
      { type: "window/create", id: "dlg", role: "dialog", parent: "p" },
      { type: "window/create", id: "tip", role: "tooltip", parent: "dlg" },
      { type: "window/focus", id: "other" },
    ]);
    s = update(s, { type: "window/focus", id: "p" }).state;
    const order = paintOrder(s);
    assert.ok(order.indexOf("dlg") > order.indexOf("p"));
    assert.ok(order.indexOf("tip") > order.indexOf("dlg"));
    // derive: the anchored dialog comes after its anchor in the overlay.
    const ids = views(derive(s));
    assert.ok(ids.indexOf("dlg") > ids.indexOf("p"));

    let t = replay(createState(), [
      { type: "window/create", id: "p" },
      { type: "window/create", id: "q" },
      { type: "window/create", id: "dlg", role: "dialog", parent: "p", focus: false },
    ]);
    t = update(t, { type: "window/detach", id: "p", x: 10, y: 10 }).state;
    assert.ok(paintOrder(t).indexOf("dlg") > paintOrder(t).indexOf("p"));
  });
});
