import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  createWindowManager,
  createOutput,
  createWorkspace,
  update,
  reduce,
  replay,
  derive,
  views,
  migrate,
  STATE_VERSION,
  DEFAULT_OUTPUT,
  COMMANDS,
  outputsList,
  outputActiveWorkspace,
  outputOf,
  workspacesOf,
  focusedOutput,
  visibleWindows,
  focusable,
  paintOrder,
} from "../src/index.mjs";
import { createDomRenderer, attachInput } from "../src/browser/index.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

const withOutput = (state, id, workspaces) => reduce(state, { type: "output/create", id, workspaces });

/** View ids present in a *compiled* render tree (as committed to a renderer). */
const viewIdsOf = (node) => {
  if (!node) return [];
  const own = node.tag === "wm-view" ? [node.key.replace(/^view:/, "").replace(/#\d+$/, "")] : [];
  return [...own, ...(node.children ?? []).flatMap(viewIdsOf)];
};

describe("outputs: state shape and defaults", () => {
  test("createState() starts with one default output holding every workspace", () => {
    const state = createState({ workspaces: ["main", "dev"] });
    assert.deepEqual(state.outputOrder, [DEFAULT_OUTPUT]);
    assert.equal(state.focusedOutput, DEFAULT_OUTPUT);
    assert.deepEqual(state.outputs[DEFAULT_OUTPUT].workspaces, ["main", "dev"]);
    assert.equal(state.outputs[DEFAULT_OUTPUT].activeWorkspace, "main");
    assert.equal(state.activeWorkspace, "main");
    assert.equal(state.workspaces.main.output, DEFAULT_OUTPUT);
    assert.equal(state.workspaces.dev.output, DEFAULT_OUTPUT);
  });

  test("state stays JSON-serializable", () => {
    const state = withOutput(createState(), "hdmi", ["hdmi-1"]);
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state);
  });

  test("createOutput() defaults activeWorkspace to the first workspace", () => {
    const output = createOutput({ id: "hdmi", workspaces: ["a", "b"] });
    assert.deepEqual(output, { id: "hdmi", workspaces: ["a", "b"], activeWorkspace: "a" });
  });

  test("createWorkspace() defaults to the default output", () => {
    assert.equal(createWorkspace({ id: "x" }).output, DEFAULT_OUTPUT);
    assert.equal(createWorkspace({ id: "x", output: "hdmi" }).output, "hdmi");
  });
});

describe("output/create", () => {
  test("creates an output with a default single workspace", () => {
    const out = update(createState(), { type: "output/create", id: "hdmi" });
    assert.deepEqual(out.events, [{ type: "output/created", id: "hdmi", workspaces: ["hdmi-1"] }]);
    assert.deepEqual(out.state.outputOrder, [DEFAULT_OUTPUT, "hdmi"]);
    assert.deepEqual(out.state.outputs.hdmi.workspaces, ["hdmi-1"]);
    assert.equal(out.state.outputs.hdmi.activeWorkspace, "hdmi-1");
    assert.equal(out.state.workspaces["hdmi-1"].output, "hdmi");
    assert.deepEqual(out.state.workspaceOrder, ["main", "hdmi-1"]);
    // Not focused by default: single-output state is untouched.
    assert.equal(out.state.focusedOutput, DEFAULT_OUTPUT);
    assert.equal(out.state.activeWorkspace, "main");
  });

  test("accepts explicit workspace ids and { id, layout } specs", () => {
    const out = update(createState(), {
      type: "output/create",
      id: "hdmi",
      workspaces: ["ws-a", { id: "ws-b", layout: { type: "columns" } }],
    });
    assert.deepEqual(out.state.outputs.hdmi.workspaces, ["ws-a", "ws-b"]);
    assert.equal(out.state.workspaces["ws-b"].layout.type, "columns");
  });

  test("focus: true also focuses the new output", () => {
    const out = update(createState(), { type: "output/create", id: "hdmi", focus: true });
    assert.equal(out.state.focusedOutput, "hdmi");
    assert.equal(out.state.activeWorkspace, "hdmi-1");
    assert.ok(out.events.some((e) => e.type === "output/created"));
    assert.ok(out.events.some((e) => e.type === "output/focused"));
  });

  test("rejects a missing id, a duplicate output id, and a duplicate workspace id", () => {
    const state = createState();
    assert.equal(update(state, { type: "output/create", id: "" }).events[0].reason, "missing-id");
    assert.equal(update(state, { type: "output/create", id: DEFAULT_OUTPUT }).events[0].reason, "duplicate-id");
    assert.equal(update(state, { type: "output/create", id: "hdmi", workspaces: ["main"] }).events[0].reason, "duplicate-id");
    assert.equal(update(state, { type: "output/create", id: "hdmi", workspaces: [] }).events[0].reason, "missing-workspaces");
  });

  test("never mutates its input and is JSON-serializable", () => {
    const state = createState();
    const before = JSON.parse(JSON.stringify(state));
    const out = update(state, { type: "output/create", id: "hdmi" });
    assert.deepEqual(state, before);
    assert.deepEqual(JSON.parse(JSON.stringify(out.state)), out.state);
  });
});

describe("output/remove", () => {
  const twoOutputs = () => withOutput(createState(), "hdmi", ["hdmi-1"]);

  test("moves the removed output's workspaces onto the fallback", () => {
    const state = twoOutputs();
    const out = update(state, { type: "output/remove", id: "hdmi" });
    assert.deepEqual(out.events[0], { type: "output/removed", id: "hdmi", fallback: DEFAULT_OUTPUT, workspaces: ["hdmi-1"] });
    assert.equal(out.state.outputs.hdmi, undefined);
    assert.deepEqual(out.state.outputOrder, [DEFAULT_OUTPUT]);
    assert.equal(out.state.workspaces["hdmi-1"].output, DEFAULT_OUTPUT);
    assert.ok(out.state.outputs[DEFAULT_OUTPUT].workspaces.includes("hdmi-1"));
  });

  test("switches focus to the fallback when the focused output is removed", () => {
    const state = reduce(twoOutputs(), { type: "output/focus", id: "hdmi" });
    const out = update(state, { type: "output/remove", id: "hdmi" });
    assert.equal(out.state.focusedOutput, DEFAULT_OUTPUT);
    assert.equal(out.state.activeWorkspace, out.state.outputs[DEFAULT_OUTPUT].activeWorkspace);
  });

  test("windows on the removed output become invisible and refocus fires", () => {
    let state = reduce(twoOutputs(), { type: "output/focus", id: "hdmi" });
    state = reduce(state, { type: "window/create", id: "a", workspace: "hdmi-1" });
    assert.equal(state.focus.window, "a");
    const out = update(state, { type: "output/remove", id: "hdmi" });
    // "a" is no longer on the fallback output's active workspace.
    assert.equal(out.state.focus.window, null);
  });

  test("rejects removing the only output, and an unknown output", () => {
    const state = createState();
    assert.equal(update(state, { type: "output/remove", id: DEFAULT_OUTPUT }).events[0].reason, "last-output");
    assert.equal(update(twoOutputs(), { type: "output/remove", id: "nope" }).events[0].reason, "unknown-output");
  });

  test("rejects an unknown fallback", () => {
    const out = update(twoOutputs(), { type: "output/remove", id: "hdmi", fallback: "nope" });
    assert.equal(out.events[0].reason, "unknown-output");
  });

  test("never mutates its input", () => {
    const state = twoOutputs();
    const before = JSON.parse(JSON.stringify(state));
    update(state, { type: "output/remove", id: "hdmi" });
    assert.deepEqual(state, before);
  });
});

describe("output/focus", () => {
  const twoOutputs = () => withOutput(createState(), "hdmi", ["hdmi-1"]);

  test("switches focusedOutput and activeWorkspace, mirroring the target output", () => {
    const out = update(twoOutputs(), { type: "output/focus", id: "hdmi" });
    assert.deepEqual(out.events, [{ type: "output/focused", id: "hdmi", previous: DEFAULT_OUTPUT }]);
    assert.equal(out.state.focusedOutput, "hdmi");
    assert.equal(out.state.activeWorkspace, "hdmi-1");
  });

  test("is a no-op when already focused there", () => {
    const state = createState();
    assert.equal(update(state, { type: "output/focus", id: DEFAULT_OUTPUT }).state, state);
  });

  test("moves keyboard focus to a focusable window on the target output", () => {
    let state = twoOutputs();
    state = reduce(state, { type: "window/create", id: "a", workspace: "hdmi-1", focus: false });
    assert.equal(state.focus.window, null);
    const out = update(state, { type: "output/focus", id: "hdmi" });
    assert.equal(out.state.focus.window, "a");
  });

  test("prefers the most recently focused window among the target's candidates", () => {
    let state = twoOutputs();
    state = reduce(state, { type: "window/create", id: "a", workspace: "hdmi-1" });
    state = reduce(state, { type: "window/create", id: "b", workspace: "hdmi-1" });
    state = reduce(state, { type: "window/focus", id: "a" });
    // Focus back on the default output so we can observe output/focus's pick.
    state = reduce(state, { type: "output/focus", id: DEFAULT_OUTPUT });
    const out = update(state, { type: "output/focus", id: "hdmi" });
    assert.equal(out.state.focus.window, "a");
  });

  test("blurs when the target output has no focusable window", () => {
    let state = twoOutputs();
    state = reduce(state, { type: "window/create", id: "a" });
    assert.equal(state.focus.window, "a");
    const out = update(state, { type: "output/focus", id: "hdmi" });
    assert.equal(out.state.focus.window, null);
    assert.ok(out.events.some((e) => e.type === "window/blurred"));
  });

  test("is a no-op when the currently focused window already belongs to the target output", () => {
    let state = twoOutputs();
    state = reduce(state, { type: "window/create", id: "a", workspace: "hdmi-1" });
    state = reduce(state, { type: "window/focus", id: "a" }); // focuses "a", switching to "hdmi"
    assert.equal(state.focusedOutput, "hdmi");
    assert.equal(update(state, { type: "output/focus", id: "hdmi" }).state, state);
  });

  test("rejects an unknown output", () => {
    assert.equal(update(createState(), { type: "output/focus", id: "nope" }).events[0].reason, "unknown-output");
  });
});

describe("workspace/move-to-output", () => {
  const twoOutputs = () => withOutput(createState({ workspaces: ["main", "dev"] }), "hdmi", ["hdmi-1"]);

  test("moves a workspace onto another output", () => {
    const out = update(twoOutputs(), { type: "workspace/move-to-output", id: "dev", output: "hdmi" });
    assert.deepEqual(out.events[0], { type: "workspace/moved-to-output", id: "dev", output: "hdmi", from: DEFAULT_OUTPUT });
    assert.equal(out.state.workspaces.dev.output, "hdmi");
    assert.ok(out.state.outputs.hdmi.workspaces.includes("dev"));
    assert.ok(!out.state.outputs[DEFAULT_OUTPUT].workspaces.includes("dev"));
  });

  test("re-assigns the source output's activeWorkspace when the moved workspace was it", () => {
    const state = twoOutputs(); // main is default output's activeWorkspace
    const out = update(state, { type: "workspace/move-to-output", id: "main", output: "hdmi" });
    assert.equal(out.state.outputs[DEFAULT_OUTPUT].activeWorkspace, "dev");
  });

  test("activate: true also focuses the moved workspace's (and so its new output's) focus", () => {
    const out = update(twoOutputs(), { type: "workspace/move-to-output", id: "dev", output: "hdmi", activate: true });
    assert.equal(out.state.focusedOutput, "hdmi");
    assert.equal(out.state.activeWorkspace, "dev");
  });

  test("rejects moving the only workspace an output has", () => {
    const out = update(twoOutputs(), { type: "workspace/move-to-output", id: "hdmi-1", output: DEFAULT_OUTPUT });
    assert.equal(out.events[0].reason, "last-workspace-on-output");
  });

  test("rejects an unknown workspace, an unknown output, and is a no-op moving to the same output", () => {
    const state = twoOutputs();
    assert.equal(update(state, { type: "workspace/move-to-output", id: "nope", output: "hdmi" }).events[0].reason, "unknown-workspace");
    assert.equal(update(state, { type: "workspace/move-to-output", id: "dev", output: "nope" }).events[0].reason, "unknown-output");
    assert.equal(update(state, { type: "workspace/move-to-output", id: "dev", output: DEFAULT_OUTPUT }).state, state);
  });

  test("never mutates its input", () => {
    const state = twoOutputs();
    const before = JSON.parse(JSON.stringify(state));
    update(state, { type: "workspace/move-to-output", id: "dev", output: "hdmi" });
    assert.deepEqual(state, before);
  });
});

describe("workspace/create and workspace/activate with outputs", () => {
  test("workspace/create defaults to the focused output, or an explicit one", () => {
    let state = withOutput(createState(), "hdmi", ["hdmi-1"]);
    state = reduce(state, { type: "workspace/create", id: "dev" });
    assert.equal(state.workspaces.dev.output, DEFAULT_OUTPUT);
    state = reduce(state, { type: "workspace/create", id: "movies", output: "hdmi" });
    assert.equal(state.workspaces.movies.output, "hdmi");
    assert.ok(state.outputs.hdmi.workspaces.includes("movies"));
  });

  test("workspace/create rejects an unknown output", () => {
    const out = update(createState(), { type: "workspace/create", id: "dev", output: "nope" });
    assert.equal(out.events[0].reason, "unknown-output");
  });

  test("activating a workspace on another output focuses that output too", () => {
    let state = withOutput(createState(), "hdmi", ["hdmi-1", "hdmi-2"]);
    const out = update(state, { type: "workspace/activate", id: "hdmi-2" });
    assert.equal(out.state.focusedOutput, "hdmi");
    assert.equal(out.state.activeWorkspace, "hdmi-2");
    assert.ok(out.events.some((e) => e.type === "output/focused"));
    assert.ok(out.events.some((e) => e.type === "workspace/activated"));
  });

  test("activating the output's already-active workspace only focuses the output", () => {
    let state = withOutput(createState(), "hdmi", ["hdmi-1"]);
    const out = update(state, { type: "workspace/activate", id: "hdmi-1" });
    assert.equal(out.state.focusedOutput, "hdmi");
    assert.deepEqual(out.events, [{ type: "output/focused", id: "hdmi", previous: DEFAULT_OUTPUT }]);
  });

  test("activating the already-active workspace of the focused output is a no-op", () => {
    const state = createState();
    assert.equal(update(state, { type: "workspace/activate", id: "main" }).state, state);
  });
});

describe("workspace/remove with outputs", () => {
  test("rejects removing the last workspace on an output, even with other outputs present", () => {
    let state = withOutput(createState({ workspaces: ["main", "dev"] }), "hdmi", ["hdmi-1"]);
    const out = update(state, { type: "workspace/remove", id: "hdmi-1" });
    assert.equal(out.events[0].reason, "last-workspace-on-output");
  });

  test("still rejects the single-workspace-overall case with reason 'last-workspace'", () => {
    assert.equal(update(createState(), { type: "workspace/remove", id: "main" }).events[0].reason, "last-workspace");
  });

  test("removing a workspace keeps the output's own workspaces/activeWorkspace in sync", () => {
    let state = createState({ workspaces: ["main", "dev"] });
    const out = update(state, { type: "workspace/remove", id: "main", fallback: "dev" });
    assert.deepEqual(out.state.outputs[DEFAULT_OUTPUT].workspaces, ["dev"]);
    assert.equal(out.state.outputs[DEFAULT_OUTPUT].activeWorkspace, "dev");
  });
});

describe("focus crosses outputs", () => {
  const twoOutputs = () => withOutput(createState(), "hdmi", ["hdmi-1"]);

  test("window/focus on a window belonging to another output switches focusedOutput too", () => {
    let state = twoOutputs();
    state = reduce(state, { type: "window/create", id: "a", workspace: "hdmi-1", focus: false });
    const out = update(state, { type: "window/focus", id: "a" });
    assert.equal(out.state.focusedOutput, "hdmi");
    assert.equal(out.state.activeWorkspace, "hdmi-1");
    assert.ok(out.events.some((e) => e.type === "output/focused"));
    assert.equal(out.state.focus.window, "a");
  });

  test("focus/next wraps from the last window of one output to the first of the next", () => {
    let state = twoOutputs();
    state = reduce(state, { type: "window/create", id: "a" });
    state = reduce(state, { type: "window/create", id: "b", workspace: "hdmi-1", focus: false });
    // Focus is on "a" (default output). focus/next should move to "b" on "hdmi".
    assert.equal(state.focus.window, "a");
    const out = update(state, { type: "focus/next" });
    assert.equal(out.state.focus.window, "b");
    assert.equal(out.state.focusedOutput, "hdmi");
  });

  test("focus/next wraps all the way back around, across outputs", () => {
    let state = twoOutputs();
    state = reduce(state, { type: "window/create", id: "a" });
    state = reduce(state, { type: "window/create", id: "b", workspace: "hdmi-1", focus: false });
    state = reduce(state, { type: "focus/next" }); // -> b, on hdmi
    const out = update(state, { type: "focus/next" }); // -> back to a, on default
    assert.equal(out.state.focus.window, "a");
    assert.equal(out.state.focusedOutput, DEFAULT_OUTPUT);
  });

  test("focus/previous cycles the other way across outputs too", () => {
    let state = twoOutputs();
    state = reduce(state, { type: "window/create", id: "a" });
    state = reduce(state, { type: "window/create", id: "b", workspace: "hdmi-1", focus: false });
    const out = update(state, { type: "focus/previous" }); // from a, backwards -> b on hdmi
    assert.equal(out.state.focus.window, "b");
    assert.equal(out.state.focusedOutput, "hdmi");
  });

  test("focus/next is a no-op (well-formed) with a single focusable window", () => {
    const state = reduce(createState(), { type: "window/create", id: "a" });
    const out = update(state, { type: "focus/next" });
    assert.equal(out.state.focus.window, "a");
  });
});

describe("queries: outputsList, outputActiveWorkspace, outputOf, workspacesOf, focusedOutput", () => {
  test("report per-output facts", () => {
    const state = withOutput(createState({ workspaces: ["main", "dev"] }), "hdmi", ["hdmi-1"]);
    assert.deepEqual(outputsList(state).map((o) => o.id), [DEFAULT_OUTPUT, "hdmi"]);
    assert.equal(outputActiveWorkspace(state), "main");
    assert.equal(outputActiveWorkspace(state, "hdmi"), "hdmi-1");
    assert.equal(outputOf(state, "dev"), DEFAULT_OUTPUT);
    assert.deepEqual(workspacesOf(state, DEFAULT_OUTPUT).map((w) => w.id), ["main", "dev"]);
    assert.equal(focusedOutput(state).id, DEFAULT_OUTPUT);
  });
});

describe("visibility, focusability and paint order are per-output", () => {
  test("a window is visible on its own output's active workspace regardless of which output is focused", () => {
    let state = withOutput(createState(), "hdmi", ["hdmi-1"]);
    state = reduce(state, { type: "window/create", id: "a", workspace: "hdmi-1", focus: false });
    // Default output is focused, but "a" is on hdmi's (only, active) workspace.
    assert.equal(state.focusedOutput, DEFAULT_OUTPUT);
    assert.deepEqual(visibleWindows(state, "hdmi").map((w) => w.id), ["a"]);
    assert.deepEqual(visibleWindows(state, DEFAULT_OUTPUT).map((w) => w.id), []);
    assert.deepEqual(focusable(state, "hdmi"), ["a"]);
    assert.deepEqual(paintOrder(state, "hdmi"), ["a"]);
  });

  test("sticky windows are visible on every workspace of their own output only", () => {
    let state = withOutput(createState({ workspaces: ["main", "dev"] }), "hdmi", ["hdmi-1"]);
    state = reduce(state, { type: "window/create", id: "a" }); // on main (default output)
    state = reduce(state, { type: "window/set-sticky", id: "a", sticky: true });
    state = reduce(state, { type: "workspace/activate", id: "dev" });
    assert.deepEqual(visibleWindows(state, DEFAULT_OUTPUT).map((w) => w.id), ["a"]);
    // hdmi is a different output: "a" does not leak across outputs.
    assert.deepEqual(visibleWindows(state, "hdmi").map((w) => w.id), []);
  });

  test("visibleWindows/focusable/paintOrder default to the focused output", () => {
    let state = withOutput(createState(), "hdmi", ["hdmi-1"]);
    state = reduce(state, { type: "window/create", id: "a" });
    assert.deepEqual(visibleWindows(state).map((w) => w.id), ["a"]);
    assert.deepEqual(focusable(state), ["a"]);
    assert.deepEqual(paintOrder(state), ["a"]);
  });
});

describe("derive(state, { output })", () => {
  test("derives independently for each output", () => {
    let state = withOutput(createState(), "hdmi", ["hdmi-1"]);
    state = reduce(state, { type: "window/create", id: "a" });
    state = reduce(state, { type: "window/create", id: "b", workspace: "hdmi-1", focus: false });
    const mainTree = derive(state, { output: DEFAULT_OUTPUT });
    const hdmiTree = derive(state, { output: "hdmi" });
    assert.deepEqual(views(mainTree), ["a"]);
    assert.deepEqual(views(hdmiTree), ["b"]);
  });

  test("with no `output`, derives the focused output (unchanged single-output behaviour)", () => {
    const state = reduce(createState(), { type: "window/create", id: "a" });
    assert.deepEqual(views(derive(state)), ["a"]);
  });
});

describe("manager: multiple outputs and renderers", () => {
  test("wm.createOutput/focusOutput/moveWorkspaceToOutput/removeOutput are wired to the commands", () => {
    const wm = createWindowManager();
    wm.createOutput("hdmi", { workspaces: ["hdmi-1"] });
    assert.ok(wm.state.outputs.hdmi);
    wm.focusOutput("hdmi");
    assert.equal(wm.state.focusedOutput, "hdmi");
    wm.createOutput("dp", { workspaces: ["dp-1", "dp-2"] });
    wm.moveWorkspaceToOutput("dp-2", "hdmi");
    assert.equal(wm.state.workspaces["dp-2"].output, "hdmi");
    wm.removeOutput("hdmi", { fallback: DEFAULT_OUTPUT });
    assert.equal(wm.state.outputs.hdmi, undefined);
    assert.equal(wm.state.workspaces["dp-2"].output, DEFAULT_OUTPUT);
  });

  test("setRenderer attaches a renderer per output, and each gets that output's own tree", () => {
    const commits = { main: [], hdmi: [] };
    const wm = createWindowManager();
    wm.createOutput("hdmi", { workspaces: ["hdmi-1"] });
    wm.setRenderer(DEFAULT_OUTPUT, { commit: (tree) => commits.main.push(tree) });
    wm.setRenderer("hdmi", { commit: (tree) => commits.hdmi.push(tree) });
    wm.create({ id: "a" });
    wm.create({ id: "b", workspace: "hdmi-1", focus: false });
    assert.ok(commits.main.length > 0);
    assert.ok(commits.hdmi.length > 0);
    assert.deepEqual(viewIdsOf(commits.main.at(-1)), ["a"]);
    assert.deepEqual(viewIdsOf(commits.hdmi.at(-1)), ["b"]);
  });

  test("setRenderer with no renderer detaches it", () => {
    const commits = [];
    const wm = createWindowManager();
    wm.createOutput("hdmi", { workspaces: ["hdmi-1"] });
    wm.setRenderer("hdmi", { commit: (tree) => commits.push(tree) });
    const before = commits.length;
    wm.setRenderer("hdmi", null);
    wm.create({ id: "z", workspace: "hdmi-1", focus: false });
    assert.equal(commits.length, before);
  });

  test("measureOutput reads the named output's renderer measure(), or {} without one", () => {
    const wm = createWindowManager();
    wm.createOutput("hdmi", { workspaces: ["hdmi-1"] });
    assert.deepEqual(wm.measureOutput("hdmi"), {});
    wm.setRenderer("hdmi", { commit() {}, measure: () => ({ width: 1920 }) });
    assert.deepEqual(wm.measureOutput("hdmi"), { width: 1920 });
  });

  test("the single-output `renderer` option keeps driving the focused output's own tree", () => {
    const commits = [];
    const wm = createWindowManager({ renderer: { commit: (tree) => commits.push(tree) } });
    wm.createOutput("hdmi", { workspaces: ["hdmi-1"], focus: true });
    wm.create({ id: "a", workspace: "hdmi-1" });
    assert.deepEqual(viewIdsOf(commits.at(-1)), ["a"]);
  });
});

describe("undo, replay and serialization with multiple outputs", () => {
  test("output/create and output/focus are each one undo step", () => {
    const wm = createWindowManager({ history: true });
    wm.createOutput("hdmi", { workspaces: ["hdmi-1"] });
    wm.focusOutput("hdmi");
    assert.equal(wm.state.focusedOutput, "hdmi");
    wm.undo();
    assert.equal(wm.state.focusedOutput, DEFAULT_OUTPUT);
    assert.ok(wm.state.outputs.hdmi);
    wm.undo();
    assert.equal(wm.state.outputs.hdmi, undefined);
  });

  test("replay(origin, log) reproduces multi-output state exactly", () => {
    const wm = createWindowManager({ history: true });
    wm.createOutput("hdmi", { workspaces: ["hdmi-1"] });
    wm.create({ id: "a" });
    wm.create({ id: "b", workspace: "hdmi-1", focus: false });
    wm.focusOutput("hdmi");
    wm.focus("b");
    assert.deepEqual(replay(wm.origin, wm.log), wm.getState());
  });

  test("serialize/load round-trips outputs exactly", () => {
    const wm = createWindowManager();
    wm.createOutput("hdmi", { workspaces: ["hdmi-1"] });
    wm.create({ id: "a", workspace: "hdmi-1" });
    const saved = wm.serialize();
    const other = createWindowManager();
    other.load(saved);
    assert.deepEqual(other.state, wm.state);
  });
});

describe("browser: two stages, one manager, one renderer + input adapter each", () => {
  /** Two fake DOM roots, each an output's own stage: renderer + attachInput, like the demo page. */
  const setup = () => {
    const doc = createFakeDocument();
    const mainRoot = doc.createElement("div");
    const hdmiRoot = doc.createElement("div");
    doc.body.append(mainRoot, hdmiRoot);
    const wm = createWindowManager({ state: createState(), history: true });
    wm.createOutput("hdmi", { workspaces: ["hdmi-1"] });
    wm.setRenderer(DEFAULT_OUTPUT, createDomRenderer({ root: mainRoot, document: doc, anchorFallback: false }));
    wm.setRenderer("hdmi", createDomRenderer({ root: hdmiRoot, document: doc, anchorFallback: false }));
    const detachMain = attachInput({
      root: mainRoot,
      getState: wm.getState,
      dispatch: wm.dispatch,
      present: (state) => wm.present(state, { output: DEFAULT_OUTPUT }),
      output: DEFAULT_OUTPUT,
    });
    const detachHdmi = attachInput({
      root: hdmiRoot,
      getState: wm.getState,
      dispatch: wm.dispatch,
      present: (state) => wm.present(state, { output: "hdmi" }),
      output: "hdmi",
    });
    const at = (target, x = 10, y = 10) => ({ target, clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {} });
    return { doc, mainRoot, hdmiRoot, wm, detachMain, detachHdmi, at };
  };

  test("each stage renders only its own output's windows", () => {
    const t = setup();
    t.wm.create({ id: "a" }); // main
    t.wm.create({ id: "b", workspace: "hdmi-1", focus: false });
    assert.ok(t.mainRoot.querySelector('wm-view[data-view="a"]'));
    assert.equal(t.mainRoot.querySelector('wm-view[data-view="b"]'), null);
    assert.ok(t.hdmiRoot.querySelector('wm-view[data-view="b"]'));
    assert.equal(t.hdmiRoot.querySelector('wm-view[data-view="a"]'), null);
  });

  test("clicking a window on the non-focused stage focuses it, and its output", () => {
    const t = setup();
    t.wm.create({ id: "a" });
    t.wm.create({ id: "b", workspace: "hdmi-1", focus: false });
    assert.equal(t.wm.state.focusedOutput, DEFAULT_OUTPUT);
    const bEl = t.hdmiRoot.querySelector('wm-view[data-view="b"]');
    t.hdmiRoot.dispatch("pointerdown", t.at(bEl));
    t.hdmiRoot.dispatch("pointerup", t.at(bEl));
    assert.equal(t.wm.state.focus.window, "b");
    assert.equal(t.wm.state.focusedOutput, "hdmi");
  });

  test("detaching an output's input adapter and renderer (output/remove) leaves the other stage working", () => {
    const t = setup();
    t.wm.create({ id: "a" });
    t.wm.create({ id: "b", workspace: "hdmi-1", focus: false });
    t.detachHdmi();
    t.wm.removeOutput("hdmi");
    assert.equal(t.wm.state.outputs.hdmi, undefined);
    const aEl = t.mainRoot.querySelector('wm-view[data-view="a"]');
    t.mainRoot.dispatch("pointerdown", t.at(aEl));
    t.mainRoot.dispatch("pointerup", t.at(aEl));
    assert.equal(t.wm.state.focus.window, "a");
  });
});

describe("browser: splitter drag/keydown on a non-focused stage acts on that stage's own workspace", () => {
  /**
   * Same two-stage rig, but the hdmi output's workspace has a columns layout
   * with two windows, so it renders a resizable splitter. `main` stays
   * focused throughout: this reproduces dragging or arrow-keying the
   * splitter shown on the OTHER output's stage.
   */
  const setup = () => {
    const doc = createFakeDocument();
    const mainRoot = doc.createElement("div");
    const hdmiRoot = doc.createElement("div");
    mainRoot.rect = { left: 0, top: 0, width: 300, height: 100 };
    hdmiRoot.rect = { left: 0, top: 0, width: 300, height: 100 };
    doc.body.append(mainRoot, hdmiRoot);
    const wm = createWindowManager({ state: createState(), history: true });
    wm.createOutput("hdmi", { workspaces: [{ id: "hdmi-1", layout: { type: "columns" } }] });
    wm.setRenderer(DEFAULT_OUTPUT, createDomRenderer({ root: mainRoot, document: doc, anchorFallback: false }));
    wm.setRenderer("hdmi", createDomRenderer({ root: hdmiRoot, document: doc, anchorFallback: false }));
    attachInput({
      root: mainRoot,
      getState: wm.getState,
      dispatch: wm.dispatch,
      present: (state) => wm.present(state, { output: DEFAULT_OUTPUT }),
      output: DEFAULT_OUTPUT,
    });
    attachInput({
      root: hdmiRoot,
      getState: wm.getState,
      dispatch: wm.dispatch,
      present: (state) => wm.present(state, { output: "hdmi" }),
      output: "hdmi",
    });
    wm.create({ id: "main-a" }); // main's own workspace, so it also has a splitter
    wm.create({ id: "main-b" });
    wm.create({ id: "x", workspace: "hdmi-1", focus: false });
    wm.create({ id: "y", workspace: "hdmi-1", focus: false });
    assert.equal(wm.state.focusedOutput, DEFAULT_OUTPUT, "main stays focused: hdmi's stage is the non-focused one");
    const layoutRect = (root, sizes) => {
      const el = root.querySelector('[data-layout="row"], [data-layout="column"]');
      let pos = 0;
      for (const kid of el.childNodes) {
        const extent = sizes[el.childNodes.indexOf(kid)] ?? 0;
        kid.rect = { left: pos, top: 0, width: extent, height: 100 };
        pos += extent;
      }
      el.rect = { left: 0, top: 0, width: pos, height: 100 };
    };
    const splitterOf = (root) => root.querySelector("[data-wm-splitter]");
    const at = (x, y = 50, extra = {}) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, preventDefault() {}, ...extra });
    return { doc, mainRoot, hdmiRoot, wm, layoutRect, splitterOf, at };
  };

  test("dragging the splitter rendered on hdmi's stage resizes hdmi-1, not main (the focused output's active workspace)", () => {
    const t = setup();
    t.layoutRect(t.hdmiRoot, [150, 150]);
    const splitter = t.splitterOf(t.hdmiRoot);
    t.hdmiRoot.dispatch("pointerdown", { target: splitter, ...t.at(150) });
    t.hdmiRoot.dispatch("pointermove", t.at(180));
    t.hdmiRoot.dispatch("pointerup", t.at(180));
    assert.notEqual(t.wm.state.workspaces["hdmi-1"].layout.sizes?.[""], undefined, "hdmi-1's own split was resized");
    assert.equal(t.wm.state.workspaces.main.layout.sizes, undefined, "main's split (the focused output's active workspace) was left untouched");
  });

  test("arrow-keying the splitter rendered on hdmi's stage resizes hdmi-1, not main", () => {
    const t = setup();
    t.layoutRect(t.hdmiRoot, [150, 150]);
    const splitter = t.splitterOf(t.hdmiRoot);
    t.hdmiRoot.dispatch("keydown", { target: splitter, key: "ArrowRight", type: "keydown", preventDefault() {}, stopPropagation() {} });
    assert.notEqual(t.wm.state.workspaces["hdmi-1"].layout.sizes?.[""], undefined, "hdmi-1's own split was resized");
    assert.equal(t.wm.state.workspaces.main.layout.sizes, undefined, "main's split was left untouched");
  });
});

describe("STATE_VERSION bump and migration from version 1 (pre-outputs)", () => {
  /** A hand-built version-1 state: single implicit output, no `outputs`/`output` fields. */
  const v1State = () => ({
    version: 1,
    config: { focusRaises: true, gap: 0, inset: 0, defaultPlacement: { x: 40, y: 40, width: 480, height: 320 }, drag: { tiled: "swap-or-insert", edgeZone: 0.25, preview: true, tooSmall: "allow", toFloating: "modifier", toTiled: "modifier", crossWorkspace: true, follow: false } },
    windows: {
      a: { id: "a", title: "A", role: "window", parent: null, modal: false, mode: "tiled", placement: { x: 40, y: 40, width: 480, height: 320 }, constraints: {}, status: "normal", layer: "normal", anchor: null, workspace: "main" },
    },
    workspaces: { main: { id: "main", windows: ["a"], layout: { type: "master-stack", ratio: 0.5 } } },
    workspaceOrder: ["main"],
    activeWorkspace: "main",
    focus: { window: "a", history: ["a"] },
    stack: { background: [], normal: ["a"], top: [], modal: [], popover: [], notification: [], system: [] },
    lastScratchpad: null,
    urgent: [],
  });

  test("STATE_VERSION is 2", () => {
    assert.equal(STATE_VERSION, 2);
  });

  test("backfills outputs, outputOrder, focusedOutput and each workspace's output", () => {
    const result = migrate(v1State());
    assert.ok(result.ok);
    assert.equal(result.state.version, STATE_VERSION);
    assert.deepEqual(result.state.outputOrder, [DEFAULT_OUTPUT]);
    assert.equal(result.state.focusedOutput, DEFAULT_OUTPUT);
    assert.deepEqual(result.state.outputs[DEFAULT_OUTPUT].workspaces, ["main"]);
    assert.equal(result.state.outputs[DEFAULT_OUTPUT].activeWorkspace, "main");
    assert.equal(result.state.workspaces.main.output, DEFAULT_OUTPUT);
  });

  test("a migrated version-1 state derives and updates normally", () => {
    const result = migrate(v1State());
    const out = update(result.state, { type: "output/create", id: "hdmi" });
    assert.ok(out.state.outputs.hdmi);
  });

  test("an unversioned (version 0) state chains through both migration steps to version 2", () => {
    const v0 = { ...v1State() };
    delete v0.version;
    delete v0.config.drag;
    v0.windows.a.draggable = true;
    const result = migrate(v0);
    assert.ok(result.ok);
    assert.equal(result.state.version, STATE_VERSION);
    assert.ok(result.state.outputs[DEFAULT_OUTPUT]);
    assert.equal("draggable" in result.state.windows.a, false);
  });

  test("wm.load() migrates a version-1 saved session", () => {
    const wm = createWindowManager();
    wm.load(JSON.stringify(v1State()));
    assert.equal(wm.state.version, STATE_VERSION);
    assert.ok(wm.state.outputs[DEFAULT_OUTPUT]);
    assert.equal(wm.state.workspaces.main.output, DEFAULT_OUTPUT);
  });

  test("round-trip: migrate(createState()) is a no-op", () => {
    const state = createState({ workspaces: ["main", "dev"] });
    const result = migrate(state);
    assert.deepEqual(result.state, state);
  });
});

describe("COMMANDS lists the new output vocabulary", () => {
  test("output/create, output/remove, output/focus, workspace/move-to-output", () => {
    for (const type of ["output/create", "output/remove", "output/focus", "workspace/move-to-output"]) {
      assert.ok(COMMANDS.includes(type), type);
    }
  });
});
