import { useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

import { useAlertDialog } from '../../contexts/AlertDialogContext.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { useUser } from '../../contexts/UserContext.jsx';
import { getHeaders } from '../../utils/web.jsx';
import { CURRENT_TOOLBAR_VIEW, IMAGE_EDIT_MODEL_TYPES } from '../../constants/Types.ts';

import CommonContainer from '../common/CommonContainer.tsx';
import AuthContainer, { AUTH_DIALOG_OPTIONS } from '../auth/AuthContainer.jsx';
import ImageEditorToolbar from './ImageEditorToolbar.jsx';

const PROCESSOR_API = import.meta.env.VITE_PROCESSOR_API;

const DEFAULT_GENERATION_MODEL = 'NANOBANANA2';
const DEFAULT_EDIT_MODEL = 'NANOBANANA2EDIT';

const getAspectRatioValue = (ratio) => {
  if (!ratio) return '1 / 1';
  const [w, h] = ratio.split(':').map((val) => Number(val));
  if (!w || !h) return '1 / 1';
  return `${w} / ${h}`;
};

export default function ImageStudioLandingHome() {
  const { user, userFetching, userInitiated } = useUser();
  const { openAlertDialog } = useAlertDialog();
  const { colorMode } = useColorMode();
  const navigate = useNavigate();

  const [currentView, setCurrentView] = useState(CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_DISPLAY);
  const [promptText, setPromptText] = useState('');
  const [aspectRatio] = useState(
    localStorage.getItem('defaultImageAspectRatio') || '1:1'
  );
  const [selectedGenerationModel, setSelectedGenerationModel] = useState(DEFAULT_GENERATION_MODEL);
  const [selectedEditModel, setSelectedEditModel] = useState(DEFAULT_EDIT_MODEL);
  const [selectedEditModelValue, setSelectedEditModelValue] = useState(
    IMAGE_EDIT_MODEL_TYPES.find((model) => model.key === DEFAULT_EDIT_MODEL)
  );
  const [editBrushWidth, setEditBrushWidth] = useState(25);

  const dialogOpenedRef = useRef(false);
  const redirectStartedRef = useRef(false);

  useEffect(() => {
    setSelectedEditModelValue(
      IMAGE_EDIT_MODEL_TYPES.find((model) => model.key === selectedEditModel)
    );
  }, [selectedEditModel]);

  useEffect(() => {
    if (!userInitiated || userFetching) return;
    if (user && user._id) return;
    if (dialogOpenedRef.current) return;
    dialogOpenedRef.current = true;
    openAlertDialog(<AuthContainer redirectTo="/image/studio" />, undefined, false, AUTH_DIALOG_OPTIONS);
  }, [userInitiated, userFetching, user, openAlertDialog]);

  useEffect(() => {
    if (!userInitiated || userFetching) return;
    if (!user || !user._id) return;
    if (redirectStartedRef.current) return;
    redirectStartedRef.current = true;

    const redirectToLastSession = async () => {
      const headers = getHeaders();
      if (!headers) {
        navigate('/image_sessions', { replace: true });
        return;
      }

      const storedSessionId = localStorage.getItem('imageSessionId');
      if (storedSessionId) {
        try {
          await axios.get(
            `${PROCESSOR_API}/image_sessions/session_details?id=${storedSessionId}`,
            headers
          );
          navigate(`/image/studio/${storedSessionId}`, { replace: true });
          return;
        } catch  {
          localStorage.removeItem('imageSessionId');
        }
      }

      try {
        const res = await axios.get(
          `${PROCESSOR_API}/image_sessions/list?page=1&limit=1&aspectRatio=All`,
          headers
        );
        const sessions = res.data?.data || [];
        const lastSession = Array.isArray(sessions) ? sessions[0] : null;
        const sessionId = lastSession?.id ?? lastSession?._id;
        if (sessionId) {
          localStorage.setItem('imageSessionId', sessionId.toString());
          navigate(`/image/studio/${sessionId}`, { replace: true });
          return;
        }
      } catch  {
        // Fall through to projects list.
      }

      navigate('/image_sessions', { replace: true });
    };

    redirectToLastSession();
  }, [userInitiated, userFetching, user, navigate]);

  const aspectRatioStyle = useMemo(() => getAspectRatioValue(aspectRatio), [aspectRatio]);

  const mainWorkspaceShell =
    colorMode === 'dark'
      ? 'bg-[#0b1021] text-slate-100'
      : 'bg-gradient-to-br from-[#e9edf7] via-[#eef3fb] to-white text-slate-900';
  const toolbarShell =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border-l border-[#1f2a3d] shadow-[0_1px_0_rgba(255,255,255,0.04)]'
      : 'bg-white border-l border-slate-200';
  const canvasSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border border-[#1f2a3d] shadow-[0_20px_50px_rgba(0,0,0,0.55)]'
      : 'bg-[#f1f5f9] border border-slate-300';
  const placeholderSurface =
    colorMode === 'dark'
      ? 'bg-gradient-to-br from-[#081426] via-[#0e2238] to-[#10253a] border border-[#2a4e70]'
      : 'bg-gradient-to-br from-white via-[#f1f5f9] to-[#e2e8f0] border border-slate-200';
  const accentSurface =
    colorMode === 'dark'
      ? 'bg-gradient-to-r from-[#46bfff]/20 to-[#39d881]/20 border border-[#39d881]/35'
      : 'bg-rose-200/60 border border-rose-200';
  const mutedSurface =
    colorMode === 'dark' ? 'bg-slate-700/30 border border-slate-600/30' : 'bg-slate-200/70 border border-slate-200';

  return (
    <CommonContainer>
      <div className={`${mainWorkspaceShell} block min-h-screen`}>
        <div className="text-center w-[82%] inline-block h-[100vh] overflow-scroll m-auto mb-8 align-top">
          <div className="min-h-[80vh] flex items-center justify-center">
            <div className={`relative ${canvasSurface} rounded-xl p-4 pb-8 inline-block w-full max-w-5xl`}>
              <div
                className={`w-full rounded-xl ${placeholderSurface} mx-auto overflow-hidden`}
                style={{ aspectRatio: aspectRatioStyle }}
              >
                <div className="w-full h-full p-6 flex flex-col justify-between">
                  <div className="flex items-center justify-between">
                    <div className="flex gap-3">
                      <div className={`h-10 w-32 rounded-full ${mutedSurface}`} />
                      <div className={`h-10 w-24 rounded-full ${accentSurface}`} />
                    </div>
                    <div className={`h-8 w-24 rounded-full ${mutedSurface}`} />
                  </div>
                  <div className="flex-1 flex items-center justify-center">
                    <div className={`h-48 w-48 rounded-3xl ${accentSurface}`} />
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className={`h-10 rounded-lg ${mutedSurface}`} />
                    <div className={`h-10 rounded-lg ${mutedSurface}`} />
                    <div className={`h-10 rounded-lg ${mutedSurface}`} />
                  </div>
                </div>
              </div>
              <div className="absolute inset-0 pointer-events-none rounded-xl" />
            </div>
          </div>
        </div>
        <div className={`w-[18%] inline-block align-top pt-[60px] ${toolbarShell}`}>
          <div className="pointer-events-none opacity-60">
            <ImageEditorToolbar
              currentViewDisplay={currentView}
              setCurrentViewDisplay={setCurrentView}
              promptText={promptText}
              setPromptText={setPromptText}
              submitGenerateNewRequest={() => {}}
              isGenerationPending={false}
              selectedGenerationModel={selectedGenerationModel}
              setSelectedGenerationModel={setSelectedGenerationModel}
              generationError={null}
              submitOutpaintRequest={() => {}}
              selectedEditModel={selectedEditModel}
              setSelectedEditModel={setSelectedEditModel}
              selectedEditModelValue={selectedEditModelValue}
              isOutpaintPending={false}
              outpaintError={null}
              editBrushWidth={editBrushWidth}
              setEditBrushWidth={setEditBrushWidth}
              showUploadAction={() => {}}
              onShowLibrary={() => {}}
              aspectRatio={aspectRatio}
              onEditProject={() => {}}
              onDownloadSimple={() => {}}
              onDownloadAdvanced={() => {}}
            />
          </div>
        </div>
      </div>
    </CommonContainer>
  );
}
