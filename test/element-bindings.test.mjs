import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { attachStage, defineWindowAlgebraElement, defineCommandPaletteElement } from "../src/bindings/element.mjs";
import { createWindowManager } from "../src/manager.mjs";
import { immediateScheduler } from "../src/browser/scheduler.mjs";
import { createFakeDocument, FakeElement } from "./helpers/fake-dom.mjs";

describe("attachStage", () => {
  test("mounts a live renderer + input adapter onto a host element", () => {
    const doc = createFakeDocument();
    const host = doc.createElement("wa-stage");
    doc.body.append(host);

    const stage = attachStage(host, { schedule: immediateScheduler });
    assert.ok(stage.wm);
    assert.ok(host.hasAttribute("data-wm-root"));

    stage.wm.create({ id: "a" });
    assert.equal(host.querySelectorAll("wm-view").length, 1);

    stage.detach();
    // Detaching tears down what it rendered...
    assert.equal(host.querySelectorAll("wm-view").length, 0);
    stage.wm.create({ id: "b" });
    // ...and the renderer no longer receives further commits.
    assert.equal(host.querySelectorAll("wm-view").length, 0);
  });

  test("sync: true or options keep two stages' window managers in step; detach stops it", async () => {
    const { createBroadcastHub } = await import("./helpers/fake-broadcast.mjs");
    const hub = createBroadcastHub();
    const make = (id) => {
      const doc = createFakeDocument();
      const host = doc.createElement("wa-stage");
      doc.body.append(host);
      return attachStage(host, { schedule: immediateScheduler, sync: { channel: new hub.BroadcastChannel("wa"), id, schedule: immediateScheduler } });
    };
    const a = make("a");
    const b = make("b");
    hub.deliver();
    a.wm.create({ id: "shared" });
    hub.deliver();
    assert.ok(b.wm.getState().windows.shared);
    assert.equal(a.sync.id, "a");
    a.detach();
    b.detach();
    const doc = createFakeDocument();
    const host = doc.createElement("wa-stage");
    doc.body.append(host);
    assert.equal(attachStage(host, { schedule: immediateScheduler }).sync, null, "sync is off by default");
  });

  test("accepts a pre-built window manager instead of creating one", () => {
    const doc = createFakeDocument();
    const host = doc.createElement("wa-stage");
    doc.body.append(host);
    const wm = createWindowManager();
    wm.create({ id: "pre-existing" });

    const stage = attachStage(host, { wm, schedule: immediateScheduler });
    assert.equal(stage.wm, wm);
    assert.equal(host.querySelectorAll("wm-view").length, 1);
    stage.detach();
  });

  test("input is live: a command button click dispatches through the same wm", () => {
    const doc = createFakeDocument();
    const host = doc.createElement("wa-stage");
    doc.body.append(host);
    const stage = attachStage(host, { schedule: immediateScheduler });
    stage.wm.create({ id: "a" });

    const closer = doc.createElement("button");
    closer.setAttribute("data-wm-command", "window/close");
    host.querySelectorAll("wm-view")[0].append(closer);
    host.dispatch("click", { target: closer });
    assert.equal(host.querySelectorAll("wm-view").length, 0);
    stage.detach();
  });

  test("forwards surfaceFor and input options", () => {
    const doc = createFakeDocument();
    const host = doc.createElement("wa-stage");
    doc.body.append(host);
    const mounts = [];
    const content = doc.createElement("section");
    const stage = attachStage(host, {
      schedule: immediateScheduler,
      surfaceFor: (id) => ({
        mount(target) {
          mounts.push(["mount", id]);
          target.append(content);
        },
        unmount() {
          mounts.push(["unmount", id]);
          content.remove();
        },
      }),
      input: { threshold: 1 },
    });
    stage.wm.create({ id: "a" });
    assert.deepEqual(mounts, [["mount", "a"]]);
    assert.equal(content.parentNode, host.querySelectorAll("wm-view")[0]);
    stage.detach();
  });
});

describe("defineWindowAlgebraElement", () => {
  test("throws without a customElements registry / HTMLElement (outside a browser)", () => {
    assert.throws(() => defineWindowAlgebraElement("wa-stage", { customElements: undefined, HTMLElement: undefined }));
  });

  test("registers the class under the given name, once", () => {
    const registry = {
      defs: new Map(),
      define(name, ctor) {
        this.defs.set(name, ctor);
      },
      get(name) {
        return this.defs.get(name);
      },
    };
    class FakeHTMLElement {}
    const Ctor = defineWindowAlgebraElement("wa-test-1", { customElements: registry, HTMLElement: FakeHTMLElement });
    assert.equal(registry.get("wa-test-1"), Ctor);
    // A second call for the same name does not re-register a new class.
    const again = defineWindowAlgebraElement("wa-test-1", { customElements: registry, HTMLElement: FakeHTMLElement });
    assert.equal(again, Ctor);
    assert.equal(registry.get("wa-test-1"), Ctor);
  });

  test("connectedCallback/disconnectedCallback drive the wm lifecycle; .wm reflects it", () => {
    const doc = createFakeDocument();
    const registry = {
      defs: new Map(),
      define(name, ctor) {
        this.defs.set(name, ctor);
      },
      get(name) {
        return this.defs.get(name);
      },
    };
    // A fake HTMLElement base that is still a real (fake) DOM element, so
    // the stage machinery (renderer + input) has what it needs.
    class FakeHTMLElement extends FakeElement {
      constructor() {
        super("wa-stage", doc);
      }
    }
    const Ctor = defineWindowAlgebraElement("wa-stage-2", { customElements: registry, HTMLElement: FakeHTMLElement });

    const el = new Ctor();
    doc.body.append(el);
    assert.equal(el.wm, null);

    el.configure({ schedule: immediateScheduler });
    el.connectedCallback();
    assert.ok(el.wm);
    el.wm.create({ id: "a" });
    assert.equal(el.querySelectorAll("wm-view").length, 1);

    el.disconnectedCallback();
    assert.equal(el.wm, null);
  });

  test(".configure() sets options up front and re-attaches live if already connected", () => {
    const doc = createFakeDocument();
    const registry = {
      defs: new Map(),
      define(name, ctor) {
        this.defs.set(name, ctor);
      },
      get(name) {
        return this.defs.get(name);
      },
    };
    class FakeHTMLElement extends FakeElement {
      constructor() {
        super("wa-stage", doc);
      }
    }
    const Ctor = defineWindowAlgebraElement("wa-stage-3", { customElements: registry, HTMLElement: FakeHTMLElement });

    const preexisting = createWindowManager();
    preexisting.create({ id: "from-outside" });

    const el = new Ctor();
    doc.body.append(el);
    el.configure({ wm: preexisting });
    el.connectedCallback();
    assert.equal(el.wm, preexisting);
    assert.equal(el.querySelectorAll("wm-view").length, 1);

    // Reconfiguring while connected re-attaches immediately with the new options.
    const other = createWindowManager();
    other.create({ id: "x" });
    other.create({ id: "y" });
    el.configure({ wm: other });
    assert.equal(el.wm, other);
    assert.equal(el.querySelectorAll("wm-view").length, 2);

    el.disconnectedCallback();
  });
});

describe("command palette bindings", () => {
  const registryFor = () => ({
    defs: new Map(),
    define(name, ctor) {
      this.defs.set(name, ctor);
    },
    get(name) {
      return this.defs.get(name);
    },
  });
  const press = (doc) => doc.dispatch("keydown", { key: "P", ctrlKey: true, shiftKey: true, preventDefault() {}, stopPropagation() {} });

  test("attachStage({ palette: true }) opens a palette on Ctrl+Shift+P for the stage's manager; detach removes it", () => {
    const doc = createFakeDocument();
    const host = doc.createElement("wa-stage");
    doc.body.append(host);
    const stage = attachStage(host, { schedule: immediateScheduler, palette: true });
    assert.ok(stage.palette);
    press(doc);
    assert.equal(stage.palette.isOpen, true);
    assert.ok(doc.body.querySelector("[data-wm-palette]"));
    stage.palette.close();
    stage.detach();
    assert.equal(doc.body.querySelector("[data-wm-palette]"), null);
    const plain = attachStage(host, { schedule: immediateScheduler });
    assert.equal(plain.palette, null, "off by default");
    const custom = attachStage(host, { schedule: immediateScheduler, palette: { shortcut: "Ctrl+K" } });
    press(doc);
    assert.equal(custom.palette.isOpen, false);
    custom.detach();
    plain.detach();
  });

  test("<wa-palette>: configure({ wm }) mounts a palette while connected; open/close/toggle; wm setter", () => {
    const doc = createFakeDocument();
    const registry = registryFor();
    class FakeHTMLElement extends FakeElement {
      constructor() {
        super("wa-palette", doc);
      }
    }
    const Ctor = defineCommandPaletteElement("wa-palette", { customElements: registry, HTMLElement: FakeHTMLElement });
    assert.equal(defineCommandPaletteElement("wa-palette", { customElements: registry, HTMLElement: FakeHTMLElement }), Ctor, "idempotent");
    const el = new Ctor();
    doc.body.append(el);
    el.connectedCallback();
    el.open();
    assert.equal(el.isOpen, false, "no manager yet: nothing to open");
    const wm = createWindowManager();
    wm.create({ id: "a", title: "Alpha" });
    el.wm = wm;
    assert.equal(el.wm, wm);
    el.open();
    assert.equal(el.isOpen, true);
    assert.ok(doc.body.querySelector("[data-wm-palette]"));
    el.close();
    el.toggle();
    assert.equal(el.isOpen, true);
    press(doc);
    assert.equal(el.isOpen, false, "the shortcut works too");
    el.configure({ wm, shortcut: false });
    press(doc);
    assert.equal(el.isOpen, false);
    el.disconnectedCallback();
    assert.equal(doc.body.querySelector("[data-wm-palette]"), null);
    assert.throws(() => defineCommandPaletteElement("x-y", { customElements: null, HTMLElement: null }), /no customElements/);
  });
});

describe("attachStage: frame-coalesced commits by default (audit 15)", () => {
  const withFrames = (fn) => {
    const frames = [];
    const saved = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (task) => frames.push(task);
    try {
      return fn(frames);
    } finally {
      globalThis.requestAnimationFrame = saved;
    }
  };

  test("many commands in a frame make one DOM commit; the view appears on the next frame", () => {
    withFrames((frames) => {
      const doc = createFakeDocument();
      const host = doc.createElement("wa-stage");
      doc.body.append(host);
      const stage = attachStage(host);
      let commits = 0;
      const commit = stage.renderer.commit;
      stage.renderer.commit = (...args) => (commits++, commit(...args));
      stage.wm.create({ id: "a" });
      stage.wm.create({ id: "b" });
      stage.wm.create({ id: "c" });
      assert.equal(host.querySelectorAll("wm-view").length, 0, "nothing committed yet");
      assert.equal(frames.length, 1, "one frame requested for three commands");
      frames.shift()();
      assert.equal(commits, 1);
      assert.equal(host.querySelectorAll("wm-view").length, 3);
      stage.detach();
    });
  });

  test("a commit still queued when the stage detaches is dropped", () => {
    withFrames((frames) => {
      const doc = createFakeDocument();
      const host = doc.createElement("wa-stage");
      doc.body.append(host);
      const stage = attachStage(host);
      stage.wm.create({ id: "a" });
      stage.detach();
      assert.doesNotThrow(() => frames.shift()());
      assert.equal(host.querySelectorAll("wm-view").length, 0);
    });
  });
});
