import VidgeniePageShell from '../oneshot_editor/VidgeniePageShell.jsx';
import { SkeletonBlock, SkeletonStatus } from '../common/LoadingSkeleton.jsx';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';

export function CreateComposerSkeleton() {
  useUiLanguage();
  return (
    <SkeletonStatus label={uiText('Loading...')} data-loading-page="create" className="mx-auto w-full max-w-4xl">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-3">
          <SkeletonBlock className="h-3 w-32" />
          <SkeletonBlock className="h-8 w-48" />
          <SkeletonBlock className="h-4 w-80 max-w-full" />
        </div>
        <SkeletonBlock className="h-10 w-36" />
      </div>
      <div className="vidgenie-editor-card rounded-2xl border border-line bg-surface p-4 shadow-sm sm:p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonBlock className="h-9 w-24" />
        </div>
        <SkeletonBlock className="h-40 w-full rounded-xl sm:h-44" />
        <div className="mt-3 flex justify-between gap-3">
          <SkeletonBlock className="h-3 w-56 max-w-[70%]" />
          <SkeletonBlock className="h-3 w-16" />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
          {[0, 1].map((field) => <div key={field} className="space-y-1.5">
            <SkeletonBlock className="h-4 w-20" />
            <SkeletonBlock className="h-11 w-full rounded-lg" />
          </div>)}
        </div>
        <div className="mt-4 flex justify-between gap-3 border-t border-line pt-4">
          <SkeletonBlock className="h-9 w-20" />
          <SkeletonBlock className="h-11 w-36" />
        </div>
      </div>
    </SkeletonStatus>
  );
}

export default function CreateLandingSkeleton() {
  return <VidgeniePageShell><main className="pb-6 pt-4 sm:pt-7"><CreateComposerSkeleton /></main></VidgeniePageShell>;
}
