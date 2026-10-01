# Framework bindings

[API reference](./README.md) › Framework bindings

Two optional bindings, each a subpath export that pulls in only the library's own modules. Neither adds a dependency. Sources: `src/bindings/react.mjs`, `src/bindings/element.mjs`.

## Contents

- [React: `@johnhenry/window-algebra/react`](#react-johnhenrywindow-algebrareact)
- [Custom element: `@johnhenry/window-algebra/element`](#custom-element-johnhenrywindow-algebraelement)

## React: `@johnhenry/window-algebra/react`

### `createReactBindings(React)`

You pass in your own React, any version with `useSyncExternalStore` (18+). Nothing is imported from `react`. It returns `{ useWindowManager, useWindowState, WindowManagerStage }`.

```jsx
import * as React from "react";
import { createPortal } from "react-dom";
import { createReactBindings } from "@johnhenry/window-algebra/react";

const { useWindowManager, useWindowState, WindowManagerStage } = createReactBindings(React);

function Desktop() {
  const { wm } = useWindowManager({ history: true });
  const count = useWindowState(wm, (state) => Object.keys(state.windows).length);
  return (
    <WindowManagerStage
      wm={wm}
      style={{ height: "100vh" }}
      renderSurface={(id) => <WindowContent wm={wm} id={id} />}
      createPortal={createPortal}
    />
  );
}
```

### `useWindowManager(options?)`

Creates a manager **once** with `createWindowManager({ schedule: createFrameScheduler(), ...options })` (later `options` are ignored; pass your own `schedule`, e.g. `immediateScheduler`, to override the frame coalescing) and subscribes the component with `useSyncExternalStore`, so it re-renders on every dispatch. Returns `{ wm, state }`; `wm` is stable across renders.

### `useWindowState(wm, selector = (state) => state)`

Subscribes to a slice of state. The component re-renders only when `selector(state)` changes by `Object.is`. The selected value is cached per state object. A selector that allocates a new object on every call re-renders on every dispatch, as with any `useSyncExternalStore` selector, so return primitives or memoized values. The latest `selector` is always used. The `wm` argument is read when the hook first mounts, so pass a stable manager (like `useWindowManager`'s).

### `<WindowManagerStage>`

Mounts a `createDomRenderer` plus `attachInput` pair into a host element for the component's lifetime. It commits `wm.present().render` immediately and after dispatches, **coalesced to one commit per frame** (`createFrameScheduler()`, or your `schedule` prop), and tears everything down on unmount (a commit still queued is dropped). It re-attaches only when `wm` changes.

| Prop | Description |
| --- | --- |
| `wm` | Required. The manager to render. |
| `renderSurface(id)` | Returns a React node for a window's content. When given **with** `createPortal`, each view's content is a React portal into a container `div[data-wa-portal="<id>"]` inside that view, so window content is an ordinary React tree (state, effects and context intact) while the WM owns layout and chrome. |
| `createPortal` | react-dom's `createPortal`. It is required for `renderSurface`. |
| `schedule(task)` | When commits run. Default `createFrameScheduler()`; `immediateScheduler` commits synchronously (tests, server-style rendering). |
| `anchorFallback` | Forwarded to `createDomRenderer`. |
| `input` | An object merged into `attachInput`'s options (`{ wm, root }` are supplied; add `announce`, `keyboard`, `modifier`, …). |
| `as` | The host tag, default `"div"`. |
| anything else | Passed to the host element (`className`, `style`, `id`, …). |

**Give the host a height.** The stage fills its host, and a `div` with no height collapses to 0 px (the React demo shipped with exactly this bug, fixed in `7f01c31`).

Without `renderSurface`/`createPortal`, views get no surface from the binding. Wire plain-DOM surfaces yourself, or use the custom element.

## Custom element: `@johnhenry/window-algebra/element`

### `defineWindowAlgebraElement(name = "wa-stage", deps?)`

Registers (with the platform's `customElements.define`) and returns a custom element class that owns a manager, a `createDomRenderer` and an `attachInput` for as long as it is connected. If `name` is already registered, the existing class is returned. `deps` (`{ customElements, HTMLElement }`) lets you define it outside a browser, for example in tests. Without a registry it **throws `Error`**.

```html
<wa-stage style="display:block; height: 100vh"></wa-stage>
<script type="module">
  import { defineWindowAlgebraElement } from "@johnhenry/window-algebra/element";
  import { createWindowManager } from "@johnhenry/window-algebra";
  import { createSurfaceRegistry, htmlSurface } from "@johnhenry/window-algebra/browser";

  defineWindowAlgebraElement();
  const surfaces = createSurfaceRegistry();
  const stage = document.querySelector("wa-stage").configure({ wm: createWindowManager(), surfaceFor: surfaces });
  surfaces.set("editor", htmlSurface(document.createElement("textarea")));
  stage.wm.create({ id: "editor", title: "Editor" });
</script>
```

Instance API:

| Member | Description |
| --- | --- |
| `configure(options)` | Sets or replaces the stage options (same shape as `attachStage`). If connected, it detaches and re-attaches immediately. It returns the element. |
| `wm` | The live manager while connected, `null` otherwise. |

Lifecycle: `connectedCallback` → `attachStage(this, options)`; `disconnectedCallback` → `detach()`. **Without an explicit `wm` in the options, a new manager is created on every connect and every `configure`**, so the previous windows are gone. Pass your own `wm` to keep state across re-parenting or reconfiguration.

### `defineCommandPaletteElement(name = "wa-palette", deps?)`

Registers and returns a custom element class that hosts a [command palette](./palette.md) for as long as it is connected. Idempotent for an already-registered `name`; `deps` as above; without a registry it **throws `Error`**.

```html
<wa-palette></wa-palette>
<script type="module">
  import { defineCommandPaletteElement } from "@johnhenry/window-algebra/element";
  defineCommandPaletteElement();
  document.querySelector("wa-palette").configure({ wm, shortcut: "Mod+K" });
</script>
```

| Member | Description |
| --- | --- |
| `configure(options)` | Options for `createPalette` (`wm` required). If connected, it re-mounts immediately. Returns the element. |
| `wm` (getter and setter) | The manager; assigning it mounts the palette. |
| `open(options?)`, `close()`, `toggle()`, `isOpen` | As on the palette handle. They do nothing until a `wm` is set. |

### `attachStage(host, options?)`

The reusable core that the element wraps. It needs only `host.ownerDocument` and the usual Element methods (the real DOM, or the fake one in `test/helpers/fake-dom.mjs`).

```js
attachStage(host, {
  wm,              // use this manager as-is…
  manager,         // …or options for createWindowManager
  anchorFallback,  // forwarded to createDomRenderer
  surfaceFor,      // forwarded to createDomRenderer
  input,           // merged into attachInput's options
  schedule,        // (task) => void; default createFrameScheduler(). immediateScheduler commits synchronously
  sync,            // true | attachSync options: keep this stage in step with other tabs (off by default)
  palette,         // true | createPalette options: a command palette for this stage's manager (off by default)
}) → { wm, renderer, sync, palette, detach() }   // sync/palette are the handles, or null
```

It commits once, then re-commits after dispatches, coalesced to one commit per frame (a bare `requestAnimationFrame`; outside a browser it falls back to a 16 ms timer, so pass `schedule: immediateScheduler` in tests). `detach()` unsubscribes, detaches input and destroys the renderer.
