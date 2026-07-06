// Centralized pricing for API chat and image endpoints.
const CREDITS_PER_USD = 100;
const IMAGE_API_PRICE_MULTIPLIER = 1.8;
const NANO_BANANA_2_EDIT_BASE_COST_USD = 0.08;
const NANO_BANANA_2_EDIT_RESOLUTION_MULTIPLIERS = Object.freeze({
  '0.5K': 0.75,
  '1K': 1,
  '2K': 1.5,
  '4K': 2,
});
const NANO_BANANA_2_EDIT_STANDARD_CREDITS = calculateNanoBanana2EditCredits('1K');

export const API_PRICING = Object.freeze({
  chat: {
    enhanceMessage: {
      credits: 30,
      distribution: { base: 30 },
    },
  },
  image: {
    textToImage: {
      perImageCredits: NANO_BANANA_2_EDIT_STANDARD_CREDITS,
      distribution: buildNanoBanana2EditDistribution('1K', 1),
    },
    removeBrandingFromImage: {
      credits: NANO_BANANA_2_EDIT_STANDARD_CREDITS,
      distribution: buildNanoBanana2EditDistribution('1K', 1),
    },
    extendImageList: {
      perImageCredits: NANO_BANANA_2_EDIT_STANDARD_CREDITS,
      distribution: buildNanoBanana2EditDistribution('1K', 1),
    },
    enhanceImage: {
      resolutions: {
        '0.5K': { credits: calculateNanoBanana2EditCredits('0.5K') },
        '1K': { credits: calculateNanoBanana2EditCredits('1K') },
        '2K': { credits: calculateNanoBanana2EditCredits('2K') },
        '4K': { credits: calculateNanoBanana2EditCredits('4K') },
      },
    },
    extractReceiptTemplateQuery: {
      credits: 50,
      distribution: { base: 50 },
    },
  },
});

export function getEnhanceMessagePricing() {
  const pricing = API_PRICING.chat.enhanceMessage;
  const credits = pricing.credits;

  return {
    key: 'enhanceMessage',
    credits,
    distribution: withTotalCredits(pricing.distribution || {}, credits),
  };
}

export function getRemoveBrandingFromImagePricing() {
  const pricing = API_PRICING.image.removeBrandingFromImage;
  const credits = pricing.credits;

  return {
    key: 'removeBrandingFromImage',
    credits,
    distribution: withTotalCredits(pricing.distribution || {}, credits),
  };
}

export function getTextToImagePricing(requestedImages = 1) {
  const basePricing = API_PRICING.image.textToImage;
  const perImageCredits = basePricing.perImageCredits;
  const parsedRequested = Number(requestedImages);
  const totalImages = Number.isFinite(parsedRequested) && parsedRequested > 0 ? parsedRequested : 1;
  const credits = roundCredits(perImageCredits * totalImages);

  return {
    key: 'textToImage',
    credits,
    distribution: {
      ...basePricing.distribution,
      perImageCredits,
      requestedImages: totalImages,
      totalCredits: credits,
    },
  };
}

export function getExtendImageListPricing(requestedImages) {
  const basePricing = API_PRICING.image.extendImageList;
  const perImageCredits = basePricing.perImageCredits;
  const parsedRequested = Number(requestedImages);
  const totalImages = Number.isFinite(parsedRequested) && parsedRequested > 0 ? parsedRequested : 1;
  const credits = roundCredits(perImageCredits * totalImages);

  return {
    key: 'extendImageList',
    credits,
    distribution: {
      ...basePricing.distribution,
      perImageCredits,
      requestedImages: totalImages,
      totalCredits: credits,
    },
  };
}

export function getEnhanceImagePricing(resolution) {
  const normalizedResolution = normalizeResolutionForPricing(resolution);
  const pricingForResolution =
    API_PRICING.image.enhanceImage.resolutions[normalizedResolution] ||
    API_PRICING.image.enhanceImage.resolutions['1K'];
  const credits = pricingForResolution.credits;

  return {
    key: 'enhanceImage',
    credits,
    distribution: {
      ...buildNanoBanana2EditDistribution(normalizedResolution, 1),
      resolution: normalizedResolution,
      resolutionCredits: pricingForResolution.credits,
      totalCredits: credits,
    },
  };
}

export function getExtractReceiptTemplateQueryPricing() {
  const pricing = API_PRICING.image.extractReceiptTemplateQuery;
  const credits = pricing.credits;

  return {
    key: 'extractReceiptTemplateQuery',
    credits,
    distribution: withTotalCredits(pricing.distribution || {}, credits),
  };
}

function withTotalCredits(distribution, totalCredits) {
  return {
    ...distribution,
    totalCredits,
  };
}

function normalizeResolutionForPricing(resolution) {
  if (typeof resolution !== 'string') {
    return '1K';
  }

  const normalized = resolution.trim().toUpperCase();
  const allowed = Object.keys(NANO_BANANA_2_EDIT_RESOLUTION_MULTIPLIERS);

  if (allowed.includes(normalized)) {
    return normalized;
  }

  return '1K';
}

function calculateNanoBanana2EditCredits(resolution, outputImages = 1) {
  const normalizedResolution = normalizeResolutionForPricing(resolution);
  const resolutionMultiplier = NANO_BANANA_2_EDIT_RESOLUTION_MULTIPLIERS[normalizedResolution] || 1;
  return roundCredits(
    NANO_BANANA_2_EDIT_BASE_COST_USD *
      resolutionMultiplier *
      IMAGE_API_PRICE_MULTIPLIER *
      CREDITS_PER_USD *
      outputImages
  );
}

function buildNanoBanana2EditDistribution(resolution, outputImages = 1) {
  const normalizedResolution = normalizeResolutionForPricing(resolution);

  return {
    resolution: normalizedResolution,
    outputImages,
  };
}

function roundCredits(value) {
  return Math.ceil(value);
}
