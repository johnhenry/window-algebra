import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState } from "../src/index.mjs";
import { createDomRenderer, attachInput } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

/**
 * Three tiled columns a|b|c in a 300×100 root, each starting 100px wide.
 * The renderer commits real `[data-wm-splitter]` elements (from `compile`),
 * so these tests drive the actual markup, not a stand-in.
 */
const setup = ({ layout = { type: "columns" }, windows = ["a", "b", "c"], history = true, input = {} } = {}) => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  root.rect = { left: 0, top: 0, width: 300, height: 100 };
  doc.body.append(root);
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false });
  const wm = createWindowManager({ state: createState({ layout }), renderer, history });
  for (const id of windows) wm.create({ id, title: id.toUpperCase() });

  const commands = [];
  const dispatch = (command) => {
    commands.push(command);
    return wm.dispatch(command);
  };
  const detach = attachInput({ root, getState: wm.getState, dispatch, present: wm.present, simulate: wm.simulate, ...input });

  const container = () => root.querySelector('[data-layout="row"], [data-layout="column"]');
  const splitterEl = (index = 0) => root.querySelector(`[data-wm-splitter][data-wm-index="${index}"]`);
  /** Lay the container and its children out left-to-right (row) or top-to-bottom (column), each `sizes[i]` px wide/tall. */
  const layoutRects = (sizes) => {
    const el = container();
    const horizontal = el.getAttribute("data-layout") === "row";
    let pos = 0;
    for (const kid of el.childNodes) {
      const extent = sizes[el.childNodes.indexOf(kid)] ?? 0;
      kid.rect = horizontal ? { left: pos, top: 0, width: extent, height: 100 } : { left: 0, top: pos, width: 100, height: extent };
      pos += extent;
    }
    el.rect = horizontal ? { left: 0, top: 0, width: pos, height: 100 } : { left: 0, top: 0, width: 100, height: pos };
  };
  const at = (x, y = 50, extra = {}) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {}, ...extra });
  const down = (target, x, y) => root.dispatch("pointerdown", { target, ...at(x, y) });
  const move = (x, y) => root.dispatch("pointermove", at(x, y));
  const up = (x, y) => root.dispatch("pointerup", at(x, y));
  const key = (target, keyName) => root.dispatch("keydown", { target, key: keyName, type: "keydown", preventDefault() {}, stopPropagation() {} });
  const resizes = () => commands.filter((c) => c.type === "layout/resize-split");
  const sizes = () => wm.state.workspaces.main.layout.sizes?.[""];

  return { doc, root, renderer, wm, detach, container, splitterEl, layout: layoutRects, down, move, up, key, commands, resizes, sizes };
};

describe("splitter drag: pointer capture, one undo step, min-share clamping", () => {
  test("dragging a columns splitter shifts weight from one side to the other", () => {
    const t = setup();
    t.layout([100, 100, 100]); // a | b | c, each 100px, container 300px (minus splitter thickness, negligible here)
    const splitter = t.splitterEl(0);
    assert.equal(splitter.getAttribute("role"), "separator");
    t.down(splitter, 100, 50);
    t.move(130, 50); // drag 30px right: a grows, b shrinks
    const [a, b, c] = t.sizes();
    assert.ok(a > 1, `a grew: ${a}`);
    assert.ok(b < 1, `b shrank: ${b}`);
    assert.equal(c, 1, "c (not adjacent to this splitter) is untouched");
    assert.ok(Math.abs(a + b - 2) < 1e-9, "the pair's total weight is conserved");
    t.up(130, 50);
    // Every intermediate command shared one gesture token, so the whole drag is one undo step.
    assert.equal(new Set(t.resizes().map((c) => c.gesture)).size, 1);
    assert.equal(t.wm.canUndo, true);
    t.wm.undo();
    assert.equal(t.sizes(), undefined, "undo restores the pre-drag (unresized) state in one step");
  });

  test("Escape cancels: the split returns to its pre-drag value, still as one gesture", () => {
    const t = setup();
    t.layout([100, 100, 100]);
    const splitter = t.splitterEl(0);
    t.down(splitter, 100, 50);
    t.move(160, 50);
    assert.notEqual(t.sizes()[0], 1);
    t.doc.dispatch("keydown", { target: splitter, key: "Escape", type: "keydown", preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(t.sizes(), [1, 1, 1]);
    assert.equal(t.wm.canUndo, true); // one step, even though it round-tripped back to the baseline
    t.wm.undo();
    assert.equal(t.sizes(), undefined);
  });

  test("dragging never pushes a side below a 5% floor", () => {
    const t = setup({ windows: ["a", "b"] });
    t.layout([100, 100]);
    const splitter = t.splitterEl(0);
    t.down(splitter, 100, 50);
    t.move(-10000, 50); // absurd drag toward negative
    const [a, b] = t.sizes();
    assert.ok(a >= (a + b) * 0.05 - 1e-9);
    assert.ok(b >= (a + b) * 0.05 - 1e-9);
    t.up(-10000, 50);
  });

  test("a window's minWidth stops the drag well short of where it would otherwise land", () => {
    const drag = (constraints) => {
      const t = setup();
      t.layout([100, 100, 100]);
      if (constraints) t.wm.dispatch({ type: "window/set-constraints", id: "b", constraints });
      t.down(t.splitterEl(0), 100, 50); // between a and b
      t.move(300, 50); // a huge drag toward a, which would otherwise hit the 5% floor
      t.up(300, 50);
      return t.sizes()[1]; // b's resulting weight
    };
    const unconstrained = drag(null);
    const constrained = drag({ minWidth: 80 }); // b starts at 100px: only 20px of give
    assert.ok(unconstrained < 0.11, "without a constraint, b is squeezed to the 5% floor");
    assert.ok(constrained > unconstrained + 0.5, "minWidth left b much bigger than the floor would");
  });

  test("a splitter click never starts a window drag, and vice versa", () => {
    const t = setup();
    t.layout([100, 100, 100]);
    const splitter = t.splitterEl(0);
    t.down(splitter, 100, 50);
    t.move(120, 50);
    assert.equal(t.root.hasAttribute("data-wm-dragging"), false, "the tiled-drag overlay never opens for a splitter drag");
    t.up(120, 50);
    assert.equal(t.resizes().length > 0, true);
    assert.equal(t.commands.some((c) => c.type === "window/drop"), false);
  });
});

describe("splitter keyboard resizing", () => {
  test("an arrow key along the splitter's axis nudges it by splitterStep of the pair's total", () => {
    const t = setup();
    t.layout([100, 100, 100]);
    const splitter = t.splitterEl(0);
    t.key(splitter, "ArrowRight");
    const [a, b] = t.sizes();
    assert.ok(Math.abs(a - 1.1) < 1e-9);
    assert.ok(Math.abs(b - 0.9) < 1e-9);
  });

  test("an arrow key across the splitter's axis is ignored", () => {
    const t = setup();
    t.layout([100, 100, 100]);
    const splitter = t.splitterEl(0); // a row's splitter is vertical: only Left/Right apply
    t.key(splitter, "ArrowDown");
    assert.equal(t.sizes(), undefined);
    assert.equal(t.resizes().length, 0);
  });

  test("a row layout's splitter is horizontal and answers Up/Down", () => {
    const t = setup({ layout: { type: "rows" } });
    t.layout([50, 50]);
    const splitter = t.splitterEl(0);
    assert.equal(splitter.getAttribute("aria-orientation"), "horizontal");
    t.key(splitter, "ArrowDown");
    const [a, b] = t.sizes();
    assert.ok(a > 1 && b < 1);
  });

  test("splitterStep is configurable (a fraction of the pair's total weight)", () => {
    const t = setup({ input: { splitterStep: 0.2 } });
    t.layout([100, 100, 100]);
    t.key(t.splitterEl(0), "ArrowRight");
    const [a] = t.sizes();
    assert.ok(Math.abs(a - 1.4) < 1e-9);
  });
});

describe("splitters work the same way for master-stack and bsp", () => {
  test("dragging a master-stack splitter adjusts spec.ratio", () => {
    const t = setup({ layout: { type: "master-stack", ratio: 0.5 }, windows: ["a", "b"] });
    t.layout([150, 150]);
    const splitter = t.splitterEl(0);
    assert.equal(splitter.getAttribute("data-wm-path"), "");
    t.down(splitter, 150, 50);
    t.move(180, 50);
    assert.ok(t.wm.state.workspaces.main.layout.ratio > 0.5);
    t.up(180, 50);
  });

  test("a bsp split's splitter carries its L/R path and resizes that node's ratio only", () => {
    const t = setup({ layout: { type: "bsp" }, windows: ["a", "b", "c"] });
    // bspFrom(["a","b","c"]): root split first=a, second=split(first=b, second=c) — both splits render.
    const root = t.root.querySelectorAll('[data-wm-splitter][data-wm-path=""]')[0];
    assert.ok(root, "the root split has a splitter");
    t.layout([300, 0, 0]); // rough: only the outer container's rect matters for this drag
    t.down(root, 150, 50);
    t.move(120, 50);
    assert.notEqual(t.wm.state.workspaces.main.layout.tree.ratio, 0.5);
    t.up(120, 50);
  });
});
