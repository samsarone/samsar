import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import SettingsPanelContent from '../../src/components/account/SettingsPanelContent.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { setUiLanguage } from '../../src/utils/localization.js';

const profile = vi.hoisted(() => ({ user: null, update: vi.fn() }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: profile.user }) }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'dark' }) }));
vi.mock('../../src/hooks/useGoogleTTSSpeakers.js', () => ({ useGoogleTTSSpeakers: () => ({ googleSpeakers: [] }), fetchGoogleTTSPreviewBlobUrl: vi.fn() }));
vi.mock('../../src/hooks/useAudioProviderAvailability.js', () => ({ useAudioProviderAvailability: () => ({ audioAvailability: null }) }));

function mountSettings() {
  return render(<MemoryRouter initialEntries={['/account/settings']}>
    <LocalizationProvider><SettingsPanelContent updateUserDetails={profile.update} /></LocalizationProvider>
  </MemoryRouter>);
}

beforeEach(() => {
  setUiLanguage('en');
  profile.user = { _id: 'owner', username: 'Creator', preferredLanguage: 'en' };
  profile.update.mockReset().mockResolvedValue(true);
});

it('shows the requested system models when no personal choices are saved', () => {
  mountSettings();
  expect(screen.getByRole('combobox', { name: 'Text model' })).toHaveValue('claude-opus-5.5');
  expect(screen.getByRole('combobox', { name: 'Image model' })).toHaveValue('GPTIMAGE2.5');
  expect(screen.getByRole('combobox', { name: 'Video model' })).toHaveValue('KLINGIMGTOVID4');
  expect(profile.update).not.toHaveBeenCalled();
});

it('keeps a saved choice through an unrelated settings save', async () => {
  profile.user = { ...profile.user, selectedInferenceModel: 'gpt-6.2-astra', agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML' };
  mountSettings();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Update', exact: true })));
  expect(profile.update).toHaveBeenCalledWith(expect.objectContaining({ selectedInferenceModel: 'gpt-6.2-astra', agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML' }));
});

it('saves model changes and updates the browser selection after success', async () => {
  mountSettings();
  fireEvent.change(screen.getByRole('combobox', { name: 'Image model' }), { target: { value: 'SEEDREAM' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Video model' }), { target: { value: 'RUNWAYML' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Update', exact: true })));
  expect(profile.update).toHaveBeenCalledWith(expect.objectContaining({ agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML' }));
  expect(localStorage.getItem('defaultVidGPTImageGenerationModel')).toBe('SEEDREAM');
  expect(localStorage.getItem('defaultVIdGPTVideoGenerationModel')).toBe('RUNWAYML');
});

it('retains browser preferences when the settings save fails', async () => {
  profile.update.mockResolvedValue(false);
  localStorage.setItem('defaultVIdGPTVideoGenerationModel', 'KLINGIMGTOVID4');
  mountSettings();
  fireEvent.change(screen.getByRole('combobox', { name: 'Video model' }), { target: { value: 'RUNWAYML' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Update', exact: true })));
  expect(localStorage.getItem('defaultVIdGPTVideoGenerationModel')).toBe('KLINGIMGTOVID4');
});

it('saves Neon as the selected Gemini model and restores it without changing other defaults', async () => {
  profile.user = { ...profile.user, selectedInferenceModel: 'gemini-4-carbon', agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML' };
  const view = mountSettings();
  expect(screen.getByRole('combobox', { name: 'Text model' })).toHaveValue('Gemini');
  fireEvent.change(screen.getByRole('combobox', { name: 'Gemini model' }), { target: { value: 'gemini-4-neon' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Update', exact: true })));
  expect(profile.update).toHaveBeenCalledWith(expect.objectContaining({
    selectedInferenceModel: 'gemini-4-neon', agentImageModel: 'SEEDREAM', agentVideoModel: 'RUNWAYML',
  }));
  view.unmount();
  profile.user = { ...profile.user, selectedInferenceModel: 'gemini-4-neon' };
  mountSettings();
  expect(screen.getByRole('combobox', { name: 'Gemini model' })).toHaveValue('gemini-4-neon');
});
