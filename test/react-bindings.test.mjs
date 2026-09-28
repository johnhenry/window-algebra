import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createReactBindings } from "../src/bindings/react.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";
import { createFakeReact } from "./helpers/fake-react.mjs";

const setup = () => {
  const doc = createFakeDocument();
  const react = createFakeReact(doc);
  const bindings = createReactBindings(react);
  return { doc, react, bindings };
};

describe("createReactBindings: useWindowManager", () => {
  test("creates one window manager per component and re-renders on dispatch", async () => {
    const { react, bindings } = setup();
    const { useWindowManager } = bindings;
    const seen = [];
    let wmInstance;
    const App = () => {
      const { wm, state } = useWindowManager();
      wmInstance = wm;
      seen.push(Object.keys(state.windows).length);
      return null;
    };
    const handle = react.render(App, {});
    assert.equal(seen.length, 1);
    assert.equal(seen[0], 0);

    wmInstance.create({ id: "a" });
    await handle.flush();
    assert.deepEqual(seen, [0, 1]);

    // The manager instance itself must not change across re-renders.
    const first = wmInstance;
    wmInstance.create({ id: "b" });
    await handle.flush();
    assert.equal(wmInstance, first);
    assert.deepEqual(seen, [0, 1, 2]);
  });

  test("passes options through to createWindowManager (e.g. history)", () => {
    const { react, bindings } = setup();
    const { useWindowManager } = bindings;
    let wm;
    const App = () => {
      ({ wm } = useWindowManager({ history: true }));
      return null;
    };
    react.render(App, {});
    wm.create({ id: "a" });
    assert.equal(wm.canUndo, true);
    wm.undo();
    assert.equal(Object.keys(wm.getState().windows).length, 0);
  });
});

describe("createReactBindings: useWindowState", () => {
  test("returns the selected slice and updates it on dispatch", async () => {
    const { react, bindings } = setup();
    const { useWindowManager, useWindowState } = bindings;
    const counts = [];
    let wm;
    const App = () => {
      ({ wm } = useWindowManager());
      const count = useWindowState(wm, (state) => Object.keys(state.windows).length);
      counts.push(count);
      return null;
    };
    const handle = react.render(App, {});
    assert.deepEqual(counts, [0]);
    wm.create({ id: "a" });
    await handle.flush();
    assert.deepEqual(counts, [0, 1]);
    wm.create({ id: "b" });
    await handle.flush();
    assert.deepEqual(counts, [0, 1, 2]);
  });

  test("defaults to the whole state when no selector is given", async () => {
    const { react, bindings } = setup();
    const { useWindowManager, useWindowState } = bindings;
    let wm;
    let last;
    const App = () => {
      ({ wm } = useWindowManager());
      last = useWindowState(wm);
      return null;
    };
    const handle = react.render(App, {});
    wm.create({ id: "a" });
    await handle.flush();
    assert.ok(last.windows.a);
  });

  test("a selector rejecting a command still reports the (unchanged) state", async () => {
    const { react, bindings } = setup();
    const { useWindowManager, useWindowState } = bindings;
    const events = [];
    let wm;
    const App = () => {
      ({ wm } = useWindowManager());
      useWindowState(wm, (state) => Object.keys(state.windows).length);
      return null;
    };
    react.render(App, {});
    const unsubscribe = wm.subscribe((_state, evts) => events.push(...evts));
    const result = wm.dispatch({ type: "window/close", id: "missing" });
    assert.equal(result.events[0].type, "command/rejected");
    assert.deepEqual(events.map((e) => e.type), ["command/rejected"]);
    unsubscribe();
  });
});

describe("createReactBindings: WindowManagerStage", () => {
  const stageSetup = () => {
    const { doc, react, bindings } = setup();
    const root = doc.createElement("div");
    doc.body.append(root);
    return { doc, react, bindings, root };
  };

  test("mounts a renderer and input adapter into the host on mount", async () => {
    const { doc, react, bindings, root } = stageSetup();
    const { useWindowManager, WindowManagerStage } = bindings;
    let wm;
    const App = () => {
      ({ wm } = useWindowManager());
      return react.createElement(WindowManagerStage, { wm });
    };
    react.render(App, {}, { container: root });
    wm.create({ id: "a" });

    const stageHost = doc.body.querySelectorAll("[data-wm-root]")[0];
    assert.ok(stageHost, "stage mounted a data-wm-root host");
    assert.equal(stageHost.querySelectorAll("wm-view").length, 1);
  });

  test("detaches on unmount: later dispatches no longer touch that DOM", () => {
    const { doc, react, bindings, root } = stageSetup();
    const { useWindowManager, WindowManagerStage } = bindings;
    let wm;
    const App = () => {
      ({ wm } = useWindowManager());
      return react.createElement(WindowManagerStage, { wm });
    };
    const handle = react.render(App, {}, { container: root });
    wm.create({ id: "a" });
    const hostBefore = doc.body.querySelectorAll("[data-wm-root]")[0];
    assert.ok(hostBefore);
    assert.equal(hostBefore.querySelectorAll("wm-view").length, 1);

    handle.unmount();
    // Unmounting tears down what it rendered...
    assert.equal(hostBefore.querySelectorAll("wm-view").length, 0);
    wm.create({ id: "b" });
    // ...and the detached host is never told about the second window either.
    assert.equal(hostBefore.querySelectorAll("wm-view").length, 0);
  });

  test("renderSurface + createPortal mounts React-rendered content into each view", async () => {
    const { doc, react, bindings, root } = stageSetup();
    const { useWindowManager, WindowManagerStage } = bindings;
    let wm;
    const App = () => {
      ({ wm } = useWindowManager());
      return react.createElement(WindowManagerStage, {
        wm,
        renderSurface: (id) => react.createElement("section", { "data-surface": id }),
        createPortal: react.createPortal,
      });
    };
    const handle = react.render(App, {}, { container: root });
    wm.create({ id: "a" });
    // The portal container mounts synchronously (imperative DOM, inside the
    // renderer commit); the React-rendered content inside it lands on the
    // next microtask, same as any `useState`-driven re-render.
    await handle.flush();

    const host = doc.body.querySelectorAll("[data-wm-root]")[0];
    const portalContainer = host.querySelector('[data-wa-portal="a"]');
    assert.ok(portalContainer, "a portal container was mounted for view a");
    const surface = portalContainer.querySelector("section[data-surface]");
    assert.ok(surface, "the React-rendered surface landed inside the portal container");
    assert.equal(surface.getAttribute("data-surface"), "a");

    wm.close("a");
    assert.equal(host.querySelector('[data-wa-portal="a"]'), null);
  });

  test("without renderSurface/createPortal, views render with no surface (plain DOM chrome only)", () => {
    const { doc, react, bindings, root } = stageSetup();
    const { useWindowManager, WindowManagerStage } = bindings;
    let wm;
    const App = () => {
      ({ wm } = useWindowManager());
      return react.createElement(WindowManagerStage, { wm });
    };
    react.render(App, {}, { container: root });
    wm.create({ id: "a" });
    const host = doc.body.querySelectorAll("[data-wm-root]")[0];
    assert.equal(host.querySelectorAll("[data-wa-portal]").length, 0);
    assert.equal(host.querySelectorAll("wm-view").length, 1);
  });
});
