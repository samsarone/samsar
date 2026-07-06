import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { useParams } from 'react-router-dom';
import { toast, ToastContainer } from 'react-toastify';
import { FaCheck, FaTimes } from 'react-icons/fa';

import { useAlertDialog } from '../../contexts/AlertDialogContext.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { NavCanvasControlContext } from '../../contexts/NavCanvasControlContext.jsx';
import { useUser } from '../../contexts/UserContext.jsx';
import { getHeaders } from '../../utils/web.jsx';
import {
  CURRENT_TOOLBAR_VIEW,
  TOOLBAR_ACTION_VIEW,
  IMAGE_EDIT_MODEL_TYPES,
} from '../../constants/Types.ts';
import {
  getTextConfigForCanvas,
  normalizeActiveTextItemListForCanvas,
} from '../../constants/TextConfig.jsx';
import {
  findAspectRatioOptionForCanvasDimensions,
  findClosestAspectRatioOption,
  fitDimensionsToCanvas,
  getCanvasDimensionsForAspectRatio,
  getSimplifiedAspectRatioLabel,
  isSupportedAspectRatioOptionValue,
  MAX_CANVAS_DIMENSION,
  MIN_CANVAS_DIMENSION,
  normalizeCanvasDimensions,
} from '../../utils/canvas.jsx';
import { getRenderableImageUrl } from '../../utils/image.jsx';
import {
  captureAssistantStageImageData,
  captureStageCanvas,
} from '../../utils/assistantFrameCapture.js';
import { imageAspectRatioOptions } from '../../constants/ImageAspectRatios.js';
import useUndoRedoState from '../../hooks/useUndoRedoState.js';

import CommonContainer from '../common/CommonContainer.tsx';
import AuthContainer, { AUTH_DIALOG_OPTIONS } from '../auth/AuthContainer.jsx';
import LoadingImage from '../video/util/LoadingImage.jsx';
import LoadingImageBase from '../video/util/LoadingImageBase.jsx';
import VideoCanvasContainer from '../video/editor/VideoCanvasContainer.jsx';
import ImageLibraryHome from '../library/image/ImageLibraryHome.jsx';
import ImageEditorToolbar from './ImageEditorToolbar.jsx';
import AssistantHome from '../assistant/AssistantHome.jsx';
import ImageUploadDialog from './ImageUploadDialog.jsx';
import ImageDownloadDialog from './ImageDownloadDialog.jsx';
import SingleSelect from '../common/SingleSelect.jsx';

import 'react-toastify/dist/ReactToastify.css';
import '../video/toolbars/editorToolbar.css';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;
const IMAGE_LIBRARY_PAGE_SIZE = 40;
const CUSTOM_CANVAS_OPTION_VALUE = '__custom_canvas__';
const IMAGE_STUDIO_CANVAS_ZOOM_MODE_STORAGE_KEY = 'imageStudioCanvasZoomMode';
const IMAGE_STUDIO_CANVAS_ZOOM_SCALE_STORAGE_KEY = 'imageStudioCanvasZoomScale';
const IMAGE_STUDIO_CANVAS_ZOOM_STEP = 0.25;
const IMAGE_STUDIO_CANVAS_ZOOM_MIN = 0.5;
const IMAGE_STUDIO_CANVAS_ZOOM_MAX = 4;

function firstStringValue(values = []) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function clampImageStudioCanvasZoom(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 1;
  }

  return Math.min(Math.max(numericValue, IMAGE_STUDIO_CANVAS_ZOOM_MIN), IMAGE_STUDIO_CANVAS_ZOOM_MAX);
}

function EditImageProjectDialogContent({
  aspectRatio,
  canvasDimensions,
  aspectRatioOptions,
  colorMode,
  onClose,
  onSave,
}) {
  const normalizedCurrentCanvasDimensions = useMemo(
    () => normalizeCanvasDimensions(canvasDimensions, aspectRatio || '1:1'),
    [aspectRatio, canvasDimensions]
  );
  const matchingCanvasAspectRatioOption = useMemo(
    () => findAspectRatioOptionForCanvasDimensions(normalizedCurrentCanvasDimensions, aspectRatioOptions),
    [aspectRatioOptions, normalizedCurrentCanvasDimensions]
  );

  const [selectedCanvasOption, setSelectedCanvasOption] = useState(
    matchingCanvasAspectRatioOption?.value || CUSTOM_CANVAS_OPTION_VALUE
  );
  const [customCanvasWidth, setCustomCanvasWidth] = useState(
    String(normalizedCurrentCanvasDimensions.width)
  );
  const [customCanvasHeight, setCustomCanvasHeight] = useState(
    String(normalizedCurrentCanvasDimensions.height)
  );
  const [isSaving, setIsSaving] = useState(false);

  const aspectRatioOptionsWithResolution = useMemo(
    () =>
      (aspectRatioOptions || []).map((option) => {
        const dimensions = getCanvasDimensionsForAspectRatio(option.value);
        return {
          ...option,
          label: `${option.label} - ${dimensions.width} x ${dimensions.height}`,
        };
      }),
    [aspectRatioOptions]
  );

  const projectCanvasOptions = useMemo(
    () => [
      ...aspectRatioOptionsWithResolution,
      { value: CUSTOM_CANVAS_OPTION_VALUE, label: 'Custom' },
    ],
    [aspectRatioOptionsWithResolution]
  );

  const selectedCanvasDimensions = useMemo(
    () =>
      selectedCanvasOption === CUSTOM_CANVAS_OPTION_VALUE
        ? {
            width: Number.isFinite(Number(customCanvasWidth))
              ? Math.round(Number(customCanvasWidth))
              : normalizedCurrentCanvasDimensions.width,
            height: Number.isFinite(Number(customCanvasHeight))
              ? Math.round(Number(customCanvasHeight))
              : normalizedCurrentCanvasDimensions.height,
          }
        : getCanvasDimensionsForAspectRatio(selectedCanvasOption),
    [
      customCanvasHeight,
      customCanvasWidth,
      normalizedCurrentCanvasDimensions.height,
      normalizedCurrentCanvasDimensions.width,
      selectedCanvasOption,
    ]
  );

  const selectedCanvasOptionValue = useMemo(
    () =>
      projectCanvasOptions.find((option) => option.value === selectedCanvasOption) ||
      projectCanvasOptions[0] ||
      null,
    [projectCanvasOptions, selectedCanvasOption]
  );

  const validationMessage = useMemo(() => {
    if (selectedCanvasOption !== CUSTOM_CANVAS_OPTION_VALUE) {
      return null;
    }

    const parsedWidth = Number(customCanvasWidth);
    const parsedHeight = Number(customCanvasHeight);

    if (!Number.isFinite(parsedWidth) || !Number.isFinite(parsedHeight)) {
      return 'Enter both width and height.';
    }

    if (parsedWidth < MIN_CANVAS_DIMENSION || parsedHeight < MIN_CANVAS_DIMENSION) {
      return `Canvas dimensions must be at least ${MIN_CANVAS_DIMENSION}px.`;
    }

    if (parsedWidth > MAX_CANVAS_DIMENSION || parsedHeight > MAX_CANVAS_DIMENSION) {
      return `Canvas dimensions must be ${MAX_CANVAS_DIMENSION}px or smaller.`;
    }

    return null;
  }, [customCanvasHeight, customCanvasWidth, selectedCanvasOption]);

  const resolvedAspectRatio = useMemo(() => {
    if (selectedCanvasOption !== CUSTOM_CANVAS_OPTION_VALUE) {
      return selectedCanvasOption;
    }

    return (
      (isSupportedAspectRatioOptionValue(aspectRatio, aspectRatioOptions) && aspectRatio) ||
      findClosestAspectRatioOption(selectedCanvasDimensions, aspectRatioOptions)?.value ||
      aspectRatioOptions?.[0]?.value ||
      '1:1'
    );
  }, [aspectRatio, aspectRatioOptions, selectedCanvasDimensions, selectedCanvasOption]);

  const dialogSurface =
    colorMode === 'dark'
      ? 'bg-[#0f172a] text-slate-100 border border-[#1f2a3d]'
      : 'bg-white text-slate-900 border border-slate-200';
  const dialogInputSurface =
    colorMode === 'dark'
      ? 'bg-slate-900 border-slate-700 text-slate-100'
      : 'bg-white border-slate-300 text-slate-900';
  const dialogSecondaryButton =
    colorMode === 'dark'
      ? 'bg-[#17253f] text-slate-100 hover:bg-[#1c3153]'
      : 'bg-slate-100 text-slate-800 hover:bg-white';
  const dialogPrimaryButton =
    colorMode === 'dark'
      ? 'bg-rose-500 text-white hover:bg-rose-400'
      : 'bg-rose-500 text-white hover:bg-rose-600';
  const dialogSubtleText = colorMode === 'dark' ? 'text-slate-300' : 'text-slate-600';

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    if (validationMessage) return;
    setIsSaving(true);
    try {
      await onSave?.({
        aspectRatio: resolvedAspectRatio,
        canvasDimensions: selectedCanvasDimensions,
      });
      onClose?.();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`relative w-full max-w-md rounded-2xl p-6 shadow-[0_20px_46px_rgba(0,0,0,0.5)] ${dialogSurface}`}>
      <FaTimes className="absolute top-3 right-3 cursor-pointer" onClick={onClose} />
      <form onSubmit={handleSubmit}>
        <div className="text-lg font-semibold">Edit project</div>
        <div className={`mt-1 text-sm ${dialogSubtleText}`}>
          Update your project parameters.
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Canvas preset</label>
            <SingleSelect
              options={projectCanvasOptions}
              onChange={(selectedOption) => {
                if (!selectedOption?.value) return;
                setSelectedCanvasOption(selectedOption.value);
              }}
              value={selectedCanvasOptionValue}
              isSearchable={false}
            />
          </div>

          {selectedCanvasOption === CUSTOM_CANVAS_OPTION_VALUE && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="edit-project-canvas-width">
                  Width
                </label>
                <input
                  id="edit-project-canvas-width"
                  type="number"
                  min={MIN_CANVAS_DIMENSION}
                  max={MAX_CANVAS_DIMENSION}
                  step="1"
                  value={customCanvasWidth}
                  onChange={(event) => setCustomCanvasWidth(event.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${dialogInputSurface}`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2" htmlFor="edit-project-canvas-height">
                  Height
                </label>
                <input
                  id="edit-project-canvas-height"
                  type="number"
                  min={MIN_CANVAS_DIMENSION}
                  max={MAX_CANVAS_DIMENSION}
                  step="1"
                  value={customCanvasHeight}
                  onChange={(event) => setCustomCanvasHeight(event.target.value)}
                  className={`w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${dialogInputSurface}`}
                />
              </div>
            </div>
          )}

          <div className={`rounded-lg border px-3 py-3 text-sm ${dialogInputSurface}`}>
            <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
              Canvas resolution
            </div>
            <div className="mt-1 font-semibold">
              {selectedCanvasDimensions.width} x {selectedCanvasDimensions.height} px
            </div>
            {selectedCanvasOption === CUSTOM_CANVAS_OPTION_VALUE && (
              <div className="mt-1 text-xs opacity-80">
                Custom ratio {getSimplifiedAspectRatioLabel(selectedCanvasDimensions)}. Default model ratio stays at {resolvedAspectRatio}.
              </div>
            )}
            {validationMessage && (
              <div className="mt-2 text-xs text-rose-500">{validationMessage}</div>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className={`px-3 py-2 rounded-md text-sm transition disabled:opacity-60 ${dialogSecondaryButton}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSaving || Boolean(validationMessage)}
            className={`px-4 py-2 rounded-md text-sm font-semibold transition disabled:opacity-60 ${dialogPrimaryButton}`}
          >
            {isSaving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function ImageStudioHome() {
  const {
    setZoomCanvasIn,
    setZoomCanvasOut,
    setResetCanvasZoom,
    setCanvasZoomPercent,
    setCanZoomInCanvas,
    setCanZoomOutCanvas,
  } = useContext(NavCanvasControlContext);
  const { id } = useParams();
  const { colorMode } = useColorMode();
  const { getUserAPI } = useUser();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();

  const [sessionDetails, setSessionDetails] = useState(null);
  const [currentLayer, setCurrentLayer] = useState(null);
  const {
    state: activeItemList,
    setState: setActiveItemList,
    syncState: syncActiveItemList,
    undo: undoActiveItemList,
    redo: redoActiveItemList,
    canUndo,
    canRedo,
    undoCount,
    redoCount,
    historyLimit,
  } = useUndoRedoState([], { limit: 5 });
  const [generationImages, setGenerationImages] = useState([]);
  const [sessionMessages, setSessionMessages] = useState([]);
  const [globalLibraryImages, setGlobalLibraryImages] = useState([]);
  const [isGlobalLibraryLoading, setIsGlobalLibraryLoading] = useState(false);
  const [globalLibraryError, setGlobalLibraryError] = useState(null);
  const [globalLibraryPagination, setGlobalLibraryPagination] = useState({
    page: 1,
    pageSize: IMAGE_LIBRARY_PAGE_SIZE,
    totalItems: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });

  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [generationAspectRatio, setGenerationAspectRatio] = useState('1:1');

  const [promptText, setPromptText] = useState('');
  const [selectedGenerationModel, setSelectedGenerationModel] = useState('NANOBANANA2');
  const [selectedEditModel, setSelectedEditModel] = useState(
    'NANOBANANA2EDIT'
  );
  const [selectedEditModelValue, setSelectedEditModelValue] = useState(
    IMAGE_EDIT_MODEL_TYPES.find((model) => model.key === selectedEditModel)
  );

  const [currentView, setCurrentView] = useState(CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_DISPLAY);
  const [currentCanvasAction, setCurrentCanvasAction] = useState(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
  const [textConfig, setTextConfig] = useState(null);
  const [addText, setAddText] = useState('');

  const [editBrushWidth, setEditBrushWidth] = useState(25);
  const [editMasklines, setEditMaskLines] = useState([]);

  const [isGenerationPending, setIsGenerationPending] = useState(false);
  const [isOutpaintPending, setIsOutpaintPending] = useState(false);
  const [isAssistantQueryGenerating, setIsAssistantQueryGenerating] = useState(false);
  const [generationError, setGenerationError] = useState(null);
  const [outpaintError, setOutpaintError] = useState(null);

  const [selectedId, setSelectedId] = useState(null);
  const [selectedLayerType, setSelectedLayerType] = useState(null);
  const [buttonPositions, setButtonPositions] = useState([]);
  const [selectedLayerSelectShape] = useState(null);

  const [pencilWidth, setPencilWidth] = useState(10);
  const [pencilColor, setPencilColor] = useState('#000000');
  const [eraserWidth, setEraserWidth] = useState(30);

  const [fillColor] = useState(colorMode === 'dark' ? '#e9edf7' : '#0b1226');
  const [strokeColor] = useState(colorMode === 'dark' ? '#e9edf7' : '#0b1226');

  const canvasRef = useRef(null);
  const canvasViewportRef = useRef(null);
  const canvasSurfaceRef = useRef(null);
  const [canvasZoomMode, setCanvasZoomMode] = useState(() => {
    if (typeof window === 'undefined') {
      return 'fit';
    }

    return window.localStorage.getItem(IMAGE_STUDIO_CANVAS_ZOOM_MODE_STORAGE_KEY) === 'manual'
      ? 'manual'
      : 'fit';
  });
  const [canvasZoomScale, setCanvasZoomScale] = useState(() => {
    if (typeof window === 'undefined') {
      return 1;
    }

    return clampImageStudioCanvasZoom(
      window.localStorage.getItem(IMAGE_STUDIO_CANVAS_ZOOM_SCALE_STORAGE_KEY)
    );
  });
  const [canvasDisplayScale, setCanvasDisplayScale] = useState(1);
  const [canvasDisplaySize, setCanvasDisplaySize] = useState({ width: null, height: null });
  const [isCanvasDragActive, setIsCanvasDragActive] = useState(false);
  const [isCanvasDropProcessing, setIsCanvasDropProcessing] = useState(false);
  const canvasDragDepthRef = useRef(0);

  const generationPollIntervalRef = useRef(null);
  const outpaintPollIntervalRef = useRef(null);
  const assistantPollRef = useRef(null);
  const assistantErrorCountRef = useRef(0);
  const currentLayerRef = useRef(null);
  const activeItemListRef = useRef([]);
  const previousSyncedLayerIdRef = useRef(null);
  const latestActiveItemListSaveRequestRef = useRef(0);
  const isHistoryInteractionBlocked =
    currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY ||
    currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY;
  const isCanvasHistoryHotkeyEnabled = !isHistoryInteractionBlocked;

  const resolvedCanvasDimensions = useMemo(
    () => normalizeCanvasDimensions(sessionDetails?.canvasDimensions, aspectRatio),
    [aspectRatio, sessionDetails?.canvasDimensions]
  );
  const isCanvasManualZoom = canvasZoomMode === 'manual';
  const canvasZoomPercent = Math.round(canvasZoomScale * 100);
  const canZoomInCanvas = canvasZoomScale < IMAGE_STUDIO_CANVAS_ZOOM_MAX - 0.001;
  const canZoomOutCanvas = canvasZoomScale > IMAGE_STUDIO_CANVAS_ZOOM_MIN + 0.001;

  const zoomCanvasIn = useCallback(() => {
    setCanvasZoomMode('manual');
    setCanvasZoomScale((prevScale) => clampImageStudioCanvasZoom(prevScale + IMAGE_STUDIO_CANVAS_ZOOM_STEP));
  }, []);

  const zoomCanvasOut = useCallback(() => {
    setCanvasZoomMode('manual');
    setCanvasZoomScale((prevScale) => clampImageStudioCanvasZoom(prevScale - IMAGE_STUDIO_CANVAS_ZOOM_STEP));
  }, []);

  const resetCanvasZoom = useCallback(() => {
    setCanvasZoomMode('fit');
    setCanvasZoomScale(1);
  }, []);

  useEffect(() => {
    setZoomCanvasIn(() => zoomCanvasIn);
    setZoomCanvasOut(() => zoomCanvasOut);
    setResetCanvasZoom(() => resetCanvasZoom);
  }, [resetCanvasZoom, setResetCanvasZoom, setZoomCanvasIn, setZoomCanvasOut, zoomCanvasIn, zoomCanvasOut]);

  useEffect(() => {
    setCanvasZoomPercent(canvasZoomPercent);
    setCanZoomInCanvas(canZoomInCanvas);
    setCanZoomOutCanvas(canZoomOutCanvas);
  }, [
    canvasZoomPercent,
    canZoomInCanvas,
    canZoomOutCanvas,
    setCanvasZoomPercent,
    setCanZoomInCanvas,
    setCanZoomOutCanvas,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(
      IMAGE_STUDIO_CANVAS_ZOOM_MODE_STORAGE_KEY,
      isCanvasManualZoom ? 'manual' : 'fit'
    );
    window.localStorage.setItem(
      IMAGE_STUDIO_CANVAS_ZOOM_SCALE_STORAGE_KEY,
      String(canvasZoomScale)
    );
  }, [canvasZoomScale, isCanvasManualZoom]);

  useEffect(() => {
    setTextConfig((prev) => {
      const defaultConfig = getTextConfigForCanvas(prev, resolvedCanvasDimensions);
      return {
        ...defaultConfig,
        x: resolvedCanvasDimensions.width / 2,
        y: resolvedCanvasDimensions.height / 2,
      };
    });
  }, [resolvedCanvasDimensions.height, resolvedCanvasDimensions.width]);

  useEffect(() => {
    currentLayerRef.current = currentLayer;
  }, [currentLayer]);

  useEffect(() => {
    activeItemListRef.current = activeItemList;
  }, [activeItemList]);

  const getPreferredGenerationAspectRatio = useCallback(
    (nextAspectRatio, nextCanvasDimensions) => {
      if (isSupportedAspectRatioOptionValue(nextAspectRatio, imageAspectRatioOptions)) {
        return nextAspectRatio;
      }

      return (
        findClosestAspectRatioOption(nextCanvasDimensions, imageAspectRatioOptions)?.value ||
        imageAspectRatioOptions?.[0]?.value ||
        '1:1'
      );
    },
    []
  );

  const showLoginDialog = () => {
    const redirectPath = id ? `/image/studio/${id}` : '/image/studio';
    openAlertDialog(<AuthContainer redirectTo={redirectPath} />, undefined, false, AUTH_DIALOG_OPTIONS);
  };

  useEffect(() => {
    setSelectedEditModelValue(
      IMAGE_EDIT_MODEL_TYPES.find((model) => model.key === selectedEditModel)
    );
  }, [selectedEditModel]);

  useEffect(() => {
    if (
      currentView !== CURRENT_TOOLBAR_VIEW.SHOW_EDIT_DISPLAY ||
      (selectedEditModelValue && selectedEditModelValue.editType !== 'inpaint')
    ) {
      setEditMaskLines([]);
    }
  }, [currentView, selectedEditModelValue]);

  useEffect(() => {
    const preferredAspectRatio = getPreferredGenerationAspectRatio(
      aspectRatio,
      resolvedCanvasDimensions
    );
    setGenerationAspectRatio(preferredAspectRatio);
  }, [
    aspectRatio,
    getPreferredGenerationAspectRatio,
    resolvedCanvasDimensions.height,
    resolvedCanvasDimensions.width,
  ]);

  useEffect(() => {
    if (!id) return;
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    axios
      .get(`${PROCESSOR_API_URL}/image_sessions/session_details?id=${id}`, headers)
      .then((response) => {
        const session = response.data;
        setSessionDetails(session);
        setSessionMessages(session?.sessionMessages || []);
        setAspectRatio(session?.aspectRatio || '1:1');
        setGenerationImages(session?.generations || []);
        const firstLayer = session?.layers?.[0] || null;
        setCurrentLayer(firstLayer);
        if (firstLayer?.imageSession?.activeItemList) {
          syncActiveItemList(firstLayer.imageSession.activeItemList, {
            resetHistory: true,
          });
        } else {
          syncActiveItemList([], { resetHistory: true });
        }
      })
      .catch(() => {
        toast.error(
          <div>
            <FaTimes /> Unable to load image session.
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  }, [id, syncActiveItemList]);

  const stopAssistantQueryPoll = useCallback(() => {
    if (assistantPollRef.current) {
      clearInterval(assistantPollRef.current);
      assistantPollRef.current = null;
    }
    assistantErrorCountRef.current = 0;
  }, []);

  useEffect(() => {
    return () => {
      stopAssistantQueryPoll();
    };
  }, [stopAssistantQueryPoll]);

  const startAssistantQueryPoll = useCallback(() => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    stopAssistantQueryPoll();
    assistantPollRef.current = setInterval(() => {
      axios
        .get(`${PROCESSOR_API_URL}/assistants/assistant_query_status?id=${id}`, headers)
        .then((dataRes) => {
          assistantErrorCountRef.current = 0;
          const assistantQueryData = dataRes.data;
          if (assistantQueryData.status === 'COMPLETED') {
            stopAssistantQueryPoll();
            setSessionMessages(assistantQueryData?.sessionDetails?.sessionMessages || []);
            setIsAssistantQueryGenerating(false);
          }
        })
        .catch(() => {
          assistantErrorCountRef.current += 1;
          if (assistantErrorCountRef.current >= 3) {
            stopAssistantQueryPoll();
            setIsAssistantQueryGenerating(false);
          }
        });
    }, 1000);
  }, [id, stopAssistantQueryPoll]);

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

  const submitAssistantQuery = useCallback((query, options = {}) => {
    const normalizedQuery = `${query || ''}`.trim();
    if (!normalizedQuery) return;

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    setIsAssistantQueryGenerating(true);
    axios
      .post(
        `${PROCESSOR_API_URL}/assistants/submit_assistant_query`,
        {
          id,
          query: normalizedQuery,
          frameImage: options?.frameImage || null,
        },
        headers
      )
      .then(() => {
        startAssistantQueryPoll();
      })
      .catch(() => {
        setIsAssistantQueryGenerating(false);
      });
  }, [id, startAssistantQueryPoll]);

  useEffect(() => {
    setGlobalLibraryImages([]);
    setIsGlobalLibraryLoading(false);
    setGlobalLibraryError(null);
    setGlobalLibraryPagination({
      page: 1,
      pageSize: IMAGE_LIBRARY_PAGE_SIZE,
      totalItems: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    });
  }, [id]);

  useEffect(() => {
    const currentLayerId = currentLayer?._id?.toString?.() || null;
    const shouldReuseLocalTextConfig =
      currentLayerId && previousSyncedLayerIdRef.current === currentLayerId;

    if (currentLayer?.imageSession?.activeItemList) {
      const normalizedItemList = normalizeActiveTextItemListForCanvas(
        currentLayer.imageSession.activeItemList,
        resolvedCanvasDimensions,
        shouldReuseLocalTextConfig ? activeItemListRef.current : [],
        { preferFallbackTextConfig: shouldReuseLocalTextConfig }
      );
      activeItemListRef.current = normalizedItemList;
      syncActiveItemList(normalizedItemList, {
        resetHistory: true,
      });
    } else {
      activeItemListRef.current = [];
      syncActiveItemList([], { resetHistory: true });
    }
    previousSyncedLayerIdRef.current = currentLayerId;
  }, [currentLayer?._id, resolvedCanvasDimensions, syncActiveItemList]);

  useEffect(() => {
    return () => {
      if (generationPollIntervalRef.current) clearTimeout(generationPollIntervalRef.current);
      if (outpaintPollIntervalRef.current) clearTimeout(outpaintPollIntervalRef.current);
    };
  }, []);

  const updateSessionLayerActiveItemList = (newActiveItemList) => {
    if (!currentLayer) return;
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const requestLayerId = currentLayer._id.toString();
    const requestId = latestActiveItemListSaveRequestRef.current + 1;
    latestActiveItemListSaveRequestRef.current = requestId;

    const payload = {
      sessionId: id,
      layerId: requestLayerId,
      activeItemList: newActiveItemList,
    };
    activeItemListRef.current = newActiveItemList;
    axios
      .post(`${PROCESSOR_API_URL}/image_sessions/update_active_item_list`, payload, headers)
      .then((response) => {
        if (requestId !== latestActiveItemListSaveRequestRef.current) {
          return;
        }

        const { session, layer } = response.data || {};
        if (session) {
          setSessionDetails(session);
          setGenerationImages(session.generations || []);
        }
        if (layer && currentLayerRef.current?._id?.toString?.() === requestLayerId) {
          setCurrentLayer(layer);
          if (layer?.imageSession?.activeItemList) {
            const normalizedItemList = normalizeActiveTextItemListForCanvas(
              layer.imageSession.activeItemList,
              resolvedCanvasDimensions,
              newActiveItemList,
              { preferFallbackTextConfig: true }
            );
            activeItemListRef.current = normalizedItemList;
            syncActiveItemList(normalizedItemList);
          } else {
            activeItemListRef.current = [];
            syncActiveItemList([]);
          }
        }
      })
      .catch(() => {});
  };

  const syncSelectionWithItemList = useCallback(
    (nextItemList) => {
      const selectedItem = (nextItemList || []).find((item) => item?.id === selectedId) || null;

      if (!selectedItem) {
        setSelectedId(null);
        setSelectedLayerType(null);
        return;
      }

      setSelectedLayerType(selectedItem.type || null);
    },
    [selectedId]
  );

  const handleUndoHistory = useCallback(() => {
    if (!canUndo || isHistoryInteractionBlocked) {
      return;
    }

    const nextItemList = undoActiveItemList();
    syncSelectionWithItemList(nextItemList);
    updateSessionLayerActiveItemList(nextItemList);
  }, [
    canUndo,
    isHistoryInteractionBlocked,
    syncSelectionWithItemList,
    undoActiveItemList,
    updateSessionLayerActiveItemList,
  ]);

  const handleRedoHistory = useCallback(() => {
    if (!canRedo || isHistoryInteractionBlocked) {
      return;
    }

    const nextItemList = redoActiveItemList();
    syncSelectionWithItemList(nextItemList);
    updateSessionLayerActiveItemList(nextItemList);
  }, [
    canRedo,
    isHistoryInteractionBlocked,
    redoActiveItemList,
    syncSelectionWithItemList,
    updateSessionLayerActiveItemList,
  ]);

  const shouldIgnoreHistoryShortcut = useCallback((target) => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const interactiveAncestor = target.closest(
      'input, textarea, select, button, [contenteditable="true"], [role="textbox"]'
    );

    return Boolean(interactiveAncestor);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      if (!isCanvasHistoryHotkeyEnabled) {
        return;
      }

      if (shouldIgnoreHistoryShortcut(event.target)) {
        return;
      }

      const key = `${event.key || ''}`.toLowerCase();

      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          handleRedoHistory();
        } else {
          handleUndoHistory();
        }
        return;
      }

      if (key === 'y') {
        event.preventDefault();
        handleRedoHistory();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    handleRedoHistory,
    handleUndoHistory,
    isCanvasHistoryHotkeyEnabled,
    shouldIgnoreHistoryShortcut,
  ]);

  const toggleHideItemInLayer = useCallback(
    (itemId) => {
      if (!itemId) return;
      const updatedItemList = activeItemList.map((item) => {
        if (item.id !== itemId) return item;
        return {
          ...item,
          isHidden: !item.isHidden,
        };
      });

      const selectedItem = updatedItemList.find((item) => item.id === itemId);
      if (selectedId === itemId && selectedItem?.isHidden) {
        setSelectedId(null);
      }

      setActiveItemList(updatedItemList);
      updateSessionLayerActiveItemList(updatedItemList);
    },
    [activeItemList, selectedId, updateSessionLayerActiveItemList]
  );

  const createTextLayer = useCallback(
    (payload) => {
      const normalizedText = `${payload?.text || ''}`.trim();
      if (!normalizedText) {
        return;
      }

      const nextTextItem = {
        type: 'text',
        text: normalizedText,
        id: `item_${activeItemList.length}`,
        config: getTextConfigForCanvas(
          {
            ...(textConfig || {}),
            ...(payload?.config || {}),
          },
          resolvedCanvasDimensions
        ),
      };

      const newItemList = [...activeItemList, nextTextItem];
      activeItemListRef.current = newItemList;
      setActiveItemList(newItemList);
      setSelectedId(nextTextItem.id);
      setSelectedLayerType('text');
      updateSessionLayerActiveItemList(newItemList);
    },
    [activeItemList, resolvedCanvasDimensions, textConfig, updateSessionLayerActiveItemList]
  );

  const createImageStudioImageItem = useCallback((imagePayload) => ({
    ...imagePayload,
    type: 'image',
  }), []);

  const setUploadURL = useCallback(
    (data, options = {}) => {
      const { closeDialog = true } = options;
      if (!data) return;
      const uploads = Array.isArray(data) ? data : [data];
      if (!uploads.length) return;

      const newItemList = [...activeItemList];
      let nextIndex = newItemList.length;
      let addedCount = 0;

      uploads.forEach((entry) => {
        if (!entry?.url) return;
        const newItemId = `item_${nextIndex}`;
        nextIndex += 1;
        newItemList.push({
          src: entry.url,
          id: newItemId,
          type: 'image',
          x: entry.x,
          y: entry.y,
          width: entry.width,
          height: entry.height,
          source: 'upload',
        });
        addedCount += 1;
      });

      if (newItemList.length === activeItemList.length) {
        return;
      }

      setActiveItemList(newItemList);
      updateSessionLayerActiveItemList(newItemList);
      if (closeDialog) {
        closeAlertDialog();
      }
      toast.success(
        <div>
          <FaCheck className="inline-flex mr-2" />{` ${addedCount} image${addedCount > 1 ? 's' : ''} uploaded.`}
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
    },
    [activeItemList, closeAlertDialog, updateSessionLayerActiveItemList]
  );

  const getRenderableImageSource = useCallback((source) => {
    if (!source || typeof source !== 'string') return '';
    if (source.startsWith('data:') || source.startsWith('http://') || source.startsWith('https://')) {
      return source;
    }
    const normalizedSource = source.startsWith('/') ? source.slice(1) : source;
    return `${PROCESSOR_API_URL}/${normalizedSource}`;
  }, []);

  const resolveCanvasImagePlacement = useCallback(
    (source) =>
      new Promise((resolve, reject) => {
        if (!source) {
          reject(new Error('Missing image source'));
          return;
        }

        const img = new Image();
        if (!source.startsWith('data:')) {
          img.crossOrigin = 'anonymous';
        }

        img.onload = () => {
          const placement = fitDimensionsToCanvas(
            { width: img.width, height: img.height },
            resolvedCanvasDimensions
          );

          resolve({
            url: source,
            width: placement.width,
            height: placement.height,
            x: placement.x,
            y: placement.y,
          });
        };
        img.onerror = () => reject(new Error('Unable to read image'));
        img.src = getRenderableImageSource(source);
      }),
    [getRenderableImageSource, resolvedCanvasDimensions]
  );

  const openUploadDialog = useCallback(() => {
    setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
    openAlertDialog(
      <div>
        <FaTimes className="absolute top-2 right-2 cursor-pointer" onClick={closeAlertDialog} />
        <ImageUploadDialog
          setUploadURL={setUploadURL}
          aspectRatio={aspectRatio}
          canvasDimensions={resolvedCanvasDimensions}
        />
      </div>
    );
  }, [aspectRatio, closeAlertDialog, openAlertDialog, resolvedCanvasDimensions, setUploadURL]);

  const isSupportedImageFile = useCallback((file) => {
    if (!file) return false;
    const fileName = file.name ? file.name.toLowerCase() : '';
    const isHeicFile = fileName.endsWith('.heic') || fileName.endsWith('.heif');
    const isWebpFile = fileName.endsWith('.webp');
    return Boolean(file.type && file.type.startsWith('image/')) || isHeicFile || isWebpFile;
  }, []);

  const resolveDroppedImagePlacement = useCallback(
    (dataUrl) => resolveCanvasImagePlacement(dataUrl),
    [resolveCanvasImagePlacement]
  );

  const processCanvasDropFiles = useCallback(
    async (fileList) => {
      const files = Array.from(fileList || []);
      if (!files.length) return;

      const validFiles = files.filter(isSupportedImageFile);
      if (!validFiles.length) {
        toast.error(
          <div>
            <FaTimes /> Please drop a supported image file.
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        return;
      }

      setIsCanvasDropProcessing(true);
      try {
        const dataUrls = await Promise.all(
          validFiles.map(
            (file) =>
              new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (event) => resolve(event.target?.result);
                reader.onerror = () => reject(new Error('Upload failed.'));
                reader.readAsDataURL(file);
              })
          )
        );

        const placements = await Promise.all(
          dataUrls.filter(Boolean).map((dataUrl) => resolveDroppedImagePlacement(dataUrl))
        );
        if (!placements.length) {
          throw new Error('No placements available');
        }

        setUploadURL(placements.length === 1 ? placements[0] : placements, {
          closeDialog: false,
        });
      } catch  {
        toast.error(
          <div>
            <FaTimes /> Upload failed. Please try another image.
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      } finally {
        setIsCanvasDropProcessing(false);
      }
    },
    [isSupportedImageFile, resolveDroppedImagePlacement, setUploadURL]
  );

  const hasDraggedFiles = useCallback((dataTransfer) => {
    if (!dataTransfer?.types) return false;
    return Array.from(dataTransfer.types).includes('Files');
  }, []);

  const handleCanvasDragEnter = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasDraggedFiles(event.dataTransfer)) return;
      canvasDragDepthRef.current += 1;
      setIsCanvasDragActive(true);
    },
    [hasDraggedFiles]
  );

  const handleCanvasDragOver = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!hasDraggedFiles(event.dataTransfer)) return;
      event.dataTransfer.dropEffect = 'copy';
    },
    [hasDraggedFiles]
  );

  const handleCanvasDragLeave = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      canvasDragDepthRef.current = Math.max(canvasDragDepthRef.current - 1, 0);
      if (canvasDragDepthRef.current === 0) {
        setIsCanvasDragActive(false);
      }
    },
    []
  );

  const handleCanvasDrop = useCallback(
    async (event) => {
      event.preventDefault();
      event.stopPropagation();
      canvasDragDepthRef.current = 0;
      setIsCanvasDragActive(false);
      const files = event.dataTransfer?.files;
      if (!files?.length) return;
      await processCanvasDropFiles(files);
    },
    [processCanvasDropFiles]
  );

  const selectImageFromLibrary = useCallback(
    async (imageItem, selectionMeta = {}) => {
      const imageSource = typeof imageItem === 'string' ? imageItem : '';
      const previewSource = firstStringValue([
        selectionMeta?.previewUrl,
        selectionMeta?.url,
        selectionMeta?.imageUrl,
        selectionMeta?.asset?.previewUrl,
        selectionMeta?.asset?.url,
      ]);
      const sourceToMeasure = previewSource || imageSource;
      if (!imageSource && !sourceToMeasure) {
        return;
      }

      try {
        const placement = await resolveCanvasImagePlacement(sourceToMeasure);
        const newItemId = `item_${activeItemList.length}`;
        const newItem = {
          src: imageSource || placement.url,
          previewUrl: previewSource || undefined,
          url: previewSource || undefined,
          id: newItemId,
          type: 'image',
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
          source: 'library',
        };
        const newItemList = [...activeItemList, newItem];
        setActiveItemList(newItemList);
        updateSessionLayerActiveItemList(newItemList);
        setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);

        toast.success(
          <div>
            <FaCheck className="inline-flex mr-2" /> Image added from library.
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      } catch (_) {
        toast.error(
          <div>
            <FaTimes /> Unable to add image from library.
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
        throw _;
      }
    },
    [activeItemList, resolveCanvasImagePlacement, updateSessionLayerActiveItemList]
  );

  const resetImageLibrary = () => {
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
  };

  const fetchImageLibraryAssets = useCallback(
    async (page = 1) => {
      if (!id) return;
      const headers = getHeaders();
      if (!headers) {
        showLoginDialog();
        return;
      }

      setIsGlobalLibraryLoading(true);
      setGlobalLibraryError(null);
      try {
        const response = await axios.get(`${PROCESSOR_API_URL}/image_sessions/library_assets`, {
          ...headers,
          params: {
            sessionId: id,
            page,
            limit: IMAGE_LIBRARY_PAGE_SIZE,
          },
        });
        const responseData = response?.data || {};
        const currentAssets = Array.isArray(responseData.currentSessionAssets)
          ? responseData.currentSessionAssets
          : [];
        const globalAssets = Array.isArray(responseData.globalSessionAssets)
          ? responseData.globalSessionAssets
          : [];
        const pagination = responseData.pagination || {};

        setGenerationImages(currentAssets);
        setGlobalLibraryImages(globalAssets);
        setGlobalLibraryPagination({
          page: Number.isFinite(pagination.page) ? pagination.page : Number(page) || 1,
          pageSize: Number.isFinite(pagination.pageSize)
            ? pagination.pageSize
            : IMAGE_LIBRARY_PAGE_SIZE,
          totalItems: Number.isFinite(pagination.totalItems) ? pagination.totalItems : globalAssets.length,
          totalPages: Number.isFinite(pagination.totalPages) ? pagination.totalPages : 1,
          hasNextPage: Boolean(pagination.hasNextPage),
          hasPreviousPage: Boolean(pagination.hasPreviousPage),
        });
      } catch (error) {
        setGlobalLibraryError(error?.message || 'Unable to load global library assets.');
      } finally {
        setIsGlobalLibraryLoading(false);
      }
    },
    [id]
  );

  const openImageLibrary = useCallback(() => {
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_LIBRARY_DISPLAY);
    fetchImageLibraryAssets(1);
  }, [fetchImageLibraryAssets]);

  const submitGenerateRequest = async (payload) => {
    if (!currentLayer) return;
    setIsGenerationPending(true);
    setGenerationError(null);
    if (generationPollIntervalRef.current) {
      clearTimeout(generationPollIntervalRef.current);
      generationPollIntervalRef.current = null;
    }
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const requestPayload = {
      ...payload,
      videoSessionId: id,
      layerId: currentLayer._id.toString(),
      aspectRatio: payload?.aspectRatio || generationAspectRatio || aspectRatio,
      model: selectedGenerationModel || 'NANOBANANA2',
    };

    axios
      .post(`${PROCESSOR_API_URL}/image_sessions/request_generate`, requestPayload, headers)
      .then(() => {
        startGenerationPoll();
        toast.success(
          <div>
            <FaCheck className="inline-flex mr-2" /> Generation request submitted.
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
            <FaTimes /> Generation request failed.
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const submitGenerateNewRequest = async (payload) => {
    await submitGenerateRequest(payload);
  };

  const exportBaseGroup = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = resolvedCanvasDimensions.width;
    canvas.height = resolvedCanvasDimensions.height;
    const ctx = canvas.getContext('2d');

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

    for (const item of activeItemList || []) {
      if (item.isHidden) continue;
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
        } catch  {}
      }
      ctx.restore();
    }

    return canvas.toDataURL('image/png');
  };

  const captureDownloadCanvas = useCallback(async () => {
    const stage = canvasRef.current?.getStage?.();
    if (!stage) {
      return null;
    }

    const stageWidth = Math.max(Number(stage.width()) || 0, 1);
    const stageHeight = Math.max(Number(stage.height()) || 0, 1);
    const pixelRatio = Math.min(
      resolvedCanvasDimensions.width / stageWidth,
      resolvedCanvasDimensions.height / stageHeight
    );

    return captureStageCanvas(canvasRef, {
      pixelRatio: pixelRatio > 0 ? pixelRatio : 1,
      hideSelectors: [
        'Transformer',
        '#maskGroup',
        '#pencilGroup',
        '#shapeSelectToolbar',
        '#overlayImagePreview',
        '#maskImagePreview',
        '#shadedAreaPreview',
      ],
    });
  }, [resolvedCanvasDimensions.height, resolvedCanvasDimensions.width]);

  const triggerDownload = (canvas, suffix = '') => {
    const dataURL = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataURL;
    const dateStr = new Date().toISOString().replace(/:/g, '-');
    const label = suffix ? `_${suffix}` : '';
    link.download = `image_${dateStr}${label}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadImageSimple = useCallback(async () => {
    const baseCanvas = await captureDownloadCanvas();
    if (!baseCanvas) return;
    triggerDownload(baseCanvas);
  }, [captureDownloadCanvas]);

  const downloadImageAdvanced = useCallback(
    async ({ mode, scale, width, height }) => {
      const baseCanvas = await captureDownloadCanvas();
      if (!baseCanvas) return;
      let outputCanvas = baseCanvas;

      if (mode === 'scale') {
        const safeScale = Math.min(Math.max(scale || 1, 1), 4);
        outputCanvas = document.createElement('canvas');
        outputCanvas.width = Math.round(baseCanvas.width * safeScale);
        outputCanvas.height = Math.round(baseCanvas.height * safeScale);
        const ctx = outputCanvas.getContext('2d');
        ctx.drawImage(baseCanvas, 0, 0, outputCanvas.width, outputCanvas.height);
        triggerDownload(outputCanvas, `${safeScale}x`);
        return;
      }

      if (mode === 'custom') {
        const safeWidth = Math.max(1, Math.floor(width || 0));
        const safeHeight = Math.max(1, Math.floor(height || 0));
        const maxWidth = baseCanvas.width * 4;
        const maxHeight = baseCanvas.height * 4;

        if (safeWidth > maxWidth || safeHeight > maxHeight) {
          toast.error(
            <div>
              <FaTimes /> Max custom resolution is 4× the canvas size.
            </div>,
            {
              position: 'bottom-center',
              className: 'custom-toast',
            }
          );
          return;
        }

        outputCanvas = document.createElement('canvas');
        outputCanvas.width = safeWidth;
        outputCanvas.height = safeHeight;
        const ctx = outputCanvas.getContext('2d');
        const scaleFactor = Math.max(safeWidth / baseCanvas.width, safeHeight / baseCanvas.height);
        const scaledWidth = baseCanvas.width * scaleFactor;
        const scaledHeight = baseCanvas.height * scaleFactor;
        const offsetX = (safeWidth - scaledWidth) / 2;
        const offsetY = (safeHeight - scaledHeight) / 2;
        ctx.drawImage(baseCanvas, offsetX, offsetY, scaledWidth, scaledHeight);
        triggerDownload(outputCanvas, `${safeWidth}x${safeHeight}`);
      }
    },
    [captureDownloadCanvas]
  );

  const openAdvancedDownloadDialog = useCallback(() => {
    const { width, height } = resolvedCanvasDimensions;
    openAlertDialog(
      <ImageDownloadDialog
        baseWidth={width}
        baseHeight={height}
        aspectRatio={aspectRatio}
        aspectRatioOptions={imageAspectRatioOptions}
        onDownload={async (payload) => {
          await downloadImageAdvanced(payload);
          closeAlertDialog();
        }}
        onClose={closeAlertDialog}
      />
    );
  }, [aspectRatio, closeAlertDialog, downloadImageAdvanced, openAlertDialog, resolvedCanvasDimensions]);

  const combineCurrentLayerItems = useCallback(() => {
    const stage = canvasRef.current?.getStage?.();
    if (!stage) {
      return;
    }

    const transformers = stage.find('Transformer');
    const overlays = stage.find('#maskGroup, #pencilGroup');
    const transformerVisibility = transformers.map((transformer) => transformer.visible());
    const overlayVisibility = overlays.map((overlay) => overlay.visible());

    transformers.forEach((transformer) => transformer.visible(false));
    overlays.forEach((overlay) => overlay.visible(false));
    stage.batchDraw();

    const combinedImageDataUrl = stage.toDataURL({ pixelRatio: 2 });

    transformers.forEach((transformer, index) => transformer.visible(transformerVisibility[index]));
    overlays.forEach((overlay, index) => overlay.visible(overlayVisibility[index]));
    stage.batchDraw();

    const combinedItem = createImageStudioImageItem({
      src: combinedImageDataUrl,
      id: 'item_0',
      x: 0,
      y: 0,
      width: resolvedCanvasDimensions.width,
      height: resolvedCanvasDimensions.height,
    });

    const updatedItemList = [combinedItem];
    setActiveItemList(updatedItemList);
    updateSessionLayerActiveItemList(updatedItemList);
    setSelectedId(combinedItem.id);
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
    setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
  }, [
    createImageStudioImageItem,
    resolvedCanvasDimensions.height,
    resolvedCanvasDimensions.width,
    updateSessionLayerActiveItemList,
  ]);

  const exportMaskedGroupAsBlackAndWhite = async () => {
    const baseStage = canvasRef.current?.getStage?.();
    if (!baseStage) return null;
    const baseLayer = baseStage.getLayers()[0];
    const maskGroup = baseLayer.findOne((node) => node.id() === 'maskGroup');

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = baseStage.width();
    offscreenCanvas.height = baseStage.height();
    const ctx = offscreenCanvas.getContext('2d');

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
        maskData[i] = 255;
        maskData[i + 1] = 255;
        maskData[i + 2] = 255;
        maskData[i + 3] = 255;
      } else {
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
  };

  const submitOutpaintRequest = async (evt) => {
    evt.preventDefault();
    if (!currentLayer) return;
    setIsOutpaintPending(true);
    if (outpaintPollIntervalRef.current) {
      clearTimeout(outpaintPollIntervalRef.current);
      outpaintPollIntervalRef.current = null;
    }

    const baseImageData = await exportBaseGroup();
    let maskImageData;

    if (selectedEditModelValue && selectedEditModelValue.editType === 'inpaint') {
      maskImageData = await exportMaskedGroupAsBlackAndWhite();
    }

    const formData = new FormData(evt.target);
    const promptValue = formData.get('promptText');
    const guidanceScale = formData.get('guidanceScale');
    const numInferenceSteps = formData.get('numInferenceSteps');
    const strength = formData.get('strength');
    const requestedAspectRatio = formData.get('aspectRatio') || generationAspectRatio || aspectRatio;

    const payload = {
      image: baseImageData,
      sessionId: id,
      layerId: currentLayer._id.toString(),
      prompt: promptValue,
      model: 'NANOBANANA2EDIT',
      guidanceScale,
      numInferenceSteps,
      strength,
      aspectRatio: requestedAspectRatio,
    };
    const inputImageUrls = activeItemList
      .filter((item) => item?.type === 'image' && item?.src && !item?.isHidden)
      .map((item) => (typeof item.src === 'string' ? item.src.trim() : ''))
      .filter(Boolean);
    const uniqueInputImageUrls = [...new Set(inputImageUrls)];
    if (uniqueInputImageUrls.length > 1) {
      payload.image_urls = [...uniqueInputImageUrls].reverse();
    }
    if (maskImageData) {
      payload.maskImage = maskImageData;
    }

    setOutpaintError(null);
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    axios
      .post(`${PROCESSOR_API_URL}/image_sessions/request_edit_image`, payload, headers)
      .then(() => {
        startOutpaintPoll();
        toast.success(
          <div>
            <FaCheck className="inline-flex mr-2" /> Edit request submitted.
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
            <FaTimes /> Edit request failed.
          </div>,
          {
            position: 'bottom-center',
            className: 'custom-toast',
          }
        );
      });
  };

  const startGenerationPoll = async () => {
    if (!currentLayer) return;
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const selectedLayerId = currentLayer._id.toString();
    const pollStatusData = await axios.get(
      `${PROCESSOR_API_URL}/image_sessions/generate_status?id=${id}&layerId=${selectedLayerId}`,
      headers
    );
    const pollStatus = pollStatusData.data;

    if (pollStatus.status === 'COMPLETED') {
      const layerData = pollStatus.layer;
      const generationImages = pollStatus.generationImages;
      const generatedImageUrlName = layerData.imageSession.activeGeneratedImage;
      const timestamp = Date.now();
      const generatedURL = `/generations/${generatedImageUrlName}?${timestamp}`;
      const placement =
        (await resolveCanvasImagePlacement(generatedURL).catch(() => null)) || {
          url: generatedURL,
          x: 0,
          y: 0,
          width: resolvedCanvasDimensions.width,
          height: resolvedCanvasDimensions.height,
        };
      const itemId = `item_${activeItemList.length}`;
      const newItemList = [
        ...activeItemList,
        {
          src: placement.url,
          id: itemId,
          type: 'image',
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
        },
      ];

      setActiveItemList(newItemList);
      setCurrentLayer(layerData);
      setIsGenerationPending(false);
      setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
      if (generationImages && generationImages.length > 0) {
        setGenerationImages(generationImages);
      }
      updateSessionLayerActiveItemList(newItemList);
      getUserAPI();
      return;
    }

    if (pollStatus.status === 'FAILED') {
      setIsGenerationPending(false);
      setGenerationError(pollStatus.generationError || 'Generation failed.');
      toast.error(
        <div>
          <FaTimes /> Generation failed.
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      getUserAPI();
      return;
    }

    generationPollIntervalRef.current = setTimeout(() => {
      startGenerationPoll();
    }, 1000);
  };

  const startOutpaintPoll = async () => {
    if (!currentLayer) return;
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const selectedLayerId = currentLayer._id.toString();
    const pollStatusData = await axios.get(
      `${PROCESSOR_API_URL}/image_sessions/edit_status?id=${id}&layerId=${selectedLayerId}`,
      headers
    );
    const pollStatusDataResponse = pollStatusData.data;

    if (pollStatusDataResponse.status === 'COMPLETED') {
      const updatedLayer = pollStatusDataResponse.layer;
      const imageSession = updatedLayer.imageSession;
      const generatedImageUrlName = imageSession.activeEditedImage;
      const generatedURL = `${generatedImageUrlName}`;
      const placement =
        (await resolveCanvasImagePlacement(generatedURL).catch(() => null)) || {
          url: generatedURL,
          x: 0,
          y: 0,
          width: resolvedCanvasDimensions.width,
          height: resolvedCanvasDimensions.height,
        };
      const itemId = `item_${activeItemList.length}`;
      const newItemList = [
        ...activeItemList,
        {
          src: placement.url,
          id: itemId,
          type: 'image',
          x: placement.x,
          y: placement.y,
          width: placement.width,
          height: placement.height,
        },
      ];

      const generationImages = pollStatusDataResponse.generationImages;
      if (generationImages && generationImages.length > 0) {
        setGenerationImages(generationImages);
      }

      setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
      setActiveItemList(newItemList);
      setCurrentLayer(updatedLayer);
      setIsOutpaintPending(false);
      updateSessionLayerActiveItemList(newItemList);
      toast.success(
        <div>
          <FaCheck className="inline-flex mr-2" /> Edit complete.
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      getUserAPI();
      return;
    }

    if (pollStatusDataResponse.status === 'FAILED') {
      setIsOutpaintPending(false);
      setOutpaintError('Edit failed.');
      toast.error(
        <div>
          <FaTimes /> Edit failed.
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      getUserAPI();
      return;
    }

    outpaintPollIntervalRef.current = setTimeout(() => {
      startOutpaintPoll();
    }, 1000);
  };

  const handleProjectSettingsChange = async (nextSettings) => {
    if (!nextSettings) return;
    const normalizedSettings =
      typeof nextSettings === 'string'
        ? {
            aspectRatio: nextSettings,
            canvasDimensions: getCanvasDimensionsForAspectRatio(nextSettings),
          }
        : nextSettings;
    const nextRatio = normalizedSettings.aspectRatio;
    const nextCanvasDimensions = normalizeCanvasDimensions(
      normalizedSettings.canvasDimensions,
      nextRatio || aspectRatio
    );
    if (!nextRatio) return;
    const previousAspectRatio = aspectRatio;
    const previousSessionDetails = sessionDetails;
    setAspectRatio(nextRatio);
    localStorage.setItem('defaultImageAspectRatio', nextRatio);
    setSessionDetails((prevSessionDetails) =>
      prevSessionDetails
        ? {
            ...prevSessionDetails,
            aspectRatio: nextRatio,
            canvasDimensions: nextCanvasDimensions,
            canvasWidth: nextCanvasDimensions.width,
            canvasHeight: nextCanvasDimensions.height,
          }
        : prevSessionDetails
    );
    if (!id) return;
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      setAspectRatio(previousAspectRatio);
      setSessionDetails(previousSessionDetails);
      localStorage.setItem('defaultImageAspectRatio', previousAspectRatio);
      return;
    }
    try {
      const response = await axios.post(
        `${PROCESSOR_API_URL}/image_sessions/update_aspect_ratio`,
        {
          sessionId: id,
          aspectRatio: nextRatio,
          canvasDimensions: nextCanvasDimensions,
        },
        headers
      );
      const session = response.data?.session || response.data;
      if (session) {
        setSessionDetails(session);
        if (session?.layers?.[0]) {
          setCurrentLayer(session.layers[0]);
        }
      }
    } catch (_) {
      setAspectRatio(previousAspectRatio);
      setSessionDetails(previousSessionDetails);
      localStorage.setItem('defaultImageAspectRatio', previousAspectRatio);
      toast.error(
        <div>
          <FaTimes /> Unable to update project settings.
        </div>,
        {
          position: 'bottom-center',
          className: 'custom-toast',
        }
      );
      throw _;
    }
  };

  const openEditProjectDialog = useCallback(() => {
    openAlertDialog(
      <EditImageProjectDialogContent
        aspectRatio={aspectRatio}
        canvasDimensions={resolvedCanvasDimensions}
        aspectRatioOptions={imageAspectRatioOptions}
        colorMode={colorMode}
        onClose={closeAlertDialog}
        onSave={handleProjectSettingsChange}
      />
    );
  }, [
    aspectRatio,
    closeAlertDialog,
    colorMode,
    handleProjectSettingsChange,
    openAlertDialog,
    resolvedCanvasDimensions,
  ]);

  const updateCanvasDisplayScale = useCallback(() => {
    const viewportNode = canvasViewportRef.current;
    const surfaceNode = canvasSurfaceRef.current;
    if (!viewportNode || !surfaceNode) return;

    const viewportWidth = viewportNode.clientWidth;
    const viewportHeight = viewportNode.clientHeight;
    const surfaceWidth = surfaceNode.offsetWidth;
    const surfaceHeight = surfaceNode.offsetHeight;

    if (!viewportWidth || !viewportHeight || !surfaceWidth || !surfaceHeight) return;

    const isDesktopViewport = viewportWidth >= 1024;
    const horizontalMargin = isDesktopViewport ? 48 : 24;
    const verticalMargin = isDesktopViewport ? 48 : 24;
    const availableWidth = Math.max(viewportWidth - horizontalMargin * 2, 1);
    const availableHeight = Math.max(viewportHeight - verticalMargin * 2, 1);
    const nextScale = Math.min(1, availableWidth / surfaceWidth, availableHeight / surfaceHeight);
    const safeScale = Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1;

    setCanvasDisplayScale((prevScale) =>
      Math.abs(prevScale - safeScale) < 0.001 ? prevScale : safeScale
    );

    const nextWidth = Math.max(1, Math.floor(surfaceWidth * safeScale));
    const nextHeight = Math.max(1, Math.floor(surfaceHeight * safeScale));
    setCanvasDisplaySize((prevSize) =>
      prevSize.width === nextWidth && prevSize.height === nextHeight
        ? prevSize
        : { width: nextWidth, height: nextHeight }
    );
  }, []);

  const isCanvasStudioDisplay =
    Boolean(currentLayer && sessionDetails) &&
    currentLayer?.imageSession?.generationStatus !== 'PENDING' &&
    currentCanvasAction !== TOOLBAR_ACTION_VIEW.SHOW_LIBRARY_DISPLAY;

  useEffect(() => {
    if (!isCanvasStudioDisplay) {
      setCanvasDisplayScale(1);
      setCanvasDisplaySize({ width: null, height: null });
      setIsCanvasDragActive(false);
      setIsCanvasDropProcessing(false);
      canvasDragDepthRef.current = 0;
      return;
    }

    if (isCanvasManualZoom) {
      setCanvasDisplayScale(1);
      setCanvasDisplaySize({ width: null, height: null });
      return;
    }

    const recalc = () => updateCanvasDisplayScale();
    const frameId = window.requestAnimationFrame(recalc);

    window.addEventListener('resize', recalc);

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(recalc);
      if (canvasViewportRef.current) {
        resizeObserver.observe(canvasViewportRef.current);
      }
      if (canvasSurfaceRef.current) {
        resizeObserver.observe(canvasSurfaceRef.current);
      }
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', recalc);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [
    isCanvasManualZoom,
    isCanvasStudioDisplay,
    resolvedCanvasDimensions.height,
    resolvedCanvasDimensions.width,
    updateCanvasDisplayScale,
  ]);

  let viewDisplay = <span />;
  if (!currentLayer || !sessionDetails) {
    viewDisplay = (
      <div className="w-full h-[80vh] flex items-center justify-center text-sm">
        Loading image session...
      </div>
    );
  } else if (currentLayer.imageSession?.generationStatus === 'PENDING') {
    viewDisplay = <LoadingImage />;
  } else if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_LIBRARY_DISPLAY) {
    viewDisplay = (
      <div className="w-full h-full flex flex-col">
        <ImageLibraryHome
          generationImages={generationImages}
          globalGenerationImages={globalLibraryImages}
          globalPagination={globalLibraryPagination}
          onGlobalPageChange={fetchImageLibraryAssets}
          isGlobalLoading={isGlobalLibraryLoading}
          globalError={globalLibraryError}
          selectImageFromLibrary={selectImageFromLibrary}
          showStudioBackButton
          onBackToStudio={resetImageLibrary}
        />
      </div>
    );
  } else {
    const canvasInternalLoading = isGenerationPending || isOutpaintPending;
    const canvasSurface =
      colorMode === 'dark'
        ? 'bg-[#0f1629] border border-[#1f2a3d] shadow-[0_16px_36px_rgba(57,217,129,0.12)]'
        : 'bg-[#f1f5f9] border border-slate-300';
    const canvasDropSurfaceHighlight = isCanvasDragActive
      ? colorMode === 'dark'
        ? 'ring-2 ring-[#46bfff] bg-[#13203a]'
        : 'ring-2 ring-rose-400 bg-rose-50'
      : '';
    const shouldScaleCanvas = !isCanvasManualZoom && canvasDisplayScale < 0.999;
    const scaledCanvasWrapperStyle =
      shouldScaleCanvas && canvasDisplaySize.width && canvasDisplaySize.height
        ? {
            width: `${canvasDisplaySize.width}px`,
            height: `${canvasDisplaySize.height}px`,
          }
        : undefined;
    const scaledCanvasSurfaceStyle = shouldScaleCanvas
      ? {
          transform: `scale(${canvasDisplayScale})`,
          transformOrigin: 'top left',
          willChange: 'transform',
        }
      : undefined;

    viewDisplay = (
      <div className="inline-block relative" style={scaledCanvasWrapperStyle}>
        <div
          ref={canvasSurfaceRef}
          className="inline-flex flex-col items-center gap-2"
          style={scaledCanvasSurfaceStyle}
        >
          <div
            className={`relative ${canvasSurface} ${canvasDropSurfaceHighlight} rounded-xl px-4 py-6 inline-block cursor-pointer transition-colors duration-150`}
            onDragEnter={handleCanvasDragEnter}
            onDragOver={handleCanvasDragOver}
            onDragLeave={handleCanvasDragLeave}
            onDrop={handleCanvasDrop}
          >
            {(canvasInternalLoading || isCanvasDropProcessing) && (
              <div className="absolute inset-0 z-10 flex items-center justify-center">
                <LoadingImageBase />
              </div>
            )}
            {isCanvasDragActive && !isCanvasDropProcessing && (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-rose-400/70 bg-rose-400/10 text-sm font-medium text-rose-500">
                Drop image to upload
              </div>
            )}
            <VideoCanvasContainer
              ref={canvasRef}
              sessionDetails={sessionDetails}
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
              applyFilter={() => {}}
              applyFinalFilter={() => {}}
              onChange={() => {}}
              pencilColor={pencilColor}
              pencilWidth={pencilWidth}
              eraserWidth={eraserWidth}
              sessionId={id}
              selectedLayerId={currentLayer?._id?.toString?.() || ''}
              exportAnimationFrames={() => {}}
              currentLayerSeek={0}
              currentLayer={currentLayer}
              updateSessionActiveItemList={updateSessionLayerActiveItemList}
              selectedLayerSelectShape={selectedLayerSelectShape}
              setCurrentView={setCurrentView}
              isLayerSeeking={false}
              setEnableSegmentationMask={() => {}}
              enableSegmentationMask={false}
              segmentationData={[]}
              setSegmentationData={() => {}}
              isExpressGeneration={false}
              removeVideoLayer={() => {}}
              aspectRatio={aspectRatio}
              canvasDimensions={resolvedCanvasDimensions}
              promptAspectRatio={generationAspectRatio}
              setPromptAspectRatio={setGenerationAspectRatio}
              isAIVideoGenerationPending={false}
              toggleStageZoom={() => {}}
              stageZoomScale={canvasZoomScale}
              requestRegenerateSubtitles={() => {}}
              displayZoomType={canvasZoomMode}
              aiVideoLayer={null}
              aiVideoLayerType={null}
              requestRegenerateAnimations={() => {}}
              requestRealignLayers={() => {}}
              totalDuration={0}
              selectedEditModelValue={selectedEditModelValue}
              createTextLayer={createTextLayer}
              requestRealignToAiVideoAndLayers={() => {}}
              requestLipSyncToSpeech={() => {}}
              onPersistTextStyle={(nextStyle) =>
                setTextConfig((prev) => ({
                  ...(prev || {}),
                  ...(nextStyle || {}),
                }))
              }
              editorVariant="imageStudio"
              setPromptText={setPromptText}
              promptText={promptText}
              submitGenerateRequest={submitGenerateRequest}
              isGenerationPending={isGenerationPending}
              selectedGenerationModel={selectedGenerationModel}
              setSelectedGenerationModel={setSelectedGenerationModel}
              generationError={generationError}
              submitGenerateNewRequest={submitGenerateNewRequest}
              isUpdateLayerPending={false}
              setSelectedVideoGenerationModel={() => {}}
              selectedVideoGenerationModel={null}
              submitGenerateNewVideoRequest={() => {}}
              videoPromptText=""
              setVideoPromptText={() => {}}
              openUploadDialog={openUploadDialog}
              rightPanelView={currentView}
              downloadCurrentFrame={() => {}}
            />
          </div>
        </div>
      </div>
    );
  }

  const mainWorkspaceShell =
    colorMode === 'dark'
      ? 'bg-[#0b1021] text-slate-100'
      : 'bg-gradient-to-br from-[#e9edf7] via-[#eef3fb] to-white text-slate-900';
  const toolbarShell =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border-l border-[#1f2a3d] shadow-[0_1px_0_rgba(255,255,255,0.04)]'
      : 'bg-white border-l border-slate-200';
  const imageStudioRightPanelWidth = 'clamp(360px, 24vw, 460px)';
  const canvasViewportLayout = isCanvasStudioDisplay
    ? 'flex items-start justify-center overflow-auto'
    : 'block overflow-auto';

  return (
    <CommonContainer>
      <div className={`${mainWorkspaceShell} flex h-[100vh] items-stretch pt-[56px]`}>
        <div
          ref={canvasViewportRef}
          className={`min-w-0 flex-1 h-full ${canvasViewportLayout} px-6 pt-4 pb-6 text-center`}
        >
          {viewDisplay}
        </div>
        <div
          className={`shrink-0 h-full overflow-y-auto pt-4 ${toolbarShell}`}
          style={{ width: imageStudioRightPanelWidth }}
        >
          <ImageEditorToolbar
            currentViewDisplay={currentView}
            setCurrentViewDisplay={setCurrentView}
            currentCanvasAction={currentCanvasAction}
            setCurrentCanvasAction={setCurrentCanvasAction}
            promptText={promptText}
            setPromptText={setPromptText}
            submitGenerateNewRequest={submitGenerateNewRequest}
            isGenerationPending={isGenerationPending}
            selectedGenerationModel={selectedGenerationModel}
            setSelectedGenerationModel={setSelectedGenerationModel}
            generationError={generationError}
            submitOutpaintRequest={submitOutpaintRequest}
            selectedEditModel={selectedEditModel}
            setSelectedEditModel={setSelectedEditModel}
            selectedEditModelValue={selectedEditModelValue}
            isOutpaintPending={isOutpaintPending}
            outpaintError={outpaintError}
            editBrushWidth={editBrushWidth}
            setEditBrushWidth={setEditBrushWidth}
            showUploadAction={openUploadDialog}
            onShowLibrary={openImageLibrary}
            textConfig={textConfig}
            setTextConfig={setTextConfig}
            addText={addText}
            setAddText={setAddText}
            submitAddText={createTextLayer}
            aspectRatio={aspectRatio}
            canvasDimensions={resolvedCanvasDimensions}
            generationAspectRatio={generationAspectRatio}
            setGenerationAspectRatio={setGenerationAspectRatio}
            onEditProject={openEditProjectDialog}
            onDownloadSimple={downloadImageSimple}
            onDownloadAdvanced={openAdvancedDownloadDialog}
            activeItemList={activeItemList}
            setActiveItemList={setActiveItemList}
            updateSessionLayerActiveItemList={updateSessionLayerActiveItemList}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            hideItemInLayer={toggleHideItemInLayer}
            canUndoHistory={canUndo && !isHistoryInteractionBlocked}
            canRedoHistory={canRedo && !isHistoryInteractionBlocked}
            undoHistoryCount={undoCount}
            redoHistoryCount={redoCount}
            historyLimit={historyLimit}
            onUndoHistory={handleUndoHistory}
            onRedoHistory={handleRedoHistory}
            isHistoryInteractionBlocked={isHistoryInteractionBlocked}
            pencilWidth={pencilWidth}
            setPencilWidth={setPencilWidth}
            pencilColor={pencilColor}
            setPencilColor={setPencilColor}
            eraserWidth={eraserWidth}
            setEraserWidth={setEraserWidth}
            onCombineCurrentLayerItems={combineCurrentLayerItems}
            zoomCanvasIn={zoomCanvasIn}
            zoomCanvasOut={zoomCanvasOut}
            resetCanvasZoom={resetCanvasZoom}
            canvasZoomPercent={canvasZoomPercent}
            canZoomInCanvas={canZoomInCanvas}
            canZoomOutCanvas={canZoomOutCanvas}
          />
          <AssistantHome
            submitAssistantQuery={submitAssistantQuery}
            sessionId={id}
            sessionMessages={sessionMessages}
            onSessionMessagesChange={setSessionMessages}
            onSessionDetailsChange={setSessionDetails}
            onAssistantQueryGeneratingChange={setIsAssistantQueryGenerating}
            isAssistantQueryGenerating={isAssistantQueryGenerating}
            getFrameImageData={getAssistantFrameImageData}
          />
          <ToastContainer
            position="bottom-center"
            autoClose={5000}
            hideProgressBar
            newestOnTop={false}
            closeOnClick
            rtl={false}
            pauseOnFocusLoss
            draggable
            pauseOnHover
            className="custom-toast-container"
            toastClassName="custom-toast"
            bodyClassName="custom-toast-body"
          />
        </div>
      </div>
    </CommonContainer>
  );
}
