/**
 * The pure core: `update(state, command) → { state, events, effects }`.
 *
 * - A *command* expresses intent: { type: "window/focus", id }.
 * - *Events* record what actually happened: { type: "window/focused", id, previous }.
 *   Policy may redirect or reject a command (for example, focus goes to a modal
 *   dialog instead; a duplicate id is rejected), so events can differ from commands.
 * - *Effects* are values describing work for the effectful shell:
 *   { type: "render" }, { type: "focus", id }.
 *
 * `update` never touches the DOM, timers, randomness, or the clock. Ids are
 * supplied by the caller.
 */
import { LAYERS, ROLES, STATUSES, createWindowRecord, createWorkspace, createOutput } from "./create.mjs";
import { constrainSize } from "../geometry/rect.mjs";
import { bspInsert, bspRemove, bspSetRatio, bspRotate, bspNodeAt, bspSetRatioAt, bspReconcile } from "../layouts/bsp.mjs";
import { treeFrom, treeFromBsp, treeNodeAt, treeSetSizesAt } from "../layouts/tree.mjs";
import { modalTarget, descendantsOf, focusable, isVisible, isBlocked, isDescendantOf, fullscreenWindow } from "./queries.mjs";
import { dropHandlers, swapWindows, DRAG_MODES, isDroppable } from "./drops.mjs";
import { matchRules, validRules, foldRuleSets, SET_FIELDS as RULE_SET_FIELDS } from "./rules.mjs";
import { migrate } from "./migrate.mjs";
import { validModifiers } from "./modifiers.mjs";

const RENDER = Object.freeze({ type: "render" });

const MODES = Object.freeze(["tiled", "floating"]);

const result = (state, events = [], effects = []) => ({ state, events, effects });
const rejected = (state, command, reason) =>
  result(state, [{ type: "command/rejected", command: command.type, id: command.id, reason }]);

const without = (list, id) => list.filter((item) => item !== id);

const setWindow = (state, id, patch) => ({
  ...state,
  windows: { ...state.windows, [id]: { ...state.windows[id], ...patch } },
});

const setWorkspace = (state, id, patch) => ({
  ...state,
  workspaces: { ...state.workspaces, [id]: { ...state.workspaces[id], ...patch } },
});

const setLayout = (state, workspaceId, fn) => {
  const ws = state.workspaces[workspaceId];
  return setWorkspace(state, workspaceId, { layout: fn(ws.layout) });
};

/** A layout spec is a function, or an object with a string `type` and (optionally) a valid `modifiers` list. */
const isValidLayoutSpec = (layout) =>
  Boolean(layout) &&
  (typeof layout === "function" || (typeof layout.type === "string" && (layout.modifiers === undefined || validModifiers(layout.modifiers))));

/** Seed a BSP spec without a tree from the workspace's current tiled order. */
const seedBspTree = (state, ws, layout) => {
  if (layout.type !== "bsp" || layout.tree) return layout;
  const tiled = ws.windows.filter((id) => isTiled(state.windows[id]));
  return { ...layout, tree: tiled.reduce((tree, id) => bspInsert(tree, { id }), null) };
};

/** Seed a docking-tree spec without a tree from the workspace's current tiled order. */
const seedTree = (state, ws, layout) => {
  if (layout.type !== "tree" || layout.tree !== undefined) return layout;
  const tiled = ws.windows.filter((id) => isTiled(state.windows[id]));
  return { ...layout, tree: treeFrom(tiled) };
};

const raiseOne = (state, id) => {
  const layer = state.windows[id].layer;
  return { ...state, stack: { ...state.stack, [layer]: [...without(state.stack[layer], id), id] } };
};

/**
 * Raise a window within its layer, and its descendants (dialogs, sheets,
 * popovers) above it: a child is never painted beneath its parent, and an
 * anchored child must follow its anchor for CSS anchor positioning to apply.
 */
const raiseInStack = (state, id) => {
  const rank = new Map(LAYERS.flatMap((layer) => state.stack[layer] ?? []).map((wid, i) => [wid, i]));
  const children = descendantsOf(state, id).sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  return [id, ...children].reduce(raiseOne, state);
};

const lowerInStack = (state, id) => {
  const layer = state.windows[id].layer;
  return { ...state, stack: { ...state.stack, [layer]: [id, ...without(state.stack[layer], id)] } };
};

const removeFromStack = (state, id) => ({
  ...state,
  stack: Object.fromEntries(LAYERS.map((layer) => [layer, without(state.stack[layer] ?? [], id)])),
});

/** Is a window part of the tiled arrangement (and therefore of a BSP tree)? */
const isTiled = (win) => win.role === "window" && win.mode === "tiled";

const bspAdd = (state, win, target) =>
  isTiled(win) && state.workspaces[win.workspace]?.layout?.type === "bsp"
    ? setLayout(state, win.workspace, (layout) => ({
        ...layout,
        tree: bspInsert(layout.tree ?? null, { id: win.id, target }),
      }))
    : state;

const bspDrop = (state, workspaceId, id) =>
  state.workspaces[workspaceId]?.layout?.type === "bsp"
    ? setLayout(state, workspaceId, (layout) => ({ ...layout, tree: bspRemove(layout.tree ?? null, id) }))
    : state;

/**
 * Why a window can never take focus: it (or an ancestor) is hidden in the
 * scratchpad or popped out into another browser window, so there is nothing
 * to focus. `null` when focusing may succeed.
 */
const unfocusableReason = (state, id) => {
  for (let win = state.windows[modalTarget(state, id)]; win; win = win.parent ? state.windows[win.parent] : undefined) {
    if (win.workspace === null) return "not-on-workspace";
    if (win.status === "popped-out") return "popped-out";
  }
  return null;
};

/**
 * Apply focus, following policy: modal redirection, output/workspace switch,
 * restore, raise. Returns `null` (nothing changes) when the target would not
 * be visible afterwards: focus is only ever given to a window that is shown.
 * `exitFullscreen` lets an explicit request for a window hidden beneath a
 * fullscreen one end that fullscreen; without it such a window is not focused.
 */
const focusOrNull = (state, requested, { exitFullscreen = false } = {}) => {
  const target = modalTarget(state, requested);
  if (unfocusableReason(state, requested)) return null;
  const previous = state.focus.window;
  let next = state;
  const events = [];
  const win = next.windows[target];
  const ws = win.workspace != null ? next.workspaces[win.workspace] : undefined;
  const outputId = ws?.output;
  // Focusing a window on another output switches which output is focused,
  // the same way focusing one on another workspace switches the workspace.
  if (ws && outputId !== next.focusedOutput) {
    events.push({ type: "output/focused", id: outputId, previous: next.focusedOutput });
    next = { ...next, focusedOutput: outputId, activeWorkspace: next.outputs[outputId].activeWorkspace };
  }
  // A sticky window is visible on every workspace already, so focusing it
  // never needs to switch which workspace is active.
  if (win.workspace !== next.activeWorkspace && !win.sticky) {
    events.push({ type: "workspace/activated", id: win.workspace, previous: next.activeWorkspace });
    next = {
      ...next,
      activeWorkspace: win.workspace,
      ...(outputId
        ? { outputs: { ...next.outputs, [outputId]: { ...next.outputs[outputId], activeWorkspace: win.workspace } } }
        : {}),
    };
  }
  // Restore the target, and any minimized ancestor it hangs off.
  for (let w = next.windows[target]; w; w = w.parent ? next.windows[w.parent] : undefined) {
    if (w.status !== "minimized") continue;
    next = setWindow(next, w.id, { status: "normal" });
    events.push({ type: "window/restored", id: w.id });
  }
  // A fullscreen window covers everything but its own descendants.
  const covering = fullscreenWindow(next, outputId ?? next.focusedOutput);
  if (covering && covering.id !== target && !isDescendantOf(next, target, covering.id)) {
    if (!exitFullscreen) return null;
    next = setWindow(next, covering.id, { status: "normal" });
    events.push({ type: "window/status-changed", id: covering.id, status: "normal", previous: "fullscreen" });
  }
  if (!isVisible(next, target)) return null;
  if (next.config.focusRaises) next = raiseInStack(next, target);
  if (next.config.urgency?.clearOnFocus !== false && next.urgent.includes(target)) {
    next = { ...next, urgent: without(next.urgent, target) };
    events.push({ type: "window/urgent-changed", id: target, urgent: false });
  }
  next = {
    ...next,
    focus: { window: target, history: [...without(next.focus.history, target), target] },
  };
  if (target !== requested) events.push({ type: "focus/redirected", requested, id: target });
  if (target !== previous) events.push({ type: "window/focused", id: target, previous });
  return result(next, events, [RENDER, { type: "focus", id: target }]);
};

/** `focusOrNull`, but an unfocusable target is simply left alone. */
const applyFocus = (state, requested, options) => focusOrNull(state, requested, options) ?? result(state);

/** Focus on behalf of a command that names its target: unfocusable means rejected. */
const focusCommand = (state, command, id) =>
  focusOrNull(state, id, { exitFullscreen: true }) ??
  rejected(state, command, unfocusableReason(state, id) ?? "not-visible");

/**
 * Put a window and all its descendants on a workspace, whatever workspace (or
 * the scratchpad) they were on. Moving a scratchpad window onto a workspace
 * directly pulls it out of the scratchpad for good.
 */
const moveFamilyTo = (state, win, target) => {
  let next = state;
  for (const id of [win.id, ...descendantsOf(state, win.id)]) {
    const from = next.windows[id].workspace;
    // A hidden scratchpad window (workspace: null) belongs to no workspace yet.
    if (from !== null) {
      next = setWorkspace(next, from, { windows: without(next.workspaces[from].windows, id) });
      next = bspDrop(next, from, id);
    }
    next = setWindow(next, id, { workspace: target });
    next = setWorkspace(next, target, { windows: [...next.workspaces[target].windows, id] });
    next = bspAdd(next, next.windows[id]);
  }
  if (win.scratchpad) {
    const { scratchpad: _scratchpad, ...rest } = next.windows[win.id];
    next = {
      ...next,
      windows: { ...next.windows, [win.id]: rest },
      lastScratchpad: next.lastScratchpad === win.id ? null : next.lastScratchpad,
    };
  }
  return next;
};

/** After the focused window disappears, focus the most recent remaining focusable window. */
const refocus = (state) => {
  if (state.focus.window && isVisible(state, state.focus.window)) return result(state);
  const candidates = new Set(focusable(state));
  const history = state.focus.history.filter((id) => state.windows[id]);
  const fallback = [...history].reverse().find((id) => candidates.has(id));
  const cleaned = { ...state, focus: { window: null, history } };
  if (fallback) return applyFocus(cleaned, fallback);
  return result(cleaned, state.focus.window ? [{ type: "window/blurred", id: state.focus.window }] : [], [
    { type: "focus", id: null },
  ]);
};

/**
 * Apply a folded rule `set` patch to a freshly built window record, skipping
 * any field the create command set explicitly (those always win over rules).
 * `placement` and `constraints` merge one level deep; `constraints` is
 * re-clamped against the window's placement afterwards.
 */
const applyRulePatch = (win, patch, command) => {
  let next = win;
  for (const key of RULE_SET_FIELDS) {
    if (patch[key] === undefined) continue;
    if (Object.prototype.hasOwnProperty.call(command, key)) continue;
    if (key === "placement") next = { ...next, placement: { ...next.placement, ...patch.placement } };
    else if (key === "constraints") next = { ...next, constraints: { ...next.constraints, ...patch.constraints } };
    else if (key === "draggable") {
      if (patch.draggable === false) next = { ...next, draggable: false };
      else {
        const { draggable: _drop, ...rest } = next;
        next = rest;
      }
    } else next = { ...next, [key]: patch[key] };
  }
  if (patch.constraints !== undefined && !Object.prototype.hasOwnProperty.call(command, "constraints")) {
    next = { ...next, placement: { ...next.placement, ...constrainSize(next.placement, next.constraints) } };
  }
  return next;
};

const merge = (a, b) => result(b.state, [...a.events, ...b.events], [...a.effects, ...b.effects]);

const dedupeEffects = (effects) => {
  const seen = new Set();
  const out = [];
  for (let i = effects.length - 1; i >= 0; i--) {
    const key = effects[i].type;
    if (seen.has(key)) continue;
    seen.add(key);
    out.unshift(effects[i]);
  }
  return out;
};

const handlers = {
  "window/create"(state, command) {
    const { id } = command;
    if (typeof id !== "string" || !id) return rejected(state, command, "missing-id");
    if (state.windows[id]) return rejected(state, command, "duplicate-id");
    if (command.parent && !state.windows[command.parent]) return rejected(state, command, "unknown-parent");
    if (command.parent && state.windows[command.parent].workspace === null) return rejected(state, command, "hidden-parent");
    if (command.role !== undefined && !ROLES.includes(command.role)) return rejected(state, command, "unknown-role");
    if (command.layer !== undefined && !LAYERS.includes(command.layer)) return rejected(state, command, "unknown-layer");
    if (command.mode !== undefined && !MODES.includes(command.mode)) return rejected(state, command, "unknown-mode");
    let win = createWindowRecord(command, state);
    const appliedRules = matchRules(state, win);
    if (appliedRules.length) win = applyRulePatch(win, foldRuleSets(state, appliedRules), command);
    if (!state.workspaces[win.workspace]) return rejected(state, command, "unknown-workspace");
    // A modal dialog on another workspace than its parent would block a window the user can see with a dialog they cannot.
    if (win.modal && win.parent && state.windows[win.parent].workspace !== win.workspace) {
      return rejected(state, command, "parent-on-other-workspace");
    }
    let next = { ...state, windows: { ...state.windows, [id]: win } };
    next = setWorkspace(next, win.workspace, { windows: [...next.workspaces[win.workspace].windows, id] });
    next = bspAdd(next, win, state.focus.window);
    next = { ...next, stack: { ...next.stack, [win.layer]: [...next.stack[win.layer], id] } };
    const createdEvent = { type: "window/created", id };
    if (appliedRules.length) createdEvent.rules = appliedRules;
    const created = result(next, [createdEvent], [RENDER]);
    if (command.focus === false || win.workspace !== next.activeWorkspace) return created;
    return merge(created, applyFocus(next, id));
  },

  "window/close"(state, command) {
    const { id } = command;
    if (!state.windows[id]) return rejected(state, command, "unknown-window");
    const doomed = [...descendantsOf(state, id).reverse(), id];
    let next = state;
    for (const victim of doomed) {
      const ws = next.windows[victim].workspace;
      // A hidden scratchpad window (workspace: null) belongs to no workspace.
      if (ws !== null) {
        next = setWorkspace(next, ws, { windows: without(next.workspaces[ws].windows, victim) });
        next = bspDrop(next, ws, victim);
      }
      next = removeFromStack(next, victim);
      const { [victim]: _removed, ...windows } = next.windows;
      next = {
        ...next,
        windows,
        focus: {
          window: next.focus.window === victim ? null : next.focus.window,
          history: without(next.focus.history, victim),
        },
        lastScratchpad: next.lastScratchpad === victim ? null : next.lastScratchpad,
        urgent: without(next.urgent, victim),
      };
    }
    const closed = result(
      next,
      doomed.map((victim) => ({ type: "window/closed", id: victim })),
      [RENDER],
    );
    return merge(closed, refocus(next));
  },

  "window/focus"(state, command) {
    if (!state.windows[command.id]) return rejected(state, command, "unknown-window");
    return focusCommand(state, command, command.id);
  },

  "window/blur"(state) {
    if (!state.focus.window) return result(state);
    const previous = state.focus.window;
    return result({ ...state, focus: { ...state.focus, window: null } }, [{ type: "window/blurred", id: previous }], [
      RENDER,
      { type: "focus", id: null },
    ]);
  },

  "focus/next"(state) {
    return cycleFocus(state, 1);
  },

  "focus/previous"(state) {
    return cycleFocus(state, -1);
  },

  /**
   * Focus the oldest urgent window (EWMH/X11-style urgency hint), switching
   * workspace if needed. Clearing the hint is a side effect of `applyFocus`
   * (see `config.urgency.clearOnFocus`).
   */
  "focus/urgent"(state, command) {
    const id = state.urgent.find((wid) => state.windows[wid] && !unfocusableReason(state, wid));
    if (!id) return rejected(state, command, "no-urgent-window");
    return focusCommand(state, command, id);
  },

  /**
   * Mark or clear a window's urgency hint. Urgency clears automatically when
   * the window gains focus, unless `config.urgency.clearOnFocus` is false.
   */
  "window/set-urgent"(state, command) {
    const { id } = command;
    if (!state.windows[id]) return rejected(state, command, "unknown-window");
    const urgent = command.urgent === undefined ? true : command.urgent;
    if (typeof urgent !== "boolean") return rejected(state, command, "invalid-urgent");
    if (state.urgent.includes(id) === urgent) return result(state);
    const next = { ...state, urgent: urgent ? [...state.urgent, id] : without(state.urgent, id) };
    return result(next, [{ type: "window/urgent-changed", id, urgent }], [RENDER]);
  },

  "window/raise"(state, command) {
    if (!state.windows[command.id]) return rejected(state, command, "unknown-window");
    return result(raiseInStack(state, command.id), [{ type: "window/raised", id: command.id }], [RENDER]);
  },

  "window/lower"(state, command) {
    if (!state.windows[command.id]) return rejected(state, command, "unknown-window");
    return result(lowerInStack(state, command.id), [{ type: "window/lowered", id: command.id }], [RENDER]);
  },

  "window/set-layer"(state, command) {
    const { id, layer } = command;
    if (!state.windows[id]) return rejected(state, command, "unknown-window");
    if (!LAYERS.includes(layer)) return rejected(state, command, "unknown-layer");
    let next = removeFromStack(state, id);
    next = setWindow(next, id, { layer });
    next = { ...next, stack: { ...next.stack, [layer]: [...next.stack[layer], id] } };
    return result(next, [{ type: "window/layer-changed", id, layer }], [RENDER]);
  },

  /**
   * Requested geometry. Stored regardless of mode; derive only honours it
   * when the window is floating. The manager may say no by ignoring it.
   */
  "window/move"(state, command) {
    const win = state.windows[command.id];
    if (!win) return rejected(state, command, "unknown-window");
    const placement = { ...win.placement, x: command.x ?? win.placement.x, y: command.y ?? win.placement.y };
    return result(setWindow(state, win.id, { placement }), [{ type: "window/moved", id: win.id, placement }], [RENDER]);
  },

  "window/resize"(state, command) {
    const win = state.windows[command.id];
    if (!win) return rejected(state, command, "unknown-window");
    const sizeValue = constrainSize(
      { width: command.width ?? win.placement.width, height: command.height ?? win.placement.height },
      win.constraints,
    );
    const placement = {
      ...win.placement,
      ...sizeValue,
      x: command.x ?? win.placement.x,
      y: command.y ?? win.placement.y,
    };
    return result(setWindow(state, win.id, { placement }), [{ type: "window/resized", id: win.id, placement }], [
      RENDER,
    ]);
  },

  "window/set-mode"(state, command) {
    const win = state.windows[command.id];
    if (!win) return rejected(state, command, "unknown-window");
    if (!MODES.includes(command.mode)) return rejected(state, command, "unknown-mode");
    if (win.mode === command.mode) return result(state);
    let next = setWindow(state, win.id, { mode: command.mode });
    next =
      command.mode === "tiled" ? bspAdd(next, next.windows[win.id], state.focus.window) : bspDrop(next, win.workspace, win.id);
    return result(next, [{ type: "window/mode-changed", id: win.id, mode: command.mode }], [RENDER]);
  },

  /**
   * Pop a tiled window out of the layout as a floating window at a position
   * (the drag-to-float gesture): one command, one undo step. Width and height
   * default to the window's stored floating size.
   */
  "window/detach"(state, command) {
    const win = state.windows[command.id];
    if (!win) return rejected(state, command, "unknown-window");
    if (state.config.drag?.toFloating === "off") return rejected(state, command, "drag-disabled");
    if (win.draggable === false) return rejected(state, command, "not-draggable");
    if (!isDroppable(state, win)) return rejected(state, command, "not-tiled");
    if (isBlocked(state, win.id)) return rejected(state, command, "blocked");
    const sizeValue = constrainSize(
      { width: command.width ?? win.placement.width, height: command.height ?? win.placement.height },
      win.constraints,
    );
    const placement = { ...win.placement, ...sizeValue, x: command.x ?? win.placement.x, y: command.y ?? win.placement.y };
    let next = setWindow(state, win.id, { mode: "floating", placement });
    next = bspDrop(next, win.workspace, win.id);
    next = raiseInStack(next, win.id);
    return result(next, [{ type: "window/detached", id: win.id, placement }], [RENDER]);
  },

  "window/toggle-floating"(state, command) {
    const win = state.windows[command.id];
    if (!win) return rejected(state, command, "unknown-window");
    return handlers["window/set-mode"](state, { ...command, mode: win.mode === "tiled" ? "floating" : "tiled" });
  },

  "window/minimize"(state, command) {
    return setStatus(state, command, "minimized");
  },
  "window/maximize"(state, command) {
    return setStatus(state, command, "maximized");
  },
  "window/fullscreen"(state, command) {
    return setStatus(state, command, "fullscreen");
  },
  "window/restore"(state, command) {
    return setStatus(state, command, "normal");
  },

  /**
   * GoldenLayout/Dockview-style pop-out: leave the layout for a separate
   * browser window, like `window/minimize` (see `isVisible`/`isBlocked`,
   * "visible elsewhere") but distinct so the browser shell
   * (`browser/popouts.mjs`, `attachPopouts`) can tell the two apart and
   * actually open/close the popup. Refused while a modal child blocks the
   * window, same as `window/detach`; already popped out is a no-op.
   */
  "window/pop-out"(state, command) {
    const win = state.windows[command.id];
    if (!win) return rejected(state, command, "unknown-window");
    if (win.status === "popped-out") return result(state);
    if (isBlocked(state, win.id)) return rejected(state, command, "blocked");
    const next = setWindow(state, win.id, { status: "popped-out" });
    const changed = result(
      next,
      [{ type: "window/status-changed", id: win.id, status: "popped-out", previous: win.status }],
      [RENDER],
    );
    return merge(changed, refocus(next));
  },

  /**
   * Reverse of `window/pop-out`. Unlike the other status setters, a window
   * that is not currently popped out is rejected rather than treated as a
   * no-op: the browser shell relies on this to tell whether its own
   * `popIn()` call (or the popup being closed) is undoing a real pop-out.
   */
  "window/pop-in"(state, command) {
    const win = state.windows[command.id];
    if (!win) return rejected(state, command, "unknown-window");
    if (win.status !== "popped-out") return rejected(state, command, "not-popped-out");
    const next = setWindow(state, win.id, { status: "normal" });
    return result(next, [{ type: "window/status-changed", id: win.id, status: "normal", previous: "popped-out" }], [RENDER]);
  },

  "window/set-title"(state, command) {
    if (!state.windows[command.id]) return rejected(state, command, "unknown-window");
    return result(setWindow(state, command.id, { title: String(command.title ?? "") }), [
      { type: "window/retitled", id: command.id, title: command.title },
    ], [RENDER]);
  },

  "window/set-constraints"(state, command) {
    const win = state.windows[command.id];
    if (!win) return rejected(state, command, "unknown-window");
    const constraints = { ...win.constraints, ...command.constraints };
    const placement = { ...win.placement, ...constrainSize(win.placement, constraints) };
    return result(setWindow(state, win.id, { constraints, placement }), [
      { type: "window/constrained", id: win.id, constraints },
    ], [RENDER]);
  },

  /** Swap two windows' positions in the workspace order (and BSP tree). */
  "window/swap"(state, command) {
    const { a, b } = command;
    const wa = state.windows[a];
    const wb = state.windows[b];
    if (!wa || !wb) return rejected(state, command, "unknown-window");
    if (wa.workspace === null || wb.workspace === null) return rejected(state, command, "not-on-workspace");
    if (wa.workspace !== wb.workspace) return rejected(state, command, "different-workspaces");
    if (a === b) return result(state);
    const next = swapWindows(state, a, b);
    return result(next, [{ type: "window/swapped", a, b }], [RENDER]);
  },

  /** Move a window to the front of the workspace order (the master position). */
  "window/promote"(state, command) {
    const win = state.windows[command.id];
    if (!win) return rejected(state, command, "unknown-window");
    const ws = state.workspaces[win.workspace];
    // A window hidden in the scratchpad has no workspace (and so no master slot).
    if (!ws) return rejected(state, command, "not-on-workspace");
    const tiled = ws.windows.filter((id) => isTiled(state.windows[id]));
    if (tiled[0] === win.id || !isTiled(win)) return result(state);
    return handlers["window/swap"](state, { type: "window/swap", a: win.id, b: tiled[0] });
  },

  "window/move-to-workspace"(state, command) {
    const win = state.windows[command.id];
    if (!win) return rejected(state, command, "unknown-window");
    const target = command.workspace;
    if (!state.workspaces[target]) return rejected(state, command, "unknown-workspace");
    // A child follows its parent; moving it alone would strand a dialog away from the window it blocks.
    if (win.parent) return rejected(state, command, "has-parent");
    if (win.workspace === target) return result(state);
    const next = moveFamilyTo(state, win, target);
    const moved = result(next, [{ type: "window/workspace-changed", id: win.id, workspace: target }], [RENDER]);
    // follow: go with the window (activate its new workspace and focus it).
    if (command.follow) return merge(moved, applyFocus(next, win.id, { exitFullscreen: true }));
    return merge(moved, refocus(next));
  },

  /**
   * i3-style scratchpad: hide a window off every workspace. It keeps its
   * `workspace` as `null` (belonging to no workspace) while hidden, is
   * marked `scratchpad: true` for as long as it remains one (shown or
   * hidden), and forced to floating mode so a later `scratchpad/toggle`
   * always shows it as a floating window. Already-hidden is a no-op.
   */
  "window/to-scratchpad"(state, command) {
    const { id } = command;
    const win = state.windows[id];
    if (!win) return rejected(state, command, "unknown-window");
    if (win.parent) return rejected(state, command, "has-parent");
    if (win.workspace === null) return result(state);
    const from = win.workspace;
    let next = setWorkspace(state, from, { windows: without(state.workspaces[from].windows, id) });
    next = bspDrop(next, from, id);
    next = setWindow(next, id, { scratchpad: true, mode: "floating", workspace: null });
    next = { ...next, lastScratchpad: id };
    const hidden = result(next, [{ type: "window/scratchpad", id }], [RENDER]);
    return merge(hidden, refocus(next));
  },

  /**
   * Show the last (or given) scratchpad window floating and centered on the
   * active workspace, focusing it; toggling the same window again hides it
   * back into the scratchpad. `id` must already be a scratchpad window
   * (sent there with `window/to-scratchpad`); with no `id`, the most
   * recently shown-or-hidden scratchpad window is used.
   */
  "scratchpad/toggle"(state, command) {
    const id = command.id ?? state.lastScratchpad;
    if (id == null) return rejected(state, command, "empty-scratchpad");
    const win = state.windows[id];
    if (!win) return rejected(state, command, "unknown-window");
    if (!win.scratchpad) return rejected(state, command, "not-scratchpad");
    let next = { ...state, lastScratchpad: id };
    if (win.workspace === null) {
      // Show: float it, centered, on the active workspace.
      const ws = next.activeWorkspace;
      next = moveFamilyTo(next, { ...win, scratchpad: false }, ws);
      next = setWindow(next, id, { placement: { ...win.placement, x: "center", y: "center" } });
      const shown = result(next, [{ type: "scratchpad/shown", id }], [RENDER]);
      return merge(shown, applyFocus(next, id, { exitFullscreen: true }));
    }
    // Hide: wherever it currently is.
    const ws = win.workspace;
    next = setWorkspace(next, ws, { windows: without(next.workspaces[ws].windows, id) });
    next = bspDrop(next, ws, id);
    next = setWindow(next, id, { workspace: null });
    const wasHidden = result(next, [{ type: "scratchpad/hidden", id }], [RENDER]);
    return merge(wasHidden, refocus(next));
  },

  /**
   * EWMH-style sticky: visible on every workspace, keeping its stacking.
   * Only the exception (`sticky: true`) is stored.
   */
  "window/set-sticky"(state, command) {
    const { id, sticky } = command;
    const win = state.windows[id];
    if (!win) return rejected(state, command, "unknown-window");
    if (typeof sticky !== "boolean") return rejected(state, command, "invalid-sticky");
    if (Boolean(win.sticky) === sticky) return result(state);
    let next;
    if (sticky) {
      next = setWindow(state, id, { sticky: true });
    } else {
      const { sticky: _sticky, ...rest } = win;
      next = { ...state, windows: { ...state.windows, [id]: rest } };
    }
    const changed = result(next, [{ type: "window/sticky-changed", id, sticky }], [RENDER]);
    return merge(changed, refocus(next));
  },

  "workspace/create"(state, command) {
    const { id } = command;
    if (typeof id !== "string" || !id) return rejected(state, command, "missing-id");
    if (state.workspaces[id]) return rejected(state, command, "duplicate-id");
    const outputId = command.output ?? state.focusedOutput;
    if (!state.outputs[outputId]) return rejected(state, command, "unknown-output");
    const ws = createWorkspace({ id, layout: command.layout ?? state.workspaces[state.activeWorkspace].layout, output: outputId });
    if (ws.layout.type === "bsp") ws.layout = { ...ws.layout, tree: null };
    let next = {
      ...state,
      workspaces: { ...state.workspaces, [id]: ws },
      workspaceOrder: [...state.workspaceOrder, id],
      outputs: {
        ...state.outputs,
        [outputId]: { ...state.outputs[outputId], workspaces: [...state.outputs[outputId].workspaces, id] },
      },
    };
    const created = result(next, [{ type: "workspace/created", id, output: outputId }], [RENDER]);
    return command.activate ? merge(created, handlers["workspace/activate"](next, { type: "workspace/activate", id })) : created;
  },

  /** Activate a workspace, switching (and focusing) its output too if it belongs to another one. */
  "workspace/activate"(state, command) {
    const ws = state.workspaces[command.id];
    if (!ws) return rejected(state, command, "unknown-workspace");
    const outputId = ws.output;
    const focusedThere = state.focusedOutput === outputId;
    const activeThere = state.outputs[outputId].activeWorkspace === command.id;
    if (focusedThere && activeThere) return result(state);
    const events = [];
    let next = state;
    if (!focusedThere) {
      events.push({ type: "output/focused", id: outputId, previous: state.focusedOutput });
      next = { ...next, focusedOutput: outputId };
    }
    if (!activeThere) {
      events.push({ type: "workspace/activated", id: command.id, previous: state.outputs[outputId].activeWorkspace });
      next = { ...next, outputs: { ...next.outputs, [outputId]: { ...next.outputs[outputId], activeWorkspace: command.id } } };
    }
    next = { ...next, activeWorkspace: command.id };
    return merge(result(next, events, [RENDER]), refocus({ ...next, focus: { ...next.focus, window: null } }));
  },

  "workspace/remove"(state, command) {
    const { id } = command;
    const ws = state.workspaces[id];
    if (!ws) return rejected(state, command, "unknown-workspace");
    if (state.workspaceOrder.length === 1) return rejected(state, command, "last-workspace");
    if (state.outputs[ws.output].workspaces.length === 1) return rejected(state, command, "last-workspace-on-output");
    const fallback = command.fallback ?? state.workspaceOrder.find((wid) => wid !== id);
    if (!state.workspaces[fallback] || fallback === id) return rejected(state, command, "unknown-workspace");
    const localFallback = state.outputs[ws.output].workspaces.find((wid) => wid !== id);
    let next = state;
    for (const winId of state.workspaces[id].windows) {
      const win = next.windows[winId];
      // Move top-level windows (their descendants follow), and also children whose
      // parent lives on another workspace: nothing else would move them, and they
      // would be left pointing at the removed workspace.
      const parentHere = win?.parent && next.windows[win.parent]?.workspace === id;
      if (win?.workspace === id && !parentHere) {
        next = moveFamilyTo(next, win, fallback);
      }
    }
    const { [id]: _gone, ...workspaces } = next.workspaces;
    const outputId = ws.output;
    next = {
      ...next,
      workspaces,
      workspaceOrder: without(next.workspaceOrder, id),
      activeWorkspace: next.activeWorkspace === id ? localFallback : next.activeWorkspace,
      outputs: {
        ...next.outputs,
        [outputId]: {
          ...next.outputs[outputId],
          workspaces: without(next.outputs[outputId].workspaces, id),
          activeWorkspace: next.outputs[outputId].activeWorkspace === id ? localFallback : next.outputs[outputId].activeWorkspace,
        },
      },
    };
    return merge(result(next, [{ type: "workspace/removed", id, fallback }], [RENDER]), refocus(next));
  },

  /**
   * Move a workspace (and everything on it) to another output. Rejected when
   * it is the only workspace its current output has (an output always keeps
   * at least one). `activate` also focuses it (and so its new output) after
   * the move.
   */
  "workspace/move-to-output"(state, command) {
    const { id } = command;
    const ws = state.workspaces[id];
    if (!ws) return rejected(state, command, "unknown-workspace");
    const target = command.output;
    if (!state.outputs[target]) return rejected(state, command, "unknown-output");
    if (ws.output === target) return result(state);
    const source = state.outputs[ws.output];
    if (source.workspaces.length === 1) return rejected(state, command, "last-workspace-on-output");
    const localFallback = source.workspaces.find((wid) => wid !== id);
    let next = setWorkspace(state, id, { output: target });
    next = {
      ...next,
      outputs: {
        ...next.outputs,
        [ws.output]: {
          ...source,
          workspaces: without(source.workspaces, id),
          activeWorkspace: source.activeWorkspace === id ? localFallback : source.activeWorkspace,
        },
        [target]: { ...next.outputs[target], workspaces: [...next.outputs[target].workspaces, id] },
      },
    };
    if (next.focusedOutput === ws.output && next.activeWorkspace === id) {
      next = { ...next, activeWorkspace: localFallback };
    }
    const moved = result(next, [{ type: "workspace/moved-to-output", id, output: target, from: ws.output }], [RENDER]);
    if (command.activate) return merge(moved, handlers["workspace/activate"](next, { type: "workspace/activate", id }));
    return merge(moved, refocus(next));
  },

  /**
   * Replace a workspace's layout spec. A BSP spec without a tree is seeded
   * from the current order. `layout.modifiers` (see `state/modifiers.mjs`),
   * when present, must be a list of `{ type, ... }` objects.
   */
  "layout/set"(state, command) {
    const wsId = command.workspace ?? state.activeWorkspace;
    const ws = state.workspaces[wsId];
    if (!ws) return rejected(state, command, "unknown-workspace");
    if (!isValidLayoutSpec(command.layout)) return rejected(state, command, "invalid-layout");
    const layout = seedTree(state, ws, seedBspTree(state, ws, command.layout));
    return result(setWorkspace(state, wsId, { layout }), [{ type: "layout/changed", workspace: wsId, layout }], [RENDER]);
  },

  /**
   * Convert the current layout to a docking tree, so a user can start from
   * any layout: BSP's binary tree maps over exactly (`treeFromBsp`,
   * preserving every split's ratio); columns/rows become a single row/column
   * with their stored sizes carried over; master-stack becomes a row of two
   * columns (or a single column below `masterCount`); tabs/monocle become a
   * `tabs` container; anything else (spiral, grid, floating, a function
   * spec) falls back to a flat row of the current tiled order.
   */
  "layout/to-tree"(state, command) {
    const wsId = command.workspace ?? state.activeWorkspace;
    const ws = state.workspaces[wsId];
    if (!ws) return rejected(state, command, "unknown-workspace");
    const ids = ws.windows.filter((id) => isTiled(state.windows[id]));
    const spec = ws.layout;
    const type = spec && typeof spec === "object" ? spec.type : null;
    let tree;
    if (type === "bsp") {
      tree = treeFromBsp(bspReconcile(spec.tree, ids));
    } else if (type === "columns" || type === "rows") {
      const container = type === "columns" ? "row" : "column";
      const stored = spec.sizes?.[""];
      const sizes = Array.isArray(stored) && stored.length === ids.length ? stored : undefined;
      tree = ids.length > 1 ? { type: container, children: [...ids], ...(sizes ? { sizes } : {}) } : treeFrom(ids);
    } else if (type === "master-stack") {
      const masterCount = Math.max(1, Number.isInteger(spec.masterCount) ? spec.masterCount : 1);
      if (ids.length <= masterCount) {
        tree = treeFrom(ids, { type: "column" });
      } else {
        const masters = ids.slice(0, masterCount);
        const rest = ids.slice(masterCount);
        const masterNode = masters.length === 1 ? masters[0] : { type: "column", children: masters };
        const restNode = rest.length === 1 ? rest[0] : { type: "column", children: rest };
        const ratio = typeof spec.ratio === "number" ? spec.ratio : 0.5;
        const side = spec.side === "right" ? "right" : "left";
        tree = {
          type: "row",
          children: side === "right" ? [restNode, masterNode] : [masterNode, restNode],
          sizes: side === "right" ? [1 - ratio, ratio] : [ratio, 1 - ratio],
        };
      }
    } else if (type === "tabs" || type === "monocle") {
      tree = treeFrom(ids, { type: "tabs" });
    } else {
      tree = treeFrom(ids, { type: "row" });
    }
    const layout = { type: "tree", tree };
    return result(setWorkspace(state, wsId, { layout }), [{ type: "layout/changed", workspace: wsId, layout }], [RENDER]);
  },

  /** Adjust a ratio: master-stack/spiral use `ratio`; BSP targets the split containing `id`. */
  "layout/set-ratio"(state, command) {
    const wsId = command.workspace ?? state.activeWorkspace;
    const ws = state.workspaces[wsId];
    if (!ws) return rejected(state, command, "unknown-workspace");
    const ratio = Math.min(0.95, Math.max(0.05, Number(command.ratio)));
    if (!Number.isFinite(ratio)) return rejected(state, command, "invalid-ratio");
    const next =
      ws.layout.type === "bsp"
        ? setLayout(state, wsId, (layout) => ({
            ...layout,
            tree: bspSetRatio(layout.tree, command.id ?? state.focus.window, ratio),
          }))
        : setLayout(state, wsId, (layout) => ({ ...layout, ratio }));
    return result(next, [{ type: "layout/ratio-changed", workspace: wsId, ratio }], [RENDER]);
  },

  /** BSP only: flip the split containing `id` between horizontal and vertical. */
  "layout/rotate-split"(state, command) {
    const wsId = command.workspace ?? state.activeWorkspace;
    const ws = state.workspaces[wsId];
    if (!ws || ws.layout.type !== "bsp") return rejected(state, command, "not-bsp");
    const next = setLayout(state, wsId, (layout) => ({ ...layout, tree: bspRotate(layout.tree, command.id ?? state.focus.window) }));
    return result(next, [{ type: "layout/split-rotated", workspace: wsId }], [RENDER]);
  },

  /**
   * Resize a persisted split, addressed by `path` (layout-specific — see
   * docs/PRD.md, "Split sizing"): `""` for columns/rows/master-stack, a
   * "0"/"1" string locating a BSP split (`bspNodeAt`), a depth string for
   * spiral. `weights` ([a, b], or one entry per child for columns/rows)
   * replaces the split's sizes outright; `delta` nudges the current ratio
   * (master-stack/bsp/spiral) or the pair at `index`/`index + 1`
   * (columns/rows, which must already have stored sizes to nudge — resize
   * with `weights` first). Pure and validated: an unresizable layout, an
   * unknown path, or a malformed value is rejected, never thrown.
   */
  "layout/resize-split"(state, command) {
    const wsId = command.workspace ?? state.activeWorkspace;
    const ws = state.workspaces[wsId];
    if (!ws) return rejected(state, command, "unknown-workspace");
    const spec = ws.layout;
    if (!spec || typeof spec !== "object" || typeof spec.type !== "string") {
      return rejected(state, command, "not-resizable");
    }
    const path = typeof command.path === "string" ? command.path : "";
    const hasDelta = typeof command.delta === "number" && Number.isFinite(command.delta);
    const hasWeights = Array.isArray(command.weights);
    if (hasWeights && (command.weights.length < 2 || !command.weights.every((w) => typeof w === "number" && Number.isFinite(w) && w > 0))) {
      return rejected(state, command, "invalid-weights");
    }
    if (!hasDelta && !hasWeights) return rejected(state, command, "missing-value");

    const clampRatio = (value) => Math.min(0.95, Math.max(0.05, value));
    const ratioFromPair = (a, b) => (a + b > 0 ? clampRatio(a / (a + b)) : 0.5);

    let layout;
    if (spec.type === "master-stack") {
      if (path !== "") return rejected(state, command, "unknown-split");
      const side = spec.side === "right" ? "right" : "left";
      const current = typeof spec.ratio === "number" ? spec.ratio : 0.5;
      let ratio;
      if (hasWeights) {
        const [a, b] = command.weights;
        ratio = side === "right" ? ratioFromPair(b, a) : ratioFromPair(a, b);
      } else {
        ratio = clampRatio(current + (side === "right" ? -command.delta : command.delta));
      }
      layout = { ...spec, ratio };
    } else if (spec.type === "bsp") {
      if (!/^[01]*$/.test(path)) return rejected(state, command, "invalid-path");
      const node = bspNodeAt(spec.tree ?? null, path);
      if (!node) return rejected(state, command, "unknown-split");
      const ratio = hasWeights ? ratioFromPair(command.weights[0], command.weights[1]) : clampRatio(node.ratio + command.delta);
      layout = { ...spec, tree: bspSetRatioAt(spec.tree, path, ratio) };
    } else if (spec.type === "spiral") {
      const depth = Number(path);
      if (path === "" || !Number.isInteger(depth) || depth < 0) return rejected(state, command, "invalid-path");
      const ratios = Array.isArray(spec.ratios) ? spec.ratios.slice() : [];
      const current = typeof ratios[depth] === "number" ? ratios[depth] : typeof spec.ratio === "number" ? spec.ratio : 0.5;
      ratios[depth] = hasWeights ? ratioFromPair(command.weights[0], command.weights[1]) : clampRatio(current + command.delta);
      layout = { ...spec, ratios };
    } else if (spec.type === "columns" || spec.type === "rows") {
      if (path !== "") return rejected(state, command, "unknown-split");
      const stored = Array.isArray(spec.sizes?.[""]) ? spec.sizes[""] : null;
      const index = Number.isInteger(command.index) ? command.index : 0;
      if (index < 0) return rejected(state, command, "invalid-index");
      let weights;
      if (hasWeights) {
        weights = command.weights.slice();
      } else {
        if (!stored || index + 1 >= stored.length) return rejected(state, command, "missing-weights");
        weights = stored.slice();
        const total = weights[index] + weights[index + 1];
        const min = total * 0.05;
        const a = Math.min(total - min, Math.max(min, weights[index] + command.delta));
        weights[index] = a;
        weights[index + 1] = total - a;
      }
      layout = { ...spec, sizes: { ...(spec.sizes ?? {}), "": weights } };
    } else if (spec.type === "tree") {
      if (!/^(\d+(,\d+)*)?$/.test(path)) return rejected(state, command, "invalid-path");
      const node = treeNodeAt(spec.tree ?? null, path);
      if (!node || node.type === "tabs") return rejected(state, command, "unknown-split");
      const n = node.children.length;
      const index = Number.isInteger(command.index) ? command.index : 0;
      let weights;
      if (hasWeights) {
        if (command.weights.length !== n) return rejected(state, command, "invalid-weights");
        weights = command.weights.slice();
      } else {
        if (index < 0 || index + 1 >= n) return rejected(state, command, "invalid-index");
        const stored = Array.isArray(node.sizes) && node.sizes.length === n ? node.sizes : new Array(n).fill(1);
        weights = stored.slice();
        const total = weights[index] + weights[index + 1];
        const min = total * 0.05;
        const a = Math.min(total - min, Math.max(min, weights[index] + command.delta));
        weights[index] = a;
        weights[index + 1] = total - a;
      }
      layout = { ...spec, tree: treeSetSizesAt(spec.tree, path, weights) };
    } else {
      return rejected(state, command, "not-resizable");
    }
    const next = setLayout(state, wsId, () => layout);
    return result(next, [{ type: "layout/split-resized", workspace: wsId, path }], [RENDER]);
  },

  /**
   * xmonad-style `ToggleLayouts a b`: flip a workspace between two stored
   * layout specs. `a`/`b` are optional after the first call — omitted, the
   * pair last given (`workspace.toggleLayouts`) is reused, so a bound key can
   * dispatch `{ type: "layout/toggle" }` with no arguments every time. The
   * current layout is compared to `a` by `type` alone (ratios, BSP trees,
   * modifiers, … may have drifted since); anything not `a` switches to `a`.
   */
  "layout/toggle"(state, command) {
    const wsId = command.workspace ?? state.activeWorkspace;
    const ws = state.workspaces[wsId];
    if (!ws) return rejected(state, command, "unknown-workspace");
    const stored = ws.toggleLayouts;
    const a = command.a ?? stored?.[0];
    const b = command.b ?? stored?.[1];
    if (!isValidLayoutSpec(a) || !isValidLayoutSpec(b)) return rejected(state, command, "invalid-layout");
    const sameType = (x, y) => (typeof x === "function" || typeof y === "function" ? x === y : x.type === y.type);
    const target = sameType(ws.layout, a) ? b : a;
    const layout = seedTree(state, ws, seedBspTree(state, ws, target));
    const next = setWorkspace(state, wsId, { layout, toggleLayouts: [a, b] });
    return result(next, [{ type: "layout/toggled", workspace: wsId, layout }], [RENDER]);
  },

  /** Shallow patch; plain-object values (drag, defaultPlacement) merge one level deep. */
  "config/set"(state, command) {
    const { type: _type, ...patch } = command;
    const drag = patch.drag;
    if (drag !== undefined) {
      if (!isPlainObject(drag)) return rejected(state, command, "invalid-config");
      if (drag.tiled !== undefined && !DRAG_MODES.includes(drag.tiled)) return rejected(state, command, "invalid-config");
      if (drag.tooSmall !== undefined && drag.tooSmall !== "allow" && drag.tooSmall !== "reject") return rejected(state, command, "invalid-config");
      if (drag.edgeZone !== undefined && !(Number(drag.edgeZone) >= 0 && Number(drag.edgeZone) <= 0.5)) return rejected(state, command, "invalid-config");
      if (drag.toFloating !== undefined && !["modifier", "threshold", "off"].includes(drag.toFloating)) return rejected(state, command, "invalid-config");
      if (drag.toTiled !== undefined && !["modifier", "always", "off"].includes(drag.toTiled)) return rejected(state, command, "invalid-config");
    }
    if (patch.rules !== undefined && !validRules(patch.rules)) return rejected(state, command, "invalid-config");
    const urgency = patch.urgency;
    if (urgency !== undefined) {
      if (!isPlainObject(urgency)) return rejected(state, command, "invalid-config");
      if (urgency.clearOnFocus !== undefined && typeof urgency.clearOnFocus !== "boolean") return rejected(state, command, "invalid-config");
    }
    const snap = patch.snap;
    if (snap !== undefined) {
      if (!isPlainObject(snap)) return rejected(state, command, "invalid-config");
      if (snap.edges !== undefined && typeof snap.edges !== "boolean") return rejected(state, command, "invalid-config");
      if (snap.threshold !== undefined && !(Number(snap.threshold) >= 0)) return rejected(state, command, "invalid-config");
      if (snap.magnet !== undefined && !(Number(snap.magnet) >= 0)) return rejected(state, command, "invalid-config");
      if (snap.zones !== undefined && !["halves-quarters", "halves", "quarters", "off"].includes(snap.zones)) return rejected(state, command, "invalid-config");
    }
    const config = { ...state.config };
    for (const [key, value] of Object.entries(patch)) {
      config[key] = isPlainObject(value) && isPlainObject(config[key]) ? { ...config[key], ...value } : value;
    }
    return result({ ...state, config }, [{ type: "config/changed", patch }], [RENDER]);
  },

  /** Replace `config.rules` wholesale. Shorthand for `config/set` with just `rules`. */
  "rules/set"(state, command) {
    const { rules } = command;
    if (!validRules(rules)) return rejected(state, command, "invalid-rules");
    return result({ ...state, config: { ...state.config, rules: [...rules] } }, [{ type: "rules/changed", rules }], [RENDER]);
  },

  /**
   * Create a new output (sway-style display/stage): its own workspace(s),
   * disjoint from every other output. `workspaces` (ids, or `{ id, layout }`
   * objects, like `createState`) defaults to a single `"<id>-1"` workspace.
   * `focus: true` also focuses the new output (see `output/focus`).
   */
  "output/create"(state, command) {
    const { id } = command;
    if (typeof id !== "string" || !id) return rejected(state, command, "missing-id");
    if (state.outputs[id]) return rejected(state, command, "duplicate-id");
    const specs = command.workspaces ?? [`${id}-1`];
    if (!Array.isArray(specs) || specs.length === 0) return rejected(state, command, "missing-workspaces");
    const list = [];
    for (const spec of specs) {
      const wsId = typeof spec === "string" ? spec : spec?.id;
      if (typeof wsId !== "string" || !wsId) return rejected(state, command, "missing-id");
      if (state.workspaces[wsId] || list.some((ws) => ws.id === wsId)) return rejected(state, command, "duplicate-id");
      list.push(createWorkspace(typeof spec === "string" ? { id: spec, output: id } : { ...spec, output: id }));
    }
    let next = {
      ...state,
      workspaces: { ...state.workspaces, ...Object.fromEntries(list.map((ws) => [ws.id, ws])) },
      workspaceOrder: [...state.workspaceOrder, ...list.map((ws) => ws.id)],
      outputs: { ...state.outputs, [id]: createOutput({ id, workspaces: list.map((ws) => ws.id) }) },
      outputOrder: [...state.outputOrder, id],
    };
    const created = result(next, [{ type: "output/created", id, workspaces: list.map((ws) => ws.id) }], [RENDER]);
    return command.focus ? merge(created, handlers["output/focus"](next, { type: "output/focus", id })) : created;
  },

  /**
   * Remove an output, moving all of its workspaces (and their windows) onto
   * `fallback` (default: another existing output). Rejected when it is the
   * only output (there is always at least one).
   */
  "output/remove"(state, command) {
    const { id } = command;
    if (!state.outputs[id]) return rejected(state, command, "unknown-output");
    if (state.outputOrder.length === 1) return rejected(state, command, "last-output");
    const fallback = command.fallback ?? state.outputOrder.find((oid) => oid !== id);
    if (!state.outputs[fallback] || fallback === id) return rejected(state, command, "unknown-output");
    const moving = state.outputs[id].workspaces;
    const workspaces = { ...state.workspaces };
    for (const wsId of moving) workspaces[wsId] = { ...workspaces[wsId], output: fallback };
    const fbOutput = state.outputs[fallback];
    let next = {
      ...state,
      workspaces,
      outputs: { ...state.outputs, [fallback]: { ...fbOutput, workspaces: [...fbOutput.workspaces, ...moving] } },
    };
    const { [id]: _gone, ...outputs } = next.outputs;
    next = { ...next, outputs, outputOrder: without(next.outputOrder, id) };
    if (next.focusedOutput === id) {
      next = { ...next, focusedOutput: fallback, activeWorkspace: next.outputs[fallback].activeWorkspace };
    }
    const removed = result(next, [{ type: "output/removed", id, fallback, workspaces: moving }], [RENDER]);
    return merge(removed, refocus(next));
  },

  /**
   * Focus another output: the source of `workspace/activated`'s cross-output
   * counterpart. Keyboard focus follows to a focusable window on the newly
   * focused output's active workspace when the current focus isn't already
   * there (most-recently-focused first, like `refocus`), else it clears.
   */
  "output/focus"(state, command) {
    const { id } = command;
    if (!state.outputs[id]) return rejected(state, command, "unknown-output");
    if (state.focusedOutput === id) return result(state);
    const previous = state.focusedOutput;
    const next = { ...state, focusedOutput: id, activeWorkspace: state.outputs[id].activeWorkspace };
    const focused = result(next, [{ type: "output/focused", id, previous }], [RENDER]);
    const focusWin = next.focus.window ? next.windows[next.focus.window] : null;
    const focusedWs = focusWin?.workspace != null ? next.workspaces[focusWin.workspace] : undefined;
    if (focusedWs?.output === id) return focused;
    const candidates = focusable(next, id);
    if (candidates.length === 0) {
      if (!next.focus.window) return focused;
      const blurred = { ...next, focus: { ...next.focus, window: null } };
      return merge(focused, result(blurred, [{ type: "window/blurred", id: next.focus.window }], [{ type: "focus", id: null }]));
    }
    const history = next.focus.history.filter((wid) => next.windows[wid]);
    const pick = [...history].reverse().find((wid) => candidates.includes(wid)) ?? candidates[candidates.length - 1];
    return merge(focused, applyFocus(next, pick));
  },

  ...dropHandlers(),
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Cycle focus among focusable windows, wrapping across outputs: every
 * output's own focusable windows, concatenated in `outputOrder`. A single
 * output degenerates to cycling within it, as before.
 */
function cycleFocus(state, direction) {
  const entries = state.outputOrder.flatMap((oid) => focusable(state, oid).map((wid) => ({ wid, oid })));
  if (entries.length === 0) return result(state);
  const index = entries.findIndex((entry) => entry.wid === state.focus.window);
  const nextIndex = index === -1 ? 0 : (index + direction + entries.length) % entries.length;
  const target = entries[nextIndex];
  if (target.oid === state.focusedOutput) return applyFocus(state, target.wid);
  const switched = { ...state, focusedOutput: target.oid, activeWorkspace: state.outputs[target.oid].activeWorkspace };
  const outputEvent = result(switched, [{ type: "output/focused", id: target.oid, previous: state.focusedOutput }], [RENDER]);
  return merge(outputEvent, applyFocus(switched, target.wid));
}

function setStatus(state, command, status) {
  const win = state.windows[command.id];
  if (!win) return rejected(state, command, "unknown-window");
  if (!STATUSES.includes(status)) return rejected(state, command, "unknown-status");
  if (win.status === status) return result(state);
  const next = setWindow(state, win.id, { status });
  const changed = result(next, [{ type: `window/status-changed`, id: win.id, status, previous: win.status }], [RENDER]);
  if (status === "minimized") return merge(changed, refocus(next));
  // Taking over the screen takes focus with it (only when the window is on screen to begin with).
  if ((status === "fullscreen" || status === "maximized") && isVisible(next, win.id)) return merge(changed, applyFocus(next, win.id));
  return changed;
}

/**
 * Command fields that name a window, workspace or output. A name that is also
 * an `Object.prototype` key (`__proto__`, `constructor`, ...) would make a
 * plain `state.windows[id]` lookup find an inherited non-window, so those
 * names are refused up front.
 */
const NAME_FIELDS = ["id", "a", "b", "target", "parent", "workspace", "output", "fallback"];
const hasReservedName = (command) => NAME_FIELDS.some((field) => typeof command[field] === "string" && command[field] in Object.prototype);

/** Names of all built-in commands. */
export const COMMANDS = Object.freeze(Object.keys(handlers));

/**
 * Apply one command. Unknown commands are rejected, never thrown.
 * `extensions` may add or override handlers: { "my/command": (state, cmd) => ({ state, events, effects }) }.
 */
export const update = (state, command, extensions) => {
  if (!command || typeof command.type !== "string") {
    return rejected(state, { type: String(command?.type) }, "invalid-command");
  }
  const handler = extensions?.[command.type] ?? handlers[command.type];
  if (!handler) return rejected(state, command, "unknown-command");
  if (hasReservedName(command)) return rejected(state, command, "invalid-id");
  const out = handler(state, command);
  return result(out.state, out.events ?? [], dedupeEffects(out.effects ?? []));
};

/** `update` returning only the next state. */
export const reduce = (state, command, extensions) => update(state, command, extensions).state;

/**
 * Replay a list of commands from an initial state (event-log style). The
 * starting state is migrated first, so replaying from an older saved origin
 * still lands on the same state a fresh `createState()` origin would.
 * A state migrate rejects (a future version, or no migration path) is
 * replayed as given, since there is nothing sound to upgrade it to.
 */
export const replay = (state, commands, extensions) => {
  const migrated = migrate(state);
  return commands.reduce((acc, cmd) => reduce(acc, cmd, extensions), migrated.ok ? migrated.state : state);
};
