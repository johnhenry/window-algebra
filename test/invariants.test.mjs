/**
 * Table-driven invariant fuzz: every built-in command, run with junk payloads
 * against deep-frozen states (plain, scratchpad, popped-out, multi-output,
 * modal, ...), must never throw, never mutate its input, and must leave a
 * state that satisfies the structural invariants below and that `derive`
 * can present on every output. Seeded, so a failure reproduces exactly.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createState, update, derive, compile, presentationContext, COMMANDS, columns, isVisible, isBlocked, LAYERS } from "../src/index.mjs";

const SEED = 20260930;
const PAYLOADS_PER_FIXTURE = 50;
const WALK_STEPS = 300;

/**
 * Known violations still to fix. Each entry is `{ finding, matches(type, invariant, command) }`; a failure that
 * matches one is tolerated, anything else fails the test. Each fix commit deletes its entry, and an entry that no
 * longer matches any failure fails the test too (so the list cannot rot).
 */
const KNOWN = [
  { finding: "1, 5, 6: focus on invisible windows", matches: (_t, i) => ["focus-visible", "active-workspace-valid", "active-workspace-matches-output"].includes(i) },
  { finding: "2: unvalidated create fields", matches: (t, i) => t === "window/create" && ["throws", "window-valid-mode", "window-valid-layer"].includes(i) },
  { finding: "4, 6: blocked parent whose dialog is not presented", matches: (_t, i) => i === "blocker-is-presentable" },
  { finding: "3: hidden tiled window in keyboard moves", matches: (t, i) => i === "throws" && /^window\/(move-before|move-after|swap-next|swap-previous)$/.test(t) },
  { finding: "8, 11: layouts derive cannot present", matches: (_t, i) => i === "derive-throws" },
];
const hits = new Map();
const knownFor = (type, invariant, command) => KNOWN.find((k) => k.matches(type, invariant, command));

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
};

const run = (state, ...commands) => commands.reduce((s, c) => update(s, c).state, state);
const mk = (state, id, extra = {}) => run(state, { type: "window/create", id, ...extra });

// ---------------------------------------------------------------- fixtures

const fixtures = () => {
  const out = {};

  out.plain = ["a", "b", "c"].reduce((s, id) => mk(s, id, { title: id }), createState({ workspaces: ["main", "two"] }));
  out.plain = mk(out.plain, "f", { mode: "floating", title: "" });
  out.plain = mk(out.plain, "z", { workspace: "two" });

  out.scratchpad = ["a", "b", "c"].reduce((s, id) => mk(s, id), createState());
  out.scratchpad = run(out.scratchpad, { type: "window/to-scratchpad", id: "b" }, { type: "window/to-scratchpad", id: "c" });
  out.scratchpad = mk(out.scratchpad, "d");
  out.scratchpad = run(out.scratchpad, { type: "window/to-scratchpad", id: "d" }, { type: "scratchpad/toggle", id: "d" });

  out.poppedOut = ["a", "b", "c"].reduce((s, id) => mk(s, id), createState());
  out.poppedOut = run(out.poppedOut, { type: "window/pop-out", id: "b" });

  out.multiOutput = createState({ workspaces: ["m1", "m2"] });
  out.multiOutput = run(out.multiOutput, { type: "output/create", id: "right", workspaces: ["r1", "r2"] });
  out.multiOutput = ["a", "b"].reduce((s, id) => mk(s, id, { workspace: "m1" }), out.multiOutput);
  out.multiOutput = ["c", "d", "e"].reduce((s, id) => mk(s, id, { workspace: "r1" }), out.multiOutput);
  out.multiOutput = mk(out.multiOutput, "s", { workspace: "r2" });
  out.multiOutput = run(out.multiOutput, { type: "window/set-sticky", id: "c", sticky: true }, { type: "window/focus", id: "a" });

  out.modal = ["a", "b"].reduce((s, id) => mk(s, id), createState({ workspaces: ["main", "two"] }));
  out.modal = mk(out.modal, "dlg", { parent: "a", role: "dialog", modal: true });
  out.modal = mk(out.modal, "dlg2", { parent: "dlg", role: "dialog", modal: true });
  out.modal = mk(out.modal, "pop", { parent: "b", role: "popover", anchor: { to: "b" } });
  out.modal = mk(out.modal, "sheet", { parent: "b", role: "sheet" });

  out.modes = ["a", "b", "c", "d", "e"].reduce((s, id) => mk(s, id), createState());
  out.modes = run(
    out.modes,
    { type: "window/minimize", id: "a" },
    { type: "window/maximize", id: "b" },
    { type: "window/set-urgent", id: "c" },
    { type: "window/set-sticky", id: "d", sticky: true },
    { type: "window/set-draggable", id: "e", draggable: false },
  );
  out.fullscreen = run(mk(mk(createState(), "a"), "b"), { type: "window/fullscreen", id: "a" });

  out.fullscreenModal = run(
    mk(mk(mk(createState(), "a"), "b"), "dlg", { parent: "a", role: "dialog", modal: true }),
    { type: "window/focus", id: "b" },
  );

  const layouts = [{ type: "bsp" }, { type: "tree" }, { type: "grid" }, { type: "spiral" }, { type: "columns" }, { type: "tabs" }, { type: "floating" }];
  for (const layout of layouts) {
    let s = createState({ workspaces: [{ id: "main", layout }, { id: "other", layout: { type: "master-stack" } }] });
    s = ["a", "b", "c", "d"].reduce((acc, id) => mk(acc, id), s);
    out[`layout-${layout.type}`] = s;
  }
  out["layout-fn"] = ["a", "b"].reduce((s, id) => mk(s, id), createState({ layout: (spec, ids) => columns(spec, ids) }));

  // modal child of a window that then goes to the scratchpad; a hidden scratchpad window with a child.
  let h = ["a", "b"].reduce((s, id) => mk(s, id), createState());
  h = mk(h, "dlg", { parent: "a", role: "dialog" });
  out.hiddenParent = run(h, { type: "window/to-scratchpad", id: "a" });

  return out;
};

// ---------------------------------------------------------------- invariants

/** Returns a list of violated invariant names for a state. */
export const violations = (state) => {
  try {
    return violationsOf(state);
  } catch (error) {
    return [`state-malformed (${error.message})`];
  }
};
const violationsOf = (state) => {
  const bad = [];
  const check = (name, ok) => ok || bad.push(name);
  const wins = Object.values(state.windows);
  check("focused-output-valid", Boolean(state.outputs[state.focusedOutput]) && state.outputOrder.includes(state.focusedOutput));
  check("active-workspace-valid", Boolean(state.workspaces[state.activeWorkspace]));
  check("active-workspace-matches-output", state.outputs[state.focusedOutput]?.activeWorkspace === state.activeWorkspace);
  for (const o of Object.values(state.outputs)) {
    check("output-active-workspace-valid", o.workspaces.includes(o.activeWorkspace) && Boolean(state.workspaces[o.activeWorkspace]));
    for (const w of o.workspaces) check("output-workspace-consistent", state.workspaces[w]?.output === o.id);
  }
  check("output-order-valid", state.outputOrder.length === Object.keys(state.outputs).length && state.outputOrder.every((o) => state.outputs[o]));
  check("workspace-order-valid", [...state.workspaceOrder].sort().join() === Object.keys(state.workspaces).sort().join());
  for (const ws of Object.values(state.workspaces)) {
    check("workspace-output-valid", state.outputs[ws.output]?.workspaces.includes(ws.id));
    check("workspace-members-unique", new Set(ws.windows).size === ws.windows.length);
    for (const id of ws.windows) check("workspace-member-consistent", state.windows[id]?.workspace === ws.id);
  }
  for (const win of wins) {
    if (win.workspace === null) {
      check("hidden-window-is-scratchpad", win.scratchpad === true);
      check("hidden-window-in-no-workspace", Object.values(state.workspaces).every((ws) => !ws.windows.includes(win.id)));
    } else {
      check("window-workspace-exists", Boolean(state.workspaces[win.workspace]));
      check("window-in-its-workspace", state.workspaces[win.workspace]?.windows.filter((x) => x === win.id).length === 1);
    }
    check("window-parent-exists", win.parent == null || Boolean(state.windows[win.parent]));
    check("window-in-stack", state.stack[win.layer]?.filter((x) => x === win.id).length === 1);
    check("window-valid-layer", LAYERS.includes(win.layer));
    check("window-valid-mode", win.mode === "tiled" || win.mode === "floating");
  }
  const stacked = LAYERS.flatMap((l) => state.stack[l] ?? []);
  check("stack-has-no-strangers", stacked.every((id) => state.windows[id]) && new Set(stacked).size === stacked.length);
  const f = state.focus.window;
  check("focus-exists", f === null || Boolean(state.windows[f]));
  check("focus-visible", f === null || !state.windows[f] || isVisible(state, f));
  check("focus-history-valid", state.focus.history.every((id) => state.windows[id]));
  check("urgent-valid", state.urgent.every((id) => state.windows[id]));
  check("last-scratchpad-valid", state.lastScratchpad === null || Boolean(state.windows[state.lastScratchpad]));
  // A modal-blocked window must be reachable through its dialog: if anything is blocked, the dialog is visible.
  for (const win of wins) {
    if (isVisible(state, win.id) && isBlocked(state, win.id)) {
      check("blocker-is-presentable", isVisible(state, modalOf(state, win.id)));
    }
  }
  for (const output of state.outputOrder) {
    try {
      const tree = derive(state, { output });
      compile(tree, presentationContext(state));
    } catch (error) {
      bad.push(`derive-throws`);
      void error;
    }
  }
  return bad;
};
const modalOf = (state, id) => {
  const child = Object.values(state.windows).find((w) => w.parent === id && w.modal && w.status !== "minimized" && w.status !== "popped-out");
  return child ? modalOf(state, child.id) : id;
};

// ---------------------------------------------------------------- payloads

const JUNK = [undefined, null, NaN, Infinity, -Infinity, -5, 0, 0.5, 1e308, "", "bogus", "__proto__", "center", "constructor", {}, [], [1], { type: "nope" }, true, false];

const goodValues = (state, rand) => {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const wins = Object.keys(state.windows);
  const wss = Object.keys(state.workspaces);
  const outs = Object.keys(state.outputs);
  return {
    id: () => pick([...wins, "new1", "ghost"]),
    a: () => pick(wins),
    b: () => pick(wins),
    target: () => pick(wins),
    parent: () => pick([...wins, null]),
    workspace: () => pick([...wss, "fresh"]),
    fallback: () => pick([...wss, ...outs]),
    output: () => pick([...outs, "out2"]),
    follow: () => rand() < 0.5,
    activate: () => rand() < 0.5,
    focus: () => rand() < 0.5,
    modal: () => rand() < 0.5,
    urgent: () => rand() < 0.5,
    sticky: () => rand() < 0.5,
    draggable: () => rand() < 0.5,
    mode: () => pick(["tiled", "floating"]),
    role: () => pick(["window", "dialog", "sheet", "popover", "menu", "tooltip", "panel", "notification"]),
    layer: () => pick(LAYERS),
    zone: () => pick(["center", "left", "right", "top", "bottom"]),
    title: () => pick(["", "t", "title"]),
    x: () => pick([0, 10, 123, "center"]),
    y: () => pick([0, 10, 123, "center"]),
    width: () => pick([50, 300, 800]),
    height: () => pick([50, 200, 600]),
    ratio: () => pick([0.2, 0.5, 0.8]),
    delta: () => pick([-0.1, 0.1]),
    index: () => pick([0, 1]),
    path: () => pick(["", "0", "1", "0,1", "00"]),
    weights: () => pick([[1, 2], [1, 1, 1], [3, 1]]),
    layout: () => pick([{ type: "columns" }, { type: "bsp" }, { type: "tree" }, { type: "master-stack", ratio: 0.4 }, { type: "grid", columns: 2 }, { type: "floating" }, { type: "tabs" }]),
    a_layout: () => pick([{ type: "columns" }, { type: "rows" }]),
    constraints: () => pick([{ minWidth: 100 }, { maxHeight: 500, aspectRatio: 1.5 }, {}]),
    anchor: () => pick([{ to: pick(wins) }, null]),
    app: () => pick(["term", "web"]),
    data: () => ({ k: 1 }),
    rules: () => pick([[], [{ match: { app: "term" }, set: { mode: "floating" } }]]),
    workspaces: () => pick([["n1"], ["n1", "n2"], [{ id: "n3", layout: { type: "columns" } }]]),
    drag: () => ({ tiled: "swap" }),
    gap: () => pick([0, 4, 10]),
    inset: () => pick([0, 8]),
    defaultPlacement: () => ({ x: 10, y: 10, width: 300, height: 200 }),
    focusRaises: () => rand() < 0.5,
    placement: () => ({ x: 5, y: 5 }),
    geometry: () => ({}),
    order: () => pick([wss, [...wss].reverse(), outs]),
  };
};

const randomPayload = (type, good, fields, rand) => {
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const payload = { type };
  const n = 1 + Math.floor(rand() * 7);
  for (let k = 0; k < n; k++) {
    const f = pick(fields);
    payload[f] = rand() < 0.65 ? good[f]() : pick(JUNK);
  }
  if (rand() < 0.8) payload.id = good.id();
  return payload;
};

const buildPayloads = (type, state, rand) => {
  const good = goodValues(state, rand);
  const fields = Object.keys(good);
  const payloads = [{ type }];
  // Deterministic sweep: junk ids alone, then valid ids with one junk field at a time.
  for (const j of JUNK) payloads.push({ type, id: j });
  for (const id of Object.keys(state.windows).slice(0, 2)) {
    payloads.push({ type, id });
    for (const f of fields) for (const j of [NaN, "bogus", {}]) payloads.push({ type, id, [f]: j });
  }
  for (let i = 0; i < PAYLOADS_PER_FIXTURE; i++) payloads.push(randomPayload(type, good, fields, rand));
  return payloads;
};

// ---------------------------------------------------------------- the checks

const failures = new Map();

const record = (type, invariant, command, label, extra = "") => {
  const known = knownFor(type, invariant, command);
  if (known) {
    hits.set(known, (hits.get(known) ?? 0) + 1);
    return;
  }
  const tag = `${type}|${invariant}`;
  if (!failures.has(tag)) failures.set(tag, `${label}: ${show(command)}${extra}`);
};

const show = (command) =>
  JSON.stringify(command, (_k, v) => (typeof v === "function" ? "[fn]" : v === undefined ? "[undefined]" : Number.isNaN(v) ? "[NaN]" : v === Infinity ? "[Infinity]" : v));

const checkOne = (frozen, command, label) => {
  const type = command.type;
  let out;
  try {
    out = update(frozen, command);
  } catch (error) {
    record(type, "throws", command, label, ` -> ${error.message}`);
    return null;
  }
  if (!out || typeof out !== "object" || !out.state || !Array.isArray(out.events) || !Array.isArray(out.effects)) {
    record(type, "bad-result", command, label);
    return null;
  }
  out.clean = true;
  if (out.state !== frozen) {
    for (const name of violations(out.state)) {
      out.clean = false;
      record(type, name, command, label);
    }
  }
  return out;
};

describe("invariant fuzz", () => {
  const all = fixtures();

  test("every fixture itself satisfies the invariants", () => {
    for (const [name, state] of Object.entries(all)) {
      const bad = violations(state).filter((v) => !(v === "focus-visible" && false));
      assert.deepEqual(bad, [], `fixture ${name}`);
    }
  });

  test("every COMMAND, with junk payloads, on deep-frozen states", () => {
    const rand = mulberry32(SEED);
    for (const [name, state] of Object.entries(all)) {
      const frozen = deepFreeze(structuredCloneSafe(state));
      for (const type of COMMANDS) {
        for (const command of buildPayloads(type, frozen, rand)) checkOne(frozen, command, name);
      }
    }
    report();
  });

  test("seeded random walks keep every invariant", () => {
    const rand = mulberry32(SEED + 1);
    for (const [name, start] of Object.entries(all)) {
      let state = deepFreeze(structuredCloneSafe(start));
      for (let step = 0; step < WALK_STEPS; step++) {
        const type = COMMANDS[Math.floor(rand() * COMMANDS.length)];
        const good = goodValues(state, rand);
        const command = randomPayload(type, good, Object.keys(good), rand);
        const out = checkOne(state, command, `${name}#${step}`);
        if (out?.clean) state = deepFreeze(out.state);
      }
    }
    report();
  });
});

// A deep copy that keeps functions (a function layout spec), which structuredClone refuses.
function structuredCloneSafe(value) {
  if (Array.isArray(value)) return value.map(structuredCloneSafe);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, structuredCloneSafe(v)]));
  return value;
}

/** Fail on any violation not listed in KNOWN, and on any KNOWN entry that no longer reproduces. */
function report() {
  assert.deepEqual(
    [...failures].map(([tag, detail]) => `${tag}: ${detail}`),
    [],
    "invariant violations",
  );
}

describe("known violations are still real", () => {
  test("KNOWN lists only violations that still reproduce", () => {
    const stale = KNOWN.filter((k) => !hits.get(k)).map((k) => k.finding);
    assert.deepEqual(stale, [], "remove fixed entries from KNOWN");
  });
});
