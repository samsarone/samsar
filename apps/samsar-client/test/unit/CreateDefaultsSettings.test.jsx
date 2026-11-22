import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import CreateDefaultsSettings from '../../src/components/account/CreateDefaultsSettings.jsx';
import SettingsPanelContent from '../../src/components/account/SettingsPanelContent.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { setUiLanguage } from '../../src/utils/localization.js';

const fixture = vi.hoisted(() => ({ user: {}, setUser: vi.fn(), deployment: {}, inference: {} }));
vi.mock('axios', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: fixture.user, setUser: fixture.setUser }) }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: { Authorization: 'Bearer test' } }) }));
vi.mock('../../src/hooks/useInferenceModelAvailability.js', () => ({ useInferenceModelAvailability: () => fixture.inference }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => fixture.deployment }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'dark' }) }));
vi.mock('../../src/hooks/useGoogleTTSSpeakers.js', () => ({ useGoogleTTSSpeakers: () => ({ googleSpeakers: [] }), fetchGoogleTTSPreviewBlobUrl: vi.fn() }));
vi.mock('../../src/hooks/useAudioProviderAvailability.js', () => ({ useAudioProviderAvailability: () => ({ audioAvailability: null }) }));

const systemDefaults = {
  inferenceModel: 'claude-opus-5.5', imageModel: 'GPTIMAGE2.5', videoModel: 'KLINGIMGTOVID4',
  inferenceEffort: 'high', duration: 30, aspectRatio: '16:9', enableSubtitles: false,
};

beforeEach(() => {
  setUiLanguage('en');
  fixture.user = { _id: 'owner', username: 'Creator', selectedInferenceModel: 'gpt-6.2-astra', agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML' };
  fixture.setUser.mockReset();
  fixture.deployment = { isStandaloneDeployment: false, isLoading: false };
  fixture.inference = { isLoading: false, inferenceModelOptions: [
    { value: 'claude-opus-5.5', label: 'Claude Opus 5.5' },
    { value: 'gpt-6.2-astra', label: 'GPT 6.2 Astra' },
    { value: 'gemini-4-carbon', label: 'Gemini Carbon' },
    { value: 'gemini-4-neon', label: 'Gemini Neon' },
  ] };
  axios.get.mockReset().mockResolvedValue({ data: { createDefaults: systemDefaults } });
  axios.put.mockReset().mockImplementation(async (_url, body) => ({ data: body }));
});

async function mount() {
  const view = render(<CreateDefaultsSettings />);
  await waitFor(() => expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'false'));
  return view;
}

it('loads account Create defaults without changing the other editor preferences', async () => {
  const saved = { ...systemDefaults, duration: 90, aspectRatio: '9:16', enableSubtitles: true };
  axios.get.mockResolvedValue({ data: { createDefaults: saved } });
  await mount();
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/users/create_defaults'), expect.objectContaining({ headers: { Authorization: 'Bearer test' } }));
  expect(screen.getByRole('combobox', { name: 'Text model' })).toHaveValue('claude-opus-5.5');
  expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveValue('90');
  expect(screen.getByRole('combobox', { name: 'Aspect ratio' })).toHaveValue('9:16');
  expect(screen.getByRole('checkbox', { name: 'Enable subtitles' })).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
  expect(axios.put).not.toHaveBeenCalled();
  expect(fixture.setUser).not.toHaveBeenCalled();
});

it('persists models and render settings then updates the shared profile', async () => {
  await mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Text model' }), { target: { value: 'gpt-6.2-astra' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Image model' }), { target: { value: 'SEEDREAM' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Video model' }), { target: { value: 'RUNWAYML' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Duration' }), { target: { value: '60' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Aspect ratio' }), { target: { value: '9:16' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Reasoning effort' }), { target: { value: 'xhigh' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Enable subtitles' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }));
  const expected = { inferenceModel: 'gpt-6.2-astra', imageModel: 'SEEDREAM', videoModel: 'RUNWAYML', duration: 60, aspectRatio: '9:16', inferenceEffort: 'xhigh', enableSubtitles: true };
  await waitFor(() => expect(axios.put).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('/users/create_defaults'), { createDefaults: expected }, { headers: { Authorization: 'Bearer test' } }));
  expect(fixture.setUser).toHaveBeenCalledExactlyOnceWith({ ...fixture.user, createDefaults: expected });
  expect(screen.getByRole('status')).toHaveTextContent('Create defaults saved.');
  expect(screen.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
});

it('retains unsaved changes after a failed save and allows a successful retry', async () => {
  axios.put.mockRejectedValueOnce({ response: { data: { message: 'Unable to persist defaults.' } } });
  await mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Duration' }), { target: { value: '120' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to persist defaults.');
  expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveValue('120');
  expect(fixture.setUser).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }));
  await waitFor(() => expect(fixture.setUser).toHaveBeenCalledWith(expect.objectContaining({ createDefaults: expect.objectContaining({ duration: 120 }) })));
});

it('merges a slow save into the latest profile for the same account', async () => {
  let resolve;
  axios.put.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const view = await mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Duration' }), { target: { value: '60' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }));
  fixture.user = { ...fixture.user, generationCredits: 1234 };
  view.rerender(<CreateDefaultsSettings />);
  await act(async () => resolve({ data: { createDefaults: { ...systemDefaults, duration: 60 } } }));
  expect(fixture.setUser).toHaveBeenCalledWith(expect.objectContaining({ generationCredits: 1234, createDefaults: expect.objectContaining({ duration: 60 }) }));
});

it('ignores a slow save response after the signed-in account changes', async () => {
  let resolve;
  axios.put.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const view = await mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Duration' }), { target: { value: '60' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }));
  fixture.user = { ...fixture.user, _id: 'other-owner' };
  view.rerender(<CreateDefaultsSettings />);
  await act(async () => resolve({ data: { createDefaults: { ...systemDefaults, duration: 60 } } }));
  expect(fixture.setUser).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: 'Duration' })).toHaveValue('30');
});

it('blocks saving a stale square aspect ratio when the chosen video model does not support it', async () => {
  axios.get.mockResolvedValue({ data: { createDefaults: { ...systemDefaults, aspectRatio: '1:1' } } });
  await mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Video model' }), { target: { value: 'RUNWAYML' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Choose an aspect ratio supported by both');
  expect(screen.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
  expect(within(screen.getByRole('combobox', { name: 'Aspect ratio' })).getByRole('option', { name: '1:1' })).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Aspect ratio' }), { target: { value: '16:9' } });
  expect(screen.getByRole('button', { name: 'Save defaults' })).toBeEnabled();
});

it('retries a failed initial read before accepting changes', async () => {
  axios.get.mockRejectedValueOnce(new Error('Offline'));
  await mount();
  expect(screen.getByRole('alert')).toHaveTextContent('Unable to load Create defaults.');
  expect(screen.getByRole('combobox', { name: 'Duration' })).toBeDisabled();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Retry' })));
  expect(axios.get).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('combobox', { name: 'Duration' })).toBeEnabled();
});

it('supports Gemini variants and hides inapplicable reasoning effort', async () => {
  await mount();
  fireEvent.change(screen.getByRole('combobox', { name: 'Text model' }), { target: { value: 'Gemini' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Gemini model' }), { target: { value: 'gemini-4-neon' } });
  expect(screen.queryByRole('combobox', { name: 'Reasoning effort' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save defaults' }));
  await waitFor(() => expect(axios.put).toHaveBeenCalledWith(expect.any(String), { createDefaults: { ...systemDefaults, inferenceModel: 'gemini-4-neon' } }, expect.any(Object)));
});

it('lists priced supported video models and excludes the unsupported custom video runner', async () => {
  await mount();
  const video = screen.getByRole('combobox', { name: 'Video model' });
  expect(within(video).getByRole('option', { name: 'RunwayML Gen 4.5' })).toBeInTheDocument();
  expect(within(video).getByRole('option', { name: 'Kling 4 Img2Vid' })).toBeInTheDocument();
  expect(within(video).queryByRole('option', { name: 'Custom Image to Video' })).toBeNull();
});

it('preserves unavailable standalone choices and blocks saving until supported models are chosen', async () => {
  fixture.deployment = { isStandaloneDeployment: true, isLoading: false, textToVideoImageModelValues: ['SEEDREAM'], textToVideoVideoModelValues: ['RUNWAYML'] };
  await mount();
  expect(screen.getByRole('alert')).toHaveTextContent('One or more saved models are unavailable.');
  expect(screen.getByRole('button', { name: 'Save defaults' })).toBeDisabled();
  expect(axios.put).not.toHaveBeenCalled();
  expect(fixture.setUser).not.toHaveBeenCalled();
});

it('opens the dedicated Defaults deep link and navigates to General without losing its existing controls', async () => {
  function Route() { return <output aria-label="Current route">{useLocation().pathname}</output>; }
  render(<MemoryRouter initialEntries={['/account/settings/defaults']}><LocalizationProvider><SettingsPanelContent updateUserDetails={vi.fn()} /><Route /></LocalizationProvider></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Create defaults' })).toBeVisible();
  await waitFor(() => expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'false'));
  fireEvent.click(screen.getByRole('button', { name: 'General', exact: true }));
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/account/settings');
  expect(screen.getByRole('combobox', { name: 'Text model' })).toHaveValue('gpt-6.2-astra');
  expect(screen.queryByRole('heading', { name: 'Create defaults' })).toBeNull();
});
