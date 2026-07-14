import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import Konva from 'konva';
import { useUser } from '../../contexts/UserContext.jsx';
import { useAlertDialog } from '../../contexts/AlertDialogContext.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { useLocalization } from '../../contexts/LocalizationContext.jsx';
import { getHeaders } from '../../utils/web.jsx';
import {
  CURRENT_TOOLBAR_VIEW,
  TOOLBAR_ACTION_VIEW,
  IMAGE_GENERAITON_MODEL_TYPES,
  IMAGE_EDIT_MODEL_TYPES
} from '../../constants/Types.ts';


import { STAGE_DIMENSIONS } from '../../constants/Image.jsx';
import ImageUploadDialog from '../image/ImageUploadDialog.jsx';
import VideoCanvasContainer from './editor/VideoCanvasContainer.jsx';
import VideoEditorToolbar from './toolbars/VideoEditorToolbar.jsx'
import LoadingImage from './util/LoadingImage.jsx';
import LoadingImageBase from './util/LoadingImageBase.jsx';
import { createLayerBoundImageItem } from './util/layerBoundImageItem.js';


import { getTextConfigForCanvas } from '../../constants/TextConfig.jsx';

import LibraryHome from '../library/LibraryHome.jsx';
import AuthContainer, { AUTH_DIALOG_OPTIONS } from '../auth/AuthContainer.jsx';
import { toast } from 'react-toastify';

import 'react-toastify/dist/ReactToastify.css';
import { FaCheck, FaTimes } from 'react-icons/fa';
import { getCanvasDimensionsForAspectRatio } from '../../utils/canvas.jsx';
import { drawCanvasTextItem } from '../../utils/canvasText.js';
import { captureAssistantStageImageData } from '../../utils/assistantFrameCapture.js';
import { getRenderableImageUrl } from '../../utils/image.jsx';
import { resolveStudioLayerVideo } from './util/studioVideoLayers.mjs';
import {
  buildSubtitleRegenerationLanguageFields,
  resolveSessionAudioLanguage,
} from '../../utils/subtitleRegenerationLanguage.mjs';



const DEFAULT_IMAGE_GENERATION_MODEL = IMAGE_GENERAITON_MODEL_TYPES[0].key;
const ACTIVE_IMAGE_GENERATION_MODEL_KEYS = new Set(
  IMAGE_GENERAITON_MODEL_TYPES.map((model) => model.key)
);

function getStoredImageGenerationModel() {
  const defaultModel = localStorage.getItem('defaultModel');
  return ACTIVE_IMAGE_GENERATION_MODEL_KEYS.has(defaultModel)
    ? defaultModel
    : DEFAULT_IMAGE_GENERATION_MODEL;
}

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;
const STATIC_CDN_URL = import.meta.env.VITE_STATIC_CDN_URL;
const VIDEO_TASK_POLL_INTERVAL_MS = 1500;
const USER_VIDEO_UPLOAD_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
const DISPLAY_FRAMES_PER_SECOND = 30;
const VIDEO_SCENE_PRELOAD_LOOKAHEAD = 2;

function isActiveUserVideoUploadTask(task) {
  return task?.status === 'UPLOADING' || task?.status === 'PROCESSING';
}

function getLayerId(layer) {
  return layer?._id?.toString?.() || layer?._id || null;
}

function getContentDispositionFileName(contentDisposition) {
  if (typeof contentDisposition !== 'string') {
    return null;
  }

  const fileNameMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
  if (!fileNameMatch?.[1]) {
    return null;
  }

  try {
    return decodeURIComponent(fileNameMatch[1]);
  } catch {
    return fileNameMatch[1];
  }
}

export default function VideoEditorContainer(props) {
  const {
    selectedLayerId,
    currentLayerSeek,
    setCurrentLayerSeek,
    currentLayer,
    updateSessionLayerActiveItemList,
    updateSessionLayerActiveItemListAnimations,
    activeItemList,
    setActiveItemList,
    isLayerSeeking,
    showAddAudioToProjectDialog,
    generationImages,
    updateCurrentActiveLayer,
    videoSessionDetails,
    setVideoSessionDetails,
    toggleHideItemInLayer,
    pollForLayersUpdate,
    setIsCanvasDirty,
    updateCurrentLayer,
    applyAnimationToAllLayers,
    setGenerationImages,
    isExpressGeneration,
    aspectRatio,
    displayZoomType,
    toggleStageZoom,
    stageZoomScale,
    zoomCanvasIn,
    zoomCanvasOut,
    resetCanvasZoom,
    canvasZoomPercent,
    canZoomInCanvas,
    canZoomOutCanvas,
    updateCurrentLayerInSessionList,
    updateCurrentLayerAndLayerList,
    totalDuration,
    isUpdateLayerPending,
    isVideoPreviewPlaying,
    isPreviewPlaybackActive = isVideoPreviewPlaying,
    setIsVideoPreviewPlaying,
    onRecordSpeechRecordingChange,
    isRenderPending,
    setAudioLayers,
    layers,
    onAssistantFrameCaptureChange,
    onSetAvatarHints,
  } = props;

  const [segmentationData, setSegmentationData] = useState([]);
  const [currentLayerDefaultPrompt, setCurrentLayerDefaultPrompt] = useState('');
  const disabledShellClass = isRenderPending ? 'pending-disabled-shell' : '';

  // 1) State to store the current AI video URL and type
  const [, setAiVideoLayer] = useState(null);
  const [aiVideoLayerType, setAiVideoLayerType] = useState(null);

  const [movieSoundList, setMovieSoundList] = useState([]);

  const [movieVisualList, setMovieVisualList] = useState([]);
  const [movieGenSpeakers, setMovieGenSpeakers] = useState([]);


  useEffect(() => {

    if (videoSessionDetails && videoSessionDetails.movieResourceList) {
      const { scenes, sounds } = videoSessionDetails.movieResourceList;
      setMovieSoundList(sounds);
      setMovieVisualList(scenes);


    }

    if (videoSessionDetails && videoSessionDetails.movieGenSpeakers) {
      setMovieGenSpeakers(videoSessionDetails.movieGenSpeakers);
    }
  }, [videoSessionDetails]);


  let { id } = useParams();
  if (!id) {
    id = props.id;
  }

  const showLoginDialog = () => {
    const loginComponent = <AuthContainer />;
    openAlertDialog(loginComponent, undefined, false, AUTH_DIALOG_OPTIONS);
  };

  const currentLayerRef = useRef(currentLayer);
  const layersRef = useRef(layers);
  const generationPollIntervalRef = useRef(null);
  const outpaintPollIntervalRef = useRef(null);
  const audioGenerationPollIntervalRef = useRef(null);
  const maskGenerationPollIntervalRef = useRef(null);
  const aiVideoGenerationPollIntervalRef = useRef(null);
  const layeredAudioGenerationPollIntervalRef = useRef(null);

  useEffect(() => {
    currentLayerRef.current = currentLayer;
  }, [currentLayer]);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);


  const [aiVideoPollType, setAiVideoPollType] = useState(null);

  const resolveLayerVideoState = useCallback((layer) => resolveStudioLayerVideo(
    layer,
    videoSessionDetails,
    {
      processorApiUrl: PROCESSOR_API_URL,
      staticCdnUrl: STATIC_CDN_URL,
    }
  ), [videoSessionDetails]);

  const layerHasPendingVideoTask = useCallback((layer) => {
    if (!layer) {
      return false;
    }

    return Boolean(
      layer.aiVideoGenerationPending
      || layer.lipSyncGenerationPending
      || layer.soundEffectGenerationPending
      || layer.userVideoGenerationPending
      || isActiveUserVideoUploadTask(layer.userVideoUploadTask)
    );
  }, []);

  const layerHasUploadedOrPendingUserVideo = useCallback((layer) => {
    if (!layer) {
      return false;
    }

    return Boolean(
      layer.userVideoGenerationPending
      || layer.hasUserVideoLayer
      || layer.userVideoLayer
      || layer.userVideoUploadTaskId
      || isActiveUserVideoUploadTask(layer.userVideoUploadTask)
    );
  }, []);

  const layerHasAnyVideoArtefact = useCallback((layer) => {
    const { url } = resolveLayerVideoState(layer);
    return Boolean(url) || layerHasPendingVideoTask(layer);
  }, [layerHasPendingVideoTask, resolveLayerVideoState]);

  const syncCurrentLayerUserVideoUploadTask = useCallback((task, extraLayerPatch = {}) => {
    const sessionLayers = Array.isArray(layersRef.current) ? layersRef.current : layers;
    if (!currentLayer?._id || !Array.isArray(sessionLayers)) {
      return;
    }

    const currentLayerId = currentLayer._id.toString();
    const updatedLayers = sessionLayers.map((layer) => {
      if (layer?._id?.toString?.() !== currentLayerId) {
        return layer;
      }

      return {
        ...layer,
        ...extraLayerPatch,
        userVideoUploadTask: task,
      };
    });
    const updatedLayerIndex = updatedLayers.findIndex(
      (layer) => layer?._id?.toString?.() === currentLayerId
    );

    if (updatedLayerIndex === -1) {
      return;
    }

    updateCurrentLayerAndLayerList(updatedLayers, updatedLayerIndex, { preserveCurrentLayer: true });
    setVideoSessionDetails((previousSessionDetails) => (
      previousSessionDetails
        ? {
          ...previousSessionDetails,
          layers: updatedLayers,
        }
        : previousSessionDetails
    ));
  }, [currentLayer, layers, setVideoSessionDetails, updateCurrentLayerAndLayerList]);

  // On each currentLayer change, figure out which AI video layer to use
  useEffect(() => {
    if (!currentLayer) {
      setAiVideoLayer(null);
      setAiVideoLayerType(null);
      setAiVideoPollType(null);
      setIsAIVideoGenerationPending(false);
      return;
    }

    const { url, type } = resolveLayerVideoState(currentLayer);
    setAiVideoLayer(url);
    setAiVideoLayerType(type || (isActiveUserVideoUploadTask(currentLayer?.userVideoUploadTask) ? 'user_video' : null));
    setIsAIVideoGenerationPending(layerHasPendingVideoTask(currentLayer));

    if (currentLayer.lipSyncGenerationPending) {
      setAiVideoPollType('lip_sync');
    } else if (currentLayer.soundEffectGenerationPending) {
      setAiVideoPollType('sound_effect');
    } else if (
      currentLayer.userVideoGenerationPending
      || currentLayer?.userVideoUploadTask?.status === 'PROCESSING'
    ) {
      setAiVideoPollType('user_video');
    } else if (currentLayer.aiVideoGenerationPending && currentLayer.layerAiVideoType === 'ai_video') {
      setAiVideoPollType('ai_video');
    } else {
      setAiVideoPollType(null);
    }
  }, [currentLayer, layerHasPendingVideoTask, resolveLayerVideoState]);

  const currentVideoLayerState = useMemo(() => {
    if (!currentLayer) {
      return { url: null, type: null };
    }

    const { url, type } = resolveLayerVideoState(currentLayer);
    return {
      url,
      type: type || (isActiveUserVideoUploadTask(currentLayer?.userVideoUploadTask) ? 'user_video' : null),
    };
  }, [currentLayer, resolveLayerVideoState]);

  const nextVideoLayerState = useMemo(() => {
    if (!currentLayer || !Array.isArray(layers)) {
      return { url: null, type: null };
    }

    const currentLayerId = currentLayer?._id?.toString?.() || currentLayer?._id || null;
    if (!currentLayerId) {
      return { url: null, type: null };
    }

    const currentLayerIndex = layers.findIndex((layer) => {
      const layerId = layer?._id?.toString?.() || layer?._id || null;
      return layerId && layerId.toString() === currentLayerId.toString();
    });

    if (currentLayerIndex < 0 || currentLayerIndex >= layers.length - 1) {
      return { url: null, type: null };
    }

    const preloadEndIndex = Math.min(
      layers.length,
      currentLayerIndex + VIDEO_SCENE_PRELOAD_LOOKAHEAD + 1
    );
    for (let index = currentLayerIndex + 1; index < preloadEndIndex; index += 1) {
      const nextVideoState = resolveLayerVideoState(layers[index]);
      if (nextVideoState.url) {
        return nextVideoState;
      }
    }

    return { url: null, type: null };
  }, [currentLayer, layers, resolveLayerVideoState]);


  useEffect(() => {
    if (!aiVideoPollType) {
      // No poll type means nothing to do
      return;
    }
    // If aiVideoPollType is set, then start polling

    startAIVideoLayerGenerationPoll();
  }, [aiVideoPollType]);

  useEffect(() => {
    if (currentLayer && currentLayer.segmentation) {
      setSegmentationData(currentLayer.segmentation);
    }

    if (currentLayer && currentLayer.imageSession && currentLayer.imageSession.generationStatus === 'PENDING') {
      pollForLayersUpdate();
    }
    let currentDefaultPrompt = '';
    if (currentLayer && currentLayer.prompt) {
      currentDefaultPrompt = currentLayer.prompt;
    }
    setCurrentLayerDefaultPrompt(currentDefaultPrompt);

    return () => {
      if (generationPollIntervalRef.current) clearInterval(generationPollIntervalRef.current);
      if (outpaintPollIntervalRef.current) clearInterval(outpaintPollIntervalRef.current);
      if (maskGenerationPollIntervalRef.current) clearInterval(maskGenerationPollIntervalRef.current);
      if (aiVideoGenerationPollIntervalRef.current) clearInterval(aiVideoGenerationPollIntervalRef.current);
      if (layeredAudioGenerationPollIntervalRef.current) clearInterval(layeredAudioGenerationPollIntervalRef.current);
    };
  }, [currentLayer]);

  const [promptText, setPromptText] = useState("");
  const [videoPromptText, setVideoPromptText] = useState("");

  const [selectedVideoGenerationModel, setSelectedVideoGenerationModel] = useState('RUNWAYML');
  const [selectedChain, setSelectedChain] = useState('');
  const [selectedAllocation, setSelectedAllocation] = useState(300);
  const [isTemplateSelectViewSelected, setIsTemplateSelectViewSelected] = useState(false);
  useState([]);
  const [editBrushWidth, setEditBrushWidth] = useState(25);
  const [editMasklines, setEditMaskLines] = useState([]);
  const [currentView, setCurrentView] = useState(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
  const [rightPanelView, setRightPanelView] = useState(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
  const [isRightPanelExpanded, setIsRightPanelExpanded] = useState(false);
  const [currentCanvasAction, setCurrentCanvasAction] = useState(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);

  const [selectedGenerationModel, setSelectedGenerationModel] = useState(getStoredImageGenerationModel);
  const [selectedEditModel, setSelectedEditModel] = useState(IMAGE_EDIT_MODEL_TYPES[0].key);

  const [isGenerationPending, setIsGenerationPending] = useState(false);
  const [isOutpaintPending, setIsOutpaintPending] = useState(false);
  const [isPublicationPending] = useState(false);
  useState(1);

  const { colorMode } = useColorMode();
  const initFillColor = colorMode === 'dark' ? '#f5f5f5' : '#030712';
  const [fillColor, setFillColor] = useState(initFillColor);
  const [strokeColor, setStrokeColor] = useState(initFillColor);
  const [strokeWidthValue, setStrokeWidthValue] = useState(2);
  const [buttonPositions, setButtonPositions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedLayerType, setSelectedLayerType] = useState(null);
  const [pencilWidth, setPencilWidth] = useState(10);
  const [pencilColor, setPencilColor] = useState('#000000');
  const [eraserWidth, setEraserWidth] = useState(30);
  const [eraserOptionsVisible] = useState(false);
  const [cursorSelectOptionVisible, setCursorSelectOptionVisible] = useState(false);
  const [generationError, setGenerationError] = useState(null);
  const [outpaintError, setOutpaintError] = useState(null);
  const [selectedLayerSelectShape, setSelectedLayerSelectShape] = useState(null);
  const [audioGenerationPending, setAudioGenerationPending] = useState(false);
  const [enableSegmentationMask, setEnableSegmentationMask] = useState(false);
  const [canvasActionLoading, setCanvasActionLoading] = useState(false);
  const [isAIVideoGenerationPending, setIsAIVideoGenerationPending] = useState(false);
  const [isSelectButtonDisabled, setIsSelectButtonDisabled] = useState(false);
  const [currentLayerHasSpeechLayer, setCurrentLayerHasSpeechLayer] = useState(false);
  const { openAlertDialog, closeAlertDialog, setIsAlertActionPending } = useAlertDialog();
  const { getUserAPI } = useUser();
  const { t } = useLocalization();

  const [showCreateNewPromptDisplay, setShowCreateNewPromptDisplay] = useState(false);
  const showCreateNewPrompt = () => {
    setShowCreateNewPromptDisplay(true);
  };

  const setCurrentViewDisplay = (view) => {
    setCurrentView(view);
  };

  useEffect(() => {
    setRightPanelView(currentView);
  }, [currentView]);




  // Text config
  const [textConfig, setTextConfig] = useState(null);
  useEffect(() => {
    if (aspectRatio) {
      const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
      const defaultDimensions = getTextConfigForCanvas(textConfig, canvasDimensions);
      setTextConfig(defaultDimensions);
    }
  }, [aspectRatio]);

  useEffect(() => {
    setIsAlertActionPending(isPublicationPending);
  }, [isPublicationPending]);

  const canvasRef = useRef(null);
  const maskGroupRef = useRef(null);

  const getAssistantFrameImageData = useCallback(async () => {
    const dataUrl = await captureAssistantStageImageData(canvasRef, {
      maxDimension: 1536,
    });

    if (!dataUrl) {
      return null;
    }

    return {
      dataUrl,
      mimeType: 'image/png',
    };
  }, []);

  useEffect(() => {
    if (typeof onAssistantFrameCaptureChange !== 'function') {
      return undefined;
    }

    onAssistantFrameCaptureChange(getAssistantFrameImageData);

    return () => {
      onAssistantFrameCaptureChange(null);
    };
  }, [getAssistantFrameImageData, onAssistantFrameCaptureChange]);

  useEffect(() => {
    if (aspectRatio) {
      const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
      const canvasMidX = canvasDimensions.width / 2;
      const canvasMidY = canvasDimensions.height / 2;
      setTextConfig((prev) =>
        prev ? { ...prev, x: canvasMidX, y: canvasMidY } : { x: canvasMidX, y: canvasMidY }
      );
    }
  }, [aspectRatio]);

  // Check if current layer has any speech within its time range
  useEffect(() => {
    if (currentLayer && videoSessionDetails) {
      const currentLayerStartTime = currentLayer.durationOffset;
      const currentLayerEndTime = currentLayer.durationOffset + currentLayer.duration;

      const audioLayers = Array.isArray(videoSessionDetails.audioLayers)
        ? videoSessionDetails.audioLayers
        : [];
      const audioSpeechLayerOverlaps = audioLayers.some((audioLayer) => {
        const audioLayerStartTime = audioLayer.startTime;
        const audioLayerEndTime = audioLayer.endTime;

        // Check if there's any overlap
        const ovelapAudio = (
          audioLayerStartTime < currentLayerEndTime &&
          audioLayerEndTime > currentLayerStartTime && audioLayer.generationType === 'speech'
        );

        return ovelapAudio;
      });

      setCurrentLayerHasSpeechLayer(audioSpeechLayerOverlaps);
    }
  }, [currentLayer, videoSessionDetails]);


  // Example showing usage for uploading images
  const createCurrentLayerImageItem = useCallback(
    (imagePayload) => createLayerBoundImageItem({ layer: currentLayer, ...imagePayload }),
    [currentLayer]
  );

  const setUploadURL = useCallback(
    (data) => {
      if (!data) return;
      const uploads = Array.isArray(data) ? data : [data];
      if (!uploads.length) return;

      const newItemList = [...activeItemList];
      let nextIndex = newItemList.length;
      uploads.forEach((entry) => {
        if (!entry?.url) return;
        const newItemId = `item_${nextIndex}`;
        nextIndex += 1;
        newItemList.push(createCurrentLayerImageItem({
          src: entry.url,
          id: newItemId,
          x: entry.x,
          y: entry.y,
          width: entry.width,
          height: entry.height,
          source: 'upload',
        }));
      });

      if (newItemList.length === activeItemList.length) {
        return;
      }

      setActiveItemList(newItemList);
      updateSessionLayerActiveItemList(newItemList);
      closeAlertDialog();
      toast.success(
        <div>
          <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.imageUploadSuccess")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
    },
    [activeItemList, createCurrentLayerImageItem, closeAlertDialog, t, updateSessionLayerActiveItemList]
  );

  const setUploadVideo = useCallback(
    async (file) => {
      if (!file || !currentLayer) {
        return;
      }
      if (layerHasAnyVideoArtefact(currentLayer)) {
        throw new Error('Remove the existing or pending video artefact before uploading a new video.');
      }

      const headers = getHeaders();
      if (!headers) {
        showLoginDialog();
        throw new Error('Unauthorized');
      }

      const requestUrl = `${PROCESSOR_API_URL}/video_sessions/upload_user_video_layer_chunk`;
      const resolvedFileName = file.name || 'uploaded_video.mp4';
      const uploadId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `upload_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      const totalChunks = Math.max(1, Math.ceil(file.size / USER_VIDEO_UPLOAD_CHUNK_SIZE_BYTES));

      setAiVideoPollType(null);
      setIsAIVideoGenerationPending(true);
      syncCurrentLayerUserVideoUploadTask({
        uploadId,
        status: 'UPLOADING',
        fileName: resolvedFileName,
        totalChunks,
        uploadedChunks: 0,
        totalFileSize: file.size,
        uploadedBytes: 0,
        progressPercent: 0,
        message: 'Uploading video to server.',
      }, {
        frameGenerationPending: true,
      });
      closeAlertDialog();

      try {
        let response = null;

        for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
          const chunkStart = chunkIndex * USER_VIDEO_UPLOAD_CHUNK_SIZE_BYTES;
          const chunkEnd = Math.min(file.size, chunkStart + USER_VIDEO_UPLOAD_CHUNK_SIZE_BYTES);
          const chunk = file.slice(chunkStart, chunkEnd);
          const chunkRequestUrl =
            `${requestUrl}` +
            `?sessionId=${encodeURIComponent(id)}` +
            `&layerId=${encodeURIComponent(currentLayer._id.toString())}` +
            `&uploadId=${encodeURIComponent(uploadId)}` +
            `&chunkIndex=${encodeURIComponent(chunkIndex)}` +
            `&totalChunks=${encodeURIComponent(totalChunks)}` +
            `&totalFileSize=${encodeURIComponent(file.size)}` +
            `&fileName=${encodeURIComponent(resolvedFileName)}`;

          syncCurrentLayerUserVideoUploadTask({
            uploadId,
            status: 'UPLOADING',
            fileName: resolvedFileName,
            totalChunks,
            uploadedChunks: chunkIndex,
            totalFileSize: file.size,
            uploadedBytes: chunkStart,
            progressPercent: file.size > 0 ? Math.round((chunkStart / file.size) * 100) : 0,
            message: 'Uploading video to server.',
          }, {
            frameGenerationPending: true,
          });

          const isLastChunk = chunkIndex === totalChunks - 1;
          const responsePromise = axios.post(chunkRequestUrl, chunk, {
            ...headers,
            headers: {
              ...headers.headers,
              'Content-Type': file.type || 'video/mp4',
            },
          });

          response = await responsePromise;
          const responseTask = response?.data?.task;
          if (responseTask) {
            syncCurrentLayerUserVideoUploadTask(responseTask, {
              frameGenerationPending: true,
              userVideoGenerationPending: responseTask.status === 'PROCESSING',
            });
          } else {
            syncCurrentLayerUserVideoUploadTask({
              uploadId,
              status: 'UPLOADING',
              fileName: resolvedFileName,
              totalChunks,
              uploadedChunks: chunkIndex + 1,
              totalFileSize: file.size,
              uploadedBytes: chunkEnd,
              progressPercent: file.size > 0 ? Math.round((chunkEnd / file.size) * 100) : 0,
              message: isLastChunk
                ? 'Upload complete. Waiting for server processing.'
                : 'Uploading video to server.',
            }, {
              frameGenerationPending: true,
            });
          }
        }

        if (
          !response?.data?.session
          && !response?.data?.layer
          && !response?.data?.task
          && response?.data?.status !== 'PENDING'
          && response?.data?.complete !== true
        ) {
          throw new Error('Video upload did not complete successfully.');
        }

        const { session, layer, audioLayers: updatedAudioLayers, task: responseTask } = response.data;
        if (session && layer) {
          const updatedLayerIndex = session.layers.findIndex(
            (sessionLayer) => sessionLayer._id.toString() === layer._id.toString()
          );
          const uploadedLayerIsCurrent =
            currentLayerRef.current?._id?.toString?.() === layer._id.toString();

          setVideoSessionDetails(session);
          updateCurrentLayerAndLayerList(session.layers, updatedLayerIndex, { preserveCurrentLayer: true });
          setAudioLayers(updatedAudioLayers || session.audioLayers || []);
          if (uploadedLayerIsCurrent) {
            setActiveItemList(layer.imageSession?.activeItemList || []);
          }
          setIsCanvasDirty(true);
        } else {
          syncCurrentLayerUserVideoUploadTask(responseTask || {
            uploadId,
            status: 'PROCESSING',
            fileName: resolvedFileName,
            totalChunks,
            uploadedChunks: totalChunks,
            totalFileSize: file.size,
            uploadedBytes: file.size,
            progressPercent: 100,
            message: 'Upload complete. Processing video on server.',
          }, {
            frameGenerationPending: true,
            userVideoGenerationPending: true,
            userVideoUploadTaskId: response?.data?.taskId || null,
          });
        }

        setAiVideoPollType('user_video');

        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> Uploaded video processing started
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      } catch (error) {
        setIsAIVideoGenerationPending(false);
        setAiVideoPollType(null);
        syncCurrentLayerUserVideoUploadTask(null, {
          userVideoGenerationPending: false,
          userVideoUploadTaskId: null,
        });
        const statusCode = error?.response?.status;
        const serverError =
          error?.response?.data?.error
          || error?.response?.data?.message
          || error?.message;

        if (statusCode === 413) {
          toast.error(
            <div>
              <FaTimes className='inline-flex mr-2' /> A video upload chunk exceeded the server request limit. Please retry the upload.
            </div>,
            {
              position: 'bottom-center',
              className: 'custom-toast',
            }
          );
          throw new Error('A video upload chunk exceeded the server request limit. Please retry the upload.');
        }

        toast.error(
          <div>
            <FaTimes className='inline-flex mr-2' /> {serverError || 'Video upload failed.'}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        throw new Error(serverError || 'Video upload failed.');
      }
    },
    [
      closeAlertDialog,
      currentLayer,
      id,
      layerHasAnyVideoArtefact,
      layers,
      setActiveItemList,
      setAudioLayers,
      setIsCanvasDirty,
      setVideoSessionDetails,
      syncCurrentLayerUserVideoUploadTask,
      updateCurrentLayerAndLayerList,
    ]
  );

  const openUploadDialog = useCallback(
    (options = {}) => {
      const { closeView = false } = options;
      if (closeView) {
        setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
      }
      openAlertDialog(
        <div className='relative w-full max-w-[460px] overflow-hidden pt-8 text-left'>
          <FaTimes className='absolute right-4 top-3 z-20 cursor-pointer text-slate-300 hover:text-white' onClick={closeAlertDialog} />
          <ImageUploadDialog
            setUploadURL={setUploadURL}
            setUploadVideo={setUploadVideo}
            aspectRatio={aspectRatio}
            canvasDimensions={getCanvasDimensionsForAspectRatio(aspectRatio)}
          />
        </div>,
        undefined,
        false,
        { hideBorder: true }
      );
    },
    [aspectRatio, closeAlertDialog, openAlertDialog, setCurrentView, setUploadURL, setUploadVideo]
  );

  useEffect(() => {
    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY) {
      setSelectedId(null);
    }
  }, [currentCanvasAction]);



  const prevLengthRef = useRef(activeItemList.length);
  const [isIntermediateSaving, setIsIntermediateSaving] = useState(false);

  useEffect(() => {
    const currentLength = activeItemList.length;
    if (prevLengthRef.current !== currentLength) {
      if (!isIntermediateSaving) {
        setIsIntermediateSaving(true);
      }
    }
    prevLengthRef.current = currentLength;
  }, [activeItemList.length, isIntermediateSaving]);

  /******************************************************
   *                    GENERATION METHODS
   ******************************************************/

  // Submit new generation request
  const submitGenerateRequest = async (payload) => {
    setIsGenerationPending(true);
    setGenerationError(null);

    payload.aspectRatio = aspectRatio;

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return null;
    }
    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/request_generate`, payload, headers)
      .then((resData) => {
        const response = resData.data;
        const updatedPrompt = response.prompt;
        if (payload.isRecreateRequest) {
          setCurrentLayerDefaultPrompt(updatedPrompt);
        }
        startGenerationPoll();
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.generationRequestSubmitted")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      })
      .catch((error) => {
        setIsGenerationPending(false);
        setGenerationError(error.message);
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.generationRequestFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const submitGenerateNewRequest = async (inputPayload) => {
    const payload = {
      ...inputPayload,
      prompt: promptText,
      videoSessionId: id,
      model: selectedGenerationModel,
      layerId: currentLayer._id.toString(),
    };
    await submitGenerateRequest(payload);
  };

  const submitGenerateRecreateRequest = async (payload) => {
    payload = {
      ...payload,
      videoSessionId: id,
      model: payload.model ? payload.model : selectedGenerationModel,
      layerId: currentLayer._id.toString(),
      skipApplyThemeToPrompt: true,
      isRecreateRequest: true,
    };
    await submitGenerateRequest(payload);
  };


  const [selectedEditModelValue, setSelectedEditModelValue] = useState(
    IMAGE_EDIT_MODEL_TYPES.find((model) => model.key === selectedEditModel)
  );
  useEffect(() => {
    setSelectedEditModelValue(
      IMAGE_EDIT_MODEL_TYPES.find((model) => model.key === selectedEditModel)
    );
  }, [selectedEditModel]);

  // Clear the mask lines if we exit the inpaint mode
  useEffect(() => {
    if (
      currentView !== CURRENT_TOOLBAR_VIEW.SHOW_EDIT_DISPLAY ||
      (selectedEditModelValue && selectedEditModelValue.editType !== 'inpaint')
    ) {
      setEditMaskLines([]);
    }
  }, [currentView, selectedEditModelValue]);

  // Export items in activeItemList onto a canvas
  async function exportBaseGroup() {
    const stageDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
    const canvas = document.createElement('canvas');
    canvas.width = stageDimensions.width;
    canvas.height = stageDimensions.height;
    const ctx = canvas.getContext('2d');

    // Helper: load an image
    const loadImage = (src) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        if (!src.startsWith('data:')) {
          img.crossOrigin = 'Anonymous';
        }
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = getRenderableImageUrl(src, PROCESSOR_API_URL);
      });

    for (const item of currentLayer.imageSession.activeItemList || []) {
      if (item.type === 'text') {
        drawCanvasTextItem(ctx, item, { width, height });
        continue;
      }

      ctx.save();
      const { x, y, width, height, rotation } = item;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(x, y);

      if (rotation) {
        ctx.translate(width / 2, height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-width / 2, -height / 2);
      }

      if (item.type === 'image') {
        const imgSrc = getRenderableImageUrl(item, PROCESSOR_API_URL);
        try {
          const img = await loadImage(imgSrc);
          ctx.drawImage(img, 0, 0, width, height);
        } catch  {

        }
      } else if (item.type === 'shape') {
        const config = item.config;
        const shapeX = config.x || 0;
        const shapeY = config.y || 0;
        const shapeWidth = config.width || 0;
        const shapeHeight = config.height || 0;
        const radius = config.radius || 0;
        const strokeWidth = config.strokeWidth || 1;

        ctx.fillStyle = config.fillColor || '#000000';
        ctx.strokeStyle = config.strokeColor || '#000000';
        ctx.lineWidth = strokeWidth;

        if (item.shape === 'rectangle') {
          ctx.fillRect(shapeX, shapeY, shapeWidth, shapeHeight);
          ctx.strokeRect(shapeX, shapeY, shapeWidth, shapeHeight);
        } else if (item.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(shapeX + radius, shapeY + radius, radius, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    return canvas.toDataURL('image/png');
  }



  // Export a masked version of the group if inpaint is used, converting lines to black/white.
  async function exportMaskedGroupAsBlackAndWhite() {
    const baseStage = canvasRef.current;
    const baseLayer = baseStage.getLayers()[0];
    const maskGroup = baseLayer.findOne((node) => node.id() === 'maskGroup');

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = baseStage.width();
    offscreenCanvas.height = baseStage.height();
    const ctx = offscreenCanvas.getContext('2d');

    // Hide transformers before exporting
    const transformers = baseStage.find('Transformer');
    const transformerVisibility = [];
    transformers.forEach((tr) => {
      transformerVisibility.push(tr.visible());
      tr.visible(false);
    });

    const baseCanvas = await baseStage.toCanvas({ pixelRatio: 1 });
    transformers.forEach((tr, index) => {
      tr.visible(transformerVisibility[index]);
    });

    const baseCtx = baseCanvas.getContext('2d');
    const baseImageData = baseCtx.getImageData(0, 0, baseCanvas.width, baseCanvas.height);
    const imageData = baseImageData.data;

    const maskImageData = ctx.createImageData(baseCanvas.width, baseCanvas.height);
    const maskData = maskImageData.data;

    for (let i = 0; i < imageData.length; i += 4) {
      const alpha = imageData[i + 3];
      if (alpha === 0) {
        // Transparent -> white
        maskData[i] = 255;
        maskData[i + 1] = 255;
        maskData[i + 2] = 255;
        maskData[i + 3] = 255;
      } else {
        // Opaque -> black
        maskData[i] = 0;
        maskData[i + 1] = 0;
        maskData[i + 2] = 0;
        maskData[i + 3] = 255;
      }
    }
    ctx.putImageData(maskImageData, 0, 0);

    if (maskGroup) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'white';
      maskGroup.children.forEach((line) => {
        ctx.beginPath();
        const points = line.points();
        ctx.moveTo(points[0], points[1]);
        for (let i = 2; i < points.length; i += 2) {
          ctx.lineTo(points[i], points[i + 1]);
        }
        ctx.closePath();
        ctx.fill();
      });
    }
    return offscreenCanvas.toDataURL('image/png');
  }

  // Submit an outpaint/inpaint request
  const submitOutpaintRequest = async (evt) => {
    evt.preventDefault();
    setIsOutpaintPending(true);

    const baseImageData = await exportBaseGroup();
    let maskImageData;

    if (selectedEditModelValue && selectedEditModelValue.editType === 'inpaint') {
      maskImageData = await exportMaskedGroupAsBlackAndWhite();
    }

    if (selectedEditModelValue && selectedEditModelValue.key === 'NANOBANANA2') {
      submitNanoBananaOutpaintRequest();
      return;

    }

    const formData = new FormData(evt.target);
    const promptText = formData.get('promptText');
    const guidanceScale = formData.get('guidanceScale');
    const numInferenceSteps = formData.get('numInferenceSteps');
    const strength = formData.get('strength');

    const payload = {
      image: baseImageData,
      sessionId: id,
      layerId: currentLayer._id.toString(),
      prompt: promptText,
      model: selectedEditModel,
      guidanceScale,
      numInferenceSteps,
      strength,
      aspectRatio,
    };
    if (maskImageData) {
      payload['maskImage'] = maskImageData;
    }



    setOutpaintError(null);
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/request_edit_image`, payload, headers)
      .then(() => {
        startOutpaintPoll();
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.editRequestSubmitted")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      })
      .catch((error) => {
        setOutpaintError(error.message);
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.editRequestFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const submitNanoBananaOutpaintRequest = () => {};

  // Poll for generation status
  async function startGenerationPoll() {
    const selectedLayerId = currentLayer._id.toString();
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const pollStatusData = await axios.get(
      `${PROCESSOR_API_URL}/video_sessions/generate_status?id=${id}&layerId=${selectedLayerId}`,
      headers
    );
    const pollStatus = pollStatusData.data;

    if (pollStatus.status === 'COMPLETED') {
      const layerData = pollStatus.layer;
      const layerList = pollStatus.layers;

      updateCurrentLayerInSessionList(layerData);

      const updatedLayerIndex = layerList.findIndex(
        (layer) => layer._id.toString() === layerData._id.toString()
      );
      const imageSession = layerData.imageSession;

      setCurrentLayerDefaultPrompt(layerData.prompt);
      setShowCreateNewPromptDisplay(false);

      const generationImages = pollStatus.generationImages;
      if (generationImages && generationImages.length > 0) {
        setGenerationImages(generationImages);
      }
      const generatedImageUrlName = imageSession.activeGeneratedImage;
      const timestamp = Date.now();
      const generatedURL = `/generations/${generatedImageUrlName}?${timestamp}`;

      // Append the new generated image
      const item_id = `item_${activeItemList.length}`;
      const stageDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
      const nImageList = [
        ...activeItemList,
        createCurrentLayerImageItem({
          src: generatedURL,
          id: item_id,
          x: 0,
          y: 0,
          width: stageDimensions.width,
          height: stageDimensions.height,
        }),
      ];




      setActiveItemList(nImageList);
      setIsGenerationPending(false);
      setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
      toast.success(
        <div>
          <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.generationComplete")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      updateCurrentLayerAndLayerList(layerList, updatedLayerIndex);
      setIsCanvasDirty(true);
      getUserAPI();
      return;
    } else if (pollStatus.status === 'FAILED') {
      setIsGenerationPending(false);
      setGenerationError(pollStatus.generationError);
      setCanvasActionLoading(false);
      toast.error(
        <div>
          <FaTimes /> {t("studio.notifications.generationFailed")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      getUserAPI();
      return;
    } else {
      generationPollIntervalRef.current = setTimeout(() => {
        startGenerationPoll();
      }, 1000);
    }
  }

  // Poll for outpaint status
  async function startOutpaintPoll() {
    const selectedLayerId = currentLayer._id.toString();
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const pollStatusData = await axios.get(
      `${PROCESSOR_API_URL}/video_sessions/edit_status?id=${id}&layerId=${selectedLayerId}`,
      headers
    );
    const pollStatusDataResponse = pollStatusData.data;




    if (pollStatusDataResponse.status === 'COMPLETED') {

      const updatedLayer = pollStatusDataResponse.layer;


      updateCurrentLayerInSessionList(updatedLayer);

      const layerData = pollStatusDataResponse.layer;
      const imageSession = layerData.imageSession;

      const generatedImageUrlName = imageSession.activeEditedImage;
      const generatedURL = `${generatedImageUrlName}`;
      const item_id = `item_${activeItemList.length}`;
      const stageDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
      const nImageList = [
        ...activeItemList,
        createCurrentLayerImageItem({
          src: generatedURL,
          id: item_id,
          x: 0,
          y: 0,
          width: stageDimensions.width,
          height: stageDimensions.height,
        }),
      ];

      const generationImages = pollStatusDataResponse.generationImages;
      if (generationImages && generationImages.length > 0) {
        setGenerationImages(generationImages);
      }
      setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
      setActiveItemList(nImageList);
      setIsOutpaintPending(false);
      setIsCanvasDirty(true);
      toast.success(
        <div>
          <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.editComplete")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      getUserAPI();
      return;
    } else if (pollStatusDataResponse.status === 'FAILED') {
      setIsOutpaintPending(false);
      setOutpaintError(t("studio.notifications.outpaintFailed"));
      toast.error(
        <div>
          <FaTimes /> {t("studio.notifications.outpaintFailed")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      getUserAPI();
      return;
    } else {
      outpaintPollIntervalRef.current = setTimeout(() => {
        startOutpaintPoll();
      }, 1000);
    }
  }



  const downloadCurrentFrame = async () => {
    const currentLayerId = getLayerId(currentLayer);
    const currentLayerVideoState = resolveLayerVideoState(currentLayer);
    if (currentLayerVideoState.url && currentLayerId) {
      const headers = getHeaders();
      if (!headers) {
        showLoginDialog();
        return;
      }

      const currentSeekFrame = Number(currentLayerSeek) || 0;
      const currentLayerOffsetSeconds = Number(currentLayer?.durationOffset) || 0;
      const currentLayerTimestamp = Math.max(
        0,
        (currentSeekFrame / DISPLAY_FRAMES_PER_SECOND) - currentLayerOffsetSeconds
      );

      try {
        const frameResponse = await axios.get(
          `${PROCESSOR_API_URL}/video_sessions/layer_frame`,
          {
            ...headers,
            params: {
              sessionId: id,
              layerId: currentLayerId,
              timestamp: currentLayerTimestamp,
            },
            responseType: 'blob',
          }
        );

        const blobUrl = window.URL.createObjectURL(frameResponse.data);
        const link = document.createElement('a');
        const dateStr = new Date().toISOString().replace(/:/g, '-');
        link.href = blobUrl;
        link.download =
          getContentDispositionFileName(frameResponse.headers?.['content-disposition']) ||
          `frame_${dateStr}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(blobUrl);
      } catch  {
        toast.error(
          <div>
            <FaTimes /> Unable to download current video frame
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      }
      return;
    }




    const stageDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
    const canvas = document.createElement('canvas');
    canvas.width = stageDimensions.width;
    canvas.height = stageDimensions.height;
    const ctx = canvas.getContext('2d');



    const loadImage = (src) =>
      new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = getRenderableImageUrl(src, PROCESSOR_API_URL);
      });


    // Draw each item
    for (const item of currentLayer.imageSession.activeItemList || []) {
      if (item.type === 'text') {
        drawCanvasTextItem(ctx, item, stageDimensions);
        continue;
      }

      ctx.save();
      const { x, y, width, height, rotation } = item;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(x, y);
      if (rotation) {
        ctx.translate(width / 2, height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.translate(-width / 2, -height / 2);
      }
      if (item.type === 'image') {
        const imgSrc = getRenderableImageUrl(item, PROCESSOR_API_URL);
        try {
          const img = await loadImage(imgSrc);
          ctx.drawImage(img, 0, 0, width, height);
        } catch  {

        }
      } else if (item.type === 'shape') {
        const config = item.config;
        const shapeX = config.x || 0;
        const shapeY = config.y || 0;
        const shapeWidth = config.width || 0;
        const shapeHeight = config.height || 0;
        const radius = config.radius || 0;
        const strokeWidth = config.strokeWidth || 1;

        ctx.fillStyle = config.fillColor || '#000000';
        ctx.strokeStyle = config.strokeColor || '#000000';
        ctx.lineWidth = strokeWidth;
        if (item.shape === 'rectangle') {
          ctx.fillRect(shapeX, shapeY, shapeWidth, shapeHeight);
          ctx.strokeRect(shapeX, shapeY, shapeWidth, shapeHeight);
        } else if (item.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(shapeX + radius, shapeY + radius, radius, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Non-premium: add watermark
    // if (!isPremiumUser) {
    //   try {
    //     const watermarkImg = await loadLocalImage(waterMarkImage);
    //     const padding = 16;
    //     const x = canvas.width - watermarkImg.width - padding / 2;
    //     const y = canvas.height - watermarkImg.height - padding;
    //     ctx.drawImage(watermarkImg, x, y, watermarkImg.width, watermarkImg.height);
    //   } catch (error) {
    //
    //   }
    // }

    const dataURL = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataURL;
    const dateStr = new Date().toISOString().replace(/:/g, '-');
    link.download = `frame_${dateStr}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  // SMART selection (mask generation)
  useEffect(() => {
    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_SMART_SELECT_DISPLAY) {
      const headers = getHeaders();
      if (!headers) {
        showLoginDialog();
        return;
      }
      const originalStage = canvasRef.current.getStage();
      const clonedStage = originalStage.clone();

      // remove BBox rects or transformers
      clonedStage
        .find((node) => node.id().startsWith('bbox_rect_'))
        .forEach((node) => {
          node.destroy();
        });
      clonedStage.find('Transformer').forEach((transformer) => {
        transformer.destroy();
      });
      clonedStage.draw();

      const dataURL = clonedStage.toDataURL();
      const layerId = currentLayer._id.toString();
      const sessionPayload = {
        image: dataURL,
        sessionId: id,
        layerId: layerId,
      };

      if (activeItemList.length === 0) {
        return;
      }
      if (activeItemList.length > 1) {
        const newItemId = `item_${activeItemList.length}`;
        const newItem = createCurrentLayerImageItem({
          src: dataURL,
          id: newItemId,
          x: 0,
          y: 0,
          width: STAGE_DIMENSIONS.width,
          height: STAGE_DIMENSIONS.height,
        });
        const newItemList = [...activeItemList, newItem];
        setActiveItemList(newItemList);
        updateSessionLayerActiveItemList(newItemList);
      }
      setEnableSegmentationMask(false);

      axios
        .post(`${PROCESSOR_API_URL}/video_sessions/request_generate_mask`, sessionPayload, headers)
        .then(function () {
          startMaskGenerationPoll();
          setEnableSegmentationMask(true);
          setCanvasActionLoading(true);
          toast.success(
            <div>
              <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.maskRequestSubmitted")}
            </div>,
            {
              position: 'bottom-center',
              className: 'custom-toast',
            }
          );
        })
        .catch(() => {
          toast.error(
            <div>
              <FaTimes /> {t("studio.notifications.maskRequestFailed")}
            </div>,
            {
              position: 'bottom-center',
              className: 'custom-toast',
            }
          );
        });
    }
  }, [currentCanvasAction]);

  const startMaskGenerationPoll = () => {
    const sessionId = id;
    axios
      .get(`${PROCESSOR_API_URL}/video_sessions/generate_mask_status?sessionId=${sessionId}`)
      .then((response) => {
        const maskGeneration = response.data;
        if (maskGeneration.status === 'COMPLETED') {
          const sessionData = maskGeneration.session;
          setVideoSessionDetails(sessionData);
          const layerData = sessionData.layers.find(
            (layer) => layer._id.toString() === currentLayer._id.toString()
          );
          const segmentationData = layerData.segmentation;
          setSegmentationData(segmentationData);
          setCanvasActionLoading(false);
          setIsCanvasDirty(true);
          toast.success(
            <div>
              <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.maskComplete")}
            </div>,
            {
              position: 'bottom-center',
              className: 'custom-toast',
            }
          );
        } else {
          maskGenerationPollIntervalRef.current = setTimeout(() => {
            startMaskGenerationPoll();
          }, 1000);
        }
      })
      .catch(() => {
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.maskFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const showTemplatesSelect = () => {
    setIsTemplateSelectViewSelected(!isTemplateSelectViewSelected);
  };
  const addImageItemToActiveList = (payload) => {
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
    updateCurrentActiveLayer(payload);
  };





  /************************************************
   *            TEXT / SHAPES
   ************************************************/
  const addTextBoxToCanvas = (payload) => {
    const normalizedTextConfig = getTextConfigForCanvas(
      {
        ...(textConfig || {}),
        ...(payload?.config || {}),
      },
      getCanvasDimensionsForAspectRatio(aspectRatio)
    );
    const nImageList = [
      ...activeItemList,
      {
        ...payload,
        id: `item_${activeItemList.length}`,
        config: normalizedTextConfig,
      },
    ];

    // If any item is an image with a query param in src, remove it
    const listPayload = nImageList.map((imageItem) => {
      if (imageItem.type === 'image') {
        const imageSrc = imageItem.src;
        const questionMarkIndex = imageSrc.indexOf('?');
        const imageSrcFormatted =
          questionMarkIndex !== -1 ? imageSrc.slice(0, questionMarkIndex) : imageSrc;
        return { ...imageItem, src: imageSrcFormatted };
      }
      return imageItem;
    });

    setActiveItemList(nImageList);
    updateSessionLayerActiveItemList(listPayload);
  };

  const createTextLayer = async (payload) => {
    const apiPayload = {
      sessionId: id,
      layerId: currentLayer._id.toString(),
      textItem: payload,
    };
    const headers = getHeaders();
    const resData = await axios.post(
      `${PROCESSOR_API_URL}/video_sessions/add_text_to_active_list`,
      apiPayload,
      headers
    );
    const responsePayload = resData.data;
    const layerData = responsePayload.layer;
    const newActiveItemList = layerData.imageSession.activeItemList;
    setActiveItemList(newActiveItemList);
  };

  const setSelectedShape = (shapeKey, shapeConfigOverride = null) => {
    let shapeConfig;
    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
    const canvasCenterX = canvasDimensions.width / 2;
    const canvasCenterY = canvasDimensions.height / 2;
    const commonShapeConfig = {
      fillColor: fillColor,
      strokeColor: strokeColor,
      strokeWidth: strokeWidthValue,
    };

    if (shapeConfigOverride && typeof shapeConfigOverride === 'object') {
      shapeConfig = {
        ...commonShapeConfig,
        ...shapeConfigOverride,
      };
    } else if (shapeKey === 'dialog') {
      const width = Math.min(canvasDimensions.width * 0.5, 420);
      const height = Math.min(canvasDimensions.height * 0.22, 180);
      shapeConfig = {
        ...commonShapeConfig,
        x: Math.round(canvasCenterX),
        y: Math.round(canvasCenterY),
        width: Math.round(width),
        height: Math.round(height),
        pointerX: Math.round(canvasCenterX),
        pointerY: Math.round(canvasCenterY + height / 2),
        xRadius: width / 2,
        yRadius: height / 2,
      };
    } else {
      const shortSide = Math.min(canvasDimensions.width, canvasDimensions.height);
      const radius = Math.round(shortSide * 0.18);
      const width = Math.min(canvasDimensions.width * 0.42, 420);
      const height = Math.min(canvasDimensions.height * 0.28, 280);
      shapeConfig = {
        ...commonShapeConfig,
        x: shapeKey === 'rectangle' ? Math.round((canvasDimensions.width - width) / 2) : Math.round(canvasCenterX),
        y: shapeKey === 'rectangle' ? Math.round((canvasDimensions.height - height) / 2) : Math.round(canvasCenterY),
        width: shapeKey === 'rectangle' ? Math.round(width) : radius * 2,
        height: shapeKey === 'rectangle' ? Math.round(height) : radius * 2,
        radius,
        ...(shapeKey === 'polygon' ? { sides: 6 } : {}),
      };
    }
    const newId = `item_${activeItemList.length}`;
    const currentLayerList = [
      ...activeItemList,
      {
        type: 'shape',
        shape: shapeKey,
        config: shapeConfig,
        id: newId,
      },
    ];
    setActiveItemList(currentLayerList);
    setSelectedId(newId);
    updateSessionLayerActiveItemList(currentLayerList);
  };

  /*************************************************
   *                   FILTERS
   *************************************************/
  const applyFilter = (index, filter, value) => {
    const nodeId = `item_${index}`;
    const stage = canvasRef.current.getStage();
    const imageNode = stage.findOne(`#${nodeId}`);
    if (!imageNode) return;
    imageNode.cache();
    imageNode.filters([filter]);

    switch (filter) {
      case Konva.Filters.Blur:
        imageNode.blurRadius(value);
        break;
      case Konva.Filters.Brighten:
        imageNode.brightness(value);
        break;
      case Konva.Filters.Contrast:
        imageNode.contrast(value);
        break;
      case Konva.Filters.HSL:
        imageNode.hue(value * 360);
        break;
      case Konva.Filters.Pixelate:
        imageNode.pixelSize(Math.round(value));
        break;
      case Konva.Filters.Posterize:
        imageNode.levels(Math.round(value));
        break;
      case Konva.Filters.RGBA:
        imageNode.alpha(value);
        break;
      default:
        // grayscale, invert, sepia, etc. have no extra param
        break;
    }
    stage.batchDraw();
  };

  const applyFinalFilter = async (index, filter, value) => {
    const nodeId = `item_${index}`;
    const stage = canvasRef.current.getStage();
    const imageNode = stage.findOne(`#${nodeId}`);
    if (!imageNode) return;

    imageNode.cache();
    imageNode.filters([filter]);
    switch (filter) {
      case Konva.Filters.Blur:
        imageNode.blurRadius(value);
        break;
      case Konva.Filters.Brighten:
        imageNode.brightness(value);
        break;
      case Konva.Filters.Contrast:
        imageNode.contrast(value);
        break;
      case Konva.Filters.HSL:
        imageNode.hue(value * 360);
        break;
      case Konva.Filters.Pixelate:
        imageNode.pixelSize(Math.round(value));
        break;
      case Konva.Filters.Posterize:
        imageNode.levels(Math.round(value));
        break;
      case Konva.Filters.RGBA:
        imageNode.alpha(value);
        break;
      default:
        break;
    }

    stage.batchDraw();
    const updatedImageDataUrl = imageNode.toDataURL();
    const updatedItemList = activeItemList.map((item, idx) => {
      if (idx === index) {
        return { ...item, src: updatedImageDataUrl };
      }
      return item;
    });

    setActiveItemList(updatedItemList);
    updateSessionLayerActiveItemList(updatedItemList);
  };

  const handleBubbleChange = () => { };

  const combineCurrentLayerItems = async () => {
    const stage = canvasRef.current.getStage();
    const transformers = stage.find('Transformer');
    transformers.forEach((tr) => tr.visible(false));
    const masks = stage.find('#maskGroup, #pencilGroup');
    masks.forEach((mask) => mask.visible(false));

    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
    const combinedImageDataUrl = stage.toDataURL({ pixelRatio: 2 });
    const combinedItem = {
      src: combinedImageDataUrl,
      id: `item_0`,
      x: 0,
      y: 0,
      width: canvasDimensions.width,
      height: canvasDimensions.height,
    };
    const updatedItemList = [createCurrentLayerImageItem(combinedItem)];
    setActiveItemList(updatedItemList);
    updateSessionLayerActiveItemList(updatedItemList);
    setSelectedId('item_0');
  };

  const submitGenerateMusicRequest = (payload) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    payload.sessionId = id;





    axios.post(`${PROCESSOR_API_URL}/audio/request_generate_audio`, payload, headers)
      .then((response) => {
        setAudioGenerationPending(true);
        startAudioGenerationPoll(response.data);
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.audioRequestSubmitted")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      })
      .catch(() => {
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.audioRequestFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const startAudioGenerationPoll = async () => {
    const sessionId = id;
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const pollStatusData = await axios.get(
      `${PROCESSOR_API_URL}/audio/generate_status?sessionId=${sessionId}`,
      headers
    );
    const pollStatus = pollStatusData.data;

    if (pollStatus.generationStatus === 'COMPLETED') {


      setVideoSessionDetails(pollStatus.videoSession);
      setAudioGenerationPending(false);
      const { generationType } = pollStatus;
      if (generationType === 'music') {
        setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_PREVIEW_MUSIC_DISPLAY);
      } else if (generationType === 'sound') {
        setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_PREVIEW_SOUND_DISPLAY);
      } else if (generationType === 'speech') {
        setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_PREVIEW_SPEECH_DISPLAY);
      }
      toast.success(
        <div>
          <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.audioComplete")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      getUserAPI();
      return;
    } else if (pollStatus.generationStatus === 'FAILED') {
      setAudioGenerationPending(false);
      toast.error(
        <div>
          <FaTimes /> {t("studio.notifications.audioFailed")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      getUserAPI();
      return;
    } else {
      audioGenerationPollIntervalRef.current = setTimeout(() => {
        startAudioGenerationPoll();
      }, 2000);
    }
  };

  const submitAddBatchTrackToProject = (payload) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const sessionId = id;
    let requestPayload = {
      sessionId,
      audioLayers: payload,
    };


    axios
      .post(`${PROCESSOR_API_URL}/audio/add_track_list_to_project`, requestPayload, headers)
      .then((response) => {
        const sessionData = response.data;
        if (sessionData && sessionData.videoSession) {
          setVideoSessionDetails(sessionData.videoSession);
          setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
          toast.success(
            <div>
              <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.trackAdded")}
            </div>,
            {
              position: 'bottom-center',
              className: 'custom-toast',
            }
          );
          setIsCanvasDirty(true);
        }
      })
      .catch(() => {
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.trackAddFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const submitAddTrackToProject = (index, payload) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }


    const sessionId = id;
    const audioLayers = videoSessionDetails.audioLayers;
    const latestAudioLayer = audioLayers[audioLayers.length - 1];
    const layerId = latestAudioLayer._id.toString();

    let requestPayload = {
      sessionId,
      trackIndex: index,
      ...payload,
    };
    if (!requestPayload.audioLayerId) {
      requestPayload.audioLayerId = layerId;
    }


    axios
      .post(`${PROCESSOR_API_URL}/audio/add_track_to_project`, requestPayload, headers)
      .then((response) => {
        const sessionData = response.data;
        if (sessionData && sessionData.videoSession) {
          setVideoSessionDetails(sessionData.videoSession);
          setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
          toast.success(
            <div>
              <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.trackAdded")}
            </div>,
            {
              position: 'bottom-center',
              className: 'custom-toast',
            }
          );
          setIsCanvasDirty(true);
        }
      })
      .catch(() => {
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.trackAddFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const selectImageFromLibrary = (imageItem, selectionMeta = {}) => {
    const newItemId = `item_${activeItemList.length}`;
    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
    const previewUrl = [
      selectionMeta?.previewUrl,
      selectionMeta?.url,
      selectionMeta?.imageUrl,
      selectionMeta?.asset?.previewUrl,
      selectionMeta?.asset?.url,
    ].find((value) => typeof value === 'string' && value.trim())?.trim();
    const newItem = createCurrentLayerImageItem({
      src: imageItem,
      id: newItemId,
      x: 0,
      y: 0,
      width: canvasDimensions.width,
      height: canvasDimensions.height,
    });
    if (previewUrl) {
      newItem.previewUrl = previewUrl;
      newItem.url = previewUrl;
    }
    const newItemList = [...activeItemList, newItem];
    setActiveItemList(newItemList);
    updateSessionLayerActiveItemList(newItemList);
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);

    currentLayer.imageSession.activeItemList = newItemList;
    updateCurrentLayer(currentLayer);

    toast.success(
      <div>
        <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.imageAddedFromLibrary")}
      </div>,
      {
        position: 'bottom-center',
        className: 'custom-toast',
      }
    );
  };

  const resetImageLibrary = () => {
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
  };

  // removeAiVideoLayer now includes the layer type in the payload
  const removeAIVideoLayer = async (targetLayer = null) => {
    const layerForRemoval = targetLayer || currentLayer;
    if (!layerForRemoval?._id) {
      return;
    }

    setCanvasActionLoading(true);

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      setCanvasActionLoading(false);
      return;
    }
    const { type: resolvedVideoLayerType } = resolveLayerVideoState(layerForRemoval);
    const payload = {
      sessionId: id,
      layerId: layerForRemoval._id.toString(),
      aiVideoLayerType: resolvedVideoLayerType || aiVideoLayerType,
    };


    try {

      const responseData = await axios.post(`${PROCESSOR_API_URL}/video_sessions/remove_ai_video_layer`, payload, headers);
      const removeResponse = responseData.data;
      if (removeResponse) {


        const { session, layer, audioLayers } = removeResponse;


        const layerList = session.layers;
        const currentNewLayerIndex = layerList.findIndex(
          (l) => l._id.toString() === layer._id.toString()
        );
        setVideoSessionDetails(session);
        updateCurrentLayerAndLayerList(layerList, currentNewLayerIndex);
        setActiveItemList(layer.imageSession.activeItemList);
        setAudioLayers(audioLayers);

        setIsCanvasDirty(true);

        const { url, type } = resolveLayerVideoState(layer);
        setAiVideoLayer(url);
        setAiVideoLayerType(type);
      }

    } catch  {

    } finally {
      setCanvasActionLoading(false);
    }
  };

  // Sync / realign helpers
  const requestRegenerateSubtitles = async (selectedSubtitleLanguage = '') => {
    toast.success(
      <div>
        <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.regenerateSubtitlesRequested")}
      </div>,
      {
        position: 'bottom-center',
        className: 'custom-toast',
      }
    );
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const payload = {
      sessionId: id,
      realignAudio: true,
      ...buildSubtitleRegenerationLanguageFields({
        selectedLanguage: selectedSubtitleLanguage,
        audioLanguage: resolveSessionAudioLanguage(videoSessionDetails),
      }),
    };
    axios.post(`${PROCESSOR_API_URL}/video_sessions/request_regenerate_subtitles`, payload, headers).then(() => {
      setIsCanvasDirty(true);
    });
  };

  const requestReAlignLayersToSpeechAndRegenerateSubtitles = async () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const payload = { sessionId: id, realignAudio: true };
    axios.post(`${PROCESSOR_API_URL}/video_sessions/request_realign_layers_to_speech_and_regen_sub`, payload, headers)
      .then(() => {
        setIsCanvasDirty(true);
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.realignLayersToSpeechRequested")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const requestRealignToAiVideoAndLayers = async () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const payload = { sessionId: id };
    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/request_realign_to_ai_video_and_layers`, payload, headers)
      .then(() => {
        setIsCanvasDirty(true);
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.realignLayersToAiVideoRequested")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const requestRegenerateAnimations = async () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const payload = { sessionId: id };
    toast.success(
      <div>
        <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.regenerateAnimationsRequested")}
      </div>,
      {
        position: 'bottom-center',
        className: 'custom-toast',
      }
    );
    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/request_regenerate_animations`, payload, headers)
      .then(() => {
        setIsCanvasDirty(true);
      });
  };

  const requestLipSyncToSpeech = (selectedModel) => {
    if (layerHasUploadedOrPendingUserVideo(currentLayer)) {
      toast.error(
        <div>
          <FaTimes /> Remove the uploaded or pending video before requesting lip sync.
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      return;
    }
    if (
      currentLayer?.aiVideoGenerationPending
      || currentLayer?.lipSyncGenerationPending
      || currentLayer?.soundEffectGenerationPending
    ) {
      toast.error(
        <div>
          <FaTimes /> Wait for the pending video task to finish before requesting lip sync.
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      return;
    }
    if (!currentLayer?.aiVideoLayer && !currentLayer?.aiVideoRemoteLink) {
      toast.error(
        <div>
          <FaTimes /> Generate an AI video for this layer before requesting lip sync.
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      return;
    }
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    setIsAIVideoGenerationPending(true);
    const payload = {
      videoSessionId: id,
      sessionId: id,
      layerId: currentLayer._id.toString(),
      model: selectedModel
    };

    setAiVideoPollType(null);

    axios.post(`${PROCESSOR_API_URL}/video_sessions/request_lip_sync_to_speech`, payload, headers).then((resData) => {

      const response = resData.data;

      const { session, layer } = response;
      const newLayers = session.layers;
      const currentLayerIndex = newLayers.findIndex(
        (l) => l._id.toString() === layer._id.toString()
      );
      updateCurrentLayerAndLayerList(newLayers, currentLayerIndex);
      setAiVideoPollType('lip_sync');


      toast.success(
        <div>
          <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.generationRequestSubmitted")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
    }).catch((error) => {
      setIsAIVideoGenerationPending(false);
      const errorMessage = error?.response?.data?.error || error?.response?.data?.message || error?.message;
      toast.error(
        <div>
          <FaTimes /> {errorMessage || t("studio.notifications.generationRequestFailed")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
    });
  };

  // Add audio from library
  const requestAddAudioLayerFromLibrary = (audioItem, addConfig = {}) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const payload = {
      sessionId: id,
      audioItem,
      ...addConfig,
    };
    return axios.post(`${PROCESSOR_API_URL}/video_sessions/add_audio_from_library`, payload, headers).then((dataRes) => {
      const response = dataRes.data;
      const sessionDetails = response.sessionDetails;
      if (sessionDetails) {
        setVideoSessionDetails(sessionDetails);
        setAudioLayers(sessionDetails.audioLayers || []);
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.audioAddedToProject")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        resetImageLibrary();
      }
    });
  };

  const requestAddGlobalAudioLayerFromLibrary = (audioItem, addConfig = {}) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const payload = {
      sessionId: id,
      audioItem,
      ...addConfig,
    };
    return axios.post(`${PROCESSOR_API_URL}/video_sessions/add_global_audio_from_library`, payload, headers).then((dataRes) => {
      const response = dataRes.data;
      const sessionDetails = response.sessionDetails;
      if (sessionDetails) {
        setVideoSessionDetails(sessionDetails);
        setAudioLayers(sessionDetails.audioLayers || []);
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.audioAddedToProject")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        resetImageLibrary();
      }
    });
  };

  // Add selected video to layer
  const addSelectedAiVideoToLayer = (payload) => {
    setIsSelectButtonDisabled(true);

    const selectedVideo = payload?.videoItem || payload?.video;
    const trimScene = Boolean(payload?.trimScene);
    const sourceType = typeof selectedVideo?.sourceType === 'string'
      ? selectedVideo.sourceType
      : 'ai_video';
    const headers = getHeaders();

    if (!headers) {
      showLoginDialog();
      setIsSelectButtonDisabled(false);
      return;
    }

    const isLibraryImport = sourceType !== 'ai_video';
    const requestUrl = isLibraryImport
      ? `${PROCESSOR_API_URL}/video_sessions/add_video_from_library`
      : `${PROCESSOR_API_URL}/video_sessions/add_ai_video_layer`;
    const requestPayload = isLibraryImport
      ? {
        sessionId: id,
        layerId: currentLayer._id.toString(),
        trimScene,
        videoItem: selectedVideo,
      }
      : {
        sessionId: id,
        videoURL: selectedVideo?.url,
        trimScene,
        layerId: currentLayer._id.toString(),
        videoModel: selectedVideo?.model,
        audioPrompt: selectedVideo?.audioPrompt,
      };

    axios
      .post(requestUrl, requestPayload, headers)
      .then((dataRes) => {
        const response = dataRes.data;
        const { session, layer, audioLayers: updatedAudioLayers } = response;
        const newLayers = Array.isArray(session?.layers) ? session.layers : [];
        const currentLayerIndex = newLayers.findIndex(
          (sessionLayer) => sessionLayer._id.toString() === layer._id.toString()
        );

        setIsSelectButtonDisabled(false);
        setVideoSessionDetails(session);
        setAudioLayers(updatedAudioLayers || session.audioLayers || []);
        updateCurrentLayerAndLayerList(newLayers, currentLayerIndex);

        const { url, type } = resolveLayerVideoState(layer);
        setAiVideoLayerType(type || sourceType);
        setAiVideoLayer(url);

        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.videoAddedToProject")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        resetImageLibrary();
      })
      .catch((error) => {
        setIsSelectButtonDisabled(false);
        toast.error(
          <div>
            <FaTimes className='inline-flex mr-2' />
            {error?.response?.data?.error || 'Unable to add the selected video.'}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  // Submit layered speech
  const submitGenerateLayeredSpeechRequest = (data) => {
    const payload = {
      ...data,
      fontSize: 40,
      fontColor: '#f5f5f5',
      fontFamily: 'Times New Roman',
      backgroundColor: '#030712',
      videoSessionId: id,
    };
    const numLayers = data.promptList.length;
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    setAudioGenerationPending(true);
    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/request_generate_layered_speech`, payload, headers)
      .then(() => {
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.layeredSpeechRequestSubmitted")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        // poll method
        numAudioLayersToPollRef.current = numLayers;
        startLayeredAudioGenerationPoll();
      })
      .catch(() => {
        setAudioGenerationPending(false);
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.layeredSpeechRequestFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const numAudioLayersToPollRef = useRef(0);
  const startLayeredAudioGenerationPoll = async () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const numLayers = numAudioLayersToPollRef.current;
    try {
      const pollStatusData = await axios.get(
        `${PROCESSOR_API_URL}/audio/layered_speech_generate_status?sessionId=${id}&numLayers=${numLayers}`,
        headers
      );
      const pollStatus = pollStatusData.data;
      if (pollStatus.generationStatus === 'COMPLETED') {
        setVideoSessionDetails(pollStatus.videoSession);
        setAudioGenerationPending(false);
        setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_PREVIEW_SPEECH_LAYERED_DISPLAY);
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.layeredSpeechComplete")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        getUserAPI();
        return;
      } else if (pollStatus.generationStatus === 'FAILED') {
        setAudioGenerationPending(false);
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.layeredSpeechFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        getUserAPI();
        return;
      } else {
        layeredAudioGenerationPollIntervalRef.current = setTimeout(() => {
          startLayeredAudioGenerationPoll();
        }, 1000);
      }
    } catch  {

      setAudioGenerationPending(false);
      toast.error(
        <div>
          <FaTimes /> {t("studio.notifications.layeredSpeechFailed")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
    }
  };

  // Submit advanced session theme
  const [isUpdateDefaultsPending, setIsUpdateDefaultsPending] = useState(false);
  const submitUpdateSessionDefaults = (defaultPayload) => {
    setIsUpdateDefaultsPending(true);
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return Promise.reject(new Error('No headers'));
    }
    const payload = {
      sessionId: id,
      defaults: defaultPayload,
    };
    return axios
      .post(`${PROCESSOR_API_URL}/video_sessions/update_defaults`, payload, headers)
      .then((response) => {
        const updatedSession = response.data;
        const sessionData = updatedSession.videoSession;
        setVideoSessionDetails(sessionData);
        setIsUpdateDefaultsPending(false);
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.sessionDefaultsUpdated")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      })
      .catch((error) => {
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.sessionDefaultsFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        setIsUpdateDefaultsPending(false);
        return Promise.reject(error);
      });
  };

  // Setting advanced theme
  const setAdvancedSessionTheme = (payload) => {
    setIsUpdateDefaultsPending(true);
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    payload = {
      sessionId: id,
      aspectRatio,
      ...payload,
    };
    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/set_advanced_theme`, payload, headers)
      .then((response) => {
        const updatedSessionContainer = response.data;
        const updatedSession = updatedSessionContainer.sessionDetails;
        setVideoSessionDetails(updatedSession);
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.advancedThemeUpdated")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        setIsUpdateDefaultsPending(false);
      })
      .catch(() => {
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.advancedThemeFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        setIsUpdateDefaultsPending(false);
      });
  };

  // Poll for AI video generation
  const startAIVideoLayerGenerationPoll = async () => {
    if (!currentLayer) {
      return;
    }

    const selectedLayerId = currentLayer._id.toString();
    const payload = {
      sessionId: id,
      layerId: selectedLayerId,
      aiVideoLayerType: aiVideoPollType,
    };



    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    if (!aiVideoPollType) {
      // setIsAIVideoGenerationPending(false);
      return;
    }
    const pollResData = await axios.post(
      `${PROCESSOR_API_URL}/video_sessions/generate_ai_video_status`,
      payload,
      headers
    );
    const pollRes = pollResData.data;
    if (pollRes.status === 'COMPLETED') {
      const sessionData = pollRes.session;
      setIsAIVideoGenerationPending(false);
      sessionData.layers.find(
        (layer) => layer._id.toString() === selectedLayerId
      );

      const newLayers = sessionData.layers;
      const updatedLayerIndex = newLayers.findIndex(
        (layer) => layer._id.toString() === selectedLayerId
      );

      setVideoSessionDetails(sessionData);
      updateCurrentLayerAndLayerList(newLayers, updatedLayerIndex, { preserveCurrentLayer: true });
      setAudioLayers(sessionData.audioLayers || []);
      setIsCanvasDirty(true);
      if (aiVideoPollType === 'user_video') {
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> Uploaded video added to layer
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      }
      getUserAPI();
    } else if (pollRes.status === 'FAILED') {
      setIsAIVideoGenerationPending(false);
      toast.error(
        <div>
          <FaTimes /> {pollRes.error || t("studio.notifications.aiVideoFailed")}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      getUserAPI();
    } else {
      aiVideoGenerationPollIntervalRef.current = setTimeout(() => {
        startAIVideoLayerGenerationPoll();
      }, VIDEO_TASK_POLL_INTERVAL_MS);
    }
  };

  // Submit new AI video request
  const submitGenerateNewAIVideoRequest = (requestConfig) => {
    if (layerHasAnyVideoArtefact(currentLayer)) {
      toast.error(
        <div>
          <FaTimes /> Remove the uploaded or pending video before generating AI video.
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      return;
    }
    setIsAIVideoGenerationPending(true);
    const payload = {
      model: selectedVideoGenerationModel,
      prompt: videoPromptText,
      currentLayerId: currentLayer._id.toString(),
      videoSessionId: id,
      aspectRatio,
      ...requestConfig,
    };
    setGenerationError(null);

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    setAiVideoPollType(null);


    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/request_generate_custom_video`, payload, headers)
      .then((resData) => {
        const response = resData.data;

        setAiVideoPollType('ai_video');

        const { session, layer } = response;
        const newLayers = session.layers;
        const currentLayerIndex = newLayers.findIndex(
          (l) => l._id.toString() === layer._id.toString()
        );
        updateCurrentLayerAndLayerList(newLayers, currentLayerIndex);
        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.generationRequestSubmitted")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      })
      .catch((error) => {
        setGenerationError(error.message);
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.generationRequestFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  useState(true);


  const requestAddSyncedSoundEffect = (payload) => {
    if (layerHasAnyVideoArtefact(currentLayer)) {
      toast.error(
        <div>
          <FaTimes /> Remove the uploaded or pending video before generating synced sound effects.
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const reqPayload = {
      sessionId: id,
      currentLayerId: currentLayer._id.toString(),
      model: payload.model || 'MMAUDIOV2',
      ...payload,
    };



    setAiVideoPollType(null);

    setIsAIVideoGenerationPending(true);
    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/add_synced_sound_effect`, reqPayload, headers)
      .then(() => {
        setAiVideoPollType('sound_effect');
        startAIVideoLayerGenerationPoll();
      });
  };

  const updateMovieGenSpeakers = (updatedSpeakers) => {


    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const payload = {
      sessionId: id,
      speakers: updatedSpeakers,
    };



    axios
      .post(`${PROCESSOR_API_URL}/video_sessions/update_movie_gen_speakers`, payload, headers)
      .then(() => {

        setMovieGenSpeakers(updatedSpeakers);

        toast.success(
          <div>
            <FaCheck className='inline-flex mr-2' /> {t("studio.notifications.movieGenSpeakersUpdated")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );



      })
      .catch(() => {
        toast.error(
          <div>
            <FaTimes /> {t("studio.notifications.movieGenSpeakersFailed")}
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  }


  let viewDisplay = <span />;




  if (currentLayer && currentLayer.imageSession && currentLayer.imageSession.activeItemList) {
    if (currentLayer.imageSession.generationStatus === 'PENDING') {
      viewDisplay = <LoadingImage />;
    } else {
      if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_LIBRARY_DISPLAY) {
        viewDisplay = (
          <LibraryHome
            generationImages={generationImages}
            addImageItemToActiveList={addImageItemToActiveList}
            selectImageFromLibrary={selectImageFromLibrary}
            resetImageLibrary={resetImageLibrary}
            onSelectMusic={requestAddAudioLayerFromLibrary}
            onSelectVideo={addSelectedAiVideoToLayer}
            isSelectButtonDisabled={isSelectButtonDisabled}
            sessionDetails={videoSessionDetails}
            sessionId={id}
            currentLayer={currentLayer}
          />
        );
      } else {
        // Show the Konva-based canvas
        let canvasInternalLoading = <span />;
        if (canvasActionLoading) {
          getCanvasDimensionsForAspectRatio(aspectRatio).width;
          canvasInternalLoading = (
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <LoadingImageBase />
            </div>
          );
        }
        viewDisplay = (
          <div className='relative'>
            {canvasInternalLoading}
            <VideoCanvasContainer
              ref={canvasRef}
              maskGroupRef={maskGroupRef}
              sessionDetails={videoSessionDetails}
              activeItemList={activeItemList}
              setActiveItemList={setActiveItemList}
              editBrushWidth={editBrushWidth}
              currentView={currentView}
              editMasklines={editMasklines}
              setEditMaskLines={setEditMaskLines}
              currentCanvasAction={currentCanvasAction}
              setCurrentCanvasAction={setCurrentCanvasAction}
              fillColor={fillColor}
              strokeColor={strokeColor}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              buttonPositions={buttonPositions}
              setButtonPositions={setButtonPositions}
              selectedLayerType={selectedLayerType}
              setSelectedLayerType={setSelectedLayerType}
              applyFilter={applyFilter}
              applyFinalFilter={applyFinalFilter}
              onChange={handleBubbleChange}
              pencilColor={pencilColor}
              pencilWidth={pencilWidth}
              eraserWidth={eraserWidth}
              sessionId={id}
              selectedLayerId={selectedLayerId}
              exportAnimationFrames={() => { }}
              currentLayerSeek={currentLayerSeek}
              isVideoPreviewPlaying={isPreviewPlaybackActive}
              currentLayer={currentLayer}
              updateSessionActiveItemList={updateSessionLayerActiveItemList}
              selectedLayerSelectShape={selectedLayerSelectShape}
              setCurrentView={setCurrentView}
              isLayerSeeking={isLayerSeeking}
              setEnableSegmentationMask={setEnableSegmentationMask}
              enableSegmentationMask={enableSegmentationMask}
              segmentationData={segmentationData}
              setSegmentationData={setSegmentationData}
              isExpressGeneration={isExpressGeneration}
              removeVideoLayer={removeAIVideoLayer}
              aspectRatio={aspectRatio}
              isAIVideoGenerationPending={isAIVideoGenerationPending}
              toggleStageZoom={toggleStageZoom}
              stageZoomScale={stageZoomScale}
              requestRegenerateSubtitles={requestRegenerateSubtitles}
              displayZoomType={displayZoomType}
              aiVideoLayer={currentVideoLayerState.url}
              aiVideoLayerType={currentVideoLayerState.type}
              nextAiVideoLayer={nextVideoLayerState.url}
              nextAiVideoLayerType={nextVideoLayerState.type}
              requestRegenerateAnimations={requestRegenerateAnimations}
              requestRealignLayers={requestReAlignLayersToSpeechAndRegenerateSubtitles}
              totalDuration={totalDuration}
              selectedEditModelValue={selectedEditModelValue}
              createTextLayer={createTextLayer}
              requestRealignToAiVideoAndLayers={requestRealignToAiVideoAndLayers}
              requestLipSyncToSpeech={requestLipSyncToSpeech}
              onPersistTextStyle={(nextStyle) =>
                setTextConfig((prev) => ({
                  ...(prev || {}),
                  ...(nextStyle || {}),
                }))
              }
              setPromptText={setPromptText}
              promptText={promptText}
              submitGenerateRequest={submitGenerateRequest}
              isGenerationPending={isGenerationPending}
              selectedGenerationModel={selectedGenerationModel}
              setSelectedGenerationModel={setSelectedGenerationModel}
              generationError={generationError}

              submitGenerateNewRequest={submitGenerateNewRequest}
              isUpdateLayerPending={isUpdateLayerPending}
              setSelectedVideoGenerationModel={setSelectedVideoGenerationModel}
              selectedVideoGenerationModel={selectedVideoGenerationModel}
              submitGenerateNewVideoRequest={submitGenerateNewAIVideoRequest}

              videoPromptText={videoPromptText}
              setVideoPromptText={setVideoPromptText}

              openUploadDialog={openUploadDialog}
              rightPanelView={rightPanelView}
              isRightPanelExpanded={isRightPanelExpanded}
              downloadCurrentFrame={downloadCurrentFrame}
            />


          </div>
        );
      }
    }
  }

  const editorToolbarExpanded = (
    <VideoEditorToolbar
      promptText={promptText}
      setPromptText={setPromptText}
      setVideoPromptText={setVideoPromptText}
      videoPromptText={videoPromptText}
      submitGenerateRequest={submitGenerateRequest}
      submitOutpaintRequest={submitOutpaintRequest}
      showAttestationDialog={() => { }}
      selectedChain={selectedChain}
      setSelectedChain={setSelectedChain}
      selectedAllocation={selectedAllocation}
      setSelectedAllocation={setSelectedAllocation}
      showTemplatesSelect={showTemplatesSelect}
      addTextBoxToCanvas={addTextBoxToCanvas}
      showMask={false}
      setShowMask={() => { }}
      editBrushWidth={editBrushWidth}
      setEditBrushWidth={setEditBrushWidth}
      setCurrentViewDisplay={setCurrentViewDisplay}
      currentViewDisplay={currentView}
      onToolbarViewChange={setRightPanelView}
      textConfig={textConfig}
      setTextConfig={setTextConfig}
      activeItemList={activeItemList}
      setActiveItemList={setActiveItemList}
      selectedGenerationModel={selectedGenerationModel}
      setSelectedGenerationModel={setSelectedGenerationModel}
      selectedEditModel={selectedEditModel}
      setSelectedEditModel={setSelectedEditModel}
      isGenerationPending={isGenerationPending}
      isOutpaintPending={isOutpaintPending}
      isPublicationPending={isPublicationPending}
      setSelectedShape={setSelectedShape}
      fillColor={fillColor}
      setFillColor={setFillColor}
      strokeColor={strokeColor}
      setStrokeColor={setStrokeColor}
      strokeWidthValue={strokeWidthValue}
      setStrokeWidthValue={setStrokeWidthValue}
      generationError={generationError}
      outpaintError={outpaintError}
      selectedId={selectedId}
      setSelectedId={setSelectedId}
      aiVideoLayerType={aiVideoLayerType}
      exportAnimationFrames={() => { }}
      showMoveAction={() => { }}
      showResizeAction={() => { }}
      showSaveAction={() => { }}
      showUploadAction={() => openUploadDialog({ closeView: true })}
      pencilWidth={pencilWidth}
      setPencilWidth={setPencilWidth}
      pencilColor={pencilColor}
      setPencilColor={setPencilColor}
      eraserWidth={eraserWidth}
      setEraserWidth={setEraserWidth}
      cursorSelectOptionVisible={cursorSelectOptionVisible}
      setCursorSelectOptionVisible={setCursorSelectOptionVisible}
      setCurrentCanvasAction={setCurrentCanvasAction}
      currentCanvasAction={currentCanvasAction}
      selectedLayerSelectShape={selectedLayerSelectShape}
      setSelectedLayerSelectShape={setSelectedLayerSelectShape}
      updateSessionLayerActiveItemList={updateSessionLayerActiveItemList}
      updateSessionLayerActiveItemListAnimations={updateSessionLayerActiveItemListAnimations}
      eraserOptionsVisible={eraserOptionsVisible}
      submitGenerateMusicRequest={submitGenerateMusicRequest}
      audioLayers={videoSessionDetails.audioLayers}
      audioGenerationPending={audioGenerationPending}
      submitAddTrackToProject={submitAddTrackToProject}
      combineCurrentLayerItems={combineCurrentLayerItems}
      showAddAudioToProjectDialog={showAddAudioToProjectDialog}
      sessionDetails={videoSessionDetails}
      submitUpdateSessionDefaults={submitUpdateSessionDefaults}
      isUpdateDefaultsPending={isUpdateDefaultsPending}
      hideItemInLayer={toggleHideItemInLayer}
      applyAnimationToAllLayers={applyAnimationToAllLayers}
      submitGenerateLayeredSpeechRequest={submitGenerateLayeredSpeechRequest}
      currentDefaultPrompt={currentLayerDefaultPrompt}
      submitGenerateRecreateRequest={submitGenerateRecreateRequest}
      submitGenerateNewRequest={submitGenerateNewRequest}
      setShowCreateNewPromptDisplay={setShowCreateNewPromptDisplay}
      showCreateNewPromptDisplay={showCreateNewPromptDisplay}
      showCreateNewPrompt={showCreateNewPrompt}
      submitGenerateNewVideoRequest={submitGenerateNewAIVideoRequest}
      selectedVideoGenerationModel={selectedVideoGenerationModel}
      setSelectedVideoGenerationModel={setSelectedVideoGenerationModel}
      zoomCanvasIn={zoomCanvasIn}
      zoomCanvasOut={zoomCanvasOut}
      resetCanvasZoom={resetCanvasZoom}
      canvasZoomPercent={canvasZoomPercent}
      canZoomInCanvas={canZoomInCanvas}
      canZoomOutCanvas={canZoomOutCanvas}
      aiVideoGenerationPending={isAIVideoGenerationPending}
      aspectRatio={aspectRatio}
      setAdvancedSessionTheme={setAdvancedSessionTheme}
      requestAddAudioLayerFromLibrary={requestAddAudioLayerFromLibrary}
      requestAddGlobalAudioLayerFromLibrary={requestAddGlobalAudioLayerFromLibrary}
      setVideoSessionDetails={setVideoSessionDetails}
      currentLayerSeek={currentLayerSeek}
      setCurrentLayerSeek={setCurrentLayerSeek}
      isVideoPreviewPlaying={isVideoPreviewPlaying}
      setIsVideoPreviewPlaying={setIsVideoPreviewPlaying}
      onRecordSpeechRecordingChange={onRecordSpeechRecordingChange}
      onSetAvatarHints={onSetAvatarHints}
      selectedEditModelValue={selectedEditModelValue}
      submitAddBatchTrackToProject={submitAddBatchTrackToProject}
      currentLayer={currentLayer}
      requestLipSyncToSpeech={requestLipSyncToSpeech}
      removeVideoLayer={removeAIVideoLayer}
      isSelectButtonDisabled={isSelectButtonDisabled}
      currentLayerHasSpeechLayer={currentLayerHasSpeechLayer}
      requestAddSyncedSoundEffect={requestAddSyncedSoundEffect}

      movieSoundList={movieSoundList}
      movieVisualList={movieVisualList}
      movieGenSpeakers={movieGenSpeakers}
      updateMovieGenSpeakers={updateMovieGenSpeakers}
      isRenderPending={isRenderPending}
      onExpandedChange={setIsRightPanelExpanded}
    />
  )


  const mainWorkspaceShell =
    colorMode === 'dark'
      ? 'bg-[#0b1021] text-slate-100'
      : 'bg-gradient-to-br from-[#e9edf7] via-[#eef3fb] to-white text-slate-900';

  return (
    <div className={`${mainWorkspaceShell} flex h-full min-h-0`}>
      <div
        className={`min-h-0 min-w-0 flex-1 overflow-auto px-6 py-6 text-center ${disabledShellClass}`}
        aria-disabled={isRenderPending}
      >
        <div className="grid h-max min-h-full w-max min-w-full place-items-center overflow-visible">
          {viewDisplay}
        </div>
      </div>
      {editorToolbarExpanded}
    </div>
  );
}
