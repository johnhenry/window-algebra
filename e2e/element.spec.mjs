import { test, expect, settle } from "./helpers.mjs";

test.describe("<wa-stage> exposes its handles (element.html)", () => {
  test("a button opens the palette through stage.palette (no keyboard shortcut needed)", async ({ demo, page }) => {
    await demo("element.html");
    expect(await page.evaluate(() => typeof document.getElementById("stage").palette.open)).toBe("function");
    await page.locator("#open-palette").click();
    await expect(page.locator("[data-wm-palette]")).toBeVisible();
    expect(await page.evaluate(() => document.getElementById("stage").palette.isOpen)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-wm-palette]")).toBeHidden();
    expect(await page.evaluate(() => document.getElementById("stage").palette.isOpen)).toBe(false);
  });

  test("stage.sync.peers() drives a tab count: a second tab makes it 2, and its windows arrive", async ({ demo, page, context }) => {
    await demo("element.html");
    await expect(page.locator("#tabs")).toHaveText("Tabs: 1");
    const other = await context.newPage();
    await other.goto("/demo/element.html");
    await other.locator("wm-view").first().waitFor();
    await expect(page.locator("#tabs")).toHaveText("Tabs: 2", { timeout: 10_000 });
    await expect(other.locator("#tabs")).toHaveText("Tabs: 2", { timeout: 10_000 });
    expect(await page.evaluate(() => document.getElementById("stage").sync.peers().length)).toBe(1);
    // the handle is live: a window made in one tab shows in the other, and flush()/detach() are reachable
    await page.evaluate(() => document.getElementById("stage").wm.create({ id: "from-a", title: "From A" }));
    await settle(page);
    await expect(other.locator('wm-view[data-view="from-a"]')).toHaveCount(1, { timeout: 10_000 });
    expect(await page.evaluate(() => typeof document.getElementById("stage").sync.flush)).toBe("function");
    await other.close();
    await expect(page.locator("#tabs")).toHaveText("Tabs: 1", { timeout: 10_000 });
  });
});

test.describe("WindowManagerStage hands out its handles (react.html, needs network)", () => {
  test("stageRef.current.palette.open() from a toolbar button", async ({ demo, page }) => {
    await demo("react.html", { ready: "wm-view" });
    await page.locator("wm-view").first().waitFor({ timeout: 20_000 });
    await settle(page);
    await page.locator("#open-palette").click();
    await expect(page.locator("[data-wm-palette]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-wm-palette]")).toBeHidden();
  });
});
