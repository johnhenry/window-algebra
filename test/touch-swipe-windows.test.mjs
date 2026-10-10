import { test } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, BASE_CSS } from "../src/index.mjs";
import { createDomRenderer, attachInput } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

// Phones show one window at a time: a monocle (`stack` without a tab strip). `swipe.tabs` only listens on a
// strip, so an app with a monocle has no way to get "swipe to the next window" from the library and has to
// classify strokes itself. Proposal: `touch: { swipe: { windows: true } }` swipes between the windows of the
// active stack, with the same classifier, distance and RTL mirroring as tab swipes.
const setup = (touch, { layout = { type: "monocle" }, direction } = {}) => {
  const doc = createFakeDocument();
  doc.defaultView = class { static CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } }; };
  const root = doc.createElement("div");
  root.rect = { left: 0, top: 0, width: 600, height: 400 };
  doc.body.append(root);
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false });
  const wm = createWindowManager({ state: createState({ layout, ...(direction ? { config: { direction } } : {}) }), renderer });
  for (const id of ["a", "b", "c"]) wm.create({ id });
  wm.focus("a");
  attachInput({ root, wm, touch, afterRender: () => {} });
  const ptr = (type, target, x, y) => root.dispatch(type, { target, clientX: x, clientY: y, pointerId: 7, pointerType: "touch", button: 0, preventDefault() {} });
  const swipe = (id, from, to, child) => {
    const el = child ? child(renderer.elementFor(id)) : renderer.elementFor(id);
    ptr("pointerdown", el, from, 100);
    ptr("pointermove", el, (from + to) / 2, 100);
    ptr("pointermove", el, to, 100);
    ptr("pointerup", el, to, 100);
  };
  return { wm, doc, root, swipe, focused: () => wm.getState().focus.window };
};

test("swipe.windows: swiping left shows the next window of a monocle, right the previous one, with no wrap", () => {
  const t = setup({ swipe: { tabs: true, windows: true } });
  t.swipe("a", 300, 200);
  assert.equal(t.focused(), "b");
  t.swipe("b", 300, 200);
  assert.equal(t.focused(), "c");
  t.swipe("c", 300, 200);
  assert.equal(t.focused(), "c");
  t.swipe("c", 200, 300);
  assert.equal(t.focused(), "b");
});

test("swipe.windows is off unless asked for", () => {
  const t = setup({ swipe: { tabs: true } });
  t.swipe("a", 300, 200);
  assert.equal(t.focused(), "a");
});

const both = { swipe: { windows: true } };

test("swipe.windows alone leaves tab strips to swipe.tabs, and sets the swipe-windows token", () => {
  const t = setup(both);
  assert.equal(t.root.getAttribute("data-wm-touch").split(" ").includes("swipe-windows"), true);
  assert.equal(t.root.getAttribute("data-wm-touch").split(" ").includes("swipe-tabs"), false);
  t.swipe("a", 300, 200);
  assert.equal(t.focused(), "b");
});

test("swipe.windows: a short, slow or vertical stroke does nothing", () => {
  const t = setup(both);
  t.swipe("a", 300, 280);
  assert.equal(t.focused(), "a", "under swipeDistance");
});

test("swipe.windows mirrors under rtl: swiping right goes to the next window", () => {
  const t = setup(both, { direction: "rtl" });
  t.swipe("a", 200, 300);
  assert.equal(t.focused(), "b");
  t.swipe("b", 300, 200);
  assert.equal(t.focused(), "a");
});

test("swipe.windows works on a tabs layout body and is off in layouts that show several windows", () => {
  const tabs = setup(both, { layout: { type: "tabs" } });
  tabs.swipe("a", 300, 200);
  assert.equal(tabs.focused(), "b");
  const many = setup(both, { layout: { type: "columns" } });
  many.swipe("a", 300, 200);
  assert.equal(many.focused(), "a");
});

test("swipe.windows leaves a stroke that starts in a text field or a horizontal scroller alone", () => {
  const t = setup(both);
  t.swipe("a", 300, 200, (view) => {
    const input = t.doc.createElement("input");
    view.append(input);
    return input;
  });
  assert.equal(t.focused(), "a", "text field");
  t.doc.defaultView.getComputedStyle = () => ({ overflowX: "auto" });
  t.swipe("a", 300, 200, (view) => {
    const strip = t.doc.createElement("div");
    strip.scrollWidth = 900;
    strip.clientWidth = 300;
    view.append(strip);
    return strip;
  });
  assert.equal(t.focused(), "a", "horizontal scroller");
  t.swipe("a", 300, 200, (view) => {
    const plain = t.doc.createElement("div");
    plain.scrollWidth = 300;
    plain.clientWidth = 300;
    view.append(plain);
    return plain;
  });
  assert.equal(t.focused(), "b", "a body that does not scroll sideways");
});

test("BASE_CSS gives a swipe-windows stage touch-action: pan-y", () => {
  assert.match(BASE_CSS, /\[data-wm-touch~="swipe-windows"\][^{]*\{[^}]*touch-action:\s*pan-y/);
});
