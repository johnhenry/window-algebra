import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, row, column, view, compile } from "../src/index.mjs";
import { createDomRenderer } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

/** A fake `document.startViewTransition`: runs the callback synchronously and logs each call. */
const fakeViewTransitions = (log = []) => {
  const fn = (callback) => {
    log.push("start");
    callback();
    const transition = {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished: Promise.resolve(),
      skipTransition() {
        log.push("skip");
      },
    };
    return transition;
  };
  fn.log = log;
  return fn;
};

const setup = (rendererOptions = {}) => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  doc.body.append(root);
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, ...rendererOptions });
  return { doc, root, renderer };
};

describe("DOM renderer: animate", () => {
  test("no animate option: commits are synchronous and unnamed", () => {
    const { root, renderer } = setup();
    renderer.commit(compile(row({}, view("a"), view("b"))));
    assert.equal(root.children[0].localName, "wm-row");
    assert.equal(renderer.elementFor("a").style.getPropertyValue("view-transition-name"), "");
    assert.equal(renderer.animate, false);
  });

  test("animate: true without startViewTransition support falls back to a synchronous commit", () => {
    const { renderer } = setup({ animate: true });
    // The fake document has no startViewTransition.
    renderer.commit(compile(row({}, view("a"))));
    assert.equal(renderer.elementFor("a").getAttribute("data-view"), "a");
  });

  test("animate: true wraps a commit in document.startViewTransition when supported", () => {
    const log = [];
    const { doc, renderer } = setup({ animate: true });
    doc.startViewTransition = fakeViewTransitions(log);
    renderer.commit(compile(row({}, view("a"), view("b"))));
    assert.deepEqual(log, ["start"]);
    assert.equal(renderer.elementFor("a").getAttribute("data-view"), "a");
  });

  test("primary view elements get a unique, sanitized view-transition-name; projections do not", () => {
    const { root, doc, renderer } = setup({ animate: true });
    doc.startViewTransition = fakeViewTransitions();
    renderer.commit(compile(row({}, view("weird id! / 1"), view("weird id! / 1"))));
    const primary = renderer.elementFor("weird id! / 1");
    const name = primary.style.getPropertyValue("view-transition-name");
    assert.match(name, /^wm-r\d+-weird-id-+1$/);
    // A second occurrence of the same view id is a projection: no primary flag, no name.
    const projected = root.querySelectorAll(`[data-view-projection="2"]`)[0];
    assert.ok(projected);
    assert.equal(projected.style.getPropertyValue("view-transition-name"), "");
  });

  test("two ids that sanitize to the same identifier still get distinct names", () => {
    const { doc, renderer } = setup({ animate: true });
    doc.startViewTransition = fakeViewTransitions();
    renderer.commit(compile(row({}, view("a.b"), view("a-b"))));
    const nameA = renderer.elementFor("a.b").style.getPropertyValue("view-transition-name");
    const nameB = renderer.elementFor("a-b").style.getPropertyValue("view-transition-name");
    assert.notEqual(nameA, nameB);
    assert.match(nameA, /^wm-r\d+-a-b$/);
    assert.match(nameB, /^wm-r\d+-a-b-1$/);
  });

  test("a name assigned to a view id stays stable across commits", () => {
    const { renderer } = setup({ animate: true });
    renderer.commit(compile(row({}, view("a"))));
    const first = renderer.elementFor("a").style.getPropertyValue("view-transition-name");
    renderer.commit(compile(column({}, view("a"))));
    const second = renderer.elementFor("a").style.getPropertyValue("view-transition-name");
    assert.equal(first, second);
  });

  test("commit({ immediate: true }) skips the transition even when animate is on", () => {
    const log = [];
    const { doc, renderer } = setup({ animate: true });
    doc.startViewTransition = fakeViewTransitions(log);
    renderer.commit(compile(row({}, view("a"))), { immediate: true });
    assert.deepEqual(log, []);
  });

  test("prefers-reduced-motion: reduce skips the transition", () => {
    const log = [];
    const { doc, renderer } = setup({ animate: true });
    doc.startViewTransition = fakeViewTransitions(log);
    doc.defaultView.matchMedia = (q) => ({ matches: q.includes("prefers-reduced-motion") });
    renderer.commit(compile(row({}, view("a"))));
    assert.deepEqual(log, []);
  });

  test("a broken matchMedia is treated as no preference, never throws", () => {
    const { doc, renderer } = setup({ animate: true });
    doc.startViewTransition = fakeViewTransitions();
    doc.defaultView.matchMedia = () => {
      throw new Error("boom");
    };
    assert.doesNotThrow(() => renderer.commit(compile(row({}, view("a")))));
  });

  test("a commit that lands mid-transition applies immediately instead of stacking a second transition", async () => {
    const log = [];
    const { doc, renderer } = setup({ animate: true });
    let resolveFinished;
    doc.startViewTransition = (callback) => {
      log.push("start");
      callback();
      return {
        finished: new Promise((resolve) => {
          resolveFinished = resolve;
        }),
      };
    };
    renderer.commit(compile(row({}, view("a"))));
    // The first transition hasn't finished yet: a second commit is coalesced (no new transition).
    renderer.commit(compile(row({}, view("a"), view("b"))));
    assert.deepEqual(log, ["start"]);
    resolveFinished();
    await Promise.resolve();
    await Promise.resolve();
    // Now that it's settled, a further commit may animate again.
    renderer.commit(compile(row({}, view("a"), view("b"), view("c"))));
    assert.deepEqual(log, ["start", "start"]);
  });

  test("setAnimate turns animation on/off after creation (a demo toggle)", () => {
    const log = [];
    const { doc, renderer } = setup();
    doc.startViewTransition = fakeViewTransitions(log);
    renderer.commit(compile(row({}, view("a"))));
    assert.deepEqual(log, []);
    assert.equal(renderer.animate, false);
    renderer.setAnimate(true);
    assert.equal(renderer.animate, true);
    renderer.commit(compile(row({}, view("a"), view("b"))));
    assert.deepEqual(log, ["start"]);
    renderer.setAnimate(false);
    renderer.commit(compile(row({}, view("a"))));
    assert.deepEqual(log, ["start"]);
    assert.equal(renderer.animate, false);
  });

  test("duration/easing set custom properties on the document element", () => {
    const { doc } = setup({ animate: { duration: 400, easing: "ease-out" } });
    assert.equal(doc.documentElement.style.getPropertyValue("--wa-transition-duration"), "400ms");
    assert.equal(doc.documentElement.style.getPropertyValue("--wa-transition-easing"), "ease-out");
  });

  test("a string duration is passed through untouched", () => {
    const { doc } = setup({ animate: { duration: "0.5s" } });
    assert.equal(doc.documentElement.style.getPropertyValue("--wa-transition-duration"), "0.5s");
  });

  test("moveBefore state preservation still holds inside an animated commit", () => {
    const log = [];
    const { root, doc, renderer } = setup({ animate: true });
    doc.startViewTransition = fakeViewTransitions(log);
    renderer.commit(compile(row({}, view("a"), view("b"))));
    const aElement = renderer.elementFor("a");
    aElement.disconnects = 0;
    renderer.commit(compile(column({}, view("b"), view("a"))));
    assert.equal(renderer.elementFor("a"), aElement);
    assert.equal(aElement.disconnects, 0);
    assert.equal(root.children[0].localName, "wm-column");
  });
});

describe("createWindowManager: animate integration", () => {
  test("a gesture command renders immediately, never mid-transition", () => {
    const log = [];
    const doc = createFakeDocument();
    const root = doc.createElement("div");
    doc.body.append(root);
    doc.startViewTransition = fakeViewTransitions(log);
    const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, animate: true });
    const wm = createWindowManager({ renderer });
    wm.create({ id: "a" });
    log.length = 0;
    wm.dispatch({ type: "window/move", id: "a", x: 1, y: 1, gesture: "drag-1" });
    assert.deepEqual(log, []);
  });

  test("an explicit command.immediate flag also skips the transition", () => {
    const log = [];
    const doc = createFakeDocument();
    const root = doc.createElement("div");
    doc.body.append(root);
    doc.startViewTransition = fakeViewTransitions(log);
    const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, animate: true });
    const wm = createWindowManager({ renderer });
    wm.create({ id: "a" });
    log.length = 0;
    wm.dispatch({ type: "window/set-title", id: "a", title: "X", immediate: true });
    assert.deepEqual(log, []);
  });

  test("a non-gesture command animates normally", () => {
    const log = [];
    const doc = createFakeDocument();
    const root = doc.createElement("div");
    doc.body.append(root);
    doc.startViewTransition = fakeViewTransitions(log);
    const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, animate: true });
    const wm = createWindowManager({ renderer });
    wm.create({ id: "a" });
    assert.deepEqual(log, ["start"]);
  });

  test("serialize / undo / replay are unaffected by the animate option", () => {
    const log = [];
    const doc = createFakeDocument();
    const root = doc.createElement("div");
    doc.body.append(root);
    doc.startViewTransition = fakeViewTransitions(log);
    const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, animate: true });
    const wm = createWindowManager({ renderer, history: true });
    wm.create({ id: "a" });
    wm.create({ id: "b" });
    const before = wm.serialize();
    wm.undo();
    wm.redo();
    assert.equal(wm.serialize(), before);
    assert.deepEqual(Object.keys(wm.state.windows), ["a", "b"]);
  });
});
