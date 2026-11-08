import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import VideoHome from '../../src/components/video/VideoHome.jsx';
import ExpressPostProcessingDialog from '../../src/components/video/advanced/ExpressPostProcessingDialog.jsx';
import CanvasControlBar from '../../src/components/video/toolbars/CanvasControlBar.jsx';
import { NavCanvasControlProvider } from '../../src/contexts/NavCanvasControlContext.jsx';

const mock = vi.hoisted(() => ({ accepted: vi.fn(), close: vi.fn(), login: vi.fn(), standalone: false, subtitles: true, header: null, frame: null }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: { Authorization: 'test' } }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: { _id: 'owner', selectedInferenceModel: 'claude-fable-5.1', selectedInferenceEffort: 'xhigh' }, getUserAPI: vi.fn() }) }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => ({ isStandaloneDeployment: mock.standalone, hasSubtitleGenerationCredentials: mock.subtitles }) }));
vi.mock('../../src/components/common/TopNav.tsx', () => ({ default: props => { mock.header = props; return <CanvasControlBar {...props} isExpressGeneration />; } }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/index.jsx', () => ({ default: props => { mock.frame = props; return null; } }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/FrameToolbarHorizontal.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/VideoEditorContainer.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/PreviewPlaybackController.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/workers/imagePreloaderWorkerSingleton.jsx', () => ({ getImagePreloaderWorker: () => ({ postMessage() {} }) }));
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() }, ToastContainer: () => null }));

const session = (extra = {}) => ({ _id: 'original', isExpressGeneration: true, framesPerSecond: 24,
  remoteURL: 'https://media.example/original.mp4', audioLayers: [], aspectRatio: '16:9', totalDuration: 4,
  layers: [{ _id: 'scene-1', duration: 4, imageSession: { activeItemList: [] } }], ...extra });
beforeEach(() => {
  mock.standalone = false; mock.subtitles = true; mock.header = mock.frame = null;
  axios.get.mockReset(); axios.post.mockReset().mockResolvedValue({ data: { session_id: 'new-session', request_id: 'new-request', status: 'PENDING' } });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
function mountDialog(extra = {}) {
  return render(<ExpressPostProcessingDialog session={session(extra)} onClose={mock.close} onRequestAccepted={mock.accepted} showLoginDialog={mock.login} openAdvancedVideoEditDialog={vi.fn()} />);
}
const click = name => fireEvent.click(screen.getByRole('button', { name, exact: true }));
const change = (name, value) => fireEvent.change(screen.getByLabelText(name), { target: { value } });

it.each([
  ['Retranslate', 'Retranslate video', 'retranslate_video', () => change('Retranslation language', 'ja'), { language: 'ja', inference_model: 'claude-fable-5.1', effort: 'xhigh', translate_outro: true, translate_footer: true, enable_subtitles: true }],
  ['Subtitles', 'Generate / regenerate subtitles', 'add_subtitles', () => {}, {}],
  ['Subtitles', 'Remove subtitles', 'remove_subtitles', () => {}, {}],
  ['Avatar', 'Regenerate narrator avatar', 'regenerate_avatar', () => {}, {}],
  ['Footer CTA', 'Update footer', 'update_footer_image', () => change('Footer CTA text', 'Visit Samsar'), { cta_text: 'Visit Samsar' }],
  ['Footer CTA', 'Remove footer', 'update_footer_image', () => {}, { remove_footer: true }],
  ['Outro CTA', 'Add outro CTA', 'add_outro_image', () => change('Outro CTA URL', 'https://samsar.one'), { generate_outro_image: true, cta_url: 'https://samsar.one' }],
  ['Clone', 'Clone render', 'clone', () => {}, {}],
  ['Reroll scenes', 'Reroll selected scenes', 'reroll-layers', () => fireEvent.click(screen.getByText('Scene 1', { selector: 'span.truncate' })), { layer_indexes: [1] }],
])('submits the shared %s operation and accepts the returned session', async (tab, submit, endpoint, fill, expected) => {
  mountDialog(); click(tab); fill(); click(submit);
  await waitFor(() => expect(mock.accepted).toHaveBeenCalledWith({ sessionId: 'new-session', requestId: 'new-request', status: 'PENDING', pollMode: 'status' }));
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining(`/v2/${endpoint}`), { input: expect.objectContaining({ videoSessionId: 'original', ...expected }) }, expect.anything());
});

it('updates an existing image outro with the same image and text contract as Vidgenie', async () => {
  mountDialog({ hasOutroImage: true });
  change('Outro CTA type', 'image'); change('CTA image URL', 'https://example.com/logo.png'); change('Outro top text', 'Hello');
  click('Update outro CTA');
  await waitFor(() => expect(mock.accepted).toHaveBeenCalled());
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/v2/update_outro_image'), { input: { videoSessionId: 'original', generate_outro_image: true, outro_cta_image: { middle_image: { url: 'https://example.com/logo.png' }, top_text: 'Hello' } } }, expect.anything());
});

it('validates input, shows API errors, and permits retry without duplicate submissions', async () => {
  mountDialog(); click('Add outro CTA');
  expect(await screen.findByText('Enter a valid outro CTA URL.')).toBeVisible();
  expect(axios.post).not.toHaveBeenCalled();
  change('Outro CTA URL', 'https://samsar.one');
  axios.post.mockRejectedValueOnce({ response: { data: { message: 'Insufficient credits' } } });
  click('Add outro CTA');
  expect(await screen.findByText('Insufficient credits')).toBeVisible();
  let resolve;
  axios.post.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  click('Add outro CTA'); click('Add outro CTA');
  expect(axios.post).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Close dialog' })).toBeDisabled();
  await act(async () => resolve({ data: { request_id: 'retry-session' } }));
  expect(mock.accepted).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'retry-session' }));
});

it('only falls back to the legacy subtitle route for an absent route', async () => {
  mountDialog(); click('Subtitles');
  axios.post.mockRejectedValueOnce({ response: { status: 404, data: 'Cannot POST /v2/add_subtitles' } });
  click('Generate / regenerate subtitles');
  await waitFor(() => expect(mock.accepted).toHaveBeenCalled());
  expect(axios.post).toHaveBeenLastCalledWith(expect.stringContaining('/v1/video/add_subtitles'), expect.anything(), expect.anything());
});

it('honors deployment subtitle availability and declined removals', async () => {
  mock.standalone = true; mock.subtitles = false;
  mountDialog();
  expect(screen.queryByRole('button', { name: 'Subtitles', exact: true })).not.toBeInTheDocument();
  click('Retranslate');
  expect(screen.queryByLabelText('Add translated subtitles')).not.toBeInTheDocument();
  click('Footer CTA'); window.confirm.mockReturnValue(false); click('Remove footer');
  expect(axios.post).not.toHaveBeenCalled();
});

function Location() { return <output aria-label="Route">{useLocation().pathname}</output>; }
it('opens a new session in Studio and polls through completion after an Express edit', async () => {
  axios.get.mockImplementation(async url => ({ data: url.includes('id=new-session') ? session({ _id: 'new-session', remoteURL: null, expressGenerationPending: true }) : session() }));
  await act(async () => render(<MemoryRouter initialEntries={['/video/original']}><NavCanvasControlProvider><Routes><Route path="/video/:id" element={<VideoHome />} /></Routes><Location /></NavCanvasControlProvider></MemoryRouter>));
  click('Express edits'); click('Footer CTA'); change('Footer CTA text', 'New footer'); click('Update footer');
  await waitFor(() => expect(screen.getByLabelText('Route')).toHaveTextContent('/video/new-session'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(localStorage.getItem('videoSessionId')).toBe('new-session');
  await waitFor(() => expect(mock.header.isRenderPending).toBe(true));
  expect(screen.queryByRole('button', { name: 'Express edits', exact: true })).not.toBeInTheDocument();
  click('Play'); expect(mock.header.isVideoPreviewPlaying).toBe(true); click('Pause');
  axios.post.mockResolvedValue({ data: { status: 'COMPLETED', session: session({ _id: 'new-session', remoteURL: 'https://media.example/new.mp4' }) } });
  await waitFor(() => expect(mock.header.renderedVideoPath).toBe('https://media.example/new.mp4'), { timeout: 4500 });
  expect(mock.header.isRenderPending).toBe(false);
  expect(screen.getByRole('button', { name: 'Express edits', exact: true })).toBeEnabled();
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/video_sessions/get_render_video_status'), { id: 'new-session' }, expect.anything());
});

it('uploads an outro image before submitting the generated CTA', async () => {
  mountDialog(); change('Outro CTA type', 'image');
  axios.post.mockResolvedValueOnce({ data: { image_urls: ['https://media.example/upload.png'] } });
  const file = new File(['image'], 'logo.png', { type: 'image/png' });
  fireEvent.change(document.querySelector('input[type="file"]'), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByLabelText('CTA image URL')).toHaveValue('https://media.example/upload.png'));
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/v2/upload_image_data'), { input: { image_data: [expect.stringMatching(/^data:image\/png;base64,/)] } }, expect.anything());
  click('Add outro CTA');
  await waitFor(() => expect(mock.accepted).toHaveBeenCalled());
});

it('keeps the form available when the API omits the new request id', async () => {
  axios.post.mockResolvedValueOnce({ data: {} });
  mountDialog(); click('Clone'); click('Clone render');
  expect(await screen.findByText('Post-processing did not return a request id.')).toBeVisible();
  expect(mock.accepted).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Clone render' })).toBeEnabled();
});

it('does not navigate when a response arrives after the dialog unmounts', async () => {
  let resolve;
  axios.post.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const { unmount } = mountDialog(); click('Clone'); click('Clone render'); unmount();
  await act(async () => resolve({ data: { session_id: 'late-session' } }));
  expect(mock.accepted).not.toHaveBeenCalled();
});

it.each([{ isExpressGeneration: false }, { expressGenerationPending: true }, { remoteURL: null }, { expressGenerationFailed: true }, { expressGenerationPaused: true }])('only offers Express edits for completed Express videos: %j', async extra => {
  axios.get.mockResolvedValue({ data: session(extra) });
  await act(async () => render(<MemoryRouter initialEntries={['/video/original']}><NavCanvasControlProvider><Routes><Route path="/video/:id" element={<VideoHome />} /></Routes></NavCanvasControlProvider></MemoryRouter>));
  expect(mock.header).toBeTruthy();
  expect(mock.header.openExpressPostProcessingDialog).toBeUndefined();
  expect(screen.queryByRole('button', { name: 'Express edits', exact: true })).not.toBeInTheDocument();
});
