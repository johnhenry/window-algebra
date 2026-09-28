/**
 * Undo/redo over any pure reducer. History is itself plain data:
 * { past: State[], present: State, future: State[] }.
 */

export const createHistory = (present, { limit = 100 } = {}) => ({ past: [], present, future: [], limit });

/** Record the result of applying `fn(present)` as a new present. No-op changes are not recorded. */
export const record = (history, nextPresent) => {
  if (nextPresent === history.present) return history;
  const past = [...history.past, history.present];
  if (past.length > history.limit) past.shift();
  return { ...history, past, present: nextPresent, future: [] };
};

export const canUndo = (history) => history.past.length > 0;
export const canRedo = (history) => history.future.length > 0;

export const undo = (history) => {
  if (!canUndo(history)) return history;
  const past = history.past.slice(0, -1);
  return { ...history, past, present: history.past[history.past.length - 1], future: [history.present, ...history.future] };
};

export const redo = (history) => {
  if (!canRedo(history)) return history;
  const [present, ...future] = history.future;
  return { ...history, past: [...history.past, history.present], present, future };
};
