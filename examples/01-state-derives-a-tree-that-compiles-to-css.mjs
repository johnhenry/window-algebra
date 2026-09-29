// The pure pipeline, end to end, with no DOM:
//   command -> update -> state -> derive -> layout tree -> compile -> render tree -> HTML
// Tiled windows get no pixel rectangles: the compiled output is flex/grid
// declarations, and the browser does the arithmetic.
import assert from "node:assert/strict";
import { createState, update, derive, compile, presentationContext, toHTML, views } from "@johnhenry/window-algebra";

let state = createState({ layout: { type: "master-stack", ratio: 0.6 }, config: { gap: 8 } });

for (const id of ["editor", "terminal", "browser"]) {
  const out = update(state, { type: "window/create", id, title: id[0].toUpperCase() + id.slice(1) });
  // Events record what happened; effects are values for the effectful shell to run.
  assert.deepEqual(out.events.map((e) => e.type).slice(0, 1), ["window/created"]);
  assert.ok(out.effects.some((e) => e.type === "render"));
  state = out.state;
}

// update() is pure: the old state was never touched.
assert.equal(Object.keys(createState().windows).length, 0);

// derive: state -> a JSON layout-algebra tree (an overlay over the tiled base).
const tree = derive(state);
assert.equal(tree.type, "overlay");
assert.deepEqual(views(tree), ["editor", "terminal", "browser"]);
assert.doesNotThrow(() => JSON.stringify(tree));

// compile: tree -> render tree of { tag, key, attrs, style, children }.
const render = compile(tree, presentationContext(state));
const html = toHTML(render);

// The master takes 0.6 of the row as a flex weight, not as pixels.
assert.match(html, /flex: 0\.6 1 0/);
assert.match(html, /flex: 0\.4 1 0/);
// Every view is a size container, keyed by window id so the DOM element survives layout changes.
assert.match(html, /<wm-view[^>]*data-view="editor"/);
assert.match(html, /container-type: size/);
// The configured gap wraps every container.
assert.match(html, /gap: 8px/);
// The last-created window has WM focus.
assert.match(html, /data-view="browser"[^>]*data-focused/);

// Switch layouts: same windows, a different tree, still no pixels.
state = update(state, { type: "layout/set", layout: { type: "grid", min: 240 } }).state;
const grid = toHTML(compile(derive(state), presentationContext(state)));
assert.match(grid, /grid-template-columns: repeat\(auto-fit, minmax\(240px, 1fr\)\)/);

console.log("01 ok: update -> derive -> compile produced flex weights and grid tracks, not pixels");
