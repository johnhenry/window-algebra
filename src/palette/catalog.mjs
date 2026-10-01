/**
 * The command palette's data: because commands are data, a palette is a
 * catalog (what each command is called, which payload fields it takes, when
 * it makes sense) plus a fuzzy filter. All of it is pure and runs in Node;
 * `browser/palette.mjs` is only the UI.
 *
 * `COMMAND_CATALOG` has one entry per built-in command and a test keeps it
 * equal to `COMMANDS`, so adding a command without describing it here fails.
 */
import { LAYERS } from "../state/create.mjs";
import { LAYOUTS } from "../state/derive.mjs";

// ------------------------------------------------------------------ field helpers

const win = (name = "id", options = {}) => ({ name, kind: "window", label: "Window", ...options });
const ws = (name = "id", options = {}) => ({ name, kind: "workspace", label: "Workspace", ...options });
const out = (name = "id", options = {}) => ({ name, kind: "output", label: "Output", ...options });
const num = (name, label, options = {}) => ({ name, kind: "number", label, ...options });
const text = (name, label, options = {}) => ({ name, kind: "text", label, ...options });
const bool = (name, label, options = {}) => ({ name, kind: "boolean", label, ...options });
const pick = (name, label, choices, options = {}) => ({ name, kind: "choice", label, choices, ...options });
const json = (name, label, options = {}) => ({ name, kind: "json", label, ...options });
const layout = (name, label, options = {}) => ({ name, kind: "layout", label, ...options });
const fresh = (name, label, prefix) => ({ name, kind: "new", label, prefix });
/** An optional field the palette still asks about. */
const ask = (field) => ({ ...field, optional: true, ask: true });
const opt = (field) => ({ ...field, optional: true });

const entry = (title, group, fields = [], extra = {}) => ({ title, group, fields, ...extra });

/**
 * `{ [command type]: { title, group, fields, requires?, keywords? } }`.
 *
 * A field is `{ name, kind, label, optional?, ask?, ... }` with `kind` one of
 * "window" | "workspace" | "output" (an existing one, chosen from a list),
 * "new" (a fresh id), "text", "number", "boolean", "choice" (`choices`),
 * "layout" (a layout type, sent as `{ type }`), "json" (`spread: true` merges
 * the object into the command, as `config/set` wants). Optional fields are
 * only asked when `ask` is set. `requires` lists what the state needs for the
 * command to make sense (see `REQUIREMENTS`).
 */
export const COMMAND_CATALOG = Object.freeze({
  // ---- windows: lifecycle and focus
  "window/create": entry("Open window", "Windows", [fresh("id", "New window id", "window"), ask(text("title", "Title"))], { keywords: "new add" }),
  "window/close": entry("Close window", "Windows", [win()], { requires: ["window"] }),
  "window/focus": entry("Focus window", "Focus", [win()], { requires: ["window"], keywords: "switch go to" }),
  "window/blur": entry("Clear focus", "Focus", [], { requires: ["focus"], keywords: "unfocus" }),
  "focus/next": entry("Focus next window", "Focus", [], { requires: ["window"], keywords: "cycle" }),
  "focus/previous": entry("Focus previous window", "Focus", [], { requires: ["window"], keywords: "cycle" }),
  "focus/urgent": entry("Focus urgent window", "Focus", [], { requires: ["urgent"] }),
  "window/set-urgent": entry("Mark window urgent", "Windows", [win(), opt(bool("urgent", "Urgent", { default: true }))], { requires: ["window"], keywords: "attention" }),
  "window/raise": entry("Raise window", "Stacking", [win()], { requires: ["window"], keywords: "front" }),
  "window/lower": entry("Lower window", "Stacking", [win()], { requires: ["window"], keywords: "back" }),
  "window/set-layer": entry("Set window layer", "Stacking", [win(), pick("layer", "Layer", LAYERS)], { requires: ["window"] }),
  // ---- geometry and mode
  "window/move": entry("Move window", "Geometry", [win(undefined, { where: "floating" }), num("x", "X (px)", { optional: false }), num("y", "Y (px)", { optional: false })], { requires: ["floating"], keywords: "position" }),
  "window/resize": entry("Resize window", "Geometry", [win(undefined, { where: "floating" }), num("width", "Width (px)"), num("height", "Height (px)")], { requires: ["floating"], keywords: "size" }),
  "window/set-mode": entry("Set window mode", "Geometry", [win(), pick("mode", "Mode", ["tiled", "floating"])], { requires: ["window"] }),
  "window/detach": entry("Detach window (float it)", "Geometry", [win(undefined, { where: "tiled" })], { requires: ["tiled"], keywords: "undock float" }),
  "window/toggle-floating": entry("Toggle floating", "Geometry", [win()], { requires: ["window"], keywords: "tile undock dock" }),
  "window/set-constraints": entry("Set size constraints", "Geometry", [win(), json("constraints", "Constraints as JSON, e.g. {\"minWidth\": 200}")], { requires: ["window"] }),
  // ---- status
  "window/minimize": entry("Minimize window", "State", [win(undefined, { where: "shown" })], { requires: ["window"] }),
  "window/maximize": entry("Maximize window", "State", [win(undefined, { where: "shown" })], { requires: ["window"] }),
  "window/fullscreen": entry("Fullscreen window", "State", [win(undefined, { where: "shown" })], { requires: ["window"] }),
  "window/restore": entry("Restore window", "State", [win(undefined, { where: "restorable" })], { requires: ["restorable"], keywords: "unminimize" }),
  "window/toggle-maximize": entry("Toggle maximize", "State", [win()], { requires: ["window"] }),
  "window/toggle-fullscreen": entry("Toggle fullscreen", "State", [win()], { requires: ["window"] }),
  "window/pop-out": entry("Pop window out", "State", [win(undefined, { where: "shown" })], { requires: ["window"], keywords: "detach separate browser window" }),
  "window/pop-in": entry("Pop window back in", "State", [win(undefined, { where: "poppedOut" })], { requires: ["poppedOut"] }),
  "window/set-title": entry("Rename window", "Windows", [win(), text("title", "New title")], { requires: ["window"], keywords: "title" }),
  "window/set-draggable": entry("Pin or unpin window", "Windows", [win(), bool("draggable", "Draggable", { default: false })], { requires: ["window"], keywords: "lock" }),
  "window/set-sticky": entry("Set window sticky", "Windows", [win(), opt(bool("sticky", "Sticky", { default: true }))], { requires: ["window"] }),
  "window/toggle-sticky": entry("Toggle sticky", "Windows", [win()], { requires: ["window"] }),
  // ---- arranging
  "window/swap": entry("Swap windows", "Arrange", [win(), win("target", { label: "With window" })], { requires: ["windows2"] }),
  "window/promote": entry("Promote window to master", "Arrange", [win()], { requires: ["window"], keywords: "zoom" }),
  "window/drop": entry("Drop window onto another", "Arrange", [win(), win("target", { label: "Onto window" }), pick("zone", "Zone", ["center", "left", "right", "top", "bottom"])], { requires: ["windows2"], keywords: "split dock" }),
  "window/swap-next": entry("Swap with next window", "Arrange", [], { requires: ["windows2"] }),
  "window/swap-previous": entry("Swap with previous window", "Arrange", [], { requires: ["windows2"] }),
  "window/move-before": entry("Move window earlier", "Arrange", [], { requires: ["windows2"] }),
  "window/move-after": entry("Move window later", "Arrange", [], { requires: ["windows2"] }),
  "window/move-to-workspace": entry("Move window to workspace", "Workspaces", [win(), ws("workspace", { label: "To workspace" }), opt(bool("follow", "Follow it", { default: false }))], { requires: ["window", "workspaces2"] }),
  // ---- scratchpad
  "window/to-scratchpad": entry("Send window to scratchpad", "Scratchpad", [win(undefined, { where: "notScratchpad" })], { requires: ["window"], keywords: "hide" }),
  "scratchpad/toggle": entry("Toggle scratchpad", "Scratchpad", [], { requires: ["scratchpad"], keywords: "show hide" }),
  "window/from-scratchpad": entry("Bring window back from scratchpad", "Scratchpad", [win(undefined, { where: "scratchpad" })], { requires: ["scratchpad"] }),
  // ---- workspaces
  "workspace/create": entry("New workspace", "Workspaces", [fresh("id", "New workspace id", "workspace"), ask(layout("layout", "Layout"))], { keywords: "add" }),
  "workspace/activate": entry("Switch workspace", "Workspaces", [ws()], { requires: ["workspaces2"], keywords: "go to" }),
  "workspace/remove": entry("Remove workspace", "Workspaces", [ws()], { requires: ["workspaces2"], keywords: "delete" }),
  "workspace/rename": entry("Rename workspace", "Workspaces", [ws(), text("to", "New id")], { requires: ["workspace"] }),
  "workspace/reorder": entry("Move workspace to position", "Workspaces", [ws(), num("index", "Position (0 = first)")], { requires: ["workspaces2"] }),
  "workspace/move-to-output": entry("Move workspace to output", "Outputs", [ws(), out("output", { label: "To output" })], { requires: ["outputs2"] }),
  // ---- outputs
  "output/create": entry("New output", "Outputs", [fresh("id", "New output id", "output")], { keywords: "display screen add" }),
  "output/remove": entry("Remove output", "Outputs", [out()], { requires: ["outputs2"] }),
  "output/focus": entry("Focus output", "Outputs", [out()], { requires: ["outputs2"] }),
  "output/reorder": entry("Move output to position", "Outputs", [out(), num("index", "Position (0 = first)")], { requires: ["outputs2"] }),
  // ---- layout
  "layout/set": entry("Set layout", "Layout", [layout("layout", "Layout")], { keywords: "tile tiling arrangement" }),
  "layout/to-tree": entry("Convert layout to docking tree", "Layout", [], { requires: ["window"] }),
  "layout/set-ratio": entry("Set split ratio", "Layout", [num("ratio", "Ratio (0 to 1)")], { keywords: "master" }),
  "layout/rotate-split": entry("Rotate split", "Layout", [], { requires: ["window"], keywords: "flip" }),
  "layout/resize-split": entry("Resize split", "Layout", [text("path", "Split path (empty for the root)", { default: "" }), num("delta", "Change (e.g. 0.05)")], { requires: ["window"] }),
  "layout/toggle": entry("Toggle between two layouts", "Layout", [layout("a", "First layout"), layout("b", "Second layout")], { keywords: "swap" }),
  // ---- configuration
  "config/set": entry("Change configuration", "Configuration", [json("patch", "Config patch as JSON, e.g. {\"gap\": 8}", { spread: true })], { keywords: "settings gap inset" }),
  "rules/set": entry("Set window rules", "Configuration", [json("rules", "Rules as JSON array")], { keywords: "match" }),
});

// ------------------------------------------------------------------ availability

const isShown = (state, w) => w.status !== "minimized" && w.status !== "popped-out" && w.workspace !== null;
/** Positioned by its own placement: floating mode, or on a workspace whose layout floats everything. */
const isFloatingish = (state, w) => w.mode === "floating" || state.workspaces[w.workspace]?.layout?.type === "floating";

/** What a `requires` token asks of the state. */
export const REQUIREMENTS = Object.freeze({
  window: (state) => Object.keys(state.windows).length > 0,
  windows2: (state) => Object.keys(state.windows).length > 1,
  focus: (state) => state.focus.window !== null,
  urgent: (state) => state.urgent.some((id) => state.windows[id]),
  floating: (state) => Object.values(state.windows).some((w) => isFloatingish(state, w)),
  tiled: (state) => Object.values(state.windows).some((w) => w.mode === "tiled" && isShown(state, w)),
  restorable: (state) => Object.values(state.windows).some((w) => w.status !== "normal"),
  poppedOut: (state) => Object.values(state.windows).some((w) => w.status === "popped-out"),
  scratchpad: (state) => Object.values(state.windows).some((w) => w.scratchpad) || state.lastScratchpad !== null,
  workspace: (state) => Object.keys(state.workspaces).length > 0,
  workspaces2: (state) => Object.keys(state.workspaces).length > 1,
  outputs2: (state) => Object.keys(state.outputs ?? {}).length > 1,
});

export const isAvailable = (state, type) => (COMMAND_CATALOG[type]?.requires ?? []).every((token) => REQUIREMENTS[token](state));

// ------------------------------------------------------------------ fuzzy matching

const BOUNDARY = /[\s/_\-.:]/;

/**
 * Subsequence match of `query` (spaces ignored, case-insensitive) in `text`:
 * `{ score, ranges }` or `null`. Matches at word starts and consecutive runs
 * score higher and earlier matches beat later ones. `ranges` are `[start, end)`
 * index pairs for highlighting.
 */
export const fuzzyMatch = (query, text) => {
  const q = String(query ?? "").toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, ranges: [] };
  const t = String(text ?? "");
  const scattered = subsequenceMatch(q, t);
  // The query typed as a phrase, contiguous in the text, beats any scattered match.
  const phrase = String(query).trim().toLowerCase();
  const at = phrase ? t.toLowerCase().indexOf(phrase) : -1;
  if (at !== -1) {
    const exact = 12 * phrase.length + (at === 0 || BOUNDARY.test(t[at - 1]) ? 4 : 0) - at * 0.05 - (t.length - phrase.length) * 0.01;
    if (!scattered || exact > scattered.score) return { score: exact, ranges: [[at, at + phrase.length]] };
  }
  return scattered;
};

const subsequenceMatch = (q, t) => {
  const lower = t.toLowerCase();
  const n = q.length;
  const m = t.length;
  if (n > m) return null;
  const boundary = (j) => j === 0 || BOUNDARY.test(t[j - 1]) || (t[j - 1] === t[j - 1].toLowerCase() && t[j] !== t[j].toLowerCase());
  const best = Array.from({ length: n }, () => new Array(m).fill(-Infinity));
  const from = Array.from({ length: n }, () => new Array(m).fill(-1));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < m; j++) {
      if (lower[j] !== q[i]) continue;
      const base = 1 + (boundary(j) ? 4 : 0) + (j === 0 ? 2 : 0);
      if (i === 0) {
        best[0][j] = base - j * 0.05;
        continue;
      }
      for (let k = i - 1; k < j; k++) {
        if (best[i - 1][k] === -Infinity) continue;
        const score = best[i - 1][k] + base + (k === j - 1 ? 3 : -0.1 * (j - k - 1));
        if (score > best[i][j]) {
          best[i][j] = score;
          from[i][j] = k;
        }
      }
    }
  }
  let end = -1;
  for (let j = 0; j < m; j++) if (best[n - 1][j] > (end === -1 ? -Infinity : best[n - 1][end])) end = j;
  if (end === -1) return null;
  const hits = [];
  for (let i = n - 1, j = end; i >= 0; i--) {
    hits.unshift(j);
    j = from[i][j];
  }
  const ranges = [];
  for (const index of hits) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === index) last[1] = index + 1;
    else ranges.push([index, index + 1]);
  }
  // Among equally good matches the shorter text is the better answer ("Move window" before "Move window to workspace").
  return { score: best[n - 1][end] - (m - n) * 0.01, ranges };
};

// ------------------------------------------------------------------ entries

/**
 * The commands the palette lists for `state`, filtered and ranked by `query`.
 *
 * @param {object} state
 * @param {object} [options]
 * @param {string} [options.query] fuzzy text, matched against the title (highlighted), then against
 *   the command type, group and keywords
 * @param {string[]} [options.exclude] command types to leave out
 * @param {object} [options.catalog] extra or replacement entries, `{ [type]: entry }`
 * @returns {Array<{ type, title, group, fields, keywords, score, ranges }>} `ranges` index into `title`
 */
export const paletteEntries = (state, { query = "", exclude = [], catalog = {} } = {}) => {
  const all = { ...COMMAND_CATALOG, ...catalog };
  const skip = new Set(exclude);
  const entries = [];
  let order = 0;
  for (const [type, spec] of Object.entries(all)) {
    order++;
    if (skip.has(type)) continue;
    if (!(spec.requires ?? []).every((token) => REQUIREMENTS[token](state))) continue;
    const base = { type, title: spec.title, group: spec.group, fields: spec.fields, keywords: spec.keywords ?? "", order };
    if (!query.trim()) {
      entries.push({ ...base, score: 0, ranges: [] });
      continue;
    }
    const titleHit = fuzzyMatch(query, spec.title);
    if (titleHit) {
      entries.push({ ...base, score: titleHit.score * 2, ranges: titleHit.ranges });
      continue;
    }
    // Keywords first: a query is read left to right, so "new window" has to find the keyword "new" and then the
    // word "window" (in the type or group) behind it. With the keywords last, "Open window" (keywords "new add")
    // never matched "new window" while "Pop window out" did, by accident.
    const hit = fuzzyMatch(query, `${spec.keywords ?? ""} ${spec.group} ${type}`);
    if (hit) entries.push({ ...base, score: hit.score, ranges: [] });
  }
  return entries.sort((a, b) => b.score - a.score || a.order - b.order);
};

// ------------------------------------------------------------------ prompting for fields

const WHERE = {
  floating: (w, state) => isFloatingish(state, w),
  tiled: (w, state) => w.mode === "tiled" && isShown(state, w),
  shown: (w, state) => isShown(state, w),
  restorable: (w) => w.status !== "normal",
  poppedOut: (w) => w.status === "popped-out",
  scratchpad: (w) => w.scratchpad === true,
  notScratchpad: (w) => !w.scratchpad,
};

/** `{ value, label, detail }` choices for a field, in a sensible order (the focused window first). */
export const fieldChoices = (state, field, { layouts = [] } = {}) => {
  switch (field.kind) {
    case "window": {
      const filter = WHERE[field.where] ?? (() => true);
      const list = Object.values(state.windows).filter((w) => filter(w, state));
      const focused = state.focus.window;
      return list
        .sort((a, b) => (b.id === focused) - (a.id === focused))
        .map((w) => ({ value: w.id, label: w.title || w.id, detail: [w.id !== (w.title || w.id) ? w.id : null, w.workspace ?? "scratchpad", w.id === focused ? "focused" : w.status !== "normal" ? w.status : w.mode].filter(Boolean).join(" · ") }));
    }
    case "workspace":
      return state.workspaceOrder
        .filter((id) => state.workspaces[id])
        .map((id) => ({ value: id, label: id, detail: id === state.activeWorkspace ? "active" : `${state.workspaces[id].windows.length} windows` }));
    case "output":
      return (state.outputOrder ?? []).map((id) => ({ value: id, label: id, detail: id === state.focusedOutput ? "focused" : "" }));
    case "choice":
      return field.choices.map((c) => ({ value: c, label: String(c), detail: "" }));
    case "boolean":
      return [{ value: true, label: "Yes", detail: "" }, { value: false, label: "No", detail: "" }];
    case "layout":
      return [...new Set([...Object.keys(LAYOUTS), ...layouts])].map((type) => ({ value: type, label: type, detail: "" }));
    default:
      return null;
  }
};

/** Does a field take a free-text answer (as opposed to picking from `fieldChoices`)? */
export const isTextField = (field) => ["new", "text", "number", "json"].includes(field.kind);

/** A suggested answer: the focused window, a fresh id, a declared default. */
export const defaultValue = (state, field) => {
  if (field.kind === "new") {
    const table = field.prefix === "workspace" ? state.workspaces : field.prefix === "output" ? state.outputs : state.windows;
    for (let n = Object.keys(table).length + 1; ; n++) if (!(`${field.prefix}-${n}` in table)) return `${field.prefix}-${n}`;
  }
  if (field.kind === "window") {
    const choices = fieldChoices(state, field);
    return choices.find((c) => c.value === state.focus.window)?.value ?? choices[0]?.value;
  }
  if (field.kind === "workspace") return state.activeWorkspace;
  return field.default;
};

/**
 * Turn what was typed or chosen for a field into its payload value:
 * `{ ok: true, value }` or `{ ok: false, error }`. Empty text for an optional field is `{ ok: true, skip: true }`.
 */
export const parseField = (field, input) => {
  const empty = input === undefined || input === null || input === "";
  if (isTextField(field) && empty) return field.optional ? { ok: true, skip: true } : { ok: false, error: `${field.label} is required.` };
  switch (field.kind) {
    case "number": {
      const value = Number(input);
      return Number.isFinite(value) ? { ok: true, value } : { ok: false, error: `${field.label}: "${input}" is not a number.` };
    }
    case "json": {
      try {
        const value = JSON.parse(input);
        if (field.spread && (value === null || typeof value !== "object" || Array.isArray(value))) return { ok: false, error: "Expected a JSON object." };
        return { ok: true, value };
      } catch {
        return { ok: false, error: "That is not valid JSON." };
      }
    }
    case "layout":
      return { ok: true, value: { type: input } };
    case "new":
    case "text":
      return { ok: true, value: String(input) };
    default:
      return { ok: true, value: input };
  }
};

/** The command object for a catalog entry and the values collected for its fields. */
export const buildCommand = (type, values = {}) => {
  const fields = COMMAND_CATALOG[type]?.fields ?? [];
  const command = { type };
  for (const field of fields) {
    if (!(field.name in values) || values[field.name] === undefined) continue;
    if (field.spread) Object.assign(command, values[field.name]);
    else command[field.name] = values[field.name];
  }
  return command;
};

/** Which command types the catalog covers; equal to `COMMANDS` (tested). */
export const CATALOGED = Object.freeze(Object.keys(COMMAND_CATALOG));
