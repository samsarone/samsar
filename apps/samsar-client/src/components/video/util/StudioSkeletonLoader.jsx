import { useUiLanguage } from '../../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../../utils/localization.js';
import { SkeletonBlock, SkeletonPage, SkeletonStatus } from '../../common/LoadingSkeleton.jsx';

export default function StudioSkeletonLoader() {
  useUiLanguage();
  const leftSpace = 'calc(var(--studio-left-width) + 32px)';
  const rightSpace = 'calc(var(--studio-right-width) + 16px)';
  const top = 'calc(var(--app-nav-height) + var(--workspace-inset))';
  return <SkeletonPage className="h-[100dvh] overflow-hidden">
    <SkeletonStatus label={uiText('Loading Studio')} data-loading-page="studio">
      <div className="box-border h-[100dvh] overflow-hidden px-4 pb-4" style={{ paddingTop: top }}>
        <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-4">
          <div className="flex min-h-0 gap-4">
            <div className="shrink-0" style={{ width: leftSpace }} />
            <div className="flex min-h-0 min-w-0 flex-1" style={{ paddingRight: rightSpace }}>
              <div className="flex h-full w-full min-w-0 items-center justify-center px-6 py-6">
              <div className="flex max-h-full w-full max-w-[720px] min-w-0 flex-col items-center rounded-xl border border-line bg-surface px-4 py-6" data-skeleton-canvas>
                <SkeletonBlock className="h-8 w-48 max-w-full shrink-0" />
                <SkeletonBlock className="my-4 aspect-square w-full max-w-[420px] flex-1" style={{ minHeight: 80, maxHeight: '48dvh' }} />
                <SkeletonBlock className="h-9 w-48 max-w-full shrink-0" />
              </div>
              </div>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="shrink-0" style={{ width: leftSpace }} />
            <div className="min-w-0 flex-1" style={{ paddingRight: rightSpace }}>
              <div className="space-y-3 rounded-2xl border border-line bg-surface p-3">
                <SkeletonBlock className="h-4 w-full" />
                <div className="flex gap-2">{[0, 1, 2, 3].map(index => <SkeletonBlock key={index} className="h-11 flex-1" />)}</div>
              </div>
            </div>
          </div>
        </div>
        <div data-skeleton-left-rail className="fixed bottom-4 left-4 flex flex-col gap-3 overflow-hidden rounded-2xl border border-line bg-surface p-3" style={{ top, width: 'var(--studio-left-width)' }}>
          <SkeletonBlock className="h-12 shrink-0" /><SkeletonBlock className="h-9 shrink-0" />
          <SkeletonBlock className="mt-2 h-4 w-20 shrink-0" />
          {[0, 1, 2, 3].map(index => <SkeletonBlock key={index} className="min-h-12 flex-1" />)}
        </div>
        <div data-skeleton-right-rail className="fixed right-4 bottom-4 flex flex-col gap-4 overflow-hidden rounded-2xl border border-line bg-surface p-3" style={{ top, width: 'var(--studio-right-width)' }}>
          {Array.from({ length: 7 }, (_, index) => <SkeletonBlock key={index} className="h-12 min-h-6 shrink" />)}
        </div>
      </div>
    </SkeletonStatus>
  </SkeletonPage>;
}
