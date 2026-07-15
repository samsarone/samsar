export const WAN_27_PRO_MODEL_KEY = 'WAN2.7PRO';
export const ALIBABA_WAN_27_PRO_MODEL = 'wan2.7-image-pro';
export const FAL_WAN_27_PRO_ENDPOINT = 'fal-ai/wan/v2.7/pro/text-to-image';

export const WAN_27_SUPPORTED_ASPECT_RATIOS = Object.freeze([
  '1:1',
  '16:9',
  '9:16',
]);

const WAN_27_1K_OUTPUT_BY_ASPECT_RATIO = Object.freeze({
  '1:1': Object.freeze({
    width: 1024,
    height: 1024,
    falImageSize: 'square_hd',
  }),
  '16:9': Object.freeze({
    width: 1792,
    height: 1024,
    falImageSize: Object.freeze({ width: 1792, height: 1024 }),
  }),
  '9:16': Object.freeze({
    width: 1024,
    height: 1792,
    falImageSize: Object.freeze({ width: 1024, height: 1792 }),
  }),
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

export function normalizeWan27AspectRatio(value, fallback = '1:1') {
  const normalized = normalizeString(value).replace(/[xX]/g, ':');
  if (WAN_27_SUPPORTED_ASPECT_RATIOS.includes(normalized)) {
    return normalized;
  }
  return WAN_27_SUPPORTED_ASPECT_RATIOS.includes(fallback) ? fallback : '1:1';
}

export function getWan27OneKOutput(value) {
  const aspectRatio = normalizeWan27AspectRatio(value);
  const output = WAN_27_1K_OUTPUT_BY_ASPECT_RATIO[aspectRatio];
  return {
    aspectRatio,
    resolution: '1K',
    ...output,
    falImageSize: typeof output.falImageSize === 'string'
      ? output.falImageSize
      : { ...output.falImageSize },
  };
}

export function getWan27Prompt(payload = {}) {
  const prompt = normalizeString(payload.prompt ?? payload.input?.prompt);
  if (!prompt) {
    throw new Error('Wan2.7 Pro requires a non-empty prompt.');
  }
  return prompt;
}

export function buildFalWan27Input(payload = {}) {
  const prompt = getWan27Prompt(payload);
  const output = getWan27OneKOutput(payload.aspectRatio ?? payload.aspect_ratio);
  const negativePrompt = normalizeString(payload.negativePrompt ?? payload.negative_prompt);
  const seed = normalizeSeed(payload.seed);

  return {
    prompt,
    image_size: output.falImageSize,
    num_images: 1,
    enable_safety_checker: payload.enableSafetyChecker ?? payload.enable_safety_checker ?? true,
    output_format: 'png',
    ...(negativePrompt ? { negative_prompt: negativePrompt.slice(0, 500) } : {}),
    ...(seed !== null ? { seed } : {}),
  };
}

export function buildAlibabaWan27Request(payload = {}) {
  const prompt = getWan27Prompt(payload);
  const output = getWan27OneKOutput(payload.aspectRatio ?? payload.aspect_ratio);
  const seed = normalizeSeed(payload.seed);

  return {
    model: ALIBABA_WAN_27_PRO_MODEL,
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
      watermark: false,
      thinking_mode: true,
      ...(seed !== null ? { seed } : {}),
    },
  };
}
