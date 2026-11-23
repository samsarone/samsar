import { render, screen, waitFor } from '@testing-library/react';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import axios from 'axios';
import OneshotEditorContainer from '../../src/components/oneshot_editor/OneshotEditorContainer.jsx';
import { AlertDialogProvider } from '../../src/contexts/AlertDialogContext.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { NavCanvasControlContext } from '../../src/contexts/NavCanvasControlContext.jsx';
import { WorkspaceNavigationProvider } from '../../src/components/common/WorkspaceNavigation.jsx';
import { setUiLanguage } from '../../src/utils/localization.js';
import clipUrl from '../fixtures/studio-preview.webm?url';
import toneUrl from '../fixtures/vidgenie-preview-tone.wav?url';
import '../../src/index.css';

const scenario = vi.hoisted(() => ({ user: null, session: null, status: null, getUserAPI: vi.fn() }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({
  user: scenario.user,
  userInitiated: true, userFetching: false, getUserAPI: scenario.getUserAPI,
}) }));
vi.mock('../../src/utils/web.jsx', async (importOriginal) => ({
  ...await importOriginal(),
  getHeaders: () => ({ headers: { Authorization: 'Bearer preview-browser-test' } }),
}));
vi.mock('react-tooltip', () => ({ Tooltip: () => null }));
vi.mock('../../src/components/landing/CreatePublishedGallery.jsx', () => ({ default: () => null }));

function CurrentRoute() {
  const { pathname, search } = useLocation();
  return <output aria-label="Current route">{pathname}{search}</output>;
}

function mount(theme, path = '/vidgenie/create-preview?view=preview', app = (
  <Routes><Route path="/vidgenie/:id" element={<OneshotEditorContainer />} /></Routes>
)) {
  localStorage.setItem('colorMode', theme);
  return render(<MemoryRouter initialEntries={[path]}>
    <LocalizationProvider><AlertDialogProvider><ColorModeProvider>
      <NavCanvasControlContext.Provider value={{}}><WorkspaceNavigationProvider>
        {app}<CurrentRoute />
      </WorkspaceNavigationProvider></NavCanvasControlContext.Provider>
    </ColorModeProvider></AlertDialogProvider></LocalizationProvider>
  </MemoryRouter>);
}

beforeEach(() => {
  setUiLanguage('en');
  scenario.user = { _id: 'creator', email: 'creator@example.com', generationCredits: 2000, isEmailVerified: true };
  scenario.session = {
    _id: 'create-preview', inputPrompt: 'A quiet city waking up, from the first light to the morning rush.',
    generationType: 'TEXT_TO_VIDEO', expressGenerationPending: true, isExpressGeneration: true,
    aspectRatio: '16:9', layers: [],
  };
  scenario.status = {
    status: 'PENDING', session_id: 'create-preview', current_step: 'video_generation',
    expressGenerationStatus: { prompt_generation: 'COMPLETED', image_generation: 'COMPLETED', speech_generation: 'COMPLETED', video_generation: 'IN_PROGRESS' },
    session: {
      id: 'create-preview', aspectRatio: '16:9', duration: 4,
      layers: [{ id: 'scene-one', startTime: 0, duration: 4, aiVideo: { status: 'COMPLETED', url: clipUrl } }],
      audioLayers: [{ id: 'narration', type: 'speech', status: 'COMPLETED', startTime: 0, duration: 4, url: toneUrl }],
    },
  };
  axios.get.mockReset().mockImplementation(async url => {
    if (url.includes('/video_sessions/session_details')) return { data: scenario.session };
    if (url.includes('status_detailed')) return { data: scenario.status };
    throw new Error(`Unexpected preview request: ${url}`);
  });
  axios.post.mockReset().mockResolvedValue({ data: {} });
});
afterEach(() => {
  vi.unstubAllEnvs();
  document.body.classList.remove('theme-dark', 'theme-light');
  document.documentElement.classList.remove('dark');
});

for (const theme of ['light', 'dark']) {
  for (const [width, height] of [[375, 812], [1280, 800]]) {
    it(`keeps the focused render preview visible at ${width}px in ${theme}`, async () => {
      await page.viewport(width, height);
      const { container } = mount(theme);
      await expect.element(page.getByRole('heading', { name: 'Creating your video...', exact: true })).toBeVisible();
      await expect.element(page.getByText('Live preview', { exact: true })).toBeVisible();
      await waitFor(() => expect(container.querySelector('main video')?.readyState).toBeGreaterThanOrEqual(2));
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(container.querySelector('.vidgenie-timeline-group')).toBeNull();
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const frame = container.querySelector('main .vidgenie-preview-frame').getBoundingClientRect();
      expect(frame.left).toBeGreaterThanOrEqual(0);
      expect(frame.right).toBeLessThanOrEqual(width);
      expect(frame.width / frame.height).toBeCloseTo(16 / 9, 1);
      await expect.element(page.getByRole('button', { name: 'Pause render', exact: true })).toBeVisible();
      await expect.element(page.getByRole('link', { name: 'Open in VidGenie', exact: true })).toBeVisible();
      await page.screenshot({ path: `test-results/create-render-preview-${theme}-${width}.png` });
    });
  }
}

it('plays the focused live video and speech without replacing media when a render is paused', async () => {
  await page.viewport(375, 812);
  const { container } = mount('light');
  await expect.element(page.getByText('Live preview', { exact: true })).toBeVisible();
  await waitFor(() => expect(container.querySelector('main video')?.readyState).toBeGreaterThanOrEqual(2));
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  await page.getByRole('button', { name: 'Unmute preview audio', exact: true }).click();
  const video = container.querySelector('main video');
  const audio = container.querySelector('main audio');
  await waitFor(() => { expect(video.paused).toBe(false); expect(audio.paused).toBe(false); expect(audio.currentTime).toBeGreaterThan(0.1); });
  await page.getByRole('button', { name: 'Pause render', exact: true }).click();
  await expect.element(page.getByRole('heading', { name: 'Render paused', exact: true })).toBeVisible();
  expect(container.querySelector('main video')).toBe(video);
  expect(container.querySelector('main audio')).toBe(audio);
  await page.getByRole('button', { name: 'Pause preview', exact: true }).click();
});

it.each([
  ['pending', '/vidgenie/create-preview?view=preview'],
  ['paused', '/vidgenie/create-preview?view=preview'],
  ['completed', '/create'],
  ['failed', '/create'],
  ['no render', '/create'],
  ['lookup failed', '/create'],
])('opens the app to the correct screen when the latest render is %s', async (status, expectedPath) => {
  vi.stubEnv('VITE_PROCESSOR_API', '/api');
  const { default: Home } = await import('../../src/components/landing/Home.tsx');
  localStorage.setItem('videoSessionId', 'stale-project');
  if (status === 'paused') {
    scenario.session.expressGenerationPaused = true;
    scenario.session.expressGenerationPending = false;
    scenario.status.status = 'PAUSED';
  }
  const editorRequest = axios.get.getMockImplementation();
  axios.get.mockImplementation(async (url, options) => {
    if (!url.endsWith('/video_sessions/latest_render')) return editorRequest(url, options);
    if (status === 'lookup failed') throw new Error('Latest render unavailable');
    return { data: status === 'no render' ? null : { sessionId: 'create-preview', status } };
  });

  mount('light', '/', <Home />);
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent(expectedPath);
  if (expectedPath === '/create') {
    await expect.element(page.getByRole('textbox', { name: 'Describe your video', exact: true })).toBeVisible();
  } else {
    const name = status === 'paused' ? 'Render paused' : 'Creating your video...';
    await expect.element(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  const urls = axios.get.mock.calls.map(([url]) => url);
  expect(urls.filter(url => url.endsWith('/video_sessions/latest_render'))).toHaveLength(1);
  expect(urls.some(url => url.includes('stale-project'))).toBe(false);
  expect(axios.post).not.toHaveBeenCalled();
});

it.each([
  ['PENDING', '/external/studio?request=partner-render', 375],
  ['PENDING', '/external/studio?request=partner-render', 1280],
  ['COMPLETED', '/create', 1280],
  ['FAILED', '/create', 1280],
  [null, '/create', 1280],
])('opens the external account home from its latest scoped request (%s → %s at %i px)', async (status, expectedPath, width) => {
  await page.viewport(width, 812);
  vi.stubEnv('VITE_PROCESSOR_API', '/api');
  const { default: Home } = await import('../../src/components/landing/Home.tsx');
  scenario.user.isExternalUser = true;
  const requests = status ? [{ request_id: 'partner-render', status }] : [];
  axios.get.mockImplementation(async url => {
    if (url.endsWith('/v1/external_users/status')) return { data: { status } };
    if (url.endsWith('/v1/external_users/requests')) return { data: { requests } };
    throw new Error(`Unexpected external home request: ${url}`);
  });

  mount('light', '/', <Home />);
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent(expectedPath);
  if (expectedPath === '/create') {
    await expect.element(page.getByRole('textbox', { name: 'Describe your video', exact: true })).toBeVisible();
  } else {
    const heading = page.getByRole('heading', { name: 'Render status', exact: true });
    await expect.element(heading).toBeVisible();
    const nav = document.querySelector('[data-app-top-nav]').getBoundingClientRect();
    expect(heading.element().getBoundingClientRect().top).toBeGreaterThanOrEqual(nav.bottom);
    await expect.element(page.getByRole('main').getByRole('status')).toHaveTextContent('Pending');
  }
  expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/v1\/external_users\/requests$/), expect.objectContaining({
    headers: { Authorization: 'Bearer preview-browser-test' }, params: { limit: 1 },
  }));
  expect(axios.get.mock.calls.some(([url]) => url.includes('/video_sessions/'))).toBe(false);
  expect(axios.post).not.toHaveBeenCalled();
});

it('resumes an approval checkpoint from home on a device with no saved step mode', async () => {
  vi.stubEnv('VITE_PROCESSOR_API', '/api');
  const { default: Home } = await import('../../src/components/landing/Home.tsx');
  const checkpoint = {
    current_step: 'image_generation', next_step: 'ai_video_generation', manual_step_stages: ['ai_video_generation'],
    requires_user_action: true, waiting_for_process_next: true,
  };
  Object.assign(scenario.session, {
    isStepVideoGeneration: true, expressGenerationPending: false, expressStepGeneration: checkpoint,
  });
  Object.assign(scenario.status, { status: 'COMPLETED', ...checkpoint });
  const editorRequest = axios.get.getMockImplementation();
  axios.get.mockImplementation((url, options) => url.endsWith('/video_sessions/latest_render')
    ? Promise.resolve({ data: { sessionId: 'create-preview', status: 'paused' } })
    : editorRequest(url, options));

  mount('light', '/', <Home />);
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/vidgenie/create-preview?view=preview');
  await expect.element(page.getByText('Images are ready for review', { exact: true })).toBeVisible();
  expect(axios.post).not.toHaveBeenCalled();

  Object.assign(scenario.status, { status: 'PENDING', next_step: null, requires_user_action: false, waiting_for_process_next: false });
  await page.getByRole('button', { name: 'Generate video', exact: true }).click();
  expect(axios.post).toHaveBeenCalledWith(expect.stringMatching(/\/create-preview\/process_next$/), {}, expect.any(Object));
  await expect.element(page.getByText('Images are ready for review', { exact: true })).not.toBeInTheDocument();
});

it('follows a Quick render from its queue on a new device before any layers exist', async () => {
  vi.stubEnv('VITE_PROCESSOR_API', '/api');
  const { default: Home } = await import('../../src/components/landing/Home.tsx');
  const session = {
    _id: 'quick-render', renderRequestedAt: new Date().toISOString(), isExpressGeneration: true, layers: [],
    videoGenerationPending: false, expressGenerationPending: false, expressGenerationStatus: { status: 'QUEUED' },
  };
  let status = { session_id: 'quick-render', status: 'QUEUED', expressGenerationStatus: session.expressGenerationStatus };
  const servedStatuses = [];
  axios.get.mockImplementation(async url => {
    if (url.endsWith('/video_sessions/latest_render')) return { data: { sessionId: 'quick-render', status: 'pending' } };
    if (url.includes('/video_sessions/session_details?id=quick-render')) return { data: session };
    if (url.includes('/video/step/quick-render/status_detailed')) throw Object.assign(new Error(), { response: { status: 404 } });
    if (url.endsWith('/v2/status_detailed?request_id=quick-render')) {
      servedStatuses.push(status.status);
      return { data: status };
    }
    throw new Error(`Unexpected Quick request: ${url}`);
  });

  mount('light', '/', <Home />);
  await expect.element(page.getByLabelText('Current route')).toHaveTextContent('/vidgenie/quick-render?view=preview');
  await expect.element(page.getByRole('heading', { name: 'Creating your video...', exact: true })).toBeVisible();
  await waitFor(() => expect(servedStatuses).toContain('QUEUED'));
  expect(screen.queryByRole('button', { name: 'Pause render' })).not.toBeInTheDocument();
  status = { session_id: 'quick-render', status: 'COMPLETED', result_url: new URL(clipUrl, window.location.href).href };
  await screen.findByRole('heading', { name: 'Your video is ready' }, { timeout: 8500 });
  await waitFor(() => expect(document.querySelector('main video')?.src).toBe(status.result_url));
  expect(servedStatuses).toContain('COMPLETED');
  expect(axios.post).not.toHaveBeenCalled();
}, 12000);

it('shows Studio export progress without offering the express pause action', async () => {
  Object.assign(scenario.session, { isExpressGeneration: false, expressGenerationPending: false, videoGenerationPending: true });
  mount('light');
  await expect.element(page.getByText('Live preview', { exact: true })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Pause render' })).not.toBeInTheDocument();
});
