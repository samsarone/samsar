import { describe, expect, it } from 'vitest';
import { canFallbackToVideoStatus, getTimelineVideoRevision, selectPreviewPreloadSegments } from '../../src/utils/sessionLoadingPolicy.mjs';

describe('session loading policy', () => {
  const status = (url = 'https://media.example/clip.mp4?asset_token=old') => ({
    session_id: 'session', session: { layers: [{ id: 'scene', startTime: 0, duration: 5, aiVideo: { url } }] },
  });
  it('refreshes for changed scene media or timing, but not credential rotation', () => {
    const original = getTimelineVideoRevision(status());
    expect(getTimelineVideoRevision(status('https://media.example/clip.mp4?asset_token=new'))).toBe(original);
    expect(getTimelineVideoRevision(status('https://media.example/new.mp4'))).not.toBe(original);
    const moved = status(); moved.session.layers[0].startTime = 5;
    expect(getTimelineVideoRevision(moved)).not.toBe(original);
    expect(getTimelineVideoRevision({ session: { layers: [{ id: 'image', image: { url: '/image.png' } }] } })).toBe('');
  });
  it('bounds preloading to nearby scenes and leaves the active video to its mounted element', () => {
    const segments = Array.from({ length: 20 }, (_, i) => ({ key: String(i), type: i % 2 ? 'image' : 'video' }));
    expect(selectPreviewPreloadSegments(segments, '2').map(s => s.key)).toEqual(['3', '4']);
    expect(selectPreviewPreloadSegments(segments, '2', { limitVideo: true }).map(s => s.key)).toEqual(['3']);
    expect(selectPreviewPreloadSegments(segments, '2', { hidden: true })).toEqual([]);
    expect(selectPreviewPreloadSegments(segments, '19').map(s => s.key)).toEqual(['19']);
  });
  it('only falls back for compatible unsupported/missing-session responses', () => {
    for (const status of [400, 404]) expect(canFallbackToVideoStatus({ response: { status } })).toBe(true);
    for (const status of [401, 403, 429, 500, 503]) expect(canFallbackToVideoStatus({ response: { status } })).toBe(false);
    expect(canFallbackToVideoStatus(new Error('offline'))).toBe(false);
  });
});
