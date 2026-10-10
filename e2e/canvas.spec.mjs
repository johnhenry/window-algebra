import { test, expect, settle, stateOf } from "./helpers.mjs";

/**
 * canvas.html: floating panes inside a world the page pans and zooms with a CSS transform. `attachInput` and
 * `createDomRenderer` get `coordinates`, and the state has `config.bounds: "none"`. Real pointer input in every
 * engine: a dragged pane and a resize grip follow the cursor 1:1 on screen at any zoom.
 */
const view = (page, z, x, y) => page.evaluate(([z, x, y]) => window.canvas.setView(z, x, y), [z, x, y]);
const pane = (page, id) => page.locator(`#world wm-view[data-view="${id}"]`);
const placement = async (page, id) => (await stateOf(page)).windows[id].placement;

test.describe("an infinite, zoomable canvas (canvas.html)", () => {
  test.beforeEach(async ({ demo, page }) => {
    await demo("canvas.html");
    await settle(page);
  });

  for (const z of [0.5, 2]) {
    test(`zoom ${z}: dragging a title bar moves the pane exactly as far as the cursor`, async ({ page }) => {
      await view(page, z, 20 - 40 * z, 20 - 140 * z); // cell3 (40, 140) near the viewport's top-left corner
      await page.evaluate(() => window.wm.dispatch({ type: "config/set", snap: { magnet: 0 } }));
      await settle(page);
      const before = await pane(page, "cell3").boundingBox();
      const start = await placement(page, "cell3");
      const bar = await pane(page, "cell3").locator('[data-wm-handle="move"]').boundingBox();
      const from = { x: bar.x + Math.min(30, bar.width / 3), y: bar.y + bar.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 60, from.y + 20, { steps: 4 });
      await page.mouse.move(from.x + 120, from.y + 40, { steps: 4 });
      await page.mouse.up();
      await settle(page);
      const after = await pane(page, "cell3").boundingBox();
      expect(after.x - before.x).toBeCloseTo(120, 0);
      expect(after.y - before.y).toBeCloseTo(40, 0);
      const end = await placement(page, "cell3");
      expect(end.x - start.x).toBeCloseTo(120 / z, 1);
      expect(end.y - start.y).toBeCloseTo(40 / z, 1);
      // One gesture, one undo step.
      await page.evaluate(() => window.wm.undo());
      expect(await placement(page, "cell3")).toEqual(start);
    });

    test(`zoom ${z}: the south-east grip follows the cursor`, async ({ page }) => {
      await view(page, z, 20 - 40 * z, 20 - 140 * z);
      await settle(page);
      const before = await pane(page, "cell3").boundingBox();
      const start = await placement(page, "cell3");
      const grip = await pane(page, "cell3").locator('[data-wm-handle="resize-se"]').boundingBox();
      const from = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(from.x + 50, from.y + 30, { steps: 6 });
      await page.mouse.up();
      await settle(page);
      const after = await pane(page, "cell3").boundingBox();
      expect(after.width - before.width).toBeCloseTo(50, 0);
      expect(after.height - before.height).toBeCloseTo(30, 0);
      const end = await placement(page, "cell3");
      expect(end.width - start.width).toBeCloseTo(50 / z, 1);
      expect(end.height - start.height).toBeCloseTo(30 / z, 1);
      expect([end.x, end.y]).toEqual([start.x, start.y]);
    });
  }

  test("the wheel zooms around the cursor; dragging empty space pans; neither moves a pane in the world", async ({ page }) => {
    const box = await page.locator("#viewport").boundingBox();
    const at = { x: box.x + box.width - 60, y: box.y + box.height - 40 }; // empty space
    const under = () => page.evaluate(([x, y]) => window.canvas.coordinates.toStage(x, y), [at.x, at.y]);
    const p0 = await under();
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => page.evaluate(() => window.canvas.view.z)).toBeGreaterThan(1.2);
    const p1 = await under();
    expect(p1.x).toBeCloseTo(p0.x, 1);
    expect(p1.y).toBeCloseTo(p0.y, 1);

    const start = await placement(page, "cell1");
    const before = await pane(page, "cell1").boundingBox();
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x - 80, at.y - 50, { steps: 5 });
    await page.mouse.up();
    await settle(page);
    const after = await pane(page, "cell1").boundingBox();
    expect(after.x - before.x).toBeCloseTo(-80, 0);
    expect(after.y - before.y).toBeCloseTo(-50, 0);
    expect(await placement(page, "cell1")).toEqual(start);
  });

  test("bounds none: a pane dragged over the stage's top edge is not maximized or snapped, and goes negative", async ({ page }) => {
    await view(page, 1, 300, 120);
    await settle(page);
    const world = await page.locator("#world").evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y };
    });
    const bar = await pane(page, "cell3").locator('[data-wm-handle="move"]').boundingBox();
    const from = { x: bar.x + 30, y: bar.y + bar.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Over the world's own top-left corner (where a bounded stage has its snap zones), then well past it.
    await page.mouse.move(world.x + 2, world.y + 2, { steps: 8 });
    await expect(page.locator("#world [data-wm-drop-zone]")).toHaveCount(0);
    await page.mouse.move(world.x - 150, world.y - 120, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    const state = await stateOf(page);
    expect(state.windows.cell3.status).toBe("normal");
    expect(state.windows.cell3.placement.x).toBeLessThan(-100);
    expect(state.windows.cell3.placement.y).toBeLessThan(-100);
    // Far outside the world element's box, and still painted (the root does not clip it).
    const box = await pane(page, "cell3").boundingBox();
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("wm-view")?.getAttribute("data-view"), [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit).toBe("cell3");
  });

  test("bounded again (config/set bounds: stage), the top edge maximizes as before", async ({ page }) => {
    await page.locator("#bounded").check();
    await view(page, 1, 0, 80); // a bounded root clips: cell3 (40, 140) is inside its box
    await settle(page);
    const world = await page.locator("#world").boundingBox();
    const bar = await pane(page, "cell3").locator('[data-wm-handle="move"]').boundingBox();
    await page.mouse.move(bar.x + 30, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(world.x + world.width / 2, world.y + 4, { steps: 10 });
    await expect(page.locator("#world [data-wm-drop-zone]")).toHaveAttribute("data-zone", "maximize");
    await page.mouse.up();
    await settle(page);
    const p = await placement(page, "cell3");
    expect([p.x, p.y]).toEqual([0, 0]);
    expect(p.width).toBeCloseTo(world.width, 0);
  });
});
