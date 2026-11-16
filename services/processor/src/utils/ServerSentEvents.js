// Snapshot events are replaceable, so slow/disconnected consumers never block
// generation or hold an unbounded queue of token deltas in memory.
export function openServerSentEvents(res) {
  res.status(200);
  // Let Node honor the request's connection lifetime. Forcing keep-alive on a
  // Connection: close request lets a proxy reuse a socket its parser has closed.
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  let closed = false, heartbeat;
  const close = () => { closed = true; clearInterval(heartbeat); };
  res.once('close', close);
  res.once('error', close);
  const send = (event, value, id) => {
    if (closed || res.destroyed || res.writableEnded) return false;
    if (res.writableLength > 1024 * 1024) { res.destroy(); close(); return false; }
    try {
      res.write(`${id ? `id: ${id}\n` : ''}event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
      res.flush?.(); // Flush compression middleware as well as the HTTP headers.
    }
    catch { close(); return false; }
    return true;
  };
  heartbeat = setInterval(() => {
    if (!closed && !res.writableNeedDrain) { try { res.write(': heartbeat\n\n'); res.flush?.(); } catch { close(); } }
  }, 10000);
  heartbeat.unref?.();
  return { send, get closed() { return closed; }, end() { close(); if (!res.writableEnded && !res.destroyed) res.end(); } };
}

export async function serveAssistantSnapshots(res, readSnapshot, { pollMs = 750, maxMs = 30000 } = {}) {
  let snapshot = await readSnapshot(); // Authorization errors remain ordinary REST errors.
  const stream = openServerSentEvents(res);
  const deadline = Date.now() + maxMs;
  let previous = '';
  try {
    while (!stream.closed && Date.now() < deadline) {
      const json = JSON.stringify(snapshot);
      if (json !== previous) {
        const state = snapshot.assistantStream;
        stream.send('snapshot', snapshot, `${snapshot.assistantSessionVersion}:${state?.queryId || 'empty'}:${state?.sequence || 0}:${state?.status || 'idle'}`);
        previous = json;
      }
      if (!snapshot.sessionMessageGenerationPending) {
        stream.send('settled', { sessionId: snapshot.sessionId });
        return;
      }
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); res.removeListener('close', done); resolve(); };
        const timer = setTimeout(done, pollMs);
        res.once('close', done);
      });
      if (!stream.closed) snapshot = await readSnapshot();
    }
    if (!stream.closed) stream.send('reconnect', {});
  } catch (error) {
    stream.send('error', { message: error.message, code: error.code, status: error.status || 500 });
  } finally { stream.end(); }
}
