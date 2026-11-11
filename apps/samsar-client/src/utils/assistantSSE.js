function structuredDeliveryMessage(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  return [data.error, data.error?.message, data.message, data.detail]
    .find(value => typeof value === 'string' && value.trim())?.trim() || '';
}

export function isTerminalAssistantDeliveryError(error) {
  const status = Number(error?.response?.status ?? error?.status);
  if ([401, 403, 404].includes(status)) return true;
  if (status !== 400) return false;
  const data = error?.response?.data;
  const code = typeof data?.code === 'string' ? data.code.trim() : '';
  if (code && !/^(?:BAD_REQUEST|ERR_BAD_REQUEST|HTTP_?400)$/i.test(code)) return true;
  const message = structuredDeliveryMessage(data);
  return Boolean(message && !/^(?:bad request|(?:http\s*)?400(?:\s+bad request)?|request failed(?: with status(?: code)? 400)?|assistant stream unavailable\.?)$/i.test(message));
}

export function assistantDeliveryErrorMessage(error) {
  return structuredDeliveryMessage(error?.response?.data) || error?.message || 'Unable to load. Please try again.';
}

export async function readAssistantSSE(response, onEvent, signal, onActivity) {
  if (!response.ok) {
    let data;
    try { data = await response.json(); } catch { /* A proxy may return an empty or non-JSON error. */ }
    const failure = { status: response.status, response: { status: response.status, data } };
    throw Object.assign(new Error(assistantDeliveryErrorMessage(failure)), failure);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    throw new Error('Assistant streaming is not supported by this server.');
  }
  const reader = response.body.getReader();
  // Aborting fetch does not always release a reader supplied by a proxy or a
  // custom transport. Wake a blocked read explicitly on navigation/timeout.
  let cancelled = false;
  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      onActivity?.(); // Heartbeat comments establish contact without advancing answer progress.
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 16 * 1024 * 1024) throw new Error('Assistant event is too large.');
      let separator;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        let name = 'message'; const data = [];
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) name = line.slice(6).trim();
          if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length && !signal?.aborted) await onEvent(name, JSON.parse(data.join('\n')));
        if (['settled', 'reconnect', 'error'].includes(name)) return;
      }
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

export function assistantMessagesFromSnapshot(snapshot) {
  // Polling may merge server progress with UI state containing the previous
  // provisional reply. Replace that reply, while preserving saved messages.
  const messages = (snapshot.sessionMessages || []).filter(message => !message.assistantStreamStatus);
  const stream = snapshot.assistantStream;
  if ((!stream?.text && stream?.status !== 'interrupted') || messages.some(message => message.role === 'assistant' && message.id === stream.queryId)) return messages;
  return [...messages, { id: stream.queryId, role: 'assistant', content: stream.text || '',
    assistantStreamStatus: stream.status }];
}
