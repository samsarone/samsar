const DOCKER_LOCAL_MEDIA_MODES = new Set(['docker-local', 'local-filesystem']);
const EXTERNAL_MEDIA_MODES = new Set(['s3-cloudfront', 'external-s3']);
const PENDING_STATUS = 'PENDING';
const COMPLETED_STATUS = 'COMPLETED';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatus(value) {
  return normalizeString(value).toUpperCase();
}

function isTruthyAssetUrl(value) {
  return normalizeString(value).length > 0;
}

function isRenderableLayer(layer = {}) {
  const duration = Number(layer?.duration);
  return Number.isFinite(duration) && duration > 0;
}

function isEnabledAudioLayer(layer = {}) {
  return layer?.isEnabled === true || layer?.defaultSelected === true;
}

export function isDockerLocalFinalVideoQueueRepairEnabled(env = process.env) {
  const configuredMode = normalizeString(env.SAMSAR_MEDIA_DELIVERY_MODE || env.MEDIA_DELIVERY_MODE)
    .toLowerCase();
  if (DOCKER_LOCAL_MEDIA_MODES.has(configuredMode)) {
    return true;
  }
  if (EXTERNAL_MEDIA_MODES.has(configuredMode)) {
    return false;
  }
  return normalizeString(env.CURRENT_ENV).toLowerCase() === 'docker';
}

export function hasFinalVideoResult(videoSession = {}) {
  return isTruthyAssetUrl(videoSession?.remoteURL) || isTruthyAssetUrl(videoSession?.videoLink);
}

export function hasBlockingPendingGeneration(videoSession = {}) {
  if (
    videoSession?.audioGenerationPending === true ||
    videoSession?.speechGenerationPending === true ||
    videoSession?.musicGenerationPending === true ||
    videoSession?.transcriptGenerationPending === true ||
    videoSession?.aiVideoGenerationPending === true
  ) {
    return true;
  }

  const expressStatus = videoSession?.expressGenerationStatus || {};
  const blockingStages = [
    'audio_generation',
    'speech_generation',
    'music_generation',
    'ai_video_generation',
    'lip_sync_generation',
    'sound_effect_generation',
    'transcript_generation',
  ];
  if (blockingStages.some((stage) => normalizeStatus(expressStatus?.[stage]) === PENDING_STATUS)) {
    return true;
  }

  const layers = Array.isArray(videoSession?.layers) ? videoSession.layers : [];
  if (layers.some((layer) => (
    layer?.frameGenerationPending === true ||
    layer?.aiVideoFrameGenerationPending === true ||
    layer?.aiVideoGenerationPending === true ||
    layer?.userVideoGenerationPending === true
  ))) {
    return true;
  }

  const audioLayers = [
    ...(Array.isArray(videoSession?.audioLayers) ? videoSession.audioLayers : []),
    ...(Array.isArray(videoSession?.global_audio_layers) ? videoSession.global_audio_layers : []),
  ];
  return audioLayers.some((layer) => (
    isEnabledAudioLayer(layer) && normalizeStatus(layer?.generationStatus) === PENDING_STATUS
  ));
}

export function hasRenderableFramesReady(videoSession = {}) {
  const layers = Array.isArray(videoSession?.layers) ? videoSession.layers : [];
  const renderableLayers = layers.filter(isRenderableLayer);
  if (!renderableLayers.length) {
    return false;
  }

  return renderableLayers.every((layer) => (
    Array.isArray(layer?.frames) && layer.frames.length > 0
  ));
}

export function shouldRepairMissingFinalVideoRequest(videoSession = {}, env = process.env) {
  if (!isDockerLocalFinalVideoQueueRepairEnabled(env)) {
    return false;
  }
  if (!videoSession || videoSession.videoGenerationPending !== true) {
    return false;
  }
  if (videoSession.frameGenerationPending === true) {
    return false;
  }
  if (videoSession.expressGenerationFailed === true || videoSession.expressGenerationCancelled === true) {
    return false;
  }
  if (hasFinalVideoResult(videoSession)) {
    return false;
  }
  if (hasBlockingPendingGeneration(videoSession)) {
    return false;
  }
  return hasRenderableFramesReady(videoSession);
}

export function buildDockerFinalVideoQueueRepairSessionPatch() {
  return {
    videoGenerationPending: true,
    frameGenerationPending: false,
    generationError: null,
    expressGenerationError: null,
    'expressGenerationStatus.frame_generation': COMPLETED_STATUS,
    'expressGenerationStatus.video_generation': PENDING_STATUS,
  };
}
