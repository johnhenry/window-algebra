import { test, expect, settle, stateOf, rectOf } from "./helpers.mjs";

const order = async (page) => {
  const state = await stateOf(page);
  return state.workspaces[state.activeWorkspace].windows;
};

test.describe("drag and drop with real pointer events (basic.html)", () => {
  test.beforeEach(async ({ demo, page }) => {
    await demo("basic.html");
    await page.evaluate(() => window.wm.setLayout({ type: "columns" }));
    await settle(page);
  });

  const handleOf = (page, id) => page.locator(`#desktop wm-view[data-view="${id}"] [data-wm-handle="move"]`);

  test("dragging a title bar onto the right edge of another window docks it after that window, in one undo step", async ({ page }) => {
    const [a, b, c] = await order(page);
    expect([a, b, c].every(Boolean)).toBe(true);
    const from = await (await handleOf(page, a).boundingBox());
    const target = await rectOf(page, c, "#desktop");
    const mouse = page.mouse;
    await mouse.move(from.x + 40, from.y + from.height / 2);
    await mouse.down();
    await mouse.move(from.x + 80, from.y + from.height / 2 + 20, { steps: 4 });
    // Over the right edge zone of c (the outer quarter of its width).
    await mouse.move(target.x + target.width - 12, target.y + target.height / 2, { steps: 12 });

    // Mid-drag: the overlay shields the page, the drop zone is highlighted, a ghost previews the result.
    await expect(page.locator("#desktop [data-wm-drag-overlay]")).toHaveCount(1);
    const zone = page.locator("#desktop [data-wm-drop-zone]");
    await expect(zone).toHaveAttribute("data-zone", "right");
    await expect(zone).toHaveAttribute("data-target", c);
    await expect(page.locator("#desktop [data-wm-ghost]").first()).toBeVisible();

    await mouse.up();
    await settle(page);
    expect(await order(page)).toEqual([b, c, a]);
    await expect(page.locator("#desktop [data-wm-drag-overlay]")).toHaveCount(0);

    // One gesture is one history step.
    await page.evaluate(() => window.wm.undo());
    expect(await order(page)).toEqual([a, b, c]);
  });

  test("the left edge inserts before; the center swaps", async ({ page }) => {
    const [a, b, c] = await order(page);
    const drag = async (id, target, dx) => {
      const from = await handleOf(page, id).boundingBox();
      const to = await rectOf(page, target, "#desktop");
      await page.mouse.move(from.x + 40, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + 80, from.y + from.height / 2 + 20, { steps: 4 });
      await page.mouse.move(to.x + dx, to.y + to.height / 2, { steps: 12 });
      await page.mouse.up();
      await settle(page);
    };
    await drag(c, a, 10); // left edge of a: c goes before a
    expect(await order(page)).toEqual([c, a, b]);
    await drag(c, b, 0.5 * (await rectOf(page, b, "#desktop")).width); // center of b: swap
    expect(await order(page)).toEqual([b, a, c]);
  });

  test("Escape cancels a drag: nothing moves, the overlay goes away", async ({ page }) => {
    const before = await order(page);
    const from = await handleOf(page, before[0]).boundingBox();
    const target = await rectOf(page, before[2], "#desktop");
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 80, from.y + from.height / 2 + 20, { steps: 4 });
    await page.mouse.move(target.x + target.width - 12, target.y + target.height / 2, { steps: 8 });
    await expect(page.locator("#desktop [data-wm-drag-overlay]")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.locator("#desktop [data-wm-drag-overlay]")).toHaveCount(0);
    await page.mouse.up();
    await settle(page);
    expect(await order(page)).toEqual(before);
  });

  test("a press that never passes the threshold is a click, not a drag", async ({ page }) => {
    const before = await order(page);
    const from = await handleOf(page, before[0]).boundingBox();
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 42, from.y + from.height / 2 + 1);
    await expect(page.locator("#desktop [data-wm-drag-overlay]")).toHaveCount(0);
    await page.mouse.up();
    expect(await order(page)).toEqual(before);
    expect((await stateOf(page)).focus.window).toBe(before[0]);
  });
});

test.describe("floating windows with real pointer events", () => {
  test("a title-bar drag moves a floating window, a corner grip resizes it, each as one undo step", async ({ demo, page }) => {
    await demo("basic.html");
    const id = await page.evaluate(() => {
      const wm = window.wm;
      const id = wm.getState().workspaces[wm.getState().activeWorkspace].windows[0];
      wm.setMode(id, "floating");
      wm.move(id, 120, 90);
      wm.resize(id, 320, 220);
      return id;
    });
    await settle(page);
    const placement = async () => (await stateOf(page)).windows[id].placement;
    const start = await placement();
    const bar = await page.locator(`#desktop wm-view[data-view="${id}"] [data-wm-handle="move"]`).boundingBox();
    await page.mouse.move(bar.x + 30, bar.y + bar.height / 2);
    await page.mouse.down();
    await page.mouse.move(bar.x + 80, bar.y + bar.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const moved = await placement();
    expect(moved.x).toBeGreaterThan(start.x);
    expect(moved.y).toBeGreaterThan(start.y);

    const grip = await page.locator(`#desktop wm-view[data-view="${id}"] [data-wm-handle="resize-se"]`).boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + 60, grip.y + 40, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const resized = await placement();
    expect(resized.width).toBeGreaterThan(moved.width);
    expect(resized.height).toBeGreaterThan(moved.height);

    await page.evaluate(() => window.wm.undo());
    expect((await placement()).width).toBe(moved.width);
    await page.evaluate(() => window.wm.undo());
    expect((await placement()).x).toBe(start.x);
  });
});
