import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, row, column, view, compile } from "../src/index.mjs";
import { createDomRenderer, attachInput, htmlSurface, lazySurface, createSurfaceRegistry } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

const setup = () => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  doc.body.append(root);
  const contents = {};
  const mounts = [];
  const registry = createSurfaceRegistry();
  for (const id of ["a", "b", "c"]) {
    contents[id] = doc.createElement("section");
    contents[id].setAttribute("data-content", id);
    registry.set(id, {
      mount(target) {
        mounts.push(["mount", id]);
        target.append(contents[id]);
      },
      unmount() {
        mounts.push(["unmount", id]);
        contents[id].remove();
      },
    });
  }
  const renderer = createDomRenderer({ root, surfaceFor: registry, document: doc, anchorFallback: false });
  return { doc, root, renderer, contents, mounts };
};

describe("DOM renderer", () => {
  test("commits a render tree into keyed elements with inline styles", () => {
    const { root, renderer } = setup();
    renderer.commit(compile(row({}, view("a"), view("b"))));
    assert.ok(root.hasAttribute("data-wm-root"));
    const rowEl = root.children[0];
    assert.equal(rowEl.localName, "wm-row");
    assert.equal(rowEl.style.getPropertyValue("display"), "flex");
    assert.deepEqual(
      rowEl.children.map((el) => el.getAttribute("data-view")),
      ["a", "b"],
    );
  });

  test("view elements and mounted surfaces survive layout changes", () => {
    const { root, renderer, contents, mounts } = setup();
    renderer.commit(compile(row({}, view("a"), view("b"))));
    const aElement = renderer.elementFor("a");
    renderer.commit(compile(column({}, view("b"), view("a"))));
    assert.equal(renderer.elementFor("a"), aElement);
    assert.equal(contents.a.parentNode, aElement);
    assert.deepEqual(mounts, [
      ["mount", "a"],
      ["mount", "b"],
    ]);
    const col = root.children[0];
    assert.equal(col.localName, "wm-column");
    assert.deepEqual(
      col.children.map((el) => el.getAttribute("data-view")),
      ["b", "a"],
    );
  });

  test("removed views unmount their surface; stale styles are removed", () => {
    const { renderer, mounts } = setup();
    renderer.commit(compile(row({}, view("a"), view("b")), { focused: "a" }));
    assert.ok(renderer.elementFor("a").hasAttribute("data-focused"));
    renderer.commit(compile(row({}, view("a")), { focused: null }));
    assert.deepEqual(mounts.at(-1), ["unmount", "b"]);
    assert.equal(renderer.elementFor("b"), undefined);
    assert.ok(!renderer.elementFor("a").hasAttribute("data-focused"));
  });

  test("a container changing type under a modifier is replaced cleanly (regression)", () => {
    const { root, renderer } = setup();
    const wm = createWindowManager({ renderer, state: createState({ config: { gap: 6, inset: 6 } }) });
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    wm.setLayout({ type: "bsp" });
    wm.setLayout({ type: "tabs" });
    const overlayEl = root.children[0];
    assert.equal(overlayEl.children.length, 1);
    assert.equal(overlayEl.children[0].localName, "wm-stack");
    assert.equal(root.querySelectorAll("wm-view").length, 2);
    assert.equal(root.querySelectorAll("wm-row").length, 0);
  });

  test("views can move between sibling containers in one commit", () => {
    const { root, renderer } = setup();
    renderer.commit(compile(row({}, column({}, view("a"), view("b")), column({}, view("c")))));
    renderer.commit(compile(row({}, column({}, view("a")), column({}, view("b"), view("c")))));
    const [left, right] = root.children[0].children;
    assert.deepEqual(left.children.map((el) => el.getAttribute("data-view")), ["a"]);
    assert.deepEqual(right.children.map((el) => el.getAttribute("data-view")), ["b", "c"]);
  });

  test("measure reports realized geometry per view", () => {
    const { renderer } = setup();
    renderer.commit(compile(row({}, view("a"))));
    assert.deepEqual(renderer.measure(), { a: { x: 0, y: 0, width: 100, height: 100 } });
  });

  test("destroy unmounts everything", () => {
    const { root, renderer, mounts } = setup();
    renderer.commit(compile(row({}, view("a"))));
    renderer.destroy();
    assert.equal(root.children.length, 0);
    assert.deepEqual(mounts.at(-1), ["unmount", "a"]);
  });

  test("manager + renderer end to end", () => {
    const { root, renderer } = setup();
    const wm = createWindowManager({ renderer });
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    wm.create({ id: "c" });
    assert.equal(root.querySelectorAll("wm-view").length, 3);
    wm.setLayout({ type: "tabs" });
    assert.equal(root.querySelectorAll("button[data-wm-tab]").length, 3);
    wm.close("c");
    assert.equal(root.querySelectorAll("wm-view").length, 2);
  });
});

describe("input adapter", () => {
  test("pointerdown focuses; move handle drags floating windows; command buttons dispatch", () => {
    const { doc, root, renderer } = setup();
    const wm = createWindowManager({ renderer });
    wm.create({ id: "a" });
    wm.create({ id: "b", mode: "floating", placement: { x: 10, y: 10, width: 200, height: 100 } });
    const detach = attachInput({ root, getState: wm.getState, dispatch: wm.dispatch });

    const handle = doc.createElement("header");
    handle.setAttribute("data-wm-handle", "move");
    renderer.elementFor("b").append(handle);
    const closer = doc.createElement("button");
    closer.setAttribute("data-wm-command", "window/close");
    renderer.elementFor("a").append(closer);

    root.dispatch("pointerdown", { target: renderer.elementFor("a"), clientX: 0, clientY: 0 });
    assert.equal(wm.state.focus.window, "a");

    root.dispatch("pointerdown", { target: handle, clientX: 100, clientY: 100, pointerId: 1, preventDefault() {} });
    assert.equal(wm.state.focus.window, "b");
    root.dispatch("pointermove", { clientX: 130, clientY: 150 });
    assert.deepEqual([wm.state.windows.b.placement.x, wm.state.windows.b.placement.y], [40, 60]);
    root.dispatch("pointerup", {});
    root.dispatch("pointermove", { clientX: 500, clientY: 500 });
    assert.equal(wm.state.windows.b.placement.x, 40);

    root.dispatch("click", { target: closer });
    assert.ok(!wm.state.windows.a);
    detach();
    assert.equal(root.listeners.get("pointerdown").size, 0);
  });

  test("resize handles resize with constraints", () => {
    const { doc, root, renderer } = setup();
    const wm = createWindowManager({ renderer });
    wm.create({ id: "a", mode: "floating", placement: { x: 0, y: 0, width: 200, height: 200 }, constraints: { minWidth: 150 } });
    attachInput({ root, getState: wm.getState, dispatch: wm.dispatch });
    const grip = doc.createElement("div");
    grip.setAttribute("data-wm-handle", "resize-se");
    renderer.elementFor("a").append(grip);
    root.dispatch("pointerdown", { target: grip, clientX: 200, clientY: 200, preventDefault() {} });
    root.dispatch("pointermove", { clientX: 100, clientY: 250 });
    assert.deepEqual(wm.state.windows.a.placement, { x: 0, y: 0, width: 150, height: 250 });
  });

  test("resize gesture honours size hints: aspectRatio and increments", () => {
    const { doc, root, renderer } = setup();
    const wm = createWindowManager({ renderer });
    wm.create({
      id: "a",
      mode: "floating",
      placement: { x: 0, y: 0, width: 100, height: 100 },
      constraints: { widthIncrement: 10, heightIncrement: 20 },
    });
    attachInput({ root, getState: wm.getState, dispatch: wm.dispatch });
    const grip = doc.createElement("div");
    grip.setAttribute("data-wm-handle", "resize-se");
    renderer.elementFor("a").append(grip);
    root.dispatch("pointerdown", { target: grip, clientX: 100, clientY: 100, preventDefault() {} });
    root.dispatch("pointermove", { clientX: 124, clientY: 124 });
    // 124 -> nearest multiple of 10 (120); 124 -> nearest multiple of 20 (120).
    assert.deepEqual(wm.state.windows.a.placement, { x: 0, y: 0, width: 120, height: 120 });
    root.dispatch("pointerup", {});

    wm.dispatch({ type: "window/set-constraints", id: "a", constraints: { aspectRatio: 1, widthIncrement: undefined, heightIncrement: undefined } });
    const gripE = doc.createElement("div");
    gripE.setAttribute("data-wm-handle", "resize-e");
    renderer.elementFor("a").append(gripE);
    root.dispatch("pointerdown", { target: gripE, clientX: 120, clientY: 120, preventDefault() {} });
    root.dispatch("pointermove", { clientX: 220, clientY: 120 });
    // Dragging only the east edge grows width to 220; height follows the aspect ratio, not the pointer.
    assert.deepEqual(wm.state.windows.a.placement, { x: 0, y: 0, width: 220, height: 220 });
  });

  test("tab buttons focus their window", () => {
    const { root, renderer } = setup();
    const wm = createWindowManager({ renderer });
    wm.setLayout({ type: "tabs" });
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    attachInput({ root, getState: wm.getState, dispatch: wm.dispatch });
    const tab = root.querySelector('button[data-wm-tab="a"]');
    root.dispatch("pointerdown", { target: tab });
    assert.equal(wm.state.focus.window, "a");
  });
});

describe("surfaces", () => {
  test("htmlSurface and lazySurface share the mount/unmount contract", () => {
    const doc = createFakeDocument();
    const target = doc.createElement("div");
    const el = doc.createElement("p");
    const html = htmlSurface(el);
    html.mount(target);
    assert.equal(el.parentNode, target);
    html.unmount();
    assert.equal(el.parentNode, null);

    let cleaned = false;
    const lazy = lazySurface((t) => {
      t.setAttribute("data-mounted", "");
      return () => (cleaned = true);
    });
    lazy.mount(target);
    assert.ok(target.hasAttribute("data-mounted"));
    lazy.unmount();
    assert.ok(cleaned);
  });
});
