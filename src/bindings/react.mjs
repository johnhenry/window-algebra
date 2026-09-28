/**
 * React bindings, built on top of the plain `createWindowManager` facade and
 * the browser renderer/input adapters. No dependency on React is declared;
 * the caller passes their own React (or a compatible stub) in.
 *
 * `createReactBindings(React)` returns three things:
 *
 * - `useWindowManager(options)` creates (once) a window manager with
 *   `createWindowManager(options)` and subscribes the component to it with
 *   `useSyncExternalStore`, so the component re-renders on every dispatch.
 *   Returns `{ wm, state }`; `wm` is stable across renders.
 * - `useWindowState(wm, selector)` subscribes to just a slice of state
 *   (`selector(state)`), re-rendering only when that slice changes
 *   (`Object.is` on the selected value).
 * - `WindowManagerStage` mounts a `createDomRenderer` + `attachInput` pair
 *   into a ref'd host element for the lifetime of the component, and (when a
 *   `renderSurface` + `createPortal` are supplied) lets window content be
 *   ordinary React trees rendered as portals into each view's mount point,
 *   instead of imperative DOM the WM owns outright.
 */
import { createWindowManager } from "../manager.mjs";
import { createDomRenderer } from "../browser/dom.mjs";
import { attachInput } from "../browser/input.mjs";

export const createReactBindings = (React) => {
  const { useRef, useEffect, useState, useSyncExternalStore, createElement, Fragment } = React;

  /** Creates a window manager once and subscribes this component to it. */
  const useWindowManager = (options) => {
    const ref = useRef(null);
    if (!ref.current) ref.current = createWindowManager(options);
    const wm = ref.current;
    const state = useSyncExternalStore(wm.subscribe, wm.getState);
    return { wm, state };
  };

  /**
   * Subscribes to a derived slice of a window manager's state. `selector`
   * defaults to identity (the whole state). Only re-renders when the
   * selected value changes (`Object.is`), so a selector returning a stable
   * primitive or a memoized value avoids extra renders; a selector that
   * allocates a fresh object every call will re-render every dispatch, same
   * as any other `useSyncExternalStore` selector.
   */
  const useWindowState = (wm, selector = (state) => state) => {
    const selectorRef = useRef(selector);
    selectorRef.current = selector;
    const cache = useRef({ has: false, state: undefined, value: undefined });
    const getSnapshot = useRef(() => {
      const state = wm.getState();
      if (cache.current.has && cache.current.state === state) return cache.current.value;
      const value = selectorRef.current(state);
      cache.current = { has: true, state, value };
      return value;
    });
    return useSyncExternalStore(wm.subscribe, getSnapshot.current);
  };

  /**
   * Mounts a WM renderer + input adapter into a host element for as long as
   * this component is alive.
   *
   * Props:
   * - `wm` (required): the window manager to render.
   * - `renderSurface?(id)`: returns a React node for a view's content. When
   *   given (with `createPortal`, react-dom's), each view's content is a
   *   React portal into that view's mount point instead of plain DOM, so
   *   window content can be ordinary React components (state, effects,
   *   context, all intact) while the WM still owns layout and chrome.
   * - `createPortal`: react-dom's `createPortal`, required for the above.
   * - `anchorFallback?`, `input?` (object merged into `attachInput`'s
   *   options), `as?` (host tag, default "div"): passed through.
   * - Everything else (`className`, `style`, `id`, ...) lands on the host
   *   element as ordinary props.
   */
  const WindowManagerStage = (props) => {
    const { wm, renderSurface, createPortal, anchorFallback, input, as = "div", ...rest } = props;
    const hostRef = useRef(null);
    const [portals, setPortals] = useState(() => new Map());

    useEffect(() => {
      const root = hostRef.current;
      if (!root || !wm) return undefined;

      const surfaceFor =
        renderSurface && createPortal
          ? (id) => {
              const container = root.ownerDocument.createElement("div");
              container.setAttribute("data-wa-portal", id);
              return {
                mount(target) {
                  target.append(container);
                  setPortals((prev) => {
                    const next = new Map(prev);
                    next.set(id, container);
                    return next;
                  });
                },
                unmount() {
                  setPortals((prev) => {
                    if (!prev.has(id)) return prev;
                    const next = new Map(prev);
                    next.delete(id);
                    return next;
                  });
                  container.remove();
                },
              };
            }
          : undefined;

      const renderer = createDomRenderer({ root, document: root.ownerDocument, anchorFallback, surfaceFor });
      const detach = attachInput({ root, wm, ...input });
      const commit = () => renderer.commit(wm.present().render);
      commit();
      const unsubscribe = wm.subscribe(commit);
      return () => {
        unsubscribe();
        detach();
        renderer.destroy?.();
        setPortals(new Map());
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps -- re-attach only when `wm` itself changes
    }, [wm]);

    const children = [];
    for (const [id, container] of portals) {
      children.push(createElement(Fragment, { key: id }, createPortal(renderSurface(id), container)));
    }
    return createElement(as, { ...rest, ref: hostRef }, ...children);
  };

  return { useWindowManager, useWindowState, WindowManagerStage };
};
