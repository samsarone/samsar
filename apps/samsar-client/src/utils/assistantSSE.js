export async function readAssistantSSE(response, onEvent, signal) {
  if (!response.ok) throw Object.assign(new Error('Assistant stream unavailable.'), { status: response.status });
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    throw new Error('Assistant streaming is not supported by this server.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
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
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function assistantMessagesFromSnapshot(snapshot) {
  const messages = snapshot.sessionMessages || [];
  const stream = snapshot.assistantStream;
  if ((!stream?.text && stream?.status !== 'interrupted') || messages.some(message => message.role === 'assistant' && message.id === stream.queryId)) return messages;
  return [...messages, { id: stream.queryId, role: 'assistant', content: stream.text || '',
    assistantStreamStatus: stream.status }];
}
