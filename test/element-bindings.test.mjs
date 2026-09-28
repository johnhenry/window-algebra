import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { attachStage, defineWindowAlgebraElement } from "../src/bindings/element.mjs";
import { createWindowManager } from "../src/manager.mjs";
import { createFakeDocument, FakeElement } from "./helpers/fake-dom.mjs";

describe("attachStage", () => {
  test("mounts a live renderer + input adapter onto a host element", () => {
    const doc = createFakeDocument();
    const host = doc.createElement("wa-stage");
    doc.body.append(host);

    const stage = attachStage(host);
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

  test("accepts a pre-built window manager instead of creating one", () => {
    const doc = createFakeDocument();
    const host = doc.createElement("wa-stage");
    doc.body.append(host);
    const wm = createWindowManager();
    wm.create({ id: "pre-existing" });

    const stage = attachStage(host, { wm });
    assert.equal(stage.wm, wm);
    assert.equal(host.querySelectorAll("wm-view").length, 1);
    stage.detach();
  });

  test("input is live: a command button click dispatches through the same wm", () => {
    const doc = createFakeDocument();
    const host = doc.createElement("wa-stage");
    doc.body.append(host);
    const stage = attachStage(host);
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
