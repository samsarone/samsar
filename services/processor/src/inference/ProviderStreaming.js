// Kept identical in processor/src/inference and the assistant worker.
const MAX_TEXT = 4 * 1024 * 1024;
export function streamInterrupted(cause) {
  return Object.assign(new Error(cause?.message || 'Provider stream ended before completion.', { cause }), {
    code: 'ASSISTANT_STREAM_INTERRUPTED', retryable: false, status: 502,
  });
}

export async function* readSSE(body) {
  if (!body) throw streamInterrupted(new Error('Provider returned no stream body.'));
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = frame => {
    let event = 'message'; const data = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    return data.length ? { event, data: data.join('\n') } : null;
  };
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    if (buffer.length > MAX_TEXT * 4) throw streamInterrupted(new Error('Stream event exceeded the size limit.'));
    let match;
    while ((match = /\r?\n\r?\n/.exec(buffer))) {
      const event = parse(buffer.slice(0, match.index));
      buffer = buffer.slice(match.index + match[0].length);
      if (event) yield event;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) { const event = parse(buffer); if (event) yield event; }
}

async function notify(onText, text, metadata = {}) {
  if (text.length > MAX_TEXT) throw streamInterrupted(new Error('Assistant output exceeded the size limit.'));
  // Delivery/storage failures cannot discard the provider's eventual usage receipt.
  if (onText) await Promise.resolve().then(() => onText(text, metadata)).catch(() => {});
}

export async function collectChatStream(stream, onText) {
  let id, model, usage = null, finished = false;
  const choices = new Map();
  try {
    for await (const chunk of stream) {
      if (chunk.error) throw new Error(chunk.error.message || 'Provider stream failed.');
      id ||= chunk.id; model = chunk.model || model;
      if (chunk.usage) usage = chunk.usage; // Usage is a cumulative receipt, never a delta to add.
      for (const entry of chunk.choices || []) {
        const index = entry.index || 0;
        const choice = choices.get(index) || { index, message: { role: 'assistant', content: '' }, finish_reason: null };
        const delta = entry.delta || {};
        if (entry.finish_reason === 'error') throw new Error('Provider stream failed.');
        if (entry.finish_reason) { choice.finish_reason = entry.finish_reason; if (index === 0) finished = true; }
        if (typeof delta.content === 'string') choice.message.content += delta.content;
        if (typeof delta.refusal === 'string') choice.message.refusal = (choice.message.refusal || '') + delta.refusal;
        for (const tool of delta.tool_calls || []) {
          choice.message.tool_calls ||= [];
          const target = choice.message.tool_calls[tool.index || 0] ||= { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tool.id) target.id = tool.id;
          if (tool.function?.name) target.function.name += tool.function.name;
          if (tool.function?.arguments) target.function.arguments += tool.function.arguments;
        }
        choices.set(index, choice);
        if (index === 0 && (delta.content || delta.refusal)) await notify(onText, choice.message.content || choice.message.refusal || '', { providerResponseId: id });
      }
    }
    if (!finished) throw new Error('Provider stream ended without a finish reason.');
    for (const choice of choices.values()) if (!choice.message.content && choice.message.refusal) choice.message.content = choice.message.refusal;
    if ((usage?.prompt_tokens ?? usage?.input_tokens) == null || (usage?.completion_tokens ?? usage?.output_tokens) == null) usage = null;
    return { id, model, object: 'chat.completion', created: Math.floor(Date.now() / 1000),
      choices: [...choices.values()].sort((a, b) => a.index - b.index), usage };
  } catch (error) { throw streamInterrupted(error); }
}

export async function createStreamingChatCompletion(client, payload, options, onText = payload?.onText) {
  const { onText: ignored, stream, stream_options, ...body } = payload;
  if (!onText) return client.chat.completions.create(body, options);
  const response = await client.chat.completions.create({ ...body, stream: true,
    stream_options: { ...stream_options, include_usage: true } }, { ...options, maxRetries: 0 });
  return collectChatStream(response, onText);
}

export async function createStreamingResponses(client, payload, options, onText) {
  if (!onText) return client.post('/responses', { body: payload, ...options });
  const stream = await client.post('/responses', { body: { ...payload, stream: true }, ...options, stream: true, maxRetries: 0 });
  let text = '', completed;
  try {
    for await (const event of stream) {
      if (['error', 'response.failed'].includes(event.type)) throw new Error(event.error?.message || event.response?.error?.message || 'Provider response failed.');
      if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
        text += event.delta || '';
        await notify(onText, text, { providerResponseId: event.response_id });
      }
      if (event.type === 'response.completed' || event.type === 'response.incomplete') completed = event.response;
    }
    if (!completed) throw new Error('Provider stream ended without a final response.');
    if ((completed.usage?.input_tokens ?? completed.usage?.prompt_tokens) == null ||
        (completed.usage?.output_tokens ?? completed.usage?.completion_tokens) == null) completed.usage = null;
    if (!completed.output_text && text) completed.output_text = text;
    return completed;
  } catch (error) { throw streamInterrupted(error); }
}

export async function collectAnthropicStream(body, onText) {
  let message, finished = false, finalUsage = false;
  const blocks = [];
  try {
    for await (const frame of readSSE(body)) {
      const event = JSON.parse(frame.data);
      if (event.type === 'error') throw new Error(event.error?.message || 'Anthropic stream failed.');
      if (event.type === 'message_start') message = { ...event.message, content: [], usage: { ...event.message.usage } };
      if (event.type === 'content_block_start') blocks[event.index] = { ...event.content_block };
      if (event.type === 'content_block_delta') {
        const block = blocks[event.index];
        if (!block) throw new Error('Missing streamed content block.');
        if (event.delta.type === 'text_delta') {
          block.text = (block.text || '') + event.delta.text;
          await notify(onText, blocks.filter(b => b?.type === 'text').map(b => b.text).join('\n'), { providerResponseId: message?.id });
        }
        if (event.delta.type === 'input_json_delta') block.partial_json = (block.partial_json || '') + event.delta.partial_json;
        // Preserve provider tool-continuation metadata without publishing thinking as answer text.
        if (event.delta.type === 'thinking_delta') block.thinking = (block.thinking || '') + event.delta.thinking;
        if (event.delta.type === 'signature_delta') block.signature = (block.signature || '') + event.delta.signature;
      }
      if (event.type === 'content_block_stop' && blocks[event.index]?.partial_json) {
        blocks[event.index].input = JSON.parse(blocks[event.index].partial_json);
        delete blocks[event.index].partial_json;
      }
      if (event.type === 'message_delta' && message) {
        Object.assign(message, event.delta);
        finalUsage ||= event.usage?.output_tokens != null;
        Object.assign(message.usage, event.usage); // Cumulative output; preserve initial cache/input counts.
      }
      if (event.type === 'message_stop') finished = true;
    }
    if (!finished || !message) throw new Error('Anthropic stream ended before message_stop.');
    return { ...message, content: blocks, usage: finalUsage && message.usage?.input_tokens != null ? message.usage : null };
  } catch (error) { throw streamInterrupted(error); }
}

export async function collectGeminiStream(body, onText) {
  let result = {}, text = '', finished = false;
  try {
    for await (const frame of readSSE(body)) {
      const event = JSON.parse(frame.data);
      if (event.error) throw new Error(event.error.message || 'Gemini stream failed.');
      const candidate = event.candidates?.[0];
      for (const part of candidate?.content?.parts || []) {
        if (typeof part.text === 'string' && !part.thought) text += part.text;
      }
      result = { ...result, ...event, usageMetadata: event.usageMetadata || result.usageMetadata };
      if (candidate?.finishReason || event.promptFeedback?.blockReason) finished = true;
      if (text) await notify(onText, text, { providerResponseId: event.responseId });
    }
    if (!finished) throw new Error('Gemini stream ended before completion.');
    return { ...result, candidates: [{ ...(result.candidates?.[0] || {}), content: { role: 'model', parts: [{ text }] } }] };
  } catch (error) { throw streamInterrupted(error); }
}

// Shared transport for the hosted Samsar adapter. A disconnect never retries
// inference automatically; callers retain the billing identity for reconciliation.
export async function requestSamsarStream({ url, headers, payload, signal, onText, fetchImpl = fetch }) {
  const response = await fetchImpl(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ ...payload, stream: true }), signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw Object.assign(new Error(body.message || body.error || `Samsar request failed (${response.status}).`), { status: response.status, code: body.code });
  }
  try {
    for await (const frame of readSSE(response.body)) {
      const event = JSON.parse(frame.data);
      if (frame.event === 'snapshot') await notify(onText, event.text || '');
      if (frame.event === 'completed') return { ...event.response, samsarBilling: { adapter: 'samsar' } };
      if (frame.event === 'error') throw Object.assign(new Error(event.message || 'Samsar stream failed.'), { code: event.code });
    }
    throw new Error('Samsar stream ended before its billing receipt.');
  } catch (error) { throw streamInterrupted(error); }
}
