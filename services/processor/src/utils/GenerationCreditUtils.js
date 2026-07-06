// In GenerationCreditUtils.js

import {
  IMAGE_MODEL_PRICES,
  VIDEO_MODEL_PRICES,
  ASSISTANT_MODEL_PRICES,
  THEME_MODEL_PRICES,
  TRANSLATION_MODEL_PRICES,
  PROMPT_GENERATION_MODEL_PRICES,
  SPEECH_MODEL_PRICES,
  MUSIC_MODEL_PRICES,
} from '../consts/ModelPrices.js';

const MODEL_PRICE_ALIASES = {
  GPTIMAGE1: 'GPTIMAGE2',
  GPTIMAGE1EDIT: 'GPTIMAGE2EDIT',
};

function resolvePriceModelKey(modelKey) {
  return MODEL_PRICE_ALIASES[modelKey] || modelKey;
}

// Helper function to find the price for a given model, operation type, tokens, aspect ratio, etc.
function getPriceFromModelPrices(modelPrices, options) {
  const {
    modelKey,
    aspectRatio,
    operationType,
    tokens,
  } = options;

  const resolvedModelKey = resolvePriceModelKey(modelKey);
  const modelPricing = modelPrices.find(model => model.key === resolvedModelKey || !model.key);

  if (!modelPricing || !modelPricing.prices) {
    return null;
  }

  // For models with aspect ratio pricing
  if (aspectRatio) {
    const priceObj =
      modelPricing.prices.find(price => price.aspectRatio === aspectRatio) ||
      modelPricing.prices[0];
    return priceObj ? priceObj.price : null;
  }

  // For models with operation type and tokens pricing
  if (operationType) {
    const priceObj = modelPricing.prices.find(price =>
      price.operationType === operationType &&
      (!tokens || price.tokens === tokens)
    );
    return priceObj ? priceObj.price : null;
  }

  // For models with operation type only
  if (operationType) {
    const priceObj = modelPricing.prices.find(price => price.operationType === operationType);
    return priceObj ? priceObj.price : null;
  }

  return null;
}

export function getCreditsRequiredForQuickVideo(payload) {
  const {
    lineItems,
    speechLanguage,
    subtitlesLanguage,
    speechRequired,
    subtitlesTranslationRequired,
    speechTranslationRequired,
    backgroundMusicRequired,
    imageModel,
    aspectRatio,
    generativeVideoRequired,     // <-- Added this line
    videoGenerationModel,        // <-- Added this line
    speechModel,                 // Add speech model to payload if needed
    wordsCount,                  // Number of words for speech if needed
    translationLinesCount,       // Number of lines for translation if needed
    themeModel,
    
    musicProvider,
  } = payload;


  let requiredCredits = 0;
  const numLines = lineItems.length || 1; // Ensure at least one line

  // Calculate image credits based on selected model and aspect ratio
  const imagePricePerImage = getPriceFromModelPrices(IMAGE_MODEL_PRICES, {
    modelKey: imageModel,
    aspectRatio,
  }) || 8; // Default to 8 credits per image if not found

  const totalImageCredits = numLines * imagePricePerImage;
  requiredCredits += totalImageCredits;

  // Add video credits if generative video is required
  if (generativeVideoRequired && videoGenerationModel) {
    const videoPricePerUnit = getPriceFromModelPrices(VIDEO_MODEL_PRICES, {
      modelKey: videoGenerationModel,
      aspectRatio,
    }) || 90; // Default to 90 credits per unit if not found


    let totalVideoCredits = 0;
    lineItems.forEach((line) => {
      const lineLength = line.length; // Character count including spaces and special characters
      let lineCost = videoPricePerUnit;
      if (lineLength > 60) {
        lineCost *= 2; // Multiply by 2 if more than 60 characters
      }
      totalVideoCredits += lineCost;
    });

    requiredCredits += totalVideoCredits;
  }

  

  let themePricePerUnit = 2;

  let totalThemeCredits = 0;

  lineItems.forEach((line) => {
    const lineLength = line.length; // Character count including spaces and special characters
    let lineCost = themePricePerUnit;
    if (lineLength > 60) {
      lineCost *= 2; // Multiply by 2 if more than 60 characters
    }
    totalThemeCredits += lineCost;
  });


  requiredCredits += totalThemeCredits;

  let promptEnhancementPricePerUnit = 2;

  let totalPromptEnhancementCredits = 0;

  lineItems.forEach((line) => {
    const lineLength = line.length; // Character count including spaces and special characters
    let lineCost = promptEnhancementPricePerUnit;
    if (lineLength > 60) {
      lineCost *= 2; // Multiply by 2 if more than 60 characters
    }
    totalPromptEnhancementCredits += lineCost;
  });


  requiredCredits += totalPromptEnhancementCredits;







  // Speech credits
  if (speechRequired) {
    const words = wordsCount || (lineItems.join(' ').split(/\s+/).length); // Approximate words count
    const speechModelKey = speechModel || 'TTS'; // Default to 'TTS' if not specified

    // Get tokens per unit and price per unit
    const speechModelPricing = SPEECH_MODEL_PRICES.find(model => model.key === speechModelKey);
    const speechPriceObj = speechModelPricing
      ? speechModelPricing.prices.find(price => price.operationType === 'words')
      : null;

    const tokensPerUnit = speechPriceObj ? speechPriceObj.tokens : 1000; // Default to 1000 words per unit
    const speechPricePerUnit = speechPriceObj ? speechPriceObj.price : 2; // Default to 2 credits per unit

    const speechUnits = Math.ceil(words / tokensPerUnit);
    const speechCredits = speechUnits * speechPricePerUnit;
    requiredCredits += speechCredits;
  }

  // Translation credits
  if (speechTranslationRequired || subtitlesTranslationRequired) {
    const lines = translationLinesCount || numLines;

    const translationPricePerLine = getPriceFromModelPrices(TRANSLATION_MODEL_PRICES, {
      operationType: 'line',
    }) || 2; // Default to 2 credits per line if not found

    const totalTranslationCredits = lines * translationPricePerLine;
    requiredCredits += totalTranslationCredits;
  }

  // Music credits
  if (backgroundMusicRequired) {
    const musicModelKey =  musicProvider ? musicProvider : 'AUDIOCRAFT'; // Or get from payload if variable

    const musicCredits = getPriceFromModelPrices(MUSIC_MODEL_PRICES, {
      modelKey: musicModelKey,
      operationType: 'generate_song',
    }) || 3; // Default to 3 credits if not found

    requiredCredits += musicCredits;
  }


  // Add credits for theme model if used
  if (themeModel) {
    const themePricePerQuery = getPriceFromModelPrices(THEME_MODEL_PRICES, {
      operationType: 'query',
    }) || 2; // Default to 2 credits per query if not found

    requiredCredits += themePricePerQuery;
  }

  return requiredCredits;
}
