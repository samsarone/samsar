const TOKENS_PER_MILLION = 1_000_000;
const CREDITS_PER_DOLLAR = 100;
export const DEFAULT_ASSISTANT_PRICING_MULTIPLIER = 1.5;
export const EXTERNAL_CHAT_PRICING_MULTIPLIER = 1.25;

const TOKEN_PRICING_USD_PER_MILLION = Object.freeze({
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
  'qwen3.7-max': {
    input: 2.5,
    cachedInput: 2.5,
    output: 7.5,
  },
  'qwen3.7-plus': {
    input: 0.4,
    cachedInput: 0.4,
    output: 1.6,
    longContextInput: 1.2,
    longContextCachedInput: 1.2,
    longContextOutput: 4.8,
    longContextInputThreshold: 256_000,
  },
});

export function calculateAssistantCreditsFromUsage({
  model,
  usage,
  pricingMultiplier = DEFAULT_ASSISTANT_PRICING_MULTIPLIER,
} = {}) {
  const pricingModel = resolvePricingModel(model);
  const pricing = pricingModel ? TOKEN_PRICING_USD_PER_MILLION[pricingModel] : null;
  const normalizedUsage = normalizeUsage(usage);

  if (!pricing || (!normalizedUsage.inputTokens && !normalizedUsage.outputTokens)) {
    return {
      credits: 0,
      costUsd: 0,
      usage: normalizedUsage,
      pricingModel,
      pricingMultiplier,
    };
  }

  const cachedInputTokens = Math.max(
    0,
    Math.min(normalizedUsage.inputTokens, normalizedUsage.cachedInputTokens),
  );
  const uncachedInputTokens = Math.max(0, normalizedUsage.inputTokens - cachedInputTokens);
  const effectivePricing = getEffectiveTokenPricing(pricing, normalizedUsage.inputTokens);
  const cachedInputRate = effectivePricing.cachedInput ?? effectivePricing.input;

  const costUsd = (
    (uncachedInputTokens / TOKENS_PER_MILLION) * effectivePricing.input +
    (cachedInputTokens / TOKENS_PER_MILLION) * cachedInputRate +
    (normalizedUsage.outputTokens / TOKENS_PER_MILLION) * effectivePricing.output
  );
  const credits = roundTo(costUsd * CREDITS_PER_DOLLAR * pricingMultiplier, 4);

  return {
    credits,
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
  const normalizedUsage = usage && typeof usage === 'object' ? usage : {};
  const inputTokens = toSafeNumber(
    normalizedUsage.input_tokens,
    normalizedUsage.prompt_tokens,
    normalizedUsage.promptTokenCount,
  );
  const outputTokens = toSafeNumber(
    normalizedUsage.output_tokens,
    normalizedUsage.completion_tokens,
    normalizedUsage.candidatesTokenCount,
  );
  const cachedInputTokens = toSafeNumber(
    normalizedUsage.input_tokens_details?.cached_tokens,
    normalizedUsage.prompt_tokens_details?.cached_tokens,
  );
  const reasoningTokens = toSafeNumber(
    normalizedUsage.output_tokens_details?.reasoning_tokens,
    normalizedUsage.completion_tokens_details?.reasoning_tokens,
  );

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
  };
}

function resolvePricingModel(model) {
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

  if (providerModel.startsWith('gpt-5.6-sol')) {
    return 'gpt-5.6-sol';
  }

  if (providerModel.startsWith('gemini-3.1')) {
    return 'gemini-3.1-pro';
  }

  if (providerModel.startsWith('qwen3.7-plus') || providerModel.startsWith('qwen-3.7-plus')) {
    return 'qwen3.7-plus';
  }

  if (
    providerModel === 'qwen3.7' ||
    providerModel.startsWith('qwen3.7-max') ||
    providerModel.startsWith('qwen-3.7')
  ) {
    return 'qwen3.7-max';
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
