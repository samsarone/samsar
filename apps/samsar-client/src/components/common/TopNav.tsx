import React, { Suspense, lazy, useEffect, useContext, useCallback } from 'react';
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
import { toast } from 'react-toastify';
import { useLocalization } from '../../contexts/LocalizationContext.jsx';
import { hasInsufficientGenerationCredits } from '../../utils/defaultRoutes.js';

import CanvasControlBar from '../video/toolbars/CanvasControlBar.jsx';
import { getSessionType } from '../../utils/environment.jsx';

import { NavCanvasControlContext } from '../../contexts/NavCanvasControlContext.jsx';
import { FaCog, FaTimes } from 'react-icons/fa';
import BrandLogo from './BrandLogo.tsx';
import { imageAspectRatioOptions } from '../../constants/ImageAspectRatios.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/canvas.jsx';


const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
const IS_DOCKER_INSTALL = import.meta.env.VITE_DOCKER_INSTALL === 'true';
const AddSessionDropdown = lazy(() => import('./AddSessionDropdown.jsx'));
const AuthContainer = lazy(() => import('../auth/AuthContainer.jsx'));
const UpgradePlan = lazy(() => import('../payments/UpgradePlan.tsx'));
const AUTH_DIALOG_OPTIONS = {
  surface: 'auth',
  fullBleed: true,
  centerContent: true,
  hideBorder: true,
  hideCloseButton: true,
};
const dialogFallback = <div className="p-6 text-sm">Loading...</div>;
const creditsNumberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
});

function formatCredits(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? creditsNumberFormatter.format(numericValue) : '-';
}

export default function TopNav(props) {
  const {
    isVideoPreviewPlaying,
    setIsVideoPreviewPlaying,
    isRenderPending,
    submitRenderVideo,
    cancelPendingRender,
    renderedVideoPath,
    downloadLink,
    isVideoGenerating,
    isUpdateLayerPending,
    isCanvasDirty,
    isSessionPublished,
    publishVideoSession,
    unpublishVideoSession,
    renderCompletedThisSession,
    sessionId: sessionIdOverride,
    openAdvancedVideoEditDialog,
    isReadOnlyShareView,
    isEditableShareView,
    isImportedSession,
    onRequestEditSession,
    openAuthDialog,
  } = props;
  const { colorMode } = useColorMode();
  const { t } = useLocalization();
  const location = useLocation();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();

  const sessionType = getSessionType();

  const isImageEditor =
    location.pathname.includes('/image/') ||
    location.pathname.includes('/iamge/') ||
    location.pathname.includes('/image_sessions');
  const isVideoEditor = location.pathname.includes('/video/') || location.pathname.includes('/vidgenie/') || location.pathname.includes('/vidgpt/') || location.pathname.includes('/adcreator/');
  const isGenerationWorkspace =
    isImageEditor ||
    isVideoEditor ||
    location.pathname === '/vidgenie' ||
    location.pathname.startsWith('/vidgenie/');
  const isGenerationsView = location.pathname.startsWith('/generations');

  const {
    downloadCurrentFrame,
    isExpressGeneration,
    requestRegenerateSubtitles,
    requestRegenerateAnimations,
    requestRealignLayers,
    requestRealignToAiVideoAndLayers,
    canvasActualDimensions,
    totalEffectiveDuration,
    sessionId: navSessionId,
  } = useContext(NavCanvasControlContext);

  const resolvedSessionId = sessionIdOverride || navSessionId;

  const navShell =
    colorMode === 'dark'
      ? 'bg-gradient-to-r from-[#071223] via-[#0d1d35] to-[#0a1b2d] text-slate-100 border-b border-[#2a4e70] shadow-[0_16px_48px_rgba(0,0,0,0.45)]'
      : 'bg-gradient-to-r from-[#e9edf7] via-[#dfe7f5] to-[#eef3fb] text-slate-900 border-b border-[#d7deef]';

  const resetSession = () => {
    closeAlertDialog();
    if (isImageEditor) {
      createNewImageSession();
      return;
    }
    createNewSession();
  };

  useEffect(() => {
    const queryParams = new URLSearchParams(location.search);
    const register = queryParams.get('register');
    const login = queryParams.get('login');
    queryParams.get('plan');

    if (!user || !user._id) {

      if (register === 'true') {
        if (IS_DOCKER_INSTALL) {
          showLoginDialog();
        } else {
          showRegisterDialog();
        }
      }

      if (login === 'true') {
        showLoginDialog();
      }
    }



    // if (user && !user.isPremiumUser) {
    //   const setPaymentFlowShown = localStorage.getItem("setPaymentFlowShown");

    //   if (!setPaymentFlowShown || setPaymentFlowShown === 'false') {
    //     localStorage.setItem("setPaymentFlowShown", "true");
    //     setTimeout(() => {
    //       openAlertDialog(
    //         <div className='relative '>
    //           <UpgradePlan />
    //         </div>
    //       );
    //     }, 10 * 1000);


    //   }

    // }

  }, [location.search]);


  useEffect(() => {
    // listen to local storage setShowSetPaymentFlow
    // if set then show timeouts 2 min the payment flow and set it to false in local storage

    // if (localStorage.getItem("setShowSetPaymentFlow") === 'true') {
    //   setTimeout(() => {
    //     openAlertDialog(
    //       <div className='relative '>
    //         <UpgradePlan />
    //       </div>

    //     );
    //   }, 500);
    //   localStorage.setItem("setShowSetPaymentFlow", "false");
    // }

    const handleStorageChange = (event) => {
      if (event.key === "setShowSetPaymentFlow" && event.newValue === 'true') {

        setTimeout(() => {
          if (user && !user.isPremiumUser) {
            openAlertDialog(
              <Suspense fallback={dialogFallback}>
                <div className='relative'>
                  <UpgradePlan />
                </div>
              </Suspense>
            );
          }

        }, 1000 * 2);
        localStorage.setItem("setShowSetPaymentFlow", "false");
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const homeAlertDialogComponent = (
    <div>
      <div>{t("common.resetSessionConfirm")}</div>
      <div className="mt-4 mb-4 m-auto">
        <div className="inline-flex ml-2 mr-2">
          <CommonButton
            onClick={() => {
              resetSession();
            }}
          >
            {t("common.yes")}
          </CommonButton>
        </div>
        <div className="inline-flex ml-2 mr-2">
          <CommonButton
            onClick={() => {
              closeAlertDialog();
            }}
          >
            {t("common.no")}
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

  const gotoCreditsBilling = () => {
    navigate('/account/billing');
  };

  const showLoginDialog = () => {
    if (typeof openAuthDialog === 'function') {
      openAuthDialog();
      return;
    }

    navigate('/login');
  };

  const showRegisterDialog = () => {
    if (IS_DOCKER_INSTALL) {
      showLoginDialog();
      return;
    }

    if (typeof openAuthDialog === 'function') {
      openAuthDialog({ initView: 'register' });
      return;
    }

    const registerComponent = (
      <Suspense fallback={dialogFallback}>
        <AuthContainer initView="register" />
      </Suspense>
    );
    openAlertDialog(registerComponent, undefined, false, AUTH_DIALOG_OPTIONS);
  }

  const copyShareUrlToClipboard = useCallback((sharePath) => {
    const shareUrl = new URL(sharePath, window.location.origin).toString();
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl).catch(() => {});
    }
    toast.success('Share link copied', { position: 'bottom-center' });
  }, []);

  const createShareUrl = useCallback((mode: 'read_only' | 'editable') => {
    if (isReadOnlyShareView || isEditableShareView) {
      const shareUrl = window.location.href;
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(shareUrl).catch(() => {});
      }
      toast.success('Share link copied', { position: 'bottom-center' });
      return;
    }

    if (!resolvedSessionId) {
      toast.error('Session is not ready to share.', { position: 'bottom-center' });
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    axios
      .post(`${PROCESSOR_SERVER}/video_sessions/share_session`, { sessionId: resolvedSessionId, mode }, headers)
      .then((response) => {
        const sharePath = response?.data?.shareUrl || response?.data?.share_url;
        if (!sharePath) {
          throw new Error('Missing share URL.');
        }

        copyShareUrlToClipboard(sharePath);
      })
      .catch((error) => {
        toast.error(error?.response?.data?.error || 'Unable to create share link.', {
          position: 'bottom-center',
        });
      });
  }, [copyShareUrlToClipboard, isEditableShareView, isReadOnlyShareView, resolvedSessionId]);

  const openShareOptionsDialog = useCallback(() => {
    const optionButtonClassName =
      colorMode === 'dark'
        ? 'w-full rounded-lg border border-white/10 bg-[#111a2f] px-4 py-3 text-left transition hover:border-cyan-300/35 hover:bg-[#162744]'
        : 'w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-slate-300 hover:bg-slate-50';
    const secondaryTextClassName = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';

    openAlertDialog(
      <div className="relative w-full">
        <FaTimes className="absolute right-0 top-0 cursor-pointer" onClick={closeAlertDialog} />
        <div className="pr-8">
          <div className="text-base font-semibold">Share session</div>
          <div className={`mt-1 text-sm ${secondaryTextClassName}`}>
            Choose how this session link can be used.
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          <button
            type="button"
            className={optionButtonClassName}
            onClick={() => {
              closeAlertDialog();
              createShareUrl('read_only');
            }}
          >
            <div className="text-sm font-semibold">Read only</div>
            <div className={`mt-1 text-xs ${secondaryTextClassName}`}>Anyone with the link can view.</div>
          </button>
          <button
            type="button"
            className={optionButtonClassName}
            onClick={() => {
              closeAlertDialog();
              createShareUrl('editable');
            }}
          >
            <div className="text-sm font-semibold">Editable link</div>
            <div className={`mt-1 text-xs ${secondaryTextClassName}`}>Authenticated users can edit this session.</div>
          </button>
        </div>
      </div>,
      undefined,
      false,
      {
        centerContent: true,
        containerClassName: 'w-full max-w-[420px]',
        fullBleed: false,
      }
    );
  }, [
    closeAlertDialog,
    colorMode,
    createShareUrl,
    isEditableShareView,
    isReadOnlyShareView,
    openAlertDialog,
  ]);

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
    const selectedAspectRatio = normalizedSessionConfig.aspectRatio || '1:1';
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
    const defaultAspectRatio = localStorage.getItem('defaultImageAspectRatio') || '1:1';
    createNewImageSession(defaultAspectRatio);
  };

  const openVideoEditor = () => {
    const storedSessionId = localStorage.getItem('videoSessionId') || localStorage.getItem('sessionId');
    if (storedSessionId) {
      navigate('/video');
      return;
    }
    const defaultAspectRatio = localStorage.getItem('defaultAspectRatio') || '1:1';
    createNewSession(defaultAspectRatio);
  };

  const openStudioWorkspace = () => {
    const storedSessionId = localStorage.getItem('videoSessionId') || localStorage.getItem('sessionId');
    if (storedSessionId) {
      navigate(`/vidgenie/${storedSessionId}`);
      return;
    }
    addNewVidGPTSession();
  };


  const addNewExpressSession = () => {
    const headers = getHeaders();
    const payload = {
      prompts: [],
    };
    axios.post(`${PROCESSOR_SERVER}/video_sessions/create_video_session`, payload, headers).then(function (response) {
      const session = response.data;
      const sessionId = session._id.toString();
      localStorage.setItem('videoSessionId', sessionId);

      navigate(`/vidgenie/${session._id}`);

    });
  }

  const addNewVidGPTSession = () => {
    const headers = getHeaders();
    const payload = {
      prompts: [],
    };
    axios.post(`${PROCESSOR_SERVER}/video_sessions/create_video_session`, payload, headers).then(function (response) {
      const session = response.data;
      const sessionId = session._id.toString();
      localStorage.setItem('videoSessionId', sessionId);

      navigate(`/vidgenie/${session._id}`);

    });
  }

  const showAddNewAdVideoSession = () => {
    const headers = getHeaders();
    const payload = {
      prompts: [],
    };
    axios.post(`${PROCESSOR_SERVER}/video_sessions/create_video_session`, payload, headers).then(function (response) {
      const session = response.data;
      const sessionId = session._id.toString();
      localStorage.setItem('videoSessionId', sessionId);

      navigate(`/adcreator/${session._id}`);

    });

  }
  let userTierDisplay = null;

  let userCredits;

  if (user && user._id && !isReadOnlyShareView) {
    if (sessionType !== 'docker') {
      if (user.isPremiumUser) {
        let premiumUserType = 'Premium';
        if (user.premiumUserType) {
          premiumUserType = user.premiumUserType;
        }
        userTierDisplay = (
          <div className='text-xs text-[#d7ffeb]'>
            <FaStar className="inline-flex text-[#39d881]" /> {premiumUserType}
          </div>
        );
      } else {
        userTierDisplay = (
          <div className='text-xs text-slate-400'>
            <FaStar className="inline-flex text-slate-500" /> {t("common.upgrade")}
          </div>
        );
      }
    }

    userCredits = user.generationCredits;

    userProfile = (
      <div className="flex items-center justify-end gap-3">
        <div className="flex flex-col text-right leading-tight">
          <div className="text-sm font-semibold max-w-[140px] whitespace-nowrap overflow-hidden text-ellipsis">
            {user.username ? user.username : user.email}
          </div>
          {userTierDisplay && (
            <div onClick={upgradeToPremiumTier} className="cursor-pointer">
              {userTierDisplay}
            </div>
          )}
        </div>
        <FaCog className="text-lg cursor-pointer hover:text-[#89dcff]" onClick={gotoUserAccount} />
      </div>
    );


  } else {
    userProfile = (
      <button
        className={`
          inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0
          ${colorMode === 'dark'
            ? 'text-slate-100 bg-[#111a2f] hover:bg-[#162744] hover:text-[#d7ffeb] shadow-[0_8px_20px_rgba(0,0,0,0.3)] hover:shadow-[0_12px_24px_rgba(70,191,255,0.2)]'
            : 'border border-slate-200 text-slate-900 bg-white/80 hover:bg-white hover:text-slate-900'}
        `}
        type="button"
        onClick={showLoginDialog}
      >
        <IoMdLogIn className="text-base" />
        <span>{t("common.login")}</span>
      </button>
    );
  }

  const gotoHome = () => {
    if (user && user._id && !isImageEditor && !isVideoEditor) {
      navigate('/generations');
      return;
    }

    const currentPath = location.pathname;
    if (currentPath.includes('video')) {
      openAlertDialog(homeAlertDialogComponent);
    } else {
      const lastActiveSession = localStorage.getItem('videoSessionId');
      if (lastActiveSession) {
        navigate(`/video/${lastActiveSession}`);
      } else {
        navigate('/');
      }
    }
  };

  const showAddNewMovieMakerSession = () => {
    const headers = getHeaders();
    const payload = {
      prompts: [],
    };
    axios.post(`${PROCESSOR_SERVER}/video_sessions/create_video_session`, payload, headers).then(function (response) {
      const session = response.data;
      const sessionId = session._id.toString();
      localStorage.setItem('videoSessionId', sessionId);

      navigate(`/movie_maker/${session._id}`);

    });
  }

  let addSessionButton = <span />;

  let betaOptionVisible = false;
  if (user && user.isAdminUser) {
    betaOptionVisible = true;
  }

  if (user && user._id) {
    addSessionButton = (
      <div className="inline-flex items-center">
        <Suspense fallback={<div className="h-11 w-[118px]" />}>
          <AddSessionDropdown
            createNewSession={isImageEditor ? createNewImageSession : createNewSession}
            gotoViewSessionsPage={gotoViewSessionsPage}
            addNewExpressSession={addNewExpressSession}
            addNewVidGPTSession={addNewVidGPTSession}
            showAddNewMovieMakerSession={showAddNewMovieMakerSession}
            betaOptionVisible={betaOptionVisible}
            showAddNewAdVideoSession={showAddNewAdVideoSession}
            aspectRatioOptions={isImageEditor ? imageAspectRatioOptions : undefined}
            aspectRatioStorageKey={isImageEditor ? 'defaultImageAspectRatio' : 'defaultAspectRatio'}
            useImageProjectModal={isImageEditor}
            switchEditorLabel={isImageEditor ? 'Video Editor' : (isVideoEditor ? 'Image Editor' : null)}
            onSwitchEditor={isImageEditor ? openVideoEditor : (isVideoEditor ? openImageEditor : null)}
            showVideoOptions={!isImageEditor}
          />
        </Suspense>
      </div>
    );
  }

  let userCreditsDisplay = <span />;
  if (user && user._id && sessionType !== 'docker') {
    const creditsButtonClass = colorMode === 'dark'
      ? 'border border-white/10 bg-black/15 text-slate-100 hover:border-cyan-300/35 hover:bg-[#13233d]'
      : 'border border-slate-200 bg-white/75 text-slate-900 hover:border-slate-300 hover:bg-white';
    const creditsLabelClass = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';
    const formattedCredits = formatCredits(userCredits);
    const showLowCreditCue = isGenerationWorkspace && hasInsufficientGenerationCredits(user);
    const cueClasses = colorMode === 'dark'
      ? 'border-cyan-300/20 bg-[#eef6ff] text-slate-950 shadow-[0_14px_30px_rgba(0,0,0,0.28)]'
      : 'border-slate-200 bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)]';
    const cuePointerClasses = colorMode === 'dark'
      ? 'border-l-cyan-300/20 border-t-cyan-300/20 bg-[#eef6ff]'
      : 'border-l-slate-200 border-t-slate-200 bg-slate-950';

    userCreditsDisplay = (
      <div className="relative">
        {showLowCreditCue ? (
          <div
            className={`pointer-events-none absolute right-0 top-full z-[1300] mt-2 w-max rounded-lg border px-3 py-2 text-xs font-semibold leading-none animate-bounce motion-reduce:animate-none ${cueClasses}`}
          >
            Add credits to generate
            <span className={`absolute right-6 top-[-5px] h-3 w-3 rotate-45 border-l border-t ${cuePointerClasses}`} />
          </div>
        ) : null}
        <button
          type="button"
          onClick={gotoCreditsBilling}
          className={`inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-xs font-semibold leading-none transition-colors ${creditsButtonClass}`}
          aria-label={`Open billing. Current balance ${formattedCredits} credits`}
        >
          <span className={creditsLabelClass}>Credits remaining</span>
          <span>{formattedCredits}</span>
        </button>
      </div>
    );
  }
  let errorMessageDisplay = <span />;

  const showRegenerateSubtitles = () => {

    openAlertDialog(
      <div className='relative'>
        <div className="absolute top-2 right-2">
          <FaTimes className="cursor-pointer" onClick={closeAlertDialog} />
        </div>
        <div className="text-center">
          <div className="text-lg font-bold">{t("studio.actions.regenerateSubtitlesTitle")}</div>
          <div className="text-sm">{t("studio.actions.realignLayers")}</div>
          <CommonButton onClick={requestRegenerateSubtitles}>{t("studio.actions.regenerateSubtitle")}</CommonButton>
        </div>
      </div>
    );

  }


  const regenerateVideoSessionSubtitles = () => {

    const headers = getHeaders();


    axios.post(`${PROCESSOR_SERVER}/video_sessions/request_regenerate_subtitles`, { sessionId: resolvedSessionId }, headers).then(function () {


    });


  }

  let controlbarView: React.ReactNode = null;
  if (location.pathname.includes('/video/') || isImageEditor) {
    controlbarView = (
      <CanvasControlBar
        downloadCurrentFrame={downloadCurrentFrame}
        isExpressGeneration={isExpressGeneration}
        sessionId={resolvedSessionId}
        requestRegenerateSubtitles={requestRegenerateSubtitles}
        requestRegenerateAnimations={requestRegenerateAnimations}
        requestRealignLayers={requestRealignLayers}
        canvasActualDimensions={canvasActualDimensions}
        totalEffectiveDuration={totalEffectiveDuration}
        requestRealignToAiVideoAndLayers={requestRealignToAiVideoAndLayers}
        showRegenerateSubtitles={showRegenerateSubtitles}
        regenerateVideoSessionSubtitles={regenerateVideoSessionSubtitles}
        isVideoPreviewPlaying={isVideoPreviewPlaying}
        setIsVideoPreviewPlaying={setIsVideoPreviewPlaying}
        isRenderPending={isRenderPending}
        submitRenderVideo={submitRenderVideo}
        cancelPendingRender={cancelPendingRender}
        renderedVideoPath={renderedVideoPath}
        downloadLink={downloadLink}
        isVideoGenerating={isVideoGenerating}
        isUpdateLayerPending={isUpdateLayerPending}
        isCanvasDirty={isCanvasDirty}
        isSessionPublished={isSessionPublished}
        publishVideoSession={publishVideoSession}
        unpublishVideoSession={unpublishVideoSession}
        renderCompletedThisSession={renderCompletedThisSession}
        editorVariant={isImageEditor ? 'imageStudio' : 'videoStudio'}
        openAdvancedVideoEditDialog={openAdvancedVideoEditDialog}
        isReadOnlyMode={Boolean(isReadOnlyShareView)}
        isImportedSession={Boolean(isImportedSession)}
        onRequestEditSession={onRequestEditSession}
        onCreateShareUrl={openShareOptionsDialog}
      />
    );
  } else if (isGenerationsView) {
    const galleryShortcutActive = colorMode === 'dark'
      ? 'border border-cyan-400/25 bg-[#13233d] text-slate-100 hover:bg-[#1a2f4d] hover:border-cyan-300/40'
      : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:border-slate-300';
    const galleryShortcutGroup = colorMode === 'dark'
      ? 'rounded-full border border-white/10 bg-black/10 px-2 py-2 shadow-[0_12px_24px_rgba(0,0,0,0.22)]'
      : 'rounded-full border border-white/70 bg-white/80 px-2 py-2 backdrop-blur';
    controlbarView = (
      <div className={`flex flex-wrap items-center justify-center gap-2 ${galleryShortcutGroup}`}>
        <button
          type="button"
          className={`inline-flex min-h-[40px] items-center justify-center rounded-full px-3 py-2 text-xs font-semibold transition lg:min-h-[46px] lg:px-5 lg:py-3 lg:text-sm ${galleryShortcutActive}`}
          onClick={openVideoEditor}
        >
          Video Editor
        </button>
        <button
          type="button"
          className={`inline-flex min-h-[40px] items-center justify-center rounded-full px-3 py-2 text-xs font-semibold transition lg:min-h-[46px] lg:px-5 lg:py-3 lg:text-sm ${galleryShortcutActive}`}
          onClick={openImageEditor}
        >
          Image Editor
        </button>
        <button
          type="button"
          className={`inline-flex min-h-[40px] items-center justify-center rounded-full px-3 py-2 text-xs font-semibold transition lg:min-h-[46px] lg:px-5 lg:py-3 lg:text-sm ${galleryShortcutActive}`}
          onClick={openStudioWorkspace}
        >
          VidGenie
        </button>
      </div>
    );
  } else if (location.pathname.includes('/vidgenie/')) {
    controlbarView = <div />;
  }


  if (isGenerationsView) {
    return (
      <div className={`${navShell} fixed top-0 inset-x-0 z-[1200] h-[76px]`}>
        <div className="grid h-full w-full grid-cols-[minmax(150px,0.8fr)_minmax(0,auto)_minmax(150px,0.8fr)] items-center gap-3 px-3 sm:px-4 lg:grid-cols-[minmax(190px,1fr)_auto_minmax(190px,1fr)] lg:px-6">
          <div className="flex h-full items-center justify-start">
            <BrandLogo onClick={gotoHome} className="w-full max-w-[210px] lg:max-w-[250px]" />
          </div>
          <div className="flex h-full items-center justify-center">
            {controlbarView}
          </div>
          <div className="flex min-w-0 items-center justify-end gap-2 text-xs sm:text-sm">
            {errorMessageDisplay}
            <div className="hidden items-center lg:flex">
              {addSessionButton}
            </div>
            <div className="hidden items-center justify-end xl:flex">
              {userCreditsDisplay}
            </div>
            <div className="flex items-center justify-end">
              {userProfile}
            </div>
          </div>
        </div>
      </div>
    );
  }



  return (
    <div className={`${navShell} fixed top-0 inset-x-0 z-[1200] h-[56px]`}>
      <div className="grid h-full w-full grid-cols-[minmax(132px,14%)_1fr_auto] items-center gap-2 px-[2px] pr-3 lg:gap-4 lg:pr-6">
        <div className="flex h-full items-center justify-center px-2">
          <BrandLogo onClick={gotoHome} className="w-full max-w-[220px] px-2 lg:max-w-[260px] lg:px-4" />
        </div>
        <div className="flex items-center justify-center min-w-0 h-full py-[2px]">
          <div className="flex h-full w-full items-center justify-center translate-y-[4px]">
            {controlbarView}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center justify-end gap-2 text-xs sm:text-sm lg:gap-3">
          {errorMessageDisplay}
          <div className="flex items-center">
            {addSessionButton}
          </div>
          <div className="hidden items-center justify-end xl:flex">
            {userCreditsDisplay}
          </div>
          <div className="flex items-center justify-end">
            {userProfile}
          </div>
        </div>
      </div>
    </div>
  );
}
