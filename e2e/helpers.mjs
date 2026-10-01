import { test as base, expect } from "@playwright/test";

/**
 * `test` with a `demo(path)` helper: opens a demo page, waits for its stage to render, and fails the test on any
 * uncaught page error or console error (the demos must run clean in every engine).
 */
export const test = base.extend({
  errors: async ({ page }, use) => {
    const errors = [];
    page.on("pageerror", (error) => {
      // The benign ResizeObserver notice some engines raise as an error event; not a failure of the page.
      if (!/ResizeObserver loop/.test(error.message)) errors.push(`pageerror: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
    });
    await use(errors);
    expect(errors, "uncaught errors on the page").toEqual([]);
  },
  demo: async ({ page, errors }, use) => {
    void errors;
    await use(async (path, { ready = "wm-view" } = {}) => {
      await page.goto(`/demo/${path}`);
      await page.locator(ready).first().waitFor();
      return page;
    });
  },
});
export { expect };

/** Wait for the frame-coalesced commit after a state change. */
export const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/** The state, via `window.wm`. */
export const stateOf = (page) => page.evaluate(() => window.wm.getState());

/** Live rect of a window's view, relative to the viewport. */
export const rectOf = async (page, id, scope = "") => {
  const box = await page.locator(`${scope} wm-view[data-view="${id}"]`.trim()).first().boundingBox();
  if (!box) throw new Error(`no box for ${id}`);
  return box;
};
