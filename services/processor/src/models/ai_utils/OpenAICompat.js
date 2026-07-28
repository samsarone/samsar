import {
  getReasoningEffortForInferenceModel,
  getDefaultUserInferenceModel,
  isGeminiInferenceModel,
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeOpenAIInferenceModel,
} from '../../consts/InferenceModels.js';
import { createAlibabaQwenChatCompletion } from '../../inference/AlibabaQwen.js';
import { createGoogleGeminiChatCompletion } from '../../inference/GoogleGemini.js';
import { createKimiK3ChatCompletion } from '../../inference/KimiK3.js';
import {
  DOCKER_INFERENCE_PROVIDER,
  createSamsarExternalChatCompletion,
  getConfiguredInferenceProviders,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';
import { resolveProviderMediaPayload } from './ProviderMediaPayload.js';
import { isStandaloneEdition } from '../../utils/EnvironmentUtils.js';

export function isResponsesOnlyModel(model) {
  const inferenceModel = normalizeOpenAIInferenceModel(model || getDefaultUserInferenceModel());
  return !isGeminiInferenceModel(inferenceModel) &&
    !isKimiInferenceModel(inferenceModel) &&
    !isQwenInferenceModel(inferenceModel);
}

export async function createCompatibleChatCompletion(
  openaiClient,
  chatRequest = {},
  dependencyOverrides = {},
) {
  if (shouldUseStandaloneInferenceAdapterFallback(chatRequest)) {
    const model = chatRequest?.model || getDefaultUserInferenceModel();
    const providers = getConfiguredInferenceProviders(model);
    if (providers.length > 1) {
      return runInferenceAdapterFallback(
        providers,
        (provider) => createCompatibleChatCompletionForProvider(
            openaiClient,
            buildProviderPinnedChatRequest(chatRequest, provider),
            dependencyOverrides,
          ),
      );
    }
  }

  return createCompatibleChatCompletionForProvider(
    openaiClient,
    chatRequest,
    dependencyOverrides,
  );
}

function normalizeAuthorization(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : '';
}

function shouldUseStandaloneInferenceAdapterFallback(chatRequest = {}) {
  if (!isStandaloneEdition()) {
    return false;
  }
  const authorization = normalizeAuthorization(chatRequest?.authorization);
  if (
    authorization === 'openrouter' ||
    ['deployed', 'samsar', 'samsar-api-key', 'samsar-key'].includes(authorization)
  ) {
    return false;
  }
  return chatRequest?.bypassSamsarExternalInference !== true &&
    chatRequest?.samsarExternalInference !== true;
}

export function buildProviderPinnedChatRequest(chatRequest, provider) {
  const providerRequest = {
    ...chatRequest,
    // The ordered adapter loop owns automatic retry. Advance after one
    // retryable provider failure instead of retrying the same adapter locally.
    externalMaxRetries: 0,
    maxRetries: 0,
  };
  if (provider === DOCKER_INFERENCE_PROVIDER.OPENROUTER) {
    return {
      ...providerRequest,
      authorization: 'openrouter',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
    };
  }
  if (provider === DOCKER_INFERENCE_PROVIDER.SAMSAR) {
    return {
      ...providerRequest,
      authorization: 'deployed',
      bypassSamsarExternalInference: false,
      samsarExternalInference: true,
    };
  }
  return {
    ...providerRequest,
    authorization: 'native',
    bypassSamsarExternalInference: true,
    samsarExternalInference: false,
  };
}

export function isRetryableInferenceAdapterError(error) {
  const status = Number(
    error?.status ??
    error?.statusCode ??
    error?.response?.status ??
    error?.cause?.status,
  );
  if (
    status === 401 ||
    status === 403 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  ) {
    return true;
  }
  const code = String(
    error?.code ||
    error?.cause?.code ||
    '',
  ).trim().toUpperCase();
  return [
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_SOCKET',
  ].includes(code);
}

export async function runInferenceAdapterFallback(
  providers = [],
  dispatchProvider,
) {
  let lastError = null;
  const attemptedProviders = [];
  for (const provider of providers) {
    attemptedProviders.push(provider);
    try {
      return await dispatchProvider(provider);
    } catch (error) {
      lastError = error;
      if (!isRetryableInferenceAdapterError(error)) {
        throw error;
      }
    }
  }
  if (lastError) {
    lastError.attemptedInferenceAdapters = attemptedProviders;
    throw lastError;
  }
  return dispatchProvider(undefined);
}

async function createCompatibleChatCompletionForProvider(
  openaiClient,
  chatRequest = {},
  dependencyOverrides = {},
) {
  const {
    externalMaxRetries,
    timeout,
    maxRetries,
    ...request
  } = chatRequest || {};
  const model = request?.model || getDefaultUserInferenceModel();
  if (shouldUseSamsarExternalInference(chatRequest)) {
    return await createSamsarExternalChatCompletion(chatRequest, dependencyOverrides);
  }

  const requestOptions = buildRequestOptions({ timeout, maxRetries });
  if (isQwenInferenceModel(model)) {
    return await createAlibabaQwenChatCompletion(
      { ...request, timeout, maxRetries },
      dependencyOverrides,
    );
  }

  if (isKimiInferenceModel(model)) {
    return await createKimiK3ChatCompletion(
      { ...request, timeout, maxRetries },
      dependencyOverrides,
    );
  }

  if (isGeminiInferenceModel(model)) {
    return await createGoogleGeminiChatCompletion(request, dependencyOverrides);
  }

  if (!isResponsesOnlyModel(model)) {
    const { reasoning, ...chatPayload } = request || {};
    const providerPayload = await resolveProviderMediaPayload(chatPayload, {
      resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
      serviceName: 'samsar_processor_openai_chat',
    });
    return await openaiClient.chat.completions.create(providerPayload, requestOptions);
  }

  const responsesRequest = buildResponsesRequest(request);
  const providerPayload = await resolveProviderMediaPayload(responsesRequest, {
    resolveMediaUrl: dependencyOverrides.resolveMediaUrl,
    serviceName: 'samsar_processor_openai_responses',
  });
  const responsesResponse = await openaiClient.post('/responses', {
    body: providerPayload,
    ...requestOptions,
  });
  const outputText = extractResponsesOutputText(responsesResponse);

  return normalizeResponsesToChatCompletion(responsesResponse, outputText);
}

function buildRequestOptions({ timeout, maxRetries } = {}) {
  // Media URLs are resolved immediately before this SDK call. Hidden SDK
  // retries would reuse the same short-lived Docker tunnel URL; outer callers
  // that retry must rebuild from the canonical reference instead.
  const options = { maxRetries: 0 };
  const parsedTimeout = Number(timeout);
  if (Number.isFinite(parsedTimeout) && parsedTimeout > 0) {
    options.timeout = Math.floor(parsedTimeout);
  }

  return options;
}

function buildResponsesRequest(chatRequest) {
  const {
    model,
    temperature,
    top_p,
    max_tokens,
    user,
    messages,
    response_format,
    reasoning,
    reasoning_effort,
  } = chatRequest || {};

  const body = {
    model: normalizeOpenAIInferenceModel(model || getDefaultUserInferenceModel()),
    input: normalizeMessagesForResponses(messages),
  };

  const reasoningEffort =
    (reasoning && typeof reasoning === 'object' ? reasoning.effort : undefined) ??
    reasoning_effort;
  if (!isGeminiInferenceModel(body.model)) {
    body.reasoning = { effort: getReasoningEffortForInferenceModel(body.model) };
  } else if (typeof reasoningEffort === 'string' && reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }

  if (temperature !== undefined) {
    body.temperature = temperature;
  }
  if (top_p !== undefined) {
    body.top_p = top_p;
  }
  if (user !== undefined) {
    body.user = user;
  }
  if (max_tokens !== undefined) {
    const parsed = Number(max_tokens);
    if (Number.isFinite(parsed) && parsed > 0) {
      body.max_output_tokens = parsed;
    }
  }

  const textConfig = buildTextConfigFromChatResponseFormat(response_format);
  if (textConfig) {
    body.text = textConfig;
  }

  return body;
}

function normalizeMessagesForResponses(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => {
    if (!message || typeof message !== 'object') {
      return message;
    }

    return normalizeMessageForResponses(message);
  });
}

function normalizeMessageForResponses(message) {
  if (!message || typeof message !== 'object') {
    return message;
  }
  const normalizedRole = message.role === 'system' ? 'developer' : message.role;
  return {
    ...message,
    role: normalizedRole,
    content: normalizeContentForResponses(message.content),
  };
}

function normalizeContentForResponses(content) {
  if (!Array.isArray(content)) {
    return content;
  }

  return content.map((item) => {
    if (!item || typeof item !== 'object') {
      return item;
    }
    if (item.type === 'text') {
      return { type: 'input_text', text: item.text || '' };
    }
    if (item.type === 'image_url') {
      const imageUrl = typeof item.image_url === 'string'
        ? item.image_url
        : item.image_url?.url;
      return {
        type: 'input_image',
        image_url: imageUrl,
        ...(item.image_url?.detail ? { detail: item.image_url.detail } : {}),
      };
    }
    return item;
  });
}

function buildTextConfigFromChatResponseFormat(responseFormat) {
  if (!responseFormat || typeof responseFormat !== 'object') {
    return null;
  }

  if (responseFormat.type === 'json_schema' && responseFormat.json_schema) {
    const jsonSchema = responseFormat.json_schema;
    if (!jsonSchema || typeof jsonSchema !== 'object') {
      return null;
    }

    const format = {
      type: 'json_schema',
      name: jsonSchema.name,
      schema: jsonSchema.schema,
      ...(jsonSchema.description !== undefined ? { description: jsonSchema.description } : {}),
      ...(jsonSchema.strict !== undefined ? { strict: jsonSchema.strict } : {}),
    };

    if (!format.name || !format.schema) {
      return null;
    }

    return { format };
  }

  if (responseFormat.type === 'json_object') {
    return { format: { type: 'json_object' } };
  }

  return null;
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

function normalizeResponsesToChatCompletion(response, outputText) {
  return {
    id: response?.id,
    model: response?.model,
    usage: response?.usage,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: outputText ?? '',
        },
        finish_reason: null,
      },
    ],
  };
}
