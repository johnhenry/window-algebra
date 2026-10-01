/**
 * Shared helpers for the example suite. Nothing here is part of the library;
 * it is page furniture: the site header, theme switching, a standard window
 * chrome (built on the library's lazySurface and the attachInput markup
 * contract), and a small event log.
 */
import { lazySurface } from "../../src/browser/index.mjs";
import { BASE_CSS, geometry } from "../../src/index.mjs";
import { PAGES } from "./coverage.mjs";

/** Tiny hyperscript: h("div", { class: "x", onclick }, child, "text"). */
export const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name.startsWith("on") && typeof value === "function") el.addEventListener(name.slice(2), value);
    else if (name === "style" && typeof value === "object") Object.assign(el.style, value);
    else if (name === "html") el.innerHTML = value;
    else el.setAttribute(name, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
};

export const $ = (selector, scope = document) => scope.querySelector(selector);
export const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];

const safeStorage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode or blocked storage: the page still works */
    }
  },
};
export { safeStorage as storage };

const LOGO = `<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1.5" y="1.5" width="10" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="1.5" width="5" height="7.5" rx="1.5" fill="var(--accent)"/><rect x="13.5" y="11" width="5" height="7.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;

const applyTheme = (theme) => {
  if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  else document.documentElement.removeAttribute("data-theme");
};

/** The effective theme (explicit choice, else the OS preference). */
export const currentTheme = () =>
  document.documentElement.getAttribute("data-theme") ??
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/**
 * Build the site header: brand, page title, links to every example, theme toggle.
 * Also injects the library's optional BASE_CSS.
 */
export const initPage = ({ current, title } = {}) => {
  applyTheme(safeStorage.get("wa-theme"));
  const style = document.createElement("style");
  style.textContent = BASE_CSS;
  document.head.prepend(style);

  let header = document.querySelector("header.site");
  if (!header) {
    header = h("header", { class: "site" });
    document.body.prepend(header);
  }
  const brand = h("a", { class: "brand", href: "./index.html", html: `${LOGO}<span>window-algebra</span>` });
  const nav = h(
    "nav",
    { class: "pages", "aria-label": "Examples" },
    PAGES.map((page) =>
      h("a", { href: page.href, "aria-current": page.href === current ? "page" : undefined, title: page.blurb }, page.short),
    ),
  );
  const toggle = h(
    "button",
    {
      class: "btn ghost small",
      type: "button",
      title: "Toggle light/dark theme",
      "aria-label": "Toggle theme",
      onclick: () => {
        const next = currentTheme() === "dark" ? "light" : "dark";
        applyTheme(next);
        safeStorage.set("wa-theme", next);
        document.dispatchEvent(new CustomEvent("wa-theme", { detail: next }));
      },
    },
    "◐ Theme",
  );
  header.replaceChildren(brand, title ? h("span", { class: "page-title" }, title) : "", h("span", { class: "spacer" }), nav, toggle);
  return header;
};

// ------------------------------------------------------------------ window chrome

const ICONS = {
  min: `<svg viewBox="0 0 14 14"><path d="M3 10h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  max: `<svg viewBox="0 0 14 14"><rect x="3" y="3" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`,
  // Shown while maximized: the classic "restore down" pair of windows.
  restore: `<svg viewBox="0 0 14 14"><rect x="2" y="5" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 5V3.2A1.2 1.2 0 0 1 6.2 2H10.8A1.2 1.2 0 0 1 12 3.2V7.8A1.2 1.2 0 0 1 10.8 9H9" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  // Shown while tiled: pop the window out of the layout.
  float: `<svg viewBox="0 0 14 14"><path d="M6.5 2.5H3.7A1.2 1.2 0 0 0 2.5 3.7v6.6a1.2 1.2 0 0 0 1.2 1.2h6.6a1.2 1.2 0 0 0 1.2-1.2V7.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M8.5 2.5h3v3M11.5 2.5 7 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Shown while floating: dock the window back into the tiled layout.
  tile: `<svg viewBox="0 0 14 14"><rect x="2.5" y="2.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 2.5v9M7 7h4.5" stroke="currentColor" stroke-width="1.4"/></svg>`,
  close: `<svg viewBox="0 0 14 14"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  // Shown while in the layout: pop the window out into its own browser window.
  popout: `<svg viewBox="0 0 14 14"><rect x="2" y="4" width="6.5" height="7.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 5.5h4.5v-3M11.5 2.5 6.5 7.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  // Shown while popped out: bring the window back into this page's layout.
  popin: `<svg viewBox="0 0 14 14"><rect x="2" y="4" width="6.5" height="7.5" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M11.5 5.5H7v-3M6.5 7.5 11.5 2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

/** The pop-out / pop-in icon markup, for a page (desktop.html) that wires that button itself. */
export const POPOUT_ICONS = { popout: ICONS.popout, popin: ICONS.popin };

export const SWATCHES = ["var(--swatch-1)", "var(--swatch-2)", "var(--swatch-3)", "var(--swatch-4)", "var(--swatch-5)", "var(--swatch-6)", "var(--swatch-7)", "var(--swatch-8)"];
let swatchIndex = 0;
export const nextSwatch = () => SWATCHES[swatchIndex++ % SWATCHES.length];

/**
 * A window surface with standard chrome. The header is a `data-wm-handle="move"`
 * drag handle; buttons use `data-wm-command`; eight `resize-*` grips cover every
 * edge in EDGES. `body(el, ctx)` fills the content area and may return a cleanup.
 *
 * @param {object} options
 * @param {string} options.id
 * @param {string} [options.title]
 * @param {string} [options.color] CSS color for the title dot / swatch
 * @param {(el: HTMLElement, ctx: object) => (void | (() => void))} [options.body]
 * @param {string[]} [options.actions] subset of ["min", "max", "float", "close"]
 * @param {(event: object) => void} [options.onLifecycle] mount/unmount notifications
 * @param {boolean} [options.bare] no title bar or grips (menus, tooltips, toasts)
 */
export const windowSurface = ({ id, title = id, color = nextSwatch(), body, actions = ["min", "max", "float", "close"], onLifecycle, bare = false }) => {
  let mounts = 0;
  return lazySurface((target) => {
    mounts++;
    target.style.setProperty("--win-color", color);
    target.tabIndex = -1;
    const commandFor = { min: "window/minimize", max: "window/maximize", float: "window/toggle-floating", close: "window/close" };
    // "popout" has no data-wm-command: it needs the actual browser window
    // (open/adopt/close), so the page wires its click to attachPopouts itself
    // (see desktop.html) instead of the generic command-button dispatch.
    const titles = { min: "Minimize", max: "Maximize", float: "Float (undock)", close: "Close", popout: "Pop out" };
    const buttons = actions.map((action) =>
      h("button", { type: "button", "data-wm-command": commandFor[action], "data-action": action, title: titles[action], "aria-label": titles[action], html: ICONS[action] }),
    );
    const bodyEl = h("div", { class: "wa-body" });
    if (bare) {
      const win = h("div", { class: "wa-win bare" }, bodyEl);
      target.append(win);
      const cleanup = body?.(bodyEl, { id, mounts, target });
      onLifecycle?.({ type: "mount", id, mounts });
      return () => {
        if (typeof cleanup === "function") cleanup();
        win.remove();
        onLifecycle?.({ type: "unmount", id, mounts });
      };
    }
    const win = h(
      "div",
      { class: "wa-win" },
      h("div", { class: "wa-bar", "data-wm-handle": "move" }, h("span", { class: "wa-dot" }), h("span", { class: "wa-title", "data-wa-title": "" }, title), h("span", { class: "wa-meta", "data-wa-meta": "" }), h("span", { class: "wa-actions" }, buttons)),
      bodyEl,
    );
    const grips = ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((edge) => h("div", { class: "wa-grip", "data-wm-handle": `resize-${edge}` }));
    target.append(win, ...grips);
    const cleanup = body?.(bodyEl, { id, mounts, target });
    onLifecycle?.({ type: "mount", id, mounts });
    return () => {
      if (typeof cleanup === "function") cleanup();
      win.remove();
      grips.forEach((grip) => grip.remove());
      onLifecycle?.({ type: "unmount", id, mounts });
    };
  });
};

/** A placeholder body: colored swatch showing the id and live size (via container query units). */
export const swatchBody = (label) => (el) => {
  el.append(h("div", { class: "swatch" }, h("span", {}, label), h("small", { "data-size": "" }, "")));
};

/**
 * How the stateful title-bar buttons look for a window. `state` is also written
 * to `data-state` so pages can style it (e.g. `[data-action="max"][data-state="maximized"]`).
 */
const BUTTON_STATES = {
  max: (win) =>
    win.status === "maximized"
      ? { state: "maximized", command: "window/restore", icon: "restore", label: "Restore", pressed: "true" }
      : { state: "normal", command: "window/maximize", icon: "max", label: "Maximize", pressed: "false" },
  float: (win) =>
    win.mode === "floating"
      ? { state: "floating", command: "window/toggle-floating", icon: "tile", label: "Tile (dock into layout)", pressed: "true" }
      : { state: "tiled", command: "window/toggle-floating", icon: "float", label: "Float (undock)", pressed: "false" },
};

/**
 * Keep chrome in sync with state: titles, the stateful buttons (maximize ↔
 * restore, float ↔ tile: command, icon, label, aria-pressed, data-state) and the
 * live size readout.
 */
export const syncChrome = (wm, root) => {
  const run = () => {
    const state = wm.getState();
    for (const viewEl of root.querySelectorAll("wm-view[data-view]")) {
      const win = state.windows[viewEl.getAttribute("data-view")];
      if (!win) continue;
      const titleEl = viewEl.querySelector(":scope > .wa-win [data-wa-title]");
      if (titleEl && titleEl.textContent !== win.title) titleEl.textContent = win.title || win.id;
      const metaEl = viewEl.querySelector(":scope > .wa-win [data-wa-meta]");
      if (metaEl) {
        const next = fmtSize(win.placement, win.constraints);
        if (metaEl.textContent !== next) metaEl.textContent = next;
      }
      for (const [action, describeButton] of Object.entries(BUTTON_STATES)) {
        const button = viewEl.querySelector(`:scope > .wa-win [data-action="${action}"]`);
        if (!button) continue;
        const next = describeButton(win);
        if (button.getAttribute("data-state") === next.state) continue;
        button.setAttribute("data-state", next.state);
        button.setAttribute("data-wm-command", next.command);
        button.setAttribute("title", next.label);
        button.setAttribute("aria-label", next.label);
        button.setAttribute("aria-pressed", next.pressed);
        button.innerHTML = ICONS[next.icon];
      }
    }
  };
  wm.subscribe(() => requestAnimationFrame(run));
  requestAnimationFrame(run);
  return run;
};

// ------------------------------------------------------------------ logging

const time = () => {
  const d = new Date();
  return `${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
};

/** An append-only log list. `log.add(kind, key, value)`; kinds: command, event, effect, rejected, info. */
export const createLog = (listEl, { max = 400, newestFirst = true } = {}) => {
  const add = (kind, key, value = "") => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const li = h("li", { class: kind }, h("span", { class: "t" }, time()), h("span", { class: "k" }, key), h("span", { class: "v" }, text));
    if (newestFirst) listEl.prepend(li);
    else listEl.append(li);
    while (listEl.children.length > max) (newestFirst ? listEl.lastElementChild : listEl.firstElementChild).remove();
    if (!newestFirst) listEl.parentElement.scrollTop = listEl.parentElement.scrollHeight;
    return li;
  };
  return { add, clear: () => listEl.replaceChildren() };
};

/** Compact description of a command, minus its type. */
export const describe = (object) => {
  const { type: _type, ...rest } = object ?? {};
  const text = JSON.stringify(rest);
  return text === "{}" ? "" : text;
};

export const fmtRect = (r) => (r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}×${Math.round(r.height)}` : "—");

/**
 * Live size readout for the title-bar chrome: pixel dimensions, or terminal-style
 * cells (e.g. "80×24") when the window's constraints set widthIncrement/heightIncrement.
 */
export const fmtSize = (placement, constraints) => {
  if (!placement) return "";
  const cells = geometry.sizeToCells(placement, constraints);
  if (cells) return `${cells.cols ?? Math.round(placement.width)}×${cells.rows ?? Math.round(placement.height)}`;
  return `${Math.round(placement.width)}×${Math.round(placement.height)}`;
};

/** Is the event target a text-entry control (so global shortcuts should stand aside)? */
export const isTyping = (event) => {
  const t = event.target;
  return t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
};
