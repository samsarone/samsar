import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
vi.hoisted(() => { vi.stubEnv('VITE_PROCESSOR_API', 'https://processor.example'); });
const boundary = vi.hoisted(() => ({ frame: null, editor: null, playback: null }));
const mock = vi.hoisted(() => ({ sessionId: 'project', auth: { user: { _id: 'owner' } }, navigate: vi.fn(), toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, headers: { headers: { Authorization: 'test' } } }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('react-router-dom', async (importOriginal) => ({ ...await importOriginal(), useParams: () => ({ id: mock.sessionId }), useNavigate: () => mock.navigate, useLocation: () => ({ pathname: `/video/${mock.sessionId}`, search: '' }) }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => mock.headers }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => mock.auth }));
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
  mock.sessionId = 'project';
  mock.auth = { user: { _id: 'owner' } };
  mock.headers = { headers: { Authorization: 'test' } };
  axios.get.mockReset().mockResolvedValue({ data: initial() });
  axios.post.mockReset();
});
async function mount() { render(<NavCanvasControlProvider><VideoHome /></NavCanvasControlProvider>); await waitFor(() => expect(boundary.frame).toBeTruthy()); }

it.each([401, 403, 429, 500, 503])('does not turn a %s session failure into detailed-status queries', async (status) => {
  axios.get.mockRejectedValue({ response: { status, data: { message: 'Unavailable' } } });
  render(<NavCanvasControlProvider><VideoHome /></NavCanvasControlProvider>);
  await act(async () => {});
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get.mock.calls[0][0]).toContain('/video_sessions/session_details');
});
it('keeps the detailed-status compatibility fallback for missing legacy sessions', async () => {
  axios.get.mockRejectedValueOnce({ response: { status: 404 } }).mockResolvedValue({ data: {
    session_id: 'project', status: 'COMPLETED', session: { id: 'project', aspectRatio: '16:9', layers: [
      { id: 'one', duration: 2, startTime: 0, image: { activeItems: [] } },
    ] },
  } });
  await mount();
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(boundary.editor.videoSessionDetails._id).toBe('project');
});


it.each([null, { response: { status: 503 } }])('offers a retry instead of leaving an empty or failed session on a permanent skeleton', async failure => {
  if (failure) axios.get.mockRejectedValueOnce(failure);
  else axios.get.mockResolvedValueOnce({ data: null });
  render(<NavCanvasControlProvider><VideoHome /></NavCanvasControlProvider>);
  const retry = await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByRole('status')).toBeNull();
  fireEvent.click(retry);
  await waitFor(() => expect(boundary.editor?.videoSessionDetails?._id).toBe('project'));
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});


it('waits for pending authentication when no credentials exist, then loads the URL session once credentials arrive', async () => {
  mock.headers = null;
  mock.auth = { user: null, userInitiated: false, userFetching: true };
  const { rerender } = render(<NavCanvasControlProvider><VideoHome /></NavCanvasControlProvider>);
  expect(axios.get).not.toHaveBeenCalled();
  mock.headers = { headers: { Authorization: 'new-owner-token' } };
  mock.auth = { user: { _id: 'owner' }, userInitiated: true, userFetching: false };
  rerender(<NavCanvasControlProvider><VideoHome /></NavCanvasControlProvider>);
  await waitFor(() => expect(boundary.editor?.videoSessionDetails?._id).toBe('project'));
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get.mock.calls[0][1].headers.Authorization).toBe('new-owner-token');
});

it('ignores a previous session response after a different project is selected', async () => {
  let resolveOld;
  axios.get.mockReturnValueOnce(new Promise(done => { resolveOld = done; })).mockResolvedValue({ data: { ...initial(), _id: 'selected' } });
  const { rerender } = render(<NavCanvasControlProvider><VideoHome /></NavCanvasControlProvider>);
  mock.sessionId = 'selected';
  rerender(<NavCanvasControlProvider><VideoHome /></NavCanvasControlProvider>);
  await waitFor(() => expect(boundary.editor?.videoSessionDetails?._id).toBe('selected'));
  await act(async () => resolveOld({ data: initial() }));
  expect(boundary.editor.videoSessionDetails._id).toBe('selected');
});
