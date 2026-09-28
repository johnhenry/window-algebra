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
 * @param {{ commit(renderTree): void, measure?(): object }} [options.renderer]
 * @param {(task: () => void) => void} [options.schedule] commit scheduler (default: immediate)
 * @param {boolean|number} [options.history] enable undo/redo (number = limit)
 * @param {(effect: object, wm: object) => void} [options.onEffect] interpret effects
 *
 * Gestures: commands carrying the same `gesture` token in a row (a floating
 * drag's stream of window/move, say) form one history step and one log entry.
 * Runs of absolute setters (window/move with x and y, window/resize with
 * x, y, width and height) collapse to their last command, so a whole drag
 * logs as one command and `replay(origin, log)` still equals the state.
 */
export const createWindowManager = ({
  state: initial = createState(),
  layouts,
  modifiers,
  extensions: extraHandlers,
  drops,
  renderer,
  schedule = immediateScheduler,
  history: historyOption = false,
  onEffect,
} = {}) => {
  const dropRegistry = { ...DROPS, ...drops };
  const extensions = drops ? { ...dropHandlers(dropRegistry), ...extraHandlers } : extraHandlers;
  let history = createHistory(initial, { limit: typeof historyOption === "number" ? historyOption : 100 });
  const listeners = new Set();
  // The command log mirrors history: undo moves the last entry aside and redo
  // puts it back, so `replay(wm.origin, wm.log)` always equals the present
  // state. A `load()` is recorded as a marker that starts a new origin.
  let entries = [];
  let undone = [];
  const lastLoad = () => entries.findLastIndex((entry) => entry.load !== undefined);

  const getState = () => history.present;

  const present = (state = getState()) => {
    const tree = derive(state, { layouts, modifiers });
    return { tree, render: compile(tree, presentationContext(state)) };
  };

  const render = () => {
    if (!renderer) return;
    schedule(() => renderer.commit(present().render));
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
        // pushed the pre-gesture state) and extend the entry.
        history = { ...history, present: out.state, future: [] };
        entries[entries.length - 1] = { gesture: token, commands: coalesce(last.commands, command) };
      } else {
        history = historyOption ? record(history, out.state) : { ...history, present: out.state };
        entries.push(token != null ? { gesture: token, commands: [command] } : { command });
      }
      undone = [];
    }
    const wm = api;
    for (const effect of out.effects) {
      if (effect.type === "render") render();
      else onEffect?.(effect, wm);
    }
    notify(out.events, command);
    return out;
  };

  const travel = (fn, direction) => {
    const before = getState();
    history = fn(history);
    if (getState() !== before) {
      if (direction < 0 && entries.length) undone.unshift(entries.pop());
      if (direction > 0 && undone.length) entries.push(undone.shift());
      render();
      notify([{ type: "history/changed" }], null);
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
    promote: command("window/promote"),
    swap: (a, b) => dispatch({ type: "window/swap", a, b }),
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
    setSticky: (id, sticky) => dispatch({ type: "window/set-sticky", id, sticky }),
    createWorkspace: (id, options = {}) => dispatch({ ...options, type: "workspace/create", id }),
    activateWorkspace: command("workspace/activate"),
    setLayout: (layout, workspace) => dispatch({ type: "layout/set", layout, workspace }),
    setRatio: (ratio, options = {}) => dispatch({ ...options, type: "layout/set-ratio", ratio }),
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
      history = historyOption ? record(history, next) : { ...history, present: next };
      entries.push({ load: next });
      undone = [];
      render();
      notify([{ type: "state/loaded" }], null);
      return next;
    },
  };

  return api;
};
