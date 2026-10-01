import { test, expect, settle, stateOf } from "./helpers.mjs";

const LAYOUTS = [
  ["master-stack", { type: "master-stack", ratio: 0.55 }],
  ["columns", { type: "columns" }],
  ["rows", { type: "rows" }],
  ["grid", { type: "grid", columns: 2 }],
  ["spiral", { type: "spiral" }],
  ["bsp", { type: "bsp" }],
  ["tree", { type: "tree" }],
  ["tabs", { type: "tabs" }],
  ["monocle", { type: "monocle" }],
];

/** Rects (relative to the stage) of every view, splitter and tab button. */
const measure = (page) =>
  page.evaluate(() => {
    const stage = document.getElementById("stage");
    const origin = stage.getBoundingClientRect();
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - origin.left, right: r.right - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
    };
    const out = { width: origin.width, views: {}, splitters: [], tabs: [] };
    for (const el of stage.querySelectorAll("wm-view[data-view]")) out.views[el.getAttribute("data-view")] = rect(el);
    for (const el of stage.querySelectorAll("[data-wm-splitter]")) out.splitters.push(rect(el));
    for (const el of stage.querySelectorAll("[data-wm-tab]")) out.tabs.push({ id: el.getAttribute("data-wm-tab"), ...rect(el) });
    return out;
  });

const setDirection = async (page, dir) => {
  await page.locator(`#${dir}`).click();
  await settle(page);
  await expect(page.locator("#stage")).toHaveAttribute("dir", dir);
  expect((await stateOf(page)).config.direction).toBe(dir);
  await settle(page);
};

const near = (a, b, tolerance = 1.5) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tolerance);

test.describe("right-to-left: every layout is the mirror image of its left-to-right self", () => {
  for (const [name, layout] of LAYOUTS) {
    test(name, async ({ demo, page }) => {
      await demo("rtl.html");
      await page.evaluate((spec) => window.wm.setLayout(spec), layout);
      await setDirection(page, "ltr");
      const ltr = await measure(page);
      await setDirection(page, "rtl");
      const rtl = await measure(page);
      expect(Object.keys(rtl.views).sort()).toEqual(Object.keys(ltr.views).sort());
      for (const id of Object.keys(ltr.views)) {
        const a = ltr.views[id];
        const b = rtl.views[id];
        near(b.left, ltr.width - a.right);
        near(b.width, a.width);
        near(b.top, a.top);
        near(b.height, a.height);
      }
      // Splitters and tab buttons mirror too.
      expect(rtl.splitters.length).toBe(ltr.splitters.length);
      ltr.splitters.forEach((s, i) => {
        near(rtl.splitters[i].left, ltr.width - s.right);
        near(rtl.splitters[i].top, s.top);
      });
      expect(rtl.tabs.map((t) => t.id)).toEqual(ltr.tabs.map((t) => t.id));
      ltr.tabs.forEach((t, i) => near(rtl.tabs[i].left, ltr.width - t.right));
      // The layouts that have a horizontal order really do change (not an identity "mirror").
      if (["master-stack", "columns", "grid", "spiral", "bsp", "tree", "tabs"].includes(name)) {
        const moved = Object.keys(ltr.views).some((id) => Math.abs(rtl.views[id].left - ltr.views[id].left) > 2) || ltr.tabs.some((t, i) => Math.abs(rtl.tabs[i].left - t.left) > 2);
        expect(moved).toBe(true);
      }
    });
  }

  test("master-stack: the master is on the right; columns: the first window is the rightmost", async ({ demo, page }) => {
    await demo("rtl.html");
    await page.evaluate(() => window.wm.setLayout({ type: "master-stack", ratio: 0.55 }));
    await settle(page);
    const [first] = (await stateOf(page)).workspaces.main.windows;
    let m = await measure(page);
    expect(m.views[first].left + m.views[first].width / 2).toBeGreaterThan(m.width / 2);
    await page.evaluate(() => window.wm.setLayout({ type: "columns" }));
    await settle(page);
    m = await measure(page);
    const state = await stateOf(page);
    const ids = state.workspaces.main.windows.filter((id) => state.windows[id].mode === "tiled");
    const lefts = ids.map((id) => m.views[id].left);
    expect(lefts).toEqual([...lefts].sort((x, y) => y - x));
  });
});

test.describe("right-to-left: interaction", () => {
  test.beforeEach(async ({ demo, page }) => {
    await demo("rtl.html");
    await page.evaluate(() => {
      const wm = window.wm;
      // keep the demo's floating window out of the tiled order
      wm.setLayout({ type: "columns" });
    });
    await settle(page);
  });

  const tiled = async (page) => {
    const state = await stateOf(page);
    return state.workspaces.main.windows.filter((id) => state.windows[id].mode === "tiled");
  };
  const handle = (page, id) => page.locator(`#stage wm-view[data-view="${id}"] [data-wm-handle="move"]`);

  test("dropping on the screen-left half of a window places the dragged one to its left, which is *after* it in layout order", async ({ page }) => {
    const [w0, w1, w2, w3] = await tiled(page);
    const from = await handle(page, w0).boundingBox();
    const m = await measure(page);
    const stageBox = await page.locator("#stage").boundingBox();
    const target = m.views[w2];
    // In RTL the title bar's buttons are on the left: press on its (right-hand) title text instead.
    const grabX = from.x + from.width - 50;
    await page.mouse.move(grabX, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(grabX - 30, from.y + from.height / 2 + 30, { steps: 4 });
    await page.mouse.move(stageBox.x + target.left + 12, stageBox.y + target.top + target.height / 2, { steps: 14 });
    const zone = page.locator("#stage [data-wm-drop-zone]");
    await expect(zone).toHaveAttribute("data-zone", "left");
    await expect(zone).toHaveAttribute("data-op", "after");
    await page.mouse.up();
    await settle(page);
    expect(await tiled(page)).toEqual([w1, w2, w0, w3]);
    const after = await measure(page);
    expect(after.views[w0].left).toBeLessThan(after.views[w2].left); // on screen it is to the left of w2
  });

  test("tab list arrows: the left arrow goes to the next tab (it is on the left)", async ({ page }) => {
    await page.evaluate(() => window.wm.setLayout({ type: "tabs" }));
    await settle(page);
    const tabs = page.locator("#stage [data-wm-tab]");
    const ids = await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-wm-tab")));
    const m = await measure(page);
    expect(m.tabs[0].left).toBeGreaterThan(m.tabs[1].left); // the first tab is the rightmost
    await tabs.first().focus();
    await page.keyboard.press("ArrowLeft");
    expect(await page.evaluate(() => document.activeElement.getAttribute("data-wm-tab"))).toBe(ids[1]);
    await page.keyboard.press("ArrowRight");
    expect(await page.evaluate(() => document.activeElement.getAttribute("data-wm-tab"))).toBe(ids[0]);
  });

  test("splitters: dragging the divider to the right shrinks the first (right-hand) pane; the arrows are swapped", async ({ page }) => {
    const [w0] = await tiled(page);
    const width = async () => (await measure(page)).views[w0].width;
    const before = await width();
    const splitter = page.locator("#stage [data-wm-splitter]").first();
    const box = await splitter.boundingBox();
    // The first splitter divides the two rightmost columns.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 30, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const afterDrag = await width();
    expect(afterDrag).toBeLessThan(before - 5);
    await page.locator("#stage [data-wm-splitter]").first().focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await settle(page);
    expect(await width()).toBeGreaterThan(afterDrag);
  });

  test("keyboard: Alt+Shift+Left moves the focused window left on screen, which is later in layout order", async ({ page }) => {
    const [w0, w1] = await tiled(page);
    await page.evaluate((id) => window.wm.focus(id), w0);
    await settle(page);
    await page.locator(`#stage wm-view[data-view="${w0}"]`).focus();
    await page.keyboard.press("Alt+Shift+ArrowLeft");
    await settle(page);
    expect((await tiled(page)).slice(0, 2)).toEqual([w1, w0]);
  });

  test("floating windows are placed from the right edge, and snap zones follow the pointer", async ({ page }) => {
    const floating = await page.evaluate(() => Object.values(window.wm.getState().windows).find((w) => w.mode === "floating").id);
    const m = await measure(page);
    const placement = (await stateOf(page)).windows[floating].placement;
    near(m.views[floating].left, m.width - placement.x - placement.width);

    // Drag it to the screen-left edge: the left half of the stage.
    const bar = await handle(page, floating).boundingBox();
    const stageBox = await page.locator("#stage").boundingBox();
    await page.mouse.move(bar.x + bar.width - 50, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(stageBox.x + 200, stageBox.y + 150, { steps: 6 });
    await page.mouse.move(stageBox.x + 4, stageBox.y + 150, { steps: 10 });
    await expect(page.locator("#stage [data-wm-drop-zone]")).toHaveAttribute("data-zone", "left");
    await page.mouse.up();
    await settle(page);
    const snapped = (await measure(page)).views[floating];
    near(snapped.left, 0, 2);
    near(snapped.width, m.width / 2, 2);
  });
});

test.describe("right-to-left: following the page's dir", () => {
  test("the stage's dir attribute drives config.direction; the compiled root carries it", async ({ demo, page }) => {
    await demo("rtl.html");
    await expect(page.locator("#stage > [data-layout]")).toHaveAttribute("dir", "rtl");
    await page.evaluate(() => document.getElementById("stage").setAttribute("dir", "ltr"));
    await expect.poll(async () => (await stateOf(page)).config.direction).toBe("ltr");
    await settle(page);
    await expect(page.locator("#stage > [data-layout]")).not.toHaveAttribute("dir", /./);
    await page.evaluate(() => document.getElementById("stage").setAttribute("dir", "rtl"));
    await expect.poll(async () => (await stateOf(page)).config.direction).toBe("rtl");
  });
});
