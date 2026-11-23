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
  user: { _id: 'creator', email: 'creator@example.com', preferredLanguage: 'en', generationCredits: 5000 }, userInitiated: true, userFetching: false,
}) }));
vi.mock('../../src/utils/web.jsx', async (importOriginal) => ({ ...await importOriginal(), getHeaders: () => ({ headers: { Authorization: 'Bearer test' } }) }));
vi.mock('../../src/hooks/useDeploymentModelAvailability.js', () => ({ useDeploymentModelAvailability: () => ({ isStandaloneDeployment: false, isLoading: false }) }));
vi.mock('../../src/hooks/useInferenceModelAvailability.js', () => ({ useInferenceModelAvailability: () => ({ isLoading: false }) }));
vi.mock('../../src/components/oneshot_editor/OneshotEditorContainer.jsx', () => ({ preloadOneshotEditor: vi.fn().mockResolvedValue(undefined) }));

const nativeFetch = window.fetch;
let feedRequests;
let cursorReady;
function videos(start, count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `video-${start + index}`, title: `Published video ${start + index}`,
    videoUrl: new URL(clipUrl, window.location.href).href,
    splashImage: new URL('/q2.png', window.location.origin).href,
    aspectRatio: ['16:9', '9:16', '1:1', '4:3'][index % 4],
    originalPrompt: 'A quiet city waking up in soft morning light.',
    inferenceModel: 'claude-opus-5.5', imageModel: 'GPTIMAGE2.5', videoModel: 'KLINGIMGTOVID4', sessionLanguage: 'en',
  }));
}

function expectPackedSlide(slide) {
  const frame = slide.getBoundingClientRect();
  const tiles = Array.from(slide.querySelectorAll('button'), (card) => card.getBoundingClientRect());

  // Inflate every tile by half a gutter on each side. In a packed mosaic these
  // rectangles meet without overlapping and exactly cover the expanded slide.
  let gutter = Infinity;
  for (const [index, tile] of tiles.entries()) {
    expect(tile.left).toBeGreaterThanOrEqual(frame.left - 0.5);
    expect(tile.top).toBeGreaterThanOrEqual(frame.top - 0.5);
    expect(tile.right).toBeLessThanOrEqual(frame.right + 0.5);
    expect(tile.bottom).toBeLessThanOrEqual(frame.bottom + 0.5);
    for (const other of tiles.slice(index + 1)) {
      const separation = Math.max(tile.left - other.right, other.left - tile.right, tile.top - other.bottom, other.top - tile.bottom);
      gutter = Math.min(gutter, separation);
    }
  }
  expect(gutter).toBeGreaterThan(0);
  const tileArea = tiles.reduce((sum, tile) => sum + (tile.width + gutter) * (tile.height + gutter), 0);
  const frameArea = (frame.width + gutter) * (frame.height + gutter);
  expect(tileArea / frameArea).toBeCloseTo(1, 2);
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
  cursorReady = Promise.resolve();
  vi.stubEnv('VITE_PROCESSOR_API', '/api');
  setUiLanguage('en');
  axios.get.mockReset(); axios.post.mockReset();
  vi.spyOn(window, 'fetch').mockImplementation(async (input, options) => {
    if (!String(input).includes('/publication?')) return nativeFetch.call(window, input, options);
    feedRequests.push(String(input));
    const secondPage = new URL(input, window.location.origin).searchParams.has('cursor');
    if (secondPage) await cursorReady;
    const items = secondPage ? [{ ...videos(33, 1)[0], aspectRatio: '9:16' }] : videos(1, 32);
    return new Response(JSON.stringify({ items, hasMore: !secondPage, nextCursor: secondPage ? null : 'page-two' }), { headers: { 'Content-Type': 'application/json' } });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
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
      const feed = new URL(feedRequests[0], window.location.origin);
      expect(feed.pathname).toBe('/api/publication');
      expect(Object.fromEntries(feed.searchParams)).toEqual({
        limit: '32', inferenceModel: 'claude-opus-5.5', videoModel: 'KLINGIMGTOVID4', language: 'en',
      });
      await expect.element(page.getByText('Claude Opus 5.5 · Kling 4 Img2Vid · English')).toBeVisible();
      expect(view.container.querySelectorAll('video')).toHaveLength(0);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      const heading = page.getByRole('heading', { name: 'Made with Samsar', exact: true }).element();
      expect(heading.getBoundingClientRect().top).toBeGreaterThan(page.getByRole('textbox', { name: 'Describe your video' }).element().getBoundingClientRect().bottom);
      const portrait = page.getByRole('button', { name: 'Play Published video 2', exact: true }).element();
      const bounds = portrait.getBoundingClientRect();
      expect(bounds.width / bounds.height).toBeCloseTo(9 / 16, 2);
      for (const [id, ratio] of [[1, 16 / 9], [3, 1], [4, 4 / 3]]) {
        const card = page.getByRole('button', { name: `Play Published video ${id}`, exact: true }).element();
        const shape = card.getBoundingClientRect();
        expect(shape.width / shape.height).toBeCloseTo(ratio, 2);
        expect(getComputedStyle(card.querySelector('img')).objectFit).toBe('contain');
      }
      const carousel = page.getByRole('group', { name: 'Published videos', exact: true }).element();
      expect([...carousel.querySelectorAll('img')].every((img) => img.getAttribute('loading') === 'lazy')).toBe(true);
      firstCard.element().scrollIntoView({ block: 'center' });
      await waitFor(() => expect(firstCard.element().getBoundingClientRect().top).toBeLessThan(height));
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

it.each([[375, 8], [820, 12], [1280, 16]])('packs the mosaic at %i px edge-to-edge with %i videos', async (width, pageSize) => {
  await page.viewport(width, 850);
  const view = mount('light');
  await expect.element(page.getByRole('button', { name: 'Play Published video 1', exact: true })).toBeVisible();
  const slide = view.container.querySelector('[data-gallery-slide="0"]');
  const cards = [...slide.querySelectorAll('button')];
  expect(cards).toHaveLength(pageSize);
  // Packing may reorder publications within a slide, but every one stays visible.
  const expected = new Map(videos(1, pageSize).map((video) => {
    const [w, h] = video.aspectRatio.split(':').map(Number);
    return [`Play ${video.title}`, w / h];
  }));
  const titles = cards.map((card) => card.getAttribute('aria-label'));
  expect([...titles].sort()).toEqual([...expected.keys()].sort());
  for (const card of cards) {
    const bounds = card.getBoundingClientRect();
    expect(bounds.width / bounds.height).toBeCloseTo(expected.get(card.getAttribute('aria-label')), 2);
  }
  await waitFor(() => expectPackedSlide(slide));
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
});

it.each([[820, 8], [1280, 16]])('keeps the visible slide stable when another cursor arrives at %i px', async (width, lastSlideCount) => {
  await page.viewport(width, 800);
  let releaseCursor;
  cursorReady = new Promise((resolve) => { releaseCursor = resolve; });
  mount('light');
  const firstCard = page.getByRole('button', { name: 'Play Published video 1', exact: true });
  await expect.element(firstCard).toBeVisible();
  const carousel = page.getByRole('group', { name: 'Published videos', exact: true }).element();
  const initialSlides = [...carousel.querySelectorAll('[data-gallery-slide]')];
  const visibleSlide = initialSlides.at(-1);
  const next = page.getByRole('button', { name: 'Next videos', exact: true });
  next.element().scrollIntoView({ block: 'center' });
  for (const slide of initialSlides.slice(1)) {
    expect(feedRequests).toHaveLength(1);
    await next.click();
    await waitFor(() => expect(Math.abs(carousel.scrollLeft - slide.offsetLeft)).toBeLessThan(2));
  }
  await waitFor(() => expect(feedRequests).toHaveLength(2));
  expect(feedRequests[1]).toContain('cursor=page-two');
  const originalCards = [...visibleSlide.querySelectorAll('button')];
  expect(originalCards).toHaveLength(lastSlideCount);
  function positions() {
    const frame = visibleSlide.getBoundingClientRect();
    return originalCards.map((card) => {
      const rect = card.getBoundingClientRect();
      return [rect.left - frame.left, rect.top - frame.top, rect.width, rect.height];
    });
  }
  const originalPositions = positions();
  releaseCursor();
  const finalCard = page.getByRole('button', { name: 'Play Published video 33', exact: true });
  await expect.element(finalCard).toBeInTheDocument();
  expect(Math.abs(carousel.scrollLeft - visibleSlide.offsetLeft)).toBeLessThan(2);
  const currentCards = [...visibleSlide.querySelectorAll('button')];
  expect(currentCards).toHaveLength(originalCards.length);
  currentCards.forEach((card, index) => expect(card).toBe(originalCards[index]));
  for (const [index, position] of positions().entries()) {
    position.forEach((value, coordinate) => expect(value).toBeCloseTo(originalPositions[index][coordinate], 0));
  }
  const lastSlide = finalCard.element().closest('[data-gallery-slide]');
  expect(lastSlide.querySelectorAll('button')).toHaveLength(1);
  const portrait = finalCard.element().getBoundingClientRect();
  expect(portrait.width / portrait.height).toBeCloseTo(9 / 16, 2);
  expect(portrait.width).toBeLessThan(lastSlide.clientWidth / 2);
  expect(portrait.height).toBeLessThanOrEqual(initialSlides[0].clientHeight);
  expect(document.querySelectorAll('video')).toHaveLength(0);
  carousel.focus();
  await userEvent.keyboard('{Home}');
  await waitFor(() => expect(carousel.scrollLeft).toBeLessThan(2), { timeout: 2000 });
  await expect.element(page.getByRole('button', { name: 'Previous videos', exact: true })).toBeDisabled();
});

it('shows a responsive skeleton during a slow feed without blocking the composer', async () => {
  await page.viewport(375, 812);
  let finishFeed;
  window.fetch.mockImplementation((input, options) => {
    if (!String(input).includes('/publication?')) return nativeFetch.call(window, input, options);
    feedRequests.push(String(input));
    return new Promise((resolve) => { finishFeed = resolve; });
  });
  mount('light');
  const loading = page.getByRole('status', { name: 'Loading videos...', exact: true });
  await expect.element(loading).toBeVisible();
  await page.getByRole('textbox', { name: 'Describe your video', exact: true }).fill('A city at golden hour');
  await expect.element(page.getByRole('button', { name: 'Create video', exact: true })).toBeEnabled();
  await waitFor(() => expect(feedRequests).toHaveLength(1));
  expect(loading.element().querySelectorAll('video, img')).toHaveLength(0);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  finishFeed(new Response(JSON.stringify({ items: videos(1, 4), hasMore: false }), { headers: { 'Content-Type': 'application/json' } }));
  await expect.element(page.getByRole('button', { name: 'Play Published video 1', exact: true })).toBeVisible();
  await expect.element(loading).not.toBeInTheDocument();
});


for (const scenario of ['empty', 'hidden-only', 'missing endpoint', 'network failure', 'malformed']) {
  it(`keeps the composer usable and omits the gallery for an initial ${scenario} feed`, async () => {
    await page.viewport(375, 812);
    window.fetch.mockImplementation((input, options) => {
      if (!String(input).includes('/publication?')) return nativeFetch.call(window, input, options);
      feedRequests.push(String(input));
      if (scenario === 'network failure') return Promise.reject(new TypeError('Offline'));
      if (scenario === 'missing endpoint') return Promise.resolve(new Response('', { status: 404 }));
      const items = scenario === 'hidden-only' ? videos(1, 2).map((item) => ({ ...item, isHidden: true })) : scenario === 'malformed' ? 'invalid' : [];
      return Promise.resolve(new Response(JSON.stringify({ items, hasMore: false }), { headers: { 'Content-Type': 'application/json' } }));
    });
    const view = mount('dark');
    const prompt = page.getByRole('textbox', { name: 'Describe your video', exact: true });
    await prompt.fill('A story to create without gallery content');
    await waitFor(() => expect(feedRequests).toHaveLength(1));
    await expect.element(page.getByRole('button', { name: 'Create video', exact: true })).toBeEnabled();
    await expect.element(page.getByRole('heading', { name: 'Made with Samsar', exact: true })).not.toBeInTheDocument();
    expect(view.container.querySelector('[aria-roledescription="carousel"]')).toBeNull();
    expect(view.container.querySelectorAll('video')).toHaveLength(0);
    expect(view.container.querySelectorAll('img:not(picture[aria-hidden="true"] > img)')).toHaveLength(0);
    expect(view.container.textContent).not.toContain('Loading videos...');
    expect(view.container.textContent).not.toContain('Unable to load videos.');
    expect(view.container.textContent).not.toContain('No published videos yet.');
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
  });
}
