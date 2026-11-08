import { getUiLocale, formatUiNumber } from '../../utils/localization.js';
import { useUiLanguage } from '../../hooks/useUiLanguage.js';
import { translateText as uiText } from '../../utils/localization.js';
import React, { Suspense, lazy, useEffect, useContext, useCallback, useState } from 'react';
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

import { IS_STANDALONE_DEPLOYMENT } from '../../utils/environment.jsx';

import { NavCanvasControlContext } from '../../contexts/NavCanvasControlContext.jsx';
import { FaCog, FaTimes } from 'react-icons/fa';
import BrandLogo from './BrandLogo.tsx';
import { imageAspectRatioOptions } from '../../constants/ImageAspectRatios.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/canvas.jsx';
import { SUPPORTED_LANGUAGES } from '../../constants/supportedLanguages.js';
import { buildSubtitleRegenerationLanguageFields } from '../../utils/subtitleRegenerationLanguage.mjs';
import { createStudioSession } from '../../utils/studioSessionApi.js';
import { getStudioSessionId } from '../../utils/studioSessionPolicy.mjs';
import { createBlankVidgenieSession } from '../../utils/vidgenieRouting.js';


const PROCESSOR_SERVER = import.meta.env.VITE_PROCESSOR_API;
// Shared chrome can render without downloading editor-only controls.
const CanvasControlBar = lazy(() => import('../video/toolbars/CanvasControlBar.jsx'));
const AddSessionDropdown = lazy(() => import('./AddSessionDropdown.jsx'));
const AuthContainer = lazy(() => import('../auth/AuthContainer.jsx'));
const UpgradePlan = lazy(() => import('../payments/UpgradePlan.tsx'));
const AUTH_DIALOG_OPTIONS = {
  surface: 'auth',
  transparentShell: true,
  fullBleed: true,
  centerContent: true,
  hideBorder: true,
  hideCloseButton: true,
};
function DialogFallback() {
  useUiLanguage();
  return <div className="p-6 text-sm">{uiText("Loading...")}</div>;
}
const dialogFallback = <DialogFallback />;
const creditsNumberFormatter = { format: (value) => formatUiNumber(value, {
  maximumFractionDigits: 2,
}) };

function formatCredits(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? creditsNumberFormatter.format(numericValue) : '-';
}

function RegenerateSubtitlesDialog({ onClose, onRegenerate, t }) {
  useUiLanguage();
  const [subtitleLanguage, setSubtitleLanguage] = useState('');

  return (
    <div className="relative min-w-[280px] pr-5">
      <div className="absolute right-0 top-0">
        <FaTimes className="cursor-pointer" onClick={onClose} />
      </div>
      <div className="text-center">
        <div className="text-lg font-bold">{t("studio.actions.regenerateSubtitlesTitle")}</div>
        <div className="text-sm">{t("studio.actions.realignLayers")}</div>
        <label className="mx-auto mt-3 block max-w-xs text-left">
          <span className="mb-1 block text-xs font-medium opacity-75">{uiText("Subtitle language")}<span className="font-normal">{uiText("(optional)")}</span>
          </span>
          <select
            value={subtitleLanguage}
            onChange={(event) => setSubtitleLanguage(event.target.value)}
            aria-label={uiText("Subtitle regeneration language")}
            className="w-full rounded-md border border-slate-500/30 bg-transparent px-2.5 py-1.5 text-sm outline-none"
          >
            <option value="">{uiText("Same as current audio")}</option>
            {SUPPORTED_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {uiText(language.name)}
              </option>
            ))}
          </select>
        </label>
        <CommonButton onClick={() => onRegenerate(subtitleLanguage)}>
          {t("studio.actions.regenerateSubtitle")}
        </CommonButton>
      </div>
    </div>
  );
}

export default function TopNav(props) {
  useUiLanguage();
  const {
    isWorkspaceLoading = false,
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
    isInteractiveVideo,
    publishedTitle,
    publishedDescription,
    publishedTags,
    publishVideoSession,
    unpublishVideoSession,
    renderCompletedThisSession,
    sessionId: sessionIdOverride,
    openAdvancedVideoEditDialog,
    openExpressPostProcessingDialog,
    isReadOnlyShareView,
    isEditableShareView,
    isImportedSession,
    onRequestEditSession,
    openAuthDialog,
    openAudioActions,
  } = props;
  const { colorMode } = useColorMode();
  const { user, userFetching, userInitiated } = useUser();
  const { t } = useLocalization();
  const location = useLocation();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();

  const isImageEditor =
    location.pathname.includes('/image/') ||
    location.pathname.includes('/iamge/') ||
    location.pathname.includes('/image_sessions');
  const isAudioEditor = location.pathname.startsWith('/audio/studio');
  const isStudioEditor = location.pathname === '/video' || location.pathname.startsWith('/video/');
  const isVideoEditor = location.pathname.includes('/video/') || location.pathname.includes('/vidgenie/') || location.pathname.includes('/vidgpt/') || location.pathname.includes('/adcreator/');
  const isGenerationWorkspace =
    isImageEditor ||
    isAudioEditor ||
    isVideoEditor ||
    location.pathname === '/vidgenie' ||
    location.pathname.startsWith('/vidgenie/');
  const isGenerationsView = location.pathname.startsWith('/generations');

  const {
    downloadCurrentFrame,
    isExpressGeneration: navIsExpressGeneration,
    requestRegenerateSubtitles,
    requestRegenerateAnimations,
    requestRealignLayers,
    requestRealignToAiVideoAndLayers,
    canvasActualDimensions,
    totalEffectiveDuration,
    sessionId: navSessionId,
  } = useContext(NavCanvasControlContext) || {};
  const isExpressGeneration = !isWorkspaceLoading && navIsExpressGeneration;

  const resolvedSessionId = sessionIdOverride || navSessionId;

  const navShell =
    `border-b text-fg ${colorMode === 'dark' ? 'border-[#3a4050] bg-[#12141c]/92 shadow-[0_12px_36px_rgba(0,0,0,0.34)] backdrop-blur-xl' : 'bg-gradient-to-r from-[#e9edf7] via-[#dfe7f5] to-[#eef3fb] border-[#d7deef]'}`;

  const resetSession = () => {
    closeAlertDialog();
    if (isAudioEditor) {
      return;
    }
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

    if (userFetching || userInitiated === false) return;
    if (!user || !user._id) {

      if (register === 'true') {
        if (IS_STANDALONE_DEPLOYMENT) {
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

  }, [location.search, user?._id, userFetching, userInitiated]);


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
    if (IS_STANDALONE_DEPLOYMENT) {
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
    toast.success(uiText("Share link copied"), { position: 'bottom-center' });
  }, []);

  const createShareUrl = useCallback((mode: 'read_only' | 'editable') => {
    if (isReadOnlyShareView || isEditableShareView) {
      const shareUrl = window.location.href;
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(shareUrl).catch(() => {});
      }
      toast.success(uiText("Share link copied"), { position: 'bottom-center' });
      return;
    }

    if (!resolvedSessionId) {
      toast.error(uiText("Session is not ready to share."), { position: 'bottom-center' });
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
          throw new Error(uiText("Missing share URL."));
        }

        copyShareUrlToClipboard(sharePath);
      })
      .catch((error) => {
        toast.error(error?.response?.data?.error || uiText("Unable to create share link."), {
          position: 'bottom-center',
        });
      });
  }, [copyShareUrlToClipboard, isEditableShareView, isReadOnlyShareView, resolvedSessionId]);

  const openShareOptionsDialog = useCallback(() => {
    const optionButtonClassName =
      `w-full rounded-lg border border-line-control bg-surface-raised text-left transition ${colorMode === 'dark' ? 'px-3 py-2 hover:border-[#f6c453]/60 hover:bg-[#292d3a]' : 'px-4 py-3 hover:border-slate-300 hover:bg-slate-50'}`;
    const secondaryTextClassName = 'text-fg-muted';

    openAlertDialog(
      <div className="relative w-full">
        <FaTimes className="absolute right-0 top-0 cursor-pointer" onClick={closeAlertDialog} />
        <div className="pr-8">
          <div className="text-base font-semibold">{uiText("Share session")}</div>
          <div className={`mt-1 text-sm ${secondaryTextClassName}`}>{uiText("Choose how this session link can be used.")}</div>
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
            <div className="text-sm font-semibold">{uiText("Read only")}</div>
            <div className={`mt-1 text-xs ${secondaryTextClassName}`}>{uiText("Anyone with the link can view.")}</div>
          </button>
          <button
            type="button"
            className={optionButtonClassName}
            onClick={() => {
              closeAlertDialog();
              createShareUrl('editable');
            }}
          >
            <div className="text-sm font-semibold">{uiText("Editable link")}</div>
            <div className={`mt-1 text-xs ${secondaryTextClassName}`}>{uiText("Authenticated users can edit this session.")}</div>
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
  }, [closeAlertDialog,
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
    createStudioSession({
      processorServer: PROCESSOR_SERVER,
      headers,
      payload,
    }).then(function (session) {
      const sessionId = getStudioSessionId(session);
      localStorage.setItem('videoSessionId', sessionId);

      navigate(`/video/${sessionId}`);

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

  const openAudioEditor = () => {
    navigate('/audio/studio');
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
    createBlankVidgenieSession(PROCESSOR_SERVER, headers).then(function (sessionId) {
      if (sessionId) navigate(`/vidgenie/${sessionId}`);
    });
  }

  const addNewVidGPTSession = () => {
    const headers = getHeaders();
    createBlankVidgenieSession(PROCESSOR_SERVER, headers).then(function (sessionId) {
      if (sessionId) navigate(`/vidgenie/${sessionId}`);
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
    if (!IS_STANDALONE_DEPLOYMENT) {
      if (user.isPremiumUser) {
        let premiumUserType = uiText('Premium');
        if (user.premiumUserType) {
          premiumUserType = user.premiumUserType;
        }
        userTierDisplay = (
          <div className='text-xs text-[#ffe5e8]'>
            <FaStar className="inline-flex text-[#f6c453]" /> {premiumUserType}
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
        <div className={`${isStudioEditor && isExpressGeneration ? "hidden xl:flex" : "flex"} flex-col text-right leading-tight`}>
          <div className="text-sm font-semibold max-w-[140px] whitespace-nowrap overflow-hidden text-ellipsis">
            {user.username ? user.username : user.email}
          </div>
          {userTierDisplay && (
            <div onClick={upgradeToPremiumTier} className="cursor-pointer">
              {userTierDisplay}
            </div>
          )}
        </div>
        <FaCog className="text-lg cursor-pointer hover:text-[#ffe0a3]" onClick={gotoUserAccount} />
      </div>
    );


  } else if (userFetching || userInitiated === false) {
    userProfile = <div aria-hidden="true" className="h-9 w-24 rounded-lg bg-surface-sunken" />;
  } else {
    userProfile = (
      <button
        className={`
          inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-200 ease-out hover:-translate-y-[1px] active:translate-y-0
          border border-line-control text-fg ${colorMode === 'dark' ? 'bg-[#20232e] shadow-[0_8px_20px_rgba(0,0,0,0.28)] hover:border-[#ff4655]/60 hover:bg-[#292d3a] hover:text-[#ffe5e8] hover:shadow-[0_12px_26px_rgba(255,70,85,0.16)]' : 'bg-white/80 hover:bg-white hover:text-slate-900'}
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
    if (user && user._id && !isImageEditor && !isAudioEditor && !isVideoEditor) {
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
            key={location.pathname}
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
            openVideoEditor={openVideoEditor}
            openImageEditor={openImageEditor}
            openAudioEditor={openAudioEditor}
            projectActionLabel={isImageEditor ? uiText("New image project") : (isAudioEditor && openAudioActions ? uiText("Audio actions") : (isStudioEditor && !isReadOnlyShareView ? uiText("New Studio project") : null))}
            onProjectAction={isAudioEditor ? openAudioActions : undefined}
          />
        </Suspense>
      </div>
    );
  }

  let userCreditsDisplay = <span />;
  if (user && user._id && !IS_STANDALONE_DEPLOYMENT) {
    const creditsButtonClass = `border border-line-control text-fg ${colorMode === 'dark' ? 'bg-black/15 hover:border-[#f6c453]/60 hover:bg-[#20232e]' : 'bg-white/75 hover:border-slate-300 hover:bg-white'}`;
    const creditsLabelClass = 'text-fg-muted';
    const formattedCredits = formatCredits(userCredits);
    const showLowCreditCue = isGenerationWorkspace && hasInsufficientGenerationCredits(user);
    const cueClasses = colorMode === 'dark'
      ? 'border-[#f6c453]/25 bg-[#fff4d6] text-slate-950 shadow-[0_14px_30px_rgba(0,0,0,0.28)]'
      : 'border-slate-200 bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.18)]';
    const cuePointerClasses = colorMode === 'dark'
      ? 'border-l-[#f6c453]/25 border-t-[#f6c453]/25 bg-[#fff4d6]'
      : 'border-l-slate-200 border-t-slate-200 bg-slate-950';

    userCreditsDisplay = (
      <div className="relative">
        {showLowCreditCue ? (
          <div
            className={`pointer-events-none absolute right-0 top-full z-[1300] mt-2 w-max rounded-lg border px-3 py-2 text-xs font-semibold leading-none animate-bounce motion-reduce:animate-none ${cueClasses}`}
          >{uiText("Add credits to generate")}<span className={`absolute right-6 top-[-5px] h-3 w-3 rotate-45 border-l border-t ${cuePointerClasses}`} />
          </div>
        ) : null}
        <button
          type="button"
          onClick={gotoCreditsBilling}
          className={`inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg px-3 text-xs font-semibold leading-none transition-colors ${creditsButtonClass}`}
          aria-label={uiText("Open billing. Current balance {value0} credits", { value0: formattedCredits })}
        >
          <span className={creditsLabelClass}>{uiText("Credits remaining")}</span>
          <span>{formattedCredits}</span>
        </button>
      </div>
    );
  }
  let errorMessageDisplay = <span />;

  const showRegenerateSubtitles = () => {

    openAlertDialog(
      <RegenerateSubtitlesDialog
        t={t}
        onClose={closeAlertDialog}
        onRegenerate={(subtitleLanguage) => {
          requestRegenerateSubtitles(subtitleLanguage);
          closeAlertDialog();
        }}
      />
    );

  }


  const regenerateVideoSessionSubtitles = (selectedSubtitleLanguage = '') => {

    const headers = getHeaders();


    axios.post(`${PROCESSOR_SERVER}/video_sessions/request_regenerate_subtitles`, {
      sessionId: resolvedSessionId,
      ...buildSubtitleRegenerationLanguageFields({
        selectedLanguage: selectedSubtitleLanguage,
      }),
    }, headers).then(function () {


    });


  }

  let controlbarView: React.ReactNode = null;
  if (isAudioEditor) {
    const editorShortcutClass = `border border-line-strong bg-surface-raised text-fg-body ${colorMode === 'dark' ? 'hover:border-[#f6c453]/60 hover:bg-[#292d3a]' : 'hover:bg-slate-50'}`;
    controlbarView = (
      <div className="flex items-center gap-2">
        <button type="button" className={`hidden min-h-9 rounded-full px-3 text-xs font-semibold sm:inline-flex sm:items-center ${editorShortcutClass}`} onClick={openVideoEditor}>{uiText("Video Editor")}</button>
        <button type="button" className={`hidden min-h-9 rounded-full px-3 text-xs font-semibold md:inline-flex md:items-center ${editorShortcutClass}`} onClick={openImageEditor}>{uiText("Image Editor")}</button>
        <div className="inline-flex min-h-9 items-center rounded-full border border-[#f6c453]/60 bg-[#f6c453]/15 px-3 text-xs font-semibold text-[#f6c453]">{uiText("Audio Studio")}</div>
      </div>
    );
  } else if (!isWorkspaceLoading && (location.pathname.includes('/video/') || isImageEditor)) {
    controlbarView = (
      <Suspense fallback={<div aria-hidden="true" className="h-9" />}>
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
        isInteractiveVideo={isInteractiveVideo}
        publishedTitle={publishedTitle}
        publishedDescription={publishedDescription}
        publishedTags={publishedTags}
        publishVideoSession={publishVideoSession}
        unpublishVideoSession={unpublishVideoSession}
        renderCompletedThisSession={renderCompletedThisSession}
        editorVariant={isImageEditor ? 'imageStudio' : 'videoStudio'}
        openAdvancedVideoEditDialog={openAdvancedVideoEditDialog}
        openExpressPostProcessingDialog={openExpressPostProcessingDialog}
        isReadOnlyMode={Boolean(isReadOnlyShareView)}
        isImportedSession={Boolean(isImportedSession)}
        onRequestEditSession={onRequestEditSession}
        onCreateShareUrl={openShareOptionsDialog}
      />
      </Suspense>
    );
  } else if (isGenerationsView) {
    const galleryShortcutActive = `border border-line-control bg-surface-raised text-fg-body hover:bg-surface-hover ${colorMode === 'dark' ? 'hover:border-[#f6c453]/60' : 'hover:border-slate-300'}`;
    const galleryShortcutGroup = colorMode === 'dark'
      ? 'rounded-full bg-black/10 px-1.5 py-1.5 shadow-[0_12px_24px_rgba(0,0,0,0.22)]'
      : 'rounded-full bg-white/80 px-1.5 py-1.5 backdrop-blur';
    controlbarView = (
      <div className={`flex flex-wrap items-center justify-center gap-2 ${galleryShortcutGroup}`}>
        <button
          type="button"
          className={`inline-flex min-h-10 items-center justify-center rounded-full px-3 py-1.5 text-xs font-semibold transition lg:min-h-[38px] lg:px-4 lg:py-2 lg:text-sm ${galleryShortcutActive}`}
          onClick={openVideoEditor}
        >{uiText("Video Editor")}</button>
        <button
          type="button"
          className={`inline-flex min-h-10 items-center justify-center rounded-full px-3 py-1.5 text-xs font-semibold transition lg:min-h-[38px] lg:px-4 lg:py-2 lg:text-sm ${galleryShortcutActive}`}
          onClick={openImageEditor}
        >{uiText("Image Editor")}</button>
        <button
          type="button"
          className={`inline-flex min-h-10 items-center justify-center rounded-full px-3 py-1.5 text-xs font-semibold transition lg:min-h-[38px] lg:px-4 lg:py-2 lg:text-sm ${galleryShortcutActive}`}
          onClick={openAudioEditor}
        >{uiText("Audio Studio")}</button>
        <button
          type="button"
          className={`inline-flex min-h-10 items-center justify-center rounded-full px-3 py-1.5 text-xs font-semibold transition lg:min-h-[38px] lg:px-4 lg:py-2 lg:text-sm ${galleryShortcutActive}`}
          onClick={openStudioWorkspace}
        >{uiText("VidGenie")}</button>
      </div>
    );
  } else if (location.pathname.includes('/vidgenie/')) {
    controlbarView = <div />;
  }


  if (isGenerationsView) {
    return (
      <div data-app-top-nav className={`${navShell} fixed top-0 inset-x-0 z-[1200] h-[76px]`}>
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
    <div data-app-top-nav className={`${navShell} fixed top-0 inset-x-0 z-[1200] h-[56px]`}>
      <div className={`grid h-full w-full items-center gap-2 px-2 pr-3 ${isStudioEditor && isExpressGeneration ? "grid-cols-[minmax(80px,10%)_minmax(0,1fr)_auto] lg:gap-2 lg:pr-3" : "grid-cols-[minmax(132px,14%)_minmax(0,1fr)_auto] lg:gap-5 lg:pr-8"}`}>
        <div className="flex h-full items-center justify-center px-2">
          <BrandLogo onClick={gotoHome} className="w-full max-w-[220px] px-2 lg:max-w-[260px] lg:px-4" />
        </div>
        <div className="flex min-w-0 items-center justify-center h-full py-[2px] lg:justify-end lg:pr-1">
          <div className="flex h-full w-full min-w-0 items-center justify-center lg:justify-end">
            {controlbarView}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center justify-end gap-2 text-xs sm:text-sm lg:gap-3">
          {errorMessageDisplay}
          <div className="flex items-center">
            {addSessionButton}
          </div>
          <div className={isStudioEditor && isExpressGeneration ? "hidden items-center justify-end 2xl:flex" : "hidden items-center justify-end xl:flex"}>
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
