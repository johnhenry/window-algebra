# Versioning and migration

[API reference](./README.md) › Versioning and migration

Every state carries a `version`, and a state saved by one build can be loaded by a later one. Source: `src/state/migrate.mjs`.

## Contents

- [API](#api)
- [Shipped migrations](#shipped-migrations)
- [Who migrates](#who-migrates)
- [Adding a migration](#adding-a-migration)
- [Known gap: `config.snap`, `config.urgency` and `config.direction` on older states](#known-gap-configsnap-configurgency-and-configdirection-on-older-states)

## API

| Export | Description |
| --- | --- |
| `STATE_VERSION` | The current shape version: `2`. `createState()` stamps it. |
| `migrate(state)` | Upgrades `state` to `STATE_VERSION`. **Never throws.** |
| `MIGRATIONS` | The registry of step functions, keyed by the version they upgrade **from**: `MIGRATIONS[n](state) → state at n + 1`. |

`migrate` returns:

| Result | When |
| --- | --- |
| `{ ok: true, state, version }` | Success. A state already at `STATE_VERSION` is returned as **the same reference**. |
| `{ ok: false, state: null, reason: "invalid-state" }` | Not a non-array object. |
| `{ ok: false, state: null, version, reason: "future-version" }` | `version > STATE_VERSION`: saved by a newer build. It is refused rather than guessed at. |
| `{ ok: false, state: null, version, reason: "no-migration-path" }` | A gap in `MIGRATIONS`. This should not happen in practice. |

A state with **no** `version` field predates versioning and is treated as version 0.

## Shipped migrations

| Step | What it does |
| --- | --- |
| `0 → 1` | Rebuilds `config` as `{ ...DEFAULT_CONFIG, ...state.config }` with `drag` merged over the defaults (`config.drag` was added after sessions had been saved without it). Drops redundant explicit `draggable: true` from windows (only the `false` exception is ever stored). Backfills `urgent: []`. |
| `1 → 2` | Multiple outputs. Stamps `output: "primary"` (`DEFAULT_OUTPUT`) on every workspace that lacks one, and adds `outputs` (one default output owning every workspace in `workspaceOrder`, with the existing `activeWorkspace`), `outputOrder: ["primary"]` and `focusedOutput: "primary"`. Existing fields are kept. |

## Who migrates

- `wm.load(stateOrJSON)` migrates before installing. On failure it emits `state/load-rejected { reason, version? }`, keeps the current state and returns `null`. See [The manager](./manager.md#serialize-and-load).
- `replay(state, commands)` migrates its starting state, so `replay(wm.origin, wm.log)` holds even when `origin` predates versioning. A state that cannot be migrated is replayed as given.
- `update` does **not** migrate. Feeding it an old state directly may fail inside a handler; migrate first.

## Adding a migration

When a change to the state shape needs one:

1. Bump `STATE_VERSION` in `src/state/create.mjs` by one.
2. Add `MIGRATIONS[oldVersion] = (state) => ({ ...state, version: oldVersion + 1, /* fixes */ })` in `src/state/migrate.mjs`, keyed by the version it upgrades **from**. The step must set `version` to `oldVersion + 1` and return a complete, valid state (fill new fields, rename or normalize old ones).
3. `migrate` chains steps automatically: a state several versions behind runs through each one in turn.
4. Add a test: build (or hand-write) a state at the old version, or omit `version` for 0, and assert that `migrate` produces what `createState()` at the new version would produce for the same intent. See `test/migrate.test.mjs`.
5. Add a `CHANGELOG.md` entry, and check that `examples/04-…` still passes.

Add a migration whenever older saved states would otherwise **break**. A new config key read with a fallback does not need one. A new required field does.

## Known gap: `config.snap`, `config.urgency` and `config.direction` on older states

`config.snap` entered the state **without** a version bump (and so did `config.urgency`, for states saved by a build that had versioning but not yet urgency hints). A state saved at version 1 **before** those keys existed passes `1 → 2` without them, because that step does not touch `config`. The library tolerates this: `attachInput` reads `{ ...DEFAULT_CONFIG.snap, ...state.config.snap }`, and focus reads `config.urgency?.clearOnFocus !== false`. But code of your own that reads `state.config.snap.magnet` directly will throw on such a state. Read with a fallback (`{ ...DEFAULT_CONFIG.snap, ...state.config.snap }`), or dispatch `config/set { snap: { ...DEFAULT_CONFIG.snap } }` after loading. A bare `config/set { snap: {} }` would store an empty object, because it only merges into an **existing** plain object. This is deliberate and documented in the tests (`migrate()` passes a pre-snap version-1 state through unchanged). A version-0 state is unaffected, because `0 → 1` rebuilds `config` from `DEFAULT_CONFIG`.

`config.direction` was added the same way: a saved state without it is read as `"ltr"` (`directionOf(state)`; `presentationContext` and every adapter go through it), and no migration backfills it, because a new config key read with a fallback does not need one.
