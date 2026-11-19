import { render, screen, waitFor } from '@testing-library/react';
import { page } from 'vitest/browser';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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

const scenario = vi.hoisted(() => ({ session: null, status: null, getUserAPI: vi.fn() }));
vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({
  user: { _id: 'creator', email: 'creator@example.com', generationCredits: 2000, isEmailVerified: true },
  userInitiated: true, userFetching: false, getUserAPI: scenario.getUserAPI,
}) }));
vi.mock('../../src/utils/web.jsx', async (importOriginal) => ({
  ...await importOriginal(),
  getHeaders: () => ({ headers: { Authorization: 'Bearer preview-browser-test' } }),
}));
vi.mock('react-tooltip', () => ({ Tooltip: () => null }));

function mount(theme) {
  localStorage.setItem('colorMode', theme);
  return render(<MemoryRouter initialEntries={['/vidgenie/create-preview?view=preview']}>
    <LocalizationProvider><AlertDialogProvider><ColorModeProvider>
      <NavCanvasControlContext.Provider value={{}}><WorkspaceNavigationProvider>
        <Routes><Route path="/vidgenie/:id" element={<OneshotEditorContainer />} /></Routes>
      </WorkspaceNavigationProvider></NavCanvasControlContext.Provider>
    </ColorModeProvider></AlertDialogProvider></LocalizationProvider>
  </MemoryRouter>);
}

beforeEach(() => {
  setUiLanguage('en');
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
