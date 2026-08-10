import { getPrimaryAdapterKeyForModel } from './adapterPresentation.mjs';

export const VIDGENIE_I2V_REQUIRED_IMAGE_EDIT_MODEL = 'NANOBANANAPROEDIT';

export const VIDGENIE_I2V_STANDALONE_ADAPTER_KEYS = Object.freeze([
  'googleCloud',
  'fal',
  'gmicloud',
  'samsar',
]);

const VIDGENIE_I2V_STANDALONE_ADAPTER_KEY_SET = new Set(
  VIDGENIE_I2V_STANDALONE_ADAPTER_KEYS,
);

function normalizeModelKey(value) {
  const rawValue = typeof value === 'string'
    ? value
    : value?.value ?? value?.key ?? value?.model ?? value?.modelKey;
  return typeof rawValue === 'string'
    ? rawValue.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    : '';
}

export function isVidgenieImageToVideoModeAvailable({
  isStandaloneDeployment = false,
  imageEditModelValues = [],
  primaryAdapterByModel = {},
} = {}) {
  if (!isStandaloneDeployment) {
    return true;
  }

  const hasRequiredEditModel = imageEditModelValues.some(
    (model) => normalizeModelKey(model) === VIDGENIE_I2V_REQUIRED_IMAGE_EDIT_MODEL,
  );
  if (!hasRequiredEditModel) {
    return false;
  }

  const adapterKey = getPrimaryAdapterKeyForModel(
    VIDGENIE_I2V_REQUIRED_IMAGE_EDIT_MODEL,
    primaryAdapterByModel,
  );
  return VIDGENIE_I2V_STANDALONE_ADAPTER_KEY_SET.has(adapterKey);
}
