import AxeBuilder from "@axe-core/playwright";
import { readdirSync } from "node:fs";
import { test, expect, settle } from "./helpers.mjs";

/**
 * An axe-core scan of every demo page, in both colour schemes. It must find no serious or critical violation
 * (minor and moderate ones are listed in the test output, not failed on).
 */
const PAGES = readdirSync(new URL("../demo", import.meta.url))
  .filter((name) => name.endsWith(".html"))
  .sort();

const FAIL_ON = new Set(["serious", "critical"]);

const describeViolations = (violations) =>
  violations
    .map((v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.slice(0, 4).map((n) => `    ${n.target.join(" ")}  ${n.failureSummary?.split("\n").slice(1, 2).join("")}`).join("\n")}`)
    .join("\n");

test("every demo page is covered (a new page needs no list edit, but must pass)", () => {
  expect(PAGES.length).toBeGreaterThanOrEqual(17);
  for (const expected of ["index.html", "basic.html", "chrome.html", "palette.html", "rtl.html", "sync.html", "touch.html", "theming.html"]) expect(PAGES).toContain(expected);
});

for (const scheme of ["light", "dark"]) {
  test.describe(`axe, ${scheme} scheme`, () => {
    test.use({ colorScheme: scheme });
    for (const name of PAGES) {
      test(name, async ({ demo, page }) => {
        // A scan loads the page, waits for frames and runs axe: far heavier than the other specs. Starved of CPU
        // (several workers, or CI), it has taken 55 s for index.html in WebKit. Triples the timeout; nothing else waits on a clock.
        test.slow();
        // react.html loads React from esm.sh; it needs the network, and its stage is the thing worth scanning.
        await demo(name, { ready: name === "react.html" ? "wm-view" : "wm-view, .card, main, body" });
        if (name === "react.html") await page.locator("wm-view").first().waitFor({ timeout: 20_000 });
        await settle(page);
        await settle(page); // surfaces mount and chrome syncs on the next frame: wait two more frames, not a fixed time
        const results = await new AxeBuilder({ page }).analyze();
        const blocking = results.violations.filter((v) => FAIL_ON.has(v.impact));
        const minor = results.violations.filter((v) => !FAIL_ON.has(v.impact));
        if (minor.length) test.info().annotations.push({ type: "axe-minor", description: describeViolations(minor) });
        expect(blocking, `serious or critical axe violations on ${name} (${scheme}):\n${describeViolations(blocking)}`).toEqual([]);
      });
    }
  });
}

test.describe("axe, with the command palette open and with the RTL stage", () => {
  test("palette.html with the palette open (commands list, then a field prompt)", async ({ demo, page }) => {
    test.slow(); // three axe scans in one test
    await demo("palette.html");
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await expect(page.locator("[data-wm-palette]")).toBeVisible();
    let results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => FAIL_ON.has(v.impact)), describeViolations(results.violations)).toEqual([]);
    await page.keyboard.type("close window");
    await page.keyboard.press("Enter"); // a window list
    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => FAIL_ON.has(v.impact)), describeViolations(results.violations)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.keyboard.type("zzzzz"); // reopen not needed: no results state
    await page.keyboard.press("ControlOrMeta+Shift+P");
    await page.keyboard.type("qqqqqq");
    results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => FAIL_ON.has(v.impact)), describeViolations(results.violations)).toEqual([]);
  });

  test("rtl.html in RTL with tabs and a floating window", async ({ demo, page }) => {
    await demo("rtl.html");
    await page.evaluate(() => window.wm.setLayout({ type: "tabs" }));
    await settle(page);
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => FAIL_ON.has(v.impact)), describeViolations(results.violations)).toEqual([]);
  });
});
