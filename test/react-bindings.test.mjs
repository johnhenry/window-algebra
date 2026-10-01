import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createReactBindings } from "../src/bindings/react.mjs";
import { immediateScheduler } from "../src/browser/scheduler.mjs";
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
      return react.createElement(WindowManagerStage, { wm, schedule: immediateScheduler });
    };
    react.render(App, {}, { container: root });
    wm.create({ id: "a" });

    const stageHost = doc.body.querySelectorAll("[data-wm-root]")[0];
    assert.ok(stageHost, "stage mounted a data-wm-root host");
    assert.equal(stageHost.querySelectorAll("wm-view").length, 1);
  });

  test("chrome: true wraps every window in the built-in chrome, and a pop-out button switches popouts on", () => {
    const { doc, react, bindings, root } = stageSetup();
    const { useWindowManager, WindowManagerStage } = bindings;
    let wm;
    const App = () => {
      ({ wm } = useWindowManager());
      return react.createElement(WindowManagerStage, { wm, schedule: immediateScheduler, chrome: { buttons: ["popout", "close"] } });
    };
    react.render(App, {}, { container: root });
    wm.create({ id: "a", title: "A" });
    const host = doc.body.querySelectorAll("[data-wm-root]")[0];
    assert.equal(host.querySelectorAll("[data-wa-chrome]").length, 1);
    assert.equal(host.querySelector("[data-wa-chrome-title]").textContent, "A");
    assert.equal(host.querySelectorAll("[data-action]").length, 3);
  });

  test("stageRef (object or callback) and onStage receive the stage's handles, and null on unmount", () => {
    const { react, bindings, root } = stageSetup();
    const { useWindowManager, WindowManagerStage } = bindings;
    const seen = [];
    const objectRef = { current: undefined };
    let wm;
    const App = () => {
      ({ wm } = useWindowManager());
      return react.createElement(WindowManagerStage, {
        wm,
        schedule: immediateScheduler,
        palette: true,
        sync: false,
        stageRef: objectRef,
        onStage: (stage) => seen.push(stage),
      });
    };
    const handle = react.render(App, {}, { container: root });
    assert.equal(objectRef.current.wm, wm);
    assert.ok(objectRef.current.renderer);
    assert.equal(objectRef.current.sync, null);
    objectRef.current.palette.open();
    assert.equal(objectRef.current.palette.isOpen, true, "a button can open the palette through the ref");
    assert.equal(seen.length, 1);
    assert.equal(seen[0], objectRef.current);
    handle.unmount();
    assert.equal(objectRef.current, null);
    assert.equal(seen.at(-1), null);
  });

  test("a callback stageRef, and sync: true makes stage.sync.peers() reachable (a \"Tabs: 2\" indicator)", async () => {
    const { createBroadcastHub } = await import("./helpers/fake-broadcast.mjs");
    const hub = createBroadcastHub();
    const stages = {};
    const mount = (tab) => {
      const { react, bindings, root } = stageSetup();
      const { useWindowManager, WindowManagerStage } = bindings;
      const App = () => {
        const { wm } = useWindowManager();
        return react.createElement(WindowManagerStage, {
          wm,
          schedule: immediateScheduler,
          sync: { channel: new hub.BroadcastChannel("wa"), id: tab, schedule: immediateScheduler },
          stageRef: (value) => (stages[tab] = value),
        });
      };
      react.render(App, {}, { container: root });
    };
    mount("tab-a");
    mount("tab-b");
    hub.deliver();
    assert.deepEqual(stages["tab-a"].sync.peers(), ["tab-b"]);
    assert.deepEqual(stages["tab-b"].sync.peers(), ["tab-a"]);
  });

  test("detaches on unmount: later dispatches no longer touch that DOM", () => {
    const { doc, react, bindings, root } = stageSetup();
    const { useWindowManager, WindowManagerStage } = bindings;
    let wm;
    const App = () => {
      ({ wm } = useWindowManager());
      return react.createElement(WindowManagerStage, { wm, schedule: immediateScheduler });
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
        schedule: immediateScheduler,
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
      return react.createElement(WindowManagerStage, { wm, schedule: immediateScheduler });
    };
    react.render(App, {}, { container: root });
    wm.create({ id: "a" });
    const host = doc.body.querySelectorAll("[data-wm-root]")[0];
    assert.equal(host.querySelectorAll("[data-wa-portal]").length, 0);
    assert.equal(host.querySelectorAll("wm-view").length, 1);
  });
});

describe("createReactBindings: frame-coalesced commits by default (audit 15)", () => {
  test("WindowManagerStage commits once per frame unless given a schedule", () => {
    const frames = [];
    const saved = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (task) => frames.push(task);
    try {
      const { doc, react, bindings } = setup();
      const root = doc.createElement("div");
      doc.body.append(root);
      const { useWindowManager, WindowManagerStage } = bindings;
      let wm;
      const App = () => {
        ({ wm } = useWindowManager());
        return react.createElement(WindowManagerStage, { wm });
      };
      react.render(App, {}, { container: root });
      wm.create({ id: "a" });
      wm.create({ id: "b" });
      const host = doc.body.querySelectorAll("[data-wm-root]")[0];
      assert.equal(host.querySelectorAll("wm-view").length, 0);
      assert.equal(frames.length, 1);
      frames.shift()();
      assert.equal(host.querySelectorAll("wm-view").length, 2);
    } finally {
      globalThis.requestAnimationFrame = saved;
    }
  });
});
