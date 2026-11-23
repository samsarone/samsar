import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Context as ResponsiveContext } from 'react-responsive';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CreatePublishedGallery, { resolvePublishedMediaUrl } from '../../src/components/landing/CreatePublishedGallery.jsx';
import { setUiLanguage } from '../../src/utils/localization.js';

const edition = vi.hoisted(() => ({ standalone: false }));
vi.mock('../../src/utils/environment.jsx', () => ({ get IS_STANDALONE_DEPLOYMENT() { return edition.standalone; } }));

const observers = [];
const originalFetch = globalThis.fetch;
const originalObserver = globalThis.IntersectionObserver;
const publication = (id, extra = {}) => ({
  id, title: `Video ${id}`, videoUrl: `https://media.example/${id}.mp4`,
  splashImage: `https://media.example/${id}.png`, aspectRatio: '16:9',
  originalPrompt: `Prompt ${id}`, ...extra,
});
const respond = (items, extra = {}) => Promise.resolve({ ok: true, json: async () => ({ items, hasMore: false, ...extra }) });

beforeEach(() => {
  edition.standalone = false;
  setUiLanguage('en');
  observers.length = 0;
  vi.stubGlobal('fetch', vi.fn(() => respond([publication('one')])));
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { this.callback = callback; this.disconnect = vi.fn(); observers.push(this); }
    observe(element) { this.element = element; }
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.IntersectionObserver = originalObserver;
});

it('resolves public CDN and relative media when the production API base is /api', () => {
  const origin = 'https://app.samsar.one';
  expect(resolvePublishedMediaUrl('https://static.samsar.one/published/video.mp4', '/api', origin)).toBe('https://static.samsar.one/published/video.mp4');
  expect(resolvePublishedMediaUrl('/published/thumbnail.png', '/api', origin)).toBe('https://app.samsar.one/published/thumbnail.png');
  expect(resolvePublishedMediaUrl('//static.samsar.one/published/thumbnail.png', '/api', origin)).toBe('https://static.samsar.one/published/thumbnail.png');
  expect(resolvePublishedMediaUrl('https://static.samsar.one/published/video.mp4', '/api', undefined)).toBe('https://static.samsar.one/published/video.mp4');
  expect(resolvePublishedMediaUrl('javascript:alert(1)', '/api', origin)).toBe('');
  expect(resolvePublishedMediaUrl('data:video/mp4;base64,test', '/api', origin)).toBe('');
});

it('does not mount or request the public gallery in standalone editions', () => {
  edition.standalone = true;
  const { container } = render(<CreatePublishedGallery />);
  expect(container).toBeEmptyDOMElement();
  expect(fetch).not.toHaveBeenCalled();
});

it('initially mounts lazy thumbnails with the saved aspect ratio, without mounting video', async () => {
  fetch.mockImplementation(() => respond([publication('portrait', { aspectRatio: '9:16' }), publication('square', { aspectRatio: '1:1' })]));
  const { container } = render(<CreatePublishedGallery />);
  const portrait = await screen.findByRole('button', { name: 'Play Video portrait' });
  expect(portrait.style.aspectRatio).toBe(String(9 / 16));
  expect(screen.getByRole('button', { name: 'Play Video square' }).style.aspectRatio).toBe('1');
  expect(container.querySelectorAll('video')).toHaveLength(0);
  expect([...container.querySelectorAll('img')].every((img) => img.getAttribute('loading') === 'lazy' && img.getAttribute('decoding') === 'async')).toBe(true);
  expect(fetch).toHaveBeenCalledOnce();
  expect(fetch.mock.calls[0][0]).toMatch(/\/publication\?limit=32$/);
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', signal: expect.any(AbortSignal) });
});

it.each([
  ['a canonical publication ratio', { aspectRatio: '9:16' }, 9 / 16],
  ['a numeric ratio', { aspectRatio: 0.5625 }, 9 / 16],
  ['a published ratio after invalid primary metadata', { aspectRatio: 'invalid', publishedAspectRatio: '3:4' }, 3 / 4],
  ['a snake case ratio', { aspectRatio: null, aspect_ratio: '4/5' }, 4 / 5],
  ['video dimensions', { aspectRatio: null, videoWidth: 1080, videoHeight: 1920 }, 9 / 16],
  ['legacy dimensions', { aspectRatio: null, width: 1440, height: 1080 }, 4 / 3],
  ['a legacy shape label', { aspectRatio: 'horizontal' }, 16 / 9],
  ['an invalid ratio', { aspectRatio: '-9:-16', width: 0, height: 1080 }, 16 / 9],
])('uses %s to size both the mosaic tile and player', async (_name, metadata, expected) => {
  fetch.mockImplementation(() => respond([publication('shape', metadata)]));
  render(<CreatePublishedGallery />);
  const card = await screen.findByRole('button', { name: 'Play Video shape' });
  expect(Number(card.style.aspectRatio)).toBeCloseTo(expected);
  expect(card.querySelector('img')).toHaveClass('object-contain');
  fireEvent.click(card);
  expect(Number(screen.getByLabelText('Video preview').style.aspectRatio)).toBeCloseTo(expected);
});

it('loads another cursor on intersection, deduplicates items, and stops repeated cursors', async () => {
  fetch.mockImplementationOnce(() => respond([publication('one')], { hasMore: true, nextCursor: 'next-page' }))
    .mockImplementationOnce(() => respond([publication('one'), publication('two')], { hasMore: true, nextCursor: 'next-page' }));
  render(<CreatePublishedGallery />);
  await screen.findByRole('button', { name: 'Play Video one' });
  expect(fetch).toHaveBeenCalledOnce();
  await act(async () => observers.at(-1).callback([{ isIntersecting: true }]));
  await screen.findByRole('button', { name: 'Play Video two' });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[1][0]).toContain('cursor=next-page');
  expect(screen.getAllByRole('button', { name: 'Play Video one' })).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
});

it('starts a fresh filtered feed and ignores a previous selection’s pending cursor', async () => {
  let finishCursor;
  fetch.mockImplementationOnce(() => respond([publication('first')], { hasMore: true, nextCursor: 'older' }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishCursor = resolve; }))
    .mockImplementationOnce(() => respond([publication('current')]));
  const view = render(<CreatePublishedGallery inferenceModel="one" videoModel="first-model" language="ja" />);
  await screen.findByRole('button', { name: 'Play Video first' });
  expect(screen.getByText('one · first-model · Japanese')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  const [url, options] = fetch.mock.calls[1];
  expect(Object.fromEntries(new URL(url).searchParams)).toEqual({
    limit: '32', cursor: 'older', inferenceModel: 'one', videoModel: 'first-model', language: 'ja',
  });
  view.rerender(<CreatePublishedGallery inferenceModel="two" videoModel="next-model" language="auto" />);
  await screen.findByRole('button', { name: 'Play Video current' });
  expect(screen.getByText('two · next-model')).toBeVisible();
  expect(options.signal.aborted).toBe(true);
  expect(Object.fromEntries(new URL(fetch.mock.calls[2][0]).searchParams)).toEqual({
    limit: '32', inferenceModel: 'two', videoModel: 'next-model',
  });
  await act(async () => finishCursor(await respond([publication('outdated')])));
  expect(screen.queryByRole('button', { name: 'Play Video first' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Play Video outdated' })).toBeNull();
});

it('follows an empty filtered page to the next matching playable result', async () => {
  fetch.mockImplementationOnce(() => respond([], { hasMore: true, nextCursor: 'next-visible' }))
    .mockImplementationOnce(() => respond([publication('visible')]));
  render(<CreatePublishedGallery videoModel="chosen" />);
  await screen.findByRole('button', { name: 'Play Video visible' });
  expect(Object.fromEntries(new URL(fetch.mock.calls[1][0]).searchParams)).toEqual({
    limit: '32', videoModel: 'chosen', cursor: 'next-visible',
  });
});

it('plays only the selected publication and shows its saved prompt and model snapshot', async () => {
  fetch.mockImplementation(() => respond([publication('one', {
    imageModel: 'fallback-image', videoModel: 'fallback-video', inferenceModel: 'fallback-text',
    generationModels: { image: ['original-image'], video: ['first-video', 'second-video'], inference: ['original-text'] },
  })]));
  render(<CreatePublishedGallery />);
  const card = await screen.findByRole('button', { name: 'Play Video one' });
  card.focus();
  fireEvent.click(card);
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent('Prompt one');
  expect(dialog).toHaveTextContent('original-image');
  expect(dialog).toHaveTextContent('first-video, second-video');
  expect(dialog).toHaveTextContent('original-text');
  expect(dialog).not.toHaveTextContent('fallback-image');
  const video = screen.getByLabelText('Video preview');
  expect(video).toHaveAttribute('src', 'https://media.example/one.mp4');
  expect(video).toHaveAttribute('preload', 'metadata');
  expect(fetch).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(video.pause).toHaveBeenCalled();
  expect(video.load).toHaveBeenCalled();
  expect(video).not.toHaveAttribute('src');
  await waitFor(() => expect(card).toHaveFocus());
});

it('keeps already loaded thumbnails and retries the failed page without starting over', async () => {
  fetch.mockImplementationOnce(() => respond([publication('one')], { hasMore: true, nextCursor: 'second' }))
    .mockRejectedValueOnce(new Error('offline'))
    .mockImplementationOnce(() => respond([publication('two')]));
  render(<CreatePublishedGallery />);
  await screen.findByRole('button', { name: 'Play Video one' });
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  await screen.findByText('Unable to load videos.');
  expect(screen.getByRole('button', { name: 'Play Video one' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: 'Play Video two' });
  expect(fetch.mock.calls[2][0]).toContain('cursor=second');
});

it('labels missing published metadata without substituting account defaults', async () => {
  fetch.mockImplementation(() => respond([publication('one', { originalPrompt: '', imageModel: null, videoModel: null, inferenceModel: null })]));
  render(<CreatePublishedGallery />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play Video one' }));
  await screen.findByRole('dialog');
  expect(screen.getByText('Prompt unavailable')).toBeVisible();
  expect(screen.getAllByText('Not recorded')).toHaveLength(3);
  expect(screen.queryByText('Claude Opus 5.5')).toBeNull();
});

it('aborts pending feed requests when the landing page unmounts', () => {
  fetch.mockReturnValue(new Promise(() => {}));
  const view = render(<CreatePublishedGallery />);
  const { signal } = fetch.mock.calls[0][1];
  expect(signal.aborted).toBe(false);
  view.unmount();
  expect(signal.aborted).toBe(true);
});


it.each([
  [375, [8, 8, 8, 8]],
  [768, [12, 12, 8]],
  [1280, [16, 16]],
])('fills mosaic pages and supports bounded keyboard navigation at %ipx', async (width, expectedCounts) => {
  const shapes = ['9:16', '1:1', '16:9', '4:3'];
  const items = Array.from({ length: 32 }, (_, index) =>
    publication(String(index + 1), { aspectRatio: shapes[index % shapes.length] }));
  fetch.mockImplementation(() => respond(items));
  const { container } = render(
    <ResponsiveContext.Provider value={{ width }}><CreatePublishedGallery /></ResponsiveContext.Provider>
  );
  const carousel = await screen.findByRole('group', { name: 'Published videos' });
  const slides = within(carousel).getAllByRole('group', { name: /^Page \d+ of \d+$/ });
  expect(slides.map((slide) => within(slide).getAllByRole('button').length)).toEqual(expectedCounts);
  slides.forEach((slide, index) => Object.defineProperty(slide, 'offsetLeft', { configurable: true, value: index * width }));
  const end = (slides.length - 1) * width;
  carousel.scrollTo = vi.fn();
  const previous = screen.getByRole('button', { name: 'Previous videos' });
  const next = screen.getByRole('button', { name: 'Next videos' });
  expect(previous).toBeDisabled();
  fireEvent.click(next);
  expect(carousel.scrollTo).toHaveBeenLastCalledWith({ left: width, behavior: 'smooth' });
  expect(previous).toBeEnabled();
  fireEvent.keyDown(carousel, { key: 'End' });
  expect(carousel.scrollTo).toHaveBeenLastCalledWith({ left: end, behavior: 'smooth' });
  expect(next).toBeDisabled();
  fireEvent.keyDown(carousel, { key: 'ArrowLeft' });
  expect(carousel.scrollTo).toHaveBeenLastCalledWith({ left: end - width, behavior: 'smooth' });
  fireEvent.keyDown(carousel, { key: 'Home' });
  expect(carousel.scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' });
  expect(previous).toBeDisabled();
  fireEvent.keyDown(carousel, { key: 'ArrowRight' });
  expect(carousel.scrollTo).toHaveBeenLastCalledWith({ left: width, behavior: 'smooth' });
  expect(container.querySelectorAll('video')).toHaveLength(0);
});

it('filters hidden publications and unsafe playback URLs while keeping frame-only fallbacks', async () => {
  fetch.mockImplementation(() => respond([
    publication('hidden', { isHidden: true }), publication('deleted', { isDeleted: true }),
    publication('unsafe', { videoUrl: 'javascript:alert(1)' }),
    publication('no-frame', { splashImage: 'data:image/png;base64,invalid' }),
  ]));
  const { container } = render(<CreatePublishedGallery />);
  expect(await screen.findByRole('button', { name: 'Play Video no-frame' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Play Video hidden' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Play Video deleted' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Play Video unsafe' })).toBeNull();
  expect(container.querySelectorAll('img, video')).toHaveLength(0);
});


it('shows an accessible mosaic skeleton while the first publication request is pending', () => {
  fetch.mockReturnValue(new Promise(() => {}));
  const { container } = render(<CreatePublishedGallery />);
  expect(fetch).toHaveBeenCalledOnce();
  expect(screen.getByRole('status', { name: 'Loading videos...' })).toHaveAttribute('aria-busy', 'true');
  expect(container.querySelectorAll('.create-gallery-skeleton-block').length).toBeGreaterThan(4);
  expect(container.querySelectorAll('img, video, button')).toHaveLength(0);
});

it('keeps existing cards mounted while a subsequent page shows skeleton placeholders', async () => {
  let finishPage;
  fetch.mockImplementationOnce(() => respond([publication('one')], { hasMore: true, nextCursor: 'second' }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishPage = resolve; }));
  render(<CreatePublishedGallery />);
  const first = await screen.findByRole('button', { name: 'Play Video one' });
  fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
  expect(screen.getByRole('status', { name: 'Loading videos...' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Play Video one' })).toBe(first);
  await act(async () => { finishPage(await respond([publication('two')])); });
  await screen.findByRole('button', { name: 'Play Video two' });
  expect(screen.queryByRole('status', { name: 'Loading videos...' })).toBeNull();
});

it.each([
  ['empty', () => respond([])],
  ['hidden-only', () => respond([publication('hidden', { isHidden: true }), publication('deleted', { isDeleted: true })])],
  ['malformed', () => Promise.resolve({ ok: true, json: async () => ({ items: 'invalid' }) })],
  ['missing endpoint', () => Promise.resolve({ ok: false, status: 404 })],
  ['network failure', () => Promise.reject(new Error('Offline'))],
])('silently omits an %s initial feed without empty/error placeholders', async (_scenario, response) => {
  fetch.mockImplementation(response);
  let view;
  await act(async () => { view = render(<CreatePublishedGallery />); });
  expect(fetch).toHaveBeenCalledOnce();
  expect(view.container).toBeEmptyDOMElement();
  expect(screen.queryByRole('heading')).toBeNull();
  expect(screen.queryByText('Unable to load videos.')).toBeNull();
  expect(screen.queryByText('No published videos yet.')).toBeNull();
});

it('bounds a hanging optional feed request without exposing an error section', async () => {
  vi.useFakeTimers();
  fetch.mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  const { container } = render(<CreatePublishedGallery />);
  const { signal } = fetch.mock.calls[0][1];
  expect(signal.aborted).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
  expect(signal.aborted).toBe(true);
  expect(container).toBeEmptyDOMElement();
});
