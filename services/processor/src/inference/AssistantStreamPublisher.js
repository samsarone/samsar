// Progress delivery is best effort; final provider usage always reaches settlement.
export function createAssistantStreamPublisher(write, { queryId, sessionVersion = 0, intervalMs = 300 } = {}) {
  let text = '', sequence = 0, lastWrite = 0, metadata = {}, inFlight, timer;
  let dirty = false, hasPublishedText = false, finishing = false, closed = false;

  function publish(status) {
    dirty = false;
    lastWrite = Date.now();
    hasPublishedText ||= Boolean(text);
    const snapshot = { queryId, sessionVersion, text, sequence: ++sequence, status,
      ...metadata, updatedAt: new Date().toISOString() };
    // Keep one write in flight; slow storage must not stall provider consumption.
    inFlight = Promise.resolve().then(() => write(snapshot)).catch(error => {
      console.error('[assistant-stream] Progress persistence failed:', error.message);
    }).finally(() => { inFlight = null; schedule(); });
    return inFlight;
  }

  function schedule() {
    if (!dirty || inFlight || timer || finishing || closed) return;
    // An empty starting snapshot must not delay the first visible text.
    const delay = hasPublishedText ? Math.max(0, intervalMs - (Date.now() - lastWrite)) : 0;
    if (!delay) { publish('streaming'); return; }
    // Flush the latest chunk even if the provider pauses before its next event.
    timer = setTimeout(() => { timer = null; schedule(); }, delay);
    timer.unref?.();
  }

  return {
    restore: (snapshot) => {
      if (snapshot?.queryId === queryId) { text = snapshot.text || ''; sequence = snapshot.sequence || 0; }
    },
    onText: async (value, details = {}) => {
      if (closed) return;
      text = value; metadata = { ...metadata, ...details }; dirty = true; schedule();
    },
    finish: async (status, details = {}) => {
      finishing = true;
      clearTimeout(timer); timer = null;
      if (inFlight) await inFlight;
      metadata = { ...metadata, ...details };
      await publish(status);
      closed = status !== 'streaming';
      finishing = false;
      schedule();
    },
  };
}
