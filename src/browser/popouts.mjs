/**
 * GoldenLayout/Dockview-style pop-out: move a window's rendered DOM into a
 * real, separate browser window, and back again.
 *
 * The pure core only tracks that the window left the layout ("popped-out",
 * see `state/update.mjs`'s `window/pop-out` / `window/pop-in` and
 * `isVisible`/`isPoppedOut` in `state/queries.mjs`) — everything about the
 * actual browser window lives here: opening it, copying/adopting the page's
 * stylesheets so the popup looks the same, moving the view's live DOM node
 * with `adoptNode` (via `renderer.release`/`renderer.adopt`, see `dom.mjs`)
 * so its content and any in-page state survive the move, keeping the
 * popup's title and WM focus in sync, and closing/reattaching it again when
 * the popup is closed or `popIn()` is called.
 *
 * Only round-tripping through `popOut`/`popIn` (or the popup closing itself,
 * which calls `popIn` the same way) carries the DOM across; a `window/pop-in`
 * dispatched directly — bypassing this helper, e.g. by `wm.undo()` after a
 * pop-out — is still handled correctly (the popup, if any, is closed), but
 * the surface remounts fresh in the main document instead of being carried
 * back. For an iframe that is no loss: most browsers reload an iframe's
 * document whenever it (or an ancestor) is adopted into another document, so
 * its state resets on the way out regardless of how it comes back.
 */

/** Read an element's attributes whether it's a real DOM node (NamedNodeMap) or the fake test DOM (a Map). */
const copyAttributes = (from, to) => {
  if (from.attributes instanceof Map) {
    for (const [name, value] of from.attributes) to.setAttribute(name, value);
  } else {
    for (const attr of from.attributes ?? []) to.setAttribute(attr.name, attr.value);
  }
};

/** Clone every `<link rel=stylesheet>` and `<style>` from the main document's head into the popup's. */
const copyStyles = (sourceDoc, targetDoc) => {
  if (!sourceDoc?.querySelectorAll || !targetDoc?.createElement) return;
  const target = targetDoc.head ?? targetDoc.body;
  if (!target) return;
  for (const node of sourceDoc.querySelectorAll("link[rel=stylesheet], style")) {
    const clone = targetDoc.createElement(node.localName);
    copyAttributes(node, clone);
    if (node.textContent) clone.textContent = node.textContent;
    target.appendChild(clone);
  }
};

/** Reset the geometry a tiled/floating/anchored layout left on the element so it fills the popup instead. */
const fillPopup = (element) => {
  const style = element.style;
  if (!style) return;
  for (const prop of ["left", "top", "right", "bottom", "inset", "transform", "anchor-name", "flex", "grid-area"]) {
    style.removeProperty(prop);
  }
  style.setProperty("position", "static");
  style.setProperty("width", "100%");
  style.setProperty("height", "100vh");
  style.setProperty("box-sizing", "border-box");
};

/**
 * @param {object} options
 * @param {object} options.wm the window manager (`createWindowManager()`)
 * @param {{ elementFor?(id): Element, release?(id): {element, surface}|undefined, adopt?(id, element, surface): void, root?: Element }} options.renderer
 *   the DOM renderer whose root holds the WM's views (`createDomRenderer()`)
 * @param {(id: string) => object | undefined} [options.surfaceFor] surface
 *   registry (unused if `renderer.release`/`adopt` are present, i.e. a real
 *   `createDomRenderer()`; kept as a fallback for a minimal custom renderer)
 * @param {(url?: string, name?: string, features?: string) => (Window|null)} [options.open]
 *   overridable in place of `window.open`; a fake returning `null`/`undefined`
 *   (or an already-`closed` window) simulates a popup blocker
 * @returns {{
 *   popOut(id: string, options?: { name?: string, features?: string }): { state, events, effects },
 *   popIn(id: string): { state, events, effects },
 *   isPoppedOut(id: string): boolean,
 *   detach(): void,
 * }}
 */
export const attachPopouts = ({ wm, renderer, surfaceFor, open } = {}) => {
  const openWindow = open ?? ((...args) => (typeof globalThis.open === "function" ? globalThis.open(...args) : null));
  const popups = new Map(); // id -> { popup, element, surface, detach() }

  const rejection = (reason, id) => ({
    state: wm.getState(),
    events: [{ type: "command/rejected", command: "window/pop-out", id, reason }],
    effects: [],
  });

  const titleOf = (id) => {
    const win = wm.getState().windows[id];
    return (win && (win.title || id)) ?? id;
  };

  const releaseElement = (id) => {
    const released = renderer?.release?.(id);
    if (released) return released;
    // Fallback for a renderer without `release`/`adopt` (not a full
    // `createDomRenderer`): grab the element and its surface separately;
    // the element is moved but the renderer's own bookkeeping, if any,
    // isn't told, so this path only really suits a bespoke test renderer.
    const element = renderer?.elementFor?.(id);
    const surface = surfaceFor?.(id);
    return element ? { element, surface } : undefined;
  };

  const closePopup = (id, { popIn = true } = {}) => {
    const entry = popups.get(id);
    if (!entry) return null;
    popups.delete(id);
    entry.detach();
    if (!entry.closedByPopup) {
      try {
        entry.popup.close?.();
      } catch {
        /* already closing */
      }
    }
    // Only carry the DOM back when this is a real pop-in (the WM state is
    // about to say "normal" again): a caller tearing this helper down with
    // `{ popIn: false }` just closes the popup, since re-registering the
    // element while the state still says "popped-out" would only have the
    // next commit sweep it away as not live, unmounting the surface anyway.
    if (popIn && entry.element) {
      entry.element.remove?.();
      const mainDoc = renderer?.root?.ownerDocument;
      if (mainDoc?.adoptNode) mainDoc.adoptNode(entry.element);
      renderer?.adopt?.(id, entry.element, entry.surface);
    }
    return popIn ? wm.dispatch({ type: "window/pop-in", id }) : null;
  };

  const popOut = (id, options = {}) => {
    const state = wm.getState();
    const win = state.windows[id];
    if (!win) return rejection("unknown-window", id);
    if (win.status === "popped-out" || popups.has(id)) return { state, events: [], effects: [] };

    // Dry-run first: never open a real popup for a command that would be
    // refused anyway (unknown window, a modal blocking it, ...).
    const dry = wm.simulate({ type: "window/pop-out", id });
    if (dry.events.some((event) => event.type === "command/rejected")) return dry;

    const width = Math.round(win.placement?.width ?? 480);
    const height = Math.round(win.placement?.height ?? 320);
    const popup = openWindow("", options.name ?? `wm-popout-${id}`, options.features ?? `popup,width=${width},height=${height}`);
    if (!popup || popup.closed) return rejection("popup-blocked", id);

    const popupDoc = popup.document;
    if (popupDoc) {
      popupDoc.title = titleOf(id);
      copyStyles(renderer?.root?.ownerDocument, popupDoc);
    }

    const released = releaseElement(id);
    const element = released?.element;
    const surface = released?.surface;
    if (element && popupDoc) {
      if (popupDoc.adoptNode) popupDoc.adoptNode(element);
      fillPopup(element);
      (popupDoc.body ?? popupDoc).appendChild(element);
    }

    // A popped-out window is not on the stage, so it can never be the WM's
    // focused window (focus is only given to visible windows). Focusing the
    // popup instead clears the WM focus: keyboard focus has left the stage.
    const onFocus = () => {
      if (wm.getState().focus.window !== null) wm.dispatch({ type: "window/blur" });
    };
    let closedByPopup = false;
    const onUnload = () => {
      closedByPopup = true;
      closePopup(id);
    };
    popup.addEventListener?.("focus", onFocus);
    popup.addEventListener?.("pagehide", onUnload);
    popup.addEventListener?.("beforeunload", onUnload);
    const unsubscribe = wm.subscribe((s) => {
      if (!popupDoc || !s.windows[id]) return;
      const next = s.windows[id].title || id;
      if (popupDoc.title !== next) popupDoc.title = next;
    });

    popups.set(id, {
      popup,
      element,
      surface,
      get closedByPopup() {
        return closedByPopup;
      },
      detach() {
        popup.removeEventListener?.("focus", onFocus);
        popup.removeEventListener?.("pagehide", onUnload);
        popup.removeEventListener?.("beforeunload", onUnload);
        unsubscribe();
      },
    });

    return wm.dispatch({ type: "window/pop-out", id });
  };

  /** Bring a popped-out window back: closes its popup (if any) and dispatches `window/pop-in`. */
  const popIn = (id) => closePopup(id) ?? wm.dispatch({ type: "window/pop-in", id });

  const unsubscribeAll = wm.subscribe((state, events = []) => {
    for (const event of events) {
      // Something other than this helper's own popIn()/popOut() moved the
      // window out of "popped-out" (restore, undo/redo, ...): drop the
      // popup-tracking entry so it isn't closed a second time, but there is
      // no DOM to carry back — it already remounted fresh (see module doc).
      if (event.type === "window/status-changed" && event.previous === "popped-out" && event.status !== "popped-out") {
        const entry = popups.get(event.id);
        if (entry) {
          popups.delete(event.id);
          entry.detach();
          try {
            entry.popup.close?.();
          } catch {
            /* already closing */
          }
        }
      }
      if (event.type === "window/closed" && popups.has(event.id)) {
        const entry = popups.get(event.id);
        popups.delete(event.id);
        entry.detach();
        try {
          entry.popup.close?.();
        } catch {
          /* already closing */
        }
      }
    }
  });

  return {
    popOut,
    popIn,
    isPoppedOut: (id) => popups.has(id),
    detach() {
      unsubscribeAll();
      for (const id of [...popups.keys()]) closePopup(id, { popIn: false });
    },
  };
};
