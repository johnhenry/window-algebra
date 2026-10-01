import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { view, row, stack, compile, tabId, panelId, createWindowManager, createState } from "../src/index.mjs";
import { presentationContext } from "../src/state/derive.mjs";
import { createDomRenderer, attachInput } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

describe("compile: ARIA roles", () => {
  test("a plain window view is a labelled group", () => {
    const out = compile(row({}, view("a")), { titles: { a: "Editor" }, roles: { a: "window" } });
    const win = out.children[0];
    assert.equal(win.attrs.role, "group");
    assert.equal(win.attrs["aria-label"], "Editor");
  });

  test("a non-modal dialog is role=dialog with no aria-modal", () => {
    const out = compile(row({}, view("d")), { titles: { d: "Find" }, roles: { d: "dialog" } });
    const win = out.children[0];
    assert.equal(win.attrs.role, "dialog");
    assert.equal(win.attrs["aria-modal"], undefined);
    assert.equal(win.attrs["aria-label"], "Find");
  });

  test("a modal dialog/sheet is role=dialog aria-modal=true", () => {
    const out = compile(row({}, view("d"), view("s")), {
      titles: { d: "Confirm", s: "Sheet" },
      roles: { d: "dialog", s: "sheet" },
      modal: ["d", "s"],
    });
    const [d, s] = out.children;
    assert.equal(d.attrs.role, "dialog");
    assert.equal(d.attrs["aria-modal"], "true");
    assert.equal(s.attrs.role, "dialog");
    assert.equal(s.attrs["aria-modal"], "true");
  });

  test("a role=dialog window that is not itself modal has no aria-modal even if unrelated windows are modal", () => {
    const out = compile(row({}, view("d")), { titles: { d: "Find" }, roles: { d: "dialog" }, modal: ["other"] });
    assert.equal(out.children[0].attrs["aria-modal"], undefined);
  });

  test("tabs: tab strip buttons and their panels are cross-referenced", () => {
    const out = compile(stack({ chrome: "tabs", active: "a" }, view("a"), view("b")), { titles: { a: "Files" } });
    const strip = out.children[0];
    const [tabA, tabB] = strip.children;
    const [panelA, panelB] = out.children.slice(1);
    assert.equal(tabA.attrs.id, tabId("a"));
    assert.equal(tabA.attrs["aria-controls"], panelId("a"));
    assert.equal(tabB.attrs.id, tabId("b"));
    assert.equal(tabB.attrs["aria-controls"], panelId("b"));
    assert.equal(panelA.attrs.role, "tabpanel");
    assert.equal(panelA.attrs.id, panelId("a"));
    assert.equal(panelA.attrs["aria-labelledby"], tabId("a"));
    // The panel is labelled by its tab, not given a separate aria-label.
    assert.equal(panelA.attrs["aria-label"], undefined);
    assert.equal(panelB.attrs.role, "tabpanel");
  });

  test("presentationContext exposes modal ids for compile's aria-modal", () => {
    const state = createState();
    state.windows.a = { id: "a", role: "window", modal: false, title: "A" };
    state.windows.d = { id: "d", role: "dialog", modal: true, title: "D" };
    const ctx = presentationContext(state);
    assert.deepEqual(ctx.modal, ["d"]);
  });
});

// ------------------------------------------------------------ keyboard: F6 cycling + modal trap

const setup = ({ windows = ["a", "b"], modalOf, input = {} } = {}) => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  root.rect = { left: 0, top: 0, width: 200, height: 100 };
  doc.body.append(root);
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false });
  const wm = createWindowManager({ state: createState(), renderer });
  for (const id of windows) wm.create({ id, title: id.toUpperCase() });
  if (modalOf) wm.create({ id: modalOf.id, parent: modalOf.parent, modal: true, title: modalOf.id.toUpperCase() });
  const focusables = {};
  const chrome = () => {
    for (const id of [...windows, modalOf?.id].filter(Boolean)) {
      const el = renderer.elementFor(id);
      if (!el || focusables[id]) continue;
      const btn1 = doc.createElement("button");
      const btn2 = doc.createElement("button");
      el.append(btn1, btn2);
      focusables[id] = [btn1, btn2];
    }
  };
  chrome();
  const detach = attachInput({ root, getState: wm.getState, dispatch: wm.dispatch, present: wm.present, simulate: wm.simulate, ...input });
  const key = (props) => root.dispatch("keydown", { type: "keydown", preventDefault() {}, ...props });
  return { doc, root, renderer, wm, focusables, detach, key, chrome };
};

describe("attachInput: F6 cycling (keyboard option)", () => {
  test("F6 focuses the next window, Shift+F6 the previous, only when keyboard is truthy", () => {
    const t = setup({ input: { keyboard: true } });
    t.wm.focus("a");
    t.key({ key: "F6" });
    assert.equal(t.wm.state.focus.window, "b");
    t.key({ key: "F6" });
    assert.equal(t.wm.state.focus.window, "a");
    t.key({ key: "F6", shiftKey: true });
    assert.equal(t.wm.state.focus.window, "b");
  });

  test("without the keyboard option, F6 is ignored", () => {
    const t = setup();
    t.wm.focus("a");
    t.key({ key: "F6" });
    assert.equal(t.wm.state.focus.window, "a");
  });
});

describe("attachInput: live announcements of focus and open/close (announce option)", () => {
  test("focus/next, window/create and window/close are narrated via subscribe", () => {
    const doc = createFakeDocument();
    const root = doc.createElement("div");
    doc.body.append(root);
    const renderer = createDomRenderer({ root, document: doc, anchorFallback: false });
    const wm = createWindowManager({ state: createState(), renderer });
    wm.create({ id: "a", title: "Editor" });
    wm.create({ id: "b", title: "Terminal" });
    const messages = [];
    const detach = attachInput({ root, wm, keyboard: true, announce: (m) => messages.push(m) });
    wm.focus("a");
    root.dispatch("keydown", { type: "keydown", key: "F6", preventDefault() {} });
    wm.create({ id: "c", title: "Log" });
    wm.close("c");
    assert.deepEqual(messages, ["Editor focused.", "Terminal focused.", "Log opened. Log focused.", "Log closed. Terminal focused."]);
    detach();
  });
});

describe("attachInput: modal focus trap", () => {
  test("Tab from the last focusable wraps to the first, inside the modal only", () => {
    const t = setup({ windows: ["a"], modalOf: { id: "m", parent: "a" } });
    t.wm.focus("m");
    const [first, last] = t.focusables.m;
    last.focus();
    assert.equal(t.doc.activeElement, last);
    t.key({ key: "Tab" });
    assert.equal(t.doc.activeElement, first, "Tab past the last element wraps to the first");
  });

  test("Shift+Tab from the first focusable wraps to the last", () => {
    const t = setup({ windows: ["a"], modalOf: { id: "m", parent: "a" } });
    t.wm.focus("m");
    const [first, last] = t.focusables.m;
    first.focus();
    t.key({ key: "Tab", shiftKey: true });
    assert.equal(t.doc.activeElement, last);
  });

  test("Tab is not trapped when the focused window is not modal", () => {
    const t = setup({ windows: ["a", "b"] });
    t.wm.focus("a");
    const [, last] = t.focusables.a;
    last.focus();
    let prevented = false;
    t.root.dispatch("keydown", { type: "keydown", key: "Tab", preventDefault: () => (prevented = true) });
    assert.equal(prevented, false, "no modal focused: Tab is left to the browser");
  });

  test("nested modals: the trap follows focus redirection to the deepest open modal", () => {
    const t = setup({ windows: ["a"], modalOf: { id: "m1", parent: "a" } });
    // A second modal on top of m1: focusing "a" (or m1) redirects to the deepest one.
    t.wm.create({ id: "m2", parent: "m1", modal: true, title: "M2" });
    const btn1 = t.doc.createElement("button");
    const btn2 = t.doc.createElement("button");
    t.renderer.elementFor("m2").append(btn1, btn2);
    t.wm.focus("a");
    assert.equal(t.wm.state.focus.window, "m2", "focus redirects to the deepest open modal");
    btn2.focus();
    t.key({ key: "Tab" });
    assert.equal(t.doc.activeElement, btn1, "the trap operates on m2's element, not m1's or a's");
  });

  test("focus landing outside the modal (e.g. programmatic) is pulled back in on the next Tab", () => {
    const t = setup({ windows: ["a"], modalOf: { id: "m", parent: "a" } });
    t.wm.focus("m");
    t.focusables.a[0].focus();
    const [first] = t.focusables.m;
    t.key({ key: "Tab" });
    assert.equal(t.doc.activeElement, first);
  });
});

// ------------------------------------------------------------ audit item 13: WAI-ARIA patterns

describe("compile: names, splitters and tabs (audit 13)", () => {
  test("a window with an empty title is named by its id", () => {
    const out = compile(row({}, view("a"), view("d")), { titles: { a: "", d: "" }, roles: { a: "window", d: "dialog" } });
    assert.equal(out.children[0].attrs["aria-label"], "a");
    assert.equal(out.children[1].attrs["aria-label"], "d");
  });

  test("a splitter is labelled by the pair it divides and controls both panels", () => {
    const tree = row({ resize: { path: "", weights: [1, 3] } }, view("a"), view("b"));
    const out = compile(tree, { titles: { a: "Editor", b: "" } });
    const splitter = out.children.find((child) => child.attrs["data-wm-splitter"] !== undefined);
    assert.equal(splitter.attrs["aria-label"], "Resize Editor and b");
    assert.equal(splitter.attrs["aria-controls"], `${panelId("a")} ${panelId("b")}`);
    assert.equal(splitter.attrs["aria-orientation"], "vertical");
    assert.equal(splitter.attrs["aria-valuenow"], "25");
    // The ids it names exist on the views.
    assert.deepEqual(out.children.filter((child) => child.view).map((child) => child.attrs.id), [panelId("a"), panelId("b")]);
  });

  test("tabs use a roving tabindex: only the selected tab is a Tab stop", () => {
    const out = compile(stack({ active: "b", chrome: "tabs" }, view("a"), view("b"), view("c")), {});
    const strip = out.children.find((child) => child.tag === "wm-tabs");
    assert.deepEqual(strip.children.map((tab) => tab.attrs.tabindex), ["-1", "0", "-1"]);
  });
});

describe("attachInput: tab keyboard navigation and floating move/resize (audit 13)", () => {
  const rig = ({ layout = { type: "tabs" }, ids = ["a", "b", "c"], input = {} } = {}) => {
    const doc = createFakeDocument();
    const root = doc.createElement("div");
    root.rect = { left: 0, top: 0, width: 600, height: 400 };
    doc.body.append(root);
    const renderer = createDomRenderer({ root, document: doc, anchorFallback: false });
    const wm = createWindowManager({ state: createState({ layout }), renderer, history: true });
    for (const id of ids) wm.create({ id, title: id.toUpperCase() });
    const detach = attachInput({ root, wm, ...input });
    const key = (target, props) => {
      let prevented = false;
      root.dispatch("keydown", { target, type: "keydown", preventDefault: () => (prevented = true), ...props });
      return prevented;
    };
    const tabs = () => root.querySelectorAll("[data-wm-tab]");
    return { doc, root, wm, detach, key, tabs };
  };

  test("arrows and Home/End move focus between tabs and wrap; Enter activates", () => {
    const t = rig();
    const [a, b, c] = t.tabs();
    assert.equal(t.wm.state.focus.window, "c");
    assert.equal(t.key(c, { key: "ArrowRight" }), true);
    assert.equal(t.doc.activeElement, a, "wraps from the last tab to the first");
    assert.deepEqual(t.tabs().map((tab) => tab.getAttribute("tabindex")), ["0", "-1", "-1"]);
    t.key(a, { key: "ArrowRight" });
    assert.equal(t.doc.activeElement, b);
    t.key(b, { key: "End" });
    assert.equal(t.doc.activeElement, c);
    t.key(c, { key: "Home" });
    assert.equal(t.doc.activeElement, a);
    t.key(a, { key: "ArrowLeft" });
    assert.equal(t.doc.activeElement, c);
    // Moving focus alone does not change the WM focus (manual activation) ...
    assert.equal(t.wm.state.focus.window, "c");
    t.key(b, { key: "Enter" });
    assert.equal(t.wm.state.focus.window, "b");
    t.key(a, { key: " " });
    assert.equal(t.wm.state.focus.window, "a");
    assert.equal(t.key(a, { key: "x" }), false);
    t.detach();
  });

  test("Alt+Shift+Arrow moves the focused floating window; Ctrl+Alt+Shift+Arrow resizes it", () => {
    const t = rig({ layout: { type: "columns" }, ids: ["a", "f"], input: { keyboard: true, floatStep: 10 } });
    t.wm.dispatch({ type: "window/set-mode", id: "f", mode: "floating" });
    t.wm.dispatch({ type: "window/move", id: "f", x: 100, y: 50 });
    t.wm.dispatch({ type: "window/resize", id: "f", width: 200, height: 100 });
    assert.equal(t.key(t.root, { key: "ArrowRight", altKey: true, shiftKey: true }), true);
    assert.deepEqual([t.wm.state.windows.f.placement.x, t.wm.state.windows.f.placement.y], [110, 50]);
    t.key(t.root, { key: "ArrowUp", altKey: true, shiftKey: true });
    assert.equal(t.wm.state.windows.f.placement.y, 40);
    t.key(t.root, { key: "ArrowRight", altKey: true, shiftKey: true, ctrlKey: true });
    t.key(t.root, { key: "ArrowDown", altKey: true, shiftKey: true, ctrlKey: true });
    assert.deepEqual([t.wm.state.windows.f.placement.width, t.wm.state.windows.f.placement.height], [210, 110]);
    t.key(t.root, { key: "ArrowLeft", altKey: true, shiftKey: true, ctrlKey: true });
    assert.equal(t.wm.state.windows.f.placement.width, 200);
    // A tiled window keeps the reorder keys: no window/move is dispatched for it.
    t.wm.dispatch({ type: "window/focus", id: "a" });
    const before = t.wm.state.windows.a.placement;
    t.key(t.root, { key: "ArrowRight", altKey: true, shiftKey: true });
    assert.deepEqual(t.wm.state.windows.a.placement, before);
    t.detach();
  });

  test("without the keyboard option the floating keys are inert", () => {
    const t = rig({ layout: { type: "columns" }, ids: ["f"] });
    t.wm.dispatch({ type: "window/set-mode", id: "f", mode: "floating" });
    const before = t.wm.state.windows.f.placement;
    assert.equal(t.key(t.root, { key: "ArrowRight", altKey: true, shiftKey: true }), false);
    assert.deepEqual(t.wm.state.windows.f.placement, before);
    t.detach();
  });
});

describe("BASE_CSS accessibility (audit 13)", () => {
  test("focus is never hidden: a strong :focus-visible ring replaces `outline: none`", async () => {
    const { BASE_CSS } = await import("../src/css/compile.mjs");
    assert.ok(!/focus-visible[^{]*\{\s*outline:\s*none/.test(BASE_CSS), "no outline: none on :focus-visible");
    assert.match(BASE_CSS, /\[data-wm-splitter\]:focus-visible[^{]*\{[^}]*outline: 3px solid/);
    assert.match(BASE_CSS, /wm-tabs > button:focus-visible/);
  });
  test("prefers-reduced-motion switches transitions and animations off", async () => {
    const { BASE_CSS } = await import("../src/css/compile.mjs");
    const block = BASE_CSS.slice(BASE_CSS.indexOf("@media (prefers-reduced-motion: reduce)"));
    assert.match(block, /transition: none !important/);
    assert.match(block, /view-transition/);
  });
});
