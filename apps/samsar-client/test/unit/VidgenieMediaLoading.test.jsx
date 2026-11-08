import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import ProgressIndicator from '../../src/components/oneshot_editor/ProgressIndicator.jsx';
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'light' }) }));

let loads;
let fetchSpy;
const OriginalImage = globalThis.Image;
beforeEach(() => {
  loads = [];
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(function () { if (this.src) loads.push(this); });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, blob: async () => new Blob(['clip']) });
});
afterEach(() => { globalThis.Image = OriginalImage; });
function status(sessionId = 'session') {
  return { session_id: sessionId, session: { id: sessionId, aspectRatio: '9:16', layers: Array.from({ length: 12 }, (_, i) => ({
    id: `scene-${i}`, startTime: i * 5, duration: 5,
    aiVideo: { url: `https://media.example/${sessionId}/clip-${i}.mp4` },
    preview: { type: 'video', url: `https://media.example/${sessionId}/clip-${i}.mp4` },
  })) } };
}
function view(props) {
  return <LocalizationProvider><ProgressIndicator {...props} /></LocalizationProvider>;
}
it('completed results do not preload hidden scene clips or fetch blobs', async () => {
  const { container } = render(view({ videoLink: 'https://media.example/final.mp4', generationStatusDetails: status() }));
  await act(async () => {});
  expect(loads).toHaveLength(0);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(container.querySelectorAll('video')).toHaveLength(1);
  expect(container.querySelector('video')).toHaveAttribute('preload', 'metadata');
});
it('pending post-processing previews also avoid loading the hidden timeline', async () => {
  render(view({ isGenerationPending: true, pendingPreviewVideoLink: 'https://media.example/previous.mp4', generationStatusDetails: status() }));
  await act(async () => {});
  expect(loads).toHaveLength(0);
  expect(fetchSpy).not.toHaveBeenCalled();
});
it('loads only nearby clips, keeps stable polls from restarting downloads, and cancels on unmount', async () => {
  const props = { isGenerationPending: true, generationStatusDetails: status('pending') };
  const { rerender, unmount } = render(view(props));
  await act(async () => {});
  expect(loads).toHaveLength(2);
  expect(loads.map(video => video.src)).toEqual([
    'https://media.example/pending/clip-1.mp4', 'https://media.example/pending/clip-2.mp4',
  ]);
  rerender(view({ ...props, generationStatusDetails: status('pending') }));
  await act(async () => {});
  expect(loads).toHaveLength(2);
  unmount();
  expect(loads.every(video => !video.getAttribute('src'))).toBe(true);
  expect(fetchSpy).not.toHaveBeenCalled();
});
it('cancels image downloads when switching from timeline to completed result', async () => {
  const images = [];
  const NativeImage = globalThis.Image;
  globalThis.Image = class extends NativeImage { constructor() { super(); images.push(this); } };
  const rawSessionDetails = { _id: 'image-session', aspectRatio: '9:16', layers: Array.from({ length: 8 }, (_, i) => ({
    _id: `image-${i}`, duration: 5, durationOffset: i * 5,
    imageSession: { activeGeneratedImage: `https://media.example/image-${i}.png` },
  })) };
  const { rerender, container } = render(view({ isGenerationPending: true, rawSessionDetails }));
  expect(images).toHaveLength(3);
  rerender(view({ videoLink: 'https://media.example/final.mp4', rawSessionDetails }));
  await act(async () => {});
  expect(images.every(image => !image.getAttribute('src'))).toBe(true);
  expect(container.querySelector('.vidgenie-preview-frame')).toHaveStyle({ aspectRatio: '9 / 16' });
});
