import { useCallback, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CommonContainer from '../../src/components/common/CommonContainer.tsx';
import CanvasControlBar from '../../src/components/video/toolbars/CanvasControlBar.jsx';
import PreviewPlaybackController from '../../src/components/video/PreviewPlaybackController.jsx';
import VideoUnderlay from '../../src/components/video/util/VideoUnderlay.jsx';
import { StudioFrameRateContext } from '../../src/components/video/StudioFrameRateContext.jsx';
import { NavCanvasControlProvider } from '../../src/contexts/NavCanvasControlContext.jsx';

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../src/components/common/TopNav.tsx', () => ({ default: props => <CanvasControlBar {...props} /> }));
vi.mock('../../src/components/video/toolbars/RenderActionButton.jsx', () => ({ default: () => null }));

let callbacks;
let clock;
let ready;
let paused;
const noAudio = [];
const dimensions = { width: 400, height: 300 };
const browserStorage = { localStorage: window.localStorage, sessionStorage: window.sessionStorage };

beforeEach(() => {
  callbacks = new Map();
  clock = 0;
  ready = new WeakSet();
  paused = new WeakMap();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn(callback => { callbacks.set(++id, callback); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn(key => callbacks.delete(key)));
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockImplementation(function () { return ready.has(this) ? 4 : 0; });
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(2);
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(function () { return paused.get(this) ?? true; });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function () { paused.set(this, false); return Promise.resolve(); });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function () { paused.set(this, true); });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('localStorage', browserStorage.localStorage);
  vi.stubGlobal('sessionStorage', browserStorage.sessionStorage);
});

function Preview() {
  const [playing, setPlaying] = useState(false);
  const [active, setActive] = useState(false);
  const [seek, setSeek] = useState(0);
  const [readySource, setReadySource] = useState('');
  const onReady = useCallback((source, isReady) => setReadySource(isReady ? source : ''), []);
  const source = seek < 48 ? '/first.mp4' : '/second.mp4';
  return <NavCanvasControlProvider><StudioFrameRateContext.Provider value={24}>
    <CommonContainer isVideoPreviewPlaying={playing} setIsVideoPreviewPlaying={setPlaying}>
      <output data-testid="seek">{seek}</output>
      <input aria-label="Caption" />
      <textarea aria-label="Prompt" />
      <div role="textbox" contentEditable suppressContentEditableWarning>Text</div>
      <VideoUnderlay aiVideoLayer={source} nextAiVideoLayer={seek < 48 ? '/second.mp4' : null}
        currentLayerSeek={(seek % 48) / 24} isVideoPreviewPlaying={active}
        canvasDimensions={dimensions} onVideoReadyChange={onReady} />
      <PreviewPlaybackController audioLayers={noAudio} currentLayerSeek={seek} framesPerSecond={24}
        totalDuration={4} isVideoPreviewPlaying={playing} isVisualReady={readySource === source}
        setCurrentLayerSeek={setSeek} setIsVideoPreviewPlaying={setPlaying} onPlaybackActiveChange={setActive} />
    </CommonContainer>
  </StudioFrameRateContext.Provider></NavCanvasControlProvider>;
}

const frame = () => Number(screen.getByTestId('seek').textContent);
async function tick(elapsed = 100) {
  clock += elapsed;
  const pending = [...callbacks.values()];
  callbacks.clear();
  await act(async () => { pending.forEach(callback => callback(clock)); });
}
async function load(video) {
  await act(async () => { ready.add(video); fireEvent.loadedData(video); });
}
async function pressSpace(target = window, extra = {}) {
  const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true, ...extra });
  if (extra.defaultPrevented) event.preventDefault();
  await act(async () => { fireEvent(target, event); });
}
const activeVideo = container => container.querySelector('video[aria-hidden="false"]');

it('starts and pauses via click and Space, reuses the next video, and replays after the end', async () => {
  const { container } = render(<Preview />);
  const first = activeVideo(container);
  // Only the active video loads until its first frame is decoded.
  expect([...container.querySelectorAll('video[src]')]).toHaveLength(1);
  await load(first);
  const next = [...container.querySelectorAll('video')].find(video => video !== first);
  expect(next).toHaveAttribute('src', '/second.mp4');
  expect(next).toHaveAttribute('preload', 'auto');
  await load(next);
  await act(async () => { fireEvent.click(screen.getByTitle('Play')); });
  await tick();
  expect(frame()).toBe(2);
  expect(first.paused).toBe(false);
  expect(next.paused).toBe(true);
  await act(async () => { fireEvent.click(screen.getByTitle('Pause')); });
  await tick();
  expect(frame()).toBe(2);
  expect(first.paused).toBe(true);
  await pressSpace();
  await tick(2000);
  expect(activeVideo(container)).toBe(next);
  await tick();
  expect(next.paused).toBe(false);
  expect(first.paused).toBe(true);
  await pressSpace();
  const pausedFrame = frame();
  await tick();
  expect(frame()).toBe(pausedFrame);
  expect(next.paused).toBe(true);
  await pressSpace();
  await tick(3000);
  expect(frame()).toBe(95);
  expect(screen.getByTitle('Play')).toBeTruthy();
  await pressSpace();
  await tick();
  await tick();
  expect(frame()).toBeLessThan(10);
  expect(activeVideo(container)).toHaveAttribute('src', '/first.mp4');
});

it('can cancel playback while buffering without starting when the video becomes ready', async () => {
  const { container } = render(<Preview />);
  await pressSpace();
  await tick(5000);
  expect(frame()).toBe(0);
  await pressSpace();
  await load(activeVideo(container));
  await tick();
  expect(frame()).toBe(0);
  expect(activeVideo(container).paused).toBe(true);
  await pressSpace();
  await tick();
  expect(frame()).toBe(2);
});

it('ignores Space in editable fields and with keyboard modifiers', async () => {
  render(<Preview />);
  for (const target of screen.getAllByRole('textbox')) await pressSpace(target);
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) await pressSpace(window, { [modifier]: true });
  expect(screen.getByTitle('Play')).toBeTruthy();
  expect(callbacks.size).toBe(0);
});

it('toggles once when Space is held and respects events already handled by another control', async () => {
  render(<Preview />);
  await pressSpace(window, { defaultPrevented: true });
  expect(screen.getByTitle('Play')).toBeTruthy();
  await pressSpace();
  await pressSpace(window, { repeat: true });
  expect(screen.getByTitle('Pause')).toBeTruthy();
});

it('does not toggle the background preview when Space is used inside a dialog', async () => {
  render(<Preview />);
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  document.body.appendChild(dialog);
  try {
    await pressSpace(dialog);
    expect(screen.getByTitle('Play')).toBeTruthy();
    expect(callbacks.size).toBe(0);
  } finally { dialog.remove(); }
});
