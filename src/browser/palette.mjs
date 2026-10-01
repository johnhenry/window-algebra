/**
 * A command palette. Commands are data, so the palette is a catalog
 * (`palette/catalog.mjs`: which commands exist for the current state, their
 * payload fields, a fuzzy filter) behind an accessible UI.
 *
 * Accessibility: the WAI-ARIA 1.2 editable combobox with a listbox popup
 * inside a modal dialog. DOM focus stays in the input the whole time and the
 * highlighted option is named by `aria-activedescendant`; ArrowDown/ArrowUp
 * move it (wrapping), Enter chooses, Escape steps back and then closes, Tab
 * is kept inside the dialog, and focus returns to where it was when the
 * palette closes. A polite live region announces the result count and
 * errors. Open it with a configurable shortcut (default Ctrl/Cmd+Shift+P).
 *
 * Flow: type to fuzzy-filter the commands that make sense for the current
 * state, Enter to choose one; each payload field is then asked in turn
 * (windows, workspaces, enums and booleans as a list, the rest as text), and
 * the finished command is dispatched. A rejected command keeps the palette
 * open on its last field with the reason shown.
 */
import { THEME_CSS } from "../css/theme.mjs";
import { paletteEntries, fieldChoices, isTextField, defaultValue, parseField, buildCommand, fuzzyMatch } from "../palette/catalog.mjs";

/** The palette's rules; every visual value is a `--wa-*` token (see css/theme.mjs). */
export const PALETTE_CSS = `
[data-wm-palette-backdrop] { position: fixed; inset: 0; z-index: 2147483000; display: flex; align-items: flex-start; justify-content: center; padding: var(--wa-palette-top) var(--wa-space-lg) var(--wa-space-lg); background: var(--wa-color-overlay); }
[data-wm-palette-backdrop][hidden] { display: none; }
[data-wm-palette] { box-sizing: border-box; inline-size: min(var(--wa-palette-width), 100%); max-block-size: min(var(--wa-palette-max-height), 80vh); display: flex; flex-direction: column; background: var(--wa-color-surface-raised); color: var(--wa-color-fg); border: var(--wa-border-width) solid var(--wa-color-border); border-radius: var(--wa-radius-md); box-shadow: var(--wa-shadow-overlay); font: var(--wa-font-size)/1.4 var(--wa-font); overflow: hidden; }
[data-wm-palette-title] { margin: 0; padding: var(--wa-space-sm) var(--wa-space-lg) 0; color: var(--wa-color-fg-muted); font-size: var(--wa-font-size-sm); font-weight: 600; }
[data-wm-palette] input { box-sizing: border-box; inline-size: 100%; margin: 0; padding: var(--wa-space-md) var(--wa-space-lg); font: inherit; color: inherit; background: transparent; border: 0; border-block-end: var(--wa-border-width) solid var(--wa-color-border); border-radius: 0; }
[data-wm-palette] input:focus-visible { outline: var(--wa-focus-ring-width) solid var(--wa-focus-ring-color); outline-offset: calc(-1 * var(--wa-focus-ring-width)); }
[data-wm-palette] [role="listbox"] { flex: 1 1 auto; min-block-size: 0; margin: 0; padding: var(--wa-space-xs); list-style: none; overflow: auto; }
[data-wm-palette] [role="listbox"][hidden] { display: none; }
[data-wm-palette] [role="option"] { display: flex; align-items: baseline; gap: var(--wa-space-sm); padding: var(--wa-space-sm) var(--wa-space-md); border-radius: var(--wa-radius-sm); cursor: pointer; }
[data-wm-palette] [role="option"][aria-selected="true"] { background: var(--wa-color-accent-soft); outline: var(--wa-border-width) solid var(--wa-color-accent); outline-offset: calc(-1 * var(--wa-border-width)); }
[data-wm-palette] [data-wm-palette-detail] { margin-inline-start: auto; color: var(--wa-color-fg-muted); font-size: var(--wa-font-size-sm); white-space: nowrap; }
[data-wm-palette] mark { background: transparent; color: var(--wa-color-accent); font-weight: 700; text-decoration: underline; }
[data-wm-palette-empty] { margin: 0; padding: var(--wa-space-md) var(--wa-space-lg); color: var(--wa-color-fg-muted); }
[data-wm-palette-empty][hidden] { display: none; }
[data-wm-palette-hint] { display: flex; gap: var(--wa-space-md); padding: var(--wa-space-sm) var(--wa-space-lg); color: var(--wa-color-fg-muted); font-size: var(--wa-font-size-sm); border-block-start: var(--wa-border-width) solid var(--wa-color-border); }
[data-wm-palette-error] { color: var(--wa-color-danger); font-weight: 600; }
[data-wm-palette-error][hidden] { display: none; }
[data-wm-palette-status] { position: absolute; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
@media (forced-colors: active) { [data-wm-palette] [role="option"][aria-selected="true"] { outline-color: Highlight; } }
`.trim();

const MOD_NAMES = { ctrl: "ctrlKey", control: "ctrlKey", meta: "metaKey", cmd: "metaKey", command: "metaKey", alt: "altKey", option: "altKey", shift: "shiftKey" };

/**
 * Parse a shortcut like "Mod+Shift+P". `Mod` is Ctrl or Cmd (either one);
 * the last part is the key, compared case-insensitively against `event.key`.
 */
export const parseShortcut = (shortcut) => {
  const parts = String(shortcut).split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) throw new TypeError(`Invalid shortcut "${shortcut}"`);
  const want = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, mod: false };
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod") want.mod = true;
    else if (MOD_NAMES[lower]) want[MOD_NAMES[lower]] = true;
    else throw new TypeError(`Unknown modifier "${part}" in shortcut "${shortcut}"`);
  }
  return { key: key.toLowerCase() === "space" ? " " : key.toLowerCase(), ...want };
};

/** Does a keydown event press the parsed shortcut (and no other modifiers)? */
export const matchesShortcut = (parsed, event) => {
  if (String(event.key).toLowerCase() !== parsed.key) return false;
  if (Boolean(event.altKey) !== parsed.altKey || Boolean(event.shiftKey) !== parsed.shiftKey) return false;
  if (parsed.mod) return Boolean(event.ctrlKey) !== Boolean(event.metaKey);
  return Boolean(event.ctrlKey) === parsed.ctrlKey && Boolean(event.metaKey) === parsed.metaKey;
};

const DEFAULT_LABELS = {
  title: "Command palette",
  input: "Command",
  placeholder: "Type a command",
  empty: "No matching commands",
  hint: "Enter to choose, Escape to go back",
  count: (n) => `${n} ${n === 1 ? "command" : "commands"} available`,
  options: (n) => `${n} ${n === 1 ? "option" : "options"}`,
  done: (title) => `${title}: done`,
  rejected: (reason) => `Not done: ${reason}`,
};

let paletteSeq = 0;

/**
 * @param {object} options
 * @param {object} options.wm the window manager
 * @param {Document} [options.document] default `host.ownerDocument` or the global document
 * @param {Element} [options.host] where the dialog is mounted (default `document.body`)
 * @param {string|string[]|false} [options.shortcut] default "Mod+Shift+P"; `false` for none
 * @param {object} [options.catalog] extra or replacement catalog entries (see `paletteEntries`)
 * @param {string[]} [options.exclude] command types to hide
 * @param {string[]} [options.layouts] extra layout type names to offer (the manager's custom layouts)
 * @param {{ popOut(id): unknown, popIn(id): unknown }} [options.popouts] an `attachPopouts` handle: with it, "pop
 *   out"/"pop in" open and close the real browser window instead of only changing state
 * @param {object} [options.labels] strings (for translation); see DEFAULT_LABELS
 * @param {boolean} [options.restoreFocus] return focus to the previously focused element on close (default true)
 * @param {boolean} [options.injectStyles] add the theme and palette CSS to the document (default true)
 * @returns {{ open(options?): void, close(): void, toggle(): void, isOpen: boolean, element: Element, detach(): void }}
 */
export const createPalette = (options = {}) => {
  const { wm, host, shortcut = "Mod+Shift+P", catalog, exclude, layouts = [], popouts, restoreFocus = true, injectStyles = true } = options;
  if (!wm) throw new TypeError("createPalette: `wm` is required");
  const doc = options.document ?? host?.ownerDocument ?? globalThis.document;
  const labels = { ...DEFAULT_LABELS, ...options.labels };
  const mount = host ?? doc.body;
  const uid = `wm-palette-${++paletteSeq}`;

  if (injectStyles && doc.head && !doc.querySelector?.("style[data-wm-palette-style]")) {
    const style = doc.createElement("style");
    style.setAttribute("data-wm-palette-style", "");
    style.textContent = `${THEME_CSS}\n${PALETTE_CSS}`;
    doc.head.appendChild(style);
  }

  // ------------------------------------------------------------ DOM
  const el = (tag, attrs = {}, text) => {
    const node = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const backdrop = el("div", { "data-wm-palette-backdrop": "", hidden: "" });
  const dialog = el("div", { "data-wm-palette": "", role: "dialog", "aria-modal": "true", "aria-labelledby": `${uid}-title`, id: uid });
  const title = el("h2", { "data-wm-palette-title": "", id: `${uid}-title` }, labels.title);
  const input = el("input", {
    type: "text",
    role: "combobox",
    id: `${uid}-input`,
    "aria-autocomplete": "list",
    "aria-expanded": "true",
    "aria-controls": `${uid}-list`,
    "aria-haspopup": "listbox",
    "aria-label": labels.input,
    autocomplete: "off",
    autocapitalize: "off",
    spellcheck: "false",
    placeholder: labels.placeholder,
  });
  const list = el("ul", { role: "listbox", id: `${uid}-list`, "aria-label": labels.input });
  const empty = el("p", { "data-wm-palette-empty": "", hidden: "" }, labels.empty);
  const hint = el("div", { "data-wm-palette-hint": "" });
  const hintText = el("span", {}, labels.hint);
  const error = el("span", { "data-wm-palette-error": "", role: "alert", hidden: "" });
  hint.append(hintText, error);
  const status = el("div", { "data-wm-palette-status": "", role: "status", "aria-live": "polite" });
  dialog.append(title, input, list, empty, hint, status);
  backdrop.append(dialog);
  mount.appendChild(backdrop);

  // ------------------------------------------------------------ state
  let open = false;
  let previouslyFocused = null;
  /** "commands", or a field of `chosen`: { entry, index, values } */
  let chosen = null;
  let query = "";
  let items = []; // [{ id, value, label, detail, ranges, entry? }]
  let active = 0;
  let lastCount = null;

  const setError = (message) => {
    if (message) {
      error.textContent = message;
      error.removeAttribute("hidden");
    } else {
      error.textContent = "";
      error.setAttribute("hidden", "");
    }
  };

  const currentField = () => (chosen ? chosen.entry.fields.filter((f) => !f.optional || f.ask)[chosen.index] : null);
  const askedFields = () => (chosen ? chosen.entry.fields.filter((f) => !f.optional || f.ask) : []);

  const highlight = (node, text, ranges) => {
    if (!ranges?.length) {
      node.textContent = text;
      return;
    }
    let at = 0;
    const plain = (part) => part && node.append(el("span", {}, part));
    for (const [from, to] of ranges) {
      plain(text.slice(at, from));
      node.append(el("mark", {}, text.slice(from, to)));
      at = to;
    }
    plain(text.slice(at));
  };

  const computeItems = () => {
    const state = wm.getState();
    const field = currentField();
    if (!field) {
      return paletteEntries(state, { query, exclude, catalog }).map((entry, i) => ({
        id: `${uid}-opt-${i}`,
        value: entry.type,
        label: entry.title,
        detail: entry.group,
        ranges: entry.ranges,
        entry,
      }));
    }
    const choices = fieldChoices(state, field, { layouts });
    if (!choices) return [];
    return choices
      .map((choice) => ({ choice, hit: fuzzyMatch(query, choice.label) ?? fuzzyMatch(query, `${choice.label} ${choice.detail}`) }))
      .filter(({ hit }) => hit)
      .sort((a, b) => b.hit.score - a.hit.score)
      .map(({ choice, hit }, i) => ({ id: `${uid}-opt-${i}`, value: choice.value, label: choice.label, detail: choice.detail, ranges: fuzzyMatch(query, choice.label) ? hit.ranges : [] }));
  };

  const announce = (message) => {
    status.textContent = message;
  };

  const render = ({ keepActive = false } = {}) => {
    const field = currentField();
    const text = field ? isTextField(field) : false;
    items = text ? [] : computeItems();
    if (!keepActive) active = 0;
    active = Math.max(0, Math.min(active, items.length - 1));
    // Prompt chrome.
    title.textContent = field ? `${chosen.entry.title}: ${field.label}` : labels.title;
    const prompt = field ? field.label : labels.input;
    input.setAttribute("aria-label", prompt);
    input.setAttribute("placeholder", field ? (field.optional ? `${field.label} (optional)` : field.label) : labels.placeholder);
    // Options.
    list.replaceChildren();
    for (const [i, item] of items.entries()) {
      const option = el("li", { role: "option", id: item.id, "aria-selected": String(i === active), "data-value": String(item.value) });
      const name = el("span", { "data-wm-palette-name": "" });
      highlight(name, item.label, item.ranges);
      option.append(name);
      if (item.detail) option.append(el("span", { "data-wm-palette-detail": "" }, item.detail));
      option.addEventListener("pointerdown", (event) => event.preventDefault?.());
      option.addEventListener("click", () => choose(i));
      list.append(option);
    }
    const expanded = !text && items.length > 0;
    input.setAttribute("aria-expanded", String(expanded));
    // An empty listbox is hidden (a listbox must contain options); the "no matches" text stands in for it.
    if (expanded) list.removeAttribute("hidden");
    else list.setAttribute("hidden", "");
    if (!text && items.length === 0) empty.removeAttribute("hidden");
    else empty.setAttribute("hidden", "");
    if (expanded) input.setAttribute("aria-activedescendant", items[active].id);
    else input.removeAttribute("aria-activedescendant");
    // Announce changes in the number of results (not on every arrow key).
    const count = text ? null : items.length;
    if (count !== lastCount) {
      lastCount = count;
      if (count !== null) announce(count === 0 ? labels.empty : field ? labels.options(count) : labels.count(count));
    }
  };

  const scrollActive = () => {
    list.children[active]?.scrollIntoView?.({ block: "nearest" });
  };

  const move = (delta) => {
    if (!items.length) return;
    active = (active + delta + items.length) % items.length;
    for (const [i, option] of [...list.children].entries()) option.setAttribute("aria-selected", String(i === active));
    input.setAttribute("aria-activedescendant", items[active].id);
    scrollActive();
  };

  // ------------------------------------------------------------ choosing and running
  const startField = () => {
    const field = currentField();
    query = "";
    input.value = "";
    setError(null);
    if (field && isTextField(field)) {
      const suggestion = defaultValue(wm.getState(), field);
      if (suggestion !== undefined && suggestion !== "") {
        input.value = String(suggestion);
        input.select?.();
      }
    }
    render();
    if (field && !isTextField(field)) {
      const wanted = defaultValue(wm.getState(), field);
      const at = items.findIndex((item) => item.value === wanted);
      if (at > 0) {
        active = at;
        render({ keepActive: true });
      }
    }
  };

  const run = () => {
    const { entry, values } = chosen;
    const command = buildCommand(entry.type, values);
    const out = popouts && entry.type === "window/pop-out" ? popouts.popOut(command.id) : popouts && entry.type === "window/pop-in" ? popouts.popIn(command.id) : wm.dispatch(command);
    const rejection = out?.events?.find?.((event) => event.type === "command/rejected");
    if (rejection) {
      // Stay on the last field so it can be corrected.
      chosen.index = Math.max(0, askedFields().length - 1);
      const field = currentField();
      query = "";
      input.value = field && isTextField(field) && values[field.name] !== undefined ? (typeof values[field.name] === "object" ? JSON.stringify(values[field.name]) : String(values[field.name])) : "";
      render();
      setError(labels.rejected(rejection.reason));
      announce(labels.rejected(rejection.reason));
      return;
    }
    const message = labels.done(entry.title);
    close();
    announce(message);
  };

  const advance = (value, field) => {
    if (value !== undefined) chosen.values[field.name] = value;
    chosen.index++;
    if (chosen.index >= askedFields().length) run();
    else startField();
  };

  const choose = (index = active) => {
    const field = currentField();
    if (!field) {
      const item = items[index];
      if (!item) return;
      chosen = { entry: item.entry, index: 0, values: {} };
      if (askedFields().length === 0) run();
      else startField();
      return;
    }
    if (isTextField(field)) {
      const parsed = parseField(field, input.value.trim());
      if (!parsed.ok) {
        setError(parsed.error);
        announce(parsed.error);
        return;
      }
      advance(parsed.skip ? undefined : parsed.value, field);
      return;
    }
    const item = items[index];
    if (!item) return;
    const parsed = parseField(field, item.value);
    advance(parsed.value, field);
  };

  const back = () => {
    if (!chosen) return false;
    if (chosen.index > 0) {
      chosen.index--;
      startField();
    } else {
      chosen = null;
      query = "";
      input.value = "";
      setError(null);
      lastCount = null;
      render();
    }
    return true;
  };

  // ------------------------------------------------------------ events
  input.addEventListener("input", () => {
    const field = currentField();
    setError(null);
    if (field && isTextField(field)) return;
    query = input.value;
    render();
  });

  input.addEventListener("keydown", (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault?.();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault?.();
        move(-1);
        break;
      case "PageDown":
        event.preventDefault?.();
        move(Math.min(5, items.length - 1 - active) || 1);
        break;
      case "PageUp":
        event.preventDefault?.();
        move(-(Math.min(5, active) || 1));
        break;
      case "Enter":
        event.preventDefault?.();
        choose();
        break;
      case "Escape":
        event.preventDefault?.();
        event.stopPropagation?.();
        if (!back()) close();
        break;
      case "Tab":
        // The input is the only stop: focus stays in the dialog.
        event.preventDefault?.();
        break;
      case "Backspace":
        if (input.value === "" && chosen) {
          event.preventDefault?.();
          back();
        }
        break;
    }
  });

  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) close();
  });

  // ------------------------------------------------------------ open / close
  function close() {
    if (!open) return;
    open = false;
    backdrop.setAttribute("hidden", "");
    chosen = null;
    const target = previouslyFocused;
    previouslyFocused = null;
    if (restoreFocus && target?.isConnected !== false) target?.focus?.({ preventScroll: true });
  }

  const openPalette = (openOptions = {}) => {
    if (open) return;
    previouslyFocused = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    open = true;
    chosen = null;
    query = openOptions.query ?? "";
    input.value = query;
    lastCount = null;
    setError(null);
    backdrop.removeAttribute("hidden");
    render();
    input.focus?.({ preventScroll: true });
  };

  // ------------------------------------------------------------ the shortcut
  const shortcuts = shortcut === false || shortcut == null ? [] : [shortcut].flat().map(parseShortcut);
  const onKey = (event) => {
    if (!shortcuts.some((parsed) => matchesShortcut(parsed, event))) return;
    event.preventDefault?.();
    event.stopPropagation?.();
    if (open) close();
    else openPalette();
  };
  if (shortcuts.length) doc.addEventListener("keydown", onKey, true);

  return {
    open: openPalette,
    close,
    toggle: () => (open ? close() : openPalette()),
    get isOpen() {
      return open;
    },
    element: backdrop,
    detach() {
      if (open) close();
      if (shortcuts.length) doc.removeEventListener("keydown", onKey, true);
      backdrop.remove();
    },
  };
};
