import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { page } from 'vitest/browser';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import VideoHome from '../../src/components/video/VideoHome.jsx';
import CanvasControlBar from '../../src/components/video/toolbars/CanvasControlBar.jsx';
import { NavCanvasControlProvider } from '../../src/contexts/NavCanvasControlContext.jsx';
import clipUrl from '../fixtures/studio-preview.webm?url';

const boundary = vi.hoisted(() => ({
  timeline: null, user: { _id: 'owner' }, navigate: vi.fn(),
  params: { id: 'preview' }, location: { pathname: '/video/preview', search: '' },
}));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('react-router-dom', async (original) => ({ ...await original(),
  useParams: () => boundary.params, useNavigate: () => boundary.navigate,
  useLocation: () => boundary.location,
}));
vi.mock('../../src/utils/web.jsx', async (original) => ({ ...await original(), getHeaders: () => ({ headers: { Authorization: 'test' } }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: boundary.user }) }));
vi.mock('../../src/components/common/TopNav.tsx', () => ({ default: props => <CanvasControlBar {...props} /> }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/index.jsx', () => ({ default: props => { boundary.timeline = props; return null; } }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/FrameToolbarHorizontal.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/toolbars/VideoEditorToolbar.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/assistant/AssistantHome.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/workers/imagePreloaderWorkerSingleton.jsx', () => ({ getImagePreloaderWorker: () => ({ postMessage() {} }) }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, ToastContainer: () => null }));

const imageUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>';
const imageItem = (overrides = {}) => ({ id: 'image', type: 'image', src: imageUrl,
  x: 0, y: 0, width: 64, height: 64, ...overrides });
const layer = (id, offset, items = [], video = true) => ({ _id: id, duration: 2, durationOffset: offset,
  imageSession: { activeItemList: items, generationStatus: 'COMPLETED' },
  ...(video ? { hasAiVideoLayer: true, aiVideoLayer: `${clipUrl}${clipUrl.includes('?') ? '&' : '?'}scene=${id}` } : {}),
});

beforeEach(() => { boundary.timeline = null; axios.get.mockReset(); });

async function mount(layers, sessionOverrides = {}) {
  axios.get.mockResolvedValue({ data: { _id: 'preview', framesPerSecond: 24, totalDuration: 4,
    aspectRatio: '16:9', layers, audioLayers: [], ...sessionOverrides } });
  const view = render(<NavCanvasControlProvider><VideoHome /></NavCanvasControlProvider>);
  await waitFor(() => expect(view.container.querySelector('#samsar-konva-stage')).toBeTruthy());
  return view;
}

const activeVideo = container => container.querySelector('video[aria-hidden="false"]');

it('plays, pauses and resumes with the toolbar and Space, retaining the preloaded next video', async () => {
  const { container } = await mount([layer('one', 0, [imageItem({ is_base_image: true })]), layer('two', 2)]);
  await waitFor(() => expect(activeVideo(container)?.readyState).toBeGreaterThanOrEqual(2));
  const firstVideo = activeVideo(container);
  const nextVideo = [...container.querySelectorAll('video')].find(video => video !== firstVideo);
  await waitFor(() => expect(nextVideo.readyState).toBeGreaterThanOrEqual(2));
  const playbackButton = screen.getByRole('button', { name: 'Play', exact: true });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await waitFor(() => expect(boundary.timeline.currentLayerSeek).toBeGreaterThan(1));
  await waitFor(() => expect(firstVideo.paused).toBe(false));
  const playingFrame = boundary.timeline.currentLayerSeek;
  await waitFor(() => expect(boundary.timeline.currentLayerSeek).toBeGreaterThan(playingFrame));
  expect(screen.getByRole('button', { name: 'Pause', exact: true })).toBe(playbackButton);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await waitFor(() => expect(firstVideo.paused).toBe(true));
  const pausedFrame = boundary.timeline.currentLayerSeek;
  fireEvent.keyDown(window, { code: 'Space', key: ' ' });
  await waitFor(() => expect(boundary.timeline.currentLayerSeek).toBeGreaterThan(pausedFrame));
  await waitFor(() => expect(activeVideo(container)).toBe(nextVideo), { timeout: 4000 });
  await waitFor(() => expect(nextVideo.paused).toBe(false));
  fireEvent.keyDown(window, { code: 'Space', key: ' ' });
  await waitFor(() => expect(nextVideo.paused).toBe(true));
});

it('plays a ready video even when its replaced base image cannot load', async () => {
  const { container } = await mount([layer('one', 0, [imageItem({ is_base_image: true, src: 'data:image/png,invalid' })]), layer('two', 2)]);
  await waitFor(() => expect(activeVideo(container)?.readyState).toBeGreaterThanOrEqual(2));
  fireEvent.click(screen.getByTitle('Play'));
  await waitFor(() => expect(boundary.timeline.currentLayerSeek).toBeGreaterThan(1));
});

it('plays image-only scenes with a source-less image placeholder', async () => {
  await mount([layer('one', 0, [imageItem(), imageItem({ id: 'placeholder', src: '' })], false), layer('two', 2, [], false)]);
  fireEvent.keyDown(window, { code: 'Space', key: ' ' });
  await waitFor(() => expect(boundary.timeline.currentLayerSeek).toBeGreaterThan(1));
});


it('previews generated scenes while an Express render is pending', async () => {
  const { container } = await mount([layer('one', 0), layer('two', 2)], { isExpressGeneration: true, expressGenerationPending: true });
  await waitFor(() => expect(activeVideo(container)?.readyState).toBeGreaterThanOrEqual(2));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await waitFor(() => expect(boundary.timeline.currentLayerSeek).toBeGreaterThan(1));
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await waitFor(() => expect(activeVideo(container).paused).toBe(true));
  const pausedFrame = boundary.timeline.currentLayerSeek;
  fireEvent.keyDown(window, { code: 'Space', key: ' ' });
  await waitFor(() => expect(boundary.timeline.currentLayerSeek).toBeGreaterThan(pausedFrame));
});
