import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createState, update, reduce, replay, matchRules, validRules, MATCH_FIELDS, SET_FIELDS } from "../src/index.mjs";

describe("window rules: matching", () => {
  test("a rule with no match field matches every window", () => {
    const state = reduce(createState(), { type: "rules/set", rules: [{ set: { layer: "top" } }] });
    const out = update(state, { type: "window/create", id: "a" });
    assert.equal(out.state.windows.a.layer, "top");
    assert.deepEqual(out.events.find((e) => e.type === "window/created").rules, [0]);
  });

  test("role, id, idPrefix, title, titleRegex, app and parent each match", () => {
    const rules = [
      { match: { role: "dialog" }, set: { layer: "modal" } },
      { match: { id: "settings" }, set: { layer: "top" } },
      { match: { idPrefix: "term-" }, set: { workspace: "b" } },
      { match: { title: "Editor" }, set: { mode: "floating" } },
      { match: { titleRegex: "^Log " }, set: { status: "minimized" } },
      { match: { app: "terminal" }, set: { draggable: false } },
    ];
    let state = createState({ workspaces: ["main", "b"] });
    state = reduce(state, { type: "rules/set", rules });

    let s = reduce(state, { type: "window/create", id: "d1", role: "dialog", parent: undefined });
    // dialogs need a parent; create one first for a real modal test below.
    s = reduce(state, { type: "window/create", id: "host" });
    s = reduce(s, { type: "window/create", id: "d2", role: "dialog", parent: "host" });
    assert.equal(s.windows.d2.layer, "modal");

    s = reduce(state, { type: "window/create", id: "settings" });
    assert.equal(s.windows.settings.layer, "top");

    s = reduce(state, { type: "window/create", id: "term-1" });
    assert.equal(s.windows["term-1"].workspace, "b");

    s = reduce(state, { type: "window/create", id: "e1", title: "Editor" });
    assert.equal(s.windows.e1.mode, "floating");

    // focus: false — otherwise window/create's default focus would restore a minimized window.
    s = reduce(state, { type: "window/create", id: "l1", title: "Log output", focus: false });
    assert.equal(s.windows.l1.status, "minimized");

    s = reduce(state, { type: "window/create", id: "t1", app: "terminal" });
    assert.equal(s.windows.t1.draggable, false);

    // non-matching windows are unaffected
    s = reduce(state, { type: "window/create", id: "plain" });
    assert.equal(s.windows.plain.layer, "normal");
    assert.equal(s.windows.plain.mode, "tiled");
  });

  test("parent match", () => {
    const rules = [{ match: { parent: "host" }, set: { layer: "popover" } }];
    let state = reduce(createState(), { type: "rules/set", rules });
    state = reduce(state, { type: "window/create", id: "host" });
    state = reduce(state, { type: "window/create", id: "child", role: "popover", parent: "host" });
    assert.equal(state.windows.child.layer, "popover");
  });

  test("matchRules is a pure query returning matched indices, without applying them", () => {
    const rules = [{ match: { role: "window" }, set: { layer: "top" } }, { match: { id: "x" }, set: { mode: "floating" } }];
    const state = reduce(createState(), { type: "rules/set", rules });
    const win = { id: "x", role: "window", title: "", parent: null };
    assert.deepEqual(matchRules(state, win), [0, 1]);
    // no mutation, no application
    assert.equal(state.windows.x, undefined);
  });

  test("titleRegex is stored as a source string, not a RegExp", () => {
    const rules = [{ match: { titleRegex: "^Term" }, set: { layer: "top" } }];
    const state = reduce(createState(), { type: "rules/set", rules });
    assert.equal(typeof state.config.rules[0].match.titleRegex, "string");
    assert.equal(JSON.parse(JSON.stringify(state.config.rules))[0].match.titleRegex, "^Term");
  });

  test("an invalid regex source simply fails to match, never throws", () => {
    const rules = [{ match: { titleRegex: "(" }, set: { layer: "top" } }];
    const state = reduce(createState(), { type: "rules/set", rules });
    const out = update(state, { type: "window/create", id: "a", title: "anything" });
    assert.equal(out.state.windows.a.layer, "normal");
  });
});

describe("window rules: precedence", () => {
  test("later rules override earlier ones on the same field", () => {
    const rules = [{ set: { layer: "top" } }, { set: { layer: "popover" } }];
    const state = reduce(createState(), { type: "rules/set", rules });
    const out = reduce(state, { type: "window/create", id: "a" });
    assert.equal(out.windows.a.layer, "popover");
  });

  test("placement and constraints merge one level deep across rules", () => {
    const rules = [
      { set: { placement: { x: 10, y: 20 }, constraints: { minWidth: 100 } } },
      { set: { placement: { y: 99 }, constraints: { minHeight: 50 } } },
    ];
    const state = reduce(createState(), { type: "rules/set", rules });
    const out = reduce(state, { type: "window/create", id: "a" });
    assert.equal(out.windows.a.placement.x, 10);
    assert.equal(out.windows.a.placement.y, 99);
    assert.equal(out.windows.a.constraints.minWidth, 100);
    assert.equal(out.windows.a.constraints.minHeight, 50);
  });

  test("explicit fields on the create command always win over rules", () => {
    const rules = [{ set: { layer: "top", mode: "floating" } }];
    const state = reduce(createState(), { type: "rules/set", rules });
    const out = reduce(state, { type: "window/create", id: "a", layer: "modal", mode: "tiled" });
    assert.equal(out.windows.a.layer, "modal");
    assert.equal(out.windows.a.mode, "tiled");
  });

  test("explicit placement fields still let rules apply mode/layer", () => {
    const rules = [{ set: { layer: "top", placement: { x: 500 } } }];
    const state = reduce(createState(), { type: "rules/set", rules });
    const out = reduce(state, { type: "window/create", id: "a", placement: { x: 1, y: 2 } });
    assert.equal(out.windows.a.layer, "top");
    assert.equal(out.windows.a.placement.x, 1); // explicit placement wins wholesale
  });

  test("a rule setting workspace is honoured when the command omits workspace", () => {
    const rules = [{ match: { role: "window" }, set: { workspace: "b" } }];
    let state = createState({ workspaces: ["main", "b"] });
    state = reduce(state, { type: "rules/set", rules });
    const out = update(state, { type: "window/create", id: "a" });
    assert.equal(out.state.windows.a.workspace, "b");
  });

  test("a rule sending a window to an unknown workspace rejects window/create", () => {
    const rules = [{ set: { workspace: "nope" } }];
    const state = reduce(createState(), { type: "rules/set", rules });
    const out = update(state, { type: "window/create", id: "a" });
    assert.equal(out.state.windows.a, undefined);
    assert.equal(out.events[0].reason, "unknown-workspace");
  });

  test("draggable: false from a rule, and un-pinning via a later rule", () => {
    const rules = [{ match: { id: "a" }, set: { draggable: false } }, { match: { id: "b" }, set: { draggable: false } }];
    let state = reduce(createState(), { type: "rules/set", rules });
    state = reduce(state, { type: "window/create", id: "a" });
    assert.equal(state.windows.a.draggable, false);
    // a second rule for the same window re-enabling it should win (later overrides earlier)
    state = reduce(state, {
      type: "rules/set",
      rules: [{ match: { id: "b" }, set: { draggable: false } }, { match: { id: "b" }, set: { draggable: true } }],
    });
    state = reduce(state, { type: "window/create", id: "b" });
    assert.equal(state.windows.b.draggable, undefined); // draggable (the default) is never stored
  });

  test("constraints from a rule re-clamp the resolved placement", () => {
    const rules = [{ set: { constraints: { minWidth: 900 } } }];
    const state = reduce(createState(), { type: "rules/set", rules });
    const out = reduce(state, { type: "window/create", id: "a" }); // default placement width 480
    assert.equal(out.windows.a.placement.width, 900);
  });

  test("anchor and status can be set by a rule", () => {
    const rules = [{ match: { role: "popover" }, set: { anchor: { of: "host", edge: "bottom" }, status: "minimized" } }];
    let state = reduce(createState(), { type: "rules/set", rules });
    state = reduce(state, { type: "window/create", id: "host" });
    state = reduce(state, { type: "window/create", id: "p1", role: "popover", parent: "host", focus: false });
    assert.deepEqual(state.windows.p1.anchor, { of: "host", edge: "bottom" });
    assert.equal(state.windows.p1.status, "minimized");
  });
});

describe("window rules: serialization and undo", () => {
  test("state with rules survives a JSON round trip", () => {
    const rules = [{ match: { role: "dialog" }, set: { layer: "modal" } }];
    const state = reduce(createState(), { type: "rules/set", rules });
    const revived = JSON.parse(JSON.stringify(state));
    assert.deepEqual(revived.config.rules, rules);
  });

  test("log + replay reproduces rule-affected windows identically", () => {
    const rules = [{ match: { idPrefix: "term-" }, set: { layer: "top", mode: "floating" } }];
    const commands = [
      { type: "rules/set", rules },
      { type: "window/create", id: "term-1" },
      { type: "window/create", id: "plain" },
    ];
    const state = replay(createState(), commands);
    const again = replay(createState(), commands);
    assert.deepEqual(state, again);
    assert.equal(state.windows["term-1"].layer, "top");
    assert.equal(state.windows["term-1"].mode, "floating");
  });

  test("rules/set is one command — undoing it (via replay without it) removes its future effect", () => {
    const rules = [{ set: { layer: "top" } }];
    const withRules = replay(createState(), [{ type: "rules/set", rules }, { type: "window/create", id: "a" }]);
    const withoutRules = replay(createState(), [{ type: "window/create", id: "a" }]);
    assert.equal(withRules.windows.a.layer, "top");
    assert.equal(withoutRules.windows.a.layer, "normal");
  });

  test("config/set can also set rules directly", () => {
    const rules = [{ set: { layer: "top" } }];
    const state = reduce(createState(), { type: "config/set", rules });
    assert.deepEqual(state.config.rules, rules);
    const out = reduce(state, { type: "window/create", id: "a" });
    assert.equal(out.windows.a.layer, "top");
  });
});

describe("window rules: malformed rules are rejected, never thrown", () => {
  test("rules/set rejects a non-array", () => {
    const state = createState();
    const out = update(state, { type: "rules/set", rules: { not: "an array" } });
    assert.equal(out.state, state);
    assert.equal(out.events[0].reason, "invalid-rules");
  });

  test("rules/set rejects an unknown match key", () => {
    const out = update(createState(), { type: "rules/set", rules: [{ match: { nope: 1 } }] });
    assert.equal(out.events[0].reason, "invalid-rules");
  });

  test("rules/set rejects an unknown set key", () => {
    const out = update(createState(), { type: "rules/set", rules: [{ set: { nope: 1 } }] });
    assert.equal(out.events[0].reason, "invalid-rules");
  });

  test("rules/set rejects a bad role, layer, mode or status in a rule", () => {
    assert.equal(update(createState(), { type: "rules/set", rules: [{ match: { role: "nope" } }] }).events[0].reason, "invalid-rules");
    assert.equal(update(createState(), { type: "rules/set", rules: [{ set: { layer: "nope" } }] }).events[0].reason, "invalid-rules");
    assert.equal(update(createState(), { type: "rules/set", rules: [{ set: { mode: "nope" } }] }).events[0].reason, "invalid-rules");
    assert.equal(update(createState(), { type: "rules/set", rules: [{ set: { status: "nope" } }] }).events[0].reason, "invalid-rules");
  });

  test("rules/set rejects wrong types for string/boolean/object fields", () => {
    assert.equal(update(createState(), { type: "rules/set", rules: [{ match: { id: 5 } }] }).events[0].reason, "invalid-rules");
    assert.equal(update(createState(), { type: "rules/set", rules: [{ set: { draggable: "no" } }] }).events[0].reason, "invalid-rules");
    assert.equal(update(createState(), { type: "rules/set", rules: [{ set: { placement: "no" } }] }).events[0].reason, "invalid-rules");
    assert.equal(update(createState(), { type: "rules/set", rules: [{ set: { workspace: 5 } }] }).events[0].reason, "invalid-rules");
  });

  test("rules/set rejects an unparseable titleRegex", () => {
    const out = update(createState(), { type: "rules/set", rules: [{ match: { titleRegex: "(" } }] });
    assert.equal(out.events[0].reason, "invalid-rules");
  });

  test("rules/set rejects a rule that isn't a plain object, or has extra keys", () => {
    assert.equal(update(createState(), { type: "rules/set", rules: ["nope"] }).events[0].reason, "invalid-rules");
    assert.equal(update(createState(), { type: "rules/set", rules: [null] }).events[0].reason, "invalid-rules");
    assert.equal(update(createState(), { type: "rules/set", rules: [{ match: {}, set: {}, extra: 1 }] }).events[0].reason, "invalid-rules");
  });

  test("config/set rejects malformed rules the same way", () => {
    const out = update(createState(), { type: "config/set", rules: [{ set: { layer: "nope" } }] });
    assert.equal(out.events[0].reason, "invalid-config");
  });

  test("a rejected rules/set leaves state unchanged", () => {
    const state = createState();
    const out = update(state, { type: "rules/set", rules: [{ set: { layer: "nope" } }] });
    assert.equal(out.state, state);
  });

  test("validRules and the field lists are exported and consistent", () => {
    assert.equal(validRules([]), true);
    assert.equal(validRules([{ match: { role: "window" } }]), true);
    assert.equal(validRules("nope"), false);
    assert.ok(MATCH_FIELDS.includes("titleRegex"));
    assert.ok(SET_FIELDS.includes("constraints"));
  });
});
