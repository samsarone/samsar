import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { SkeletonBlock, SkeletonFields, SkeletonPage, SkeletonStatus } from './LoadingSkeleton.jsx';

export function AudioCardsSkeleton() {
  return <SkeletonStatus label={uiText('Loading...')}>
    <div className="grid gap-4 py-6 sm:grid-cols-2 xl:grid-cols-3">
      {[0, 1, 2].map(index => <div key={index} className="space-y-3 rounded-2xl border border-line bg-surface p-4">
        <div className="flex items-start gap-3">
          <SkeletonBlock className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2"><SkeletonBlock className="h-4 w-3/4" /><SkeletonBlock className="h-3 w-1/2" /><SkeletonBlock className="h-5 w-full" /></div>
        </div>
        <SkeletonBlock className="mt-4 h-9 w-full rounded-full" />
      </div>)}
    </div>
  </SkeletonStatus>;
}

export function ProjectCardsSkeleton({ label = uiText('Loading your projects...'), gallery = false }) {
  useUiLanguage();
  const grid = gallery
    ? 'grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4'
    : 'grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-4 sm:gap-5 lg:gap-6';
  return <SkeletonStatus label={label} className="mx-auto mb-6 w-full max-w-[1600px]">
    <div className={`grid ${grid}`}>
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="overflow-hidden rounded-lg border border-line bg-surface">
        {!gallery && <div className="px-4 py-3"><SkeletonBlock className="h-5 w-2/3" /></div>}
        <SkeletonBlock className="aspect-video w-full rounded-none" />
        <div className="space-y-3 p-4"><SkeletonBlock className="h-4 w-2/3" /><SkeletonBlock className="h-8 w-full" /></div>
      </div>)}
    </div>
  </SkeletonStatus>;
}

export function ImageCanvasSkeleton() {
  return <SkeletonStatus label={uiText('Loading image session...')} className="flex w-full justify-center">
    <div className="mx-auto w-[min(60vw,640px)] max-w-full space-y-3 rounded-xl border border-line bg-surface p-4">
      <SkeletonBlock className="mx-auto h-8 w-40 max-w-full" />
      <SkeletonBlock className="aspect-square w-full" />
      <SkeletonBlock className="mx-auto h-8 w-32 max-w-full" />
    </div>
  </SkeletonStatus>;
}

export default function PageSkeletonLoader({ page = 'content' }) {
  useUiLanguage();
  const fields = <SkeletonFields count={4} className="grid-cols-1" />;
  let content;
  if (page === 'image') {
    content = <div className="flex h-[100dvh] overflow-hidden pt-[var(--app-nav-height)]">
      <div className="min-w-0 flex-1 overflow-hidden px-6 pt-4 pb-6"><ImageCanvasSkeleton /></div>
      <div className="h-full shrink-0 space-y-5 overflow-hidden border-l border-line bg-surface p-4" style={{ width: 'clamp(360px, 24vw, 460px)' }}>
        <SkeletonBlock className="h-10 w-full" />{fields}<SkeletonBlock className="h-32 w-full" /><SkeletonBlock className="h-10 w-full" />
      </div>
    </div>;
  } else if (page === 'audio') {
    content = <div className="grid h-[100dvh] grid-cols-1 overflow-hidden pt-[var(--app-nav-height)] lg:grid-cols-[minmax(0,1fr)_minmax(290px,18%)]">
      <div className="min-w-0 overflow-hidden px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><div className="mx-auto max-w-6xl space-y-4">
        <SkeletonBlock className="h-7 w-48" /><SkeletonBlock className="h-4 w-72 max-w-full" /><SkeletonBlock className="h-10 w-full" /><AudioCardsSkeleton />
      </div></div>
      <div className="hidden space-y-5 border-l border-line bg-surface p-5 lg:block"><SkeletonBlock className="h-12 w-full" /><SkeletonBlock className="h-12 w-full" />{fields}<SkeletonBlock className="h-28 w-full" /></div>
    </div>;
  } else if (page === 'account') {
    content = <div className="flex h-[100dvh] overflow-hidden pt-[var(--app-nav-height)]">
      <div className="hidden w-48 shrink-0 space-y-4 border-r border-line bg-surface p-4 md:block">
        <SkeletonBlock className="h-16 w-full" />{Array.from({ length: 8 }, (_, index) => <SkeletonBlock key={index} className="h-9 w-full" />)}
      </div>
      <div className="min-w-0 flex-1"><div className="border-b border-line p-4"><SkeletonBlock className="mx-auto h-7 w-40" /></div><div className="space-y-6 p-3 sm:p-6"><SkeletonBlock className="h-4 w-64 max-w-full" />{fields}</div></div>
    </div>;
  } else if (page === 'auth') {
    content = <div className="flex min-h-[100dvh] items-center justify-center p-6"><div className="w-full max-w-md space-y-6 rounded-2xl border border-line bg-surface p-8"><SkeletonBlock className="mx-auto h-10 w-32" /><SkeletonFields count={2} className="grid-cols-1" /><SkeletonBlock className="h-11 w-full" /></div></div>;
  } else {
    content = <div className="container mx-auto space-y-5 px-4 pb-8 pt-[calc(var(--app-nav-height)+var(--workspace-inset))]">
      <div className="flex flex-wrap items-center justify-between gap-3"><SkeletonBlock className="h-8 w-48" /><SkeletonBlock className="h-9 w-32" /></div>
      {page === 'projects' || page === 'gallery' ? <><SkeletonFields count={3} /><ProjectCardsSkeleton gallery={page === 'gallery'} /></>
        : <div className="space-y-5 rounded-2xl border border-line bg-surface p-5">{page === 'quick' && <SkeletonFields count={8} className="grid-cols-2 sm:grid-cols-4" />}<SkeletonBlock className="h-32 w-full" /><SkeletonBlock className="h-4 w-2/3" />{page === 'quick' && <SkeletonBlock className="h-11 w-full" />}</div>}
    </div>;
  }
  // Canvas/card regions announce their own status only when used independently.
  return <SkeletonPage><SkeletonStatus label={uiText('Loading...')} data-loading-page={page}>{content}</SkeletonStatus></SkeletonPage>;
}
