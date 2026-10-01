import { test, expect, settle, stateOf } from "./helpers.mjs";

const SHORTCUT = "ControlOrMeta+Shift+P";
const open = async (page) => {
  await page.keyboard.press(SHORTCUT);
  await expect(page.locator("[data-wm-palette]")).toBeVisible();
};

test.describe("command palette (palette.html)", () => {
  test.beforeEach(async ({ demo }) => {
    await demo("palette.html");
  });

  test("Ctrl/Cmd+Shift+P opens it with focus in the combobox; the WAI-ARIA combobox/listbox pattern holds", async ({ page }) => {
    await open(page);
    const input = page.locator("[data-wm-palette] input");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("role", "combobox");
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await expect(input).toHaveAttribute("aria-autocomplete", "list");
    await expect(page.locator("[data-wm-palette]")).toHaveAttribute("role", "dialog");
    await expect(page.locator("[data-wm-palette]")).toHaveAttribute("aria-modal", "true");
    const listId = await input.getAttribute("aria-controls");
    const list = page.locator(`#${listId}`);
    await expect(list).toHaveAttribute("role", "listbox");
    const options = list.locator('[role="option"]');
    expect(await options.count()).toBeGreaterThan(15);
    await expect(list.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);

    // aria-activedescendant follows the arrows, and DOM focus never leaves the input.
    const first = await options.first().getAttribute("id");
    await expect(input).toHaveAttribute("aria-activedescendant", first);
    await page.keyboard.press("ArrowDown");
    const second = await options.nth(1).getAttribute("id");
    await expect(input).toHaveAttribute("aria-activedescendant", second);
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await expect(input).toHaveAttribute("aria-activedescendant", await options.last().getAttribute("id")); // wraps
    await expect(input).toBeFocused();
    // Tab stays inside the dialog.
    await page.keyboard.press("Tab");
    await expect(input).toBeFocused();
  });

  test("fuzzy filter, field prompts and dispatch: close a window by name", async ({ page }) => {
    const before = Object.keys((await stateOf(page)).windows);
    await open(page);
    await page.keyboard.type("cls win");
    const options = page.locator('[data-wm-palette] [role="option"]');
    await expect(options.first()).toContainText("Close window");
    await expect(options.first().locator("mark").first()).toBeVisible();
    await page.keyboard.press("Enter");
    // Now asking which window: a list, the focused window first.
    await expect(page.locator("[data-wm-palette-title]")).toContainText("Close window");
    await page.keyboard.type("term");
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText("Terminal");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-wm-palette]")).toBeHidden();
    const after = Object.keys((await stateOf(page)).windows);
    expect(after).toEqual(before.filter((id) => id !== "term"));
    // The dispatched command shows up in the page's own log.
    await expect(page.locator("#log li").first()).toContainText('"window/close"');
  });

  test("text and number fields: rename a window; bad input is reported and keeps your place", async ({ page }) => {
    await open(page);
    await page.keyboard.type("rename window");
    await page.keyboard.press("Enter"); // the command
    await page.keyboard.press("Enter"); // the focused window
    await expect(page.locator("[data-wm-palette-title]")).toContainText("New title");
    await page.keyboard.type("Console");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-wm-palette]")).toBeHidden();
    expect(Object.values((await stateOf(page)).windows).map((w) => w.title)).toContain("Console");

    // Move window is offered once a window floats, and its x field takes a number.
    await page.evaluate(() => window.wm.toggleFloating(window.wm.getState().focus.window));
    await open(page);
    await page.keyboard.type("move window");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // the floating window
    await page.keyboard.type("abc");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-wm-palette-error]")).toContainText("not a number");
    await expect(page.locator("[data-wm-palette]")).toBeVisible();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("77");
    await page.keyboard.press("Enter");
    await page.keyboard.type("88");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-wm-palette]")).toBeHidden();
    const moved = Object.values((await stateOf(page)).windows).find((w) => w.mode === "floating");
    expect([moved.placement.x, moved.placement.y]).toEqual([77, 88]);
  });

  test("Escape steps back, then closes, and focus returns to where it was", async ({ page }) => {
    await page.locator("#open").focus();
    await open(page);
    await page.keyboard.type("close window");
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-wm-palette-title]")).toContainText("Window");
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-wm-palette-title]")).toHaveText("Command palette");
    await expect(page.locator("[data-wm-palette]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-wm-palette]")).toBeHidden();
    await expect(page.locator("#open")).toBeFocused();
  });

  test("a rejected command stays open on its last field with the reason", async ({ page }) => {
    await open(page);
    await page.keyboard.type("new workspace");
    await page.keyboard.press("Enter");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("main"); // exists
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter"); // the optional layout: first one
    await expect(page.locator("[data-wm-palette-error]")).toContainText("duplicate-id");
    await expect(page.locator("[data-wm-palette]")).toBeVisible();
  });

  test("the shortcut is configurable, and the backdrop closes it", async ({ page }) => {
    await page.locator("#shortcut").selectOption("F1");
    await page.keyboard.press(SHORTCUT);
    await expect(page.locator("[data-wm-palette]")).toBeHidden();
    await page.keyboard.press("F1");
    await expect(page.locator("[data-wm-palette]")).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(page.locator("[data-wm-palette]")).toBeHidden();
  });

  test("the palette honours the theme tokens (it is themed through --wa-* only)", async ({ page }) => {
    await page.evaluate(() => document.documentElement.style.setProperty("--wa-color-surface-raised", "rgb(255, 0, 0)"));
    await page.evaluate(() => document.documentElement.style.setProperty("--wa-radius-md", "21px"));
    await open(page);
    const style = await page.locator("[data-wm-palette]").evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, radius: getComputedStyle(el).borderTopLeftRadius }));
    expect(style.background).toBe("rgb(255, 0, 0)");
    expect(style.radius).toBe("21px");
    await settle(page);
  });
});
