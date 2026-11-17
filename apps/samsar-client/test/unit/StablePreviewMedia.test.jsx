import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStablePreviewMedia } from '../../src/components/oneshot_editor/useStablePreviewMedia.js';

function segment(url, overrides = {}) {
  return { key: 'scene', url, startTime: 0, endTime: 5, status: 'COMPLETED', ...overrides };
}

function mount(initialSegments, initialScope = 'project') {
  return renderHook(({ incoming, scope }) => useStablePreviewMedia(incoming, scope), {
    initialProps: { incoming: initialSegments, scope: initialScope },
  });
}

describe('stable Vidgenie preview sources', () => {
  it('keeps mounted sources through private and CloudFront credential rotation', () => {
    const original = [
      segment('/assets/scene.mp4?version=1&asset_token=original'),
      segment('https://cdn.example/speech.wav?Expires=1&Signature=old&Key-Pair-Id=key', { key: 'speech' }),
    ];
    const { result, rerender } = mount(original);
    const refreshSource = result.current.refreshSource;
    rerender({ incoming: [
      segment('/assets/scene.mp4?version=1&asset_token=renewed'),
      segment('https://cdn.example/speech.wav?Expires=2&Signature=new&Key-Pair-Id=key', { key: 'speech' }),
    ], scope: 'project' });
    expect(result.current.segments.map((value) => value.url)).toEqual(original.map((value) => value.url));
    expect(result.current.refreshSource).toBe(refreshSource);
  });

  it('uses current timing and status while keeping the existing media source', () => {
    const originalUrl = '/assets/scene.mp4?asset_token=original';
    const { result, rerender } = mount([segment(originalUrl)]);
    rerender({ incoming: [segment('/assets/scene.mp4?asset_token=renewed', {
      startTime: 3, endTime: 10, status: 'READY', title: 'Updated scene', sourceTrimStartTime: 2,
    })], scope: 'project' });
    expect(result.current.segments).toEqual([segment(originalUrl, {
      startTime: 3, endTime: 10, status: 'READY', title: 'Updated scene', sourceTrimStartTime: 2,
    })]);
  });

  it('replaces media immediately when its content version or asset changes', () => {
    const { result, rerender } = mount([segment('/assets/scene.mp4?version=1&asset_token=original')]);
    const updated = segment('/assets/scene.mp4?version=2&asset_token=renewed');
    rerender({ incoming: [updated], scope: 'project' });
    expect(result.current.segments[0]).toBe(updated);
    const replaced = segment('/assets/replacement.mp4?asset_token=latest');
    rerender({ incoming: [replaced], scope: 'project' });
    expect(result.current.segments[0]).toBe(replaced);
    expect(result.current.refreshSource('scene')).toBe(false);
  });

  it('retries with the newest grant only when it differs from the assigned source', () => {
    const originalUrl = '/assets/scene.mp4?asset_token=original';
    const latestUrl = '/assets/scene.mp4?asset_token=latest';
    const { result, rerender } = mount([segment(originalUrl)]);
    rerender({ incoming: [segment('/assets/scene.mp4?asset_token=intermediate')], scope: 'project' });
    rerender({ incoming: [segment(latestUrl)], scope: 'project' });
    expect(result.current.segments[0].url).toBe(originalUrl);
    let refreshed;
    act(() => { refreshed = result.current.refreshSource('scene'); });
    expect(refreshed).toBe(true);
    expect(result.current.segments[0].url).toBe(latestUrl);
    expect(result.current.refreshSource('scene')).toBe(false);
    expect(result.current.refreshSource('missing')).toBe(false);
  });

  it('retries failed media when the first renewed grant arrives after the error', () => {
    const originalUrl = '/assets/scene.mp4?asset_token=original';
    const renewedUrl = '/assets/scene.mp4?asset_token=renewed';
    const { result, rerender } = mount([segment(originalUrl)]);
    expect(result.current.refreshSource('scene')).toBe(false);
    rerender({ incoming: [segment(originalUrl)], scope: 'project' });
    expect(result.current.segments[0].url).toBe(originalUrl);
    rerender({ incoming: [segment(renewedUrl)], scope: 'project' });
    expect(result.current.segments[0].url).toBe(renewedUrl);
    rerender({ incoming: [segment('/assets/scene.mp4?asset_token=later')], scope: 'project' });
    expect(result.current.segments[0].url).toBe(renewedUrl);
  });

  it('does not replace a failed source repeatedly until another grant is available', () => {
    const originalUrl = '/assets/scene.mp4?asset_token=original';
    const { result, rerender } = mount([segment(originalUrl)]);
    expect(result.current.refreshSource('scene')).toBe(false);
    for (let poll = 0; poll < 3; poll += 1) {
      rerender({ incoming: [segment(originalUrl)], scope: 'project' });
      expect(result.current.segments[0].url).toBe(originalUrl);
      expect(result.current.refreshSource('scene')).toBe(false);
    }
    const renewedUrl = '/assets/scene.mp4?asset_token=renewed';
    rerender({ incoming: [segment(renewedUrl)], scope: 'project' });
    expect(result.current.segments[0].url).toBe(renewedUrl);
  });

  it('discards removed segments and does not retain their old sources when re-added', () => {
    const { result, rerender } = mount([segment('/assets/scene.mp4?asset_token=original')]);
    rerender({ incoming: [], scope: 'project' });
    expect(result.current.segments).toEqual([]);
    expect(result.current.refreshSource('scene')).toBe(false);
    const replacement = segment('/assets/scene.mp4?asset_token=readded');
    rerender({ incoming: [replacement], scope: 'project' });
    expect(result.current.segments[0]).toBe(replacement);
  });

  it('isolates retained grants by project and by mounted hook', () => {
    const originalUrl = '/assets/scene.mp4?asset_token=original';
    const nextUrl = '/assets/scene.mp4?asset_token=next-project';
    const { result, rerender, unmount } = mount([segment(originalUrl)]);
    rerender({ incoming: [segment(nextUrl)], scope: 'other-project' });
    expect(result.current.segments[0].url).toBe(nextUrl);
    rerender({ incoming: [segment(originalUrl)], scope: 'project' });
    expect(result.current.segments[0].url).toBe(originalUrl);
    unmount();
    const remounted = mount([segment(nextUrl)]);
    expect(remounted.result.current.segments[0].url).toBe(nextUrl);
  });
});
