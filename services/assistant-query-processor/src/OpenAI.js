import OpenAI from "openai";
import {
  DEFAULT_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  isGeminiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './InferenceModels.js';
import { createQwenChatCompletion } from './Qwen.js';
import { sendAssistantGeminiCompletionRequest } from './GoogleGemini.js';
import {
  createSamsarExternalChatCompletion,
  resolveConfiguredInferenceProvider,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';
import { runExternalInferenceWithRetry } from './ExternalInferenceRetry.js';
import { resolveProviderMediaPayload } from './ProviderMediaPayload.js';

const API_KEY = process.env.OPENAI_API_KEY;


const openai = new OpenAI({ apiKey: API_KEY || '' });
const DEFAULT_ASSISTANT_QUERY_TIMEOUT_MS = 10 * 60 * 1000;

function getModelNameForInferenceModel(inferenceModel) {
  return normalizeInferenceModel(inferenceModel || DEFAULT_INFERENCE_MODEL);
}



export async function sendAssistantMessageRequest(messageList, inferenceModel, reasoningEffort) {
  const completion = await sendAssistantCompletionRequest(messageList, inferenceModel, reasoningEffort);
  return completion.outputText;
}

function normalizeCompletionOptions(options) {
  if (!options) {
    return {};
  }

  if (typeof options === 'string') {
    return { reasoningEffort: options };
  }

  if (typeof options === 'object' && !Array.isArray(options)) {
    return options;
  }

  return {};
}

function getReasoningEffort(options = {}) {
  return (
    options.reasoningEffort ||
    options.reasoning_effort ||
    options.reasoning?.effort ||
    null
  );
}

export function getAssistantReasoningEffort(inferenceModel, options = {}) {
  if (isQwenInferenceModel(inferenceModel)) {
    return null;
  }
  return isGeminiInferenceModel(inferenceModel)
    ? getReasoningEffort(options)
    : GPT_56_SOL_REASONING_EFFORT;
}

function getRequestTimeoutMs(options = {}) {
  const parsed = Number(
    options.timeout ??
    options.timeoutMs ??
    process.env.ASSISTANT_QUERY_INFERENCE_TIMEOUT_MS
  );
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_ASSISTANT_QUERY_TIMEOUT_MS;
}

export async function sendAssistantCompletionRequest(messageList, inferenceModel, options) {
  const completionOptions = normalizeCompletionOptions(options);
  const model = getModelNameForInferenceModel(inferenceModel);
  const isGeminiModel = isGeminiInferenceModel(inferenceModel);
  const isQwenModel = isQwenInferenceModel(inferenceModel) || isQwenInferenceModel(model);
  const reasoningEffort = getAssistantReasoningEffort(inferenceModel, completionOptions);
  const externalPayload = {
    model,
    messages: messageList,
    authorization: completionOptions.authorization,
    reasoning_effort: reasoningEffort || undefined,
    timeout: getRequestTimeoutMs(completionOptions),
  };
  if (shouldUseSamsarExternalInference(externalPayload)) {
    return await sendAssistantSamsarExternalCompletionRequest(messageList, model, completionOptions);
  }

  if (isGeminiModel) {
    return await sendAssistantGeminiCompletionRequest(messageList, inferenceModel, completionOptions);
  }

  if (isQwenModel) {
    return await sendAssistantQwenCompletionRequest(messageList, model, completionOptions);
  }

  return await sendAssistantOpenAICompletionRequest(
    messageList,
    inferenceModel,
    reasoningEffort,
    completionOptions,
  );
}

export async function sendAssistantQwenCompletionRequest(messageList, inferenceModel, options = {}) {
  const model = getModelNameForInferenceModel(inferenceModel);
  const response = await createQwenChatCompletion({
    ...options,
    model,
    messages: messageList,
    timeout: getRequestTimeoutMs(options),
  });
  const outputText = response?.choices?.[0]?.message?.content || '';

  return {
    model: response?.model || model,
    response: normalizeChatCompletionToResponses(response),
    outputText,
    outputContent: buildFallbackAssistantContent(outputText),
    externalProvider: 'alibabaCloud',
  };
}

export async function sendAssistantSamsarExternalCompletionRequest(messageList, inferenceModel, options = {}) {
  const model = getModelNameForInferenceModel(inferenceModel);
  const reasoningEffort = getAssistantReasoningEffort(inferenceModel, options);
  const response = await createSamsarExternalChatCompletion({
    model,
    messages: messageList,
    authorization: options.authorization,
    reasoning_effort: reasoningEffort || undefined,
    timeout: getRequestTimeoutMs(options),
  });
  const outputText = response?.choices?.[0]?.message?.content || '';

  return {
    model: response?.model || model,
    response: normalizeChatCompletionToResponses(response),
    outputText,
    outputContent: buildFallbackAssistantContent(outputText),
    externalProvider: resolveConfiguredInferenceProvider(model) || 'samsar',
  };
}

export async function sendAssistantOpenAICompletionRequest(
  messageList,
  inferenceModel,
  reasoningEffort,
  options = {},
  dependencyOverrides = {},
) {
  const model = getModelNameForInferenceModel(inferenceModel);
  const client = dependencyOverrides.client || openai;
  const timeoutMs = getRequestTimeoutMs(options);
  const retryOptions = {
    timeoutMs,
    maxRetries: options.externalMaxRetries ?? options.maxRetries,
    ...(dependencyOverrides.retryOptions || {}),
  };

  try {
    const sourceBody = {
      model,
      input: normalizeMessagesForResponses(messageList),
    };
    sourceBody.reasoning = { effort: GPT_56_SOL_REASONING_EFFORT };

    try {
      const response = await runExternalInferenceWithRetry(
        async ({ signal }) => {
          const body = await resolveProviderMediaPayload(sourceBody, {
            resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
            serviceName: 'samsar_assistant_query_processor_openai_responses',
          });
          return client.post('/responses', {
            body,
            timeout: timeoutMs,
            maxRetries: 0,
            signal,
          });
        },
        {
          provider: 'openai-responses',
          model,
          ...retryOptions,
        },
      );

      return {
        model: response?.model || model,
        response,
        outputText: extractResponsesOutputText(response),
        outputContent: extractResponsesOutputContent(response),
      };
    } catch (responsesError) {
      const shouldFallback = dependencyOverrides.shouldFallbackToChatCompletions ||
        shouldFallbackToChatCompletions;
      if (!shouldFallback(responsesError, model)) {
        throw responsesError;
      }

      const sourcePayload = {
        messages: normalizeMessagesForChatCompletions(messageList),
        model,
      };
      const response = await runExternalInferenceWithRetry(
        async ({ signal }) => {
          const payload = await resolveProviderMediaPayload(sourcePayload, {
            resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
            serviceName: 'samsar_assistant_query_processor_openai_chat',
          });
          return client.chat.completions.create(payload, {
            timeout: timeoutMs,
            maxRetries: 0,
            signal,
          });
        },
        {
          provider: 'openai-chat',
          model,
          ...retryOptions,
        },
      );
      const outputText = response?.choices?.[0]?.message?.content || '';

      return {
        model: response?.model || model,
        response: normalizeChatCompletionToResponses(response),
        outputText,
        outputContent: buildFallbackAssistantContent(outputText),
      };
    }
  } catch (error) {
    if (typeof error?.code === 'string' && error.code.startsWith('SAMSAR_')) {
      throw error;
    }
    throw new Error(
      'An error occurred while sending the message. Please try again with a different message.',
      { cause: error },
    );
  }

}

function normalizeMessagesForResponses(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => {
    if (!message || typeof message !== 'object') {
      return message;
    }

    if (message.role === 'system') {
      return { ...message, role: 'developer' };
    }

    return message;
  });
}

function normalizeMessagesForChatCompletions(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages
    .map((message) => normalizeChatCompletionMessage(message))
    .filter(Boolean);
}

function normalizeChatCompletionMessage(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }

  const normalizedRole = message.role === 'developer' ? 'system' : message.role;
  const normalizedContent = normalizeContentForChatCompletions(message.content);

  return {
    ...message,
    role: normalizedRole,
    content: normalizedContent,
  };
}

function normalizeContentForChatCompletions(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return content;
  }

  const normalizedParts = content
    .flatMap((part) => normalizeChatCompletionContentParts(part));

  if (normalizedParts.length === 0) {
    return '';
  }

  const hasNonTextPart = normalizedParts.some((part) => part.type !== 'text');
  if (!hasNonTextPart) {
    return normalizedParts.map((part) => part.text).join('\n\n');
  }

  return normalizedParts;
}

function flattenChatImageReferences(value, depth = 0) {
  if (typeof value === 'string') return value.trim() ? [value] : [];
  if (Array.isArray(value) && depth < 4) {
    return value.flatMap((entry) => flattenChatImageReferences(entry, depth + 1));
  }
  if (!value || typeof value !== 'object' || depth >= 4) return [];
  if (
    typeof value.url === 'string' ||
    typeof value.uri === 'string' ||
    typeof value.image_url === 'string' ||
    typeof value.imageUrl === 'string' ||
    typeof value.data === 'string' ||
    typeof value.base64 === 'string'
  ) {
    return [value];
  }
  return [
    'image_url', 'imageUrl', 'image_uri', 'imageUri',
    'source', 'urls', 'uris', 'sources',
  ].flatMap((field) => flattenChatImageReferences(value[field], depth + 1));
}

function getChatImageReferences(part) {
  return [
    'image_url', 'imageUrl', 'image_uri', 'imageUri', 'input_image', 'inputImage', 'image',
    'image_urls', 'imageUrls', 'image_uris', 'imageUris', 'images',
    'url', 'uri', 'source', 'urls', 'uris', 'sources',
  ].flatMap((field) => flattenChatImageReferences(part?.[field]));
}

function toChatImageUrl(reference, detail) {
  if (typeof reference === 'string') {
    return { url: reference, ...(detail ? { detail } : {}) };
  }
  if (!reference || typeof reference !== 'object') return null;
  const data = typeof reference.data === 'string' ? reference.data : reference.base64;
  const mimeType = reference.media_type || reference.mime_type || reference.mimeType || 'image/png';
  const url = data
    ? `data:${mimeType};base64,${data}`
    : reference.url || reference.uri || reference.image_url || reference.imageUrl;
  if (typeof url !== 'string' || !url.trim()) return null;
  return {
    url: url.trim(),
    ...((reference.detail || detail) ? { detail: reference.detail || detail } : {}),
  };
}

function normalizeChatCompletionContentParts(part) {
  if (!part || typeof part !== 'object') {
    return [];
  }

  if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
    return typeof part.text === 'string'
      ? [{
          type: 'text',
          text: part.text,
        }]
      : [];
  }

  const normalizedType = typeof part.type === 'string'
    ? part.type.toLowerCase().replace(/[\s-]+/g, '_')
    : '';
  if (/(?:^|_)image(?:_|$)/.test(normalizedType)) {
    return getChatImageReferences(part)
      .map((reference) => toChatImageUrl(reference, part.detail))
      .filter(Boolean)
      .map((imageUrl) => ({
          type: 'image_url',
          image_url: imageUrl,
        }));
  }

  if (typeof part.text === 'string') {
    return [{
      type: 'text',
      text: part.text,
    }];
  }

  return [];
}

function extractResponsesOutputText(response) {
  if (!response || typeof response !== 'object') {
    return '';
  }

  if (typeof response.output_text === 'string') {
    return response.output_text;
  }

  const output = response.output;
  if (!Array.isArray(output)) {
    return '';
  }

  const texts = [];
  for (const item of output) {
    if (!item || typeof item !== 'object' || item.type !== 'message') {
      continue;
    }
    const contentList = item.content;
    if (!Array.isArray(contentList)) {
      continue;
    }
    for (const content of contentList) {
      if (!content || typeof content !== 'object') {
        continue;
      }
      if (content.type === 'output_text' && typeof content.text === 'string') {
        texts.push(content.text);
      }
    }
  }

  return texts.join('');
}

function extractResponsesOutputContent(response) {
  const output = response?.output;
  if (!Array.isArray(output)) {
    return buildFallbackAssistantContent(extractResponsesOutputText(response));
  }

  const assistantMessage = output.find((item) => item?.type === 'message' && item?.role === 'assistant');
  if (assistantMessage && Array.isArray(assistantMessage.content) && assistantMessage.content.length > 0) {
    return assistantMessage.content;
  }

  return buildFallbackAssistantContent(extractResponsesOutputText(response));
}

function buildFallbackAssistantContent(outputText) {
  return [
    {
      type: 'output_text',
      text: typeof outputText === 'string' ? outputText : '',
      annotations: [],
    }
  ];
}

function shouldFallbackToChatCompletions(error, model) {
  if (typeof model === 'string' && model.startsWith('gpt-5')) {
    return false;
  }

  const status = error?.status || error?.response?.status;
  if (status !== 400 && status !== 404) {
    return false;
  }

  const message = `${error?.message || ''}`.toLowerCase();
  return (
    message.includes('/responses')
    || message.includes('responses')
    || message.includes('unsupported')
    || message.includes('not found')
  );
}

function normalizeChatCompletionToResponses(chatResponse) {
  const message = chatResponse?.choices?.[0]?.message || {};
  const text = typeof message.content === 'string' ? message.content : '';
  const createdAt = Number(chatResponse?.created);

  return {
    id: chatResponse?.id,
    object: 'response',
    created_at: Number.isFinite(createdAt) ? createdAt : Math.floor(Date.now() / 1000),
    status: 'completed',
    model: chatResponse?.model,
    output_text: text,
    output: [
      {
        id: `${chatResponse?.id || 'chatcmpl'}_message`,
        type: 'message',
        role: 'assistant',
        content: buildFallbackAssistantContent(text),
      },
    ],
    usage: {
      input_tokens: Number(chatResponse?.usage?.prompt_tokens) || 0,
      input_tokens_details: {
        cached_tokens: Number(chatResponse?.usage?.prompt_tokens_details?.cached_tokens) || 0,
      },
      output_tokens: Number(chatResponse?.usage?.completion_tokens) || 0,
      output_tokens_details: {
        reasoning_tokens: Number(chatResponse?.usage?.completion_tokens_details?.reasoning_tokens) || 0,
      },
      total_tokens: Number(chatResponse?.usage?.total_tokens) || 0,
    },
  };
}
