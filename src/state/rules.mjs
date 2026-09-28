/**
 * Declarative window rules (xmonad ManageHooks / i3 for_window / EWMH window
 * types): `config.rules` is an ordered array of
 *
 *   { match: { role?, id?, idPrefix?, title?, titleRegex?, app?, parent? },
 *     set:   { mode?, layer?, workspace?, placement?, status?, draggable?, constraints?, anchor? } }
 *
 * matched against a window at `window/create` time (see `update.mjs`).
 * Within one rule's `match`, every present field must agree (AND); a rule
 * with no `match` (or an empty one) matches every window. Rules apply in
 * array order and later rules override earlier ones field-by-field; whatever
 * fields the create command sets explicitly always win over any rule.
 *
 * Rules stay JSON-serializable: `titleRegex` is a regex *source* string, not
 * a `RegExp` instance, and is compiled fresh each time it is tested.
 */
import { LAYERS, ROLES, STATUSES } from "./create.mjs";

/** Recognised `match` keys. */
export const MATCH_FIELDS = Object.freeze(["role", "id", "idPrefix", "title", "titleRegex", "app", "parent"]);
/** Recognised `set` keys — the same window fields a rule may override. */
export const SET_FIELDS = Object.freeze(["mode", "layer", "workspace", "placement", "status", "draggable", "constraints", "anchor"]);

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const compileRegex = (source) => {
  try {
    return new RegExp(source);
  } catch {
    return null;
  }
};

/** Does one rule's `match` accept this window? Absent fields are ignored. */
const matches = (match, win) => {
  if (!match) return true;
  if (match.role !== undefined && win.role !== match.role) return false;
  if (match.id !== undefined && win.id !== match.id) return false;
  if (match.idPrefix !== undefined && !(win.id ?? "").startsWith(match.idPrefix)) return false;
  if (match.title !== undefined && win.title !== match.title) return false;
  if (match.titleRegex !== undefined) {
    const re = compileRegex(match.titleRegex);
    if (!re || !re.test(win.title ?? "")) return false;
  }
  if (match.app !== undefined && win.app !== match.app) return false;
  if (match.parent !== undefined && win.parent !== match.parent) return false;
  return true;
};

/**
 * Indices of `state.config.rules` whose `match` accepts `win`, in rule
 * order. Pure; never throws — a malformed `titleRegex` simply fails to match.
 */
export const matchRules = (state, win) =>
  (state.config.rules ?? []).reduce((acc, rule, index) => (isPlainObject(rule) && matches(rule.match, win) ? [...acc, index] : acc), []);

const isValidRule = (rule) => {
  if (!isPlainObject(rule)) return false;
  const { match, set, ...rest } = rule;
  if (Object.keys(rest).length > 0) return false;
  if (match !== undefined) {
    if (!isPlainObject(match)) return false;
    for (const key of Object.keys(match)) if (!MATCH_FIELDS.includes(key)) return false;
    if (match.role !== undefined && !ROLES.includes(match.role)) return false;
    if (match.titleRegex !== undefined && (typeof match.titleRegex !== "string" || !compileRegex(match.titleRegex))) return false;
    for (const key of ["id", "idPrefix", "title", "app", "parent"]) {
      if (match[key] !== undefined && typeof match[key] !== "string") return false;
    }
  }
  if (set !== undefined) {
    if (!isPlainObject(set)) return false;
    for (const key of Object.keys(set)) if (!SET_FIELDS.includes(key)) return false;
    if (set.mode !== undefined && set.mode !== "tiled" && set.mode !== "floating") return false;
    if (set.layer !== undefined && !LAYERS.includes(set.layer)) return false;
    if (set.status !== undefined && !STATUSES.includes(set.status)) return false;
    if (set.workspace !== undefined && typeof set.workspace !== "string") return false;
    if (set.draggable !== undefined && typeof set.draggable !== "boolean") return false;
    if (set.placement !== undefined && !isPlainObject(set.placement)) return false;
    if (set.constraints !== undefined && !isPlainObject(set.constraints)) return false;
    if (set.anchor !== undefined && set.anchor !== null && !isPlainObject(set.anchor)) return false;
  }
  return true;
};

/** Is `rules` a well-formed, JSON-serializable rule list? */
export const validRules = (rules) => Array.isArray(rules) && rules.every(isValidRule);

/**
 * Fold matched rules' `set` patches into one object, later rules overriding
 * earlier ones field-by-field; `placement` and `constraints` merge one level
 * deep across rules, the same way `config/set` merges plain objects.
 */
export const foldRuleSets = (state, indices) =>
  indices.reduce((patch, index) => {
    const set = state.config.rules[index]?.set;
    if (!set) return patch;
    const next = { ...patch };
    for (const [key, value] of Object.entries(set)) {
      next[key] = isPlainObject(value) && isPlainObject(next[key]) ? { ...next[key], ...value } : value;
    }
    return next;
  }, {});

/** Recognised `set` keys that a create command may also set explicitly (rules never override those). */
export const explicitlySet = (command, key) => Object.prototype.hasOwnProperty.call(command, key);
