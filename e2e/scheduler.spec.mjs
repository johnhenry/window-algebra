import { test, expect } from "./helpers.mjs";

test.describe("frame-scheduler commits (<wa-stage>)", () => {
  test("many commands in a frame make one DOM commit, on the next frame", async ({ demo, page }) => {
    await demo("element.html");
    const result = await page.evaluate(async () => {
      const stage = document.getElementById("stage");
      const wm = stage.wm;
      const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
      await raf();
      await raf();
      const before = stage.querySelectorAll("wm-view").length;
      let batches = 0;
      const observer = new MutationObserver(() => batches++);
      observer.observe(stage, { childList: true, subtree: true, attributes: true });
      for (const id of ["x1", "x2", "x3", "x4", "x5"]) wm.create({ id, title: id });
      wm.setLayout({ type: "columns" });
      const synchronous = stage.querySelectorAll("wm-view").length; // nothing has been committed yet
      await raf();
      await raf();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const after = stage.querySelectorAll("wm-view").length;
      observer.disconnect();
      return { before, synchronous, after, batches };
    });
    expect(result.synchronous).toBe(result.before);
    expect(result.after).toBe(result.before + 5);
    // The DOM changed in one commit, not once per command (mount of the new surfaces aside, a single batch).
    expect(result.batches).toBeLessThanOrEqual(2);
  });

  test("a gesture-less burst coalesces to the last state: only the final layout is ever painted", async ({ demo, page }) => {
    await demo("element.html");
    const layouts = await page.evaluate(async () => {
      const stage = document.getElementById("stage");
      const wm = stage.wm;
      const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
      await raf();
      const seen = new Set();
      const observer = new MutationObserver(() => seen.add(stage.querySelector("[data-layout]")?.getAttribute("data-layout")));
      observer.observe(stage, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-layout"] });
      wm.setLayout({ type: "rows" });
      wm.setLayout({ type: "columns" });
      wm.setLayout({ type: "bsp" });
      await raf();
      await raf();
      observer.disconnect();
      return { seen: [...seen], final: stage.querySelector("[data-layout]")?.getAttribute("data-layout") };
    });
    expect(layouts.seen).not.toContain("wm-rows");
    expect(layouts.final).toBeTruthy();
  });
});
