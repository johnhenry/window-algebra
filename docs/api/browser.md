# Browser adapters

[API reference](./README.md) › Browser adapters

The effectful edge. Everything here is exported from `@johnhenry/window-algebra/browser`. Importing it touches no DOM; calling the functions does. Sources: `src/browser/dom.mjs`, `input.mjs`, `chrome.mjs`, `surface.mjs`, `scheduler.mjs`, `popouts.mjs`.

## Contents

- [createDomRenderer](#createdomrendereroptions)
- [attachInput](#attachinputoptions)
  - [Markup contract](#markup-contract)
  - [Pointer behaviour](#pointer-behaviour)
  - [Touch and pen](#touch-and-pen)
  - [Right-to-left](#right-to-left)
  - [Keyboard](#keyboard)
  - [Focus sync](#focus-sync)
  - [Announcements](#announcements)
  - [Attributes it sets](#attributes-it-sets)
- [Window chrome](#window-chrome) (`chrome`, `chromeSurface`)
- [Surfaces](#surfaces)
- [Schedulers](#schedulers)
- [attachPopouts](#attachpopouts)
- [attachSync](./sync.md) (cross-tab sync, its own page)
- [createPalette](./palette.md) (the command palette, its own page)

## `createDomRenderer(options)`

```js
createDomRenderer({
  root,                 // host Element; the render tree is mounted inside it (it gets data-wm-root)
  surfaceFor,           // (id) => surface | undefined, default () => undefined
  document,             // default root.ownerDocument
  anchorFallback,       // boolean; default: true where CSS.supports("anchor-name: --x") is false
  animate,              // false | true | { duration?: number(ms) | string, easing?: string }
  chrome,               // false | true | { buttons, icon, icons, labels, for }: built-in window chrome, see below
}) → renderer
```

It reconciles a render tree into real DOM:

- **Keyed.** Elements are keyed by render-tree key. View elements are keyed by window id, so a window keeps its element **and its mounted surface** when the layout changes around it. A key whose tag changes gets a fresh element.
- **Diffed.** Styles are diffed per property and attributes per name. Tab text is updated in place.
- **Top-down and state-preserving.** Each element is placed in its already-connected parent before its children are reconciled, so a view moving into a brand-new container never leaves the document. Moves use `parent.moveBefore()` where the browser supports it, so an iframe does not reload and focus and playing media survive. Otherwise they fall back to `insertBefore`. Stale elements are swept only after every view has had the chance to move.
- **Surfaces.** `surfaceFor(id).mount(viewElement)` (with [`chrome`](#window-chrome), the chrome body instead) is called once, the first time a primary view appears; `unmount()` is called when it disappears. Projections never get a surface.
- **Blocked views.** For a view with `data-wm-blocked`, every child element of the view gets `inert`. The view itself stays hit-testable, so a click on a window behind a modal is redirected (by `attachInput`) instead of falling through to the window underneath.

| Member | Description |
| --- | --- |
| `root` | The host element. |
| `commit(renderTree, { immediate = false }?)` | Applies a render tree. With `animate`, it runs inside `document.startViewTransition` unless `immediate` is set, a transition is already in flight (rapid commits coalesce), the browser lacks View Transitions, or `prefers-reduced-motion: reduce` matches. |
| `measure()` | `{ [id]: rect }` for every primary view, relative to `root`. |
| `elementFor(id)` | The view element for a window id, if rendered. |
| `bodyFor(id)` | Where a view's content mounts: its chrome body when `chrome` is on (and the window has chrome), else the view element. |
| `anchorFallback` | Whether anchored elements are positioned by JS. |
| `reposition()` | Re-runs the JS anchor fallback (for example after content changed size without a commit). With the fallback on, a `ResizeObserver` on `root` also triggers it. |
| `animate` (getter), `setAnimate(value)` | Whether animation is configured, and a way to turn it on or off or reconfigure `duration`/`easing` later. |
| `release(id)` | Detaches a view's element from the renderer's bookkeeping **without** touching the DOM or unmounting its surface, and returns `{ element, surface }` (or `undefined`). The next commit neither recreates nor sweeps it. Used by pop-outs. |
| `adopt(id, element, surface?)` | The reverse: re-registers the element (and its still-mounted surface) so the next commit reuses and re-patches it instead of mounting a fresh surface. |
| `destroy()` | Unmounts every surface, removes every element, and disconnects the observer. |
| `styleOf(key)` | Debug helper: the inline style text recorded for a key. |

**The JS anchor fallback.** With `anchorFallback`, the native anchor declarations are stripped and each anchored element is positioned with `left`/`top` computed from measured rects. Side-anchored elements run the full [`positionPopup`](./geometry.md#positionpopupanchorrect-popupsize-stage-options), including `slide` and `resize` (setting `width`/`height` when it shrinks something). Inside-anchored elements are aligned by `justify-self`/`align-self`. Coordinates and sizes it set are cleared when an element stops being anchored.

**Animation.** Every primary view gets a unique `view-transition-name` (`wm-r<renderer#>-<sanitized id>`, unique per document), so each window animates on its own. `duration`/`easing` set `--wa-transition-duration`/`--wa-transition-easing` on the document element, which `BASE_CSS` reads. The manager passes `immediate: true` for commands carrying a `gesture` token or `immediate: true`.

## `attachInput(options)`

Turns pointer and keyboard events inside `root` into commands. The geometry math lives in the pure helpers; this only wires events. It returns a `detach()` function that cancels any gesture in progress, removes every listener, removes its own announcer region and unsubscribes.

```js
attachInput({
  root,                  // required: the renderer's root
  wm,                    // shorthand for getState, dispatch, subscribe, present, simulate, drops
  getState, dispatch,    // required unless wm is given
  subscribe,             // the manager's subscribe: enables focus sync and command announcements
  output,                // bind this adapter to one output's stage (multi-output rigs)
  present,               // (state) => { render }: derive + compile for the drag preview (wm.present)
  simulate,              // (command, state) => { state, events }: dry runs (wm.simulate)
  drops,                 // drop-interpreter registry for finding targets (wm.drops; default DROPS)
  snap,                  // number: snap floating moves to an n-px grid
  threshold: 5,          // px of travel before a press on a tiled handle or a tab becomes a drag
  longPress: 400,        // ms a touch pointer must hold still to start a drag
  modifier: "shift",     // "shift" | "alt" | "ctrl" | "meta": the key for toFloating/toTiled "modifier"
  detachDistance: 24,    // px outside root before toFloating: "threshold" detaches
  dragPreview,           // (ctx) => void: custom preview renderer (replaces the ghost; the zone highlight stays)
  announce,              // true | Element | (message) => void: aria-live narration (opt-in)
  keyboard,              // true | { [combo]: commandType }: keyboard moving and F6 cycling (opt-in)
  splitterStep: 0.05,    // fraction of a pair's total an arrow key nudges a focused splitter by
  floatStep: 10,         // px a keyboard move/resize of a floating window changes it by
  afterRender,           // (task) => void: when to move DOM focus after a focus change (default: next frame)
  touch,                 // true | { pinch, swipe, contextMenu, ... }: touch and pen gestures (opt-in), see below
  popouts,               // an attachPopouts handle: window/pop-out and window/pop-in buttons open and close the real window
}) → detach
```

Pass `wm` (or `present`, `simulate` and `drops` from it) so that previews and targets use your custom layouts, modifiers, extensions and drop interpreters. Without them the adapter falls back to the built-in `derive`/`update`/`DROPS`.

`output`: in a multi-output setup, give each stage its own adapter with `output: "<id>"` (and `present: (s) => wm.present(s, { output })`). Splitter drags, arrow-key resizes and the drag ghost then act on **that stage's** workspace instead of whichever workspace the globally focused output shows.

### Markup contract

Inside a window's surface (the adapter walks up from the event target):

| Attribute | Behaviour |
| --- | --- |
| `data-wm-handle="move"` | Drag to move a floating window, or to drag a tiled window to a new slot (the title bar). |
| `data-wm-handle="resize-<edge>"` | `<edge>` is one of `EDGES` (`n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`). Drag to resize a floating window. |
| `data-wm-command="<type>"` | Click dispatches `{ type, id }`, where `id` is `data-wm-target` if present, else the enclosing view's id. With a `popouts` handle, `window/pop-out` and `window/pop-in` call `popOut(id)` / `popIn(id)` instead. |
| `data-wm-dblclick="<type>"` | Double-click dispatches `{ type, id }` the same way (the chrome's title bar uses `window/toggle-maximize`). A control inside it keeps its own click; a window a modal blocks ignores it. |

Controls inside a handle (`button`, `a`, `input`, `select`, `textarea`, `label`, `[contenteditable]`, `[data-wm-command]`) keep their own click: pressing one never starts a gesture.

Rendered by `compile` (no markup needed): tab buttons (`data-wm-tab`) and splitters (`data-wm-splitter`).

Anywhere on the page (usually a workspace switcher): `data-wm-workspace-target="<workspace id>"`. Dropping a dragged window on it moves the window there (`config.drag.crossWorkspace`).

### Pointer behaviour

- **Press on any window** focuses it (`window/focus`), unless it is already focused. A press on a blocked window only redirects focus (`preventDefault`, no drag).
- **Floating move** (`status: "normal"`): captures the pointer on the handle. Every move dispatches `window/move` with a shared `gesture` token, **magnetized** onto the stage and other visible windows (`config.snap.magnet`). The adapter tracks intent as the pointer moves. With the modifier held (or `config.drag.toTiled: "always"`), hovering a tiled window previews the slot it would take, and release dispatches `window/drop`. Near a stage edge or corner, the snap-zone preview appears, and release dispatches one `window/resize`. Over a workspace target, release moves the window there and restores its position. <kbd>Escape</kbd> or `pointercancel` moves it back (in the same gesture).
- **Floating resize**: `window/resize` per move (with `constrainSize` and magnetism), sharing a gesture token.
- **Tiled drag**: a press on a droppable tiled window's move handle becomes a drag after `threshold` px (touch: after a still `longPress`; moving first hands the gesture back to the browser, and the context menu is suppressed). An overlay (`[data-wm-drag-overlay]`) then covers the stage, which shields iframes from the pointer and holds the preview: the hypothetical next state is rendered through the same derive → compile pipeline into ghost outlines. Constraints are dropped from the ghost so it shows each **slot**, and slots that would violate a window's constraints are outlined red (`data-wm-too-small`). The drop zone is highlighted. With the modifier held (`toFloating: "modifier"`) or outside the stage (`"threshold"`), the preview shows the window floating at the pointer instead. Release dispatches exactly one command: `window/drop` (with a `geometry` estimate when `tooSmall: "reject"`), `window/detach`, or `window/move-to-workspace` (with `follow` from config). <kbd>Escape</kbd> or `pointercancel` aborts. Pressing or releasing the modifier mid-drag updates the preview without moving the pointer.
- **Tab drag**: drag a tab along its strip; an insertion line shows where it lands, and release dispatches `window/drop` with zone `left`/`right` (past the last tab means last).
- **Pinned windows** (`draggable: false`): a press on the move handle or tab marks the view or tab `data-wm-drag-denied` for the press, and nothing moves.
- **Splitters**: a press captures the pointer; each move dispatches `layout/resize-split` with full `weights` and a shared gesture token. It is clamped so neither side crosses the min/max constraints of a single window directly on that side. <kbd>Escape</kbd> restores the original weights in the same gesture.
- While a press or drag is live, the adapter also listens on the document (capture phase), so the pointer may leave the stage (toward a workspace tab) before the threshold. A new `pointerdown` cancels any stale gesture.

### Touch and pen

Everything in [Pointer behaviour](#pointer-behaviour) is pointer-event based, so a finger or a pen drags a floating window (its title bar sets `touch-action: none`), and drags a tiled window or a tab after a still `longPress`. A pen behaves like a mouse for those (a drag starts after `threshold` px). `touch` adds the gestures a mouse has no equivalent for. It is **opt-in**: without it nothing below is recognised, and `pointerType: "mouse"` is never touched by any of it.

```js
attachInput({ root, wm, touch: true });
attachInput({
  root, wm,
  touch: {
    pinch: true,                       // two touches on a floating window resize it
    swipe: { tabs: true, workspaces: false, windows: false },
    contextMenu: (press) => openMenu(press), // true | (press) => void | "window/toggle-floating" | false
    contextDelay: 500,                 // ms held still
    slop: 10,                          // px of drift that cancels a long press
    swipeDistance: 48,                 // px for a tab or window swipe
    workspaceSwipeDistance: 64,        // px for a two-finger workspace swipe
  },
});
```

`touch: true` means `pinch`, `swipe: { tabs: true }` and `contextMenu: true`. `swipe: false` turns every swipe off; `workspaces` and `windows` are off by default because each needs `touch-action: pan-y` on the whole stage.

| Gesture | Pointers | Result |
| --- | --- | --- |
| Pinch | two **touch** pointers on the same floating window (not tiled, blocked, pinned or minimized) | `window/resize` with `x`, `y`, `width`, `height` per move and one shared `gesture` token: one undo step, one log entry. The window scales with the finger distance (honouring `constraints`, never below 48 px) and follows the fingers' midpoint. `pointercancel` puts it back. The pure math is `createPinch`/`updatePinch`. |
| Tab swipe | one touch or pen pointer, a horizontal stroke on a tab strip of at least `swipeDistance` px, mostly horizontal, within 700 ms | `window/focus` on the next tab (swipe left) or previous (swipe right); no wrap. A vertical stroke scrolls as usual. The classifier is `swipeOf`. |
| Window swipe | `swipe.windows`: one touch or pen pointer, a horizontal stroke of at least `swipeDistance` px, mostly horizontal, within 700 ms, that starts on a tiled window of a `monocle` or `tabs` layout | `window/focus` on the next window of the stack (swipe left) or the previous one (swipe right); no wrap. Strokes that start in a text field, `select`, `contenteditable`, a handle or splitter, or in a horizontally scrolling element, are left to the page. Layouts that show several windows (columns, master-stack, ...) ignore it. |
| Workspace swipe | two **touch** pointers, a horizontal stroke of the midpoint of at least `workspaceSwipeDistance` px (when they are not a pinch) | `workspace/activate` on the next (swipe left) or previous workspace of the stage's output; no wrap. |
| Long press | one touch or pen pointer held still for `contextDelay` ms on a window (not on a control, tab or splitter) | `contextMenu`: `true` dispatches a bubbling `wm-contextmenu` event on the window element (`detail` is the press); a function is called with `{ id, x, y, clientX, clientY, pointerType, target }` (`x`/`y` are relative to `root`); a string is a command type dispatched as `{ type, id }`. The native context menu that follows is suppressed. A held press on a floating title bar cancels its (unmoved) move first; on a **tiled** title bar it still starts a drag, as before, and does not fire. |

A second finger always ends a single-finger gesture in progress (a floating move is put back, a drag cancelled), then starts a pinch if both fingers are on one floating window, else a workspace swipe if enabled.

**`touch-action`.** The browser decides which touch gestures it keeps by `touch-action` on the touched element and its ancestors, so each gesture needs its own. The adapter sets `data-wm-touch` on `root` (tokens `pinch`, `swipe-tabs`, `swipe-workspaces`, `swipe-windows`, `context`), and `BASE_CSS` maps them: floating windows get `touch-action: none` (pinch), tab strips `pan-y` (horizontal strokes are the page's, vertical ones scroll), the stage `pan-y` for workspace and window swipes, windows `-webkit-touch-callout: none` (long press). Handles and splitters are always `touch-action: none`. Without `BASE_CSS`, set the same rules yourself. The costs: with `pinch`, a floating window's own content cannot be panned by touch; with `swipe.workspaces`, nothing inside the stage scrolls horizontally by touch. `swipe.windows` needs `pan-y` on the stage too, and a `pan-y` set only on the stage does not reach a touch that starts inside a scroller, so give the app's own vertical scrollers `touch-action: pan-y` as well. `BASE_CSS` sets it on `wm-view`, and `CHROME_CSS` on the chrome's scrolling body (`.wa-chrome-body`).

Under `config.direction: "rtl"` swipes mirror: swiping toward the inline-start edge (right) goes to the next tab, window or workspace.

### Right-to-left

With `config.direction: "rtl"` (see [Layouts › Right-to-left](./layouts.md#right-to-left)) the adapter works in screen terms, so every gesture does what it looks like:

| Interaction | In RTL |
| --- | --- |
| Floating move, resize, snap zones, magnetism, detach, pinch | pointer positions are physical, a window's `x` is measured from the right edge. Gestures run in screen coordinates and are mirrored (`x' = stage width - x - width`) on the way in and out, so the window follows the pointer; the snap preview and the resulting placement cover the same screen half |
| Drop zones, the drop line, the tab-drag insertion point | the screen-left half of a target is the *later* side of it; the preview is drawn where the pointer is |
| <kbd>←</kbd> <kbd>→</kbd> on a focused tab | swapped (WAI-ARIA: in a right-to-left tab list the left arrow goes to the next tab); <kbd>↑</kbd> <kbd>↓</kbd>, <kbd>Home</kbd>, <kbd>End</kbd> unchanged |
| Arrow keys on a focused splitter | swapped: the first pane is on the right, so the right arrow shrinks it. Dragging the splitter right shrinks it too |
| `DEFAULT_MOVE_KEYS` and a custom `keyboard` map | the left and right arrows are swapped when looked up, so <kbd>Alt+Shift+←</kbd> still moves the window left on screen (later in layout order). The map itself is written for left-to-right |
| <kbd>Alt+Shift+←/→</kbd> and <kbd>Ctrl+Alt+Shift+←/→</kbd> on a floating window | the window moves toward the arrow, and the arrow resizes toward itself (`placement.x` and `width` change the other way) |
| Swipes (`touch`) | swiping toward the inline-start edge (right) goes to the next tab or workspace |

**Following the page's `dir`.** `attachDirection({ wm, element })` (also on `attachStage` as `direction: "auto"`, the default) reads an explicit `dir` on the stage or any ancestor, or a computed `direction: rtl`, dispatches `config/set { direction }` when it differs, and watches `dir` changes with a `MutationObserver`. A page with **no** `dir` says nothing, so `createState({ config: { direction: "rtl" } })` still works. `pageDirection(element)` is the pure read (`"rtl"`, `"ltr"` or `undefined`). `attachStage` also takes `direction: "ltr" | "rtl"` (set once) or `false` (never touch it). Cross-tab sync keeps the direction per tab (it is neither sent nor applied).

### Keyboard

| Keys | Condition | Command |
| --- | --- | --- |
| Arrow along a focused splitter's axis | always | `layout/resize-split`, nudging by `splitterStep` of the pair's total |
| <kbd>←</kbd> <kbd>→</kbd> (and <kbd>↑</kbd> <kbd>↓</kbd>), <kbd>Home</kbd>, <kbd>End</kbd> on a focused tab | always | move focus between the tabs of the strip, wrapping (roving `tabindex`); focus alone does not change the WM focus |
| <kbd>Enter</kbd> / <kbd>Space</kbd> on a focused tab | always | `window/focus` for that tab's window (which also moves focus into its panel) |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+Arrow | `keyboard` truthy, the focused window is floating and normal | `window/move` by `floatStep` px. A tiled window keeps its reorder keys below |
| <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>Shift</kbd>+Arrow | the same | `window/resize` by `floatStep` px (right/down grow, left/up shrink; never below 0) |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | the focused window is modal | trapped: focus wraps within the modal's element (or goes to the element itself if it has nothing focusable) |
| <kbd>F6</kbd> / <kbd>Shift</kbd>+<kbd>F6</kbd> | `keyboard` truthy | `focus/next` / `focus/previous` |
| `DEFAULT_MOVE_KEYS` (or your map) | `keyboard` truthy, a window focused, no drag | the mapped command with `{ id: focused }` |
| <kbd>Escape</kbd> | during a drag, floating move or splitter drag | cancel |

`DEFAULT_MOVE_KEYS`:

| Combo | Command |
| --- | --- |
| `Alt+Shift+ArrowLeft`, `Alt+Shift+ArrowUp` | `window/move-before` |
| `Alt+Shift+ArrowRight`, `Alt+Shift+ArrowDown` | `window/move-after` |
| `Alt+Shift+PageUp` | `window/swap-previous` |
| `Alt+Shift+PageDown` | `window/swap-next` |

Combos are built as `Ctrl+Meta+Alt+Shift+<event.key>` (in that order, present modifiers only). Keyboard handling only sees keys pressed while focus is inside `root`. <kbd>Escape</kbd> for transient windows (menus, popovers) is left to the application: bind it to `wm.close(id)` yourself.

### Focus sync

With `subscribe` (or `wm`):

- **WM → DOM.** After a `window/focused` event, on the next frame (or `afterRender`), DOM focus moves into that window: first to the element last focused inside it, otherwise to the view itself (given `tabindex="-1"`). It never takes focus from a text field, select or `contenteditable` element **outside** `root`.
- **DOM → WM.** In both modes, keyboard focus entering a window (<kbd>Tab</kbd>, a scripted `.focus()`) dispatches `window/focus` (unless the window is blocked), so it is raised just as a click raises it.

### Announcements

With `announce` (`true` creates a visually hidden `role="status"` `aria-live="polite"` region inside `root`; an element is used as the region; a function receives each message), the adapter narrates drag start ("Dragging Editor. Escape cancels."), the current target ("Release to move before Terminal.", "Release to snap left."), the result ("Editor moved before Terminal.") and cancellation. For commands it dispatches, or every command when `subscribe` is given, it also narrates `window/focused`, `window/created`, `window/closed`, `window/swapped`, `window/reordered`, `window/detached` and `window/workspace-changed`, naming windows by title (it remembers titles, so a closed window is still named).

### Attributes it sets

| Attribute | On | Meaning |
| --- | --- | --- |
| `data-wm-dragging` | `root` | a tiled or tab drag is active |
| `data-wm-drag-source` | the dragged view or tab | |
| `data-wm-drag-overlay` | overlay div in `root` | shield and preview host (`z-index: 2147483000`) |
| `data-wm-drag-ghost`, `data-wm-ghost`, `data-wm-ghost-label` | ghost host and ghost views | the preview (`data-wm-ghost="dragged"` for the dragged window) |
| `data-wm-too-small` | ghost view | a slot violates that window's constraints |
| `data-wm-drop-zone` (+ `data-zone`, `data-op`, `data-target`) | zone div | the highlighted zone (`data-op="snap"` for snap zones) |
| `data-wm-drop-line` | line div | the tab insertion line |
| `data-wm-drop-active` | a workspace target | hovered during a drag |
| `data-wm-drag-denied` | view or tab | a press on a pinned window |
| `data-wm-active` | splitter | being dragged |
| `data-wm-announcer` | the region it created | |

If `root` is `position: static`, it is set to `position: relative` when the first drag overlay is created.

## Window chrome

Opt-in. Every app that draws windows needs the same parts: a title bar with a title and buttons, a drag handle, resize grips. `chrome` ships them, built on the markup contract below, so there is nothing to re-implement.

```js
createDomRenderer({ root, surfaceFor, chrome: true });
createDomRenderer({ root, surfaceFor, chrome: { buttons: ["minimize", "maximize", "float", "popout", "close"] } });
// <wa-stage>.configure({ wm, surfaceFor, chrome }) and attachStage(host, { chrome }) take the same option
```

`chrome` is `true` or an object:

| Option | Description |
| --- | --- |
| `buttons` | Which buttons, in order: an array of `CHROME_BUTTONS` (`"minimize"`, `"maximize"`, `"float"`, `"popout"`, `"close"`), or `(id) => array` for per-window sets. Default `DEFAULT_CHROME_BUTTONS`: `minimize`, `maximize`, `float`, `close`. An unknown name throws. |
| `icon` | `(id) => Node \| string \| null`: the icon slot at the start of the bar (text is set as text, never as HTML). |
| `icons` | A glyph per action (`close`, `maximize`, `restore`, `float`, `dock`, `popout`, `popin`, `minimize`), text or a node, replacing the default characters. |
| `labels` | Accessible names per action, plus `actions` for the button group. Defaults are `DEFAULT_CHROME_LABELS` ("Close window", ...). Use it to translate. |
| `for` | `(id) => boolean`: return `false` to leave a window bare (a tooltip, a toast, a menu). Its surface then mounts straight into the view. |

**What a window gets.** Inside its view element (`wm-view`), `[data-wa-chrome]` holds:

- the **title bar**, `[data-wm-handle="move"]` with `data-wm-dblclick="window/toggle-maximize"`: the icon slot (`[data-wa-chrome-icon]`), the title (`[data-wa-chrome-title]`, kept in step with the window's title on every commit; an untitled window shows its id) and a `role="group"` of buttons;
- the **body**, `[data-wa-chrome-body]`, where the window's surface mounts (`renderer.bodyFor(id)` returns it, or the view element when there is no chrome);
- **eight resize grips**, `[data-wm-handle="resize-n"]` and so on.

**Buttons.** Each is a real `<button type="button">` with a `data-wm-command` (so `attachInput` dispatches it) and `data-action`. A toggle is two buttons and CSS shows one, from the `data-mode` and `data-status` attributes `compile` writes on the view: `maximize` / `restore` (`window/maximize`, `window/restore`), `float` / `dock` (`window/toggle-floating`), `popout` / `popin` (`window/pop-out`, `window/pop-in`). Nothing is relabelled in JavaScript, which is also why the chrome keeps working in a pop-out window, where no renderer updates it. Accessible names include the title ("Close window: Editor"). When a toggle hides the button that was pressed, focus moves to its counterpart once the change has rendered, so a keyboard user is not left on nothing. The **pop-out** button needs a pop-out handle: `attachStage` creates one by itself when `buttons` lists `"popout"` (and exposes it as `stage.popouts`); with your own wiring pass `attachInput({ popouts })`. Without one it only dispatches `window/pop-out`.

**Behaviour.**

- **Drag and resize** are the pointer adapter's: the bar moves a floating window (or drags a tiled one after the threshold or a long press), a grip resizes it. The grips show only while the window floats and is not maximized, minimized or popped out.
- **Double-click** the bar maximizes, and again restores. A control inside the bar keeps its own click; a window a modal blocks ignores it.
- **Tab strips.** A window that is a tab panel (`stack` with `chrome: "tabs"`) gets no title bar, since its tab is its title; the bar returns when the layout changes.
- **Scrolling.** A body that scrolls becomes a focusable, labelled region (`tabindex="0"`, `role="region"`, `aria-labelledby` the title), as axe's `scrollable-region-focusable` requires; one that fits is not a tab stop. This is re-evaluated on every commit, when the body resizes, when any child of the body (what the surface mounted) changes size, and (coalesced to one check per frame) when anything inside the body is added, removed, retexted or has its `style`, `class`, `hidden`, `width` or `height` changed, so content that renders late is covered, including rows added inside a child of fixed height (`height: 100%`) whose box never changes. Open shadow roots of the body's direct children are watched too. Not seen: layout changes that mutate nothing in the body (a stylesheet rule that toggles, an image or font that finishes loading inside a fixed-height child) and shadow roots nested deeper than a direct child; those are re-checked at the next commit or body resize.
- **Pop-outs.** In the popup the bar shows pop-in and close, hides the layout buttons and the grips, and follows the window's title.
- **Blocked windows.** A window blocked by a modal has its chrome inert, like the rest of its contents.

**Styling.** `CHROME_CSS` (part of `RULES_CSS` and `BASE_CSS`) reads only `--wa-*` tokens: the title bar uses `--wa-titlebar-*` (`--wa-titlebar-active-bg` for the focused window), the buttons `--wa-color-accent-soft` and `--wa-color-danger`, the focus ring `--wa-focus-ring-*`, and size comes from `--wa-chrome-bar-height`, `--wa-chrome-button-size` and `--wa-chrome-grip-size` (see [Theming](./theming.md)). It uses logical properties, so under `dir="rtl"` the icon and title come first on the right and the buttons sit at the left; only the grips use physical offsets, because `resize-e` names the right edge in both directions. On coarse pointers (touch, pen) the bar and buttons grow to `--wa-chrome-touch-target` (44 px) and the grips to `--wa-chrome-grip-touch`; the bar and grips set `touch-action: none` so a finger drags them instead of scrolling the page. Under `forced-colors` the buttons get a border.

### `chromeSurface(options)`

The same chrome for **one** window, as a surface, for a custom renderer or a hand-built `surfaceFor`. Do not combine it with `createDomRenderer({ chrome })`: that wraps every window itself.

```js
surfaces.set("editor", chromeSurface({
  id: "editor",
  title: "Editor",
  wm,                                      // optional: the title follows state.windows.editor.title
  body: (el) => { el.append(editorElement); return () => {}; },   // or a surface to mount into the body
  buttons: ["maximize", "close"],          // icon, icons, labels as above
}));
```

`buildChrome(doc, { id, title, buttons, icon, icons, labels })` returns the pieces (`{ frame, bar, body, titleId, setTitle, setBarVisible, syncScrollable, dispose }`) and `setChromeTitle(element, title)` retitles chrome (and its buttons' names) in any element, in whichever document it lives. `CHROME_BUTTONS`, `DEFAULT_CHROME_BUTTONS` and `DEFAULT_CHROME_LABELS` are exported too. Source: `src/browser/chrome.mjs`, `src/css/chrome.mjs`. Demo: `demo/chrome.html`.

## Surfaces

A surface is anything that can be displayed inside a view. The window manager never knows which kind it has: it calls `mount(target)` once and `unmount()` when the view goes away. Provide them through `surfaceFor(id)`.

| Export | Description |
| --- | --- |
| `htmlSurface(element)` | Appends an existing element on mount and removes it on unmount. `kind: "html"`. |
| `lazySurface(render)` | Calls `render(target)` on first mount. If it returns a function, that is called on unmount. `kind: "lazy"`. |
| `iframeSurface(src, { document?, attributes? })` | An `htmlSurface` around a new borderless full-size `<iframe>` with the given attributes. |
| `canvasSurface(draw, { document? })` | A full-size `<canvas>` repainted by `draw(canvas, { width, height, ratio })` whenever the view's size changes (`ResizeObserver`; a single paint without one). The backing store is scaled by `devicePixelRatio`. `kind: "canvas"`, and `.canvas` exposes the element. |
| `createSurfaceRegistry(initial?)` | A `surfaceFor` function backed by a `Map`, with `.set(id, surface)` (chainable), `.delete(id)` and `.has(id)`. The renderer asks `surfaceFor` on every commit until it returns a surface. After that it never asks again for as long as the view stays rendered, so replacing a registry entry does not swap a surface that is already mounted. |

## Schedulers

| Export | Description |
| --- | --- |
| `createFrameScheduler(requestFrame?)` | Coalesces commits: many scheduled tasks within a frame run only the **most recent** one, on the next `requestAnimationFrame` (or a 16 ms `setTimeout` without one). Pass it as the manager's `schedule` so a burst of commands produces one DOM commit per frame. |
| `immediateScheduler(task)` | Runs the task immediately (the manager's default; also for tests and server rendering). |

## `attachPopouts`

GoldenLayout/Dockview-style pop-out. It moves a window's live DOM into a real, separate browser window and back again. The pure core only records `status: "popped-out"`; this helper does the browser side.

```js
attachPopouts({
  wm,          // the window manager
  renderer,    // the createDomRenderer whose root holds the views (uses release/adopt/root)
  surfaceFor,  // fallback only, for a minimal renderer without release/adopt
  open,        // (url, name, features) => Window | null; default window.open. Injectable for tests.
}) → { popOut(id, { name?, features? }?), popIn(id), isPoppedOut(id), detach() }
```

**`popOut(id, options?)`**: it dry-runs `window/pop-out` first, so it never opens a popup for a refused command. Then it opens a window (`name` defaults to `wm-popout-<id>`; `features` defaults to `popup,width=<w>,height=<h>` from the window's placement) and sets its title. It copies every `<link rel=stylesheet>` and `<style>` from the page into the popup, `release`s the view's element, `adoptNode`s it into the popup and makes it fill the popup, and dispatches `window/pop-out`. It keeps the popup's title in sync with the window title, and focusing the popup clears the WM focus (`window/blur`): a popped-out window is not on the stage, so it can never be the WM's focused window. It returns `dispatch`'s result, a rejection (`unknown-window`, `blocked`), or `{ events: [command/rejected popup-blocked] }` when `open()` returns a falsy or already-closed window. State and the DOM are untouched in that case. Popping out an already popped-out window returns an empty result.

**`popIn(id)`**: closes the popup, puts back the inline geometry `popOut` took away (`position`, `width`, `height`, `box-sizing`, `flex`, `left`/`top`/`inset`, `grid-area`, `transform`, ...: the values the layout had given the element, since the renderer only re-patches the properties it manages), carries the element back (`adoptNode` + `renderer.adopt`, so the surface was never unmounted) and dispatches `window/pop-in`. The same happens automatically when the popup closes itself (`pagehide`/`beforeunload`).

**Chrome in the popup**: the window's `data-wm-command` buttons move into the popup with it, outside the stage root `attachInput` listens on, so the popup gets the same click delegation: a button dispatches `{ type, id }` (`data-wm-target` overrides `id`), and `window/pop-in` goes through `popIn(id)` so the DOM is carried back. Give a pop-out button `data-wm-command="window/pop-in"` while its window is popped out and it works from inside the popup.

**Other paths**: if the window leaves `"popped-out"` some other way (`window/restore`, undo/redo), the popup is closed and the surface **remounts fresh** in the main document. If the window closes (`window/closed`), the popup closes.

**`isPoppedOut(id)`** reports whether this helper has a popup open for the window. **`detach()`** stops listening and closes every popup without dispatching pop-in.

Most browsers reload an iframe whenever it is adopted into another document, so an iframe surface's state resets on the way out, however it comes back. Other content (inputs, canvases, in-page state) survives the round trip.
