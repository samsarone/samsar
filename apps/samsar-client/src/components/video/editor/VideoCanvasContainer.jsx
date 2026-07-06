import VideoCanvas from "./VideoCanvas";
import { forwardRef, useCallback, useContext, useEffect, useState, useRef } from "react";
import { CURRENT_TOOLBAR_VIEW, TOOLBAR_ACTION_VIEW } from '../../../constants/Types.ts';
import { generateCursor, generatePencilCursor } from "../util/GenerateSVG.jsx";
import Konva from 'konva';

import {
  applyGlitchEffect
} from '../../../utils/frame_animation/GlitchUtils.jsx';
import { applyBloomEffect } from '../../../utils/frame_animation/BloomUtils.jsx';
import { createLayerBoundImageItem } from '../util/layerBoundImageItem.js';
import { NavCanvasControlContext } from '../../../contexts/NavCanvasControlContext.jsx';

const SHAPE_CONFIG_SCALE_KEYS = [
  'width',
  'height',
  'radius',
  'strokeWidth',
  'pointerX',
  'pointerY',
  'xRadius',
  'yRadius',
];



const DISPLAY_FRAMES_PER_SECOND = 30;
const DEFAULT_SESSION_FRAMES_PER_SECOND = 24;
const VALID_SESSION_FRAME_RATES = new Set([16, 24, 30]);

function normalizeSessionFramesPerSecond(value) {
  const parsed = Math.round(Number(value));
  return VALID_SESSION_FRAME_RATES.has(parsed)
    ? parsed
    : DEFAULT_SESSION_FRAMES_PER_SECOND;
}

function applyAnimationsToNode(node, item, elapsedTime, duration, durationOffset, framesPerSecond = DEFAULT_SESSION_FRAMES_PER_SECOND) {
  if (!item.animations) return;

  const sessionFramesPerSecond = normalizeSessionFramesPerSecond(framesPerSecond);
  const totalLayerDuration = duration * 1000; // Convert to milliseconds

  item.animations.forEach(animation => {
    const { type, params, frameDuration, frameOffset } = animation;

    if (!params || !type) return;

    // Determine animation start and end times
    let startTime, endTime;

    if (frameOffset !== undefined && frameDuration !== undefined) {
      const durationOffsetEffective = durationOffset * 1000;
      startTime = durationOffsetEffective + (frameOffset * (1000 / sessionFramesPerSecond));
      endTime = startTime + (frameDuration * (1000 / sessionFramesPerSecond));
    } else {
      // Use default layer duration
      startTime = durationOffset * 1000;
      endTime = startTime + totalLayerDuration;
    }

    const animationElapsed = elapsedTime - startTime;
    const totalAnimationDuration = endTime - startTime;

    // Only process animation if current time is within animation boundaries
    if (animationElapsed >= 0 && animationElapsed <= totalAnimationDuration) {
      const t = animationElapsed / totalAnimationDuration; // Progress ratio [0,1]

      switch (type) {
        case 'zoom':
          // Apply zoom animation
          const { startScale = 100, endScale = 100 } = params;
          const scale = (startScale + (endScale - startScale) * t) / 100;
          node.scaleX(scale);
          node.scaleY(scale);
          break;

        case 'slide':
          // Apply slide animation
          const { startX = node.x(), endX = node.x(), startY = node.y(), endY = node.y() } = params;
          const translateX = startX + (endX - startX) * t;
          const translateY = startY + (endY - startY) * t;
          node.x(translateX);
          node.y(translateY);
          break;

        case 'rotate':
          // Apply rotate animation
          const { startAngle = 0, endAngle = 360, rotationSpeed } = params;
          let angle;
          if (rotationSpeed) {
            // Continuous rotation based on rotation speed
            angle = t * rotationSpeed * 360;
          } else {
            // Rotation from startAngle to endAngle
            angle = startAngle + (endAngle - startAngle) * t;
          }
          node.rotation(angle);
          break;

        case 'fade':
          // Apply fade animation
          const { startFade = 100, endFade = 100 } = params;
          const opacity = (startFade + (endFade - startFade) * t) / 100;
          node.opacity(opacity);
          break;

        case 'orbit':
          // Apply orbit animation
          const { centerX, centerY, radius, startAngle: orbitStartAngle = 0, endAngle: orbitEndAngle = 360 } = params;
          const currentAngle = orbitStartAngle + (orbitEndAngle - orbitStartAngle) * t;
          const radians = (currentAngle * Math.PI) / 180;
          const orbitX = centerX + radius * Math.cos(radians);
          const orbitY = centerY + radius * Math.sin(radians);
          node.x(orbitX);
          node.y(orbitY);
          break;
        // Add other custom animations here (e.g., snowfall, light_transition)
        default:
          applyCustomAnimation(node, animation, t);
          break;
      }
    } else {
      // Handle static animations if needed
      applyStaticAnimation(node, type, params);
    }
  });
}


function applyCustomAnimation(node, animation, t) {
  const { type, params } = animation;

  switch (type) {
    case 'glitch':
      applyGlitchEffect(node, params, t);
      break;
    case 'bloom':
      applyBloomEffect(node, params, t);
      break;
    case 'snowfall':
    case 'light_transition':
    case 'hologram':
    case 'nebula':
    case 'particle':
    case 'lens_flare':
      break;
    default:
      break;
  }
}




function applyStaticAnimation(node, type, params) {
  switch (type) {
    case 'zoom':
      const { endScale = 100 } = params;
      node.scaleX(endScale / 100);
      node.scaleY(endScale / 100);
      break;

    case 'rotate':
      const { endAngle = 0 } = params;
      node.rotation(endAngle);
      break;

    case 'slide':
      const { endX = node.x(), endY = node.y() } = params;
      node.x(endX);
      node.y(endY);
      break;

    case 'fade':
      const { endFade = 100 } = params;
      node.opacity(endFade / 100);
      break;

    default:
      break;
  }
}

const ERASER_HISTORY_LIMIT = 5;

function shouldIgnoreCanvasNudgeShortcut(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const interactiveAncestor = target.closest(
    'input, textarea, select, button, a, [contenteditable="true"], [role="textbox"], [role="button"]'
  );

  return Boolean(interactiveAncestor);
}

const VideoCanvasContainer = forwardRef((props, ref) => {
  const { sessionDetails, activeItemList, setActiveItemList, currentView,
    setCurrentView, editBrushWidth, editMasklines, setEditMaskLines, currentCanvasAction,
    setCurrentCanvasAction, setSelectedId, selectedId, setButtonPositions, selectedLayerType, pencilColor, pencilWidth, eraserWidth, currentLayer, currentLayerSeek, updateSessionActiveItemList,
    selectedLayerSelectShape, isExpressGeneration,
    stageZoomScale, selectedEditModelValue, createTextLayer, requestRealignToAiVideoAndLayers,
    requestLipSyncToSpeech, onPersistTextStyle
  } = props;



  const shapeSelectTransformerCircleRef = useRef();
  const shapeSelectTransformerRectangleRef = useRef();

  const [eraserLayer, setEraserLayer] = useState(null);
  const [, setIsShapeVisible] = useState(false);
  const [showMask, setShowMask] = useState(false);
  const [showEraser, setShowEraser] = useState(false);
  const [isPainting, setIsPainting] = useState(false);
  const [showPencil, setShowPencil] = useState(false);
  const [pencilLines, setPencilLines] = useState([]);
  const [shapeSelectToolbarVisible, setShapeSelectToolbarVisible] = useState(false);
  const [shapeSelectToolbarPosition, setShapeSelectToolbarPosition] = useState({ x: 0, y: 0 });

  const [paintToolbarVisible, setPaintToolbarVisible] = useState(false);
  const [paintToolbarPosition, setPaintToolbarPosition] = useState({ x: 0, y: 0 });
  const [toolbarShapeProps, setToolbarShapeProps] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    radius: 0
  });

  const [shapeSet, setShapeSet] = useState(false);

  const showEraserRef = useRef(showEraser);
  const showPencilRef = useRef(showPencil);
  const editMasklinesRef = useRef(editMasklines);
  const eraserWidthRef = useRef(eraserWidth);
  useRef({});
  const initialParamsRef = useRef({});
  const [hoveredObject] = useState(null);
  useState(null);
  const [overlayImage] = useState(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const [isDrawing, setIsDrawing] = useState(false);

  const [eraserToolbarVisible, setEraserToolbarVisible] = useState(false);
  const [eraserToolbarPosition, setEraserToolbarPosition] = useState({ x: 0, y: 0 });

  const [tempTopNode, setTempTopNode] = useState(null);
  const eraserTargetItemIdRef = useRef(null);
  const eraserExitHandledRef = useRef(false);
  const lastEraserPointRef = useRef(null);
  const activeSnappedEraserColumnRef = useRef(null);
  const currentEraserStrokeNodesRef = useRef([]);
  const eraserUndoHistoryRef = useRef([]);
  const eraserRedoHistoryRef = useRef([]);
  const [eraserHistoryState, setEraserHistoryState] = useState({
    undoCount: 0,
    redoCount: 0,
  });
  const {
    showCanvasNavigationGrid,
    setShowCanvasNavigationGrid,
    canvasNavigationGridGranularity,
    snapEraserToGrid,
  } = useContext(NavCanvasControlContext);
  const createCurrentLayerImageItem = (imagePayload) =>
    createLayerBoundImageItem({ layer: currentLayer, ...imagePayload });
  const isMaskPaintMode =
    (
      currentView === CURRENT_TOOLBAR_VIEW.SHOW_EDIT_DISPLAY
      && selectedEditModelValue
      && selectedEditModelValue.editType === 'inpaint'
    )
    || currentView === CURRENT_TOOLBAR_VIEW.SHOW_EDIT_MASK_DISPLAY;

  const getTopVisibleImageTarget = (stage, point = null) => {
    for (let index = activeItemList.length - 1; index >= 0; index -= 1) {
      const item = activeItemList[index];
      if (!item?.id || item?.type !== 'image' || item?.isHidden) {
        continue;
      }

      const node = stage.findOne(`#group_${item.id}`) || stage.findOne(`#${item.id}`);
      if (!node) {
        continue;
      }

      if (point) {
        const rect = node.getClientRect({
          skipTransform: false,
          skipShadow: false,
          skipStroke: false,
        });
        const pointInsideNode =
          point.x >= rect.x &&
          point.x <= rect.x + rect.width &&
          point.y >= rect.y &&
          point.y <= rect.y + rect.height;

        if (!pointInsideNode) {
          continue;
        }
      }

      return { item, index, node };
    }

    return null;
  };

  const getEraserLayerImageNode = () =>
    eraserLayer?.findOne('#originalShape') || eraserLayer?.children?.[0] || null;

  const syncEraserHistoryState = useCallback(() => {
    setEraserHistoryState({
      undoCount: eraserUndoHistoryRef.current.length,
      redoCount: eraserRedoHistoryRef.current.length,
    });
  }, []);

  const resetEraserHistory = useCallback(() => {
    currentEraserStrokeNodesRef.current = [];
    eraserUndoHistoryRef.current = [];
    eraserRedoHistoryRef.current = [];
    setEraserHistoryState({
      undoCount: 0,
      redoCount: 0,
    });
  }, []);

  const recordEraserStrokeNode = useCallback((node) => {
    if (!node) {
      return;
    }

    currentEraserStrokeNodesRef.current.push(node);
  }, []);

  const commitCurrentEraserStroke = useCallback(() => {
    const strokeNodes = currentEraserStrokeNodesRef.current.filter(Boolean);
    currentEraserStrokeNodesRef.current = [];

    if (!strokeNodes.length) {
      return;
    }

    eraserUndoHistoryRef.current = [
      ...eraserUndoHistoryRef.current,
      strokeNodes,
    ].slice(-ERASER_HISTORY_LIMIT);
    eraserRedoHistoryRef.current = [];
    syncEraserHistoryState();
  }, [syncEraserHistoryState]);

  const undoEraserStroke = useCallback(() => {
    if (isPainting || !eraserLayer || !eraserUndoHistoryRef.current.length) {
      return;
    }

    const previousStrokeNodes = eraserUndoHistoryRef.current.pop();
    if (!previousStrokeNodes?.length) {
      syncEraserHistoryState();
      return;
    }

    previousStrokeNodes.forEach((node) => node.remove());
    eraserRedoHistoryRef.current = [
      previousStrokeNodes,
      ...eraserRedoHistoryRef.current,
    ].slice(0, ERASER_HISTORY_LIMIT);
    eraserLayer.batchDraw();
    syncEraserHistoryState();
  }, [eraserLayer, isPainting, syncEraserHistoryState]);

  const redoEraserStroke = useCallback(() => {
    if (isPainting || !eraserLayer || !eraserRedoHistoryRef.current.length) {
      return;
    }

    const nextStrokeNodes = eraserRedoHistoryRef.current.shift();
    if (!nextStrokeNodes?.length) {
      syncEraserHistoryState();
      return;
    }

    nextStrokeNodes.forEach((node) => eraserLayer.add(node));
    eraserUndoHistoryRef.current = [
      ...eraserUndoHistoryRef.current,
      nextStrokeNodes,
    ].slice(-ERASER_HISTORY_LIMIT);
    eraserLayer.batchDraw();
    syncEraserHistoryState();
  }, [eraserLayer, isPainting, syncEraserHistoryState]);

  const getCanvasGridStep = (stage) => {
    const stageWidth = Number(stage?.width?.()) || 0;
    const stageHeight = Number(stage?.height?.()) || 0;
    const granularityMultiplier = Math.min(
      Math.max(Number(canvasNavigationGridGranularity) || 1, 1),
      10
    );
    return {
      x: stageWidth > 0 ? stageWidth / (20 * granularityMultiplier) : 0,
      y: stageHeight > 0 ? stageHeight / (20 * granularityMultiplier) : 0,
    };
  };

  const getResolvedEraserPoint = (stage, point) => {
    if (!point) {
      return null;
    }

    if (!snapEraserToGrid) {
      return point;
    }

    const { x: stepX, y: stepY } = getCanvasGridStep(stage);
    const stageWidth = Number(stage?.width?.()) || point.x;
    const stageHeight = Number(stage?.height?.()) || point.y;
    if (!stepX || !stepY) {
      return point;
    }

    return {
      x: Math.min(Math.max(Math.round(point.x / stepX) * stepX, 0), stageWidth),
      y: Math.min(Math.max(Math.round(point.y / stepY) * stepY, 0), stageHeight),
    };
  };

  const getGridAlignedEraserColumn = (activeEraserLayer, stage, point) => {
    if (!activeEraserLayer || !stage || !point) {
      return null;
    }

    const { x: stepX } = getCanvasGridStep(stage);
    const eraserImageNode =
      activeEraserLayer.findOne('#originalShape') || activeEraserLayer.children?.[0] || null;

    if (!stepX || !eraserImageNode) {
      return null;
    }

    const imageBounds = eraserImageNode.getClientRect({
      skipTransform: false,
      skipShadow: false,
      skipStroke: false,
    });
    if (!imageBounds?.width || !imageBounds?.height) {
      return null;
    }

    const imageLeft = imageBounds.x;
    const imageRight = imageBounds.x + imageBounds.width;
    const imageTop = imageBounds.y;
    const imageBottom = imageBounds.y + imageBounds.height;
    const stageWidth = Number(stage?.width?.()) || imageRight;
    const clampedX = Math.min(
      Math.max(point.x, imageLeft),
      Math.max(imageLeft, imageRight - 0.001)
    );
    const columnIndex = Math.max(Math.floor(clampedX / stepX), 0);
    const columnStart = columnIndex * stepX;
    const columnEnd = Math.min(columnStart + stepX, stageWidth);
    const x = Math.max(columnStart, imageLeft);
    const width = Math.min(columnEnd, imageRight) - x;

    if (width <= 0) {
      return null;
    }

    return {
      x,
      y: imageTop,
      width,
      height: imageBottom - imageTop,
    };
  };

  const drawEraserStrokeAtPoint = (activeEraserLayer, stage, point, options = {}) => {
    if (!activeEraserLayer || !stage || !point) {
      return;
    }

    const resolvedPoint = getResolvedEraserPoint(stage, point);
    if (!resolvedPoint) {
      return;
    }

    const eraserRadius = eraserWidthRef.current ? eraserWidthRef.current / 2 : eraserWidth / 2;
    const isInitialPoint = options.isInitialPoint || !lastEraserPointRef.current;

    if (snapEraserToGrid) {
      const activeGridColumn =
        activeSnappedEraserColumnRef.current
        || getGridAlignedEraserColumn(activeEraserLayer, stage, point);

      if (activeGridColumn) {
        const columnTop = activeGridColumn.y;
        const columnBottom = activeGridColumn.y + activeGridColumn.height;
        const currentY = Math.min(Math.max(point.y, columnTop), columnBottom);
        let segmentTop = Math.max(currentY - eraserRadius, columnTop);
        let segmentBottom = Math.min(currentY + eraserRadius, columnBottom);

        activeSnappedEraserColumnRef.current = activeGridColumn;

        if (!isInitialPoint && lastEraserPointRef.current) {
          segmentTop = Math.max(Math.min(lastEraserPointRef.current.y, currentY), columnTop);
          segmentBottom = Math.min(Math.max(lastEraserPointRef.current.y, currentY), columnBottom);
        }

        if (segmentBottom > segmentTop) {
          const eraserStrip = new Konva.Rect({
            x: activeGridColumn.x,
            y: segmentTop,
            width: activeGridColumn.width,
            height: segmentBottom - segmentTop,
            fill: 'black',
            globalCompositeOperation: 'destination-out',
            listening: false,
            id: 'eraserGridStrip',
          });
          activeEraserLayer.add(eraserStrip);
          recordEraserStrokeNode(eraserStrip);
          activeEraserLayer.batchDraw();
        }

        lastEraserPointRef.current = {
          x: activeGridColumn.x + activeGridColumn.width / 2,
          y: currentY,
        };
        return;
      }
    }

    if (!snapEraserToGrid) {
      const eraserShape = new Konva.Circle({
        x: resolvedPoint.x,
        y: resolvedPoint.y,
        radius: eraserRadius,
        fill: 'black',
        globalCompositeOperation: 'destination-out',
        listening: false,
        id: 'eraserCircle',
      });
      activeEraserLayer.add(eraserShape);
      recordEraserStrokeNode(eraserShape);
    }

    lastEraserPointRef.current = resolvedPoint;
    activeEraserLayer.batchDraw();
  };

  const getEraserResultPayload = () => {
    if (!eraserLayer) {
      return null;
    }

    const eraserLayerImage = getEraserLayerImageNode();
    if (!eraserLayerImage) {
      return null;
    }

    const boundingBox = eraserLayerImage.getClientRect({
      skipTransform: false,
      skipShadow: false,
      skipStroke: false,
    });

    if (!boundingBox?.width || !boundingBox?.height) {
      return null;
    }

    return {
      boundingBox,
      dataURL: eraserLayer.toDataURL({
        x: boundingBox.x,
        y: boundingBox.y,
        width: boundingBox.width,
        height: boundingBox.height,
        pixelRatio: 1,
      }),
    };
  };

  const finishEraserStroke = (activeEraserLayer = eraserLayer) => {
    if (!activeEraserLayer) {
      setIsPainting(false);
      activeSnappedEraserColumnRef.current = null;
      currentEraserStrokeNodesRef.current = [];
      lastEraserPointRef.current = null;
      return;
    }

    commitCurrentEraserStroke();

    const imageNode = activeEraserLayer.findOne('#originalShape') || activeEraserLayer.children?.[0];
    const boundingBox = imageNode?.getClientRect?.();
    if (boundingBox) {
      setEraserToolbarPosition({ x: boundingBox.x, y: boundingBox.y + 50 });
      setEraserToolbarVisible(true);
    }
    setIsPainting(false);
    activeSnappedEraserColumnRef.current = null;
    lastEraserPointRef.current = null;
    setEraserLayer(activeEraserLayer);
    activeEraserLayer.off('mousemove');
    activeEraserLayer.off('mouseup');
  };


  useEffect(() => {
    if (snapEraserToGrid && !showCanvasNavigationGrid) {
      setShowCanvasNavigationGrid(true);
    }
  }, [showCanvasNavigationGrid, setShowCanvasNavigationGrid, snapEraserToGrid]);

  useEffect(() => {
    const stage = ref.current.getStage();

    const positions = activeItemList.map(item => {
      if (!item.id) {
        return;
      }
      const itemId = item.id.toString();
      const node = stage.findOne(`#${itemId}`);
      if (node) {
        const absPos = node.getClientRect({ skipTransform: false, skipShadow: false, skipStroke: false });
        return { id: item.id, x: absPos.x + 30, y: absPos.y + 30 };
      }
      return null;
    }).filter(Boolean);



    setButtonPositions(positions);
  }, [activeItemList, ref, selectedId]);

  const nudgeSelectedTextItem = useCallback((deltaX, deltaY) => {
    if (!selectedId || selectedLayerType !== 'text') {
      return false;
    }

    const selectedTextItem = activeItemList.find(
      (item) => item?.id === selectedId && item?.type === 'text' && !item?.isHidden
    );

    if (!selectedTextItem) {
      return false;
    }

    const currentX = Number(selectedTextItem.config?.x);
    const currentY = Number(selectedTextItem.config?.y);

    if (!Number.isFinite(currentX) || !Number.isFinite(currentY)) {
      return false;
    }

    const nextActiveItemList = activeItemList.map((item) => {
      if (item?.id !== selectedId) {
        return item;
      }

      return {
        ...item,
        config: {
          ...(item.config || {}),
          x: currentX + deltaX,
          y: currentY + deltaY,
        },
      };
    });

    setActiveItemList(nextActiveItemList);
    updateSessionActiveItemList(nextActiveItemList);
    return true;
  }, [
    activeItemList,
    selectedId,
    selectedLayerType,
    setActiveItemList,
    updateSessionActiveItemList,
  ]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      if (shouldIgnoreCanvasNudgeShortcut(event.target)) {
        return;
      }

      const step = event.shiftKey ? 10 : 1;
      let deltaX = 0;
      let deltaY = 0;

      switch (event.key) {
        case 'ArrowLeft':
          deltaX = -step;
          break;
        case 'ArrowRight':
          deltaX = step;
          break;
        case 'ArrowUp':
          deltaY = -step;
          break;
        case 'ArrowDown':
          deltaY = step;
          break;
        default:
          return;
      }

      const moved = nudgeSelectedTextItem(deltaX, deltaY);
      if (moved) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [nudgeSelectedTextItem]);


  useEffect(() => {
    initialParamsRef.current = {};
  }, [currentLayer]);


  useEffect(() => {
    const { duration, durationOffset } = currentLayer;
    const elapsedTime = (currentLayerSeek / DISPLAY_FRAMES_PER_SECOND) * 1000; // Convert to milliseconds
    const stage = ref.current.getStage();
    const layer = stage.findOne("#baseGroup");
    if (!layer) return;
    activeItemList.forEach(item => {
      const node = layer.findOne(`#${item.id}`);
      if (node) {
        applyAnimationsToNode(node, item, elapsedTime, duration, durationOffset, sessionDetails?.framesPerSecond);
      }
    });
  }, [currentLayerSeek, currentLayer, activeItemList, sessionDetails?.framesPerSecond]);



  useEffect(() => {
    showEraserRef.current = showEraser;
    showPencilRef.current = showPencil;
    editMasklinesRef.current = editMasklines;
    eraserWidthRef.current = eraserWidth;
  }, [showEraser, showPencil, editMasklines, eraserWidth]);


  useEffect(() => {
    setShowMask(false);
    setShowEraser(false);
    const stage = ref.current.getStage();
    const container = stage.container();
    if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_EDIT_DISPLAY && selectedEditModelValue && selectedEditModelValue.editType === 'inpaint') {
      setEditMaskLines([]);
      setShowMask(true);
      container.style.cursor = generateCursor(editBrushWidth);
    } else if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY) {
      setShowEraser(true);
      container.style.cursor = generateCursor(eraserWidthRef.current);
    } else if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY) {
      setShowPencil(true);
      container.style.cursor = generatePencilCursor(20);
    } else {
      setEditMaskLines([]);
      container.style.cursor = 'default';
    }
  }, [currentView, currentCanvasAction, selectedEditModelValue]);


  useEffect(() => {
    if (
      currentView === CURRENT_TOOLBAR_VIEW.SHOW_EDIT_DISPLAY &&
      selectedEditModelValue &&
      selectedEditModelValue.editType === 'inpaint'
    ) {
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = generateCursor(editBrushWidth);
    }
  }, [editBrushWidth, currentView, selectedEditModelValue]);



  useEffect(() => {
    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY) {
      eraserExitHandledRef.current = false;
      const stage = ref.current.getStage();
      const container = stage.container();
      container.style.cursor = generateCursor(eraserWidth);
    }
  }, [currentCanvasAction, eraserWidth]);

  useEffect(() => {
    if (!isPainting || currentCanvasAction !== TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY) {
      return undefined;
    }

    const handlePointerRelease = () => {
      finishEraserStroke();
    };

    window.addEventListener('mouseup', handlePointerRelease);
    window.addEventListener('pointerup', handlePointerRelease);
    window.addEventListener('pointercancel', handlePointerRelease);

    return () => {
      window.removeEventListener('mouseup', handlePointerRelease);
      window.removeEventListener('pointerup', handlePointerRelease);
      window.removeEventListener('pointercancel', handlePointerRelease);
    };
  }, [currentCanvasAction, eraserLayer, isPainting]);


  const previousActionViewRef = useRef();

  useEffect(() => {
    if (previousActionViewRef.current === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY && currentCanvasAction !== TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY) {
      setEraserToolbarPosition(null);
      setEraserToolbarVisible(false);
      if (!eraserExitHandledRef.current) {
        replaceTopLayer();
      }
      eraserExitHandledRef.current = false;
    }
  }, [currentCanvasAction]);



  const replaceEraserImage = () => {
    eraserExitHandledRef.current = true;
    replaceTopLayer();
    setEraserToolbarVisible(false);
    setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
  }

  const duplicateEraserImage = () => {
    eraserExitHandledRef.current = true;
    duplicateTopLayer();
    setEraserToolbarVisible(false);
    setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
  }

  const resetEraserImage = () => {
    const stage = ref.current.getStage();
    eraserExitHandledRef.current = true;
    activeSnappedEraserColumnRef.current = null;
    resetEraserHistory();
    lastEraserPointRef.current = null;
    if (eraserLayer) {
      eraserLayer.destroy();
      setEraserLayer(null);
      if (tempTopNode) {
        const layer = stage.findOne('#baseGroup');
        layer.add(tempTopNode);
        tempTopNode.show();
        setTempTopNode(null);
        layer.draw();
      }
    }
    eraserTargetItemIdRef.current = null;
    setEraserToolbarVisible(false);
    setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
    setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_DEFAULT_DISPLAY);
  };

  useEffect(() => {
    if (previousActionViewRef.current === TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY && currentCanvasAction !== TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY) {

      const stage = ref.current.getStage();
      const pencilGroup = stage.findOne('#pencilGroup');
      if (pencilGroup) {


        const dataURL = pencilGroup.toDataURL();
        const imageObj = new window.Image();
        imageObj.onload = () => {
          const groupClientRect = pencilGroup.getClientRect();
          const newItem = createCurrentLayerImageItem({
            id: `item_${activeItemList.length}`,
            src: dataURL,
            x: groupClientRect.x,
            y: groupClientRect.y,
            width: groupClientRect.width,
            height: groupClientRect.height,
          });
          const newItemList = [...activeItemList, newItem];



          setActiveItemList(newItemList);
          pencilGroup.off();
          pencilGroup.destroy();
          setShowPencil(false);
          updateSessionActiveItemList(newItemList)
        };
        imageObj.src = dataURL;
      }
    }
    if (previousActionViewRef.current !== currentCanvasAction) {
      previousActionViewRef.current = currentCanvasAction;
    }
  }, [currentCanvasAction, currentView]);




  const handleLayerMouseDown = (e) => {
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();
    if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_SELECT_DISPLAY && (selectedLayerSelectShape === 'rectangle' || selectedLayerSelectShape === 'circle')) {
      if (!shapeSet) {
        startPosRef.current = point;
        setIsDrawing(true);
        setToolbarShapeProps({ x: point.x, y: point.y, radius: 0 });
      }
    } else if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY) {
      let newEraserLayer = eraserLayer;
      if (!newEraserLayer) {
        const target = getTopVisibleImageTarget(stage, point);
        if (!target) {
          return;
        }

        const targetImageNode = target.node.findOne('Image') || target.node.children?.[0];
        if (!targetImageNode) {
          return;
        }

        newEraserLayer = new Konva.Layer();
        const clonedImageNode = targetImageNode.clone({ id: 'originalShape' });
        setTempTopNode(target.node.clone());
        eraserTargetItemIdRef.current = target.item.id;
        activeSnappedEraserColumnRef.current = null;
        resetEraserHistory();
        target.node.destroy();
        newEraserLayer.add(clonedImageNode);
        stage.add(newEraserLayer);
        setEraserLayer(newEraserLayer);
      }

      setEraserToolbarPosition(null);
      setEraserToolbarVisible(false);
      setIsPainting(true);
      setHandlersForLayer(newEraserLayer);
      newEraserLayer.off('mousedown');
      newEraserLayer.on('mousedown', () => {
        if (showEraserRef.current) {
          setIsPainting(true);
          activeSnappedEraserColumnRef.current = null;
          currentEraserStrokeNodesRef.current = [];
          lastEraserPointRef.current = null;
          setHandlersForLayer(newEraserLayer);
        }
        setEraserToolbarPosition(null);
        setEraserToolbarVisible(false);
      });

      function setHandlersForLayer(nextEraserLayer) {
        nextEraserLayer.off('mousemove');
        nextEraserLayer.off('mouseup');
        nextEraserLayer.on('mousemove', () => {
          const currentPoint = stage.getPointerPosition();
          drawEraserStrokeAtPoint(nextEraserLayer, stage, currentPoint);
        });
        nextEraserLayer.on('mouseup', () => {
          finishEraserStroke(nextEraserLayer);
        });
      }

      activeSnappedEraserColumnRef.current = null;
      currentEraserStrokeNodesRef.current = [];
      lastEraserPointRef.current = null;
      drawEraserStrokeAtPoint(newEraserLayer, stage, point, { isInitialPoint: true });
    } else if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY) {
      setIsPainting(true);
      setPaintToolbarVisible(false);
      const pos = e.target.getStage().getPointerPosition();
      setPencilLines([...pencilLines, { points: [pos.x, pos.y], stroke: pencilColor, strokeWidth: pencilWidth }]);
    } else if (isMaskPaintMode) {
      setIsPainting(true);
      const pos = e.target.getStage().getPointerPosition();
      addLine([pos.x, pos.y, pos.x, pos.y]);
    }
  };

  const handleLayerMouseMove = (e) => {
    const stage = e.target.getStage();
    const pointerPosition = stage.getPointerPosition();
    if (isDrawing && !shapeSet) {
      const startX = startPosRef.current.x;
      const startY = startPosRef.current.y;

      if (selectedLayerSelectShape === 'rectangle') {
        const newProps = {
          ...toolbarShapeProps,
          x: Math.min(startX, pointerPosition.x),
          y: Math.min(startY, pointerPosition.y),
          width: Math.abs(pointerPosition.x - startX),
          height: Math.abs(pointerPosition.y - startY),
        };
        setToolbarShapeProps(newProps);
      } else if (selectedLayerSelectShape === 'circle') {
        const newProps = {
          ...toolbarShapeProps,
          x: startX,
          y: startY,
          radius: Math.sqrt(
            (pointerPosition.x - startX) ** 2 + (pointerPosition.y - startY) ** 2
          ),
        };
        setToolbarShapeProps(newProps);
      }

      return;
    }
    if (!isPainting) return;
    const point = stage.getPointerPosition();
    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY && eraserLayer) {
      drawEraserStrokeAtPoint(eraserLayer, stage, point);
    } else if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY) {
      let lastLine = pencilLines[pencilLines.length - 1];
      if (lastLine) {
        lastLine.points = lastLine.points.concat([point.x, point.y]);
        setPencilLines(pencilLines.slice(0, -1).concat(lastLine));
      }
    } else if (editMasklinesRef.current.length > 0) {
      let lastLine = editMasklinesRef.current[editMasklinesRef.current.length - 1];
      lastLine.points = lastLine.points.concat([point.x, point.y]);
      setEditMaskLines(editMasklinesRef.current.slice(0, -1).concat(lastLine));
    }
  };

  const handleLayerMouseUp = () => {
    if (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_ERASER_DISPLAY && eraserLayer) {
      finishEraserStroke();
    }

    setIsPainting(false);
    setIsDrawing(false);

    if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_SELECT_DISPLAY && (currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_SELECT_SHAPE_DISPLAY)) {
      const stage = ref.current.getStage();
      const layer = stage.findOne('#shapeSelectToolbar');
      if (layer) {
        let newYPos = layer.attrs.y > 40 ? layer.attrs.y - 40 : layer.attrs.y;
        setShapeSelectToolbarVisible(true);
        setShapeSelectToolbarPosition({ x: layer.attrs.x, y: newYPos });
        if (toolbarShapeProps.radius > 0 || toolbarShapeProps.width > 0 || toolbarShapeProps.height > 0) {
          setShapeSet(true);
        }
      }
    } else {
      setShapeSet(false);
      setShapeSelectToolbarVisible(false);
    }

    if (currentView === CURRENT_TOOLBAR_VIEW.SHOW_ACTIONS_DISPLAY && currentCanvasAction === TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY) {
      setPaintToolbarVisible(true);
      setPaintToolbarPosition({ x: toolbarShapeProps.x, y: toolbarShapeProps.y + 40 });
    }
  };



  const addLine = (points) => {
    setEditMaskLines([...editMasklines, { points, stroke: 'white', strokeWidth: editBrushWidth }]);
  };




  const replaceTopLayer = () => {
    const eraserResult = getEraserResultPayload();
    if (!eraserResult) {
      return;
    }

    lastEraserPointRef.current = null;

    const { boundingBox, dataURL } = eraserResult;
    const targetItemId = eraserTargetItemIdRef.current;
    const targetIndex = activeItemList.findIndex((item) => item?.id === targetItemId);
    const resolvedTargetIndex = targetIndex >= 0 ? targetIndex : activeItemList.length - 1;
    const targetItem = activeItemList[resolvedTargetIndex];

    if (!targetItem) {
      return;
    }

    const imageObj = new window.Image();
    imageObj.onload = () => {
      const newItem = createCurrentLayerImageItem({
        ...targetItem,
        id: targetItem.id,
        src: dataURL,
        width: imageObj.width / stageZoomScale,
        height: imageObj.height / stageZoomScale,
        x: boundingBox.x / stageZoomScale,
        y: boundingBox.y / stageZoomScale,
      });
      const newActiveItemList = activeItemList.map((item, index) =>
        index === resolvedTargetIndex ? newItem : item
      );
      setActiveItemList(newActiveItemList);
      eraserLayer.off();
      eraserLayer.destroy();
      setEraserLayer(null);
      setTempTopNode(null);
      activeSnappedEraserColumnRef.current = null;
      resetEraserHistory();
      eraserTargetItemIdRef.current = null;
      updateSessionActiveItemList(newActiveItemList);
      setSelectedId(null);
    };
    imageObj.src = dataURL;
  }

  const duplicateTopLayer = () => {
    const eraserResult = getEraserResultPayload();
    if (!eraserResult) {
      return;
    }

    lastEraserPointRef.current = null;

    const { boundingBox, dataURL } = eraserResult;
    const imageObj = new window.Image();
    imageObj.onload = () => {
      const newItem = createCurrentLayerImageItem({
        id: `item_${activeItemList.length}`,
        src: dataURL,
        width: imageObj.width / stageZoomScale,
        height: imageObj.height / stageZoomScale,
        x: boundingBox.x / stageZoomScale,
        y: boundingBox.y / stageZoomScale,
      });
      const newActiveItemList = [...activeItemList, newItem];
      setActiveItemList(newActiveItemList);
      updateSessionActiveItemList(newActiveItemList);
      eraserLayer.off();
      eraserLayer.destroy();
      setEraserLayer(null);
      setTempTopNode(null);
      activeSnappedEraserColumnRef.current = null;
      resetEraserHistory();
      eraserTargetItemIdRef.current = null;
    };
    imageObj.src = dataURL;
  }


  const flipImageHorizontal = (id) => {
    const stage = ref.current.getStage();
    const imageNode = stage.findOne(`#${id}`);
    if (!imageNode) {
      return;
    }

    // Flip the image horizontally
    imageNode.scaleX(imageNode.scaleX() * -1);
    stage.batchDraw();

    // Convert the updated image node to a data URL
    const updatedImageDataUrl = imageNode.toDataURL();

    // Update the activeItemList with the new data URL
    const updatedItemList = activeItemList.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          src: updatedImageDataUrl,
        };
      }
      return item;
    });

    setActiveItemList(updatedItemList);

    // Send a backend request to update the session layer
    updateSessionActiveItemList(updatedItemList);
  };

  const flipImageVertical = (id) => {
    const stage = ref.current.getStage();
    const imageNode = stage.findOne(`#${id}`);
    if (!imageNode) {
      return;
    }

    // Flip the image vertically
    imageNode.scaleY(imageNode.scaleY() * -1);
    stage.batchDraw();

    // Convert the updated image node to a data URL
    const updatedImageDataUrl = imageNode.toDataURL();

    // Update the activeItemList with the new data URL
    const updatedItemList = activeItemList.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          src: updatedImageDataUrl,
        };
      }
      return item;
    });

    setActiveItemList(updatedItemList);

    // Send a backend request to update the session layer
    updateSessionActiveItemList(updatedItemList);
  };

  const onCopyShapeLayer = () => {
    setIsShapeVisible(false);
    setShapeSelectToolbarVisible(false);
    const stage = ref.current.getStage();
    const shape = stage.findOne("#shapeSelectToolbar");
    let transformer;
    if (shape) {
      if (shape.attrs.type === 'circle') {
        transformer = shapeSelectTransformerCircleRef.current; // Add this line to get transformer reference
      } else if (shape.attrs.type === 'rectangle') {
        transformer = shapeSelectTransformerRectangleRef.current; // Add this line to get transformer reference
      }
      if (transformer) {
        transformer.hide(); // Hide transformer boundaries
      }
      const boundingBox = shape.getClientRect();
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = boundingBox.width;
      offscreenCanvas.height = boundingBox.height;
      const offscreenCtx = offscreenCanvas.getContext('2d');
      shape.hide();
      offscreenCtx.drawImage(
        stage.toCanvas(),
        boundingBox.x, boundingBox.y,
        boundingBox.width, boundingBox.height,
        0, 0,
        boundingBox.width, boundingBox.height
      );
      if (shape.attrs.type === 'circle') {
        const shapeRadius = shape.attrs.radius;
        const centerX = boundingBox.width / 2;
        const centerY = boundingBox.height / 2;
        const imageData = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        const data = imageData.data;
        for (let y = 0; y < offscreenCanvas.height; y++) {
          for (let x = 0; x < offscreenCanvas.width; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > shapeRadius) {
              const index = (y * offscreenCanvas.width + x) * 4;
              data[index + 3] = 0;
            }
          }
        }
        offscreenCtx.putImageData(imageData, 0, 0);
      }
      const dataURL = offscreenCanvas.toDataURL();
      const imageObj = new window.Image();
      imageObj.onload = () => {
        const newItem = createCurrentLayerImageItem({
          id: `item_${activeItemList.length}`,
          src: dataURL,
          width: imageObj.width / stageZoomScale,
          height: imageObj.height / stageZoomScale,
          x: boundingBox.x / stageZoomScale,
          y: boundingBox.y / stageZoomScale,
        });

        const newActiveItemList = [...activeItemList, newItem];

        setActiveItemList(newActiveItemList);
        updateSessionActiveItemList(newActiveItemList);
        if (transformer) {
          transformer.show(); // Show transformer boundaries again
        }
      };
      imageObj.src = dataURL;
    }
  };

  const onReplaceShapeLayer = () => {
    setIsShapeVisible(false);
    setShapeSelectToolbarVisible(false);
    const stage = ref.current.getStage();
    const shape = stage.findOne("#shapeSelectToolbar");
    let transformer;

    if (shape) {
      if (shape.attrs.type === 'circle') {
        transformer = shapeSelectTransformerCircleRef.current; // Add this line to get transformer reference
      } else if (shape.attrs.type === 'rectangle') {
        transformer = shapeSelectTransformerRectangleRef.current; // Add this line to get transformer reference
      }
      if (transformer) {
        transformer.hide(); // Hide transformer boundaries
      }
      const boundingBox = shape.getClientRect();
      const offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = boundingBox.width;
      offscreenCanvas.height = boundingBox.height;
      const offscreenCtx = offscreenCanvas.getContext('2d');
      shape.hide();
      offscreenCtx.drawImage(
        stage.toCanvas(),
        boundingBox.x, boundingBox.y,
        boundingBox.width, boundingBox.height,
        0, 0,
        boundingBox.width, boundingBox.height
      );
      if (shape.attrs.type === 'circle') {
        const shapeRadius = shape.attrs.radius;
        const centerX = boundingBox.width / 2;
        const centerY = boundingBox.height / 2;
        const imageData = offscreenCtx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
        const data = imageData.data;
        for (let y = 0; y < offscreenCanvas.height; y++) {
          for (let x = 0; x < offscreenCanvas.width; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > shapeRadius) {
              const index = (y * offscreenCanvas.width + x) * 4;
              data[index + 3] = 0;
            }
          }
        }
        offscreenCtx.putImageData(imageData, 0, 0);
      }
      const dataURL = offscreenCanvas.toDataURL();
      const imageObj = new window.Image();
      imageObj.onload = () => {
        const newItem = createCurrentLayerImageItem({
          id: `item_${activeItemList.length - 1}`,
          src: dataURL,
          width: imageObj.width / stageZoomScale,
          height: imageObj.height / stageZoomScale,
          x: boundingBox.x / stageZoomScale,
          y: boundingBox.y / stageZoomScale,
        });

        let prevActiveList = [...activeItemList];
        prevActiveList[prevActiveList.length - 1] = newItem;
        setActiveItemList(prevActiveList);
        updateSessionActiveItemList(prevActiveList);
        if (transformer) {
          transformer.show(); // Show transformer boundaries again
        }
        setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
      };
      imageObj.src = dataURL;
    }
  };

  const handleResetShapeLayer = () => {
    setIsShapeVisible(false);
    setShapeSelectToolbarVisible(false);
  };


  const removeSelectedItem = () => {


    const newList = activeItemList.filter((item) => item.id !== selectedId);

    const reorderedItems = newList.map((item, newIndex) => ({
      ...item,
      id: `item_${newIndex}`
    }));


    setActiveItemList(reorderedItems);
    updateSessionActiveItemList(reorderedItems);
  }


  const removeItem = (index) => {



    const newList = [...activeItemList];
    newList.splice(index, 1);

    // Reorder the IDs of the remaining items
    const reorderedItems = newList.map((item, newIndex) => ({
      ...item,
      id: `item_${newIndex}`
    }));


    setActiveItemList(reorderedItems);
    updateSessionActiveItemList(reorderedItems);
  }

  const updateTargetActiveLayerConfig = (id, newConfig, updateState = true) => {




    const scaledNewConfig = {
      ...newConfig,
      x: newConfig.x / stageZoomScale,
      y: newConfig.y / stageZoomScale,
      width: newConfig.width / stageZoomScale,
      height: newConfig.height / stageZoomScale,

    }



    const newItem = activeItemList.find((item) => item.id === id);


    if (newItem.type === 'image') {
      newItem.x = scaledNewConfig.x;
      newItem.y = scaledNewConfig.y;
      newItem.width = scaledNewConfig.width;
      newItem.height = scaledNewConfig.height;
    }


    const newActiveItemList = activeItemList.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          ...scaledNewConfig,
        };
      }
      return item;
    });
    if (updateState) {
      setActiveItemList(newActiveItemList);
    }
    updateSessionActiveItemList(newActiveItemList);
  }



  const updateTargetImageActiveLayerConfig = (id, newConfig, updateState = true) => {


    const newActiveItemList = activeItemList.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          ...newConfig,
        };
      }
      return item;
    });
    if (updateState) {
      setActiveItemList(newActiveItemList);
    }
    updateSessionActiveItemList(newActiveItemList);
  }


  const updateTargetShapeActiveLayerConfig = (id, newConfig) => {



    let scaledNewConfig = {
      ...newConfig,
      x: newConfig.x / stageZoomScale,
      y: newConfig.y / stageZoomScale,
    }
    SHAPE_CONFIG_SCALE_KEYS.forEach((key) => {
      if (typeof newConfig[key] === 'number') {
        scaledNewConfig[key] = newConfig[key] / stageZoomScale;
      }
    });

    const newActiveItemList = activeItemList.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          config: {
            ...item.config,
            ...scaledNewConfig,
          },
        };
      }
      return item;
    });

    setActiveItemList(newActiveItemList);
    updateSessionActiveItemList(newActiveItemList);
  }


  const updateTargetShapeActiveLayerConfigNoScale = (id, newConfig) => {





    let scaledNewConfig = {
      ...newConfig,
      x: newConfig.x,
      y: newConfig.y ,
      width: newConfig.width,
      height: newConfig.height,
    }


    const newActiveItemList = activeItemList.map((item) => {
      if (item.id === id) {
        return {
          ...item,
          config: {
            ...item.config,
            ...scaledNewConfig,
          },
        };
      }
      return item;
    });

    setActiveItemList(newActiveItemList);
    updateSessionActiveItemList(newActiveItemList);
  }



  const updateTargetTextActiveLayerConfig = (id, newConfig) => {
    const {
      text: nextText,
      positionMode,
      styleValueSpace = 'canvas',
      bringToFront = false,
      ...configChanges
    } = newConfig || {};

    const stage = ref.current?.getStage?.();
    const useExplicitCenterPosition =
      positionMode === 'center'
      && typeof configChanges.x === 'number'
      && typeof configChanges.y === 'number';


    const textNode = stage?.findOne?.(`#${id}`);
    if (!textNode && !useExplicitCenterPosition) {

      return;
    }

    const boundingBox = textNode?.getClientRect?.();

    let centerX = boundingBox ? boundingBox.x + boundingBox.width / 2 : 0;
    let centerY = boundingBox ? boundingBox.y + boundingBox.height / 2 : 0;
    const useRawStyleValues = styleValueSpace === 'raw';


    let scaledNewConfig = {
      ...configChanges,
      x: useExplicitCenterPosition ? configChanges.x : centerX / stageZoomScale,
      y: useExplicitCenterPosition ? configChanges.y : centerY / stageZoomScale,
    };
    if (typeof configChanges.width === 'number') {
      scaledNewConfig.width = useRawStyleValues
        ? configChanges.width
        : configChanges.width / stageZoomScale;
    }
    if (typeof configChanges.height === 'number') {
      scaledNewConfig.height = useRawStyleValues
        ? configChanges.height
        : configChanges.height / stageZoomScale;
    }
    if (typeof configChanges.fontSize === 'number') {
      scaledNewConfig.fontSize =
        useRawStyleValues
          ? configChanges.fontSize
          : configChanges.fontSize / stageZoomScale;
    }
    if (typeof configChanges.strokeWidth === 'number') {
      scaledNewConfig.strokeWidth =
        useRawStyleValues
          ? configChanges.strokeWidth
          : configChanges.strokeWidth / stageZoomScale;
    }
    ['letterSpacing', 'shadowBlur', 'shadowOffsetX', 'shadowOffsetY'].forEach((key) => {
      if (typeof configChanges[key] === 'number') {
        scaledNewConfig[key] = useRawStyleValues
          ? configChanges[key]
          : configChanges[key] / stageZoomScale;
      }
    });


    let updatedItem = null;
    const newActiveItemList = activeItemList.map((item) => {
      if (item.id === id) {
        updatedItem = {
          ...item,
          ...(typeof nextText === 'string' ? { text: nextText } : {}),
          config: {
            ...item.config,
            ...scaledNewConfig,
          },
        };
        return updatedItem;
      }
      return item;
    });

    const nextActiveItemList = bringToFront && updatedItem
      ? [
        ...newActiveItemList.filter((item) => item.id !== id),
        updatedItem,
      ]
      : newActiveItemList;

    setActiveItemList(nextActiveItemList);
    updateSessionActiveItemList(nextActiveItemList);
  };




  const addPaintImage = () => {
    const stage = ref.current.getStage();
    const pencilGroup = stage.findOne('#pencilGroup');
    if (pencilGroup) {

      const dataURL = pencilGroup.toDataURL();
      const imageObj = new window.Image();
      imageObj.onload = () => {
        const groupClientRect = pencilGroup.getClientRect();
        const newItem = createCurrentLayerImageItem({
          id: `item_${activeItemList.length}`,
          src: dataURL,
          x: groupClientRect.x / stageZoomScale,
          y: groupClientRect.y / stageZoomScale,
          width: groupClientRect.width / stageZoomScale,
          height: groupClientRect.height / stageZoomScale,
        });
        const newItemList = [...activeItemList, newItem];
        setActiveItemList(newItemList);
        pencilGroup.off();
        pencilGroup.destroy();
        setShowPencil(false);
        updateSessionActiveItemList(newItemList);
      };
      imageObj.src = dataURL;
      setCurrentCanvasAction(TOOLBAR_ACTION_VIEW.SHOW_PENCIL_DISPLAY);
      setPaintToolbarVisible(false);
      setCurrentView(CURRENT_TOOLBAR_VIEW.SHOW_DEFAULT_DISPLAY);
    }
  };

  const resetPaintImage = () => {
    const stage = ref.current.getStage();
    const paintLayer = stage.findOne('#pencilGroup');
    if (paintLayer) {
      paintLayer.destroyChildren();
      paintLayer.draw();
    }
    setPaintToolbarVisible(false);
  };




  return (
    <div>
      <VideoCanvas
        {...props}
        ref={ref}
        applyAnimationsToNode={applyAnimationsToNode}
        replaceTopLayer={replaceTopLayer}
        duplicateTopLayer={duplicateTopLayer}
        eraserLayer={eraserLayer}
        setEraserLayer={setEraserLayer}
        flipImageVertical={flipImageVertical}
        flipImageHorizontal={flipImageHorizontal}
        onCopyShapeLayer={onCopyShapeLayer}
        onReplaceShapeLayer={onReplaceShapeLayer}
        handleResetShapeLayer={handleResetShapeLayer}
        removeItem={removeItem}
        removeSelectedItem={removeSelectedItem}
        updateTargetActiveLayerConfig={updateTargetActiveLayerConfig}
        updateTargetShapeActiveLayerConfig={updateTargetShapeActiveLayerConfig}
        updateTargetTextActiveLayerConfig={updateTargetTextActiveLayerConfig}
        addPaintImage={addPaintImage}
        resetPaintImage={resetPaintImage}
        shapeSelectTransformerCircleRef={shapeSelectTransformerCircleRef}
        shapeSelectTransformerRectangleRef={shapeSelectTransformerRectangleRef}
        addLine={addLine}
        handleLayerMouseDown={handleLayerMouseDown}
        handleLayerMouseMove={handleLayerMouseMove}
        handleLayerMouseUp={handleLayerMouseUp}
        resetEraserImage={resetEraserImage}
        replaceEraserImage={replaceEraserImage}
        duplicateEraserImage={duplicateEraserImage}
        undoEraserStroke={undoEraserStroke}
        redoEraserStroke={redoEraserStroke}
        showEraser={showEraser}
        showMask={showMask}
        showPencil={showPencil}
        pencilLines={pencilLines}
        overlayImage={overlayImage}
        shapeSelectToolbarVisible={shapeSelectToolbarVisible}
        shapeSelectToolbarPosition={shapeSelectToolbarPosition}
        paintToolbarVisible={paintToolbarVisible}
        paintToolbarPosition={paintToolbarPosition}
        toolbarShapeProps={toolbarShapeProps}
        setToolbarShapeProps={setToolbarShapeProps}
        isDrawing={isDrawing}
        shapeSet={shapeSet}
        setShapeSet={setShapeSet}
        startPosRef={startPosRef}
        hoveredObject={hoveredObject}
        eraserWidthRef={eraserWidthRef}
        eraserToolbarPosition={eraserToolbarPosition}
        eraserToolbarVisible={eraserToolbarVisible}
        eraserUndoCount={eraserHistoryState.undoCount}
        eraserRedoCount={eraserHistoryState.redoCount}
        eraserHistoryLimit={ERASER_HISTORY_LIMIT}
        canUndoEraserStroke={eraserHistoryState.undoCount > 0 && !isPainting}
        canRedoEraserStroke={eraserHistoryState.redoCount > 0 && !isPainting}
        isExpressGeneration={isExpressGeneration}
        createTextLayer={createTextLayer}
        updateTargetImageActiveLayerConfig={updateTargetImageActiveLayerConfig}
        updateTargetShapeActiveLayerConfigNoScale={updateTargetShapeActiveLayerConfigNoScale}
        requestRealignToAiVideoAndLayers={requestRealignToAiVideoAndLayers}
        requestLipSyncToSpeech={requestLipSyncToSpeech}
        onPersistTextStyle={onPersistTextStyle}
      />

    </div>
  )
});

export default VideoCanvasContainer;
