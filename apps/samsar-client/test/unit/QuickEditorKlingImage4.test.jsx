import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import QuickEditor from '../../src/components/quick_editor/QuickEditor.jsx';

const boundary = vi.hoisted(() => ({
  empty: [],
  user: { _id: 'owner', generationCredits: 1000 },
  availability: { isStandaloneDeployment: false, textToVideoImageModelValues: [], textToVideoVideoModelValues: [] },
}));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/utils/web.jsx', () => ({ getHeaders: () => ({ headers: { Authorization: 'Bearer test-session' } }) }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({ user: boundary.user }) }));
vi.mock('../../src/contexts/ColorMode.jsx', () => ({ useColorMode: () => ({ colorMode: 'light' }) }));
vi.mock('../../src/contexts/AlertDialogContext.jsx', () => ({ useAlertDialog: () => ({ openAlertDialog: vi.fn(), closeAlertDialog: vi.fn() }) }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => boundary.availability }));
vi.mock('../../src/hooks/useGoogleTTSSpeakers.js', () => ({
  useGoogleTTSSpeakers: () => ({ googleSpeakers: boundary.empty }),
  mergeGoogleTTSSpeakers: (speakers) => speakers,
  getGoogleTTSVoiceDetails: vi.fn(), fetchGoogleTTSPreviewBlobUrl: vi.fn(),
}));
vi.mock('../../src/hooks/useAudioProviderAvailability.js', () => ({ useAudioProviderAvailability: () => ({ audioAvailability: null }) }));
vi.mock('../../src/components/assistant/AssistantHome.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/library/audio/MusicLibraryHome.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/oneshot_editor/ProgressIndicator.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/auth/AuthContainer.jsx', () => ({ default: () => null, AUTH_DIALOG_OPTIONS: {} }));
vi.mock('../../src/components/quick_editor/CombinedAudioSelect.jsx', () => ({ default: () => null }));
// Keep QuickEditor's state and request construction real while exposing the
// select-widget boundary as native controls for deterministic interaction.
vi.mock('../../src/components/common/SingleSelect.jsx', () => ({ default: ({ options = [], value, onChange }) => <select
  aria-label={options.some((option) => option.value === 'GPTIMAGE2.5') ? 'Image model'
    : options.some((option) => option.value === '1:1') ? 'Aspect ratio' : undefined}
  value={value?.value || ''}
  onChange={(event) => onChange(options.find((option) => String(option.value) === event.target.value))}
>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select> }));

beforeEach(() => {
  axios.get.mockResolvedValue({ data: { _id: 'quick-project' } });
  // Submission succeeds asynchronously in production; leave it pending here
  // so this request-boundary test never starts the unrelated polling timer.
  axios.post.mockReturnValue(new Promise(() => {}));
});

function mount() {
  return render(<MemoryRouter initialEntries={['/quick/quick-project']}><Routes>
    <Route path='/quick/:id' element={<QuickEditor />} />
  </Routes></MemoryRouter>);
}

it.each(['16:9', '9:16'])('offers Kling for %s and submits the standard 720p setting', async (aspectRatio) => {
  localStorage.setItem('defaultAspectRatio', aspectRatio);
  localStorage.setItem('defaultModel', 'KLINGIMAGE4');
  mount();
  await waitFor(() => expect(axios.get).toHaveBeenCalled());
  expect(screen.getByRole('combobox', { name: 'Image model' })).toHaveValue('KLINGIMAGE4');
  fireEvent.change(screen.getByPlaceholderText('Type your narrative here. One line per scene. Do not enter prompts, just the narrative text.'), { target: { value: 'The train reaches the mountains.' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })));
  expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/quick_session\/create$/), expect.objectContaining({
    imageModel: 'KLINGIMAGE4', aspectRatio, resolution: '720p',
  }), expect.anything());
});

it('removes Kling on square and replaces a saved Kling preference before submitting', async () => {
  localStorage.setItem('defaultAspectRatio', '16:9');
  localStorage.setItem('defaultModel', 'KLINGIMAGE4');
  mount();
  await waitFor(() => expect(axios.get).toHaveBeenCalled());
  fireEvent.change(screen.getByRole('combobox', { name: 'Aspect ratio' }), { target: { value: '1:1' } });
  expect(screen.queryByRole('option', { name: 'Kling Image 4' })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Image model' })).toHaveValue('GPTIMAGE2.5');
  fireEvent.change(screen.getByPlaceholderText('Type your narrative here. One line per scene. Do not enter prompts, just the narrative text.'), { target: { value: 'The train reaches the mountains.' } });
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Submit', exact: true })));
  expect(axios.post).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ imageModel: 'GPTIMAGE2.5', aspectRatio: '1:1' }), expect.anything());
  expect(axios.post.mock.calls[0][1]).not.toHaveProperty('resolution');
});
