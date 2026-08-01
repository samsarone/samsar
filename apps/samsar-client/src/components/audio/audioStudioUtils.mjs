export const AUDIO_TYPE_MUSIC = 'music';
export const AUDIO_TYPE_SPEECH = 'speech';
export const AUDIO_TYPE_SOUND_EFFECT = 'sound_effect';

export const AUDIO_TYPE_LABELS = Object.freeze({
  [AUDIO_TYPE_MUSIC]: 'Music',
  [AUDIO_TYPE_SPEECH]: 'Speech',
  [AUDIO_TYPE_SOUND_EFFECT]: 'Sound effects',
});

export function normalizeAudioLibraryType(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (normalized === 'music' || normalized === 'background_music') return AUDIO_TYPE_MUSIC;
  if (
    normalized === 'speech' ||
    normalized === 'lip_sync' ||
    normalized === 'custom_speech' ||
    normalized === 'recorded_speech'
  ) {
    return AUDIO_TYPE_SPEECH;
  }
  return AUDIO_TYPE_SOUND_EFFECT;
}

export function resolveAudioStudioPath(item = {}) {
  const candidates = [
    item.playbackUrl,
    item.url,
    item.sourceUrl,
    item.selectedLocalAudioLink,
    ...(Array.isArray(item.localAudioLinks) ? item.localAudioLinks : []),
    item.selectedRemoteAudioLink,
    ...(Array.isArray(item.remoteAudioLinks) ? item.remoteAudioLinks : []),
    ...(Array.isArray(item.remoteAudioData)
      ? item.remoteAudioData.map((audioData) => audioData?.audio_url)
      : []),
  ];
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.trim())?.trim() || '';
}

function resolveAudioStudioPathUrl(audioPath, apiServer) {
  if (!audioPath || !apiServer) return audioPath || '';
  if (/^https?:\/\//i.test(audioPath) || audioPath.startsWith('blob:') || audioPath.startsWith('data:')) {
    return audioPath;
  }
  return `${apiServer.replace(/\/$/, '')}/${audioPath.replace(/^\/+/, '')}`;
}

export function resolveAudioStudioUrls(item = {}, apiServer) {
  const candidates = [
    item.playbackUrl,
    item.url,
    item.sourceUrl,
    item.selectedLocalAudioLink,
    ...(Array.isArray(item.localAudioLinks) ? item.localAudioLinks : []),
    item.selectedRemoteAudioLink,
    ...(Array.isArray(item.remoteAudioLinks) ? item.remoteAudioLinks : []),
    ...(Array.isArray(item.remoteAudioData)
      ? item.remoteAudioData.map((audioData) => audioData?.audio_url)
      : []),
  ];
  return Array.from(new Set(
    candidates
      .filter((candidate) => typeof candidate === 'string' && candidate.trim())
      .map((candidate) => resolveAudioStudioPathUrl(candidate.trim(), apiServer))
      .filter(Boolean)
  ));
}

export function resolveAudioStudioUrl(item, apiServer) {
  return resolveAudioStudioUrls(item, apiServer)[0] || '';
}

function getItemTimestamp(item = {}) {
  const timestamp = Date.parse(
    item.updatedAt ||
    item.createdAt ||
    item.generationMeta?.completedAt ||
    item.generationMeta?.joinedAt ||
    ''
  );
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function normalizeProjectGroups(groups, libraryType) {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap((group) => (
    Array.isArray(group?.items)
      ? group.items.map((item) => ({
          ...item,
          libraryType: normalizeAudioLibraryType(item?.libraryType || item?.generationType || libraryType),
          projectId: item?.projectId || item?.sessionId || group?.projectId || null,
          projectName: item?.projectName || group?.projectName || 'Audio Studio',
        }))
      : []
  ));
}

export function flattenAudioStudioArtifacts(globalArtifacts = {}) {
  const flattened = [
    ...normalizeProjectGroups(globalArtifacts.music, AUDIO_TYPE_MUSIC),
    ...normalizeProjectGroups(globalArtifacts.speech, AUDIO_TYPE_SPEECH),
    ...normalizeProjectGroups(globalArtifacts.soundEffect, AUDIO_TYPE_SOUND_EFFECT),
  ];
  const seen = new Set();
  return flattened
    .filter((item) => {
      const key = item?._id?.toString?.() || `${item?.projectId || ''}:${resolveAudioStudioPath(item)}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((leftItem, rightItem) => getItemTimestamp(rightItem) - getItemTimestamp(leftItem));
}

export function getAudioStudioItemId(item = {}) {
  return item?._id?.toString?.() || '';
}

export function formatAudioStudioDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return '--:--';
  const minutes = Math.floor(duration / 60);
  const seconds = Math.floor(duration % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
