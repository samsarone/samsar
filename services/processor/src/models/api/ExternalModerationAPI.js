import {
  createNativeOpenAIModeration,
  getModerationDecision,
  getModerationTotalTimeoutMs,
} from '../moderation/CreateModeration.js';

export const EXTERNAL_MODERATION_DEFAULT_MODEL = 'omni-moderation-latest';
export const EXTERNAL_MODERATION_MAX_INPUTS = 32;
export const EXTERNAL_MODERATION_MAX_TEXT_CHARS = 100_000;
export const EXTERNAL_MODERATION_MAX_TOTAL_TEXT_CHARS = 200_000;
export const EXTERNAL_MODERATION_MAX_IMAGE_URL_CHARS = 8 * 1024 * 1024;

const MIN_EXTERNAL_MODERATION_TIMEOUT_MS = 1_000;
const MAX_EXTERNAL_MODERATION_TIMEOUT_MS = 120_000;
const SUPPORTED_MODERATION_MODELS = new Set([
  'omni-moderation-latest',
  'omni-moderation-2024-09-26',
  'text-moderation-latest',
  'text-moderation-stable',
]);

function buildError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.exposeExternalModerationMessage = true;
  if (code) {
    error.code = code;
  }
  return error;
}

function normalizeModel(value) {
  if (value === undefined || value === null || value === '') {
    return EXTERNAL_MODERATION_DEFAULT_MODEL;
  }
  if (typeof value !== 'string' || !SUPPORTED_MODERATION_MODELS.has(value.trim())) {
    throw buildError(
      `model must be one of: ${[...SUPPORTED_MODERATION_MODELS].join(', ')}.`,
    );
  }
  return value.trim();
}

function validateText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw buildError(`${label} must be a non-empty string.`);
  }
  if (value.length > EXTERNAL_MODERATION_MAX_TEXT_CHARS) {
    throw buildError(
      `${label} exceeds the ${EXTERNAL_MODERATION_MAX_TEXT_CHARS}-character limit.`,
      413,
    );
  }
  return value;
}

function validateImageUrl(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw buildError(`${label} must be a non-empty URL string.`);
  }
  if (value.length > EXTERNAL_MODERATION_MAX_IMAGE_URL_CHARS) {
    throw buildError(`${label} exceeds the supported URL/data-URL size.`, 413);
  }

  const normalized = value.trim();
  if (!/^https?:\/\//i.test(normalized) && !/^data:image\//i.test(normalized)) {
    throw buildError(`${label} must use http, https, or an image data URL.`);
  }
  return normalized;
}

function normalizeMultimodalInput(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw buildError(`input[${index}] must be a supported moderation input object.`);
  }

  if (entry.type === 'text') {
    return {
      type: 'text',
      text: validateText(entry.text, `input[${index}].text`),
    };
  }

  if (entry.type === 'image_url') {
    if (!entry.image_url || typeof entry.image_url !== 'object' || Array.isArray(entry.image_url)) {
      throw buildError(`input[${index}].image_url must be an object containing url.`);
    }
    return {
      type: 'image_url',
      image_url: {
        url: validateImageUrl(entry.image_url.url, `input[${index}].image_url.url`),
      },
    };
  }

  throw buildError(`input[${index}].type must be text or image_url.`);
}

export function normalizeExternalModerationInput(value) {
  if (typeof value === 'string') {
    return validateText(value, 'input');
  }

  if (!Array.isArray(value) || value.length === 0) {
    throw buildError(
      'input must be a non-empty string, array of strings, or array of moderation input objects.',
    );
  }
  if (value.length > EXTERNAL_MODERATION_MAX_INPUTS) {
    throw buildError(`input supports at most ${EXTERNAL_MODERATION_MAX_INPUTS} entries.`, 413);
  }

  const allStrings = value.every((entry) => typeof entry === 'string');
  const allObjects = value.every(
    (entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
  );
  if (!allStrings && !allObjects) {
    throw buildError('input arrays cannot mix strings and moderation input objects.');
  }

  const normalized = allStrings
    ? value.map((entry, index) => validateText(entry, `input[${index}]`))
    : value.map(normalizeMultimodalInput);
  const totalTextChars = normalized.reduce((total, entry) => {
    if (typeof entry === 'string') {
      return total + entry.length;
    }
    return entry.type === 'text' ? total + entry.text.length : total;
  }, 0);

  if (totalTextChars > EXTERNAL_MODERATION_MAX_TOTAL_TEXT_CHARS) {
    throw buildError(
      `input exceeds the ${EXTERNAL_MODERATION_MAX_TOTAL_TEXT_CHARS}-character aggregate text limit.`,
      413,
    );
  }

  return normalized;
}

export function getExternalModerationTimeoutMs(env = process.env) {
  const parsed = Number(env.SAMSAR_EXTERNAL_MODERATION_TIMEOUT_MS);
  const configuredTimeoutMs = Number.isFinite(parsed) && parsed > 0
    ? parsed
    : getModerationTotalTimeoutMs({ env, provider: 'openai' });
  return Math.min(
    MAX_EXTERNAL_MODERATION_TIMEOUT_MS,
    Math.max(MIN_EXTERNAL_MODERATION_TIMEOUT_MS, Math.floor(configuredTimeoutMs)),
  );
}

function aggregateModerationDecision(results) {
  const decisions = results.map((result) => getModerationDecision(result, { provider: 'openai' }));
  const rejected = decisions.filter((decision) => !decision.safe);
  if (rejected.length === 0) {
    return { safe: true, reason: 'passed' };
  }

  const categories = [
    ...new Set(rejected.flatMap((decision) => decision.categories || [])),
  ];
  const scoreDecision = rejected.find((decision) => decision.reason === 'category_score');
  const reason = rejected.some((decision) => decision.reason === 'flagged')
    ? 'flagged'
    : rejected[0].reason;

  return {
    safe: false,
    reason,
    ...(categories.length > 0 ? { categories } : {}),
    ...(scoreDecision?.threshold !== undefined
      ? { threshold: scoreDecision.threshold }
      : {}),
  };
}

function getExpectedResultCount(input) {
  return Array.isArray(input) && input.every((entry) => typeof entry === 'string')
    ? input.length
    : 1;
}

function validateNativeResponse(response, expectedResultCount) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw buildError(
      'The production moderation provider returned an invalid response.',
      502,
      'INVALID_MODERATION_RESPONSE',
    );
  }
  if (
    !Array.isArray(response.results) ||
    response.results.length !== expectedResultCount ||
    response.results.some((result) => (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      typeof result.flagged !== 'boolean' ||
      !result.categories ||
      typeof result.categories !== 'object' ||
      Array.isArray(result.categories) ||
      !result.category_scores ||
      typeof result.category_scores !== 'object' ||
      Array.isArray(result.category_scores)
    ))
  ) {
    throw buildError(
      'The production moderation provider returned no usable results.',
      502,
      'INVALID_MODERATION_RESPONSE',
    );
  }
  return response;
}

async function runWithTimeout(operation, timeoutMs, controller) {
  let timeoutId;
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(buildError(
        `External moderation exceeded its ${timeoutMs}ms request deadline.`,
        504,
        'EXTERNAL_MODERATION_TIMEOUT',
      ));
      controller.abort();
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve().then(operation), timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function createExternalModeration({
  userId,
  payload = {},
  moderationCall = createNativeOpenAIModeration,
  timeoutMs = getExternalModerationTimeoutMs(),
} = {}) {
  if (!userId) {
    throw buildError('User ID is required.', 401);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw buildError('The moderation request body must be an object.');
  }

  const input = normalizeExternalModerationInput(payload.input);
  const model = normalizeModel(payload.model);
  const boundedTimeoutMs = Math.min(
    MAX_EXTERNAL_MODERATION_TIMEOUT_MS,
    Math.max(MIN_EXTERNAL_MODERATION_TIMEOUT_MS, Number(timeoutMs) || getExternalModerationTimeoutMs()),
  );
  const controller = new AbortController();
  const response = await runWithTimeout(
    () => moderationCall(input, {
      model,
      signal: controller.signal,
    }),
    boundedTimeoutMs,
    controller,
  );
  const nativeResponse = validateNativeResponse(response, getExpectedResultCount(input));

  return {
    response: {
      ...nativeResponse,
      decision: aggregateModerationDecision(nativeResponse.results),
    },
  };
}

export function mapExternalModerationError(error) {
  const rawStatus = Number(
    error?.statusCode ||
    error?.status ||
    error?.response?.status,
  );
  const statusCode = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
    ? rawStatus
    : 500;

  if (error?.exposeExternalModerationMessage === true) {
    return {
      statusCode,
      message: error.message,
    };
  }

  if (
    error?.code === 'MODERATION_PROVIDER_UNAVAILABLE' ||
    statusCode === 401 ||
    statusCode === 403
  ) {
    return {
      statusCode: 503,
      message: 'The production moderation provider is not configured.',
    };
  }

  if (
    statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500
  ) {
    return {
      statusCode: statusCode === 408 ? 504 : 503,
      message: 'The production moderation provider is temporarily unavailable.',
    };
  }

  return {
    statusCode: statusCode >= 400 && statusCode < 500 ? statusCode : 502,
    message: statusCode >= 400 && statusCode < 500
      ? 'The production moderation provider rejected the request.'
      : 'The production moderation provider returned an invalid response.',
  };
}
