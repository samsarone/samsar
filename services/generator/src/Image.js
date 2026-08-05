
import 'dotenv/config';
import { getImageFromText, getEditImageFromText } from './Dispatcher.js';
import { getDBConnectionString } from './DBString.js';
import ImageGeneration from './schema/ImageGeneration.js';
import Session from './schema/Session.js';
import VideoSession from './schema/VideoSession.js';
import { User } from './schema/User.js';
import AvatarVoiceoverTask from './schema/AvatarVoiceoverTask.js';
import FrameGeneration from './schema/FrameGeneration.js';
import GlobalSession from './schema/GlobalSession.js';
import { updateBatchGenerationRequest } from './BatchImage.js';
import { getAlternatePromptFromPrompt } from './OpenAI.js';
import {
  hasRequestInferenceAuthorization,
  hasRequestInferenceModel,
  resolveRequestInferenceAuthorization,
  resolveRequestInferenceSettings,
} from './inference/RequestInferenceModel.js';
import GeneratedImage from './schema/generations/GeneratedImage.js';
import { handleFluxRequest } from './Flux.js';
import { handleRecraftRequest } from './Recraft.js';
import { handleStableDiffusionRequest } from './StableDiffusion.js';
import { handleSanaRequest } from './Sana.js';
import { handlePhotonRequest } from './providers/Luma.js';
import { handleImagenRequest } from './providers/Imagen.js';
import { handleImagenFalRequest } from './providers/ImagenFal.js';
import { handleGemma3CreateRequest } from './providers/Gemma3.js';
import { handleLuminaRequest } from './providers/LuminaV2.js';
import { handleReveRequest } from './providers/Reve.js';
import { handleIdeogramRequest } from './providers/Ideogram.js';
import { handleGPTImageTwoRequest } from './providers/GPTImageOne.js';
import { handleFalGPTImageTwoRequest } from './providers/GPTImageTwoFal.js';
import { handleFLiteRequest } from './providers/FLite.js';
import { handleSeedreamRequest } from './providers/Seedream.js';
import { handleHunyuanRequest } from './providers/Hunyuan.js';
import { handleCustomTextToImageRequest } from './providers/CustomTextToImage.js';
import {
  handleSamsarExternalTextToImageRequest,
  shouldUseSamsarExternalImageProvider,
} from './providers/SamsarExternalImage.js';
import {
  handleGenBlazeImageRequest,
  isGenBlazeImageRequestApplicable,
  shouldUseGenBlazeImageProvider,
} from './providers/GenBlazeImage.js';

import { handleNanoBananaFalRequest } from './providers/NanoBanana.js';
import {
  handleGoogleNanoBananaRequest,
  shouldUseGoogleNativeNanoBanana,
} from './providers/GoogleNanoBananaNative.js';
import { handleAlibabaWan27Request } from './providers/AlibabaWan27.js';
import { handleFalWan27Request } from './providers/FalWan27.js';

import {
  isDockerRuntime,
  isStandaloneEdition,
  usesExternalMediaPublishing,
  usesLocalAssetStorage,
} from './utils/Environment.js';
import { recordProviderUsageLog } from './utils/ProviderUsageAudit.js';
import {
  getAvailableCpuCount,
  resolveCpuUpperBound,
  resolvePerTaskCpuUpperBound,
} from './utils/CpuResources.js';
import {
  DOCKER_ADAPTER_PROVIDER,
  resolveNextDockerImageGenerationProvider,
  resolveNextDockerImageEditProvider,
  resolveDockerImageEditProvider,
  resolveDockerImageGenerationProvider,
  resolveGPTImageTwoGenerationProvider,
  resolveWan27ImageGenerationProvider,
} from './consts/DockerProviderPriority.js';

import { handleHiDreamRequest } from './providers/HiDream.js';


import {
  addVisionDescriptionsForLayerImage,
  assignScoreForTheImage
} from './utils/VisionUtils.js';
import { getCanvasDimensionsForAspectRatio } from './utils/CanvasUtils.js';
import {
  getImageReferenceFromRequest,
  getImageNameFromReference,
  getRemoteImageUrlFromReference,
  needsImageEnhancement,
  persistImageToLocalAssets,
} from './utils/UpscaleUtils.js';
import { uploadImageToCDN } from './utils/AWS.js';
import * as path from 'path';
import fs from 'fs';
import sharp from 'sharp';

const HEAVY_WORK_CPU_BUDGET = getAvailableCpuCount();
const MAX_CONCURRENT_REQUESTS = resolveCpuUpperBound(
  process.env.SAMSAR_GENERATOR_MAX_CONCURRENT_REQUESTS,
  4,
  { availableCpuCount: HEAVY_WORK_CPU_BUDGET },
);
const SHARP_THREADS_PER_REQUEST = resolvePerTaskCpuUpperBound(
  process.env.SAMSAR_GENERATOR_MAX_SHARP_THREADS,
  8,
  {
    availableCpuCount: HEAVY_WORK_CPU_BUDGET,
    maxConcurrentTasks: MAX_CONCURRENT_REQUESTS,
  },
);
// This configures an upper bound only. libvips creates worker threads when a
// Sharp operation actually runs, and the outer queue owns request parallelism.
sharp.concurrency(SHARP_THREADS_PER_REQUEST);
const MAX_IMAGE_GENERATION_FAILURES = 3;
const MAX_IMAGE_GENERATION_FILTER_RETRIES = 3;
const IMAGE_GENERATION_RETRY_BASE_DELAY_MS = Math.max(
  250,
  Number(process.env.IMAGE_GENERATION_RETRY_BASE_DELAY_MS) || 2000,
);
const IMAGE_GENERATION_RETRY_MAX_DELAY_MS = Math.max(
  IMAGE_GENERATION_RETRY_BASE_DELAY_MS,
  Number(process.env.IMAGE_GENERATION_RETRY_MAX_DELAY_MS) || 30000,
);
const IMAGE_GENERATION_PROVIDER_PENDING_TIMEOUT_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.IMAGE_GENERATION_PROVIDER_PENDING_TIMEOUT_MS) || 20 * 60 * 1000
);
const IMAGE_FILTER_SCORE_CUTOFF = 50;
const GROUNDED_IMAGE_FILTER_SCORE_CUTOFF = 55;
const SCORE_ONLY_FILTER_FAILURES_BEFORE_RELAXATION = 2;
const SCORE_ONLY_FILTER_RELAXED_CUTOFF = 50;
const BRANCHED_IMAGE_FILTER_FALLBACK_SCORE_CUTOFF = 25;
const IMAGE_FILTER_SCORE_RELAXATION_PER_GENERATION_FAILURE = 10;
const MIN_IMAGE_FILTER_SCORE_CUTOFF = 35;
const MIN_GROUNDED_IMAGE_FILTER_SCORE_CUTOFF = 41;
const FAILURE_HISTORY_LIMIT = 10;
const TERMINAL_IMAGE_REQUEST_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
let ongoingRequests = 0;
const taskQueue = [];

function resolveNanoBananaEnhanceEditModel(model) {
  const normalized = typeof model === 'string' ? model.trim() : '';
  if (normalized === 'NANOBANANAPRO' || normalized === 'NANOBANANAPROEDIT') {
    return 'NANOBANANAPROEDIT';
  }
  if (normalized === 'NANOBANANA2' || normalized === 'NANOBANANA2EDIT' || normalized === 'NANOBANANAEDIT') {
    return 'NANOBANANA2EDIT';
  }
  return 'NANOBANANAPROEDIT';
}

function normalizeRetryCount(value) {
  const count = Number(value || 0);
  if (!Number.isFinite(count) || count < 0) {
    return 0;
  }
  return Math.floor(count);
}

function getImageGenerationRetryDelayMs(nextFailureCount = 1) {
  const retryIndex = Math.max(0, normalizeRetryCount(nextFailureCount) - 1);
  return Math.min(
    IMAGE_GENERATION_RETRY_MAX_DELAY_MS,
    IMAGE_GENERATION_RETRY_BASE_DELAY_MS * (2 ** retryIndex),
  );
}

function getImageGenerationNextAttemptAfter(nextFailureCount = 1, now = Date.now()) {
  return new Date(Number(now) + getImageGenerationRetryDelayMs(nextFailureCount));
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function persistFinalGeneratedImageForRequest(
  payload = {},
  generatedImage = {},
  dependencies = {},
) {
  const generatedImageModel = dependencies.generatedImageModel || GeneratedImage;
  const requestId = payload?._id;
  const sourceRequestId = requestId?.toString?.() || normalizeString(requestId);
  const record = {
    ...generatedImage,
    sourceRequestId: sourceRequestId || null,
    sourceProviderRequestId: normalizeString(payload?.apiRequestId) || null,
  };

  if (!requestId) {
    const imageDocument = new generatedImageModel(record);
    return imageDocument.save({});
  }

  try {
    return await generatedImageModel.findOneAndUpdate(
      { _id: requestId },
      { $setOnInsert: record },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      },
    );
  } catch (error) {
    // Concurrent upserts can race at the unique MongoDB _id boundary. The
    // already-persisted request result is the desired idempotent outcome.
    if (error?.code === 11000 && typeof generatedImageModel.findById === 'function') {
      return generatedImageModel.findById(requestId);
    }
    throw error;
  }
}

function normalizeAdapterProvider(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['alibaba', 'alibabacloud', 'aliyun', 'dashscope', 'qwen'].includes(normalized)) {
    return DOCKER_ADAPTER_PROVIDER.ALIBABA_CLOUD;
  }
  if (['google', 'googlecloud', 'gcp', 'vertex', 'vertexai'].includes(normalized)) {
    return DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD;
  }
  if (normalized === 'fal') {
    return DOCKER_ADAPTER_PROVIDER.FAL;
  }
  if (normalized === 'openai') {
    return DOCKER_ADAPTER_PROVIDER.OPENAI;
  }
  if (normalized === 'samsar') {
    return DOCKER_ADAPTER_PROVIDER.SAMSAR;
  }
  if (['gmi', 'gmicloud', 'genblaze'].includes(normalized)) {
    return DOCKER_ADAPTER_PROVIDER.GMICLOUD;
  }
  return '';
}

function getPinnedImageAdapterProvider(payload = {}) {
  const status = normalizeString(payload?.apiGenerationStatus).toUpperCase();
  const submittedAdapter = normalizeAdapterProvider(payload?.submittedAdapter);
  if (status === 'PENDING' && submittedAdapter) {
    return submittedAdapter;
  }

  if (isStandaloneEdition()) {
    const overrideProvider = normalizeAdapterProvider(payload?.adapterProviderOverride);
    if (overrideProvider) {
      return overrideProvider;
    }

    const selectedProvider = normalizeAdapterProvider(payload?.adapterProvider);
    if (selectedProvider) {
      return selectedProvider;
    }
  }

  const externalProvider = normalizeAdapterProvider(payload?.externalProvider);
  if (
    externalProvider &&
    (status === 'PENDING' || payload?.requestType !== 'API' || externalProvider !== DOCKER_ADAPTER_PROVIDER.SAMSAR)
  ) {
    return externalProvider;
  }

  const requestId = normalizeString(payload?.apiRequestId).toLowerCase();
  if (requestId.startsWith('google-native-nanobanana:')) {
    return DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD;
  }
  if (requestId.startsWith('samsar-external-image:')) {
    return DOCKER_ADAPTER_PROVIDER.SAMSAR;
  }
  if (requestId.startsWith('genblaze-image:')) {
    return DOCKER_ADAPTER_PROVIDER.GMICLOUD;
  }
  return '';
}

function isImageGenerationProviderApplicable(model, provider, payload = {}) {
  const normalizedProvider = normalizeAdapterProvider(provider);
  if (normalizedProvider !== DOCKER_ADAPTER_PROVIDER.GMICLOUD) {
    return true;
  }
  return isGenBlazeImageRequestApplicable({
    ...payload,
    model: normalizeString(model).toUpperCase(),
  });
}

function resolveNextApplicableImageGenerationProvider(model, currentProvider, payload = {}) {
  let nextProvider = resolveNextDockerImageGenerationProvider(model, currentProvider);
  const visitedProviders = new Set();
  while (
    nextProvider &&
    !visitedProviders.has(nextProvider) &&
    !isImageGenerationProviderApplicable(model, nextProvider, payload)
  ) {
    visitedProviders.add(nextProvider);
    nextProvider = resolveNextDockerImageGenerationProvider(model, nextProvider);
  }
  return nextProvider;
}

function resolveApplicableImageGenerationProvider(model, provider, payload = {}) {
  if (!provider || isImageGenerationProviderApplicable(model, provider, payload)) {
    return provider;
  }

  // Preserve an explicit GMI selection if no exact configured alternative
  // exists; the gateway then returns its precise contract error rather than
  // silently changing the requested aspect ratio.
  return resolveNextApplicableImageGenerationProvider(model, provider, payload) || provider;
}

function resolveImageProviderForModel(model, payload = {}) {
  const normalizedModel = normalizeString(model).toUpperCase();
  if (!normalizedModel) {
    return '';
  }
  const pinnedProvider = getPinnedImageAdapterProvider(payload);
  if (pinnedProvider) {
    return resolveApplicableImageGenerationProvider(
      normalizedModel,
      pinnedProvider,
      payload,
    );
  }
  if (normalizedModel === 'WAN2.7PRO') {
    return resolveApplicableImageGenerationProvider(
      normalizedModel,
      resolveWan27ImageGenerationProvider(payload?.externalProvider),
      payload,
    );
  }
  if (normalizedModel === 'GPTIMAGE2') {
    return resolveApplicableImageGenerationProvider(
      normalizedModel,
      resolveGPTImageTwoGenerationProvider(payload?.externalProvider),
      payload,
    );
  }

  const dockerProvider = resolveDockerImageGenerationProvider(normalizedModel);
  if (dockerProvider) {
    return resolveApplicableImageGenerationProvider(
      normalizedModel,
      dockerProvider,
      payload,
    );
  }

  if (normalizedModel === 'DALLE3' || normalizedModel === 'GPTIMAGE2' || normalizedModel === 'GPTIMAGE1') {
    return 'openai';
  }
  if (normalizedModel === 'IMAGEN3' || normalizedModel === 'IMAGEN3FLASH') {
    return 'googleCloud';
  }
  if (normalizedModel === 'NANOBANANA2' || normalizedModel === 'NANOBANANAPRO') {
    return shouldUseGoogleNativeNanoBanana(payload) ? 'googleCloud' : 'fal';
  }
  if (normalizedModel === 'CUSTOM_TEXT_TO_IMAGE' || normalizedModel.startsWith('CUSTOM_TEXT_TO_IMAGE:')) {
    return '';
  }
  return 'fal';
}

// Crossing adapters must be explicitly authorized by a confirmed generation
// failure. Prompt/scoring retries stay pinned by default.
function getImageGenerationAdapterRetryState(payload = {}, { rotateAdapter = false } = {}) {
  if (!isStandaloneEdition()) {
    return {
      provider: '',
      setFields: {},
      unsetFields: {},
    };
  }

  const model = normalizeString(payload?.model).toUpperCase();
  const currentProvider =
    getPinnedImageAdapterProvider(payload) ||
    resolveImageProviderForModel(model, payload);
  const nextProvider = rotateAdapter
    ? resolveNextApplicableImageGenerationProvider(model, currentProvider, payload)
    : '';
  const retryProvider = nextProvider || currentProvider;

  return {
    provider: retryProvider,
    setFields: retryProvider
      ? {
        adapterProvider: retryProvider,
        adapterProviderOverride: retryProvider,
      }
      : {},
    unsetFields: {
      apiRequestId: '',
      apiSubmittedAt: '',
      submittedAdapter: '',
      externalProvider: '',
    },
  };
}

function getPinnedImageEditAdapterProvider(payload = {}) {
  const status = normalizeString(payload?.apiEditStatus).toUpperCase();
  const submittedAdapter = normalizeAdapterProvider(payload?.submittedAdapter);
  if (status === 'PENDING' && submittedAdapter) {
    return submittedAdapter;
  }

  if (isStandaloneEdition()) {
    const overrideProvider = normalizeAdapterProvider(payload?.adapterProviderOverride);
    if (overrideProvider) {
      return overrideProvider;
    }
    const selectedProvider = normalizeAdapterProvider(payload?.adapterProvider);
    if (selectedProvider) {
      return selectedProvider;
    }
  }

  const requestId = normalizeString(payload?.apiRequestId).toLowerCase();
  if (requestId.startsWith('google-native-nanobanana-edit:')) {
    return DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD;
  }
  if (requestId.startsWith('samsar-external-image:')) {
    return DOCKER_ADAPTER_PROVIDER.SAMSAR;
  }
  if (requestId.startsWith('genblaze-image-edit:')) {
    return DOCKER_ADAPTER_PROVIDER.GMICLOUD;
  }
  return normalizeAdapterProvider(payload?.externalProvider);
}

function resolveImageEditProviderForModel(model, payload = {}) {
  const normalizedModel = normalizeString(model).toUpperCase();
  if (!normalizedModel) {
    return '';
  }
  const pinnedProvider = getPinnedImageEditAdapterProvider(payload);
  if (pinnedProvider) {
    return pinnedProvider;
  }
  const dockerProvider = resolveDockerImageEditProvider(normalizedModel);
  if (dockerProvider) {
    return dockerProvider;
  }
  if (normalizedModel === 'GPTIMAGE2EDIT' || normalizedModel === 'GPTIMAGE1EDIT') {
    return DOCKER_ADAPTER_PROVIDER.OPENAI;
  }
  if (normalizedModel === 'CUSTOM_IMAGE_EDIT') {
    return '';
  }
  return DOCKER_ADAPTER_PROVIDER.FAL;
}

function getImageEditAdapterRetryState(payload = {}, { rotateAdapter = true } = {}) {
  if (!isStandaloneEdition()) {
    return {
      provider: '',
      setFields: {},
      unsetFields: {},
    };
  }

  const model = normalizeString(payload?.model).toUpperCase();
  const currentProvider = resolveImageEditProviderForModel(model, payload);
  const nextProvider = rotateAdapter
    ? resolveNextDockerImageEditProvider(model, currentProvider)
    : '';
  const retryProvider = rotateAdapter ? nextProvider : currentProvider;

  return {
    provider: retryProvider,
    setFields: retryProvider
      ? {
        adapterProvider: retryProvider,
        adapterProviderOverride: retryProvider,
      }
      : {},
    unsetFields: {
      apiRequestId: '',
      apiSubmittedAt: '',
      submittedAdapter: '',
      externalProvider: '',
    },
  };
}

async function recordImageProviderUsage(payload = {}, provider, metadata = {}) {
  if (!provider) {
    return null;
  }
  return recordProviderUsageLog({
    payload,
    requestType: 'text_to_image',
    callType: 'text_to_image',
    provider,
    model: payload.model,
    source: 'image_generator',
    service: 'samsar_generator',
    metadata: {
      aspectRatio: payload.aspectRatio || null,
      requestStatus: payload.apiGenerationStatus || payload.generationStatus || null,
      ...metadata,
    },
  });
}

function getProcessorAssetsRoot(folderName) {
  if (usesLocalAssetStorage()) {
    if (folderName === 'assets_v2') {
      return process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
    }
    if (folderName === 'assets') {
      return process.env.SAMSAR_ASSETS_ROOT || '/assets';
    }
    return `/${folderName}`;
  }

  return path.join(process.cwd(), '..', 'samsar_processor', folderName);
}

function sanitizeAssetSessionId(sessionId) {
  return String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function normalizeLocalGenerationReference(imageRef) {
  if (typeof imageRef !== 'string' || !imageRef.trim()) {
    return '';
  }

  let normalized = imageRef.trim().replace(/\\/g, '/');
  if (/^https?:\/\//i.test(normalized)) {
    try {
      normalized = decodeURIComponent(new URL(normalized).pathname);
    } catch {
      return '';
    }
  }

  return normalized
    .split('?')[0]
    .split('#')[0]
    .replace(/^\/+/, '');
}

function buildGenerationAssetResult(relativePath) {
  const normalizedRelativePath = relativePath.replace(/^\/+/, '');
  return {
    relativePath: normalizedRelativePath,
    remoteImageUrl: `/${normalizedRelativePath}`,
    imageName: path.posix.basename(normalizedRelativePath),
  };
}

async function uploadGenerationAssetToCDN(localPath, relativePath) {
  if (!localPath || !relativePath) {
    return;
  }
  if (
    isDockerRuntime() &&
    !usesExternalMediaPublishing() &&
    !isTruthyEnv(process.env.SAMSAR_DOCKER_UPLOAD_GENERATED_ASSETS)
  ) {
    return;
  }
  await uploadImageToCDN(localPath, relativePath);
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

async function persistGenerationImageForSession(imageRef, sessionId) {
  const normalizedRef = normalizeLocalGenerationReference(imageRef);
  if (!normalizedRef) {
    return buildGenerationAssetResult(`generations/${imageRef}`);
  }

  const safeSessionId = sanitizeAssetSessionId(sessionId);
  const fileName = path.posix.basename(normalizedRef);
  const destinationRelativePath = path.posix.join('assets_v2', 'generations', safeSessionId, fileName);
  const destinationPath = path.join(
    getProcessorAssetsRoot('assets_v2'),
    'generations',
    safeSessionId,
    fileName
  );

  if (fs.existsSync(destinationPath)) {
    await uploadGenerationAssetToCDN(destinationPath, destinationRelativePath);
    return buildGenerationAssetResult(destinationRelativePath);
  }

  const relativeWithoutAssetsPrefix = normalizedRef
    .replace(/^assets_v2\//, '')
    .replace(/^assets\//, '');
  const relativeWithoutGenerationsPrefix = relativeWithoutAssetsPrefix.replace(/^generations\//, '');
  const sourceCandidates = [
    path.join(getProcessorAssetsRoot('assets_v2'), relativeWithoutAssetsPrefix),
    path.join(getProcessorAssetsRoot('assets'), relativeWithoutAssetsPrefix),
    path.join(getProcessorAssetsRoot('assets'), 'generations', relativeWithoutGenerationsPrefix),
  ];

  const sourcePath = sourceCandidates.find((candidate) => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  });

  if (!sourcePath) {
    return normalizedRef.startsWith('assets_v2/')
      ? buildGenerationAssetResult(normalizedRef)
      : buildGenerationAssetResult(`generations/${relativeWithoutGenerationsPrefix}`);
  }

  await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
  if (path.resolve(sourcePath) !== path.resolve(destinationPath)) {
    await fs.promises.copyFile(sourcePath, destinationPath);
    if (sourcePath.includes(`${path.sep}assets${path.sep}generations${path.sep}`)) {
      await fs.promises.unlink(sourcePath).catch(() => {});
    }
  }
  await uploadGenerationAssetToCDN(destinationPath, destinationRelativePath);

  return buildGenerationAssetResult(destinationRelativePath);
}

function isTerminalImageRequestStatus(value) {
  return typeof value === 'string' && TERMINAL_IMAGE_REQUEST_STATUSES.has(value);
}

function getImageGenerationFailureMessage(imageData, fallback = 'Image generation returned no image.') {
  if (typeof imageData?.error === 'string' && imageData.error.trim()) {
    return imageData.error.trim();
  }
  if (typeof imageData?.message === 'string' && imageData.message.trim()) {
    return imageData.message.trim();
  }
  if (typeof imageData === 'string' && imageData.trim()) {
    return imageData.trim();
  }
  return fallback;
}

function hasReachedScoreOnlyFilterRelaxation(payload = {}) {
  return normalizeRetryCount(payload?.failureRetryCount) === 0 &&
    normalizeRetryCount(payload?.filterRetryCount) >= SCORE_ONLY_FILTER_FAILURES_BEFORE_RELAXATION;
}

function getImageFilterScoreCutoff(videoTone, payload = {}) {
  const baseCutoff = videoTone === 'grounded'
    ? GROUNDED_IMAGE_FILTER_SCORE_CUTOFF
    : IMAGE_FILTER_SCORE_CUTOFF;
  const minCutoff = videoTone === 'grounded'
    ? MIN_GROUNDED_IMAGE_FILTER_SCORE_CUTOFF
    : MIN_IMAGE_FILTER_SCORE_CUTOFF;
  const generationFailureCount = normalizeRetryCount(payload?.failureRetryCount);

  if (generationFailureCount <= 0) {
    return baseCutoff;
  }

  return Math.max(
    minCutoff,
    baseCutoff - (generationFailureCount * IMAGE_FILTER_SCORE_RELAXATION_PER_GENERATION_FAILURE)
  );
}

function getScoreThresholdCutoff(videoTone, payload = {}) {
  const standardCutoff = getImageFilterScoreCutoff(videoTone, payload);
  if (!hasReachedScoreOnlyFilterRelaxation(payload)) {
    return standardCutoff;
  }
  return Math.min(standardCutoff, SCORE_ONLY_FILTER_RELAXED_CUTOFF);
}

function isBranchedVideoSession(sessionData = {}) {
  return normalizeString(sessionData?.narrativeType).toLowerCase() === 'branched';
}

function getTerminalFilterFailurePolicy(videoTone, payload = {}, sessionData = {}) {
  const isBranchedSession = isBranchedVideoSession(sessionData);
  return {
    fallbackScoreCutoff: isBranchedSession
      ? BRANCHED_IMAGE_FILTER_FALLBACK_SCORE_CUTOFF
      : getScoreThresholdCutoff(videoTone, payload),
    // The branched prune path preserves topology and retimes only paths that
    // reference the failed asset. Singular sessions retain their existing
    // score-only prune policy.
    allowExpressLayerPrune: isBranchedSession || hasReachedScoreOnlyFilterRelaxation(payload),
  };
}

function getBranchedTerminalGenerationPruneOptions(sessionData = {}) {
  const allowExpressImageLayerPrune = Boolean(
    sessionData?.isExpressGeneration && isBranchedVideoSession(sessionData),
  );
  return {
    pruneLayer: allowExpressImageLayerPrune,
    allowExpressImageLayerPrune,
  };
}

function parseMaybeJson(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  if (typeof value !== 'string') {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getFirstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function getFirstNonEmptyStringWithSource(candidates = []) {
  for (const candidate of candidates) {
    const normalized = normalizeString(candidate?.value);
    if (normalized) {
      return {
        value: normalized,
        source: candidate.source || '',
      };
    }
  }
  return { value: '', source: '' };
}

function getTextFingerprint(value = '') {
  const normalized = normalizeString(value);
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

function summarizeTextForLog(value = '', previewLength = 220) {
  const normalized = normalizeString(value);
  return {
    length: normalized.length,
    fingerprint: getTextFingerprint(normalized),
    preview: normalized.slice(0, previewLength),
  };
}

function getOptionalInteger(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function getSceneVisualDetailsForLayer(sessionData = {}, layerDataIndex = -1, layer = null, options = {}) {
  const movieResourceList = parseMaybeJson(sessionData.movieResourceList) || sessionData.movieResourceList;
  const scenes = Array.isArray(movieResourceList?.scenes) ? movieResourceList.scenes : [];
  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  if (!scenes.length) {
    return {
      value: '',
      sourceSceneIndex: null,
      sourceSceneIndexSource: '',
      fallbackUsed: false,
      sceneCount: 0,
      layerCount: layers.length,
    };
  }

  const sceneIndexCandidates = [
    { value: options.sourceSceneIndex, source: options.sourceSceneIndexSource || 'payload.sourceSceneIndex' },
    { value: layer?.sourceSceneIndex, source: 'layer.sourceSceneIndex' },
    { value: layer?.sceneIndex, source: 'layer.sceneIndex' },
    { value: layer?.movieResourceIndex, source: 'layer.movieResourceIndex' },
    { value: layer?.imageSession?.sourceSceneIndex, source: 'layer.imageSession.sourceSceneIndex' },
    { value: layer?.imageSession?.sceneIndex, source: 'layer.imageSession.sceneIndex' },
    { value: layer?.imageSession?.movieResourceIndex, source: 'layer.imageSession.movieResourceIndex' },
  ];
  for (const candidate of sceneIndexCandidates) {
    const sceneIndex = getOptionalInteger(candidate.value);
    if (sceneIndex !== null) {
      return {
        value: scenes[sceneIndex]?.visual || '',
        sourceSceneIndex: sceneIndex,
        sourceSceneIndexSource: candidate.source,
        fallbackUsed: false,
        sceneCount: scenes.length,
        layerCount: layers.length,
      };
    }
  }

  if (layerDataIndex >= 0 && scenes.length === layers.length) {
    return {
      value: scenes[layerDataIndex]?.visual || '',
      sourceSceneIndex: layerDataIndex,
      sourceSceneIndexSource: 'layerDataIndex',
      fallbackUsed: true,
      sceneCount: scenes.length,
      layerCount: layers.length,
    };
  }

  return {
    value: '',
    sourceSceneIndex: null,
    sourceSceneIndexSource: '',
    fallbackUsed: false,
    sceneCount: scenes.length,
    layerCount: layers.length,
  };
}

function getSceneVisualForLayer(sessionData = {}, layerDataIndex = -1, layer = null, options = {}) {
  return getSceneVisualDetailsForLayer(sessionData, layerDataIndex, layer, options).value;
}

function buildImageThemeScoringContextDetails(sessionData = {}, layerDataIndex = -1, currentImagePrompt = '', options = {}) {
  const layer = Array.isArray(sessionData.layers) && layerDataIndex >= 0
    ? sessionData.layers[layerDataIndex]
    : null;
  const layerPrompt = getFirstNonEmptyStringWithSource([
    { value: currentImagePrompt, source: options.currentPromptSource || 'payload.prompt' },
    { value: layer?.originalImageGenerationPrompt, source: 'layer.originalImageGenerationPrompt' },
    { value: layer?.imageSession?.originalImageGenerationPrompt, source: 'layer.imageSession.originalImageGenerationPrompt' },
    { value: layer?.originalImagePrompt, source: 'layer.originalImagePrompt' },
    { value: layer?.imageSession?.originalImagePrompt, source: 'layer.imageSession.originalImagePrompt' },
    { value: layer?.sourcePrompt, source: 'layer.sourcePrompt' },
    { value: layer?.imageSession?.sourcePrompt, source: 'layer.imageSession.sourcePrompt' },
    { value: layer?.originalPrompt, source: 'layer.originalPrompt' },
    { value: layer?.imageSession?.originalPrompt, source: 'layer.imageSession.originalPrompt' },
    { value: layer?.imageSession?.originalRetryPrompt, source: 'layer.imageSession.originalRetryPrompt' },
    { value: layer?.imageSession?.prompt, source: 'layer.imageSession.prompt' },
    { value: layer?.prompt, source: 'layer.prompt' },
  ]);
  if (layerPrompt.value) {
    const context = `Layer visual prompt: ${layerPrompt.value}`;
    return {
      context,
      diagnostics: {
        contextType: 'layer_prompt',
        contextLabel: 'Layer visual prompt',
        selectedPromptSource: layerPrompt.source,
        layerDataIndex,
        sourceSceneIndex: getOptionalInteger(options?.sourceSceneIndex),
        sourceSceneIndexSource: options?.sourceSceneIndexSource || '',
        contextText: summarizeTextForLog(context),
        selectedPromptText: summarizeTextForLog(layerPrompt.value),
      },
    };
  }

  const sceneDetails = getSceneVisualDetailsForLayer(sessionData, layerDataIndex, layer, options);

  if (sceneDetails.value) {
    const context = `Scene visual: ${sceneDetails.value}`;
    return {
      context,
      diagnostics: {
        contextType: 'scene_visual',
        contextLabel: 'Scene visual',
        selectedPromptSource: 'movieResourceList.scenes.visual',
        layerDataIndex,
        sourceSceneIndex: sceneDetails.sourceSceneIndex,
        sourceSceneIndexSource: sceneDetails.sourceSceneIndexSource,
        sceneIndexFallbackUsed: sceneDetails.fallbackUsed,
        sceneCount: sceneDetails.sceneCount,
        layerCount: sceneDetails.layerCount,
        contextText: summarizeTextForLog(context),
        selectedPromptText: summarizeTextForLog(sceneDetails.value),
      },
    };
  }

  return {
    context: '',
    diagnostics: {
      contextType: 'empty',
      contextLabel: '',
      selectedPromptSource: '',
      layerDataIndex,
      sourceSceneIndex: sceneDetails.sourceSceneIndex,
      sourceSceneIndexSource: sceneDetails.sourceSceneIndexSource,
      sceneIndexFallbackUsed: sceneDetails.fallbackUsed,
      sceneCount: sceneDetails.sceneCount,
      layerCount: sceneDetails.layerCount,
      contextText: summarizeTextForLog(''),
      selectedPromptText: summarizeTextForLog(''),
    },
  };
}

function buildImageThemeScoringContext(sessionData = {}, layerDataIndex = -1, currentImagePrompt = '', options = {}) {
  return buildImageThemeScoringContextDetails(
    sessionData,
    layerDataIndex,
    currentImagePrompt,
    options,
  ).context;
}

function buildImageThemeScoringContextDetailsForPayload(sessionData = {}, layerDataIndex = -1, payload = {}) {
  const sourceSceneIndex =
    payload?.sourceSceneIndex ??
    payload?.sceneIndex ??
    payload?.movieResourceIndex;
  return buildImageThemeScoringContextDetails(
    sessionData,
    layerDataIndex,
    payload?.prompt || '',
    {
      sourceSceneIndex,
      sourceSceneIndexSource: payload?.sourceSceneIndexSource ||
        (payload?.sourceSceneIndex !== undefined
        ? 'payload.sourceSceneIndex'
        : (payload?.sceneIndex !== undefined
          ? 'payload.sceneIndex'
          : (payload?.movieResourceIndex !== undefined ? 'payload.movieResourceIndex' : ''))),
      currentPromptSource: 'payload.prompt',
    },
  );
}

function buildImageThemeScoringContextForPayload(sessionData = {}, layerDataIndex = -1, payload = {}) {
  return buildImageThemeScoringContextDetailsForPayload(sessionData, layerDataIndex, payload).context;
}

function buildImageThemeStyleContext(sessionData = {}) {
  const parentJsonTheme = parseMaybeJson(sessionData.parentJsonTheme);
  const themeStyle = parentJsonTheme?.style;

  if (!themeStyle) {
    return '';
  }

  if (typeof themeStyle === 'string') {
    return themeStyle.trim();
  }

  if (Array.isArray(themeStyle) && themeStyle.length === 0) {
    return '';
  }

  if (
    typeof themeStyle === 'object' &&
    !Array.isArray(themeStyle) &&
    Object.keys(themeStyle).length === 0
  ) {
    return '';
  }

  return JSON.stringify(themeStyle);
}

function normalizePromptForComparison(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function isSafetyRejectionMessage(message = '') {
  return /safety system|safety_violations|content policy|policy violation|request was rejected|inappropriate content/i.test(
    String(message || '')
  );
}

function extractSafetyViolationLabels(message = '') {
  const match = String(message || '').match(/safety_violations=\[([^\]]+)\]/i);
  if (!match) {
    return [];
  }
  return match[1]
    .split(',')
    .map((label) => label.trim().toLowerCase())
    .filter(Boolean);
}

function sanitizePromptForThemePreservingRetry(prompt = '', failureMessage = '') {
  const labels = extractSafetyViolationLabels(failureMessage);
  let sanitizedPrompt = String(prompt || '').trim();

  sanitizedPrompt = sanitizedPrompt
    .replace(/\b(?:Dragon\s*Ball(?:\s*Z)?|DBZ|Goku|Vegeta|Kamehameha)\b/gi, 'original martial-arts energy-hero theme')
    .replace(/\b(?:Super\s+Saiyan(?:\s+\d+)?|Saiyan(?:-like)?)\b/gi, 'original energy-awakened hero')
    .replace(/\b(?:orange\s+gi|orange\s+martial\s+arts\s+gi)\b/gi, 'brand-free martial-arts outfit')
    .replace(/\b(?:blue\s+belt\s+sash|blue\s+wristbands|blue\s+boots|dark\s+blue\s+undershirt)\b/gi, 'simple contrasting training gear')
    .replace(/\b(?:waist-length|long\s+wild|spiked\s+golden|golden\s+hair)\b/gi, 'original non-identifying hairstyle')
    .replace(/\bteal-green\s+eyes\b/gi, 'expressive eyes')
    .replace(/\bno\s+eyebrows\b/gi, 'neutral brow design')
    .replace(/\bprominent\s+brow\s+ridge\b/gi, 'strong brow shadow')
    .replace(/\b(?:exact|photorealistic|photo-realistic)\s+likeness\b/gi, 'fictional non-identifying appearance')
    .replace(/\b(?:likeness|face|facial features)\s+of\b/gi, 'fictional non-identifying character inspired by the role of')
    .replace(/\b(?:looks like|look like|resembling|resembles|portrayed by|played by)\b/gi, 'using a fictional non-identifying character inspired by')
    .replace(/\b(?:celebrity|public figure|real person|real-life person)\b/gi, 'fictional non-identifying adult character')
    .replace(/\b(?:blood|gore|gory|mutilated|mutilation|dismembered|dismemberment)\b/gi, 'non-graphic dramatic detail');

  if (labels.includes('violence')) {
    sanitizedPrompt = sanitizedPrompt
      .replace(/\b(?:killing|murdering|stabbing|shooting|beheading|torturing)\b/gi, 'dramatic non-graphic tension')
      .replace(/\b(?:corpse|dead body|dead bodies)\b/gi, 'empty aftermath-free scene element');
  }

  return sanitizedPrompt;
}

function buildThemePreservingSafetyRetryPrompt(originalPrompt = '', failureMessage = '', retryCount = 1) {
  const labels = extractSafetyViolationLabels(failureMessage);
  const sanitizedPrompt = sanitizePromptForThemePreservingRetry(originalPrompt, failureMessage);
  const rewriteConstraints = [
    'Use an original, brand-free, non-identifying adult character design.',
    'Keep only broad setting, mood, action, composition, lighting, camera angle, visual medium, genre, and visual style.',
    'Avoid fictional species labels, transformation names, attack names, exact costume colorways, signature hair/eye/costume combinations, logos, names, and iconic silhouettes.',
    'Do not switch to a generic cinematic fallback, different medium, different genre, different era, or unrelated setting.',
    'Keep the scene coherent and suitable for a general audience.',
  ];

  if (labels.includes('violence')) {
    rewriteConstraints.push(
      'If the scene contains conflict, show it as non-graphic tension or symbolic aftermath-free drama; avoid gore, injury detail, active harm, weapon contact, or suffering.'
    );
  }

  if (!sanitizedPrompt) {
    return [
      'Image for the same storyboard scene and visual theme.',
      ...rewriteConstraints,
    ].join(' ');
  }

  return [
    `Brand-free reinterpretation of the same broad storyboard: ${sanitizedPrompt}`,
    ...rewriteConstraints,
  ].join(' ');
}

async function getAlteredPromptForRetry(
  prompt,
  retryCount,
  failureMessage = '',
  previousPrompt = '',
  rewriteMode = 'generation_failure',
  userInferenceModel,
  userInferenceAuthorization,
) {
  const originalPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const currentPrompt = typeof previousPrompt === 'string' ? previousPrompt.trim() : '';

  if (isSafetyRejectionMessage(failureMessage)) {
    try {
      const safetyAlteredPrompt = await getAlternatePromptFromPrompt(
        originalPrompt,
        retryCount,
        failureMessage,
        rewriteMode,
        userInferenceModel,
        userInferenceAuthorization,
      );
      const normalizedSafetyPrompt = typeof safetyAlteredPrompt === 'string' ? safetyAlteredPrompt.trim() : '';
      const normalizedSafetyComparison = normalizePromptForComparison(normalizedSafetyPrompt);

      if (
        normalizedSafetyPrompt &&
        normalizedSafetyComparison !== normalizePromptForComparison(originalPrompt) &&
        normalizedSafetyComparison !== normalizePromptForComparison(currentPrompt)
      ) {
        return normalizedSafetyPrompt;
      }
    } catch (err) {
      console.error('[image_generation] safety retry prompt rewrite failed', {
        retryCount,
        message: err?.message || String(err),
      });
    }

    return buildThemePreservingSafetyRetryPrompt(originalPrompt, failureMessage, retryCount);
  }

  const alteredPrompt = await getAlternatePromptFromPrompt(
    originalPrompt,
    retryCount,
    failureMessage,
    rewriteMode,
    userInferenceModel,
    userInferenceAuthorization,
  );
  const normalizedAlteredPrompt = typeof alteredPrompt === 'string' ? alteredPrompt.trim() : '';
  const normalizedAlteredComparison = normalizePromptForComparison(normalizedAlteredPrompt);

  if (
    normalizedAlteredPrompt &&
    normalizedAlteredComparison !== normalizePromptForComparison(originalPrompt) &&
    normalizedAlteredComparison !== normalizePromptForComparison(currentPrompt)
  ) {
    return normalizedAlteredPrompt;
  }

  return [
    sanitizePromptForThemePreservingRetry(originalPrompt, failureMessage) || 'Image for the same storyboard scene and visual theme.',
    'Preserve the original subject, setting, mood, composition, lighting, visual medium, genre, and visual style.',
    'Use fictional non-identifying characters and brand-free details where needed.',
  ].join(' ');
}

function hasSessionInferenceModel(session = {}) {
  return Boolean(
    (typeof session.expressGenerationInferenceModel === 'string' && session.expressGenerationInferenceModel.trim()) ||
    (typeof session.inferenceModel === 'string' && session.inferenceModel.trim()) ||
    (typeof session.inference_model === 'string' && session.inference_model.trim()),
  );
}

function hasSessionInferenceAuthorization(session = {}) {
  return Boolean(resolveRequestInferenceAuthorization({ session }));
}

function hasUserInferenceModel(user = {}) {
  return Boolean(
    (typeof user.selectedInferenceModel === 'string' && user.selectedInferenceModel.trim()) ||
    (typeof user.inferenceModel === 'string' && user.inferenceModel.trim()),
  );
}

function hasUserInferenceAuthorization(user = {}) {
  return Boolean(resolveRequestInferenceAuthorization({ user }));
}

function toPlainContextValue(value = {}) {
  return typeof value?.toObject === 'function' ? value.toObject() : value || {};
}

async function resolveImageInferenceSettings({
  request = {},
  fallbackRequest = {},
  session = {},
  user = {},
} = {}) {
  let resolvedSession = toPlainContextValue(session);
  let resolvedUser = toPlainContextValue(user);
  const hasRequestedModel = hasRequestInferenceModel(request) || hasRequestInferenceModel(fallbackRequest);
  const hasRequestedAuthorization =
    hasRequestInferenceAuthorization(request) ||
    hasRequestInferenceAuthorization(fallbackRequest);

  if (
    (!hasRequestedModel && !hasSessionInferenceModel(resolvedSession)) ||
    (!hasRequestedAuthorization && !hasSessionInferenceAuthorization(resolvedSession))
  ) {
    const sessionId =
      request.videoSessionId || request.sessionId ||
      fallbackRequest.videoSessionId || fallbackRequest.sessionId;
    if (sessionId) {
      const fetchedSession = await VideoSession.findById(sessionId)
        .select([
          'expressGenerationInferenceModel',
          'inferenceModel',
          'expressGenerationInferenceModelAuthorization',
          'selectedInferenceModelAuthorization',
          'inferenceModelAuthorization',
          'userId',
        ].join(' '))
        .lean() || {};
      resolvedSession = { ...fetchedSession, ...resolvedSession };
    }
  }

  const userId = request.userId || fallbackRequest.userId || resolvedSession.userId;
  if (
    (
      (!hasRequestedModel && !hasSessionInferenceModel(resolvedSession) && !hasUserInferenceModel(resolvedUser)) ||
      (
        !hasRequestedAuthorization &&
        !hasSessionInferenceAuthorization(resolvedSession) &&
        !hasUserInferenceAuthorization(resolvedUser)
      )
    ) &&
    userId
  ) {
    const fetchedUser = await User.findById(userId)
      .select('selectedInferenceModel selectedInferenceModelAuthorization')
      .lean() || {};
    resolvedUser = { ...fetchedUser, ...resolvedUser };
  }

  return resolveRequestInferenceSettings({
    request,
    fallbackRequest,
    session: resolvedSession,
    user: resolvedUser,
  });
}

function getBestFilterPass(filterPasses = [], minScore = null) {
  let bestPass = null;
  let bestScore = -Infinity;
  const requiredScore = Number(minScore);

  for (const pass of Array.isArray(filterPasses) ? filterPasses : []) {
    if (pass?.aspectRatioRejected === true) {
      continue;
    }
    const score = Number(pass?.score);
    if (
      pass?.src &&
      Number.isFinite(score) &&
      (!Number.isFinite(requiredScore) || score >= requiredScore) &&
      score > bestScore
    ) {
      bestPass = pass;
      bestScore = score;
    }
  }

  return bestPass ? { pass: bestPass, score: bestScore } : null;
}

function buildActiveImageCandidate({
  src,
  remoteSrc,
  description,
  score,
} = {}) {
  const hasScore = score !== null && score !== undefined && score !== '';
  const normalizedScore = hasScore ? Number(score) : Number.NaN;
  return {
    src: typeof src === 'string' ? src : '',
    remoteSrc: typeof remoteSrc === 'string' ? remoteSrc : '',
    description: typeof description === 'string' ? description : '',
    score: Number.isFinite(normalizedScore) ? normalizedScore : null,
  };
}

function normalizeOptionalScore(score) {
  if (score === null || score === undefined || score === '') {
    return null;
  }
  const normalizedScore = Number(score);
  return Number.isFinite(normalizedScore) ? normalizedScore : null;
}

async function processBestFilterPassIfAvailable(payload, filterPasses = [], minScore = null) {
  const bestFilterPass = getBestFilterPass(filterPasses, minScore);
  if (!bestFilterPass) {
    return false;
  }

  await processImageGenerationSuccess(
    {
      image: bestFilterPass.pass.src,
      description: bestFilterPass.pass.description || "",
    },
    payload,
    bestFilterPass.score
  );
  return true;
}

function buildFailureHistoryEntry(payload = {}, message, failureRetryCount, source) {
  return {
    at: new Date(),
    source,
    message,
    requestId: payload?._id?.toString?.() || payload?._id || null,
    videoSessionId: payload?.videoSessionId?.toString?.() || payload?.videoSessionId || null,
    layerId: payload?.layerId?.toString?.() || payload?.layerId || null,
    operationType: payload?.operationType || null,
    model: payload?.model || null,
    failureRetryCount,
  };
}

async function recordImageGenerationFailure(payload, {
  imageData = null,
  message = null,
  failureRetryCount = null,
  source = 'image_generation',
  setFields = {},
  unsetFields = {},
} = {}) {
  const requestId = payload?._id;
  if (!requestId) {
    return null;
  }

  const failureMessage = message || getImageGenerationFailureMessage(imageData);
  const normalizedFailureRetryCount = failureRetryCount === null
    ? normalizeRetryCount(payload?.failureRetryCount)
    : normalizeRetryCount(failureRetryCount);
  const historyEntry = buildFailureHistoryEntry(
    payload,
    failureMessage,
    normalizedFailureRetryCount,
    source
  );


  const update = {
      $set: {
        generationError: failureMessage,
        lastFailureAt: historyEntry.at,
        lastFailureMessage: failureMessage,
        lastFailureSource: source,
        ...setFields,
      },
      $push: {
        failureHistory: {
          $each: [historyEntry],
          $slice: -FAILURE_HISTORY_LIMIT,
        },
      },
  };
  if (Object.keys(unsetFields).length > 0) {
    update.$unset = unsetFields;
  }

  await ImageGeneration.updateOne({ _id: requestId }, update);

  return historyEntry;
}

async function updateLayerPromptForRetry(payload = {}, prompt, failureMessage) {
  const { videoSessionId, layerId } = payload;
  if (!videoSessionId || !layerId || typeof prompt !== 'string' || prompt.length === 0) {
    return;
  }

  const sessionSnapshot = await VideoSession.findOne(
    { _id: videoSessionId, 'layers._id': layerId },
    { 'layers.$': 1 }
  ).lean();
  const layerSnapshot = Array.isArray(sessionSnapshot?.layers) ? sessionSnapshot.layers[0] : null;
  const originalPromptSeed = [
    layerSnapshot?.originalImageGenerationPrompt,
    layerSnapshot?.imageSession?.originalImageGenerationPrompt,
    payload.originalImageGenerationPrompt,
    layerSnapshot?.originalImagePrompt,
    layerSnapshot?.imageSession?.originalImagePrompt,
    layerSnapshot?.sourcePrompt,
    layerSnapshot?.imageSession?.sourcePrompt,
    layerSnapshot?.originalPrompt,
    layerSnapshot?.imageSession?.originalPrompt,
    payload.originalImagePrompt,
    payload.originalRetryPrompt,
    layerSnapshot?.imageSession?.originalRetryPrompt,
    layerSnapshot?.prompt,
    layerSnapshot?.imageSession?.prompt,
    payload.prompt,
  ].map(normalizeString).find(Boolean);
  const originalPromptSource = normalizeString(layerSnapshot?.originalImageGenerationPromptSource) ||
    normalizeString(layerSnapshot?.imageSession?.originalImageGenerationPromptSource) ||
    normalizeString(payload.originalImageGenerationPromptSource) ||
    'image_generation_request';

  const setPayload = {
    'layers.$.prompt': prompt,
    'layers.$.imageSession.prompt': prompt,
  };
  if (originalPromptSeed) {
    if (!normalizeString(layerSnapshot?.originalImageGenerationPrompt)) {
      setPayload['layers.$.originalImageGenerationPrompt'] = originalPromptSeed;
    }
    if (!normalizeString(layerSnapshot?.originalImageGenerationPromptSource)) {
      setPayload['layers.$.originalImageGenerationPromptSource'] = originalPromptSource;
    }
    if (!normalizeString(layerSnapshot?.originalImagePrompt)) {
      setPayload['layers.$.originalImagePrompt'] = originalPromptSeed;
    }
    if (!normalizeString(layerSnapshot?.sourcePrompt)) {
      setPayload['layers.$.sourcePrompt'] = originalPromptSeed;
    }
    if (!normalizeString(layerSnapshot?.originalPrompt)) {
      setPayload['layers.$.originalPrompt'] = originalPromptSeed;
    }
    if (!normalizeString(layerSnapshot?.imageSession?.originalImagePrompt)) {
      setPayload['layers.$.imageSession.originalImagePrompt'] = originalPromptSeed;
    }
    if (!normalizeString(layerSnapshot?.imageSession?.originalImageGenerationPrompt)) {
      setPayload['layers.$.imageSession.originalImageGenerationPrompt'] = originalPromptSeed;
    }
    if (!normalizeString(layerSnapshot?.imageSession?.originalImageGenerationPromptSource)) {
      setPayload['layers.$.imageSession.originalImageGenerationPromptSource'] = originalPromptSource;
    }
    if (!normalizeString(layerSnapshot?.imageSession?.sourcePrompt)) {
      setPayload['layers.$.imageSession.sourcePrompt'] = originalPromptSeed;
    }
    if (!normalizeString(layerSnapshot?.imageSession?.originalPrompt)) {
      setPayload['layers.$.imageSession.originalPrompt'] = originalPromptSeed;
    }
    if (!normalizeString(layerSnapshot?.imageSession?.originalRetryPrompt)) {
      setPayload['layers.$.imageSession.originalRetryPrompt'] = originalPromptSeed;
    }
  }
  if (failureMessage) {
    setPayload['layers.$.imageSession.generationError'] = failureMessage;
  }

  await VideoSession.updateOne(
    { _id: videoSessionId, 'layers._id': layerId },
    { $set: setPayload }
  );
}

async function markImageGenerationRequestFailed(payload = {}, imageData = null, options = {}) {
  const requestId = payload?._id;
  const message = options.message || getImageGenerationFailureMessage(
    imageData,
    `Image generation failed after ${MAX_IMAGE_GENERATION_FAILURES} failed attempts.`
  );
  const failureRetryCount = normalizeRetryCount(options.failureRetryCount);

  await recordImageGenerationFailure(payload, {
    imageData,
    message,
    failureRetryCount,
    source: options.source || 'image_generation_terminal_failure',
    setFields: {
      generationStatus: 'FAILED',
      apiGenerationStatus: 'FAILED',
      rowLocked: false,
      failureRetryCount,
    },
  });

  const videoSessionId = payload?.videoSessionId;
  const layerId = payload?.layerId;
  if (videoSessionId && layerId) {
    const sessionData = options.sessionData || await VideoSession.findOne({ _id: videoSessionId });
    if (sessionData) {
      const shouldPruneExpressLayer =
        options.pruneLayer === true &&
        options.allowExpressImageLayerPrune === true;
      if (shouldPruneExpressLayer) {
        const pruneResult = await pruneExpressImageLayerAfterFailure({
          sessionData,
          videoSessionId,
          layerId,
          requestId,
          message,
        });
        if (pruneResult.pruned) {
          return;
        }
      }

      const layerIndex = sessionData.layers.findIndex(
        (layer) => layer._id.toString() === layerId.toString()
      );
      if (layerIndex >= 0) {
        const expressFailureUpdate = getExpressImageFailureUpdate(sessionData, message);
        await VideoSession.updateOne(
          { _id: videoSessionId },
          {
            $set: {
              [`layers.${layerIndex}.imageSession.generationStatus`]: 'FAILED',
              [`layers.${layerIndex}.imageSession.generationError`]: message,
              ...expressFailureUpdate,
            }
          }
        );
        await markVideoGlobalSessionFailed(videoSessionId, message);
      }
    }
  }

  if (requestId) {
    removeTaskFromQueueById(requestId);
  }
}

async function markVideoGlobalSessionFailed(sessionId, message) {
  if (!sessionId) {
    return;
  }

  try {
    const normalizedSessionId = sessionId?.toString?.() || sessionId;
    await GlobalSession.findOneAndUpdate(
      {
        $or: [
          { sessionId: normalizedSessionId },
          { requestId: normalizedSessionId },
        ],
      },
      {
        $set: {
          status: 'FAILED',
          errorMessage: message || 'Image generation failed.',
        },
      }
    );
  } catch (err) {
    console.error('[image_generation] failed to mark GlobalSession failed', {
      sessionId: sessionId?.toString?.() || sessionId,
      message: err?.message || String(err),
    });
  }
}

function shouldPreserveExpressImageLayerOnFailure(error) {
  return Boolean(error?.preserveExpressImageLayer || error?.nonPromptProviderFailure);
}

function shouldRetryUnhandledGenerationTask(payload = {}, error) {
  return payload?.operationType === 'GENERATE' &&
    Boolean(payload?.isBatchGeneration || payload?.retryOnFailure) &&
    shouldPreserveExpressImageLayerOnFailure(error);
}

async function rescheduleGenerationAfterRecoveryFailure(payload = {}, recoveryError) {
  const requestId = payload?._id;
  if (!requestId) {
    return;
  }

  const latestDoc = await ImageGeneration.findById(requestId);
  if (!latestDoc || isTerminalImageRequestStatus(latestDoc.generationStatus)) {
    return;
  }

  const nextFailureCount = normalizeRetryCount(latestDoc.failureRetryCount) + 1;
  const message = recoveryError?.message || 'Image generation recovery handler failed.';
  if (nextFailureCount >= MAX_IMAGE_GENERATION_FAILURES) {
    await markImageGenerationRequestFailed(latestDoc, { image: null, error: message }, {
      failureRetryCount: nextFailureCount,
      message: `${message} Max image generation failures reached (${MAX_IMAGE_GENERATION_FAILURES}).`,
      source: 'image_generation_recovery_max_failures',
      pruneLayer: false,
    });
    return;
  }

  await recordImageGenerationFailure(latestDoc, {
    imageData: { image: null, error: message },
    message,
    failureRetryCount: nextFailureCount,
    source: 'image_generation_recovery_backoff',
    setFields: {
      rowLocked: false,
      failureRetryCount: nextFailureCount,
      nextAttemptAfter: getImageGenerationNextAttemptAfter(nextFailureCount),
      // Preserve the submitted provider request so the retry polls the existing
      // FAL result instead of charging for a duplicate image generation.
      generationStatus: latestDoc.generationStatus || 'PENDING',
      apiGenerationStatus: latestDoc.apiGenerationStatus || 'PENDING',
    },
  });
}

async function recoverUnhandledGenerationTask(activeTask, error) {
  if (isAvatarVoiceoverImageRequest(activeTask)) {
    await updateAvatarVoiceoverImageGeneration(
      { image: null, error: error?.message || 'Unable to generate avatar image.' },
      activeTask
    );
    return;
  }

  if (isExpressNarratorAvatarImageRequest(activeTask)) {
    await updateExpressNarratorAvatarImageGeneration(
      { image: null, error: error?.message || 'Unable to generate narrator avatar image.' },
      activeTask
    );
    return;
  }

  const preserveExpressImageLayer = shouldPreserveExpressImageLayerOnFailure(error);
  const failureData = {
    image: null,
    error: error?.message || 'Unhandled image generation error.',
  };
  if (shouldRetryUnhandledGenerationTask(activeTask, error)) {
    await handleNoImageRetryOrFailure(activeTask, failureData);
    return;
  }

  await markImageGenerationRequestFailed(
    activeTask,
    failureData,
    {
      failureRetryCount: normalizeRetryCount(activeTask?.failureRetryCount) + 1,
      source: preserveExpressImageLayer
        ? 'image_generation_provider_configuration_error'
        : 'image_generation_unhandled_error',
      pruneLayer: !preserveExpressImageLayer,
    }
  );
}

async function scheduleImageGenerationRetry(payload = {}, latestDoc, imageData, {
  source = 'image_generation_retry',
  updateLayerPrompt = true,
  terminalOnMaxFailures = true,
  sessionData = {},
  rotateAdapter = true,
} = {}) {
  const previousFailureCount = normalizeRetryCount(latestDoc?.failureRetryCount);
  const nextFailureCount = previousFailureCount + 1;
  const failureMessage = getImageGenerationFailureMessage(imageData);
  const retrySource = isSafetyRejectionMessage(failureMessage) ? `${source}_safety` : source;

  if (nextFailureCount >= MAX_IMAGE_GENERATION_FAILURES) {
    if (terminalOnMaxFailures) {
      await markImageGenerationRequestFailed(payload, imageData, {
        failureRetryCount: nextFailureCount,
        message: `${failureMessage} Max image generation failures reached (${MAX_IMAGE_GENERATION_FAILURES}).`,
        source: 'image_generation_max_failures',
        ...getBranchedTerminalGenerationPruneOptions(sessionData),
      });
    }
    return false;
  }

  const retryPrompt = latestDoc?.originalRetryPrompt || payload?.originalRetryPrompt || latestDoc?.prompt || payload?.prompt;
  if (!retryPrompt) {
    await markImageGenerationRequestFailed(payload, imageData, {
      failureRetryCount: nextFailureCount,
      message: `${failureMessage} Unable to build retry prompt.`,
      source: 'image_generation_retry_prompt_missing',
    });
    return false;
  }

  const currentPrompt = latestDoc?.prompt || payload?.prompt || '';
  const retryInferenceSettings = await resolveImageInferenceSettings({
    request: latestDoc,
    fallbackRequest: payload,
    session: sessionData,
  });
  const newPrompt = await getAlteredPromptForRetry(
    retryPrompt,
    nextFailureCount,
    failureMessage,
    currentPrompt,
    'generation_failure',
    retryInferenceSettings.model,
    retryInferenceSettings.authorization,
  );
  const setFields = {
    prompt: newPrompt,
    rowLocked: false,
    generationStatus: 'INIT',
    apiGenerationStatus: 'INIT',
    failureRetryCount: nextFailureCount,
    nextAttemptAfter: getImageGenerationNextAttemptAfter(nextFailureCount),
  };
  const adapterRetryState = getImageGenerationAdapterRetryState(
    latestDoc || payload,
    { rotateAdapter },
  );
  Object.assign(setFields, adapterRetryState.setFields);
  if (!latestDoc?.originalRetryPrompt) {
    setFields.originalRetryPrompt = retryPrompt;
  }

  await recordImageGenerationFailure(payload, {
    imageData,
    message: failureMessage,
    failureRetryCount: nextFailureCount,
    source: retrySource,
    setFields,
    unsetFields: adapterRetryState.unsetFields,
  });

  if (updateLayerPrompt) {
    await updateLayerPromptForRetry(payload, newPrompt, failureMessage);
  }

  return true;
}

function getImagePlacementForCanvas(imageData, canvasDimensions) {
  const sourceWidth = Number(imageData?.width);
  const sourceHeight = Number(imageData?.height);
  const shouldPreserveOriginal =
    imageData?.preserveOriginalForAiVideo &&
    Number.isFinite(sourceWidth) &&
    Number.isFinite(sourceHeight) &&
    sourceWidth > 0 &&
    sourceHeight > 0;

  if (!shouldPreserveOriginal) {
    return {
      x: 0,
      y: 0,
      width: canvasDimensions.width,
      height: canvasDimensions.height,
      sourceWidth: canvasDimensions.width,
      sourceHeight: canvasDimensions.height,
      preserveOriginalForAiVideo: false
    };
  }

  const scale = Math.min(
    1,
    canvasDimensions.width / sourceWidth,
    canvasDimensions.height / sourceHeight
  );
  const width = Math.round(sourceWidth * scale);
  const height = Math.round(sourceHeight * scale);

  return {
    x: Math.round((canvasDimensions.width - width) / 2),
    y: Math.round((canvasDimensions.height - height) / 2),
    width,
    height,
    sourceWidth,
    sourceHeight,
    preserveOriginalForAiVideo: true
  };
}

function getImageItemPlacementFields(remoteImageUrl, placement) {
  const fields = {
    src: remoteImageUrl,
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: placement.height,
  };

  if (placement.preserveOriginalForAiVideo) {
    fields.sourceWidth = placement.sourceWidth;
    fields.sourceHeight = placement.sourceHeight;
    fields.aiVideoSourceOriginal = true;
  }

  return fields;
}

function clearOriginalImagePlacementFields(item) {
  if (!item) {
    return item;
  }
  delete item.sourceWidth;
  delete item.sourceHeight;
  delete item.aiVideoSourceOriginal;
  return item;
}

/**
 * Helper to remove a task from taskQueue by its Mongo _id.
 * @param {string|Object} requestId The _id to remove from the queue.
 */
function removeTaskFromQueueById(requestId) {
  // If _id is a Mongo ObjectId, compare using .equals(), otherwise compare string
  for (let i = taskQueue.length - 1; i >= 0; i--) {
    if (taskQueue[i]._id.toString() === requestId.toString()) {
      taskQueue.splice(i, 1);
    }
  }
}

function getExpressImageFailureUpdate(sessionData, message = 'Image generation failed after retries') {
  if (!sessionData || !sessionData.isExpressGeneration) {
    return {};
  }

  const now = new Date();
  return {
    'expressGenerationStatus.image_generation': 'FAILED',
    'expressGenerationStatus.status': 'FAILED',
    expressGenerationPending: false,
    expressGenerationFailed: true,
    expressGenerationError: message,
    'expressStepGeneration.status': 'FAILED',
    'expressStepGeneration.error': message,
    'expressStepGeneration.updatedAt': now,
    'expressStepGeneration.updated_at': now,
  };
}

function getDocumentAgeMs(value) {
  const timestamp = value ? new Date(value).getTime() : 0;
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return 0;
  }
  return Date.now() - timestamp;
}

function isProviderPendingTimedOut(task = {}) {
  if (task?.apiGenerationStatus !== 'PENDING') {
    return false;
  }
  const pendingSince = task.apiSubmittedAt || task.createdAt;
  const ageMs = getDocumentAgeMs(pendingSince);
  return ageMs >= IMAGE_GENERATION_PROVIDER_PENDING_TIMEOUT_MS;
}

function getConnectedAudioRelativeStart(audioLayer = {}, layer = {}) {
  const layerOffset = Number(layer?.durationOffset);
  const audioStart = Number(audioLayer?.startTime);
  if (Number.isFinite(layerOffset) && Number.isFinite(audioStart)) {
    return Math.max(0, audioStart - layerOffset);
  }

  const storedOffset = Number(audioLayer?.connectedLayerStartTimeOffset);
  return Number.isFinite(storedOffset) ? Math.max(0, storedOffset) : 0;
}

function getAudioLayerDuration(audioLayer = {}) {
  const duration = Number(audioLayer?.duration);
  if (Number.isFinite(duration) && duration >= 0) {
    return duration;
  }

  const start = Number(audioLayer?.startTime);
  const end = Number(audioLayer?.endTime);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    return end - start;
  }

  return 0;
}

function clampAudioLayersToTimeline(audioLayers = [], totalDuration = 0) {
  const safeTimelineEnd = Math.max(0, Number(totalDuration) || 0);

  for (const audioLayer of audioLayers) {
    const startTimeValue = Number(audioLayer?.startTime);
    const startTime = Number.isFinite(startTimeValue) ? Math.max(0, startTimeValue) : 0;
    const endTimeValue = Number(audioLayer?.endTime);
    const audioDuration = getAudioLayerDuration(audioLayer);
    const endTime = Number.isFinite(endTimeValue) && endTimeValue >= startTime
      ? endTimeValue
      : startTime + audioDuration;

    if (startTime > safeTimelineEnd) {
      audioLayer.startTime = safeTimelineEnd;
      audioLayer.endTime = safeTimelineEnd;
    } else if (endTime > safeTimelineEnd) {
      audioLayer.endTime = safeTimelineEnd;
    }
  }

  return audioLayers;
}

function reflowLayersAndConnectedAudio(layers = [], audioLayers = []) {
  const originalLayersById = new Map(
    layers
      .map((layer) => [
        layer?._id?.toString?.(),
        {
          durationOffset: layer?.durationOffset,
          duration: layer?.duration,
        },
      ])
      .filter(([layerId]) => Boolean(layerId))
  );
  let durationOffset = 0;

  for (const layer of layers) {
    const layerId = layer?._id?.toString?.();
    const originalLayer = originalLayersById.get(layerId) || layer;
    const duration = Math.max(0, Number(layer?.duration) || 0);
    layer.durationOffset = durationOffset;

    for (const audioLayer of audioLayers) {
      if (!layerId || String(audioLayer?.connectedLayerId || '') !== layerId) {
        continue;
      }
      const relativeStart = Math.min(
        duration,
        getConnectedAudioRelativeStart(audioLayer, originalLayer)
      );
      const audioDuration = getAudioLayerDuration(audioLayer);
      audioLayer.connectedLayerStartTimeOffset = relativeStart;
      audioLayer.startTime = durationOffset + relativeStart;
      audioLayer.endTime = audioLayer.startTime + audioDuration;
    }

    durationOffset += duration;
  }

  clampAudioLayersToTimeline(audioLayers, durationOffset);
  return durationOffset;
}

function normalizeDocumentId(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return value?.toString?.() || String(value);
}

function cloneDocumentObject(value) {
  const plainValue = typeof value?.toObject === 'function'
    ? value.toObject({ depopulate: true })
    : value;
  return plainValue && typeof plainValue === 'object' ? { ...plainValue } : {};
}

function getNonNegativeInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const normalized = Number(value);
  return Number.isInteger(normalized) && normalized >= 0 ? normalized : null;
}

function getBranchTimelineLayerId(entry = {}) {
  return normalizeDocumentId(entry?.layerId ?? entry?.layer_id);
}

function getBranchAudioLayerId(entry = {}) {
  return normalizeDocumentId(
    entry?.audioLayerId ?? entry?.audio_layer_id ?? entry?.layerId ?? entry?._id,
  );
}

function getBranchAudioConnectedLayerId(entry = {}, audioLayer = {}) {
  return normalizeDocumentId(
    entry?.connectedLayerId ??
    entry?.connected_layer_id ??
    audioLayer?.connectedLayerId ??
    audioLayer?.connected_layer_id,
  );
}

function getBranchAudioType(entry = {}, audioLayer = {}) {
  return normalizeString(
    audioLayer?.generationType ??
    audioLayer?.type ??
    entry?.generationType ??
    entry?.type,
  ).toLowerCase().replace(/[\s-]+/g, '_');
}

function getPositiveDuration(value) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function reflowSceneIndexAfterRemoval(sceneIndex, removedSceneIndices = []) {
  const normalizedSceneIndex = getNonNegativeInteger(sceneIndex);
  if (normalizedSceneIndex === null) {
    return null;
  }

  const removedBeforeOrAt = removedSceneIndices.filter(
    (removedSceneIndex) => removedSceneIndex <= normalizedSceneIndex,
  ).length;
  const reflowedSceneIndex = normalizedSceneIndex - removedBeforeOrAt;
  return reflowedSceneIndex >= 0 ? reflowedSceneIndex : null;
}

function getChoicePointKey(choice = {}) {
  const branchPointId = normalizeDocumentId(
    choice?.branchPointId ?? choice?.branch_point_id,
  );
  if (branchPointId) {
    return `branch:${branchPointId}`;
  }
  const parentNodeId = normalizeDocumentId(
    choice?.parentNodeId ?? choice?.parent_node_id,
  );
  return parentNodeId ? `parent:${parentNodeId}` : '';
}

function getChoicePointTimingByKey(branchRenderPaths = []) {
  const timingByKey = new Map();
  for (const path of branchRenderPaths) {
    for (const choice of Array.isArray(path?.selectionTrail) ? path.selectionTrail : []) {
      const key = getChoicePointKey(choice);
      if (!key || timingByKey.has(key)) {
        continue;
      }
      timingByKey.set(key, {
        divergenceSceneIndex: getNonNegativeInteger(
          choice?.divergenceSceneIndex ?? choice?.divergence_scene_index,
        ),
        switchAtSeconds: Number.isFinite(Number(
          choice?.switchAtSeconds ?? choice?.switch_at_seconds,
        ))
          ? Number(choice?.switchAtSeconds ?? choice?.switch_at_seconds)
          : null,
      });
    }
  }
  return timingByKey;
}

function reflowBranchingMeta(branchingMeta = {}, branchRenderPaths = []) {
  const timingByKey = getChoicePointTimingByKey(branchRenderPaths);
  const sourceBranchPoints = Array.isArray(branchingMeta?.branchPoints)
    ? branchingMeta.branchPoints
    : [];
  const branchPoints = sourceBranchPoints.map((branchPoint) => {
    const timing = timingByKey.get(getChoicePointKey(branchPoint));
    return timing
      ? { ...cloneDocumentObject(branchPoint), divergenceSceneIndex: timing.divergenceSceneIndex }
      : cloneDocumentObject(branchPoint);
  });

  const branchSceneIndices = Array.isArray(branchingMeta?.branchSceneIndices)
    ? branchingMeta.branchSceneIndices.map((configuredIndex, arrayIndex) => {
      const level = arrayIndex + 1;
      const levelIndices = branchPoints
        .filter((branchPoint) => Number(branchPoint?.level) === level)
        .map((branchPoint) => getNonNegativeInteger(branchPoint?.divergenceSceneIndex));
      if (levelIndices.length === 0) {
        return configuredIndex;
      }
      const distinctIndices = [...new Set(levelIndices)];
      return distinctIndices.length === 1 ? distinctIndices[0] : null;
    })
    : [];

  return {
    ...(branchingMeta || {}),
    branchPoints,
    branchSceneIndices,
  };
}

function buildBranchOptionsFromMeta(branchPoint = {}, branchRenderPaths = []) {
  const divergencePaths = Array.isArray(branchPoint?.divergencePaths)
    ? branchPoint.divergencePaths
    : [];
  return divergencePaths.map((option, optionIndex) => {
    const childNodeId = normalizeDocumentId(
      option?.childNodeId ?? option?.child_node_id,
    );
    return {
      childNodeId,
      branchOrdinal: Number(option?.branchOrdinal ?? option?.branch_ordinal) || optionIndex + 1,
      branchingHint: option?.branchingHint ?? option?.path_name ?? option?.pathName ?? null,
      description:
        option?.description ?? option?.path_description ?? option?.pathDescription ?? null,
      leafPathIds: branchRenderPaths
        .filter((path) => (Array.isArray(path?.selectionTrail) ? path.selectionTrail : [])
          .some((choice) => normalizeDocumentId(
            choice?.nodeId ?? choice?.node_id ?? choice?.childNodeId,
          ) === childNodeId))
        .map((path) => normalizeDocumentId(path?.pathId)),
    };
  });
}

function reflowBranchingTimeline({
  branchingTimeline = {},
  branchingMeta = {},
  branchRenderPaths = [],
  defaultBranchPathId = null,
} = {}) {
  const timingByKey = getChoicePointTimingByKey(branchRenderPaths);
  const existingChoicePointByKey = new Map(
    (Array.isArray(branchingTimeline?.choicePoints) ? branchingTimeline.choicePoints : [])
      .map((choicePoint) => [getChoicePointKey(choicePoint), choicePoint])
      .filter(([key]) => Boolean(key)),
  );
  const configuredBranchPoints = Array.isArray(branchingMeta?.branchPoints)
    ? branchingMeta.branchPoints
    : [];
  const sourceBranchPoints = configuredBranchPoints.length > 0
    ? configuredBranchPoints
    : (Array.isArray(branchingTimeline?.choicePoints)
      ? branchingTimeline.choicePoints
      : []);
  const choicePoints = sourceBranchPoints.map((branchPoint) => {
    const key = getChoicePointKey(branchPoint);
    const existingChoicePoint = existingChoicePointByKey.get(key) || {};
    const timing = timingByKey.get(key) || {};
    const existingOptions = Array.isArray(existingChoicePoint?.options)
      ? existingChoicePoint.options.map(cloneDocumentObject)
      : [];
    return {
      ...cloneDocumentObject(existingChoicePoint),
      branchPointId: normalizeDocumentId(
        branchPoint?.branchPointId ?? branchPoint?.branch_point_id,
      ) || null,
      parentNodeId: normalizeDocumentId(
        branchPoint?.parentNodeId ?? branchPoint?.parent_node_id,
      ) || null,
      level: getNonNegativeInteger(branchPoint?.level),
      divergenceSceneIndex: timing.divergenceSceneIndex ?? null,
      switchAtSeconds: timing.switchAtSeconds ?? 0,
      options: existingOptions.length > 0
        ? existingOptions
        : buildBranchOptionsFromMeta(branchPoint, branchRenderPaths),
    };
  });

  const normalizedDefaultPathId = normalizeDocumentId(defaultBranchPathId);
  const effectiveDefaultPathId = branchRenderPaths.some(
    (path) => normalizeDocumentId(path?.pathId) === normalizedDefaultPathId,
  )
    ? normalizedDefaultPathId
    : normalizeDocumentId(branchRenderPaths[0]?.pathId) || null;

  return {
    ...(branchingTimeline || {}),
    schemaVersion: branchingTimeline?.schemaVersion || 'branching_timeline.v1',
    timing: branchingTimeline?.timing || { origin: 'media', unit: 'seconds' },
    rootNodeId:
      normalizeDocumentId(branchingTimeline?.rootNodeId) ||
      normalizeDocumentId(branchingMeta?.rootNodeId) ||
      normalizeDocumentId(branchRenderPaths[0]?.nodeIds?.[0]) ||
      null,
    defaultPathId: effectiveDefaultPathId,
    choicePoints,
  };
}

function reflowBranchedAudioTimeline({
  audioTimeline = [],
  timeline = [],
  pathDuration = 0,
  remainingAudioById = new Map(),
  removedAudioLayerIds = new Set(),
  removedLayerId = '',
  removedSceneIndices = [],
} = {}) {
  return (Array.isArray(audioTimeline) ? audioTimeline : []).flatMap((rawEntry) => {
    const entry = cloneDocumentObject(rawEntry);
    const audioLayerId = getBranchAudioLayerId(entry);
    const audioLayer = remainingAudioById.get(audioLayerId) || {};
    const connectedLayerId = getBranchAudioConnectedLayerId(entry, audioLayer);
    if (
      removedAudioLayerIds.has(audioLayerId) ||
      (connectedLayerId && connectedLayerId === removedLayerId)
    ) {
      return [];
    }

    const audioType = getBranchAudioType(entry, audioLayer);
    if (!connectedLayerId || audioType === 'music') {
      return [{
        ...entry,
        duration: pathDuration,
        startTime: 0,
        endTime: pathDuration,
        connectedLayerStartTimeOffset: 0,
        sceneIndex: reflowSceneIndexAfterRemoval(entry?.sceneIndex, removedSceneIndices),
      }];
    }

    const connectedLayerIndex = timeline.findIndex(
      (timelineEntry) => getBranchTimelineLayerId(timelineEntry) === connectedLayerId,
    );
    if (connectedLayerIndex < 0) {
      return [];
    }

    const connectedTimelineEntry = timeline[connectedLayerIndex];
    const connectedLayerDuration = getPositiveDuration(connectedTimelineEntry?.duration) || 0;
    const audioDuration = getPositiveDuration(audioLayer?.duration) ||
      getPositiveDuration(entry?.duration) ||
      connectedLayerDuration;
    const relativeStart = audioType === 'speech' && connectedLayerDuration > audioDuration
      ? (connectedLayerDuration - audioDuration) / 2
      : Math.min(
        connectedLayerDuration,
        Math.max(0, Number(entry?.connectedLayerStartTimeOffset) || 0),
      );
    const startTime = connectedTimelineEntry.startTime + relativeStart;
    return [{
      ...entry,
      connectedLayerId,
      connectedLayerIndex,
      sequenceIndex: connectedLayerIndex,
      pathSequenceIndex: connectedLayerIndex,
      connectedLayerStartTimeOffset: relativeStart,
      sceneIndex: connectedTimelineEntry.sceneIndex,
      duration: audioDuration,
      startTime,
      endTime: startTime + audioDuration,
    }];
  });
}

function reflowBranchedPathAfterLayerRemoval({
  rawPath = {},
  layerId,
  remainingLayerDurationById = new Map(),
  remainingAudioById = new Map(),
  removedAudioLayerIds = new Set(),
} = {}) {
  const normalizedLayerId = normalizeDocumentId(layerId);
  const rawTimeline = Array.isArray(rawPath?.timeline) ? rawPath.timeline : [];
  const removedTimelineIndices = rawTimeline.flatMap((entry, index) => (
    getBranchTimelineLayerId(entry) === normalizedLayerId ? [index] : []
  ));
  if (removedTimelineIndices.length === 0) {
    return { affected: false, path: rawPath, followingLayerIds: [] };
  }

  const removedSceneIndices = [...new Set(rawTimeline
    .filter((entry) => getBranchTimelineLayerId(entry) === normalizedLayerId)
    .map((entry) => getNonNegativeInteger(entry?.sceneIndex))
    .filter((sceneIndex) => sceneIndex !== null))]
    .sort((left, right) => left - right);
  const firstRemovedTimelineIndex = Math.min(...removedTimelineIndices);
  let durationOffset = 0;
  const timeline = rawTimeline.flatMap((rawEntry, rawEntryIndex) => {
    const entry = cloneDocumentObject(rawEntry);
    const currentLayerId = getBranchTimelineLayerId(entry);
    if (currentLayerId === normalizedLayerId) {
      return [];
    }
    const duration = remainingLayerDurationById.get(currentLayerId) ||
      getPositiveDuration(entry?.duration);
    if (duration === null || duration === undefined) {
      throw new Error(
        `Branch path ${normalizeDocumentId(rawPath?.pathId) || '<unknown>'} contains an invalid layer duration.`,
      );
    }
    const sequenceIndex = rawTimeline
      .slice(0, rawEntryIndex)
      .filter((candidate) => getBranchTimelineLayerId(candidate) !== normalizedLayerId)
      .length;
    const shouldRegenerateFrames = sequenceIndex >= firstRemovedTimelineIndex;
    const reflowedEntry = {
      ...entry,
      sequenceIndex,
      pathSequenceIndex: sequenceIndex,
      sceneIndex: reflowSceneIndexAfterRemoval(entry?.sceneIndex, removedSceneIndices),
      duration,
      durationOffset,
      startTime: durationOffset,
      endTime: durationOffset + duration,
      ...(shouldRegenerateFrames
        ? {
          frameGenerationStatus: 'INIT',
          frameGenerationPending: true,
          frameGenerationError: null,
          frames: [],
        }
        : {}),
    };
    durationOffset += duration;
    return [reflowedEntry];
  });

  const selectionTrail = (Array.isArray(rawPath?.selectionTrail)
    ? rawPath.selectionTrail
    : []).map((rawChoice) => {
    const choice = cloneDocumentObject(rawChoice);
    const divergenceSceneIndex = reflowSceneIndexAfterRemoval(
      choice?.divergenceSceneIndex ?? choice?.divergence_scene_index,
      removedSceneIndices,
    );
    const divergenceEntry = divergenceSceneIndex === null
      ? null
      : [...timeline].reverse().find(
        (entry) => getNonNegativeInteger(entry?.sceneIndex) === divergenceSceneIndex,
      );
    return {
      ...choice,
      divergenceSceneIndex,
      switchAtSeconds: divergenceEntry?.endTime ?? 0,
    };
  });
  const immediateChoice = selectionTrail.at(-1) || null;
  const audioTimeline = reflowBranchedAudioTimeline({
    audioTimeline: rawPath?.audioTimeline,
    timeline,
    pathDuration: durationOffset,
    remainingAudioById,
    removedAudioLayerIds,
    removedLayerId: normalizedLayerId,
    removedSceneIndices,
  });

  return {
    affected: true,
    followingLayerIds: timeline
      .slice(firstRemovedTimelineIndex)
      .map((entry) => getBranchTimelineLayerId(entry))
      .filter(Boolean),
    path: {
      ...cloneDocumentObject(rawPath),
      duration: durationOffset,
      timeline,
      audioTimeline,
      selectionTrail,
      frameGenerationStatus: 'INIT',
      frameGenerationPending: true,
      frameGenerationError: null,
      ...(immediateChoice
        ? {
          branchingHint:
            immediateChoice?.branchingHint ?? immediateChoice?.pathName ?? null,
          branchingDescription:
            immediateChoice?.branchingDescription ?? immediateChoice?.pathDescription ?? null,
          branchPointId: normalizeDocumentId(immediateChoice?.branchPointId) || null,
          divergenceSceneIndex: immediateChoice.divergenceSceneIndex,
          switchAtSeconds: immediateChoice.switchAtSeconds,
        }
        : {}),
    },
  };
}

function buildBranchedExpressLayerPrunePlan(sessionData = {}, layerId) {
  const normalizedLayerId = normalizeDocumentId(layerId);
  const layers = Array.isArray(sessionData?.layers)
    ? sessionData.layers.map(cloneDocumentObject)
    : [];
  const layerIndex = layers.findIndex(
    (layer) => normalizeDocumentId(layer?._id) === normalizedLayerId,
  );
  if (layerIndex < 0) {
    return { pruned: true, reason: 'missing_layer' };
  }

  const branchRenderPaths = Array.isArray(sessionData?.branchRenderPaths)
    ? sessionData.branchRenderPaths
    : [];
  if (branchRenderPaths.length === 0) {
    return { pruned: false, reason: 'missing_branch_render_paths' };
  }
  const affectedPaths = branchRenderPaths.filter((path) => (
    Array.isArray(path?.timeline) && path.timeline.some(
      (entry) => getBranchTimelineLayerId(entry) === normalizedLayerId,
    )
  ));
  if (affectedPaths.some((path) => path.timeline.every(
    (entry) => getBranchTimelineLayerId(entry) === normalizedLayerId,
  ))) {
    return { pruned: false, reason: 'empty_branch_path' };
  }

  const [removedLayer] = layers.splice(layerIndex, 1);
  const removedAudioLayerIds = new Set();
  const audioLayers = (Array.isArray(sessionData?.audioLayers)
    ? sessionData.audioLayers
    : []).flatMap((audioLayer) => {
    if (getBranchAudioConnectedLayerId({}, audioLayer) === normalizedLayerId) {
      const audioLayerId = normalizeDocumentId(audioLayer?._id);
      if (audioLayerId) {
        removedAudioLayerIds.add(audioLayerId);
      }
      return [];
    }
    return [cloneDocumentObject(audioLayer)];
  });
  const remainingLayerDurationById = new Map(layers.map((layer) => [
    normalizeDocumentId(layer?._id),
    getPositiveDuration(layer?.duration),
  ]));
  const remainingAudioById = new Map(audioLayers.map((audioLayer) => [
    normalizeDocumentId(audioLayer?._id),
    audioLayer,
  ]));
  const followingLayerIds = new Set();
  const nextBranchRenderPaths = branchRenderPaths.map((path) => {
    const result = reflowBranchedPathAfterLayerRemoval({
      rawPath: path,
      layerId: normalizedLayerId,
      remainingLayerDurationById,
      remainingAudioById,
      removedAudioLayerIds,
    });
    result.followingLayerIds.forEach((followingLayerId) => followingLayerIds.add(followingLayerId));
    return result.path;
  });
  layers.forEach((layer) => {
    if (followingLayerIds.has(normalizeDocumentId(layer?._id))) {
      layer.frameGenerationPending = true;
    }
  });

  const branchingMeta = reflowBranchingMeta(
    sessionData?.branchingMeta || {},
    nextBranchRenderPaths,
  );
  const branchingTimeline = reflowBranchingTimeline({
    branchingTimeline: sessionData?.branchingTimeline || {},
    branchingMeta,
    branchRenderPaths: nextBranchRenderPaths,
    defaultBranchPathId:
      sessionData?.defaultBranchPathId ?? sessionData?.branchingTimeline?.defaultPathId,
  });
  const totalDuration = nextBranchRenderPaths.reduce(
    (maximum, path) => Math.max(maximum, Number(path?.duration) || 0),
    0,
  );

  return {
    pruned: true,
    branched: true,
    layerIndex,
    removedLayer,
    layers,
    audioLayers,
    totalDuration,
    branchRenderPaths: nextBranchRenderPaths,
    branchingMeta,
    branchingTimeline,
    followingLayerIds: [...followingLayerIds],
  };
}

function isPrunableExpressImageLayer(layer = {}) {
  const baseType = typeof layer?.layerBaseAiImageType === 'string'
    ? layer.layerBaseAiImageType.trim().toLowerCase()
    : '';
  const aiType = typeof layer?.layerAiVideoType === 'string'
    ? layer.layerAiVideoType.trim().toLowerCase()
    : '';
  return baseType !== 'none' && aiType !== 'none';
}

function buildExpressLayerPrunePlan(sessionData = {}, layerId) {
  if (!sessionData?.isExpressGeneration || !layerId) {
    return { pruned: false };
  }

  if (isBranchedVideoSession(sessionData)) {
    return buildBranchedExpressLayerPrunePlan(sessionData, layerId);
  }

  const normalizedLayerId = layerId.toString();
  const layers = Array.isArray(sessionData.layers) ? [...sessionData.layers] : [];
  const layerIndex = layers.findIndex((layer) => layer?._id?.toString?.() === normalizedLayerId);
  if (layerIndex < 0) {
    return { pruned: true, reason: 'missing_layer' };
  }

  const remainingPrunableLayerCount = layers.filter((layer) => (
    layer?._id?.toString?.() !== normalizedLayerId &&
    isPrunableExpressImageLayer(layer)
  )).length;
  if (remainingPrunableLayerCount <= 0) {
    return { pruned: false, reason: 'last_prunable_layer' };
  }

  const [removedLayer] = layers.splice(layerIndex, 1);
  const audioLayers = Array.isArray(sessionData.audioLayers)
    ? sessionData.audioLayers.filter((audioLayer) => (
      String(audioLayer?.connectedLayerId || '') !== normalizedLayerId
    ))
    : [];
  const totalDuration = reflowLayersAndConnectedAudio(layers, audioLayers);
  for (let index = layerIndex; index < layers.length; index += 1) {
    layers[index].frameGenerationPending = true;
  }

  return {
    pruned: true,
    layerIndex,
    removedLayer,
    layers,
    audioLayers,
    totalDuration,
  };
}

async function pruneExpressImageLayerAfterFailure({
  sessionData,
  videoSessionId,
  layerId,
  requestId,
  message,
}) {
  if (!sessionData?.isExpressGeneration || !videoSessionId || !layerId) {
    return { pruned: false };
  }

  let currentSessionData = sessionData;
  let prunePlan = null;
  let updated = false;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    prunePlan = buildExpressLayerPrunePlan(currentSessionData, layerId);
    if (!prunePlan.pruned) {
      return prunePlan;
    }
    if (prunePlan.reason === 'missing_layer') {
      await ImageGeneration.deleteMany({ videoSessionId, layerId });
      return prunePlan;
    }

    const now = new Date();
    const setPayload = {
      ...(!prunePlan.branched
        ? {
          layers: prunePlan.layers,
          audioLayers: prunePlan.audioLayers,
        }
        : {}),
      totalDuration: prunePlan.totalDuration,
      frameGenerationPending: true,
      'expressGenerationStatus.image_generation': 'PENDING',
      'expressGenerationStatus.status': 'PENDING',
      expressGenerationPending: true,
      expressGenerationFailed: false,
      expressGenerationError: null,
      'expressStepGeneration.status': 'PENDING',
      'expressStepGeneration.currentStep': 'image_generation',
      'expressStepGeneration.current_step': 'image_generation',
      'expressStepGeneration.currentStepLabel': 'Images',
      'expressStepGeneration.current_step_label': 'Images',
      'expressStepGeneration.waitingForProcessNext': false,
      'expressStepGeneration.waiting_for_process_next': false,
      'expressStepGeneration.requiresUserAction': false,
      'expressStepGeneration.requires_user_action': false,
      'expressStepGeneration.canProcessNext': false,
      'expressStepGeneration.can_process_next': false,
      'expressStepGeneration.updatedAt': now,
      'expressStepGeneration.updated_at': now,
      ...(prunePlan.branched
        ? {
          branchRenderPaths: prunePlan.branchRenderPaths,
          branchingMeta: prunePlan.branchingMeta,
          branchingTimeline: prunePlan.branchingTimeline,
        }
        : {}),
    };
    const version = Number(currentSessionData?.__v);
    const hasVersion = Number.isInteger(version) && version >= 0;
    const updateResult = await VideoSession.updateOne(
      {
        _id: videoSessionId,
        'layers._id': layerId,
        ...(hasVersion ? { __v: version } : {}),
      },
      {
        $set: setPayload,
        ...(hasVersion ? { $inc: { __v: 1 } } : {}),
        ...(prunePlan.branched
          ? {
            $pull: {
              layers: { _id: layerId },
              audioLayers: { connectedLayerId: normalizeDocumentId(layerId) },
            },
          }
          : {}),
      },
    );
    const modifiedCount = Number(updateResult?.modifiedCount ?? updateResult?.nModified ?? 0);
    if (modifiedCount > 0) {
      updated = true;
      break;
    }
    currentSessionData = await VideoSession.findOne({ _id: videoSessionId });
    if (!currentSessionData) {
      return { pruned: false, reason: 'missing_session' };
    }
  }
  if (!updated) {
    throw new Error('Unable to remove failed image layer after concurrent session updates.');
  }

  await ImageGeneration.deleteMany({ videoSessionId, layerId });
  if (requestId) {
    removeTaskFromQueueById(requestId);
  }

  return { pruned: true, branched: prunePlan?.branched === true };
}

async function processNextTask() {
  if (taskQueue.length === 0 || ongoingRequests >= MAX_CONCURRENT_REQUESTS) {
    return;
  }

  const task = taskQueue.shift();
  ongoingRequests++;

  const { _id } = task;
  let activeTask = task;



  try {
    const latestTask = await ImageGeneration.findById(_id);
    if (!latestTask) {
      removeTaskFromQueueById(_id);
      return;
    }

    activeTask = latestTask;

    if (latestTask.operationType === "GENERATE") {
      if (isTerminalImageRequestStatus(latestTask.generationStatus)) {
        removeTaskFromQueueById(_id);
        return;
      }
      await processPendingGenerationRequet(latestTask);
    } else if (latestTask.operationType === "EDIT") {
      if (isTerminalImageRequestStatus(latestTask.editStatus)) {
        removeTaskFromQueueById(_id);
        return;
      }
      await processEditRequest(latestTask);
    } else if (latestTask.operationType === "UPSCALE") {
      if (isTerminalImageRequestStatus(latestTask.editStatus)) {
        removeTaskFromQueueById(_id);
        return;
      }
      await processUpscaleRequest(latestTask);
    }
  } catch (error) {


    console.error('[image_generation] unhandled generation task error', {
      requestId: _id?.toString?.() || _id,
      videoSessionId: activeTask?.videoSessionId || null,
      layerId: activeTask?.layerId || null,
      model: activeTask?.model || null,
      message: error?.message || String(error),
    });
    try {
      await recoverUnhandledGenerationTask(activeTask, error);
    } catch (recoveryError) {
      console.error('[image_generation] recovery handler failed; scheduling bounded retry', {
        requestId: _id?.toString?.() || _id,
        videoSessionId: activeTask?.videoSessionId || null,
        layerId: activeTask?.layerId || null,
        model: activeTask?.model || null,
        status: recoveryError?.status || recoveryError?.response?.status || null,
        message: recoveryError?.message || String(recoveryError),
      });
      try {
        await rescheduleGenerationAfterRecoveryFailure(activeTask, recoveryError);
      } catch (rescheduleError) {
        console.error('[image_generation] failed to persist recovery backoff; releasing row lock', {
          requestId: _id?.toString?.() || _id,
          message: rescheduleError?.message || String(rescheduleError),
        });
        await ImageGeneration.updateOne(
          { _id },
          {
            $set: {
              rowLocked: false,
              nextAttemptAfter: getImageGenerationNextAttemptAfter(
                normalizeRetryCount(activeTask?.failureRetryCount) + 1,
              ),
            },
          },
        ).catch((unlockError) => {
          console.error('[image_generation] emergency row unlock failed', {
            requestId: _id?.toString?.() || _id,
            message: unlockError?.message || String(unlockError),
          });
        });
      }
    }
  } finally {
    ongoingRequests--;
    processNextTask();
  }
}

export async function getAndProcessPendingImageGenerationRows() {
  await getDBConnectionString();

  while (true) {
    await getTimeout(1000);
    await processPendingImageRequests();
  }
}

async function claimPendingImageGenerationRequest(
  requestId,
  imageGenerationModel = ImageGeneration,
  now = new Date(),
) {
  return imageGenerationModel.findOneAndUpdate(
    {
      _id: requestId,
      rowLocked: false,
      ...buildPendingImageGenerationEligibilityFilter(now),
    },
    { $set: { rowLocked: true } },
    { new: true },
  );
}

function buildPendingImageGenerationEligibilityFilter(now = new Date()) {
  const terminalStatuses = [...TERMINAL_IMAGE_REQUEST_STATUSES];
  return {
    $and: [
      {
        $or: [
          {
            operationType: 'GENERATE',
            generationStatus: { $nin: terminalStatuses },
            apiGenerationStatus: { $nin: terminalStatuses },
          },
          {
            operationType: { $in: ['EDIT', 'UPSCALE'] },
            editStatus: { $nin: terminalStatuses },
            apiEditStatus: { $nin: terminalStatuses },
          },
        ],
      },
      {
        $or: [
          { nextAttemptAfter: { $exists: false } },
          { nextAttemptAfter: null },
          { nextAttemptAfter: { $lte: now } },
        ],
      },
    ],
  };
}

export async function processPendingImageRequests() {
  const availableSlots = Math.max(
    0,
    MAX_CONCURRENT_REQUESTS - ongoingRequests - taskQueue.length,
  );
  if (availableSlots === 0) {
    return;
  }

  await getDBConnectionString();

  const eligibilityFilter = buildPendingImageGenerationEligibilityFilter();
  const pendingRequests = await ImageGeneration.find({
    rowLocked: false,
    ...eligibilityFilter,
  })
    .sort({ createdAt: 1 })
    .limit(availableSlots);

  for (let pendingRequestData of pendingRequests) {
    try {
      const lockedRequest = await claimPendingImageGenerationRequest(pendingRequestData._id);
      if (lockedRequest) {
        taskQueue.push(lockedRequest);
      }
    } catch (e) {
      console.error(`Error locking row for request ${pendingRequestData._id}:`, e);
    }
  }

  // Start only the capacity claimed during this poll.
  for (let i = 0; i < availableSlots; i++) {
    processNextTask();
  }
}

async function processPendingGenerationRequet(pendingRequestData) {
  const { model } = pendingRequestData;

  if (isProviderPendingTimedOut(pendingRequestData)) {
    const ageMinutes = Math.round(
      getDocumentAgeMs(pendingRequestData.apiSubmittedAt || pendingRequestData.createdAt) / 60000
    );
    await handleNoImageRetryOrFailure(pendingRequestData, {
      image: null,
      error: `Image provider request timed out after ${ageMinutes} minutes.`,
    }, {
      rotateAdapter: false,
    });
    return;
  }

  const selectedAdapterProvider = resolveImageProviderForModel(model, pendingRequestData);
  const adapterSelectionUpdate = {};
  if (
    normalizeString(pendingRequestData?.apiGenerationStatus || 'INIT').toUpperCase() === 'INIT' &&
    selectedAdapterProvider &&
    normalizeAdapterProvider(pendingRequestData?.submittedAdapter) !== selectedAdapterProvider
  ) {
    pendingRequestData.submittedAdapter = selectedAdapterProvider;
    adapterSelectionUpdate.submittedAdapter = selectedAdapterProvider;
  }
  if (
    isStandaloneEdition() &&
    selectedAdapterProvider &&
    normalizeAdapterProvider(pendingRequestData?.adapterProvider) !== selectedAdapterProvider
  ) {
    pendingRequestData.adapterProvider = selectedAdapterProvider;
    adapterSelectionUpdate.adapterProvider = selectedAdapterProvider;
  }
  if (Object.keys(adapterSelectionUpdate).length > 0) {
    await ImageGeneration.updateOne(
      { _id: pendingRequestData._id },
      { $set: adapterSelectionUpdate },
    );
  }

  if (shouldUseSamsarExternalImageProvider(pendingRequestData)) {
    const imageData = await handleSamsarExternalTextToImageRequest(pendingRequestData);
    if (imageData?.image) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    } else if (imageData?.error) {
      await handleNoImageRetryOrFailure(pendingRequestData, imageData);
    }
    return;
  }

  if (
    selectedAdapterProvider === DOCKER_ADAPTER_PROVIDER.GMICLOUD &&
    shouldUseGenBlazeImageProvider(pendingRequestData)
  ) {
    await recordImageProviderUsage(pendingRequestData, DOCKER_ADAPTER_PROVIDER.GMICLOUD);
    const imageData = await handleGenBlazeImageRequest(pendingRequestData);
    if (imageData?.image) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    } else if (imageData?.error) {
      await handleNoImageRetryOrFailure(pendingRequestData, imageData);
    }
    return;
  }

  await recordImageProviderUsage(
    pendingRequestData,
    resolveImageProviderForModel(model, pendingRequestData)
  );

  if (model === 'DALLE3') {
    await processDalle3GenerationRequest(pendingRequestData);
  } else if (
    model === 'FLUX1PRO' ||
    model === 'FLUX1DEV' ||
    model === 'FLUX1.1PRO' ||
    model === 'FLUX1.1ULTRA'
  ) {
    const imageData = await handleFluxRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'RECRAFTV3' || model === 'RECRAFT20B') {
    const imageData = await handleRecraftRequest(pendingRequestData);
    if (imageData && imageData.image) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'SDV3.5') {
    const imageData = await handleStableDiffusionRequest(pendingRequestData);
    if (imageData && imageData.image) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'SANA' ||
    model === 'SANA4.5B' || model === 'SANASPRINT'
  ) {
    const imageData = await handleSanaRequest(pendingRequestData);
    if (imageData && imageData.image) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'PHOTON' || model === 'PHOTONFLASH') {
    const imageData = await handlePhotonRequest(pendingRequestData);
    if (imageData && imageData.image) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'IMAGEN3' || model === 'IMAGEN3FLASH') {
    const imageData = await handleImagenRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'IMAGEN4') {
    const imageData = await handleImagenFalRequest(pendingRequestData);
    if (imageData) {

      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'GEMMA3') {
    const imageData = await handleGemma3CreateRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'LUMINAV2') {
    const imageData = await handleLuminaRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'REVE') {
    const imageData = await handleReveRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'IDEOGRAMV3') {
    const imageData = await handleIdeogramRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'HIDREAMI1') {
    const imageData = await handleHiDreamRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'GPTIMAGE2' || model === 'GPTIMAGE1') {
    const shouldUseFal = model === 'GPTIMAGE2' &&
      selectedAdapterProvider === DOCKER_ADAPTER_PROVIDER.FAL;
    const imageData = shouldUseFal
      ? await handleFalGPTImageTwoRequest(pendingRequestData)
      : await handleGPTImageTwoRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'FLITE') {
    const imageData = await handleFLiteRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'SEEDREAM') {
    const imageData = await handleSeedreamRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'CUSTOM_TEXT_TO_IMAGE' || model?.startsWith?.('CUSTOM_TEXT_TO_IMAGE:')) {
    const imageData = await handleCustomTextToImageRequest(pendingRequestData);
    if (imageData?.image) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'NANOBANANA2' || model === 'NANOBANANAPRO') {
    const imageData = selectedAdapterProvider === DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD ||
      (!selectedAdapterProvider && shouldUseGoogleNativeNanoBanana(pendingRequestData))
      ? await handleGoogleNanoBananaRequest(pendingRequestData)
      : await handleNanoBananaFalRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'WAN2.7PRO') {
    const imageData = selectedAdapterProvider === DOCKER_ADAPTER_PROVIDER.FAL
      ? await handleFalWan27Request(pendingRequestData)
      : await handleAlibabaWan27Request(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  } else if (model === 'HUNYUAN') {
    const imageData = await handleHunyuanRequest(pendingRequestData);
    if (imageData) {
      await updateImageInSessionLayer(imageData, pendingRequestData);
    }
  }
}

async function processDalle3GenerationRequest(pendingRequestData) {
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(pendingRequestData._id, { rowLocked: true });

  const requestId = pendingRequestData._id;
  const prompt = pendingRequestData.prompt;

  const imageData = await getImageFromText(pendingRequestData);
  let genRowValue = await ImageGeneration.findOne({ _id: requestId });

  if (!genRowValue) {
    // If it's already gone, also remove from the queue
    removeTaskFromQueueById(requestId);
    return;
  }

  const {
    videoSessionId,
    layerId,
  } = genRowValue;

  let sessionDataValue = await VideoSession.findOne({ _id: videoSessionId }).populate({
    path: 'layers.imageSession',
    model: 'Session'
  });

  if (!sessionDataValue) {
    await ImageGeneration.deleteOne({ _id: requestId });
    removeTaskFromQueueById(requestId);
    return;
  }

  let layerDataIndex = sessionDataValue.layers.findIndex(
    layer => layer._id.toString() === layerId
  );

  // If layer not found, remove pending request
  if (layerDataIndex === -1) {
    await ImageGeneration.deleteOne({ _id: requestId });
    removeTaskFromQueueById(requestId);
    return;
  }

  // If we got no image back from the API:
  if (!imageData || !imageData.image || imageData.image.trim().length === 0) {
    await handleNoImageRetryOrFailure(pendingRequestData, imageData);
    return;
  }



  // If we do have an image:
  await updateImageInSessionLayer(imageData, pendingRequestData);
}

async function updateImageInSessionLayer(imageData, payload) {
  await getDBConnectionString();

  if (isAvatarVoiceoverImageRequest(payload)) {
    await updateAvatarVoiceoverImageGeneration(imageData, payload);
    return;
  }
  if (isExpressNarratorAvatarImageRequest(payload)) {
    await updateExpressNarratorAvatarImageGeneration(imageData, payload);
    return;
  }

  if (!payload?.videoSessionId && !payload?.layerId && payload?.requestType === 'API') {
    await markStandaloneGenerationAsCompleted(payload, imageData);
    return;
  }

  let {
    videoSessionId,
    layerId,
    prompt,
    imageFilterScoreRequired,
    _id,
  } = payload;



  let sessionDataValue = await VideoSession.findOne({ _id: videoSessionId });
  if (!sessionDataValue) {
    await ImageGeneration.deleteOne({ _id: _id });
    removeTaskFromQueueById(_id);
    return;
  }
  sessionDataValue = sessionDataValue.toObject();


  const videoTone = sessionDataValue.videoTone || 'default';
  const inferenceSettings = await resolveImageInferenceSettings({
    request: payload,
    session: sessionDataValue,
  });
  const userInferenceModel = inferenceSettings.model;
  const userInferenceAuthorization = inferenceSettings.authorization;

  let layerDataIndex = sessionDataValue.layers.findIndex(
    (layer) => layer._id.toString() === layerId
  );

  const requestId = payload._id;
  // If layer not found, remove pending request.
  if (layerDataIndex === -1) {
    await ImageGeneration.deleteOne({ _id: requestId });
    removeTaskFromQueueById(requestId);
    return;
  }

  // If we got no image back from the API:
  if (!imageData || !imageData.image || imageData.image.length === 0) {


    await handleNoImageRetryOrFailure(payload, imageData);
    return;
  }

  const imageAsset = await persistGenerationImageForSession(imageData.image, videoSessionId);
  const imageURL = imageAsset.relativePath;
  const remoteImageUrl = imageAsset.remoteImageUrl;



  let imageScore = null;
  let imageDescription = null;

  if (imageFilterScoreRequired) {
    const requestedAspectRatio = payload.aspectRatio || sessionDataValue.aspectRatio || '';
    const imageThemeContextDetails = buildImageThemeScoringContextDetailsForPayload(sessionDataValue, layerDataIndex, payload);
    const imageThemeContext = imageThemeContextDetails.context;
    const imageThemeStyle = buildImageThemeStyleContext(sessionDataValue);

    // 1) get description from Vision - do NOT save to layer yet
    imageDescription = await addVisionDescriptionsForLayerImage(
      videoSessionId,
      layerId,
      remoteImageUrl,
      videoTone,
      userInferenceModel,
      requestedAspectRatio,
      imageThemeContext,
      userInferenceAuthorization,
    );


    // 2) assign score
    const imagePrompt = prompt;

    imageScore = await assignScoreForTheImage(
      imagePrompt,
      imageDescription,
      videoTone,
      userInferenceModel,
      requestedAspectRatio,
      imageThemeContext,
      imageThemeStyle,
      userInferenceAuthorization,
    );

    try {
      imageScore = parseInt(imageScore, 10);
    } catch (err) {
      imageScore = null;
    }

  }



  const filterScoreCutoff = getScoreThresholdCutoff(videoTone, payload);

  // If the image fails the score threshold:
  if (imageFilterScoreRequired && imageScore !== null && imageScore < filterScoreCutoff) {


    // Provide imageDescription to the re-filter logic
    await processRefilterFailure(imageData, payload, imageScore, imageDescription);
    return;
  }

  // Otherwise, success path
  // Pass the imageDescription along so we can store it on final success
  imageData.description = imageDescription || "";

  await processImageGenerationSuccess(imageData, payload, imageScore);
}

function isAvatarVoiceoverImageRequest(payload = {}) {
  return payload?.requestType === 'AVATAR_VOICEOVER' && Boolean(payload?.avatarVoiceoverTaskId);
}

function isExpressNarratorAvatarImageRequest(payload = {}) {
  return payload?.requestType === 'EXPRESS_NARRATOR_AVATAR' && Boolean(payload?.videoSessionId || payload?.sessionId);
}

async function updateExpressNarratorAvatarImageGeneration(imageData, payload) {
  await getDBConnectionString();
  const sessionId = payload?.videoSessionId?.toString?.() || payload?.videoSessionId || payload?.sessionId;
  const requestId = payload?._id;
  if (!sessionId) {
    return;
  }

  if (!imageData?.image) {
    const message = imageData?.error || 'Unable to generate narrator avatar image.';
    await VideoSession.updateOne(
      { _id: sessionId },
      {
        $set: {
          narratorAvatarImageStatus: 'FAILED',
          narratorAvatarStatus: 'FAILED',
          narratorAvatarError: message,
          'expressGenerationStatus.narrator_avatar_generation': 'FAILED',
          expressGenerationError: message,
        },
      }
    );
    if (requestId) {
      await ImageGeneration.deleteOne({ _id: requestId });
      removeTaskFromQueueById(requestId);
    }
    return;
  }

  const imageAsset = await persistGenerationImageForSession(imageData.image, sessionId);
  const remoteImageUrl = imageAsset.remoteImageUrl;
  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: {
        narratorAvatarImageStatus: 'COMPLETED',
        narratorAvatarImage: remoteImageUrl,
        narratorAvatarImageUrl: remoteImageUrl,
        narratorAvatarImageWidth: imageData.width || 0,
        narratorAvatarImageHeight: imageData.height || 0,
        narratorAvatarStatus: 'IMAGE_READY',
        narratorAvatarError: '',
      },
    }
  );
  if (requestId) {
    await ImageGeneration.deleteOne({ _id: requestId });
    removeTaskFromQueueById(requestId);
  }
}

async function updateAvatarVoiceoverImageGeneration(imageData, payload) {
  await getDBConnectionString();
  const taskId = payload?.avatarVoiceoverTaskId?.toString?.() || payload?.avatarVoiceoverTaskId;
  const requestId = payload?._id;
  if (!taskId) {
    return;
  }

  if (!imageData?.image) {
    const message = imageData?.error || 'Unable to generate avatar image.';
    await AvatarVoiceoverTask.updateOne(
      { _id: taskId },
      {
        $set: {
          status: 'FAILED',
          stage: 'IMAGE_GENERATION',
          imageStatus: 'FAILED',
          imageError: message,
          errorMessage: message,
        },
      }
    );
    if (requestId) {
      await ImageGeneration.deleteOne({ _id: requestId });
      removeTaskFromQueueById(requestId);
    }
    return;
  }

  const imageAsset = await persistGenerationImageForSession(imageData.image, payload?.sessionId || payload?.videoSessionId || taskId);
  const remoteImageUrl = imageAsset.remoteImageUrl;
  await AvatarVoiceoverTask.updateOne(
    { _id: taskId },
    {
      $set: {
        status: 'IMAGE_COMPLETED',
        stage: 'IMAGE_READY',
        imageStatus: 'COMPLETED',
        imageError: '',
        avatarImage: remoteImageUrl,
        avatarImageUrl: remoteImageUrl,
        avatarImageWidth: imageData.width || 0,
        avatarImageHeight: imageData.height || 0,
      },
    }
  );
  if (requestId) {
    await ImageGeneration.deleteOne({ _id: requestId });
    removeTaskFromQueueById(requestId);
  }
}

async function handleNoImageRetryOrFailure(payload, imageData, options = {}) {

  const {
    _id: requestId,
    prompt,
    isBatchGeneration,
    retryOnFailure,
    videoSessionId,
    layerId,
    originalRetryPrompt
  } = payload;

  await getTimeout(100);


  // 1) Fetch the latest doc from DB
  const latestDoc = await ImageGeneration.findOne({ _id: requestId });
  if (!latestDoc) {
    removeTaskFromQueueById(requestId);
    return; // The doc may already have been removed elsewhere
  }

  if (isExpressNarratorAvatarImageRequest(payload)) {
    if (retryOnFailure) {
      const scheduledRetry = await scheduleImageGenerationRetry(payload, latestDoc, imageData, {
        source: 'express_narrator_avatar_image_retry',
        updateLayerPrompt: false,
        terminalOnMaxFailures: false,
        rotateAdapter: options.rotateAdapter !== false,
      });
      if (scheduledRetry) {
        return;
      }
    }

    await recordImageGenerationFailure(payload, {
      imageData,
      failureRetryCount: normalizeRetryCount(latestDoc.failureRetryCount) + 1,
      source: 'express_narrator_avatar_image_failure',
      setFields: {
        generationStatus: 'FAILED',
        apiGenerationStatus: 'FAILED',
        rowLocked: false,
      },
    });

    await updateExpressNarratorAvatarImageGeneration(
      { image: null, error: imageData?.error || 'Unable to generate narrator avatar image.' },
      payload
    );
    return;
  }

  const sessionData = await VideoSession.findOne({ _id: videoSessionId });
  let inRefilterLoop = false;
  let layerIndex = -1;
  let filterPassesForLayer = [];
  if (sessionData) {
    layerIndex = sessionData.layers.findIndex(l => l._id.toString() === layerId);
    const layer = layerIndex >= 0 ? sessionData.layers[layerIndex] : null;
    const passes = layer?.filterPasses || [];
    filterPassesForLayer = Array.isArray(passes) ? passes : [];
    inRefilterLoop = filterPassesForLayer.length > 0;
  }




  if (inRefilterLoop) {


    const nextPassNum = (latestDoc.refilterImagePassNumber || 0) + 1;
    const nextFailureCount = normalizeRetryCount(latestDoc.failureRetryCount) + 1;
    const currentFilterRetryCount = normalizeRetryCount(latestDoc.filterRetryCount);
    const nextFilterRetryCount = currentFilterRetryCount + 1;
    const failureMessage = getImageGenerationFailureMessage(imageData);

    if (nextFilterRetryCount >= MAX_IMAGE_GENERATION_FILTER_RETRIES) {
      const terminalFilterPolicy = getTerminalFilterFailurePolicy(
        sessionData?.videoTone || 'default',
        latestDoc || payload,
        sessionData
      );
      if (await processBestFilterPassIfAvailable(
        payload,
        filterPassesForLayer,
        terminalFilterPolicy.fallbackScoreCutoff
      )) {
        return;
      }
    }

    // Optionally cap filter passes to 3 (or whatever you prefer)
    if (
      nextFailureCount < MAX_IMAGE_GENERATION_FAILURES &&
      nextFilterRetryCount < MAX_IMAGE_GENERATION_FILTER_RETRIES
    ) {
      const retryPrompt = latestDoc.originalRetryPrompt || payload.originalRetryPrompt || latestDoc.prompt || payload.prompt;
      if (!retryPrompt) {
        await markImageGenerationRequestFailed(payload, imageData, {
          sessionData,
          failureRetryCount: nextFailureCount,
          message: `${failureMessage} Unable to build refilter retry prompt.`,
          source: 'image_generation_refilter_retry_prompt_missing',
          ...getBranchedTerminalGenerationPruneOptions(sessionData),
        });
        return;
      }

      const currentPrompt = latestDoc.prompt || payload.prompt || '';
      const retryInferenceSettings = await resolveImageInferenceSettings({
        request: latestDoc,
        fallbackRequest: payload,
        session: sessionData,
      });
      const newPrompt = await getAlteredPromptForRetry(
        retryPrompt,
        nextFilterRetryCount,
        failureMessage,
        currentPrompt,
        'generation_failure',
        retryInferenceSettings.model,
        retryInferenceSettings.authorization,
      );
      const adapterRetryState = getImageGenerationAdapterRetryState(
        latestDoc || payload,
        // The provider returned no image, so this is an actual generation
        // failure and may advance to the configured fallback adapter.
        { rotateAdapter: true },
      );

      await recordImageGenerationFailure(payload, {
        imageData,
        message: failureMessage,
        failureRetryCount: nextFailureCount,
        source: isSafetyRejectionMessage(failureMessage)
          ? 'image_generation_refilter_retry_safety'
          : 'image_generation_refilter_retry',
        setFields: {
          rowLocked: false,
          generationStatus: "INIT",
          apiGenerationStatus: "INIT",
          failureRetryCount: nextFailureCount,
          refilterImagePassNumber: nextPassNum,
          filterRetryCount: nextFilterRetryCount,
          prompt: newPrompt,
          nextAttemptAfter: getImageGenerationNextAttemptAfter(nextFailureCount),
          ...adapterRetryState.setFields,
          ...(!latestDoc.originalRetryPrompt ? { originalRetryPrompt: retryPrompt } : {}),
        },
        unsetFields: adapterRetryState.unsetFields,
      });

      await updateLayerPromptForRetry(payload, newPrompt, failureMessage);
      return;
    }
  }


  const { failureRetryCount = 0 } = latestDoc;


  // 2) If batch generation or `retryOnFailure` => attempt a retry if we have not exceeded max
  const refilterRetryLimitReached = inRefilterLoop &&
    normalizeRetryCount(latestDoc.filterRetryCount) >= MAX_IMAGE_GENERATION_FILTER_RETRIES;

  if ((isBatchGeneration || retryOnFailure) && !refilterRetryLimitReached) {


    const scheduledRetry = await scheduleImageGenerationRetry(payload, latestDoc, imageData, {
      terminalOnMaxFailures: false,
      sessionData,
      rotateAdapter: options.rotateAdapter !== false,
    });
    if (scheduledRetry) {
      return; // Return here so we don't remove the doc
    }

    {


      // Attempt to finalize with best pass in filterPasses (if exists)
      const sessionData = await VideoSession.findOne({ _id: videoSessionId });
      if (sessionData) {
        const layerData = sessionData.layers.find(l => l._id.toString() === layerId);
        const terminalFilterPolicy = getTerminalFilterFailurePolicy(
          sessionData?.videoTone || 'default',
          latestDoc || payload,
          sessionData
        );
        if (await processBestFilterPassIfAvailable(
          payload,
          layerData?.filterPasses || [],
          terminalFilterPolicy.fallbackScoreCutoff
        )) {
          return;
        }



        await markImageGenerationRequestFailed(payload, imageData, {
          sessionData,
          failureRetryCount: normalizeRetryCount(failureRetryCount) + 1,
          message: `${getImageGenerationFailureMessage(imageData)} Max image generation failures reached (${MAX_IMAGE_GENERATION_FAILURES}).`,
          ...getBranchedTerminalGenerationPruneOptions(sessionData),
        });


      } else {
        await markImageGenerationRequestFailed(payload, imageData, {
          failureRetryCount: normalizeRetryCount(failureRetryCount) + 1,
          message: 'Video session not found while handling image generation failure.',
        });
      }
    }
  } else {


    // Before removing, check filterPasses as well
    const sessionData = await VideoSession.findOne({ _id: videoSessionId });
    if (sessionData) {
      const layerData = sessionData.layers.find(l => l._id.toString() === layerId);
      const terminalFilterPolicy = getTerminalFilterFailurePolicy(
        sessionData?.videoTone || 'default',
        latestDoc || payload,
        sessionData
      );
      if (await processBestFilterPassIfAvailable(
        payload,
        layerData?.filterPasses || [],
        terminalFilterPolicy.fallbackScoreCutoff
      )) {
        return;
      }
    }

    // If no best pass, proceed to mark as failed
    await markImageGenerationRequestFailed(payload, imageData, {
      sessionData,
      failureRetryCount: normalizeRetryCount(latestDoc.failureRetryCount) + 1,
      message: `${getImageGenerationFailureMessage(imageData)} Max image generation failures reached (${MAX_IMAGE_GENERATION_FAILURES}).`,
      ...getBranchedTerminalGenerationPruneOptions(sessionData),
    });

  }
}

/**
 * Renamed from "processImageFilterFailure" to "processRefilterFailure".
 * Now includes imageDescription, which is also added to filterPasses.
 */
async function processRefilterFailure(imageData, payload, imageScore, imageDescription, options = {}) {
  const {
    videoSessionId,
    layerId,
  } = payload;

  const requestId = payload._id;


  await getDBConnectionString();

  const imageAsset = await persistGenerationImageForSession(imageData.image, videoSessionId);
  const imageURL = imageAsset.relativePath;

  const latestGenerationData = await ImageGeneration.findOne({ _id: requestId });
  if (!latestGenerationData) {
    removeTaskFromQueueById(requestId);
    return;
  }

  const latestFilterRetryCount = normalizeRetryCount(latestGenerationData.filterRetryCount);



  const latestSessionData = await VideoSession.findOne({ _id: videoSessionId });
  if (!latestSessionData) {
    await ImageGeneration.deleteOne({ _id: requestId });
    removeTaskFromQueueById(requestId);
    return;
  }

  const latestLayerData = latestSessionData.layers.find(
    layer => layer._id.toString() === layerId
  );
  const layerDataIndex = latestSessionData.layers.findIndex(
    layer => layer._id.toString() === layerId
  );

  if (!latestLayerData || layerDataIndex === -1) {
    await markImageGenerationRequestFailed(payload, imageData, {
      failureRetryCount: normalizeRetryCount(latestGenerationData.failureRetryCount) + 1,
      message: 'Video session layer not found while handling image filter failure.',
    });
    return;
  }

  let filterPasses = latestLayerData.filterPasses || [];
  filterPasses.push({
    ...(options.filterPassMetadata && typeof options.filterPassMetadata === 'object'
      ? options.filterPassMetadata
      : {}),
    score: imageScore,
    src: imageURL,
    description: imageDescription || ""
  });

  let updateFields = {};
  updateFields[`layers.${layerDataIndex}.filterPasses`] = filterPasses;

  await VideoSession.updateOne(
    { _id: videoSessionId },
    { $set: updateFields }
  );

  const nextFilterRetryCount = latestFilterRetryCount + 1;

  if (nextFilterRetryCount < MAX_IMAGE_GENERATION_FILTER_RETRIES) {

    const failureMessage = options.failureMessage || `Generated image score ${imageScore} was below the acceptance threshold.`;
    const retryPrompt = latestGenerationData.originalRetryPrompt || payload.originalRetryPrompt || latestGenerationData.prompt || payload.prompt;
    const currentPrompt = latestGenerationData.prompt || payload.prompt || '';
    const retryInferenceSettings = await resolveImageInferenceSettings({
      request: latestGenerationData,
      fallbackRequest: payload,
      session: latestSessionData,
    });
    const newPrompt = await getAlteredPromptForRetry(
      retryPrompt,
      nextFilterRetryCount,
      failureMessage,
      currentPrompt,
      'score_threshold',
      retryInferenceSettings.model,
      retryInferenceSettings.authorization,
    );
    const adapterRetryState = getImageGenerationAdapterRetryState(
      latestGenerationData || payload,
      // Scoring succeeded against a generated image. Start the next scoring
      // attempt on the same adapter; a low score is not a provider failure.
      { rotateAdapter: false },
    );

    await recordImageGenerationFailure(payload, {
      message: failureMessage,
      failureRetryCount: normalizeRetryCount(latestGenerationData.failureRetryCount),
      source: options.failureSource || 'image_generation_filter_retry',
      setFields: {
        rowLocked: false,
        generationStatus: "INIT",
        apiGenerationStatus: "INIT",
        prompt: newPrompt,
        filterRetryCount: nextFilterRetryCount,
        ...adapterRetryState.setFields,
        ...(!latestGenerationData.originalRetryPrompt ? { originalRetryPrompt: retryPrompt } : {}),
      },
      unsetFields: adapterRetryState.unsetFields,
    });

    await updateLayerPromptForRetry(payload, newPrompt, failureMessage);



    return { retry: true };
  } else {

    const terminalFilterPolicy = getTerminalFilterFailurePolicy(
      latestSessionData?.videoTone || 'default',
      latestGenerationData || payload,
      latestSessionData
    );
    if (await processBestFilterPassIfAvailable(
      payload,
      filterPasses,
      terminalFilterPolicy.fallbackScoreCutoff
    )) {
      return { retry: false };
    }

    await markImageGenerationRequestFailed(payload, imageData, {
      failureRetryCount: normalizeRetryCount(latestGenerationData.failureRetryCount) + 1,
      message: 'No usable image passed filter scoring and no previous filter pass could be finalized.',
      source: 'image_generation_filter_terminal_failure',
      pruneLayer: terminalFilterPolicy.allowExpressLayerPrune,
      allowExpressImageLayerPrune: terminalFilterPolicy.allowExpressLayerPrune,
    });
    return { retry: false };
  }
}

async function processImageGenerationSuccess(imageData, payload, imageScore) {
  const {
    videoSessionId,
    layerId,
    batchGenerationId,
    isBatchGeneration,

    aspectRatio,
    retryOnFailure,
    prompt,
    imageFilterScoreRequired,
    refilterImageGenerationsRequired,
    refilterImagePassNumber,
    _id,
  } = payload;
  const replaceActiveItemId =
    typeof payload.replaceActiveItemId === "string"
      ? payload.replaceActiveItemId
      : typeof payload.replace_active_item_id === "string"
        ? payload.replace_active_item_id
        : "";
  const appendGeneratedImageCandidate = Boolean(
    payload.appendGeneratedImageCandidate ||
    payload.append_generated_image_candidate ||
    replaceActiveItemId
  );
  const preserveActiveSelectedImage = Boolean(
    payload.preserveActiveSelectedImage ||
    payload.preserve_active_selected_image ||
    appendGeneratedImageCandidate
  );

  await getDBConnectionString();
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
  const imagePlacement = getImagePlacementForCanvas(imageData, canvasDimensions);
  let imageWidth = imagePlacement.sourceWidth;
  let imageHeight = imagePlacement.sourceHeight;

  let sessionDataValue = await VideoSession.findOne({ _id: videoSessionId });
  if (!sessionDataValue) {
    await ImageGeneration.deleteOne({ _id: payload._id });
    removeTaskFromQueueById(payload._id);
    return;
  }

  sessionDataValue = sessionDataValue.toObject();

  const imageAsset = await persistGenerationImageForSession(imageData.image, videoSessionId);
  const imageURL = imageAsset.relativePath;
  const remoteImageUrl = imageAsset.remoteImageUrl;

  const layerDataIndex = sessionDataValue.layers.findIndex(
    layer => layer._id.toString() === layerId
  );

  if (layerDataIndex === -1) {
    await ImageGeneration.deleteOne({ _id: payload._id });
    removeTaskFromQueueById(payload._id);
    return;
  }

  let updateFields = {};
  // If we did filter check and passed, store the score
  const normalizedImageScore = normalizeOptionalScore(imageScore);
  if (imageFilterScoreRequired && normalizedImageScore !== null) {
    updateFields[`layers.${layerDataIndex}.refilterImageScore`] = normalizedImageScore;
  }

  // Keep the selected image and its description aligned, including the empty
  // description case so a newly selected image never inherits stale metadata.
  if (!preserveActiveSelectedImage) {
    const activeImageCandidate = buildActiveImageCandidate({
      src: imageURL,
      remoteSrc: remoteImageUrl,
      description: imageData.description,
      score: imageScore,
    });
    updateFields[`layers.${layerDataIndex}.imageSession.activeImageDescription`] =
      activeImageCandidate.description;
    updateFields[`layers.${layerDataIndex}.activeImageDescription`] =
      activeImageCandidate.description;
    updateFields[`layers.${layerDataIndex}.activeImageCandidate`] = activeImageCandidate;
  }

  // Clear filterPasses on final success
  // updateFields[`layers.${layerDataIndex}.filterPasses`] = [];

  // Normal success
  updateFields[`layers.${layerDataIndex}.imageSession.generationStatus`] = "COMPLETED";
  if (!preserveActiveSelectedImage) {
    updateFields[`layers.${layerDataIndex}.imageSession.activeGeneratedImage`] = imageURL;
    updateFields[`layers.${layerDataIndex}.imageSession.activeSelectedImage`] = remoteImageUrl;
  }
  updateFields[`layers.${layerDataIndex}.imageSession.generationError`] = null;

  let sessionGenerations = sessionDataValue.generations || [];
  if (!sessionGenerations.some((gen) => gen.src === imageURL)) {
    sessionGenerations.push({
      src: imageURL,
      width: imageWidth,
      height: imageHeight,
      description: imageData.description || '',
      score: normalizedImageScore,
      layerId,
    });
  }
  updateFields[`generations`] = sessionGenerations;

  let activeItemList =
    sessionDataValue.layers[layerDataIndex].imageSession.activeItemList || [];
  let shouldRegenerateFrames = !preserveActiveSelectedImage;
  const imageItemFields = {
    ...getImageItemPlacementFields(remoteImageUrl, imagePlacement),
    prompt,
    generationPrompt: prompt,
    description: imageData.description || "",
    createdAt: new Date(),
  };

  if (appendGeneratedImageCandidate) {
    const baseRowIndex = activeItemList.findIndex((item) => item.is_base_image);
    const replacementIndex = replaceActiveItemId
      ? activeItemList.findIndex((item) => item.id === replaceActiveItemId)
      : -1;

    if (baseRowIndex === -1 && replacementIndex === -1) {
      shouldRegenerateFrames = true;
      activeItemList.push({
        type: "image",
        ...imageItemFields,
        id: `item_${activeItemList.length}`,
        is_base_image: true,
      });
    } else if (replacementIndex > -1 && !activeItemList[replacementIndex]?.is_base_image) {
      activeItemList[replacementIndex] = {
        ...activeItemList[replacementIndex],
        ...imageItemFields,
        id: activeItemList[replacementIndex].id,
        is_base_image: false,
      };
    } else {
      activeItemList.push({
        type: "image",
        ...imageItemFields,
        id: `item_${activeItemList.length}`,
        is_base_image: false,
      });
    }
  } else if (payload.isBaseGeneration) {
    const baseRowIndex = activeItemList.findIndex((item) => item.is_base_image);
    if (baseRowIndex > -1) {
      activeItemList[baseRowIndex] = {
        ...activeItemList[baseRowIndex],
        ...imageItemFields
      };
      if (!imagePlacement.preserveOriginalForAiVideo) {
        clearOriginalImagePlacementFields(activeItemList[baseRowIndex]);
      }
    } else {
      const newId = `item_${activeItemList.length}`;
      activeItemList.push({
        type: "image",
        ...imageItemFields,
        id: newId,
        is_base_image: true,
      });
    }
  } else {
    const newId = `item_0`;
    activeItemList = [{
      type: "image",
      ...imageItemFields,
      id: newId,
    }];
  }

  if (isBatchGeneration && batchGenerationId) {
    await updateBatchGenerationRequest(batchGenerationId, layerId, remoteImageUrl);
  }

  updateFields[`layers.${layerDataIndex}.imageSession.activeItemList`] = activeItemList;
  if (shouldRegenerateFrames) {
    updateFields[`layers.${layerDataIndex}.frameGenerationPending`] = true;
    updateFields.frameGenerationPending = true;
  }

  try {
    await VideoSession.updateOne(
      { _id: videoSessionId },
      {
        $set: updateFields,
      }
    );

    if (shouldRegenerateFrames && !payload.isBaseGeneration) {
      const frameGenerationData = new FrameGeneration({
        sessionId: videoSessionId,
        layerId: layerId,
      });
      await frameGenerationData.save({});
    }
  } catch (e) {
    console.error(e);
  }


  // Only final, user-visible results belong in GeneratedImage. The request id
  // is also the record id, so repeated completion delivery cannot add copies.
  await persistFinalGeneratedImageForRequest(payload, {
    url: imageURL,
    description: imageData.description || "",
    prompt: payload.prompt,
    sessionId: videoSessionId,
    userId: sessionDataValue.userId,
    generationType: "generate",
    model: payload.model || null,
    aspectRatio: payload.aspectRatio || sessionDataValue.aspectRatio || null,
  });

  // Remove the request from the queue and DB
  await ImageGeneration.deleteOne({ _id: payload._id });
  removeTaskFromQueueById(payload._id);
}

async function scheduleImageEditAdapterRetry(
  payload = {},
  message = 'Image edit adapter failed',
  { rotateAdapter = true } = {},
) {
  const adapterRetryState = getImageEditAdapterRetryState(
    payload,
    { rotateAdapter },
  );
  if (!adapterRetryState.provider) {
    return false;
  }

  const retryStatus = rotateAdapter ? 'INIT' : 'PENDING';
  const update = {
    $set: {
      ...adapterRetryState.setFields,
      editStatus: retryStatus,
      apiEditStatus: retryStatus,
      generationStatus: retryStatus,
      apiGenerationStatus: retryStatus,
      rowLocked: false,
      errorMessage: null,
      editError: null,
      generationError: null,
    },
  };
  if (rotateAdapter) {
    update.$unset = adapterRetryState.unsetFields;
  }

  await ImageGeneration.updateOne(
    { _id: payload?._id },
    update,
  );

  try {
    await GlobalSession.findOneAndUpdate(
      { sessionId: payload?._id?.toString?.() || payload?._id },
      {
        $set: { status: 'PENDING' },
        $unset: { errorMessage: '' },
      },
    );
  } catch {
  }

  console.warn('[image_edit] scheduling adapter retry', {
    requestId: payload?._id?.toString?.() || payload?._id,
    model: payload?.model || null,
    provider: adapterRetryState.provider,
    rotated: rotateAdapter,
    message,
  });
  return true;
}

async function processUpscaleRequest(pendingRequestData) {
  await getDBConnectionString();

  try {
    const editAlreadyFailed =
      pendingRequestData?.editStatus === 'FAILED' ||
      pendingRequestData?.apiEditStatus === 'FAILED';
    if (editAlreadyFailed) {
      if (await scheduleImageEditAdapterRetry(
        pendingRequestData,
        pendingRequestData?.errorMessage || pendingRequestData?.editError,
      )) {
        return;
      }
      await finalizeUpscaleFailure(
        pendingRequestData,
        pendingRequestData?.errorMessage || pendingRequestData?.editError || 'Image enhancement failed'
      );
      return;
    }

    const sourceImageRef = getImageReferenceFromRequest(pendingRequestData);

    const skipEnhancement =
      pendingRequestData?.skipEnhancement === true ||
      pendingRequestData?.skip_enhancement === true;

    if (!sourceImageRef) {
      await finalizeUpscaleFailure(pendingRequestData, 'Missing source image for upscale request');
      return;
    }

    if (skipEnhancement) {
      await finalizeUpscaleSuccess(pendingRequestData, sourceImageRef);
      return;
    }

    const aspectRatio = pendingRequestData.aspectRatio || '1:1';
    let shouldEnhance = true;
    try {
      shouldEnhance = await needsImageEnhancement(sourceImageRef, aspectRatio);
    } catch (err) {
      shouldEnhance = true;
    }


    if (!shouldEnhance) {
      await finalizeUpscaleSuccess(pendingRequestData, sourceImageRef);
      return;
    }

    const enhanceModel = resolveNanoBananaEnhanceEditModel(pendingRequestData.model);
    const enhanceCaseType = 'enhance_image';
    const imageUrls = sourceImageRef ? [sourceImageRef] : [];
    const apiEditStatus = pendingRequestData.apiEditStatus || 'INIT';
    const selectedAdapterProvider = resolveImageEditProviderForModel(
      enhanceModel,
      pendingRequestData,
    );

    const editPayload = {
      ...(pendingRequestData.toObject ? pendingRequestData.toObject() : pendingRequestData),
      case_type: enhanceCaseType,
      apiEditStatus,
      model: enhanceModel,
      resolution: pendingRequestData.resolution || '1k',
      image: sourceImageRef,
      image_urls: imageUrls,
      ...(selectedAdapterProvider
        ? {
          submittedAdapter: selectedAdapterProvider,
          adapterProvider: selectedAdapterProvider,
          adapterProviderOverride: selectedAdapterProvider,
          deferAdapterFailureFinalization: true,
        }
        : {}),
    };

    const enhanceUpdates = {};
    if (!pendingRequestData.case_type || pendingRequestData.case_type !== enhanceCaseType) {
      enhanceUpdates.case_type = enhanceCaseType;
    }
    if (pendingRequestData.model !== enhanceModel) {
      enhanceUpdates.model = enhanceModel;
    }
    if (sourceImageRef && pendingRequestData.image !== sourceImageRef) {
      enhanceUpdates.image = sourceImageRef;
    }
    if (imageUrls.length) {
      enhanceUpdates.image_urls = imageUrls;
    }
    if (!pendingRequestData.apiEditStatus) {
      enhanceUpdates.apiEditStatus = apiEditStatus;
    }
    if (!pendingRequestData.editStatus) {
      enhanceUpdates.editStatus = 'INIT';
    }
    if (
      normalizeString(apiEditStatus).toUpperCase() === 'INIT' &&
      selectedAdapterProvider &&
      normalizeAdapterProvider(pendingRequestData.submittedAdapter) !== selectedAdapterProvider
    ) {
      enhanceUpdates.submittedAdapter = selectedAdapterProvider;
    }
    if (
      selectedAdapterProvider &&
      normalizeAdapterProvider(pendingRequestData.adapterProvider) !== selectedAdapterProvider
    ) {
      enhanceUpdates.adapterProvider = selectedAdapterProvider;
      enhanceUpdates.adapterProviderOverride = selectedAdapterProvider;
    }

    if (Object.keys(enhanceUpdates).length > 0) {
      await ImageGeneration.updateOne(
        { _id: pendingRequestData._id },
        { $set: enhanceUpdates }
      );
    }

    const editedImageData = await getEditImageFromText(editPayload);


    if (!editedImageData) {
      const latestRequest = await ImageGeneration.findById(pendingRequestData._id).lean();
      const providerMarkedFailed =
        latestRequest?.editStatus === 'FAILED' ||
        latestRequest?.apiEditStatus === 'FAILED';
      if (providerMarkedFailed) {
        await scheduleImageEditAdapterRetry(
          editPayload,
          latestRequest?.errorMessage || latestRequest?.editError || 'Image enhancement adapter failed',
          { rotateAdapter: apiEditStatus !== 'PENDING' },
        );
      }
      return;
    }

    const firstResultUrl = Array.isArray(editedImageData?.resultUrls) ? editedImageData.resultUrls[0] : null;
    const firstImageEntry = Array.isArray(editedImageData?.images) ? editedImageData.images[0] : null;
    const firstImageRef = typeof firstImageEntry === 'string' ? firstImageEntry : firstImageEntry?.url;

    const resolvedEditImageRef =
      editedImageData.resultUrl ||
      firstResultUrl ||
      editedImageData.image ||
      firstImageRef;

    if (resolvedEditImageRef) {
      await finalizeUpscaleSuccess(pendingRequestData, resolvedEditImageRef);
    } else if (editedImageData.error) {
      const rotateAdapter =
        apiEditStatus !== 'PENDING' ||
        editedImageData.definitiveAdapterFailure === true;
      if (await scheduleImageEditAdapterRetry(
        editPayload,
        editedImageData.error,
        { rotateAdapter },
      )) {
        return;
      }
      await finalizeUpscaleFailure(pendingRequestData, editedImageData.error);
    } else {
      await finalizeUpscaleFailure(pendingRequestData, 'Upscale enhancement completed without an image result');
    }
  } catch (error) {
    if (await scheduleImageEditAdapterRetry(
      pendingRequestData,
      error?.message || 'Upscale request failed',
      {
        rotateAdapter:
          normalizeString(pendingRequestData?.apiEditStatus).toUpperCase() !== 'PENDING',
      },
    )) {
      return;
    }
    await finalizeUpscaleFailure(pendingRequestData, error?.message || 'Upscale request failed');
  }
}

async function finalizeUpscaleSuccess(payload, imageReference) {
  const requestId = payload._id;
  const sessionId = payload.sessionId || payload.videoSessionId;


  if (!sessionId) {
    await finalizeUpscaleFailure(payload, 'Missing video session context for upscale request');
    return;
  }

  const sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  if (!sessionDataValue) {
    await finalizeUpscaleFailure(payload, 'Video session missing for upscale request');
    return;
  }

  const layerIndex = sessionDataValue.layers.findIndex(
    (layer) => layer._id.toString() === payload.layerId
  );
  if (layerIndex === -1) {
    await ImageGeneration.deleteOne({ _id: requestId });
    removeTaskFromQueueById(requestId);
    return;
  }

  const aspectRatio = payload.aspectRatio || sessionDataValue.aspectRatio || '1:1';
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
  const imageWidth = canvasDimensions.width;
  const imageHeight = canvasDimensions.height;

  const localRelativeImagePath = await persistImageToLocalAssets(imageReference, {
    forceNewName: true,
    preferredExtension: 'png',
    convertToPng: true,
  });
  const imageAsset = await persistGenerationImageForSession(localRelativeImagePath, sessionId);
  const normalizedLocalImageSrc = imageAsset.relativePath || (localRelativeImagePath || '').replace(/^[\\/]+/, '');
  if (!normalizedLocalImageSrc) {
    await finalizeUpscaleFailure(payload, 'Unable to persist upscale image locally');
    return;
  }
  const selectedImageSrc = imageAsset.remoteImageUrl || (normalizedLocalImageSrc.startsWith('/')
    ? normalizedLocalImageSrc
    : `/${normalizedLocalImageSrc}`);
  const persistedImageName = normalizedLocalImageSrc;
  if (!persistedImageName) {
    await finalizeUpscaleFailure(payload, 'Unable to resolve upscale image reference');
    return;
  }

  const updateFields = {};
  updateFields[`layers.${layerIndex}.imageSession.editStatus`] = "COMPLETED";
  updateFields[`layers.${layerIndex}.imageSession.generationStatus`] = "COMPLETED";
  updateFields[`layers.${layerIndex}.imageSession.activeEditedImage`] = selectedImageSrc;
  updateFields[`layers.${layerIndex}.imageSession.activeSelectedImage`] = selectedImageSrc;
  updateFields[`layers.${layerIndex}.imageSession.editError`] = null;

  let sessionGenerations = sessionDataValue.generations || [];
  if (!sessionGenerations.some((gen) => gen.src === persistedImageName)) {
    sessionGenerations.push({
      src: persistedImageName,
      width: imageWidth,
      height: imageHeight,
    });
  }
  updateFields[`generations`] = sessionGenerations;

  let activeItemList = sessionDataValue.layers[layerIndex].imageSession.activeItemList || [];
  const previousActiveItemList =
    sessionDataValue.layers[layerIndex].imageSession.previousActiveItemList || [];

  if (payload.isBaseGeneration) {
    const baseRowIndex = activeItemList.findIndex((item) => item.is_base_image);
    if (baseRowIndex > -1) {
      const baseItem = activeItemList[baseRowIndex]?.toObject
        ? activeItemList[baseRowIndex].toObject()
        : { ...activeItemList[baseRowIndex] };
      activeItemList[baseRowIndex] = {
        ...baseItem,
        src: normalizedLocalImageSrc,
        image: selectedImageSrc,
        width: imageWidth,
        height: imageHeight,
      };
    } else {
      const newId = `item_${activeItemList.length}`;
      activeItemList.push({
        type: "image",
        src: normalizedLocalImageSrc,
        image: selectedImageSrc,
        x: 0,
        y: 0,
        width: imageWidth,
        height: imageHeight,
        id: newId,
        is_base_image: true,
      });
    }
  } else {
    const newId = `item_${activeItemList.length}`;
    activeItemList.push({
      type: "image",
      src: normalizedLocalImageSrc,
      image: selectedImageSrc,
      x: 0,
      y: 0,
      width: imageWidth,
      height: imageHeight,
      id: newId,
    });
  }

  updateFields[`layers.${layerIndex}.imageSession.activeItemList`] = activeItemList.map((item) =>
    item?.toObject ? item.toObject() : item
  );
  updateFields[`layers.${layerIndex}.imageSession.previousActiveItemList`] = previousActiveItemList;
  updateFields.frameGenerationPending = true;
  updateFields[`layers.${layerIndex}.frameGenerationPending`] = true;

  try {
    await VideoSession.updateOne(
      { _id: sessionId },
      { $set: updateFields }
    );

    if (!payload.isBaseGeneration) {
      const frameGenerationData = new FrameGeneration({
        sessionId,
        layerId: payload.layerId,
      });
      await frameGenerationData.save({});
    }
  } catch (error) {
    console.error(error);
  }

  if (payload.isBatchGeneration && payload.batchGenerationId) {
    await updateBatchGenerationRequest(payload.batchGenerationId, payload.layerId, selectedImageSrc);
  }

  try {
    await persistFinalGeneratedImageForRequest(payload, {
      url: persistedImageName,
      description: '',
      prompt: payload.prompt || '',
      sessionId,
      userId: sessionDataValue.userId,
      generationType: 'upscale',
      model: payload.model || null,
      aspectRatio: aspectRatio || sessionDataValue.aspectRatio || null,
    });
  } catch (error) {
    console.error(error);
  }

  try {
    await ImageGeneration.deleteOne({ _id: requestId });
  } catch (error) {
    console.error(error);
    await ImageGeneration.updateOne(
      { _id: requestId },
      {
        editStatus: "COMPLETED",
        apiEditStatus: "COMPLETED",
        generationStatus: "COMPLETED",
        apiGenerationStatus: "COMPLETED",
        rowLocked: false,
      }
    );
  }

  removeTaskFromQueueById(requestId);
}

async function finalizeUpscaleFailure(payload, errorMessage = 'Upscale request failed') {
  const requestId = payload._id;
  const sessionId = payload.sessionId || payload.videoSessionId;

  const normalizedMessage = errorMessage || 'Upscale request failed';

  if (!sessionId) {
    await ImageGeneration.updateOne(
      { _id: requestId },
      {
        editStatus: "FAILED",
        apiEditStatus: "FAILED",
        generationStatus: "FAILED",
        apiGenerationStatus: "FAILED",
        rowLocked: false,
      }
    );
    removeTaskFromQueueById(requestId);
    return;
  }

  const sessionDataValue = await VideoSession.findOne({ _id: sessionId });
  if (!sessionDataValue) {
    await ImageGeneration.updateOne(
      { _id: requestId },
      {
        editStatus: "FAILED",
        apiEditStatus: "FAILED",
        generationStatus: "FAILED",
        apiGenerationStatus: "FAILED",
        rowLocked: false,
      }
    );
    removeTaskFromQueueById(requestId);
    return;
  }

  const layerIndex = sessionDataValue.layers.findIndex(
    (layer) => layer._id.toString() === payload.layerId
  );

  if (layerIndex === -1) {
    await ImageGeneration.updateOne(
      { _id: requestId },
      {
        editStatus: "FAILED",
        apiEditStatus: "FAILED",
        generationStatus: "FAILED",
        apiGenerationStatus: "FAILED",
        rowLocked: false,
      }
    );
    removeTaskFromQueueById(requestId);
    return;
  }

  const expressFailureUpdate = getExpressImageFailureUpdate(sessionDataValue, normalizedMessage);

  const updateFields = {
    [`layers.${layerIndex}.imageSession.editStatus`]: "FAILED",
    [`layers.${layerIndex}.imageSession.generationStatus`]: "COMPLETED",
    [`layers.${layerIndex}.imageSession.editError`]: normalizedMessage,
    ...expressFailureUpdate,
  };

  await VideoSession.updateOne(
    { _id: sessionId },
    {
      $set: updateFields,
    }
  );

  await ImageGeneration.updateOne(
    { _id: requestId },
    {
      editStatus: "FAILED",
      apiEditStatus: "FAILED",
      generationStatus: "FAILED",
      apiGenerationStatus: "FAILED",
      rowLocked: false,
    }
  );

  removeTaskFromQueueById(requestId);
}

async function processEditRequest(pendingRequestData) {
  await getDBConnectionString();
  const requestId = pendingRequestData._id;


  try {
    let genRowValue = await ImageGeneration.findOne({ _id: requestId });
    if (!genRowValue) {
      // If already gone, also remove from the queue
      removeTaskFromQueueById(requestId);
      return;
    }

    const selectedAdapterProvider = resolveImageEditProviderForModel(
      pendingRequestData.model,
      pendingRequestData,
    );
    if (
      normalizeString(pendingRequestData?.apiEditStatus || 'INIT').toUpperCase() === 'INIT' &&
      selectedAdapterProvider &&
      normalizeAdapterProvider(pendingRequestData?.submittedAdapter) !== selectedAdapterProvider
    ) {
      pendingRequestData.submittedAdapter = selectedAdapterProvider;
      await ImageGeneration.updateOne(
        { _id: requestId },
        { $set: { submittedAdapter: selectedAdapterProvider } },
      );
    }
    const editRequestPayload = selectedAdapterProvider
      ? {
        ...(pendingRequestData.toObject
          ? pendingRequestData.toObject()
          : pendingRequestData),
        adapterProvider: selectedAdapterProvider,
        adapterProviderOverride: selectedAdapterProvider,
        deferAdapterFailureFinalization: true,
      }
      : pendingRequestData;
    const editedImageData = await getEditImageFromText(editRequestPayload);

    if (!editedImageData) {
      const latestRequest = await ImageGeneration.findById(requestId).lean();
      const providerMarkedFailed =
        latestRequest?.editStatus === 'FAILED' ||
        latestRequest?.apiEditStatus === 'FAILED';
      if (providerMarkedFailed) {
        await scheduleImageEditAdapterRetry(
          editRequestPayload,
          latestRequest?.errorMessage || latestRequest?.editError || 'Image edit adapter failed',
          {
            rotateAdapter:
              normalizeString(pendingRequestData?.apiEditStatus).toUpperCase() !== 'PENDING',
          },
        );
      }
      return;
    }

    if (editedImageData && editedImageData.image) {
      // Standalone API edits (no session/layer) should bypass video session updates
      if (!genRowValue.sessionId && !genRowValue.videoSessionId && !genRowValue.layerId) {
        await markStandaloneEditAsCompleted(genRowValue, editedImageData);
      } else {
        await markEditImageAsCompleted(genRowValue, editedImageData);
      }
    } else if (editedImageData && editedImageData.error) {
      const rotateAdapter =
        normalizeString(pendingRequestData?.apiEditStatus).toUpperCase() !== 'PENDING' ||
        editedImageData.definitiveAdapterFailure === true;
      if (await scheduleImageEditAdapterRetry(
        editRequestPayload,
        editedImageData.error,
        { rotateAdapter },
      )) {
        return;
      }
      // If edit returned no image, handle similar retry logic if needed
      // (or finalize as your use case demands)
      if (genRowValue.isBatchGeneration) {
        if (genRowValue.failureRetryCount < 5) {
          const retryPrompt = genRowValue.originalRetryPrompt || genRowValue.prompt;
          const retryInferenceSettings = await resolveImageInferenceSettings({
            request: genRowValue,
            fallbackRequest: pendingRequestData,
          });
          const newPrompt = await getAlternatePromptFromPrompt(
            retryPrompt,
            genRowValue.failureRetryCount,
            editedImageData.error || '',
            'generation_failure',
            retryInferenceSettings.model,
            retryInferenceSettings.authorization,
          );
          await ImageGeneration.updateOne(
            { _id: requestId },
            {
              prompt: newPrompt,
              ...(!genRowValue.originalRetryPrompt ? { originalRetryPrompt: retryPrompt } : {}),
              rowLocked: false,
              $inc: { failureRetryCount: 1 },
            }
          );
        } else {
          await ImageGeneration.updateOne(
            { _id: requestId },
            {
              editStatus: "FAILED",
              apiEditStatus: "FAILED",
              generationStatus: "FAILED",
              apiGenerationStatus: "FAILED",
              rowLocked: false
            }
          );
          removeTaskFromQueueById(requestId);
        }
      } else {
        await ImageGeneration.updateOne(
          { _id: requestId },
          {
            editStatus: "FAILED",
            apiEditStatus: "FAILED",
            generationStatus: "FAILED",
            apiGenerationStatus: "FAILED",
            rowLocked: false
          }
        );
        removeTaskFromQueueById(requestId);
      }
    }
  } catch (e) {
    if (await scheduleImageEditAdapterRetry(
      pendingRequestData,
      e?.message || 'Image edit adapter failed',
      {
        rotateAdapter:
          normalizeString(pendingRequestData?.apiEditStatus).toUpperCase() !== 'PENDING',
      },
    )) {
      return;
    }
    console.error(e);
  }
}

async function markEditImageAsCompleted(genRowValue, editedImageData) {
  const {
    layerId,
    sessionId,
    isBatchGeneration,
    batchGenerationId,
    isBaseGeneration,
    aspectRatio,
    _id: requestId
  } = genRowValue;

  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
  const imageWidth = canvasDimensions.width;
  const imageHeight = canvasDimensions.height;

  let sessionDataValue;
  try {
    sessionDataValue = await VideoSession.findOne({ _id: sessionId });
    if (!sessionDataValue) {
      throw new Error('VideoSession not found');
    }
  } catch (err) {
    console.error(`Error fetching VideoSession ${sessionId}:`, err);
    await markGlobalSessionFailed(sessionId, 'Video session not found for edit request');
    await ImageGeneration.updateOne(
      { _id: requestId },
      {
        editStatus: "FAILED",
        apiEditStatus: "FAILED",
        generationStatus: "FAILED",
        apiGenerationStatus: "FAILED",
        rowLocked: false
      }
    );
    removeTaskFromQueueById(requestId);
    return;
  }

  let layerDataIndex = sessionDataValue.layers.findIndex(layer => layer._id.toString() === layerId);
  if (layerDataIndex === -1) {
    await ImageGeneration.deleteOne({ _id: requestId });
    removeTaskFromQueueById(requestId);
    return;
  }

  let updateFields = {};

  // We got a successful edited image
  if (editedImageData.image) {
    const editedImageURL = editedImageData.image;
    const persistedImagePath = await persistImageToLocalAssets(editedImageURL);
    const imageAsset = await persistGenerationImageForSession(persistedImagePath || editedImageURL, sessionId);
    const imageName = imageAsset.imageName;
    const remoteImageUrl = imageAsset.remoteImageUrl
      || getRemoteImageUrlFromReference(persistedImagePath || editedImageURL)
      || (imageName ? `/generations/${imageName}` : null);
    const normalizedLocalImageSrc = imageAsset.relativePath || (persistedImagePath || remoteImageUrl || '').replace(/^[\\/]+/, '');
    const selectedImageSrc = remoteImageUrl || (normalizedLocalImageSrc ? `/${normalizedLocalImageSrc}` : null);
    const activeImageSrc = normalizedLocalImageSrc || (selectedImageSrc ? selectedImageSrc.replace(/^[\\/]+/, '') : null);

    if (!selectedImageSrc || !activeImageSrc) {
      await markGlobalSessionFailed(sessionId, 'Edited image missing for completion');
      await ImageGeneration.deleteOne({ _id: requestId });
      removeTaskFromQueueById(requestId);
      return;
    }

    updateFields[`layers.${layerDataIndex}.imageSession.editStatus`] = "COMPLETED";
    updateFields[`layers.${layerDataIndex}.imageSession.generationStatus`] = "COMPLETED";
    updateFields[`layers.${layerDataIndex}.imageSession.activeEditedImage`] = selectedImageSrc;
    updateFields[`layers.${layerDataIndex}.imageSession.activeSelectedImage`] = selectedImageSrc;
    updateFields[`layers.${layerDataIndex}.imageSession.editError`] = null;
    updateFields[`layers.${layerDataIndex}.imageSession.generationError`] = null;

    let sessionGenerations = sessionDataValue.generations || [];
    const generationSrc = normalizedLocalImageSrc || imageName || editedImageURL;
    if (generationSrc && !sessionGenerations.some(gen => gen.src === generationSrc)) {
      sessionGenerations.push({
        src: generationSrc,
        width: imageWidth,
        height: imageHeight
      });
    }
    updateFields[`generations`] = sessionGenerations;

    let activeItemList = sessionDataValue.layers[layerDataIndex].imageSession.activeItemList || [];
    let previousActiveItemList = sessionDataValue.layers[layerDataIndex].imageSession.previousActiveItemList || [];
    if (isBaseGeneration) {
      let baseRow = activeItemList.find(item => item.is_base_image);
      if (baseRow) {
        baseRow.src = activeImageSrc;
        baseRow.width = imageWidth;
        baseRow.height = imageHeight;
      } else {

        const newId = `item_0`;
        activeItemList = [{
          type: 'image',
          src: activeImageSrc,
          x: 0,
          y: 0,
          width: imageWidth,
          height: imageHeight,
          id: newId,
          'is_base_image': true
        }];

      }
      updateFields[`layers.${layerDataIndex}.imageSession.activeItemList`] = activeItemList;
    } else {
      const newId = `item_0`;
      activeItemList = [{
        type: 'image',
        src: activeImageSrc,
        x: 0,
        y: 0,
        width: imageWidth,
        height: imageHeight,
        id: newId
      }];

      updateFields[`layers.${layerDataIndex}.imageSession.activeItemList`] = activeItemList;
    }

    updateFields[`layers.${layerDataIndex}.imageSession.previousActiveItemList`] = previousActiveItemList;

    if (isBatchGeneration && batchGenerationId && selectedImageSrc) {
      await updateBatchGenerationRequest(batchGenerationId, layerId, selectedImageSrc);
    }

    updateFields.frameGenerationPending = true;
    updateFields[`layers.${layerDataIndex}.frameGenerationPending`] = true;

    let layerUpdated = false;
    try {
      await VideoSession.updateOne(
        { _id: sessionDataValue._id },
        {
          $set: updateFields
        }
      );

      // Create the frame generation doc if not base generation
      if (!isBaseGeneration) {
        const frameGenerationData = new FrameGeneration({
          sessionId: sessionDataValue._id,
          layerId: layerId
        });
        await frameGenerationData.save({});
      }
      layerUpdated = true;
    } catch (e) {
      console.error(e);
    }

    // Save an entry in GeneratedImage if we got a valid edit
    if (layerUpdated && generationSrc) {
      const generatedImagePayload = {
        url: generationSrc,
        description: '',
        prompt: genRowValue.prompt,
        sessionId: sessionDataValue._id.toString(),
        userId: sessionDataValue.userId,
        generationType: 'edit',
        model: genRowValue.model || null,
        aspectRatio: genRowValue.aspectRatio || sessionDataValue.aspectRatio || null,
      };
      try {
        await persistFinalGeneratedImageForRequest(genRowValue, generatedImagePayload);
      } catch (e) {
        console.error(e);
      }
    }

    if (layerUpdated) {
      await ImageGeneration.deleteOne({ _id: requestId });
    } else {
      await ImageGeneration.updateOne({ _id: requestId }, { rowLocked: false });
    }
    removeTaskFromQueueById(requestId);
    return;
  } else {
    const errorMessage = editedImageData.error;
    updateFields[`layers.${layerDataIndex}.imageSession.editStatus`] = "FAILED";
    updateFields[`layers.${layerDataIndex}.imageSession.generationStatus`] = "COMPLETED";
    updateFields[`layers.${layerDataIndex}.imageSession.editError`] = errorMessage;

  }

  updateFields.frameGenerationPending = true;

  try {
    await VideoSession.updateOne(
      { _id: sessionDataValue._id },
      {
        $set: updateFields
      }
    );

    // Create the frame generation doc if not base generation
    if (!isBaseGeneration && editedImageData?.image) {
      const frameGenerationData = new FrameGeneration({
        sessionId: sessionDataValue._id,
        layerId: layerId
      });
      await frameGenerationData.save({});
    }
  } catch (e) {
    console.error(e);
  }

  // Mark the image generation record as failed and unlock it
  await ImageGeneration.updateOne(
    { _id: requestId },
    {
      editStatus: "FAILED",
      apiEditStatus: "FAILED",
      generationStatus: "FAILED",
      apiGenerationStatus: "FAILED",
      rowLocked: false
    }
  );
  removeTaskFromQueueById(requestId);
}

async function markStandaloneEditAsCompleted(genRowValue, editedImageData) {
  const { _id: requestId } = genRowValue;

  const remoteImageUrl = await resolveStandaloneGenerationResultUrl(
    editedImageData,
    genRowValue,
  );
  const completionUpdate = {
    editStatus: "COMPLETED",
    apiEditStatus: "COMPLETED",
    generationStatus: "COMPLETED",
    apiGenerationStatus: "COMPLETED",
    resultUrl: remoteImageUrl,
    rowLocked: false,
  };
  if (isGenBlazeImageCompletion(genRowValue)) {
    completionUpdate.resultUrls = remoteImageUrl ? [remoteImageUrl] : [];
  }

  await ImageGeneration.updateOne(
    { _id: requestId },
    completionUpdate,
  );

  removeTaskFromQueueById(requestId);
}

async function markStandaloneGenerationAsCompleted(payload, imageData) {
  const { _id: requestId } = payload;
  const imageName = imageData?.image;
  const resultUrl = await resolveStandaloneGenerationResultUrl(imageData, payload);

  await ImageGeneration.updateOne(
    { _id: requestId },
    {
      generationStatus: "COMPLETED",
      apiGenerationStatus: "COMPLETED",
      resultUrl,
      resultUrls: resultUrl ? [resultUrl] : [],
      rowLocked: false,
    }
  );

  await GlobalSession.findOneAndUpdate(
    { sessionId: requestId?.toString?.() || requestId },
    {
      $set: {
        sessionId: requestId?.toString?.() || requestId,
        sessionType: 'image',
        requestId: requestId?.toString?.() || requestId,
        provider: payload?.model || null,
        status: 'COMPLETED',
        resultUrl,
        resultUrls: resultUrl ? [resultUrl] : [],
        userId: payload?.userId?.toString?.() || payload?.userId || null,
      },
    },
    { upsert: true }
  );

  try {
    await persistFinalGeneratedImageForRequest(payload, {
      url: resultUrl || (imageName ? `/generations/${imageName}` : ''),
      description: imageData?.description || "",
      prompt: payload?.prompt || "",
      sessionId: requestId,
      userId: payload?.userId,
      generationType: "generate",
      model: payload?.model || null,
      aspectRatio: payload?.aspectRatio || null,
    });
  } catch (error) {
    console.error(error);
  }

  removeTaskFromQueueById(requestId);
}

function isGenBlazeImageCompletion(payload = {}) {
  const provider = normalizeAdapterProvider(
    payload?.adapterProviderOverride || payload?.adapterProvider || payload?.externalProvider,
  );
  if (provider === DOCKER_ADAPTER_PROVIDER.GMICLOUD) {
    return true;
  }
  const requestId = normalizeString(payload?.apiRequestId).toLowerCase();
  return requestId.startsWith('genblaze-image:') ||
    requestId.startsWith('genblaze-image-edit:');
}

async function resolveStandaloneGenerationResultUrl(imageData, payload = {}, dependencies = {}) {
  const firstResultUrl = Array.isArray(imageData?.resultUrls) ? imageData.resultUrls[0] : null;
  if (!isGenBlazeImageCompletion(payload) && (imageData?.resultUrl || firstResultUrl)) {
    return imageData.resultUrl || firstResultUrl;
  }

  const imageName = imageData?.image;
  if (!imageName) {
    return null;
  }

  const remotePath = `generations/${imageName}`;
  const resolveAssetsRoot = dependencies.getAssetsRoot || getProcessorAssetsRoot;
  const uploadImage = dependencies.uploadImage || uploadImageToCDN;
  const absolutePath = path.join(resolveAssetsRoot('assets'), 'generations', imageName);
  try {
    const cdnUrl = await uploadImage(absolutePath, remotePath);
    if (cdnUrl) {
      return cdnUrl;
    }
  } catch (error) {
    console.error('[image_generation] standalone CDN upload failed', {
      imageName,
      message: error?.message || String(error),
    });
  }

  return `/${remotePath}`;
}

async function getTimeout(timeout = 1000) {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, timeout);
  });
}

async function markGlobalSessionFailed(sessionId, message) {
  try {
    await GlobalSession.findOneAndUpdate(
      { sessionId: sessionId?.toString() },
      { $set: {
        sessionId: sessionId?.toString(),
        sessionType: 'image',
        status: 'FAILED',
        errorMessage: message || 'Video session missing for edit request',
      }},
      { upsert: true }
    );
  } catch (err) {
    console.error('Error marking GlobalSession as failed:', err);
  }
}

export const __testOnly__ = {
  buildImageThemeScoringContext,
  buildImageThemeScoringContextDetails,
  buildImageThemeScoringContextForPayload,
  buildImageThemeScoringContextDetailsForPayload,
  getBestFilterPass,
  buildActiveImageCandidate,
  normalizeOptionalScore,
  isSafetyRejectionMessage,
  getImageGenerationRetryDelayMs,
  getImageGenerationNextAttemptAfter,
  buildPendingImageGenerationEligibilityFilter,
  claimPendingImageGenerationRequest,
  persistFinalGeneratedImageForRequest,
  getPinnedImageAdapterProvider,
  getImageGenerationAdapterRetryState,
  isImageGenerationProviderApplicable,
  resolveNextApplicableImageGenerationProvider,
  getPinnedImageEditAdapterProvider,
  getImageEditAdapterRetryState,
  resolveImageEditProviderForModel,
  resolveImageProviderForModel,
  isGenBlazeImageCompletion,
  resolveStandaloneGenerationResultUrl,
  shouldRetryUnhandledGenerationTask,
  getImageFilterScoreCutoff,
  getScoreThresholdCutoff,
  getTerminalFilterFailurePolicy,
  hasReachedScoreOnlyFilterRelaxation,
  buildExpressLayerPrunePlan,
  clampAudioLayersToTimeline,
  reflowLayersAndConnectedAudio,
};
