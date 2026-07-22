export const GPT_IMAGE_TWO_MODEL = 'gpt-image-2';
export const GPT_IMAGE_TWO_FAL_ENDPOINT = 'fal-ai/gpt-image-2';
export const GPT_IMAGE_TWO_QUALITY = 'high';

const OUTPUT_BY_ASPECT_RATIO = Object.freeze({
  '1:1': Object.freeze({ width: 1024, height: 1024 }),
  '16:9': Object.freeze({ width: 1536, height: 864 }),
  '9:16': Object.freeze({ width: 864, height: 1536 }),
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getGPTImageTwoOutput(aspectRatio = '1:1') {
  const normalizedAspectRatio = normalizeString(aspectRatio).replace(/[xX]/g, ':');
  const dimensions = OUTPUT_BY_ASPECT_RATIO[normalizedAspectRatio] || OUTPUT_BY_ASPECT_RATIO['1:1'];

  return {
    aspectRatio: OUTPUT_BY_ASPECT_RATIO[normalizedAspectRatio] ? normalizedAspectRatio : '1:1',
    width: dimensions.width,
    height: dimensions.height,
    openAIImageSize: `${dimensions.width}x${dimensions.height}`,
    falImageSize: {
      width: dimensions.width,
      height: dimensions.height,
    },
  };
}

export function buildOpenAIGPTImageTwoInput(payload = {}) {
  const output = getGPTImageTwoOutput(payload.aspectRatio);

  return {
    model: GPT_IMAGE_TWO_MODEL,
    prompt: payload.prompt,
    size: output.openAIImageSize,
    quality: GPT_IMAGE_TWO_QUALITY,
    output_format: 'png',
    n: 1,
  };
}

export function buildFalGPTImageTwoInput(payload = {}) {
  const output = getGPTImageTwoOutput(payload.aspectRatio);

  return {
    prompt: payload.prompt,
    image_size: output.falImageSize,
    quality: GPT_IMAGE_TWO_QUALITY,
    num_images: 1,
    output_format: 'png',
  };
}

export function normalizeGPTImageTwoResult({ image, width, height }) {
  return {
    image,
    width,
    height,
    preserveOriginalForAiVideo: true,
  };
}
