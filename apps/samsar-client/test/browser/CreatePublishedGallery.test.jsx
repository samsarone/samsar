import { render, waitFor } from '@testing-library/react';
import { page, userEvent } from 'vitest/browser';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import axios from 'axios';
import CreateLanding from '../../src/components/landing/CreateLanding.jsx';
import { AlertDialogProvider } from '../../src/contexts/AlertDialogContext.jsx';
import { ColorModeProvider } from '../../src/contexts/ColorMode.jsx';
import { LocalizationProvider } from '../../src/contexts/LocalizationContext.jsx';
import { NavCanvasControlContext } from '../../src/contexts/NavCanvasControlContext.jsx';
import { WorkspaceNavigationProvider } from '../../src/components/common/WorkspaceNavigation.jsx';
import { setUiLanguage } from '../../src/utils/localization.js';
import clipUrl from '../fixtures/studio-preview.webm?url';
import '../../src/index.css';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../src/contexts/UserContext.jsx', () => ({ useUser: () => ({
  user: { _id: 'creator', email: 'creator@example.com', generationCredits: 2000 }, userInitiated: true, userFetching: false,
}) }));
vi.mock('../../src/utils/web.jsx', async (importOriginal) => ({ ...await importOriginal(), getHeaders: () => ({ headers: { Authorization: 'Bearer test' } }) }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => ({ isStandaloneDeployment: false, isLoading: false }) }));
vi.mock('../../src/hooks/useInferenceModelAvailability.js', () => ({ useInferenceModelAvailability: () => ({ isLoading: false }) }));
vi.mock('../../src/components/oneshot_editor/OneshotEditorContainer.jsx', () => ({ preloadOneshotEditor: vi.fn().mockResolvedValue(undefined) }));

const nativeFetch = window.fetch;
let feedRequests;
function videos(start, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `video-${start + index}`, title: `Published video ${start + index}`,
    videoUrl: new URL(clipUrl, window.location.href).href,
    splashImage: new URL('/q2.png', window.location.origin).href,
    aspectRatio: ['16:9', '9:16', '1:1', '4:3'][index % 4],
    originalPrompt: 'A quiet city waking up in soft morning light.',
    inferenceModel: 'claude-opus-5.5', imageModel: 'GPTIMAGE2.5', videoModel: 'KLINGIMGTOVID4',
  }));
}
function mount(theme) {
  localStorage.setItem('colorMode', theme);
  return render(<MemoryRouter initialEntries={['/create']}>
    <LocalizationProvider><AlertDialogProvider><ColorModeProvider>
      <NavCanvasControlContext.Provider value={{}}><WorkspaceNavigationProvider>
        <CreateLanding />
      </WorkspaceNavigationProvider></NavCanvasControlContext.Provider>
    </ColorModeProvider></AlertDialogProvider></LocalizationProvider>
  </MemoryRouter>);
}

beforeEach(() => {
  feedRequests = [];
  setUiLanguage('en');
  axios.get.mockReset(); axios.post.mockReset();
  vi.spyOn(window, 'fetch').mockImplementation((input, options) => {
    if (!String(input).includes('/publication?')) return nativeFetch.call(window, input, options);
    feedRequests.push(String(input));
    const secondPage = new URL(input).searchParams.has('cursor');
    return Promise.resolve(new Response(JSON.stringify({ items: videos(secondPage ? 13 : 1, secondPage ? 4 : 12), hasMore: !secondPage, nextCursor: secondPage ? null : 'page-two' }), { headers: { 'Content-Type': 'application/json' } }));
  });
});

afterEach(() => {
  document.body.classList.remove('theme-dark', 'theme-light');
  document.documentElement.classList.remove('dark');
});

for (const theme of ['light', 'dark']) {
  for (const [width, height] of [[375, 812], [1280, 800]]) {
    it(`shows an image-only mosaic below the composer and a compact playable dialog at ${width}px in ${theme}`, async () => {
      await page.viewport(width, height);
      const view = mount(theme);
      const firstCard = page.getByRole('button', { name: 'Play Published video 1', exact: true });
      await expect.element(firstCard).toBeVisible();
      expect(view.container.querySelectorAll('video')).toHaveLength(0);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const heading = page.getByRole('heading', { name: 'Made with Samsar', exact: true }).element();
      expect(heading.getBoundingClientRect().top).toBeGreaterThan(page.getByRole('textbox', { name: 'Describe your video' }).element().getBoundingClientRect().bottom);
      const portrait = page.getByRole('button', { name: 'Play Published video 2', exact: true }).element();
      const bounds = portrait.getBoundingClientRect();
      expect(bounds.width / bounds.height).toBeCloseTo(9 / 16, 2);
      expect([...view.container.querySelectorAll('img')].every((img) => img.getAttribute('loading') === 'lazy')).toBe(true);
      await page.screenshot({ path: `test-results/create-mosaic-${theme}-${width}.png` });
      await firstCard.click();
      const dialog = page.getByRole('dialog');
      await expect.element(dialog).toBeVisible();
      await expect.element(dialog).toHaveTextContent('A quiet city waking up');
      await expect.element(dialog).toHaveTextContent('Claude Opus 5.5');
      await expect.element(dialog).toHaveTextContent('GPTImage 2.6');
      const video = document.querySelector('video');
      await waitFor(() => expect(video.readyState).toBeGreaterThanOrEqual(2));
      await video.play();
      await waitFor(() => expect(video.currentTime).toBeGreaterThan(0.05));
      expect(dialog.element().getBoundingClientRect().width).toBeLessThanOrEqual(width);
      expect(dialog.element().getBoundingClientRect().height).toBeLessThanOrEqual(height);
      await page.screenshot({ path: `test-results/create-video-dialog-${theme}-${width}.png` });
      if (width === 1280) await userEvent.keyboard('{Escape}');
      else await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
      await expect.element(dialog).not.toBeInTheDocument();
      expect(video.isConnected).toBe(false);
      expect(video.paused).toBe(true);
      expect(video.getAttribute('src')).toBeNull();
      await expect.element(firstCard).toHaveFocus();
    });
  }
}

it('loads the next page on scroll without moving already displayed mosaic cards', async () => {
  await page.viewport(1280, 800);
  mount('light');
  const firstCard = page.getByRole('button', { name: 'Play Published video 1', exact: true });
  await expect.element(firstCard).toBeVisible();
  expect(feedRequests).toHaveLength(1);
  const original = firstCard.element();
  const originalColumn = original.parentElement;
  const originalPosition = original.getBoundingClientRect().top + window.scrollY;
  page.getByRole('button', { name: 'Load more', exact: true }).element().scrollIntoView();
  await expect.element(page.getByRole('button', { name: 'Play Published video 13', exact: true })).toBeInTheDocument();
  expect(feedRequests).toHaveLength(2);
  expect(feedRequests[1]).toContain('cursor=page-two');
  expect(firstCard.element()).toBe(original);
  expect(firstCard.element().parentElement).toBe(originalColumn);
  expect(firstCard.element().getBoundingClientRect().top + window.scrollY).toBeCloseTo(originalPosition, 0);
  expect(document.querySelectorAll('video')).toHaveLength(0);
});
