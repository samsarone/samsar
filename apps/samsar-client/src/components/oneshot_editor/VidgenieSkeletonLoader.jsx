import VidgeniePageShell from './VidgeniePageShell.jsx';
import { VIDGENIE_EDITOR_CLASS, VIDGENIE_CARD_CLASS, getVidgeniePreviewFrameStyle } from './vidgenieLayout.js';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { getSessionLoadingLayout, readSessionLoadingLayout } from '../../utils/sessionLoadingLayout.js';
import { SkeletonBlock, SkeletonFields, SkeletonStatus } from '../common/LoadingSkeleton.jsx';
import './mobileStyles.css';

export function VidgenieSkeleton({ variant = 'unknown', aspectRatio = '16:9', embedded = false }) {
  useUiLanguage();
  const { colorMode } = useColorMode();
  const surface = `border border-line ${colorMode === 'dark' ? 'bg-[#181b24]/96 shadow-[0_20px_56px_rgba(0,0,0,0.32)]' : 'bg-white shadow-sm'}`;
  const completed = variant === 'completed';
  const showForm = variant === 'init' || variant === 'pending';
  const content = (
    <SkeletonStatus label={uiText('Loading VidGenie')} data-loading-layout={variant} className={`${VIDGENIE_EDITOR_CLASS} vidgenie-loading`}>
      <div className={`${VIDGENIE_CARD_CLASS} ${surface}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
          <SkeletonBlock className="h-7 w-44 max-w-full" />
          <SkeletonBlock className="h-9 w-full rounded-full sm:w-28" />
          <SkeletonBlock className="h-8 w-36 max-w-full self-center rounded-full sm:ml-auto" />
        </div>
        {completed && <div className="mt-4 rounded-xl bg-surface-sunken p-3 ring-1 ring-line">
          <SkeletonBlock className="h-4 w-28" />
          <SkeletonBlock className="mt-2 h-3 w-44 max-w-full" />
        </div>}
        {showForm && <div className="mt-4" data-skeleton-request>
          <SkeletonFields count={6} />
        </div>}
        {variant === 'unknown' && <div className="mt-4 space-y-3"><SkeletonBlock className="h-4 w-1/3" /><SkeletonBlock className="h-16 w-full" /></div>}
      </div>
      {(completed || variant === 'pending') && <div data-skeleton-result className={`vidgenie-progress-panel mt-4 rounded-xl p-3 sm:rounded-2xl sm:p-4 ${surface}`}>
        {variant === 'pending' && <SkeletonBlock className="h-3 w-full rounded-full" />}
        <SkeletonBlock className={`vidgenie-preview-frame ${aspectRatio === '9:16' ? 'vidgenie-preview-frame-portrait' : 'vidgenie-preview-frame-landscape'} mx-auto mt-5 rounded-xl`} style={getVidgeniePreviewFrameStyle(aspectRatio)} />
      </div>}
      {showForm && <div className="mt-4 space-y-3" data-skeleton-prompt>
        <SkeletonBlock className="h-4 w-44" /><SkeletonBlock className="h-32 w-full" />
        <div className="flex justify-between gap-3"><SkeletonBlock className="h-3 w-36" /><SkeletonBlock className="h-3 w-16" /></div>
        <SkeletonBlock className="h-10 w-44" />
      </div>}
    </SkeletonStatus>
  );
  if (embedded) return content;
  return <VidgeniePageShell>{content}</VidgeniePageShell>;
}

function RouteVidgenieSkeleton(props) {
  const location = useLocation();
  const id = location.pathname.match(/^\/(?:vidgenie|vidgpt|videogpt|vidgemie|video|quick_video)\/([^/]+)\/?$/)?.[1];
  const guest = location.state?.guestSession;
  const guestId = String(guest?._id?.$oid || guest?._id || guest?.id || '');
  const layout = id && guestId === id && guest?.isGuestSession === true
    ? getSessionLoadingLayout(guest) : readSessionLoadingLayout(id);
  return <VidgenieSkeleton {...layout} {...props} />;
}

export default function VidgenieSkeletonLoader(props) {
  const inRouter = useInRouterContext();
  return inRouter ? <RouteVidgenieSkeleton {...props} /> : <VidgenieSkeleton {...props} />;
}
