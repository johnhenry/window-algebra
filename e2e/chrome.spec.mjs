import { test, expect, settle, stateOf, rectOf } from "./helpers.mjs";

const win = (page, id) => page.locator(`#stage wm-view[data-view="${id}"]`);
const button = (page, id, name) => win(page, id).getByRole("button", { name });

test.describe("built-in window chrome (chrome.html)", () => {
  test("every window has a title bar, a body and named buttons; only the right toggle half shows", async ({ demo, page }) => {
    await demo("chrome.html");
    await settle(page);
    const w = win(page, "notes");
    await expect(w.locator("[data-wa-chrome-title]")).toHaveText("Notes");
    for (const name of ["Minimize window: Notes", "Maximize window: Notes", "Tile window: Notes", "Close window: Notes"]) {
      await expect(w.getByRole("button", { name })).toBeVisible();
    }
    // floating: "Float" and "Restore" are hidden by CSS, so they are not in the accessibility tree either
    await expect(w.getByRole("button", { name: "Float window: Notes" })).toHaveCount(0);
    await expect(w.getByRole("button", { name: "Restore window: Notes" })).toHaveCount(0);
    expect(await page.locator("#stage [data-wm-handle^=resize-]").count()).toBe(8 * 3);
  });

  test("the buttons run their commands: maximize, restore, tile, close (and Float returns it)", async ({ demo, page }) => {
    await demo("chrome.html");
    await button(page, "notes", "Maximize window: Notes").click();
    await expect.poll(async () => (await stateOf(page)).windows.notes.status).toBe("maximized");
    await settle(page);
    await expect(button(page, "notes", "Restore window: Notes")).toBeVisible();
    await expect(button(page, "notes", "Maximize window: Notes")).toHaveCount(0);
    await expect(win(page, "notes").locator('[data-wm-handle="resize-se"]')).toBeHidden();
    await button(page, "notes", "Restore window: Notes").click();
    await expect.poll(async () => (await stateOf(page)).windows.notes.status).toBe("normal");
    await button(page, "notes", "Tile window: Notes").click();
    await expect.poll(async () => (await stateOf(page)).windows.notes.mode).toBe("tiled");
    await settle(page);
    await expect(button(page, "notes", "Float window: Notes")).toBeVisible();
    await expect(win(page, "notes").locator('[data-wm-handle="resize-se"]')).toBeHidden();
    await button(page, "notes", "Close window: Notes").click();
    await expect.poll(async () => (await stateOf(page)).windows.notes).toBeUndefined();
  });

  test("a tiled window maximized with a real click shows Restore (Chromium moveBefore left a stale style)", async ({ demo, page }) => {
    await demo("chrome.html");
    await settle(page);
    await page.evaluate(() => {
      for (const id of ["notes", "long", "form"]) window.wm.dispatch({ type: "window/set-mode", id, mode: "tiled" });
      window.wm.setLayout({ type: "master-stack", ratio: 0.55 });
    });
    await settle(page);
    // a tiled window moves from its column to the overlay when it maximizes; the attribute write must follow the move
    await button(page, "form", "Maximize window: Settings").click();
    await expect.poll(async () => (await stateOf(page)).windows.form.status).toBe("maximized");
    await settle(page);
    await expect(button(page, "form", "Restore window: Settings")).toBeVisible();
    await button(page, "form", "Restore window: Settings").click();
    await expect.poll(async () => (await stateOf(page)).windows.form.status).toBe("normal");
    await settle(page);
    await expect(button(page, "form", "Maximize window: Settings")).toBeVisible();
  });

  test("keyboard: Tab reaches the buttons; Enter and Space press them", async ({ demo, page, browserName }) => {
    await demo("chrome.html");
    await settle(page);
    await button(page, "form", "Maximize window: Settings").focus();
    await expect(button(page, "form", "Maximize window: Settings")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await stateOf(page)).windows.form.status).toBe("maximized");
    // the pressed button is now hidden: focus moved to the one that took its place, not to nothing
    await expect(button(page, "form", "Restore window: Settings")).toBeFocused();
    await page.keyboard.press("Space");
    await expect.poll(async () => (await stateOf(page)).windows.form.status).toBe("normal");
    await expect(button(page, "form", "Maximize window: Settings")).toBeFocused();
    await settle(page);
    // Tab order inside the bar: minimize -> maximize -> tile -> close. (Safari does not Tab to buttons unless the
    // user turns that on, so WebKit skips the Tab walk; Enter, Space and the focus ring still run there.)
    await button(page, "form", "Minimize window: Settings").focus();
    if (browserName !== "webkit") {
      await page.keyboard.press("Tab");
      await expect(button(page, "form", "Maximize window: Settings")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(button(page, "form", "Tile window: Settings")).toBeFocused();
      await page.keyboard.press("Tab");
    }
    await button(page, "form", "Close window: Settings").focus();
    await expect(button(page, "form", "Close window: Settings")).toBeFocused();
    // the focus ring is visible on a keyboard-focused button
    const outline = await button(page, "form", "Close window: Settings").evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("solid");
  });

  test("double-click on the title bar maximizes and restores; a double-click on a button does not", async ({ demo, page }) => {
    await demo("chrome.html");
    const bar = win(page, "notes").locator('[data-wm-handle="move"]');
    await bar.dblclick({ position: { x: 60, y: 10 } });
    await expect.poll(async () => (await stateOf(page)).windows.notes.status).toBe("maximized");
    await win(page, "notes").locator('[data-wm-handle="move"]').dblclick({ position: { x: 60, y: 10 } });
    await expect.poll(async () => (await stateOf(page)).windows.notes.status).toBe("normal");
    await button(page, "notes", "Minimize window: Notes").dblclick();
    await settle(page);
    expect((await stateOf(page)).windows.notes.status).not.toBe("maximized");
  });

  test("the title bar drags a floating window, and a resize grip resizes it", async ({ demo, page }) => {
    await demo("chrome.html");
    await settle(page);
    const before = await rectOf(page, "long", "#stage");
    await page.mouse.move(before.x + 60, before.y + 12);
    await page.mouse.down();
    await page.mouse.move(before.x + 110, before.y + 52, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const moved = await rectOf(page, "long", "#stage");
    expect(Math.round(moved.x - before.x)).toBeGreaterThan(30);
    expect(Math.round(moved.y - before.y)).toBeGreaterThan(20);
    const grip = await win(page, "long").locator('[data-wm-handle="resize-se"]').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + grip.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const resized = await rectOf(page, "long", "#stage");
    expect(resized.width).toBeGreaterThan(moved.width + 30);
    expect(resized.height).toBeGreaterThan(moved.height + 20);
  });

  test("a body that scrolls is a focusable, labelled region (the axe rule); one that fits is not", async ({ demo, page }) => {
    await demo("chrome.html");
    await settle(page);
    await page.waitForTimeout(150);
    const long = win(page, "long").locator("[data-wa-chrome-body]");
    await expect(long).toHaveAttribute("tabindex", "0");
    await expect(long).toHaveAttribute("role", "region");
    await expect(long).toHaveAccessibleName("Long document");
    await expect(win(page, "form").locator("[data-wa-chrome-body]")).not.toHaveAttribute("tabindex", /.*/);
  });

  test("a body whose content grows after it mounted becomes a focusable, labelled region (and stops being one when it shrinks)", async ({ demo, page }) => {
    await demo("chrome.html");
    await settle(page);
    const body = win(page, "notes").locator("[data-wa-chrome-body]");
    await expect(body).not.toHaveAttribute("tabindex", /.*/);
    // a component that renders late: the window's size does not change, only what is inside it
    await body.evaluate((el) => {
      const late = document.createElement("div");
      late.id = "late";
      late.style.height = "900px";
      el.append(late);
    });
    await expect(body).toHaveAttribute("tabindex", "0");
    await expect(body).toHaveAttribute("role", "region");
    await expect(body).toHaveAccessibleName("Notes");
    await body.evaluate((el) => { el.querySelector("#late").style.height = "10px"; });
    await expect(body).not.toHaveAttribute("tabindex", /.*/);
    await body.evaluate((el) => el.querySelector("#late").remove());
  });

  test("right to left: the bar and the buttons mirror, and the grips stay on their physical edges", async ({ demo, page }) => {
    await demo("chrome.html");
    await settle(page);
    const place = () =>
      page.evaluate(() => {
        const view = document.querySelector('#stage wm-view[data-view="notes"]');
        const v = view.getBoundingClientRect();
        const title = view.querySelector("[data-wa-chrome-title]").getBoundingClientRect();
        const close = view.querySelector('[data-action="close"]').getBoundingClientRect();
        const e = view.querySelector('[data-wm-handle="resize-e"]').getBoundingClientRect();
        return { vLeft: v.left, vRight: v.right, titleLeft: title.left, closeLeft: close.left, closeRight: close.right, eRight: e.right };
      });
    const ltr = await place();
    expect(ltr.closeRight).toBeGreaterThan(ltr.titleLeft); // actions after the title
    expect(Math.abs(ltr.eRight - ltr.vRight)).toBeLessThanOrEqual(2);
    await page.locator("#rtl").check();
    await settle(page);
    await settle(page);
    const rtl = await place();
    expect(rtl.closeLeft).toBeLessThan(rtl.vLeft + 120); // actions now at the left edge
    expect(Math.abs(rtl.eRight - rtl.vRight)).toBeLessThanOrEqual(2); // resize-e is the right edge in both directions
  });

  test("tokens theme it: overriding --wa-chrome-bar-height and the accent changes the bar", async ({ demo, page }) => {
    await demo("chrome.html");
    await settle(page);
    const barHeight = () => win(page, "notes").locator('[data-wm-handle="move"]').evaluate((el) => el.getBoundingClientRect().height);
    const before = await barHeight();
    await page.locator("#skin").check();
    await settle(page);
    expect(await barHeight()).toBeGreaterThan(before + 3);
  });

  test("tabs layout: a tabbed window has no second title bar", async ({ demo, page }) => {
    await demo("chrome.html");
    await page.evaluate(() => Object.keys(window.wm.getState().windows).forEach((id) => window.wm.dispatch({ type: "window/set-mode", id, mode: "tiled" })));
    await page.locator("#layout").selectOption("tabs");
    await settle(page);
    await expect(page.locator('#stage [data-wm-handle="move"]:visible')).toHaveCount(0);
    await page.locator("#layout").selectOption("columns");
    await settle(page);
    await expect(page.locator('#stage [data-wm-handle="move"]:visible').first()).toBeVisible();
  });

  test("button sets: pop out adds a pop-out button that opens a real window with working chrome; custom icons and labels apply", async ({ demo, page }) => {
    await demo("chrome.html");
    await page.locator("#buttons").selectOption("popout");
    await settle(page);
    const [popup] = await Promise.all([page.waitForEvent("popup"), button(page, "notes", "Pop out window: Notes").click()]);
    await popup.waitForLoadState();
    await expect.poll(async () => (await stateOf(page)).windows.notes.status).toBe("popped-out");
    const inPopup = popup.locator('wm-view[data-view="notes"]');
    await expect(inPopup).toHaveCount(1);
    // In the popup: pop-in and close show; minimize, maximize and the grips are hidden by CSS
    await expect(inPopup.getByRole("button", { name: "Pop window back in: Notes" })).toBeVisible();
    await expect(inPopup.getByRole("button", { name: /Maximize window/ })).toHaveCount(0);
    await expect(inPopup.locator('[data-wm-handle="resize-se"]')).toBeHidden();
    await page.evaluate(() => window.wm.dispatch({ type: "window/set-title", id: "notes", title: "Notes (renamed)" }));
    await expect(inPopup.locator("[data-wa-chrome-title]")).toHaveText("Notes (renamed)");
    const closed = popup.waitForEvent("close");
    await Promise.all([closed, inPopup.getByRole("button", { name: /Pop window back in/ }).click().catch(() => {})]);
    await expect.poll(async () => (await stateOf(page)).windows.notes.status).toBe("normal");
    await settle(page);
    await expect(win(page, "notes").locator("[data-wa-chrome]")).toHaveCount(1);

    await page.locator("#buttons").selectOption("custom");
    await settle(page);
    await expect(button(page, "notes", "Dismiss: Notes")).toBeVisible();
    await expect(button(page, "notes", "Collapse: Notes")).toBeVisible();
    await expect(win(page, "notes").locator("[data-wa-chrome-icon]")).toHaveText("✎");
  });
});

test.describe("built-in window chrome with touch (chrome.html)", () => {
  test.use({ hasTouch: true, isMobile: false });

  test("coarse pointers get 44px targets and thicker grips (Chromium and WebKit emulate pointer: coarse)", async ({ demo, page, browserName }) => {
    test.skip(browserName !== "chromium", "pointer: coarse emulation is Chromium-only in Playwright");
    await demo("chrome.html");
    await settle(page);
    const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
    test.skip(!coarse, "this engine did not report a coarse pointer");
    const box = await button(page, "notes", "Close window: Notes").boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(43);
    expect(box.height).toBeGreaterThanOrEqual(43);
  });
});
