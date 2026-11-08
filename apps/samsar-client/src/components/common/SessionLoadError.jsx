import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { SkeletonPage } from './LoadingSkeleton.jsx';

export default function SessionLoadError({ message, onRetry }) {
  useUiLanguage();
  return <SkeletonPage>
    <div className="mx-auto w-full max-w-lg px-4 pt-[calc(var(--app-nav-height)+var(--workspace-inset))]">
      <div role="alert" className="rounded-2xl border border-line bg-surface p-6 text-center text-fg">
        <h1 className="text-xl font-semibold">{uiText('Unable to open this session.')}</h1>
        <p className="mt-2 text-sm text-fg-muted">{message}</p>
        <button type="button" onClick={onRetry} className="mt-4 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">{uiText('Try again')}</button>
      </div>
    </div>
  </SkeletonPage>;
}
