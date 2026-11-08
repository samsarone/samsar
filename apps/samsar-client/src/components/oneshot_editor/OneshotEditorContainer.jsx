import { VIDGENIE_PAGE_CLASS } from './vidgenieLayout.js';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import OverflowContainer from '../common/OverflowContainer.tsx';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { getHeaders } from '../../utils/web';
import { useUser } from '../../contexts/UserContext.jsx';
import { resolveVidgenieEntryPath } from '../../utils/vidgenieRouting.js';
import { shouldDeferVidgenieProjectLoad } from './vidgenieProjectViewState.mjs';
import VidgenieSkeletonLoader from './VidgenieSkeletonLoader.jsx';

const API_SERVER = import.meta.env.VITE_PROCESSOR_API;
let editorModulePromise;
const loadOneshotEditor = () => {
  if (!editorModulePromise) {
    editorModulePromise = import('./OneshotEditor.jsx').catch((error) => {
      editorModulePromise = undefined;
      throw error;
    });
  }
  return editorModulePromise;
};
const OneshotEditor = lazy(loadOneshotEditor);

export function preloadOneshotEditor() {
  return loadOneshotEditor();
}

export default function OneshotEditorContainer() {
  useUiLanguage();

  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const { colorMode } = useColorMode();
  const { user, userFetching, userInitiated } = useUser();
  const [routeError, setRouteError] = useState('');
  const routeResolutionStartedRef = useRef(false);
  const shouldWaitForProjectAuth = shouldDeferVidgenieProjectLoad({
    sessionId: id,
    hasAuthenticatedUser: Boolean(user?._id),
    userInitiated,
    userFetching,
  });

  useEffect(() => {
    // Code can download while auth resolves; session reads still wait for auth.
    if (id) void preloadOneshotEditor().catch(() => undefined);
  }, [id]);

  useEffect(() => {
    if (id || routeResolutionStartedRef.current) {
      return;
    }

    if (!userInitiated || userFetching) {
      return;
    }

    const isAuthenticated = Boolean(user?._id);
    const headers = isAuthenticated ? getHeaders() : null;
    if (isAuthenticated && !headers) {
      return;
    }

    routeResolutionStartedRef.current = true;
    setRouteError('');
    let isCancelled = false;
    void preloadOneshotEditor().catch(() => undefined);

    const resolveRoute = async () => {
      try {
        let guestSession = null;
        const targetPath = await resolveVidgenieEntryPath({
          apiServer: API_SERVER,
          headers,
          search: location.search,
          createIfMissing: isAuthenticated,
          onGuestSessionResolved: (session) => {
            guestSession = session;
          },
        });

        if (isCancelled) return;

        if (targetPath) {
          navigate(targetPath, {
            replace: true,
            state: guestSession ? { guestSession } : null,
          });
          return;
        }

        setRouteError(
          isAuthenticated
            ? uiText("Unable to open VidGenie.")
            : uiText("The sample project is unavailable. Log in to create in VidGenie.")
        );
        routeResolutionStartedRef.current = false;
      } catch {
        if (isCancelled) return;
        setRouteError(
          isAuthenticated
            ? uiText("Unable to open VidGenie.")
            : uiText("The sample project is unavailable. Log in to create in VidGenie.")
        );
        routeResolutionStartedRef.current = false;
      }
    };

    void resolveRoute();

    return () => {
      isCancelled = true;
      routeResolutionStartedRef.current = false;
    };
  }, [id, location.search, navigate, user, userFetching, userInitiated]);

  useEffect(() => {


    if (id) {
      // navigate(`/vidgpt/quick_editor/${id}`);
    }
  }, [id]);

  const outerShell =
    `text-fg ${colorMode === 'dark' ? 'bg-[#0c0d12]' : 'bg-gradient-to-br from-[#e9edf7] via-[#eef3fb] to-white'}`;
  const subtleGradient =
    colorMode === 'dark'
      ? 'bg-[linear-gradient(180deg,#15171f_0%,#12141c_44%,#0c0d12_100%)]'
      : 'bg-gradient-to-b from-[#eef3fb] via-[#e4ebf8] to-[#f7fbff]';

  if (shouldWaitForProjectAuth) {
    return <VidgenieSkeletonLoader />;
  }

  if (!id) {
    if (routeError) {
      return (
        <div className={`${outerShell} ${subtleGradient} min-h-screen`}>
          <OverflowContainer>
            <div className="mx-auto flex min-h-[70vh] w-full max-w-lg items-center px-4 py-12">
              <div className="w-full rounded-2xl border border-slate-200/20 bg-white/10 p-6 text-center shadow-sm backdrop-blur-sm">
                <h1 className="text-xl font-semibold">{uiText("VidGenie sample unavailable")}</h1>
                <p className="mt-2 text-sm opacity-75">{routeError}</p>
                <button
                  type="button"
                  onClick={() => navigate('/login?redirect=%2Fvidgenie')}
                  className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >{uiText("Log in to create")}</button>
              </div>
            </div>
          </OverflowContainer>
        </div>
      );
    }

    return (
      <VidgenieSkeletonLoader />
    );
  }

  return (
    <div className={`${outerShell} ${subtleGradient} min-h-screen`}>
      <OverflowContainer>
        <div className={VIDGENIE_PAGE_CLASS}>
          <Suspense fallback={<VidgenieSkeletonLoader embedded />}>
            <OneshotEditor />
          </Suspense>
        </div>
      </OverflowContainer>
    </div>
  )
}
