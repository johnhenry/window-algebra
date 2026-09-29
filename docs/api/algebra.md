# Layout algebra

[API reference](./README.md) › Layout algebra

Eleven primitives build an immutable, JSON-serializable presentation tree. The rule of the grammar: **every container and modifier takes an options object first**, then its child or children. `view(id)` is the only exception. Sources: `src/algebra/nodes.mjs`, `src/algebra/transforms.mjs`. The same exports are available from `@johnhenry/window-algebra/algebra` and `/transforms`.

## Contents

- [Node shapes](#node-shapes)
- [Leaf: `view`](#viewid)
- [Containers](#containers): `row`, `column`, `grid`, `stack`, `overlay`
- [Modifiers](#modifiers): `place`, `size`, `gap`, `inset`, `anchor`
- [Generic constructors and guards](#generic-constructors-and-guards)
- [Validation and JSON](#validation-and-json)
- [Transforms](#transforms)

## Node shapes

```js
{ type: "view", id }                                    // leaf
{ type: "row" | "column" | "grid" | "stack" | "overlay", options, children: Node[] }
{ type: "place" | "size" | "gap" | "inset" | "anchor", options, child: Node }
```

Every node a constructor returns is **deep-frozen**. `options` is shallow-copied from what you pass. Constructors validate eagerly and **throw `TypeError`** on misuse (see [Errors](./errors.md)).

| Kind list | Value |
| --- | --- |
| `CONTAINER_KINDS` | `["row", "column", "grid", "stack", "overlay"]` |
| `MODIFIER_KINDS` | `["place", "size", "gap", "inset", "anchor"]` |
| `NODE_KINDS` | `["view", ...CONTAINER_KINDS, ...MODIFIER_KINDS]` |

The CSS each node becomes is documented in [compile and CSS](./compile.md#css-mapping).

## `view(id)`

A presentation of a window or surface. `id` must be a non-empty string (`TypeError` otherwise). The same id may appear more than once: the first occurrence is the primary view and receives the surface, and later ones are rendered as non-primary projections.

## Containers

`children` may be passed as separate arguments or nested arrays (flattened to any depth). `null`, `undefined` and `false` entries are dropped, so `row({}, cond && view("a"))` works. Every remaining child must be a node.

### `row(options, ...children)` / `column(options, ...children)`

Horizontal / vertical composition (flexbox).

| Option | Meaning |
| --- | --- |
| `align` | Cross-axis alignment of children: `"start"`, `"center"`, `"end"`, `"stretch"` or any `align-items` value. |
| `distribute` | Main-axis distribution: any `justify-content` value (`"space-between"`, …). |
| `wrap` | `true` → `flex-wrap: wrap`. |
| `resize` | `{ path, weights }`, set by resizable layouts. It makes `compile` render a splitter between each pair of children (see [Split sizing](./layouts.md#split-sizing)). Hand-built trees normally omit it. |

Children fill the main axis equally (`flex: 1 1 0`) unless a `size` modifier says otherwise.

### `grid(options, ...children)`

A two-dimensional constraint space (CSS Grid).

| Option | Meaning |
| --- | --- |
| `columns`, `rows` | A number `n` → `repeat(n, minmax(0, 1fr))`; an array → tracks (numbers become `fr`, strings pass through); an object `{ repeat = "auto-fit", min = 300, max = "1fr" }` → `repeat(repeat, minmax(min, max))`; a string passes through. |
| `areas` | `grid-template-areas`: an array of row strings, or one newline-separated string. |
| `autoFlow` | `grid-auto-flow`. |
| `autoRows` | `grid-auto-rows`, same syntax as `rows`. |

Place children into cells with `place({ area | row | column })`.

### `stack(options, ...children)`

Children share one allocation, and one is shown at a time.

| Option | Meaning |
| --- | --- |
| `active` | The view id to show. A child is active if it *contains* that view. With `active` omitted, every child is shown (stacked). Inactive children stay mounted but get `visibility: hidden`, `inert` and `aria-hidden`. |
| `chrome` | `"tabs"` renders a tab strip (`wm-tabs`, `role="tablist"`) above the stack, with one button per child, labelled by the first view in that child. |

### `overlay(options, ...children)`

Children occupy independent layers of the same region. Later children are higher. There are no options. `derive` always returns an `overlay` at the root.

## Modifiers

Each modifier wraps exactly one child node. Several modifiers stacked on one element all apply to that element (modifiers produce no DOM of their own).

### `place(options, child)`

Position within the parent's allocation. It is interpreted by the parent's kind.

| Option | Applies | Meaning |
| --- | --- | --- |
| `area`, `row`, `column` | parent is `grid` | `grid-area`, `grid-row`, `grid-column` |
| `align` | parent is `row`/`column` | `align-self` |
| `x`, `y` | any | `"start"`/`"center"`/`"end"`/`"stretch"` → `justify-self`/`align-self`. A number or any other string → absolute positioning with `translate: x y` (px for numbers). |
| `top`, `right`, `bottom`, `left` | any | Absolute positioning at these insets (numbers in px). |

### `size(options, child)`

Allocation constraints.

| Option | Meaning |
| --- | --- |
| `weight` | Share of the parent row/column's main axis (`flex: weight 1 0`). |
| `width`, `height` | A fixed extent. Numbers are px; `"content"` → `max-content`; `"min-content"`, `"max-content"` and `"fit-content"` pass through; any other string passes through. On the parent's main axis it also sets `flex: 0 0 auto`. An axis sized by its content stops the view from being a size container on that axis (see [compile](./compile.md#views)). |
| `min`, `max` | `min-`/`max-` of the parent's main axis (flex parents only). |
| `preferred` | `flex-basis`; `flex: 1 1 preferred` when no `weight` is given. |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | The corresponding CSS properties. |
| `aspectRatio` | CSS `aspect-ratio`. |

### `gap(options, child)`

Separation between the wrapped container's children. A number is shorthand for `{ all: n }`. It has no effect on a view.

| Option | Meaning |
| --- | --- |
| `all` | `gap` |
| `row`, `column` | `row-gap`, `column-gap` (used when `all` and `inner`/`outer` are absent) |
| `inner`, `outer` | `gap` and `padding` (when either is present, `all`/`row`/`column` are ignored) |

### `inset(options, child)`

Padding around the wrapped allocation. A number is shorthand for `{ all: n }`. Options: `all`, or `top`/`right`/`bottom`/`left`, with `x`/`y` as fallbacks for the horizontal/vertical pairs.

### `anchor(options, child)`

Position the child relative to another view with CSS anchor positioning (or the JS fallback). `to` is **required** (`TypeError` otherwise).

| Option | Meaning |
| --- | --- |
| `to` | The view id to anchor against. |
| `side` | `"top"`/`"bottom"`/`"left"`/`"right"`: attach outside that edge of the anchor (side-attached form). |
| `align` | `"start"`/`"center"`/`"end"` along the cross axis (default `"center"`). |
| `offset` | The gap in px between the anchor edge and the popup. |
| `inside`, `x`, `y` | The inside form: `inside: true`, or `x`/`y` without `side`. The child is placed inside the anchor and aligned by `x`/`y` (`"start"`/`"center"`/`"end"`). |
| `gravity` | Which way the popup grows from its attach point (default: `side`). A value on the other axis falls back to `side`. |
| `flip` | Axes (`["x","y"]` subset) allowed to flip to the opposite side or alignment instead of overflowing. **The default depends on the path.** Under native CSS anchor positioning an omitted `flip` means both axes. Under the JS anchor fallback (and when calling `positionPopup` directly) it means neither. Pass `flip` explicitly if you need the same behaviour everywhere. |
| `slide` | Axes allowed to translate back into the stage. Default: neither. **JS fallback only.** |
| `resize` | Axes allowed to shrink to fit the stage. Default: neither. **JS fallback only.** |

The placement math is [`positionPopup`](./geometry.md#positionpopupanchorrect-popupsize-stage-options). Which parts CSS can express is described in [compile › Anchors](./compile.md#anchors).

## Generic constructors and guards

| Export | Description |
| --- | --- |
| `container(kind, options, children)` | The generic container constructor that the named ones call (`children` is an array). It throws on an unknown kind. |
| `modifier(kind, options, child)` | The generic modifier constructor. It accepts a number as `options` for `gap`/`inset`. It throws on an unknown kind. |
| `isNode(value)` | A plain object whose `type` is in `NODE_KINDS`. |
| `isContainer(node)`, `isModifier(node)`, `isView(node)` | Kind checks (each implies `isNode`). |

## Validation and JSON

| Export | Description |
| --- | --- |
| `validate(tree)` | Checks an arbitrary value (for example parsed JSON). Returns `{ ok: true }` or `{ ok: false, errors: [{ path, message }] }`, with paths like `$.children[1].child`. It checks node kinds, view ids, container `children` arrays, modifier `options`, and `anchor`'s `options.to`. It never throws. |
| `fromJSON(json)` | Accepts a string or an object, validates it, and returns a deep-frozen `structuredClone`. It **throws `TypeError`** listing every error for an invalid tree, and `SyntaxError` for invalid JSON text. |

Trees round-trip: `fromJSON(JSON.stringify(tree))` is structurally equal to `tree`.

## Transforms

Ordinary functions over trees. Each returns a new valid tree (or a value derived from one) and never mutates.

| Export | Description |
| --- | --- |
| `transform(tree, fn)` | A bottom-up structural map. `fn(node, path)` receives each node **after** its children were mapped and returns a replacement (or the node itself). Returning `null` removes the node from its parent container; a modifier whose child was removed disappears with it. It throws `TypeError` if `tree` is not a node. |
| `walk(tree, fn)` | Depth-first pre-order traversal: `fn(node, path, parent)`. |
| `fold(tree, fn, initial)` | Reduces over every node in pre-order: `fn(acc, node, path, parent)`. |
| `views(tree)` | View ids in document order, duplicates preserved. |
| `find(tree, predicate)` | The first node (pre-order) matching a predicate function, or the view with that id when `predicate` is a string. Returns `undefined` when there is no match. |
| `mapViews(tree, fn)` | Maps every view through `fn(view) → node`. |
| `replace(tree, predicate, replacement)` | Replaces nodes matching `predicate` (a function or a view id) with `replacement` (a node, or `fn(node) → node`). |
| `remove(tree, id)` | Removes every occurrence of a view. Modifiers wrapping it go too; containers left empty are kept. |
| `mirror(tree)` | Reverses the children of every `row` (left-right reflection). Columns and grids are unchanged. |
| `flip(tree)` | Reverses the children of every `column` (top-bottom reflection). |
| `rotate(tree)` | A quarter turn: every `row` becomes a `column` and vice versa, keeping options. |
| `reverse(tree)` | Reverses the children of every container. |
| `swap(tree, a, b)` | Swaps two view ids wherever they appear. |
| `count(tree)` | The number of nodes. |
| `equals(a, b)` | Structural equality (`JSON.stringify` comparison, so option key order matters). |

The layout modifiers `mirror`, `reflect-x` and `reflect-y` are built on `rotate`, `mirror` and `flip` respectively. See [Layouts › Modifiers](./layouts.md#layout-modifiers).
