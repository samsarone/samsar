// Translates the internal OpenAI chat contract to Anthropic Messages and back.
export const CLAUDE_OPUS_55_MODEL = 'claude-opus-5.5';
export const ANTHROPIC_OPUS_55_MODEL = 'claude-opus-5-5';
export const OPENROUTER_OPUS_55_MODEL = 'anthropic/claude-opus-5.5';
const DEFAULT_MAX_TOKENS = 128000;
const MAX_TOKENS = 128000;

export function isClaudeOpus55Model(value) {
  return ['claude-opus-5.5', 'claude-opus-5-5', 'anthropic/claude-opus-5.5',
    'claude 5.5 opus', 'claude opus 5.5'].includes(String(value || '').trim().toLowerCase());
}

function imageSource(value) {
  const url = typeof value === 'string' ? value : value?.url;
  if (!url) return null;
  const data = url.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/i);
  return data
    ? { type: 'base64', media_type: data[1].toLowerCase(), data: data[2] }
    : { type: 'url', url };
}

function contentBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content ?? '') }];
  return content.flatMap((part) => {
    if (typeof part === 'string') return [{ type: 'text', text: part }];
    if (['text', 'input_text', 'output_text'].includes(part?.type)) {
      return [{ type: 'text', text: String(part.text ?? '') }];
    }
    if (['image_url', 'input_image', 'image'].includes(part?.type)) {
      const source = imageSource(part.image_url || part.image || part.url);
      return source ? [{ type: 'image', source }] : [];
    }
    return [];
  });
}

export function toAnthropicMessages(request = {}) {
  const system = [];
  const messages = [];
  for (const message of request.messages || []) {
    if (message.role === 'system' || message.role === 'developer') {
      system.push(...contentBlocks(message.content).filter((block) => block.type === 'text'));
    } else if (message.role === 'tool') {
      messages.push({ role: 'user', content: [{ type: 'tool_result',
        tool_use_id: message.tool_call_id, content: String(message.content ?? '') }] });
    } else if (message.role === 'assistant') {
      if (Array.isArray(message.anthropic_content)) {
        messages.push({ role: 'assistant', content: message.anthropic_content });
        continue;
      }
      const content = contentBlocks(message.content).filter((block) => block.text);
      for (const call of message.tool_calls || []) {
        let input;
        try { input = JSON.parse(call.function?.arguments || '{}'); } catch { input = {}; }
        content.push({ type: 'tool_use', id: call.id, name: call.function?.name, input });
      }
      messages.push({ role: 'assistant', content });
    } else if (message.role === 'user') {
      messages.push({ role: 'user', content: contentBlocks(message.content) });
    }
  }
  const requestedLimit = Number(request.max_tokens ?? request.max_completion_tokens ?? request.max_output_tokens);
  const max_tokens = Number.isFinite(requestedLimit) && requestedLimit > 0
    ? Math.min(Math.floor(requestedLimit), MAX_TOKENS) : DEFAULT_MAX_TOKENS;
  const requestedEffort = String(request.effort || request.reasoning?.effort ||
    request.reasoning_effort || request.reasoningEffort || '').toLowerCase();
  const effort = ['low', 'medium'].includes(requestedEffort)
    ? requestedEffort : 'high';
  const body = {
    model: ANTHROPIC_OPUS_55_MODEL,
    max_tokens,
    output_config: { effort },
    ...(system.length ? { system } : {}),
    messages,
  };
  if (Array.isArray(request.tools) && request.tools.length) {
    body.tools = request.tools.map((tool) => ({
      name: tool.function?.name || tool.name,
      description: tool.function?.description || tool.description || '',
      input_schema: tool.function?.parameters || tool.input_schema || { type: 'object', properties: {} },
      strict: true,
    }));
    const choice = request.tool_choice;
    body.tool_choice = { type: choice === 'none' || choice?.type === 'none' ? 'none' : 'auto',
      ...(request.parallel_tool_calls === false ? { disable_parallel_tool_use: true } : {}) };
  }
  if (request.response_format?.type === 'json_schema' && request.response_format.json_schema?.schema) {
    body.output_config.format = { type: 'json_schema', schema: request.response_format.json_schema.schema };
  } else if (request.response_format?.type === 'json_object') {
    body.system = [...(body.system || []), { type: 'text', text: 'Respond with a valid JSON object only.' }];
  }
  return body;
}

export function fromAnthropicMessage(response) {
  const text = (response.content || []).filter((block) => block.type === 'text')
    .map((block) => block.text).join('\n');
  const tool_calls = (response.content || []).filter((block) => block.type === 'tool_use')
    .map((block) => ({ id: block.id, type: 'function', function: {
      name: block.name, arguments: JSON.stringify(block.input || {}),
    } }));
  const promptTokens = (response.usage?.input_tokens || 0) +
    (response.usage?.cache_creation_input_tokens || 0) +
    (response.usage?.cache_read_input_tokens || 0);
  const completionTokens = response.usage?.output_tokens || 0;
  return {
    id: response.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: CLAUDE_OPUS_55_MODEL,
    choices: [{ index: 0, message: { role: 'assistant', content: text,
      ...(tool_calls.length ? { tool_calls, anthropic_content: response.content } : {}) },
      finish_reason: response.stop_reason === 'tool_use' ? 'tool_calls'
        : response.stop_reason === 'max_tokens' ? 'length' : 'stop' }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      prompt_tokens_details: { cached_tokens: response.usage?.cache_read_input_tokens || 0 },
      completion_tokens_details: { reasoning_tokens: response.usage?.output_tokens_details?.thinking_tokens || 0 },
    },
  };
}

export async function createAnthropicChatCompletion(request = {}, {
  fetchImpl = fetch, env = process.env,
} = {}) {
  const apiKey = String(env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required for native Claude inference.');
  const timeoutMs = Number(request.timeout ?? request.timeoutMs) || 600000;
  const endpoint = String(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const response = await fetchImpl(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(toAnthropicMessages(request)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Anthropic inference failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return fromAnthropicMessage(payload);
}
