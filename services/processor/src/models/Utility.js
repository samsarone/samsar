
import Templates from '../schema/Templates.js';
import fs from 'fs/promises';
import path from 'path';
import Fuse from 'fuse.js';
import { getDBConnectionString , getDatabase} from './DBString.js';
import { dir } from 'console';
import * as modelPrices from '../consts/ModelPrices.js';

const PUBLIC_VIDEO_MODEL_PRICE_EXCLUDED_KEYS = new Set([
  'CUSTOM_IMAGE_TO_VIDEO',
]);


export async function getPageTemplateList(pageNumber) {
  await getDBConnectionString();
  try {
    const templates = await Templates.find({}).skip((pageNumber - 1) * 50).limit(50);
    return templates.map(template => template.fileName);
  } catch (error) {
    console.error('Error fetching templates:', error);
    return [];
  }
}

export function getAspectRatioPrefix(aspectRatio) {
  const normalized = typeof aspectRatio === 'string' ? aspectRatio.trim() : '';
  if (!normalized || normalized === '1:1' || normalized === '16:9') {
    return null;
  } else if (normalized === '9:16') {
    return 'Create a centered, tall, vertical portrait image with a 9:16 aspect ratio, ensuring that all characters and objects are vertical straight that depicts the following: ';
  }
  return null;
}

export function getAspectRatioPostfix(aspectRatio) {
  const normalized = typeof aspectRatio === 'string' ? aspectRatio.trim() : '';
  if (!normalized || normalized === '1:1') {
    return null;
  } else if (normalized === '16:9') {
    return ' ar 16:9 orientation landscape';
  } else if (normalized === '9:16') {
    return ' ar 9:16 orientation portrait';
  }
  return ` ar ${normalized}`;
}

export function getModelPricesList() {
  const retPayload  = {
    IMAGE_MODEL_PRICES: modelPrices.IMAGE_MODEL_PRICES,
    VIDEO_MODEL_PRICES: modelPrices.VIDEO_MODEL_PRICES.filter((model) => (
      !PUBLIC_VIDEO_MODEL_PRICE_EXCLUDED_KEYS.has(model?.key)
    )),
    ASSISTANT_MODEL_PRICES: modelPrices.ASSISTANT_MODEL_PRICES,
    SPEECH_MODEL_PRICES: modelPrices.SPEECH_MODEL_PRICES,
    MUSIC_MODEL_PRICES: modelPrices.MUSIC_MODEL_PRICES,
    THEME_MODEL_PRICES: modelPrices.THEME_MODEL_PRICES,
    TRANSLATION_MODEL_PRICES: modelPrices.TRANSLATION_MODEL_PRICES,
    PROMPT_GENERATION_MODEL_PRICES: modelPrices.PROMPT_GENERATION_MODEL_PRICES,
  };


  return retPayload;


}
