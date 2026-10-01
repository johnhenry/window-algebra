/**
 * `npm run bench`: non-gating performance numbers.
 *
 *  1. Node: update and update+derive+compile throughput (ops/s) on a 50-window state.
 *  2. Node: derive (and derive+compile) time at 10 / 100 / 500 windows for several layouts.
 *  3. Browser (Playwright, Chromium): frame time of a real pointer drag of a floating window with 100 windows on
 *     the stage, from `bench/drag.html`.
 *
 * Flags: --no-browser (skip part 3), --json (machine-readable output), --browsers=chromium,firefox,webkit.
 * Numbers vary with the machine; they are for comparing changes, not a pass/fail gate.
 */
import { performance } from "node:perf_hooks";
import { spawn } from "node:child_process";
import { createState, update, derive, compile, presentationContext, replay } from "../src/index.mjs";

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const fmt = (n, digits = 2) => (n >= 100 ? n.toFixed(0) : n.toFixed(digits));

const populate = (layout, count) =>
  replay(
    createState({ layout }),
    Array.from({ length: count }, (_, i) => ({ type: "window/create", id: `w${i}`, title: `Window ${i}`, focus: false })),
  );

// ------------------------------------------------------------------ 1. throughput

const throughput = () => {
  const base = populate({ type: "master-stack", ratio: 0.55 }, 50);
  const floating = update(base, { type: "window/set-mode", id: "w3", mode: "floating" }).state;
  const commands = [
    { type: "focus/next" },
    { type: "window/move", id: "w3", x: 20, y: 30 },
    { type: "window/raise", id: "w7" },
    { type: "layout/set-ratio", ratio: 0.6 },
    { type: "window/focus", id: "w11" },
    { type: "window/swap-next", id: "w5" },
    { type: "window/set-title", id: "w9", title: "renamed" },
    { type: "window/resize", id: "w3", width: 400, height: 300 },
  ];
  const run = (label, step, seconds = 1) => {
    let state = floating;
    let n = 0;
    const end = performance.now() + seconds * 1000;
    // warm up
    for (let i = 0; i < 2000; i++) state = step(state, commands[i % commands.length]);
    state = floating;
    const start = performance.now();
    while (performance.now() < end) {
      for (let i = 0; i < 200; i++) state = step(state, commands[(n + i) % commands.length]);
      n += 200;
    }
    const elapsed = performance.now() - start;
    return { label, opsPerSecond: (n / elapsed) * 1000, microseconds: (elapsed / n) * 1000 };
  };
  return [
    run("update", (state, command) => update(state, command).state),
    run("update + derive", (state, command) => {
      const next = update(state, command).state;
      derive(next);
      return next;
    }),
    run("update + derive + compile", (state, command) => {
      const next = update(state, command).state;
      compile(derive(next), presentationContext(next));
      return next;
    }),
  ];
};

// ------------------------------------------------------------------ 2. derive at scale

const LAYOUTS = [
  ["master-stack", { type: "master-stack" }],
  ["columns", { type: "columns" }],
  ["rows", { type: "rows" }],
  ["grid", { type: "grid" }],
  ["spiral", { type: "spiral" }],
  ["bsp", { type: "bsp" }],
  ["tree", { type: "tree" }],
  ["tabs", { type: "tabs" }],
];
const SIZES = [10, 100, 500];

const scale = () => {
  const rows = [];
  for (const [name, layout] of LAYOUTS) {
    const row = { layout: name };
    for (const count of SIZES) {
      const state = populate(layout, count);
      const iterations = count >= 500 ? 20 : count >= 100 ? 100 : 400;
      const time = (fn) => {
        for (let i = 0; i < Math.min(iterations, 10); i++) fn();
        const samples = [];
        for (let i = 0; i < iterations; i++) {
          const t = performance.now();
          fn();
          samples.push(performance.now() - t);
        }
        return median(samples);
      };
      row[`derive ${count}`] = time(() => derive(state));
      row[`derive+compile ${count}`] = time(() => compile(derive(state), presentationContext(state)));
    }
    rows.push(row);
  }
  return rows;
};

// ------------------------------------------------------------------ 3. drag frame time

const dragFrameTime = async (browserName) => {
  const { chromium, firefox, webkit } = await import("playwright-core");
  const engine = { chromium, firefox, webkit }[browserName];
  const port = 4329;
  const server = spawn(process.execPath, [new URL("../e2e/serve.mjs", import.meta.url).pathname, String(port)], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 600));
  const browser = await engine.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(`http://127.0.0.1:${port}/bench/drag.html`);
    await page.waitForFunction(() => window.benchReady === true);
    const box = await page.locator('wm-view[data-view="bench-drag"] [data-wm-handle="move"]').boundingBox();
    await page.evaluate(() => window.startFrameRecording());
    await page.mouse.move(box.x + 60, box.y + 12);
    await page.mouse.down();
    const steps = 120;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(box.x + 60 + (i / steps) * 500, box.y + 12 + Math.sin((i / steps) * Math.PI * 4) * 80);
      // One pointer move per frame, like a real 60 Hz mouse, so the frame deltas are the page's own pace.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
    await page.mouse.up();
    const frames = await page.evaluate(() => window.stopFrameRecording());
    const windows = await page.evaluate(() => document.querySelectorAll("wm-view").length);
    const sorted = [...frames].sort((a, b) => a - b);
    const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
    return { browser: browserName, windows, frames: frames.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1), slow: frames.filter((f) => f > 20).length };
  } finally {
    await browser.close();
    server.kill();
  }
};

// ------------------------------------------------------------------ report

const results = { node: process.version, platform: `${process.platform}/${process.arch}`, throughput: throughput(), scale: scale(), drag: [] };
if (!flag("no-browser")) {
  for (const name of option("browsers", "chromium").split(",")) {
    try {
      results.drag.push(await dragFrameTime(name));
    } catch (error) {
      results.drag.push({ browser: name, error: String(error.message ?? error).split("\n")[0] });
    }
  }
}

if (flag("json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log(`window-algebra bench, Node ${results.node}, ${results.platform}\n`);
  console.log("Throughput, 50 windows (master-stack), mixed commands\n");
  console.log("| step | ops/s | µs/op |\n| --- | ---: | ---: |");
  for (const r of results.throughput) console.log(`| ${r.label} | ${Math.round(r.opsPerSecond).toLocaleString("en-US")} | ${fmt(r.microseconds)} |`);
  console.log("\nMedian time per call (ms)\n");
  const head = ["layout", ...SIZES.flatMap((n) => [`derive ${n}`, `+compile ${n}`])];
  console.log(`| ${head.join(" | ")} |\n| --- | ${head.slice(1).map(() => "---:").join(" | ")} |`);
  for (const row of results.scale) {
    console.log(`| ${row.layout} | ${SIZES.flatMap((n) => [fmt(row[`derive ${n}`]), fmt(row[`derive+compile ${n}`])]).join(" | ")} |`);
  }
  if (results.drag.length) {
    console.log("\nDrag frame time, a floating window dragged over a stage of 100 windows (ms between frames)\n");
    console.log("| browser | windows | frames | p50 | p95 | max | frames over 20 ms |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const d of results.drag) {
      console.log(d.error ? `| ${d.browser} | n/a: ${d.error} | | | | | |` : `| ${d.browser} | ${d.windows} | ${d.frames} | ${fmt(d.p50)} | ${fmt(d.p95)} | ${fmt(d.max)} | ${d.slow} |`);
    }
  }
}
