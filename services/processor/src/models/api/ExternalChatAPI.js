import OpenAI from 'openai';

import { DEFAULT_INFERENCE_MODEL, normalizeInferenceModel } from '../../consts/InferenceModels.js';
import { createCompatibleChatCompletion } from '../ai_utils/OpenAICompat.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import {
  calculateAssistantCreditsFromUsage,
  calculateLegacyAssistantCredits,
  EXTERNAL_CHAT_PRICING_MULTIPLIER,
} from './AssistantBilling.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const DEFAULT_EXTERNAL_CHAT_TIMEOUT_MS = 10 * 60 * 1000;

export function getExternalChatTimeoutMs(payload = {}) {
  const parsed = Number(
    payload.timeout ??
    payload.timeoutMs ??
    process.env.SAMSAR_EXTERNAL_CHAT_TIMEOUT_MS
  );

  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_EXTERNAL_CHAT_TIMEOUT_MS;
}

function buildError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) {
    error.code = code;
  }
  return error;
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw buildError('messages must be a non-empty OpenAI-compatible message array.');
  }
  return messages;
}

function getRequestedModel(payload = {}) {
  return normalizeInferenceModel(
    payload.model ||
    payload.provider_options?.model ||
    payload.providerOptions?.model ||
    payload.inference_model ||
    payload.inferenceModel ||
    DEFAULT_INFERENCE_MODEL
  );
}

export async function createExternalChatCompletion({ userId, payload = {} } = {}) {
  if (!userId) {
    throw buildError('User ID is required.', 401);
  }
  if (payload.stream === true) {
    throw buildError('stream=true is not supported for this endpoint yet.', 400);
  }

  const messages = normalizeMessages(payload.messages);
  const model = getRequestedModel(payload);
  const timeout = getExternalChatTimeoutMs(payload);
  const response = await createCompatibleChatCompletion(openai, {
    ...payload,
    model,
    messages,
    timeout,
    bypassSamsarExternalInference: true,
  });

  const assistantMessage = response?.choices?.[0]?.message;
  const outputText = typeof assistantMessage?.content === 'string'
    ? assistantMessage.content
    : '';
  const billing = calculateAssistantCreditsFromUsage({
    model: response?.model || model,
    usage: response?.usage,
    pricingMultiplier: EXTERNAL_CHAT_PRICING_MULTIPLIER,
  });
  const creditsCharged = billing.credits || calculateLegacyAssistantCredits({
    inputMessages: messages,
    outputText,
  });

  const chargeResult = await deductGenerationCredits(userId, creditsCharged, {
    source: 'external_chat_completion',
    metadata: {
      requestType: 'API',
      category: 'external_chat',
      model: response?.model || model,
      pricingMultiplier: billing.pricingMultiplier ?? EXTERNAL_CHAT_PRICING_MULTIPLIER,
      costUsd: billing.costUsd ?? null,
      usage: billing.usage ?? null,
      creditsCharged,
    },
  });

  return {
    response,
    creditsCharged,
    remainingCredits: chargeResult?.remainingCredits ?? null,
  };
}
