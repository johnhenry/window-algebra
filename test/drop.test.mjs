import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  createWindowManager,
  update,
  replay,
  derive,
  views,
  bspIds,
  bspFrom,
  bspLeaf,
  bspSplit,
  DROPS,
  DROP_ZONES,
  orderDrops,
  createDropHandler,
  dropZoneAt,
  dropTargetAt,
  previewDrop,
  zoneRect,
  dragMode,
  COMMANDS,
} from "../src/index.mjs";

const IDS = ["a", "b", "c", "d"];
const make = (layout, { config, ids = IDS, extra = [] } = {}) =>
  replay(createState({ layout, config }), [...ids.map((id) => ({ type: "window/create", id })), ...extra]);
const order = (state, ws = "main") => state.workspaces[ws].windows.join("");
const drop = (state, id, target, zone, rest = {}) => update(state, { type: "window/drop", id, target, zone, ...rest });
const reason = (out) => out.events.find((e) => e.type === "command/rejected")?.reason;

/** Expected order after dropping d onto b: swap / before / after. */
const SWAP = "adcb";
const BEFORE = "adbc";
const AFTER = "abdc";

describe("window/drop: order-based layouts (d dropped onto b)", () => {
  const table = {
    columns: { spec: { type: "columns" }, center: SWAP, left: BEFORE, right: AFTER, top: SWAP, bottom: SWAP },
    grid: { spec: { type: "grid", columns: 2 }, center: SWAP, left: BEFORE, right: AFTER, top: SWAP, bottom: SWAP },
    tabs: { spec: { type: "tabs" }, center: SWAP, left: BEFORE, right: AFTER, top: SWAP, bottom: SWAP },
    monocle: { spec: { type: "monocle" }, center: SWAP, left: BEFORE, right: AFTER, top: SWAP, bottom: SWAP },
    rows: { spec: { type: "rows" }, center: SWAP, top: BEFORE, bottom: AFTER, left: SWAP, right: SWAP },
    // b is in the stack column: vertical.
    "master-stack": { spec: { type: "master-stack" }, center: SWAP, top: BEFORE, bottom: AFTER, left: SWAP, right: SWAP },
    // spiral: b (index 1) splits with the rest in a column.
    spiral: { spec: { type: "spiral" }, center: SWAP, top: BEFORE, bottom: AFTER, left: SWAP, right: SWAP },
    // Unknown (custom) layout types read in reading order.
    custom: { spec: { type: "sidebar" }, center: SWAP, left: BEFORE, top: BEFORE, right: AFTER, bottom: AFTER },
  };
  for (const [name, row] of Object.entries(table)) {
    test(name, () => {
      for (const zone of DROP_ZONES) {
        const out = drop(make(row.spec), "d", "b", zone);
        assert.equal(order(out.state), row[zone], `${name} ${zone}`);
        const event = out.events.find((e) => e.type === "window/dropped");
        assert.deepEqual(event, { type: "window/dropped", id: "d", target: "b", zone, op: event.op, workspace: "main" });
        assert.deepEqual(out.effects, [{ type: "render" }]);
      }
    });
  }

  test("master-stack: a lone master sits beside the stack (mirrored for side: right)", () => {
    const left = make({ type: "master-stack" });
    assert.equal(order(drop(left, "c", "a", "left").state), "cabd");
    assert.equal(order(drop(left, "c", "a", "right").state), "acbd");
    assert.equal(order(drop(left, "c", "a", "top").state), "cbad"); // cross-axis: swap
    const right = make({ type: "master-stack", side: "right" });
    assert.equal(order(drop(right, "c", "a", "right").state), "cabd");
    assert.equal(order(drop(right, "c", "a", "left").state), "acbd");
    // Several masters stack in a column.
    const two = make({ type: "master-stack", masterCount: 2 });
    assert.equal(order(drop(two, "d", "a", "top").state), "dabc");
  });

  test("spiral alternates axes with depth; the last window shares its predecessor's split", () => {
    const s = make({ type: "spiral" });
    assert.equal(order(drop(s, "d", "a", "left").state), "dabc"); // index 0: x
    assert.equal(order(drop(s, "a", "c", "left").state), "bacd"); // index 2: x
    assert.equal(order(drop(s, "a", "d", "right").state), "bcda"); // last (index 3): shares depth 2 → x
    assert.equal(order(drop(s, "a", "d", "top").state), "dbca"); // cross-axis swap
  });

  test("the dragged window moves; derive follows", () => {
    const out = drop(make({ type: "columns" }), "a", "d", "right");
    assert.deepEqual(views(derive(out.state)), ["b", "c", "d", "a"]);
  });

  test("non-tiled windows keep their slots in the workspace list", () => {
    const s = make({ type: "columns" }, { ids: ["a", "f", "b", "c"], extra: [] });
    const withFloat = update(s, { type: "window/set-mode", id: "f", mode: "floating" }).state;
    assert.equal(order(drop(withFloat, "c", "a", "left").state), "cfab");
  });

  test("a drop that changes nothing still reports, without a new state", () => {
    const s = make({ type: "columns" });
    const out = drop(s, "a", "b", "left");
    assert.equal(out.state.workspaces, s.workspaces);
    assert.equal(order(out.state), "abcd");
    assert.equal(out.events[0].type, "window/dropped");
  });
});

describe("window/drop: BSP", () => {
  const bsp = () => make({ type: "bsp" }, { extra: [{ type: "layout/set", layout: { type: "bsp" } }] });

  test("center swaps the two leaves (and the workspace order)", () => {
    const s = bsp();
    const out = drop(s, "a", "d", "center");
    assert.deepEqual(bspIds(out.state.workspaces.main.layout.tree), ["d", "b", "c", "a"]);
    assert.equal(order(out.state), "dbca");
  });

  const tree = (s) => s.workspaces.main.layout.tree;
  for (const [zone, direction, first] of [
    ["left", "horizontal", true],
    ["right", "horizontal", false],
    ["top", "vertical", true],
    ["bottom", "vertical", false],
  ]) {
    test(`${zone} removes the dragged leaf and splits the target (${direction}, dragged ${first ? "first" : "second"})`, () => {
      const s = replay(createState({ layout: { type: "bsp" } }), ["a", "b", "c"].map((id) => ({ type: "window/create", id })));
      const out = drop(s, "a", "c", zone);
      const t = tree(out.state);
      assert.equal(bspIds(t).filter((id) => id === "a").length, 1);
      // Find the split containing c: its sibling must be a, in the right direction and position.
      const find = (node) =>
        node.type === "leaf" ? null : [node.first, node.second].some((n) => n.type === "leaf" && n.id === "c") ? node : find(node.first) ?? find(node.second);
      const split = find(t);
      assert.equal(split.direction, direction);
      assert.equal((first ? split.first : split.second).id, "a");
      assert.equal((first ? split.second : split.first).id, "c");
      assert.deepEqual([...bspIds(t)].sort(), ["a", "b", "c"]);
      assert.deepEqual(bspIds(t), out.state.workspaces.main.windows.filter((id) => bspIds(t).includes(id)));
    });
  }

  test("a stale tree is reconciled before the drop", () => {
    const s = bsp();
    const stale = { ...s, workspaces: { ...s.workspaces, main: { ...s.workspaces.main, layout: { type: "bsp", tree: bspFrom(["a", "b"]) } } } };
    const out = drop(stale, "d", "a", "left");
    assert.deepEqual([...bspIds(tree(out.state))].sort(), ["a", "b", "c", "d"]);
  });
});

describe("window/drop: rejections", () => {
  const base = () => make({ type: "columns" });
  test("unknown window / target", () => {
    assert.equal(reason(drop(base(), "zz", "a", "center")), "unknown-window");
    assert.equal(reason(drop(base(), "a", "zz", "center")), "unknown-window");
  });
  test("unknown zone", () => assert.equal(reason(drop(base(), "a", "b", "middle")), "unknown-zone"));
  test("drop onto itself", () => assert.equal(reason(drop(base(), "a", "a", "center")), "same-window"));
  test("target in another workspace", () => {
    const s = replay(createState({ workspaces: ["one", "two"] }), [
      { type: "window/create", id: "a" },
      { type: "window/create", id: "b", workspace: "two" },
    ]);
    assert.equal(reason(drop(s, "a", "b", "center")), "different-workspaces");
  });
  test("not tiled: floating, maximized, minimized, dialogs, the floating layout", () => {
    const s = base();
    // A floating *dragged* window is refused only when config.drag.toTiled is "off"; a floating target always is.
    const noTiling = update(s, { type: "config/set", drag: { toTiled: "off" } }).state;
    assert.equal(reason(drop(update(noTiling, { type: "window/set-mode", id: "a", mode: "floating" }).state, "a", "b", "center")), "not-tiled");
    assert.equal(reason(drop(update(s, { type: "window/set-mode", id: "b", mode: "floating" }).state, "a", "b", "center")), "not-tiled");
    assert.equal(reason(drop(update(s, { type: "window/maximize", id: "a" }).state, "a", "b", "center")), "not-tiled");
    assert.equal(reason(drop(update(s, { type: "window/minimize", id: "b" }).state, "a", "b", "center")), "not-tiled");
    const dialog = update(s, { type: "window/create", id: "dlg", role: "dialog", parent: "a" }).state;
    assert.equal(reason(drop(dialog, "dlg", "b", "center")), "not-tiled");
    assert.equal(reason(drop(update(s, { type: "layout/set", layout: { type: "floating" } }).state, "a", "b", "center")), "not-tiled");
  });
  test("blocked by a modal (dragged or target)", () => {
    const s = update(base(), { type: "window/create", id: "m", role: "dialog", modal: true, parent: "b" }).state;
    assert.equal(reason(drop(s, "b", "c", "center")), "blocked");
    assert.equal(reason(drop(s, "c", "b", "center")), "blocked");
  });
  test("dragging disabled by config or by the layout", () => {
    const off = update(base(), { type: "config/set", drag: { tiled: "off" } }).state;
    assert.equal(reason(drop(off, "a", "b", "center")), "drag-disabled");
    const layoutOff = make({ type: "columns", drag: "off" });
    assert.equal(reason(drop(layoutOff, "a", "b", "center")), "drag-disabled");
  });
  test("pinned windows cannot be dragged, nor swapped away", () => {
    const s = update(base(), { type: "window/set-draggable", id: "a", draggable: false }).state;
    assert.equal(reason(drop(s, "a", "b", "center")), "not-draggable");
    assert.equal(reason(drop(s, "b", "a", "center")), "not-draggable");
    assert.equal(order(drop(s, "b", "a", "left").state), "bacd"); // inserting beside it is fine
  });
  test("every rejection leaves the state untouched", () => {
    const s = base();
    for (const out of [drop(s, "zz", "a", "center"), drop(s, "a", "a", "center"), drop(s, "a", "b", "middle")]) assert.equal(out.state, s);
  });
});

describe("drag settings", () => {
  test("createState defaults, merged partially from options", () => {
    assert.deepEqual(createState().config.drag, {
      tiled: "swap-or-insert", edgeZone: 0.25, preview: true, tooSmall: "allow",
      toFloating: "modifier", toTiled: "modifier", crossWorkspace: true, follow: false,
    });
    assert.deepEqual(createState({ config: { drag: { tiled: "swap" } } }).config.drag.edgeZone, 0.25);
  });

  test("config/set merges drag one level deep and validates it", () => {
    const s = update(createState(), { type: "config/set", drag: { edgeZone: 0.1 } }).state;
    assert.equal(s.config.drag.edgeZone, 0.1);
    assert.equal(s.config.drag.tiled, "swap-or-insert");
    for (const drag of [{ tiled: "sometimes" }, { tooSmall: "maybe" }, { edgeZone: 0.9 }, "swap", { toFloating: "yes" }, { toTiled: "never" }]) {
      assert.equal(reason(update(s, { type: "config/set", drag })), "invalid-config");
    }
  });

  test("mode swap forbids inserts; mode insert forbids swaps", () => {
    const swap = make({ type: "columns" }, { config: { drag: { tiled: "swap" } } });
    assert.equal(reason(drop(swap, "d", "b", "left")), "zone-disabled");
    assert.equal(order(drop(swap, "d", "b", "center").state), SWAP);
    const insert = make({ type: "columns" }, { config: { drag: { tiled: "insert" } } });
    assert.equal(reason(drop(insert, "d", "b", "center")), "zone-disabled");
    assert.equal(reason(drop(insert, "d", "b", "top")), "zone-disabled"); // cross-axis edge is a swap
    assert.equal(order(drop(insert, "d", "b", "left").state), BEFORE);
    const bspInsertOnly = make({ type: "bsp", drag: "insert" });
    assert.equal(reason(drop(bspInsertOnly, "d", "b", "center")), "zone-disabled");
  });

  test("a layout spec's drag overrides config.drag.tiled", () => {
    const s = make({ type: "columns", drag: "swap" });
    assert.equal(dragMode(s), "swap");
    assert.equal(reason(drop(s, "d", "b", "right")), "zone-disabled");
    const bogus = make({ type: "columns", drag: "nonsense" });
    assert.equal(dragMode(bogus), "swap-or-insert");
  });

  test("draggable: false at create time and via window/set-draggable", () => {
    let s = replay(createState(), [{ type: "window/create", id: "a", draggable: false }, { type: "window/create", id: "b" }]);
    assert.equal(s.windows.a.draggable, false);
    assert.ok(!("draggable" in s.windows.b));
    const out = update(s, { type: "window/set-draggable", id: "a", draggable: true });
    assert.ok(!("draggable" in out.state.windows.a));
    assert.deepEqual(out.events, [{ type: "window/draggable-changed", id: "a", draggable: true }]);
    assert.equal(update(out.state, { type: "window/set-draggable", id: "a", draggable: true }).state, out.state);
    assert.equal(reason(update(s, { type: "window/set-draggable", id: "nope", draggable: false })), "unknown-window");
  });

  test("tooSmall: reject refuses a drop whose estimated slot violates constraints", () => {
    const extra = [{ type: "window/set-constraints", id: "d", constraints: { minWidth: 300 } }];
    const reject = make({ type: "columns" }, { config: { drag: { tooSmall: "reject" } }, extra });
    const small = { d: { width: 200, height: 400 }, b: { width: 200, height: 400 } };
    assert.equal(reason(drop(reject, "d", "b", "center", { geometry: small })), "too-small");
    assert.equal(order(drop(reject, "d", "b", "center", { geometry: { d: { width: 320, height: 400 } } }).state), SWAP);
    // Without geometry the setting is advisory.
    assert.equal(order(drop(reject, "d", "b", "center").state), SWAP);
    // "allow" ignores the estimate.
    const allow = make({ type: "columns" }, { extra });
    assert.equal(order(drop(allow, "d", "b", "center", { geometry: small }).state), SWAP);
    // max constraints count too.
    const maxed = update(reject, { type: "window/set-constraints", id: "b", constraints: { maxHeight: 100 } }).state;
    assert.equal(reason(drop(maxed, "d", "b", "center", { geometry: { d: { width: 400, height: 50 }, b: { width: 50, height: 400 } } })), "too-small");
  });
});

describe("drop interpreters are a registry", () => {
  test("DROPS covers every built-in tiled layout plus a default", () => {
    for (const type of ["master-stack", "columns", "rows", "grid", "spiral", "monocle", "tabs", "bsp", "default"]) assert.ok(DROPS[type], type);
  });

  test("createDropHandler / manager drops override per layout type", () => {
    const drops = { ...DROPS, columns: orderDrops(() => "y") };
    const s = make({ type: "columns" });
    const out = update(s, { type: "window/drop", id: "d", target: "b", zone: "top" }, { "window/drop": createDropHandler(drops) });
    assert.equal(order(out.state), BEFORE);
    const wm = createWindowManager({ state: createState({ layout: { type: "columns" } }), drops: { columns: orderDrops(() => "y") } });
    IDS.forEach((id) => wm.create({ id }));
    wm.drop("d", "b", "top");
    assert.equal(order(wm.state), BEFORE);
    assert.deepEqual(replay(createState({ layout: { type: "columns" } }), wm.log, { "window/drop": createDropHandler(drops) }), wm.state);
  });

  test("a custom interpreter may rewrite the layout spec", () => {
    const drops = { ...DROPS, pinboard: { ops: () => ({ center: "swap" }), apply: (spec, ids, d) => ({ ids, layout: { ...spec, last: d.id } }) } };
    const s = make({ type: "pinboard" });
    const out = update(s, { type: "window/drop", id: "a", target: "b", zone: "center" }, { "window/drop": createDropHandler(drops) });
    assert.equal(out.state.workspaces.main.layout.last, "a");
    assert.equal(reason(update(s, { type: "window/drop", id: "a", target: "b", zone: "left" }, { "window/drop": createDropHandler(drops) })), "unknown-zone");
  });
});

describe("keyboard equivalents", () => {
  test("swap-next / swap-previous wrap around the tiled order", () => {
    const s = update(make({ type: "columns" }), { type: "window/focus", id: "d" }).state;
    assert.equal(order(update(s, { type: "window/swap-next" }).state), "dbca");
    assert.equal(order(update(s, { type: "window/swap-previous", id: "b" }).state), "bacd");
  });

  test("move-before / move-after step one slot, or relative to a target", () => {
    const s = make({ type: "columns" });
    assert.equal(order(update(s, { type: "window/move-after", id: "a" }).state), "bacd");
    assert.equal(order(update(s, { type: "window/move-before", id: "c" }).state), "acbd");
    assert.equal(update(s, { type: "window/move-before", id: "a" }).state, s); // already first
    assert.equal(order(update(s, { type: "window/move-before", id: "d", target: "a" }).state), "dabc");
    assert.deepEqual(update(s, { type: "window/move-after", id: "a", target: "c" }).events, [{ type: "window/reordered", id: "a", target: "c", position: "after" }]);
    assert.equal(reason(update(s, { type: "window/move-after", id: "a", target: "a" })), "same-window");
    assert.equal(reason(update(s, { type: "window/move-after", id: "zz" })), "unknown-window");
  });

  test("BSP: swap-next follows leaf order; move-after splits the neighbour along its split", () => {
    const s = make({ type: "bsp" });
    const t = (st) => st.workspaces.main.layout.tree;
    const swapped = update(s, { type: "window/swap-next", id: "a" }).state;
    assert.deepEqual(bspIds(t(swapped)), ["b", "a", "c", "d"]);
    const moved = update(s, { type: "window/move-after", id: "a", target: "d" }).state;
    assert.deepEqual(bspIds(t(moved)), ["b", "c", "d", "a"]);
  });

  test("the manager exposes them; commands are listed", () => {
    for (const type of ["window/drop", "window/swap-next", "window/swap-previous", "window/move-before", "window/move-after", "window/set-draggable"]) {
      assert.ok(COMMANDS.includes(type), type);
    }
    const wm = createWindowManager({ state: createState({ layout: { type: "columns" } }) });
    IDS.forEach((id) => wm.create({ id }));
    wm.swapNext("a");
    wm.swapPrevious("a");
    wm.moveAfter("a");
    wm.moveBefore("a", "d");
    wm.setDraggable("a", false);
    assert.equal(order(wm.state), "bcad");
    assert.equal(wm.state.windows.a.draggable, false);
  });
});

describe("dropZoneAt", () => {
  const r = { x: 100, y: 100, width: 200, height: 100 };
  test("edges within the edge band, center otherwise, null outside", () => {
    assert.equal(dropZoneAt(r, { x: 200, y: 150 }), "center");
    assert.equal(dropZoneAt(r, { x: 110, y: 150 }), "left");
    assert.equal(dropZoneAt(r, { x: 290, y: 150 }), "right");
    assert.equal(dropZoneAt(r, { x: 200, y: 105 }), "top");
    assert.equal(dropZoneAt(r, { x: 200, y: 195 }), "bottom");
    assert.equal(dropZoneAt(r, { x: 50, y: 150 }), null);
  });
  test("corners pick the nearer edge; the band is configurable", () => {
    assert.equal(dropZoneAt(r, { x: 102, y: 110 }), "left"); // 1% from left vs 10% from top
    assert.equal(dropZoneAt(r, { x: 140, y: 101 }), "top");
    assert.equal(dropZoneAt(r, { x: 130, y: 150 }, 0.1), "center");
    assert.equal(dropZoneAt(r, { x: 130, y: 150 }, 0.2), "left");
    assert.equal(dropZoneAt(r, { x: 199, y: 150 }, 0), "center");
  });
  test("zoneRect covers the half of the target a zone refers to", () => {
    assert.deepEqual(zoneRect(r, "left"), { x: 100, y: 100, width: 100, height: 100 });
    assert.deepEqual(zoneRect(r, "bottom"), { x: 100, y: 150, width: 200, height: 50 });
    assert.deepEqual(zoneRect(r, "center"), r);
  });
});

describe("dropTargetAt", () => {
  const geo = {
    a: { x: 0, y: 0, width: 100, height: 100 },
    b: { x: 100, y: 0, width: 100, height: 100 },
    c: { x: 200, y: 0, width: 100, height: 100 },
    d: { x: 300, y: 0, width: 100, height: 100 },
  };
  test("finds the window and zone under the pointer", () => {
    const s = make({ type: "columns" });
    assert.deepEqual(dropTargetAt(s, geo, { x: 150, y: 50 }, "a"), { target: "b", zone: "center", op: "swap" });
    assert.deepEqual(dropTargetAt(s, geo, { x: 105, y: 50 }, "a"), { target: "b", zone: "left", op: "before" });
    assert.deepEqual(dropTargetAt(s, geo, { x: 395, y: 50 }, "a"), { target: "d", zone: "right", op: "after" });
    assert.equal(dropTargetAt(s, geo, { x: 50, y: 50 }, "a"), null); // over itself
    assert.equal(dropTargetAt(s, geo, { x: 500, y: 50 }, "a"), null); // outside
  });
  test("respects edgeZone, mode fallbacks and pinned targets", () => {
    const narrow = make({ type: "columns" }, { config: { drag: { edgeZone: 0.02 } } });
    assert.equal(dropTargetAt(narrow, geo, { x: 105, y: 50 }, "a").zone, "center");
    const swap = make({ type: "columns" }, { config: { drag: { tiled: "swap" } } });
    assert.deepEqual(dropTargetAt(swap, geo, { x: 105, y: 50 }, "a"), { target: "b", zone: "center", op: "swap" });
    const insert = make({ type: "columns" }, { config: { drag: { tiled: "insert" } } });
    assert.deepEqual(dropTargetAt(insert, geo, { x: 160, y: 50 }, "a"), { target: "b", zone: "right", op: "after" });
    assert.deepEqual(dropTargetAt(insert, geo, { x: 150, y: 2 }, "a").op, "before"); // top is a swap: nearest insert edge wins
    const pinned = update(make({ type: "columns" }), { type: "window/set-draggable", id: "b", draggable: false }).state;
    assert.equal(dropTargetAt(pinned, geo, { x: 150, y: 50 }, "a").op !== "swap", true);
    assert.equal(dropTargetAt(pinned, geo, { x: 50, y: 50 }, "b"), null); // pinned windows do not drag
    const off = make({ type: "columns", drag: "off" });
    assert.equal(dropTargetAt(off, geo, { x: 150, y: 50 }, "a"), null);
  });
  test("a floating window covering the point blocks the drop", () => {
    const s = update(make({ type: "columns" }), { type: "window/create", id: "f", mode: "floating" }).state;
    const withFloat = { ...geo, f: { x: 120, y: 20, width: 40, height: 40 } };
    assert.equal(dropTargetAt(s, withFloat, { x: 130, y: 30 }, "a"), null);
    assert.equal(dropTargetAt(s, withFloat, { x: 180, y: 80 }, "a").target, "b");
  });
  test("hidden stack children are not targets", () => {
    const s = update(make({ type: "monocle" }), { type: "window/focus", id: "c" }).state;
    const stacked = Object.fromEntries(IDS.map((id) => [id, { x: 0, y: 0, width: 400, height: 100 }]));
    assert.equal(dropTargetAt(s, stacked, { x: 200, y: 50 }, "a")?.target, "c");
    assert.equal(dropTargetAt(s, stacked, { x: 200, y: 50 }, "c"), null);
  });
  test("blocked windows neither drag nor accept drops", () => {
    const s = update(make({ type: "columns" }), { type: "window/create", id: "m", role: "dialog", modal: true, parent: "b", focus: false }).state;
    assert.equal(dropTargetAt(s, geo, { x: 150, y: 50 }, "a"), null);
    assert.equal(dropTargetAt(s, geo, { x: 50, y: 50 }, "b"), null);
  });
});

describe("previewDrop", () => {
  const deepFreeze = (value) => {
    if (value && typeof value === "object" && !Object.isFrozen(value)) {
      Object.freeze(value);
      Object.values(value).forEach(deepFreeze);
    }
    return value;
  };
  test("returns the hypothetical next state without touching the input", () => {
    const s = deepFreeze(make({ type: "columns" }));
    const before = JSON.stringify(s);
    const next = previewDrop(s, { id: "d", target: "b", zone: "left" });
    assert.equal(order(next), BEFORE);
    assert.equal(JSON.stringify(s), before);
    assert.deepEqual(next, drop(s, "d", "b", "left").state);
  });
  test("null for rejected drops or no drop", () => {
    const s = make({ type: "columns" });
    assert.equal(previewDrop(s, { id: "a", target: "a", zone: "center" }), null);
    assert.equal(previewDrop(s, null), null);
  });
});
