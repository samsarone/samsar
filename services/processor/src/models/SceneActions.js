import hat from 'hat';

import VideoSession from '../schema/VideoSession.js';
import FrameGeneration from '../schema/FrameGeneration.js';
import { getDBConnectionString } from './DBString.js';
import { assertVideoSessionEditableAccess } from './VideoSession.js';
import { getCanvasDimensionsForAspectRatio } from '../utils/CanvasUtils.js';
import {
  getSceneActionById,
  getSceneActionSummaries,
  SCENE_ACTION_COMMAND,
} from '../consts/SceneActions.js';

const VISUAL_ITEM_TYPES = new Set(['image', 'shape', 'text']);

function toPlainObject(value) {
  if (!value) {
    return value;
  }

  if (typeof value.toObject === 'function') {
    return value.toObject();
  }

  return JSON.parse(JSON.stringify(value));
}

function stripHeavySessionFields(session) {
  const sessionPayload = toPlainObject(session);
  if (!sessionPayload || !Array.isArray(sessionPayload.layers)) {
    return sessionPayload;
  }

  return {
    ...sessionPayload,
    layers: sessionPayload.layers.map((layer) => {
      const nextLayer = { ...layer };
      delete nextLayer.frames;
      return nextLayer;
    }),
  };
}

function getNextItemId(activeItemList) {
  const maxItemNumber = activeItemList.reduce((maxValue, item) => {
    if (typeof item?.id !== 'string') {
      return maxValue;
    }

    const match = item.id.match(/^item_(\d+)$/);
    if (!match?.[1]) {
      return maxValue;
    }

    const parsedValue = Number.parseInt(match[1], 10);
    return Number.isFinite(parsedValue) ? Math.max(maxValue, parsedValue) : maxValue;
  }, -1);

  return `item_${maxItemNumber + 1}`;
}

function createFadeAnimation(actionId, startFade, endFade) {
  return {
    type: 'fade',
    params: {
      startFade,
      endFade,
    },
    sceneActionId: actionId,
  };
}

function createSlideAnimation(actionId, startX, endX, startY, endY) {
  return {
    type: 'slide',
    params: {
      startX,
      endX,
      startY,
      endY,
    },
    sceneActionId: actionId,
  };
}

function createZoomAnimation(actionId, startScale, endScale) {
  return {
    type: 'zoom',
    params: {
      startScale,
      endScale,
    },
    sceneActionId: actionId,
  };
}

function appendSceneAnimations(item, actionId, animations) {
  const existingAnimations = Array.isArray(item.animations) ? item.animations : [];
  const nextAnimations = existingAnimations.filter(
    (animation) => animation?.sceneActionId !== actionId
  );

  return {
    ...item,
    animations: [
      ...nextAnimations,
      ...animations,
    ],
  };
}

function createRectangleItem({
  id,
  action,
  x,
  y,
  width,
  height,
  color,
  animations,
}) {
  return {
    type: 'shape',
    shape: 'rectangle',
    id,
    x: 0,
    y: 0,
    width,
    height,
    config: {
      x,
      y,
      width,
      height,
      fillColor: color,
      strokeColor: color,
      strokeWidth: 0,
      fixed: true,
    },
    animations,
    isSceneActionItem: true,
    sceneActionId: action.id,
    sceneActionLabel: action.label,
  };
}

function getImageItems(activeItemList) {
  return activeItemList.filter((item) => item?.type === 'image' && !item?.isHidden);
}

function getItemNumber(value, fallback = 0) {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function getImageRect(item, canvasDimensions) {
  const width = getItemNumber(item.width ?? item.config?.width, canvasDimensions.width);
  const height = getItemNumber(item.height ?? item.config?.height, canvasDimensions.height);
  const x = getItemNumber(item.x ?? item.config?.x, 0);
  const y = getItemNumber(item.y ?? item.config?.y, 0);

  return { x, y, width, height };
}

function getOffscreenPosition(direction, rect, canvasDimensions) {
  switch (direction) {
    case 'left':
      return { x: -Math.max(rect.width, canvasDimensions.width), y: rect.y };
    case 'right':
      return { x: canvasDimensions.width, y: rect.y };
    case 'up':
      return { x: rect.x, y: -Math.max(rect.height, canvasDimensions.height) };
    case 'down':
      return { x: rect.x, y: canvasDimensions.height };
    default:
      return { x: rect.x, y: rect.y };
  }
}

function applyToImageItems(activeItemList, action, canvasDimensions, buildAnimations) {
  const imageItems = getImageItems(activeItemList);
  if (imageItems.length === 0) {
    throw new Error('This scene action needs at least one image item in the current layer.');
  }

  return activeItemList.map((item) => {
    if (item?.type !== 'image' || item?.isHidden) {
      return item;
    }

    return appendSceneAnimations(
      item,
      action.id,
      buildAnimations(item, getImageRect(item, canvasDimensions))
    );
  });
}

function applyOverlayFade(activeItemList, action, operation, canvasDimensions) {
  const nextId = getNextItemId(activeItemList);
  const overlayItem = createRectangleItem({
    id: nextId,
    action,
    x: 0,
    y: 0,
    width: canvasDimensions.width,
    height: canvasDimensions.height,
    color: operation.color,
    animations: [createFadeAnimation(action.id, operation.startFade, operation.endFade)],
  });

  return [...activeItemList, overlayItem];
}

function getOverlayWipeSlide(operation, canvasDimensions) {
  const start = { x: 0, y: 0 };
  const end = { x: 0, y: 0 };

  if (operation.mode === 'cover') {
    switch (operation.direction) {
      case 'left':
        start.x = canvasDimensions.width;
        break;
      case 'right':
        start.x = -canvasDimensions.width;
        break;
      case 'up':
        start.y = canvasDimensions.height;
        break;
      case 'down':
        start.y = -canvasDimensions.height;
        break;
      default:
        break;
    }
  } else {
    switch (operation.direction) {
      case 'left':
        end.x = -canvasDimensions.width;
        break;
      case 'right':
        end.x = canvasDimensions.width;
        break;
      case 'up':
        end.y = -canvasDimensions.height;
        break;
      case 'down':
        end.y = canvasDimensions.height;
        break;
      default:
        break;
    }
  }

  return { start, end };
}

function applyOverlayWipe(activeItemList, action, operation, canvasDimensions) {
  const nextId = getNextItemId(activeItemList);
  const { start, end } = getOverlayWipeSlide(operation, canvasDimensions);
  const overlayItem = createRectangleItem({
    id: nextId,
    action,
    x: 0,
    y: 0,
    width: canvasDimensions.width,
    height: canvasDimensions.height,
    color: operation.color,
    animations: [
      createSlideAnimation(action.id, start.x, end.x, start.y, end.y),
    ],
  });

  return [...activeItemList, overlayItem];
}

function applyLetterbox(activeItemList, action, operation, canvasDimensions) {
  const firstId = getNextItemId(activeItemList);
  const secondId = `item_${Number.parseInt(firstId.replace('item_', ''), 10) + 1}`;
  const barHeight = Math.max(1, Math.round(canvasDimensions.height * 0.12));
  const isIn = operation.mode === 'in';
  const topStartY = isIn ? -barHeight : 0;
  const topEndY = isIn ? 0 : -barHeight;
  const bottomVisibleY = canvasDimensions.height - barHeight;
  const bottomStartY = isIn ? canvasDimensions.height : bottomVisibleY;
  const bottomEndY = isIn ? bottomVisibleY : canvasDimensions.height;

  const topBar = createRectangleItem({
    id: firstId,
    action,
    x: 0,
    y: 0,
    width: canvasDimensions.width,
    height: barHeight,
    color: '#000000',
    animations: [createSlideAnimation(action.id, 0, 0, topStartY, topEndY)],
  });
  const bottomBar = createRectangleItem({
    id: secondId,
    action,
    x: 0,
    y: 0,
    width: canvasDimensions.width,
    height: barHeight,
    color: '#000000',
    animations: [createSlideAnimation(action.id, 0, 0, bottomStartY, bottomEndY)],
  });

  return [...activeItemList, topBar, bottomBar];
}

function applyItemFade(activeItemList, action, operation) {
  const visualItems = activeItemList.filter((item) => VISUAL_ITEM_TYPES.has(item?.type) && !item?.isHidden);
  if (visualItems.length === 0) {
    throw new Error('This scene action needs at least one visual item in the current layer.');
  }

  return activeItemList.map((item) => {
    if (!VISUAL_ITEM_TYPES.has(item?.type) || item?.isHidden) {
      return item;
    }

    return appendSceneAnimations(item, action.id, [
      createFadeAnimation(action.id, operation.startFade, operation.endFade),
    ]);
  });
}

function applyImageOperation(activeItemList, action, operation, canvasDimensions) {
  switch (operation.type) {
    case 'imageZoom':
      return applyToImageItems(activeItemList, action, canvasDimensions, () => [
        createZoomAnimation(action.id, operation.startScale, operation.endScale),
      ]);
    case 'imageSlideDelta':
      return applyToImageItems(activeItemList, action, canvasDimensions, (_item, rect) => [
        createSlideAnimation(
          action.id,
          rect.x,
          rect.x + canvasDimensions.width * operation.deltaXRatio,
          rect.y,
          rect.y + canvasDimensions.height * operation.deltaYRatio
        ),
      ]);
    case 'imageZoomSlide':
      return applyToImageItems(activeItemList, action, canvasDimensions, (_item, rect) => [
        createZoomAnimation(action.id, operation.startScale, operation.endScale),
        createSlideAnimation(
          action.id,
          rect.x,
          rect.x + canvasDimensions.width * operation.deltaXRatio,
          rect.y,
          rect.y + canvasDimensions.height * operation.deltaYRatio
        ),
      ]);
    case 'imageSlideIn':
      return applyToImageItems(activeItemList, action, canvasDimensions, (_item, rect) => {
        const start = getOffscreenPosition(operation.direction, rect, canvasDimensions);
        return [createSlideAnimation(action.id, start.x, rect.x, start.y, rect.y)];
      });
    case 'imageSlideOut':
      return applyToImageItems(activeItemList, action, canvasDimensions, (_item, rect) => {
        const end = getOffscreenPosition(operation.direction, rect, canvasDimensions);
        return [createSlideAnimation(action.id, rect.x, end.x, rect.y, end.y)];
      });
    case 'imageSway':
      return applyToImageItems(activeItemList, action, canvasDimensions, () => [
        {
          type: 'sway',
          params: {
            amplitude: operation.amplitude,
            frequency: operation.frequency,
          },
          sceneActionId: action.id,
        },
      ]);
    default:
      throw new Error(`Unsupported scene action operation: ${operation.type}`);
  }
}

function applySceneActionOperation({ activeItemList, action, canvasDimensions }) {
  const operation = action.operation;

  switch (operation.type) {
    case 'overlayFade':
      return applyOverlayFade(activeItemList, action, operation, canvasDimensions);
    case 'overlayWipe':
      return applyOverlayWipe(activeItemList, action, operation, canvasDimensions);
    case 'letterbox':
      return applyLetterbox(activeItemList, action, operation, canvasDimensions);
    case 'itemFade':
      return applyItemFade(activeItemList, action, operation);
    default:
      return applyImageOperation(activeItemList, action, operation, canvasDimensions);
  }
}

async function ensureUnlockedFrameGeneration(sessionId, layerId) {
  const normalizedSessionId = sessionId?.toString?.();
  const normalizedLayerId = layerId?.toString?.();

  if (!normalizedSessionId || !normalizedLayerId) {
    return null;
  }

  const existingGeneration = await FrameGeneration.findOne({
    sessionId: normalizedSessionId,
    layerId: normalizedLayerId,
    rowLocked: false,
  }).select('_id').lean();

  if (existingGeneration) {
    return existingGeneration;
  }

  return FrameGeneration.create({
    sessionId: normalizedSessionId,
    layerId: normalizedLayerId,
  });
}

export function isSceneActionsCommand(query) {
  return typeof query === 'string' && query.trim().toLowerCase() === SCENE_ACTION_COMMAND;
}

export function buildSceneActionsAssistantMessage(messageId = hat()) {
  return {
    role: 'assistant',
    content: 'Available scene actions. These update the current layer using canvas items and animations only; no generation request is created.',
    id: messageId,
    timestamp: new Date(),
    sceneActions: getSceneActionSummaries(),
  };
}

export async function appendSceneActionsCommandResponse(sessionData, userMessageContent, messageId = hat()) {
  const sessionMessages = Array.isArray(sessionData.sessionMessages)
    ? sessionData.sessionMessages
    : [];

  sessionData.sessionMessages = [
    ...sessionMessages,
    {
      role: 'user',
      content: userMessageContent,
      id: messageId,
      timestamp: new Date(),
    },
    buildSceneActionsAssistantMessage(messageId),
  ];
  sessionData.sessionMessageGenerationPending = false;
  sessionData.sessionMessageGenerationError = null;

  await sessionData.save();

  return {
    status: 'COMPLETED',
    handledCommand: SCENE_ACTION_COMMAND,
    sessionDetails: stripHeavySessionFields(sessionData),
  };
}

export async function listSceneActions() {
  return {
    command: SCENE_ACTION_COMMAND,
    sceneActions: getSceneActionSummaries(),
  };
}

export async function applySceneActionToSessionLayer(userId, payload = {}) {
  await getDBConnectionString();

  const sessionId = payload.id || payload.sessionId;
  const layerId = payload.layerId;
  const actionId = payload.actionId;
  const action = getSceneActionById(actionId);

  if (!sessionId) {
    throw new Error('Session ID is required');
  }
  if (!layerId) {
    throw new Error('Layer ID is required');
  }
  if (!action) {
    throw new Error('Unknown scene action');
  }

  const sessionData = await assertVideoSessionEditableAccess(userId, {
    ...payload,
    sessionId,
  });
  if (!sessionData) {
    throw new Error('Session not found');
  }

  const layerIndex = sessionData.layers.findIndex(
    (layer) => layer?._id?.toString?.() === layerId.toString()
  );

  if (layerIndex === -1) {
    throw new Error('Layer not found');
  }

  const layer = sessionData.layers[layerIndex];
  if (!layer.imageSession) {
    layer.imageSession = {};
  }

  const activeItemList = Array.isArray(layer.imageSession.activeItemList)
    ? layer.imageSession.activeItemList.map((item) => toPlainObject(item))
    : [];
  const canvasDimensions = getCanvasDimensionsForAspectRatio(sessionData.aspectRatio || '1:1');
  const nextActiveItemList = applySceneActionOperation({
    activeItemList,
    action,
    canvasDimensions,
  });

  layer.imageSession.activeItemList = nextActiveItemList;
  layer.imageSession.generationStatus = 'COMPLETED';
  layer.frameGenerationPending = true;
  sessionData.frameGenerationPending = true;
  sessionData.sessionMessageGenerationPending = false;
  sessionData.sessionMessageGenerationError = null;

  const sessionMessages = Array.isArray(sessionData.sessionMessages)
    ? sessionData.sessionMessages
    : [];
  sessionData.sessionMessages = [
    ...sessionMessages,
    {
      role: 'assistant',
      content: `Applied **${action.label}** to the current layer. You can undo or redo from the canvas history if you want to compare states.`,
      id: hat(),
      timestamp: new Date(),
      sceneActionApplied: {
        id: action.id,
        label: action.label,
      },
    },
  ];

  await FrameGeneration.deleteMany({ sessionId, layerId, rowLocked: false });
  await ensureUnlockedFrameGeneration(sessionId, layerId);
  const updatedSession = await sessionData.save();
  const sessionPayload = stripHeavySessionFields(updatedSession);
  const updatedLayer = sessionPayload.layers.find(
    (sessionLayer) => sessionLayer?._id?.toString?.() === layerId.toString()
  );

  return {
    sessionDetails: sessionPayload,
    layer: updatedLayer,
    action: {
      id: action.id,
      label: action.label,
    },
  };
}
