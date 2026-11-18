import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CreatePublishedGallery from '../../src/components/landing/CreatePublishedGallery.jsx';
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
  expect(fetch.mock.calls[0][0]).toMatch(/\/publication\?limit=12$/);
  expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit', signal: expect.any(AbortSignal) });
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
