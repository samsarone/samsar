import { deductExternalUserCredits } from '../external/User.js';

const AUXILIARY_OPERATION_MULTIPLIER = 2;
const SAMSAR_CREDITS_PER_USD = 100;
const SAMSAR_USD_PER_CREDIT = 1 / SAMSAR_CREDITS_PER_USD;
const UTILITY_USD_RATES = Object.freeze({
  firecrawl: Object.freeze({
    usdPerCredit: 0.009,
  }),
  elevenlabsTts: Object.freeze({
    usdPer1kCharacters: 0.12,
  }),
  elevenlabsStt: Object.freeze({
    usdPerHour: 0.22,
  }),
  samsar: Object.freeze({
    creditsPerUsd: SAMSAR_CREDITS_PER_USD,
    usdPerCredit: SAMSAR_USD_PER_CREDIT,
  }),
});

function buildError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}

function normalizeUtilityType(payload = {}) {
  const rawValue =
    normalizeOptionalString(payload.utility_type) ||
    normalizeOptionalString(payload.utilityType) ||
    normalizeOptionalString(payload.type) ||
    normalizeOptionalString(payload.usage_type) ||
    normalizeOptionalString(payload.usageType);

  if (!rawValue) {
    throw buildError('utility_type is required.');
  }

  const normalizedValue = rawValue.toLowerCase();
  if (
    normalizedValue === 'elevenlabs_tts'
    || normalizedValue === 'tts'
    || normalizedValue === 'elevenlabs:text_to_speech'
  ) {
    return 'elevenlabs_tts';
  }

  if (
    normalizedValue === 'elevenlabs_stt'
    || normalizedValue === 'stt'
    || normalizedValue === 'transcription'
    || normalizedValue === 'elevenlabs:transcription'
  ) {
    return 'elevenlabs_stt';
  }

  if (
    normalizedValue === 'firecrawl'
    || normalizedValue === 'firecrawl_crawl'
    || normalizedValue === 'crawl'
  ) {
    return 'firecrawl';
  }

  throw buildError(`Unsupported utility_type "${rawValue}".`);
}

function normalizePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveElevenLabsCharacterCount(payload = {}) {
  const explicitCharacters =
    payload.elevenlabs_characters_used ??
    payload.elevenlabsCharactersUsed ??
    payload.elevenlabs_character_count ??
    payload.elevenlabsCharacterCount ??
    payload.characters ??
    payload.character_count ??
    payload.characterCount;
  const normalizedCharacters = normalizePositiveNumber(explicitCharacters);
  if (normalizedCharacters > 0) {
    return Math.ceil(normalizedCharacters);
  }

  const text =
    typeof payload.text === 'string'
      ? payload.text
      : typeof payload.content === 'string'
        ? payload.content
        : '';

  return text.length > 0 ? text.length : 0;
}

function resolveElevenLabsDurationHours(payload = {}) {
  const durationMs =
    payload.elevenlabs_duration_ms ??
    payload.elevenlabsDurationMs ??
    payload.duration_ms ??
    payload.durationMs;
  const normalizedDurationMs = normalizePositiveNumber(durationMs);
  if (normalizedDurationMs > 0) {
    return normalizedDurationMs / 3_600_000;
  }

  const durationSeconds =
    payload.elevenlabs_duration_seconds ??
    payload.elevenlabsDurationSeconds ??
    payload.duration_seconds ??
    payload.durationSeconds;
  const normalizedDurationSeconds = normalizePositiveNumber(durationSeconds);
  if (normalizedDurationSeconds > 0) {
    return normalizedDurationSeconds / 3_600;
  }

  const durationMinutes =
    payload.elevenlabs_duration_minutes ??
    payload.elevenlabsDurationMinutes ??
    payload.duration_minutes ??
    payload.durationMinutes;
  const normalizedDurationMinutes = normalizePositiveNumber(durationMinutes);
  if (normalizedDurationMinutes > 0) {
    return normalizedDurationMinutes / 60;
  }

  const durationHours =
    payload.elevenlabs_duration_hours ??
    payload.elevenlabsDurationHours ??
    payload.duration_hours ??
    payload.durationHours;
  const normalizedDurationHours = normalizePositiveNumber(durationHours);
  if (normalizedDurationHours > 0) {
    return normalizedDurationHours;
  }

  return 0;
}

function resolveFirecrawlCreditsUsed(payload = {}) {
  const creditsUsed =
    payload.firecrawl_credits_used ??
    payload.firecrawlCreditsUsed ??
    payload.firecrawl_credit_count ??
    payload.firecrawlCreditCount ??
    payload.credits_used ??
    payload.creditsUsed;

  return normalizePositiveNumber(creditsUsed);
}

function calculateCreditsFromUsd(costUsd) {
  const normalizedCostUsd = Number.isFinite(costUsd) ? Math.max(0, costUsd) : 0;
  return normalizedCostUsd * SAMSAR_CREDITS_PER_USD * AUXILIARY_OPERATION_MULTIPLIER;
}

export function calculateExternalUserUtilityCharge(payload = {}) {
  const utilityType = normalizeUtilityType(payload);
  const pricingMultiplier = AUXILIARY_OPERATION_MULTIPLIER;
  const model =
    normalizeOptionalString(payload.model) ||
    normalizeOptionalString(payload.model_id) ||
    normalizeOptionalString(payload.modelId);
  let provider = null;
  let costUsd = 0;
  let units = {};

  if (utilityType === 'elevenlabs_tts') {
    provider = 'elevenlabs';
    const characters = resolveElevenLabsCharacterCount(payload);
    if (characters <= 0) {
      throw buildError('text or characters is required for elevenlabs_tts charges.');
    }

    costUsd = (characters / 1000) * UTILITY_USD_RATES.elevenlabsTts.usdPer1kCharacters;
    units = {
      characters,
      usdPer1kCharacters: UTILITY_USD_RATES.elevenlabsTts.usdPer1kCharacters,
    };
  } else if (utilityType === 'elevenlabs_stt') {
    provider = 'elevenlabs';
    const durationHours = resolveElevenLabsDurationHours(payload);
    if (durationHours <= 0) {
      throw buildError(
        'duration_ms, duration_seconds, duration_minutes, or duration_hours is required for elevenlabs_stt charges.',
      );
    }

    costUsd = durationHours * UTILITY_USD_RATES.elevenlabsStt.usdPerHour;
    units = {
      durationHours,
      durationMinutes: durationHours * 60,
      durationSeconds: durationHours * 3600,
      usdPerHour: UTILITY_USD_RATES.elevenlabsStt.usdPerHour,
    };
  } else if (utilityType === 'firecrawl') {
    provider = 'firecrawl';
    const firecrawlCreditsUsed = resolveFirecrawlCreditsUsed(payload);
    if (firecrawlCreditsUsed <= 0) {
      throw buildError('firecrawl_credits_used is required for firecrawl charges.');
    }

    costUsd = firecrawlCreditsUsed * UTILITY_USD_RATES.firecrawl.usdPerCredit;
    units = {
      firecrawlCreditsUsed,
      usdPerCredit: UTILITY_USD_RATES.firecrawl.usdPerCredit,
    };
  }

  return {
    utilityType,
    provider,
    model,
    costUsd,
    pricingMultiplier,
    credits: calculateCreditsFromUsd(costUsd),
    creditsPerDollar: UTILITY_USD_RATES.samsar.creditsPerUsd,
    samsarUsdPerCredit: UTILITY_USD_RATES.samsar.usdPerCredit,
    units,
  };
}

export async function chargeExternalUserUtilityUsage({
  externalUser,
  payload = {},
} = {}) {
  if (!externalUser?._id) {
    throw buildError('External user is required for utility charges.');
  }

  const quote = calculateExternalUserUtilityCharge(payload);
  const normalizedMetadata = normalizeMetadata(payload.metadata);
  const source = `external_utility_${quote.utilityType}`;

  const deduction = await deductExternalUserCredits({
    externalUser,
    credits: quote.credits,
    countAsRequest: false,
    source,
    metadata: {
      requestType: 'API',
      category: 'external_utility',
      utilityType: quote.utilityType,
      provider: quote.provider,
      model: quote.model,
      costUsd: quote.costUsd,
      samsarCreditsPerUsd: quote.creditsPerDollar,
      samsarUsdPerCredit: quote.samsarUsdPerCredit,
      pricingMultiplier: quote.pricingMultiplier,
      creditsCalculated: quote.credits,
      units: quote.units,
      ...normalizedMetadata,
    },
  });

  return {
    utilityType: quote.utilityType,
    provider: quote.provider,
    model: quote.model,
    creditsCharged: deduction.creditsCharged,
    remainingCredits: deduction.remainingCredits ?? null,
    pricing: {
      costUsd: quote.costUsd,
      pricingMultiplier: quote.pricingMultiplier,
      creditsPerDollar: quote.creditsPerDollar,
      samsarUsdPerCredit: quote.samsarUsdPerCredit,
      units: quote.units,
    },
    external_user: deduction.externalUser ?? null,
    externalUser: deduction.externalUser ?? null,
  };
}
