import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const scenario = vi.hoisted(() => ({ user: {}, headers: {}, deployment: {}, inference: {}, standalone: false }));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => scenario.user }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => scenario.headers }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => scenario.deployment }));
vi.mock('../../src/hooks/useInferenceModelAvailability.js', () => ({ useInferenceModelAvailability: () => scenario.inference }));
vi.mock('../../src/components/common/OverflowContainer.tsx', () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock('../../src/utils/environment.jsx', () => ({ get IS_STANDALONE_DEPLOYMENT() { return scenario.standalone; } }));
vi.mock('../../src/components/landing/CreatePublishedGallery.jsx', () => ({ default: () => <section aria-label="Published videos" /> }));
vi.mock('../../src/components/oneshot_editor/OneshotEditorContainer.jsx', () => ({ preloadOneshotEditor: vi.fn().mockResolvedValue(undefined) }));
import CreateLanding from '../../src/components/landing/CreateLanding.jsx';

function CurrentRoute() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}
function mount() {
  return render(<MemoryRouter initialEntries={['/create']}><CreateLanding /><CurrentRoute /></MemoryRouter>);
}
function enterPrompt(prompt = 'A quiet city waking up') {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: prompt } });
}
function submit() { fireEvent.submit(screen.getByRole('button', { name: 'Create video' }).closest('form')); }

beforeEach(() => {
  scenario.user = { user: { _id: 'user' }, userInitiated: true, userFetching: false };
  scenario.headers = { headers: { Authorization: 'Bearer test' } };
  scenario.deployment = { isStandaloneDeployment: false, isLoading: false };
  scenario.inference = { isLoading: false };
  scenario.standalone = false;
  axios.post.mockReset().mockResolvedValue({ data: { session_id: 'new-video', request_id: 'new-video' } });
});

describe('simple create landing', () => {
  it('shows a prompt, visible render estimate and duration controls without creating a session', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'Create video' })).toBeVisible();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveValue('30');
    expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toHaveValue('16:9');
    expect(screen.getByRole('status', { name: 'Render estimate' })).toHaveTextContent('1,080 credits');
    expect(screen.getByRole('button', { name: 'About Create defaults' })).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Claude Opus 5.5' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '4000');
    expect(screen.getByRole('button', { name: 'Create video' })).toBeDisabled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('shows platform publications only in the production edition', async () => {
    const view = mount();
    expect(await screen.findByRole('region', { name: 'Published videos' })).toBeInTheDocument();
    view.unmount();
    scenario.standalone = true;
    mount();
    expect(screen.queryByRole('region', { name: 'Published videos' })).toBeNull();
  });

  it('creates a fresh automatic video with the new defaults and opens its progress view', async () => {
    mount();
    enterPrompt('  A quiet city waking up  ');
    submit();
    await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/new-video?view=preview'));
    expect(axios.post).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/v2/video/step/text_to_video'), { input: {
      prompt: 'A quiet city waking up', inference_model: 'claude-opus-5.5', image_model: 'GPTIMAGE2.5',
      video_model: 'KLINGIMGTOVID4', duration: 30, aspect_ratio: '16:9', language: 'auto',
      enable_subtitles: false, generation_step_mode: 'one_step', auto_render_full_video: true,
      manual_step_stages: [], effort: 'high',
    } }, scenario.headers);
    expect(localStorage.getItem('videoSessionId')).toBe('new-video');
    expect(sessionStorage.getItem('samsarCreatePrompt')).toBeNull();
  });

  it('honors model and language preferences saved in account settings', async () => {
    scenario.user.user = { _id: 'user', selectedInferenceModel: 'gpt-6.1-sol', selectedInferenceEffort: 'xhigh', agentImageModel: 'SEEDREAM', agentVideoModel: 'VEO3.1I2V', preferredLanguage: 'ja' };
    mount(); enterPrompt(); submit();
    await waitFor(() => expect(axios.post).toHaveBeenCalled());
    expect(axios.post.mock.calls[0][1].input).toMatchObject({ inference_model: 'gpt-6.1-sol', effort: 'xhigh', image_model: 'SEEDREAM', video_model: 'VEO3.1I2V', language: 'ja' });
  });

  it('retains the draft through sign-in and restores it when returning', () => {
    scenario.user.user = null;
    const view = mount(); enterPrompt(); submit();
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/login?redirect=%2Fcreate');
    expect(axios.post).not.toHaveBeenCalled();
    view.unmount(); mount();
    expect(screen.getByRole('textbox')).toHaveValue('A quiet city waking up');
  });

  it('keeps failed prompts editable and lets the user retry a failed request', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 402, data: { message: 'Insufficient credits.' } } });
    mount(); enterPrompt(); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient credits.');
    expect(screen.getByRole('textbox')).toHaveValue('A quiet city waking up');
    expect(screen.getByRole('button', { name: 'Create video' })).toBeEnabled();
    submit();
    await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/new-video'));
  });

  it('prevents duplicate submissions while a request is pending', async () => {
    let resolve;
    axios.post.mockReturnValue(new Promise(done => { resolve = done; }));
    mount(); enterPrompt();
    const form = screen.getByRole('button', { name: 'Create video' }).closest('form');
    fireEvent.submit(form); fireEvent.submit(form);
    expect(axios.post).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Creating your video...' })).toBeDisabled();
    await act(async () => resolve({ data: { session_id: 'new-video' } }));
  });

  it('keeps the draft when the server does not return a session', async () => {
    axios.post.mockResolvedValueOnce({ data: {} });
    mount(); enterPrompt(); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to create your video.');
    expect(sessionStorage.getItem('samsarCreatePrompt')).toBe('A quiet city waking up');
  });

  it('uses configured model availability without silently changing user choices', async () => {
    scenario.deployment = { isStandaloneDeployment: true, isLoading: false, textToVideoImageModelValues: ['GPTIMAGE2.5'], textToVideoVideoModelValues: ['RUNWAYML'] };
    scenario.inference = { isLoading: false, modelValues: ['claude-opus-5.5'] };
    mount(); enterPrompt(); submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Your default models are unavailable.');
    expect(axios.post).not.toHaveBeenCalled();
  });
});


it('uses persisted Create defaults and forwards a duration override with the chosen models', async () => {
  scenario.user.user = { _id: 'user', selectedInferenceModel: 'claude-opus-5.5', createDefaults: {
    inferenceModel: 'gpt-6.2-astra', inferenceEffort: 'xhigh', imageModel: 'SEEDREAM',
    videoModel: 'SEEDANCE2.5I2V', duration: 60, aspectRatio: '9:16', enableSubtitles: true,
  } };
  mount();
  expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveValue('60');
  expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toHaveValue('9:16');
  expect(screen.getByRole('status', { name: 'Render estimate' })).toHaveTextContent('3,600 credits');
  fireEvent.change(screen.getByRole('combobox', { name: 'Duration' }), { target: { value: '90' } });
  expect(screen.getByRole('status', { name: 'Render estimate' })).toHaveTextContent('5,400 credits');
  enterPrompt(); submit();
  await waitFor(() => expect(axios.post).toHaveBeenCalled());
  expect(axios.post.mock.calls[0][1].input).toMatchObject({ inference_model: 'gpt-6.2-astra', effort: 'xhigh', image_model: 'SEEDREAM', video_model: 'SEEDANCE2.5I2V', duration: 90, aspect_ratio: '9:16', enable_subtitles: true });
  expect(scenario.user.user.createDefaults.duration).toBe(60);
});

it('shows provider billing instead of an invented credit estimate in standalone deployments', () => {
  scenario.deployment = { isStandaloneDeployment: true, isLoading: false };
  mount();
  expect(screen.getByRole('status', { name: 'Render estimate' })).toHaveTextContent('API charge');
  expect(screen.getByRole('status', { name: 'Render estimate' })).not.toHaveTextContent('1,080');
});

it('hydrates saved defaults with the profile and resets overrides when the account changes', () => {
  const view = mount();
  scenario.user.user = { _id: 'user', createDefaults: { duration: 60, aspectRatio: '9:16' } };
  view.rerender(<MemoryRouter><CreateLanding /><CurrentRoute /></MemoryRouter>);
  expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveValue('60');
  fireEvent.change(screen.getByRole('combobox', { name: 'Duration' }), { target: { value: '90' } });
  scenario.user.user = { _id: 'other', createDefaults: { duration: 10 } };
  view.rerender(<MemoryRouter><CreateLanding /><CurrentRoute /></MemoryRouter>);
  expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveValue('10');
});

it('hides inspiration in focus mode and restores it with Escape', async () => {
  mount();
  expect(await screen.findByRole('region', { name: 'Published videos' })).toBeVisible();
  enterPrompt();
  fireEvent.click(screen.getByRole('button', { name: 'Focus mode' }));
  expect(screen.queryByRole('region', { name: 'Published videos' })).toBeNull();
  expect(screen.getByRole('textbox')).toHaveValue('A quiet city waking up');
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(await screen.findByRole('region', { name: 'Published videos' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(screen.getByRole('textbox')).toHaveValue('');
  expect(sessionStorage.getItem('samsarCreatePrompt')).toBe('');
});

it('blocks aspect ratios unsupported by the selected models before starting a render', async () => {
  scenario.user.user = { _id: 'user', createDefaults: { videoModel: 'RUNWAYML', aspectRatio: '1:1' } };
  mount();
  expect(screen.getByRole('option', { name: 'Square · 1:1' })).toBeDisabled();
  enterPrompt(); submit();
  expect(screen.getByRole('alert')).toHaveTextContent('Choose an aspect ratio supported by both the image and video model.');
  expect(axios.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Aspect ratio' }), { target: { value: '9:16' } });
  submit();
  await waitFor(() => expect(axios.post).toHaveBeenCalledOnce());
  expect(axios.post.mock.calls[0][1].input.aspect_ratio).toBe('9:16');
});

it('omits hosted inspiration when deployment availability reports standalone', () => {
  scenario.deployment = { isStandaloneDeployment: true, isLoading: false };
  mount();
  expect(screen.queryByRole('region', { name: 'Published videos' })).toBeNull();
  expect(screen.getByRole('textbox', { name: 'Describe your video' })).toBeVisible();
});

it('explains saved defaults and links to account defaults without changing render overrides', async () => {
  scenario.user.user = { _id: 'user', createDefaults: { duration: 60, aspectRatio: '9:16', enableSubtitles: true } };
  mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Duration' }), { target: { value: '90' } });
  expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveAttribute('title', 'Saved default: 60 seconds. Changes here apply only to this video.');
  expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toHaveAttribute('title', 'Saved default: 9:16. Changes here apply only to this video.');
  expect(screen.queryByRole('link', { name: 'Claude Opus 5.5' })).toBeNull();
  expect(screen.queryByRole('dialog', { name: 'Create defaults' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'About Create defaults' }));
  const guidance = await screen.findByRole('dialog', { name: 'Create defaults' });
  const model = screen.getByRole('link', { name: 'Claude Opus 5.5' });
  expect(model).toHaveAttribute('href', '/account/settings/defaults');
  expect(model).toHaveAttribute('title', 'Text model: Claude Opus 5.5. Change in Defaults.');
  expect(guidance).toHaveTextContent('Saved defaults: 60s · 9:16');
  expect(guidance).toHaveTextContent('Subtitles: On');
  expect(guidance).toHaveTextContent('Duration and aspect ratio changes here apply only to this video.');
  expect(screen.getByRole('link', { name: 'Change defaults' })).toHaveAttribute('href', '/account/settings/defaults');
  expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveValue('90');
  fireEvent.click(screen.getByRole('link', { name: 'Change defaults' }));
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/account/settings/defaults');
  expect(axios.post).not.toHaveBeenCalled();
});

it.each(['profile', 'models'])('shows a composer skeleton until %s defaults resolve without losing the draft', async (loading) => {
  sessionStorage.setItem('samsarCreatePrompt', 'A saved idea');
  if (loading === 'profile') scenario.user = { user: null, userInitiated: false, userFetching: true };
  else scenario.deployment.isLoading = true;
  const view = mount();
  const status = screen.getByRole('status', { name: 'Loading...' });
  expect(status).toHaveAttribute('aria-busy', 'true');
  expect(status.querySelectorAll('button, input, select, textarea, a')).toHaveLength(0);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('status', { name: 'Render estimate' })).toBeNull();
  scenario.user = { user: { _id: 'user', createDefaults: { duration: 60, aspectRatio: '9:16' } }, userInitiated: true, userFetching: false };
  scenario.deployment.isLoading = false;
  view.rerender(<MemoryRouter><CreateLanding /><CurrentRoute /></MemoryRouter>);
  expect(screen.queryByRole('status', { name: 'Loading...' })).toBeNull();
  expect(screen.getByRole('textbox')).toHaveValue('A saved idea');
  expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveValue('60');
  expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toHaveValue('9:16');
  expect(axios.post).not.toHaveBeenCalled();
});
