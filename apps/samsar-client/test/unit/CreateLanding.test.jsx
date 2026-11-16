import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const scenario = vi.hoisted(() => ({ user: {}, headers: {}, deployment: {}, inference: {} }));
vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => scenario.user }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => scenario.headers }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => scenario.deployment }));
vi.mock('../../src/hooks/useInferenceModelAvailability.js', () => ({ useInferenceModelAvailability: () => scenario.inference }));
vi.mock('../../src/components/common/OverflowContainer.tsx', () => ({ default: ({ children }) => <div>{children}</div> }));
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
  axios.post.mockReset().mockResolvedValue({ data: { session_id: 'new-video', request_id: 'new-video' } });
});

describe('simple create landing', () => {
  it('shows one prompt and no generation options, without creating a session on entry', () => {
    mount();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveAttribute('maxlength', '4000');
    expect(screen.getByRole('button', { name: 'Create video' })).toBeDisabled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('creates a fresh automatic video with the new defaults and opens its progress view', async () => {
    mount();
    enterPrompt('  A quiet city waking up  ');
    submit();
    await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent('/vidgenie/new-video'));
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
