/**
 * `npm run size`: size budgets. Bundles every `exports` entry (with its whole import graph, minified, ESM) with
 * esbuild and measures the gzip size, and measures the packed tarball (`npm pack --json`). Exits non-zero when a
 * budget in `size-budgets.json` is exceeded. Flags: --json (print numbers only), --update-hint (print suggested budgets).
 */
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
const budgets = JSON.parse(readFileSync(new URL("size-budgets.json", root), "utf8"));
const json = process.argv.includes("--json");

const entries = Object.entries(pkg.exports)
  .filter(([, target]) => typeof target === "object")
  .map(([subpath, target]) => [subpath, target.default]);

const measured = {};
for (const [subpath, file] of entries) {
  const result = await build({
    entryPoints: [new URL(file, root).pathname],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].contents;
  measured[subpath] = { minified: code.length, gzip: gzipSync(code, { level: 9 }).length };
}

const packOut = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: root.pathname, encoding: "utf8" });
const [pack] = JSON.parse(packOut);
const tarball = { packed: pack.size, unpacked: pack.unpackedSize, files: pack.entryCount };

if (json) {
  console.log(JSON.stringify({ entries: measured, tarball }, null, 2));
  process.exit(0);
}

let failed = false;
const check = (label, value, limit) => {
  const ok = limit === undefined || value <= limit;
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(28)} ${String(value).padStart(7)} B  (budget ${limit ?? "none"})`);
};
for (const [subpath, m] of Object.entries(measured)) {
  check(`${subpath} gzip`, m.gzip, budgets.entries?.[subpath]);
}
check("tarball packed", tarball.packed, budgets.tarball?.packed);
check("tarball unpacked", tarball.unpacked, budgets.tarball?.unpacked);
check("tarball file count", tarball.files, budgets.tarball?.files);
for (const subpath of Object.keys(budgets.entries ?? {})) {
  if (!(subpath in measured)) { failed = true; console.log(`FAIL budget for unknown entry ${subpath}`); }
}
if (failed) {
  console.error("\nSize budget exceeded. Raise size-budgets.json only for a deliberate, explained growth.");
  process.exit(1);
}
