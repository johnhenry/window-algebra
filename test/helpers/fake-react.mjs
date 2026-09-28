/**
 * A deliberately tiny React stand-in: just enough of the hooks contract
 * (`useState`, `useRef`, `useEffect`, `useSyncExternalStore`) plus
 * `createElement`/`Fragment`/`createPortal` and a synchronous `render`, to
 * exercise `createReactBindings` (including its own nested function
 * component, `WindowManagerStage`) without a real React or react-dom.
 *
 * Every function-typed element gets its own persistent hook storage, keyed
 * by its structural path in the tree (stable across re-renders as long as
 * the tree's shape doesn't change) — a poor man's fiber. A string-typed
 * element with a `ref` reuses its existing DOM node across re-renders,
 * since real React never recreates a mounted host on a re-render and
 * `attachStage`'s captured `root` (and its event listeners) depend on that
 * identity holding. A portal writes into its own container exactly once;
 * later renders that still include it are no-ops.
 */
export const Fragment = Symbol("Fragment");

export const createFakeReact = (doc) => {
  let current = null; // the hook bucket in scope for the component call in progress

  const useRef = (initial) => {
    const bucket = current;
    const i = bucket.index++;
    if (!(i in bucket.refs)) bucket.refs[i] = { current: initial };
    return bucket.refs[i];
  };

  const useState = (initial) => {
    const bucket = current;
    const i = bucket.index++;
    if (!(i in bucket.state)) bucket.state[i] = typeof initial === "function" ? initial() : initial;
    const setState = (value) => {
      const next = typeof value === "function" ? value(bucket.state[i]) : value;
      if (!Object.is(next, bucket.state[i])) {
        bucket.state[i] = next;
        bucket.owner.scheduleRerender();
      }
    };
    return [bucket.state[i], setState];
  };

  const depsChanged = (prev, deps) =>
    !prev || !deps || prev.length !== deps.length || deps.some((d, idx) => !Object.is(d, prev[idx]));

  const useEffect = (fn, deps) => {
    const bucket = current;
    const i = bucket.index++;
    const prev = bucket.effects[i];
    bucket.effects[i] = { fn, deps, changed: depsChanged(prev?.deps, deps), cleanup: prev?.cleanup };
  };

  const useSyncExternalStore = (subscribe, getSnapshot) => {
    const bucket = current;
    const i = bucket.index++;
    if (!bucket.stores[i]) bucket.stores[i] = { unsubscribe: subscribe(() => bucket.owner.scheduleRerender()) };
    return getSnapshot();
  };

  const createElement = (type, props, ...children) => ({ type, props: props ?? {}, children });
  const createPortal = (node, container) => ({ $$portal: true, node, container });

  const applyProp = (el, key, value) => {
    if (key === "ref") {
      if (typeof value === "function") value(el);
      else if (value) value.current = el;
    } else if (key === "style" && value && typeof value === "object") {
      for (const [prop, val] of Object.entries(value)) el.style.setProperty(prop, String(val));
    } else if (key === "className") {
      el.setAttribute("class", value);
    } else if (key !== "children" && key !== "key") {
      el.setAttribute(key, value);
    }
  };

  /**
   * Renders `Component(props)` (and any nested function components in the
   * result) into real (fake) DOM nodes, reusing hook storage and DOM nodes
   * across re-renders by structural path. `effectQueue` collects `{fn,
   * cleanup-of-previous}` entries to run once the whole pass has mounted,
   * innermost first (roughly React's commit order).
   */
  const renderNode = (node, path, hooksByPath, effectQueue, owner) => {
    if (node == null || typeof node === "boolean") return [];
    if (Array.isArray(node)) return node.flatMap((child, i) => renderNode(child, `${path}.${i}`, hooksByPath, effectQueue, owner));
    if (typeof node !== "object") return [];

    if (node.$$portal) {
      if (!node.container.__waPortalMounted) {
        const dom = renderNode(node.node, `${path}:portal`, hooksByPath, effectQueue, owner);
        for (const el of dom) node.container.append(el);
        node.container.__waPortalMounted = true;
      }
      return [];
    }

    const { type, props, children } = node;

    if (type === Fragment) {
      return children.flatMap((child, i) => renderNode(child, `${path}.${i}`, hooksByPath, effectQueue, owner));
    }

    if (typeof type === "function") {
      let bucket = hooksByPath.get(path);
      if (!bucket) {
        bucket = { index: 0, refs: [], state: [], effects: [], stores: [], owner };
        hooksByPath.set(path, bucket);
      }
      bucket.index = 0;
      const previous = current;
      current = bucket;
      const subtree = type(props);
      current = previous;
      const dom = renderNode(subtree, `${path}>`, hooksByPath, effectQueue, owner);
      for (const effect of bucket.effects) if (effect?.changed) effectQueue.push(effect);
      return dom;
    }

    // string-typed host element
    const ref = props?.ref;
    const reused = ref && typeof ref === "object" ? ref.current : undefined;
    const el = reused ?? doc.createElement(type);
    for (const [key, value] of Object.entries(props ?? {})) applyProp(el, key, value);
    for (const [i, child] of children.entries()) {
      for (const dom of renderNode(child, `${path}.${i}`, hooksByPath, effectQueue, owner)) el.append(dom);
    }
    return [el];
  };

  /**
   * Renders `Component(props)` and re-renders it on state/store changes;
   * returns `{ unmount(), flush() }`. Like React 18's automatic batching,
   * several state/store updates that happen in the same synchronous burst
   * (e.g. two `useSyncExternalStore` subscriptions both notified by one
   * dispatch) coalesce into a single re-render, run on the next microtask —
   * `await handle.flush()` after such an action, before asserting.
   *
   * `container`, if given, receives the rendered root node(s) (appending an
   * already-attached, ref-reused node is a harmless no-op, matching how a
   * real host element stays put across re-renders).
   */
  const render = (Component, props, { container } = {}) => {
    const hooksByPath = new Map();
    let pending = null;
    const owner = {
      scheduleRerender: () => {
        if (!pending) {
          pending = Promise.resolve().then(() => {
            pending = null;
            run();
          });
        }
      },
    };
    const run = () => {
      const effectQueue = [];
      const roots = renderNode({ type: Component, props, children: [] }, "root", hooksByPath, effectQueue, owner);
      if (container) for (const node of roots) container.append(node);
      for (const effect of effectQueue) {
        effect.cleanup?.();
        effect.cleanup = effect.fn();
      }
    };
    run();
    return {
      unmount() {
        for (const bucket of hooksByPath.values()) {
          for (const effect of bucket.effects) effect?.cleanup?.();
          for (const store of bucket.stores) store?.unsubscribe?.();
        }
      },
      /** Resolves once any pending, microtask-coalesced re-render has run. */
      flush: () => pending ?? Promise.resolve(),
    };
  };

  return { useRef, useState, useEffect, useSyncExternalStore, createElement, Fragment, createPortal, render };
};
