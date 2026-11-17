import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import ProgressIndicator from '../../src/components/oneshot_editor/ProgressIndicator.jsx';

vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'light' }) }));

let mediaStates;
let playSpy;

function state(element) {
  if (!mediaStates.has(element)) {
    mediaStates.set(element, { readyState: 0, paused: true, time: 0, startedAt: Date.now(), seeks: [] });
  }
  return mediaStates.get(element);
}

function mediaTime(element) {
  const value = state(element);
  return value.time + (!value.paused && value.readyState >= 3 ? (Date.now() - value.startedAt) / 1000 : 0);
}

function setReady(element, readyState, event = 'canplay') {
  const value = state(element);
  value.time = mediaTime(element);
  value.startedAt = Date.now();
  value.readyState = readyState;
  fireEvent(element, new Event(event));
}

beforeEach(() => {
  vi.useFakeTimers();
  mediaStates = new WeakMap();
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockImplementation(function () { return state(this).readyState; });
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function () { return state(this).paused; });
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(function () { return mediaTime(this); });
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation(function (time) {
    const value = state(this);
    value.time = time;
    value.startedAt = Date.now();
    value.seeks.push(time);
  });
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () {
    const value = state(this);
    value.time = mediaTime(this);
    value.startedAt = Date.now();
    value.paused = true;
  });
  playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () {
    const value = state(this);
    if (value.paused) value.startedAt = Date.now();
    value.paused = false;
    return Promise.resolve();
  });
});

function status(sessionId = 'audio-preview', sceneCount = 8) {
  return {
    session_id: sessionId,
    current_step: 'video_generation',
    session: {
      id: sessionId,
      duration: sceneCount * 2,
      layers: [],
      audioLayers: Array.from({ length: sceneCount }, (_, index) => ({
        id: `speech-${index}`, type: 'speech', status: 'COMPLETED',
        startTime: index * 2, duration: 2,
        url: `https://media.example/${sessionId}/speech-${index}.mp3`,
      })),
    },
  };
}

function view(generationStatusDetails) {
  return <LocalizationProvider><ProgressIndicator isGenerationPending generationStatusDetails={generationStatusDetails} /></LocalizationProvider>;
}

function timelineTime() {
  return Number(screen.getByRole('slider', { name: 'Preview timeline' }).value);
}

async function advance(milliseconds) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 50) {
    await act(async () => { vi.advanceTimersByTime(Math.min(50, milliseconds - elapsed)); });
  }
}

function startAudiblePreview() {
  fireEvent.click(screen.getByRole('button', { name: 'Unmute preview audio' }));
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
}

it('buffers a bounded group of upcoming speech clips before they become active', async () => {
  const { container } = render(view(status('preload')));
  const audio = [...container.querySelectorAll('audio')];
  expect(audio[0]).toHaveAttribute('preload', 'auto');
  expect(audio[1]).toHaveAttribute('preload', 'auto');
  expect(audio.filter(element => element.preload === 'auto').length).toBeLessThanOrEqual(4);
  expect(audio.at(-1)).toHaveAttribute('preload', 'none');
  setReady(audio[0], 3);
  startAudiblePreview();
  await act(async () => {});
  expect(playSpy.mock.contexts).not.toContain(audio.at(-1));
});

it('unlocks every Safari speech element during the initial gesture while keeping distant preload disabled', async () => {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
  );
  const { container } = render(view(status('safari-unlock')));
  const audio = [...container.querySelectorAll('audio')];
  const distantSpeech = audio.at(-1);
  expect(distantSpeech).toHaveAttribute('preload', 'none');
  setReady(audio[0], 3);
  startAudiblePreview();
  // This call must occur synchronously in the gesture, before promise callbacks.
  expect(playSpy.mock.contexts).toContain(distantSpeech);
  expect(distantSpeech).toHaveAttribute('preload', 'none');
  await act(async () => {});
  expect(distantSpeech.paused).toBe(true);
});

it('holds the audible playhead at metadata-only audio and resumes when samples can play', async () => {
  const { container } = render(view(status('readiness')));
  const audio = container.querySelector('audio');
  setReady(audio, 1, 'loadedmetadata');
  startAudiblePreview();
  await advance(1000);
  expect(timelineTime()).toBe(0);
  setReady(audio, 3);
  await advance(500);
  expect(timelineTime()).toBeGreaterThan(0);
});

it('pauses on audio buffering without repeatedly seeking and resumes the same scene', async () => {
  const { container } = render(view(status('buffering')));
  const audio = container.querySelector('audio');
  setReady(audio, 3);
  startAudiblePreview();
  await advance(750);
  expect(timelineTime()).toBeGreaterThan(0);
  setReady(audio, 1, 'waiting');
  const stoppedAt = timelineTime();
  const seeksAtBuffering = state(audio).seeks.length;
  await advance(1000);
  expect(timelineTime()).toBe(stoppedAt);
  expect(audio.paused).toBe(true);
  expect(state(audio).seeks.length).toBe(seeksAtBuffering);
  setReady(audio, 3);
  await advance(500);
  expect(timelineTime()).toBeGreaterThan(stoppedAt);
  expect(timelineTime()).toBeLessThan(2);
});

it('advances from one scene speech clip to the next without replaying the previous speech', async () => {
  const { container } = render(view(status('transition')));
  const audio = [...container.querySelectorAll('audio')];
  audio.forEach(element => setReady(element, 3));
  startAudiblePreview();
  await advance(2300);
  expect(timelineTime()).toBeGreaterThanOrEqual(2);
  expect(timelineTime()).toBeLessThan(3);
  expect(audio[0].paused).toBe(true);
  expect(audio[1].paused).toBe(false);
});

it('keeps the preview clock moving when fresh status polls arrive between timer ticks', async () => {
  const { rerender } = render(view(status('polling')));
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  for (let poll = 0; poll < 10; poll += 1) {
    await advance(100);
    rerender(view(status('polling')));
  }
  expect(timelineTime()).toBeGreaterThanOrEqual(0.75);
});

function videoStatus(sessionId, token) {
  const details = status(sessionId);
  const url = `https://media.example/${sessionId}/scene.mp4?asset_token=${token}`;
  details.session.layers = [{ id: 'scene', startTime: 0, duration: 16, aiVideo: { url }, preview: { type: 'video', url } }];
  details.session.audioLayers = details.session.audioLayers.map(layer => ({ ...layer, url: `${layer.url}?asset_token=${token}` }));
  return details;
}

it('retains mounted scene media and playback when polling only rotates delivery credentials', async () => {
  const { container, rerender } = render(view(videoStatus('credentials', 'old')));
  const video = container.querySelector('video');
  const audio = container.querySelector('audio');
  setReady(video, 3);
  setReady(audio, 3);
  startAudiblePreview();
  await advance(500);
  const previousAudioSource = audio.getAttribute('src');
  const previousAudioTime = audio.currentTime;
  rerender(view(videoStatus('credentials', 'refreshed')));
  expect(container.querySelector('video')).toBe(video);
  expect(container.querySelector('audio')).toBe(audio);
  expect(audio.getAttribute('src')).toBe(previousAudioSource);
  expect(audio.currentTime).toBeGreaterThanOrEqual(previousAudioTime);
});

it('does not restart the preview timer for repeated video readiness events', async () => {
  const { container } = render(view(videoStatus('ready-events', 'token')));
  const video = container.querySelector('video');
  setReady(video, 3);
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  for (let event = 0; event < 10; event += 1) {
    await advance(100);
    setReady(video, 3);
  }
  expect(timelineTime()).toBeGreaterThanOrEqual(0.75);
});

it('reaches an unbuffered next image at the scene boundary and stops the previous speech', async () => {
  const details = videoStatus('image-boundary', 'token');
  details.session.layers[0].duration = 2;
  details.session.layers.push({
    id: 'next-image', startTime: 2, duration: 14,
    preview: { type: 'image', url: 'https://media.example/image-boundary/next.png' },
  });
  const { container } = render(view(details));
  setReady(container.querySelector('video'), 3);
  const audio = [...container.querySelectorAll('audio')];
  audio.forEach(element => setReady(element, 3));
  startAudiblePreview();
  await advance(2300);
  expect(timelineTime()).toBeGreaterThanOrEqual(2);
  expect(timelineTime()).toBeLessThan(2.1);
  expect(audio[0].paused).toBe(true);
  expect(audio[1].paused).toBe(true);
});

it('does not pause or rewind newly active speech when an earlier unlock promise resolves', async () => {
  const { container } = render(view(status('delayed-unlock')));
  const audio = [...container.querySelectorAll('audio')];
  audio.forEach(element => setReady(element, 3));
  const originalPlay = playSpy.getMockImplementation();
  let finishUnlock;
  let delayed = false;
  playSpy.mockImplementation(function () {
    const result = originalPlay.call(this);
    if (this === audio[1] && !delayed) {
      delayed = true;
      return new Promise(resolve => { finishUnlock = resolve; });
    }
    return result;
  });
  startAudiblePreview();
  expect(finishUnlock).toBeTypeOf('function');
  await advance(2300);
  expect(timelineTime()).toBeGreaterThanOrEqual(2);
  expect(audio[1].paused).toBe(false);
  const activeTime = audio[1].currentTime;
  const activeVolume = audio[1].volume;
  await act(async () => { finishUnlock(); });
  expect(audio[1].paused).toBe(false);
  expect(audio[1].currentTime).toBeGreaterThanOrEqual(activeTime);
  expect(audio[1].volume).toBe(activeVolume);
  expect(audio[1].muted).toBe(false);
});

it('retries failed video with the newest credentials retained from a status poll', async () => {
  const { container, rerender } = render(view(videoStatus('video-retry', 'old')));
  const originalVideo = container.querySelector('video');
  setReady(originalVideo, 3);
  const audio = container.querySelector('audio');
  setReady(audio, 3);
  startAudiblePreview();
  await advance(300);
  rerender(view(videoStatus('video-retry', 'new')));
  expect(container.querySelector('video')).toBe(originalVideo);
  expect(originalVideo.src).toContain('asset_token=old');
  fireEvent.error(originalVideo);
  const retriedVideo = container.querySelector('video');
  expect(retriedVideo.src).toContain('asset_token=new');
  setReady(retriedVideo, 3);
  const beforeResume = timelineTime();
  await advance(300);
  expect(timelineTime()).toBeGreaterThan(beforeResume);
});

it('retries failed speech with the newest credentials without changing unrelated media', async () => {
  const { container, rerender } = render(view(videoStatus('audio-retry', 'old')));
  const video = container.querySelector('video');
  const audio = container.querySelector('audio');
  setReady(video, 3);
  setReady(audio, 3);
  startAudiblePreview();
  await advance(300);
  rerender(view(videoStatus('audio-retry', 'new')));
  expect(audio.src).toContain('asset_token=old');
  fireEvent.error(audio);
  expect(container.querySelector('audio')).toBe(audio);
  expect(audio.src).toContain('asset_token=new');
  expect(container.querySelector('video')).toBe(video);
  expect(video.src).toContain('asset_token=old');
  setReady(audio, 3);
  const beforeResume = timelineTime();
  await advance(300);
  expect(timelineTime()).toBeGreaterThan(beforeResume);
});

it('holds speech and the playhead when video has a frame but is waiting for more samples', async () => {
  const { container } = render(view(videoStatus('video-buffering', 'token')));
  const video = container.querySelector('video');
  const audio = container.querySelector('audio');
  setReady(video, 3);
  setReady(audio, 3);
  startAudiblePreview();
  await advance(500);
  expect(timelineTime()).toBeGreaterThan(0);
  setReady(video, 2, 'waiting');
  const beforeBuffering = timelineTime();
  await advance(750);
  expect(timelineTime()).toBe(beforeBuffering);
  expect(audio.paused).toBe(true);
  expect(video.paused).toBe(true);
  setReady(video, 3);
  await advance(300);
  expect(timelineTime()).toBeGreaterThan(beforeBuffering);
  expect(audio.paused).toBe(false);
});

it('continues past a failed image instead of permanently holding its scene', async () => {
  const details = status('image-error');
  details.session.layers = [{
    id: 'failed-image', startTime: 0, duration: 16,
    preview: { type: 'image', url: 'https://media.example/image-error/missing.png' },
  }];
  const { container } = render(view(details));
  setReady(container.querySelector('audio'), 3);
  startAudiblePreview();
  await advance(300);
  expect(timelineTime()).toBe(0);
  fireEvent.error(container.querySelector('img'));
  await advance(300);
  expect(timelineTime()).toBeGreaterThan(0);
});

it('does not restart speech whose source ends before its timeline segment', async () => {
  const { container } = render(view(status('short-speech')));
  const audio = container.querySelector('audio');
  Object.defineProperty(audio, 'duration', { configurable: true, value: 1 });
  setReady(audio, 3);
  startAudiblePreview();
  await advance(950);
  const value = state(audio);
  value.time = 1;
  value.startedAt = Date.now();
  value.paused = true;
  fireEvent.ended(audio);
  const playsAtEnd = playSpy.mock.contexts.filter(element => element === audio).length;
  await advance(650);
  expect(timelineTime()).toBeGreaterThanOrEqual(1.5);
  expect(timelineTime()).toBeLessThan(2);
  expect(audio.paused).toBe(true);
  expect(playSpy.mock.contexts.filter(element => element === audio)).toHaveLength(playsAtEnd);
  expect(audio.currentTime).toBe(1);
});

it('does not restart a finished video while its longer scene window continues', async () => {
  const { container } = render(view(videoStatus('short-video', 'token')));
  const video = container.querySelector('video');
  Object.defineProperty(video, 'duration', { configurable: true, value: 1 });
  setReady(video, 3);
  fireEvent.click(screen.getByRole('button', { name: 'Play preview' }));
  await advance(950);
  const value = state(video);
  value.time = 1;
  value.startedAt = Date.now();
  value.paused = true;
  fireEvent.ended(video);
  const playsAtEnd = playSpy.mock.contexts.filter(element => element === video).length;
  await advance(650);
  expect(timelineTime()).toBeGreaterThanOrEqual(1.5);
  expect(video.paused).toBe(true);
  expect(playSpy.mock.contexts.filter(element => element === video)).toHaveLength(playsAtEnd);
  expect(video.currentTime).toBe(1);
});
