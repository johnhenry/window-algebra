import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BASE_CSS, RULES_CSS, THEME_CSS, THEME_TOKENS, compile, derive, createState, update, presentationContext } from "../src/index.mjs";
import { createWindowManager } from "../src/index.mjs";
import { createDomRenderer, attachInput } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

const tokens = Object.entries(THEME_TOKENS);
const varsIn = (text) => [...text.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]);

describe("theme tokens", () => {
  test("a small, documented set: every token is --wa-*, described, and has a light and a dark value", () => {
    assert.ok(tokens.length >= 40 && tokens.length <= 70, `${tokens.length} tokens`);
    for (const [name, token] of tokens) {
      assert.match(name, /^--wa-[a-z0-9-]+$/);
      assert.ok(token.description?.length > 3, `${name} has a description`);
      assert.ok(token.light && token.dark, `${name} has light and dark values`);
    }
  });

  test("the set covers colours, radii, spacing, focus ring, splitter, title bar and shadows", () => {
    for (const group of ["--wa-color-", "--wa-radius-", "--wa-space-", "--wa-focus-ring-", "--wa-splitter-", "--wa-titlebar-", "--wa-shadow-"]) {
      assert.ok(tokens.some(([name]) => name.startsWith(group)), group);
    }
  });

  test("THEME_CSS declares every token for light, dark (media query and data-theme) and prefers-contrast: more", () => {
    for (const [name, token] of tokens) {
      assert.ok(THEME_CSS.includes(`${name}: ${token.light};`), `${name} light`);
      assert.ok(THEME_CSS.includes(`${name}: ${token.dark};`), `${name} dark`);
    }
    assert.match(THEME_CSS, /@media \(prefers-color-scheme: dark\)/);
    assert.match(THEME_CSS, /:where\(\[data-theme="dark"\]\)/);
    assert.match(THEME_CSS, /\[data-theme="light"\]/);
    assert.match(THEME_CSS, /@media \(prefers-contrast: more\)/);
    assert.match(THEME_CSS, /@media \(prefers-contrast: more\) and \(prefers-color-scheme: dark\)/);
    const hc = tokens.filter(([, token]) => token.hc);
    assert.ok(hc.length >= 20, "the contrast variant changes the colours that matter");
    for (const [name, token] of hc) {
      assert.ok(THEME_CSS.includes(`${name}: ${token.hc.light};`), `${name} hc light`);
      assert.ok(THEME_CSS.includes(`${name}: ${token.hc.dark};`), `${name} hc dark`);
    }
  });

  test("defaults have zero specificity (:where), so any user rule wins whatever the order", () => {
    const selectors = [...THEME_CSS.matchAll(/(^|\n)\s*([^@\n{}][^{}]*)\{/g)].map((m) => m[2].trim());
    assert.ok(selectors.length >= 6);
    for (const selector of selectors) assert.ok(selector.startsWith(":where("), selector);
  });
});

describe("every visual value in the library's CSS comes from a token", () => {
  const defined = new Set(Object.keys(THEME_TOKENS));

  test("BASE_CSS = THEME_CSS + RULES_CSS", () => {
    assert.equal(BASE_CSS, `${THEME_CSS}\n${RULES_CSS}`);
  });

  test("every var(--wa-*) the rules read is a defined token, and no legacy --wm-* property is left", () => {
    const used = new Set(varsIn(RULES_CSS));
    assert.ok(used.size >= 25);
    for (const name of used) assert.ok(defined.has(name), `${name} is not defined in THEME_TOKENS`);
    assert.doesNotMatch(RULES_CSS, /var\(--wm-/);
  });

  test("the rules contain no colour, no pixel length and no hard-coded shadow", () => {
    assert.doesNotMatch(RULES_CSS, /#[0-9a-fA-F]{3,8}\b/, "hex colour");
    assert.doesNotMatch(RULES_CSS, /\b(rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color-mix)\(/, "colour function");
    assert.doesNotMatch(RULES_CSS, /(?<![-\w])(white|black|red|green|blue|orange|gray|grey)(?![-\w])/, "named colour");
    assert.doesNotMatch(RULES_CSS, /(^|[^-\w.])\d*\.?\d+(px|rem|em)\b/, "a literal length");
    // the one literal: the halo is a third of the ring width, a ratio, not a value
    for (const line of RULES_CSS.split("\n")) {
      if (/box-shadow/.test(line)) assert.match(line, /var\(--wa-/, line);
    }
  });

  test("the compiled render tree's styles carry no colour or shadow (layout only)", () => {
    const state = [..."abcd"].reduce((s, id) => update(s, { type: "window/create", id, title: id }).state, createState({ config: { gap: 8, inset: 4 } }));
    const tabs = update(state, { type: "layout/set", layout: { type: "tabs" } }).state;
    const text = JSON.stringify([state, tabs].map((s) => compile(derive(s), presentationContext(s))));
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|box-shadow|border-radius|"color"|"background/);
  });

  test("the drag ghost, zone and insertion line read tokens, not literals", () => {
    const doc = createFakeDocument();
    const root = doc.createElement("div");
    root.rect = { left: 0, top: 0, width: 400, height: 100 };
    doc.body.append(root);
    const renderer = createDomRenderer({ root, document: doc, anchorFallback: false });
    const wm = createWindowManager({ state: createState({ layout: { type: "columns" } }), renderer });
    for (const id of ["a", "b", "c"]) wm.create({ id });
    ["a", "b", "c"].forEach((id, i) => {
      const el = renderer.elementFor(id);
      el.rect = { left: i * 100, top: 0, width: 100, height: 100 };
      const bar = doc.createElement("header");
      bar.setAttribute("data-wm-handle", "move");
      el.append(bar);
    });
    attachInput({ root, wm });
    const e = (x, y) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {} });
    root.dispatch("pointerdown", { target: renderer.elementFor("a").querySelector("[data-wm-handle]"), ...e(50, 10) });
    root.dispatch("pointermove", e(60, 10));
    root.dispatch("pointermove", e(150, 50));
    const overlay = root.querySelector("[data-wm-drag-overlay]");
    const styles = [];
    const visit = (el) => {
      styles.push(el.style.toObject());
      el.children.forEach(visit);
    };
    visit(overlay);
    const visual = styles.flatMap((s) => ["background", "outline", "border-radius", "box-shadow", "color", "outline-offset", "border"].map((p) => s[p]).filter(Boolean));
    assert.ok(visual.length >= 5);
    for (const value of visual) {
      assert.doesNotMatch(value, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|\d\s*px/, value);
      for (const name of varsIn(value)) assert.ok(defined.has(name), `${name} in ${value}`);
    }
    root.dispatch("pointerup", e(150, 50));
  });
});

// WCAG relative luminance and contrast, for hex tokens.
const hex = (value) => {
  const m = /^#([0-9a-f]{6})$/i.exec(value);
  return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) : null;
};
const lum = (rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [lum(hex(a)), lum(hex(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("the default themes meet WCAG contrast", () => {
  const value = (name, scheme, mode) => {
    const token = THEME_TOKENS[name];
    return (mode === "hc" ? token.hc?.[scheme] : undefined) ?? token[scheme];
  };
  const pairs = [
    // [foreground, background, minimum ratio at normal contrast, at prefers-contrast: more]
    ["--wa-color-fg", "--wa-color-bg", 4.5, 7],
    ["--wa-color-fg", "--wa-color-surface", 4.5, 7],
    ["--wa-color-fg", "--wa-color-surface-raised", 4.5, 7],
    ["--wa-color-fg-muted", "--wa-color-surface", 4.5, 7],
    ["--wa-color-fg-muted", "--wa-color-bg", 4.5, 7],
    ["--wa-color-accent-fg", "--wa-color-accent", 4.5, 7],
    ["--wa-titlebar-fg", "--wa-titlebar-bg", 4.5, 7],
    ["--wa-titlebar-fg", "--wa-titlebar-active-bg", 4.5, 7],
    ["--wa-ghost-label-fg", "--wa-ghost-line", 4.5, 7],
    ["--wa-color-accent", "--wa-color-surface", 4.5, 7],
    ["--wa-color-danger", "--wa-color-surface", 4.5, 7],
    ["--wa-color-urgent", "--wa-color-surface", 3, 4.5],
    ["--wa-focus-ring-color", "--wa-color-surface", 3, 7],
    ["--wa-focus-ring-color", "--wa-focus-ring-halo", 3, 7],
    ["--wa-color-border", "--wa-color-surface", 1.4, 7],
  ];
  for (const scheme of ["light", "dark"]) {
    for (const mode of ["normal", "hc"]) {
      test(`${scheme}, ${mode === "hc" ? "prefers-contrast: more" : "default"}`, () => {
        for (const [fg, bg, normal, high] of pairs) {
          const ratio = contrast(value(fg, scheme, mode), value(bg, scheme, mode));
          assert.ok(ratio >= (mode === "hc" ? high : normal), `${fg} on ${bg}: ${ratio.toFixed(2)} < ${mode === "hc" ? high : normal}`);
        }
      });
    }
  }
});
