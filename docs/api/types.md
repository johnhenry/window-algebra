# TypeScript types

[API reference](./README.md) › TypeScript types

Every entry point ships declarations, and every `package.json` export has a `types` condition, so `import { update } from "@johnhenry/window-algebra"` is typed with no `@types` package and no build step.

| Import specifier | Declarations |
| --- | --- |
| `@johnhenry/window-algebra` | `src/index.d.mts` |
| `@johnhenry/window-algebra/browser` | `src/browser/index.d.mts` |
| `@johnhenry/window-algebra/algebra` | `src/algebra/nodes.d.mts` |
| `@johnhenry/window-algebra/transforms` | `src/algebra/transforms.d.mts` |
| `@johnhenry/window-algebra/layouts` | `src/layouts/index.d.mts` |
| `@johnhenry/window-algebra/css` | `src/css/compile.d.mts` |
| `@johnhenry/window-algebra/react` | `src/bindings/react.d.mts` |
| `@johnhenry/window-algebra/element` | `src/bindings/element.d.mts` |

They live next to the source (`.d.mts` beside `.mjs`), so `files: ["src"]` already ships them; the shared vocabulary is in `src/types/` (`state`, `commands`, `events`, `tree`, `render`). `moduleResolution` `node16`/`nodenext`/`bundler` read the `exports` map; an older `node10` resolver reads `typesVersions`. The browser entry's types use the DOM lib (`Element`, `Document`); the root entry's do not.

## Commands: a discriminated union

`Command` is a union of 58 interfaces keyed by `type`, each with its exact payload. Narrow it with `switch (command.type)`, and `update`, `wm.dispatch` and every convenience method are checked against it.

```ts
import { update, type Command, type CommandOf, type Event } from "@johnhenry/window-algebra";

const describe = (command: Command): string => {
  switch (command.type) {
    case "window/drop":
      return `${command.id} on ${command.target} (${command.zone})`; // zone: "center" | "left" | ...
    case "config/set":
      return String(command.direction ?? command.gap);               // the patch's fields are the command's
    default:
      return command.type;
  }
};

update(state, { type: "window/close" });                 // error: `id` is required
update(state, { type: "window/drop", id: "a", target: "b", zone: "middle" }); // error: not a DropZone

const close: CommandOf<"window/close"> = { type: "window/close", id: "a" };
```

`CommandType` is the union of the type strings (`COMMANDS` has the same value at runtime); `CommandOf<T>` picks one member. Every command also accepts the manager's `gesture?: string` and `immediate?: boolean`. Per-command payloads, events and rejections are in [Commands](./commands.md).

**Commands of your own.** A custom command is only accepted together with the extensions that handle it, so a typo in a built-in is still an error:

```ts
update(state, { type: "my/ping", n: 1 }, { "my/ping": (s) => ({ state: s }) }); // ok
update(state, { type: "my/ping", n: 1 });                                         // error

type Ping = { type: "my/ping"; n: number };
const wm = createWindowManager<Ping>({ extensions: { "my/ping": (s) => ({ state: s }) } });
wm.dispatch({ type: "my/ping", n: 2 });  // ok
wm.dispatch({ type: "my/pong" });        // error
```

## Events and effects

`Event` is the union of the 47 event interfaces (`UpdateEvent` for those `update` returns, `ManagerEvent` for `history/changed`, `state/loaded`, `state/load-rejected`), with the exact fields documented in [Events](./events.md); `EventOf<"window/focused">` picks one. `Effect` is `{ type: "render" } | { type: "focus"; id: string | null }`. `command/rejected.reason` is a `RejectionReason` (every reason in [Errors](./errors.md)), widened to `string` because an extension may add its own. `update` returns `UpdateResult = { state; events: UpdateEvent[]; effects: Effect[] }`.

## State

`State`, `WindowRecord`, `WorkspaceRecord`, `OutputRecord`, `Config` and friends mirror [State](./state.md). A `LayoutSpec` is a union of the built-in specs (`MasterStackSpec`, `ColumnsSpec`, `BspSpec`, `TreeSpec`, ...) discriminated by `type`, a `CustomLayoutSpec` (any other `type`, for layouts you register) or a `LayoutInterpreter` function. `ConfigInput` is what `createState({ config })` and `config/set` take.

The layout algebra's nodes (`LayoutNode` = `ViewNode | RowNode | ... | AnchorNode`) are `readonly`, as they are deep-frozen at runtime; constructors take options-first and `NodeChild` (nodes, nested arrays, or dropped `null`/`undefined`/`false`).

## The manager

`WindowManager<C>` has every method, getter and convenience helper of [the manager](./manager.md). The type parameter `C` is the union of your own command types (default `never`): `dispatch`, `simulate`, `subscribe` and `log` take `Command | C`.

## Checked in CI

- `npm run test:types` runs `tsc --noEmit` over `test/types/usage.mts`, a typed usage file that imports every entry point the way a consumer would. It also holds `// @ts-expect-error` lines (a wrong zone, a missing `id`, a misspelled field, an unknown command, ...) that **must fail to compile**, so a type that goes loose breaks the build.
- `test/types.test.mjs` keeps the declarations honest: the `Command` union lists exactly `COMMANDS`; the `Event` union lists exactly the events in `docs/api/events.md`; every documented rejection reason is in `RejectionReason`; for each entry point the runtime exports and the declared exports match in both directions (a generated file that touches every runtime export is compiled by `tsc`); and every `package.json` export has a `types` condition pointing at a file that ships.

## Why hand-written

`tsc --declaration --allowJs --emitDeclarationOnly` was tried first. From this JavaScript it produces `any` for nearly everything that matters (`update(state: any, command: any, extensions: any)`), because a command's payload and an event's fields are implicit in the handlers' bodies, so it cannot produce a discriminated union, and it marks optional parameters as required. The JSDoc in the source documents options, not shapes. The declarations are therefore written by hand beside the sources, and the tests above are what keep them from drifting.
