// Tiled windows own no geometry, so dragging one edits logical structure:
// the workspace order, a BSP tree or a docking tree. What a drop zone means
// depends on the layout, through the DROPS registry of drop interpreters.
import assert from "node:assert/strict";
import { createState, update, previewDrop, bspIds, treeIds, orderDrops, createDropHandler, DROPS } from "@johnhenry/window-algebra";

const withWindows = (layout, ids = ["a", "b", "c"]) =>
  ids.reduce((s, id) => update(s, { type: "window/create", id }).state, createState({ layout }));
const order = (s) => s.workspaces.main.windows;
const drop = (s, id, target, zone) => update(s, { type: "window/drop", id, target, zone });
const reasonOf = (out) => out.events.find((e) => e.type === "command/rejected")?.reason;

// columns: left = insert before, right = insert after, center = swap.
let s = withWindows({ type: "columns" });
assert.deepEqual(order(drop(s, "c", "a", "left").state), ["c", "a", "b"]);
assert.deepEqual(order(drop(s, "a", "c", "right").state), ["b", "c", "a"]);
assert.deepEqual(order(drop(s, "a", "c", "center").state), ["c", "b", "a"]);
const event = drop(s, "c", "a", "left").events[0];
assert.deepEqual(event, { type: "window/dropped", id: "c", target: "a", zone: "left", op: "before", workspace: "main" });

// rows read vertically: top = before.
s = withWindows({ type: "rows" });
assert.deepEqual(order(drop(s, "c", "a", "top").state), ["c", "a", "b"]);

// bsp: an edge splits the target on that side.
s = withWindows({ type: "bsp" });
const bsp = drop(s, "c", "a", "left");
assert.equal(bsp.events[0].op, "split");
assert.deepEqual(bspIds(bsp.state.workspaces.main.layout.tree), ["c", "a", "b"]);

// docking tree: center adds the dragged window as a tab beside the target.
s = withWindows({ type: "tree" });
const tabbed = drop(s, "c", "a", "center").state.workspaces.main.layout.tree;
assert.deepEqual(treeIds(tabbed), ["a", "c", "b"]);
assert.ok(JSON.stringify(tabbed).includes('"type":"tabs"'));

// A modifier that reflects the layout also reflects what the zones mean.
s = withWindows({ type: "columns", modifiers: [{ type: "reflect-x" }] });
assert.equal(drop(s, "c", "a", "left").events[0].op, "after");

// Settings: config.drag.tiled = "swap" forbids inserts; pinned windows refuse to move.
s = update(withWindows({ type: "columns" }), { type: "config/set", drag: { tiled: "swap" } }).state;
assert.equal(reasonOf(drop(s, "c", "a", "left")), "zone-disabled");
s = update(withWindows({ type: "columns" }), { type: "window/set-draggable", id: "c", draggable: false }).state;
assert.equal(reasonOf(drop(s, "c", "a", "left")), "not-draggable");

// previewDrop is just update() on immutable state: the hypothetical next state, or null.
s = withWindows({ type: "columns" });
assert.deepEqual(order(previewDrop(s, { id: "c", target: "a", zone: "left" })), ["c", "a", "b"]);
assert.equal(previewDrop(s, { id: "a", target: "a", zone: "left" }), null); // same-window

// Custom layouts get a custom interpreter: here "y" means top/bottom insert.
const handler = createDropHandler({ ...DROPS, stacked: orderDrops(() => "y") });
s = withWindows({ type: "stacked" });
assert.deepEqual(order(handler(s, { type: "window/drop", id: "c", target: "a", zone: "top" }).state), ["c", "a", "b"]);

console.log("03 ok: the same zone means insert, swap, split or tab depending on the layout");
