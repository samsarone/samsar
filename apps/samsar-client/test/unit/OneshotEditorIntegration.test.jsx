import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, parsePath, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { clearAuthData, persistAuthToken } from '../../src/utils/web.jsx';
import OneshotEditor from '../../src/components/oneshot_editor/OneshotEditor.jsx';

const harness = vi.hoisted(() => ({
  user: null, session: null, status: null, userFetching: false, userInitiated: true, standalone: false,
  getUserAPI: vi.fn(), openAlertDialog: vi.fn(), closeAlertDialog: vi.fn(),
}));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/utils/environment.jsx', async (importOriginal) => ({
  ...await importOriginal(), get IS_STANDALONE_DEPLOYMENT() { return harness.standalone; },
}));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => harness }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'light' }) }));
vi.mock('../../src/contexts/AlertDialogContext.jsx', () => ({ useAlertDialog: () => harness }));
vi.mock('react-tooltip', () => ({ Tooltip: () => null }));
vi.mock('react-toastify', () => ({ ToastContainer: () => null, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/components/auth/AuthContainer.jsx', () => ({ default: () => <div>Login dialog</div>, AUTH_DIALOG_OPTIONS: {} }));
vi.mock('../../src/components/assistant/AssistantHome.jsx', () => ({ default: ({ submitAssistantQuery }) => <aside aria-label="Assistant panel"><button onClick={() => submitAssistantQuery("Improve this idea")}>Ask assistant</button></aside> }));
vi.mock('../../src/components/video/advanced/VideoEditAdvancedDialog.jsx', () => ({ default: () => <div>Advanced edit dialog</div> }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/PublishOptionsDialog.jsx', () => ({ default: () => <div>Publish options</div> }));
vi.mock('../../src/components/oneshot_editor/VidgenieSkeletonLoader.jsx', () => ({ default: () => <div role="status">Loading project</div> }));
vi.mock('../../src/components/landing/CreatePublishedGallery.jsx', () => ({
  default: (filters) => <output aria-label="Publication filters">{JSON.stringify(filters)}</output>,
}));
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
  harness.standalone = false;
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
  return <output aria-label="Current route">{location.pathname}{location.search}{location.hash}</output>;
}

async function mountEditor({ path = '/vidgenie/project-1', state, initialSessionRequestRef } = {}) {
  let view;
  await act(async () => { view = render(<MemoryRouter initialEntries={[{ ...parsePath(path), state }]}>
    <LocalizationProvider><CurrentLocation /><Routes>
      <Route path="/vidgenie/:id" element={<OneshotEditor initialSessionRequestRef={initialSessionRequestRef} />} />
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
  it('shows publications matching the editable request and removes them as soon as submission starts', async () => {
    harness.user.selectedInferenceModel = 'gemini-4-neon';
    Object.assign(harness.session, { expressGenerationType: 'TEXT_TO_VIDEO', expressGenerationPending: true });
    await mountEditor();
    const filters = () => JSON.parse(screen.getByLabelText('Publication filters').textContent);
    expect(filters()).toEqual({ inferenceModel: 'gemini-4-neon', videoModel: 'KLINGIMGTOVID4', language: 'en' });
    const videoControl = screen.getByText('Video Model', { selector: 'p' }).parentElement;
    fireEvent.keyDown(within(videoControl).getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'RunwayML Gen 4.5' }));
    const languageControl = screen.getByText('Audio language').parentElement;
    fireEvent.keyDown(within(languageControl).getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Japanese' }));
    expect(filters()).toEqual({ inferenceModel: 'gemini-4-neon', videoModel: 'RUNWAYML', language: 'ja' });
    let finish;
    axios.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await submitPrompt();
    expect(screen.queryByLabelText('Publication filters')).toBeNull();
    await act(async () => finish({ data: { request_id: 'request-1' } }));
    expect(screen.queryByLabelText('Publication filters')).toBeNull();
  });

  it.each([
    { isExpressGeneration: true, expressGenerationPending: true },
    { session: { isStepVideoGeneration: true, expressGenerationPending: false } },
    { session: { expressGenerationCancelled: true } },
    { session: { expressGenerationFailed: true } },
  ])('omits publications for a previously submitted project with status %j', async (status) => {
    Object.assign(harness.session, status);
    await mountEditor();
    expect(screen.queryByLabelText('Publication filters')).toBeNull();
  });

  it.each([
    ['default', null, null, null, 60],
    ['account preset', 120, null, null, 120],
    ['existing VidGenie preference', 120, '30', null, 30],
    ['saved session request', 120, '30', 90, 90],
  ])('uses the %s duration in the wizard and its JSON draft', async (_source, account, stored, session, expected) => {
    if (account) harness.user.createDefaults = { duration: account };
    if (stored) localStorage.setItem('defaultVidGPTDuration', stored);
    if (session) harness.session.expressGenerationRequestedDurationSeconds = session;
    await mountEditor();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'JSON mode' })));
    expect(JSON.parse(screen.getByRole('textbox', { name: 'JSON request' }).value).duration).toBe(expected);
    expect(localStorage.getItem('defaultVidGPTDuration')).toBe(stored);
  });

  it('saves a new explicit duration and uses it for the current render', async () => {
    harness.session.expressGenerationRequestedDurationSeconds = 90;
    await mountEditor();
    const control = screen.getByText('Max Duration').parentElement;
    fireEvent.keyDown(within(control).getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: '30 Secs' }));
    expect(localStorage.getItem('defaultVidGPTDuration')).toBe('30');
    await submitPrompt();
    expect(axios.post.mock.calls[0][1].input.duration).toBe(30);
  });

  it('focuses create-origin renders on progress while preserving pause, resume and the full editor route', async () => {
    harness.session = { ...harness.session, inputPrompt: 'A quiet city waking up', generationType: 'TEXT_TO_VIDEO', expressGenerationPending: true, isExpressGeneration: true };
    await mountEditor({ path: '/vidgenie/project-1?ref=create&view=preview#render' });
    expect(screen.getByRole('heading', { name: 'Creating your video...' })).toBeVisible();
    expect(screen.getByText('A quiet city waking up')).toBeVisible();
    expect(screen.getByLabelText('Generation progress')).toHaveTextContent('Generating project');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Assistant panel')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Enter a succinct prompt for your rendition…')).not.toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Pause render' })));
    expect(screen.getByRole('heading', { name: 'Render paused' })).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Resume render' })));
    expect(screen.getByLabelText('Generation progress')).toHaveTextContent('Generating project');
    const editorLink = screen.getByRole('link', { name: 'Open in VidGenie' });
    expect(editorLink).toHaveAttribute('href', '/vidgenie/project-1?ref=create#render');
    const sessionReads = axios.get.mock.calls.filter(([url]) => url.includes('session_details')).length;
    await act(async () => fireEvent.click(editorLink));
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/project-1?ref=create#render');
    expect(promptInput()).toBeVisible();
    expect(screen.queryByLabelText('Publication filters')).toBeNull();
    expect(axios.get.mock.calls.filter(([url]) => url.includes('session_details'))).toHaveLength(sessionReads);
  });

  it('keeps focused progress mounted across polls and exposes the completed playback and actions', async () => {
    vi.useFakeTimers();
    harness.session = { ...harness.session, inputPrompt: 'Create preview', generationType: 'TEXT_TO_VIDEO', expressGenerationPending: true, isExpressGeneration: true };
    await mountEditor({ path: '/vidgenie/project-1?view=preview' });
    const progress = screen.getByLabelText('Generation progress');
    harness.status = { ...harness.status, current_step: 'video_generation' };
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByLabelText('Generation progress')).toBe(progress);
    harness.status = { status: 'COMPLETED', videoLink: 'https://media.example/create-result.mp4' };
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(screen.getByLabelText('Generation progress')).toBe(progress);
    expect(screen.getByRole('heading', { name: 'Your video is ready' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Preview result' })).toHaveAttribute('href', 'https://media.example/create-result.mp4');
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'View in Studio' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Pause render' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create another video' })).toHaveAttribute('href', '/create');
    const reads = axios.get.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(15000));
    expect(axios.get).toHaveBeenCalledTimes(reads);
  });

  it('keeps focused image failures recoverable through the existing retry action', async () => {
    harness.session = { ...harness.session, inputPrompt: 'Saved request', isExpressGeneration: true, expressGenerationFailed: true, expressGenerationError: 'Image provider rejected the request', expressGenerationStatus: { prompt_generation: 'COMPLETED', image_generation: 'FAILED' } };
    harness.status = { status: 'FAILED', error: 'Image provider rejected the request', expressGenerationStatus: harness.session.expressGenerationStatus };
    await mountEditor({ path: '/vidgenie/project-1?view=preview' });
    expect(screen.getByRole('heading', { name: 'Video generation failed' })).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Image provider rejected the request');
    harness.status = { status: 'PENDING' };
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry image generation' })));
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/v2\/resume_render$/), { input: { videoSessionId: 'project-1' } }, expect.any(Object));
    expect(screen.getByLabelText('Generation progress')).toHaveTextContent('Generating project');
  });

  it('renders a completed project from the route preload without requesting it again', async () => {
    const session = { ...harness.session, inputPrompt: 'Preloaded story', isExpressGeneration: true, videoLink: 'https://media.example/final.mp4' };
    const initialSessionRequestRef = { current: { sessionId: 'project-1', authorization: 'Bearer integration-token', promise: Promise.resolve({ data: session }) } };
    await mountEditor({ initialSessionRequestRef });
    expect(screen.getByText('Video ready')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Preview result' })).toHaveAttribute('href', session.videoLink);
    expect(screen.queryByLabelText('Publication filters')).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
    expect(initialSessionRequestRef.current).toBeNull();
  });

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
      session_id: 'project-1', prompt: 'A river story.', image_model: 'GPTIMAGE2.5', video_model: 'KLINGIMGTOVID4',
      inference_model: 'claude-opus-5.5', duration: 60,
      aspect_ratio: '16:9', tone: 'grounded', auto_render_full_video: true,
    }) }), expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer integration-token' }) }));
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/request-1\/status_detailed$/), expect.any(Object));
    expect(screen.getByLabelText('Generation progress')).toHaveTextContent('Generating project');
    expect(screen.getByRole('button', { name: 'Submit', exact: true })).toBeDisabled();
    expect(localStorage.getItem('vidgenieRequestStepMode:request-1')).toBeTruthy();
  });

  it.each(['gemini-4-carbon', 'gemini-4-neon'])('submits %s from the saved account choice without adding GPT/Claude effort', async (model) => {
    harness.user.selectedInferenceModel = model;
    await mountEditor();
    await submitPrompt('A Gemini-planned river story.');
    const payload = axios.post.mock.calls[0][1].input;
    expect(payload).toMatchObject({ inference_model: model, inferenceModel: model, session_id: 'project-1' });
    expect(payload).not.toHaveProperty('effort');
  });

  it('waits for profile hydration before persisting model defaults and uses saved account choices', async () => {
    harness.user = null;
    harness.userFetching = true;
    harness.userInitiated = false;
    const view = await mountEditor();
    expect(JSON.parse(localStorage.getItem('vidgeniePreferencesV1') || '{}').inferenceModel).toBeUndefined();
    expect(localStorage.getItem('defaultVidGPTImageGenerationModel')).toBeNull();
    expect(localStorage.getItem('defaultVIdGPTVideoGenerationModel')).toBeNull();

    harness.user = { _id: 'user-1', generationCredits: 2000, isEmailVerified: true,
      selectedInferenceModel: 'gpt-6.1-sol', selectedInferenceEffort: 'xhigh',
      agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML' };
    harness.userFetching = false;
    harness.userInitiated = true;
    await act(async () => view.rerender(<MemoryRouter initialEntries={['/vidgenie/project-1']}>
      <LocalizationProvider><CurrentLocation /><Routes>
        <Route path="/vidgenie/:id" element={<OneshotEditor />} />
        <Route path="*" element={<div>Destination page</div>} />
      </Routes></LocalizationProvider>
    </MemoryRouter>));
    await submitPrompt('A story with saved models.');
    expect(axios.post.mock.calls[0][1].input).toMatchObject({
      inference_model: 'gpt-6.1-sol', effort: 'xhigh', image_model: 'SEEDREAM', video_model: 'RUNWAYML',
    });
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

  it('submits English captions independently from Japanese speech in a normal Vidgenie request', async () => {
    await mountEditor();
    const audioLanguageControl = screen.getByText('Audio language').parentElement;
    fireEvent.keyDown(within(audioLanguageControl).getByRole('combobox'), { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('option', { name: 'Japanese', exact: true }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Subtitles', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced', exact: true }));
    fireEvent.change(screen.getByLabelText('Subtitle language'), { target: { value: 'en' } });

    await submitPrompt('日本語のナレーションと英語の字幕を付けてください。');

    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/step\/text_to_video$/), expect.objectContaining({
      input: expect.objectContaining({
        language: 'ja', enable_subtitles: true, subtitle_language: 'en', session_id: 'project-1',
      }),
    }), expect.any(Object));
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
    ['th', true, 'th'],
    ['', true, 'ja'],
    ['en', false, undefined],
  ])('retranslates audio with independent subtitle selection %s and subtitles enabled %s', async (subtitleLanguage, enableSubtitles, expectedSubtitleLanguage) => {
    harness.session = {
      ...harness.session,
      isExpressGeneration: true,
      speechLanguage: 'en',
      subtitleLanguage: 'en',
      videoLink: 'https://media.example/final.mp4',
    };
    harness.status = { status: 'COMPLETED', videoLink: harness.session.videoLink };
    await mountEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Retranslate', exact: true }));
    fireEvent.change(screen.getByLabelText('Retranslation language'), { target: { value: 'ja' } });
    expect(screen.getByLabelText('Subtitle language')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'Add translated subtitles' })).not.toBeChecked();
    if (enableSubtitles) {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Add translated subtitles' }));
      fireEvent.change(screen.getByLabelText('Subtitle language'), { target: { value: subtitleLanguage } });
    } else {
      expect(screen.getByLabelText('Subtitle language')).toBeDisabled();
    }
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retranslate video' })); });
    const call = axios.post.mock.calls.find(([url]) => url.endsWith('/retranslate_video'));
    expect(call?.[1].input).toMatchObject({ language: 'ja', enable_subtitles: enableSubtitles });
    expect(call?.[1].input.subtitle_language).toBe(expectedSubtitleLanguage);
  });

  it.each([
    ['claude-fable-5.2', 'xhigh', 'claude-fable-5.2'],
    ['claude-fable-5.1', 'xhigh', 'claude-fable-5.2'],
    ['gpt-6.1-sol', 'high', 'gpt-6.1-sol'],
    ['gemini-4-carbon', null, 'gemini-4-carbon'],
    ['gemini-4-neon', null, 'gemini-4-neon'],
    ['gemini-4-argon', null, 'gemini-4-carbon'],
  ])('retranslation submits the selected %s model as its canonical key and applicable effort', async (model, effort, expectedModel) => {
    harness.user.selectedInferenceModel = 'gpt-6.2-astra';
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
    expect(call[1].input.inference_model).toBe(expectedModel);
    expect(call[1].input.effort).toBe(effort ?? undefined);
  });

  it('retranslation uses the source Claude XHigh settings even when account and browser defaults are Gemini', async () => {
    harness.user.selectedInferenceModel = 'gemini-4-carbon';
    harness.user.selectedInferenceEffort = 'high';
    localStorage.setItem('vidgeniePreferencesV1', JSON.stringify({ inferenceModel: 'gemini-4-neon' }));
    harness.session = {
      ...harness.session, isExpressGeneration: true, videoLink: 'https://media.example/final.mp4',
      expressGenerationInferenceModel: 'claude-opus-5.5-xhigh', expressGenerationInferenceEffort: 'xhigh',
    };
    harness.status = { status: 'COMPLETED', videoLink: harness.session.videoLink };
    await mountEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Retranslate', exact: true }));
    fireEvent.change(screen.getByLabelText('Retranslation language'), { target: { value: 'th' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retranslate video' })); });
    const call = axios.post.mock.calls.find(([url]) => url.endsWith('/retranslate_video'));
    expect(call[1].input).toMatchObject({
      inference_model: 'claude-opus-5.5', effort: 'xhigh', language: 'th',
      enable_subtitles: false, translate_outro: false, translate_footer: false,
    });
    expect(call[1].input.subtitle_language).toBeUndefined();
  });

  it('saves optional retranslation choices on the session, restores them after reopening, and keeps another session unchecked', async () => {
    harness.session = { ...harness.session, isExpressGeneration: true, videoLink: 'https://media.example/final.mp4' };
    harness.status = { status: 'COMPLETED', videoLink: harness.session.videoLink };
    axios.post.mockImplementation(async (url, body) => {
      if (url.endsWith('/post_processing_preferences')) {
        harness.session = { ...harness.session, postProcessingPreferences: {
          ...harness.session.postProcessingPreferences, ...body.preferences,
        } };
        return { data: { sessionId: body.sessionId, postProcessingPreferences: harness.session.postProcessingPreferences } };
      }
      return { data: { request_id: 'request-1' } };
    });
    const first = await mountEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Retranslate', exact: true }));
    for (const label of ['Add translated subtitles', 'Translate outro', 'Translate footer']) {
      expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked();
    }
    fireEvent.click(screen.getByRole('checkbox', { name: 'Translate outro' }));
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/video_sessions/post_processing_preferences'),
      { sessionId: 'project-1', preferences: { translationTranslateOutro: true } },
      expect.anything(),
    ));
    first.unmount();
    const reopened = await mountEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Retranslate', exact: true }));
    expect(screen.getByRole('checkbox', { name: 'Translate outro' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Add translated subtitles' })).not.toBeChecked();
    reopened.unmount();
    harness.session = { ...harness.session, _id: 'project-2', postProcessingPreferences: undefined };
    await mountEditor({ path: '/vidgenie/project-2' });
    fireEvent.click(screen.getByRole('button', { name: 'Retranslate', exact: true }));
    expect(screen.getByRole('checkbox', { name: 'Translate outro' })).not.toBeChecked();
  });

  it('does not submit a retranslation or duplicate clicks while preference saving fails', async () => {
    harness.session = { ...harness.session, isExpressGeneration: true, videoLink: 'https://media.example/final.mp4' };
    harness.status = { status: 'COMPLETED', videoLink: harness.session.videoLink };
    axios.post.mockRejectedValue(new Error('Unable to save session choices'));
    await mountEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Retranslate', exact: true }));
    fireEvent.change(screen.getByLabelText('Retranslation language'), { target: { value: 'th' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Translate outro' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retranslate video' }));
      fireEvent.click(screen.getByRole('button', { name: 'Retranslate video' }));
    });
    expect(axios.post.mock.calls.some(([url]) => url.endsWith('/retranslate_video'))).toBe(false);
    expect(await screen.findByText('Unable to save session choices')).toBeVisible();
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
    expect(harness.openAlertDialog.mock.calls[0][0].props.redirectTo).toBe('/');
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

  it('accepts Neon in JSON mode and retains the explicitly supplied model', async () => {
    await openJson({ ...validJson(), inference_model: 'gemini-4-neon' });
    expect(screen.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })));
    expect(axios.post.mock.calls[0][1]).toMatchObject({ inference_model: 'gemini-4-neon', session_id: 'project-1' });
  });

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

  it('filters publications by the models and audio language entered in JSON mode', async () => {
    await openJson({ input: { ...validJson(), inferenceModel: 'gemini-4-neon', language: 'JP', subtitleLanguage: 'English' } });
    expect(JSON.parse(screen.getByLabelText('Publication filters').textContent)).toEqual({
      inferenceModel: 'gemini-4-neon', videoModel: 'RUNWAYML', language: 'ja',
    });
  });

  it('preserves English subtitle selection with Japanese speech in JSON mode', async () => {
    await openJson({ input: { ...validJson(), language: 'JP', enableSubtitles: true, subtitleLanguage: 'English' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })); });

    expect(axios.post.mock.calls[0][1].input).toMatchObject({
      language: 'ja', enable_subtitles: true, subtitle_language: 'en', session_id: 'project-1',
    });
  });
});

it.each([
  ['gpt-6.2-astra', 'gpt-6.2-astra'],
  ['gpt-6.1-sol', 'gpt-6.1-sol'],
  ['claude-opus-5.5', 'claude-opus-5.5'],
  ['claude-fable-5.2', 'claude-fable-5.2'],
  ['claude-fable-5.1', 'claude-fable-5.2'],
].flatMap(([model, expectedModel]) =>
  ['high', 'xhigh'].map((effort) => [model, effort, expectedModel])
))('submits saved %s / %s as its canonical model through the Vidgenie wizard', async (model, effort, expectedModel) => {
  harness.user.selectedInferenceModel = model;
  harness.user.selectedInferenceEffort = effort;
  await mountEditor();
  await submitPrompt();
  expect(axios.post.mock.calls[0][1].input).toMatchObject({ inference_model: expectedModel, effort });
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


describe('Vidgenie assistant context', () => {
  it('sends the initial view and current draft without generation settings or asset URLs', async () => {
    await mountEditor();
    fireEvent.change(promptInput(), { target: { value: 'A traveler returns home' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Ask assistant' })));
    const call = axios.post.mock.calls.find(([url]) => url.includes('/assistants/submit_assistant_query'));
    expect(call[1].assistantContext).toMatchObject({ version: 1, page: 'vidgenie', view: 'initial', mode: 'T2V', draft: 'A traveler returns home' });
    expect(call[1].stream).toBe(true);
    expect(call[1].assistantContext).not.toHaveProperty('aspectRatio');
  });
});


describe('session loading request budget', () => {
  const detailCalls = () => axios.get.mock.calls.filter(([url]) => url.includes('/video_sessions/session_details'));
  const statusCalls = () => axios.get.mock.calls.filter(([url]) => url.includes('status_detailed'));
  const complete = () => {
    harness.session = { ...harness.session, isExpressGeneration: true, inputPrompt: 'Saved prompt',
      videoLink: 'https://media.example/final.mp4', expressGenerationPending: false };
    harness.status = { status: 'COMPLETED', videoLink: harness.session.videoLink,
      session: { id: 'project-1', layers: [{ id: 'scene', duration: 5, aiVideo: { url: 'https://media.example/clip.mp4' } }] } };
  };
  it.each([false, true])('completed session loads once (standalone=%s) and loads reroll details on demand', async (standalone) => {
    harness.standalone = standalone;
    complete();
    await mountEditor();
    expect(screen.getByText('Video ready')).toBeVisible();
    expect(detailCalls()).toHaveLength(1);
    expect(statusCalls()).toHaveLength(0);
    const reroll = screen.getByRole('button', { name: /Re-roll|Reroll/i });
    await act(async () => { fireEvent.click(reroll); });
    expect(statusCalls()).toHaveLength(1);
    expect(detailCalls()).toHaveLength(1);
  });
  it('anonymous standalone has one bootstrap and keeps polling pending work', async () => {
    vi.useFakeTimers();
    harness.standalone = true;
    harness.user = null;
    clearAuthData();
    harness.status = { status: 'PENDING', session_id: 'project-1',
      expressGenerationPending: true, expressGenerationStatus: { video_generation: 'PENDING' },
      session: { id: 'project-1', layers: [] } };
    await mountEditor();
    expect(detailCalls()).toHaveLength(0);
    const initialCalls = statusCalls().length;
    expect(initialCalls).toBeLessThanOrEqual(2);
    harness.status = { status: 'COMPLETED', session_id: 'project-1', videoLink: 'https://media.example/done.mp4' };
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.getByText('Video ready')).toBeVisible();
    expect(statusCalls()).toHaveLength(initialCalls + 1);
  });
  it('unchanged pending scene video does not repeatedly reload the full session', async () => {
    vi.useFakeTimers();
    harness.session = { ...harness.session, isExpressGeneration: true, inputPrompt: 'Rendering', expressGenerationPending: true };
    harness.status = { status: 'PENDING', session_id: 'project-1', expressGenerationPending: true,
      session: { id: 'project-1', layers: [{ id: 'scene', duration: 5, aiVideo: { url: 'https://media.example/clip.mp4' } }] } };
    await mountEditor();
    await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
    expect(detailCalls()).toHaveLength(1);
    harness.status.session.layers[0].aiVideo.url = 'https://media.example/new-clip.mp4';
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(detailCalls()).toHaveLength(2);
  });
  it.each([403, 429, 500, 503])('does not amplify a %s session failure with status requests', async (status) => {
    axios.get.mockRejectedValue({ response: { status, data: { message: 'Unavailable' } } });
    await mountEditor();
    expect(detailCalls()).toHaveLength(1);
    expect(statusCalls()).toHaveLength(0);
  });
});
