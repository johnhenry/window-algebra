/**
 * Built-in window chrome, opt-in: a title bar (icon slot, title, buttons) that is a drag handle and maximizes on
 * double-click, a body for the window's content, and eight resize grips for floating windows. It is plain markup
 * over the library's own contracts (`data-wm-handle`, `data-wm-command`, `data-wm-dblclick`), styled by
 * `CHROME_CSS` (part of `BASE_CSS`) from the `--wa-*` tokens.
 *
 * Two ways in:
 * - `createDomRenderer({ chrome: true | { buttons, ... } })` (and `<wa-stage>`'s `chrome` option) wraps every
 *   window's surface in chrome for you; the renderer keeps the title in step on every commit.
 * - `chromeSurface({ id, title, body, ... })` wraps one surface, for a custom renderer or a hand-built
 *   `surfaceFor`. Pass `wm` and it follows the window's title itself.
 *
 * Which buttons show is CSS, driven by `data-mode` and `data-status` on the view (`compile` writes both), so
 * nothing is relabelled in JavaScript: a maximize button and a restore button both exist and one is hidden. That
 * is also why the chrome keeps working inside a pop-out window, where no renderer is updating it.
 *
 * Only this file builds chrome markup; it touches no global `document`.
 */

/** Every button the chrome can show, in default order. `popout` needs `attachPopouts` (see `attachInput`'s `popouts`). */
export const CHROME_BUTTONS = Object.freeze(["minimize", "maximize", "float", "popout", "close"]);
/** The buttons shown when `chrome: true`. */
export const DEFAULT_CHROME_BUTTONS = Object.freeze(["minimize", "maximize", "float", "close"]);

// Each button is one or two elements; `show`/`hide` name the states (`floating`, `maximized`, `popped-out`) in
// which `CHROME_CSS` shows or hides it.
const BUTTONS = {
  minimize: [{ action: "minimize", command: "window/minimize", icon: "–", hide: "popped-out" }],
  maximize: [
    { action: "maximize", command: "window/maximize", icon: "□", hide: "maximized popped-out" },
    { action: "restore", command: "window/restore", icon: "❐", show: "maximized", hide: "popped-out" },
  ],
  float: [
    { action: "float", command: "window/toggle-floating", icon: "◱", hide: "floating maximized popped-out" },
    { action: "dock", command: "window/toggle-floating", icon: "▣", show: "floating", hide: "maximized popped-out" },
  ],
  popout: [
    { action: "popout", command: "window/pop-out", icon: "↗", hide: "popped-out" },
    { action: "popin", command: "window/pop-in", icon: "↙", show: "popped-out" },
  ],
  close: [{ action: "close", command: "window/close", icon: "×" }],
};

// The two halves of a toggle: pressing one hides it and shows the other (see CHROME_CSS), so focus follows.
const COUNTERPART = { maximize: "restore", restore: "maximize", float: "dock", dock: "float", popout: "popin", popin: "popout" };

const GRIP_EDGES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

/** Default accessible names, by action. Replace any with the `labels` option (translation). */
export const DEFAULT_CHROME_LABELS = Object.freeze({
  minimize: "Minimize window",
  maximize: "Maximize window",
  restore: "Restore window",
  float: "Float window",
  dock: "Tile window",
  popout: "Pop out window",
  popin: "Pop window back in",
  close: "Close window",
  actions: "Window controls",
});

let chromeSeq = 0;
const identSafe = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "-") || "x";

/**
 * Normalize the `chrome` option of `createDomRenderer` / `attachStage` / `chromeSurface`: `true`, or an object.
 * Returns `null` for a falsy value.
 *
 * @param {boolean|object} chrome
 * @returns {null | { buttons: (id: string) => string[], icon: (id: string) => (Node|string|null|undefined), icons: object, labels: object, enabled: (id: string) => boolean }}
 */
export const normalizeChrome = (chrome) => {
  if (!chrome) return null;
  const options = chrome === true ? {} : chrome;
  const list = options.buttons ?? DEFAULT_CHROME_BUTTONS;
  const buttons = typeof list === "function" ? list : () => list;
  return {
    buttons: (id) => {
      const names = buttons(id) ?? [];
      for (const name of names) {
        if (!(name in BUTTONS)) throw new TypeError(`chrome: unknown button "${name}" (one of ${CHROME_BUTTONS.join(", ")})`);
      }
      return names;
    },
    icon: options.icon ?? (() => null),
    icons: options.icons ?? {},
    labels: { ...DEFAULT_CHROME_LABELS, ...options.labels },
    enabled: options.for ?? (() => true),
  };
};

/**
 * Build one window's chrome. Returns the elements and a few operations; the caller places `frame` inside the
 * window's view element and mounts the window's content into `body`.
 */
export const buildChrome = (doc, { id, title = id, buttons = DEFAULT_CHROME_BUTTONS, icon, icons = {}, labels = DEFAULT_CHROME_LABELS } = {}) => {
  const uid = `wa-chrome-${++chromeSeq}-${identSafe(id)}`;
  const make = (tag, attrs = {}) => {
    const element = doc.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
    return element;
  };

  const iconSlot = make("span", { class: "wa-chrome-icon", "data-wa-chrome-icon": "", "aria-hidden": "true" });
  const mark = icon?.(id);
  if (mark && typeof mark === "object") iconSlot.append(mark);
  else if (mark) iconSlot.textContent = String(mark);

  const titleId = `${uid}-title`;
  const titleEl = make("span", { class: "wa-chrome-title", id: titleId, "data-wa-chrome-title": "" });
  const actions = make("span", { class: "wa-chrome-actions", role: "group", "aria-label": labels.actions });
  const buttonEls = [];
  for (const name of buttons) {
    for (const spec of BUTTONS[name]) {
      const button = make("button", { type: "button", class: "wa-chrome-btn", "data-wm-command": spec.command, "data-action": spec.action, "data-wa-label": labels[spec.action] ?? DEFAULT_CHROME_LABELS[spec.action], title: labels[spec.action] ?? DEFAULT_CHROME_LABELS[spec.action] });
      if (spec.show) button.setAttribute("data-wa-show", spec.show);
      if (spec.hide) button.setAttribute("data-wa-hide", spec.hide);
      const glyph = make("span", { "aria-hidden": "true" });
      const custom = icons[spec.action];
      if (custom && typeof custom === "object") glyph.append(custom);
      else glyph.textContent = custom ?? spec.icon;
      button.append(glyph);
      actions.append(button);
      buttonEls.push(button);
    }
  }

  // A toggle hides the button that was pressed (maximize shows restore): a keyboard user would be left on nothing,
  // so once the change has rendered, focus moves to the button that took its place.
  actions.addEventListener("click", (event) => {
    const pressed = event.target?.closest?.("[data-action]");
    const next = pressed && COUNTERPART[pressed.getAttribute("data-action")];
    if (!next) return;
    const view = doc.defaultView;
    const later = view?.requestAnimationFrame ? (fn) => view.requestAnimationFrame(fn) : (fn) => setTimeout(fn, 0);
    later(() =>
      later(() => {
        const hidden = pressed.getClientRects ? pressed.getClientRects().length === 0 : false;
        const lost = !doc.activeElement || doc.activeElement === doc.body || doc.activeElement === pressed;
        if (hidden && lost) actions.querySelector(`[data-action="${next}"]`)?.focus?.();
      }),
    );
  });

  const bar = make("div", { class: "wa-chrome-bar", "data-wm-handle": "move", "data-wm-dblclick": "window/toggle-maximize" });
  bar.append(iconSlot, titleEl, actions);
  const body = make("div", { class: "wa-chrome-body", "data-wa-chrome-body": "" });
  const frame = make("div", { class: "wa-chrome", "data-wa-chrome": "" });
  frame.append(bar, body, ...GRIP_EDGES.map((edge) => make("div", { class: "wa-chrome-grip", "data-wm-handle": `resize-${edge}` })));

  /** A body that scrolls must be reachable by keyboard (axe `scrollable-region-focusable`); one that fits is not a tab stop. */
  const syncScrollable = () => {
    const scrolls = body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth;
    const marked = body.hasAttribute("data-wa-scrollable");
    if (scrolls && !marked) {
      body.setAttribute("data-wa-scrollable", "");
      body.setAttribute("tabindex", "0");
      body.setAttribute("role", "region");
      body.setAttribute("aria-labelledby", titleId);
    } else if (!scrolls && marked) {
      for (const name of ["data-wa-scrollable", "tabindex", "role", "aria-labelledby"]) body.removeAttribute(name);
    }
  };

  const setTitle = (next) => setChromeTitle(frame, next);
  setTitle(title);

  // The body resizes with the window; its content grows on its own (a component that renders after the surface mounted,
  // a list that fills). The body's box does not change then, so each child of the body is observed too, and a
  // MutationObserver keeps that set in step with what the surface mounts and unmounts.
  let observer;
  let mutations;
  const Observer = doc.defaultView?.ResizeObserver;
  if (Observer) {
    observer = new Observer(syncScrollable);
    observer.observe(body);
    const watched = new Set();
    const watch = () => {
      for (const child of watched) if (child.parentNode !== body) { observer?.unobserve(child); watched.delete(child); }
      for (const child of body.children) if (!watched.has(child)) { watched.add(child); observer?.observe(child); }
      syncScrollable();
    };
    const Mutation = doc.defaultView?.MutationObserver;
    if (Mutation) {
      mutations = new Mutation(watch);
      mutations.observe(body, { childList: true });
    }
    watch();
  }

  return {
    frame,
    bar,
    body,
    titleId,
    setTitle,
    /** Show or hide the title bar (a tab panel already has its tab). */
    setBarVisible(visible) {
      if (visible) bar.removeAttribute("hidden");
      else bar.setAttribute("hidden", "");
    },
    syncScrollable,
    dispose() {
      observer?.disconnect();
      mutations?.disconnect();
      observer = undefined;
      mutations = undefined;
    },
  };
};

/**
 * Set a window's chrome title and the accessible names of its buttons ("Close window: Editor"). Works on any
 * element that contains chrome, in whichever document it now lives (`attachPopouts` uses it for a popped-out window).
 */
export const setChromeTitle = (element, title) => {
  const titleEl = element.querySelector?.("[data-wa-chrome-title]");
  if (!titleEl) return;
  if (titleEl.textContent !== title) titleEl.textContent = title;
  for (const button of element.querySelectorAll("[data-wa-label]")) {
    const name = `${button.getAttribute("data-wa-label")}: ${title}`;
    if (button.getAttribute("aria-label") !== name) button.setAttribute("aria-label", name);
  }
};

/**
 * Wrap one window's content in chrome, as a surface. For a custom renderer, or a `surfaceFor` of your own; with
 * `createDomRenderer({ chrome })` the renderer does this for every window and you do not.
 *
 * @param {object} options
 * @param {string} options.id the window id
 * @param {string} [options.title] initial title (default the id)
 * @param {((el: Element) => (void | (() => void))) | { mount(el: Element): void, unmount?(): void }} [options.body]
 *   the content: a function that fills the body element (and may return a cleanup), or a surface to mount into it
 * @param {object} [options.wm] when given, the title follows `state.windows[id].title`
 * @param {string[]} [options.buttons] any of `CHROME_BUTTONS` (default `DEFAULT_CHROME_BUTTONS`)
 * @param {(id: string) => (Node|string|null)} [options.icon] the icon slot, a node or text
 * @param {object} [options.icons] glyph per action (`close`, `maximize`, ...): text or a node
 * @param {object} [options.labels] accessible names per action (translation)
 * @param {Document} [options.document]
 */
export const chromeSurface = ({ id, title, body, wm, buttons, icon, icons, labels, document: docOption } = {}) => {
  let handle;
  let inner;
  let cleanup;
  let unsubscribe;
  return {
    kind: "chrome",
    mount(target) {
      const doc = docOption ?? target.ownerDocument;
      const config = normalizeChrome({ buttons, icon, icons, labels });
      handle = buildChrome(doc, { id, title: title ?? id, buttons: config.buttons(id), icon: config.icon, icons: config.icons, labels: config.labels });
      target.append(handle.frame);
      if (typeof body === "function") cleanup = body(handle.body);
      else if (body?.mount) {
        inner = body;
        inner.mount(handle.body);
      }
      if (wm) {
        const follow = (state) => {
          const win = state.windows[id];
          if (win) handle.setTitle(win.title || id);
        };
        follow(wm.getState());
        unsubscribe = wm.subscribe(follow);
      }
      handle.syncScrollable();
    },
    unmount() {
      unsubscribe?.();
      unsubscribe = undefined;
      if (typeof cleanup === "function") cleanup();
      cleanup = undefined;
      inner?.unmount?.();
      inner = undefined;
      handle?.dispose();
      handle?.frame.remove();
      handle = undefined;
    },
  };
};
