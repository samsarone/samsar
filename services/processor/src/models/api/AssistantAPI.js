import mongoose from 'mongoose';
import OpenAI from 'openai';
import hat from 'hat';
import VideoSession from '../../schema/VideoSession.js';
import ExternalUser from '../../schema/ExternalUser.js';
import User from '../../schema/User.js';
import { getDBConnectionString } from '../DBString.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import { getModelForUserInferenceModel } from '../agent/ModelUtils.js';
import { createCompatibleChatCompletion } from '../ai_utils/OpenAICompat.js';
import { resolveProviderMediaPayload } from '../ai_utils/ProviderMediaPayload.js';
import { deductExternalUserCredits } from '../external/User.js';
import {
  GPT_56_SOL_REASONING_EFFORT,
  isGeminiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from '../../consts/InferenceModels.js';
import {
  calculateAssistantCreditsFromUsage,
  calculateLegacyAssistantCredits,
  DEFAULT_ASSISTANT_PRICING_MULTIPLIER,
} from './AssistantBilling.js';

const DEFAULT_ASSISTANT_MODEL = 'gpt-5.6-sol';
const DEFAULT_ASSISTANT_COMPLETION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_ASSISTANT_SYSTEM_PROMPT =
  'You are a helpful assistant for Samsar. Respond clearly, accurately, and preserve any multimodal context provided by the user.';
const ASSISTANT_PROVIDER_MEDIA_SERVICE = 'samsar_processor_assistant';
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

export function getAssistantCompletionTimeoutMs(payload = {}) {
  const parsed = Number(
    payload.timeout ??
    payload.timeoutMs ??
    process.env.SAMSAR_ASSISTANT_TIMEOUT_MS,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_ASSISTANT_COMPLETION_TIMEOUT_MS;
}

export async function setAssistantSystemPromptForUser(userId, payload = {}, { externalUser = null } = {}) {
  if (!userId) {
    throw buildError('User ID is required.', 400);
  }

  await getDBConnectionString();

  const [user, scopedExternalUser] = await Promise.all([
    User.findById(userId),
    externalUser?._id ? ExternalUser.findById(externalUser._id) : null,
  ]);
  if (!user) {
    throw buildError('User not found.', 404);
  }
  if (
    scopedExternalUser &&
    normalizeString(scopedExternalUser.internalUserId?.toString?.() || scopedExternalUser.internalUserId) !==
      normalizeString(userId?.toString?.() || userId)
  ) {
    throw buildError('Unauthorized external user access.', 403);
  }

  const rawPrompt =
    payload.system_prompt ??
    payload.systemPrompt ??
    payload.prompt ??
    payload.value;

  if (rawPrompt === null || rawPrompt === undefined || `${rawPrompt}`.trim().length === 0) {
    if (scopedExternalUser) {
      scopedExternalUser.assistantSystemPrompt = null;
      await scopedExternalUser.save();
    } else {
      user.assistantSystemPrompt = null;
      await user.save();
    }
    return {
      system_prompt: null,
      model: resolveAssistantModelName(user),
      selected_assistant_model: normalizeInferenceModel(user.selectedAssistantModel),
    };
  }

  if (typeof rawPrompt !== 'string') {
    throw buildError('system_prompt must be a string.', 400);
  }

  const normalizedPrompt = rawPrompt.trim();
  if (scopedExternalUser) {
    scopedExternalUser.assistantSystemPrompt = normalizedPrompt;
    await scopedExternalUser.save();
  } else {
    user.assistantSystemPrompt = normalizedPrompt;
    await user.save();
  }

  return {
    system_prompt: normalizedPrompt,
    model: resolveAssistantModelName(user),
    selected_assistant_model: normalizeInferenceModel(user.selectedAssistantModel),
  };
}

export async function createAssistantCompletion(userId, payload = {}, { externalUser = null } = {}) {
  const sessionId = getSessionIdFromPayload(payload);
  if (!sessionId) {
    throw buildError('session_id is required.', 400);
  }
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    throw buildError('Invalid session_id.', 400);
  }

  await getDBConnectionString();

  const [user, sessionData, scopedExternalUser] = await Promise.all([
    User.findById(userId),
    VideoSession.findById(sessionId),
    externalUser?._id ? ExternalUser.findById(externalUser._id) : null,
  ]);

  if (!user) {
    throw buildError('User not found.', 404);
  }
  if (!sessionData) {
    throw buildError('Session not found.', 404);
  }
  if ((sessionData.userId || '').toString() !== userId.toString()) {
    throw buildError('Unauthorized session access.', 403);
  }
  if (
    scopedExternalUser &&
    normalizeString(scopedExternalUser.internalUserId?.toString?.() || scopedExternalUser.internalUserId) !==
      normalizeString(userId?.toString?.() || userId)
  ) {
    throw buildError('Unauthorized external user access.', 403);
  }
  if (scopedExternalUser) {
    assertExternalUserSessionAccess(sessionData, scopedExternalUser);
  }

  const inputMessages = normalizeInputMessages(
    payload.input ?? payload.message ?? payload.messages ?? null,
  );
  const sessionMessages = Array.isArray(sessionData.sessionMessages)
    ? [...sessionData.sessionMessages]
    : [];

  if (inputMessages.length > 0) {
    sessionMessages.push(...inputMessages);
    sessionData.sessionMessages = sessionMessages;
    await sessionData.save();
  }

  if (sessionMessages.length === 0) {
    throw buildError('Session has no messages to complete.', 400);
  }

  const selectedAssistantModel = normalizeInferenceModel(user.selectedAssistantModel);
  const selectedAssistantModelAuthorization = normalizeModelAuthorization(
    user.selectedAssistantModelAuthorization,
  );
  const model = resolveAssistantModelName(user);
  const systemPrompt = getAssistantSystemPromptForContext({
    user,
    externalUser: scopedExternalUser,
  });
  const usesOpenAIResponses =
    !isGeminiInferenceModel(selectedAssistantModel) &&
    !isQwenInferenceModel(selectedAssistantModel);
  const previousResponseId = usesOpenAIResponses
    ? resolvePreviousResponseId({ payload, sessionMessages, inputMessages })
    : null;
  const responseRequest = buildResponsesRequest({
    model,
    inputMessages: buildResponsesInputMessages({
      systemPrompt,
      sessionMessages,
      inputMessages,
      previousResponseId,
    }),
    payload,
    previousResponseId,
  });

  let response;
  const timeoutMs = getAssistantCompletionTimeoutMs(payload);
  try {
    response = await createAssistantResponse(
      responseRequest,
      selectedAssistantModel,
      selectedAssistantModelAuthorization,
      timeoutMs,
    );
  } catch (error) {
    console.error('[api][assistant][completion] OpenAI request failed', {
      userId,
      sessionId,
      model,
      selectedAssistantModel,
      selectedAssistantModelAuthorization,
      openaiError: summarizeOpenAIError(error),
    });
    throw error;
  }

  const outputText = extractResponsesOutputText(response);
  const billing =
    calculateAssistantCreditsFromUsage({
      model: response?.model || model,
      usage: response?.usage,
    });
  const creditsCharged =
    billing.credits ||
    calculateLegacyAssistantCredits({
      inputMessages: responseRequest.input,
      outputText,
      inferenceModel: selectedAssistantModel,
    });

  let chargeResult;
  try {
    if (scopedExternalUser) {
      chargeResult = await deductExternalUserCredits({
        externalUser: scopedExternalUser,
        credits: creditsCharged,
      });
    } else {
      chargeResult = await deductGenerationCredits(userId, creditsCharged, {
        source: 'assistant_api_completion',
        metadata: {
          requestType: 'API',
          category: 'assistant',
          sessionId,
          selectedAssistantModel,
          selectedAssistantModelAuthorization,
          model: response?.model || model,
          pricingMultiplier:
            billing.pricingMultiplier ?? DEFAULT_ASSISTANT_PRICING_MULTIPLIER,
          costUsd: billing.costUsd ?? null,
          usage: billing.usage ?? null,
          creditsCharged,
        },
      });
    }
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      throw error;
    }
    throw error;
  }

  sessionData.sessionMessages = [
    ...sessionMessages,
    buildAssistantSessionMessage(response),
  ];
  sessionData.sessionMessageGenerationPending = false;
  sessionData.sessionMessageGenerationError = null;
  await sessionData.save();

  return {
    openaiResponse: response,
    creditsCharged,
    remainingCredits: chargeResult?.remainingCredits ?? null,
  };
}

function getSessionIdFromPayload(payload = {}) {
  return payload.session_id || payload.sessionId || payload.id || null;
}

function getAssistantSystemPromptForContext({ user, externalUser } = {}) {
  const externalPrompt = normalizeString(externalUser?.assistantSystemPrompt);
  if (externalPrompt) {
    return externalPrompt;
  }

  const userPrompt = normalizeString(user?.assistantSystemPrompt);
  return userPrompt || DEFAULT_ASSISTANT_SYSTEM_PROMPT;
}

function resolveAssistantModelName(user) {
  return getModelForUserInferenceModel(user?.selectedAssistantModel || DEFAULT_ASSISTANT_MODEL);
}

function normalizeModelAuthorization(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/[_\s]+/g, '-');
  return ['native', 'deployed'].includes(normalized) ? normalized : '';
}

function assertExternalUserSessionAccess(sessionData, externalUser) {
  const externalUserId = normalizeString(externalUser?._id?.toString?.() || externalUser?._id || externalUser?.id);
  const externalIdentityKey = normalizeString(externalUser?.externalIdentityKey);
  const sessionExternalUserId = normalizeString(
    sessionData?.externalRequestUserId?.toString?.() || sessionData?.externalRequestUserId,
  );
  const sessionExternalIdentityKey = normalizeString(sessionData?.externalRequestIdentityKey);

  const matchesExternalUser =
    (externalUserId && sessionExternalUserId && externalUserId === sessionExternalUserId) ||
    (externalIdentityKey && sessionExternalIdentityKey && externalIdentityKey === sessionExternalIdentityKey);

  if (!matchesExternalUser) {
    throw buildError('Session not found for this external user.', 404);
  }
}

function resolvePreviousResponseId({ payload = {}, sessionMessages = [], inputMessages = [] }) {
  if (!Array.isArray(inputMessages) || inputMessages.length === 0) {
    return null;
  }

  const explicitPreviousResponseId = normalizeString(
    payload.previous_response_id ?? payload.previousResponseId,
  );
  if (explicitPreviousResponseId) {
    return explicitPreviousResponseId;
  }

  return getLatestSessionResponseId(sessionMessages);
}

function getLatestSessionResponseId(sessionMessages = []) {
  for (let index = sessionMessages.length - 1; index >= 0; index -= 1) {
    const responseId = normalizeString(sessionMessages[index]?.openaiResponseId);
    if (responseId) {
      return responseId;
    }
  }

  return null;
}

function buildResponsesInputMessages({
  systemPrompt,
  sessionMessages = [],
  inputMessages = [],
  previousResponseId = null,
}) {
  const normalizedMessages = previousResponseId
    ? normalizeSessionMessagesForResponses(inputMessages)
    : normalizeSessionMessagesForResponses(sessionMessages);

  return [
    { role: 'developer', content: systemPrompt },
    ...normalizedMessages,
  ];
}

export function buildResponsesRequest({ model, inputMessages, payload = {}, previousResponseId = null }) {
  const body = {
    model,
    input: inputMessages,
  };

  if (previousResponseId) {
    body.previous_response_id = previousResponseId;
  }

  const maxOutputTokens = payload.max_output_tokens ?? payload.maxOutputTokens ?? payload.max_tokens;
  const parsedMaxOutputTokens = Number(maxOutputTokens);
  if (Number.isFinite(parsedMaxOutputTokens) && parsedMaxOutputTokens > 0) {
    body.max_output_tokens = parsedMaxOutputTokens;
  }

  if (payload.temperature !== undefined) {
    body.temperature = payload.temperature;
  }
  if (payload.top_p !== undefined) {
    body.top_p = payload.top_p;
  }
  if (payload.text && typeof payload.text === 'object') {
    body.text = payload.text;
  }
  if (payload.metadata && typeof payload.metadata === 'object') {
    body.metadata = payload.metadata;
  }
  if (typeof payload.user === 'string' && payload.user.trim()) {
    body.user = payload.user.trim();
  }
  if (Array.isArray(payload.tools)) {
    body.tools = payload.tools;
  }
  if (payload.tool_choice !== undefined) {
    body.tool_choice = payload.tool_choice;
  }
  if (payload.parallel_tool_calls !== undefined) {
    body.parallel_tool_calls = payload.parallel_tool_calls;
  }

  body.reasoning = { effort: GPT_56_SOL_REASONING_EFFORT };

  return body;
}

export async function resolveAssistantProviderMediaInput(input, dependencyOverrides = {}) {
  if (!Array.isArray(input)) {
    return input;
  }

  const overrides = typeof dependencyOverrides === 'function'
    ? { resolveMediaUrl: dependencyOverrides }
    : (dependencyOverrides || {});
  const resolveMediaUrl = typeof overrides.resolveMediaUrl === 'function'
    ? overrides.resolveMediaUrl
    : getAccessibleProviderMediaUrl;
  const serviceName = normalizeString(overrides.serviceName)
    || ASSISTANT_PROVIDER_MEDIA_SERVICE;
  return resolveProviderMediaPayload(input, { resolveMediaUrl, serviceName });
}

async function buildAssistantProviderRequest(responseRequest) {
  return {
    ...responseRequest,
    input: await resolveAssistantProviderMediaInput(responseRequest.input),
  };
}

async function createAssistantResponse(
  responseRequest,
  selectedAssistantModel = DEFAULT_ASSISTANT_MODEL,
  selectedAssistantModelAuthorization = '',
  timeoutMs = DEFAULT_ASSISTANT_COMPLETION_TIMEOUT_MS,
) {
  if (
    isGeminiInferenceModel(selectedAssistantModel) ||
    isQwenInferenceModel(selectedAssistantModel) ||
    selectedAssistantModelAuthorization === 'deployed'
  ) {
    // Compatible adapters own provider-bound media normalization. Preserve the
    // canonical input here so native Gemini can read mounted bytes as inlineData
    // and URL-based adapters can create fresh URLs at their dispatch boundary.
    const providerRequest = responseRequest;
    const chatResponse = await createCompatibleChatCompletion(openai, {
      model: selectedAssistantModel,
      messages: providerRequest.input,
      ...(selectedAssistantModelAuthorization
        ? { authorization: selectedAssistantModelAuthorization }
        : {}),
      timeout: timeoutMs,
      maxRetries: 0,
      externalPolling: selectedAssistantModelAuthorization === 'deployed',
      externalPollTimeoutMs: timeoutMs,
      externalPollIntervalMs: process.env.SAMSAR_EXTERNAL_ASSISTANT_POLL_INTERVAL_MS,
      ...(providerRequest.temperature !== undefined ? { temperature: providerRequest.temperature } : {}),
      ...(providerRequest.top_p !== undefined ? { top_p: providerRequest.top_p } : {}),
      ...(providerRequest.max_output_tokens !== undefined
        ? { max_tokens: providerRequest.max_output_tokens }
        : {}),
      ...(providerRequest.user !== undefined ? { user: providerRequest.user } : {}),
      ...(providerRequest.tools !== undefined ? { tools: providerRequest.tools } : {}),
      ...(providerRequest.tool_choice !== undefined ? { tool_choice: providerRequest.tool_choice } : {}),
      ...(providerRequest.parallel_tool_calls !== undefined
        ? { parallel_tool_calls: providerRequest.parallel_tool_calls }
        : {}),
    });
    return normalizeChatCompletionToResponses(chatResponse);
  }

  try {
    const providerRequest = await buildAssistantProviderRequest(responseRequest);
    return await openai.post('/responses', {
      body: providerRequest,
      timeout: timeoutMs,
      maxRetries: 0,
    });
  } catch (error) {
    if (!shouldFallbackToChatCompletions(error, responseRequest?.model)) {
      throw error;
    }

    const providerRequest = await buildAssistantProviderRequest(responseRequest);
    const chatPayload = {
      model: providerRequest.model,
      messages: providerRequest.input,
      ...(providerRequest.temperature !== undefined ? { temperature: providerRequest.temperature } : {}),
      ...(providerRequest.top_p !== undefined ? { top_p: providerRequest.top_p } : {}),
      ...(providerRequest.max_output_tokens !== undefined
        ? { max_completion_tokens: providerRequest.max_output_tokens }
        : {}),
      ...(providerRequest.user !== undefined ? { user: providerRequest.user } : {}),
    };

    const chatResponse = await openai.chat.completions.create(chatPayload, {
      timeout: timeoutMs,
      maxRetries: 0,
    });
    return normalizeChatCompletionToResponses(chatResponse);
  }
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
        content: [
          {
            type: 'output_text',
            text,
            annotations: [],
          },
        ],
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

function normalizeInputMessages(input) {
  if (input === null || input === undefined) {
    return [];
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      throw buildError('input must not be empty.', 400);
    }
    return [buildSessionMessage({ role: 'user', content: trimmed })];
  }

  if (Array.isArray(input)) {
    if (input.every(isMessageLike)) {
      return input.map((message) => buildSessionMessage(message));
    }

    return [buildSessionMessage({ role: 'user', content: input })];
  }

  if (isMessageLike(input)) {
    return [buildSessionMessage(input)];
  }

  if (typeof input === 'object' && input.type) {
    return [buildSessionMessage({ role: 'user', content: [input] })];
  }

  throw buildError('input must be a string, a message object, or an array of message content.', 400);
}

function isMessageLike(value) {
  return !!(
    value &&
    typeof value === 'object' &&
    typeof value.role === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'content')
  );
}

function buildSessionMessage(message = {}) {
  const role = normalizeRole(message.role);
  return {
    role,
    content: normalizeMessageContent(message.content, role),
    id: message.id || hat(),
    timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
  };
}

function normalizeSessionMessagesForResponses(sessionMessages = []) {
  return sessionMessages.map((message) => {
    const role = normalizeRole(message?.role);
    return {
      role,
      content: normalizeMessageContent(message?.content, role),
    };
  });
}

function normalizeRole(role) {
  if (role === 'system') {
    return 'developer';
  }
  if (role === 'assistant' || role === 'developer' || role === 'user') {
    return role;
  }
  return 'user';
}

function normalizeMessageContent(content, role = 'user') {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item) => normalizeContentItem(item, role)).filter(Boolean);
  }

  if (content && typeof content === 'object' && content.type) {
    const normalized = normalizeContentItem(content, role);
    return normalized ? [normalized] : '';
  }

  if (content === null || content === undefined) {
    return '';
  }

  return JSON.stringify(content);
}

function normalizeContentItem(item, role = 'user') {
  if (typeof item === 'string') {
    return {
      type: role === 'assistant' ? 'output_text' : 'input_text',
      text: item,
    };
  }

  if (!item || typeof item !== 'object') {
    return null;
  }

  if (item.type === 'text' && typeof item.text === 'string') {
    return {
      type: role === 'assistant' ? 'output_text' : 'input_text',
      text: item.text,
    };
  }

  if (item.type === 'image_url') {
    const imageUrl = item.image_url || item.url;
    if (typeof imageUrl === 'string' && imageUrl.trim()) {
      return {
        type: 'input_image',
        image_url: imageUrl.trim(),
      };
    }
  }

  if (item.type === 'image' && typeof item.image_url === 'string' && item.image_url.trim()) {
    return {
      type: 'input_image',
      image_url: item.image_url.trim(),
    };
  }

  return item;
}

function buildAssistantSessionMessage(response) {
  const assistantOutputContent = extractAssistantOutputContent(response);
  const assistantMessage = {
    role: 'assistant',
    content: assistantOutputContent,
    id: hat(),
    timestamp: new Date(),
    openaiResponseId: response?.id || null,
    model: response?.model || null,
    usage: response?.usage || null,
    assistantOutputTypes: listResponseOutputTypes(response),
    generatedImageCount: countResponseOutputItemsByType(response, 'image_generation_call'),
  };

  return assistantMessage;
}

function extractAssistantOutputContent(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  const assistantMessage = output.find((item) => item?.type === 'message' && item?.role === 'assistant');

  if (assistantMessage && Array.isArray(assistantMessage.content) && assistantMessage.content.length > 0) {
    return assistantMessage.content;
  }

  const outputText = extractResponsesOutputText(response);
  if (outputText) {
    return outputText;
  }

  if (countResponseOutputItemsByType(response, 'image_generation_call') > 0) {
    return [
      {
        type: 'output_text',
        text: 'Generated image content is attached in the OpenAI response output.',
        annotations: [],
      },
    ];
  }

  return '';
}

function extractResponsesOutputText(response) {
  if (typeof response?.output_text === 'string') {
    return response.output_text;
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  const texts = [];

  output.forEach((item) => {
    if (!item || typeof item !== 'object' || item.type !== 'message') {
      return;
    }

    const contentList = Array.isArray(item.content) ? item.content : [];
    contentList.forEach((content) => {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        texts.push(content.text);
      }
    });
  });

  return texts.join('');
}

function summarizeOpenAIError(error) {
  if (!error) {
    return null;
  }

  const apiError = error?.error;
  const headers = error?.headers || error?.response?.headers;
  const requestId =
    error?.request_id ||
    error?.requestId ||
    headers?.['x-request-id'] ||
    headers?.['x-request_id'] ||
    headers?.['x-openai-request-id'] ||
    headers?.['x-openai-request_id'] ||
    null;

  return {
    name: error?.name,
    message: error?.message,
    status: error?.status ?? error?.response?.status ?? null,
    code: error?.code ?? apiError?.code ?? null,
    type: error?.type ?? apiError?.type ?? null,
    param: error?.param ?? apiError?.param ?? null,
    requestId,
  };
}

function listResponseOutputTypes(response) {
  const output = Array.isArray(response?.output) ? response.output : [];
  return output
    .map((item) => normalizeString(item?.type))
    .filter(Boolean);
}

function countResponseOutputItemsByType(response, type) {
  const normalizedType = normalizeString(type);
  if (!normalizedType) {
    return 0;
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  return output.filter((item) => normalizeString(item?.type) === normalizedType).length;
}

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function buildError(message, statusCode = 500, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) {
    error.code = code;
  }
  return error;
}
