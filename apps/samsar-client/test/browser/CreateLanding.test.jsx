import { render } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import axios from 'axios';
import CreateLanding from '../../src/components/landing/CreateLanding.jsx';
import { AlertDialogProvider } from '../../src/contexts/AlertDialogContext.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { NavCanvasControlContext } from '../../src/contexts/NavCanvasControlContext.jsx';
import { WorkspaceNavigationProvider } from '../../src/components/common/WorkspaceNavigation.jsx';
import { setUiLanguage } from '../../src/utils/localization.js';
import '../../src/index.css';

const scenario = vi.hoisted(() => ({ user: {} }));
const headers = { headers: { Authorization: 'Bearer create-browser-test' } };

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => scenario.user }));
vi.mock('../../src/utils/web.jsx', async (importOriginal) => ({
  ...await importOriginal(),
  getHeaders: () => ({ headers: { Authorization: 'Bearer create-browser-test' } }),
}));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({
  useDeploymentModelAvailability: () => ({ isStandaloneDeployment: false, isLoading: false }),
}));
vi.mock('../../src/hooks/useInferenceModelAvailability.js', () => ({
  useInferenceModelAvailability: () => ({ isLoading: false }),
}));
vi.mock('../../src/components/landing/CreatePublishedGallery.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/oneshot_editor/OneshotEditorContainer.jsx', () => ({ preloadOneshotEditor: vi.fn().mockResolvedValue(undefined) }));

function CurrentRoute() {
  const location = useLocation();
  return <output aria-label="Current route">{location.pathname}{location.search}</output>;
}

function mount(theme) {
  localStorage.setItem('colorMode', theme);
  return render(
    <MemoryRouter initialEntries={['/create']}>
      <LocalizationProvider>
        <AlertDialogProvider>
          <ColorModeProvider>
            <NavCanvasControlContext.Provider value={{}}>
              <WorkspaceNavigationProvider>
                <Routes>
                  <Route path="/create" element={<CreateLanding />} />
                  <Route path="*" element={<div>Video progress</div>} />
                </Routes>
                <CurrentRoute />
              </WorkspaceNavigationProvider>
            </NavCanvasControlContext.Provider>
          </ColorModeProvider>
        </AlertDialogProvider>
      </LocalizationProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  scenario.user = {
    user: { _id: 'creator', email: 'creator@example.com', generationCredits: 5000 },
    userInitiated: true,
    userFetching: false,
  };
  setUiLanguage('en');
  axios.post.mockReset().mockResolvedValue({ data: { request_id: 'created-video', session_id: 'created-video' } });
  axios.get.mockReset();
});

afterEach(() => {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.documentElement.classList.remove('dark');
});

for (const theme of ['light', 'dark']) {
  for (const [width, height] of [[375, 812], [1280, 800]]) {
    it(`shows a single prompt and reachable CTA at ${width}px in ${theme} mode`, async () => {
      await page.viewport(width, height);
      const view = mount(theme);
      const prompt = page.getByRole('textbox', { name: 'Describe your video', exact: true });
      const submit = page.getByRole('button', { name: 'Create video', exact: true });
      await expect.element(prompt).toBeVisible();
      await expect.element(submit).toBeVisible();
      await expect.element(submit).toBeDisabled();
      await expect.element(page.getByRole('link', { name: 'Create', exact: true })).not.toBeInTheDocument();
      const projects = page.getByRole('button', { name: 'View Projects', exact: true });
      await expect.element(projects).toBeVisible();
      await projects.click();
      await expect.element(page.getByRole('menuitem', { name: 'Create', exact: true })).toHaveAttribute('aria-current', 'page');
      await userEvent.keyboard('{Escape}');
      expect(view.container.querySelectorAll('textarea')).toHaveLength(1);
      expect(view.container.querySelectorAll('select')).toHaveLength(2);
      for (const label of view.container.querySelectorAll('label[for="create-duration"], label[for="create-aspect-ratio"]')) {
        expect(label.getBoundingClientRect().height).toBeGreaterThan(12);
        expect(label.control.offsetHeight).toBeGreaterThanOrEqual(44);
      }
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      expect(document.querySelector('[data-app-top-nav]').scrollWidth).toBeLessThanOrEqual(width);
      const promptBounds = prompt.element().getBoundingClientRect();
      const submitBounds = submit.element().getBoundingClientRect();
      const headingBounds = page.getByRole('heading', { name: 'Create video', exact: true }).element().getBoundingClientRect();
      const navigationBounds = document.querySelector('[data-app-top-nav]').getBoundingClientRect();
      expect(headingBounds.top).toBeGreaterThanOrEqual(navigationBounds.bottom);
      expect(promptBounds.left).toBeGreaterThanOrEqual(0);
      expect(promptBounds.right).toBeLessThanOrEqual(width);
      expect(submitBounds.bottom).toBeLessThanOrEqual(height);
      expect(submitBounds.right).toBeLessThanOrEqual(width);
      expect(axios.post).not.toHaveBeenCalled();
      expect(axios.get).not.toHaveBeenCalled();
      const artwork = view.container.querySelector('.create-splash-artwork img');
      await expect.poll(() => artwork.naturalWidth).toBeGreaterThan(0);
      expect(artwork.currentSrc.includes('-portrait-')).toBe(width <= 640);
      await page.screenshot({ path: `test-results/create-landing-${theme}-${width}.png` });
      const help = page.getByRole('button', { name: 'About Create defaults', exact: true });
      await help.click();
      const guidance = page.getByRole('dialog', { name: 'Create defaults', exact: true });
      await expect.element(guidance).toBeVisible();
      await expect.element(guidance).toHaveTextContent('Saved defaults: 60s · 16:9');
      await expect.element(guidance).toHaveTextContent('Duration and aspect ratio changes here apply only to this video.');
      await expect.element(page.getByRole('link', { name: 'Change defaults', exact: true })).toHaveAttribute('href', '/account/settings/defaults');
      const guidanceBounds = guidance.element().getBoundingClientRect();
      expect(guidanceBounds.left).toBeGreaterThanOrEqual(0);
      expect(guidanceBounds.right).toBeLessThanOrEqual(width);
      expect(guidanceBounds.top).toBeGreaterThanOrEqual(0);
      expect(guidanceBounds.bottom).toBeLessThanOrEqual(height);
      await userEvent.keyboard('{Escape}');
      await expect.element(guidance).not.toBeInTheDocument();
      await expect.element(help).toHaveFocus();
    });
  }
}

it('submits the defaults from the visible form and opens the video progress route', async () => {
  await page.viewport(375, 812);
  mount('dark');
  await page.getByRole('textbox', { name: 'Describe your video', exact: true }).fill('  A quiet city waking up  ');
  await page.getByRole('button', { name: 'Create video', exact: true }).click();
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/vidgenie/created-video?view=preview');
  expect(axios.post).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining('/v2/video/step/text_to_video'),
    { input: {
      prompt: 'A quiet city waking up',
      inference_model: 'claude-opus-5.5',
      effort: 'high',
      image_model: 'GPTIMAGE2.5',
      video_model: 'KLINGIMGTOVID4',
      duration: 60,
      aspect_ratio: '16:9',
      language: 'auto',
      enable_subtitles: false,
      generation_step_mode: 'one_step',
      auto_render_full_video: true,
      manual_step_stages: [],
    } },
    headers,
  );
  expect(localStorage.getItem('videoSessionId')).toBe('created-video');
  expect(sessionStorage.getItem('samsarCreatePrompt')).toBeNull();
});

it('takes an underfunded user to billing and retains their video prompt', async () => {
  await page.viewport(375, 812);
  scenario.user.user.generationCredits = 100;
  mount('light');
  await page.getByRole('textbox', { name: 'Describe your video', exact: true }).fill('A city at sunrise');
  const alert = page.getByRole('alert');
  await expect.element(alert).toHaveTextContent('This render needs 2,160 credits. Your balance is 100.');
  await expect.element(page.getByRole('button', { name: 'Create video', exact: true })).toBeDisabled();
  await alert.getByRole('link', { name: 'Purchase credits', exact: true }).click();
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/account/billing');
  expect(sessionStorage.getItem('samsarCreatePrompt')).toBe('A city at sunrise');
  expect(axios.post).not.toHaveBeenCalled();
});

it('keeps the draft and saved options intact through the loading skeleton', async () => {
  await page.viewport(375, 812);
  sessionStorage.setItem('samsarCreatePrompt', 'An idea saved before signing in');
  scenario.user.userFetching = true;
  const view = mount('dark');
  const loading = page.getByRole('status', { name: 'Loading...', exact: true });
  await expect.element(loading).toBeVisible();
  expect(loading.element().querySelectorAll('button, input, select, textarea, a')).toHaveLength(0);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  await page.screenshot({ path: 'test-results/create-landing-loading-mobile.png' });
  scenario.user.userFetching = false;
  // Mounting the same page after authentication must recover the stored draft.
  view.unmount();
  mount('dark');
  await expect.element(page.getByRole('textbox', { name: 'Describe your video', exact: true })).toHaveValue('An idea saved before signing in');
  expect(axios.post).not.toHaveBeenCalled();
});
