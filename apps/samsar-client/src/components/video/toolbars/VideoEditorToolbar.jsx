// VideoEditorToolbar.js
import { useContext, useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import PromptGenerator from './PromptGenerator.jsx';
import ImageEditGenerator from '../toolbars/ImageEditGenerator.jsx';

import AddText from './text_toolbar/AddText.tsx';
import {
  FaChevronDown,
  FaChevronLeft,
  FaChevronRight,
  FaChevronCircleRight,
  FaTimes,
} from 'react-icons/fa';
import AddShapeDisplay from '../../editor/utils/AddShapeDisplay.tsx';
import { useColorMode } from '../../../contexts/ColorMode.jsx';
import LayersDisplay from '../../editor/toolbar/LayersDisplay.tsx';
import Select from 'react-select';
import {
  CURRENT_TOOLBAR_VIEW,
  TOOLBAR_ACTION_VIEW,


  MUSIC_PROVIDERS,
  TTS_COMBINED_SPEAKER_TYPES
} from '../../../constants/Types.ts';
import SecondaryButton from '../../common/SecondaryButton.tsx';
import SoundSelectToolbar from './audio/SoundSelectToolbar.jsx';
import LayerSpeechPreview from './audio/LayerSpeechPreview.jsx';
import MovieSpeechProviderSelect from './audio/MovieSpeechProviderSelect.jsx';
import RecordSpeechSection from './audio/RecordSpeechSection.jsx';

import { toast } from 'react-toastify';
import './editorToolbar.css';
import 'react-toastify/dist/ReactToastify.css';
import { AiOutlineSound } from "react-icons/ai";
import { PiSelectionAll } from "react-icons/pi";
import { MdOutlineRectangle } from "react-icons/md";
import { FaPencilAlt, FaEraser, FaCrosshairs, FaUpload } from 'react-icons/fa';
import { FaRegCircle } from "react-icons/fa";
import { FaMusic } from 'react-icons/fa6';
import { RiSpeakLine } from "react-icons/ri";
import MusicSelectToolbar from './audio/MusicSelectToolbar.jsx';
import SpeechSelectToolbar from './audio/SpeechSelectToolbar.jsx';
import { LuCombine } from "react-icons/lu";
import { TbLibraryPhoto } from "react-icons/tb";
import TextareaAutosize from 'react-textarea-autosize';
import PromptViewer from './PromptViewer.jsx';
import VideoEditorDefaultsViewer from './VideoEditorDefaultsViewer.jsx';
import VideoPromptGenerator from './VideoPromptGenerator.jsx';
import SingleSelect from '../../common/SingleSelect.jsx';

import { useAlertDialog } from '../../../contexts/AlertDialogContext.jsx';
import VideoLipSyncOptionsViewer from './ai_video/VideoLipSyncOptionsViewer.jsx';
import VideoAiVideoOptionsViewer from './ai_video/VideoAiVideoOptionsViewer.jsx';
import { NavCanvasControlContext } from '../../../contexts/NavCanvasControlContext.jsx';
import {
  fetchGoogleTTSPreviewBlobUrl,
  getGoogleTTSVoiceDetails,
} from '../../../hooks/useGoogleTTSSpeakers.js';
import { useAudioProviderAvailability } from '../../../hooks/useAudioProviderAvailability.js';
import { filterMusicProvidersForAudioAvailability } from '../../../constants/audioProviderAvailability.js';

const SOUND_EFFECT_MODEL_OPTIONS = [
  { value: 'SDAUDIO', label: 'Stable Audio' },
  { value: 'CUSTOM_TEXT_TO_SOUND_EFFECT', label: 'Custom Sound Effect' },
];

function resolveSpeakerProvider(speaker = {}) {
  const explicitProvider =
    typeof speaker?.provider === 'string'
      ? speaker.provider.trim().toUpperCase()
      : '';

  if (
    explicitProvider === 'OPENAI' ||
    explicitProvider === 'ELEVENLABS' ||
    explicitProvider === 'PLAYAI' ||
    explicitProvider === 'GOOGLE' ||
    explicitProvider === 'CUSTOM_TEXT_TO_SPEECH'
  ) {
    return explicitProvider;
  }

  const speakerValue = typeof speaker?.speaker === 'string' ? speaker.speaker.trim() : '';
  const matchedSpeaker = TTS_COMBINED_SPEAKER_TYPES.find((item) => item.value === speakerValue);
  return matchedSpeaker?.provider || 'OPENAI';
}

function buildMovieSpeakerOption(speaker = {}) {
  const speakerValue = typeof speaker?.speaker === 'string' ? speaker.speaker.trim() : '';
  const speakerLabel =
    typeof speaker?.speakerCharacterName === 'string' && speaker.speakerCharacterName.trim()
      ? speaker.speakerCharacterName.trim()
      : typeof speaker?.actor === 'string' && speaker.actor.trim()
        ? speaker.actor.trim()
        : speakerValue;

  return {
    value: speakerValue,
    label: speakerLabel,
    provider: resolveSpeakerProvider(speaker),
    speaker: speakerValue,
    speakerCharacterName: speakerLabel,
    languageCode: speaker.languageCode,
    languageCodes: speaker.languageCodes,
    speakerVoiceId: speaker.speakerVoiceId || speaker.voiceId || speakerValue,
    speakerLabel: speaker.speakerLabel || speaker.label || speaker.name || speakerValue,
    speakerDetails: speaker.speakerDetails || null,
  };
}

function resolveSessionSubtitlesEnabled(sessionDetails = {}) {
  if (sessionDetails?.enableSubtitles === false) {
    return false;
  }

  if (typeof sessionDetails?.hasSubtitles === 'boolean') {
    return sessionDetails.hasSubtitles;
  }

  if (typeof sessionDetails?.has_subtitles === 'boolean') {
    return sessionDetails.has_subtitles;
  }

  if (typeof sessionDetails?.enableSubtitles === 'boolean') {
    return sessionDetails.enableSubtitles;
  }

  return true;
}

export default function VideoEditorToolbar(props) {
  const {
    sessionDetails,
    addTextBoxToCanvas,
    editBrushWidth,
    setEditBrushWidth,
    setCurrentViewDisplay,
    currentViewDisplay,
    onToolbarViewChange,
    textConfig,
    setTextConfig,
    activeItemList,
    setActiveItemList,
    setSelectedShape,
    fillColor,
    setFillColor,
    strokeColor,
    setStrokeColor,
    strokeWidthValue,
    setStrokeWidthValue,
    selectedId,
    exportAnimationFrames,
    setSelectedId,
    pencilWidth,
    setPencilWidth,
    pencilColor,
    setPencilColor,
    eraserWidth,
    setEraserWidth,
    showUploadAction,
    currentCanvasAction,
    setCurrentCanvasAction,
    setSelectedLayerSelectShape,
    updateSessionLayerActiveItemList,
    submitGenerateMusicRequest,
    audioLayers,
    audioGenerationPending,
    submitAddTrackToProject,
    combineCurrentLayerItems,
    submitUpdateSessionDefaults,
    isUpdateDefaultsPending,
    hideItemInLayer,
    updateSessionLayerActiveItemListAnimations,
    applyAnimationToAllLayers,
    submitGenerateLayeredSpeechRequest,
    currentDefaultPrompt,
    submitGenerateRecreateRequest,
    showCreateNewPrompt,
    showCreateNewPromptDisplay,
    aspectRatio,
    onToggleDisplay,
    showToggleCollapseToolbar,
    setAdvancedSessionTheme,
    submitAddBatchTrackToProject,
    currentLayer,
    requestAddAudioLayerFromLibrary,
    requestAddGlobalAudioLayerFromLibrary,
    currentLayerSeek,
    setCurrentLayerSeek,
    isVideoPreviewPlaying,
    setIsVideoPreviewPlaying,
    onRecordSpeechRecordingChange,
    setVideoSessionDetails,
    onSetAvatarHints,
    movieSoundList,
    movieGenSpeakers,
    updateMovieGenSpeakers,
    isRenderPending,
    onExpandedChange,
  } = props;
  const {
    showCanvasNavigationGrid,
    setShowCanvasNavigationGrid,
    snapEraserToGrid,
    setSnapEraserToGrid,
  } = useContext(NavCanvasControlContext);

  const toggleEraserGridSnap = () => {
    const nextValue = !snapEraserToGrid;
    setSnapEraserToGrid(nextValue);
    if (nextValue) {
      setShowCanvasNavigationGrid(true);
    }
  };

  const { openAlertDialog, closeAlertDialog } = useAlertDialog();

  const [selectedAnimationOption, setSelectedAnimationOption] = useState(null);
  const [addText, setAddText] = useState('');
  const [animateAllLayersSelected, setAnimateAllLayersSelected] = useState(false);

  const addSubtitles = resolveSessionSubtitlesEnabled(sessionDetails);

  const COLLAPSED_EDITOR_TOOLBAR_WIDTH = 'clamp(148px, 11vw, 168px)';
  const EXPANDED_EDITOR_TOOLBAR_WIDTH = 'min(48vw, 720px)';
  const [currentlyPlayingSpeaker, setCurrentlyPlayingSpeaker] = useState(null);
  const [isExpandedView, setIsExpandedView] = useState(false);
  const [containerWidth, setContainerWidth] = useState(COLLAPSED_EDITOR_TOOLBAR_WIDTH);
  const audioSampleRef = useRef(null);
  const audioSampleObjectUrlRef = useRef(null);
  const [numberOfSpeechLayersRequested, setNumberOfSpeechLayersRequested] = useState(0);
  const [selectedMusicProvider, setSelectedMusicProvider] = useState(MUSIC_PROVIDERS[0]);
  const [selectedSoundEffectModel, setSelectedSoundEffectModel] = useState(SOUND_EFFECT_MODEL_OPTIONS[0]);
  const [isInstrumental, setIsInstrumental] = useState(false);
  const [musicLyrics, setMusicLyrics] = useState('');

  // Duration state for AUDIOCRAFT
  const [musicDuration, setMusicDuration] = useState(10);

  const [ttsProvider, setTtsProvider] = useState({ value: 'OPENAI', label: 'OpenAI' });


  const [speakerType, setSpeakerType] = useState(null);
  const { audioAvailability } = useAudioProviderAvailability();
  const availableMusicProviders = useMemo(
    () => filterMusicProvidersForAudioAvailability(MUSIC_PROVIDERS, audioAvailability),
    [audioAvailability]
  );
  const isCollapsedSidebarView = !isExpandedView;
  const sidebarSizeVariant = isExpandedView ? 'sidebarExpanded' : 'sidebarCollapsed';
  const shouldStackMusicProviderFields = isCollapsedSidebarView;
  const musicProviderRowClass = shouldStackMusicProviderFields
    ? "mb-3 flex flex-col gap-3"
    : "mb-3 grid grid-cols-[minmax(0,1fr)_140px] items-end gap-3";
  const musicDurationFieldClass = shouldStackMusicProviderFields
    ? "w-full"
    : "w-[136px] shrink-0";
  const musicFooterRowClass = isCollapsedSidebarView
    ? "mt-3 flex flex-col gap-3"
    : "mt-3 flex items-center justify-between gap-3";
  const musicGenerateButtonWrapClass = isCollapsedSidebarView
    ? "w-full"
    : "w-auto shrink-0";

  useEffect(() => {

    if (movieGenSpeakers && movieGenSpeakers.length > 0) {
      const storedSpeakerName = localStorage.getItem('defaultSpeaker');

      const storedSpeaker = movieGenSpeakers.find(speaker => speaker.speakerCharacterName === storedSpeakerName);

      if (storedSpeaker) {
        setSpeakerType(buildMovieSpeakerOption(storedSpeaker));
      }
      else {
        setSpeakerType(buildMovieSpeakerOption(movieGenSpeakers[0]));
      }

    }
  }, [movieGenSpeakers]);

  useEffect(() => {
    if (speakerType) {
      localStorage.setItem('defaultSpeaker', speakerType.label);
    }
  }, [speakerType]);

  useEffect(() => {
    if (onExpandedChange) {
      onExpandedChange(isExpandedView);
    }
  }, [isExpandedView, onExpandedChange]);

  const { colorMode } = useColorMode();
  const disabledShellClass = isRenderPending ? 'pending-disabled-shell' : '';
  const defaultMusicProvider = availableMusicProviders[0] || null;
  const currentMusicProvider =
    selectedMusicProvider && availableMusicProviders.some((provider) => provider.key === selectedMusicProvider.key)
      ? selectedMusicProvider
      : defaultMusicProvider;
  const musicDurationMin = currentMusicProvider?.minDurationSeconds || 1;
  const musicDurationMax = currentMusicProvider?.maxDurationSeconds || 180;
  const supportsMusicLyrics = currentMusicProvider?.supportsLyrics === true;
  const musicProviderLocksInstrumental = currentMusicProvider?.locksInstrumental === true;

  const handleMusicProviderChange = (selectedOption) => {
    const selectedProvider = availableMusicProviders.find(provider => provider.key === selectedOption.value) || defaultMusicProvider;
    if (!selectedProvider) {
      return;
    }
    setSelectedMusicProvider(selectedProvider);

    if (selectedProvider.locksInstrumental) {
      setIsInstrumental(true);
    } else if (selectedMusicProvider?.locksInstrumental) {
      setIsInstrumental(false);
    }
  };

  useEffect(() => {
    if (!defaultMusicProvider) {
      setSelectedMusicProvider(null);
      return;
    }

    if (!selectedMusicProvider || !availableMusicProviders.some((provider) => provider.key === selectedMusicProvider.key)) {
      setSelectedMusicProvider(defaultMusicProvider);
    }
  }, [availableMusicProviders, defaultMusicProvider, selectedMusicProvider]);

  const handleTtsProviderChange = (selectedOption) => {
    setTtsProvider(selectedOption);
    setSpeakerType(null);
  };

  const handleSpeakerChange = (selectedOption) => {
    setSpeakerType(selectedOption);

    //const selectedSpeakerName = selectedOption.label;
    // localStorage.setItem('defaultSpeaker', selectedSpeakerName);

    if (audioSampleRef.current) {
      audioSampleRef.current.pause();
      audioSampleRef.current = null;
    }
    if (audioSampleObjectUrlRef.current) {
      URL.revokeObjectURL(audioSampleObjectUrlRef.current);
      audioSampleObjectUrlRef.current = null;
    }
    setCurrentlyPlayingSpeaker(null);
  };

  const getStudioSpeechPlacementPayload = () => {
    const currentLayerStartTime = Number(currentLayer?.durationOffset ?? currentLayer?.startTime ?? 0);

    return {
      startTime: Number.isFinite(currentLayerStartTime) && currentLayerStartTime >= 0
        ? currentLayerStartTime
        : 0,
      audioBindingMode: 'unbounded',
      bindToLayer: false,
      studioSpeechGeneration: true,
    };
  };

  const handleAddAllSpeechLayers = () => {
    const speechAudioLayers = audioLayers.slice(-numberOfSpeechLayersRequested);

    const batchPayload = speechAudioLayers.map((layer) => {
      return {
        startTime: layer.startTime || 0,
        duration: layer.duration || 5,
        endTime: (layer.startTime || 0) + (layer.duration || 5),
        volume: layer.volume || 100,
        addSubtitles: addSubtitles,
        selectedSubtitleOption: 'SUBTITLE_WORD',
        audioLayerId: layer._id.toString(),
        audioBindingMode: 'unbounded',
        bindToLayer: false,
        studioSpeechGeneration: true,
      };
    });

    submitAddBatchTrackToProject(batchPayload);
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
  };

  const handleBackFromPreview = () => {
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_SPEECH_GENERATE_DISPLAY);
  };

  const stopSpeakerPreview = () => {
    if (audioSampleRef.current) {
      audioSampleRef.current.pause();
      audioSampleRef.current = null;
    }
    if (audioSampleObjectUrlRef.current) {
      URL.revokeObjectURL(audioSampleObjectUrlRef.current);
      audioSampleObjectUrlRef.current = null;
    }
    setCurrentlyPlayingSpeaker(null);
  };

  const playMusicPreviewForSpeaker = async (evt, speaker) => {
    evt.stopPropagation();
    if (
      currentlyPlayingSpeaker &&
      currentlyPlayingSpeaker.value === speaker.value &&
      currentlyPlayingSpeaker.provider === speaker.provider
    ) {
      stopSpeakerPreview();
    } else {
      stopSpeakerPreview();
      let speakerMusicLink = speaker.previewURL;
      if (speakerMusicLink) {
        try {
          if (speaker.previewRequiresAuth) {
            speakerMusicLink = await fetchGoogleTTSPreviewBlobUrl(speaker);
            audioSampleObjectUrlRef.current = speakerMusicLink;
          }
          const audio = new Audio(speakerMusicLink);
          await audio.play();
          audioSampleRef.current = audio;
          setCurrentlyPlayingSpeaker(speaker);

          audio.onended = () => {
            stopSpeakerPreview();
          };
        } catch  {
          if (audioSampleObjectUrlRef.current) {
            URL.revokeObjectURL(audioSampleObjectUrlRef.current);
            audioSampleObjectUrlRef.current = null;
          }
          setCurrentlyPlayingSpeaker(null);
          audioSampleRef.current = null;
        }
      }
    }
  };

  useEffect(() => {
    return () => {
      if (audioSampleRef.current) {
        audioSampleRef.current.pause();
        audioSampleRef.current = null;
      }
      if (audioSampleObjectUrlRef.current) {
        URL.revokeObjectURL(audioSampleObjectUrlRef.current);
        audioSampleObjectUrlRef.current = null;
      }
    };
  }, []);

  const submitAddText = (payloadOverride = null) => {
    const sourcePayload = payloadOverride || {
      text: addText,
      config: textConfig,
    };

    let textConfigCopy = { ...(sourcePayload?.config || {}) };
    if (textConfigCopy.fontSize) {
      textConfigCopy.fontSize = parseInt(textConfigCopy.fontSize, 10);
    }
    if (textConfigCopy.strokeWidth) {
      textConfigCopy.strokeWidth = parseInt(textConfigCopy.strokeWidth, 10);
    }
    textConfigCopy.textAlign = textConfigCopy.textAlign || 'center';
    const payload = {
      type: 'text',
      text: sourcePayload?.text || '',
      config: textConfigCopy
    };
    addTextBoxToCanvas(payload);
  };

  const handleAnimationChange = (selectedOption) => {
    setSelectedAnimationOption(selectedOption.value);
  };

  const submitApplyAnimationToLayer = (evt) => {
    evt.preventDefault();

    const formData = new FormData(evt.target);
    let formValues = Object.fromEntries(formData.entries());
    for (let key in formValues) {
      if (!isNaN(formValues[key])) {
        formValues[key] = parseFloat(formValues[key]);
      }
    }

    const animationType = formValues.type;
    delete formValues.type;

    if (selectedId && !animateAllLayersSelected) {
      const newActiveItemList = activeItemList.map(item => {
        if (item.id === selectedId) {
          let animations = item.animations || [];
          const existingAnimationIndex = animations.findIndex(animation => animation.type === animationType);
          if (existingAnimationIndex !== -1) {
            animations[existingAnimationIndex] = {
              type: animationType,
              params: formValues
            };
          } else {
            animations.push({
              type: animationType,
              params: formValues
            });
          }
          return {
            ...item,
            animations: animations
          };
        }
        return item;
      });

      setActiveItemList(newActiveItemList);
      updateSessionLayerActiveItemListAnimations(newActiveItemList);
      exportAnimationFrames(newActiveItemList);
    } else {
      applyAnimationToAllLayers(formValues, animationType);
    }
  };


  const getAnimationBoundariesDisplay = (selectedOption) => {
    const selectedItem = activeItemList.find(item => item.id === selectedId);

    if ((!selectedItem || activeItemList.length === 0) && !animateAllLayersSelected) {
      return;
    }

    let animationParams = selectedItem?.animations;

    if (selectedOption === 'fade') {
      let startFade = 100;
      let endFade = 100;
      if (animationParams && animationParams.length > 0) {
        let fadeAnimationParams = animationParams.find(animation => animation.type === 'fade');
        if (fadeAnimationParams) {
          startFade = fadeAnimationParams.params.startFade;
          endFade = fadeAnimationParams.params.endFade;
        }
      }
      return (
        <div className='mt-2'>
          <form onSubmit={submitApplyAnimationToLayer} key="fadeForm">
            <div className='grid grid-cols-2 gap-2 m-auto text-center'>
              <div>
                <input
                  type='text'
                  placeholder='Start Fade'
                  name="startFade"
                  defaultValue={startFade}
                  className='w-full'
                />
                <div>Start Fade</div>
              </div>
              <div>
                <input
                  type='text'
                  placeholder='End Fade'
                  name="endFade"
                  defaultValue={endFade}
                  className='w-full'
                />
                <div>End Fade</div>
                <input type="hidden" name="type" value="fade" />
              </div>
            </div>
            <div className='m-auto text-center'>
              <SecondaryButton type="submit">Apply</SecondaryButton>
            </div>
          </form>
        </div>
      );
    } else if (selectedOption === 'slide') {
      let startX = 0;
      let startY = 0;
      let endX = 0;
      let endY = 0;

      if (selectedItem) {
        startX = selectedItem.x;
        startY = selectedItem.y;
        endX = selectedItem.x;
        endY = selectedItem.y;
      }
      if (animationParams) {
        let slideAnimationParams = animationParams.find(animation => animation.type === 'slide');
        if (slideAnimationParams) {
          startX = slideAnimationParams.params.startX;
          startY = slideAnimationParams.params.startY;
          endX = slideAnimationParams.params.endX;
          endY = slideAnimationParams.params.endY;
        }
      }

      return (
        <div className='mt-2'>
          <form onSubmit={submitApplyAnimationToLayer} key="slideForm">
            <div className='grid grid-cols-2 gap-2 m-auto text-center'>
              <div>
                <input
                  type='text'
                  name="startX"
                  placeholder='Start X'
                  defaultValue={startX}
                  className='w-full'
                />
                <div>Start X</div>
              </div>
              <div>
                <input
                  type='text'
                  name="startY"
                  placeholder='Start Y'
                  defaultValue={startY}
                  className='w-full'
                />
                <div>Start Y</div>
              </div>
              <div>
                <input
                  type='text'
                  placeholder='End X'
                  name="endX"
                  defaultValue={endX}
                  className='w-full'
                />
                <div>End X</div>
              </div>
              <div>
                <input
                  type='text'
                  placeholder='End Y'
                  name='endY'
                  defaultValue={endY}
                  className='w-full'
                />
                <div>End Y</div>
              </div>
            </div>
            <input type="hidden" name="type" value="slide" />
            <div className='m-auto text-center'>
              <SecondaryButton type="submit">Apply</SecondaryButton>
            </div>
          </form>
        </div>
      );
    } else if (selectedOption === 'zoom') {
      let startScale = 100;
      let endScale = 100;
      if (animationParams) {
        let zoomAnimationParams = animationParams.find(animation => animation.type === 'zoom');
        if (zoomAnimationParams) {
          startScale = zoomAnimationParams.params.startScale;
          endScale = zoomAnimationParams.params.endScale;
        }
      }
      return (
        <div className='mt-2'>
          <form onSubmit={submitApplyAnimationToLayer} key="zoomForm">
            <div className='grid grid-cols-2 gap-2 m-auto text-center'>
              <div>
                <input
                  type='text'
                  placeholder='Start Scale'
                  name="startScale"
                  defaultValue={startScale}
                  className='w-full'
                />
                <div>Start Scale</div>
              </div>
              <div>
                <input
                  type='text'
                  placeholder='End Scale'
                  name="endScale"
                  defaultValue={endScale}
                  className='w-full'
                />
                <div>End Scale</div>
              </div>
            </div>
            <input type="hidden" name="type" value="zoom" />
            <div className='m-auto text-center'>
              <SecondaryButton type="submit">Apply</SecondaryButton>
            </div>
          </form>
        </div>
      );
    } else if (selectedOption === 'rotate') {
      let startRotate = 0;
      if (animationParams) {
        const rotateParams = animationParams.find(animation => animation.type === 'rotate');
        if (rotateParams) {
          startRotate = rotateParams.params.startRotate;
        }
      }
      return (
        <div className='mt-2'>
          <form onSubmit={submitApplyAnimationToLayer} key="rotateForm">
            <div className='grid grid-cols-2 gap-2 m-auto text-center'>
              <div>
                <input
                  type='text'
                  name="startRotate"
                  defaultValue={startRotate}
                  placeholder='Rotations / second'
                  className='w-full'
                />
                <div>Rotations/second</div>
              </div>
            </div>
            <input type="hidden" name="type" value="rotate" />
            <div className='m-auto text-center'>
              <SecondaryButton type="submit">Apply</SecondaryButton>
            </div>
          </form>
        </div>
      );
    }
  };

  let generateDisplay = <span />;
  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_DISPLAY) {
    if (currentDefaultPrompt && !showCreateNewPromptDisplay) {
      generateDisplay = (
        <PromptViewer
          {...props}
          showCreateNewPrompt={showCreateNewPrompt}
          submitGenerateRecreateRequest={submitGenerateRecreateRequest}
        />
      );
    } else {
      generateDisplay = <PromptGenerator {...props} sizeVariant={sidebarSizeVariant} />;
    }
  }

  let generateVideoDisplay = <span />;
  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_VIDEO_DISPLAY) {
    if (currentLayer.hasLipSyncVideoLayer) {
      generateVideoDisplay = <VideoLipSyncOptionsViewer {...props} sizeVariant={sidebarSizeVariant} />;
    } else if (
      currentLayer.userVideoGenerationPending
      || currentLayer?.userVideoUploadTask?.status === 'UPLOADING'
      || currentLayer?.userVideoUploadTask?.status === 'PROCESSING'
    ) {
      generateVideoDisplay = <VideoAiVideoOptionsViewer {...props} sizeVariant={sidebarSizeVariant} />;
    } else if (currentLayer.hasUserVideoLayer && currentLayer.userVideoGenerationStatus === "COMPLETED") {
      generateVideoDisplay = <VideoAiVideoOptionsViewer {...props} sizeVariant={sidebarSizeVariant} />;
    } else if (currentLayer.hasAiVideoLayer && currentLayer.aiVideoGenerationStatus === "COMPLETED") {
      generateVideoDisplay = <VideoAiVideoOptionsViewer {...props} sizeVariant={sidebarSizeVariant} />;
    } else {
      generateVideoDisplay = <VideoPromptGenerator {...props} sizeVariant={sidebarSizeVariant} />;
    }
  }

  let addTextDisplay = <span />;
  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_ADD_TEXT_DISPLAY) {
    addTextDisplay = (
      <AddText
        setAddText={setAddText}
        submitAddText={submitAddText}
        textConfig={textConfig}
        addText={addText}
        setTextConfig={setTextConfig}
        isExpandedView={isExpandedView}
      />
    );
  }

  let editDisplay = <span />;
  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_EDIT_DISPLAY) {
    editDisplay = (
      <div>
        <ImageEditGenerator
          {...props}
          editBrushWidth={editBrushWidth}
          setEditBrushWidth={setEditBrushWidth}
          sizeVariant={sidebarSizeVariant}
        />
      </div>
    );
  }

  let layersDisplay = <span />;
  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_LAYERS_DISPLAY) {
    layersDisplay = (
      <LayersDisplay
        activeItemList={activeItemList}
        setActiveItemList={setActiveItemList}
        updateSessionLayerActiveItemList={updateSessionLayerActiveItemList}
        hideItemInLayer={hideItemInLayer}
        selectedId={selectedId}
        setSelectedId={setSelectedId}
      />
    );
  }

  const toggleCurrentViewDisplay = (view) => {
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
    const nextView =
      view === currentViewDisplay
        ? CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY
        : view;
    setCurrentViewDisplay(nextView);
    if (onToolbarViewChange) {
      onToolbarViewChange(nextView);
    }
  };

  const submitGenerateSound = (evt) => {
    evt.preventDefault();
    const formData = new FormData(evt.target);
    const promptText = formData.get('promptText');
    const secondsTotal = parseInt(formData.get('secondsTotal'), 10);
    const soundEffectModel = formData.get('soundEffectModel') || selectedSoundEffectModel.value;

    if (isNaN(secondsTotal) || secondsTotal < 2 || secondsTotal > 40) {
      toast.error(
        <div>
          <FaTimes className="inline-flex mr-2" /> Please enter a duration between 2 and 40 seconds.
        </div>,
        {
          position: "bottom-center",
          className: "custom-toast",
        }
      );
      return;
    }

    const body = {
      prompt: promptText,
      generationType: 'sound',
      model: soundEffectModel,
      secondsTotal: secondsTotal,
    };
    submitGenerateMusicRequest(body);
  };

  const showLibraryAction = () => {
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_LIBRARY_DISPLAY);
  };

  let addShapeDisplay = <span />;
  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_ADD_SHAPE_DISPLAY) {
    addShapeDisplay = (
      <AddShapeDisplay
        setSelectedShape={setSelectedShape}
        setStrokeColor={setStrokeColor}
        setFillColor={setFillColor}
        fillColor={fillColor}
        strokeColor={strokeColor}
        strokeWidthValue={strokeWidthValue}
        setStrokeWidthValue={setStrokeWidthValue}
        isExpandedView={isExpandedView}
        aspectRatio={aspectRatio}
      />
    );
  }

  const panelSurface =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border border-[#1f2a3d] text-slate-100 shadow-[0_12px_30px_rgba(0,0,0,0.35)]'
      : 'bg-white border border-slate-200 text-slate-900';
  const inputSurface =
    colorMode === 'dark'
      ? 'bg-[#111a2f] border border-[#1f2a3d]'
      : 'bg-white border border-slate-200';
  const interactiveTile =
    colorMode === 'dark'
      ? 'bg-rose-500/10 border border-rose-400/30 text-rose-100'
      : 'bg-rose-50 border border-rose-200 text-rose-700';
  const buttonBgcolor =
    colorMode === 'dark'
      ? 'bg-[#131c33] border border-[#24314d] text-white'
      : 'bg-slate-100 border border-slate-200 text-slate-900';
  const textInnerColor = colorMode === 'dark' ? 'text-slate-100' : 'text-slate-900';
  const text2Color = colorMode === 'dark' ? 'text-slate-100' : 'text-neutral-900';
  const formSelectBgColor = colorMode === 'dark' ? '#0f1629' : '#f8fafc';
  const formSelectTextColor = colorMode === 'dark' ? '#e2e8f0' : '#0f172a';
  const formSelectSelectedTextColor = formSelectTextColor;
  const formSelectHoverColor = colorMode === 'dark' ? '#1b2438' : '#2563EB';
  const sliderAccent = colorMode === 'dark' ? '#f87171' : '#2563eb';
  const sliderTrack = colorMode === 'dark' ? '#1f2a3d' : '#e2e8f0';
  const compactFieldLabelClass = `block mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] ${text2Color}`;
  const compactInputClass = `w-full rounded-lg ${inputSurface} ${text2Color} px-3 py-2.5 text-sm leading-5 ${colorMode === 'dark' ? 'shadow-sm' : ''} transition-colors duration-200 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-400/20`;
  const compactNumericInputClass = `${compactInputClass} min-w-0 text-center text-base font-semibold tabular-nums`;
  const compactTextareaClass = `${compactInputClass} min-h-[96px]`;
  const compactActionGridClass = 'grid w-full gap-2';
  const compactActionGridStyle = {
    gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))',
  };
  const compactActionLabelClass = isExpandedView
    ? 'w-full whitespace-normal break-words text-center text-[11px] font-medium leading-tight tracking-tight'
    : 'w-full overflow-hidden text-ellipsis whitespace-nowrap text-center text-[11px] font-medium leading-tight tracking-tight';
  const compactActionTileClass = (isActive = false) =>
    [
      `flex ${isExpandedView ? 'min-h-[64px]' : 'min-h-[58px]'} w-full min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-2 py-2 text-center transition-all duration-200`,
      isActive ? interactiveTile : `${inputSurface} ${text2Color}`,
    ].join(' ');

  const renderToolbarActionTile = ({
    key,
    icon,
    label,
    onClick,
    isActive = false,
    ariaPressed,
  }) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={ariaPressed}
      className={compactActionTileClass(isActive)}
      title={label}
    >
      <span className="pointer-events-none text-xl" aria-hidden="true">
        {icon}
      </span>
      <span className={compactActionLabelClass}>{label}</span>
    </button>
  );

  let uploadDisplay = <span />;
  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_UPLOAD_DISPLAY) {
    uploadDisplay = (
      <div className={`${compactActionGridClass} mt-2`} style={compactActionGridStyle}>
        {renderToolbarActionTile({
          key: 'upload',
          icon: <FaUpload />,
          label: 'Upload',
          onClick: showUploadAction,
        })}
        {renderToolbarActionTile({
          key: 'library',
          icon: <TbLibraryPhoto />,
          label: 'Library',
          onClick: showLibraryAction,
        })}
      </div>
    );
  }

  const getSliderStyle = (value, min, max) => {
    const numValue = Number(value);
    const safeValue = Number.isFinite(numValue) ? Math.min(Math.max(numValue, min), max) : min;
    const percent = ((safeValue - min) / (max - min)) * 100;
    return {
      accentColor: sliderAccent,
      background: `linear-gradient(to right, ${sliderAccent} 0%, ${sliderAccent} ${percent}%, ${sliderTrack} ${percent}%, ${sliderTrack} 100%)`,
      height: '8px',
      borderRadius: '9999px',
      outline: 'none',
      transition: 'background 0.25s ease',
    };
  };

  let animateOptionsDisplay = <span />;
  const animationOptions = [
    { value: 'fade', label: 'Fade' },
    { value: 'slide', label: 'Slide' },
    { value: 'zoom', label: 'Zoom' },
    { value: 'rotate', label: 'Rotate' }
  ];

  const setAnimateAllLayersSelectedFunc = () => {
    setAnimateAllLayersSelected(true);
  };

  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_ANIMATE_DISPLAY) {
    if ((!selectedId || selectedId === -1) && !animateAllLayersSelected) {
      animateOptionsDisplay = (
        <div className={`${text2Color} pl-2`}>
          <div>
            <div className='block mb-4 text-xs mt-2'>
              <SecondaryButton onClick={setAnimateAllLayersSelectedFunc}>
                Animate all layers
              </SecondaryButton>
            </div>
            <div className='block mt-4'>
              Please select a layer to animate.
            </div>
          </div>
        </div>
      );
    } else {
      let animationOptionMeta = <span />;
      if (selectedAnimationOption) {
        animationOptionMeta = getAnimationBoundariesDisplay(selectedAnimationOption);
      }

      animateOptionsDisplay = (
        <div>
          Select animation
          <div>
            <Select
              options={animationOptions}
              onChange={handleAnimationChange}
              styles={{
                menu: (provided) => ({
                  ...provided,
                  backgroundColor: formSelectBgColor,
                }),
                singleValue: (provided) => ({
                  ...provided,
                  color: formSelectTextColor,
                }),
                control: (provided, state) => ({
                  ...provided,
                  backgroundColor: formSelectBgColor,
                  borderColor: state.isFocused ? '#007BFF' : '#ced4da',
                  '&:hover': {
                    borderColor: state.isFocused ? '#007BFF' : '#ced4da'
                  },
                  boxShadow: state.isFocused
                    ? '0 0 0 0.2rem rgba(0, 123, 255, 0.25)'
                    : null,
                  minHeight: '38px',
                  height: '38px'
                }),
                option: (provided, state) => ({
                  ...provided,
                  backgroundColor: formSelectBgColor,
                  color: state.isSelected ? formSelectSelectedTextColor : formSelectTextColor,
                  '&:hover': {
                    backgroundColor: formSelectHoverColor
                  }
                })
              }}
            />
          </div>
          <div key={`${selectedId}_form_input`}>
            {animationOptionMeta}
          </div>
        </div>
      );
    }
  }

  const submitGenerateMusic = (evt) => {
    evt.preventDefault();
    if (!currentMusicProvider) {
      toast.error('No music provider is configured for this deployment.', {
        position: 'bottom-center',
      });
      return;
    }

    const formData = new FormData(evt.target);
    const promptText = (formData.get('promptText') || '').toString().trim();
    const lyricsText = (formData.get('lyricsText') || '').toString().trim();
    const normalizedMusicDuration = Number(musicDuration);

    if (
      Number.isNaN(normalizedMusicDuration)
      || normalizedMusicDuration < musicDurationMin
      || normalizedMusicDuration > musicDurationMax
    ) {
      toast.error(
        <div>
          <FaTimes className="inline-flex mr-2" /> Duration must be between {musicDurationMin} and {musicDurationMax} seconds.
        </div>,
        {
          position: "bottom-center",
          className: "custom-toast",
        }
      );
      return;
    }

    const body = {
      prompt: promptText,
      generationType: 'music',
      isInstrumental: isInstrumental,
      model: currentMusicProvider.key,
      duration: normalizedMusicDuration,
    };

    if (currentMusicProvider.key === 'ELEVENLABS_MUSIC') {
      if (lyricsText) {
        body.lyrics = lyricsText;
      }

      body.generationMeta = {
        providerKey: currentMusicProvider.key,
        musicLengthMs: Math.round(normalizedMusicDuration * 1000),
        forceInstrumental: isInstrumental,
        outputFormat: 'mp3_44100_128',
      };

      if (lyricsText) {
        body.generationMeta.lyrics = lyricsText;
      }
    }

    submitGenerateMusicRequest(body);
  };

  const submitGenerateSpeech = (payload) => {
    const studioSpeechPlacementPayload = getStudioSpeechPlacementPayload();
    const speechPayload = {
      ...payload,
      ...studioSpeechPlacementPayload,
      aspectRatio,
    };
    const speechOptionValue = speechPayload.speechOptionValue;

    // "SPEECH_LAYER_LINES" means multiple lines => multiple speech layers
    if (speechOptionValue === 'SPEECH_LAYER_LINES') {
      const promptText = speechPayload.promptText;
      const speaker = speechPayload.speaker;
      const textAnimationOptions = speechPayload.textAnimationOptions;
      const subtitleOptionValue = speechPayload.subtitleOptionValue;
      const ttsProviderValue = speechPayload.ttsProviderValue || speechPayload.ttsProvider;

      const promptList = promptText
        .split('\n')
        .filter(prompt => prompt && prompt.trim().length > 0);


      let layeredSpeechBody = {
        generationType: 'speech',
        speaker: speaker,
        promptList: promptList,
        addSubtitles: addSubtitles,
        textAnimationOptions: textAnimationOptions,
        subtitleOption: subtitleOptionValue,
        ttsProvider: ttsProviderValue,
        languageCode: speechPayload.languageCode,
        languageCodes: speechPayload.languageCodes,
        speakerVoiceId: speechPayload.speakerVoiceId || speechPayload.voiceId || speaker,
        speakerLabel: speechPayload.speakerLabel || speechPayload.label || speaker,
        speakerDetails:
          ttsProviderValue === 'GOOGLE'
            ? (speechPayload.speakerDetails || getGoogleTTSVoiceDetails(speechPayload))
            : speechPayload.speakerDetails,
        aspectRatio: aspectRatio,
        audioBindingMode: studioSpeechPlacementPayload.audioBindingMode,
        bindToLayer: studioSpeechPlacementPayload.bindToLayer,
        studioSpeechGeneration: studioSpeechPlacementPayload.studioSpeechGeneration,
      };

      if (speechPayload.generationMeta) {
        layeredSpeechBody.generationMeta = speechPayload.generationMeta;
      }


      setNumberOfSpeechLayersRequested(promptList.length);
      submitGenerateLayeredSpeechRequest(layeredSpeechBody);
    } else {
      submitGenerateMusicRequest(speechPayload);
    }
  };

  let audioOptionsDisplay = <span />;
  let audioSubOptionsDisplay = <span />;

  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_AUDIO_DISPLAY) {
    const audioActionOptions = [
      {
        value: TOOLBAR_ACTION_VIEW.SHOW_SPEECH_GENERATE_DISPLAY,
        label: 'Speech',
        icon: <RiSpeakLine />,
      },
      {
        value: TOOLBAR_ACTION_VIEW.SHOW_MUSIC_GENERATE_DISPLAY,
        label: 'Music',
        icon: <FaMusic />,
      },
      {
        value: TOOLBAR_ACTION_VIEW.SHOW_SOUND_GENERATE_DISPLAY,
        label: 'Effects',
        icon: <AiOutlineSound />,
      },
    ];
    const selectedAudioActionOption =
      audioActionOptions.find((option) => option.value === currentCanvasAction) || null;
    const isAudioOptionSelected = (option) => currentCanvasAction === option;
    const handleAudioActionChange = (selectedOption) => {
      if (selectedOption?.value) {
        setCurrentCanvasAction(selectedOption.value);
      }
    };

    audioOptionsDisplay = isCollapsedSidebarView ? (
      <div className="mb-3">
        <label className={compactFieldLabelClass} htmlFor="audioGenerateType">
          Type
        </label>
        <SingleSelect
          name="audioGenerateType"
          placeholder="Select audio type..."
          options={audioActionOptions.map(({ value, label }) => ({ value, label }))}
          value={
            selectedAudioActionOption
              ? { value: selectedAudioActionOption.value, label: selectedAudioActionOption.label }
              : null
          }
          onChange={handleAudioActionChange}
          isSearchable={false}
          truncateLabels
        />
      </div>
    ) : (
      <div className={compactActionGridClass} style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        {audioActionOptions.map((option) => (
          renderToolbarActionTile({
            key: option.value,
            icon: option.icon,
            label: option.label,
            onClick: () => {
              setCurrentCanvasAction(option.value);
            },
            isActive: isAudioOptionSelected(option.value),
            ariaPressed: isAudioOptionSelected(option.value),
          })
        ))}
      </div>
    );

    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_MUSIC_GENERATE_DISPLAY) {
      audioSubOptionsDisplay = (
        <div className="transition-all duration-300 ease-in-out">
          <form name="audioGenerateForm" className="w-full" onSubmit={submitGenerateMusic}>

            <div className={musicProviderRowClass}>
              <div className="min-w-0 flex-1">
                <label className={compactFieldLabelClass} htmlFor="musicProvider">
                  Provider
                </label>
                <SingleSelect
                  name="musicProvider"
                  options={availableMusicProviders.map(provider => ({
                    value: provider.key,
                    label: provider.name
                  }))}
                  value={currentMusicProvider
                    ? {
                      value: currentMusicProvider.key,
                      label: currentMusicProvider.name
                    }
                    : null}
                  onChange={handleMusicProviderChange}
                  truncateLabels={isCollapsedSidebarView}
                />
              </div>
              <div className={musicDurationFieldClass}>
                <label className={compactFieldLabelClass} htmlFor="musicDuration">
                  Duration
                </label>
                <input
                  type="number"
                  id="musicDuration"
                  name="musicDuration"
                  min={musicDurationMin}
                  max={musicDurationMax}
                  step="1"
                  value={musicDuration}
                  onChange={(e) => setMusicDuration(e.target.value)}
                  className={compactNumericInputClass}
                />
                <div className={`mt-1 text-[11px] ${text2Color} opacity-70 text-center`}>
                  {musicDurationMin}-{musicDurationMax} sec
                </div>
              </div>
            </div>


            <TextareaAutosize
              name="promptText"
              placeholder="Add prompt text here"
              className={compactTextareaClass}
              minRows={3}
            />
            {supportsMusicLyrics && !isInstrumental && (
              <TextareaAutosize
                name="lyricsText"
                placeholder="Optional lyrics for the vocal track"
                value={musicLyrics}
                onChange={(e) => setMusicLyrics(e.target.value)}
                className={`${compactTextareaClass} mt-2`}
                minRows={3}
              />
            )}
            <div className={musicFooterRowClass}>
              <div className="flex items-center">
                <input
                  type="checkbox"
                  name="isInstrumental"
                  checked={isInstrumental}
                  onChange={(e) => setIsInstrumental(e.target.checked)}
                  disabled={musicProviderLocksInstrumental}
                />
                <div className={`inline-flex text-xs ${text2Color} ml-1`}>Instr</div>
              </div>
              <div className={musicGenerateButtonWrapClass}>
                <SecondaryButton
                  type="submit"
                  isPending={audioGenerationPending}
                  className="w-full px-4 py-2.5 text-sm"
                >
                  Generate
                </SecondaryButton>
              </div>
            </div>
          </form>
        </div>
      );
    }

    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_SPEECH_GENERATE_DISPLAY) {
      audioSubOptionsDisplay = (
        <div>
          <MovieSpeechProviderSelect
            movieSoundList={movieSoundList}
            movieGenSpeakers={movieGenSpeakers}
            updateMovieGenSpeakers={updateMovieGenSpeakers}
            submitGenerateSpeech={submitGenerateSpeech}
            ttsProvider={ttsProvider}
            handleTtsProviderChange={handleTtsProviderChange}
            speakerType={speakerType}
            handleSpeakerChange={handleSpeakerChange}
            playMusicPreviewForSpeaker={playMusicPreviewForSpeaker}
            currentlyPlayingSpeaker={currentlyPlayingSpeaker}
            audioGenerationPending={audioGenerationPending}
            bgColor={inputSurface}
            text2Color={text2Color}
            colorMode={colorMode}
            sizeVariant={sidebarSizeVariant}
          />
        </div>
      );
    }

    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PREVIEW_SOUND_DISPLAY) {
      if (audioLayers.length > 0) {
        const latestAudioLayer = audioLayers[audioLayers.length - 1];
        if (latestAudioLayer) {
          audioOptionsDisplay = (
            <SoundSelectToolbar
              audioLayer={latestAudioLayer}
              submitAddTrackToProject={submitAddTrackToProject}
              setCurrentCanvasAction={setCurrentCanvasAction}
            />
          );
        }
      }
      audioSubOptionsDisplay = <span />;
    }

    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PREVIEW_MUSIC_DISPLAY) {
      if (audioLayers.length > 0) {
        const latestAudioLayer = audioLayers[audioLayers.length - 1];
        audioOptionsDisplay = (
          <MusicSelectToolbar
            audioLayer={latestAudioLayer}
            sessionDetails={sessionDetails}
            submitAddTrackToProject={submitAddTrackToProject}
            setCurrentCanvasAction={setCurrentCanvasAction}
          />
        );
      }
      audioSubOptionsDisplay = <span />;
    }

    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PREVIEW_SPEECH_DISPLAY) {
      if (audioLayers.length > 0) {
        const latestAudioLayer = audioLayers[audioLayers.length - 1];
        if (latestAudioLayer) {
          audioOptionsDisplay = (
            <SpeechSelectToolbar
              audioLayer={latestAudioLayer}
              submitAddTrackToProject={submitAddTrackToProject}
              setCurrentCanvasAction={setCurrentCanvasAction}
              currentLayer={currentLayer}
              sessionDetails={sessionDetails}
            />
          );
        }
      }
      audioSubOptionsDisplay = <span />;
    }

    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PREVIEW_SPEECH_LAYERED_DISPLAY) {
      if (audioLayers && audioLayers.length > 0) {
        const lastNSpeechAudioLayers = audioLayers.slice(-numberOfSpeechLayersRequested);
        audioOptionsDisplay = (
          <LayerSpeechPreview
            audioLayers={lastNSpeechAudioLayers}
            onAddAll={handleAddAllSpeechLayers}
            onBack={handleBackFromPreview}
            submitAddTrackToProject={submitAddTrackToProject}
            colorMode={colorMode}
            sessionDetails={sessionDetails}
          />
        );
        audioSubOptionsDisplay = <span />;
      }
    }

    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_SOUND_GENERATE_DISPLAY) {
      audioSubOptionsDisplay = (
        <div className="transition-all duration-300 ease-in-out">
          <form name="audioGenerateForm" className="w-full" onSubmit={submitGenerateSound}>
            <div className="mb-2">
              <label className={`text-xs ${text2Color}`} htmlFor="soundEffectModel">
                Provider
              </label>
              <SingleSelect
                name="soundEffectModel"
                options={SOUND_EFFECT_MODEL_OPTIONS}
                value={selectedSoundEffectModel}
                onChange={(selectedOption) =>
                  setSelectedSoundEffectModel(selectedOption || SOUND_EFFECT_MODEL_OPTIONS[0])
                }
                isSearchable={false}
                truncateLabels={isCollapsedSidebarView}
              />
            </div>
            <div className="mb-2">
              <label className={`text-xs ${text2Color}`} htmlFor="secondsTotal">
                Duration (seconds):
              </label>
              <input
                type="number"
                name="secondsTotal"
                min="2"
                max="40"
                defaultValue="5"
                className={`w-full ${inputSurface} ${text2Color} rounded-md px-3 py-2 bg-transparent`}
              />
            </div>
            <TextareaAutosize
              name="promptText"
              placeholder="Add prompt text here"
              className={`w-full h-24 ${inputSurface} ${text2Color} rounded-md px-3 py-2 bg-transparent`}
              minRows={3}
            />
            <div className="flex flex-row">
              <div className="basis-full m-auto">
                <SecondaryButton type="submit" isPending={audioGenerationPending}>
                  Generate
                </SecondaryButton>
              </div>
            </div>
          </form>
        </div>
      );
    }
  }

  let actionsOptionsDisplay = <span />;
  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_ACTIONS_DISPLAY) {
    let actionsSubOptionsDisplay = <span />;
    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY) {
      actionsSubOptionsDisplay = (
        <div className={`mt-2 rounded ${colorMode === 'dark' ? 'shadow-lg' : ''}`}>
          <label className="block mb-2">Width:</label>
          <input
            type="range"
            min="1"
            max="50"
            className="w-full appearance-none rounded-full"
            value={pencilWidth}
            onChange={(e) => setPencilWidth(e.target.value)}
            style={getSliderStyle(Number(pencilWidth), 1, 50)}
          />
          <label className="block mt-2 mb-2">Color:</label>
          <input
            type="color"
            value={pencilColor}
            onChange={(e) => setPencilColor(e.target.value)}
          />
        </div>
      );
    } else if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY) {
      actionsSubOptionsDisplay = (
        <div className={`mt-2 rounded ${colorMode === 'dark' ? 'shadow-lg' : ''}`}>
          <label className="block mb-2">Width:</label>
          <input
            type="range"
            min="1"
            max="100"
            className="w-full appearance-none rounded-full"
            value={eraserWidth}
            onChange={(e) => setEraserWidth(e.target.value)}
            style={getSliderStyle(Number(eraserWidth), 1, 100)}
          />
          {showCanvasNavigationGrid && (
            <button
              type="button"
              onClick={toggleEraserGridSnap}
              className={`mt-3 w-full rounded-md border px-3 py-2 text-xs font-medium transition ${snapEraserToGrid ? interactiveTile : inputSurface} ${text2Color}`}
            >
              {snapEraserToGrid ? 'Snap Eraser: On' : 'Snap Eraser: Off'}
            </button>
          )}
        </div>
      );
    }
    actionsOptionsDisplay = (
      <div>
        <div className={compactActionGridClass} style={compactActionGridStyle}>
          {renderToolbarActionTile({
            key: 'pencil',
            icon: <FaPencilAlt />,
            label: 'Pencil',
            onClick: () => setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY),
            isActive: currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY,
            ariaPressed: currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY,
          })}
          {renderToolbarActionTile({
            key: 'eraser',
            icon: <FaEraser />,
            label: 'Eraser',
            onClick: () => setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY),
            isActive: currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY,
            ariaPressed: currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY,
          })}
          {renderToolbarActionTile({
            key: 'combine',
            icon: <LuCombine />,
            label: 'Combine',
            onClick: combineCurrentLayerItems,
          })}
        </div>
        {actionsSubOptionsDisplay}
      </div>
    );
  }

  let selectOptionsDisplay = <span />;
  let selectSubObjectionsDisplay = <span />;
  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_SELECT_DISPLAY) {
    selectOptionsDisplay = (
      <div className={compactActionGridClass} style={compactActionGridStyle}>
        {renderToolbarActionTile({
          key: 'select-layer',
          icon: <FaCrosshairs />,
          label: 'Select Layer',
          onClick: () => setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_SELECT_LAYER_DISPLAY),
          isActive: currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_SELECT_LAYER_DISPLAY,
          ariaPressed: currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_SELECT_LAYER_DISPLAY,
        })}
        {renderToolbarActionTile({
          key: 'select-shape',
          icon: <PiSelectionAll />,
          label: 'Select Shape',
          onClick: () => setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_SELECT_SHAPE_DISPLAY),
          isActive: currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_SELECT_SHAPE_DISPLAY,
          ariaPressed: currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_SELECT_SHAPE_DISPLAY,
        })}
      </div>
    );

    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_SELECT_SHAPE_DISPLAY) {
      selectSubObjectionsDisplay = (
        <div className="mt-2">
          <div
            className={`${compactActionGridClass} transition-all duration-300`}
            style={compactActionGridStyle}
          >
            {renderToolbarActionTile({
              key: 'select-rectangle',
              icon: <MdOutlineRectangle />,
              label: 'Rectangle',
              onClick: () => setSelectedLayerSelectShape('rectangle'),
            })}
            {renderToolbarActionTile({
              key: 'select-circle',
              icon: <FaRegCircle />,
              label: 'Circle',
              onClick: () => setSelectedLayerSelectShape('circle'),
            })}
          </div>
        </div>
      );
    }
  }

  let defaultsOptionDisplay = <span />;
  if (currentViewDisplay === CURRENT_TOOLBAR_VIEW.SHOW_SET_DEFAULTS_DISPLAY) {
    defaultsOptionDisplay = (
      <VideoEditorDefaultsViewer
        submitUpdateSessionDefaults={submitUpdateSessionDefaults}
        defaultSceneDuration={sessionDetails.defaultSceneDuration}
        basicTextTheme={sessionDetails.basicTextTheme}
        parentJsonTheme={sessionDetails.parentJsonTheme}
        derivedJsonTheme={sessionDetails.derivedJsonTheme}
        setAdvancedSessionTheme={setAdvancedSessionTheme}
        isUpdateDefaultsPending={isUpdateDefaultsPending}
        isExpandedView={isExpandedView}
      />
    );
  }

  const showExpandedDefaultsDialog = () => {
    openAlertDialog(
      <div className="mt-4 mb-4">
        <div>
          <FaTimes
            className="absolute top-2 right-2 cursor-pointer"
            onClick={closeAlertDialog}
          />
        </div>
        <VideoEditorDefaultsViewer
          submitUpdateSessionDefaults={submitUpdateSessionDefaults}
          defaultSceneDuration={sessionDetails.defaultSceneDuration}
          basicTextTheme={sessionDetails.basicTextTheme}
          parentJsonTheme={sessionDetails.parentJsonTheme}
          derivedJsonTheme={sessionDetails.derivedJsonTheme}
          isUpdateDefaultsPending={isUpdateDefaultsPending}
          setAdvancedSessionTheme={setAdvancedSessionTheme}
        />
      </div>
    );
  };

  const showExpandedGenImageDialog = () => {
    if (currentDefaultPrompt && !showCreateNewPromptDisplay) {
      openAlertDialog(
        <div className="mt-4 mb-4">
          <FaTimes
            className="absolute top-2 right-2 cursor-pointer"
            onClick={closeAlertDialog}
          />
          <PromptViewer
            {...props}
            showCreateNewPrompt={showCreateNewPrompt}
            submitGenerateRecreateRequest={submitGenerateRecreateRequest}
          />
        </div>
      );
    } else {
      openAlertDialog(
        <div className="mt-4 mb-4">
          <FaTimes
            className="absolute top-2 right-2 cursor-pointer"
            onClick={closeAlertDialog}
          />
          <PromptGenerator {...props} sizeVariant={sidebarSizeVariant} />
        </div>
      );
    }
  };

  const showExpandedGenVideoDialog = () => {
    openAlertDialog(
      <div className="mt-4 mb-4">
        <FaTimes
          className="absolute top-2 right-2 cursor-pointer"
          onClick={closeAlertDialog}
        />
        <VideoPromptGenerator {...props} sizeVariant={sidebarSizeVariant} />
      </div>
    );
  };

  const showExpandedGenAudioDialog = () => {
    openAlertDialog(
      <div>
        <FaTimes
          className="absolute top-2 right-2 cursor-pointer"
          onClick={closeAlertDialog}
        />
        <div className={textInnerColor}>
          {audioOptionsDisplay}
        </div>
        <div>
          {audioSubOptionsDisplay}
        </div>
      </div>
    );
  };

  let collapseButton = <span />;
  if (showToggleCollapseToolbar) {
    collapseButton = (
      <div className={`${text2Color} flex ml-2 cursor-pointer`} onClick={onToggleDisplay}>
        <div className="inline-flex">Collapse</div>
        <FaChevronCircleRight className='inline-flex mt-1 ml-2' />
      </div>
    );
  }

  const bgPillSelected = colorMode === 'dark' ? 'bg-rose-500/25 border border-rose-400/30' : 'bg-rose-100 border border-rose-200';
  const bgPillUnselected = colorMode === 'dark' ? 'bg-[#111a2f] border border-[#1f2a3d]' : 'bg-gray-200 border border-transparent';
  const textPillSelected = colorMode === 'dark' ? 'text-rose-100' : 'text-rose-700';
  const textPillUnselected = colorMode === 'dark' ? 'text-slate-200' : 'text-gray-600';

  const recordingFacecamDisplay = (
    <div className={textInnerColor}>
      <RecordSpeechSection
        bgColor={inputSurface}
        text2Color={text2Color}
        colorMode={colorMode}
        currentLayer={currentLayer}
        sessionDetails={sessionDetails}
        requestAddAudioLayerFromLibrary={requestAddAudioLayerFromLibrary}
        requestAddGlobalAudioLayerFromLibrary={requestAddGlobalAudioLayerFromLibrary}
        currentLayerSeek={currentLayerSeek}
        setCurrentLayerSeek={setCurrentLayerSeek}
        isVideoPreviewPlaying={isVideoPreviewPlaying}
        setIsVideoPreviewPlaying={setIsVideoPreviewPlaying}
        onRecordSpeechRecordingChange={onRecordSpeechRecordingChange}
        onAvatarVoiceoverSessionChange={setVideoSessionDetails}
        onSetAvatarHints={onSetAvatarHints}
        isCollapsedSidebarView={isCollapsedSidebarView}
      />
    </div>
  );

  const isItemSelected = (view) => currentViewDisplay === view;
  const getMarginTop = (view) => (isItemSelected(view) ? 'mt-0' : 'mt-4');
  const getSelectedClass = (view) =>
    isItemSelected(view) ? `${bgPillSelected} ${textPillSelected}` : `${bgPillUnselected} ${textPillUnselected}`

  const layerToolbarList = [
    {
      label: 'Defaults',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_SET_DEFAULTS_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_SET_DEFAULTS_DISPLAY),
      onExpandClick: showExpandedDefaultsDialog,
      content: <div className={textInnerColor}>{defaultsOptionDisplay}</div>
    },
    {
      label: 'Generate Image',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_DISPLAY),
      onExpandClick: showExpandedGenImageDialog,
      content: generateDisplay
    },
    {
      label: 'Edit Image',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_EDIT_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_EDIT_DISPLAY),
      onExpandClick: null,
      content: editDisplay
    },
    {
      label: 'Generate Video',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_VIDEO_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_VIDEO_DISPLAY),
      onExpandClick: showExpandedGenVideoDialog,
      content: generateVideoDisplay
    },
    {
      label: 'Generate Audio',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_AUDIO_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_AUDIO_DISPLAY),
      onExpandClick: showExpandedGenAudioDialog,
      showOverflow: true,
      content: (
        <div className={textInnerColor}>
          {audioOptionsDisplay}
          {audioSubOptionsDisplay}
        </div>
      )
    },
    {
      label: 'Facecam & Voiceover',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_RECORDING_FACECAM_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_RECORDING_FACECAM_DISPLAY),
      onExpandClick: null,
      showOverflow: true,
      content: recordingFacecamDisplay
    },
    {
      label: 'Actions',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_ACTIONS_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_ACTIONS_DISPLAY),
      onExpandClick: null,
      content: actionsOptionsDisplay
    },
    {
      label: 'Select',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_SELECT_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_SELECT_DISPLAY),
      onExpandClick: null,
      content: (
        <div className={textInnerColor}>
          {selectOptionsDisplay}
          {selectSubObjectionsDisplay}
        </div>
      ),
      showOverflow: true,
    },
    {
      label: 'Animate',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_ANIMATE_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_ANIMATE_DISPLAY),
      onExpandClick: null,
      content: animateOptionsDisplay,
      showOverflow: true,
    },
    {
      label: 'Upload/Library',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_UPLOAD_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_UPLOAD_DISPLAY),
      onExpandClick: null,
      content: uploadDisplay
    },
    {
      label: 'Text',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_ADD_TEXT_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_ADD_TEXT_DISPLAY),
      onExpandClick: null,
      content: addTextDisplay
    },
    {
      label: 'Shape',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_ADD_SHAPE_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_ADD_SHAPE_DISPLAY),
      onExpandClick: null,
      content: addShapeDisplay
    },
    {
      label: 'Layers',
      icon: null,
      view: CURRENT_TOOLBAR_VIEW.SHOW_LAYERS_DISPLAY,
      onClick: () => toggleCurrentViewDisplay(CURRENT_TOOLBAR_VIEW.SHOW_LAYERS_DISPLAY),
      onExpandClick: null,
      content: layersDisplay
    }
  ];

  const showEditorExpandedView = () => {
    if (isExpandedView) {
      setContainerWidth(COLLAPSED_EDITOR_TOOLBAR_WIDTH);
    } else {
      setContainerWidth(EXPANDED_EDITOR_TOOLBAR_WIDTH);
    }
    setIsExpandedView(!isExpandedView);
  };

  const stickyHeaderPaddingClass = isExpandedView ? 'p-3' : 'p-2.5';
  const toolbarListTopMarginClass = isExpandedView ? 'mt-[56px]' : 'mt-4';
  const toolbarItemButtonClass = isExpandedView
    ? 'pt-1 pb-1 pl-2 pr-2 text-lg font-bold'
    : 'px-1.5 py-1.5 text-[13px] font-semibold';
  const toolbarItemIconClass = isExpandedView ? 'inline-flex ml-4' : 'inline-flex ml-1.5';
  const toolbarItemChevronClass = isExpandedView ? 'inline-flex mr-4 text-sm' : 'inline-flex mr-1.5 text-xs';
  const toolbarItemBodyClass = isExpandedView ? 'pt-1 pl-2 pr-2' : 'pt-1 px-1.5';
  const rightPanelZIndex = isExpandedView ? 1500 : 950;

  let expandButtonLabel = (
    <div className='relative w-full cursor-pointer pb-1 block'>
      <FaChevronLeft className='inline-block ml-1 mr-1 text-xs font-bold mt-[-2px]' />
      <div className='inline-block'>Expand</div>
    </div>
  );

  if (isExpandedView) {
    expandButtonLabel = (
      <div className='relative w-full cursor-pointer pb-1 block'>
        <FaChevronRight className='inline-block ml-1 mr-1 text-xs font-bold mt-[-2px]' />
        <div className='inline-block'>Collapse</div>
      </div>
    );
  }

  const toolbarPanel = (
    <div
      className={`${panelSurface} m-auto fixed top-[72px] bottom-4 right-4 overflow-y-auto pl-2 pr-2 toolbar-container ${disabledShellClass}`}
      aria-disabled={isRenderPending}
      style={{
        width: containerWidth,
        maxWidth: 'calc(100vw - 32px)',
        paddingBottom: 'calc(var(--assistant-sidebar-safe-bottom, 0px) + 1rem)',
        zIndex: rightPanelZIndex,
      }}
    >
      <div>
        <div
            className={`sticky top-0 z-10 rounded-xl transition-colors duration-200 ${stickyHeaderPaddingClass} ${colorMode === 'dark'
              ? 'bg-[#111a2f] border border-[#1f2a3d] shadow-[0_12px_32px_rgba(0,0,0,0.35)]'
            : 'bg-white/95 border border-slate-200'}`}
        >
          {collapseButton}
          <div
            onClick={showEditorExpandedView}
            className={`m-auto text-center ${isExpandedView ? 'text-sm' : 'text-[13px]'} font-medium ${colorMode === 'dark' ? 'text-slate-100' : 'text-slate-700'}`}
          >
            {expandButtonLabel}
          </div>
        </div>

        <div className={toolbarListTopMarginClass}>
          {layerToolbarList.map((item, index) => (
            <div key={index} className={`${getMarginTop(item.view)} transition-all duration-300`}>
              {(() => {
                const isSelected = isItemSelected(item.view);
                const toolbarItemBodyMarginClass = isSelected
                  ? index === layerToolbarList.length - 1
                    ? 'mb-4'
                    : 'mb-1'
                  : 'mb-0';
                const toolbarItemContainerSurfaceClass = isSelected
                  ? 'bg-transparent border border-transparent'
                  : buttonBgcolor;
                const toolbarItemBodyOverflowClass =
                  isSelected && item.showOverflow ? 'overflow-visible' : 'overflow-hidden';
                const toolbarItemBodyPointerClass = isSelected ? 'pointer-events-auto' : 'pointer-events-none';

                return (
              <div
                className={`${toolbarItemContainerSurfaceClass} rounded-sm text-left ${isSelected ? 'mt-1' : 'mt-4'
                  } transition-colors duration-300`}
              >
                <div
                  className={`${toolbarItemButtonClass} m-auto cursor-pointer flex justify-between items-center ${getSelectedClass(
                    item.view
                  )} rounded transition-colors duration-300`}
                  onClick={item.onClick}
                >
                  {item.icon && (
                    <div
                      className={toolbarItemIconClass}
                      onClick={(e) => {
                        e.stopPropagation();
                        item.onExpandClick && item.onExpandClick();
                      }}
                    >
                      {item.icon}
                    </div>
                  )}
                  <div className="flex-grow text-center">{item.label}</div>
                  <FaChevronDown className={toolbarItemChevronClass} />
                </div>
                <div
                  className={`${toolbarItemBodyMarginClass} ${toolbarItemBodyClass} ${toolbarItemBodyOverflowClass} ${toolbarItemBodyPointerClass} transition-all duration-500 ${isSelected ? 'h-auto opacity-100' : 'max-h-0 opacity-0'
                    }`}
                >
                  {item.content}
                </div>
              </div>
                );
              })()}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(toolbarPanel, document.body)
    : toolbarPanel;
}
