/**
 * Versioned state and migrations.
 *
 * Saved/serialized state carries a `version` (see `STATE_VERSION` in
 * `create.mjs`). `migrate(state)` brings an older state up to the current
 * version by running it through `MIGRATIONS`, a registry of step functions
 * keyed by the version they upgrade *from*. A state with no `version` field
 * at all predates versioning and is treated as version 0 — the state shape
 * `createState` produced before this feature existed. A state whose version
 * is newer than `STATE_VERSION` cannot be understood by this build, so it is
 * rejected rather than guessed at.
 *
 * `migrate` never throws: it returns `{ ok, state, version, reason }`. On
 * success `ok` is true and `state` is the upgraded state (or the original
 * object, unchanged, when it is already current). On failure `ok` is false,
 * `state` is `null`, and `reason` is one of "invalid-state" (not an object),
 * "future-version" (newer than this build knows), or "no-migration-path"
 * (a gap in the registry — should not happen in practice).
 *
 * ## Adding a migration
 *
 * 1. Bump `STATE_VERSION` in `create.mjs` by one.
 * 2. Add `MIGRATIONS[oldVersion] = (state) => ({ ...state, version: oldVersion + 1, ...changes })`
 *    below, where `oldVersion` is the version the step upgrades *from*.
 *    The step must set `version` to `oldVersion + 1` and otherwise return a
 *    complete, valid state (fill in new fields, rename/normalize old ones).
 * 3. `migrate` chains steps automatically: a state several versions behind
 *    runs through each step in turn until it reaches `STATE_VERSION`.
 * 4. Add a round-trip test: build (or hand-write) a state at the old version,
 *    run it through `migrate`, and assert the result matches what a fresh
 *    `createState()` at the new version would produce for the same intent.
 */
import { STATE_VERSION, DEFAULT_CONFIG } from "./create.mjs";

export { STATE_VERSION };

/** Windows only ever stored the `draggable: false` exception; drop a stray explicit `true`. */
const normalizeDraggable = (windows = {}) =>
  Object.fromEntries(
    Object.entries(windows).map(([id, w]) => {
      if (w?.draggable !== true) return [id, w];
      const { draggable, ...rest } = w;
      return [id, rest];
    }),
  );

/**
 * Migration steps, keyed by the version they upgrade *from*. Each maps a
 * state at that version to a state at `version + 1`.
 */
export const MIGRATIONS = {
  // 0 → 1: `config.drag` (drag-and-drop settings) and the "only store the
  // draggable:false exception" convention were both added after states had
  // already been saved without them. Backfill the drag defaults and drop any
  // redundant explicit `draggable: true`.
  0: (state) => ({
    ...state,
    version: 1,
    config: {
      ...DEFAULT_CONFIG,
      ...state.config,
      drag: { ...DEFAULT_CONFIG.drag, ...(state.config?.drag ?? {}) },
    },
    windows: normalizeDraggable(state.windows),
  }),
};

/**
 * Upgrade `state` to `STATE_VERSION`, or report why it cannot be loaded.
 * See the module doc for the result shape and how to add a migration.
 */
export const migrate = (state) => {
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    return { ok: false, state: null, reason: "invalid-state" };
  }
  const version = state.version ?? 0;
  if (version > STATE_VERSION) {
    return { ok: false, state: null, version, reason: "future-version" };
  }
  if (version === STATE_VERSION) {
    return { ok: true, state, version };
  }
  let next = state.version === undefined ? { ...state, version: 0 } : state;
  while (next.version < STATE_VERSION) {
    const step = MIGRATIONS[next.version];
    if (!step) return { ok: false, state: null, version: next.version, reason: "no-migration-path" };
    next = step(next);
  }
  return { ok: true, state: next, version: next.version };
};
