import { test, expect, settle, stateOf } from "./helpers.mjs";

test.describe("pop-out (desktop.html, popups allowed)", () => {
  test("the pop-out button opens a real window holding the view, and closing it pops the window back in", async ({ demo, page }) => {
    await demo("desktop.html");
    const id = await page.evaluate(() => Object.keys(window.wm.getState().windows).find((w) => window.wm.getState().windows[w].role === "window"));
    const button = page.locator(`#stage wm-view[data-view="${id}"] [data-action="popout"]`);
    await expect(button).toBeVisible();

    const [popup] = await Promise.all([page.waitForEvent("popup"), button.click()]);
    await popup.waitForLoadState();
    await expect.poll(async () => (await stateOf(page)).windows[id].status).toBe("popped-out");

    // The live DOM node moved into the popup; the stage no longer has it.
    await expect(popup.locator(`wm-view[data-view="${id}"]`)).toHaveCount(1);
    await expect(page.locator(`#stage wm-view[data-view="${id}"]`)).toHaveCount(0);
    await expect.poll(() => popup.title()).toBeTruthy();
    // It never holds the WM's focus: focus is only given to windows on the stage.
    expect((await stateOf(page)).focus.window).not.toBe(id);

    // Close the popup: the window returns to the layout.
    await popup.close();
    await expect.poll(async () => (await stateOf(page)).windows[id].status, { timeout: 10_000 }).toBe("normal");
    await settle(page);
    await expect(page.locator(`#stage wm-view[data-view="${id}"]`)).toHaveCount(1);
  });

  test("window/pop-in from the page brings it back and closes the popup", async ({ demo, page }) => {
    await demo("desktop.html");
    const id = await page.evaluate(() => Object.keys(window.wm.getState().windows).find((w) => window.wm.getState().windows[w].role === "window"));
    const [popup] = await Promise.all([page.waitForEvent("popup"), page.locator(`#stage wm-view[data-view="${id}"] [data-action="popout"]`).click()]);
    await popup.waitForLoadState();
    await expect.poll(async () => (await stateOf(page)).windows[id].status).toBe("popped-out");
    const closed = popup.waitForEvent("close");
    // The same button, now "Pop in", lives in the popup.
    await popup.locator(`wm-view[data-view="${id}"] [data-action="popout"]`).click();
    await closed;
    await expect.poll(async () => (await stateOf(page)).windows[id].status).toBe("normal");
  });

  test("a blocked popup is a rejection, not an exception: the window stays", async ({ demo, page }) => {
    await demo("desktop.html");
    const id = await page.evaluate(() => Object.keys(window.wm.getState().windows).find((w) => window.wm.getState().windows[w].role === "window"));
    await page.locator("#block-popup").check();
    await page.locator(`#stage wm-view[data-view="${id}"] [data-action="popout"]`).click();
    await settle(page);
    expect((await stateOf(page)).windows[id].status).toBe("normal");
    await expect(page.locator(`#stage wm-view[data-view="${id}"]`)).toHaveCount(1);
  });
});
