import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { page } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import ProgressIndicator from '../../src/components/oneshot_editor/ProgressIndicator.jsx';
import clipUrl from '../fixtures/studio-preview.webm?url';
import toneUrl from '../fixtures/vidgenie-preview-tone.wav?url';

vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'light' }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: null }) }));

// The video fixture has no audio. This deterministic 440Hz PCM fixture exercises
// the browser's real audio decoder and playback clock alongside each scene.
function mediaUrl(source, scene, token) {
  const url = new URL(source, window.location.href);
  url.searchParams.set('scene', scene);
  url.searchParams.set('asset_token', token);
  return url.toString();
}

function status(id, token = 'initial') {
  return {
    session_id: id,
    session: {
      id,
      aspectRatio: '16:9',
      duration: 4,
      stages: { image_generation: 'COMPLETED', speech_generation: 'COMPLETED', video_generation: 'PENDING' },
      layers: ['one', 'two'].map((scene, index) => ({
        id: scene,
        startTime: index * 2,
        duration: 2,
        aiVideo: { status: 'COMPLETED', url: mediaUrl(clipUrl, scene, token) },
      })),
      audioLayers: ['one', 'two'].map((scene, index) => ({
        id: `speech-${scene}`,
        type: 'speech',
        status: 'COMPLETED',
        isEnabled: true,
        volume: 100,
        startTime: index * 2,
        duration: 2,
        url: mediaUrl(toneUrl, scene, token),
      })),
    },
  };
}

function view(generationStatusDetails) {
  return <LocalizationProvider><ProgressIndicator isGenerationPending generationStatusDetails={generationStatusDetails} /></LocalizationProvider>;
}

const video = container => container.querySelector('video');
const audio = (container, scene) => [...container.querySelectorAll('audio')]
  .find(element => new URL(element.src).searchParams.get('scene') === scene);
const timeline = () => screen.getByRole('slider', { name: 'Preview timeline' });

async function startPreview(container) {
  await waitFor(() => expect(video(container)?.readyState).toBeGreaterThanOrEqual(2));
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  await page.getByRole('button', { name: 'Unmute preview audio', exact: true }).click();
  await waitFor(() => {
    expect(audio(container, 'one').paused).toBe(false);
    expect(audio(container, 'one').muted).toBe(false);
    expect(audio(container, 'one').volume).toBeGreaterThan(0);
    expect(audio(container, 'one').currentTime).toBeGreaterThan(0.1);
    expect(video(container).paused).toBe(false);
  });
}

it('plays audible scene audio and moves into the next scene while the final video renders', async () => {
  const { container } = render(view(status('vidgenie-scene-transition')));
  const firstAudio = audio(container, 'one');
  const secondAudio = audio(container, 'two');
  await startPreview(container);
  const firstVideo = video(container);
  const initialAudioTime = firstAudio.currentTime;
  await waitFor(() => expect(firstAudio.currentTime).toBeGreaterThan(initialAudioTime + 0.15));
  await waitFor(() => {
    expect(video(container)).not.toBe(firstVideo);
    expect(new URL(video(container).src).searchParams.get('scene')).toBe('two');
    expect(Number(timeline().value)).toBeGreaterThanOrEqual(2);
    expect(video(container).paused).toBe(false);
    expect(secondAudio.paused).toBe(false);
    expect(secondAudio.muted).toBe(false);
    expect(secondAudio.volume).toBeGreaterThan(0);
    expect(secondAudio.currentTime).toBeGreaterThan(0.1);
    expect(firstAudio.paused).toBe(true);
  }, { timeout: 5000 });
  await page.getByRole('button', { name: 'Pause preview', exact: true }).click();
});

it('keeps the loaded media and playback position when status polls rotate asset tokens', async () => {
  const id = 'vidgenie-credential-refresh';
  const { container, rerender } = render(view(status(id)));
  await startPreview(container);
  const loadedVideo = video(container);
  const loadedAudio = audio(container, 'one');
  const loadedVideoSource = loadedVideo.src;
  const loadedAudioSource = loadedAudio.src;
  let videoEmptied = 0;
  let audioEmptied = 0;
  loadedVideo.addEventListener('emptied', () => { videoEmptied += 1; });
  loadedAudio.addEventListener('emptied', () => { audioEmptied += 1; });
  const videoTime = loadedVideo.currentTime;
  const audioTime = loadedAudio.currentTime;
  for (const token of ['second-grant', 'third-grant', 'fourth-grant']) {
    rerender(view(status(id, token)));
    expect(video(container)).toBe(loadedVideo);
    expect(audio(container, 'one')).toBe(loadedAudio);
    expect(loadedVideo.src).toBe(loadedVideoSource);
    expect(loadedAudio.src).toBe(loadedAudioSource);
  }
  await waitFor(() => {
    expect(loadedVideo.currentTime).toBeGreaterThan(videoTime + 0.15);
    expect(loadedAudio.currentTime).toBeGreaterThan(audioTime + 0.15);
  });
  expect(videoEmptied).toBe(0);
  expect(audioEmptied).toBe(0);
  expect(loadedVideo.paused).toBe(false);
  expect(loadedAudio.paused).toBe(false);
  await page.getByRole('button', { name: 'Pause preview', exact: true }).click();
});

it('pauses, resumes and scrubs both real scene media clocks', async () => {
  const { container } = render(view(status('vidgenie-playback-controls')));
  await startPreview(container);
  await page.getByRole('button', { name: 'Pause preview', exact: true }).click();
  await waitFor(() => {
    expect(video(container).paused).toBe(true);
    expect(audio(container, 'one').paused).toBe(true);
  });
  const pausedTime = Number(timeline().value);
  fireEvent.change(timeline(), { target: { value: '2.5' } });
  await waitFor(() => {
    expect(new URL(video(container).src).searchParams.get('scene')).toBe('two');
    expect(video(container).readyState).toBeGreaterThanOrEqual(2);
    expect(video(container).currentTime).toBeCloseTo(0.5, 1);
    expect(audio(container, 'two').currentTime).toBeCloseTo(0.5, 1);
    expect(video(container).paused).toBe(true);
    expect(audio(container, 'two').paused).toBe(true);
    expect(Number(timeline().value)).toBe(2.5);
  });
  expect(pausedTime).toBeLessThan(2);
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  await waitFor(() => {
    expect(Number(timeline().value)).toBeGreaterThan(2.5);
    expect(video(container).currentTime).toBeGreaterThan(0.6);
    expect(audio(container, 'two').currentTime).toBeGreaterThan(0.6);
    expect(audio(container, 'two').muted).toBe(false);
    expect(audio(container, 'one').paused).toBe(true);
  });
  await page.getByRole('button', { name: 'Pause preview', exact: true }).click();
});
