const TOKENS_PER_MILLION = 1_000_000;
const CREDITS_PER_DOLLAR = 100;
const DEFAULT_ASSISTANT_PRICING_MULTIPLIER = 2.5;

const TOKEN_PRICING_USD_PER_MILLION = Object.freeze({
  'gpt-5.5': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gemini-3.1-pro': { input: 2.5, cachedInput: 0.25, output: 15 },
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
  const cachedInputRate = pricing.cachedInput ?? pricing.input;

  const costUsd = (
    (uncachedInputTokens / TOKENS_PER_MILLION) * pricing.input +
    (cachedInputTokens / TOKENS_PER_MILLION) * cachedInputRate +
    (normalizedUsage.outputTokens / TOKENS_PER_MILLION) * pricing.output
  );
  const credits = roundTo(costUsd * CREDITS_PER_DOLLAR * pricingMultiplier, 4);

  return {
    credits,
    costUsd: roundTo(costUsd, 8),
    usage: normalizedUsage,
    pricingModel,
    pricingMultiplier,
    creditsPerDollar: CREDITS_PER_DOLLAR,
    tokenPricingUsdPerMillion: pricing,
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

  if (normalized.startsWith('gpt-5.5')) {
    return 'gpt-5.5';
  }

  if (normalized.startsWith('gemini-')) {
    return 'gemini-3.1-pro';
  }

  return null;
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
