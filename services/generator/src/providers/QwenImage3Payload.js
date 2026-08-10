export const QWEN_IMAGE_3_PRO_MODEL_KEY = 'QWENIMAGE3PRO';
export const ALIBABA_QWEN_IMAGE_3_PRO_MODEL = 'qwen-image-3.0-pro';

export const QWEN_IMAGE_3_SUPPORTED_ASPECT_RATIOS = Object.freeze([
  '1:1',
  '16:9',
  '9:16',
]);

const QWEN_IMAGE_3_OUTPUT_BY_ASPECT_RATIO = Object.freeze({
  '1:1': Object.freeze({ width: 1024, height: 1024 }),
  '16:9': Object.freeze({ width: 1792, height: 1024 }),
  '9:16': Object.freeze({ width: 1024, height: 1792 }),
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSeed(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const seed = Number(value);
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
    return null;
  }
  return seed;
}

export function normalizeQwenImage3AspectRatio(value, fallback = '1:1') {
  const normalized = normalizeString(value).replace(/[xX]/g, ':');
  if (QWEN_IMAGE_3_SUPPORTED_ASPECT_RATIOS.includes(normalized)) {
    return normalized;
  }
  return QWEN_IMAGE_3_SUPPORTED_ASPECT_RATIOS.includes(fallback) ? fallback : '1:1';
}

export function getQwenImage3Output(value) {
  const aspectRatio = normalizeQwenImage3AspectRatio(value);
  return {
    aspectRatio,
    ...QWEN_IMAGE_3_OUTPUT_BY_ASPECT_RATIO[aspectRatio],
  };
}

export function getQwenImage3Prompt(payload = {}) {
  const prompt = normalizeString(payload.prompt ?? payload.input?.prompt);
  if (!prompt) {
    throw new Error('Qwen Image 3.0 Pro requires a non-empty prompt.');
  }
  return prompt;
}

export function buildAlibabaQwenImage3Request(payload = {}) {
  const prompt = getQwenImage3Prompt(payload);
  const output = getQwenImage3Output(payload.aspectRatio ?? payload.aspect_ratio);
  const negativePrompt = normalizeString(payload.negativePrompt ?? payload.negative_prompt);
  const seed = normalizeSeed(payload.seed);
  const promptExtend = payload.promptExtend ?? payload.prompt_extend ?? true;

  return {
    model: ALIBABA_QWEN_IMAGE_3_PRO_MODEL,
    input: {
      messages: [
        {
          role: 'user',
          content: [{ text: prompt }],
        },
      ],
    },
    parameters: {
      size: `${output.width}*${output.height}`,
      n: 1,
      prompt_extend: promptExtend !== false,
      watermark: false,
      ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      ...(seed !== null ? { seed } : {}),
    },
  };
}
