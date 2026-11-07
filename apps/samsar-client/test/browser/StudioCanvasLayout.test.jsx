import { act, render, waitFor } from '@testing-library/react';
import { page } from 'vitest/browser';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import VideoHome from '../../src/components/video/VideoHome.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import { NavCanvasControlProvider } from '../../src/contexts/NavCanvasControlContext.jsx';
import '../../src/index.css';

const boundary = vi.hoisted(() => ({ toolbar: null }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('react-router-dom', () => ({ useParams: () => ({ id: 'layout' }), useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/video/layout', search: '' }) }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: { Authorization: 'test' } }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: { _id: 'owner' } }) }));
vi.mock('../../src/components/common/CommonContainer.tsx', () => ({ default: p => <div>{p.children}</div> }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/index.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/FrameToolbarHorizontal.jsx', () => ({ default: () => <div data-testid="timeline" style={{ height: 120 }} /> }));
vi.mock('../../src/components/video/toolbars/VideoEditorToolbar.jsx', () => ({ default: p => { boundary.toolbar = p; return null; } }));
vi.mock('../../src/components/video/PreviewPlaybackController.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/assistant/AssistantHome.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/workers/imagePreloaderWorkerSingleton.jsx', () => ({ getImagePreloaderWorker: () => ({ postMessage() {} }) }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, ToastContainer: () => null }));

beforeEach(() => {
  boundary.toolbar = null;
  axios.get.mockReset();
});

async function mount(aspectRatio = '16:9', theme = 'dark') {
  await page.viewport(1280, 900);
  localStorage.setItem('colorMode', theme);
  axios.get.mockResolvedValue({ data: {
    _id: 'layout', framesPerSecond: 24, totalDuration: 2, aspectRatio,
    layers: [{ _id: 'scene', duration: 2, durationOffset: 0, imageSession: { activeItemList: [] } }],
    audioLayers: [],
  } });
  const view = render(<ColorModeProvider><NavCanvasControlProvider><VideoHome /></NavCanvasControlProvider></ColorModeProvider>);
  await waitFor(() => expect(view.container.querySelector('#samsar-konva-stage')).toBeTruthy());
  return view;
}

function expectFitted(container) {
  const stage = container.querySelector('#samsar-konva-stage');
  const frame = stage.parentElement;
  let workspace = frame.parentElement;
  while (workspace && getComputedStyle(workspace).overflow !== 'auto') workspace = workspace.parentElement;
  expect(workspace).toBeTruthy();
  const bounds = workspace.getBoundingClientRect();
  const canvas = frame.getBoundingClientRect();
  expect(workspace.scrollWidth).toBeLessThanOrEqual(workspace.clientWidth + 1);
  expect(workspace.scrollHeight).toBeLessThanOrEqual(workspace.clientHeight + 1);
  expect(Math.abs(canvas.left + canvas.width / 2 - (bounds.left + bounds.width / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(canvas.top + canvas.height / 2 - (bounds.top + bounds.height / 2))).toBeLessThanOrEqual(1);
  expect(canvas.width).toBeGreaterThan(100);
  expect(canvas.height).toBeGreaterThan(100);
  return workspace;
}

for (const theme of ['light', 'dark']) {
  it.each(['16:9', '9:16', '1:1'])(`fits and centers %s in the ${theme} Studio workspace`, async aspectRatio => {
    const { container } = await mount(aspectRatio, theme);
    await waitFor(() => expectFitted(container));
  });
}

it('refits after a window resize and expansion of the bottom timeline', async () => {
  const { container } = await mount();
  await waitFor(() => expectFitted(container));
  await page.viewport(1024, 768);
  container.querySelector('[data-testid="timeline"]').style.height = '240px';
  await waitFor(() => expectFitted(container));
  await page.viewport(1440, 1000);
  await waitFor(() => expectFitted(container));
});

it('preserves manual zoom, keeps enlarged edges reachable, and recenters on Fit', async () => {
  const { container } = await mount();
  let workspace;
  await waitFor(() => { workspace = expectFitted(container); });
  await act(async () => { boundary.toolbar.zoomCanvasIn(); });
  await waitFor(() => expect(workspace.scrollWidth).toBeGreaterThan(workspace.clientWidth));
  const stage = container.querySelector('#samsar-konva-stage');
  const zoomedWidth = stage.getBoundingClientRect().width;
  await page.viewport(1100, 800);
  await waitFor(() => expect(stage.getBoundingClientRect().width).toBeCloseTo(zoomedWidth));
  workspace.scrollLeft = workspace.scrollWidth;
  workspace.scrollTop = workspace.scrollHeight;
  await act(async () => { boundary.toolbar.resetCanvasZoom(); });
  await waitFor(() => expectFitted(container));
  expect(workspace.scrollLeft).toBe(0);
  expect(workspace.scrollTop).toBe(0);
});
