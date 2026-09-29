# Geometry and interaction

[API reference](./README.md) › Geometry and interaction

Pure geometry: rects in, rects out. Nothing here knows about the DOM or dispatches commands. The browser adapter measures, calls these, and turns the answers into commands. Sources: `src/geometry/rect.mjs` (the `geometry` namespace), `src/geometry/positioner.mjs`, `src/interaction/drag.mjs`, `src/interaction/snap.mjs`.

A rect is `{ x, y, width, height }`; a point is `{ x, y }`.

## Contents

- [The `geometry` namespace](#the-geometry-namespace)
- [Size hints: `constrainSize` and `sizeToCells`](#size-hints)
- [positionPopup](#positionpopupanchorrect-popupsize-stage-options)
- [Move, resize and ratio gestures](#move-resize-and-ratio-gestures)
- [Snap zones and magnetism](#snap-zones-and-magnetism)

## The `geometry` namespace

```js
import { geometry } from "@johnhenry/window-algebra";
geometry.intersects(a, b);
```

| Function | Returns |
| --- | --- |
| `rect(x = 0, y = 0, width = 0, height = 0)` | A rect. |
| `right(r)`, `bottom(r)` | `x + width`, `y + height`. |
| `center(r)` | The centre point. |
| `contains(r, point)` | Whether the point is inside (left/top inclusive, right/bottom exclusive). |
| `intersects(a, b)` | Whether two rects overlap with positive area. |
| `intersection(a, b)` | The overlap rect, or `null`. |
| `union(a, b)` | The bounding rect. |
| `inset(r, amount)` | Shrinks the rect (grows it for negative amounts). `amount` is a number or `{ top, right, bottom, left }`. Sizes never go below 0. |
| `constrainSize(size, constraints, { preserve }?)` | See [Size hints](#size-hints). |
| `sizeToCells(size, constraints)` | See [Size hints](#size-hints). |
| `clamp(r, container, { keepVisible }?)` | Keeps `r` inside `container` (shrinking it if it is larger). With `keepVisible: n`, only requires `n` px to stay visible horizontally and the top edge to stay inside (the usual rule for dragged windows). |
| `translate(r, dx, dy)` | Moves the rect. |
| `equalRects(a, b)` | Structural equality, `null`-safe. |

## Size hints

ICCCM `WM_NORMAL_HINTS`-style constraints, stored in a window's `constraints`.

### `constrainSize(size, constraints?, { preserve }?)`

```js
constrainSize({ width, height }, {
  minWidth = 0, minHeight = 0, maxWidth = Infinity, maxHeight = Infinity,
  aspectRatio,                       // number (exact) or { min, max }, as width / height
  widthIncrement, heightIncrement,   // only base + n × increment is allowed
  baseWidth, baseHeight,             // default to minWidth / minHeight here
}, { preserve: "width" | "height" }) → { width, height }
```

The order is: clamp to min/max, apply the aspect ratio, re-clamp, snap to increments, re-clamp. `preserve` chooses which dimension the aspect-ratio adjustment holds fixed. By default it picks whichever change is smaller. It is used by `window/resize`, `window/detach`, `window/set-constraints`, rule-set constraints, and `updateResize` (which picks `preserve` from the dragged edge).

Note the base default: in `constrainSize` an omitted `baseWidth`/`baseHeight` defaults to `minWidth`/`minHeight`, while `sizeToCells` defaults it to 0. Set `baseWidth`/`baseHeight` explicitly when you use increments, so the two agree.

### `sizeToCells(size, constraints)`

Returns `{ cols, rows }` for a window with increments, for a live "80×24" readout, or `null` when neither increment is set. Each value is `round((size - base) / increment)` (`null` for an axis without an increment), with `base` defaulting to 0.

Tiled windows: `derive` applies min/max and an **exact** numeric `aspectRatio` as CSS. Ranges and increments are advisory, because CSS decides tiled sizes.

## `positionPopup(anchorRect, popupSize, stage, options?)`

Wayland `xdg_positioner`-style placement for anchored popups (menus, popovers, tooltips, side-anchored dialogs). This is the math the DOM renderer's JS anchor fallback runs, exposed so it can be tested and reused without a DOM.

```js
positionPopup(
  anchorRect,              // { x, y, width, height } in stage coordinates
  popupSize,               // { width, height }, the natural size
  stage,                   // { x = 0, y = 0, width, height }
  {
    side = "bottom",       // "top" | "bottom" | "left" | "right" (POPUP_SIDES)
    align = "center",      // "start" | "center" | "end" along the cross axis
    offset = 0,            // px between the anchor edge and the popup
    gravity = side,        // growth direction; must share side's axis or it falls back to side
    flip = [],             // axes allowed to flip to the opposite side/alignment
    slide = [],            // axes allowed to translate back into the stage
    resize = [],           // axes allowed to shrink to fit
  },
) → { x, y, width, height, side, align, gravity,
      flipped: { x, y }, slid: { x, y }, resized: { x, y }, constrained: { x, y } }
```

Each axis is handled independently, trying flip, then slide, then resize, and only the adjustments that axis opted into. The primary axis (that of `side`) flips `side` and `gravity` together. The cross axis flips `align` between `start` and `end` (never from `center`). A flip is taken only if it overflows less than the original. Resize keeps the edge nearest the anchor fixed. With all three lists empty the plain placement is returned, even if it overflows. The returned `side`/`align`/`gravity` are the values actually used, and the flag objects say what happened per axis.

`POPUP_SIDES` is `["top", "bottom", "left", "right"]`.

## Move, resize and ratio gestures

Pointer-agnostic: feed them positions from a mouse, touch, pen, a synthetic source, a remote peer or an agent.

| Export | Description |
| --- | --- |
| `createDrag({ origin, bounds })` | Starts a move: `{ kind: "move", origin, start }`. |
| `updateDrag(drag, pointer, { snap }?)` | The new `{ x, y }` for a pointer. With `snap: n`, it rounds to an `n`-px grid. |
| `EDGES` | `["n", "s", "e", "w", "ne", "nw", "se", "sw"]` |
| `createResize({ origin, bounds, edge = "se", constraints = {} })` | Starts a resize from an edge or corner. **Throws `TypeError`** for an unknown edge. |
| `updateResize(resize, pointer)` | The resulting `{ x, y, width, height }`, constrained by `constrainSize`. For a single-axis edge (`n`/`s` or `e`/`w`), `preserve` holds the dragged dimension, so an aspect ratio adjusts the other one. West and north edges keep the opposite edge fixed. |
| `updateRatio({ ratio, origin, total }, pointer, axis = "x")` | A split ratio after dragging a divider across `total` px, clamped to [0.05, 0.95]. |

## Snap zones and magnetism

Windows Snap, macOS tiling and window-manager magnetism, for **floating** windows. Tiled windows use `window/drop` instead. They are configured by [`config.snap`](./state.md#configuration-config) and applied by `attachInput`. A released snap is one `window/resize { id, x, y, width, height }` carrying the drag's `gesture` token, so the whole gesture is one undo step. `constrainSize` still clamps it, so a zone never violates a window's constraints (the window may just not fill the whole zone).

| Export | Description |
| --- | --- |
| `SNAP_ZONES` | `["maximize", "left", "right", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"]` |
| `snapZoneAt(stage, point, { edges = true, threshold = 16, zones = "halves-quarters" }?)` | The zone the pointer is near, or `null`. "Near" is within `threshold` px of a stage edge, on either side of it, so a pointer that overshoots slightly mid-drag still counts. A corner (near two edges) wins over an edge. The top edge means `maximize`. `zones: "halves"` never returns a corner, `"quarters"` never returns an edge, and `"off"`/`false` or `edges: false` always return `null`. |
| `snapZoneRect(stage, zone)` | The placement for a zone: the whole stage, a half or a quarter. It returns `null` for an unknown zone. |
| `magnetize(rect, others, { magnet = 8 }?)` | Magnetism for a **move**. The rect is translated so its left/right edges (and, independently, its top/bottom edges) snap onto the nearest matching edge among `others` within `magnet` px. Include the stage rect in `others` for the stage to attract; exclude the window being moved. `magnet: 0` disables it. |
| `magnetizeResize(rect, others, edge = "se", { magnet = 8 }?)` | Magnetism for a **resize**: only the dragged edge(s) snap. Width and height never go negative. |
