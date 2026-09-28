import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  view,
  row,
  column,
  grid,
  stack,
  overlay,
  place,
  size,
  gap,
  inset,
  anchor,
  container,
  isNode,
  isContainer,
  isModifier,
  validate,
  fromJSON,
  NODE_KINDS,
} from "../src/index.mjs";

describe("primitives", () => {
  test("there are exactly eleven primitives", () => {
    assert.deepEqual([...NODE_KINDS].sort(), [
      "anchor",
      "column",
      "gap",
      "grid",
      "inset",
      "overlay",
      "place",
      "row",
      "size",
      "stack",
      "view",
    ]);
  });

  test("view(id) is a leaf", () => {
    assert.deepEqual(view("editor"), { type: "view", id: "editor" });
  });

  test("view requires a non-empty string id", () => {
    assert.throws(() => view(""), TypeError);
    assert.throws(() => view(42), TypeError);
  });

  test("containers take options first, then children", () => {
    const tree = row({ align: "center" }, view("a"), view("b"));
    assert.equal(tree.type, "row");
    assert.deepEqual(tree.options, { align: "center" });
    assert.deepEqual(
      tree.children.map((c) => c.id),
      ["a", "b"],
    );
  });

  test("forgetting options is a helpful error", () => {
    assert.throws(() => row(view("a"), view("b")), /options must come first/);
    assert.throws(() => place(view("a")), /options must come first/);
  });

  test("options must be a plain object", () => {
    assert.throws(() => column("x", view("a")), /plain object/);
    assert.throws(() => stack([], view("a")), /plain object/);
  });

  test("children arrays are flattened and falsy children dropped", () => {
    const ids = ["a", "b"];
    const tree = column({}, ids.map(view), false && view("x"), null, view("c"));
    assert.deepEqual(
      tree.children.map((c) => c.id),
      ["a", "b", "c"],
    );
  });

  test("non-node children are rejected", () => {
    assert.throws(() => row({}, "a"), /expected a layout node/);
  });

  test("modifiers wrap exactly one child", () => {
    const node = size({ weight: 2 }, view("a"));
    assert.deepEqual(node, { type: "size", options: { weight: 2 }, child: { type: "view", id: "a" } });
    assert.throws(() => size({ weight: 2 }), TypeError);
  });

  test("gap and inset accept a number shorthand", () => {
    assert.deepEqual(gap(8, row({})).options, { all: 8 });
    assert.deepEqual(inset(16, row({})).options, { all: 16 });
  });

  test("anchor requires options.to", () => {
    assert.throws(() => anchor({ side: "bottom" }, view("menu")), /options.to/);
    assert.equal(anchor({ to: "save" }, view("menu")).options.to, "save");
  });

  test("nodes are deeply frozen", () => {
    const tree = row({ align: "start" }, view("a"));
    assert.ok(Object.isFrozen(tree));
    assert.ok(Object.isFrozen(tree.options));
    assert.ok(Object.isFrozen(tree.children));
    assert.ok(Object.isFrozen(tree.children[0]));
  });

  test("options objects are copied, not aliased", () => {
    const options = { columns: 2 };
    const tree = grid(options, view("a"));
    options.columns = 3;
    assert.equal(tree.options.columns, 2);
  });

  test("generic container() backs the named constructors", () => {
    assert.deepEqual(container("stack", { active: "a" }, [view("a")]), stack({ active: "a" }, view("a")));
    assert.throws(() => container("blob", {}, []), /Unknown container/);
  });

  test("predicates", () => {
    assert.ok(isNode(view("a")));
    assert.ok(isContainer(overlay({})));
    assert.ok(isModifier(inset({ all: 1 }, view("a"))));
    assert.ok(!isNode({ type: "div" }));
    assert.ok(!isNode(null));
  });
});

describe("validation and serialization", () => {
  const tree = overlay(
    {},
    inset({ all: 8 }, gap({ all: 8 }, row({}, size({ weight: 2 }, view("editor")), column({}, view("b"), view("t"))))),
    anchor({ to: "editor", x: "center", y: "center" }, size({ width: 480, height: "content" }, view("dialog"))),
  );

  test("a built tree validates", () => {
    assert.deepEqual(validate(tree), { ok: true });
  });

  test("JSON round-trip preserves the tree exactly", () => {
    const restored = fromJSON(JSON.stringify(tree));
    assert.deepEqual(restored, tree);
    assert.ok(Object.isFrozen(restored));
  });

  test("invalid trees report paths", () => {
    const bad = { type: "row", options: {}, children: [{ type: "view" }, { type: "size", options: {}, child: 3 }] };
    const result = validate(bad);
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.errors.map((e) => e.path),
      ["$.children[0]", "$.children[1].child"],
    );
    assert.throws(() => fromJSON(bad), /Invalid layout tree/);
  });
});
