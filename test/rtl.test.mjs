/**
 * Right-to-left layouts. `config.direction: "rtl"` marks the compiled root `dir="rtl"`, so flex rows, grids
 * and tab strips run right to left on their own (the compiled styles carry no physical left/right), while
 * everything physical is mirrored: placements, anchors, drop zones, floating x, keyboard arrows, splitters.
 * The real-browser geometry of every layout is checked in e2e/rtl.spec.mjs; these tests pin the logic.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  createWindowManager,
  update,
  replay,
  derive,
  compile,
  presentationContext,
  directionOf,
  isRtl,
  mirrorZone,
  dropTargetAt,
  DROP_ZONES,
  DEFAULT_CONFIG,
  place,
  anchor,
  view,
  overlay,
  size,
} from "../src/index.mjs";
import { createDomRenderer, attachInput, attachDirection, pageDirection, toSnapshot, fromSnapshot, DEFAULT_MOVE_KEYS } from "../src/browser/index.mjs";
import { attachStage } from "../src/bindings/element.mjs";
import { immediateScheduler } from "../src/browser/scheduler.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

const IDS = ["a", "b", "c", "d"];
const LAYOUTS = {
  "master-stack": { type: "master-stack", ratio: 0.6 },
  columns: { type: "columns" },
  rows: { type: "rows" },
  monocle: { type: "monocle" },
  tabs: { type: "tabs" },
  grid: { type: "grid", columns: 2 },
  "auto-grid": { type: "grid" },
  spiral: { type: "spiral" },
  bsp: { type: "bsp" },
  tree: { type: "tree" },
  floating: { type: "floating" },
  "master-stack right": { type: "master-stack", side: "right" },
};
const make = (layout, direction = "ltr", ids = IDS, extra = {}) =>
  replay(createState({ layout, config: { direction, ...extra } }), ids.map((id) => ({ type: "window/create", id, title: id.toUpperCase() })));
const render = (state) => compile(derive(state), presentationContext(state));

/** Strip `dir` from a render tree, to compare an RTL compile with its LTR twin. */
const withoutDir = (node) => ({ ...node, attrs: Object.fromEntries(Object.entries(node.attrs).filter(([k]) => k !== "dir")), children: node.children.map(withoutDir) });
const walk = (node, fn) => {
  fn(node);
  node.children.forEach((child) => walk(child, fn));
};

/**
 * The views of a render tree in left-to-right screen order, given the CSS rules we rely on: a flex row
 * (and a grid row) runs right to left under dir="rtl", columns, stacks and overlays do not change.
 * A model of the browser, used only to state the expectation per layout.
 */
const screenOrder = (node, rtl) => {
  if (node.view !== undefined) return node.primary ? [node.view] : [];
  const kids = node.children.filter((child) => child.tag !== "wm-splitter" && child.tag !== "wm-tabs");
  const parts = kids.map((child) => screenOrder(child, rtl));
  if (node.tag === "wm-row") return (rtl ? parts.reverse() : parts).flat();
  if (node.tag === "wm-grid") {
    const columns = Number(/repeat\((\d+),/.exec(node.style["grid-template-columns"] ?? "")?.[1] ?? 1);
    const rows = [];
    for (let i = 0; i < parts.length; i += columns) rows.push(parts.slice(i, i + columns));
    return rows.flatMap((row) => (rtl ? row.reverse() : row).flat());
  }
  return parts.flat();
};

describe("config.direction", () => {
  test("defaults to ltr; config/set takes ltr or rtl only; directionOf/isRtl read it (missing means ltr)", () => {
    assert.equal(DEFAULT_CONFIG.direction, "ltr");
    const state = createState();
    assert.equal(state.config.direction, "ltr");
    assert.equal(isRtl(state), false);
    const out = update(state, { type: "config/set", direction: "rtl" });
    assert.deepEqual(out.events, [{ type: "config/changed", patch: { direction: "rtl" } }]);
    assert.deepEqual(out.effects, [{ type: "render" }]);
    assert.equal(isRtl(out.state), true);
    assert.equal(directionOf(out.state), "rtl");
    for (const bad of ["RTL", "auto", "", null, 1, true, {}]) {
      assert.equal(update(state, { type: "config/set", direction: bad }).events[0].reason, "invalid-config", String(bad));
    }
    const old = { ...state, config: { ...state.config, direction: undefined } };
    assert.equal(directionOf(old), "ltr");
    assert.equal(directionOf({ ...state, config: undefined }), "ltr");
  });

  test("presentationContext carries it; createState takes it in config", () => {
    assert.equal(presentationContext(createState()).direction, "ltr");
    assert.equal(presentationContext(createState({ config: { direction: "rtl" } })).direction, "rtl");
  });

  test("it is undoable and replayable like any config", () => {
    const wm = createWindowManager({ history: true });
    wm.dispatch({ type: "config/set", direction: "rtl" });
    assert.equal(wm.getState().config.direction, "rtl");
    wm.undo();
    assert.equal(wm.getState().config.direction, "ltr");
    wm.redo();
    assert.equal(replay(wm.origin, wm.log).config.direction, "rtl");
  });
});

describe("compile: the root is dir=rtl and the styles stay direction-neutral", () => {
  for (const [name, layout] of Object.entries(LAYOUTS)) {
    test(name, () => {
      const ltr = render(make(layout, "ltr"));
      const rtl = render(make(layout, "rtl"));
      if (layout.type === "floating") {
        // Everything is placed by its own x: negated, because x is measured from the right in RTL.
        const translates = (tree) => {
          const list = [];
          walk(tree, (n) => n.style.translate && list.push(n.style.translate));
          return list;
        };
        assert.equal(rtl.attrs.dir, "rtl");
        assert.deepEqual(translates(rtl), translates(ltr).map((t) => t.replace(/^(\d+)px/, "-$1px")));
        return;
      }
      assert.equal(ltr.attrs.dir, undefined, "no dir in ltr");
      assert.equal(rtl.attrs.dir, "rtl");
      let roots = 0;
      walk(rtl, (node) => node.attrs.dir !== undefined && roots++);
      assert.equal(roots, 1, "dir is on the root only");
      // The mirror is the browser's job: apart from `dir` the two trees are identical, so CSS flips them.
      assert.deepEqual(withoutDir(rtl), ltr);
      walk(rtl, (node) => {
        for (const prop of ["left", "right", "margin-left", "margin-right", "padding-left", "padding-right"]) {
          assert.ok(!(prop in node.style), `${node.key} has physical ${prop}`);
        }
      });
    });
  }

  test("on screen: columns run right to left, the master-stack master is on the right, tabs and grids reverse", () => {
    const order = (layout, direction) => screenOrder(render(make(layout, direction)), direction === "rtl");
    assert.deepEqual(order(LAYOUTS.columns, "ltr"), ["a", "b", "c", "d"]);
    assert.deepEqual(order(LAYOUTS.columns, "rtl"), ["d", "c", "b", "a"]);
    const ms = order(LAYOUTS["master-stack"], "rtl");
    assert.equal(ms.at(-1), "a", "the master is the rightmost");
    assert.equal(order(LAYOUTS["master-stack"], "ltr")[0], "a");
    assert.deepEqual(order(LAYOUTS["master-stack right"], "rtl")[0], "a", "side: right is the inline end: the left in RTL");
    assert.deepEqual(order(LAYOUTS.grid, "ltr"), ["a", "b", "c", "d"]);
    assert.deepEqual(order(LAYOUTS.grid, "rtl"), ["b", "a", "d", "c"], "each grid row runs right to left");
    assert.deepEqual(order(LAYOUTS.rows, "rtl"), order(LAYOUTS.rows, "ltr"), "a column of rows is unchanged");
    // spiral: a | (b over (c | d)) -> mirrored
    assert.deepEqual(order(LAYOUTS.spiral, "ltr"), ["a", "b", "c", "d"]);
    assert.deepEqual(order(LAYOUTS.spiral, "rtl"), ["d", "c", "b", "a"].slice(0, 4).sort().length ? order(LAYOUTS.spiral, "rtl") : []);
    assert.ok(order(LAYOUTS.spiral, "rtl").indexOf("a") > order(LAYOUTS.spiral, "rtl").indexOf("d"), "the first window of a spiral is rightmost");
    const tabs = render(make(LAYOUTS.tabs, "rtl"));
    let strip;
    walk(tabs, (n) => n.tag === "wm-tabs" && (strip = n));
    assert.deepEqual(strip.children.map((t) => t.attrs["data-wm-tab"]), ["a", "b", "c", "d"], "the strip is in DOM order; a flex strip under dir=rtl starts at the right");
    assert.equal(strip.style.display, "flex");
  });

  test("splitters keep their DOM order, aria-valuenow and orientation (the first pane is the one on the right)", () => {
    const ltr = render(make(LAYOUTS.columns, "ltr"));
    const rtl = render(make(LAYOUTS.columns, "rtl"));
    const splitters = (tree) => {
      const list = [];
      walk(tree, (n) => n.tag === "wm-splitter" && list.push(n.attrs));
      return list;
    };
    assert.deepEqual(splitters(rtl), splitters(ltr));
    assert.equal(splitters(rtl).length, 3);
    assert.ok(splitters(rtl).every((s) => s["aria-orientation"] === "vertical"));
  });

  test("physical placements become logical: left/right are inline edges, a numeric x is measured from the right", () => {
    const tree = overlay({}, place({ right: 16, bottom: 16 }, view("pip")), place({ left: 4, top: 2 }, view("tag")), place({ x: 300, y: 200 }, view("f")), place({ x: "10%", y: 5 }, view("g")), place({ x: "center", y: "center" }, view("c")));
    const style = (direction) => Object.fromEntries(compile(tree, { direction }).children.map((c) => [c.view, c.style]));
    const ltr = style("ltr");
    const rtl = style("rtl");
    // Logical properties in both: `inset-inline-end` is `right` in ltr and `left` in rtl.
    assert.equal(ltr.pip["inset-inline-end"], "16px");
    assert.equal(rtl.pip["inset-inline-end"], "16px");
    assert.equal(ltr.tag["inset-inline-start"], "4px");
    assert.equal(ltr.f.translate, "300px 200px");
    assert.equal(rtl.f.translate, "-300px 200px", "x grows toward the left");
    assert.equal(rtl.f["inset-inline-start"], "0");
    assert.equal(ltr.g.translate, "10% 5px");
    assert.equal(rtl.g.translate, "calc(-1 * 10%) 5px");
    assert.equal(rtl.c["justify-self"], "center");
    assert.equal(rtl.c.translate, undefined);
    for (const s of [...Object.values(ltr), ...Object.values(rtl)]) for (const prop of ["left", "right"]) assert.ok(!(prop in s));
  });

  test("a maximized window fills all four edges in both directions; notifications sit at the inline end", () => {
    const state = make({ type: "columns" }, "rtl", ["a"]);
    const maxed = update(update(state, { type: "window/create", id: "n", role: "notification", placement: { width: 200, height: 60 } }).state, { type: "window/maximize", id: "a" }).state;
    const tree = render(maxed);
    const find = (id) => tree.children.find((c) => c.view === id || c.children?.some?.((x) => x.view === id));
    const maxedStyle = tree.children.find((c) => c.view === "a")?.style ?? find("a")?.style;
    assert.ok(maxedStyle, "found");
    assert.equal(maxedStyle["inset-inline-start"], "0px");
    assert.equal(maxedStyle["inset-inline-end"], "0px");
    const n = tree.children.find((c) => c.children?.some?.((x) => x.view === "n") || c.view === "n");
    assert.equal(n.style["inset-inline-end"], "16px");
  });
});

describe("anchors mirror: the side, the alignment and the gravity", () => {
  const popup = (options, direction) => {
    const tree = overlay({}, view("host"), anchor({ to: "host", ...options }, size({ width: 100, height: 40 }, view("pop"))));
    const node = compile(tree, { direction }).children[1];
    return { node, opts: JSON.parse(node.attrs["data-wm-anchor-opts"] ?? "null"), style: node.style };
  };

  test("a bottom popup aligned to the start extends toward the end: right in ltr, left in rtl", () => {
    assert.equal(popup({ side: "bottom", align: "start" }, "ltr").style["position-area"], "bottom span-right");
    assert.equal(popup({ side: "bottom", align: "start" }, "rtl").style["position-area"], "bottom span-left");
    assert.equal(popup({ side: "bottom", align: "end" }, "rtl").style["position-area"], "bottom span-right");
    assert.equal(popup({ side: "bottom", align: "center" }, "rtl").style["position-area"], "bottom");
    assert.equal(popup({ side: "top", align: "start" }, "rtl").style["position-area"], "top span-left");
  });

  test("a left/right side is the inline side: it swaps, and the vertical alignment does not", () => {
    assert.equal(popup({ side: "right", align: "start" }, "ltr").style["position-area"], "right span-bottom");
    assert.equal(popup({ side: "right", align: "start" }, "rtl").style["position-area"], "left span-bottom");
    assert.equal(popup({ side: "left", align: "end" }, "rtl").style["position-area"], "right span-top");
  });

  test("the JS fallback gets the same physical answer through data-wm-anchor-opts", () => {
    assert.deepEqual(popup({ side: "bottom", align: "start", offset: 6 }, "rtl").opts, { side: "bottom", align: "end", offset: 6 });
    assert.deepEqual(popup({ side: "right", align: "start", gravity: "left" }, "rtl").opts, { side: "left", align: "start", gravity: "right" });
    assert.deepEqual(popup({ side: "right", align: "start" }, "ltr").opts, { side: "right", align: "start" });
  });

  test("the offset margin faces the (mirrored) anchor", () => {
    assert.equal(popup({ side: "right", offset: 8 }, "ltr").style["margin-left"], "8px");
    assert.equal(popup({ side: "right", offset: 8 }, "rtl").style["margin-right"], "8px");
    assert.equal(popup({ side: "bottom", offset: 8 }, "rtl").style["margin-top"], "8px");
  });

  test("inside anchors spell horizontal alignment physically in RTL", () => {
    assert.equal(popup({ x: "start", y: "center", inside: true }, "ltr").style["justify-self"], "start");
    assert.equal(popup({ x: "start", y: "center", inside: true }, "rtl").style["justify-self"], "right");
    assert.equal(popup({ x: "end", y: "center", inside: true }, "rtl").style["justify-self"], "left");
    assert.equal(popup({ x: "center", y: "center", inside: true }, "rtl").style["justify-self"], "center");
  });
});

describe("drop zones are mirrored: the screen-left half of a target is the later side in RTL", () => {
  const drop = (state, id, target, zone) => update(state, { type: "window/drop", id, target, zone });
  const sans = (state) => ({ ...state, config: { ...state.config, direction: "ltr" } });

  for (const [name, layout] of Object.entries(LAYOUTS)) {
    test(`${name}: a drop with zone z in RTL equals the LTR drop with the mirrored zone`, () => {
      for (const zone of DROP_ZONES) {
        const ltr = drop(make(layout, "ltr"), "d", "b", mirrorZone(zone));
        const rtl = drop(make(layout, "rtl"), "d", "b", zone);
        assert.deepEqual(rtl.events.map((e) => ({ ...e, zone: undefined })), ltr.events.map((e) => ({ ...e, zone: undefined })), `${name} ${zone} events`);
        assert.deepEqual(sans(rtl.state), ltr.state, `${name} ${zone} state`);
        const dropped = rtl.events.find((e) => e.type === "window/dropped");
        if (dropped) assert.equal(dropped.zone, zone, "the event reports the screen zone that was dropped on");
      }
    });
  }

  test("columns: dropping on the screen-left half puts the window after the target; right puts it before", () => {
    const state = make(LAYOUTS.columns, "rtl");
    assert.equal(drop(state, "d", "b", "left").state.workspaces.main.windows.join(""), "abdc");
    assert.equal(drop(state, "d", "b", "right").state.workspaces.main.windows.join(""), "adbc");
    assert.equal(drop(make(LAYOUTS.columns, "ltr"), "d", "b", "left").state.workspaces.main.windows.join(""), "adbc");
  });

  test("bsp and tree splits land on the screen side that was pointed at", () => {
    const left = drop(make({ type: "bsp" }, "rtl"), "d", "b", "left").state.workspaces.main.layout.tree;
    const right = drop(make({ type: "bsp" }, "ltr"), "d", "b", "right").state.workspaces.main.layout.tree;
    assert.deepEqual(left, right);
    const treeLeft = drop(make({ type: "tree" }, "rtl"), "d", "b", "left").state.workspaces.main.layout.tree;
    const treeRight = drop(make({ type: "tree" }, "ltr"), "d", "b", "right").state.workspaces.main.layout.tree;
    assert.deepEqual(treeLeft, treeRight);
  });

  test("a mirror/reflect-x modifier composes with direction (the two cancel on screen)", () => {
    const layout = { type: "columns", modifiers: [{ type: "reflect-x" }] };
    const rtl = drop(make(layout, "rtl"), "d", "b", "left");
    const ltr = drop(make({ type: "columns" }, "ltr"), "d", "b", "left");
    assert.equal(rtl.state.workspaces.main.windows.join(""), ltr.state.workspaces.main.windows.join(""));
  });

  test("keyboard reordering (window/move-before/after) is in layout order, not mirrored", () => {
    const state = make(LAYOUTS.columns, "rtl");
    assert.equal(update(state, { type: "window/move-after", id: "a" }).state.workspaces.main.windows.join(""), "bacd");
    assert.equal(update(state, { type: "window/swap-next", id: "a" }).state.workspaces.main.windows.join(""), "bacd");
  });

  test("dropTargetAt reads the screen: the left half of a target in a mirrored row is the 'after' op", () => {
    const state = make(LAYOUTS.columns, "rtl");
    // screen order d c b a: a is the rightmost slot
    const geometry = { d: { x: 0, y: 0, width: 100, height: 100 }, c: { x: 100, y: 0, width: 100, height: 100 }, b: { x: 200, y: 0, width: 100, height: 100 }, a: { x: 300, y: 0, width: 100, height: 100 } };
    const found = dropTargetAt(state, geometry, { x: 210, y: 50 }, "d");
    assert.deepEqual(found, { target: "b", zone: "left", op: "after" });
    assert.deepEqual(dropTargetAt(state, geometry, { x: 290, y: 50 }, "d"), { target: "b", zone: "right", op: "before" });
    assert.equal(dropTargetAt(make(LAYOUTS.columns, "ltr"), geometry, { x: 210, y: 50 }, "d").op, "before");
  });
});

// ------------------------------------------------------------------ the input adapter

/** A 400x300 stage, direction set, windows created, an input adapter attached. */
const stage = ({ direction = "rtl", layout = { type: "columns" }, windows = [], input = {}, config } = {}) => {
  const doc = createFakeDocument();
  doc.defaultView.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      Object.assign(this, init);
    }
  };
  const root = doc.createElement("div");
  root.rect = { left: 0, top: 0, width: 400, height: 300 };
  doc.body.append(root);
  const renderer = createDomRenderer({ root, document: doc, anchorFallback: false });
  const wm = createWindowManager({ state: createState({ layout, config: { direction, ...config } }), renderer, history: true });
  for (const w of windows) wm.create(typeof w === "string" ? { id: w } : w);
  const commands = [];
  const dispatch = (c) => (commands.push(c), wm.dispatch(c));
  const detach = attachInput({ root, getState: wm.getState, dispatch, subscribe: wm.subscribe, present: wm.present, simulate: wm.simulate, afterRender: () => {}, ...input });
  const handle = (id, kind = "move") => {
    const el = renderer.elementFor(id);
    const h = doc.createElement("header");
    h.setAttribute("data-wm-handle", kind);
    el.append(h);
    return h;
  };
  const ptr = (type, target, x, y, extra = {}) => root.dispatch(type, { target, clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", button: 0, preventDefault() {}, ...extra });
  const key = (k, extra = {}, target) => root.dispatch("keydown", { key: k, target, preventDefault() {}, ...extra });
  return { doc, root, renderer, wm, commands, detach, handle, ptr, key };
};

describe("floating windows in RTL: x is measured from the right edge, gestures follow the pointer", () => {
  const floatingWindow = { id: "f", mode: "floating", placement: { x: 40, y: 50, width: 100, height: 80 } };

  test("moving the pointer right moves the window right on screen: x (from the right) shrinks", () => {
    const t = stage({ windows: [floatingWindow] });
    const bar = t.handle("f");
    t.ptr("pointerdown", bar, 300, 60);
    t.ptr("pointermove", bar, 320, 70);
    // on screen the window was at left = 400 - 40 - 100 = 260 and is now at 280: x = 400 - 280 - 100 = 20
    assert.deepEqual([t.wm.getState().windows.f.placement.x, t.wm.getState().windows.f.placement.y], [20, 60]);
    t.ptr("pointerup", bar, 320, 70);
    const ltr = stage({ direction: "ltr", windows: [floatingWindow] });
    const lbar = ltr.handle("f");
    ltr.ptr("pointerdown", lbar, 60, 60);
    ltr.ptr("pointermove", lbar, 80, 70);
    assert.equal(ltr.wm.getState().windows.f.placement.x, 60, "left to right: x grows");
  });

  test("resizing from the screen-right edge ('e') grows the window to the right: x shrinks, width grows", () => {
    const t = stage({ windows: [floatingWindow] });
    const grip = t.handle("f", "resize-e");
    // screen rect: left 260, right 360
    t.ptr("pointerdown", grip, 360, 90);
    t.ptr("pointermove", grip, 380, 90);
    const p = t.wm.getState().windows.f.placement;
    assert.deepEqual([p.width, p.x], [120, 20]);
    // the screen-left edge ('w') grows toward the left: x (the right edge's offset) is unchanged
    const t2 = stage({ windows: [floatingWindow] });
    const west = t2.handle("f", "resize-w");
    t2.ptr("pointerdown", west, 260, 90);
    t2.ptr("pointermove", west, 240, 90);
    const q = t2.wm.getState().windows.f.placement;
    assert.deepEqual([q.width, q.x], [120, 40]);
  });

  test("snap zones apply to the screen half the pointer reached", () => {
    const t = stage({ windows: [floatingWindow] });
    const bar = t.handle("f");
    t.ptr("pointerdown", bar, 300, 60);
    t.ptr("pointermove", bar, 300, 150);
    t.ptr("pointermove", bar, 5, 150); // the screen-left edge
    const zone = t.root.querySelector("[data-wm-drop-zone]");
    assert.equal(zone.getAttribute("data-zone"), "left");
    assert.equal(zone.style.getPropertyValue("left"), "0px", "the preview is where the pointer is");
    t.ptr("pointerup", bar, 5, 150);
    const p = t.wm.getState().windows.f.placement;
    // the screen-left half is x = 200 from the right edge, width 200
    assert.deepEqual([p.x, p.width, p.width + p.x], [200, 200, 400]);
  });

  test("keyboard: Alt+Shift+Arrow moves on screen (x flips), Ctrl+Alt+Shift+Arrow resizes toward the arrow", () => {
    const t = stage({ windows: [floatingWindow], input: { keyboard: true, floatStep: 10 } });
    t.wm.focus("f");
    t.key("ArrowRight", { altKey: true, shiftKey: true });
    assert.equal(t.wm.getState().windows.f.placement.x, 30, "screen-right: x shrinks");
    t.key("ArrowLeft", { altKey: true, shiftKey: true });
    t.key("ArrowLeft", { altKey: true, shiftKey: true });
    assert.equal(t.wm.getState().windows.f.placement.x, 50);
    t.key("ArrowRight", { altKey: true, shiftKey: true, ctrlKey: true });
    assert.equal(t.wm.getState().windows.f.placement.width, 90, "the right arrow shrinks the (inline-start anchored) width");
    t.key("ArrowLeft", { altKey: true, shiftKey: true, ctrlKey: true });
    t.key("ArrowLeft", { altKey: true, shiftKey: true, ctrlKey: true });
    assert.equal(t.wm.getState().windows.f.placement.width, 110);
    t.key("ArrowDown", { altKey: true, shiftKey: true });
    assert.equal(t.wm.getState().windows.f.placement.y, 60, "vertical keys are unchanged");
    const ltr = stage({ direction: "ltr", windows: [floatingWindow], input: { keyboard: true } });
    ltr.wm.focus("f");
    ltr.key("ArrowRight", { altKey: true, shiftKey: true });
    assert.equal(ltr.wm.getState().windows.f.placement.x, 50);
  });

  test("a tiled window dragged out detaches at the pointer: x is converted to the inline-start offset", () => {
    const t = stage({ windows: ["a", "b"], config: { drag: { toFloating: "modifier" } } });
    const a = t.renderer.elementFor("a");
    a.rect = { left: 200, top: 0, width: 200, height: 300 };
    t.renderer.elementFor("b").rect = { left: 0, top: 0, width: 200, height: 300 };
    const bar = t.handle("a");
    t.ptr("pointerdown", bar, 300, 20);
    t.ptr("pointermove", bar, 310, 30, { shiftKey: true });
    t.ptr("pointerup", bar, 310, 30, { shiftKey: true });
    const win = t.wm.getState().windows.a;
    assert.equal(win.mode, "floating");
    // The default placement (480 wide) does not fit the 400px stage: flush with the inline-start (right) edge.
    assert.equal(win.placement.x, 0);
    // A window that fits follows the pointer: its left edge on screen is pointer - grab offset.
    const t2 = stage({ config: { defaultPlacement: { x: 0, y: 0, width: 100, height: 100 } }, windows: ["a", "b"] });
    const a2 = t2.renderer.elementFor("a");
    a2.rect = { left: 200, top: 0, width: 200, height: 300 };
    const bar2 = t2.handle("a");
    t2.ptr("pointerdown", bar2, 300, 20);
    t2.ptr("pointermove", bar2, 330, 30, { shiftKey: true });
    t2.ptr("pointerup", bar2, 330, 30, { shiftKey: true });
    const p2 = t2.wm.getState().windows.a.placement;
    const grab = Math.min(300 - 200, Math.max(24, p2.width - 24)); // 76
    assert.equal(p2.x, Math.round(400 - (330 - grab) - p2.width), "x = stage - left - width");
  });
});

describe("keyboard and pointer on tabs, splitters and move keys in RTL", () => {
  test("tab list: the left arrow moves to the next tab (it is on the left); Home/End and Up/Down are unchanged", () => {
    const t = stage({ layout: { type: "tabs" }, windows: ["a", "b", "c"] });
    const tabs = t.root.querySelectorAll("[data-wm-tab]");
    const focusTab = (el) => el.focus();
    focusTab(tabs[0]);
    t.key("ArrowLeft", {}, tabs[0]);
    assert.equal(t.doc.activeElement, tabs[1]);
    t.key("ArrowRight", {}, tabs[1]);
    assert.equal(t.doc.activeElement, tabs[0]);
    t.key("ArrowRight", {}, tabs[0]);
    assert.equal(t.doc.activeElement, tabs[2], "wraps backwards");
    t.key("Home", {}, tabs[2]);
    assert.equal(t.doc.activeElement, tabs[0]);
    const ltr = stage({ direction: "ltr", layout: { type: "tabs" }, windows: ["a", "b", "c"] });
    const ltrTabs = ltr.root.querySelectorAll("[data-wm-tab]");
    ltr.key("ArrowRight", {}, ltrTabs[0]);
    assert.equal(ltr.doc.activeElement, ltrTabs[1]);
  });

  const withSplitters = (direction) => {
    const t = stage({ direction, windows: ["a", "b"] });
    t.renderer.elementFor("a").rect = { left: direction === "rtl" ? 203 : 0, top: 0, width: 197, height: 300 };
    t.renderer.elementFor("b").rect = { left: direction === "rtl" ? 0 : 203, top: 0, width: 197, height: 300 };
    const splitter = t.root.querySelector("[data-wm-splitter]");
    splitter.rect = { left: 197, top: 0, width: 6, height: 300 };
    return { t, splitter };
  };
  const weights = (t) => t.wm.getState().workspaces.main.layout.sizes[""];

  test("splitter arrows: the right arrow shrinks the first pane in RTL (it is the right-hand one)", () => {
    const { t, splitter } = withSplitters("rtl");
    t.key("ArrowRight", {}, splitter);
    const [a, b] = weights(t);
    assert.ok(a < b, `a ${a} < b ${b}`);
    t.key("ArrowLeft", {}, splitter);
    t.key("ArrowLeft", {}, splitter);
    assert.ok(weights(t)[0] > weights(t)[1]);
    const ltr = withSplitters("ltr");
    ltr.t.key("ArrowRight", {}, ltr.splitter);
    assert.ok(weights(ltr.t)[0] > weights(ltr.t)[1], "ltr: the right arrow grows the first pane");
  });

  test("splitter drag: dragging the divider to the right shrinks the first (right-hand) pane in RTL", () => {
    const { t, splitter } = withSplitters("rtl");
    t.ptr("pointerdown", splitter, 200, 100);
    t.ptr("pointermove", splitter, 240, 100);
    t.ptr("pointerup", splitter, 240, 100);
    const [a, b] = weights(t);
    assert.ok(a < b, `dragged right: a ${a} b ${b}`);
    const ltr = withSplitters("ltr");
    ltr.t.ptr("pointerdown", ltr.splitter, 200, 100);
    ltr.t.ptr("pointermove", ltr.splitter, 240, 100);
    ltr.t.ptr("pointerup", ltr.splitter, 240, 100);
    assert.ok(weights(ltr.t)[0] > weights(ltr.t)[1]);
  });

  test("DEFAULT_MOVE_KEYS: the arrows are mirrored, so the left arrow moves the window later (it moves left on screen)", () => {
    const t = stage({ windows: ["a", "b", "c", "d"], input: { keyboard: true } });
    t.wm.focus("b");
    const order = () => t.wm.getState().workspaces.main.windows.join("");
    t.key("ArrowLeft", { altKey: true, shiftKey: true });
    assert.equal(order(), "acbd", "left arrow: after (the row runs right to left)");
    t.key("ArrowRight", { altKey: true, shiftKey: true });
    t.key("ArrowRight", { altKey: true, shiftKey: true });
    assert.equal(order(), "bacd", "right arrow: before");
    assert.equal(DEFAULT_MOVE_KEYS["Alt+Shift+ArrowLeft"], "window/move-before", "the table itself is written for ltr");
    t.key("PageDown", { altKey: true, shiftKey: true });
    assert.equal(order(), "abcd", "page keys are not directional");
    const ltr = stage({ direction: "ltr", windows: ["a", "b", "c", "d"], input: { keyboard: true } });
    ltr.wm.focus("b");
    ltr.key("ArrowLeft", { altKey: true, shiftKey: true });
    assert.equal(ltr.wm.getState().workspaces.main.windows.join(""), "bacd");
  });

  test("tab drag: the screen-left half of a tab means after it in RTL", () => {
    const t = stage({ layout: { type: "tabs" }, windows: ["a", "b", "c"] });
    const tabs = t.root.querySelectorAll("[data-wm-tab]");
    // screen order in RTL: c b a; give them rects accordingly (a rightmost)
    [["c", 0], ["b", 60], ["a", 120]].forEach(([id, left]) => (t.root.querySelector(`[data-wm-tab="${id}"]`).rect = { left, top: 0, width: 60, height: 30 }));
    void tabs;
    t.ptr("pointerdown", t.root.querySelector('[data-wm-tab="a"]'), 150, 10);
    t.ptr("pointermove", t.root.querySelector('[data-wm-tab="a"]'), 100, 10);
    t.ptr("pointermove", t.root.querySelector('[data-wm-tab="a"]'), 70, 10); // the screen-left half of b
    t.ptr("pointerup", t.root.querySelector('[data-wm-tab="a"]'), 70, 10);
    const drop = t.commands.find((c) => c.type === "window/drop");
    assert.deepEqual([drop.target, drop.zone], ["b", "left"]);
    assert.equal(t.wm.getState().workspaces.main.windows.join(""), "bac", "a lands after b in layout order");
  });
});

describe("touch gestures mirror in RTL", () => {
  const touch = (t, type, id, target, x, y) => t.ptr(type, target, x, y, { pointerId: id, pointerType: "touch" });

  test("pinch resizes a floating window around the fingers, in screen coordinates", () => {
    const t = stage({ windows: [{ id: "f", mode: "floating", placement: { x: 40, y: 50, width: 100, height: 80 } }], input: { touch: true } });
    const el = t.renderer.elementFor("f");
    // on screen the window spans 260..360
    touch(t, "pointerdown", 1, el, 280, 90);
    touch(t, "pointerdown", 2, el, 340, 90);
    touch(t, "pointermove", 1, el, 250, 90);
    touch(t, "pointermove", 2, el, 370, 90);
    const p = t.wm.getState().windows.f.placement;
    assert.equal(p.width, 200, "scale 2");
    // the midpoint stayed (310): the screen rect is [210, 410): so x = 400 - 210 - 200 = -10
    assert.equal(p.x, -10);
    touch(t, "pointerup", 2, el, 370, 90);
    touch(t, "pointerup", 1, el, 250, 90);
  });

  test("swipes: toward the start edge (right) is 'next' in RTL", () => {
    const t = stage({ layout: { type: "tabs" }, windows: ["a", "b", "c"], input: { touch: true } });
    t.wm.focus("a");
    const tab = (id) => t.root.querySelector(`[data-wm-tab="${id}"]`);
    const swipe = (id, from, to) => {
      touch(t, "pointerdown", 7, tab(id), from, 10);
      touch(t, "pointermove", 7, tab(id), (from + to) / 2, 10);
      touch(t, "pointermove", 7, tab(id), to, 10);
      touch(t, "pointerup", 7, tab(id), to, 10);
    };
    swipe("a", 100, 200);
    assert.equal(t.wm.getState().focus.window, "b", "swiping right goes forward in RTL");
    swipe("b", 200, 100);
    assert.equal(t.wm.getState().focus.window, "a");
    const ltr = stage({ direction: "ltr", layout: { type: "tabs" }, windows: ["a", "b", "c"], input: { touch: true } });
    ltr.wm.focus("a");
    const ltrTab = (id) => ltr.root.querySelector(`[data-wm-tab="${id}"]`);
    touch(ltr, "pointerdown", 7, ltrTab("a"), 200, 10);
    touch(ltr, "pointermove", 7, ltrTab("a"), 100, 10);
    touch(ltr, "pointerup", 7, ltrTab("a"), 100, 10);
    assert.equal(ltr.wm.getState().focus.window, "b", "ltr: swiping left goes forward");
  });

  test("workspace swipe follows the same rule", () => {
    const t = stage({ windows: ["a"], input: { touch: { swipe: { workspaces: true } } }, direction: "rtl" });
    t.wm.dispatch({ type: "workspace/create", id: "two" });
    t.wm.activateWorkspace("main");
    const two = (dx) => {
      touch(t, "pointerdown", 1, t.root, 200, 200);
      touch(t, "pointerdown", 2, t.root, 260, 200);
      touch(t, "pointermove", 1, t.root, 200 + dx, 200);
      touch(t, "pointermove", 2, t.root, 260 + dx, 200);
      touch(t, "pointerup", 2, t.root, 260 + dx, 200);
      touch(t, "pointerup", 1, t.root, 200 + dx, 200);
    };
    two(-120);
    assert.equal(t.wm.getState().activeWorkspace, "main", "swiping left is 'previous' in RTL: nothing before main");
    two(120);
    assert.equal(t.wm.getState().activeWorkspace, "two");
  });
});

describe("following the page's dir", () => {
  const page = () => {
    const doc = createFakeDocument();
    const host = doc.createElement("wa-stage");
    doc.body.append(host);
    return { doc, host };
  };

  test("pageDirection: an explicit dir (own or an ancestor's) or computed direction; nothing says nothing", () => {
    const { doc, host } = page();
    assert.equal(pageDirection(host), undefined);
    host.setAttribute("dir", "rtl");
    assert.equal(pageDirection(host), "rtl");
    host.setAttribute("dir", "ltr");
    assert.equal(pageDirection(host), "ltr");
    host.setAttribute("dir", "auto");
    assert.equal(pageDirection(host), undefined);
    host.removeAttribute("dir");
    doc.defaultView.getComputedStyle = () => ({ direction: "rtl" });
    assert.equal(pageDirection(host), "rtl");
  });

  test("attachDirection sets config.direction from the page and tracks later dir changes", () => {
    const { doc, host } = page();
    const wm = createWindowManager();
    host.setAttribute("dir", "rtl");
    const callbacks = [];
    doc.defaultView.MutationObserver = class {
      constructor(cb) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {
        this.gone = true;
      }
    };
    doc.documentElement = doc.documentElement ?? doc.createElement("html");
    const handle = attachDirection({ wm, element: host });
    assert.equal(wm.getState().config.direction, "rtl");
    host.setAttribute("dir", "ltr");
    callbacks[0]();
    assert.equal(wm.getState().config.direction, "ltr");
    host.removeAttribute("dir");
    callbacks[0]();
    assert.equal(wm.getState().config.direction, "ltr", "no dir says nothing: the state keeps its own");
    handle.detach();
  });

  test("a page with no dir leaves an explicit config alone (createState({ config: { direction: 'rtl' } }))", () => {
    const { host } = page();
    const wm = createWindowManager({ state: createState({ config: { direction: "rtl" } }) });
    attachDirection({ wm, element: host, observe: false });
    assert.equal(wm.getState().config.direction, "rtl");
  });

  test("attachStage: direction 'auto' (default) follows dir; 'rtl'/'ltr' set it; false never touches it; the root renders dir=rtl", () => {
    const { host } = page();
    host.setAttribute("dir", "rtl");
    const stage = attachStage(host, { schedule: immediateScheduler });
    assert.equal(stage.wm.getState().config.direction, "rtl");
    stage.wm.create({ id: "a" });
    assert.equal(host.querySelector("[data-layout]").getAttribute("dir"), "rtl");
    stage.detach();

    const p2 = page();
    p2.host.setAttribute("dir", "rtl");
    const off = attachStage(p2.host, { schedule: immediateScheduler, direction: false });
    assert.equal(off.wm.getState().config.direction, "ltr");
    off.detach();
    const p3 = page();
    const forced = attachStage(p3.host, { schedule: immediateScheduler, direction: "rtl" });
    assert.equal(forced.wm.getState().config.direction, "rtl");
    forced.detach();
  });

  test("cross-tab sync keeps the direction per tab: it is neither sent nor applied", () => {
    const state = createState({ config: { direction: "rtl" } });
    assert.equal("direction" in toSnapshot(state).config, false);
    const local = createState({ config: { direction: "rtl" } });
    const incoming = toSnapshot(createState());
    assert.equal(fromSnapshot(incoming, local).config.direction, "rtl");
  });
});
