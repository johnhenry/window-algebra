/**
 * The hand-written declarations (`src/**\/*.d.mts`) must not drift from the code. Commands and events are
 * compared with `COMMANDS` and the documented event table, and each entry point's runtime exports are
 * compared with what its declarations export, in both directions (the missing-declaration direction is a
 * `tsc` run over a generated file). The typed usage file is `npm run test:types`.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { COMMANDS } from "../src/index.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");

const ENTRIES = {
  ".": ["src/index.mjs", "src/index.d.mts"],
  "./browser": ["src/browser/index.mjs", "src/browser/index.d.mts"],
  "./algebra": ["src/algebra/nodes.mjs", "src/algebra/nodes.d.mts"],
  "./transforms": ["src/algebra/transforms.mjs", "src/algebra/transforms.d.mts"],
  "./layouts": ["src/layouts/index.mjs", "src/layouts/index.d.mts"],
  "./css": ["src/css/compile.mjs", "src/css/compile.d.mts"],
  "./react": ["src/bindings/react.mjs", "src/bindings/react.d.mts"],
  "./element": ["src/bindings/element.mjs", "src/bindings/element.d.mts"],
};

describe("package.json: every export has a types condition", () => {
  const pkg = JSON.parse(read("package.json"));
  test("each subpath maps `types` before `default` to a shipped .d.mts that exists", () => {
    for (const [subpath, [source, declaration]] of Object.entries(ENTRIES)) {
      const entry = pkg.exports[subpath];
      assert.deepEqual(Object.keys(entry), ["types", "default"], `${subpath}: types must come first`);
      assert.equal(entry.types, `./${declaration}`);
      assert.equal(entry.default, `./${source}`);
      assert.ok(statSync(join(root, declaration)).isFile(), declaration);
    }
    assert.equal(pkg.exports["./package.json"], "./package.json");
    assert.equal(Object.keys(pkg.exports).length, Object.keys(ENTRIES).length + 1);
    assert.equal(pkg.types, "./src/index.d.mts");
  });

  test("typesVersions covers the subpaths for moduleResolution node10", () => {
    for (const subpath of Object.keys(ENTRIES).filter((s) => s !== ".")) {
      assert.deepEqual(pkg.typesVersions["*"][subpath.slice(2)], [ENTRIES[subpath][1]]);
    }
  });

  test("the declarations ship: `files` is `src`, which holds every .d.mts", () => {
    assert.deepEqual(pkg.files, ["src"]);
    const found = [];
    const visit = (dir) => {
      for (const name of readdirSync(join(root, dir))) {
        const path = `${dir}/${name}`;
        if (statSync(join(root, path)).isDirectory()) visit(path);
        else if (name.endsWith(".d.mts")) found.push(path);
      }
    };
    visit("src");
    for (const [, declaration] of Object.values(ENTRIES)) assert.ok(found.includes(declaration));
    assert.ok(found.length >= 12, `${found.length} declaration files`);
  });
});

describe("commands and events", () => {
  const literals = (text, pattern) => [...text.matchAll(pattern)].map((m) => m[1]);

  test("the Command union lists exactly the COMMANDS, once each", () => {
    const declared = literals(read("src/types/commands.d.mts"), /^\s+type: "([a-z]+\/[a-z-]+)";$/gm);
    assert.equal(new Set(declared).size, declared.length, "no duplicate interface");
    assert.deepEqual([...declared].sort(), [...COMMANDS].sort());
    const union = read("src/types/commands.d.mts").split("export type Command =")[1].split(";")[0];
    const members = [...union.matchAll(/\|\s+([A-Za-z]+)/g)].map((m) => m[1]);
    assert.equal(members.length, COMMANDS.length, "every interface is in the union");
    for (const name of members) assert.match(read("src/types/commands.d.mts"), new RegExp(`export interface ${name} `), name);
  });

  test("the Event union lists exactly the events documented in docs/api/events.md", () => {
    const declared = literals(read("src/types/events.d.mts"), /^\s+type: "([a-z]+\/[a-z-]+)";$/gm).filter((t) => t !== "render" && t !== "focus");
    const documented = literals(read("docs/api/events.md"), /^\| `([a-z]+\/[a-z-]+)` \|/gm);
    assert.deepEqual([...declared].sort(), [...new Set(documented)].sort());
    assert.ok(declared.length >= 46);
  });

  test("every rejection reason the docs list is in RejectionReason", () => {
    const declared = new Set(literals(read("src/types/events.d.mts").split("export type RejectionReason =")[1].split("/** Why `wm.load`")[0], /\| "([a-z-]+)"/g));
    const documented = literals(read("docs/api/errors.md").split("## Every rejection reason")[1].split("## What throws")[0], /^\| `([a-z-]+)`/gm).filter(
      (r) => !["invalid-json", "invalid-state", "future-version", "no-migration-path"].includes(r),
    );
    for (const reason of documented) assert.ok(declared.has(reason), `RejectionReason lacks "${reason}"`);
  });

  test("every config key and layout type is declared", () => {
    const state = read("src/types/state.d.mts");
    for (const key of ["direction", "focusRaises", "gap", "inset", "defaultPlacement", "drag", "rules", "urgency", "snap"]) assert.match(state, new RegExp(`\\n  ${key}: `), key);
    for (const type of ["master-stack", "columns", "rows", "monocle", "tabs", "grid", "spiral", "bsp", "tree", "floating"]) assert.match(state, new RegExp(`type: "${type}"`), type);
  });
});

describe("runtime exports and declarations agree", () => {
  /** Names a d.mts file exports as values or types, following `export *` and `export { } from`. */
  const declared = (path, seen = new Set()) => {
    if (seen.has(path)) return { values: new Set(), types: new Set(), namespaces: new Set() };
    seen.add(path);
    const text = read(path);
    const values = new Set();
    const types = new Set();
    const namespaces = new Set();
    for (const m of text.matchAll(/^export (?:declare )?(function|const|class|let|var) ([A-Za-z0-9_$]+)/gm)) values.add(m[2]);
    for (const m of text.matchAll(/^export (?:declare )?(interface|type|enum) ([A-Za-z0-9_$]+)/gm)) types.add(m[2]);
    for (const m of text.matchAll(/^export \* as ([A-Za-z0-9_$]+) from/gm)) namespaces.add(m[1]);
    for (const m of text.matchAll(/^export (type )?\{([^}]*)\} from "([^"]+)"/gms)) {
      const names = m[2].split(",").map((n) => n.trim().split(/\s+as\s+/).pop()).filter(Boolean);
      for (const n of names) (m[1] ? types : values).add(n);
    }
    for (const m of text.matchAll(/^export \* from "([^"]+)"/gm)) {
      const target = join(dirname(path), m[1].replace(/\.mjs$/, ".d.mts"));
      const nested = declared(target, seen);
      nested.values.forEach((v) => values.add(v));
      nested.types.forEach((v) => types.add(v));
      nested.namespaces.forEach((v) => namespaces.add(v));
    }
    return { values, types, namespaces };
  };

  for (const [subpath, [source, declaration]] of Object.entries(ENTRIES)) {
    test(`${subpath}: no declared value without a runtime export, none missing`, async () => {
      const runtime = Object.keys(await import(`../${source}`)).sort();
      const { values, namespaces } = declared(declaration);
      const names = new Set([...values, ...namespaces]);
      const extra = [...names].filter((n) => !runtime.includes(n));
      assert.deepEqual(extra, [], `declared but not exported at runtime`);
      const missing = runtime.filter((n) => !names.has(n));
      assert.deepEqual(missing, [], `exported at runtime but not declared`);
    });
  }

  test("tsc agrees with that: a generated file touching every runtime export of every entry compiles", async () => {
    const dir = join(root, "test", "types", ".generated");
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    try {
      const lines = [];
      let i = 0;
      for (const [subpath, [source]] of Object.entries(ENTRIES)) {
        const keys = Object.keys(await import(`../${source}`));
        const specifier = subpath === "." ? "@johnhenry/window-algebra" : `@johnhenry/window-algebra/${subpath.slice(2)}`;
        lines.push(`import * as m${i} from "${specifier}";`);
        for (const key of keys) lines.push(`void m${i}.${key};`);
        i++;
      }
      writeFileSync(join(dir, "exports.mts"), `${lines.join("\n")}\nexport {};\n`);
      writeFileSync(
        join(dir, "tsconfig.json"),
        JSON.stringify({ extends: "../tsconfig.json", include: ["./*.mts"] }),
      );
      const out = spawnSync(process.execPath, [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(dir, "tsconfig.json")], { encoding: "utf8", cwd: root });
      assert.equal(out.status, 0, `${out.stdout}${out.stderr}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
