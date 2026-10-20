/**
 * Pure snapshot and diff over state, so "what changed" (undo words, announcements,
 * change feeds) does not depend on diffing `wm.log` by hand.
 */

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
};

/**
 * A detached, plain-data copy of a state (what `JSON.stringify` would keep: a function layout
 * spec does not survive). Safe to keep, compare and store after the state moves on.
 */
export const snapshot = (state) => JSON.parse(JSON.stringify(state));

const walk = (before, after, path, changes) => {
  if (same(before, after)) return;
  if (isObject(before) && isObject(after)) {
    for (const key of Object.keys(before)) {
      if (!Object.hasOwn(after, key)) changes.push({ path: [...path, key], op: "remove", before: before[key] });
      else walk(before[key], after[key], [...path, key], changes);
    }
    for (const key of Object.keys(after)) {
      if (!Object.hasOwn(before, key)) changes.push({ path: [...path, key], op: "add", after: after[key] });
    }
    return;
  }
  changes.push({ path, op: "replace", before, after });
};

const keysOf = (value) => (isObject(value) ? Object.keys(value) : []);

const collection = (before, after, changes, name) => {
  const a = before?.[name] ?? {};
  const b = after?.[name] ?? {};
  const changed = {};
  for (const id of keysOf(b)) {
    if (!Object.hasOwn(a, id)) continue;
    const fields = new Set();
    for (const change of changes) {
      if (change.path[0] === name && change.path[1] === id && change.path.length > 2) fields.add(change.path[2]);
    }
    if (fields.size) changed[id] = [...fields];
  }
  return {
    added: keysOf(b).filter((id) => !Object.hasOwn(a, id)),
    removed: keysOf(a).filter((id) => !Object.hasOwn(b, id)),
    changed,
  };
};

/**
 * What changed between two states (or snapshots), as data.
 *
 * - `changes`: every leaf difference, `{ path, op: "add" | "remove" | "replace", before?, after? }`.
 *   Objects are compared key by key; arrays are compared whole (a reordered `workspaces.main.windows`
 *   is one `replace`).
 * - `windows`, `workspaces`, `outputs`: `{ added, removed, changed }` ids, where `changed` maps an id
 *   to the names of its top-level fields that differ.
 * - `focus`, `activeWorkspace`, `focusedOutput`: `{ before, after }` or `null` when unchanged
 *   (`focus` compares the focused window id).
 * - `config`: names of the top-level config keys that differ.
 * - `empty`: nothing differs.
 */
export const diffStates = (before, after) => {
  const a = snapshot(before);
  const b = snapshot(after);
  const changes = [];
  walk(a, b, [], changes);
  const moved = (x, y) => (x === y ? null : { before: x, after: y });
  const configKeys = new Set();
  for (const change of changes) if (change.path[0] === "config" && change.path.length > 1) configKeys.add(change.path[1]);
  return {
    empty: changes.length === 0,
    changes,
    windows: collection(a, b, changes, "windows"),
    workspaces: collection(a, b, changes, "workspaces"),
    outputs: collection(a, b, changes, "outputs"),
    focus: moved(a.focus?.window ?? null, b.focus?.window ?? null),
    activeWorkspace: moved(a.activeWorkspace, b.activeWorkspace),
    focusedOutput: moved(a.focusedOutput, b.focusedOutput),
    config: [...configKeys],
  };
};
