const normalizeString = value => typeof value === 'string' ? value.trim() : '';
const normalizeId = value => value?.toString?.() || '';
const normalizeStatus = value => normalizeString(value).toUpperCase();
// Strict:false Mongoose fields are readable through get() even when they do
// not have generated JavaScript accessors on a hydrated document.
const readField = (object, field) => object?.get?.(field) ?? object?.[field];
const snapshotFieldGuard = value => {
  if (value === undefined) return { $exists: false };
  // Hydrated defaults may not exist in an older stored document. These empty
  // states still exclude a late, usable result without blocking its failure.
  if (value === false || value === '' || Array.isArray(value) && value.length === 0) {
    return { $in: [value, null] };
  }
  return value;
};

export const PROVIDER_NETWORK_FAILURE_CODES = Object.freeze([
  'PROVIDER_NETWORK_RETRY_EXHAUSTED',
  'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN',
  'PROVIDER_MEDIA_DOWNLOAD_FAILED',
  'PROVIDER_NETWORK_WAIT_EXPIRED',
  'PROVIDER_MEDIA_PREPARATION_FAILED',
]);

export function isLipSyncInfrastructureFailure(layer = {}) {
  return readField(layer, 'lipSyncInfrastructureFailure') === true ||
    PROVIDER_NETWORK_FAILURE_CODES.includes(normalizeString(readField(layer, 'lipSyncVideoGenerationErrorCode')));
}

const VIDEO_STAGE_FIELDS = Object.freeze({
  lip_sync_generation: ['lipSyncVideoGenerationStatus', 'hasLipSyncVideoLayer', 'lipSyncVideoLayer', 'lipSyncRemoteLink'],
  sound_effect_generation: ['soundEffectVideoGenerationStatus', 'hasSoundEffectVideoLayer', 'soundEffectVideoLayer', 'soundEffectRemoteLink'],
  ai_video_generation: ['aiVideoGenerationStatus', 'hasAiVideoLayer', 'aiVideoLayer', 'aiVideoRemoteLink'],
});
const AUDIO_FIELDS = ['generationStatus', 'selectedLocalAudioLink', 'selectedRemoteAudioLink', 'audioLink', 'localAudioLinks', 'remoteAudioLinks'];
const hasAudioOutput = layer => AUDIO_FIELDS.slice(1).some(field => {
  const value = readField(layer, field);
  return Array.isArray(value) ? value.some(item => normalizeString(item)) : normalizeString(value);
});

/** Stale source-session markers and completed outputs are never failure work. */
export function getUnresolvedProviderNetworkFailure(session = {}) {
  if (!readField(session, 'expressGenerationPending') || readField(session, 'expressGenerationPaused') ||
      readField(session, 'expressGenerationCancelled') || readField(session, 'expressGenerationFailed')) return null;
  const marker = readField(session, 'providerNetworkFailure');
  const generationStatus = readField(session, 'expressGenerationStatus') || {};
  if (!marker || typeof marker !== 'object' || !normalizeString(marker.code)) return null;
  const stage = normalizeString(marker.stage);
  // Accept current pipeline stages, never arbitrary Mongo field paths supplied
  // by a malformed marker. The specialized workers can also report before a
  // legacy session has an explicit status entry for their stage.
  if (stage !== marker.stage || !/^[a-z]+(?:_[a-z]+)*_generation$/.test(stage) ||
      (!VIDEO_STAGE_FIELDS[stage] && !['audio_generation', 'speech_generation', 'music_generation'].includes(stage) &&
       generationStatus[stage] === undefined)) return null;
  const audioTarget = Boolean(normalizeId(marker.audioLayerId));
  const targetId = normalizeId(audioTarget ? marker.audioLayerId : marker.layerId);
  if (!targetId) return null;
  const collection = audioTarget ? 'audioLayers' : 'layers';
  const sessionTargets = readField(session, collection);
  const targets = Array.isArray(sessionTargets) ? sessionTargets : [];
  const layer = targets.find(item => normalizeId(item?._id) === targetId);
  if (!layer) return null;
  const videoFields = !audioTarget && VIDEO_STAGE_FIELDS[stage];
  const fields = audioTarget ? AUDIO_FIELDS : videoFields || ['generationStatus'];
  if (audioTarget) {
    if (normalizeStatus(readField(layer, 'generationStatus')) === 'COMPLETED' && hasAudioOutput(layer)) return null;
  } else if (videoFields) {
    const [status, hasOutput, local, remote] = videoFields;
    if (normalizeStatus(readField(layer, status)) === 'COMPLETED' && readField(layer, hasOutput) === true &&
        (normalizeString(readField(layer, local)) || normalizeString(readField(layer, remote)))) return null;
  } else if (normalizeStatus(generationStatus[stage]) === 'COMPLETED') {
    return null;
  }
  return { marker, layer, fields, collection, targetField: audioTarget ? 'audioLayerId' : 'layerId' };
}

/** Compare current ownership and result fields so late success/user controls win. */
export function buildProviderNetworkFailureGuard(session, failure) {
  const { marker, layer, fields, collection, targetField } = failure;
  const layerMatch = { _id: layer._id };
  for (const field of fields) {
    const value = readField(layer, field);
    layerMatch[field] = snapshotFieldGuard(value);
  }
  const stageState = readField(session, 'expressGenerationStatus')?.[marker.stage];
  const filter = {
    _id: session._id,
    expressGenerationPending: true,
    expressGenerationPaused: { $ne: true },
    expressGenerationCancelled: { $ne: true },
    expressGenerationFailed: { $ne: true },
    'providerNetworkFailure.code': marker.code,
    'providerNetworkFailure.stage': marker.stage,
    [`providerNetworkFailure.${targetField}`]: marker[targetField],
    [`expressGenerationStatus.${marker.stage}`]: stageState === undefined ? { $exists: false } : stageState,
    [collection]: { $elemMatch: layerMatch },
  };
  for (const key of ['requestId', 'providerRequestId', 'failedAt']) {
    if (marker[key] !== undefined) filter[`providerNetworkFailure.${key}`] = marker[key];
  }
  return filter;
}
