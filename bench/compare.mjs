/**
 * `node bench/compare.mjs <current.json> [baseline.json] [--factor=3]`: compare `npm run bench -- --json` output with
 * the committed baseline (`bench/baseline.json`). Non-gating: always exits 0. A metric that is more than `factor`
 * times worse than the baseline (throughput lower, times higher) prints a GitHub `::warning::` annotation.
 * The factor is generous (default 3) because shared CI runners are noisy; it catches order-of-magnitude regressions only.
 */
import { readFileSync, appendFileSync } from "node:fs";

const args = process.argv.slice(2);
const factor = Number(args.find((a) => a.startsWith("--factor="))?.split("=")[1] ?? 3);
const [currentPath, baselinePath = new URL("./baseline.json", import.meta.url).pathname] = args.filter((a) => !a.startsWith("--"));
if (!currentPath) { console.error("usage: compare.mjs <current.json> [baseline.json] [--factor=3]"); process.exit(0); }

/** Flatten a bench result into `{ name: { value, better: "higher" | "lower" } }`. */
export const metrics = (r) => {
  const out = {};
  for (const t of r.throughput ?? []) out[`throughput/${t.label} ops/s`] = { value: t.opsPerSecond, better: "higher" };
  for (const row of r.scale ?? []) {
    for (const [k, v] of Object.entries(row)) if (k !== "layout") out[`scale/${row.layout}/${k} ms`] = { value: v, better: "lower" };
  }
  for (const d of r.drag ?? []) {
    if (d.error) continue;
    out[`drag/${d.browser}/p50 ms`] = { value: d.p50, better: "lower" };
    out[`drag/${d.browser}/p95 ms`] = { value: d.p95, better: "lower" };
  }
  return out;
};

const current = metrics(JSON.parse(readFileSync(currentPath, "utf8")));
const baseline = metrics(JSON.parse(readFileSync(baselinePath, "utf8")));
const rows = [];
let regressions = 0;
for (const [name, base] of Object.entries(baseline)) {
  const now = current[name];
  if (!now) { rows.push(`| ${name} | ${base.value.toPrecision(4)} | missing | | |`); continue; }
  // ratio > 1 means worse.
  const ratio = base.better === "higher" ? base.value / now.value : now.value / base.value;
  const bad = ratio > factor;
  if (bad) {
    regressions++;
    console.log(`::warning title=bench regression::${name}: ${now.value.toPrecision(4)} vs baseline ${base.value.toPrecision(4)} (${ratio.toFixed(1)}x worse, threshold ${factor}x)`);
  }
  rows.push(`| ${name} | ${base.value.toPrecision(4)} | ${now.value.toPrecision(4)} | ${ratio.toFixed(2)}x | ${bad ? "REGRESSION" : ""} |`);
}
const table = `### Bench vs baseline (warn above ${factor}x worse; non-gating)\n\n| metric | baseline | now | worse by | |\n| --- | ---: | ---: | ---: | --- |\n${rows.join("\n")}\n\n${regressions} regression(s).\n`;
console.log(table);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
