import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import { MdChevronLeft, MdChevronRight, MdClose, MdPlayArrow, MdVideocam } from 'react-icons/md';
import { useMediaQuery } from 'react-responsive';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { IS_STANDALONE_DEPLOYMENT } from '../../utils/environment.jsx';
import { translateText as uiText } from '../../utils/localization.js';
import { IMAGE_GENERAITON_MODEL_TYPES, VIDEO_GENERATION_MODEL_TYPES, INFERENCE_MODEL_TYPES } from '../../constants/Types.ts';

const API_SERVER = (import.meta.env.VITE_PROCESSOR_API || 'http://localhost:3002').replace(/\/$/, '');
const PAGE_SIZE = 12;
const FEED_TIMEOUT_MS = 12000;
const text = (value) => typeof value === 'string' ? value.trim() : '';

export function resolvePublishedMediaUrl(value, apiBase = API_SERVER, origin = globalThis.location?.origin) {
  const candidate = text(value);
  if (!candidate) return '';
  try {
    let url;
    try {
      // Public CDN URLs do not depend on whether the API uses an absolute or
      // same-origin base (production uses /api).
      url = new URL(candidate);
    } catch {
      const locationOrigin = origin && origin !== 'null' ? origin : 'http://localhost:3002';
      url = new URL(candidate, new URL(apiBase, locationOrigin));
    }
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch { return ''; }
}

function aspectRatio(value) {
  const normalized = text(value).toLowerCase();
  if (normalized === 'portrait' || normalized === 'vertical') return 9 / 16;
  if (normalized === 'landscape') return 16 / 9;
  if (normalized === 'square') return 1;
  const parts = normalized.split(/\s*[:x/×]\s*/).map(Number);
  const ratio = parts.length === 2 ? parts[0] / parts[1] : Number(normalized);
  return Number.isFinite(ratio) && ratio >= 0.2 && ratio <= 5 ? ratio : 16 / 9;
}

function normalizePublication(item) {
  const id = text(item?.id) || text(item?._id);
  const videoUrl = resolvePublishedMediaUrl(item?.videoUrl || item?.video_url);
  if (!id || !videoUrl || item?.isHidden || item?.isDeleted) return null;
  return {
    id,
    videoUrl,
    title: text(item.title),
    posterUrl: resolvePublishedMediaUrl(item.posterUrl || item.splashImage || item.thumbnailUrl || item.thumbnail),
    aspectRatio: aspectRatio(item.aspectRatio || item.publishedAspectRatio || item.aspect_ratio),
    prompt: text(item.originalPrompt || item.original_prompt),
    // The publication snapshot describes the models that made this video.
    models: {
      inference: modelValues(item.generationModels?.inference, item.inferenceModel),
      image: modelValues(item.generationModels?.image, item.imageModel),
      video: modelValues(item.generationModels?.video, item.videoModel),
    },
  };
}

function modelValues(snapshot, fallback) {
  const values = Array.isArray(snapshot) ? snapshot.map(text).filter(Boolean) : [];
  return [...new Set(values.length ? values : [text(fallback)].filter(Boolean))];
}

function modelLabel(value, options) {
  const option = options.find((candidate) => (candidate.key || candidate.value) === value);
  return option?.name || option?.label || value;
}

function PublishedVideoDialog({ video, onClose }) {
  const videoRef = useRef(null);
  useEffect(() => () => {
    const element = videoRef.current;
    if (!element) return;
    element.pause();
    element.removeAttribute('src');
    element.load();
  }, [video.id]);
  const title = video.title || uiText('Untitled video');
  const modelRows = [
    { label: uiText('Text model'), values: video.models.inference, options: INFERENCE_MODEL_TYPES },
    { label: uiText('Image model'), values: video.models.image, options: IMAGE_GENERAITON_MODEL_TYPES },
    { label: uiText('Video model'), values: video.models.video, options: VIDEO_GENERATION_MODEL_TYPES },
  ];
  return (
    <Dialog open onClose={onClose} className="relative z-[11060]">
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" aria-hidden="true" />
      <div className="fixed inset-0 flex items-center justify-center overflow-y-auto p-3 sm:p-6">
        <DialogPanel className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-line bg-surface text-left text-fg shadow-2xl sm:max-h-[calc(100dvh-3rem)]">
          <div className="flex shrink-0 items-center gap-3 px-5 py-3">
            <DialogTitle className="min-w-0 flex-1 truncate text-sm font-medium">{title}</DialogTitle>
            <button type="button" onClick={onClose} aria-label={uiText('Close dialog')} className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-fg-secondary transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
              <MdClose aria-hidden="true" className="size-5" />
            </button>
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain">
            <div className="flex justify-center bg-black">
              <video ref={(element) => { if (element) videoRef.current = element; }} key={video.id} src={video.videoUrl} poster={video.posterUrl || undefined} controls autoPlay playsInline preload="metadata" aria-label={uiText('Video preview')} className="block max-h-[48dvh] w-full object-contain" style={{ aspectRatio: video.aspectRatio }} />
            </div>
            <div className="space-y-5 px-5 py-5">
              <section>
                <h3 className="mb-2 text-xs font-medium text-fg-muted">{uiText('Prompt')}</h3>
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-body">{video.prompt || uiText('Prompt unavailable')}</p>
              </section>
              <section>
                <h3 className="mb-2 text-xs font-medium text-fg-muted">{uiText('Model settings')}</h3>
                <dl className="grid gap-2 text-xs sm:grid-cols-3 sm:gap-3">
                  {modelRows.map((row) => <div key={row.label} className="min-w-0 rounded-xl bg-surface-muted px-3 py-2.5">
                    <dt className="mb-1 text-fg-muted">{row.label}</dt>
                    <dd className="break-words font-medium text-fg-body">{row.values.length ? row.values.map((value) => modelLabel(value, row.options)).join(', ') : uiText('Not recorded')}</dd>
                  </div>)}
                </dl>
              </section>
            </div>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function PublishedGallery() {
  useUiLanguage();
  const [request, setRequest] = useState({ cursor: null, attempt: 0 });
  const [page, setPage] = useState({ items: [], loading: true, error: false, nextCursor: null, hasMore: true });
  const [selectedVideo, setSelectedVideo] = useState(null);
  const sentinelRef = useRef(null);
  const carouselRef = useRef(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const requestPendingRef = useRef(true);
  const completedCursorsRef = useRef(new Set());
  const wideScreen = useMediaQuery({ minWidth: 1024 });
  const mediumScreen = useMediaQuery({ minWidth: 640 });
  const columnCount = wideScreen ? 4 : mediumScreen ? 3 : 2;
  const slides = useMemo(() => {
    const result = [];
    const itemsPerSlide = columnCount * 2;
    for (let offset = 0; offset < page.items.length; offset += itemsPerSlide) {
      const columns = Array.from({ length: columnCount }, () => []);
      const heights = Array(columnCount).fill(0);
      for (const item of page.items.slice(offset, offset + itemsPerSlide)) {
        const column = heights.indexOf(Math.min(...heights));
        columns[column].push(item);
        heights[column] += 1 / item.aspectRatio;
      }
      result.push(columns);
    }
    return result;
  }, [columnCount, page.items]);

  const moveToSlide = useCallback((index) => {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const target = Math.max(0, Math.min(index, slides.length - 1));
    const slide = carousel.querySelector(`[data-gallery-slide="${target}"]`);
    const left = slide?.offsetLeft || 0;
    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (carousel.scrollTo) carousel.scrollTo({ left, behavior: reducedMotion ? 'instant' : 'smooth' });
    else carousel.scrollLeft = left;
    setActiveSlide(target);
  }, [slides.length]);

  function updateActiveSlide() {
    const carousel = carouselRef.current;
    if (!carousel) return;
    const slideElements = [...carousel.querySelectorAll('[data-gallery-slide]')];
    let closest = 0;
    for (let index = 1; index < slideElements.length; index += 1) {
      if (Math.abs(slideElements[index].offsetLeft - carousel.scrollLeft)
        < Math.abs(slideElements[closest].offsetLeft - carousel.scrollLeft)) closest = index;
    }
    setActiveSlide(closest);
  }

  useEffect(() => {
    // Restart at the first mosaic page when a breakpoint changes the page size.
    setActiveSlide(0);
    if (carouselRef.current) carouselRef.current.scrollLeft = 0;
  }, [columnCount]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    let active = true;
    requestPendingRef.current = true;
    setPage((previous) => ({ ...previous, loading: true, error: false }));
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (request.cursor) params.set('cursor', request.cursor);
    async function load() {
      try {
        // This is the public publication feed, without private session reads.
        const response = await fetch(`${API_SERVER}/publication?${params}`, { signal: controller.signal, credentials: 'omit' });
        if (!response.ok) throw new Error('Publication request failed');
        const payload = await response.json();
        if (!active) return;
        const incoming = (Array.isArray(payload?.items) ? payload.items : []).map(normalizePublication).filter(Boolean);
        completedCursorsRef.current.add(request.cursor);
        const nextCursor = text(payload.nextCursor) || null;
        const hasMore = payload.hasMore !== false && Boolean(nextCursor) && !completedCursorsRef.current.has(nextCursor);
        setPage((previous) => {
          const ids = new Set(previous.items.map((item) => item.id));
          const additions = incoming.filter((item) => { if (ids.has(item.id)) return false; ids.add(item.id); return true; });
          return { items: [...previous.items, ...additions], loading: false, error: false, nextCursor, hasMore };
        });
      } catch (error) {
        if (active) setPage((previous) => ({ ...previous, loading: false, error: true }));
      } finally {
        clearTimeout(timeout);
        if (active) requestPendingRef.current = false;
      }
    }
    void load();
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [request]);

  const loadMore = useCallback(() => {
    if (requestPendingRef.current || page.loading || page.error || !page.hasMore || !page.nextCursor) return;
    requestPendingRef.current = true;
    setRequest({ cursor: page.nextCursor, attempt: 0 });
  }, [page.error, page.hasMore, page.loading, page.nextCursor]);

  useEffect(() => {
    if (!sentinelRef.current || selectedVideo || page.loading || page.error || !page.hasMore || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root: carouselRef.current, rootMargin: '0px 120px 0px 0px' });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [loadMore, page.error, page.hasMore, page.loading, selectedVideo]);

  const closeVideo = useCallback(() => setSelectedVideo(null), []);
  // Publications are optional inspiration. Empty or unavailable feeds should
  // leave the composer undisturbed, including while the first request loads.
  if (!page.items.length) return null;

  return (
    <section aria-labelledby="create-gallery-heading" aria-roledescription="carousel" className="mt-12 min-w-0 pb-8 sm:mt-16">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 id="create-gallery-heading" className="text-lg font-semibold tracking-tight text-fg">{uiText('Made with Samsar')}</h2>
          <p className="mt-1 text-sm text-fg-muted">{uiText('Explore the latest published videos.')}</p>
        </div>
        {slides.length > 0 && <div className="flex shrink-0 items-center gap-2">
          <button type="button" aria-label={uiText('Previous videos')} aria-controls="create-gallery-carousel" disabled={activeSlide === 0} onClick={() => moveToSlide(activeSlide - 1)} className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-surface text-fg-secondary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none">
            <MdChevronLeft aria-hidden="true" className="size-6" />
          </button>
          <button type="button" aria-label={uiText('Next videos')} aria-controls="create-gallery-carousel" disabled={activeSlide >= slides.length - 1} onClick={() => moveToSlide(activeSlide + 1)} className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-surface text-fg-secondary transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-35 motion-reduce:transition-none">
            <MdChevronRight aria-hidden="true" className="size-6" />
          </button>
        </div>}
      </div>
      <div id="create-gallery-carousel" ref={carouselRef} role="group" aria-label={uiText('Published videos')} tabIndex={slides.length ? 0 : -1} onScroll={updateActiveSlide} onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'ArrowRight') { event.preventDefault(); moveToSlide(activeSlide + 1); }
        if (event.key === 'ArrowLeft') { event.preventDefault(); moveToSlide(activeSlide - 1); }
        if (event.key === 'Home') { event.preventDefault(); moveToSlide(0); }
        if (event.key === 'End') { event.preventDefault(); moveToSlide(slides.length - 1); }
      }} className="relative flex snap-x snap-mandatory items-start gap-4 overflow-x-auto overscroll-x-contain rounded-2xl pb-3 outline-none [scrollbar-width:thin] focus-visible:ring-2 focus-visible:ring-focus">
        {slides.map((columns, slideIndex) => <div key={slideIndex} data-gallery-slide={slideIndex} role="group" aria-roledescription="slide" aria-label={uiText('Page {current} of {total}', { current: slideIndex + 1, total: slides.length })} className="grid w-full shrink-0 snap-start grid-cols-2 items-start gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {columns.map((column, columnIndex) => <div key={columnIndex} className="flex min-w-0 flex-col gap-3" data-gallery-column={columnIndex}>
            {column.map((video) => {
              const title = video.title || uiText('Untitled video');
              return <button key={video.id} type="button" onClick={() => setSelectedVideo(video)} aria-label={uiText('Play {title}', { title })} className="group relative block w-full overflow-hidden rounded-2xl border border-line/40 bg-surface-muted text-left outline-none transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas motion-reduce:transform-none motion-reduce:transition-none" style={{ aspectRatio: video.aspectRatio }}>
                <MdVideocam aria-hidden="true" className="absolute left-1/2 top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 text-fg-muted/40" />
                {video.posterUrl && <img src={video.posterUrl} alt="" loading="lazy" decoding="async" width={Math.round(video.aspectRatio * 600)} height="600" className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none" onError={(event) => { event.currentTarget.hidden = true; }} />}
                <span aria-hidden="true" className="absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/80 via-black/25 to-transparent px-3 pb-3 pt-12 text-white">
                  <span className="mb-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-colors group-hover:bg-white/35 motion-reduce:transition-none"><MdPlayArrow className="size-5" /></span>
                  <span className="min-w-0 truncate pb-1 text-xs font-medium">{title}</span>
                </span>
              </button>;
            })}
          </div>)}
        </div>)}
        <div ref={sentinelRef} aria-hidden="true" className="h-px w-px shrink-0" />
      </div>
      {slides.length > 1 && <p className="mt-2 text-center text-xs text-fg-muted" aria-live="polite" aria-atomic="true">{uiText('Page {current} of {total}', { current: activeSlide + 1, total: slides.length })}</p>}
      {(page.loading || page.error || page.hasMore) && <div className="flex min-h-16 items-center justify-center" aria-live="polite">
        {page.loading ? <span role="status" className="text-xs text-fg-muted">{uiText('Loading videos...')}</span> : page.error ? <div className="flex flex-wrap items-center justify-center gap-3 text-xs text-fg-muted">
          <span>{uiText('Unable to load videos.')}</span>
          <button type="button" onClick={() => setRequest((previous) => ({ ...previous, attempt: previous.attempt + 1 }))} className="min-h-10 rounded-full px-4 font-medium text-fg-secondary hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{uiText('Try again')}</button>
        </div> : page.hasMore ? <button type="button" onClick={loadMore} className="min-h-10 rounded-full px-5 text-xs font-medium text-fg-muted transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">{uiText('Load more')}</button> : null}
      </div>}
      {selectedVideo && <PublishedVideoDialog video={selectedVideo} onClose={closeVideo} />}
    </section>
  );
}

export default function CreatePublishedGallery() {
  return IS_STANDALONE_DEPLOYMENT ? null : <PublishedGallery />;
}
