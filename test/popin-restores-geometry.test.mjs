import { test } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager } from "../src/index.mjs";
import { createDomRenderer, createSurfaceRegistry, attachPopouts } from "../src/browser/index.mjs";
import { createFakeDocument, createFakeWindow } from "./helpers/fake-dom.mjs";

// popOut() makes the element fill the popup (`fillPopup`: position static, width 100%, height 100vh, box-sizing
// border-box, and it removes left/top/flex/grid-area/...). popIn() hands the element back to the renderer, which
// only re-patches the properties it manages, so the popup geometry stays on the element in the main page: a tile
// comes back `position: static; height: 100vh`, and a tiled window loses the `flex` the layout gave it.
test("pop-in puts back the inline geometry the layout had given the element before pop-out", () => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  doc.body.append(root);
  const registry = createSurfaceRegistry();
  const renderer = createDomRenderer({ root, surfaceFor: registry, document: doc, anchorFallback: false });
  const wm = createWindowManager({ renderer });
  wm.create({ id: "a" });
  wm.create({ id: "b" });
  const element = renderer.elementFor("b");
  const read = () => ["position", "width", "height", "box-sizing"].map((p) => element.style.getPropertyValue(p) || "");
  const before = read();
  const popouts = attachPopouts({ wm, renderer, open: () => createFakeWindow() });
  popouts.popOut("b");
  assert.equal(element.style.getPropertyValue("height"), "100vh", "in the popup it fills the window");
  popouts.popIn("b");
  assert.deepEqual(read(), before, "back in the page it has the geometry the layout gave it");
});

test("pop-in puts back flex and inset a layout had given the element, and leaves unrelated styles alone", () => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  doc.body.append(root);
  const registry = createSurfaceRegistry();
  const renderer = createDomRenderer({ root, surfaceFor: registry, document: doc, anchorFallback: false });
  const wm = createWindowManager({ renderer });
  wm.create({ id: "a" });
  const element = renderer.elementFor("a");
  element.style.setProperty("flex", "2 1 0");
  element.style.setProperty("left", "12px");
  element.style.setProperty("color", "red");
  const popouts = attachPopouts({ wm, renderer, open: () => createFakeWindow() });
  popouts.popOut("a");
  assert.equal(element.style.getPropertyValue("flex") || "", "");
  popouts.popIn("a");
  assert.equal(element.style.getPropertyValue("flex"), "2 1 0");
  assert.equal(element.style.getPropertyValue("left"), "12px");
  assert.equal(element.style.getPropertyValue("color"), "red");
});
