import { forwardRef, useEffect, useState, useRef, useContext } from "react";
import { createPortal } from 'react-dom';
import { Stage, Layer, Group, Line, Image as KonvaImage, Rect } from 'react-konva';

import { useColorMode } from '../../../contexts/ColorMode.jsx';
import { CURRENT_TOOLBAR_VIEW, TOOLBAR_ACTION_VIEW } from '../../../constants/Types.ts';

import DraggableToolbarRectangle from "../toolbars/toolbar_shapes/DraggableToolbarRectangle.jsx";
import DraggableToolbarCircle from "../toolbars/toolbar_shapes/DraggableToolbarCircle.jsx";
import { generateCursor } from "../util/GenerateSVG.jsx";
import axios from 'axios';
import debounce from 'lodash/debounce';
import VideoUnderlay from '../util/VideoUnderlay.jsx';
import CanvasToolbar from "./CanvasToolbar.jsx";
import { ActiveRenderItem } from './CanvasUtils.jsx';
import VideoCanvasOverlay from './overlay/VideoCanvasOverlay.jsx';
import ImageUploadOverlay from './overlay/ImageUploadOverlay.jsx';
import CanvasLoaderTransparent from '../util/loader/CanvasLoaderTransparent.jsx';
import MinimalTaskSkeleton from '../../common/MinimalTaskSkeleton.jsx';

import { getCanvasDimensionsForAspectRatio } from '../../../utils/canvas.jsx';
import VideoCanvasGridOverlay from './overlay/VideoCanvasGridOverlay.jsx'; // Make sure the path is correct
import { createLayerBoundImageItem } from '../util/layerBoundImageItem.js';
import { FaTimes } from 'react-icons/fa';

import { NavCanvasControlContext } from '../../../contexts/NavCanvasControlContext.jsx';
import './videoCanvas.css';
import { isItemVisibleAtDisplayFrame } from './CanvasUtils.jsx';


const FPS = 30;




const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API;


function getVideoTypeLabel(type) {
  switch (type) {
    case 'lip_sync':
      return 'Lip Synced video';
    case 'sound_effect':
      return 'Sound Effect video';
    case 'ai_video':
      return 'Base AI Video';
    case 'user_video':
      return 'Uploaded Video';
    default:
      return 'Video Layer';
  }
}

function canDragCanvasItems({
  editorVariant,
  currentView,
  currentCanvasAction,
  selectedEditModelValue,
}) {
  const isMaskEditMode =
    currentView === CURRENT_TOOLBAR_VIEW.SHOW_EDIT_MASK_DISPLAY
    || (
      currentView === CURRENT_TOOLBAR_VIEW.SHOW_EDIT_DISPLAY
      && selectedEditModelValue?.editType === 'inpaint'
    );

  const blockedCanvasActions = new Set([
    TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY,
    TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY,
    TOOLBAR_ACTION_VIEW.SHOW_SMART_SELECT_DISPLAY,
    TOOLBAR_ACTION_VIEW.SHOW_SELECT_SHAPE_DISPLAY,
  ]);

  if (isMaskEditMode || blockedCanvasActions.has(currentCanvasAction)) {
    return false;
  }

  if (
    editorVariant !== "imageStudio"
    && currentView === CURRENT_TOOLBAR_VIEW.SHOW_SELECT_DISPLAY
    && currentCanvasAction
    && currentCanvasAction !== TOOLBAR_ACTION_VIEW.SHOW_SELECT_LAYER_DISPLAY
  ) {
    return false;
  }

  return true;
}

const VideoCanvas = forwardRef((props, ref) => {
  const {
    activeItemList, setActiveItemList, currentView, editBrushWidth, editMasklines, currentCanvasAction,
    setCurrentCanvasAction, setSelectedId, selectedId, buttonPositions, setButtonPositions, selectedLayerType,
    setSelectedLayerType, applyFilter, onChange, sessionId, selectedFrameId, currentLayer,
    updateSessionActiveItemList, selectedLayerSelectShape, isLayerSeeking, applyFinalFilter, flipImageVertical,
    flipImageHorizontal, onCopyShapeLayer, onReplaceShapeLayer, handleResetShapeLayer, removeItem,
    updateTargetActiveLayerConfig, updateTargetShapeActiveLayerConfig, addPaintImage, resetPaintImage,
    shapeSelectTransformerCircleRef, shapeSelectTransformerRectangleRef, replaceEraserImage, duplicateEraserImage,
    undoEraserStroke, redoEraserStroke, handleLayerMouseDown, handleLayerMouseMove, handleLayerMouseUp,
    resetEraserImage, showMask, eraserToolbarVisible,
    eraserToolbarPosition, eraserWidthRef, toolbarShapeProps, setToolbarShapeProps, paintToolbarPosition,
    paintToolbarVisible, isDrawing, shapeSet, showPencil, pencilLines, overlayImage, shapeSelectToolbarVisible,
    shapeSelectToolbarPosition, enableSegmentationMask, segmentationData, isExpressGeneration, currentLayerSeek, isVideoPreviewPlaying, removeVideoLayer, aspectRatio, isAIVideoGenerationPending,
    canvasDimensions: canvasDimensionsProp,
    toggleStageZoom, stageZoomScale, displayZoomType, requestRegenerateSubtitles, aiVideoLayer,
    nextAiVideoLayer, nextAiVideoLayerType,
    requestRegenerateAnimations, removeSelectedItem, requestRealignLayers, totalDuration,
    updateTargetTextActiveLayerConfig, createTextLayer, updateTargetImageActiveLayerConfig,
    downloadCurrentFrame, requestRealignToAiVideoAndLayers,
    promptText, setPromptText, selectedGenerationModel, setSelectedGenerationModel,
    aiVideoLayerType,
    generationError, currentDefaultPrompt, submitGenerateNewRequest,
    isGenerationPending, isUpdateLayerPending,
    submitGenerateNewVideoRequest, aiVideoGenerationPending,
    selectedVideoGenerationModel, setSelectedVideoGenerationModel,
    videoPromptText, setVideoPromptText, updateTargetShapeActiveLayerConfigNoScale,
    selectedEditModelValue,
    onPersistTextStyle,
    openUploadDialog,
    sessionDetails,
    rightPanelView,
    isRightPanelExpanded = false,
    promptAspectRatio,
    setPromptAspectRatio,
    eraserUndoCount,
    eraserRedoCount,
    eraserHistoryLimit,
    canUndoEraserStroke,
    canRedoEraserStroke,
    editorVariant = "videoStudio",


  } = props;





  const durationOffset = currentLayer.durationOffset;

  const [maskImage, setMaskImage] = useState(null);
  const [maskData, setMaskData] = useState(null);
  const [shadedArea, setShadedArea] = useState(null);
  const [boundingBoxes, setBoundingBoxes] = useState([]);
  const [selectedBbox, setSelectedBbox] = useState(null);

  const [maskBaseImageId, setMaskBaseImageId] = useState(null);

  useState(false);

  const [showAddRemoveMaskedItemButton, setShowAddRemoveMaskedItemButton] = useState(false);


  const [showOverlayPromptGenerator, setShowOverlayPromptGenerator] = useState(true);


  const [canvasDimensions, setCanvasDimensions] = useState({ width: 1024, height: 1024 });
  const canvasFrameRef = useRef(null);
  const [videoLayerControlPosition, setVideoLayerControlPosition] = useState(null);



  const {
    setIsExpressGeneration,
    setSessionId,
    setDisplayZoomType,
    setDownloadCurrentFrame,
    setToggleStageZoom,
    setRequestRegenerateSubtitles,
    setRequestRegenerateAnimations,
    setRequestRealignLayers,
    setCanvasActualDimensions,
    setTotalEffectiveDuration,
    setRequestRealignToAiVideoAndLayers,
    showGridOverlay,
    showCanvasNavigationGrid,
    canvasNavigationGridGranularity,

  } = useContext(NavCanvasControlContext);

  useEffect(() => {
    setTotalEffectiveDuration(totalDuration);
  }, [totalDuration]);

  useEffect(() => {
    const baseCanvasDimensions = canvasDimensionsProp || getCanvasDimensionsForAspectRatio(aspectRatio);
    setCanvasActualDimensions(baseCanvasDimensions);
  }, [aspectRatio, canvasDimensionsProp, setCanvasActualDimensions]);


  useEffect(() => {
    setRequestRealignToAiVideoAndLayers(() => requestRealignToAiVideoAndLayers);
  }, [requestRealignToAiVideoAndLayers]);

  useEffect(() => {
    setIsExpressGeneration(isExpressGeneration);
  }, [isExpressGeneration]);

  useEffect(() => {
    setRequestRealignLayers(() => requestRealignLayers);
  }, [requestRealignLayers]);


  useEffect(() => {
    setSessionId(sessionId);
  }, [sessionId]);

  useEffect(() => {
    setDisplayZoomType(displayZoomType);
  }, [displayZoomType]);


  useEffect(() => {
    setDownloadCurrentFrame(() => downloadCurrentFrame);
  }, [downloadCurrentFrame]);

  useEffect(() => {
    setToggleStageZoom(() => toggleStageZoom);
  }, [toggleStageZoom]);

  useEffect(() => {
    setRequestRegenerateSubtitles(() => requestRegenerateSubtitles);
  }, [requestRegenerateSubtitles]);

  useEffect(() => {
    setRequestRegenerateAnimations(() => requestRegenerateAnimations);
  }, [requestRegenerateAnimations]);




  useEffect(() => {
    const baseDimensions = canvasDimensionsProp || getCanvasDimensionsForAspectRatio(aspectRatio);
    setCanvasDimensions({
      width: baseDimensions.width * stageZoomScale,
      height: baseDimensions.height * stageZoomScale,
    });
  }, [aspectRatio, canvasDimensionsProp, displayZoomType, stageZoomScale]);
  useEffect(() => {
    if (currentCanvasAction === 'SHOW_SMART_SELECT_DISPLAY' && enableSegmentationMask && selectedBbox) {
      setShowAddRemoveMaskedItemButton(true);
    } else {
      setShowAddRemoveMaskedItemButton(false);
    }
  }, [currentCanvasAction, selectedBbox]);

  useEffect(() => {
    if (currentCanvasAction === 'SHOW_SMART_SELECT_DISPLAY' && enableSegmentationMask) {
      loadSegmentationMask();
    }
  }, [currentCanvasAction, segmentationData]);

  const loadSegmentationMask = async () => {
    const maskData = segmentationData;

    if (!maskData || maskData.length === 0) {
      return;
    }
    setMaskData(maskData);

    const boxes = maskData.map((mask) => mask.bbox);
    setBoundingBoxes(boxes); // Update the state with bounding box data

    // set setMaskBaseImageId to top image
    const topItem = activeItemList
      .filter(item => item.id.startsWith('item_'))
      .sort((a, b) => {
        const idA = parseInt(a.id.replace('item_', ''), 10);
        const idB = parseInt(b.id.replace('item_', ''), 10);
        return idB - idA;
      })[0];

    setMaskBaseImageId(topItem.id);

  };



  useEffect(() => {
    const stage = ref.current.getStage();
    const container = stage.container();
    if (currentCanvasAction === 'MOVE') {
      container.style.cursor = 'grab';
    } else if (currentCanvasAction === 'RESIZE') {
      container.style.cursor = 'nwse-resize';
    } else if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY) {
      container.style.cursor = generateCursor(eraserWidthRef.current);
    } else {
      container.style.cursor = 'default';
    }
  }, [currentCanvasAction]);

  const { colorMode } = useColorMode();

  const textColor = colorMode === 'dark' ? `text-slate-100` : `text-black`;

  const selectLayer = (item) => {


    if (item.config) setSelectedId(item.id);
    if (item.type === 'image') {
      setSelectedLayerType('image');
    } else if (item.type === 'text') {
      setSelectedLayerType('text');
    } else if (item.type === 'shape') {
      setSelectedLayerType('shape');
    }
  };

  if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY) {
    const stage = ref.current.getStage();
    const container = stage.container();
    container.style.cursor = generateCursor(eraserWidthRef.current);
  }

  if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_EDIT_MASK_DISPLAY) {
    const stage = ref.current.getStage();
    const container = stage.container();
    container.style.cursor = generateCursor(editBrushWidth);
  }

  const moveItem = (index, direction) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= activeItemList.length) return; // Out of bounds, do nothing

    const newList = [...activeItemList];

    // Swap the items
    const temp = newList[newIndex];
    newList[newIndex] = newList[index];
    newList[index] = temp;

    // Swap their IDs
    const tempId = newList[newIndex].id;
    newList[newIndex].id = newList[index].id;
    newList[index].id = tempId;

    setActiveItemList(newList);
    updateSessionActiveItemList(newList); // Make sure to update the session active item list
  };

  const setSelectedLayer = (item) => {
    setSelectedId(item.id);
    if (item.type === 'image') {
      setSelectedLayerType('image');
    } else if (item.type === 'text') {
      setSelectedLayerType('text');
    } else if (item.type === 'shape') {
      setSelectedLayerType('shape');
    }
  };

  const updateToolbarButtonPosition = (id, x, y) => {

    setButtonPositions((prevPositions) =>
      prevPositions.map((pos) =>
        pos.id === id ? { ...pos, x: x + 30, y: y + 30 } : pos
      )
    );
  };

  const isCanvasItemDraggable = canDragCanvasItems({
    editorVariant,
    currentView,
    currentCanvasAction,
    selectedEditModelValue,
  });

  const previousViewRef = useRef();

  useEffect(() => {
    if (previousViewRef.current === CURRENT_TOOLBAR_VIEW.SHOW_ACTIONS_DISPLAY && currentView !== CURRENT_TOOLBAR_VIEW.SHOW_ACTIONS_DISPLAY) {
      setCurrentCanvasAction(null);
    }
    previousViewRef.current = currentView;
  }, [currentView]);

  let imageStackList = null;

  if (activeItemList && activeItemList.length > 0) {

    imageStackList = activeItemList.map((item, index) => {
      if (item.isHidden) {
        return null;
      }

      let itemId = item._id ? item._id : item.id;
      return <ActiveRenderItem
        currentLayerSeek={currentLayerSeek}
        item={item}
        index={index}
        selectedId={selectedId}
        setSelectedLayer={setSelectedLayer}
        setSelectedId={setSelectedId}
        selectedFrameId={selectedFrameId}
        showMask={showMask}
        updateToolbarButtonPosition={updateToolbarButtonPosition}
        isDraggable={isCanvasItemDraggable}
        updateTargetActiveLayerConfig={updateTargetActiveLayerConfig}
        isLayerSeeking={isLayerSeeking}
        selectLayer={selectLayer}
        updateTargetShapeActiveLayerConfig={updateTargetShapeActiveLayerConfig}
        updateTargetTextActiveLayerConfig={updateTargetTextActiveLayerConfig}
        onChange={onChange}
        sessionId={sessionId}
        durationOffset={currentLayer.durationOffset}
        stageZoomScale={stageZoomScale}
        aspectRatio={aspectRatio}
        framesPerSecond={sessionDetails?.framesPerSecond}
        key={`item_${sessionId}_${selectedFrameId}_${itemId}`}
        createTextLayer={createTextLayer}
      />
    }).filter(Boolean);
  }

  let currentShapeSelectDisplay = null;

  if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_SELECT_DISPLAY) {
    if (selectedLayerSelectShape === 'circle') {
      currentShapeSelectDisplay = (
        <DraggableToolbarCircle
          shapeProps={toolbarShapeProps}
          setShapeProps={setToolbarShapeProps}
          id="shapeSelectToolbar"
          isDrawing={isDrawing}
          shapeSet={shapeSet}
          transformerRef={shapeSelectTransformerCircleRef}
        />)
    } else if (selectedLayerSelectShape === 'rectangle') {
      currentShapeSelectDisplay = (
        <DraggableToolbarRectangle
          shapeProps={toolbarShapeProps}
          setShapeProps={setToolbarShapeProps}
          id="shapeSelectToolbar"
          isDrawing={isDrawing}
          shapeSet={shapeSet}
          transformerRef={shapeSelectTransformerRectangleRef}
        />
      );
    }
  }

  const addNewItem = (newItem) => {
    const normalizedItem =
      newItem?.type === 'image'
        ? createLayerBoundImageItem({ layer: currentLayer, ...newItem })
        : newItem;
    const newActiveItemList = [...activeItemList, normalizedItem];
    setActiveItemList(newActiveItemList);
    updateSessionActiveItemList(newActiveItemList);
    //  setSelectedId(newItem.id); // Ensure the new item is selected
    //  setSelectedLayerType(newItem.type); // Ensure the new item is set to the correct layer type
  };

  const handleMouseOver = () => {
    if (ref && ref.current) {
      const stage = ref.current.getStage();
      stage.getPointerPosition();
      if (!currentLayer || !maskData) return;
      setShadedArea(null);
    }
  };

  const handleBoundingBoxClick = async (e, bbox, segmentation) => {
    e.cancelBubble = true; // Prevent the click from propagating to other elements
    try {
      // Fetch segmentation data from the API
      const payload = {
        counts: segmentation.counts,
        size: segmentation.size,
        bbox: bbox,
      }
      const response = await axios.post(`${PROCESSOR_API_URL}/video_sessions/segmentation_image`, payload, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && response.data.mask_image) {
        const base64Image = `data:image/png;base64,${response.data.mask_image}`;
        const [x, y, width, height] = bbox;

        const imageObj = new Image();
        imageObj.onload = () => {
          const maskPreviewImage = {
            src: imageObj,
            x: x,
            y: y,
            width: width,
            height: height,
          };
          setMaskImage(maskPreviewImage);
          setSelectedBbox({ bbox, segmentation });
        };
        imageObj.src = base64Image;
      }
    } catch  {

    }
  };

  const getImageDataFromCanvas = (imageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = imageElement.width;
    canvas.height = imageElement.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageElement, 0, 0);
    return ctx.getImageData(0, 0, imageElement.width, imageElement.height);
  };

  const handleCanvasClick = (e) => {
    const stage = ref.current.getStage();
    const pointerPosition = stage.getPointerPosition();

    // Find bounding boxes that contain the click point and save their indices
    const containingBoxes = boundingBoxes.map((bbox, index) => {
      const [x, y, width, height] = bbox;
      if (
        pointerPosition.x >= x &&
        pointerPosition.x <= x + width &&
        pointerPosition.y >= y &&
        pointerPosition.y <= y + height
      ) {
        return { bbox, index };
      }
      return null;
    }).filter(item => item !== null);

    if (containingBoxes.length > 0) {
      // Existing logic for handling bounding box click
      const smallestBox = containingBoxes.reduce((smallest, item) => {
        const [, , width, height] = item.bbox;
        const area = width * height;
        if (!smallest || area < smallest.area) {
          return { ...item, area };
        }
        return smallest;
      }, null);

      const { bbox, index } = smallestBox;
      const { segmentation } = maskData[index];
      handleBoundingBoxClick(e, bbox, segmentation);
    } else {
      // No bounding boxes were clicked. Check if the click target is the stage itself.
      // If yes, this means no item was clicked. We then unselect all items.
      if (e.target === stage) {
        setSelectedId(null);
        setSelectedLayerType(null);
      }
    }
  };


  const handleAddButtonClick = () => {
    const stage = ref.current.getStage();
    const imageNode = stage.findOne(`#${maskBaseImageId}`);
    if (!imageNode || !imageNode.image()) {

      return;
    }

    const imageElement = imageNode.image();
    const imageData = getImageDataFromCanvas(imageElement);

    const maskImageElement = maskImage ? maskImage.src : null;
    if (maskImageElement) {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = maskImage.width;
      maskCanvas.height = maskImage.height;
      const maskCtx = maskCanvas.getContext('2d');
      maskCtx.drawImage(maskImageElement, 0, 0);

      const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);
      createMaskImage(imageData, maskData, selectedBbox.bbox, () => {
        // setSelectedId(newItem.id);
        // setSelectedLayer(newItem);
        /// setSelectedBbox(null); // Hide the toolbar
      });
    }
  };

  const handleRemoveButtonClick = () => {
    const stage = ref.current.getStage();
    const imageNode = stage.findOne(`#${maskBaseImageId}`);
    if (!imageNode || !imageNode.image()) {

      return;
    }

    const imageElement = imageNode.image();
    const imageData = getImageDataFromCanvas(imageElement);

    const maskImageElement = maskImage ? maskImage.src : null;
    if (maskImageElement) {
      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = maskImage.width;
      maskCanvas.height = maskImage.height;
      const maskCtx = maskCanvas.getContext('2d');
      maskCtx.drawImage(maskImageElement, 0, 0);

      const maskData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height);

      const topItem = activeItemList.find(item => item.id === maskBaseImageId);

      removeMaskImage(imageData, maskData, selectedBbox.bbox, topItem, (newItem) => {
        setSelectedId(newItem.id);
        setSelectedLayerType(newItem.type);
        setSelectedBbox(null); // Hide the toolbar
      });
    }
  };

  const removeMaskImage = (imageData, maskData, bbox, topItem, callback) => {
    const [x, y, width, height] = bbox;

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = imageData.width;
    offscreenCanvas.height = imageData.height;
    const offscreenCtx = offscreenCanvas.getContext('2d');
    offscreenCtx.putImageData(imageData, 0, 0);

    const extractedData = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);

    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const sourceX = x + i;
        const sourceY = y + j;
        const maskIndex = (j * width + i) * 4; // maskData is in RGBA format
        const extractIndex = (sourceY * extractedData.width + sourceX) * 4;

        if (maskData.data[maskIndex + 3] !== 0) { // Check alpha channel of the maskData
          extractedData.data[extractIndex] = 0; // R
          extractedData.data[extractIndex + 1] = 0; // G
          extractedData.data[extractIndex + 2] = 0; // B
          extractedData.data[extractIndex + 3] = 0; // A
        }
      }
    }

    offscreenCtx.putImageData(extractedData, 0, 0);
    const dataURL = offscreenCanvas.toDataURL();

    const imageObj = new Image();
    imageObj.onload = () => {
      const newItem = createLayerBoundImageItem({
        layer: currentLayer,
        id: maskBaseImageId, // Keep the same ID
        src: imageObj.src,
        x: topItem.x,
        y: topItem.y,
        width: topItem.width,
        height: topItem.height,
        config: topItem?.config,
        startFrame: topItem?.startFrame,
        endFrame: topItem?.endFrame,
        startTime: topItem?.startTime,
        endTime: topItem?.endTime,
      });

      const newActiveItemList = activeItemList.map(item => item.id === maskBaseImageId ? newItem : item);
      setActiveItemList(newActiveItemList);
      updateSessionActiveItemList(newActiveItemList);

      if (callback) callback(newItem); // Call the callback with the new item
    };
    imageObj.src = dataURL;
  };

  const createMaskImage = (imageData, maskData, bbox, callback) => {
    const [x, y, width, height] = bbox;

    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    const offscreenCtx = offscreenCanvas.getContext('2d');

    const extractedData = new ImageData(width, height);

    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const sourceX = x + i;
        const sourceY = y + j;
        const maskIndex = (j * width + i) * 4; // maskData is in RGBA format
        const imageIndex = (sourceY * imageData.width + sourceX) * 4;
        const extractIndex = (j * width + i) * 4;

        if (maskData.data[maskIndex + 3] !== 0) { // Check alpha channel of the maskData
          extractedData.data[extractIndex] = imageData.data[imageIndex]; // R
          extractedData.data[extractIndex + 1] = imageData.data[imageIndex + 1]; // G
          extractedData.data[extractIndex + 2] = imageData.data[imageIndex + 2]; // B
          extractedData.data[extractIndex + 3] = 255; // A
        } else {
          extractedData.data[extractIndex + 3] = 0; // Fully transparent
        }
      }
    }

    offscreenCtx.putImageData(extractedData, 0, 0);
    const dataURL = offscreenCanvas.toDataURL();

    const imageObj = new Image();
    imageObj.onload = () => {
      const newItem = createLayerBoundImageItem({
        layer: currentLayer,
        id: `item_${activeItemList.length}`,
        src: imageObj.src,
        x: x,
        y: y,
        width: width,
        height: height,
      });

      addNewItem(newItem);
      if (callback) callback(newItem); // Call the callback with the new item
    };
    imageObj.src = dataURL;
  };

  const debouncedHandleMouseOver = debounce((e) => {
    handleMouseOver(e);
  }, 100);


  // let canvasVideoUnderlay = <span />;

  const currentRelativeFrame = currentLayerSeek - (durationOffset * FPS);

  const currentRelateiveTimeStamp = currentRelativeFrame ? currentRelativeFrame / FPS : 0;



  let canvasVideoUnderlay = (
    <div className='absolute inset-0'>
      <VideoUnderlay aiVideoLayer={aiVideoLayer} currentLayerSeek={currentRelateiveTimeStamp}
        canvasDimensions={canvasDimensions}
        aiVideoLayerType={aiVideoLayerType}
        nextAiVideoLayer={nextAiVideoLayer}
        nextAiVideoLayerType={nextAiVideoLayerType}
        isVideoPreviewPlaying={isVideoPreviewPlaying} />
    </div>
  )

  const handleRemoveVideoLayerClick = (event) => {
    event.stopPropagation();
    removeVideoLayer?.();
  };

  useEffect(() => {
    if (!aiVideoLayer || !canvasFrameRef.current || typeof window === 'undefined') {
      setVideoLayerControlPosition(null);
      return undefined;
    }

    const canvasFrame = canvasFrameRef.current;

    const updateVideoLayerControlPosition = () => {
      const rect = canvasFrame.getBoundingClientRect();
      setVideoLayerControlPosition({
        right: Math.max(window.innerWidth - rect.right + 12, 12),
        top: Math.max(rect.top + 12, 72),
        maxWidth: Math.max(220, Math.min(rect.width - 24, window.innerWidth - 24)),
      });
    };

    updateVideoLayerControlPosition();
    window.addEventListener('resize', updateVideoLayerControlPosition);
    window.addEventListener('scroll', updateVideoLayerControlPosition, true);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateVideoLayerControlPosition)
      : null;
    resizeObserver?.observe(canvasFrame);

    return () => {
      window.removeEventListener('resize', updateVideoLayerControlPosition);
      window.removeEventListener('scroll', updateVideoLayerControlPosition, true);
      resizeObserver?.disconnect();
    };
  }, [
    aiVideoLayer,
    canvasDimensions.height,
    canvasDimensions.width,
    isRightPanelExpanded,
    rightPanelView,
    stageZoomScale,
  ]);

  const videoLayerControlClassName = colorMode === 'dark'
    ? 'border border-[#1f2a3d] bg-[#0f1629]/95 text-slate-100 shadow-[0_10px_28px_rgba(0,0,0,0.35)]'
    : 'border border-slate-200 bg-white/95 text-slate-800';
  const videoLayerRemoveButtonClassName = colorMode === 'dark'
    ? 'bg-rose-500/15 text-rose-100 hover:bg-rose-500/25 hover:text-white'
    : 'bg-rose-50 text-rose-700 hover:bg-rose-100';
  const videoLayerTypePillClassName = colorMode === 'dark'
    ? 'border border-[#e45a26]/30 bg-[#e45a26]/20 text-orange-100'
    : 'border border-orange-200 bg-orange-50 text-orange-700';
  const maskActionClassName = colorMode === 'dark'
    ? 'bg-[#111a2f] text-slate-100 border border-[#1f2a3d] shadow-[0_10px_28px_rgba(0,0,0,0.35)]'
    : 'bg-white text-slate-800 border border-slate-200';

  const videoLayerRemoveControl = aiVideoLayer ? (
    <div
      className={`fixed z-[900] flex items-center justify-end gap-2 overflow-visible rounded-lg px-2 py-1 ${videoLayerControlClassName}`}
      style={{
        right: `${videoLayerControlPosition?.right ?? 12}px`,
        top: `${videoLayerControlPosition?.top ?? 72}px`,
        maxWidth: `${videoLayerControlPosition?.maxWidth ?? 320}px`,
      }}
    >
      <button
        type="button"
        className={`inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${videoLayerRemoveButtonClassName}`}
        onClick={handleRemoveVideoLayerClick}
        aria-label="Remove video from layer"
        title="Remove video from layer"
      >
        <FaTimes className="text-[11px]" aria-hidden="true" />
        <span>Remove from layer</span>
      </button>
      <span className={`min-w-0 truncate rounded-full px-2.5 py-1 text-xs font-semibold ${videoLayerTypePillClassName}`}>
        {getVideoTypeLabel(aiVideoLayerType)}
      </span>
    </div>
  ) : null;

  const videoLayerRemoveControlPortal =
    videoLayerRemoveControl && typeof document !== 'undefined'
      ? createPortal(videoLayerRemoveControl, document.body)
      : videoLayerRemoveControl;


  const overlayView = rightPanelView || currentView;
  const overlayGenerateTab =
    overlayView === CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_VIDEO_DISPLAY
      ? "video"
      : overlayView === CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_DISPLAY
      ? "image"
      : "image";
  const isEditImageView = [
    CURRENT_TOOLBAR_VIEW.SHOW_EDIT_DISPLAY,
    CURRENT_TOOLBAR_VIEW.SHOW_EDIT_MASK_DISPLAY,
  ].includes(overlayView);

  useEffect(() => {
    if (
      !isRightPanelExpanded && (
      overlayView === CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_DISPLAY ||
      overlayView === CURRENT_TOOLBAR_VIEW.SHOW_GENERATE_VIDEO_DISPLAY
      )
    ) {
      setShowOverlayPromptGenerator(true);
    }
  }, [overlayView, isRightPanelExpanded]);
  const hasActiveImageInFrame = (() => {
    if (!activeItemList || activeItemList.length === 0) {
      return false;
    }
    return activeItemList.some((item) => {
      if (!item || item.isHidden || item.type !== 'image') {
        return false;
      }
      return isItemVisibleAtDisplayFrame(item, currentRelativeFrame, sessionDetails?.framesPerSecond);
    });
  })();
  const overlayImageAspectRatio =
    editorVariant === "imageStudio"
      ? promptAspectRatio || aspectRatio
      : aspectRatio;

  let canvasActionOverlay = <span />;
  if (
    !isRightPanelExpanded
    && !isEditImageView
    && activeItemList.length === 0
    && !aiVideoLayer
    && showOverlayPromptGenerator
  ) {

    canvasActionOverlay = <VideoCanvasOverlay activeItemList={activeItemList}
      currentLayer={currentLayer}
      sessionDetails={sessionDetails}
      activeTab={overlayGenerateTab}
      promptText={promptText}
      setPromptText={setPromptText}

      isGenerationPending={isGenerationPending}
      selectedGenerationModel={selectedGenerationModel}
      setSelectedGenerationModel={setSelectedGenerationModel}
      generationError={generationError}
      currentDefaultPrompt={currentDefaultPrompt}
      submitGenerateNewRequest={submitGenerateNewRequest}
      aspectRatio={overlayImageAspectRatio}
      setAspectRatio={setPromptAspectRatio}
      canvasDimensions={canvasDimensions}

      videoPromptText={videoPromptText}
      setVideoPromptText={setVideoPromptText}

      aiVideoGenerationPending={aiVideoGenerationPending}
      selectedVideoGenerationModel={selectedVideoGenerationModel}
      setSelectedVideoGenerationModel={setSelectedVideoGenerationModel}

      submitGenerateNewVideoRequest={submitGenerateNewVideoRequest}



      onCloseOverlay={() => {
        setShowOverlayPromptGenerator(false);
      }}
      editorVariant={editorVariant}

    />;

  }

  let canvasEditUploadOverlay = <span />;
  if (isEditImageView && !hasActiveImageInFrame) {
    canvasEditUploadOverlay = (
      <ImageUploadOverlay
        aspectRatio={aspectRatio}
        canvasDimensions={canvasDimensions}
        onUpload={openUploadDialog}
        onOpenLibrary={() => setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_LIBRARY_DISPLAY)}
        activeTab="upload"
      />
    );
  }

    let canvasInternalLoading = <span />;

    let canvasGridOverlay = <span />;
    if (showGridOverlay || showCanvasNavigationGrid) {
      canvasGridOverlay = (
        <VideoCanvasGridOverlay
          canvasDimensions={canvasDimensions}
          granularityMultiplier={canvasNavigationGridGranularity}
        />
      );

    }
    if (isUpdateLayerPending) {
      canvasInternalLoading = (
        <div className={`absolute t-0 w-full pt-[150px]   z-10`}>
          <CanvasLoaderTransparent />
        </div>
      );
    }

  let bgCanvasColor = '#111827';
    if (colorMode === 'light') {
      bgCanvasColor = '#F3F4F6';
    }

  const activeUserVideoUploadTask = currentLayer?.userVideoUploadTask || null;
  const isUserVideoUploadActive = Boolean(
    currentLayer?.userVideoGenerationPending
    || activeUserVideoUploadTask?.status === 'UPLOADING'
    || activeUserVideoUploadTask?.status === 'PROCESSING'
  );
  const pendingVideoTaskTitle = activeUserVideoUploadTask?.status === 'UPLOADING'
    ? `Uploading video${Number.isFinite(activeUserVideoUploadTask?.progressPercent) ? ` (${activeUserVideoUploadTask.progressPercent}%)` : ''}`
    : isUserVideoUploadActive
      ? 'Processing uploaded video'
      : 'Processing video task';
  const pendingVideoTaskSubtitle = activeUserVideoUploadTask?.message
    || (isUserVideoUploadActive
      ? 'The server is normalizing the uploaded video for this layer.'
      : 'This can take a few minutes.');
  const canvasSurfaceClassName =
    colorMode === 'dark'
      ? 'bg-[#0f1629] border border-[#1f2a3d] shadow-[0_16px_34px_rgba(2,6,23,0.18)]'
      : 'bg-[#f1f5f9] border border-slate-300';
  const canvasShellClassName =
    editorVariant === "imageStudio"
      ? "m-auto relative py-6 pl-0 pr-0"
      : `m-auto relative rounded-xl px-4 py-6 ${canvasSurfaceClassName}`;

  return (
    <div className={`${canvasShellClassName} ${textColor} overflow-visible`}
      style={{
        display: 'inline-block',
        boxSizing: 'border-box',
      }}
    >
      {canvasInternalLoading}
      <div
        ref={canvasFrameRef}
        className="relative z-[40] inline-block overflow-visible"
        style={{
          width: `${canvasDimensions.width}px`,
          height: `${canvasDimensions.height}px`,
        }}
      >
        {canvasVideoUnderlay}
        {canvasGridOverlay}
        <Stage width={canvasDimensions.width} height={canvasDimensions.height} ref={ref} id="samsar-konva-stage"
          onMouseMove={debouncedHandleMouseOver} onClick={handleCanvasClick}
          style={{
            border: '2px solid stone-300',
            boxSizing: 'border-box',
            padding: 0,
            margin: 0,
            backgroundColor: bgCanvasColor,
          }}
        >
          <Layer onMouseDown={handleLayerMouseDown} onMouseMove={handleLayerMouseMove}
           onMouseUp={handleLayerMouseUp}
           onMouseLeave={handleLayerMouseUp}
           >
            <Group id="baseGroup">
              {imageStackList}
            </Group>

            {currentCanvasAction === 'SHOW_SMART_SELECT_DISPLAY' && boundingBoxes.map((bbox, index) => (
              <Rect
                key={index}
                x={bbox[0]}
                y={bbox[1]}
                width={bbox[2]}
                height={bbox[3]}
                stroke="red"
                strokeWidth={2}
                id={`bbox_rect_${index}`}
              />
            ))}

            {showMask && (
              <Group id="maskGroup">
                {editMasklines.map((line, i) => (
                  <Line key={i} points={line.points} stroke={line.stroke} strokeWidth={line.strokeWidth} />
                ))}
              </Group>
            )}
            {showPencil && (
              <Group id="pencilGroup">
                {pencilLines.map((line, i) => (
                  <Line key={i} points={line.points} stroke={line.stroke} strokeWidth={line.strokeWidth} />
                ))}
              </Group>
            )}
            {overlayImage && (
              <KonvaImage
                id="overlayImagePreview"
                image={overlayImage}
                x={0}
                y={0}
                width={canvasDimensions.width}
                height={canvasDimensions.height}
                opacity={0.6}
              />
            )}
            {maskImage && (
              <KonvaImage
                id="maskImagePreview"
                image={maskImage.src}
                x={maskImage.x}
                y={maskImage.y}
                width={maskImage.width}
                height={maskImage.height}
                opacity={0.6}
              />
            )}
            {shadedArea && (
              <Group id="shadedAreaPreview">
                <Line points={shadedArea} fill="rgba(0, 0, 0, 0.5)" closed />
              </Group>
            )}
            {currentShapeSelectDisplay}
          </Layer>
        </Stage>
      </div>
      {videoLayerRemoveControlPortal}

      <CanvasToolbar
        buttonPositions={buttonPositions}
        selectedId={selectedId}
        selectedLayerType={selectedLayerType}
        moveItem={moveItem}
        applyFilter={applyFilter}
        applyFinalFilter={applyFinalFilter}
        colorMode={colorMode}
        removeItem={removeItem}
        removeSelectedItem={removeSelectedItem}
        flipImageHorizontal={flipImageHorizontal}
        flipImageVertical={flipImageVertical}
        updateTargetActiveLayerConfig={updateTargetActiveLayerConfig}
        updateTargetShapeActiveLayerConfig={updateTargetShapeActiveLayerConfig}
        activeItemList={activeItemList}
        eraserToolbarVisible={eraserToolbarVisible}
        eraserToolbarPosition={eraserToolbarPosition}
        replaceEraserImage={replaceEraserImage}
        duplicateEraserImage={duplicateEraserImage}
        undoEraserStroke={undoEraserStroke}
        redoEraserStroke={redoEraserStroke}
        eraserUndoCount={eraserUndoCount}
        eraserRedoCount={eraserRedoCount}
        eraserHistoryLimit={eraserHistoryLimit}
        canUndoEraserStroke={canUndoEraserStroke}
        canRedoEraserStroke={canRedoEraserStroke}
        resetEraserImage={resetEraserImage}
        shapeSelectToolbarVisible={shapeSelectToolbarVisible}
        shapeSelectToolbarPosition={shapeSelectToolbarPosition}
        handleResetShapeLayer={handleResetShapeLayer}
        onCopyShapeLayer={onCopyShapeLayer}
        onReplaceShapeLayer={onReplaceShapeLayer}
        paintToolbarVisible={paintToolbarVisible}
        paintToolbarPosition={paintToolbarPosition}
        addPaintImage={addPaintImage}
        resetPaintImage={resetPaintImage}
        updateTargetImageActiveLayerConfig={updateTargetImageActiveLayerConfig}
        updateTargetShapeActiveLayerConfigNoScale={updateTargetShapeActiveLayerConfigNoScale}
        updateTargetTextActiveLayerConfig={updateTargetTextActiveLayerConfig}
        onPersistTextStyle={onPersistTextStyle}
        stageZoomScale={stageZoomScale}
        canvasDimensions={canvasDimensions}
        editorVariant={editorVariant}
      />
      {showAddRemoveMaskedItemButton && (
        <div className={`fixed bottom-4 left-1/2 transform -translate-x-1/2 p-2 rounded-lg z-50 ${maskActionClassName}`}>
          <button className="mr-4" onClick={handleAddButtonClick}>Add</button>
          <button onClick={handleRemoveButtonClick}>Remove</button>
        </div>
      )}
      {isAIVideoGenerationPending && (
        <div className="animation-overlay flex items-center justify-center">
          <MinimalTaskSkeleton
            title={pendingVideoTaskTitle}
            subtitle={pendingVideoTaskSubtitle}
          />
        </div>
      )}
      {canvasEditUploadOverlay}
      {canvasActionOverlay}

    </div>
  );
});

export default VideoCanvas;
