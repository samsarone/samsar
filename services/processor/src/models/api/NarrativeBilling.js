import { calculateAssistantCreditsFromUsage } from './AssistantBilling.js';

const CREDITS_PER_DOLLAR = 100;

export const NARRATIVE_PRICING_MULTIPLIER = 1.5;

/**
 * Calculate narrative billing from every inference call used to build a narrative.
 *
 * Each receipt is priced independently at the provider's underlying rate. The
 * narrative multiplier is applied once to the summed USD cost so rounding a
 * single call can never compound across retries or stages.
 *
 * @param {Array<object>} usageReceipts
 * @returns {object}
 */
export function calculateNarrativeBilling(usageReceipts = []) {
  const aggregateUsage = createEmptyUsage();
  const receipts = [];
  let underlyingCostUsd = 0;

  for (const receipt of Array.isArray(usageReceipts) ? usageReceipts : []) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
      continue;
    }

    const usage = getReceiptUsage(receipt);
    const model = getReceiptModel(receipt);
    const billing = calculateAssistantCreditsFromUsage({
      model,
      usage,
      pricingMultiplier: 1,
    });

    underlyingCostUsd += billing.costUsd;
    addUsage(aggregateUsage, billing.usage);

    receipts.push(createSafeReceipt(receipt, model, billing));
  }

  underlyingCostUsd = roundTo(underlyingCostUsd, 8);
  const underlyingCredits = roundTo(underlyingCostUsd * CREDITS_PER_DOLLAR, 4);
  const credits = roundTo(
    underlyingCostUsd * CREDITS_PER_DOLLAR * NARRATIVE_PRICING_MULTIPLIER,
    4,
  );

  return {
    credits,
    costUsd: underlyingCostUsd,
    underlyingCostUsd,
    underlyingCredits,
    usage: aggregateUsage,
    receipts,
    pricingMultiplier: NARRATIVE_PRICING_MULTIPLIER,
    creditsPerDollar: CREDITS_PER_DOLLAR,
  };
}

function getReceiptUsage(receipt) {
  const rawUsage = firstObject(
    receipt.usage,
    receipt.usageMetadata,
    receipt.response?.usage,
    receipt.response?.usageMetadata,
  );

  if (!rawUsage) {
    return {};
  }

  // The shared calculator understands normalized Gemini usage. Preserve that
  // path while also accepting Vertex's raw usageMetadata receipt shape.
  const cachedTokens = firstSafeNumber(
    rawUsage.input_tokens_details?.cached_tokens,
    rawUsage.prompt_tokens_details?.cached_tokens,
    rawUsage.cachedContentTokenCount,
    rawUsage.cachedInputTokens,
  );
  const reasoningTokens = firstSafeNumber(
    rawUsage.output_tokens_details?.reasoning_tokens,
    rawUsage.completion_tokens_details?.reasoning_tokens,
    rawUsage.thoughtsTokenCount,
    rawUsage.reasoningTokens,
  );
  const inputTokens = firstSafeNumber(
    rawUsage.input_tokens,
    rawUsage.prompt_tokens,
    rawUsage.promptTokenCount,
    rawUsage.inputTokens,
  );
  const hasNormalizedOutput = hasSafeNumber(rawUsage.output_tokens) ||
    hasSafeNumber(rawUsage.completion_tokens) ||
    hasSafeNumber(rawUsage.outputTokens);
  const outputTokens = hasNormalizedOutput
    ? firstSafeNumber(
      rawUsage.output_tokens,
      rawUsage.completion_tokens,
      rawUsage.outputTokens,
    )
    : firstSafeNumber(rawUsage.candidatesTokenCount) +
      firstSafeNumber(rawUsage.thoughtsTokenCount);

  return {
    ...rawUsage,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    input_tokens_details: {
      cached_tokens: cachedTokens,
    },
    output_tokens_details: {
      reasoning_tokens: reasoningTokens,
    },
  };
}

/**
 * Ensure every successful provider response can be priced. An aggregate-only
 * check can otherwise hide one missing receipt behind another valid call.
 */
export function validateNarrativeBilling(billing, expectedReceiptCount = null) {
  const receipts = Array.isArray(billing?.receipts) ? billing.receipts : [];
  const errors = [];

  if (Number.isSafeInteger(expectedReceiptCount) && expectedReceiptCount >= 0 &&
    receipts.length !== expectedReceiptCount) {
    errors.push(`Expected ${expectedReceiptCount} inference receipts but priced ${receipts.length}.`);
  }

  receipts.forEach((receipt, index) => {
    if (!receipt?.pricingModel) {
      errors.push(`Inference receipt ${index + 1} has an unsupported pricing model.`);
    }
    const inputTokens = toSafeNumber(receipt?.usage?.inputTokens);
    const outputTokens = toSafeNumber(receipt?.usage?.outputTokens);
    if (inputTokens + outputTokens <= 0) {
      errors.push(`Inference receipt ${index + 1} has no billable token usage.`);
    }
  });

  return { valid: errors.length === 0, errors };
}

function getReceiptModel(receipt) {
  return firstNonEmptyString(receipt.model, receipt.response?.model) ?? null;
}

function createSafeReceipt(receipt, model, billing) {
  const safeReceipt = {
    usage: billing.usage,
    underlyingCostUsd: billing.costUsd,
    underlyingCredits: billing.credits,
  };
  const stage = firstNonEmptyString(receipt.stage);
  const provider = firstNonEmptyString(receipt.provider);
  const attempt = toSafeAttempt(receipt.attempt);
  const validationAttempt = toSafeAttempt(receipt.validationAttempt);
  const requestKey = firstNonEmptyString(receipt.requestKey);

  if (stage !== null) {
    safeReceipt.stage = stage;
  }
  if (attempt !== null) {
    safeReceipt.attempt = attempt;
  }
  if (validationAttempt !== null) {
    safeReceipt.validationAttempt = validationAttempt;
  }
  if (requestKey !== null) {
    safeReceipt.requestKey = requestKey;
  }
  if (model !== null) {
    safeReceipt.model = model;
  }
  if (provider !== null) {
    safeReceipt.provider = provider;
  }
  if (billing.pricingModel) {
    safeReceipt.pricingModel = billing.pricingModel;
  }

  return safeReceipt;
}

function createEmptyUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
}

function addUsage(aggregate, usage) {
  aggregate.inputTokens += toSafeNumber(usage?.inputTokens);
  aggregate.outputTokens += toSafeNumber(usage?.outputTokens);
  aggregate.cachedInputTokens += toSafeNumber(usage?.cachedInputTokens);
  aggregate.reasoningTokens += toSafeNumber(usage?.reasoningTokens);
}

function firstObject(...values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) ?? null;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function firstSafeNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 0;
}

function hasSafeNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0;
}

function toSafeAttempt(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toSafeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function roundTo(value, decimals) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
