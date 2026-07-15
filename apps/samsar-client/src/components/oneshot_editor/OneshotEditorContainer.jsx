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
const loadOneshotEditor = () => import('./OneshotEditor.jsx');
const OneshotEditor = lazy(loadOneshotEditor);

export function preloadOneshotEditor() {
  return loadOneshotEditor();
}

export default function OneshotEditorContainer() {

  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const { colorMode } = useColorMode();
  const { user, userFetching, userInitiated } = useUser();
  const [routeError, setRouteError] = useState('');
  const routeResolutionStartedRef = useRef(false);
  const shouldWaitForProjectAuth = shouldDeferVidgenieProjectLoad({
    sessionId: id,
    userInitiated,
    userFetching,
  });

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
            ? 'Unable to open VidGenie.'
            : 'The sample project is unavailable. Log in to create in VidGenie.'
        );
        routeResolutionStartedRef.current = false;
      } catch {
        if (isCancelled) return;
        setRouteError(
          isAuthenticated
            ? 'Unable to open VidGenie.'
            : 'The sample project is unavailable. Log in to create in VidGenie.'
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
    colorMode === 'dark'
      ? 'bg-[#0b1021] text-slate-100'
      : 'bg-gradient-to-br from-[#e9edf7] via-[#eef3fb] to-white text-slate-900';
  const subtleGradient =
    colorMode === 'dark'
      ? 'bg-gradient-to-b from-[#080f21] via-[#0d1830] to-[#0b1226]'
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
                <h1 className="text-xl font-semibold">VidGenie sample unavailable</h1>
                <p className="mt-2 text-sm opacity-75">{routeError}</p>
                <button
                  type="button"
                  onClick={() => navigate('/login?redirect=%2Fvidgenie')}
                  className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  Log in to create
                </button>
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
        <div className="vidgenie-page-shell mx-auto w-full max-w-6xl px-2 py-4 pt-[58px] sm:px-4 sm:py-6 sm:pt-6 md:py-10">
          <Suspense fallback={<VidgenieSkeletonLoader />}>
            <OneshotEditor />
          </Suspense>
        </div>
      </OverflowContainer>
    </div>
  )
}
