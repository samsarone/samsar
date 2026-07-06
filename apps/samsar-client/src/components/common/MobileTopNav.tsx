import { Suspense, lazy } from 'react';
import axios from 'axios';
import { useUser } from '../../contexts/UserContext';
import CommonButton from './CommonButton.tsx';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAlertDialog } from '../../contexts/AlertDialogContext';
import { IoMdLogIn } from 'react-icons/io';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import './common.css';
import { FaStar } from 'react-icons/fa6';
import { getHeaders } from '../../utils/web.jsx';
import BrandLogo from './BrandLogo.tsx';
import { imageAspectRatioOptions } from '../../constants/ImageAspectRatios.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/canvas.jsx';
import { getSessionType } from '../../utils/environment.jsx';

const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const AddSessionDropdown = lazy(() => import('./AddSessionDropdown.jsx'));
const AuthContainer = lazy(() => import('../auth/AuthContainer.jsx'));
const AUTH_DIALOG_OPTIONS = {
  surface: 'auth',
  fullBleed: true,
  centerContent: true,
  hideBorder: true,
  hideCloseButton: true,
};
const dialogFallback = <div className="p-6 text-sm">Loading...</div>;

export default function MobileTopNav(props) {
  const { addNewVidGPTSession } = props;
  const { colorMode } = useColorMode();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const location = useLocation();
  const sessionType = getSessionType();

  const isImageEditor =
    location.pathname.includes('/image/') ||
    location.pathname.includes('/iamge/') ||
    location.pathname.includes('/image_sessions');
  const isVideoEditor = location.pathname.includes('/video/') || location.pathname.includes('/vidgenie/') || location.pathname.includes('/vidgpt/') || location.pathname.includes('/adcreator/');
  const isGenerationsView = location.pathname.startsWith('/generations');

  const navShell =
    colorMode === 'dark'
      ? 'bg-gradient-to-r from-[#071223] via-[#0d1d35] to-[#0a1b2d] text-slate-100 border-b border-[#2a4e70] shadow-[0_14px_32px_rgba(0,0,0,0.38)]'
      : 'bg-gradient-to-r from-[#e9edf7] via-[#dfe7f5] to-[#eef3fb] text-slate-900 border-b border-[#d7deef]';

  const resetSession = () => {
    closeAlertDialog();
    if (isImageEditor) {
      createNewImageSession();
      return;
    }
    createNewSession();
  };

  const alertDialogComponent = (
    <div>
      <div>This will reset your current session. Are you sure you want to proceed?</div>
      <div className="mt-4 mb-4 m-auto">
        <div className="inline-flex ml-2 mr-2">
          <CommonButton
            onClick={() => {
              resetSession();
            }}
          >
            Yes
          </CommonButton>
        </div>
        <div className="inline-flex ml-2 mr-2">
          <CommonButton
            onClick={() => {
              closeAlertDialog();
            }}
          >
            No
          </CommonButton>
        </div>
      </div>
    </div>
  );

  const { user } = useUser();
  const navigate = useNavigate();

  let userProfile = <span />;

  const gotoUserAccount = () => {
    navigate('/account');
  };

  const showLoginDialog = () => {
    const loginComponent = (
      <Suspense fallback={dialogFallback}>
        <AuthContainer />
      </Suspense>
    );
    openAlertDialog(loginComponent, undefined, false, AUTH_DIALOG_OPTIONS);
  };

  const upgradeToPremiumTier = () => {
    navigate('/create_payment');
  };

  const createNewSession = (
    sessionConfig:
      | string
      | {
          aspectRatio?: string;
          sessionName?: string;
          sessionDescription?: string;
        } = '1:1'
  ) => {
    const normalizedSessionConfig = typeof sessionConfig === 'string'
      ? { aspectRatio: sessionConfig }
      : (sessionConfig || {});
    const selectedAspectRatio = normalizedSessionConfig.aspectRatio || '1:1';
    const normalizedSessionName = typeof normalizedSessionConfig.sessionName === 'string'
      ? normalizedSessionConfig.sessionName.trim()
      : '';
    const normalizedSessionDescription = typeof normalizedSessionConfig.sessionDescription === 'string'
      ? normalizedSessionConfig.sessionDescription.trim()
      : '';
    const headers = getHeaders();
    const payload: {
      prompts: string[];
      aspectRatio: string;
      sessionName?: string;
      sessionDescription?: string;
    } = {
      prompts: [],
      aspectRatio: selectedAspectRatio,
    };
    if (normalizedSessionName) {
      payload.sessionName = normalizedSessionName;
    }
    if (normalizedSessionDescription) {
      payload.sessionDescription = normalizedSessionDescription;
    }
    axios.post(`${PROCESSOR_SERVER}/video_sessions/create_video_session`, payload, headers).then(function (response) {
      const session = response.data;
      const sessionId = session._id.toString();
      localStorage.setItem('videoSessionId', sessionId);
      navigate(`/video/${session._id}`);
    });
  };

  const createNewImageSession = (
    sessionConfig:
      | string
      | {
          aspectRatio?: string;
          sessionName?: string;
          canvasDimensions?: { width?: number; height?: number };
          addBackgroundLayer?: boolean;
          backgroundLayerColor?: string;
        } = '1:1'
  ) => {
    const normalizedSessionConfig = typeof sessionConfig === 'string'
      ? { aspectRatio: sessionConfig }
      : (sessionConfig || {});
    const selectedAspectRatio = normalizedSessionConfig.aspectRatio || localStorage.getItem('defaultImageAspectRatio') || '1:1';
    const fallbackCanvasDimensions = getCanvasDimensionsForAspectRatio(selectedAspectRatio);
    const rawWidth = Number(normalizedSessionConfig.canvasDimensions?.width);
    const rawHeight = Number(normalizedSessionConfig.canvasDimensions?.height);
    const canvasDimensions = {
      width: Number.isFinite(rawWidth) && rawWidth > 0 ? Math.round(rawWidth) : fallbackCanvasDimensions.width,
      height: Number.isFinite(rawHeight) && rawHeight > 0 ? Math.round(rawHeight) : fallbackCanvasDimensions.height,
    };
    const normalizedSessionName = typeof normalizedSessionConfig.sessionName === 'string'
      ? normalizedSessionConfig.sessionName.trim()
      : '';
    const shouldAddBackgroundLayer = Boolean(normalizedSessionConfig.addBackgroundLayer);
    const backgroundLayerColor =
      typeof normalizedSessionConfig.backgroundLayerColor === 'string'
        ? normalizedSessionConfig.backgroundLayerColor
        : '#ffffff';

    const headers = getHeaders();
    const payload: {
      prompts: string[];
      aspectRatio: string;
      canvasDimensions: { width: number; height: number };
      sessionName?: string;
      addBackgroundLayer?: boolean;
      backgroundLayerColor?: string;
    } = {
      prompts: [],
      aspectRatio: selectedAspectRatio,
      canvasDimensions,
    };
    if (normalizedSessionName) {
      payload.sessionName = normalizedSessionName;
    }
    if (shouldAddBackgroundLayer) {
      payload.addBackgroundLayer = true;
      payload.backgroundLayerColor = backgroundLayerColor;
    }
    axios.post(`${PROCESSOR_SERVER}/image_sessions/create_session`, payload, headers).then(function (response) {
      const session = response.data;
      const sessionId = session._id.toString();
      localStorage.setItem('imageSessionId', sessionId);
      navigate(`/image/studio/${session._id}`);
    });
  };

  const gotoViewSessionsPage = () => {
    if (isImageEditor) {
      navigate('/image_sessions');
      return;
    }
    navigate('/my_sessions');
  };

  const openImageEditor = () => {
    const storedSessionId = localStorage.getItem('imageSessionId');
    if (storedSessionId) {
      navigate(`/image/studio/${storedSessionId}`);
      return;
    }
    createNewImageSession();
  };

  const openVideoEditor = () => {
    const storedSessionId = localStorage.getItem('videoSessionId') || localStorage.getItem('sessionId');
    if (storedSessionId) {
      navigate('/video');
      return;
    }
    createNewSession();
  };

  const openStudioWorkspace = () => {
    const storedSessionId = localStorage.getItem('videoSessionId') || localStorage.getItem('sessionId');
    if (storedSessionId) {
      navigate(`/vidgenie/${storedSessionId}`);
      return;
    }
    addNewVidGPTSession();
  };

  const createNewSessionDialog = (sessionConfig = '1:1') => {
    openAlertDialog(
      <div>
        <div>This will reset your current session. Are you sure you want to proceed?</div>
        <div className="mt-4 mb-4 m-auto">
          <div className="inline-flex ml-2 mr-2">
            <CommonButton
              onClick={() => {
                closeAlertDialog();
                createNewSession(sessionConfig);
              }}
            >
              Yes
            </CommonButton>
          </div>
          <div className="inline-flex ml-2 mr-2">
            <CommonButton
              onClick={() => {
                closeAlertDialog();
              }}
            >
              No
            </CommonButton>
          </div>
        </div>
      </div>
    );
  };

  let userTierDisplay = null;

  if (user && user._id) {
    if (sessionType !== 'docker') {
      if (user.isPremiumUser) {
        userTierDisplay = (
          <div className="text-[#d7ffeb]">
            <FaStar className="inline-flex text-[#39d881]" /> Premium
          </div>
        );
      } else {
        userTierDisplay = (
          <div className="text-slate-400">
            <FaStar className="inline-flex text-slate-500" /> Upgrade
          </div>
        );
      }
    }
    userProfile = (
      <div className="flex items-center justify-end cursor-pointer" onClick={gotoUserAccount}>
        <div className="flex flex-col text-left mr-2">
          <div className="text-md max-w-[90px] whitespace-nowrap overflow-hidden text-ellipsis">
            <h1>{user.displayName ? user.displayName : user.email}</h1>
          </div>
          {userTierDisplay && (
            <div onClick={upgradeToPremiumTier} className="cursor-pointer">
              {userTierDisplay}
            </div>
          )}
        </div>

      </div>
    );
  } else {
    const loginButtonClass = colorMode === 'dark'
      ? 'm-auto text-center min-w-16 rounded-lg text-slate-100 bg-[#111a2f] pl-8 pr-8 pt-1 pb-2 font-bold text-lg shadow-[0_8px_20px_rgba(0,0,0,0.3)] transition-all duration-200 ease-out hover:-translate-y-[1px] hover:bg-[#162744] hover:text-[#d7ffeb] hover:shadow-[0_12px_24px_rgba(70,191,255,0.2)] active:translate-y-0'
      : 'm-auto text-center min-w-16 rounded-lg border border-slate-200 bg-white/80 pl-8 pr-8 pt-1 pb-2 text-lg font-bold text-slate-900 transition-all duration-200 ease-out hover:-translate-y-[1px] hover:bg-white active:translate-y-0';

    userProfile = (
      <div className="mt-1 flex justify-end">
        <button
          className={loginButtonClass}
          onClick={showLoginDialog}
        >
          <IoMdLogIn className="inline-flex" /> Login
        </button>
      </div>
    );
  }

  const gotoHome = () => {
    if (user && user._id && !isImageEditor && !isVideoEditor) {
      navigate('/generations');
      return;
    }
    openAlertDialog(alertDialogComponent);
  };

  let addSessionButton = <span />;

  if (user && user._id) {
    addSessionButton = (

      <div className="">
        <Suspense fallback={<div className="h-11 w-[118px]" />}>
          <AddSessionDropdown
            createNewSession={isImageEditor ? createNewImageSession : createNewSessionDialog}
            gotoViewSessionsPage={gotoViewSessionsPage}
            addNewVidGPTSession={addNewVidGPTSession}
            aspectRatioOptions={isImageEditor ? imageAspectRatioOptions : undefined}
            aspectRatioStorageKey={isImageEditor ? 'defaultImageAspectRatio' : 'defaultAspectRatio'}
            useImageProjectModal={isImageEditor}
            switchEditorLabel={isImageEditor ? 'Video Editor' : (isVideoEditor ? 'Image Editor' : null)}
            onSwitchEditor={isImageEditor ? openVideoEditor : (isVideoEditor ? openImageEditor : null)}
            showStudioOption={false}
            showVideoOptions={!isImageEditor}
            compact={isGenerationsView}
          />
        </Suspense>
      </div>

    );
  }

  return (
    <div className={`${navShell} fixed z-[1200] w-[100vw] ${isGenerationsView ? 'py-2' : 'h-[50px]'}`}>
      <div className={`${isGenerationsView ? 'flex flex-col gap-3 px-3' : 'flex flex-basis items-center h-full'}`}>
        <div className={isGenerationsView ? 'flex min-h-[44px] items-center justify-between' : 'basis-1/3 pl-2'}>
          <BrandLogo onClick={gotoHome} className={isGenerationsView ? '' : 'mt-1'} />
          {isGenerationsView && (
            <div className="flex min-w-0 items-center justify-end gap-2">
              <div className="text-xs inline-flex items-center">
                {addSessionButton}
              </div>
              <div className="inline-flex items-center">{userProfile}</div>
            </div>
          )}
        </div>
        {!isGenerationsView && (
          <div className="basis-2/3">
            <div className="text-xs inline-flex items-center">
              <div>{addSessionButton}</div>
            </div>
            <div className=" inline-flex float-right mr-2">{userProfile}</div>
          </div>
        )}
        {isGenerationsView && (
          <div className={`grid w-full grid-cols-3 gap-2 rounded-full px-2 py-2 ${colorMode === 'dark'
            ? 'border border-white/10 bg-black/10'
            : 'border border-white/70 bg-white/80 backdrop-blur'
          }`}>
            <button
              type="button"
              className={`${colorMode === 'dark'
                ? 'border border-cyan-400/25 bg-[#13233d] text-slate-100 hover:bg-[#1a2f4d] hover:border-cyan-300/40'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:border-slate-300'
              } inline-flex min-h-[42px] min-w-0 items-center justify-center rounded-full px-2 py-2.5 text-[11px] font-semibold transition sm:text-xs`}
              onClick={openVideoEditor}
            >
              Video Editor
            </button>
            <button
              type="button"
              className={`${colorMode === 'dark'
                ? 'border border-cyan-400/25 bg-[#13233d] text-slate-100 hover:bg-[#1a2f4d] hover:border-cyan-300/40'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:border-slate-300'
              } inline-flex min-h-[42px] min-w-0 items-center justify-center rounded-full px-2 py-2.5 text-[11px] font-semibold transition sm:text-xs`}
              onClick={openImageEditor}
            >
              Image Editor
            </button>
            <button
              type="button"
              className={`${colorMode === 'dark'
                ? 'border border-cyan-400/25 bg-[#13233d] text-slate-100 hover:bg-[#1a2f4d] hover:border-cyan-300/40'
                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:border-slate-300'
              } inline-flex min-h-[42px] min-w-0 items-center justify-center rounded-full px-2 py-2.5 text-[11px] font-semibold transition sm:text-xs`}
              onClick={openStudioWorkspace}
            >
              VidGenie
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
