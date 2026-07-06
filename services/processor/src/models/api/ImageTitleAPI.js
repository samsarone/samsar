import OpenAI from 'openai';
import { deductGenerationCredits } from '../GenerationCredits.js';
import { calculateAssistantCreditsFromUsage } from './AssistantBilling.js';

const ASSIGN_TITLE_MODEL = process.env.IMAGE_ASSIGN_TITLE_MODEL || 'gpt-5.5';
const ASSIGN_TITLE_REASONING_EFFORT = 'low';
const ASSIGN_TITLE_IMAGE_DETAIL = 'low';
const ASSIGN_TITLE_PRICING_MULTIPLIER = 1.5;
const ASSIGN_TITLE_MAX_OUTPUT_TOKENS_DESCRIPTION = 220;
const ASSIGN_TITLE_MAX_OUTPUT_TOKENS_TITLE = 80;
const ASSIGN_TITLE_MAX_TITLE_CHARS = 72;
const ASSIGN_TITLE_MAX_TITLE_WORDS = 8;
const ASSIGN_TITLE_OPENAI_TIMEOUT_MS = Number.isFinite(Number(process.env.IMAGE_ASSIGN_TITLE_OPENAI_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.IMAGE_ASSIGN_TITLE_OPENAI_TIMEOUT_MS)))
  : 90000;

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const TITLE_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: {
      type: 'string',
      description: 'A short SEO-friendly title suitable for an image title or camel-cased filename.',
    },
  },
};

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

export async function assignTitleToImage(payload = {}) {
  const userId = normalizeNonEmptyString(payload.userId);
  if (!userId) {
    throw buildError('userId is required.', 401);
  }

  ensureOpenAIClient();

  const imageInput = resolveImageInput(payload);
  const metadata = normalizeMetadata(payload.metadata);

  const descriptionResponse = await analyzeImageForSeoTitle({ imageInput });
  const imageDescription = normalizeNonEmptyString(extractResponsesOutputText(descriptionResponse));
  if (!imageDescription) {
    throw buildError('OpenAI did not return an image description.', 502);
  }

  const titleResponse = await createSeoFriendlyTitle({
    imageDescription,
    metadata,
  });
  const rawTitlePayload = parseJsonFromResponse(titleResponse);
  const title = normalizeSeoTitle(rawTitlePayload?.title || '', imageDescription);
  if (!title) {
    throw buildError('OpenAI did not return an image title.', 502);
  }

  const billing = calculateAssignTitleBilling([
    { step: 'vision_description', response: descriptionResponse },
    { step: 'title_generation', response: titleResponse },
  ]);

  const chargeResult = await deductGenerationCredits(userId, billing.credits, {
    source: 'image_assign_title',
    metadata: {
      requestType: 'API',
      category: 'image',
      model: ASSIGN_TITLE_MODEL,
      pricingMultiplier: ASSIGN_TITLE_PRICING_MULTIPLIER,
      imageInputType: imageInput.type,
      imageMimeType: imageInput.mimeType || null,
      fileName: normalizeNonEmptyString(payload.fileName) || null,
      metadataKeys: Object.keys(metadata),
      billing,
    },
  });

  return {
    title,
    content: title,
    imageDescription,
    metadata,
    model: ASSIGN_TITLE_MODEL,
    creditsCharged: billing.credits,
    remainingCredits: chargeResult?.remainingCredits ?? null,
  };
}

async function analyzeImageForSeoTitle({ imageInput }) {
  return createOpenAIResponse({
    label: 'image title description',
    body: {
      model: ASSIGN_TITLE_MODEL,
      reasoning: { effort: ASSIGN_TITLE_REASONING_EFFORT },
      max_output_tokens: ASSIGN_TITLE_MAX_OUTPUT_TOKENS_DESCRIPTION,
      input: [
        {
          role: 'developer',
          content:
            'You analyze images for SEO title generation. Describe only visible, factual cues useful for naming the image. ' +
            'Prefer the main subject, setting, style, product/category cues, and readable relevant text. Avoid markdown.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text:
                'Analyze this image only for assigning a short SEO-friendly image title. ' +
                'Return one compact factual description in one or two sentences. Do not create the title yet.',
            },
            {
              type: 'input_image',
              image_url: imageInput.imageUrl,
              detail: ASSIGN_TITLE_IMAGE_DETAIL,
            },
          ],
        },
      ],
    },
  });
}

async function createSeoFriendlyTitle({ imageDescription, metadata }) {
  const metadataText = Object.keys(metadata).length > 0
    ? JSON.stringify(metadata)
    : '{}';

  return createOpenAIResponse({
    label: 'image title generation',
    body: {
      model: ASSIGN_TITLE_MODEL,
      reasoning: { effort: ASSIGN_TITLE_REASONING_EFFORT },
      max_output_tokens: ASSIGN_TITLE_MAX_OUTPUT_TOKENS_TITLE,
      text: {
        format: {
          type: 'json_schema',
          name: 'seo_image_title',
          strict: true,
          schema: TITLE_RESPONSE_SCHEMA,
        },
      },
      input: [
        {
          role: 'developer',
          content:
            'You are the custom function create_seo_image_title. Return JSON only. ' +
            'Create one short SEO-friendly image title that can also be camel-cased into a filename. ' +
            'Use 3 to 7 clear words when possible. Do not include file extensions, quotes, hashtags, markdown, or trailing punctuation. ' +
            'Use metadata only when it improves accuracy and never invent specific brands, locations, or people.',
        },
        {
          role: 'user',
          content:
            `Image description:\n${imageDescription}\n\n` +
            `Optional metadata JSON:\n${metadataText}\n\n` +
            'Return the best short title.',
        },
      ],
    },
  });
}

async function createOpenAIResponse({ body, label }) {
  return withTimeout(
    openaiClient.post('/responses', { body }),
    ASSIGN_TITLE_OPENAI_TIMEOUT_MS,
    label,
  );
}

function resolveImageInput(payload = {}) {
  const imageDataUrl = normalizeNonEmptyString(
    payload.imageDataUrl ||
    payload.image_data_url ||
    payload.imageData ||
    payload.image_data,
  );
  if (imageDataUrl) {
    return normalizeDataImageUrl(imageDataUrl);
  }

  const genericImage = normalizeNonEmptyString(payload.image);
  if (genericImage) {
    if (isDataImageUrl(genericImage)) {
      return normalizeDataImageUrl(genericImage);
    }
    if (isHttpUrl(genericImage)) {
      return { type: 'url', imageUrl: genericImage, mimeType: null };
    }
  }

  const imageUrl = normalizeNonEmptyString(payload.image_url || payload.imageUrl || payload.url);
  if (imageUrl && isHttpUrl(imageUrl)) {
    return { type: 'url', imageUrl, mimeType: null };
  }

  throw buildError('An image file, image_data data URL, or image_url is required.', 400);
}

function normalizeDataImageUrl(value) {
  const match = value.match(/^data:([^;,]+);base64,([\s\S]+)$/i);
  if (!match) {
    throw buildError('image_data must be a valid base64 image data URL.', 400);
  }

  const mimeType = normalizeImageMimeType(match[1]);
  if (!mimeType) {
    throw buildError('image_data must be a PNG, JPEG, WEBP, or non-animated GIF image.', 400);
  }

  const base64Payload = match[2].replace(/\s+/g, '');
  if (!base64Payload) {
    throw buildError('image_data must include a base64 payload.', 400);
  }

  return {
    type: 'data_url',
    imageUrl: `data:${mimeType};base64,${base64Payload}`,
    mimeType,
  };
}

function normalizeMetadata(value) {
  if (value === undefined || value === null || value === '') {
    return {};
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return normalizeMetadata(parsed);
    } catch {
      throw buildError('metadata must be valid JSON when provided as a string.', 400);
    }
  }

  if (isPlainObject(value)) {
    return removeUndefinedValues(value);
  }

  throw buildError('metadata must be a JSON object.', 400);
}

function calculateAssignTitleBilling(stepResponses = []) {
  const steps = stepResponses.map(({ step, response }) => {
    const billing = calculateAssistantCreditsFromUsage({
      model: response?.model || ASSIGN_TITLE_MODEL,
      usage: response?.usage,
      pricingMultiplier: ASSIGN_TITLE_PRICING_MULTIPLIER,
    });

    return {
      step,
      model: response?.model || ASSIGN_TITLE_MODEL,
      credits: billing.credits,
      costUsd: billing.costUsd,
      usage: billing.usage,
      pricingModel: billing.pricingModel,
      tokenPricingUsdPerMillion: billing.tokenPricingUsdPerMillion,
    };
  });

  const credits = roundTo(steps.reduce((sum, step) => sum + (Number(step.credits) || 0), 0), 4);
  const costUsd = roundTo(steps.reduce((sum, step) => sum + (Number(step.costUsd) || 0), 0), 8);
  const fallbackApplied = credits <= 0;

  return {
    credits: fallbackApplied ? 1 : credits,
    costUsd,
    pricingMultiplier: ASSIGN_TITLE_PRICING_MULTIPLIER,
    fallbackApplied,
    steps,
  };
}

function parseJsonFromResponse(response) {
  const outputText = extractResponsesOutputText(response);
  const parsed = parseJsonLoose(outputText);
  if (parsed) {
    return parsed;
  }
  throw buildError('OpenAI title response was not valid JSON.', 502);
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

function parseJsonLoose(input) {
  if (typeof input !== 'string') {
    return null;
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
    }
  }

  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    try {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    } catch {
    }
  }

  return null;
}

function normalizeSeoTitle(value, fallbackDescription = '') {
  let title = normalizeNonEmptyString(value)
    .replace(/[`"'“”‘’]/g, '')
    .replace(/[\\/:*?<>|#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '')
    .trim();

  if (!title) {
    title = normalizeNonEmptyString(fallbackDescription)
      .split(/[.!?]/)[0]
      .replace(/[`"'“”‘’]/g, '')
      .replace(/[\\/:*?<>|#]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const words = title.split(/\s+/).filter(Boolean);
  if (words.length > ASSIGN_TITLE_MAX_TITLE_WORDS) {
    title = words.slice(0, ASSIGN_TITLE_MAX_TITLE_WORDS).join(' ');
  }

  if (title.length > ASSIGN_TITLE_MAX_TITLE_CHARS) {
    title = title
      .slice(0, ASSIGN_TITLE_MAX_TITLE_CHARS)
      .replace(/\s+\S*$/g, '')
      .replace(/[.,;:!?]+$/g, '')
      .trim();
  }

  return title;
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(buildError(`${label} timed out after ${timeoutMs}ms`, 504));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function normalizeImageMimeType(value) {
  const normalized = normalizeNonEmptyString(value).toLowerCase();
  const mimeType = normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType) ? mimeType : null;
}

function isDataImageUrl(value) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function removeUndefinedValues(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function roundTo(value, decimals = 4) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function ensureOpenAIClient() {
  if (!openaiClient) {
    throw buildError('OPENAI_API_KEY is not set.', 500);
  }
}

function buildError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
