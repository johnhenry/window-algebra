/**
 * Keep `config.direction` in step with the page: a stage inside `dir="rtl"`
 * (an attribute on the stage, `<html>`, or anything between) lays itself out
 * right to left, with no extra configuration.
 *
 * The page wins only when it says something. An element with an explicit
 * `dir` (or a computed `direction: rtl`) sets the state's direction; a page
 * with no `dir` anywhere leaves `config.direction` as the state has it, so
 * `createState({ config: { direction: "rtl" } })` still works on a plain page.
 */

/** "rtl" | "ltr" if the page says so for `element`, else `undefined`. */
export const pageDirection = (element) => {
  const view = element.ownerDocument?.defaultView;
  let computed;
  try {
    computed = view?.getComputedStyle?.(element)?.direction;
  } catch {
    computed = undefined;
  }
  const attribute = element.closest?.("[dir]")?.getAttribute("dir")?.toLowerCase();
  if (computed === "rtl" || attribute === "rtl") return "rtl";
  if (attribute === "ltr") return "ltr";
  return undefined;
};

/**
 * @param {object} options
 * @param {object} options.wm the window manager whose `config.direction` is kept in step
 * @param {Element} options.element the stage element (its `dir`, and its ancestors', are read)
 * @param {boolean} [options.observe] watch `dir` changes with a MutationObserver (default true)
 * @returns {{ direction(): string|undefined, refresh(): void, detach(): void }}
 */
export const attachDirection = ({ wm, element, observe = true }) => {
  const refresh = () => {
    const direction = pageDirection(element);
    if (direction && wm.getState().config?.direction !== direction) wm.dispatch({ type: "config/set", direction });
  };
  refresh();
  const doc = element.ownerDocument;
  const Observer = doc?.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  let observer = null;
  if (observe && Observer && doc?.documentElement) {
    observer = new Observer(refresh);
    observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["dir"], subtree: true });
  }
  return {
    direction: () => pageDirection(element),
    refresh,
    detach() {
      observer?.disconnect();
    },
  };
};
