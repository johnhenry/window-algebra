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
} from "../src/index.mjs";
import { createDomRenderer, createSurfaceRegistry } from "../src/browser/index.mjs";
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
