import { getReasoningModelBase } from '../../inference/ReasoningModels.js';
import { GENERATION_PRICING_MULTIPLIER, GENERATION_CREDITS_PER_USD } from '../../consts/pricing/GenerationPricingPolicy.js';

const TOKENS_PER_MILLION = 1_000_000;
const CREDITS_PER_DOLLAR = GENERATION_CREDITS_PER_USD;
export const DEFAULT_ASSISTANT_PRICING_MULTIPLIER = GENERATION_PRICING_MULTIPLIER;
export const EXTERNAL_CHAT_PRICING_MULTIPLIER = GENERATION_PRICING_MULTIPLIER;
const GEMINI_4_CARBON_STANDARD_PRICING_START_MS = Date.UTC(2026, 11, 1);
const GEMINI_4_CARBON_STANDARD_PRICING = Object.freeze({
  input: 4,
  cachedInput: 0.2,
  output: 20,
});

const TOKEN_PRICING_USD_PER_MILLION = Object.freeze({
  'claude-fable-5.2': { input: 8, cachedInput: 0.2, output: 40, cacheWrite: 10, cacheWriteHour: 16 },
  'claude-fable-5.1': { input: 10, cachedInput: 0.25, output: 50, cacheWrite: 12.5, cacheWriteHour: 20 }, // Historical receipts.
  'claude-opus-5.5': { input: 4, cachedInput: 0.2, output: 20, cacheWrite: 5, cacheWriteHour: 8 },
  'gpt-6.1-sol': {
    input: 2,
    cachedInput: 0.1,
    output: 10,
    longContextInput: 4,
    longContextCachedInput: 0.2,
    longContextOutput: 15,
    longContextInputThreshold: 272_000,
  },
  'gpt-6-astra': {
    input: 10,
    cachedInput: 1,
    output: 50,
    longContextInput: 20,
    longContextCachedInput: 2,
    longContextOutput: 75,
    longContextInputThreshold: 272_000,
  },
  'gpt-5.6-luna': {
    input: 1,
    cachedInput: 0.1,
    output: 6,
    longContextInput: 2,
    longContextCachedInput: 0.2,
    longContextOutput: 9,
    longContextInputThreshold: 272_000,
  },
  'gpt-5.6-sol': {
    input: 5,
    cachedInput: 0.5,
    output: 30,
    longContextInput: 10,
    longContextCachedInput: 1,
    longContextOutput: 45,
    longContextInputThreshold: 272_000,
  },
  'gemini-3.1-pro': {
    input: 2,
    cachedInput: 0.2,
    output: 12,
    longContextInput: 4,
    longContextCachedInput: 0.4,
    longContextOutput: 18,
    longContextInputThreshold: 200_000,
  },
  // Google Cloud global Standard pricing through November 30, 2026.
  'gemini-4-carbon': { input: 2, cachedInput: 0.1, output: 10 },
  'gemini-4-argon': { input: 2, cachedInput: 0.1, output: 10 }, // Historical receipts.
  'qwen3.8-max': { input: 2, cachedInput: 0.25, output: 6, cacheWrite: 2.5 },
  'kimi-k3': {
    input: 3,
    cachedInput: 0.3,
    output: 15,
  },
});

// Narrative and publication tools retain their existing pricing contracts.
const LEGACY_INFERENCE_PRICING = {
  ...TOKEN_PRICING_USD_PER_MILLION,
  'qwen3.8-max': { input: 2.5, cachedInput: 2.5, output: 7.5 },
  'claude-opus-5.5': { input: 0.8374, cachedInput: 0.8374, output: 20.07 },
};
export function calculateInferenceCreditsFromUsage(options = {}) {
  return calculateAssistantCreditsFromUsage({ ...options, tariffProfile: 'legacy' });
}

export function calculateAssistantCreditsFromUsage({
  model,
  usage,
  pricingMultiplier,
  pricingTimestampMs = Date.now(),
  tariffProfile = 'assistant',
  adapter,
  adapterCostUsd,
  region,
} = {}) {
  const pricingModel = resolvePricingModel(model);
  pricingMultiplier ??= DEFAULT_ASSISTANT_PRICING_MULTIPLIER;
  const billedAtMs = Number.isFinite(pricingTimestampMs) ? pricingTimestampMs : Date.now();
  const pricing = ['gemini-4-carbon', 'gemini-4-argon'].includes(pricingModel) && billedAtMs >= GEMINI_4_CARBON_STANDARD_PRICING_START_MS
    ? GEMINI_4_CARBON_STANDARD_PRICING
    : pricingModel ? (tariffProfile === 'legacy' ? LEGACY_INFERENCE_PRICING : TOKEN_PRICING_USD_PER_MILLION)[pricingModel] : null;
  const normalizedUsage = normalizeUsage(usage);
  // Provider monetary fields are audit data only. Settlement always uses the
  // checked-in model tariff and measured usage, including zero-token usage.

  const hasTokenUsage = [usage, usage?.anthropic_usage, usage?.google_usage_metadata].some(source =>
    source && [source.input_tokens, source.prompt_tokens, source.promptTokenCount,
      source.output_tokens, source.completion_tokens, source.candidatesTokenCount]
      .some(value => value !== undefined && value !== null));
  if (!pricing || (!normalizedUsage.inputTokens && !normalizedUsage.outputTokens && !hasTokenUsage)) {
    return {
      credits: 0,
      costUsd: 0,
      billable: false,
      usage: normalizedUsage,
      pricingModel,
      pricingMultiplier,
    };
  }

  if (tariffProfile === 'assistant' && (normalizedUsage.cachedInputTokens > normalizedUsage.inputTokens ||
    (normalizedUsage.cacheWriteHourTokens || 0) > (normalizedUsage.cacheWriteTokens || 0))) {
    throw billingError('Provider cache counts are inconsistent.', 'ASSISTANT_BILLING_INVALID_USAGE');
  }
  const cachedInputTokens = Math.max(
    0,
    Math.min(normalizedUsage.inputTokens, normalizedUsage.cachedInputTokens),
  );
  const cacheWriteTokens = normalizedUsage.cacheWriteTokens || 0;
  const cacheWriteHourTokens = Math.min(cacheWriteTokens, normalizedUsage.cacheWriteHourTokens || 0);
  if (cachedInputTokens + cacheWriteTokens > normalizedUsage.inputTokens) {
    throw billingError("Cache counts exceed total input tokens.", "ASSISTANT_BILLING_INVALID_USAGE");
  }
  const uncachedInputTokens = Math.max(0, normalizedUsage.inputTokens - cachedInputTokens - cacheWriteTokens);
  const effectivePricing = getEffectiveTokenPricing(pricing, normalizedUsage.inputTokens);
  const cachedInputRate = effectivePricing.cachedInput ?? effectivePricing.input;

  let costUsd = (
    (uncachedInputTokens / TOKENS_PER_MILLION) * effectivePricing.input +
    (cachedInputTokens / TOKENS_PER_MILLION) * cachedInputRate +
    ((cacheWriteTokens - cacheWriteHourTokens) / TOKENS_PER_MILLION) * (pricing.cacheWrite !== undefined ? pricing.cacheWrite * (effectivePricing.longContext ? 2 : 1) : effectivePricing.input * (pricingModel.startsWith("gpt-") ? 1.25 : 1)) +
    (cacheWriteHourTokens / TOKENS_PER_MILLION) * (pricing.cacheWriteHour ?? effectivePricing.input * 2) +
    (normalizedUsage.outputTokens / TOKENS_PER_MILLION) * effectivePricing.output
  );
  if (region && region !== 'global' && ['gemini-4-carbon', 'gemini-4-argon'].includes(pricingModel)) costUsd *= 1.1;
  const credits = roundTo(costUsd * CREDITS_PER_DOLLAR * pricingMultiplier, 4);

  return {
    credits,
    billable: true,
    costSource: "token_tariff",
    costUsd: roundTo(costUsd, 8),
    usage: normalizedUsage,
    pricingModel,
    pricingMultiplier,
    creditsPerDollar: CREDITS_PER_DOLLAR,
    tokenPricingUsdPerMillion: effectivePricing,
  };
}

export function calculateLegacyAssistantCredits({
  inputMessages = [],
  outputText = '',
} = {}) {
  const inputTexts = Array.isArray(inputMessages)
    ? inputMessages.map((message) => getTextFromMessageContent(message?.content)).join(' ')
    : '';
  const totalText = `${inputTexts} ${typeof outputText === 'string' ? outputText : ''}`.trim();
  const totalWords = totalText.split(/\s+/).filter(Boolean).length;

  let creditsNeeded = Math.ceil(totalWords / 1000) || 1;
  return creditsNeeded;
}

export function normalizeUsage(usage) {
  const source = usage && typeof usage === 'object' ? usage : {};
  const raw = source.anthropic_usage || source.google_usage_metadata || source;
  const anthropic = raw.cache_read_input_tokens !== undefined || raw.cache_creation_input_tokens !== undefined;
  const google = raw.promptTokenCount !== undefined;
  const cachedInputTokens = toSafeNumber(raw.cache_read_input_tokens, raw.cachedContentTokenCount,
    source.input_tokens_details?.cached_tokens, source.prompt_tokens_details?.cached_tokens);
  const cacheWriteTokens = toSafeNumber(raw.cache_creation_input_tokens,
    source.input_tokens_details?.cache_write_tokens, source.prompt_tokens_details?.cache_write_tokens);
  const cacheWriteHourTokens = toSafeNumber(raw.cache_creation?.ephemeral_1h_input_tokens,
    source.input_tokens_details?.cache_write_tokens_details?.ttl_1h_tokens);
  const inputTokens = anthropic
    ? toSafeNumber(raw.input_tokens) + cachedInputTokens + cacheWriteTokens
    : toSafeNumber(raw.promptTokenCount, source.input_tokens, source.prompt_tokens);
  const reasoningTokens = toSafeNumber(raw.thoughtsTokenCount,
    source.output_tokens_details?.reasoning_tokens, source.completion_tokens_details?.reasoning_tokens);
  const outputTokens = google
    ? (raw.candidatesTokenCount == null
      ? Math.max(0, toSafeNumber(raw.totalTokenCount) - inputTokens)
      : toSafeNumber(raw.candidatesTokenCount) + reasoningTokens)
    : toSafeNumber(source.output_tokens, source.completion_tokens);
  return { inputTokens, outputTokens, cachedInputTokens, reasoningTokens,
    ...(cacheWriteTokens ? { cacheWriteTokens, cacheWriteHourTokens } : {}) };
}

// Preserve monetary and provider-specific usage when translating chat and
// Responses formats. Reasoning is already included in normalized output.
export function normalizeAssistantResponseUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const u = normalizeUsage(usage);
  const inputDetails = { ...(usage.prompt_tokens_details || {}), ...(usage.input_tokens_details || {}),
    cached_tokens: u.cachedInputTokens,
    ...(u.cacheWriteTokens ? { cache_write_tokens: u.cacheWriteTokens } : {}) };
  const outputDetails = { ...(usage.completion_tokens_details || {}), ...(usage.output_tokens_details || {}),
    reasoning_tokens: u.reasoningTokens };
  return { ...usage, input_tokens: u.inputTokens, prompt_tokens: u.inputTokens,
    output_tokens: u.outputTokens, completion_tokens: u.outputTokens,
    input_tokens_details: inputDetails, prompt_tokens_details: inputDetails,
    output_tokens_details: outputDetails, completion_tokens_details: outputDetails,
    total_tokens: Number(usage.total_tokens) || u.inputTokens + u.outputTokens };
}

export function assertAssistantTariffAvailable(model) {
  const pricingModel = resolvePricingModel(model);
  if (!pricingModel || !TOKEN_PRICING_USD_PER_MILLION[pricingModel]) {
    throw billingError('The inference model has no checked-in token tariff.', 'ASSISTANT_BILLING_TARIFF_UNAVAILABLE');
  }
  return pricingModel;
}

export function calculateAssistantRequestBilling(response, { model, waived = false, pricingTimestampMs } = {}) {
  if (waived) return { credits: 0, costUsd: 0, billable: true, waived: true,
    pricingMultiplier: DEFAULT_ASSISTANT_PRICING_MULTIPLIER };
  const adapter = response?.samsarBilling?.adapter;
  assertAssistantTariffAvailable(response?.model || model);
  const result = calculateAssistantCreditsFromUsage({
    model: response?.model || model, usage: response?.usage,
    adapter,
    adapterCostUsd: response?.samsarBilling?.costUsd,
    region: response?.samsarBilling?.region,
    pricingTimestampMs,
    // Assistant policy is fixed here, irrespective of model or client options.
    pricingMultiplier: DEFAULT_ASSISTANT_PRICING_MULTIPLIER,
  });
  if (result.costSource === 'token_tariff') {
    validateAssistantTokenCounts(response?.usage);
    const paidToolTypes = new Set(['image_generation_call', 'web_search_call', 'file_search_call',
      'code_interpreter_call', 'shell_call']);
    if (response?.output?.some?.(item => paidToolTypes.has(item.type)) ||
      Object.values(response?.usage?.anthropic_usage?.server_tool_use || {}).some(Number)) {
      throw billingError('This response includes paid tools without checked-in tool tariffs; provider-reported costs are not used.',
        'ASSISTANT_BILLING_TOOL_COST_REQUIRED');
    }
  }
  if (!result.billable) throw billingError('Provider response has no supported billable token usage.',
    'ASSISTANT_BILLING_USAGE_REQUIRED');
  return result;
}

function validateAssistantTokenCounts(usage) {
  const tokenFields = new Set(['input_tokens', 'prompt_tokens', 'output_tokens', 'completion_tokens',
    'cached_tokens', 'cache_write_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
    'ephemeral_1h_input_tokens', 'ephemeral_5m_input_tokens', 'reasoning_tokens',
    'promptTokenCount', 'candidatesTokenCount', 'thoughtsTokenCount', 'cachedContentTokenCount', 'totalTokenCount']);
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, count] of Object.entries(value)) {
      if (tokenFields.has(key) && count != null &&
        (typeof count === 'boolean' || (typeof count === 'string' && !count.trim()) || !Number.isSafeInteger(Number(count)) || Number(count) < 0)) {
        throw billingError('Provider token counts are invalid.', 'ASSISTANT_BILLING_INVALID_USAGE');
      }
      if (count && typeof count === 'object') visit(count);
    }
  }
  visit(usage);
}

function billingError(message, code) {
  return Object.assign(new Error(message), { code, status: 502, statusCode: 502 });
}

function resolvePricingModel(model) {
  // Settle historical receipts against their actual model, before saved-choice aliases.
  const receiptToken = String(model || '').replace(/^(?:anthropic)\//i, '').replace(/[^a-z0-9]/gi, '').toUpperCase().replace(/(?:EXTRAHIGH|XHIGH|HIGH)$/, '');
  if (receiptToken === 'CLAUDEFABLE51') return 'claude-fable-5.1';
  const reasoningModel = getReasoningModelBase(model);
  if (TOKEN_PRICING_USD_PER_MILLION[reasoningModel]) return reasoningModel;
  if (typeof model !== 'string') {
    return null;
  }

  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  const providerModel = normalized.includes('/')
    ? normalized.slice(normalized.lastIndexOf('/') + 1)
    : normalized;

  if (providerModel.startsWith('gpt-5.6-luna')) {
    return 'gpt-5.6-luna';
  }

  if (['claude-opus-5.5', 'claude-opus-5-5'].includes(providerModel)) {
    return 'claude-opus-5.5';
  }

  if (providerModel.startsWith('gpt-6.1-sol')) {
    return 'gpt-6.1-sol';
  }

  if (providerModel.startsWith('gpt-6-astra')) {
    return 'gpt-6-astra';
  }

  if (providerModel.startsWith('gpt-5.6-sol')) {
    return 'gpt-5.6-sol';
  }

  if (providerModel.startsWith('gemini-4-argon')) return 'gemini-4-argon';

  if (providerModel.startsWith('gemini-4-carbon')) {
    return 'gemini-4-carbon';
  }

  if (providerModel.startsWith('gemini-3.1')) {
    return 'gemini-3.1-pro';
  }

  if (
    providerModel === 'qwen3.8' ||
    providerModel.startsWith('qwen3.8-max') ||
    providerModel.startsWith('qwen-3.8')
  ) {
    return 'qwen3.8-max';
  }

  if (providerModel === 'kimik3' || providerModel.startsWith('kimi-k3')) {
    return 'kimi-k3';
  }

  return null;
}

function getEffectiveTokenPricing(pricing, inputTokens) {
  const threshold = Number(pricing.longContextInputThreshold);
  if (!Number.isFinite(threshold) || threshold <= 0 || inputTokens <= threshold) {
    return {
      input: pricing.input,
      cachedInput: pricing.cachedInput,
      output: pricing.output,
    };
  }

  return {
    input: pricing.longContextInput ?? pricing.input,
    cachedInput: pricing.longContextCachedInput ?? pricing.cachedInput,
    output: pricing.longContextOutput ?? pricing.output,
    longContext: true,
    longContextInputThreshold: threshold,
  };
}

function getTextFromMessageContent(content) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      if (typeof item.text === 'string') {
        return item.text;
      }

      if (typeof item.content === 'string') {
        return item.content;
      }

      return '';
    })
    .join(' ');
}

function toSafeNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  return 0;
}

function roundTo(value, decimals = 4) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
