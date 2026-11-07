import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
const boundary = vi.hoisted(() => ({ frame: null, editor: null, playback: null }));
const mock = vi.hoisted(() => ({ navigate: vi.fn(), toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, headers: { headers: { Authorization: 'test' } } }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'project' }), useNavigate: () => mock.navigate, useLocation: () => ({ pathname: '/video/project', search: '' }) }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => mock.headers }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: { _id: 'owner' } }) }));
vi.mock('../../src/components/common/CommonContainer.tsx', () => ({ default: p => <div>{p.children}</div> }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/index.jsx', () => ({ default: p => { boundary.frame = p; return null; } }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/FrameToolbarHorizontal.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/VideoEditorContainer.jsx', () => ({ default: p => { boundary.editor = p; return null; } }));
vi.mock('../../src/components/video/PreviewPlaybackController.jsx', () => ({ default: p => { boundary.playback = p; return null; } }));
vi.mock('../../src/components/assistant/AssistantHome.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/workers/imagePreloaderWorkerSingleton.jsx', () => ({ getImagePreloaderWorker: () => ({ postMessage() {} }) }));
vi.mock('react-toastify', () => ({ toast: mock.toast, ToastContainer: () => null }));
import VideoHome from '../../src/components/video/VideoHome.jsx';
import { NavCanvasControlProvider } from '../../src/contexts/NavCanvasControlContext.jsx';

const layer = (_id, offset = 0) => ({ _id, duration: 2, durationOffset: offset, imageSession: { activeItemList: [] } });
const initial = () => ({ _id: 'project', framesPerSecond: 24, totalDuration: 4, aspectRatio: '16:9', layers: [layer('one'), layer('two', 2)], audioLayers: [] });
beforeEach(() => {
  boundary.frame = boundary.editor = null;
  mock.headers = { headers: { Authorization: 'test' } };
  axios.get.mockReset().mockResolvedValue({ data: initial() });
  axios.post.mockReset();
});
async function mount() { render(<NavCanvasControlProvider><VideoHome /></NavCanvasControlProvider>); await waitFor(() => expect(boundary.frame).toBeTruthy()); }

it.each([
  ['16:9', 800, 600, 800 / 1792],
  ['9:16', 800, 600, 600 / 1792],
  ['1:1', 800, 600, 600 / 1024],
])('fits a %s session to the measured workspace', async (aspectRatio, width, height, scale) => {
  axios.get.mockResolvedValue({ data: { ...initial(), aspectRatio } });
  await mount();
  await act(async () => { boundary.editor.onCanvasViewportChange({ width, height }); });
  expect(boundary.editor.displayZoomType).toBe('fit');
  expect(boundary.editor.stageZoomScale).toBeCloseTo(scale);
  expect(boundary.editor.canvasZoomPercent).toBe(100);
});

it('updates Fit on resize, preserves manual zoom, and resets against the latest workspace', async () => {
  await mount();
  await act(async () => { boundary.editor.onCanvasViewportChange({ width: 896, height: 600 }); });
  expect(boundary.editor.stageZoomScale).toBe(0.5);
  await act(async () => { boundary.editor.onCanvasViewportChange({ width: 448, height: 400 }); });
  expect(boundary.editor.stageZoomScale).toBe(0.25);
  await act(async () => { boundary.editor.zoomCanvasIn(); });
  expect(boundary.editor.displayZoomType).toBe('manual');
  expect(boundary.editor.stageZoomScale).toBe(0.3125);
  expect(boundary.editor.canvasZoomPercent).toBe(125);
  await act(async () => { boundary.editor.onCanvasViewportChange({ width: 896, height: 600 }); });
  expect(boundary.editor.stageZoomScale).toBe(0.3125);
  await act(async () => { boundary.editor.resetCanvasZoom(); });
  expect(boundary.editor.displayZoomType).toBe('fit');
  expect(boundary.editor.stageZoomScale).toBe(0.5);
  expect(boundary.editor.canvasZoomPercent).toBe(100);
});

it('F2P: reorder adopts the processor audio placements and complete session snapshot', async () => {
  const updated = { ...initial(), layers: [layer('two'), layer('one', 2)], audioLayers: [
    { _id: 'speech', generationType: 'speech', isEnabled: true, startTime: 2, duration: 2, url: '/speech.wav' },
  ] };
  axios.post.mockResolvedValue({ data: updated });
  await mount();
  await act(async () => { boundary.frame.onLayersOrderChange(updated.layers, 'one'); });
  await waitFor(() => expect(boundary.frame.audioLayers).toMatchObject(updated.audioLayers));
  expect(boundary.editor.videoSessionDetails.layers).toEqual(updated.layers);
});

it('F2P: copy adopts the processor duration and connected audio', async () => {
  const updated = { ...initial(), totalDuration: 6, layers: [layer('one'), layer('copy', 2), layer('two', 4)],
    audioLayers: [{ _id: 'copied-speech', isEnabled: true, startTime: 2, duration: 2 }] };
  axios.post.mockResolvedValue({ data: { videoSession: updated } });
  await mount();
  await act(async () => { boundary.frame.copyCurrentLayerBelow(); });
  await waitFor(() => expect(boundary.frame.totalDuration).toBe(6));
  expect(boundary.frame.audioLayers).toMatchObject(updated.audioLayers);
});

it('F2P: rejected layer save clears pending state and reports the error', async () => {
  axios.post.mockRejectedValue(new Error('Save offline'));
  await mount();
  await act(async () => { await boundary.frame.updateSessionLayer(initial().layers[0]); });
  await waitFor(() => expect(boundary.editor.isUpdateLayerPending).toBe(false));
  expect(mock.toast.error).toHaveBeenCalled();
});

it('F2P: failed active images hold playback until refreshed credentials decode successfully', async () => {
  const OriginalImage = globalThis.Image;
  const failed = vi.fn();
  globalThis.Image = class {
    naturalWidth = 1;
    naturalHeight = 1;
    set src(url) {
      queueMicrotask(() => {
        if (url.includes('asset_token=expired')) { failed(); this.onerror?.(); }
        else if (url) this.onload?.();
      });
    }
    decode() { return Promise.resolve(); }
  };
  try {
    const session = initial();
    session.layers[0].imageSession.activeItemList = [{ id: 'image', type: 'image', src: 'https://media.example/image.png?asset_token=expired' }];
    let refresh;
    axios.get.mockResolvedValueOnce({ data: session }).mockImplementation(() => new Promise(resolve => { refresh = resolve; }));
    await mount();
    await act(async () => {});
    expect(boundary.playback.isVisualReady).toBe(false);
    expect(failed).toHaveBeenCalled();
    await waitFor(() => expect(refresh).toBeTypeOf('function'));
    const updated = structuredClone(session);
    updated.layers[0].imageSession.activeItemList[0].src = 'https://media.example/image.png?asset_token=fresh';
    await act(async () => { refresh({ data: updated }); });
    await waitFor(() => expect(boundary.playback.isVisualReady).toBe(true));
  } finally { globalThis.Image = OriginalImage; }
});
