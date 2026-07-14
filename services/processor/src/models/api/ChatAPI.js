import OpenAI from "openai";
import User from "../../schema/User.js";
import UserAPIChats from "../../schema/UserAPIChats.js";
import { getDBConnectionString } from "../DBString.js";
import { getModelForUserInferenceModel } from "../agent/ModelUtils.js";
import { createCompatibleChatCompletion } from "../ai_utils/OpenAICompat.js";
import { creditGenerationCredits, deductGenerationCredits } from "../GenerationCredits.js";
import { getEnhanceMessagePricing } from "../../consts/pricing/ApiPricing.js";
import { getLanguageStringFromLanguageCode } from "../../consts/LanguageCodes.js";
import {
  DEFAULT_INFERENCE_MODEL,
  isGeminiInferenceModel,
  isQwenInferenceModel,
  normalizeInferenceModel,
} from "../../consts/InferenceModels.js";

const API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MAX_WORDS = 800;
const MAX_ALLOWED_MAX_WORDS = 1500;

const TEXT_ENHANCE_SYSTEM_PROMPT = `
You are a persuasive marketing copywriter. Turn user messages into conversion-focused copy that makes people want to buy or take the intended action.
Use the provided metadata (e.g., audience, product, offer, differentiators, tone, channel) only as private context to guide wording - never restate or echo metadata fields or details.
Preserve the original intent and constraints while elevating clarity, emotion, and polish.
Write vivid, benefits-first messaging in active voice; translate metadata into enticing phrasing instead of repeating it verbatim or listing fields.
Lead with a hook, weave in the strongest proof or differentiator, and close with a clear call to action suited to the channel.
Keep claims accurate to the metadata; do not invent brands, locations, guarantees, or specifics not provided in the original message or metadata.
Avoid filler - prefer tight, high-impact lines over long explanations.
Do not use headings, bullets, bold, italics, or other markdown formatting.
The only markdown allowed is inline links in the form [descriptive anchor text](https://example.com).
Never output raw URLs in parentheses or as standalone bare links.
Do not quote, repeat, or list metadata; use it only to inform tone and benefits while keeping the wording grounded in the original message.
Aim for approximately {targetWordRange} words when possible.
Maximum words (equivalent): {maxwords}.
Use a professional marketing copy tone; avoid em dashes - use straightforward punctuation.`;
const ENHANCE_MESSAGE_PRICING = getEnhanceMessagePricing();
export const CHAT_CREDIT_COST = ENHANCE_MESSAGE_PRICING.credits;

const openai = new OpenAI({ apiKey: API_KEY || '' });

/**
 * Enhance a user message using OpenAI chat completions.
 * @param {Object} payload
 * @param {Object} payload.metadata
 * @param {string} payload.message
 * @param {string} [payload.userId]
 * @param {string} [payload.language]
 * @param {number|string} [payload.maxwords]
 * @param {number|string} [payload.maxWords]
 */
export async function requestChatEnhance(payload = {}) {
  const {
    metadata = {},
    message,
    userId,
    language = 'auto',
    maxwords,
    maxWords,
  } = payload;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    throw new Error('Message is required');
  }

  const normalizedMetadata = isPlainObject(metadata) ? metadata : {};
  const normalizedMaxWords = normalizeMaxWords(maxwords ?? maxWords);
  const targetWordRange = getTargetWordRange(normalizedMaxWords);

  let normalizedSystemPrompt = TEXT_ENHANCE_SYSTEM_PROMPT
    .replace('{targetWordRange}', targetWordRange)
    .replace('{maxwords}', normalizedMaxWords.toString());

  const languageString = getLanguageStringFromLanguageCode(language);
  if (languageString) {
    normalizedSystemPrompt += `\nEnsure that the enhanced message is created in ${languageString} language.`;
  }

  const messages = [
    {
      role: 'developer',
      content: normalizedSystemPrompt,
    },
  ];

  if (Object.keys(normalizedMetadata).length > 0) {
    messages.push({
      role: 'user',
      content: `Metadata:\n${JSON.stringify(normalizedMetadata)}`,
    });
  }

  messages.push({
    role: 'user',
    content: `Original Message:\n${message.trim()}`,
  });

  const inferenceModel = await getInferenceModelForUser(userId);
  const model = getModelForUserInferenceModel(inferenceModel);

  if (!API_KEY && !isGeminiInferenceModel(model) && !isQwenInferenceModel(model)) {
    throw new Error('OPENAI_API_KEY is not set');
  }

  let response;
  try {
    response = await createCompatibleChatCompletion(openai, {
      model,
      messages,
    });
  } catch (error) {
    console.error('[models][chat_enhance] OpenAI request failed', {
      userId: userId ?? null,
      inferenceModel,
      model,
      language,
      messageLength: message.trim().length,
      metadataKeys: Object.keys(normalizedMetadata),
      openaiError: summarizeOpenAIError(error),
    });
    throw error;
  }

  const enhancedMessage = response?.choices?.[0]?.message?.content?.trim() || '';

  await saveUserAPIChatSession({
    userId,
    metadata: normalizedMetadata,
    inputMessage: message.trim(),
    responseMessage: enhancedMessage,
    inferenceModel,
    model,
    creditsCharged: CHAT_CREDIT_COST,
    status: 'success',
  });

  return {
    openaiResponse: response,
    enhancedMessage,
    model,
    inferenceModel,
    metadata: normalizedMetadata,
    userId,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMaxWords(value) {
  const parsedValue = Number(value);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0 || parsedValue > MAX_ALLOWED_MAX_WORDS) {
    return DEFAULT_MAX_WORDS;
  }

  return parsedValue;
}

function getTargetWordRange(maxWords) {
  const targetMin = Math.max(1, Math.round(maxWords * 0.625));
  const targetMax = Math.max(targetMin, Math.round(maxWords * 0.75));
  return `${targetMin}-${targetMax}`;
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

async function getInferenceModelForUser(userId) {
  if (!userId) {
    return DEFAULT_INFERENCE_MODEL;
  }

  try {
    await getDBConnectionString();
    const userData = await User.findById(userId).lean();

    if (!userData) {
      return DEFAULT_INFERENCE_MODEL;
    }

    return normalizeInferenceModel(userData.selectedInferenceModel);
  } catch {
    return DEFAULT_INFERENCE_MODEL;
  }
}

export async function chargeCreditsForChat(userId, amount = CHAT_CREDIT_COST) {
  if (!userId) {
    throw new Error('User ID is required to charge credits');
  }

  const parsedAmount = Number(amount);
  const creditsToCharge = Number.isFinite(parsedAmount) && parsedAmount > 0
    ? parsedAmount
    : ENHANCE_MESSAGE_PRICING.credits;
  const pricing = {
    ...ENHANCE_MESSAGE_PRICING,
    credits: creditsToCharge,
    distribution: {
      ...ENHANCE_MESSAGE_PRICING.distribution,
      totalCredits: creditsToCharge,
    },
  };

  const deduction = await deductGenerationCredits(userId, creditsToCharge, {
    source: 'chat_enhance',
    metadata: {
      pricing,
      requestType: 'API',
      category: 'chat',
    },
  });

  return deduction;
}

export async function refundCreditsForChat(userId, amount = CHAT_CREDIT_COST) {
  if (!userId) {
    return { remainingCredits: null };
  }

  const parsedAmount = Number(amount);
  const creditsToRefund = Number.isFinite(parsedAmount) && parsedAmount > 0
    ? parsedAmount
    : ENHANCE_MESSAGE_PRICING.credits;
  const pricing = {
    ...ENHANCE_MESSAGE_PRICING,
    credits: creditsToRefund,
    distribution: {
      ...ENHANCE_MESSAGE_PRICING.distribution,
      totalCredits: creditsToRefund,
    },
  };

  return creditGenerationCredits(userId, creditsToRefund, {
    source: 'chat_enhance_refund',
    metadata: { pricing },
  });
}

export async function saveUserAPIChatSession(sessionData) {
  try {
    await getDBConnectionString();
    const session = new UserAPIChats(sessionData);
    await session.save();
  } catch {
  }
}
