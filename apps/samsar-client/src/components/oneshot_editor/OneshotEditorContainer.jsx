import { useEffect, useRef, useState } from 'react';
import OverflowContainer from '../common/OverflowContainer.tsx';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { getHeaders } from '../../utils/web';
import { useUser } from '../../contexts/UserContext.jsx';
import { resolveVidgenieEntryPath } from '../../utils/vidgenieRouting.js';
import VidgenieSkeletonLoader from './VidgenieSkeletonLoader.jsx';

import OneshotEditor from './OneshotEditor.jsx';
const API_SERVER = import.meta.env.VITE_PROCESSOR_API;

export default function OneshotEditorContainer() {

  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const { colorMode } = useColorMode();
  const { user, userFetching, userInitiated } = useUser();
  const [routeError, setRouteError] = useState('');
  const routeResolutionStartedRef = useRef(false);

  useEffect(() => {
    if (id || routeResolutionStartedRef.current) {
      return;
    }

    if (!userInitiated || userFetching) {
      return;
    }

    const headers = getHeaders();
    if (!user || !headers) {
      return;
    }

    routeResolutionStartedRef.current = true;
    setRouteError('');

    const resolveRoute = async () => {
      try {
        const targetPath = await resolveVidgenieEntryPath({
          apiServer: API_SERVER,
          headers,
          search: location.search,
          createIfMissing: true,
        });

        if (targetPath) {
          navigate(targetPath, { replace: true });
          return;
        }

        setRouteError('Unable to open VidGenie.');
        routeResolutionStartedRef.current = false;
      } catch  {
        setRouteError('Unable to open VidGenie.');
        routeResolutionStartedRef.current = false;
      }
    };

    void resolveRoute();
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

  if (!id) {
    return (
      <>
        <VidgenieSkeletonLoader />
        {routeError ? (
          <div className="fixed inset-x-0 bottom-8 z-50 mx-auto w-fit rounded-lg bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
            {routeError}
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className={`${outerShell} ${subtleGradient} min-h-screen`}>
      <OverflowContainer>
        <div className="vidgenie-page-shell mx-auto w-full max-w-6xl px-2 py-4 pt-[58px] sm:px-4 sm:py-6 sm:pt-6 md:py-10">
          <OneshotEditor />
        </div>
      </OverflowContainer>
    </div>
  )
}
