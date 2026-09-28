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
  compile,
  toHTML,
  tracks,
  anchorName,
  styleText,
  masterStack,
  columns,
  rows,
  fixedGrid,
  spiral,
  bspFrom,
  bspSetRatio,
  bspToLayout,
  SPLITTER_SIZE,
} from "../src/index.mjs";

const viewNodes = (node, out = []) => {
  if (node.view !== undefined) out.push(node);
  node.children.forEach((child) => viewNodes(child, out));
  return out;
};

describe("compile: tree → CSS declarations", () => {
  test("row/column become flex; weights become flex-grow", () => {
    const out = compile(row({}, size({ weight: 2 }, view("a")), size({ weight: 1 }, view("b"))));
    assert.equal(out.tag, "wm-row");
    assert.equal(out.style.display, "flex");
    assert.equal(out.style["flex-direction"], "row");
    assert.equal(out.children[0].style.flex, "2 1 0");
    assert.equal(out.children[1].style.flex, "1 1 0");
  });

  test("master-stack ratio 0.65 is expressed as flex weights, not pixels", () => {
    const out = compile(masterStack({ ratio: 0.65 }, ["a", "b", "c"]));
    // A splitter (fixed px thickness) sits between the master and the rest.
    assert.equal(out.children[0].style.flex, "0.65 1 0");
    assert.equal(out.children[1].tag, "wm-splitter");
    assert.equal(out.children[2].style.flex, "0.35 1 0");
    const withoutSplitters = { ...out, children: out.children.filter((child) => child.tag !== "wm-splitter") };
    assert.ok(!JSON.stringify(withoutSplitters).includes("px"));
  });

  test("fixed sizes along the main axis stop flexing", () => {
    const out = compile(row({}, size({ width: 240 }, view("side")), view("main")));
    assert.equal(out.children[0].style.flex, "0 0 auto");
    assert.equal(out.children[0].style.width, "240px");
    const col = compile(column({}, size({ height: "content", min: 40 }, view("bar"))));
    assert.equal(col.children[0].style.height, "max-content");
    assert.equal(col.children[0].style["min-height"], "40px");
  });

  test("container options map to alignment", () => {
    const out = compile(row({ align: "center", distribute: "space-between" }, view("a")));
    assert.equal(out.style["align-items"], "center");
    assert.equal(out.style["justify-content"], "space-between");
  });

  test("grid tracks and placement", () => {
    assert.equal(tracks(3), "repeat(3, minmax(0, 1fr))");
    assert.equal(tracks({ repeat: "auto-fit", min: 300, max: "1fr" }), "repeat(auto-fit, minmax(300px, 1fr))");
    assert.equal(tracks([2, 1, "200px"]), "2fr 1fr 200px");
    const out = compile(
      grid({ columns: 3, rows: 2, areas: ["side main", "side bottom"] }, place({ column: "1 / 3", row: 1 }, view("a")), place({ area: "side" }, view("b"))),
    );
    assert.equal(out.style.display, "grid");
    assert.equal(out.style["grid-template-areas"], '"side main" "side bottom"');
    assert.equal(out.children[0].style["grid-column"], "1 / 3");
    assert.equal(out.children[1].style["grid-area"], "side");
  });

  test("stack shares one cell; inactive children are hidden and inert but stay mounted", () => {
    const out = compile(stack({ active: "b" }, view("a"), view("b")));
    const [a, b] = out.children;
    assert.equal(a.style["grid-area"], "1 / 1");
    assert.equal(b.style["grid-area"], "1 / 1");
    assert.equal(a.style.visibility, "hidden");
    assert.equal(a.attrs.inert, "");
    assert.equal(b.style.visibility, undefined);
  });

  test("tabs chrome renders a tab strip that is not a window", () => {
    const out = compile(stack({ active: "a", chrome: "tabs" }, view("a"), view("b")), { titles: { a: "Terminal" } });
    const strip = out.children[0];
    assert.equal(strip.tag, "wm-tabs");
    assert.deepEqual(
      strip.children.map((b) => [b.attrs["data-wm-tab"], b.attrs["aria-selected"], b.text]),
      [
        ["a", "true", "Terminal"],
        ["b", "false", "b"],
      ],
    );
    assert.equal(out.children[1].style["grid-area"], "2 / 1");
  });

  test("overlay layers; numeric place uses translate", () => {
    const out = compile(overlay({}, view("base"), place({ x: 300, y: 200 }, size({ width: 500, height: 300 }, view("f")))));
    const f = out.children[1];
    assert.equal(f.style.position, "absolute");
    assert.equal(f.style.translate, "300px 200px");
    assert.equal(f.style.width, "500px");
    assert.equal(f.style["z-index"], "1");
    assert.equal(out.children[0].style["z-index"], "0");
  });

  test("place with edges and keyword alignment", () => {
    const out = compile(overlay({}, place({ right: 16, bottom: 16 }, view("pip")), place({ x: "center", y: "center" }, view("dlg"))));
    assert.equal(out.children[0].style.right, "16px");
    assert.equal(out.children[0].style.position, "absolute");
    assert.equal(out.children[1].style["justify-self"], "center");
    assert.equal(out.children[1].style.position, "relative");
  });

  test("anchor uses CSS anchor positioning and names the target", () => {
    const out = compile(
      overlay({}, view("editor"), anchor({ to: "editor", side: "bottom", align: "start", offset: 8 }, view("menu"))),
    );
    const [editor, menu] = out.children;
    assert.equal(editor.style["anchor-name"], anchorName("editor"));
    assert.equal(menu.style["position-anchor"], "--wm-editor");
    assert.equal(menu.style["position-area"], "bottom span-right");
    assert.equal(menu.style["margin-top"], "8px");
    assert.equal(menu.attrs["data-wm-anchor"], "editor");
    assert.equal(anchorName("a b/c"), "--wm-a_b_c");
  });

  test("anchor flip defaults to both axes; an empty flip array omits the fallback", () => {
    const both = compile(overlay({}, view("editor"), anchor({ to: "editor", side: "bottom" }, view("menu"))));
    assert.equal(both.children[1].style["position-try-fallbacks"], "flip-block, flip-inline");

    const none = compile(overlay({}, view("editor"), anchor({ to: "editor", side: "bottom", flip: [] }, view("menu"))));
    assert.equal(none.children[1].style["position-try-fallbacks"], undefined);

    const yOnly = compile(overlay({}, view("editor"), anchor({ to: "editor", side: "bottom", flip: ["y"] }, view("menu"))));
    assert.equal(yOnly.children[1].style["position-try-fallbacks"], "flip-block");
  });

  test("a gravity opposite the anchor side changes position-area; a same-side gravity is ignored", () => {
    const flipped = compile(
      overlay({}, view("editor"), anchor({ to: "editor", side: "bottom", align: "start", gravity: "top" }, view("menu"))),
    );
    assert.equal(flipped.children[1].style["position-area"], "top span-right");

    const ignored = compile(
      overlay({}, view("editor"), anchor({ to: "editor", side: "bottom", align: "start", gravity: "bottom" }, view("menu"))),
    );
    assert.equal(ignored.children[1].style["position-area"], "bottom span-right");
  });

  test("side-mode anchors carry their positioner options for the JS fallback; inside-mode anchors do not", () => {
    const sideMode = compile(
      overlay(
        {},
        view("editor"),
        anchor({ to: "editor", side: "left", align: "end", offset: 6, gravity: "right", flip: ["x"], slide: ["y"], resize: ["y"] }, view("menu")),
      ),
    );
    assert.deepEqual(JSON.parse(sideMode.children[1].attrs["data-wm-anchor-opts"]), {
      side: "left",
      align: "end",
      offset: 6,
      gravity: "right",
      flip: ["x"],
      slide: ["y"],
      resize: ["y"],
    });

    const insideMode = compile(overlay({}, view("editor"), anchor({ to: "editor", inside: true, side: "top" }, view("sheet"))));
    assert.equal(insideMode.children[1].attrs["data-wm-anchor-opts"], undefined);
  });

  test("gap and inset map to CSS gap and padding", () => {
    const out = compile(inset({ all: 16 }, gap({ all: 8 }, row({}, view("a"), view("b")))));
    assert.equal(out.style.gap, "8px");
    assert.equal(out.style.padding, "16px");
    const sides = compile(inset({ top: 1, x: 2 }, view("a")));
    assert.equal(sides.style.padding, "1px 2px 0px 2px");
  });

  test("views are size containers keyed by id with focus/blocked/role attributes", () => {
    const out = compile(row({}, view("a"), view("b")), {
      focused: "a",
      blocked: ["b"],
      roles: { a: "window" },
      titles: { a: "Editor" },
    });
    const [a, b] = viewNodes(out);
    assert.equal(a.key, "view:a");
    assert.equal(a.style["container-type"], "size");
    assert.equal(a.attrs["data-focused"], "");
    assert.equal(a.attrs["aria-label"], "Editor");
    // Blocked views are marked, not inert: an inert element is skipped by
    // hit-testing, so clicks would fall through to the window underneath.
    assert.equal(b.attrs["data-wm-blocked"], "");
    assert.equal(b.attrs.inert, undefined);
  });

  test("urgent windows are marked on the view and in the tab strip", () => {
    const out = compile(row({}, view("a"), view("b")), { urgent: ["b"] });
    const [a, b] = viewNodes(out);
    assert.equal(a.attrs["data-wm-urgent"], undefined);
    assert.equal(b.attrs["data-wm-urgent"], "");

    const tabbed = compile(stack({ chrome: "tabs", active: "a" }, view("a"), view("b")), { urgent: ["b"] });
    const tabs = tabbed.children.find((child) => child.tag === "wm-tabs");
    const [tabA, tabB] = tabs.children;
    assert.equal(tabA.attrs["data-wm-urgent"], undefined);
    assert.equal(tabB.attrs["data-wm-urgent"], "");
  });

  test("a view appearing twice becomes a primary plus a projection", () => {
    const [first, second] = viewNodes(compile(row({}, view("logs"), view("logs"))));
    assert.equal(first.key, "view:logs");
    assert.equal(first.primary, true);
    assert.equal(second.key, "view:logs#2");
    assert.equal(second.primary, false);
    assert.equal(second.attrs["data-view-projection"], "2");
  });

  test("view keys are stable across layout changes (element reuse)", () => {
    const keys = (tree) => viewNodes(compile(tree)).map((n) => n.key).sort();
    assert.deepEqual(keys(masterStack({}, ["a", "b", "c"])), keys(stack({ active: "a" }, view("a"), view("b"), view("c"))));
  });
});

describe("toHTML", () => {
  test("renders escaped markup with inline styles and slots", () => {
    const html = toHTML(compile(row({}, view("a")), { titles: { a: 'x"<y>' } }), { slot: (id) => `<p>${id}</p>` });
    assert.match(html, /^<wm-row data-layout="row" style="[^"]*display: flex/);
    assert.match(html, /aria-label="x&quot;&lt;y&gt;"/);
    assert.match(html, /<p>a<\/p><\/wm-view>/);
  });

  test("styleText skips empty values", () => {
    assert.equal(styleText({ a: "1", b: "", c: undefined }), "a: 1");
  });
});

describe("compile: resizable-split splitters", () => {
  test("a row/column with N children carries N-1 splitters, addressed and valued from resize.weights", () => {
    const out = compile(columns({}, ["a", "b", "c"]));
    const splitters = out.children.filter((child) => child.tag === "wm-splitter");
    assert.equal(splitters.length, 2);
    for (const s of splitters) {
      assert.equal(s.attrs.role, "separator");
      assert.equal(s.attrs["aria-orientation"], "vertical"); // a row's splitter bar stands vertical
      assert.equal(s.attrs["data-wm-count"], "3");
      assert.equal(s.attrs["aria-valuenow"], "50"); // equal default weights
      assert.equal(s.attrs.tabindex, "0");
      assert.equal(s.style.flex, `0 0 ${SPLITTER_SIZE}px`);
    }
    assert.deepEqual(splitters.map((s) => s.attrs["data-wm-index"]), ["0", "1"]);
    assert.equal(out.children[0].view, "a");
    assert.equal(out.children[1].tag, "wm-splitter");
    assert.equal(out.children[2].view, "b");
    assert.equal(out.children[3].tag, "wm-splitter");
    assert.equal(out.children[4].view, "c");

    // `rows` is the column orientation: a horizontal splitter bar.
    const rowsOut = compile(rows({}, ["a", "b"]));
    assert.equal(rowsOut.children[1].attrs["aria-orientation"], "horizontal");

    // Custom sizes change aria-valuenow accordingly.
    const resized = compile(columns({ sizes: { "": [3, 1] } }, ["a", "b"]));
    assert.equal(resized.children[1].attrs["aria-valuenow"], "75");
  });

  test("a single child gets no splitter", () => {
    const out = compile(columns({}, ["a"]));
    assert.equal(out.children.some((c) => c.tag === "wm-splitter"), false);
  });

  test("master-stack, bsp and spiral splits each carry exactly one splitter, addressed by path", () => {
    const master = compile(masterStack({ ratio: 0.65 }, ["a", "b", "c"]));
    assert.equal(master.children[1].attrs["data-wm-path"], "");
    assert.equal(master.children[1].attrs["aria-valuenow"], "65");

    const bsp = compile(bspToLayout(bspSetRatio(bspFrom(["a", "b"]), "b", 0.4)));
    const splitter = bsp.children.find((c) => c.tag === "wm-splitter");
    assert.equal(splitter.attrs["data-wm-path"], "");
    assert.equal(splitter.attrs["aria-valuenow"], "40");

    const nested = compile(spiral({}, ["a", "b", "c"]));
    const outer = nested.children.find((c) => c.tag === "wm-splitter");
    assert.equal(outer.attrs["data-wm-path"], "0");
    // spiral's second level is a column nested inside the row; it has its own splitter.
    const innerColumn = nested.children.find((c) => c.tag === "wm-column");
    const innerSplitter = innerColumn?.children.find((c) => c.tag === "wm-splitter");
    assert.equal(innerSplitter?.attrs["data-wm-path"], "1");
  });

  test("fixedGrid does not render splitters (grid track resizing is not yet supported)", () => {
    const out = compile(fixedGrid({ columns: 3 }, ["a", "b", "c"]));
    assert.equal(out.children.some((c) => c.tag === "wm-splitter"), false);
  });
});
