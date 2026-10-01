import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createWindowManager, createState, compile, derive, presentationContext, update, BASE_CSS, RULES_CSS, CHROME_CSS, THEME_TOKENS } from "../src/index.mjs";
import {
  createDomRenderer,
  attachInput,
  attachPopouts,
  chromeSurface,
  buildChrome,
  setChromeTitle,
  CHROME_BUTTONS,
  DEFAULT_CHROME_BUTTONS,
  createSurfaceRegistry,
} from "../src/browser/index.mjs";
import { attachStage } from "../src/bindings/element.mjs";
import { immediateScheduler } from "../src/browser/scheduler.mjs";
import { createFakeDocument, createFakeWindow } from "./helpers/fake-dom.mjs";

const setup = ({ chrome = true, surfaces = {}, windows = ["a", "b"], state } = {}) => {
  const doc = createFakeDocument();
  const root = doc.createElement("div");
  doc.body.append(root);
  const registry = createSurfaceRegistry(surfaces);
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false, chrome, surfaceFor: registry });
  const wm = createWindowManager({ renderer, ...(state ? { state } : {}) });
  for (const id of windows) wm.create({ id, title: id.toUpperCase() });
  return { doc, root, renderer, wm, registry };
};

const actions = (el) => el.querySelectorAll("[data-action]").map((b) => b.getAttribute("data-action"));
const view = (root, id) => root.querySelector(`wm-view[data-view="${id}"]`);

describe("window chrome: the renderer option", () => {
  test("off by default: a view holds only what its surface mounts", () => {
    const { root } = setup({ chrome: false });
    assert.equal(root.querySelectorAll("[data-wa-chrome]").length, 0);
  });

  test("chrome: true wraps every window: a drag-handle bar, a body, eight grips, the default buttons", () => {
    const { root } = setup();
    const a = view(root, "a");
    const frame = a.querySelector("[data-wa-chrome]");
    assert.ok(frame);
    const bar = a.querySelector('[data-wm-handle="move"]');
    assert.ok(bar, "the title bar is the move handle");
    assert.equal(bar.getAttribute("data-wm-dblclick"), "window/toggle-maximize");
    assert.deepEqual(a.querySelectorAll("[data-wm-handle]").map((h) => h.getAttribute("data-wm-handle")).slice(1).sort(), ["resize-e", "resize-n", "resize-ne", "resize-nw", "resize-s", "resize-se", "resize-sw", "resize-w"]);
    assert.ok(a.querySelector("[data-wa-chrome-body]"));
    // two elements for a toggle (one is hidden by CSS), one for the rest
    assert.deepEqual(actions(a), ["minimize", "maximize", "restore", "float", "dock", "close"]);
    assert.deepEqual(DEFAULT_CHROME_BUTTONS, ["minimize", "maximize", "float", "close"]);
  });

  test("every button is a real <button type=button> with a data-wm-command and an accessible name that includes the title", () => {
    const { root } = setup();
    for (const button of view(root, "b").querySelectorAll("[data-action]")) {
      assert.equal(button.localName, "button");
      assert.equal(button.getAttribute("type"), "button");
      assert.ok(button.getAttribute("data-wm-command").startsWith("window/"));
      assert.match(button.getAttribute("aria-label"), /^.+ window: B$/, button.getAttribute("data-action"));
    }
    const commands = Object.fromEntries(view(root, "b").querySelectorAll("[data-action]").map((b) => [b.getAttribute("data-action"), b.getAttribute("data-wm-command")]));
    assert.deepEqual(commands, { minimize: "window/minimize", maximize: "window/maximize", restore: "window/restore", float: "window/toggle-floating", dock: "window/toggle-floating", close: "window/close" });
  });

  test("the surface mounts into the body, not the view, and unmounts with the window", () => {
    const log = [];
    const { doc, root, wm } = setup({
      windows: [],
      surfaces: {
        a: { mount: (target) => (log.push(["mount", target.getAttribute("data-wa-chrome-body")]), target.append(Object.assign(doc0(), {}))), unmount: () => log.push(["unmount"]) },
      },
    });
    function doc0() {
      return doc.createElement("section");
    }
    wm.create({ id: "a" });
    assert.deepEqual(log, [["mount", ""]]);
    assert.ok(view(root, "a").querySelector("[data-wa-chrome-body]").querySelector("section"));
    wm.close("a");
    assert.deepEqual(log, [["mount", ""], ["unmount"]]);
    assert.equal(root.querySelectorAll("[data-wa-chrome]").length, 0);
  });

  test("the title follows state on every commit, and so do the buttons' names; an untitled window shows its id", () => {
    const { root, wm } = setup();
    wm.setTitle?.("a", "Renamed") ?? wm.dispatch({ type: "window/set-title", id: "a", title: "Renamed" });
    const a = view(root, "a");
    assert.equal(a.querySelector("[data-wa-chrome-title]").textContent, "Renamed");
    assert.equal(a.querySelector('[data-action="close"]').getAttribute("aria-label"), "Close window: Renamed");
    wm.create({ id: "plain" });
    assert.equal(view(root, "plain").querySelector("[data-wa-chrome-title]").textContent, "plain");
  });

  test("buttons: pick and order them; a function decides per window; an unknown name throws", () => {
    const { root } = setup({ chrome: { buttons: ["close", "popout"] } });
    assert.deepEqual(actions(view(root, "a")), ["close", "popout", "popin"]);
    const perWindow = setup({ chrome: { buttons: (id) => (id === "a" ? ["close"] : []) } });
    assert.deepEqual(actions(view(perWindow.root, "a")), ["close"]);
    assert.deepEqual(actions(view(perWindow.root, "b")), []);
    assert.deepEqual(CHROME_BUTTONS, ["minimize", "maximize", "float", "popout", "close"]);
    assert.throws(() => setup({ chrome: { buttons: ["explode"] } }), /unknown button "explode"/);
  });

  test("for(id) === false leaves a window bare (its surface mounts straight into the view); icon, icons and labels apply", () => {
    const mounted = [];
    const { doc, root } = setup({
      chrome: {
        for: (id) => id !== "tip",
        icon: (id) => `#${id}`,
        icons: { close: "X" },
        labels: { close: "Schliessen", actions: "Fenster" },
      },
      windows: ["a", "tip"],
      surfaces: { tip: { mount: (target) => mounted.push(target.localName) } },
    });
    assert.equal(view(root, "tip").querySelectorAll("[data-wa-chrome]").length, 0);
    assert.deepEqual(mounted, ["wm-view"]);
    const a = view(root, "a");
    assert.equal(a.querySelector("[data-wa-chrome-icon]").textContent, "#a");
    assert.equal(a.querySelector('[data-action="close"]').textContent, "X");
    assert.equal(a.querySelector('[data-action="close"]').getAttribute("aria-label"), "Schliessen: A");
    assert.equal(a.querySelector('[role="group"]').getAttribute("aria-label"), "Fenster");
    assert.ok(doc);
  });

  test("a window in a tab strip gets no title bar (its tab is its title), and gets it back when the layout changes", () => {
    const { root, wm } = setup({ windows: ["a", "b", "c"] });
    wm.setLayout({ type: "tabs" });
    const hidden = (id) => view(root, id).querySelector('[data-wm-handle="move"]').hasAttribute("hidden");
    assert.deepEqual(["a", "b", "c"].map(hidden), [true, true, true]);
    wm.setLayout({ type: "columns" });
    assert.deepEqual(["a", "b", "c"].map(hidden), [false, false, false]);
  });

  test("bodyFor(id) is the chrome body (the view itself without chrome)", () => {
    const withChrome = setup();
    assert.equal(withChrome.renderer.bodyFor("a"), view(withChrome.root, "a").querySelector("[data-wa-chrome-body]"));
    const without = setup({ chrome: false });
    assert.equal(without.renderer.bodyFor("a"), without.renderer.elementFor("a"));
    assert.equal(without.renderer.bodyFor("nope"), undefined);
  });

  test("a scrolling body is a labelled, focusable region; one that fits is not a tab stop", () => {
    const { root, renderer, wm } = setup();
    const body = renderer.bodyFor("a");
    body.scrollHeight = 500;
    body.clientHeight = 100;
    renderer.commit(wm.present().render);
    assert.equal(body.getAttribute("tabindex"), "0");
    assert.equal(body.getAttribute("role"), "region");
    assert.equal(body.getAttribute("aria-labelledby"), view(root, "a").querySelector("[data-wa-chrome-title]").getAttribute("id"));
    body.scrollHeight = 50;
    renderer.commit(wm.present().render);
    assert.equal(body.hasAttribute("tabindex"), false);
    assert.equal(body.hasAttribute("role"), false);
  });

  test("destroy removes the chrome with the views", () => {
    const { root, renderer } = setup();
    renderer.destroy();
    assert.equal(root.querySelectorAll("[data-wa-chrome]").length, 0);
  });
});

describe("window chrome: input", () => {
  const stage = (options = {}) => {
    const doc = createFakeDocument();
    const host = doc.createElement("div");
    doc.body.append(host);
    const s = attachStage(host, { schedule: immediateScheduler, chrome: true, ...options });
    s.wm.create({ id: "a", title: "A" });
    return { doc, host, s, a: view(host, "a") };
  };
  const click = (host, target) => host.dispatch("click", { target });
  const dblclick = (host, target) => host.dispatch("dblclick", { target, preventDefault() {} });

  test("clicking a chrome button runs its command on that window", () => {
    const { host, s, a } = stage();
    click(host, a.querySelector('[data-action="float"]'));
    assert.equal(s.wm.getState().windows.a.mode, "floating");
    click(host, a.querySelector('[data-action="maximize"]'));
    assert.equal(s.wm.getState().windows.a.status, "maximized");
    assert.equal(view(host, "a").getAttribute("data-status"), "maximized", "compile marks the status for the CSS");
    click(host, view(host, "a").querySelector('[data-action="restore"]'));
    assert.equal(s.wm.getState().windows.a.status, "normal");
    assert.equal(view(host, "a").hasAttribute("data-status"), false);
    click(host, a.querySelector('[data-action="close"]'));
    assert.equal(s.wm.getState().windows.a, undefined);
  });

  test("pressing a toggle hides it: focus moves to the button that took its place, once the change has rendered", () => {
    const { doc, host, s } = stage();
    const frames = [];
    doc.defaultView.requestAnimationFrame = (fn) => frames.push(fn);
    const run = () => {
      while (frames.length) frames.shift()();
    };
    s.wm.dispatch({ type: "window/set-mode", id: "a", mode: "floating" });
    const bar = view(host, "a");
    const maximize = bar.querySelector('[data-action="maximize"]');
    const restore = bar.querySelector('[data-action="restore"]');
    maximize.focus();
    maximize.getClientRects = () => []; // CSS hid it
    bar.querySelector("[role=group]").dispatch("click", { target: maximize });
    assert.notEqual(doc.activeElement, restore, "not before the next frames");
    run();
    assert.equal(doc.activeElement, restore);
    // a button that stays visible keeps focus
    const minimize = bar.querySelector('[data-action="minimize"]');
    minimize.focus();
    bar.querySelector("[role=group]").dispatch("click", { target: minimize });
    run();
    assert.equal(doc.activeElement, minimize);
  });

  test("double-click on the title bar toggles maximize; on a button inside it, it does not", () => {
    const { host, s, a } = stage();
    const bar = a.querySelector('[data-wm-handle="move"]');
    dblclick(host, bar);
    assert.equal(s.wm.getState().windows.a.status, "maximized");
    dblclick(host, view(host, "a").querySelector('[data-wa-chrome-title]'));
    assert.equal(s.wm.getState().windows.a.status, "normal", "the title text counts as the bar");
    dblclick(host, a.querySelector('[data-action="close"]'));
    assert.ok(s.wm.getState().windows.a, "a button keeps its own click");
    assert.equal(s.wm.getState().windows.a.status, "normal");
  });

  test("double-click is ignored on a window a modal blocks", () => {
    const { host, s, a } = stage();
    s.wm.create({ id: "m", modal: true, parent: "a" });
    dblclick(host, a.querySelector('[data-wm-handle="move"]'));
    assert.equal(s.wm.getState().windows.a.status, "normal");
  });

  test("a press on a chrome button inside the bar does not start a move gesture (the INTERACTIVE rule)", () => {
    const { host, s, a } = stage();
    s.wm.dispatch({ type: "window/set-mode", id: "a", mode: "floating" });
    const close = view(host, "a").querySelector('[data-action="close"]');
    let prevented = false;
    host.dispatch("pointerdown", { target: close, clientX: 5, clientY: 5, pointerId: 1, button: 0, preventDefault: () => (prevented = true) });
    assert.equal(prevented, false);
    assert.ok(a);
  });

  test("resize grips drive a floating window's resize", () => {
    const { host, s } = stage();
    s.wm.dispatch({ type: "window/set-mode", id: "a", mode: "floating" });
    const before = { ...s.wm.getState().windows.a.placement };
    const grip = view(host, "a").querySelector('[data-wm-handle="resize-se"]');
    const ev = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {} });
    host.dispatch("pointerdown", { target: grip, ...ev(100, 100) });
    host.ownerDocument.dispatch("pointermove", ev(140, 130));
    host.ownerDocument.dispatch("pointerup", ev(140, 130));
    const after = s.wm.getState().windows.a.placement;
    assert.ok(after.width > before.width && after.height > before.height, JSON.stringify([before, after]));
  });

  test("the pop-out button opens a real window through attachPopouts, and the pop-in button brings it back", () => {
    const popup = createFakeWindow();
    const { host, s } = stage({ chrome: { buttons: ["popout", "close"] }, popouts: { open: () => popup } });
    assert.ok(s.popouts, "a popout button switches popouts on by itself");
    const a = view(host, "a");
    click(host, a.querySelector('[data-action="popout"]'));
    assert.equal(s.wm.getState().windows.a.status, "popped-out");
    assert.equal(s.popouts.isPoppedOut("a"), true);
    const el = popup.document.body.querySelector('wm-view[data-view="a"]');
    assert.ok(el, "the window's DOM, chrome included, moved into the popup");
    assert.equal(el.getAttribute("data-status"), "popped-out", "the popup chrome shows pop-in and hides the layout buttons (CSS)");
    s.wm.dispatch({ type: "window/set-title", id: "a", title: "Moved" });
    assert.equal(el.querySelector("[data-wa-chrome-title]").textContent, "Moved", "the title keeps following in the popup");
    popup.document.dispatch("click", { target: el.querySelector('[data-action="popin"]') });
    assert.equal(s.wm.getState().windows.a.status, "normal");
    assert.equal(s.popouts.isPoppedOut("a"), false);
    const back = view(host, "a");
    assert.ok(back);
    assert.equal(back.hasAttribute("data-status"), false);
    assert.ok(back.querySelector("[data-wa-chrome]"), "the chrome came back with the window");
  });

  test("without popouts, a pop-out command button is just the command (the bare dispatch is unchanged)", () => {
    const doc = createFakeDocument();
    const host = doc.createElement("div");
    doc.body.append(host);
    const wm = createWindowManager();
    const renderer = createDomRenderer({ root: host, document: doc, anchorFallback: false, chrome: { buttons: ["popout"] } });
    wm.create({ id: "a" });
    renderer.commit(wm.present().render);
    attachInput({ root: host, wm });
    click(host, host.querySelector('[data-action="popout"]'));
    assert.equal(wm.getState().windows.a.status, "popped-out");
  });
});

describe("chromeSurface (for a custom renderer)", () => {
  test("wraps a body function in chrome, runs its cleanup on unmount, and follows the title when given wm", () => {
    const doc = createFakeDocument();
    const target = doc.createElement("wm-view");
    doc.body.append(target);
    const wm = createWindowManager();
    wm.create({ id: "a", title: "First" });
    const cleaned = [];
    const surface = chromeSurface({ id: "a", title: "First", wm, body: (el) => (el.textContent = "hello", () => cleaned.push("cleanup")) });
    surface.mount(target);
    assert.equal(target.querySelector("[data-wa-chrome-body]").textContent, "hello");
    assert.equal(target.querySelector("[data-wa-chrome-title]").textContent, "First");
    wm.dispatch({ type: "window/set-title", id: "a", title: "Second" });
    assert.equal(target.querySelector("[data-wa-chrome-title]").textContent, "Second");
    assert.equal(target.querySelector('[data-action="close"]').getAttribute("aria-label"), "Close window: Second");
    surface.unmount();
    assert.deepEqual(cleaned, ["cleanup"]);
    assert.equal(target.querySelectorAll("[data-wa-chrome]").length, 0);
    wm.dispatch({ type: "window/set-title", id: "a", title: "Third" });
  });

  test("wraps another surface too", () => {
    const doc = createFakeDocument();
    const target = doc.createElement("wm-view");
    doc.body.append(target);
    const log = [];
    const inner = { mount: (el) => log.push(["mount", el.hasAttribute("data-wa-chrome-body")]), unmount: () => log.push(["unmount"]) };
    const surface = chromeSurface({ id: "a", body: inner, buttons: ["close"] });
    surface.mount(target);
    surface.unmount();
    assert.deepEqual(log, [["mount", true], ["unmount"]]);
  });

  test("buildChrome and setChromeTitle are the pieces: any element holding chrome can be retitled", () => {
    const doc = createFakeDocument();
    const handle = buildChrome(doc, { id: "x y", title: "T" });
    assert.match(handle.titleId, /^wa-chrome-\d+-x-y-title$/, "ids are CSS-safe and unique");
    const holder = doc.createElement("div");
    holder.append(handle.frame);
    setChromeTitle(holder, "U");
    assert.equal(handle.frame.querySelector("[data-wa-chrome-title]").textContent, "U");
    setChromeTitle(doc.createElement("div"), "no chrome here is a no-op");
  });
});

describe("window chrome: the stylesheet and the tokens", () => {
  test("CHROME_CSS is part of RULES_CSS and BASE_CSS, and reads only defined tokens", () => {
    assert.ok(RULES_CSS.includes(CHROME_CSS));
    assert.ok(BASE_CSS.includes(CHROME_CSS));
    const used = [...CHROME_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);
    assert.ok(used.length > 20);
    for (const name of used) assert.ok(name in THEME_TOKENS, name);
    for (const name of ["--wa-chrome-bar-height", "--wa-chrome-button-size", "--wa-chrome-touch-target", "--wa-chrome-grip-size", "--wa-chrome-grip-touch"]) assert.ok(name in THEME_TOKENS, name);
  });

  test("it is RTL-aware: the bar and buttons use logical properties; only the physical-edge grips use left/right", () => {
    const withoutGrips = CHROME_CSS.split("\n").filter((line) => !line.includes("wa-chrome-grip")).join("\n");
    assert.doesNotMatch(withoutGrips, /(^|[^-])(margin|padding|border)-(left|right)\b|(^|[\s;{])(left|right):/m);
    assert.match(CHROME_CSS, /padding-inline/);
  });

  test("it is touch-friendly: coarse pointers get bigger targets and thicker grips; the handles stop browser panning", () => {
    assert.match(CHROME_CSS, /@media \(pointer: coarse\)[\s\S]*--wa-chrome-touch-target[\s\S]*--wa-chrome-grip-touch/);
    assert.match(CHROME_CSS, /\.wa-chrome-bar \{[^}]*touch-action: none/);
    assert.match(CHROME_CSS, /\.wa-chrome-grip \{[^}]*touch-action: none/);
  });

  test("compile marks a non-normal status on the view (data-status), and nothing for a normal window", () => {
    let state = createState();
    for (const id of ["a", "b"]) state = update(state, { type: "window/create", id }).state;
    state = update(state, { type: "window/maximize", id: "a" }).state;
    const tree = compile(derive(state), presentationContext(state));
    const attrs = {};
    const visit = (node) => (node.view !== undefined ? (attrs[node.view] = node.attrs) : node.children.forEach(visit));
    visit(tree);
    assert.equal(attrs.a["data-status"], "maximized");
    assert.equal("data-status" in attrs.b, false);
  });
});
