import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { SkeletonBlock, SkeletonPage, SkeletonStatus } from './LoadingSkeleton.jsx';

// For routes whose destination is not known yet, reserve only shared chrome.
export default function RouteLoadingScreen({ label = uiText("Loading...") }) {
  useUiLanguage();
  return <SkeletonPage>
    <SkeletonStatus label={label} className="mx-auto w-full max-w-6xl px-4 pt-[calc(var(--app-nav-height)+var(--workspace-inset))]">
      <div className="space-y-5 rounded-2xl border border-line bg-surface p-6">
        <SkeletonBlock className="h-6 w-44 max-w-full" />
        <SkeletonBlock className="h-3 w-2/3" />
        <SkeletonBlock className="h-24 w-full" />
      </div>
    </SkeletonStatus>
  </SkeletonPage>;
}
