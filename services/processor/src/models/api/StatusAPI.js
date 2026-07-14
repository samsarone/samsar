import VideoSession from '../../schema/VideoSession.js';
import GeneratedImage from '../../schema/generations/GeneratedImage.js';
import { buildSecureMediaDeliveryUrl } from '../AWS.js';
import { resolveDockerLocalPublicAssetBaseUrl } from '../../consts/DockerDeploymentUrls.js';

const DEFAULT_STATIC_ASSET_BASE_URL = 'https://static.samsar.one';
const USER_RESOURCES_PREFIX = 'user_resources/';
const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');

export const VIDEO_STATUS_SESSION_PROJECTION = [
  'remoteURL',
  'videoLink',
  'expressGenerationStatus',
  'expressGenerationCreditCharges',
  'expressGenerationError',
  'expressGenerationFailed',
  'expressGenerationPending',
  'expressGenerationPaused',
  'expressGenerationCancelled',
  'videoGenerationPending',
  'expressGenerativeVideoModel',
  'expressGenerativeVideoModelSubType',
  'videoGenerationModelSubType',
  'enableSubtitles',
  'hasSubtitles',
  'has_subtitles',
  'subtitleLanguage',
  'subtitleLanguageString',
  'subtitleLanguageExplicit',
  'subtitleTranslationRequired',
  'sessionLanguage',
  'language',
  'language_code',
  'langauge',
  'languageString',
  'addFooterAnimation',
  'footerMetadata',
  'footerLogoImagePath',
  'footerCtaText',
  'footerCtaUrl',
  'footerCtaLogo',
  'layers.addFooterAnimation',
  'layers.footerMetadata',
  'layers.footerLogoImagePath',
  'layers.footer_logo_image_path',
].join(' ');

export const VIDEO_STATUS_DETAILED_SESSION_PROJECTION = [
  'remoteURL',
  'videoLink',
  'expressGenerationStatus',
  'expressGenerationCreditCharges',
  'expressGenerationError',
  'expressGenerationFailed',
  'expressGenerationPending',
  'expressGenerationPaused',
  'expressGenerationPausedAt',
  'expressGenerationResumedAt',
  'expressGenerationCancelled',
  'videoGenerationPending',
  'expressGenerativeVideoModel',
  'expressGenerativeVideoModelSubType',
  'videoGenerationModelSubType',
  'enableSubtitles',
  'hasSubtitles',
  'has_subtitles',
  'subtitleLanguage',
  'subtitleLanguageString',
  'subtitleLanguageExplicit',
  'subtitleTranslationRequired',
  'sessionLanguage',
  'language',
  'language_code',
  'langauge',
  'languageString',
  'addFooterAnimation',
  'footerMetadata',
  'footerLogoImagePath',
  'footerCtaText',
  'footerCtaUrl',
  'footerCtaLogo',
  'aspectRatio',
  'framesPerSecond',
  'totalDuration',
  'inputPrompt',
  'expressInputPrompt',
  'expressGenerationType',
  'isExpressGeneration',
  'isStepVideoGeneration',
  'expressStepGeneration',
  'createdAt',
  'updatedAt',
  'generations',
  'layers._id',
  'layers.prompt',
  'layers.videoGenerationPrompt',
  'layers.status',
  'layers.duration',
  'layers.durationOffset',
  'layers.addFooterAnimation',
  'layers.footerMetadata',
  'layers.footerLogoImagePath',
  'layers.footer_logo_image_path',
  'layers.imageSession.generationStatus',
  'layers.imageSession.editStatus',
  'layers.imageSession.activeSelectedImage',
  'layers.imageSession.activeGeneratedImage',
  'layers.imageSession.activeEditedImage',
  'layers.imageSession.activeImageRemoteLink',
  'layers.imageSession.activeImageDescription',
  'layers.imageSession.prompt',
  'layers.imageSession.activeItemList',
  'layers.filterPasses',
  'layers.refilterImageScore',
  'layers.aiVideoGenerationStatus',
  'layers.aiVideoRemoteLink',
  'layers.aiVideoLayer',
  'layers.hasAiVideoLayer',
  'layers.aiLayerStartFrame',
  'layers.aiLayerEndFrame',
  'layers.baseLayerStartFrame',
  'layers.baseLayerEndFrame',
  'layers.aiVideoThumbnailPath',
  'layers.thumbnailPath',
  'layers.lipSyncVideoGenerationStatus',
  'layers.lipSyncRemoteLink',
  'layers.lipSyncVideoLayer',
  'layers.hasLipSyncVideoLayer',
  'layers.lipSyncThumbnailPath',
  'layers.soundEffectVideoGenerationStatus',
  'layers.soundEffectRemoteLink',
  'layers.soundEffectVideoLayer',
  'layers.hasSoundEffectVideoLayer',
  'layers.soundEffectThumbnailPath',
  'layers.userVideoGenerationStatus',
  'layers.userVideoRemoteLink',
  'layers.userVideoLayer',
  'layers.hasUserVideoLayer',
  'layers.userVideoThumbnailPath',
  'layers.layerAiVideoType',
  'layers.layerBaseAiImageType',
  'layers.layerAISoundEffectPrompt',
  'audioLayers._id',
  'audioLayers.prompt',
  'audioLayers.subtitleText',
  'audioLayers.subtitleLanguage',
  'audioLayers.speechLanguage',
  'audioLayers.subtitleTranslationRequired',
  'audioLayers.generationType',
  'audioLayers.generationStatus',
  'audioLayers.generationError',
  'audioLayers.duration',
  'audioLayers.startTime',
  'audioLayers.endTime',
  'audioLayers.sourceTrimStartTime',
  'audioLayers.connectedLayerId',
  'audioLayers.connectedLayerIndex',
  'audioLayers.audioBindingMode',
  'audioLayers.bindToLayer',
  'audioLayers.selectedRemoteAudioLink',
  'audioLayers.remoteAudioLinks',
  'audioLayers.selectedLocalAudioLink',
  'audioLayers.localAudioLinks',
  'audioLayers.speaker',
  'audioLayers.provider',
  'audioLayers.languageCode',
  'audioLayers.languageCodes',
  'audioLayers.speakerVoiceId',
  'audioLayers.speakerLabel',
  'audioLayers.speakerDetails',
  'audioLayers.speakerCharacterName',
  'audioLayers.lyrics',
  'audioLayers.addSubtitles',
  'audioLayers.addTranscriptionsRequired',
  'audioLayers.subtitleFont',
  'audioLayers.subtitleWordAnimation',
  'audioLayers.transcriptAlignment',
  'audioLayers.volume',
  'audioLayers.isEnabled',
  'audioLayers.defaultSelected',
  'global_audio_layers._id',
  'global_audio_layers.prompt',
  'global_audio_layers.generationType',
  'global_audio_layers.generationStatus',
  'global_audio_layers.generationError',
  'global_audio_layers.duration',
  'global_audio_layers.startTime',
  'global_audio_layers.endTime',
  'global_audio_layers.sourceTrimStartTime',
  'global_audio_layers.selectedRemoteAudioLink',
  'global_audio_layers.remoteAudioLinks',
  'global_audio_layers.selectedLocalAudioLink',
  'global_audio_layers.localAudioLinks',
  'global_audio_layers.speaker',
  'global_audio_layers.provider',
  'global_audio_layers.languageCode',
  'global_audio_layers.languageCodes',
  'global_audio_layers.speakerVoiceId',
  'global_audio_layers.speakerLabel',
  'global_audio_layers.speakerDetails',
  'global_audio_layers.speakerCharacterName',
  'global_audio_layers.lyrics',
  'global_audio_layers.addSubtitles',
  'global_audio_layers.subtitleFont',
  'global_audio_layers.subtitleWordAnimation',
  'global_audio_layers.transcriptAlignment',
  'global_audio_layers.volume',
  'global_audio_layers.isEnabled',
  'global_audio_layers.defaultSelected',
  'global_videos._id',
  'global_videos.startTime',
  'global_videos.endTime',
  'global_videos.duration',
  'global_videos.url',
  'global_videos.remoteURL',
  'global_videos.assetPath',
  'global_videos.source',
  'global_videos.title',
  'global_videos.framesPerSecond',
  'global_videos.framesGenerationStatus',
].join(' ');

const EXPRESS_STATUS_STAGE_ORDER = [
  'prompt_generation',
  'image_generation',
  'speech_generation',
  'music_generation',
  'audio_generation',
  'ai_video_generation',
  'lip_sync_generation',
  'sound_effect_generation',
  'delete_reflow',
  'timeline_reflowed',
  'transcript_generation',
  'frame_generation',
  'video_generation',
];

const PREVIEW_STAGE_ORDER = [
  'prompt_generation',
  'image_generation',
  'speech_generation',
  'music_generation',
  'audio_generation',
  'ai_video_generation',
  'lip_sync_generation',
  'sound_effect_generation',
  'video_generation',
];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNonEmptyString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function shouldReturnDockerLocalAssetReferences() {
  const configuredMode = String(process.env.SAMSAR_MEDIA_DELIVERY_MODE || process.env.MEDIA_DELIVERY_MODE || '')
    .trim()
    .toLowerCase();
  if (configuredMode === 'docker-local' || configuredMode === 'local-filesystem') {
    return true;
  }
  if (configuredMode === 's3-cloudfront' || configuredMode === 'external-s3') {
    return false;
  }
  const isDockerRuntime = String(process.env.CURRENT_ENV || '').trim().toLowerCase() === 'docker';
  const externalMediaPublishEnabled = isTruthyEnv(
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED || process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED,
  );
  return isDockerRuntime && !externalMediaPublishEnabled;
}

function normalizeDockerLocalSecureAssetReference(value) {
  if (!shouldReturnDockerLocalAssetReferences()) {
    return null;
  }

  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  let relativePath = normalized.replace(/^\/+/, '');
  if (/^https?:\/\//i.test(normalized)) {
    try {
      relativePath = decodeURIComponent(new URL(normalized).pathname).replace(/^\/+/, '');
    } catch {
      return null;
    }
  }

  if (relativePath.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return `${resolveDockerLocalPublicAssetBaseUrl()}/${relativePath}`;
  }

  if (relativePath.startsWith(USER_RESOURCES_PREFIX)) {
    return `${resolveDockerLocalPublicAssetBaseUrl()}/${SECURE_ASSET_PREFIX}/${relativePath}`;
  }

  return null;
}

function resolveRequestAssetBaseUrl(req) {
  const configuredBase =
    normalizeString(process.env.API_SERVER) ||
    normalizeString(process.env.PUBLIC_API_BASE_URL) ||
    normalizeString(process.env.PUBLIC_BASE_URL);
  if (configuredBase) {
    return configuredBase.replace(/\/+$/, '');
  }

  const host = req?.get?.('host');
  if (!host) {
    return null;
  }

  return `${req.protocol || 'https'}://${host}`;
}

function resolveStaticAssetBaseUrl() {
  return (
    normalizeString(process.env.STATIC_CDN_URL) ||
    normalizeString(process.env.PUBLIC_STATIC_CDN_URL) ||
    DEFAULT_STATIC_ASSET_BASE_URL
  ).replace(/\/+$/, '');
}

function normalizeUserResourcesAssetUrl(value) {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  const staticBaseUrl = resolveStaticAssetBaseUrl();
  const relativePath = normalized.replace(/^\/+/, '');
  if (relativePath.startsWith(USER_RESOURCES_PREFIX)) {
    return buildSecureMediaDeliveryUrl(`${SECURE_ASSET_PREFIX}/${relativePath}`) ||
      `${staticBaseUrl}/${relativePath}`;
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      const pathname = parsedUrl.pathname.replace(/^\/+/, '');
      if (pathname.startsWith(USER_RESOURCES_PREFIX)) {
        return buildSecureMediaDeliveryUrl(`${SECURE_ASSET_PREFIX}/${pathname}`) ||
          `${staticBaseUrl}/${pathname}${parsedUrl.search || ''}`;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeSecureMediaAssetUrl(value) {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      if (pathname.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
        return buildSecureMediaDeliveryUrl(pathname);
      }
    } catch {
      return null;
    }
    return null;
  }

  const relativePath = normalized.replace(/^\/+/, '');
  if (relativePath.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return buildSecureMediaDeliveryUrl(relativePath);
  }

  return null;
}

export function normalizeResponseAssetUrl(value, req = null) {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  const dockerLocalSecureAssetUrl = normalizeDockerLocalSecureAssetReference(normalized);
  if (dockerLocalSecureAssetUrl) {
    return dockerLocalSecureAssetUrl;
  }

  const secureMediaUrl = normalizeSecureMediaAssetUrl(normalized);
  if (secureMediaUrl) {
    return secureMediaUrl;
  }

  const userResourcesUrl = normalizeUserResourcesAssetUrl(normalized);
  if (userResourcesUrl) {
    return userResourcesUrl;
  }

  if (
    /^https?:\/\//i.test(normalized) ||
    /^data:/i.test(normalized) ||
    /^blob:/i.test(normalized)
  ) {
    return normalized;
  }

  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  const responsePath = normalizeRawImageAssetReference(normalized) || normalized;
  const baseUrl = resolveRequestAssetBaseUrl(req);
  if (!baseUrl) {
    return responsePath;
  }

  return `${baseUrl}/${responsePath.replace(/^\/+/, '')}`;
}

export function normalizeResponseAssetUrlList(values, req = null) {
  return normalizeStringList(values)
    .map((value) => normalizeResponseAssetUrl(value, req))
    .filter(Boolean);
}

function normalizeStringList(values) {
  return Array.isArray(values)
    ? values.map((value) => normalizeString(value)).filter(Boolean)
    : [];
}

function pickFirstString(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function toObjectIdString(value) {
  return value?.toString?.() || value || null;
}

function compactObject(payload = {}) {
  return Object.entries(payload).reduce((result, [key, value]) => {
    if (value === undefined || value === null) {
      return result;
    }
    if (Array.isArray(value) && value.length === 0) {
      return result;
    }
    if (value instanceof Date) {
      result[key] = value;
      return result;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = compactObject(value);
      if (Object.keys(nested).length === 0) {
        return result;
      }
      result[key] = nested;
      return result;
    }
    result[key] = value;
    return result;
  }, {});
}

function resolveVideoHasSubtitles(sessionData = {}) {
  if (typeof sessionData.hasSubtitles === 'boolean') {
    return sessionData.hasSubtitles;
  }
  if (typeof sessionData.has_subtitles === 'boolean') {
    return sessionData.has_subtitles;
  }
  if (typeof sessionData.enableSubtitles === 'boolean') {
    return sessionData.enableSubtitles;
  }
  return true;
}

function normalizeResultLanguage(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'auto') {
    return null;
  }

  return trimmed.toLowerCase();
}

function resolveVideoResultLanguage(sessionData = {}) {
  return (
    normalizeResultLanguage(sessionData.sessionLanguage) ||
    normalizeResultLanguage(sessionData.language) ||
    normalizeResultLanguage(sessionData.language_code) ||
    normalizeResultLanguage(sessionData.langauge) ||
    'en'
  );
}

function hasFooterMetadata(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasFooterMetadata(entry));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return Boolean(
    value.url ||
    value.cta_url ||
    value.ctaUrl ||
    value.title ||
    value.cta_text ||
    value.ctaText ||
    value.text ||
    value.cta_logo ||
    value.ctaLogo ||
    value.logoUrl ||
    value.logoImagePath ||
    value.footerLogoImagePath
  );
}

export function resolveVideoHasFooter(sessionData = {}) {
  if (!sessionData || typeof sessionData !== 'object') {
    return false;
  }

  if (
    sessionData.addFooterAnimation === true &&
    (
      hasFooterMetadata(sessionData.footerMetadata) ||
      Boolean(
        sessionData.footerLogoImagePath ||
        sessionData.footerCtaText ||
        sessionData.footerCtaUrl ||
        sessionData.footerCtaLogo
      )
    )
  ) {
    return true;
  }

  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  return layers.some((layer) => (
    layer?.addFooterAnimation === true &&
    (
      hasFooterMetadata(layer.footerMetadata) ||
      Boolean(layer.footerLogoImagePath || layer.footer_logo_image_path)
    )
  ));
}

async function loadVideoStatusSnapshot(sessionId) {
  if (!sessionId) {
    return null;
  }

  const sessionData = await VideoSession.findById(sessionId)
    .select(VIDEO_STATUS_SESSION_PROJECTION)
    .lean();

  if (!sessionData) {
    return null;
  }

  const provider =
    sessionData.expressGenerativeVideoModel ||
    sessionData.expressGenerativeVideoModelSubType ||
    sessionData.videoGenerationModelSubType ||
    null;

  return {
    ...sessionData,
    provider,
  };
}

async function loadVideoDetailedStatusSnapshot(sessionId) {
  if (!sessionId) {
    return null;
  }

  const sessionData = await VideoSession.findById(sessionId)
    .select(VIDEO_STATUS_DETAILED_SESSION_PROJECTION)
    .lean();

  if (!sessionData) {
    return null;
  }

  const provider =
    sessionData.expressGenerativeVideoModel ||
    sessionData.expressGenerativeVideoModelSubType ||
    sessionData.videoGenerationModelSubType ||
    null;

  return {
    ...sessionData,
    provider,
  };
}

async function loadGeneratedImageCandidates(sessionId) {
  if (!sessionId) {
    return [];
  }

  try {
    return await GeneratedImage.find({ sessionId: sessionId.toString() })
      .select('url description prompt createdAt')
      .sort({ createdAt: 1 })
      .lean();
  } catch {
    return [];
  }
}

function getItemAssetUrl(item = {}) {
  return pickFirstString(
    item.src,
    item.image,
    item.url,
    item.selectedImageUrl,
    item.selected_image_url,
    item.generatedImage?.url,
    item.generatedImage?.src,
    item.generated_image?.url,
    item.generated_image?.src,
    item.remoteURL,
    item.remoteUrl,
    item.remote_url,
  );
}

function normalizeRawImageAssetReference(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      if (pathname.startsWith(`${SECURE_ASSET_PREFIX}/`) || pathname.startsWith(USER_RESOURCES_PREFIX)) {
        return pathname;
      }
    } catch {}
  }
  if (
    !/^https?:\/\//i.test(normalized) &&
    !normalized.startsWith('/') &&
    !normalized.includes('/') &&
    /\.(png|jpe?g|webp|gif)$/i.test(normalized)
  ) {
    return `/generations/${normalized}`;
  }
  return normalized;
}

function getImageAssetKey(value) {
  const normalized = normalizeRawImageAssetReference(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    return decodeURIComponent(parsed.pathname).split('/').filter(Boolean).pop() || normalized;
  } catch {
    return decodeURIComponent(normalized.split('?')[0]).split('/').filter(Boolean).pop() || normalized;
  }
}

function getItemPrompt(item = {}, fallbackPrompt = null) {
  return pickFirstString(
    item.prompt,
    item.generationPrompt,
    item.sourcePrompt,
    item.imagePrompt,
    item.secondaryPrompt,
    fallbackPrompt,
  );
}

function normalizePromptForCandidateMatch(value) {
  return normalizeString(value).replace(/\s+/g, ' ');
}

function getLayerCandidatePromptKeys(layer = {}) {
  return [
    layer.prompt,
    layer.imageSession?.prompt,
  ]
    .map((value) => normalizePromptForCandidateMatch(value))
    .filter(Boolean);
}

function buildGeneratedImageCandidatesByLayer(sessionData = {}, generatedImages = []) {
  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const promptToLayerIndexes = new Map();

  layers.forEach((layer, index) => {
    getLayerCandidatePromptKeys(layer).forEach((promptKey) => {
      const existing = promptToLayerIndexes.get(promptKey) || [];
      existing.push(index);
      promptToLayerIndexes.set(promptKey, existing);
    });
  });

  const candidatesByLayer = new Map();
  generatedImages.forEach((candidate) => {
    const promptKey = normalizePromptForCandidateMatch(candidate?.prompt);
    const layerIndexes = promptToLayerIndexes.get(promptKey) || [];
    layerIndexes.forEach((layerIndex) => {
      const existing = candidatesByLayer.get(layerIndex) || [];
      existing.push(candidate);
      candidatesByLayer.set(layerIndex, existing);
    });
  });

  return candidatesByLayer;
}

function serializeDetailedImageItem(item = {}, index = 0, {
  req = null,
  fallbackPrompt = null,
  selectedImageUrl = null,
} = {}) {
  const rawUrl = getItemAssetUrl(item);
  const normalizedRawUrl = normalizeRawImageAssetReference(rawUrl);
  const url = normalizeResponseAssetUrl(normalizedRawUrl || rawUrl, req);
  const normalizedSelectedUrl = normalizeResponseAssetUrl(
    normalizeRawImageAssetReference(selectedImageUrl) || selectedImageUrl,
    req,
  );
  const isPrimary = item?.is_base_image === true || (
    Boolean(url) &&
    Boolean(normalizedSelectedUrl) &&
    url === normalizedSelectedUrl
  );

  return compactObject({
    id: normalizeNonEmptyString(item.id) || toObjectIdString(item._id) || `item_${index}`,
    itemId: normalizeNonEmptyString(item.id) || toObjectIdString(item._id) || `item_${index}`,
    index,
    type: normalizeNonEmptyString(item.type) || 'image',
    role: isPrimary ? 'primary' : 'secondary',
    isPrimary,
    is_base_image: item?.is_base_image === true,
    url,
    rawUrl: normalizedRawUrl,
    src: normalizeRawImageAssetReference(item.src || rawUrl),
    image: normalizeRawImageAssetReference(item.image || rawUrl),
    remoteURL: normalizeNonEmptyString(item.remoteURL || item.remoteUrl || item.remote_url),
    prompt: getItemPrompt(item, fallbackPrompt),
    description: normalizeNonEmptyString(item.description),
    x: normalizeNumber(item.x),
    y: normalizeNumber(item.y),
    width: normalizeNumber(item.width),
    height: normalizeNumber(item.height),
    config: item.config && typeof item.config === 'object' ? item.config : null,
    animations: Array.isArray(item.animations) ? item.animations : null,
    createdAt: item.createdAt || item.created_at || null,
  });
}

function serializeSecondaryImageCandidate(candidate = {}, index = 0, {
  req = null,
  fallbackPrompt = null,
  source = 'generated_image',
} = {}) {
  const rawUrl = normalizeRawImageAssetReference(
    candidate.url ||
    candidate.src ||
    candidate.image ||
    candidate.imageUrl ||
    candidate.image_url,
  );
  const url = normalizeResponseAssetUrl(rawUrl, req);
  if (!url && !rawUrl) {
    return null;
  }

  return compactObject({
    id: normalizeNonEmptyString(candidate.id) || `${source}_${index}`,
    itemId: normalizeNonEmptyString(candidate.id) || `${source}_${index}`,
    index,
    type: 'image',
    role: 'secondary',
    isPrimary: false,
    is_base_image: false,
    source,
    url,
    rawUrl,
    src: rawUrl,
    image: rawUrl,
    prompt: getItemPrompt(candidate, fallbackPrompt),
    description: normalizeNonEmptyString(candidate.description),
    score: normalizeNumber(candidate.score),
    createdAt: candidate.createdAt || candidate.created_at || null,
  });
}

function buildDetailedImageItems(
  layer = {},
  req = null,
  selectedImageUrl = null,
  generatedImageCandidates = [],
) {
  const activeItems = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const fallbackPrompt = pickFirstString(layer?.imageSession?.prompt, layer.prompt);
  const selectedUrl = selectedImageUrl || getLayerSelectedImageUrl(layer);
  let serializedItems = activeItems
    .filter((item) => normalizeString(item?.type).toLowerCase() === 'image' || getItemAssetUrl(item))
    .map((item, index) => serializeDetailedImageItem(item, index, {
      req,
      fallbackPrompt,
      selectedImageUrl: selectedUrl,
    }))
    .filter((item) => item.url || item.rawUrl || item.src || item.image);

  const normalizedSelectedUrl = normalizeResponseAssetUrl(selectedUrl, req);
  const rawSelectedUrl = normalizeRawImageAssetReference(selectedUrl);
  if (serializedItems.length === 0 && normalizedSelectedUrl) {
    serializedItems = [compactObject({
      id: 'item_0',
      itemId: 'item_0',
      index: 0,
      type: 'image',
      role: 'primary',
      isPrimary: true,
      is_base_image: true,
      url: normalizedSelectedUrl,
      rawUrl: rawSelectedUrl,
      src: rawSelectedUrl,
      image: rawSelectedUrl,
      prompt: fallbackPrompt,
    })];
  }

  const seenAssetKeys = new Set(
    serializedItems
      .map((item) => getImageAssetKey(item.rawUrl || item.src || item.image || item.url))
      .filter(Boolean),
  );
  const secondaryCandidates = [];
  const pushCandidate = (candidate, source) => {
    const rawUrl = candidate?.url || candidate?.src || candidate?.image || candidate?.imageUrl || candidate?.image_url;
    const assetKey = getImageAssetKey(rawUrl);
    if (!assetKey || seenAssetKeys.has(assetKey)) {
      return;
    }
    const serialized = serializeSecondaryImageCandidate(candidate, serializedItems.length + secondaryCandidates.length, {
      req,
      fallbackPrompt,
      source,
    });
    if (!serialized) {
      return;
    }
    seenAssetKeys.add(assetKey);
    secondaryCandidates.push(serialized);
  };

  const filterPasses = Array.isArray(layer?.filterPasses) ? layer.filterPasses : [];
  filterPasses.forEach((pass, index) => pushCandidate({
    id: `filter_pass_${index}`,
    src: pass.src,
    url: pass.src,
    description: pass.description,
    score: pass.score,
    prompt: pass.prompt,
  }, 'filter_pass'));
  generatedImageCandidates.forEach((candidate, index) => pushCandidate({
    id: `generated_${index}`,
    url: candidate.url,
    description: candidate.description,
    prompt: candidate.prompt,
    createdAt: candidate.createdAt,
  }, 'generated_image'));

  serializedItems = [...serializedItems, ...secondaryCandidates];
  if (serializedItems.length === 0) {
    return [];
  }

  const hasPrimary = serializedItems.some((item) => item.isPrimary);
  if (!hasPrimary) {
    serializedItems[0] = {
      ...serializedItems[0],
      role: 'primary',
      isPrimary: true,
      is_base_image: true,
    };
  }

  return serializedItems;
}

function getLayerSelectedImageUrl(layer = {}) {
  const activeItems = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const baseImageItem = activeItems.find((item) => item?.is_base_image === true) ||
    activeItems.find((item) => normalizeString(item?.type).toLowerCase() === 'image') ||
    activeItems[0] ||
    null;

  return pickFirstString(
    getItemAssetUrl(baseImageItem || {}),
    layer?.imageSession?.activeImageRemoteLink,
    layer?.imageSession?.activeGeneratedImage,
    layer?.imageSession?.activeEditedImage,
    layer?.imageSession?.activeSelectedImage,
  );
}

function buildAssetStatus(rawStatus, fallbackUrl = null) {
  const normalized = normalizeString(rawStatus).toUpperCase();
  if (normalized) {
    return normalized;
  }
  return fallbackUrl ? 'COMPLETED' : 'INIT';
}

function buildVideoAsset({
  status,
  url,
  hasAsset,
  req,
}) {
  const normalizedUrl = normalizeResponseAssetUrl(url, req);
  if (!normalizedUrl && !hasAsset && !normalizeString(status)) {
    return null;
  }

  return {
    status: buildAssetStatus(status, normalizedUrl),
    url: normalizedUrl,
  };
}

function buildImageAssetReference(value, req = null) {
  const rawUrl = normalizeRawImageAssetReference(value)?.replace(/^\/+/, '');
  const url = normalizeResponseAssetUrl(rawUrl || value, req);
  if (!url && !rawUrl) {
    return null;
  }
  return compactObject({
    url,
    rawUrl,
  });
}

function isImageListToVideoDetailedPreview(sessionData = {}) {
  const routeType = normalizeString(
    sessionData.expressStepGeneration?.routeType ||
    sessionData.expressStepGeneration?.route_type,
  ).toLowerCase();
  return sessionData.isStepVideoGeneration === true &&
    (routeType === 'image_to_video' || routeType === 'image_list_to_video');
}

function buildLayerPreview({
  image,
  aiVideo,
  lipSyncVideo,
  soundEffectVideo,
  userVideo,
}) {
  if (lipSyncVideo?.url) {
    return { stage: 'lip_sync_generation', type: 'video', url: lipSyncVideo.url };
  }
  if (soundEffectVideo?.url) {
    return { stage: 'sound_effect_generation', type: 'video', url: soundEffectVideo.url };
  }
  if (aiVideo?.url) {
    return { stage: 'ai_video_generation', type: 'video', url: aiVideo.url };
  }
  if (userVideo?.url) {
    return { stage: 'user_video', type: 'video', url: userVideo.url };
  }
  if (image?.url) {
    return { stage: 'image_generation', type: 'image', url: image.url };
  }
  return null;
}

function buildLayerFrameImages(layer = {}, req = null) {
  const startFrame = pickFirstString(
    layer.aiLayerStartFrame,
    layer.aiVideoThumbnailPath,
    layer.thumbnailPath,
    layer.baseLayerStartFrame,
    layer.imageSession?.videoRenderStartFrameImage,
  );
  const endFrame = pickFirstString(
    layer.aiLayerEndFrame,
    layer.baseLayerEndFrame,
    layer.imageSession?.videoRenderEndFrameImage,
  );

  return compactObject({
    startFrame,
    startFrameUrl: normalizeResponseAssetUrl(startFrame, req),
    endFrame,
    endFrameUrl: normalizeResponseAssetUrl(endFrame, req),
    aiLayerStartFrame: normalizeNonEmptyString(layer.aiLayerStartFrame),
    baseLayerStartFrame: normalizeNonEmptyString(layer.baseLayerStartFrame),
    thumbnailPath: normalizeNonEmptyString(layer.thumbnailPath),
    aiVideoThumbnailPath: normalizeNonEmptyString(layer.aiVideoThumbnailPath),
    lipSyncThumbnailPath: normalizeNonEmptyString(layer.lipSyncThumbnailPath),
    soundEffectThumbnailPath: normalizeNonEmptyString(layer.soundEffectThumbnailPath),
    userVideoThumbnailPath: normalizeNonEmptyString(layer.userVideoThumbnailPath),
  });
}

function serializeDetailedLayer(
  layer = {},
  index = 0,
  req = null,
  generatedImageCandidates = [],
  options = {},
) {
  const startTime = normalizeNumber(layer.durationOffset) ?? 0;
  const duration = normalizeNumber(layer.duration);
  const endTime = duration === null ? null : startTime + duration;
  const selectedImageUrl = getLayerSelectedImageUrl(layer);
  const imageUrl = normalizeResponseAssetUrl(selectedImageUrl, req);
  const imageItems = buildDetailedImageItems(layer, req, selectedImageUrl, generatedImageCandidates);
  const frameImages = buildLayerFrameImages(layer, req);
  const editedImage = options.includeEditedImage
    ? buildImageAssetReference(layer?.imageSession?.activeEditedImage, req)
    : null;
  const image = compactObject({
    status: buildAssetStatus(layer?.imageSession?.generationStatus, imageUrl),
    editStatus: normalizeNonEmptyString(layer?.imageSession?.editStatus),
    url: imageUrl,
    editedImage: editedImage?.url,
    editedImageRawUrl: editedImage?.rawUrl,
    prompt: normalizeNonEmptyString(layer?.imageSession?.prompt || layer?.prompt),
    description: normalizeNonEmptyString(
      layer?.imageSession?.activeImageDescription || layer?.activeImageDescription,
    ),
    items: imageItems,
  });
  const aiVideo = buildVideoAsset({
    status: layer.aiVideoGenerationStatus,
    url: pickFirstString(layer.aiVideoRemoteLink, layer.aiVideoLayer),
    hasAsset: layer.hasAiVideoLayer === true,
    req,
  });
  const lipSyncVideo = buildVideoAsset({
    status: layer.lipSyncVideoGenerationStatus,
    url: pickFirstString(layer.lipSyncRemoteLink, layer.lipSyncVideoLayer),
    hasAsset: layer.hasLipSyncVideoLayer === true,
    req,
  });
  const soundEffectVideo = buildVideoAsset({
    status: layer.soundEffectVideoGenerationStatus,
    url: pickFirstString(layer.soundEffectRemoteLink, layer.soundEffectVideoLayer),
    hasAsset: layer.hasSoundEffectVideoLayer === true,
    req,
  });
  const userVideo = buildVideoAsset({
    status: layer.userVideoGenerationStatus,
    url: pickFirstString(layer.userVideoRemoteLink, layer.userVideoLayer),
    hasAsset: layer.hasUserVideoLayer === true,
    req,
  });
  const preview = buildLayerPreview({
    image,
    aiVideo,
    lipSyncVideo,
    soundEffectVideo,
    userVideo,
  });
  const shouldExposeBaseAiVideo = !(
    lipSyncVideo?.url ||
    soundEffectVideo?.url ||
    userVideo?.url
  );

  return compactObject({
    index,
    id: toObjectIdString(layer._id),
    startTime,
    endTime,
    duration,
    status: normalizeNonEmptyString(layer.status),
    prompt: normalizeNonEmptyString(layer.prompt),
    videoPrompt: normalizeNonEmptyString(layer.videoGenerationPrompt),
    aiVideoType: normalizeNonEmptyString(layer.layerAiVideoType),
    baseImageType: normalizeNonEmptyString(layer.layerBaseAiImageType),
    soundEffectPrompt: normalizeNonEmptyString(layer.layerAISoundEffectPrompt),
    aiLayerStartFrame: normalizeNonEmptyString(layer.aiLayerStartFrame),
    baseLayerStartFrame: normalizeNonEmptyString(layer.baseLayerStartFrame),
    thumbnailPath: normalizeNonEmptyString(layer.thumbnailPath),
    aiVideoThumbnailPath: normalizeNonEmptyString(layer.aiVideoThumbnailPath),
    frameImages,
    image,
    editedImage,
    aiVideo: shouldExposeBaseAiVideo ? aiVideo : undefined,
    lipSyncVideo,
    soundEffectVideo,
    userVideo,
    preview,
  });
}

function getAudioLayerUrl(layer = {}) {
  return pickFirstString(
    layer.selectedRemoteAudioLink,
    ...normalizeStringList(layer.remoteAudioLinks),
    layer.selectedLocalAudioLink,
    ...normalizeStringList(layer.localAudioLinks),
  );
}

function serializeDetailedAudioLayer(layer = {}, index = 0, req = null) {
  const startTime = normalizeNumber(layer.startTime) ?? 0;
  const duration = normalizeNumber(layer.duration);
  const endTime = normalizeNumber(layer.endTime) ?? (
    duration === null ? null : startTime + duration
  );
  const url = normalizeResponseAssetUrl(getAudioLayerUrl(layer), req);
  const transcriptAlignment = layer.transcriptAlignment &&
    typeof layer.transcriptAlignment === 'object' &&
    !Array.isArray(layer.transcriptAlignment)
    ? layer.transcriptAlignment
    : null;

  return compactObject({
    index,
    id: toObjectIdString(layer._id),
    type: normalizeNonEmptyString(layer.generationType) || 'audio',
    status: buildAssetStatus(layer.generationStatus, url),
    startTime,
    endTime,
    duration,
    sourceTrimStartTime: normalizeNumber(layer.sourceTrimStartTime),
    prompt: normalizeNonEmptyString(layer.prompt),
    subtitleText: normalizeNonEmptyString(layer.subtitleText),
    subtitleLanguage: normalizeNonEmptyString(layer.subtitleLanguage),
    speechLanguage: normalizeNonEmptyString(layer.speechLanguage),
    subtitleTranslationRequired: normalizeBoolean(layer.subtitleTranslationRequired),
    url,
    remoteAudioLinks: normalizeResponseAssetUrlList(layer.remoteAudioLinks, req),
    volume: normalizeNumber(layer.volume),
    isEnabled: normalizeBoolean(layer.isEnabled),
    defaultSelected: normalizeBoolean(layer.defaultSelected),
    speaker: normalizeNonEmptyString(layer.speaker),
    provider: normalizeNonEmptyString(layer.provider),
    languageCode: normalizeNonEmptyString(layer.languageCode),
    languageCodes: Array.isArray(layer.languageCodes) ? layer.languageCodes : undefined,
    speakerVoiceId: normalizeNonEmptyString(layer.speakerVoiceId),
    speakerLabel: normalizeNonEmptyString(layer.speakerLabel),
    speakerDetails: layer.speakerDetails && typeof layer.speakerDetails === 'object'
      ? layer.speakerDetails
      : undefined,
    speakerCharacterName: normalizeNonEmptyString(layer.speakerCharacterName),
    lyrics: normalizeNonEmptyString(layer.lyrics),
    connectedLayerId: normalizeNonEmptyString(layer.connectedLayerId),
    connectedLayerIndex: normalizeNumber(layer.connectedLayerIndex),
    audioBindingMode: normalizeNonEmptyString(layer.audioBindingMode),
    bindToLayer: normalizeBoolean(layer.bindToLayer),
    addSubtitles: normalizeBoolean(layer.addSubtitles),
    addTranscriptionsRequired: normalizeBoolean(layer.addTranscriptionsRequired),
    subtitleFont: normalizeNonEmptyString(layer.subtitleFont),
    subtitleWordAnimation: normalizeNonEmptyString(layer.subtitleWordAnimation),
    transcriptAlignment,
  });
}

function serializeDetailedGlobalVideo(globalVideo = {}, index = 0, req = null) {
  const url = normalizeResponseAssetUrl(
    pickFirstString(globalVideo.remoteURL, globalVideo.url, globalVideo.assetPath),
    req,
  );
  const startTime = normalizeNumber(globalVideo.startTime) ?? 0;
  const duration = normalizeNumber(globalVideo.duration);
  const endTime = normalizeNumber(globalVideo.endTime) ?? (
    duration === null ? null : startTime + duration
  );

  return compactObject({
    index,
    id: toObjectIdString(globalVideo._id),
    type: 'video',
    source: normalizeNonEmptyString(globalVideo.source),
    title: normalizeNonEmptyString(globalVideo.title),
    status: buildAssetStatus(globalVideo.framesGenerationStatus, url),
    startTime,
    endTime,
    duration,
    url,
    framesPerSecond: normalizeNumber(globalVideo.framesPerSecond),
  });
}

function normalizeStageStatusMap(rawStatus = {}) {
  if (!rawStatus || typeof rawStatus !== 'object' || Array.isArray(rawStatus)) {
    return {};
  }

  return Object.entries(rawStatus).reduce((result, [key, value]) => {
    if (typeof value === 'string') {
      result[key] = value.trim().toUpperCase();
    } else if (value !== undefined && value !== null) {
      result[key] = value;
    }
    return result;
  }, {});
}

function isCompletedStageStatus(value) {
  const normalized = normalizeString(value).toUpperCase();
  return normalized === 'COMPLETED' ||
    normalized === 'SUCCESS' ||
    normalized === 'SUCCEEDED' ||
    normalized === 'DONE';
}

function resolveCurrentStage(stageStatusMap = {}) {
  for (const stage of EXPRESS_STATUS_STAGE_ORDER) {
    const status = stageStatusMap[stage];
    if (!status || !isCompletedStageStatus(status)) {
      return stage;
    }
  }
  return 'video_generation';
}

function resolveCompletedStages(stageStatusMap = {}) {
  return EXPRESS_STATUS_STAGE_ORDER.filter((stage) => isCompletedStageStatus(stageStatusMap[stage]));
}

function resolvePreviewStage({
  stageStatusMap,
  layers,
  audioLayers,
  globalAudioLayers,
  globalVideos,
  resultUrl,
}) {
  const hasLayerImage = layers.some((layer) => Boolean(layer.image?.url));
  const hasAiVideo = layers.some((layer) => Boolean(layer.aiVideo?.url || layer.userVideo?.url));
  const hasLipSyncVideo = layers.some((layer) => Boolean(layer.lipSyncVideo?.url));
  const hasSoundEffectVideo = layers.some((layer) => Boolean(layer.soundEffectVideo?.url));
  const hasSpeech = audioLayers.some((layer) => layer.type === 'speech' && Boolean(layer.url));
  const hasMusic = [...audioLayers, ...globalAudioLayers].some((layer) => layer.type !== 'speech' && Boolean(layer.url));
  const hasGlobalVideo = globalVideos.some((video) => Boolean(video.url));
  const availability = {
    video_generation: Boolean(resultUrl),
    sound_effect_generation: hasSoundEffectVideo,
    lip_sync_generation: hasLipSyncVideo,
    ai_video_generation: hasAiVideo || hasGlobalVideo,
    audio_generation: hasSpeech || hasMusic,
    music_generation: hasMusic,
    speech_generation: hasSpeech,
    image_generation: hasLayerImage,
    prompt_generation: true,
  };

  for (let index = PREVIEW_STAGE_ORDER.length - 1; index >= 0; index -= 1) {
    const stage = PREVIEW_STAGE_ORDER[index];
    if (availability[stage]) {
      return stage;
    }
  }

  return hasLayerImage ? 'image_generation' : 'prompt_generation';
}

function resolveSessionDuration(sessionData = {}, layers = [], audioLayers = [], globalAudioLayers = [], globalVideos = []) {
  const explicitDuration = normalizeNumber(sessionData.totalDuration);
  if (explicitDuration !== null && explicitDuration > 0) {
    return explicitDuration;
  }

  const endTimes = [
    ...layers.map((layer) => normalizeNumber(layer.endTime)),
    ...audioLayers.map((layer) => normalizeNumber(layer.endTime)),
    ...globalAudioLayers.map((layer) => normalizeNumber(layer.endTime)),
    ...globalVideos.map((video) => normalizeNumber(video.endTime)),
  ].filter((value) => value !== null);

  return endTimes.length ? Math.max(...endTimes) : 0;
}

export function buildNormalizedVideoSessionPreview(
  sessionData = {},
  statusPayload = {},
  req = null,
  { generatedImageCandidates = [] } = {},
) {
  const generatedImageCandidatesByLayer = buildGeneratedImageCandidatesByLayer(
    sessionData,
    generatedImageCandidates,
  );
  const includeEditedImage = isImageListToVideoDetailedPreview(sessionData);
  const layers = (Array.isArray(sessionData.layers) ? sessionData.layers : [])
    .map((layer, index) => serializeDetailedLayer(
      layer,
      index,
      req,
      generatedImageCandidatesByLayer.get(index) || [],
      { includeEditedImage },
    ));
  const audioLayers = (Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [])
    .map((layer, index) => serializeDetailedAudioLayer(layer, index, req));
  const globalAudioLayers = (Array.isArray(sessionData.global_audio_layers) ? sessionData.global_audio_layers : [])
    .map((layer, index) => serializeDetailedAudioLayer(layer, index, req));
  const globalVideos = (Array.isArray(sessionData.global_videos) ? sessionData.global_videos : [])
    .map((video, index) => serializeDetailedGlobalVideo(video, index, req));
  const stageStatusMap = normalizeStageStatusMap(sessionData.expressGenerationStatus);
  const resultUrl = normalizeResponseAssetUrl(statusPayload.result_url, req);
  const currentStage = resolveCurrentStage(stageStatusMap);
  const previewStage = resolvePreviewStage({
    stageStatusMap,
    layers,
    audioLayers,
    globalAudioLayers,
    globalVideos,
    resultUrl,
  });

  return compactObject({
    id: toObjectIdString(sessionData._id),
    requestId: toObjectIdString(statusPayload.request_id || sessionData._id),
    type: 'video',
    routeType: sessionData.isStepVideoGeneration ? 'step' : 'express',
    aspectRatio: normalizeNonEmptyString(sessionData.aspectRatio),
    framesPerSecond: normalizeNumber(sessionData.framesPerSecond),
    duration: resolveSessionDuration(sessionData, layers, audioLayers, globalAudioLayers, globalVideos),
    language:
      normalizeNonEmptyString(sessionData.sessionLanguage) ||
      normalizeNonEmptyString(sessionData.language) ||
      normalizeNonEmptyString(sessionData.language_code) ||
      normalizeNonEmptyString(sessionData.langauge),
    languageString: normalizeNonEmptyString(sessionData.languageString),
    subtitleLanguage: normalizeNonEmptyString(sessionData.subtitleLanguage),
    subtitleLanguageString: normalizeNonEmptyString(sessionData.subtitleLanguageString),
    subtitleLanguageExplicit: normalizeBoolean(sessionData.subtitleLanguageExplicit),
    subtitleTranslationRequired: normalizeBoolean(sessionData.subtitleTranslationRequired),
    hasSubtitles: resolveVideoHasSubtitles(sessionData),
    hasFooter: resolveVideoHasFooter(sessionData),
    inputPrompt: normalizeNonEmptyString(sessionData.inputPrompt || sessionData.expressInputPrompt),
    inferenceModel: normalizeNonEmptyString(
      sessionData.expressGenerationInferenceModel || sessionData.inferenceModel,
    ),
    expressGenerationInferenceModel: normalizeNonEmptyString(
      sessionData.expressGenerationInferenceModel || sessionData.inferenceModel,
    ),
    generationType: normalizeNonEmptyString(sessionData.expressGenerationType),
    provider: normalizeNonEmptyString(statusPayload.provider || sessionData.provider),
    currentStage,
    previewStage,
    completedStages: resolveCompletedStages(stageStatusMap),
    stages: stageStatusMap,
    layers,
    audioLayers,
    globalAudioLayers,
    globalVideos,
    result: {
      url: resultUrl,
      remoteURL: normalizeResponseAssetUrl(sessionData.remoteURL, req),
      videoLink: normalizeResponseAssetUrl(sessionData.videoLink, req),
      hasSubtitles: resolveVideoHasSubtitles(sessionData),
      hasFooter: resolveVideoHasFooter(sessionData),
      language: resolveVideoResultLanguage(sessionData),
    },
    createdAt: sessionData.createdAt || null,
    updatedAt: sessionData.updatedAt || null,
  });
}

export async function buildVideoStatusResponse({
  sessionId,
  requestId,
  provider,
  req,
  defaultResultUrl,
  defaultResultUrls,
}) {
  if (!sessionId) {
    return null;
  }

  try {
    const sessionSnapshot = await loadVideoStatusSnapshot(sessionId);
    if (!sessionSnapshot) {
      return null;
    }

    const stageVideoStatusRaw =
      typeof sessionSnapshot?.expressGenerationStatus?.video_generation === 'string'
        ? sessionSnapshot.expressGenerationStatus.video_generation.trim().toUpperCase()
        : '';
    const stageVideoFailed =
      stageVideoStatusRaw.includes('FAIL') ||
      stageVideoStatusRaw.includes('ERROR') ||
      stageVideoStatusRaw.includes('TIMEOUT');
    const stageVideoCanceled = stageVideoStatusRaw.includes('CANCEL');
    const expressGenerationCancelled = Boolean(sessionSnapshot?.expressGenerationCancelled);
    const expressGenerationPaused = Boolean(sessionSnapshot?.expressGenerationPaused);
    const statusRaw = typeof sessionSnapshot?.expressGenerationStatus?.status === 'string'
      ? sessionSnapshot.expressGenerationStatus.status.trim().toUpperCase()
      : '';
    const normalizedDefaultUrls = Array.isArray(defaultResultUrls)
      ? defaultResultUrls.filter(Boolean)
      : [];
    const completionStatusSet = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE']);
    const stageVideoCompleted = completionStatusSet.has(stageVideoStatusRaw);
    const host = req?.get?.('host');
    const normalizedVideoLink = sessionSnapshot?.videoLink
      ? sessionSnapshot.videoLink.startsWith('http')
        ? sessionSnapshot.videoLink
        : host
          ? `${req.protocol}://${host}/${sessionSnapshot.videoLink.replace(/^\//, '')}`
          : sessionSnapshot.videoLink
      : null;
    const completionUrl = normalizeResponseAssetUrl(normalizedVideoLink
      || sessionSnapshot?.remoteURL
      || defaultResultUrl
      || normalizedDefaultUrls[0], req);
    let normalizedStatus = completionUrl ? 'COMPLETED' : 'PENDING';
    if (expressGenerationCancelled || stageVideoCanceled) {
      normalizedStatus = 'CANCELLED';
    } else if (sessionSnapshot.expressGenerationFailed || stageVideoFailed) {
      normalizedStatus = 'FAILED';
    } else if (expressGenerationPaused) {
      normalizedStatus = 'PAUSED';
    } else if (completionUrl && stageVideoCompleted) {
      normalizedStatus = 'COMPLETED';
    } else if (statusRaw) {
      normalizedStatus = statusRaw;
    } else if (
      sessionSnapshot.expressGenerationPending ||
      sessionSnapshot.videoGenerationPending ||
      stageVideoStatusRaw === 'PENDING' ||
      stageVideoStatusRaw === 'INIT' ||
      stageVideoStatusRaw === 'IN_PROGRESS'
    ) {
      normalizedStatus = 'PENDING';
    } else if (completionUrl) {
      normalizedStatus = 'COMPLETED';
    }
    const shouldReportCompleted = completionStatusSet.has(normalizedStatus) && Boolean(completionUrl);

    const expressGenerationCreditCharges = sessionSnapshot?.expressGenerationCreditCharges || {
      totalCharged: 0,
      stages: {},
    };
    const totalCreditsCharged = Number(expressGenerationCreditCharges?.totalCharged) || 0;

    const payload = {
      session_id: sessionId.toString(),
      request_id: (requestId || sessionId).toString(),
      status: shouldReportCompleted
        ? 'COMPLETED'
        : completionStatusSet.has(normalizedStatus)
          ? 'PENDING'
          : normalizedStatus,
      type: 'video',
      provider: provider || sessionSnapshot?.provider || null,
      expressGenerationStatus: sessionSnapshot?.expressGenerationStatus,
      expressGenerationPaused,
      expressGenerationCreditCharges,
      express_generation_credit_charges: expressGenerationCreditCharges,
      creditsCharged: totalCreditsCharged,
      credits_charged: totalCreditsCharged,
    };

    if (sessionSnapshot?.expressGenerationError) {
      payload.expressGenerationError = sessionSnapshot.expressGenerationError;
      payload.message = sessionSnapshot.expressGenerationError;
    }

    if (sessionSnapshot?.videoLink) {
      payload.videoLink = normalizeResponseAssetUrl(sessionSnapshot.videoLink, req);
    }

    if (sessionSnapshot?.remoteURL) {
      payload.remoteURL = normalizeResponseAssetUrl(sessionSnapshot.remoteURL, req);
    }

    if (shouldReportCompleted) {
      payload.result_url = completionUrl;
      payload.result_urls = normalizedDefaultUrls.length
        ? normalizeResponseAssetUrlList(normalizedDefaultUrls, req)
        : [completionUrl];
      payload.has_subtitles = resolveVideoHasSubtitles(sessionSnapshot);
      payload.has_footer = resolveVideoHasFooter(sessionSnapshot);
      payload.result_language = resolveVideoResultLanguage(sessionSnapshot);
    }

    return payload;
  } catch (error) {
    return null;
  }
}

export async function buildVideoStatusDetailedResponse({
  sessionId,
  requestId,
  provider,
  req,
  defaultResultUrl,
  defaultResultUrls,
}) {
  const baseStatus = await buildVideoStatusResponse({
    sessionId,
    requestId,
    provider,
    req,
    defaultResultUrl,
    defaultResultUrls,
  });

  if (!baseStatus) {
    return null;
  }

  const sessionSnapshot = await loadVideoDetailedStatusSnapshot(sessionId);
  if (!sessionSnapshot) {
    return null;
  }
  const generatedImageCandidates = await loadGeneratedImageCandidates(sessionId);

  return {
    ...baseStatus,
    status_detail_schema: 'video_session_preview.v1',
    session: buildNormalizedVideoSessionPreview(sessionSnapshot, baseStatus, req, {
      generatedImageCandidates,
    }),
  };
}
