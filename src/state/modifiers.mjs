/**
 * xmonad-style layout modifiers: small decorators that wrap a layout
 * interpreter (or its drop semantics) without needing their own workspace
 * state. A layout spec carries them declaratively and stays JSON-serializable:
 *
 *   { type: "master-stack", ratio: 0.5, modifiers: [{ type: "smart-gaps" }, { type: "mirror" }] }
 *
 * `MODIFIERS` is parallel to `LAYOUTS` (see `derive.mjs`): keyed by
 * `modifier.type`, overridable/extendable the same way (`derive(state, { modifiers })`,
 * `createWindowManager({ modifiers })`). Each entry is a factory
 * `(modifierSpec) => (interpreter) => wrappedInterpreter`, where `interpreter`
 * has the same shape as a `LAYOUTS` entry: `(spec, ids, context) → tree`.
 * `withModifiers` composes a list of modifier specs over a base interpreter,
 * in order — the xmonad `ModifiedLayout` pattern, as plain functions.
 */
import { view, stack } from "../algebra/nodes.mjs";
import { replace, mirror as mirrorTree, flip as flipTree, rotate as rotateTree } from "../algebra/transforms.mjs";

/** Known modifier type names (for validation; the registry may carry more). */
export const MODIFIER_TYPES = Object.freeze(["smart-gaps", "no-gaps", "mirror", "reflect-x", "reflect-y", "max-windows"]);

/**
 * Built-in modifier factories. `(modifierSpec) => (interpreter) => (spec, ids, context) => tree`.
 * `smart-gaps` and `no-gaps` are tree no-ops here — they act on the gap/inset
 * wrap in `derive` (see `suppressesGaps`) — but are registered so the list is
 * introspectable and overridable like any other modifier.
 */
export const MODIFIERS = Object.freeze({
  "no-gaps": () => (interpreter) => interpreter,
  "smart-gaps": () => (interpreter) => interpreter,

  /** xmonad Mirror: transpose the layout (rows become columns and vice versa). */
  mirror: () => (interpreter) => (spec, ids, context) => rotateTree(interpreter(spec, ids, context)),

  /** Reflect left-right: reverse the children of every row. */
  "reflect-x": () => (interpreter) => (spec, ids, context) => mirrorTree(interpreter(spec, ids, context)),

  /** Reflect top-bottom: reverse the children of every column. */
  "reflect-y": () => (interpreter) => (spec, ids, context) => flipTree(interpreter(spec, ids, context)),

  /**
   * xmonad-style `Maximize`/`LimitWindows`-ish cap: only the first `n` tiled
   * windows get their own slot from the wrapped interpreter; the rest share
   * the last slot as a hidden stack (only the active one painted, the others
   * mounted-but-inert — the same presentation `monocle`/`tabs` already use).
   * `ids` keeps every window (so `derive`'s tiled set, `paintOrder`, and drops
   * over the flat workspace order all still agree with what's on screen); only
   * the *tree* changes shape.
   */
  "max-windows": (modifierSpec) => (interpreter) => (spec, ids, context) => {
    const n = Math.max(1, Number(modifierSpec.n) || 1);
    if (!Array.isArray(ids) || ids.length <= n) return interpreter(spec, ids, context);
    const visible = ids.slice(0, n);
    const overflow = ids.slice(n);
    const slot = visible[visible.length - 1];
    const tree = interpreter(spec, visible, context);
    const focused = context?.focused;
    // The overflow stack shows `slot` (the last regularly-laid-out window)
    // unless focus is on one of the hidden windows, which then comes forward.
    const stackActive = overflow.includes(focused) ? focused : slot;
    return replace(tree, slot, stack({ active: stackActive }, view(slot), ...overflow.map((id) => view(id))));
  },
});

/** Modifier types that suppress the configured gap/inset wrap in `derive`. */
const GAP_SUPPRESSORS = Object.freeze({
  "no-gaps": () => true,
  "smart-gaps": (modifierSpec, context) => (context?.tiledIds?.length ?? 0) <= 1,
});

/**
 * Compose a base interpreter with a workspace's modifier list, in order.
 * `registry` defaults to the built-ins and may be extended/overridden the
 * same way `derive`'s `layouts` option extends `LAYOUTS`.
 *
 * @param {(spec, ids, context) => object} interpreter
 * @param {Array<{type: string}>} [mods]
 * @param {object} [registry]
 */
export const withModifiers = (interpreter, mods = [], registry = MODIFIERS) =>
  (Array.isArray(mods) ? mods : []).reduce((interp, modifierSpec) => {
    const factory = modifierSpec && typeof modifierSpec === "object" ? registry[modifierSpec.type] : undefined;
    return typeof factory === "function" ? factory(modifierSpec)(interp) : interp;
  }, interpreter);

/** Does this modifier list suppress the configured gap/inset for `context` (e.g. `{ tiledIds }`)? */
export const suppressesGaps = (mods = [], context = {}, registry = GAP_SUPPRESSORS) =>
  Array.isArray(mods) &&
  mods.some((m) => m && typeof registry[m.type] === "function" && registry[m.type](m, context));

/**
 * Remap a drop interpreter's zone→op map so drags still match what
 * `mirror`/`reflect-x`/`reflect-y` actually painted (left/right, top/bottom,
 * or both, swapped to match). `max-windows`/`no-gaps`/`smart-gaps` leave the
 * map untouched — they don't change the layout's screen axes.
 */
export const applyModifiersToOps = (ops, mods = []) => {
  if (!ops || !Array.isArray(mods)) return ops;
  return mods.reduce((next, mod) => {
    if (!next || !mod) return next;
    if (mod.type === "reflect-x") return { ...next, left: next.right, right: next.left };
    if (mod.type === "reflect-y") return { ...next, top: next.bottom, bottom: next.top };
    if (mod.type === "mirror") return { ...next, top: next.left, left: next.top, right: next.bottom, bottom: next.right };
    return next;
  }, ops);
};

/** Shape-check a `spec.modifiers` list (used by `layout/set` and `layout/toggle`). */
export const validModifiers = (mods) => Array.isArray(mods) && mods.every((m) => m && typeof m.type === "string");
