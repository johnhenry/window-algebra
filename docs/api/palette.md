# Command palette

[API reference](./README.md) › Command palette

Commands are data, so a palette is a catalog plus a filter plus a UI. The catalog and fuzzy matching are pure (exported from the root entry and tested in Node); `createPalette` is the UI (exported from `@johnhenry/window-algebra/browser`), and `<wa-palette>` / `attachStage({ palette })` wrap it. Sources: `src/palette/catalog.mjs`, `src/browser/palette.mjs`.

```js
import { createPalette } from "@johnhenry/window-algebra/browser";

const palette = createPalette({ wm });   // Ctrl/Cmd+Shift+P opens it
palette.open({ query: "close" });
```

## What it does

1. **Lists** the commands that make sense for the current state (no "Close window" with no windows, no "Switch workspace" with one workspace, "Pop window back in" only when something is popped out, ...), grouped and named for people, not as `window/close`.
2. **Filters** them by fuzzy text. The title is matched first (a contiguous phrase beats a scattered match, word starts and runs score higher, a shorter title beats a longer one), then the keywords, group and command type read together as one text, in that order (so "new window" finds *Open window*, whose keywords are "new add"). The matched letters are highlighted.
3. **Prompts** for the payload fields of the chosen command, one at a time: windows, workspaces, outputs, enums, booleans and layouts as a list you can filter (the focused window first, the active workspace and a field's declared default preselected), the rest as text (a fresh id is pre-filled; numbers and JSON are validated; an optional field can be skipped with Enter).
4. **Dispatches** `wm.dispatch(command)`. A rejected command keeps the palette open on its last field with the reason (`Not done: duplicate-id`), so it can be corrected.

## Keyboard and accessibility

The WAI-ARIA 1.2 **editable combobox with a listbox popup**, inside a modal dialog:

| Element | ARIA |
| --- | --- |
| the dialog | `role="dialog"`, `aria-modal="true"`, named by its heading (which shows the command and field being asked) |
| the input | `role="combobox"`, `aria-autocomplete="list"`, `aria-haspopup="listbox"`, `aria-expanded` (false when there is no list, as for a text field or no matches), `aria-controls` (the listbox), `aria-activedescendant` (the highlighted option), an `aria-label` that is the current prompt |
| the list | `role="listbox"`; each row `role="option"` with `aria-selected` on the highlighted one. DOM focus never leaves the input. An empty list is hidden (a listbox must hold options) and a "no matching commands" line takes its place |
| a live region | `role="status"`, `aria-live="polite"`: the result count, "no matching commands", and the outcome |
| the error line | `role="alert"` |

| Key | Does |
| --- | --- |
| Ctrl/Cmd+Shift+P (configurable) | opens, and closes |
| <kbd>↓</kbd> / <kbd>↑</kbd> | move the highlight, wrapping |
| <kbd>PageDown</kbd> / <kbd>PageUp</kbd> | move by five |
| <kbd>Enter</kbd> | choose the highlighted option, or submit the typed answer |
| <kbd>Escape</kbd> | step back one field, then to the command list, then close |
| <kbd>Backspace</kbd> on empty input | step back |
| <kbd>Tab</kbd> / <kbd>Shift+Tab</kbd> | kept inside the dialog (the input is its only stop) |
| a press on the backdrop | closes |

Focus moves into the input on open and returns to the element that had it on close (`restoreFocus: false` to opt out).

## `createPalette(options)`

| Option | Description |
| --- | --- |
| `wm` | Required. The window manager the commands run on. |
| `shortcut` | `"Mod+Shift+P"` by default; a string, a list of strings, or `false` for none (use `open()`). `Mod` is Ctrl **or** Cmd; `Ctrl`, `Meta`/`Cmd`, `Alt`, `Shift` match exactly; the last part is the key (case-insensitive, `Space` allowed). The listener is on the document, capture phase. Some browsers reserve a few chords (Firefox uses Ctrl+Shift+P for a private window on some platforms): pick another with this option. |
| `host` | Where the dialog is mounted (default `document.body`; it is `position: fixed`). |
| `document` | Default `host.ownerDocument` or the global document. |
| `catalog` | Extra or replacement entries, `{ "my/command": { title, group, fields, requires?, keywords? } }`, merged over `COMMAND_CATALOG`. Combine with `extensions` on the manager to expose your own commands. |
| `exclude` | Command types to hide. |
| `layouts` | Extra layout type names to offer in layout fields (the manager's custom layouts). |
| `popouts` | An `attachPopouts` handle. With it, "Pop window out/in" open and close the real browser window; without it they only change state. |
| `labels` | Strings for translation: `title`, `input`, `placeholder`, `empty`, `hint`, and the functions `count(n)`, `options(n)`, `done(title)`, `rejected(reason)`. |
| `restoreFocus` | Default `true`. |
| `injectStyles` | Default `true`: add `THEME_CSS` and `PALETTE_CSS` once to `document.head` (`style[data-wm-palette-style]`). With `false`, supply the rules yourself; they read only `--wa-*` [theme tokens](./theming.md). |

Returns `{ open({ query }?), close(), toggle(), isOpen, element, detach() }`. `element` is the backdrop (`[data-wm-palette-backdrop]`).

`parseShortcut(shortcut)` and `matchesShortcut(parsed, keydownEvent)` are exported for custom bindings.

## The catalog (pure)

| Export | Description |
| --- | --- |
| `COMMAND_CATALOG` | `{ [type]: { title, group, fields, requires?, keywords? } }`, one entry for **each of the 58 built-in commands**; a test keeps it equal to `COMMANDS`. |
| `paletteEntries(state, { query, exclude, catalog }?)` | The available entries, filtered and ranked: `{ type, title, group, fields, keywords, score, ranges }` (`ranges` index into `title`). |
| `fuzzyMatch(query, text)` | `{ score, ranges }` or `null`. Case-insensitive, spaces in the query ignored. |
| `REQUIREMENTS`, `isAvailable(state, type)` | The `requires` tokens (`window`, `windows2`, `focus`, `urgent`, `floating`, `tiled`, `restorable`, `poppedOut`, `scratchpad`, `workspace`, `workspaces2`, `outputs2`) and whether a command is available. |
| `fieldChoices(state, field, { layouts }?)` | `{ value, label, detail }` choices for a list field, or `null` for a text field. |
| `defaultValue(state, field)` | The suggested answer: the focused window, a fresh id, the active workspace, the field's `default`. |
| `parseField(field, input)` | `{ ok, value }`, `{ ok, skip }` (empty optional text) or `{ ok: false, error }`. |
| `buildCommand(type, values)` | The command object; a `spread` field (`config/set`'s JSON patch) merges into it. |
| `isTextField(field)` | Whether a field takes typed text. |

A field is `{ name, kind, label, optional?, ask?, ... }`: `kind` is `window`, `workspace`, `output`, `new` (a fresh id), `text`, `number`, `boolean`, `choice` (`choices`), `layout` (sent as `{ type }`), or `json` (`spread: true` merges the object into the command). Optional fields are asked only when `ask` is set; the rest are left to the command's defaults.

## What it does not do

- It lists commands, not their targets: "Close window" then picks the window, there is no "Close Editor" entry per window.
- Fields it asks about are the common ones. `window/create` asks for an id and a title, not `role`, `parent` or `placement`; `layout/set` takes a layout type, not its options (a spec such as `{ type: "master-stack", ratio: 0.6 }` needs `layout/set` from code, or a catalog entry with a `json` field); `window/set-constraints` and `config/set` take JSON.
- `window/pop-out` only opens a real window when you pass `popouts`.
- The pointer-driven commands (`window/drop`, `layout/resize-split`) are there for completeness; the palette cannot show their geometry.
