/**
 * The imperative facade: `wm.focus("editor")` ergonomics over the pure core.
 * It is a coordinator, not a god object: it holds the current state, runs
 * `update`, keeps optional history, notifies subscribers, and hands the
 * derived presentation to a renderer on a schedule.
 */
import { createState } from "./state/create.mjs";
import { update } from "./state/update.mjs";
import { derive, presentationContext, LAYOUTS } from "./state/derive.mjs";
import { createHistory, record, undo as undoHistory, redo as redoHistory, canUndo, canRedo } from "./state/history.mjs";
import { compile } from "./css/compile.mjs";
import { immediateScheduler } from "./browser/scheduler.mjs";
import { DROPS, dropHandlers } from "./state/drops.mjs";
import { migrate } from "./state/migrate.mjs";

/**
 * Commands whose last application within a gesture subsumes the earlier ones
 * (absolute setters), so a coalesced gesture keeps only the last of a run.
 */
const absolute = (command) =>
  command.type === "window/move"
    ? command.x != null && command.y != null
    : command.type === "window/resize"
      ? ["x", "y", "width", "height"].every((key) => command[key] != null)
      : false;

const coalesce = (commands, command) => {
  const previous = commands[commands.length - 1];
  return absolute(command) && previous?.type === command.type && previous.id === command.id
    ? [...commands.slice(0, -1), command]
    : [...commands, command];
};

/**
 * @param {object} [options]
 * @param {object} [options.state] initial state (default: createState())
 * @param {object} [options.layouts] extra layout interpreters for derive
 * @param {object} [options.modifiers] extra/override layout modifiers for derive (see `MODIFIERS`)
 * @param {object} [options.extensions] extra command handlers for update
 * @param {object} [options.drops] extra/override drop interpreters for window/drop, keyed by layout type
 * @param {{ commit(renderTree, opts?): void, measure?(): object }} [options.renderer] the renderer for the
 *   focused output (single-output use)
 * @param {object<string, { commit(renderTree, opts?): void, measure?(): object }>} [options.renderers] one
 *   renderer per output id, for driving several stages (multiple outputs) at once; see `setRenderer`
 *   to attach/replace/remove one later
 * @param {(task: () => void) => void} [options.schedule] commit scheduler (default: immediate)
 * @param {boolean|number|{ limit?: number, ignore?: Iterable<string> }} [options.history] enable
 *   undo/redo (number = limit); the object form also takes `ignore`, command types that are applied
 *   and logged but never become an undo step (focus and stacking, say)
 * @param {(effect: object, wm: object) => void} [options.onEffect] interpret effects
 *
 * Gestures: commands carrying the same `gesture` token in a row (a floating
 * drag's stream of window/move, say) form one history step and one log entry.
 * Runs of absolute setters (window/move with x and y, window/resize with
 * x, y, width and height) collapse to their last command, so a whole drag
 * logs as one command and `replay(origin, log)` still equals the state. A
 * `gesture` token (or an explicit `command.immediate: true`) also tells a
 * renderer's `animate` option to commit that render immediately, never
 * mid-transition (see `createDomRenderer`'s `animate` option).
 *
 * Ignored commands (`history.ignore`, or `history: false` on the command):
 * the state changes and the command is logged, but no undo step is pushed and
 * the redo stack is kept. History holds whole states, so an ignored change
 * rides along with the step before it: undo rolls it back with that step, and
 * redo brings it back. One made after an undo (while redo is available) is
 * discarded by the next undo or redo, which restore their snapshots exactly.
 * Either way `replay(origin, log)` still equals the state.
 */
export const createWindowManager = ({
  state: initial = createState(),
  layouts,
  modifiers,
  extensions: extraHandlers,
  drops,
  renderer,
  renderers,
  schedule = immediateScheduler,
  history: historyOption = false,
  onEffect,
} = {}) => {
  const dropRegistry = { ...DROPS, ...drops };
  const extensions = drops ? { ...dropHandlers(dropRegistry), ...extraHandlers } : extraHandlers;
  const historyConfig = typeof historyOption === "object" && historyOption !== null ? historyOption : {};
  const historyOn = Boolean(historyOption);
  const historyLimit = typeof historyOption === "number" ? historyOption : (historyConfig.limit ?? 100);
  const ignoredTypes = new Set(historyConfig.ignore ?? []);
  // A command's own `history` flag wins over the `ignore` list.
  const skipsHistory = (command) =>
    historyOn && command?.history !== true && (command?.history === false || ignoredTypes.has(command?.type));
  let history = createHistory(initial, { limit: historyLimit });
  const listeners = new Set();
  // One renderer per output, for driving several stages at once. `renderer`
  // (single-output) is kept alongside it, always addressing the focused
  // output's own tree, regardless of `renderers`.
  const rendererMap = new Map(Object.entries(renderers ?? {}));
  // The command log mirrors history: undo moves the last entry aside and redo
  // puts it back, so `replay(wm.origin, wm.log)` always equals the present
  // state. A `load()` is recorded as a marker that starts a new origin.
  //
  // An ignored command (see `skipsHistory`) is logged as an `ignored` entry
  // that belongs to the step before it: undo moves a step aside together with
  // the ignored entries after it, as one group. Ignored commands applied while
  // redo is available are `transient`: the next undo or redo first drops them
  // (and puts back `redoBase`, the state before them), so the snapshots in
  // `history.future` stay the states the log replays to.
  let entries = [];
  let undone = [];
  let transient = 0;
  let redoBase;
  const lastLoad = () => entries.findLastIndex((entry) => entry.load !== undefined);

  const getState = () => history.present;

  /** Derived presentation tree and compiled render tree, for an output (default: the focused one). */
  const present = (state = getState(), { output } = {}) => {
    const tree = derive(state, { layouts, modifiers, output });
    return { tree, render: compile(tree, presentationContext(state)) };
  };

  // A gesture (a floating drag's stream of window/move, say) or a command
  // explicitly marked `immediate` never animates, so an in-progress drag or
  // resize is never fighting a view transition for the element's position.
  const isImmediate = (command) => command?.gesture != null || command?.immediate === true;

  const render = (command) => {
    const opts = { immediate: isImmediate(command) };
    if (renderer) schedule(() => renderer.commit(present().render, opts));
    for (const [outputId, r] of rendererMap) {
      schedule(() => r.commit(present(getState(), { output: outputId }).render, opts));
    }
  };

  const notify = (events, command) => {
    for (const listener of listeners) listener(getState(), events, command);
  };

  /**
   * `update` is pure and cannot see the interpreter registry, so the manager
   * refuses layout specs no interpreter can derive (otherwise every later
   * render would throw).
   */
  const layoutIsUnknown = (layout) =>
    Boolean(layout) && typeof layout !== "function" && typeof layout.type === "string" &&
    !(layout.type in LAYOUTS) && !(layouts && layout.type in layouts);

  const unknownLayout = (command) => {
    if (command?.type === "layout/set" || command?.type === "workspace/create") return layoutIsUnknown(command.layout);
    if (command?.type === "layout/toggle") return layoutIsUnknown(command.a) || layoutIsUnknown(command.b);
    return false;
  };

  /** What a command would do, without doing it: no history, render, or notification. */
  const simulate = (command, state = getState()) =>
    unknownLayout(command)
      ? {
          state,
          events: [{ type: "command/rejected", command: command.type, id: command.id, reason: "unknown-layout" }],
          effects: [],
        }
      : update(state, command, extensions);

  const dispatch = (command) => {
    const out = simulate(command);
    if (out.state !== getState()) {
      const last = entries[entries.length - 1];
      const token = command?.gesture;
      if (token != null && undone.length === 0 && last?.gesture === token) {
        // Same gesture: replace the present (the gesture's first command already
        // pushed the pre-gesture state) and extend the entry. An ignored command
        // carrying the open gesture's token joins the gesture too.
        history = { ...history, present: out.state, future: [] };
        entries[entries.length - 1] = { gesture: token, commands: coalesce(last.commands, command) };
        undone = [];
      } else if (skipsHistory(command)) {
        // Applied and logged, but not an undo step: `past` and `future` stay.
        if (undone.length > 0) {
          if (transient === 0) redoBase = getState();
          transient += 1;
        }
        history = { ...history, present: out.state };
        entries.push({ command, ignored: true });
      } else {
        history = historyOn ? record(history, out.state) : { ...history, present: out.state };
        entries.push(token != null ? { gesture: token, commands: [command] } : { command });
        undone = [];
        transient = 0;
        redoBase = undefined;
      }
    }
    const wm = api;
    for (const effect of out.effects) {
      if (effect.type === "render") render(command);
      else onEffect?.(effect, wm);
    }
    notify(out.events, command);
    return out;
  };

  /**
   * Undo, redo and load replace the state without running `update`, so nothing
   * says where focus went. Report it the way a command would: the focus event
   * (`window/focused` or `window/blurred`) for subscribers, and a `focus`
   * effect for `onEffect`, so keyboard focus follows the restored WM focus.
   */
  const focusChange = (before, after) => {
    const previous = before.focus?.window ?? null;
    const id = after.focus?.window ?? null;
    if (previous === id) return [];
    onEffect?.({ type: "focus", id }, api);
    return [id ? { type: "window/focused", id, previous } : { type: "window/blurred", id: previous }];
  };

  const travel = (fn, direction) => {
    const before = getState();
    if (!(direction < 0 ? canUndo(history) : canRedo(history))) return before;
    if (transient > 0) {
      // Drop the ignored changes made since the undo, so the step lands exactly.
      entries.splice(entries.length - transient);
      history = { ...history, present: redoBase };
      transient = 0;
      redoBase = undefined;
    }
    history = fn(history);
    if (direction < 0) {
      // A step and the ignored entries that followed it move aside together.
      const end = entries.findLastIndex((entry) => !entry.ignored);
      if (end !== -1) undone.unshift(entries.splice(end));
    }
    if (direction > 0 && undone.length) entries.push(...undone.shift());
    if (getState() !== before) {
      render();
      notify([{ type: "history/changed" }, ...focusChange(before, getState())], null);
    }
    return getState();
  };

  const command = (type) => (id, rest = {}) => dispatch({ type, id, ...rest });

  const api = {
    getState,
    get state() {
      return getState();
    },
    dispatch,
    simulate,
    /** The drop-interpreter registry in effect (DROPS plus the `drops` option). */
    drops: dropRegistry,
    /** Command handlers passed to `update` (the `extensions` option plus custom drops), for pure dry runs. */
    extensions,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Derived presentation tree and compiled render tree for the current state. */
    present,
    render,
    /**
     * Attach, replace, or (passing no renderer) remove the renderer driving
     * a given output's stage, then render it immediately. Multiple outputs
     * are driven by calling this once per output id.
     */
    setRenderer(outputId, outputRenderer) {
      if (outputRenderer) rendererMap.set(outputId, outputRenderer);
      else rendererMap.delete(outputId);
      render();
    },
    /** Realized geometry for a given output's renderer, if it can measure. */
    measureOutput: (outputId) => rendererMap.get(outputId)?.measure?.() ?? {},
    /** Commands applied since `origin` (for replay/sync); undone commands are excluded. */
    get log() {
      return entries.slice(lastLoad() + 1).flatMap((entry) => entry.commands ?? [entry.command]);
    },
    /** The state `log` replays from: the initial state, or the last loaded one. */
    get origin() {
      const index = lastLoad();
      return index === -1 ? initial : entries[index].load;
    },
    /** Realized geometry, if the renderer can measure. */
    measure: () => renderer?.measure?.() ?? {},

    create: (options) => dispatch({ ...options, type: "window/create" }),
    close: command("window/close"),
    focus: command("window/focus"),
    blur: () => dispatch({ type: "window/blur" }),
    focusNext: () => dispatch({ type: "focus/next" }),
    focusPrevious: () => dispatch({ type: "focus/previous" }),
    /** Focus the oldest urgent window (switching workspace if needed). */
    focusUrgent: () => dispatch({ type: "focus/urgent" }),
    raise: command("window/raise"),
    lower: command("window/lower"),
    move: (id, x, y) => dispatch({ type: "window/move", id, x, y }),
    resize: (id, width, height) => dispatch({ type: "window/resize", id, width, height }),
    setMode: (id, mode) => dispatch({ type: "window/set-mode", id, mode }),
    toggleFloating: command("window/toggle-floating"),
    minimize: command("window/minimize"),
    maximize: command("window/maximize"),
    fullscreen: command("window/fullscreen"),
    restore: command("window/restore"),
    toggleMaximize: command("window/toggle-maximize"),
    toggleFullscreen: command("window/toggle-fullscreen"),
    /** GoldenLayout/Dockview-style pop-out; see `attachPopouts` for the actual browser window. */
    popOut: command("window/pop-out"),
    popIn: command("window/pop-in"),
    promote: command("window/promote"),
    swap: (id, target) => dispatch({ type: "window/swap", id, target }),
    /** Drop a tiled window onto another: zone "center" | "left" | "right" | "top" | "bottom". */
    drop: (id, target, zone, rest = {}) => dispatch({ ...rest, type: "window/drop", id, target, zone }),
    swapNext: (id) => dispatch({ type: "window/swap-next", id }),
    swapPrevious: (id) => dispatch({ type: "window/swap-previous", id }),
    moveBefore: (id, target) => dispatch({ type: "window/move-before", id, ...(target ? { target } : {}) }),
    moveAfter: (id, target) => dispatch({ type: "window/move-after", id, ...(target ? { target } : {}) }),
    setDraggable: (id, draggable) => dispatch({ type: "window/set-draggable", id, draggable }),
    /** Mark (or clear) a window's urgency hint; `urgent` defaults to true. */
    setUrgent: (id, urgent = true) => dispatch({ type: "window/set-urgent", id, urgent }),
    moveToWorkspace: (id, workspace) => dispatch({ type: "window/move-to-workspace", id, workspace }),
    toScratchpad: command("window/to-scratchpad"),
    toggleScratchpad: (id) => dispatch({ type: "scratchpad/toggle", ...(id ? { id } : {}) }),
    setSticky: (id, sticky = true) => dispatch({ type: "window/set-sticky", id, sticky }),
    toggleSticky: command("window/toggle-sticky"),
    createWorkspace: (id, options = {}) => dispatch({ ...options, type: "workspace/create", id }),
    activateWorkspace: command("workspace/activate"),
    /** Create a new output (sway-style display/stage); see `output/create`. */
    createOutput: (id, options = {}) => dispatch({ ...options, type: "output/create", id }),
    /** Remove an output, moving its workspaces onto `options.fallback` (default: another output). */
    removeOutput: (id, options = {}) => dispatch({ ...options, type: "output/remove", id }),
    /** Focus another output; keyboard focus follows to a window on it, if any. */
    focusOutput: command("output/focus"),
    /** Move a workspace (and everything on it) onto another output. */
    moveWorkspaceToOutput: (id, output, options = {}) => dispatch({ ...options, type: "workspace/move-to-output", id, output }),
    setLayout: (layout, workspace) => dispatch({ type: "layout/set", layout, workspace }),
    setRatio: (ratio, options = {}) => dispatch({ ...options, type: "layout/set-ratio", ratio }),
    /** Resize a persisted split: `resizeSplit(path, { delta } | { weights }, options)`. */
    resizeSplit: (path, change = {}, options = {}) => dispatch({ ...options, ...change, type: "layout/resize-split", path }),
    /** xmonad `ToggleLayouts`: flip between two stored layouts (`a`/`b` optional after the first call). */
    toggleLayout: (a, b, workspace) => dispatch({ type: "layout/toggle", a, b, workspace }),
    /** Replace `config.rules` wholesale. */
    setRules: (rules) => dispatch({ type: "rules/set", rules }),

    undo: () => travel(undoHistory, -1),
    redo: () => travel(redoHistory, 1),
    get canUndo() {
      return canUndo(history);
    },
    get canRedo() {
      return canRedo(history);
    },

    /** Serialize the logical state (the WM topology is just data). */
    serialize: () => JSON.stringify(getState()),
    /**
     * Replace the logical state wholesale (restore a saved session). The
     * incoming state is migrated to the current version first; a state this
     * build cannot understand (parse failure, or a newer version than
     * `STATE_VERSION`) is rejected — a `state/load-rejected` event fires and
     * the manager's own state is left untouched.
     */
    load(state) {
      let parsed;
      try {
        parsed = typeof state === "string" ? JSON.parse(state) : state;
      } catch {
        notify([{ type: "state/load-rejected", reason: "invalid-json" }], null);
        return null;
      }
      const migrated = migrate(parsed);
      if (!migrated.ok) {
        notify([{ type: "state/load-rejected", reason: migrated.reason, version: migrated.version }], null);
        return null;
      }
      const next = migrated.state;
      const before = getState();
      history = historyOn ? record(history, next) : { ...history, present: next };
      entries.push({ load: next });
      undone = [];
      transient = 0;
      redoBase = undefined;
      render();
      notify([{ type: "state/loaded" }, ...focusChange(before, next)], null);
      return next;
    },
  };

  return api;
};
