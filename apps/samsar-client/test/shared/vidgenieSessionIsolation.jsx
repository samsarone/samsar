import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { persistAuthToken } from '../../src/utils/web.jsx';
import OneshotEditor from '../../src/components/oneshot_editor/OneshotEditor.jsx';

const harness = vi.hoisted(() => ({ session: null, status: null, nextSession: null, inferenceAvailability: null }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({
  useUser: () => ({ user: { _id: 'owner', generationCredits: 2000 }, userInitiated: true, userFetching: false, getUserAPI: vi.fn() }),
}));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'light' }) }));
vi.mock('../../src/contexts/AlertDialogContext.jsx', () => ({ useAlertDialog: () => ({ openAlertDialog: vi.fn(), closeAlertDialog: vi.fn() }) }));
vi.mock('../../src/hooks/useInferenceModelAvailability.js', async () => {
  const actual = await vi.importActual(new URL('../../src/hooks/useInferenceModelAvailability.js', import.meta.url).pathname);
  return { ...actual, useInferenceModelAvailability: () => harness.inferenceAvailability || actual.useInferenceModelAvailability() };
});
vi.mock('react-tooltip', () => ({ Tooltip: () => null }));
vi.mock('react-toastify', () => ({ ToastContainer: () => null, toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('../../src/components/auth/AuthContainer.jsx', () => ({ default: () => null, AUTH_DIALOG_OPTIONS: {} }));
vi.mock('../../src/components/assistant/AssistantHome.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/advanced/VideoEditAdvancedDialog.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/video/toolbars/frame_toolbar/PublishOptionsDialog.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/oneshot_editor/ProgressIndicator.jsx', () => ({
  default: ({ videoLink, errorMessage }) => <section aria-label="Generation progress">
    {videoLink && <a href={videoLink}>Preview result</a>}
    {errorMessage?.error && <p role="alert">{errorMessage.error}</p>}
  </section>,
}));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  harness.session = { _id: 'previous', layers: [], audioLayers: [], inputPrompt: '' };
  harness.status = { status: 'PENDING', session_id: 'previous' };
  harness.nextSession = { _id: 'new-project', layers: [], audioLayers: [], inputPrompt: '' };
  harness.inferenceAvailability = null;
  axios.get.mockReset();
  axios.post.mockReset();
  axios.get.mockImplementation(async (url) => {
    if (url.includes('/video_sessions/session_details')) {
      return { data: url.includes('id=new-project')
        ? harness.nextSession
        : harness.session };
    }
    if (url.includes('status_detailed')) return { data: harness.status };
    throw new Error(`Unexpected API request: ${url}`);
  });
  persistAuthToken('session-isolation-token');
});

describe('Vidgenie completed session models', () => {
  function completeSession(settings = {}) {
    harness.session = {
      ...harness.session,
      isExpressGeneration: true,
      expressGenerationType: 'TEXT_TO_VIDEO',
      inputPrompt: 'Saved story',
      videoLink: 'https://media.example/final.mp4',
      ...settings,
    };
    harness.status = { status: 'COMPLETED', videoLink: harness.session.videoLink };
  }

  function expandRequest() {
    fireEvent.click(screen.getByRole('button', { name: /Original request/ }));
  }

  function expectModel(label, value) {
    const field = screen.getByText(new RegExp(`^${label}$`, 'i')).parentElement;
    expect(field).toHaveTextContent(value);
    expect(field.querySelector('input')).toBeDisabled();
  }

  it.each(['TEXT_TO_VIDEO', 'IMAGE_LIST_TO_VIDEO'])('shows the saved %s models instead of browser defaults', async (expressGenerationType) => {
    localStorage.setItem('defaultVidGPTImageGenerationModel', 'GPTIMAGE2.5');
    localStorage.setItem('defaultVIdGPTVideoGenerationModel', 'RUNWAYML');
    localStorage.setItem('defaultVidgenieImageListVideoGenerationModel', 'RUNWAYML');
    completeSession({
      expressGenerationType,
      expressGenerationImageModel: 'SEEDREAM',
      expressGenerativeVideoModel: 'VEO3.1I2V',
      expressGenerationInferenceModel: 'claude-fable-5.1',
      expressGenerationInferenceEffort: 'xhigh',
      // Explicit generation settings take priority over older session fields.
      imageModel: 'NANOBANANAPRO', videoGenerationModel: 'RUNWAYML',
      inferenceModel: 'gpt-6-astra', inferenceEffort: 'high',
    });
    await mount();
    expandRequest();
    expectModel('Image model', 'Seedream');
    expectModel('Video model', 'VEO3.1 I2V');
    fireEvent.click(screen.getByRole('button', { name: 'Advanced', exact: true }));
    expect(screen.getByRole('combobox', { name: 'Claude model' })).toHaveValue('claude-fable-5.1');
    expect(screen.getByRole('combobox', { name: 'Claude model' })).toBeDisabled();
    expectModel('Inference effort', 'xhigh');
    expect(localStorage.getItem('defaultVidGPTImageGenerationModel')).toBe('GPTIMAGE2.5');
    expect(localStorage.getItem('defaultVIdGPTVideoGenerationModel')).toBe('RUNWAYML');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('shows older session fields and a saved model subtype even when the model is no longer offered', async () => {
    completeSession({ imageModel: 'NANOBANANA2', videoGenerationModel: 'PIXVERSEI2V', videoGenerationModelSubType: 'comic' });
    await mount();
    expandRequest();
    expectModel('Image model', 'NanoBanana 2');
    expectModel('Video model', 'PIXVERSEI2V');
    expectModel('Pixverse style', 'comic');
  });

  it('preserves unrecognized historical model keys instead of showing current defaults', async () => {
    completeSession({ image_model: 'ARCHIVED_IMAGE_MODEL', video_model: 'ARCHIVED_VIDEO_MODEL' });
    await mount();
    expandRequest();
    expectModel('Image model', 'ARCHIVED_IMAGE_MODEL');
    expectModel('Video model', 'ARCHIVED_VIDEO_MODEL');
  });

  it('displays the saved inference model when deployment availability excludes it', async () => {
    harness.inferenceAvailability = {
      isStandaloneDeployment: false, isLoading: false, hasConfiguredInferenceModels: true,
      inferenceModelOptions: [{ label: 'GPT 6 Astra', value: 'gpt-6-astra' }],
    };
    completeSession({ expressGenerationInferenceModel: 'claude-fable-5.1', expressGenerationInferenceEffort: 'xhigh' });
    await mount();
    expect(screen.getByText('Inference: Claude Fable 5.1')).toBeVisible();
    expandRequest();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced', exact: true }));
    expect(screen.getByRole('combobox', { name: 'Claude model' })).toHaveValue('claude-fable-5.1');
    expectModel('Inference effort', 'xhigh');
  });

  it('updates model values when navigating between completed sessions', async () => {
    completeSession({ expressGenerationImageModel: 'SEEDREAM', expressGenerativeVideoModel: 'VEO3.1I2V' });
    harness.nextSession = {
      ...harness.session, _id: 'new-project',
      expressGenerationImageModel: 'NANOBANANAPRO', expressGenerativeVideoModel: 'KLINGIMGTOVID4',
    };
    await mount();
    expandRequest();
    expectModel('Image model', 'Seedream');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open new session' })); });
    expandRequest();
    expectModel('Image model', 'NanoBanana Pro');
    expectModel('Video model', 'Kling 4');
  });

  it('keeps the new-session model defaults after viewing a completed session', async () => {
    localStorage.setItem('defaultVidGPTImageGenerationModel', 'GPTIMAGE2.5');
    localStorage.setItem('defaultVIdGPTVideoGenerationModel', 'RUNWAYML');
    completeSession({ expressGenerationImageModel: 'SEEDREAM', expressGenerativeVideoModel: 'VEO3.1I2V' });
    await mount();
    expandRequest();
    expectModel('Image model', 'Seedream');
    await openNewSession();
    expect(screen.getByText(/^Image model$/i).parentElement).toHaveTextContent('GPTImage 2.6');
    expect(screen.getByText(/^Video model$/i).parentElement).toHaveTextContent('RunwayML Gen 4.5');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })); });
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/step\/text_to_video$/), expect.objectContaining({
      input: expect.objectContaining({ session_id: 'new-project', image_model: 'GPTIMAGE2.5', video_model: 'RUNWAYML' }),
    }), expect.anything());
  });
});

function Navigation() {
  const navigate = useNavigate();
  const location = useLocation();
  return <>
    <output aria-label="Current route">{location.pathname}</output>
    <button type="button" onClick={() => navigate('/vidgenie/new-project')}>Open new session</button>
  </>;
}

async function mount() {
  await act(async () => { render(
    <MemoryRouter initialEntries={['/vidgenie/previous']}>
      <LocalizationProvider><Navigation /><Routes>
        <Route path="/vidgenie/:id" element={<OneshotEditor />} />
      </Routes></LocalizationProvider>
    </MemoryRouter>
  ); });
}

const promptInput = () => screen.getByPlaceholderText('Enter a succinct prompt for your rendition…');
async function openNewSession() {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open new session' })); });
  fireEvent.click(screen.getByRole('button', { name: 'Text to Video', exact: true }));
  await waitFor(() => expect(promptInput()).toBeEnabled());
  fireEvent.change(promptInput(), { target: { value: 'New story with its own CTA' } });
}
function editCta() {
  fireEvent.click(screen.getByRole('button', { name: 'Advanced', exact: true }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Generate CTA outro' }));
  const typeSelect = screen.getByRole('option', { name: 'CTA image' }).closest('select');
  fireEvent.change(typeSelect, { target: { value: 'image' } });
  fireEvent.change(screen.getByPlaceholderText('Shop the drop'), { target: { value: 'New CTA description' } });
  fireEvent.change(screen.getByPlaceholderText('Limited availability'), { target: { value: 'New CTA footer' } });
  fireEvent.change(screen.getByPlaceholderText('https://cdn.example.com/logo.png'), { target: { value: 'https://media.example/new-cta.png' } });
}
function expectNewDraft() {
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/new-project');
  expect(promptInput()).toHaveValue('New story with its own CTA');
  expect(screen.getByPlaceholderText('Shop the drop')).toHaveValue('New CTA description');
  expect(screen.getByPlaceholderText('https://cdn.example.com/logo.png')).toHaveValue('https://media.example/new-cta.png');
  expect(screen.queryByRole('link', { name: 'Preview result' })).not.toBeInTheDocument();
}

describe('Vidgenie CTA session isolation', () => {
  it.each(['success', 'failure'])('keeps the new CTA draft when the previous session load finishes with %s', async (outcome) => {
    const oldLoad = deferred();
    if (outcome === 'failure') {
      const get = axios.get.getMockImplementation();
      axios.get.mockImplementation((url, config) => url.includes('status_detailed')
        ? Promise.reject(new Error('Previous session status unavailable'))
        : get(url, config));
    }
    axios.get.mockImplementationOnce(() => oldLoad.promise);
    await mount();
    await openNewSession();
    editCta();
    await act(async () => {
      if (outcome === 'success') oldLoad.resolve({ data: { ...harness.session, inputPrompt: 'Previous story', videoLink: 'https://media.example/old.mp4' } });
      else oldLoad.reject({ response: { status: 503, data: { message: 'Previous session unavailable' } } });
    });
    expectNewDraft();
    expect(screen.queryByText('Previous session unavailable')).not.toBeInTheDocument();
  });

  it.each(['success', 'failure'])('ignores a previous generation poll finishing with %s after a new session opens', async (outcome) => {
    const oldPoll = deferred();
    harness.session = { ...harness.session, inputPrompt: 'Previous story', isExpressGeneration: true, expressGenerationPending: true };
    const get = axios.get.getMockImplementation();
    axios.get.mockImplementation((url, config) => url.includes('status_detailed') ? oldPoll.promise : get(url, config));
    await mount();
    await waitFor(() => expect(axios.get.mock.calls.some(([url]) => url.includes('/previous/status_detailed'))).toBe(true));
    await openNewSession();
    editCta();
    await act(async () => {
      if (outcome === 'success') oldPoll.resolve({ data: { status: 'COMPLETED', videoLink: 'https://media.example/old.mp4' } });
      else oldPoll.reject({ response: { data: { status: 'FAILED', error: 'Previous generation failed' } } });
    });
    expectNewDraft();
    expect(screen.queryByText('Previous generation failed')).not.toBeInTheDocument();
  });

  it('ignores an old CTA upload after switching to a new session', async () => {
    const oldUpload = deferred();
    axios.post.mockReturnValue(oldUpload.promise);
    await mount();
    editCta();
    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [new File(['image'], 'old-cta.png', { type: 'image/png' })] } });
    await waitFor(() => expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/upload_image_data'), expect.anything(), expect.anything()));
    await openNewSession();
    editCta();
    await act(async () => { oldUpload.resolve({ data: { image_urls: ['https://media.example/old-cta.png'] } }); });
    expectNewDraft();
  });

  it('does not navigate back when an outro operation for the previous session completes', async () => {
    const oldOutro = deferred();
    harness.session = { ...harness.session, videoLink: 'https://media.example/old.mp4' };
    harness.status = { status: 'COMPLETED', videoLink: harness.session.videoLink };
    axios.post.mockReturnValue(oldOutro.promise);
    await mount();
    fireEvent.change(screen.getByLabelText('Outro CTA type'), { target: { value: 'image' } });
    fireEvent.change(screen.getByLabelText('CTA image URL'), { target: { value: 'https://media.example/old-cta.png' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add outro CTA' })); });
    expect(axios.post).toHaveBeenCalledOnce();
    await openNewSession();
    editCta();
    await act(async () => { oldOutro.resolve({ data: { session_id: 'previous-outro', status: 'PENDING' } }); });
    expectNewDraft();
  });

  it('still opens the generated outro session when the user stays on the current project', async () => {
    harness.session = { ...harness.session, videoLink: 'https://media.example/old.mp4' };
    harness.status = { status: 'COMPLETED', videoLink: harness.session.videoLink };
    axios.post.mockResolvedValue({ data: { session_id: 'previous-outro', status: 'PENDING' } });
    await mount();
    fireEvent.change(screen.getByLabelText('Outro CTA type'), { target: { value: 'image' } });
    fireEvent.change(screen.getByLabelText('CTA image URL'), { target: { value: 'https://media.example/old-cta.png' } });
    fireEvent.change(screen.getByLabelText('Outro top text'), { target: { value: 'Existing project CTA' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add outro CTA' })); });
    expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/add_outro_image$/), { input: {
      videoSessionId: 'previous', generate_outro_image: true,
      outro_cta_image: { middle_image: { url: 'https://media.example/old-cta.png' }, top_text: 'Existing project CTA' },
    } }, expect.anything());
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/previous-outro');
  });

  it('does not start an old generation request in the new session when submission finishes late', async () => {
    const oldSubmission = deferred();
    axios.post.mockReturnValue(oldSubmission.promise);
    await mount();
    fireEvent.change(promptInput(), { target: { value: 'Previous story' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })); });
    await openNewSession();
    editCta();
    await act(async () => { oldSubmission.resolve({ data: { request_id: 'previous-request' } }); });
    expectNewDraft();
    expect(screen.getByRole('button', { name: 'Submit', exact: true })).toBeEnabled();
    expect(axios.get.mock.calls.some(([url]) => url.includes('/previous-request/'))).toBe(false);
  });

  it('uploads and submits the selected CTA image and description for the current session', async () => {
    axios.post.mockResolvedValue({ data: { image_urls: ['https://media.example/uploaded-cta.png'] } });
    await mount();
    await openNewSession();
    editCta();
    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [new File(['image'], 'cta.png', { type: 'image/png' })] } });
    await waitFor(() => expect(screen.getByPlaceholderText('https://cdn.example.com/logo.png')).toHaveValue('https://media.example/uploaded-cta.png'));
    axios.post.mockResolvedValue({ data: { request_id: 'new-project' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })); });
    expect(axios.post).toHaveBeenLastCalledWith(expect.stringMatching(/\/step\/text_to_video$/), expect.objectContaining({
      input: expect.objectContaining({
        session_id: 'new-project', generate_outro_image: true,
        outro_cta_image: { middle_image: { url: 'https://media.example/uploaded-cta.png' }, top_text: 'New CTA description', bottom_text: 'New CTA footer' },
      }),
    }), expect.anything());
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/new-project');
  });
});
