import {
  GPT_56_SOL_INFERENCE_MODEL,
  createGoogleGeminiChatCompletion,
  getDefaultInferenceModel,
  getGPT56SolReasoningEffort,
  isGeminiInferenceModel,
  isKimiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from './GoogleGemini.js';
import { createKimiK3ChatCompletion } from './KimiK3.js';
import { createQwenChatCompletion } from './Qwen.js';
import {
  DOCKER_INFERENCE_PROVIDER,
  createSamsarExternalChatCompletion,
  getConfiguredInferenceProviders,
  isQwenInferenceAdapterRoutingEnabled,
  resolveConfiguredInferenceProvider,
  shouldUseOpenRouterInference,
  shouldUseSamsarExternalInference,
} from './SamsarExternalInferenceAdapter.js';
import { normalizeProviderMediaUrl } from '../ai_video/utils/AWS.js';
import { normalizeProviderMediaPayload } from './ProviderMediaPayload.js';
import { isStandaloneEdition } from '../utils/EnvironmentUtils.js';

const INFERENCE_ADAPTER_PROVIDER_SYMBOL =
  Symbol.for('samsar.inferenceAdapterProvider');

export function isResponsesOnlyModel(model) {
  const inferenceModel = normalizeInferenceModel(model || getDefaultInferenceModel());
  return !isGeminiInferenceModel(inferenceModel) &&
    !isKimiInferenceModel(inferenceModel) &&
    !isQwenInferenceModel(inferenceModel);
}

export async function createCompatibleChatCompletion(
  openaiClient,
  chatRequest = {},
) {
  if (shouldUseStandaloneInferenceAdapterFallback(chatRequest)) {
    const model = chatRequest?.model || getDefaultInferenceModel();
    const providers = getConfiguredInferenceProviders(model, chatRequest);
    if (providers.length > 1) {
      return runInferenceAdapterFallback(
        providers,
        async (provider) => attachInferenceAdapterProvider(
          await createCompatibleChatCompletionForProvider(
            openaiClient,
            buildProviderPinnedChatRequest(chatRequest, provider),
          ),
          provider,
        ),
      );
    }
  }

  const provider = resolveInferenceAdapterProvider(chatRequest);
  return attachInferenceAdapterProvider(
    await createCompatibleChatCompletionForProvider(openaiClient, chatRequest),
    provider,
  );
}

function attachInferenceAdapterProvider(response, provider) {
  if (
    response &&
    typeof response === 'object' &&
    Object.isExtensible(response)
  ) {
    Object.defineProperty(response, INFERENCE_ADAPTER_PROVIDER_SYMBOL, {
      configurable: true,
      value: provider,
    });
  }
  return response;
}

export function getInferenceAdapterProvider(response) {
  return typeof response?.[INFERENCE_ADAPTER_PROVIDER_SYMBOL] === 'string'
    ? response[INFERENCE_ADAPTER_PROVIDER_SYMBOL]
    : '';
}

function resolveInferenceAdapterProvider(chatRequest = {}) {
  const model = chatRequest?.model || getDefaultInferenceModel();
  if (shouldUseSamsarExternalInference(chatRequest)) {
    if (normalizeAuthorization(chatRequest.authorization) === 'gmicloud' ||
        normalizeAuthorization(chatRequest.authorization) === 'genblaze') {
      return DOCKER_INFERENCE_PROVIDER.GMICLOUD;
    }
    const configuredProvider = resolveConfiguredInferenceProvider(model);
    if (configuredProvider === DOCKER_INFERENCE_PROVIDER.GMICLOUD) {
      return configuredProvider;
    }
    return shouldUseOpenRouterInference(chatRequest)
      ? DOCKER_INFERENCE_PROVIDER.OPENROUTER
      : DOCKER_INFERENCE_PROVIDER.SAMSAR;
  }
  if (isKimiInferenceModel(model)) {
    return DOCKER_INFERENCE_PROVIDER.KIMI;
  }
  if (isQwenInferenceModel(model)) {
    return DOCKER_INFERENCE_PROVIDER.ALIBABA_CLOUD;
  }
  if (isGeminiInferenceModel(model)) {
    return DOCKER_INFERENCE_PROVIDER.GOOGLE_CLOUD;
  }
  return DOCKER_INFERENCE_PROVIDER.OPENAI;
}

function normalizeAuthorization(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[_\s]+/g, '-')
    : '';
}

function shouldUseStandaloneInferenceAdapterFallback(chatRequest = {}) {
  const model = chatRequest?.model || getDefaultInferenceModel();
  const productionQwenRoutingEnabled = isQwenInferenceModel(model) &&
    isQwenInferenceAdapterRoutingEnabled();
  if (!isStandaloneEdition() && !productionQwenRoutingEnabled) {
    return false;
  }
  const authorization = normalizeAuthorization(chatRequest?.authorization);
  if (
    authorization === 'gmicloud' ||
    authorization === 'genblaze' ||
    authorization === 'openrouter' ||
    ['deployed', 'samsar', 'samsar-api-key', 'samsar-key'].includes(authorization)
  ) {
    return false;
  }
  if (
    chatRequest?.bypassSamsarExternalInference === true ||
    typeof chatRequest?.samsarExternalInference === 'boolean'
  ) {
    return false;
  }
  return true;
}

function buildProviderPinnedChatRequest(chatRequest, provider) {
  const providerRequest = {
    ...chatRequest,
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
  if (provider === DOCKER_INFERENCE_PROVIDER.GMICLOUD) {
    return {
      ...providerRequest,
      authorization: 'gmicloud',
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

function getInferenceAdapterErrorMetadata(error) {
  const visited = new Set();
  let current = error;
  let status = null;
  const codes = [];
  const names = [];
  const messages = [];

  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    if (current.message) messages.push(String(current.message));
    if (current.code !== undefined) {
      codes.push(String(current.code).trim().toUpperCase());
    }
    if (current.name !== undefined) {
      names.push(String(current.name).trim().toUpperCase());
    }
    const candidateStatus = Number(
      current.status ??
      current.statusCode ??
      current.response?.status ??
      current.error?.status ??
      current.code ??
      current.error?.code,
    );
    if (status === null && Number.isInteger(candidateStatus) && candidateStatus > 0) {
      status = candidateStatus;
    }
    current = current.cause;
  }

  return {
    status,
    codes,
    names,
    message: messages.join(' ').toLowerCase(),
  };
}

export function isRetryableInferenceAdapterError(error) {
  const { status, codes, names, message } = getInferenceAdapterErrorMetadata(error);
  if (codes.includes('GENBLAZE_MODEL_UNSUPPORTED')) {
    return true;
  }
  if (status !== null) {
    return status === 401 ||
      status === 403 ||
      status === 425 ||
      status === 429;
  }
  const retryableCodes = [
    'EAI_AGAIN',
    'ECONNREFUSED',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'UND_ERR_CONNECT_TIMEOUT',
  ];
  if (codes.some((code) => retryableCodes.includes(code))) {
    return true;
  }
  return false;
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
    if (typeof lastError === 'object') {
      lastError.attemptedInferenceAdapters = attemptedProviders;
    }
    throw lastError;
  }
  return dispatchProvider(undefined);
}

async function createCompatibleChatCompletionForProvider(
  openaiClient,
  chatRequest = {},
) {
  const {
    authorization,
    bypassSamsarExternalInference,
    externalMaxRetries,
    samsarExternalInference,
    timeout,
    maxRetries,
    ...request
  } = chatRequest || {};
  const model = request?.model || getDefaultInferenceModel();
  if (shouldUseSamsarExternalInference(chatRequest)) {
    return await createSamsarExternalChatCompletion(chatRequest);
  }

  const requestOptions = buildRequestOptions({ timeout });
  if (isKimiInferenceModel(model)) {
    return await createKimiK3ChatCompletion({
      ...request,
      ...(timeout !== undefined ? { timeout } : {}),
      ...(maxRetries !== undefined ? { maxRetries } : {}),
    });
  }
  if (isQwenInferenceModel(model)) {
    return await createQwenChatCompletion({
      ...request,
      ...(timeout !== undefined ? { timeout } : {}),
      ...(maxRetries !== undefined ? { maxRetries } : {}),
    });
  }
  if (isGeminiInferenceModel(model)) {
    return await createGoogleGeminiChatCompletion(request);
  }

  if (!isResponsesOnlyModel(model)) {
    const { reasoning, ...chatPayload } = request || {};
    return await openaiClient.chat.completions.create(
      await normalizeProviderMediaPayload(chatPayload, normalizeProviderMediaUrl),
      requestOptions,
    );
  }

  const responsesRequest = buildResponsesRequest(
    await normalizeProviderMediaPayload(request, normalizeProviderMediaUrl),
  );
  const responsesResponse = await openaiClient.post('/responses', {
    body: responsesRequest,
    ...requestOptions,
  });
  const outputText = extractResponsesOutputText(responsesResponse);

  return normalizeResponsesToChatCompletion(responsesResponse, outputText);
}

export function buildRequestOptions({ timeout } = {}) {
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
    reasoningEffort,
    effort,
  } = chatRequest || {};

  const inferenceModel = normalizeInferenceModel(model || getDefaultInferenceModel());
  const body = {
    model: typeof inferenceModel === 'string' && inferenceModel.startsWith(GPT_56_SOL_INFERENCE_MODEL)
      ? GPT_56_SOL_INFERENCE_MODEL
      : inferenceModel,
    input: normalizeMessagesForResponses(messages),
  };

  const legacyReasoningEffort =
    (reasoning && typeof reasoning === 'object' ? reasoning.effort : undefined) ??
    reasoning_effort;
  const requestedReasoningEffort = typeof inferenceModel === 'string' &&
    inferenceModel.startsWith(GPT_56_SOL_INFERENCE_MODEL)
    ? effort ?? reasoningEffort ?? legacyReasoningEffort
    : legacyReasoningEffort;
  if (!isGeminiInferenceModel(body.model)) {
    body.reasoning = {
      effort: getGPT56SolReasoningEffort(inferenceModel, requestedReasoningEffort),
    };
  } else if (typeof requestedReasoningEffort === 'string' && requestedReasoningEffort) {
    body.reasoning = { effort: requestedReasoningEffort };
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

    if (message.role === 'system') {
      return { ...message, role: 'developer' };
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
