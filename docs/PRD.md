# PRD: window-algebra

This PRD was written from the design conversation "Design Window Manager APIs" (see `_chat-shares/6ab9f8e7/`). The conversation ended with a request to create the PRD, which was never answered there. This document is that PRD, and it reflects what version 0 implements.

## Problem

Browser applications that need multiple windows (IDEs, dashboards, browser-OS experiments, html-in-canvas environments) usually either reimplement a desktop window manager imperatively or hard-code one layout mode. Both approaches mix policy (who goes where) with mechanism (pixels and DOM), and neither takes advantage of the browser's own layout engine.

## Goals

1. Provide window-management primitives, not a finished window manager. Floating, tiling, tabbed, and hybrid managers should all come from the same parts.
2. Keep a pure, deterministic core: `update(state, command)` and `derive(state)` have no side effects.
3. Express layout as a small algebra of spatial relationships, and preserve those relationships down to CSS instead of reducing them to pixels early.
4. Treat CSS (flex, grid, anchor positioning, containment, container queries) as the constraint solver.
5. Keep surfaces, windows, and presentations as distinct identities, so the same manager can host HTML, iframes, canvas, or html-in-canvas surfaces.

## Non-goals (v0)

- Replacing an operating-system window manager or compositor.
- Multi-output (multiple displays or canvases). The state model leaves room for an `Output`, but there isn't one yet.
- Collaborative synchronization. Determinism and the command log make it possible, but it isn't built.
- Animated transitions. The keyed DOM makes View Transitions straightforward to add later.

## Architecture

```
EVENT/COMMAND ─▶ update (pure) ─▶ intent state ─▶ derive (pure) ─▶ layout tree
      ─▶ compile (pure) ─▶ render tree ─▶ commit (effectful) ─▶ DOM ─▶ measure ─▶ realized state
```

There are three kinds of state: **intent** (the logical model), **presentation** (the layout tree and its CSS declarations), and **realized** (the geometry the browser measured).

## Layout algebra

There are eleven primitives, and all of them except `view` take options first:

- Leaf: `view(id)`
- Containers: `row`, `column`, `grid`, `stack`, `overlay`
- Modifiers: `place`, `size`, `gap`, `inset`, `anchor`

These candidates were considered and rejected (or left as derived helpers):

- `flow`: `grid` with auto-fit columns covers it.
- `layer` / `z` / `top` / `portal`: these are policy or renderer concerns.
- `fit` / `clip` / `scroll` / `transform`: these are surface rendering, not layout.
- `repeat`: plain JavaScript already does this.
- `group`: this belongs to logical state.
- `dock`: this is sugar over `row` plus `size`.
- `align`: this folds into `place` as `{ x: "center" }`.
- `area`: this folds into `place` as `{ area }`.
- `aspect` / `limit`: these fold into `size`.
- `when`: plain JavaScript conditionals do this.

## Requirements implemented in v0

| Area | Requirement |
| --- | --- |
| State | Plain JSON. Windows, workspaces, focus with history, and per-layer stacking. |
| Commands | 36 built-in commands. Bad commands are rejected, never thrown. Extensions are supported. |
| Policy | Modal-graph focus redirection, optional focus-raises, cascading close, refocus from history. |
| Layouts | master-stack, columns, rows, grid (auto-fit/fixed), spiral, monocle, tabs, floating, BSP (stateful), and custom interpreters. |
| Hybrid | Tiled base plus floating, dialog, popover, and notification layers in a single overlay. |
| Transforms | mirror, flip, rotate, reverse, mapViews, replace, remove, swap, find, fold. |
| CSS | Flex weights, grid tracks and areas, stack visibility plus `inert`, overlay translate, anchor positioning, gap/padding, size containers. |
| DOM | Keyed reconciliation, stable view elements, surface mount/unmount, realized-geometry measurement, anchor fallback. |
| Input | Pure drag, resize, and ratio math, plus a pointer adapter with a markup contract. |
| Drag and drop | `window/drop` edits tiled structure (order or BSP tree) per layout through drop interpreters; `config.drag` modes, edge zone, preview, and a `tooSmall` check; pinned windows; keyboard equivalents; a ghost preview rendered by the same derive → compile pipeline. Tiled ↔ floating (`window/detach`, floating drops), drops onto workspace targets (with `follow`), tab-strip reordering, children that travel with their parent, pinned-window affordances, touch long-press, aria-live announcements, and opt-in keyboard moving. |
| History | Undo/redo of window management, a command log, replay, and serialize/load. A gesture (commands sharing a `gesture` token) is one undo step and one log entry. |
| Size hints | ICCCM `WM_NORMAL_HINTS`-style hints beyond min/max: `aspectRatio` (exact or `{ min, max }`) and `widthIncrement`/`heightIncrement` with `baseWidth`/`baseHeight` (terminal-style cells). Honoured by `constrainSize` for floating move/resize and `window/resize`; tiled windows get CSS `aspect-ratio` for an exact ratio, increments are advisory. |

## Open questions

- Should the five container kinds collapse into one internal `container(strategy, …)` node? The constructors already go through that function, but the node `type` still records the kind.
- Should struts / `reserve()` for panels be a primitive or live in `Output.workArea`?
- Should views split into authoritative views and synchronized projections? Today the second occurrence of a view is rendered but receives no surface.
- Should the tab strip become a general presentation node for chrome that isn't a window?
