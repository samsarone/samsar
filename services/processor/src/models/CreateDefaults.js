import User from '../schema/User.js';
import { getDBConnectionString } from './DBString.js';
import { CREATE_ASPECT_RATIOS, CREATE_DURATIONS, resolveCreateDefaults } from '../consts/CreateDefaults.js';
import { INFERENCE_MODEL_OPTIONS, normalizeSupportedInferenceModel } from '../consts/InferenceModels.js';
import { IMAGE_MODEL_PRICES, VIDEO_MODEL_PRICES } from '../consts/ModelPrices.js';
import { IMAGE_GENERAITON_MODEL_TYPES, VIDEO_GENERATION_MODEL_TYPES } from '../consts/ModelTypes.js';
import { TEXT_TO_VIDEO_IMAGE_MODEL_KEYS, TEXT_TO_VIDEO_VIDEO_MODEL_KEYS } from '../consts/ExpressVideoModelOptions.js';
import { getExpressVideoPricingDistributionPerSecond } from '../consts/pricing/ExpressVideoPricingDistribution.js';
import { normalizeStoredGPTImageModelKey } from '../consts/GPTImageModelKeys.js';
import { normalizeKlingModelKey } from '../utils/KlingModel.js';
import { getReasoningModelBase, resolveInferenceEffort } from '../inference/ReasoningModels.js';
import { filterModelsForDeploymentAvailability } from './api/DeploymentModelConfig.js';

const FIELDS = Object.freeze(['inferenceModel', 'imageModel', 'videoModel', 'inferenceEffort', 'duration', 'aspectRatio', 'enableSubtitles']);
const invalid = (message) => Object.assign(new Error(message), { status: 400 });

function expressOptions(prices, keys) {
  return keys.filter((key) => prices.some((model) => model.key === key && model.isExpressModel === true)
    || getExpressVideoPricingDistributionPerSecond(key)?.total != null)
    .map((value) => ({ value }));
}

// Use the same express keys, exposed inference options, and runtime deployment
// policy as /video/supported_models. The form cannot save a Studio-only model.
export function getCreateDefaultModelValues() {
  const values = (options) => filterModelsForDeploymentAvailability(options).map((option) => option.value);
  return {
    inferenceModel: values(INFERENCE_MODEL_OPTIONS.filter((option) => option.exposeInCatalog !== false)),
    imageModel: values(expressOptions(IMAGE_MODEL_PRICES, TEXT_TO_VIDEO_IMAGE_MODEL_KEYS)),
    videoModel: values(expressOptions(VIDEO_MODEL_PRICES, TEXT_TO_VIDEO_VIDEO_MODEL_KEYS)),
  };
}

export function validateCreateDefaults(payload, user = {}, available = getCreateDefaultModelValues()) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw invalid('createDefaults must be an object.');
  for (const key of Object.keys(payload)) {
    if (!FIELDS.includes(key)) throw invalid(`Unknown Create default: ${key}.`);
  }
  const next = { ...resolveCreateDefaults(user), ...payload };
  for (const key of ['inferenceModel', 'imageModel', 'videoModel']) {
    if (typeof next[key] !== 'string' || !next[key].trim()) throw invalid(`${key} must be a supported model.`);
    next[key] = next[key].trim();
  }
  const normalizedInference = normalizeSupportedInferenceModel(next.inferenceModel);
  if (!normalizedInference) throw invalid('inferenceModel must be a supported text-to-video model.');
  if (Object.hasOwn(payload, 'inferenceModel') && !Object.hasOwn(payload, 'inferenceEffort') && /-xhigh$/.test(normalizedInference)) {
    next.inferenceEffort = resolveInferenceEffort(normalizedInference);
  }
  next.inferenceModel = getReasoningModelBase(normalizedInference);
  next.imageModel = normalizeStoredGPTImageModelKey(next.imageModel);
  next.videoModel = normalizeKlingModelKey(next.videoModel);
  for (const key of ['inferenceModel', 'imageModel', 'videoModel']) {
    if (!available[key]?.includes(next[key])) throw invalid(`${key} is unavailable for text-to-video generation. Choose a supported model.`);
  }
  if (!['high', 'xhigh'].includes(next.inferenceEffort)) throw invalid('inferenceEffort must be high or xhigh.');
  if (!CREATE_DURATIONS.includes(next.duration)) throw invalid(`duration must be one of ${CREATE_DURATIONS.join(', ')} seconds.`);
  if (!CREATE_ASPECT_RATIOS.includes(next.aspectRatio)) throw invalid('aspectRatio must be 16:9, 9:16, or 1:1.');
  for (const [key, catalog] of [['imageModel', IMAGE_GENERAITON_MODEL_TYPES], ['videoModel', VIDEO_GENERATION_MODEL_TYPES]]) {
    const ratios = catalog.find((model) => model.key === next[key])?.supportedAspectRatios;
    if (Array.isArray(ratios) && !ratios.includes(next.aspectRatio)) {
      throw invalid(`${key} does not support ${next.aspectRatio}. Choose a compatible aspect ratio or model.`);
    }
  }
  if (typeof next.enableSubtitles !== 'boolean') throw invalid('enableSubtitles must be a boolean.');
  return next;
}

async function findUser(userId) {
  await getDBConnectionString();
  const user = await User.findById(userId);
  if (!user) throw Object.assign(new Error('User not found.'), { status: 404 });
  return user;
}

export async function getUserCreateDefaults(userId) {
  return resolveCreateDefaults(await findUser(userId));
}

export async function updateUserCreateDefaults(userId, payload) {
  const user = await findUser(userId);
  // Validate the entire merged result before mutating the document or saving.
  const createDefaults = validateCreateDefaults(payload, user);
  user.createDefaults = createDefaults;
  await user.save();
  return resolveCreateDefaults(user);
}
