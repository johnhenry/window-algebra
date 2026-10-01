import { test, expect, settle, stateOf, rectOf } from "./helpers.mjs";

/**
 * Touch and pen gestures (touch.html). The context has touch enabled. Chromium is driven with real multi-touch
 * through CDP (`Input.dispatchTouchEvent`), which exercises `touch-action`. Firefox and WebKit have no multi-touch
 * automation, so there the same pointer streams are dispatched as `PointerEvent`s with `pointerType: "touch"`
 * (real events through the real DOM and layout, but without the browser's gesture arbitration).
 */
test.use({ hasTouch: true, viewport: { width: 1000, height: 760 } });

const makeTouch = async (page, browserName) => {
  if (browserName === "chromium") {
    const cdp = await page.context().newCDPSession(page);
    const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    return {
      native: true,
      start: (points) => send("touchStart", points),
      move: (points) => send("touchMove", points),
      end: () => send("touchEnd", []),
    };
  }
  const fire = (type, id, x, y) =>
    page.evaluate(
      ([type, id, x, y]) => {
        // A touch pointer is implicitly captured by the element it went down on: later events go there, wherever the finger is.
        window.__touch ??= new Map();
        let target = window.__touch.get(id);
        if (type === "pointerdown" || !target?.isConnected) target = document.elementFromPoint(x, y) ?? document.body;
        if (type === "pointerdown") window.__touch.set(id, target);
        if (type === "pointerup") window.__touch.delete(id);
        target.dispatchEvent(new PointerEvent(type, { pointerId: id + 1, pointerType: "touch", isPrimary: id === 0, clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
      },
      [type, id, x, y],
    );
  let down = [];
  return {
    native: false,
    start: async (points) => {
      down = points;
      for (const [i, [x, y]] of points.entries()) await fire("pointerdown", i, x, y);
    },
    move: async (points) => {
      down = points;
      for (const [i, [x, y]] of points.entries()) await fire("pointermove", i, x, y);
    },
    end: async () => {
      for (const [i, [x, y]] of down.entries()) await fire("pointerup", i, x, y);
      down = [];
    },
  };
};

const lerp = (a, b, t) => a + (b - a) * t;
/** Slide the points from `from` to `to` in `steps`. */
const slide = async (touch, from, to, steps = 8) => {
  await touch.start(from);
  for (let i = 1; i <= steps; i++) await touch.move(from.map(([x, y], k) => [lerp(x, to[k][0], i / steps), lerp(y, to[k][1], i / steps)]));
  await touch.end();
};

test.describe("touch and pen gestures (touch.html)", () => {
  test.beforeEach(async ({ demo }) => {
    await demo("touch.html");
  });

  test("opt-in: attachInput sets data-wm-touch, and BASE_CSS maps it to touch-action", async ({ page }) => {
    await expect(page.locator("#stage")).toHaveAttribute("data-wm-touch", "pinch swipe-tabs swipe-workspaces context");
    const actions = await page.evaluate(() => {
      const ta = (el) => getComputedStyle(el).touchAction;
      const float = document.querySelector('#stage wm-view[data-mode="floating"]');
      return { stage: ta(document.getElementById("stage")), float: float && ta(float), handle: ta(document.querySelector("#stage [data-wm-handle]")) };
    });
    expect(actions.stage).toBe("pan-y");
    expect(actions.float).toBe("none");
    expect(actions.handle).toBe("none");
  });

  test("pinch: two touches on a floating window resize it, as one undo step", async ({ page, browserName }) => {
    const touch = await makeTouch(page, browserName);
    const id = await page.evaluate(() => Object.values(window.wm.getState().windows).find((w) => w.mode === "floating").id);
    const box = await rectOf(page, id, "#stage");
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const before = (await stateOf(page)).windows[id].placement;
    await slide(touch, [[cx - 40, cy], [cx + 40, cy]], [[cx - 100, cy], [cx + 100, cy]]);
    await settle(page);
    const after = (await stateOf(page)).windows[id].placement;
    expect(after.width).toBeGreaterThan(before.width * 2);
    expect(after.height).toBeGreaterThan(before.height * 2);
    await page.evaluate(() => window.wm.undo());
    expect((await stateOf(page)).windows[id].placement.width).toBe(before.width);
  });

  test("tab swipe: a horizontal stroke on the tab strip switches tabs; a vertical one does not", async ({ page, browserName }) => {
    const touch = await makeTouch(page, browserName);
    await page.locator('[data-ws="tabbed"]').click();
    await settle(page);
    const tabs = page.locator("#stage [data-wm-tab]");
    const names = await tabs.evaluateAll((els) => els.map((el) => el.textContent));
    const selected = () => page.locator('#stage [data-wm-tab][aria-selected="true"]').textContent();
    const box = (i) => tabs.nth(i).boundingBox();
    // (A press on a tab also selects it, as a tap would, so each stroke starts on the tab we mean.)
    let b = await box(0);
    const y = b.y + b.height / 2;
    await slide(touch, [[b.x + b.width / 2, y]], [[b.x + b.width / 2, y + 60]], 6); // vertical: nothing but the press
    await settle(page);
    expect(await selected()).toBe(names[0]);
    await slide(touch, [[b.x + b.width / 2, y]], [[b.x + b.width / 2 - 100, y]], 6); // swipe left: next
    await settle(page);
    expect(await selected()).toBe(names[1]);
    b = await box(1);
    await slide(touch, [[b.x + b.width / 2, y]], [[b.x + b.width / 2 + 100, y]], 6); // swipe right: previous
    await settle(page);
    expect(await selected()).toBe(names[0]);
    b = await box(2);
    await slide(touch, [[b.x + b.width / 2, y]], [[b.x + b.width / 2 - 100, y]], 6); // left on the last tab: no wrap
    await settle(page);
    expect(await selected()).toBe(names[2]);
  });

  test("workspace swipe: two fingers swipe to the next workspace", async ({ page, browserName }) => {
    const touch = await makeTouch(page, browserName);
    expect(await page.locator("#where").textContent()).toBe("floaty");
    // an empty part of the stage (below the floating windows)
    const stage = await page.locator("#stage").boundingBox();
    const x = stage.x + stage.width - 160;
    const y = stage.y + stage.height - 60;
    await slide(touch, [[x, y], [x + 60, y]], [[x - 130, y], [x - 70, y]]);
    await settle(page);
    await expect(page.locator("#where")).toHaveText("tabbed");
    await slide(touch, [[x - 60, y], [x, y]], [[x + 70, y], [x + 130, y]]);
    await settle(page);
    await expect(page.locator("#where")).toHaveText("floaty");
  });

  test("long press on a window opens its context menu (and not on a control)", async ({ page, browserName }) => {
    const touch = await makeTouch(page, browserName);
    await page.locator('[data-ws="tiles"]').click();
    await settle(page);
    const id = (await stateOf(page)).workspaces.tiles.windows[0];
    const box = await rectOf(page, id, "#stage");
    const point = [box.x + box.width / 2, box.y + box.height - 30];
    await touch.start([point]);
    await page.waitForTimeout(700);
    await touch.end();
    await expect(page.locator("#ctx")).toBeVisible();
    await expect(page.locator('#ctx [role="menuitem"]').first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#ctx")).toBeHidden();
    // A press on a control keeps its own behaviour.
    const close = await page.locator(`#stage wm-view[data-view="${id}"] [data-action="close"]`).boundingBox();
    await touch.start([[close.x + close.width / 2, close.y + close.height / 2]]);
    await page.waitForTimeout(700);
    await touch.end();
    await settle(page);
    await expect(page.locator("#ctx")).toBeHidden();
  });

  test("a mouse never triggers any of these: no pinch-like wheel, no long-press menu", async ({ page }) => {
    await page.locator('[data-ws="tiles"]').click();
    await settle(page);
    const id = (await stateOf(page)).workspaces.tiles.windows[0];
    const box = await rectOf(page, id, "#stage");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 30);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.locator("#ctx")).toBeHidden();
  });

  test("a title bar drags a floating window with touch (touch-action: none lets the page have it)", async ({ page, browserName }) => {
    const touch = await makeTouch(page, browserName);
    const id = await page.evaluate(() => Object.values(window.wm.getState().windows).find((w) => w.mode === "floating").id);
    const bar = await page.locator(`#stage wm-view[data-view="${id}"] [data-wm-handle="move"]`).boundingBox();
    const start = (await stateOf(page)).windows[id].placement;
    const x = bar.x + 60;
    const y = bar.y + bar.height / 2;
    await slide(touch, [[x, y]], [[x + 90, y + 40]], 8);
    await settle(page);
    const end = (await stateOf(page)).windows[id].placement;
    expect(end.x).toBeGreaterThan(start.x + 40);
    expect(end.y).toBeGreaterThan(start.y + 15);
  });
});
