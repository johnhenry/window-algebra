import { test, expect, settle, stateOf } from "./helpers.mjs";

/** The id of the window DOM focus is inside, or null. */
const domFocus = (page) => page.evaluate(() => document.activeElement?.closest?.("#desktop wm-view[data-view]")?.getAttribute("data-view") ?? null);

test.describe("focus moves to visible windows (basic.html)", () => {
  test.beforeEach(async ({ demo }) => {
    await demo("basic.html");
  });

  test("a command-driven focus moves keyboard focus into that window", async ({ page }) => {
    const ids = await page.evaluate(() => window.wm.getState().workspaces.main.windows);
    await page.evaluate((id) => window.wm.focus(id), ids[0]);
    await settle(page);
    expect(await domFocus(page)).toBe(ids[0]);
    await page.evaluate(() => window.wm.focusNext());
    await settle(page);
    expect(await domFocus(page)).toBe(ids[1]);
    await page.evaluate(() => window.wm.focusPrevious());
    await settle(page);
    expect(await domFocus(page)).toBe(ids[0]);
  });

  test("closing or minimizing the focused window hands focus to a window that is on screen", async ({ page }) => {
    const [a, b, c] = await page.evaluate(() => window.wm.getState().workspaces.main.windows);
    await page.evaluate((id) => window.wm.focus(id), c);
    await settle(page);
    await page.evaluate((id) => window.wm.minimize(id), c);
    await settle(page);
    let state = await stateOf(page);
    expect(state.windows[c].status).toBe("minimized");
    expect([a, b]).toContain(state.focus.window);
    expect(await domFocus(page)).toBe(state.focus.window);
    await expect(page.locator(`#desktop wm-view[data-view="${state.focus.window}"]`)).toBeVisible();

    const survivor = state.focus.window;
    await page.evaluate((id) => window.wm.close(id), survivor);
    await settle(page);
    state = await stateOf(page);
    expect(state.windows[survivor]).toBeUndefined();
    expect(state.windows[state.focus.window].status).toBe("normal");
    expect(await domFocus(page)).toBe(state.focus.window);
  });

  test("focus is never given to a window that is not shown: a hidden (scratchpad) window is refused", async ({ page }) => {
    const [a, b] = await page.evaluate(() => window.wm.getState().workspaces.main.windows);
    await page.evaluate((id) => window.wm.focus(id), a);
    await page.evaluate((id) => window.wm.toScratchpad(id), b);
    await settle(page);
    const reason = await page.evaluate((id) => window.wm.dispatch({ type: "window/focus", id }).events.find((e) => e.type === "command/rejected")?.reason, b);
    expect(reason).toBe("not-on-workspace");
    expect((await stateOf(page)).focus.window).toBe(a);
    // Cycling skips it too.
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.wm.focusNext());
      expect((await stateOf(page)).focus.window).not.toBe(b);
    }
  });

  test("a click inside a window focuses it in the WM and in the DOM", async ({ page }) => {
    const ids = await page.evaluate(() => window.wm.getState().workspaces.main.windows);
    await page.evaluate((id) => window.wm.focus(id), ids[0]);
    await page.locator(`#desktop wm-view[data-view="${ids[1]}"] .body`).click();
    await settle(page);
    expect((await stateOf(page)).focus.window).toBe(ids[1]);
    expect(await domFocus(page)).toBe(ids[1]);
  });

  test("focus never leaves a text field outside the stage", async ({ page }) => {
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "outside";
      document.body.append(input);
    });
    await page.locator("#outside").focus();
    await page.evaluate(() => window.wm.focusNext());
    await settle(page);
    await expect(page.locator("#outside")).toBeFocused();
  });
});
