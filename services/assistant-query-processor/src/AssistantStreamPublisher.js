// Progress delivery is best effort; final provider usage always reaches settlement.
export function createAssistantStreamPublisher(write, { queryId, sessionVersion = 0, intervalMs = 300 } = {}) {
  let text = '', sequence = 0, lastWrite = 0, metadata = {}, inFlight;
  async function publish(status, force = false) {
    if (force && inFlight) await inFlight;
    if (!force && (inFlight || Date.now() - lastWrite < intervalMs)) return;
    lastWrite = Date.now();
    const snapshot = { queryId, sessionVersion, text, sequence: ++sequence, status,
      ...metadata, updatedAt: new Date().toISOString() };
    // Keep one write in flight; slow storage must not stall provider consumption.
    inFlight = Promise.resolve().then(() => write(snapshot)).catch(error => {
      console.error('[assistant-stream] Progress persistence failed:', error.message);
    }).finally(() => { inFlight = null; });
    if (force) await inFlight;
  }
  return {
    restore: (snapshot) => { if (snapshot?.queryId === queryId) { text = snapshot.text || ''; sequence = snapshot.sequence || 0; } },
    onText: async (value, details = {}) => { text = value; metadata = { ...metadata, ...details }; await publish('streaming'); },
    finish: async (status, details = {}) => { metadata = { ...metadata, ...details }; await publish(status, true); },
  };
}
