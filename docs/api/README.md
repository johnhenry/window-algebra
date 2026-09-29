# window-algebra API reference

The complete reference for every public export of `@johnhenry/window-algebra`. It is organised by area. Each page was written against the source in `src/` and the tests in `test/`. If a page and the code disagree, the code is right and the page has a bug.

For the rationale, prior art and open questions, see the design document, [`docs/PRD.md`](../PRD.md). For a guided tour, start with the [README](../../README.md).

## Pages

| Page | Covers |
| --- | --- |
| [State](./state.md) | The state shape (windows, workspaces, outputs, focus, stack), `createState`, `createWorkspace`, `createOutput`, `createWindowRecord`, `LAYERS`, `ROLES`, `STATUSES`, `DEFAULT_OUTPUT`, and every `config` key with its default (`DEFAULT_CONFIG`, including `drag`, `rules`, `urgency`, `snap`). |
| [Commands](./commands.md) | `update`, `reduce`, `replay`, `COMMANDS`, extensions, the `{ state, events, effects }` protocol, and **all 51 built-in commands**: payload fields, events emitted, effects and rejection reasons. |
| [Events and effects](./events.md) | Every event type (44, including the manager's `history/changed`, `state/loaded` and `state/load-rejected`), its fields and which commands emit it, and the two effect types. |
| [Queries](./queries.md) | Every read-only query (`isVisible`, `focusable`, `paintOrder`, `modalTarget`, …), the rule helpers (`matchRules`, `validRules`, `MATCH_FIELDS`, `SET_FIELDS`) and `presentationContext`. |
| [Layout algebra](./algebra.md) | The eleven primitives and every option each one accepts, `container`/`modifier`, the type guards, `validate`, `fromJSON`, and all tree transforms (`transform`, `walk`, `fold`, `mirror`, `rotate`, …). |
| [Layouts and modifiers](./layouts.md) | `derive`, `LAYOUTS` and every layout type's spec options, the derived-layout functions (`masterStack`, `spiral`, `dock`, …), the BSP and docking-tree helpers, split sizing (`layout/resize-split` paths), and layout modifiers (`MODIFIERS`, `withModifiers`, …). |
| [Drag and drop](./drops.md) | Drop semantics per layout, `DROPS`, drop interpreters (`orderDrops`, `createDropHandler`, `dropInterpreterFor`), the drag-mode helpers, and the pure pointer helpers (`dropZoneAt`, `dropTargetAt`, `previewDrop`, `zoneRect`). |
| [compile and CSS](./compile.md) | `compile`, the render-tree shape, element keys, every attribute and CSS mapping, `toHTML`, `styleText`, `tracks`, `px`, `anchorName`, `tabId`/`panelId`, `SPLITTER_SIZE`, `BASE_CSS` and its custom properties. |
| [Geometry and interaction](./geometry.md) | The `geometry` namespace (rects, `constrainSize`, `sizeToCells`, …), `positionPopup`, move/resize/ratio gesture math, and snap zones and magnetism. |
| [The manager](./manager.md) | `createWindowManager`: options, every method and getter, gestures, the command log, `load`/`serialize`, multiple renderers. |
| [Browser adapters](./browser.md) | `createDomRenderer` (reconciliation, measurement, the anchor fallback, animation, `release`/`adopt`), `attachInput` (options, markup contract, attributes it sets, keyboard), surfaces, schedulers, and `attachPopouts`. |
| [Framework bindings](./bindings.md) | `createReactBindings` (`useWindowManager`, `useWindowState`, `WindowManagerStage`) and the `<wa-stage>` custom element (`defineWindowAlgebraElement`, `attachStage`). |
| [Versioning and migration](./versioning.md) | `STATE_VERSION`, `migrate`, `MIGRATIONS`, what each migration step does, how to add one, and the known `config.snap` gap. |
| [Errors](./errors.md) | What is rejected as an event and what throws, with every rejection reason in one table. |

## Entry points

`package.json` `exports` maps these subpaths. Every one is plain ESM and has no dependencies.

| Import specifier | File | Contents |
| --- | --- | --- |
| `@johnhenry/window-algebra` | `src/index.mjs` | Everything pure (algebra, transforms, layouts, geometry, interaction, state, commands, queries, history, compile) plus `createWindowManager`. Runs in Node, workers and browsers. |
| `@johnhenry/window-algebra/browser` | `src/browser/index.mjs` | `createDomRenderer`, `attachInput`, `DEFAULT_MOVE_KEYS`, `htmlSurface`, `lazySurface`, `iframeSurface`, `canvasSurface`, `createSurfaceRegistry`, `createFrameScheduler`, `immediateScheduler`, `attachPopouts`. Importing it touches no DOM; calling the functions does. |
| `@johnhenry/window-algebra/algebra` | `src/algebra/nodes.mjs` | Just the primitives, guards, `validate`, `fromJSON` and the kind lists. |
| `@johnhenry/window-algebra/transforms` | `src/algebra/transforms.mjs` | Just the tree transforms. |
| `@johnhenry/window-algebra/layouts` | `src/layouts/index.mjs` | The derived-layout functions and every BSP and docking-tree helper (including `isTreeContainer`). |
| `@johnhenry/window-algebra/css` | `src/css/compile.mjs` | `compile`, `toHTML`, `styleText`, `tracks`, `px`, `anchorName`, `tabId`, `panelId`, `SPLITTER_SIZE`, `BASE_CSS`. |
| `@johnhenry/window-algebra/react` | `src/bindings/react.mjs` | `createReactBindings`. React is passed in, not imported. |
| `@johnhenry/window-algebra/element` | `src/bindings/element.mjs` | `defineWindowAlgebraElement`, `attachStage`. |
| `@johnhenry/window-algebra/package.json` | `package.json` | The manifest. |

The root entry re-exports `geometry` as a namespace (`import { geometry } from "@johnhenry/window-algebra"`; `geometry.constrainSize(...)`) and re-exports `SIDES` from the positioner as `POPUP_SIDES`. The bindings are **not** re-exported from the root entry, so importing the root never pulls in binding code.

Internal modules that are not in `exports` (for example `src/state/update.mjs` directly) are not part of the public API. Helpers that exist in those modules but are not re-exported (`resolveDrop` and `dropHandlers` in `state/drops.mjs`, `foldRuleSets` and `explicitlySet` in `state/rules.mjs`) may change without notice.

## Conventions used throughout

- **Pure means pure.** `update`, `derive`, `compile`, every query, transform and geometry helper return new values and never mutate their inputs, touch the DOM, read the clock or use randomness. Ids are always supplied by the caller.
- **Immutable trees.** Layout-algebra nodes are deep-frozen. State objects are not frozen, but nothing in the library mutates them. Treat them as immutable.
- **Commands never throw.** Anything `update` cannot do comes back as a `command/rejected` event with a `reason`. The things that *do* throw are programmer errors in constructors and interpreters; see [Errors](./errors.md).
- **A no-op returns the same state reference.** `update(state, cmd).state === state` means nothing changed. The manager relies on this to skip history entries.
- **Rects** are `{ x, y, width, height }` in CSS pixels. Browser-side rects are relative to the renderer's root element.
