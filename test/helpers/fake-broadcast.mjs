/**
 * A fake BroadcastChannel for Node. Messages are structured-cloned (like the
 * real thing, so a function in a payload throws DataCloneError) and queued
 * per hub; nothing is delivered until the test calls `hub.deliver()`, which
 * makes "two tabs change concurrently" deterministic. The sender never hears
 * its own messages, as with the real API.
 */
export const createBroadcastHub = () => {
  const channels = new Map(); // name -> Set<FakeChannel>
  const queue = [];
  const sent = [];
  class FakeBroadcastChannel {
    #listeners = new Set();
    onmessage = null;
    closed = false;
    constructor(name) {
      this.name = name;
      if (!channels.has(name)) channels.set(name, new Set());
      channels.get(name).add(this);
    }
    postMessage(data) {
      if (this.closed) throw new Error("InvalidStateError: channel is closed");
      const copy = structuredClone(data);
      sent.push(copy);
      queue.push({ from: this, data: copy });
    }
    addEventListener(type, fn) {
      if (type === "message") this.#listeners.add(fn);
    }
    removeEventListener(type, fn) {
      if (type === "message") this.#listeners.delete(fn);
    }
    close() {
      this.closed = true;
      channels.get(this.name)?.delete(this);
    }
    _receive(data) {
      const event = { data };
      for (const fn of this.#listeners) fn(event);
      this.onmessage?.(event);
    }
  }
  return {
    BroadcastChannel: FakeBroadcastChannel,
    /** Every message ever posted (cloned), in order. */
    sent,
    /** Deliver queued messages (including any posted while delivering) until the queue is empty. */
    deliver() {
      let guard = 0;
      while (queue.length) {
        if (++guard > 1000) throw new Error("fake-broadcast: message storm (an echo loop?)");
        const { from, data } = queue.shift();
        for (const channel of channels.get(from.name) ?? []) if (channel !== from && !channel.closed) channel._receive(structuredClone(data));
      }
    },
    pending: () => queue.length,
  };
};
