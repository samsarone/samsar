import { useState } from 'react';
import { render } from '@testing-library/react';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import axios from 'axios';
import UserAccount from '../../src/components/account/UserAccount.tsx';
import CreateLanding from '../../src/components/landing/CreateLanding.jsx';
import { AlertDialogProvider } from '../../src/contexts/AlertDialogContext.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { NavCanvasControlContext } from '../../src/contexts/NavCanvasControlContext.jsx';
import { WorkspaceNavigationProvider } from '../../src/components/common/WorkspaceNavigation.jsx';
import { setUiLanguage } from '../../src/utils/localization.js';
import '../../src/index.css';

const fixture = vi.hoisted(() => ({ Context: null, user: null, currentUser: null, defaults: null, options: [{ value: 'claude-opus-5.5', label: 'Claude Opus 5.5' }, { value: 'gpt-6.2-astra', label: 'GPT 6.2 Astra' }] }));
const headers = { headers: { Authorization: 'Bearer defaults-browser-test' } };
vi.mock('axios', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', async () => {
  const React = await import('react');
  fixture.Context = React.createContext(null);
  return { useUser: () => React.useContext(fixture.Context) };
});
vi.mock('../../src/utils/web.jsx', async (importOriginal) => ({ ...await importOriginal(), getHeaders: () => ({ headers: { Authorization: 'Bearer defaults-browser-test' } }) }));
vi.mock('../../src/hooks/useGoogleTTSSpeakers.js', () => ({ useGoogleTTSSpeakers: () => ({ googleSpeakers: [] }), fetchGoogleTTSPreviewBlobUrl: vi.fn() }));
vi.mock('../../src/hooks/useAudioProviderAvailability.js', () => ({ useAudioProviderAvailability: () => ({ audioAvailability: null }) }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => ({ isStandaloneDeployment: false, isLoading: false }) }));
vi.mock('../../src/hooks/useInferenceModelAvailability.js', () => ({ useInferenceModelAvailability: () => {
  return { isLoading: false, isStandaloneDeployment: false, inferenceModelOptions: fixture.options, assistantModelOptions: fixture.options, hasConfiguredInferenceModels: true };
} }));
vi.mock('../../src/components/landing/CreatePublishedGallery.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/oneshot_editor/OneshotEditorContainer.jsx', () => ({ preloadOneshotEditor: vi.fn().mockResolvedValue(undefined) }));

function TestUserProvider({ children }) {
  const [user, setUser] = useState(fixture.user);
  fixture.currentUser = user;
  return <fixture.Context.Provider value={{ user, setUser, userFetching: false, userInitiated: true }}>{children}</fixture.Context.Provider>;
}
function CurrentRoute() {
  const location = useLocation();
  return <output aria-label="Current route" className="sr-only">{location.pathname}{location.search}</output>;
}
function mount(theme) {
  localStorage.setItem('colorMode', theme);
  return render(<MemoryRouter initialEntries={['/account/settings/defaults']}>
    <TestUserProvider><LocalizationProvider><AlertDialogProvider><ColorModeProvider>
      <NavCanvasControlContext.Provider value={{}}><WorkspaceNavigationProvider>
        <Routes>
          <Route path="/account/*" element={<UserAccount />} />
          <Route path="/create" element={<CreateLanding />} />
          <Route path="*" element={<div>Video progress</div>} />
        </Routes>
        <CurrentRoute />
      </WorkspaceNavigationProvider></NavCanvasControlContext.Provider>
    </ColorModeProvider></AlertDialogProvider></LocalizationProvider></TestUserProvider>
  </MemoryRouter>);
}

beforeEach(() => {
  setUiLanguage('en');
  fixture.defaults = { inferenceModel: 'claude-opus-5.5', imageModel: 'GPTIMAGE2.5', videoModel: 'KLINGIMGTOVID4', inferenceEffort: 'high', duration: 30, aspectRatio: '16:9', enableSubtitles: false };
  fixture.user = { _id: 'creator', username: 'Creator', email: 'creator@example.com', generationCredits: 2000, selectedInferenceModel: 'claude-opus-5.5', selectedAssistantModel: 'claude-opus-5.5', selectedInferenceEffort: 'high', createDefaults: fixture.defaults };
  axios.get.mockReset().mockImplementation(async (url) => ({ data: String(url).endsWith('/users/create_defaults') ? { createDefaults: fixture.defaults } : { apiKeys: [], items: [] } }));
  axios.put.mockReset().mockImplementation(async (_url, { createDefaults }) => { fixture.defaults = createDefaults; return { data: { createDefaults } }; });
  axios.post.mockReset().mockResolvedValue({ data: { session_id: 'defaults-video' } });
});
afterEach(() => {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.documentElement.classList.remove('dark');
});

for (const theme of ['light', 'dark']) {
  for (const [width, height] of [[375, 812], [1280, 800]]) {
    it(`renders the dedicated Defaults route with reachable controls at ${width}px in ${theme}`, async () => {
      await page.viewport(width, height);
      mount(theme);
      await expect.element(page.getByRole('heading', { name: 'Create defaults', exact: true })).toBeVisible();
      await expect.element(page.getByRole('combobox', { name: 'Duration', exact: true })).toBeEnabled();
      await expect.element(page.getByRole('button', { name: 'Save defaults', exact: true })).toBeDisabled();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const form = page.getByRole('form', { name: 'Create defaults', exact: true }).element();
      expect(form.scrollWidth).toBeLessThanOrEqual(form.clientWidth);
      for (const select of form.querySelectorAll('select')) {
        const bounds = select.getBoundingClientRect();
        expect(bounds.left).toBeGreaterThanOrEqual(0);
        expect(bounds.right).toBeLessThanOrEqual(width);
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      await page.screenshot({ path: `test-results/create-defaults-${theme}-${width}.png` });
      const save = page.getByRole('button', { name: 'Save defaults', exact: true });
      save.element().scrollIntoView({ block: 'center' });
      await expect.element(save).toBeVisible();
      const saveBounds = save.element().getBoundingClientRect();
      expect(saveBounds.bottom).toBeLessThanOrEqual(height);
      expect(saveBounds.right).toBeLessThanOrEqual(width);
      expect(saveBounds.height).toBeGreaterThanOrEqual(width === 375 ? 44 : 38);
      await page.screenshot({ path: `test-results/create-defaults-actions-${theme}-${width}.png` });
      expect(axios.put).not.toHaveBeenCalled();
    });
  }
}

it('saves account defaults then uses them when Create submits a new video', async () => {
  await page.viewport(375, 812);
  mount('dark');
  const duration = page.getByRole('combobox', { name: 'Duration', exact: true });
  await expect.element(duration).toBeEnabled();
  await duration.selectOptions('60');
  await page.getByRole('combobox', { name: 'Text model', exact: true }).selectOptions('gpt-6.2-astra');
  await page.getByRole('combobox', { name: 'Image model', exact: true }).selectOptions('SEEDREAM');
  await page.getByRole('combobox', { name: 'Video model', exact: true }).selectOptions('RUNWAYML');
  await page.getByRole('combobox', { name: 'Aspect ratio', exact: true }).selectOptions('9:16');
  await page.getByRole('combobox', { name: 'Reasoning effort', exact: true }).selectOptions('xhigh');
  await page.getByRole('checkbox', { name: 'Enable subtitles', exact: true }).click();
  await page.getByRole('button', { name: 'Save defaults', exact: true }).click();
  await expect.element(page.getByRole('form', { name: 'Create defaults', exact: true }).getByRole('status')).toHaveTextContent('Create defaults saved.');
  expect(axios.put).toHaveBeenCalledOnce();
  expect(fixture.currentUser.createDefaults).toMatchObject({ inferenceModel: 'gpt-6.2-astra', imageModel: 'SEEDREAM', videoModel: 'RUNWAYML', duration: 60, aspectRatio: '9:16', inferenceEffort: 'xhigh', enableSubtitles: true });
  await page.getByRole('link', { name: 'Create', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'Create video', exact: true })).toBeVisible();
  await expect.element(page.getByRole('combobox', { name: 'Duration', exact: true })).toHaveValue('60');
  await expect.element(page.getByRole('combobox', { name: 'Aspect ratio', exact: true })).toHaveValue('9:16');
  await expect.element(page.getByRole('status', { name: 'Render estimate' })).toHaveTextContent('1,800 credits');
  await page.getByRole('textbox', { name: 'Describe your video', exact: true }).fill('A city waking up');
  await page.getByRole('button', { name: 'Create video', exact: true }).click();
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/vidgenie/defaults-video?view=preview');
  const createRequest = axios.post.mock.calls.find(([url]) => String(url).includes('/v2/video/step/text_to_video'));
  expect(createRequest).toEqual([expect.stringContaining('/v2/video/step/text_to_video'), { input: expect.objectContaining({ inference_model: 'gpt-6.2-astra', image_model: 'SEEDREAM', video_model: 'RUNWAYML', duration: 60, aspect_ratio: '9:16', effort: 'xhigh', enable_subtitles: true }) }, headers]);
});
