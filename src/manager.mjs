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

/**
 * @param {object} [options]
 * @param {object} [options.state] initial state (default: createState())
 * @param {object} [options.layouts] extra layout interpreters for derive
 * @param {object} [options.extensions] extra command handlers for update
 * @param {{ commit(renderTree): void, measure?(): object }} [options.renderer]
 * @param {(task: () => void) => void} [options.schedule] commit scheduler (default: immediate)
 * @param {boolean|number} [options.history] enable undo/redo (number = limit)
 * @param {(effect: object, wm: object) => void} [options.onEffect] interpret effects
 */
export const createWindowManager = ({
  state: initial = createState(),
  layouts,
  extensions,
  renderer,
  schedule = immediateScheduler,
  history: historyOption = false,
  onEffect,
} = {}) => {
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
    const tree = derive(state, { layouts });
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
  const unknownLayout = (command) => {
    if (command?.type !== "layout/set" && command?.type !== "workspace/create") return false;
    const layout = command.layout;
    if (!layout || typeof layout === "function" || typeof layout.type !== "string") return false;
    return !(layout.type in LAYOUTS) && !(layouts && layout.type in layouts);
  };

  const dispatch = (command) => {
    const out = unknownLayout(command)
      ? {
          state: getState(),
          events: [{ type: "command/rejected", command: command.type, id: command.id, reason: "unknown-layout" }],
          effects: [],
        }
      : update(getState(), command, extensions);
    if (out.state !== getState()) {
      history = historyOption ? record(history, out.state) : { ...history, present: out.state };
      entries.push({ command });
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
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Derived presentation tree and compiled render tree for the current state. */
    present,
    render,
    /** Commands applied since `origin` (for replay/sync); undone commands are excluded. */
    get log() {
      return entries.slice(lastLoad() + 1).map((entry) => entry.command);
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
    moveToWorkspace: (id, workspace) => dispatch({ type: "window/move-to-workspace", id, workspace }),
    createWorkspace: (id, options = {}) => dispatch({ ...options, type: "workspace/create", id }),
    activateWorkspace: command("workspace/activate"),
    setLayout: (layout, workspace) => dispatch({ type: "layout/set", layout, workspace }),
    setRatio: (ratio, options = {}) => dispatch({ ...options, type: "layout/set-ratio", ratio }),

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
    /** Replace the logical state wholesale (restore a saved session). */
    load(state) {
      const next = typeof state === "string" ? JSON.parse(state) : state;
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
