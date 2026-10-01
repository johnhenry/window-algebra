import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager } from "../src/index.mjs";
import { createDomRenderer, createSurfaceRegistry, attachPopouts } from "../src/browser/index.mjs";
import { createFakeDocument, createFakeWindow } from "./helpers/fake-dom.mjs";

const setup = (wmOptions = {}) => {
  const doc = createFakeDocument();
  const style = doc.createElement("style");
  style.textContent = ".wa-win { color: red; }";
  doc.head.append(style);
  const root = doc.createElement("div");
  doc.body.append(root);
  const contents = {};
  const registry = createSurfaceRegistry();
  for (const id of ["a", "b"]) {
    contents[id] = doc.createElement("section");
    contents[id].setAttribute("data-content", id);
    registry.set(id, {
      mount(target) {
        target.append(contents[id]);
      },
      unmount() {
        contents[id].remove();
      },
    });
  }
  const renderer = createDomRenderer({ root, surfaceFor: registry, document: doc, anchorFallback: false });
  const wm = createWindowManager({ renderer, ...wmOptions });
  wm.create({ id: "a" });
  wm.create({ id: "b", title: "B" });
  return { doc, root, renderer, contents, registry, wm };
};

describe("attachPopouts", () => {
  test("pop-out: opens a popup, copies styles, adopts the surface's DOM, dispatches window/pop-out", () => {
    const { doc, root, renderer, contents, wm } = setup();
    const popup = createFakeWindow();
    const opened = [];
    const popouts = attachPopouts({ wm, renderer, open: (...args) => (opened.push(args), popup) });

    const bElement = renderer.elementFor("b");
    const out = popouts.popOut("b");

    assert.equal(opened.length, 1);
    assert.equal(wm.state.windows.b.status, "popped-out");
    assert.deepEqual(
      out.events.filter((e) => e.type === "window/status-changed"),
      [{ type: "window/status-changed", id: "b", status: "popped-out", previous: "normal" }],
    );
    // The rendered element (and its mounted surface content) moved into the popup...
    assert.equal(bElement.ownerDocument, popup.document);
    assert.equal(contents.b.parentNode, bElement, "surface content never unmounted, just moved");
    assert.equal(bElement.parentNode, popup.document.body);
    // ...and the main renderer no longer knows about it (no double-remove on the next commit).
    assert.equal(renderer.elementFor("b"), undefined);
    assert.ok(!root.contains(bElement));
    // The popup's own document got the title and the copied stylesheet.
    assert.equal(popup.document.title, "B");
    assert.equal(popup.document.head.querySelectorAll("style").length, 1);
  });

  test("pop-out: a popup blocker (open returns null) rejects with an event and touches nothing", () => {
    const { renderer, wm } = setup();
    const popouts = attachPopouts({ wm, renderer, open: () => null });
    const bElement = renderer.elementFor("b");
    const out = popouts.popOut("b");
    assert.deepEqual(out.events, [{ type: "command/rejected", command: "window/pop-out", id: "b", reason: "popup-blocked" }]);
    assert.equal(wm.state.windows.b.status, "normal");
    assert.equal(renderer.elementFor("b"), bElement, "never released since the popup never opened");
  });

  test("pop-out: an already-closed popup (closed: true) is treated the same as a blocked one", () => {
    const { wm } = setup();
    const popup = createFakeWindow();
    popup.closed = true;
    const popouts = attachPopouts({ wm, renderer: undefined, open: () => popup });
    const out = popouts.popOut("a");
    assert.equal(out.events[0].reason, "popup-blocked");
  });

  test("pop-out: refuses without opening a popup when the command itself would be rejected", () => {
    const { wm } = setup();
    let opened = 0;
    const popouts = attachPopouts({ wm, renderer: undefined, open: () => (opened++, createFakeWindow()) });
    assert.equal(popouts.popOut("zz").events[0].reason, "unknown-window");
    assert.equal(opened, 0);

    wm.dispatch({ type: "window/create", id: "m", role: "dialog", modal: true, parent: "a" });
    assert.equal(popouts.popOut("a").events[0].reason, "blocked");
    assert.equal(opened, 0);
  });

  test("pop-out: already popped out (or already tracked) is a no-op, not a second popup", () => {
    const { wm, renderer } = setup();
    let opened = 0;
    const popup1 = createFakeWindow();
    const popouts = attachPopouts({ wm, renderer, open: () => (opened++, opened === 1 ? popup1 : createFakeWindow()) });
    popouts.popOut("b");
    assert.equal(opened, 1);
    const again = popouts.popOut("b");
    assert.equal(opened, 1);
    assert.deepEqual(again.events, []);
  });

  test("pop-in: closes the popup and moves the DOM back so the surface remounts in place, unmounted", () => {
    const { root, renderer, contents, wm } = setup();
    const popup = createFakeWindow();
    const popouts = attachPopouts({ wm, renderer, open: () => popup });
    const bElement = renderer.elementFor("b");
    popouts.popOut("b");
    assert.ok(popup.closed === false);

    const out = popouts.popIn("b");
    assert.equal(popup.closed, true);
    assert.equal(wm.state.windows.b.status, "normal");
    assert.deepEqual(
      out.events.filter((e) => e.type === "window/status-changed"),
      [{ type: "window/status-changed", id: "b", status: "normal", previous: "popped-out" }],
    );
    // adopt() re-registered it, so the *same* element/content comes back...
    assert.equal(renderer.elementFor("b"), bElement);
    assert.equal(contents.b.parentNode, bElement);
    // ...and after the manager's own re-render it is back under the WM root.
    assert.ok(root.contains(bElement));
    assert.equal(popouts.isPoppedOut("b"), false);
  });

  test("pop-in with nothing tracked (never popped out via this helper) is a no-op", () => {
    const { wm } = setup();
    const popouts = attachPopouts({ wm, renderer: undefined, open: () => createFakeWindow() });
    const out = popouts.popIn("a"); // "a" was never popped out
    assert.deepEqual(out.events, [], "a no-op, like window/restore on a normal window");
    assert.equal(wm.state.windows.a.status, "normal");
  });

  test("closing the popup window itself pops the window back in", () => {
    const { renderer, wm } = setup();
    const popup = createFakeWindow();
    const popouts = attachPopouts({ wm, renderer, open: () => popup });
    popouts.popOut("b");
    popup.dispatch("pagehide", {});
    assert.equal(wm.state.windows.b.status, "normal");
    assert.equal(popouts.isPoppedOut("b"), false);
    assert.equal(renderer.elementFor("b").ownerDocument, renderer.root.ownerDocument);
  });

  test("focusing the popup blurs the WM focus (a popped-out window is never WM-focused); it does not loop", () => {
    const { renderer, wm } = setup();
    const popup = createFakeWindow();
    const popouts = attachPopouts({ wm, renderer, open: () => popup });
    popouts.popOut("b");
    wm.focus("a");
    assert.equal(wm.state.focus.window, "a");
    popup.dispatch("focus", {});
    assert.equal(wm.state.focus.window, null);
    popup.dispatch("focus", {});
    assert.equal(wm.state.focus.window, null);
    assert.equal(wm.focus("b").events[0].reason, "popped-out");
  });

  test("the popup's title tracks window/set-title while popped out", () => {
    const { renderer, wm } = setup();
    const popup = createFakeWindow();
    const popouts = attachPopouts({ wm, renderer, open: () => popup });
    popouts.popOut("b");
    wm.dispatch({ type: "window/set-title", id: "b", title: "Renamed" });
    assert.equal(popup.document.title, "Renamed");
  });

  test("closing a popped-out window (window/close) closes its popup too", () => {
    const { renderer, wm } = setup();
    const popup = createFakeWindow();
    const popouts = attachPopouts({ wm, renderer, open: () => popup });
    popouts.popOut("b");
    wm.close("b");
    assert.equal(popup.closed, true);
    assert.equal(popouts.isPoppedOut("b"), false);
  });

  test("a direct window/pop-in (bypassing the helper, e.g. undo) still closes the tracked popup", () => {
    const { renderer, wm } = setup();
    const popup = createFakeWindow();
    const popouts = attachPopouts({ wm, renderer, open: () => popup });
    popouts.popOut("b");
    wm.dispatch({ type: "window/pop-in", id: "b" });
    assert.equal(popup.closed, true);
    assert.equal(popouts.isPoppedOut("b"), false);
  });

  test("undoing a pop-out closes the popup; redoing it pops the window back in instead of leaving it invisible (regression)", () => {
    const { renderer, wm } = setup({ history: true });
    const popup = createFakeWindow();
    const popouts = attachPopouts({ wm, renderer, open: () => popup });
    popouts.popOut("b");
    assert.equal(wm.state.windows.b.status, "popped-out");
    wm.undo();
    assert.equal(wm.state.windows.b.status, "normal");
    assert.equal(popup.closed, true, "undo used to leave the popup open");
    assert.equal(popouts.isPoppedOut("b"), false);
    // Redo cannot reopen a popup (no gesture, and the DOM was released): the window is popped back in.
    wm.redo();
    assert.equal(wm.state.windows.b.status, "normal");
  });

  test("loading a state with a popped-out window pops it back in", () => {
    const { renderer, wm } = setup({ history: true });
    const popouts = attachPopouts({ wm, renderer, open: () => createFakeWindow() });
    const saved = JSON.parse(wm.serialize());
    saved.windows.b.status = "popped-out";
    wm.load(saved);
    assert.equal(wm.state.windows.b.status, "normal");
    assert.equal(popouts.isPoppedOut("b"), false);
  });

  test("detach() closes every tracked popup and stops reacting to further state changes", () => {
    const { renderer, wm } = setup();
    const popupA = createFakeWindow();
    const popupB = createFakeWindow();
    let n = 0;
    const popouts = attachPopouts({ wm, renderer, open: () => (n++ === 0 ? popupA : popupB) });
    popouts.popOut("a");
    popouts.popOut("b");
    popouts.detach();
    assert.equal(popupA.closed, true);
    assert.equal(popupB.closed, true);
  });
});
