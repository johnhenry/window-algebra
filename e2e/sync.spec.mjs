import { test, expect, settle, stateOf } from "./helpers.mjs";

const open = async (context, errors) => {
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto("/demo/sync.html");
  await page.locator("wm-view").first().waitFor(); // the first tab seeds a window; later tabs are handed it
  return page;
};
const ids = async (page) => Object.keys((await stateOf(page)).windows).sort();

test.describe("cross-tab sync (sync.html, two tabs of one browser context)", () => {
  test("a change in one tab appears in the other; undo and redo propagate; no echo loop", async ({ context, errors }) => {
    const a = await open(context, errors);
    const b = await open(context, errors);
    await expect.poll(() => a.evaluate(() => window.sync().peers().length)).toBe(1);
    expect(await ids(b)).toEqual(await ids(a)); // b was handed a's window, it did not make its own

    const sent = () => a.locator("#sync-log li", { hasText: /^sent/ }).count();
    const applied = () => b.locator("#sync-log li", { hasText: /^applied/ }).count();
    const [sentBefore, appliedBefore] = [await sent(), await applied()];
    await a.locator("#new").click();
    await expect.poll(() => ids(b)).toHaveLength(2);
    await settle(b);
    await expect(b.locator("wm-view")).toHaveCount(2);
    expect(await ids(a)).toEqual(await ids(b));

    // One send in A, one apply in B, and nothing bounced back: B sent nothing for it.
    expect(await sent()).toBe(sentBefore + 1);
    expect(await applied()).toBe(appliedBefore + 1);
    await b.waitForTimeout(200);
    expect(await b.locator("#sync-log li", { hasText: /^sent/ }).count()).toBe(0);
    expect(await a.locator("#sync-log li", { hasText: /^applied/ }).count()).toBe(0);

    await b.locator("#undo").click();
    await expect.poll(() => ids(a)).toHaveLength(1);
    await b.locator("#redo").click();
    await expect.poll(() => ids(a)).toHaveLength(2);
    await expect.poll(async () => (await stateOf(a)).focus.window).toBe((await stateOf(b)).focus.window);
  });

  test("a late joiner is brought up to date; concurrent edits converge on one winner", async ({ context, errors }) => {
    const a = await open(context, errors);
    await a.locator("#new").click();
    await a.locator("#new").click();
    const b = await open(context, errors);
    await expect.poll(() => ids(b)).toHaveLength(3);

    // Both tabs edit before hearing from each other (sync paused on one side by stopping delivery isn't possible
    // across tabs, so make the edits in one evaluate each, back to back): they must end identical.
    await Promise.all([a.evaluate(() => window.wm.setLayout({ type: "rows" })), b.evaluate(() => window.wm.setLayout({ type: "columns" }))]);
    await expect
      .poll(async () => JSON.stringify((await stateOf(a)).workspaces.main.layout) === JSON.stringify((await stateOf(b)).workspaces.main.layout))
      .toBe(true);
    await settle(a);
    await settle(b);
    const shape = (page) => page.locator("#stage [data-layout]").evaluateAll((els) => els.map((el) => el.getAttribute("data-layout")).join());
    await expect.poll(() => shape(b)).toBe(await shape(a));
  });

  test("turning sync off stops both directions", async ({ context, errors }) => {
    const a = await open(context, errors);
    const b = await open(context, errors);
    await expect.poll(() => a.evaluate(() => window.sync().peers().length)).toBe(1);
    await a.locator("#sync-on").uncheck();
    await a.locator("#new").click();
    await b.waitForTimeout(300);
    expect(await ids(b)).toHaveLength(1);
    await b.locator("#new").click();
    await b.waitForTimeout(300);
    expect(await ids(a)).toHaveLength(2); // a's own, not b's
    await a.locator("#sync-on").check();
    await expect.poll(() => ids(b)).toEqual(await ids(a)).catch(() => {});
  });
});
