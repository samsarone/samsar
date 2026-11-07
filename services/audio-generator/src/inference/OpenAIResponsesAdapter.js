import { getReasoningModelBase, resolveInferenceEffort } from './ReasoningModels.js';

// Sol's native tool calls use Responses; workers retain their chat-shaped result.
export async function createSolResponsesCompletion(client, request, options = {}) {
  const input = (request.messages || []).flatMap((message) => {
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: String(message.content || '') }];
    const content = Array.isArray(message.content) ? message.content.map((part) => {
      if (part.type === 'image_url') return { type: 'input_image', image_url: part.image_url?.url || part.image_url, ...(part.image_url?.detail ? { detail: part.image_url.detail } : {}) };
      if (part.type === 'text') return { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text };
      return part;
    }) : message.content;
    const items = content ? [{ role: message.role === 'system' ? 'developer' : message.role, content }] : [];
    for (const call of message.tool_calls || []) items.push({ type: 'function_call', call_id: call.id, name: call.function.name, arguments: call.function.arguments });
    return items;
  });
  const body = {
    model: getReasoningModelBase(request.model), input,
    reasoning: { effort: resolveInferenceEffort(request.model, request.effort || request.reasoning?.effort || request.reasoning_effort || request.reasoningEffort) },
  };
  const limit = request.max_output_tokens ?? request.max_completion_tokens ?? request.max_tokens;
  if (limit) body.max_output_tokens = limit;
  if (request.tools) body.tools = request.tools.map((tool) => tool.function ? { type: 'function', ...tool.function } : tool);
  if (request.tool_choice) body.tool_choice = request.tool_choice.function ? { type: 'function', name: request.tool_choice.function.name } : request.tool_choice;
  if (request.parallel_tool_calls !== undefined) body.parallel_tool_calls = request.parallel_tool_calls;
  if (request.response_format) body.text = { format: request.response_format.type === 'json_schema' ? { type: 'json_schema', ...request.response_format.json_schema } : request.response_format };
  const response = await client.post('/responses', { body, ...options });
  const tool_calls = (response.output || []).filter((item) => item.type === 'function_call').map((item) => ({ id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments } }));
  const content = response.output_text ?? (response.output || []).filter((item) => item.type === 'message').flatMap((item) => item.content || []).filter((part) => part.type === 'output_text').map((part) => part.text).join('');
  const usage = response.usage || {};
  return {
    id: response.id, model: response.model || body.model,
    usage: { ...usage, prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens, prompt_tokens_details: usage.input_tokens_details, completion_tokens_details: usage.output_tokens_details },
    choices: [{ index: 0, message: { role: 'assistant', content, ...(tool_calls.length ? { tool_calls } : {}) }, finish_reason: tool_calls.length ? 'tool_calls' : response.status === 'incomplete' ? 'length' : 'stop' }],
  };
}
