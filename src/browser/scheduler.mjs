/**
 * Frame-coalescing commits: many commands, one DOM commit per frame
 * (in the spirit of double-buffered, transactional compositor state).
 * Only the most recently scheduled task runs.
 */
export const createFrameScheduler = (
  requestFrame = globalThis.requestAnimationFrame?.bind(globalThis) ?? ((fn) => setTimeout(fn, 16)),
) => {
  let pending = null;
  let queued = false;
  return (task) => {
    pending = task;
    if (queued) return;
    queued = true;
    requestFrame(() => {
      queued = false;
      const run = pending;
      pending = null;
      run?.();
    });
  };
};

/** Run tasks immediately (tests, server rendering). */
export const immediateScheduler = (task) => task();
