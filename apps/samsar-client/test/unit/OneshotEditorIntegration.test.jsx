import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { clearAuthData, persistAuthToken } from '../../src/utils/web.jsx';
import OneshotEditor from '../../src/components/oneshot_editor/OneshotEditor.jsx';

const harness = vi.hoisted(() => ({
  user: null, session: null, status: null, userFetching: false, userInitiated: true,
  getUserAPI: vi.fn(), openAlertDialog: vi.fn(), closeAlertDialog: vi.fn(),
}));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => harness }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'light' }) }));
vi.mock('../../src/contexts/AlertDialogContext.jsx', () => ({ useAlertDialog: () => harness }));
vi.mock('react-tooltip', () => ({ Tooltip: () => null }));
vi.mock('react-toastify', () => ({ ToastContainer: () => null, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/components/auth/AuthContainer.jsx', () => ({ default: () => <div>Login dialog</div>, AUTH_DIALOG_OPTIONS: {} }));
vi.mock('../../src/components/assistant/AssistantHome.jsx', () => ({ default: () => <aside aria-label="Assistant panel" /> }));
vi.mock('../../src/components/video/advanced/VideoEditAdvancedDialog.jsx', () => ({ default: () => <div>Advanced edit dialog</div> }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/PublishOptionsDialog.jsx', () => ({ default: () => <div>Publish options</div> }));
vi.mock('../../src/components/oneshot_editor/VidgenieSkeletonLoader.jsx', () => ({ default: () => <div role="status">Loading project</div> }));
vi.mock('../../src/components/oneshot_editor/ProgressIndicator.jsx', () => ({
  default: ({ isGenerationPending, isGenerationPaused, isGenerationWaitingForApproval, videoLink, errorMessage, onProcessNextStep }) => <section aria-label="Generation progress">
    <output>{isGenerationPaused ? 'Paused project' : isGenerationWaitingForApproval ? 'Review images' : isGenerationPending ? 'Generating project' : videoLink ? 'Video ready' : 'Generation idle'}</output>
    {videoLink && <a href={videoLink}>Preview result</a>}
    {errorMessage?.error && <p role="alert">{errorMessage.error}</p>}
    {isGenerationWaitingForApproval && <button onClick={onProcessNextStep}>Continue generation</button>}
  </section>,
}));
vi.mock('ace-builds', () => ({ default: { config: { set: vi.fn() } } }));
vi.mock('ace-builds/src-noconflict/mode-json', () => ({}));
vi.mock('ace-builds/src-noconflict/theme-monokai', () => ({}));
vi.mock('ace-builds/src-noconflict/ext-language_tools', () => ({}));
vi.mock('react-ace', () => ({ default: ({ value, onChange, readOnly }) => <textarea aria-label="JSON request" value={value} onChange={(event) => onChange?.(event.target.value)} readOnly={readOnly} /> }));

beforeEach(() => {
  harness.user = { _id: 'user-1', generationCredits: 2000, isEmailVerified: true };
  harness.userFetching = false;
  harness.userInitiated = true;
  harness.session = { _id: 'project-1', layers: [], audioLayers: [], inputPrompt: '' };
  harness.status = { status: 'PENDING', session_id: 'project-1', expressGenerationStatus: { image_generation: 'PENDING' } };
  harness.getUserAPI.mockReset();
  harness.openAlertDialog.mockReset();
  harness.closeAlertDialog.mockReset();
  axios.get.mockReset();
  axios.post.mockReset();
  axios.get.mockImplementation(async (url) => {
    if (url.includes('/video_sessions/session_details')) return { data: harness.session };
    if (url.includes('status_detailed')) return { data: harness.status };
    throw new Error(`Unexpected API request: ${url}`);
  });
  axios.post.mockResolvedValue({ data: { request_id: 'request-1' } });
  persistAuthToken('integration-token');
});
afterEach(() => { clearAuthData(); });

function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}</output>;
}

async function mountEditor({ path = '/vidgenie/project-1', state } = {}) {
  let view;
  await act(async () => { view = render(<MemoryRouter initialEntries={[{ pathname: path, state }]}>
    <LocalizationProvider><CurrentLocation /><Routes>
      <Route path="/vidgenie/:id" element={<OneshotEditor />} />
      <Route path="*" element={<div>Destination page</div>} />
    </Routes></LocalizationProvider>
  </MemoryRouter>); });
  return view;
}

function promptInput() { return screen.getByPlaceholderText('Enter a succinct prompt for your rendition…'); }
async function submitPrompt(prompt = 'A river flowing through an ancient city.') {
  fireEvent.change(promptInput(), { target: { value: prompt } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })); });
}

describe('VidGenie project loading and wizard requests', () => {
  it('loads the route project with authorization and restores its prompt', async () => {
    harness.session.inputPrompt = 'Saved story';
    await mountEditor();
    expect(promptInput()).toHaveValue('Saved story');
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/session_details\?id=project-1&cacheBust=/), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer integration-token' }) }));
    expect(screen.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
    expect(screen.queryByLabelText('Generation progress')).not.toBeInTheDocument();
  });

  it('waits for authentication hydration before reading a private project', async () => {
    harness.user = null;
    harness.userFetching = true;
    harness.userInitiated = false;
    await mountEditor();
    expect(screen.getByText('Loading project')).toBeVisible();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('shows a load failure and retries the same route project', async () => {
    axios.get.mockRejectedValue({ response: { status: 503, data: { error: 'Workspace temporarily unavailable' } } });
    await mountEditor();
    expect(screen.getByRole('heading', { name: 'Unable to open this VidGenie project' })).toBeVisible();
    expect(screen.getByText('Workspace temporarily unavailable')).toBeVisible();
    axios.get.mockImplementation(async () => ({ data: harness.session }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(promptInput()).toBeVisible();
  });

  it('refreshes authentication on a 401 before retrying the project', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 401 } });
    await mountEditor();
    expect(harness.getUserAPI).toHaveBeenCalledOnce();
    expect(promptInput()).toBeVisible();
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('requires a prompt before any generation request is sent', async () => {
    await mountEditor();
    await submitPrompt('  ');
    expect(screen.getByText('Please enter some text before submitting.')).toBeVisible();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('clamps pasted prompts to the visible 4000-character limit', async () => {
    await mountEditor();
    fireEvent.change(promptInput(), { target: { value: 'a'.repeat(4500) } });
    expect(promptInput()).toHaveValue('a'.repeat(4000));
    expect(screen.getByText('4000/4000 characters')).toBeVisible();
  });

  it('submits the selected wizard configuration with the route session and starts polling its returned request', async () => {
    await mountEditor();
    await submitPrompt('  A river story.  ');
    expect(axios.post).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/v2\/video\/step\/text_to_video$/), expect.objectContaining({ input: expect.objectContaining({
      session_id: 'project-1', prompt: 'A river story.', image_model: 'GPTIMAGE2.5', video_model: 'RUNWAYML',
      aspect_ratio: '16:9', tone: 'grounded', auto_render_full_video: true,
    }) }), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer integration-token' }) }));
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/request-1\/status_detailed$/), expect.any(Object));
    expect(screen.getByLabelText('Generation progress')).toHaveTextContent('Generating project');
    expect(screen.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
    expect(localStorage.getItem('vidgenieRequestStepMode:request-1')).toBeTruthy();
  });

  it('includes explicit subtitle translation choices in the generation request', async () => {
    await mountEditor();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Subtitles', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced', exact: true }));
    fireEvent.change(screen.getByLabelText('Subtitle language'), { target: { value: 'th' } });
    await submitPrompt();
    const payload = axios.post.mock.calls[0][1];
    expect(payload.input).toMatchObject({ enable_subtitles: true, subtitle_language: 'th' });
  });

  it('reports server request failures and restores the submit control', async () => {
    axios.post.mockRejectedValue({ response: { data: { message: 'Insufficient generation credits' } } });
    await mountEditor();
    await submitPrompt();
    expect(screen.getByRole('alert')).toHaveTextContent('Insufficient generation credits');
    expect(screen.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
  });

  it('blocks generation for an account below the hosted credit minimum', async () => {
    harness.user.generationCredits = 299;
    await mountEditor();
    expect(promptInput()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
  });
});

describe('VidGenie generation lifecycle', () => {
  it.each([
    ['claude-fable-5.1', 'xhigh'],
    ['gpt-6.1-sol', 'high'],
    ['gemini-4-argon', null],
  ])('retranslation submits the selected %s model and applicable effort', async (model, effort) => {
    harness.user.selectedInferenceModel = 'gpt-6-astra';
    harness.session = {
      ...harness.session, isExpressGeneration: true,
      videoLink: 'https://media.example/final.mp4',
      inferenceModel: model, inferenceEffort: effort,
    };
    harness.status = { status: 'COMPLETED', videoLink: harness.session.videoLink };
    await mountEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Retranslate', exact: true }));
    fireEvent.change(screen.getByLabelText('Retranslation language'), { target: { value: 'ja' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retranslate video' })); });
    const call = axios.post.mock.calls.find(([url]) => url.endsWith('/retranslate_video'));
    expect(call).toBeDefined();
    expect(call[1].input.inference_model).toBe(model);
    expect(call[1].input.effort).toBe(effort ?? undefined);
  });

  it('shows completed results and keeps the original request collapsed until expanded', async () => {
    harness.session = { ...harness.session, generationType: 'TEXT_TO_VIDEO', inputPrompt: 'Original saved prompt', videoLink: 'https://media.example/final.mp4', isExpressGeneration: true };
    harness.status = { status: 'COMPLETED', videoLink: 'https://media.example/final.mp4' };
    await mountEditor();
    expect(screen.getByRole('link', { name: 'Preview result' })).toHaveAttribute('href', 'https://media.example/final.mp4');
    expect(screen.queryByPlaceholderText('Enter a succinct prompt for your rendition…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Original request/ }));
    expect(promptInput()).toHaveValue('Original saved prompt');
    expect(promptInput()).toBeDisabled();
  });

  it('polls a newly submitted request to completion and cancels future polling', async () => {
    vi.useFakeTimers();
    const { unmount } = await mountEditor();
    await submitPrompt();
    harness.status = { status: 'COMPLETED', videoLink: 'https://media.example/rendered.mp4' };
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole('link', { name: 'Preview result' })).toHaveAttribute('href', 'https://media.example/rendered.mp4');
    const requests = axios.get.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(axios.get).toHaveBeenCalledTimes(requests);
    unmount();
  });

  it('reports terminal generation failures and stops polling', async () => {
    vi.useFakeTimers();
    await mountEditor();
    await submitPrompt();
    harness.status = { status: 'FAILED', error: 'Image provider rejected the request' };
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByRole('alert')).toHaveTextContent('Image provider rejected the request');
    const requests = axios.get.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(axios.get).toHaveBeenCalledTimes(requests);
  });

  it('pauses the active project and can resume its generation', async () => {
    harness.session = { ...harness.session, inputPrompt: 'Started project', generationType: 'TEXT_TO_VIDEO', expressGenerationPending: true, isExpressGeneration: true };
    await mountEditor();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Pause', exact: true })); });
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/v2\/pause_render$/), { input: { videoSessionId: 'project-1' } }, expect.any(Object));
    expect(screen.getByLabelText('Generation progress')).toHaveTextContent('Paused project');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Play', exact: true })); });
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/v2\/resume_render$/), { input: { videoSessionId: 'project-1' } }, expect.any(Object));
    expect(screen.getByLabelText('Generation progress')).toHaveTextContent('Generating project');
  });

  it('requires review in two-step mode before sending process_next', async () => {
    await mountEditor();
    fireEvent.click(screen.getByRole('radio', { name: '2-step' }));
    harness.status = { status: 'PENDING', requires_user_action: true };
    await submitPrompt();
    expect(axios.post.mock.calls[0][1].input).toMatchObject({ generation_step_mode: 'two_step', auto_render_full_video: false, manual_step_stages: ['ai_video_generation'] });
    expect(screen.getByLabelText('Generation progress')).toHaveTextContent('Review images');
    harness.status = { status: 'PENDING' };
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue generation' })); });
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/request-1\/process_next$/), {}, expect.any(Object));
    expect(screen.getByLabelText('Generation progress')).toHaveTextContent('Generating project');
  });

  it('renders a handed-off guest sample without fetching private data and opens login from its banner', async () => {
    clearAuthData();
    harness.user = null;
    const guestSession = { ...harness.session, isGuestSession: true, inputPrompt: 'Guest sample' };
    await mountEditor({ state: { guestSession } });
    expect(axios.get).not.toHaveBeenCalled();
    expect(promptInput()).toHaveValue('Guest sample');
    expect(promptInput()).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Log in to create' }));
    expect(harness.openAlertDialog).toHaveBeenCalledOnce();
    expect(harness.openAlertDialog.mock.calls[0][0].props.redirectTo).toBe('/vidgenie');
  });

  it('cancels scheduled generation polls when leaving the editor', async () => {
    vi.useFakeTimers();
    const { unmount } = await mountEditor();
    await submitPrompt();
    unmount();
    const requests = axios.get.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
    expect(axios.get).toHaveBeenCalledTimes(requests);
  });
});

describe('VidGenie image-list requests and JSON editor validation', () => {
  it('requires an image in image-list mode', async () => {
    await mountEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Image List to Video' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })); });
    expect(screen.getByText('Please add at least one image URL or upload an image.')).toBeVisible();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('submits ordered image URLs with descriptions through image_to_video', async () => {
    await mountEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Image List to Video' }));
    fireEvent.change(screen.getByPlaceholderText('https://...'), { target: { value: 'https://media.example/one.png' } });
    fireEvent.change(screen.getByPlaceholderText('What is in this image and what matters for this scene'), { target: { value: ' First scene ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add image' }));
    fireEvent.change(screen.getAllByPlaceholderText('https://...')[1], { target: { value: 'https://media.example/two.png' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Move image up' })[1]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })); });
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/step\/image_to_video$/), expect.objectContaining({ input: expect.objectContaining({
      session_id: 'project-1', image_urls: [
        { image_url: 'https://media.example/two.png' }, { image_url: 'https://media.example/one.png', image_text: 'First scene' },
      ],
    }) }), expect.any(Object));
  });

  it('removes an image without leaving stale request data', async () => {
    await mountEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Image List to Video' }));
    fireEvent.change(screen.getByPlaceholderText('https://...'), { target: { value: 'https://media.example/removed.png' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(screen.getByPlaceholderText('https://...')).toHaveValue('');
    expect(screen.queryByRole('img', { name: 'Image 1' })).not.toBeInTheDocument();
  });

  async function openJson(input) {
    await mountEditor();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'JSON mode' })); });
    const editor = screen.getByRole('textbox', { name: 'JSON request' });
    fireEvent.change(editor, { target: { value: typeof input === 'string' ? input : JSON.stringify(input) } });
    return editor;
  }
  const validJson = () => ({ prompt: 'A natural river.', image_model: 'GPTIMAGE2.5', video_model: 'RUNWAYML', duration: 30 });

  it.each([
    ['empty prompt', { prompt: '' }, 'JSON input.prompt is required for text_to_video.'],
    ['duration too short', { duration: 5 }, 'JSON input.duration must be between 10 and 240 seconds.'],
    ['duration too long', { duration: 241 }, 'JSON input.duration must be between 10 and 240 seconds.'],
    ['invalid aspect ratio', { aspect_ratio: '4:3' }, 'JSON input.aspect_ratio must be one of:'],
    ['invalid language', { language: 42 }, 'JSON input.language must be a string when provided.'],
    ['invalid subtitle type', { enable_subtitles: 'yes' }, 'JSON input.enable_subtitles must be a boolean when provided.'],
    ['missing outro CTA', { generate_outro_image: true }, 'JSON input.cta_url or input.outro_cta_image is required'],
    ['unsupported image model', { image_model: 'unknown' }, 'JSON input.image_model must be one of:'],
    ['unsupported video model', { video_model: 'unknown' }, 'JSON input.video_model must be one of:'],
    ['another session', { session_id: 'other-project' }, 'JSON session_id must match the current Vidgenie session.'],
  ])('blocks JSON submission for %s', async (_label, change, message) => {
    await openJson({ ...validJson(), ...change });
    expect(screen.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
    expect(screen.getByText((text) => text.includes(message))).toBeVisible();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('repairs comments, unquoted keys, single quotes, and trailing commas before sending JSON', async () => {
    await openJson(`{ // Request from the API example\n prompt: 'A natural river.', image_model: 'GPTIMAGE2.5', video_model: 'RUNWAYML', duration: 30, }`);
    expect(screen.getByText('Valid JSON for text to video.')).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })); });
    const payload = axios.post.mock.calls[0][1];
    expect(payload).toMatchObject({ prompt: 'A natural river.', session_id: 'project-1', duration: 30 });
    expect(screen.getByText('JSON request hidden during render')).toBeVisible();
  });

  it('normalizes camelCase request aliases and strips the endpoint selector before submission', async () => {
    await openJson({ endpoint: '/v2/text_to_video', input: { prompt: 'River', imageModel: 'GPTIMAGE2.5', videoModel: 'RUNWAYML', duration: 30,
      aspectRatio: '9:16', enableSubtitles: true, subtitleLanguage: 'th' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })); });
    const payload = axios.post.mock.calls[0][1];
    expect(payload.endpoint).toBeUndefined();
    expect(payload.input).toMatchObject({ aspect_ratio: '9:16', enable_subtitles: true, subtitle_language: 'th', session_id: 'project-1' });
  });
});

it.each(['gpt-6-astra', 'gpt-6.1-sol', 'claude-opus-5.5', 'claude-fable-5.1'].flatMap((model) =>
  ['high', 'xhigh'].map((effort) => [model, effort])
))('submits saved %s / %s through the Vidgenie wizard', async (model, effort) => {
  harness.user.selectedInferenceModel = model;
  harness.user.selectedInferenceEffort = effort;
  await mountEditor();
  await submitPrompt();
  expect(axios.post.mock.calls[0][1].input).toMatchObject({ inference_model: model, effort });
});


it('migrates a saved Kling selection to v4 while retaining the 36-credit agent rate', async () => {
  localStorage.setItem('defaultVIdGPTVideoGenerationModel', 'KLINGIMGTOVID3PRO');
  await mountEditor();
  expect(screen.getByText('36 Credits / second of video')).toBeVisible();
  expect(screen.getByText('Kling 4')).toBeVisible();
  await submitPrompt();
  const submission = axios.post.mock.calls.find(([url]) => url.includes('/video/'));
  expect(submission).toBeDefined();
  expect(JSON.stringify(submission[1])).toContain('KLINGIMGTOVID4');
});
