import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  createWindowManager,
  update,
  COMMANDS,
  COMMAND_CATALOG,
  REQUIREMENTS,
  paletteEntries,
  fuzzyMatch,
  fieldChoices,
  defaultValue,
  parseField,
  buildCommand,
  isAvailable,
} from "../src/index.mjs";
import { createPalette, parseShortcut, matchesShortcut, PALETTE_CSS } from "../src/browser/index.mjs";
import { THEME_TOKENS } from "../src/css/theme.mjs";
import { createFakeDocument } from "./helpers/fake-dom.mjs";

const run = (state, ...commands) => commands.reduce((s, c) => update(s, c).state, state);
const rich = () => {
  let s = createState({ workspaces: ["main", "two"] });
  s = run(s, { type: "window/create", id: "a", title: "Editor" }, { type: "window/create", id: "b", title: "Terminal" }, { type: "window/create", id: "f", title: "Floaty", mode: "floating" });
  s = run(s, { type: "output/create", id: "right" }, { type: "window/focus", id: "b" });
  return s;
};

describe("the command catalog", () => {
  test("describes every built-in command, and nothing else", () => {
    assert.deepEqual(Object.keys(COMMAND_CATALOG).sort(), [...COMMANDS].sort());
    assert.equal(Object.keys(COMMAND_CATALOG).length, 58);
  });

  test("every entry is well formed: a title, a group, known field kinds, unique field names, known requirements", () => {
    const kinds = new Set(["window", "workspace", "output", "new", "text", "number", "boolean", "choice", "json", "layout"]);
    for (const [type, entry] of Object.entries(COMMAND_CATALOG)) {
      assert.ok(entry.title && entry.group, type);
      const names = entry.fields.map((f) => f.name);
      assert.equal(new Set(names).size, names.length, `${type} field names`);
      for (const field of entry.fields) {
        assert.ok(kinds.has(field.kind), `${type}.${field.name} kind ${field.kind}`);
        assert.ok(field.label, `${type}.${field.name} label`);
        if (field.kind === "choice") assert.ok(field.choices.length, `${type}.${field.name} choices`);
      }
      for (const token of entry.requires ?? []) assert.ok(token in REQUIREMENTS, `${type} requires ${token}`);
    }
  });

  test("a palette run for every command builds a command `update` understands (never unknown/invalid)", () => {
    const state = rich();
    const sample = { number: 5, text: "x", json: {} };
    for (const [type, entry] of Object.entries(COMMAND_CATALOG)) {
      const values = {};
      for (const field of entry.fields) {
        if (field.optional && !field.ask) continue;
        const choices = fieldChoices(state, field);
        let value;
        if (choices) value = field.kind === "layout" ? { type: choices[0].value } : choices[0]?.value;
        else if (field.kind === "new") value = defaultValue(state, field);
        else if (field.kind === "json") value = field.spread ? { gap: 4 } : field.name === "rules" ? [] : {};
        else value = sample[field.kind];
        values[field.name] = value;
      }
      const command = buildCommand(type, values);
      assert.equal(command.type, type);
      const out = update(state, command);
      const reasons = out.events.filter((e) => e.type === "command/rejected").map((e) => e.reason);
      assert.ok(!reasons.includes("unknown-command") && !reasons.includes("invalid-command"), `${type}: ${reasons}`);
    }
  });

  test("the requirements decide which commands a state offers", () => {
    const empty = createState();
    const types = (state) => paletteEntries(state).map((e) => e.type);
    assert.ok(types(empty).includes("window/create"));
    assert.ok(!types(empty).includes("window/close"));
    assert.ok(!types(empty).includes("workspace/activate"), "one workspace: nothing to switch to");
    assert.ok(!types(empty).includes("output/focus"));
    const state = rich();
    assert.ok(types(state).includes("window/close"));
    assert.ok(types(state).includes("workspace/activate"));
    assert.ok(types(state).includes("output/focus"));
    assert.ok(!types(state).includes("window/pop-in"), "nothing is popped out");
    assert.ok(!types(state).includes("focus/urgent"));
    assert.ok(!types(state).includes("window/from-scratchpad"));
    const popped = run(state, { type: "window/pop-out", id: "a" }, { type: "window/set-urgent", id: "b" }, { type: "window/to-scratchpad", id: "f" });
    assert.ok(types(popped).includes("window/pop-in"));
    assert.ok(types(popped).includes("focus/urgent"));
    assert.ok(types(popped).includes("window/from-scratchpad"));
    assert.ok(isAvailable(popped, "window/pop-in") && !isAvailable(state, "window/pop-in"));
    const floatingLayout = createState({ layout: { type: "floating" } });
    assert.ok(!isAvailable(floatingLayout, "window/move"));
    assert.ok(isAvailable(run(floatingLayout, { type: "window/create", id: "z" }), "window/move"), "a window on a floating-layout workspace can be moved");
  });

  test("exclude and catalog options", () => {
    const state = rich();
    assert.ok(!paletteEntries(state, { exclude: ["window/close"] }).some((e) => e.type === "window/close"));
    const custom = paletteEntries(state, { catalog: { "my/thing": { title: "My thing", group: "Mine", fields: [] } } });
    assert.ok(custom.some((e) => e.type === "my/thing"));
    const renamed = paletteEntries(state, { catalog: { "window/close": { ...COMMAND_CATALOG["window/close"], title: "Shut" } } });
    assert.equal(renamed.find((e) => e.type === "window/close").title, "Shut");
  });
});

describe("fuzzy matching", () => {
  test("subsequence, case-insensitive, spaces ignored", () => {
    assert.ok(fuzzyMatch("cw", "Close window"));
    assert.ok(fuzzyMatch("CLOSE W", "Close window"));
    assert.equal(fuzzyMatch("xyz", "Close window"), null);
    assert.equal(fuzzyMatch("windowx", "window"), null, "longer than the text");
    assert.deepEqual(fuzzyMatch("", "anything"), { score: 0, ranges: [] });
  });

  test("ranges point at the matched characters, merged when consecutive", () => {
    assert.deepEqual(fuzzyMatch("clo", "Close window").ranges, [[0, 3]]);
    assert.deepEqual(fuzzyMatch("cw", "Close window").ranges, [[0, 1], [6, 7]]);
  });

  test("word starts and runs beat scattered matches; earlier beats later", () => {
    assert.ok(fuzzyMatch("cw", "Close window").score > fuzzyMatch("cw", "Focus next window").score);
    assert.ok(fuzzyMatch("foc", "Focus window").score > fuzzyMatch("foc", "a fine old cup").score);
    assert.ok(fuzzyMatch("win", "window").score > fuzzyMatch("win", "a window").score);
  });

  test("a phrase typed contiguously beats a scattered match, and among equals the shorter text wins", () => {
    assert.ok(fuzzyMatch("move window", "Move window").score > fuzzyMatch("move window", "Move window to workspace").score);
    assert.deepEqual(fuzzyMatch("window", "Move window to workspace").ranges, [[5, 11]]);
    assert.deepEqual(paletteEntries(rich(), { query: "move window" }).slice(0, 2).map((e) => e.title), ["Move window", "Move window later"]);
  });

  test("a query ranks entries: title hits first, then type, group and keywords", () => {
    const state = rich();
    const top = (query) => paletteEntries(state, { query })[0]?.type;
    assert.equal(top("close win"), "window/close");
    assert.equal(top("new ws"), "workspace/create");
    // regression: a keyword followed by a word of the type/group ("new window" for "Open window", keywords "new add")
    // used to match nothing, while "Pop window out" matched it by accident (found building the workbench app)
    assert.equal(top("new window"), "window/create");
    assert.equal(top("add window"), "window/create");
    const byKeyword = paletteEntries(state, { query: "undock" }).map((e) => e.type);
    assert.ok(byKeyword.includes("window/detach") && byKeyword.includes("window/toggle-floating"));
    assert.deepEqual(paletteEntries(state, { query: "zzzzqq" }), []);
    const highlighted = paletteEntries(state, { query: "clo" }).find((e) => e.type === "window/close");
    assert.deepEqual(highlighted.ranges, [[0, 3]]);
  });
});

describe("prompting for fields", () => {
  test("window choices put the focused window first and carry a detail", () => {
    const state = rich();
    const choices = fieldChoices(state, { kind: "window", name: "id" });
    assert.equal(choices[0].value, "b");
    assert.match(choices[0].detail, /focused/);
    assert.deepEqual(choices.map((c) => c.label).sort(), ["Editor", "Floaty", "Terminal"]);
    assert.deepEqual(fieldChoices(state, { kind: "window", name: "id", where: "floating" }).map((c) => c.value), ["f"]);
    assert.deepEqual(fieldChoices(state, { kind: "workspace" }).map((c) => c.value), ["main", "two", "right-1"]);
    assert.deepEqual(fieldChoices(state, { kind: "output" }).map((c) => c.value), ["primary", "right"]);
    assert.ok(fieldChoices(state, { kind: "layout" }).some((c) => c.value === "bsp"));
    assert.ok(fieldChoices(state, { kind: "layout" }, { layouts: ["custom"] }).some((c) => c.value === "custom"));
    assert.deepEqual(fieldChoices(state, { kind: "boolean" }).map((c) => c.value), [true, false]);
    assert.equal(fieldChoices(state, { kind: "text" }), null);
  });

  test("defaults: the focused window, a fresh id, the active workspace, a declared default", () => {
    const state = rich();
    assert.equal(defaultValue(state, { kind: "window", name: "id" }), "b");
    assert.equal(defaultValue(state, { kind: "new", prefix: "window" }), "window-4");
    assert.equal(defaultValue(run(state, { type: "window/create", id: "window-4" }), { kind: "new", prefix: "window" }), "window-5");
    assert.equal(defaultValue(state, { kind: "new", prefix: "workspace" }), "workspace-4");
    assert.equal(defaultValue(state, { kind: "workspace" }), "main");
    assert.equal(defaultValue(state, { kind: "boolean", default: false }), false);
  });

  test("parseField: numbers, JSON, required and optional text, layouts", () => {
    assert.deepEqual(parseField({ kind: "number", label: "X" }, "12.5"), { ok: true, value: 12.5 });
    assert.equal(parseField({ kind: "number", label: "X" }, "abc").ok, false);
    assert.equal(parseField({ kind: "number", label: "X" }, "").ok, false);
    assert.deepEqual(parseField({ kind: "text", label: "T", optional: true }, ""), { ok: true, skip: true });
    assert.equal(parseField({ kind: "text", label: "T" }, "").ok, false);
    assert.deepEqual(parseField({ kind: "json", label: "J" }, '{"a":1}'), { ok: true, value: { a: 1 } });
    assert.equal(parseField({ kind: "json", label: "J" }, "{nope").ok, false);
    assert.equal(parseField({ kind: "json", label: "J", spread: true }, "[1]").ok, false);
    assert.deepEqual(parseField({ kind: "layout" }, "bsp"), { ok: true, value: { type: "bsp" } });
  });

  test("buildCommand: values by field name, `spread` merges a JSON object, undefined is skipped", () => {
    assert.deepEqual(buildCommand("window/close", { id: "a" }), { type: "window/close", id: "a" });
    assert.deepEqual(buildCommand("config/set", { patch: { gap: 8, inset: 2 } }), { type: "config/set", gap: 8, inset: 2 });
    assert.deepEqual(buildCommand("window/create", { id: "n", title: undefined }), { type: "window/create", id: "n" });
    assert.deepEqual(buildCommand("layout/set", { layout: { type: "bsp" } }), { type: "layout/set", layout: { type: "bsp" } });
    assert.deepEqual(buildCommand("unknown/command", { id: "a" }), { type: "unknown/command" });
  });
});

describe("shortcuts", () => {
  const key = (k, mods = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  test("Mod means Ctrl or Cmd (one of them), other modifiers must match exactly", () => {
    const parsed = parseShortcut("Mod+Shift+P");
    assert.ok(matchesShortcut(parsed, key("P", { ctrlKey: true, shiftKey: true })));
    assert.ok(matchesShortcut(parsed, key("p", { metaKey: true, shiftKey: true })));
    assert.ok(!matchesShortcut(parsed, key("P", { shiftKey: true })));
    assert.ok(!matchesShortcut(parsed, key("P", { ctrlKey: true })));
    assert.ok(!matchesShortcut(parsed, key("P", { ctrlKey: true, shiftKey: true, altKey: true })));
    assert.ok(!matchesShortcut(parsed, key("P", { ctrlKey: true, metaKey: true, shiftKey: true })));
    assert.ok(!matchesShortcut(parsed, key("K", { ctrlKey: true, shiftKey: true })));
  });
  test("explicit modifiers, Space, errors", () => {
    assert.ok(matchesShortcut(parseShortcut("Alt+Space"), key(" ", { altKey: true })));
    assert.ok(matchesShortcut(parseShortcut("Ctrl+K"), key("k", { ctrlKey: true })));
    assert.ok(!matchesShortcut(parseShortcut("Ctrl+K"), key("k", { metaKey: true })));
    assert.ok(matchesShortcut(parseShortcut("F1"), key("F1")));
    assert.throws(() => parseShortcut(""), TypeError);
    assert.throws(() => parseShortcut("Hyper+K"), TypeError);
  });
});

// ------------------------------------------------------------------ the UI

const setup = ({ state, options = {} } = {}) => {
  const doc = createFakeDocument();
  const outside = doc.createElement("button");
  doc.body.append(outside);
  const wm = createWindowManager({ state: state ?? rich(), history: true });
  const palette = createPalette({ wm, document: doc, ...options });
  const dialog = () => palette.element.querySelector("[data-wm-palette]");
  const input = () => palette.element.querySelector("input");
  const list = () => palette.element.querySelector("[role=listbox]");
  const options_ = () => palette.element.querySelectorAll("[role=option]");
  const names = () => options_().map((o) => o.querySelector("[data-wm-palette-name]").textContent);
  const type = (text) => {
    input().value = text;
    input().dispatch("input", {});
  };
  const press = (k, extra = {}) => {
    const event = { key: k, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
    input().dispatch("keydown", event);
    return event;
  };
  const shortcut = (extra = {}) => {
    const event = { key: "P", ctrlKey: true, shiftKey: true, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...extra };
    doc.dispatch("keydown", event);
    return event;
  };
  const selected = () => options_().find((o) => o.getAttribute("aria-selected") === "true");
  const error = () => palette.element.querySelector("[data-wm-palette-error]");
  const status = () => palette.element.querySelector("[role=status]").textContent;
  const dispatched = [];
  const original = wm.dispatch;
  wm.dispatch = (command) => (dispatched.push(command), original(command));
  return { doc, wm, palette, outside, dialog, input, list, options: options_, names, type, press, shortcut, selected, error, status, dispatched };
};

describe("createPalette: opening", () => {
  test("Ctrl+Shift+P and Cmd+Shift+P open it, again closes it, and the event is consumed", () => {
    const t = setup();
    assert.equal(t.palette.isOpen, false);
    assert.ok(t.palette.element.hasAttribute("hidden"));
    const e = t.shortcut();
    assert.ok(e.prevented);
    assert.equal(t.palette.isOpen, true);
    assert.ok(!t.palette.element.hasAttribute("hidden"));
    assert.equal(t.doc.activeElement, t.input(), "focus moves into the input");
    t.shortcut({ ctrlKey: false, metaKey: true });
    assert.equal(t.palette.isOpen, false);
    t.shortcut({ shiftKey: false });
    assert.equal(t.palette.isOpen, false, "Ctrl+P alone is not the shortcut");
  });

  test("a configurable shortcut (string or list), or none", () => {
    const t = setup({ options: { shortcut: ["Ctrl+K", "F2"] } });
    t.shortcut();
    assert.equal(t.palette.isOpen, false, "the default no longer applies");
    t.shortcut({ key: "k", shiftKey: false });
    assert.equal(t.palette.isOpen, true);
    t.palette.close();
    t.shortcut({ key: "F2", ctrlKey: false, shiftKey: false });
    assert.equal(t.palette.isOpen, true);
    const none = setup({ options: { shortcut: false } });
    none.shortcut();
    assert.equal(none.palette.isOpen, false);
    none.palette.open();
    assert.equal(none.palette.isOpen, true);
  });

  test("open({ query }) pre-fills the filter; toggle() works; focus returns where it was", () => {
    const t = setup();
    t.outside.focus();
    t.palette.open({ query: "close" });
    assert.equal(t.input().value, "close");
    assert.equal(t.names()[0], "Close window");
    t.palette.toggle();
    assert.equal(t.palette.isOpen, false);
    assert.equal(t.doc.activeElement, t.outside, "focus is restored");
    t.palette.toggle();
    assert.equal(t.palette.isOpen, true);
  });

  test("the theme and palette CSS are injected once, and use only defined tokens", () => {
    const t = setup();
    setup({ state: rich() }); // other document: separate
    t.palette.open();
    t.palette.close();
    t.palette.open();
    assert.equal(t.doc.querySelectorAll("style[data-wm-palette-style]").length, 1);
    const used = new Set([...PALETTE_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    assert.ok(used.size >= 15);
    for (const name of used) assert.ok(name in THEME_TOKENS, name);
    // (the visually-hidden live region's 1px is a hack, not a visual value)
    const visual = PALETTE_CSS.split("\n").filter((line) => !line.startsWith("[data-wm-palette-status]")).join("\n");
    assert.doesNotMatch(visual, /#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|(^|[^-\w.])\d*\.?\d+px\b/);
    const none = setup({ options: { injectStyles: false } });
    assert.equal(none.doc.querySelectorAll("style[data-wm-palette-style]").length, 0);
  });
});

describe("createPalette: the WAI-ARIA combobox and listbox pattern", () => {
  test("a modal dialog holding a combobox input that controls a listbox of options", () => {
    const t = setup();
    t.palette.open();
    assert.equal(t.dialog().getAttribute("role"), "dialog");
    assert.equal(t.dialog().getAttribute("aria-modal"), "true");
    assert.ok(t.doc.body.querySelector(`#${t.dialog().getAttribute("aria-labelledby")}`), "named by its heading");
    const input = t.input();
    assert.equal(input.getAttribute("role"), "combobox");
    assert.equal(input.getAttribute("aria-autocomplete"), "list");
    assert.equal(input.getAttribute("aria-expanded"), "true");
    assert.equal(input.getAttribute("aria-haspopup"), "listbox");
    assert.equal(input.getAttribute("aria-controls"), t.list().getAttribute("id"));
    assert.equal(t.list().getAttribute("role"), "listbox");
    assert.ok(t.options().length > 20);
    for (const option of t.options()) {
      assert.ok(option.getAttribute("id"));
      assert.ok(["true", "false"].includes(option.getAttribute("aria-selected")));
    }
    assert.equal(t.options().filter((o) => o.getAttribute("aria-selected") === "true").length, 1);
    assert.equal(input.getAttribute("aria-activedescendant"), t.selected().getAttribute("id"));
    assert.ok(input.getAttribute("aria-label"));
  });

  test("ArrowDown/ArrowUp move the active option (wrapping) and aria-activedescendant follows; DOM focus stays in the input", () => {
    const t = setup();
    t.palette.open();
    const ids = t.options().map((o) => o.getAttribute("id"));
    const e = t.press("ArrowDown");
    assert.ok(e.prevented);
    assert.equal(t.input().getAttribute("aria-activedescendant"), ids[1]);
    assert.equal(t.options()[1].getAttribute("aria-selected"), "true");
    assert.equal(t.options()[0].getAttribute("aria-selected"), "false");
    t.press("ArrowUp");
    t.press("ArrowUp");
    assert.equal(t.input().getAttribute("aria-activedescendant"), ids.at(-1), "wraps to the last");
    t.press("ArrowDown");
    assert.equal(t.input().getAttribute("aria-activedescendant"), ids[0], "and back to the first");
    t.press("PageDown");
    assert.equal(t.input().getAttribute("aria-activedescendant"), ids[5]);
    t.press("PageUp");
    assert.equal(t.input().getAttribute("aria-activedescendant"), ids[0]);
    assert.equal(t.doc.activeElement, t.input());
  });

  test("typing filters and ranks, highlighting the matched letters; the first match is active", () => {
    const t = setup();
    t.palette.open();
    t.type("clo");
    assert.equal(t.names()[0], "Close window");
    const marks = t.options()[0].querySelectorAll("mark");
    assert.equal(marks.map((m) => m.textContent).join(""), "Clo");
    assert.equal(t.selected(), t.options()[0]);
    t.type("zzzzqq");
    assert.equal(t.options().length, 0);
    assert.ok(t.list().hasAttribute("hidden"), "an empty listbox is hidden");
    assert.equal(t.input().getAttribute("aria-expanded"), "false");
    assert.equal(t.input().hasAttribute("aria-activedescendant"), false);
    assert.ok(!t.palette.element.querySelector("[data-wm-palette-empty]").hasAttribute("hidden"));
    assert.match(t.status(), /No matching/);
    t.press("Enter");
    assert.equal(t.dispatched.length, 0, "Enter with nothing to choose does nothing");
    assert.equal(t.palette.isOpen, true);
    t.type("");
    assert.ok(t.options().length > 20);
    assert.ok(!t.list().hasAttribute("hidden"));
  });

  test("a polite live region announces the result count", () => {
    const t = setup();
    t.palette.open();
    const region = t.palette.element.querySelector("[role=status]");
    assert.equal(region.getAttribute("aria-live"), "polite");
    assert.match(t.status(), /\d+ commands available/);
    t.type("focus n");
    assert.match(t.status(), /^\d+ (command|commands) available$/);
  });

  test("Tab never leaves the dialog", () => {
    const t = setup();
    t.palette.open();
    assert.ok(t.press("Tab").prevented);
    assert.ok(t.press("Tab", { shiftKey: true }).prevented);
    assert.equal(t.doc.activeElement, t.input());
  });

  test("clicking an option chooses it; pressing the backdrop closes", () => {
    const t = setup();
    t.palette.open({ query: "focus next" });
    t.options()[0].dispatch("click", {});
    assert.deepEqual(t.dispatched, [{ type: "focus/next" }]);
    assert.equal(t.palette.isOpen, false);
    t.palette.open();
    t.palette.element.dispatch("pointerdown", { target: t.dialog() });
    assert.equal(t.palette.isOpen, true, "a press inside the dialog keeps it open");
    t.palette.element.dispatch("pointerdown", { target: t.palette.element });
    assert.equal(t.palette.isOpen, false);
  });
});

describe("createPalette: running commands", () => {
  test("a command with no fields runs on Enter, closes, and returns focus", () => {
    const t = setup();
    t.outside.focus();
    t.palette.open({ query: "focus next" });
    t.press("Enter");
    assert.deepEqual(t.dispatched, [{ type: "focus/next" }]);
    assert.equal(t.wm.getState().focus.window, "f", "it actually ran");
    assert.equal(t.palette.isOpen, false);
    assert.equal(t.doc.activeElement, t.outside);
  });

  test("a window field is a list, the focused window first; Enter runs the command with that id", () => {
    const t = setup();
    t.palette.open({ query: "close win" });
    t.press("Enter");
    assert.equal(t.palette.isOpen, true, "still asking: which window?");
    assert.equal(t.names()[0], "Terminal");
    assert.match(t.dialog().querySelector("h2").textContent, /Close window: Window/);
    t.type("edi");
    assert.deepEqual(t.names(), ["Editor"]);
    t.press("Enter");
    assert.deepEqual(t.dispatched, [{ type: "window/close", id: "a" }]);
    assert.equal(t.wm.getState().windows.a, undefined);
    assert.equal(t.palette.isOpen, false);
  });

  test("a list filter matches the label fuzzily but the detail only as a phrase, so a short query does not match everything (found in the browser)", () => {
    const t = setup();
    t.palette.open({ query: "close win" });
    t.press("Enter");
    t.type("ter");
    assert.deepEqual(t.names(), ["Terminal"], "Editor's detail `editor · main · tiled` must not match t…e…r by scattering");
    t.type("main");
    assert.equal(t.names().length, 3, "a typed phrase still matches the detail (the workspace)");
  });

  test("text and number fields take typed answers and report bad input without losing your place", () => {
    const t = setup();
    t.palette.open({ query: "rename window" });
    t.press("Enter"); // the command
    t.press("Enter"); // the window (focused: b)
    assert.equal(t.options().length, 0, "a text field has no list");
    assert.ok(t.list().hasAttribute("hidden"));
    assert.equal(t.input().getAttribute("aria-expanded"), "false");
    assert.equal(t.input().getAttribute("placeholder"), "New title");
    t.type("Console");
    t.press("Enter");
    assert.deepEqual(t.dispatched.at(-1), { type: "window/set-title", id: "b", title: "Console" });
    assert.equal(t.wm.getState().windows.b.title, "Console");

    t.palette.open({ query: "move window" });
    t.press("Enter"); // the command
    t.press("Enter"); // the window (only f is floating)
    t.type("abc");
    t.press("Enter");
    assert.equal(t.error().hasAttribute("hidden"), false);
    assert.equal(t.error().getAttribute("role"), "alert");
    assert.match(t.error().textContent, /not a number/);
    assert.equal(t.palette.isOpen, true);
    t.type("30");
    assert.ok(t.error().hasAttribute("hidden"), "typing clears the message");
    t.press("Enter");
    t.type("40");
    t.press("Enter");
    assert.deepEqual(t.dispatched.at(-1), { type: "window/move", id: "f", x: 30, y: 40 });
  });

  test("suggested answers are pre-filled (a fresh id), optional fields can be skipped with Enter", () => {
    const t = setup();
    t.palette.open({ query: "open window" });
    t.press("Enter");
    assert.equal(t.input().value, "window-4");
    t.press("Enter"); // accept the id; then the optional title
    assert.equal(t.input().getAttribute("placeholder"), "Title (optional)");
    t.press("Enter"); // skip
    assert.deepEqual(t.dispatched.at(-1), { type: "window/create", id: "window-4" });
    assert.ok(t.wm.getState().windows["window-4"]);
  });

  test("choice, boolean and layout fields are lists; a default is preselected", () => {
    const t = setup();
    t.palette.open({ query: "pin or unpin" });
    t.press("Enter"); // the command
    t.press("Enter"); // window b
    assert.deepEqual(t.names(), ["Yes", "No"]);
    assert.equal(t.selected().querySelector("[data-wm-palette-name]").textContent, "No", "default: not draggable");
    t.press("Enter");
    assert.deepEqual(t.dispatched.at(-1), { type: "window/set-draggable", id: "b", draggable: false });

    t.palette.open({ query: "set layout" });
    t.press("Enter");
    assert.ok(t.names().includes("bsp"));
    t.type("bsp");
    t.press("Enter");
    assert.deepEqual(t.dispatched.at(-1), { type: "layout/set", layout: { type: "bsp" } });
    assert.equal(t.wm.getState().workspaces.main.layout.type, "bsp");

    t.palette.open({ query: "drop window" });
    t.press("Enter"); // the command
    t.press("Enter"); // window
    t.press("Enter"); // target (first listed)
    assert.deepEqual(t.names(), ["center", "left", "right", "top", "bottom"]);
    t.press("ArrowDown");
    t.press("Enter");
    const drop = t.dispatched.at(-1);
    assert.deepEqual([drop.type, drop.zone], ["window/drop", "left"]);
  });

  test("JSON fields: config/set spreads the object into the command; bad JSON is reported", () => {
    const t = setup();
    t.palette.open({ query: "change config" });
    t.press("Enter");
    t.type("{nope");
    t.press("Enter");
    assert.match(t.error().textContent, /not valid JSON/);
    t.type('{"gap": 9}');
    t.press("Enter");
    assert.deepEqual(t.dispatched.at(-1), { type: "config/set", gap: 9 });
    assert.equal(t.wm.getState().config.gap, 9);
  });

  test("a rejected command keeps the palette open on its last field, with the reason", () => {
    const t = setup();
    t.palette.open({ query: "new workspace" });
    t.press("Enter");
    t.type("main"); // already exists
    t.press("Enter"); // then the optional layout field is asked
    assert.equal(t.input().getAttribute("placeholder"), "Layout (optional)");
    t.press("Enter"); // pick the first layout
    assert.equal(t.palette.isOpen, true);
    assert.match(t.error().textContent, /duplicate-id/);
    assert.match(t.status(), /Not done: duplicate-id/);
  });

  test("custom layouts and popouts: pop-out routes through attachPopouts", () => {
    const calls = [];
    const popouts = { popOut: (id) => (calls.push(["out", id]), { events: [] }), popIn: (id) => (calls.push(["in", id]), { events: [] }) };
    const t = setup({ options: { popouts, layouts: ["mine"] } });
    t.palette.open({ query: "pop window out" });
    t.press("Enter");
    t.press("Enter");
    assert.deepEqual(calls, [["out", "b"]]);
    assert.equal(t.dispatched.length, 0, "not dispatched directly");
    t.palette.open({ query: "set layout" });
    t.press("Enter");
    assert.ok(t.names().includes("mine"));
  });
});

describe("createPalette: stepping back", () => {
  test("Escape goes back one step, then closes; Backspace on empty input also steps back", () => {
    const t = setup();
    t.outside.focus();
    t.palette.open({ query: "move window" });
    t.press("Enter"); // the command
    t.press("Enter"); // window
    assert.match(t.dialog().querySelector("h2").textContent, /X/); // the x field
    t.press("Escape");
    assert.match(t.dialog().querySelector("h2").textContent, /Window/, "back to the window step");
    t.press("Escape");
    assert.equal(t.dialog().querySelector("h2").textContent, "Command palette", "back to the command list");
    assert.equal(t.palette.isOpen, true);
    const e = t.press("Escape");
    assert.ok(e.prevented);
    assert.equal(t.palette.isOpen, false);
    assert.equal(t.doc.activeElement, t.outside);

    t.palette.open({ query: "rename window" });
    t.press("Enter");
    t.type("");
    t.press("Backspace");
    assert.equal(t.dialog().querySelector("h2").textContent, "Command palette");
    assert.equal(t.dispatched.length, 0);
  });

  test("closing mid-prompt forgets it: the next open starts at the command list", () => {
    const t = setup();
    t.palette.open({ query: "close win" });
    t.press("Enter");
    t.palette.close();
    t.palette.open();
    assert.equal(t.dialog().querySelector("h2").textContent, "Command palette");
    assert.equal(t.input().value, "");
  });
});

describe("createPalette: lifecycle", () => {
  test("requires a window manager; labels can be translated", () => {
    assert.throws(() => createPalette({}), TypeError);
    const t = setup({ options: { labels: { title: "Befehle", empty: "Nichts gefunden", count: (n) => `${n} Befehle` } } });
    t.palette.open();
    assert.equal(t.dialog().querySelector("h2").textContent, "Befehle");
    assert.match(t.status(), /Befehle$/);
    t.type("zzzzqq");
    assert.equal(t.palette.element.querySelector("[data-wm-palette-empty]").textContent, "Nichts gefunden");
  });

  test("detach removes the dialog and the shortcut", () => {
    const t = setup();
    t.palette.open();
    t.palette.detach();
    assert.equal(t.palette.isOpen, false);
    assert.equal(t.doc.body.querySelector("[data-wm-palette]"), null);
    t.shortcut();
    assert.equal(t.palette.isOpen, false);
  });

  test("the list tracks the state: commands appear when the state makes them meaningful", () => {
    const t = setup({ state: createState() });
    t.palette.open({ query: "close" });
    assert.equal(t.options().length, 0);
    t.palette.close();
    t.wm.create({ id: "x" });
    t.palette.open({ query: "close" });
    assert.equal(t.names()[0], "Close window");
  });
});
