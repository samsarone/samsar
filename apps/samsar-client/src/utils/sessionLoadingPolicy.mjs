import { getStudioMediaIdentity } from '../components/video/util/studioMediaIdentity.mjs';

// A refreshed credential is not a newly generated scene. Include the route and
// timeline placement so changes of media, scene order, or duration still refresh.
export function getTimelineVideoRevision(data) {
  const session = data?.session || {};
  const layers = Array.isArray(session.layers) ? session.layers : [];
  const videos = Array.isArray(session.globalVideos) ? session.globalVideos : [];
  const media = layers.map((layer) => [
    layer.id || layer._id, layer.startTime, layer.duration, layer.endTime,
    ...[layer.aiVideo?.url, layer.lipSyncVideo?.url, layer.soundEffectVideo?.url,
      layer.userVideo?.url, layer.preview?.type === 'video' ? layer.preview.url : null]
      .map((url) => url ? getStudioMediaIdentity(url) : ''),
  ]);
  const globalMedia = videos.map((video) => [
    video.id || video._id, video.startTime, video.duration,
    video.url ? getStudioMediaIdentity(video.url) : '',
  ]);
  if (!media.some((row) => row.slice(4).some(Boolean)) && !globalMedia.some((row) => row[3])) return '';
  return JSON.stringify([session.id || session._id || data?.session_id || data?.request_id, media, globalMedia]);
}

export function selectPreviewPreloadSegments(segments, activeKey, { hidden = false, limitVideo = false } = {}) {
  if (hidden || !segments.length) return [];
  const current = Math.max(0, segments.findIndex((segment) => segment.key === activeKey));
  return segments.slice(current, current + 3).filter((segment) => (
    // The mounted active video already buffers itself and reports readiness.
    segment.type !== 'video' || (!limitVideo && segment.key !== activeKey)
  ));
}

export function canFallbackToVideoStatus(error) {
  return [400, 404].includes(error?.response?.status);
}
