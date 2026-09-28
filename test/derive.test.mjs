import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  reduce,
  replay,
  derive,
  presentationContext,
  views,
  find,
  validate,
  columns,
} from "../src/index.mjs";

const make = (commands, options) => replay(createState(options), commands);
const win = (id, extra = {}) => ({ type: "window/create", id, ...extra });

describe("derive: state → presentation tree", () => {
  test("always an overlay whose first layer is the tiled base", () => {
    const tree = derive(make([win("a"), win("b"), win("c")]));
    assert.equal(tree.type, "overlay");
    assert.equal(tree.children.length, 1);
    const base = tree.children[0];
    assert.equal(base.type, "row");
    assert.deepEqual(views(base), ["a", "b", "c"]);
  });

  test("no pixels for tiled windows: only relationships and weights", () => {
    const tree = derive(make([win("a"), win("b")]));
    const json = JSON.stringify(tree);
    assert.ok(!/"x":|"y":|"width":/.test(json));
  });

  test("floating windows are layered above in stacking order", () => {
    let state = make([
      win("a"),
      win("f1", { mode: "floating", placement: { x: 10, y: 20, width: 300, height: 200 } }),
      win("f2", { mode: "floating" }),
    ]);
    state = reduce(state, { type: "window/focus", id: "f1" }); // raises f1 above f2
    const tree = derive(state);
    assert.deepEqual(
      tree.children.slice(1).map((n) => views(n)[0]),
      ["f2", "f1"],
    );
    const f1 = tree.children[2];
    assert.equal(f1.type, "place");
    assert.deepEqual(f1.options, { x: 10, y: 20 });
  });

  test("dialogs anchor to their parent; popovers anchor by side", () => {
    const state = make([
      win("editor"),
      win("save", { role: "dialog", parent: "editor", modal: true, placement: { width: 400, height: 200 } }),
      win("menu", { role: "menu", parent: "editor", anchor: { to: "editor", side: "bottom", align: "start" } }),
    ]);
    const tree = derive(state);
    const save = find(tree, (n) => n.type === "anchor" && views(n)[0] === "save");
    assert.deepEqual(save.options, { to: "editor", x: "center", y: "center" });
    const menu = find(tree, (n) => n.type === "anchor" && views(n)[0] === "menu");
    assert.equal(menu.options.side, "bottom");
  });

  test("orphan dialogs are centered", () => {
    const tree = derive(make([win("d", { role: "dialog" })]));
    assert.deepEqual(tree.children[1].options, { x: "center", y: "center" });
  });

  test("minimized windows disappear; maximized fill; fullscreen replaces everything", () => {
    let state = make([win("a"), win("b"), win("c")]);
    state = reduce(state, { type: "window/minimize", id: "c" });
    assert.deepEqual(views(derive(state)), ["a", "b"]);
    state = reduce(state, { type: "window/maximize", id: "a" });
    const maxTree = derive(state);
    assert.deepEqual(maxTree.children[1].options, { top: 0, right: 0, bottom: 0, left: 0 });
    state = reduce(state, { type: "window/fullscreen", id: "b" });
    assert.deepEqual(derive(state), { type: "overlay", options: {}, children: [{ type: "view", id: "b" }] });
  });

  test("monocle/tabs follow focus", () => {
    let state = make([win("a"), win("b"), win("c")], { layout: { type: "tabs" } });
    state = reduce(state, { type: "window/focus", id: "b" });
    const base = derive(state).children[0];
    assert.equal(base.type, "stack");
    assert.deepEqual(base.options, { active: "b", chrome: "tabs" });
  });

  test("gap and inset from config wrap the tiled base", () => {
    const state = make([win("a"), win("b"), win("c")], { config: { gap: 8, inset: 16 } });
    const base = derive(state).children[0];
    assert.equal(base.type, "inset");
    assert.equal(base.child.type, "gap");
    const nested = find(base, (n) => n.type === "column");
    const wrapper = find(base, (n) => n.type === "gap" && n.child === nested);
    assert.ok(wrapper, "nested containers get the gap too");
  });

  test("floating layout type floats every window", () => {
    const tree = derive(make([win("a"), win("b")], { layout: { type: "floating" } }));
    assert.deepEqual(tree.children[0], { type: "row", options: {}, children: [] });
    assert.equal(tree.children[1].type, "place");
  });

  test("bsp and grid interpreters", () => {
    let state = make([win("a"), win("b"), win("c")]);
    state = reduce(state, { type: "layout/set", layout: { type: "bsp" } });
    assert.deepEqual(views(derive(state)), ["a", "b", "c"]);
    state = reduce(state, { type: "layout/set", layout: { type: "grid", min: 250 } });
    assert.equal(derive(state).children[0].type, "grid");
  });

  test("custom layout interpreters are plain functions", () => {
    const state = make([win("a"), win("b")], { layout: { type: "coding" } });
    const tree = derive(state, { layouts: { coding: (spec, ids) => columns({}, [...ids].reverse()) } });
    assert.deepEqual(views(tree), ["b", "a"]);
    assert.throws(() => derive(state), /no layout interpreter/);
  });

  test("every derived tree validates", () => {
    const state = make([win("a"), win("b", { mode: "floating" }), win("n", { role: "notification" })]);
    assert.deepEqual(validate(derive(state)), { ok: true });
  });

  test("presentationContext exposes focus and blocked windows", () => {
    const state = make([win("a"), win("d", { role: "dialog", parent: "a", modal: true })]);
    const ctx = presentationContext(state);
    assert.equal(ctx.focused, "d");
    assert.deepEqual(ctx.blocked, ["a"]);
    assert.equal(ctx.roles.d, "dialog");
  });

  test("presentationContext exposes urgent windows", () => {
    let state = make([win("a"), win("b")]);
    state = reduce(state, { type: "window/set-urgent", id: "a" });
    assert.deepEqual(presentationContext(state).urgent, ["a"]);
  });
});
