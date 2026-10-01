import { test, expect, settle, stateOf, rectOf } from "./helpers.mjs";

// layouts.html also shows a gallery of small previews, so scope everything to the main stage.
const STAGE = "#stage";

const activeTab = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-wm-tab") ?? null);

test.describe("keyboard: tab strip (roving tabindex)", () => {
  test("one tab stop; Arrow, Home and End move focus; Enter activates", async ({ demo, page }) => {
    await demo("layouts.html");
    await page.evaluate(() => window.wm.setLayout({ type: "tabs" }));
    await settle(page);
    const tabs = page.locator(`${STAGE} [data-wm-tab]`);
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(3);
    const ids = await tabs.evaluateAll((els) => els.map((el) => el.getAttribute("data-wm-tab")));

    // Roving tabindex: only the selected tab is a Tab stop.
    await expect(page.locator(`${STAGE} [data-wm-tab][tabindex="0"]`)).toHaveCount(1);
    await expect(page.locator(`${STAGE} [data-wm-tab][tabindex="-1"]`)).toHaveCount(count - 1);
    const selected = await page.locator(`${STAGE} [data-wm-tab][aria-selected="true"]`).getAttribute("data-wm-tab");
    expect(await page.locator(`${STAGE} [data-wm-tab][tabindex="0"]`).getAttribute("data-wm-tab")).toBe(selected);

    await tabs.first().focus();
    expect(await activeTab(page)).toBe(ids[0]);
    await page.keyboard.press("ArrowRight");
    expect(await activeTab(page)).toBe(ids[1]);
    await page.keyboard.press("ArrowRight");
    expect(await activeTab(page)).toBe(ids[2]);
    await page.keyboard.press("ArrowLeft");
    expect(await activeTab(page)).toBe(ids[1]);
    await page.keyboard.press("End");
    expect(await activeTab(page)).toBe(ids[count - 1]);
    await page.keyboard.press("ArrowRight");
    expect(await activeTab(page)).toBe(ids[0]); // wraps
    await page.keyboard.press("ArrowLeft");
    expect(await activeTab(page)).toBe(ids[count - 1]);
    await page.keyboard.press("Home");
    expect(await activeTab(page)).toBe(ids[0]);

    // Arrow moves focus only; Enter (manual activation) selects the tab and its panel.
    await page.keyboard.press("ArrowRight");
    expect((await stateOf(page)).focus.window).not.toBe(ids[1]);
    await page.keyboard.press("Enter");
    await settle(page);
    expect((await stateOf(page)).focus.window).toBe(ids[1]);
    await expect(page.locator(`${STAGE} [data-wm-tab="${ids[1]}"]`)).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(`${STAGE} [data-wm-tab="${ids[1]}"]`)).toHaveAttribute("tabindex", "0");
  });
});

test.describe("keyboard: floating windows", () => {
  test("Alt+Shift+Arrow moves and Ctrl+Alt+Shift+Arrow resizes the focused floating window", async ({ demo, page }) => {
    await demo("layouts.html");
    const id = await page.evaluate(() => {
      const wm = window.wm;
      const id = Object.keys(wm.getState().windows)[0];
      wm.setMode(id, "floating");
      wm.move(id, 100, 80);
      wm.resize(id, 300, 200);
      wm.focus(id);
      return id;
    });
    await settle(page);
    await page.locator(`${STAGE} wm-view[data-view="${id}"]`).focus();
    const placement = async () => (await stateOf(page)).windows[id].placement;
    const start = await placement();

    await page.keyboard.press("Alt+Shift+ArrowRight");
    await page.keyboard.press("Alt+Shift+ArrowRight");
    await page.keyboard.press("Alt+Shift+ArrowDown");
    const moved = await placement();
    expect([moved.x, moved.y]).toEqual([start.x + 20, start.y + 10]);
    await page.keyboard.press("Alt+Shift+ArrowLeft");
    expect((await placement()).x).toBe(start.x + 10);

    await page.keyboard.press("Control+Alt+Shift+ArrowRight");
    await page.keyboard.press("Control+Alt+Shift+ArrowDown");
    await page.keyboard.press("Control+Alt+Shift+ArrowDown");
    const resized = await placement();
    expect([resized.width, resized.height]).toEqual([start.width + 10, start.height + 20]);
    await page.keyboard.press("Control+Alt+Shift+ArrowLeft");
    expect((await placement()).width).toBe(start.width);

    // It really moved on screen.
    await settle(page);
    const box = await rectOf(page, id, STAGE);
    expect(box.width).toBeCloseTo(start.width, 0);
  });

  test("F6 cycles window focus, and focus lands inside the window", async ({ demo, page }) => {
    await demo("layouts.html");
    const before = (await stateOf(page)).focus.window;
    await page.locator(`${STAGE} wm-view[data-view="${before}"]`).focus();
    await page.keyboard.press("F6");
    await settle(page);
    const after = (await stateOf(page)).focus.window;
    expect(after).not.toBe(before);
    expect(await page.evaluate((id) => document.activeElement?.closest("wm-view")?.getAttribute("data-view") === id, after)).toBe(true);
    await page.keyboard.press("Shift+F6");
    await settle(page);
    expect((await stateOf(page)).focus.window).toBe(before);
  });
});

test.describe("keyboard: splitters", () => {
  test("a focused splitter is nudged by its axis arrows", async ({ demo, page }) => {
    await demo("layouts.html");
    await page.evaluate(() => window.wm.setLayout({ type: "columns" }));
    await settle(page);
    const splitter = page.locator(`${STAGE} [data-wm-splitter]`).first();
    await expect(splitter).toHaveAttribute("role", "separator");
    const before = Number(await splitter.getAttribute("aria-valuenow"));
    await splitter.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await settle(page);
    expect(Number(await page.locator(`${STAGE} [data-wm-splitter]`).first().getAttribute("aria-valuenow"))).toBeGreaterThan(before);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await settle(page);
    expect(Number(await page.locator(`${STAGE} [data-wm-splitter]`).first().getAttribute("aria-valuenow"))).toBeLessThan(before);
  });
});
