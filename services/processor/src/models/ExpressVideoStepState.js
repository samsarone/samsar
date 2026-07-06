import { getDBConnectionString } from './DBString.js';
import VideoSession from '../schema/VideoSession.js';

export const EXPRESS_STEP_VIDEO_STAGES = Object.freeze([
  'prompt_generation',
  'image_generation',
  'speech_generation',
  'music_generation',
  'ai_video_generation',
  'lip_sync_generation',
  'sound_effect_generation',
  'narrator_avatar_generation',
  'video_generation',
]);

export const EXPRESS_STEP_VIDEO_STAGE_LABELS = Object.freeze({
  prompt_generation: 'Narrative',
  image_generation: 'Images',
  speech_generation: 'Speech',
  music_generation: 'Music',
  ai_video_generation: 'AI video',
  lip_sync_generation: 'Lip sync',
  sound_effect_generation: 'Sound effects',
  narrator_avatar_generation: 'Narrator avatar',
  video_generation: 'Final video',
});

export const DEFAULT_EXPRESS_STEP_MANUAL_STAGES = Object.freeze([
  'ai_video_generation',
]);

export function normalizeExpressStepStage(stageKey) {
  return typeof stageKey === 'string' ? stageKey.trim().toLowerCase() : '';
}

export function normalizeExpressStepStageList(value, fallback = []) {
  let rawStages = [];
  if (Array.isArray(value)) {
    rawStages = value;
  } else if (typeof value === 'string') {
    rawStages = value.split(',');
  } else if (value && typeof value === 'object') {
    rawStages = Object.entries(value)
      .filter(([, enabled]) => enabled === true || enabled === 'true' || enabled === 1 || enabled === '1')
      .map(([stage]) => stage);
  } else if (value === false || value === null) {
    rawStages = [];
  } else {
    rawStages = fallback;
  }

  return [...new Set(rawStages
    .map(normalizeExpressStepStage)
    .filter((stage) => EXPRESS_STEP_VIDEO_STAGES.includes(stage)))];
}

function normalizeStepGenerationMode(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function resolveExpressStepManualStages(payload = {}) {
  const stepModeInput = [
    'generation_step_mode',
    'generationStepMode',
    'step_generation_mode',
    'stepGenerationMode',
    'step_mode',
    'stepMode',
  ].find((key) => Object.prototype.hasOwnProperty.call(payload || {}, key));

  if (stepModeInput) {
    const stepMode = normalizeStepGenerationMode(payload[stepModeInput]);
    if (stepMode === 'one_step' || stepMode === '1_step' || stepMode === 'single_step') {
      return [];
    }
    if (stepMode === 'two_step' || stepMode === '2_step') {
      return [...DEFAULT_EXPRESS_STEP_MANUAL_STAGES];
    }
  }

  const autoRenderFullVideoInput = [
    'auto_render_full_video',
    'autoRenderFullVideo',
    'render_full_video',
    'renderFullVideo',
    'render_full_video_automatically',
    'renderFullVideoAutomatically',
  ].find((key) => Object.prototype.hasOwnProperty.call(payload || {}, key));

  if (autoRenderFullVideoInput) {
    const value = payload[autoRenderFullVideoInput];
    const enabled = value === true || value === 'true' || value === 1 || value === '1' || value === 'yes' || value === 'on';
    if (enabled) {
      return [];
    }
  }

  const manualStageInput = [
    'manual_step_stages',
    'manualStepStages',
    'step_manual_stages',
    'stepManualStages',
    'pause_before_steps',
    'pauseBeforeSteps',
    'approval_steps',
    'approvalSteps',
    'require_approval_for_steps',
    'requireApprovalForSteps',
  ].find((key) => Object.prototype.hasOwnProperty.call(payload || {}, key));

  if (manualStageInput) {
    return normalizeExpressStepStageList(payload[manualStageInput], []);
  }

  if (autoRenderFullVideoInput) {
    return [...DEFAULT_EXPRESS_STEP_MANUAL_STAGES];
  }

  return [];
}

export function getNextExpressStepStage(stageKey) {
  const normalizedStage = normalizeExpressStepStage(stageKey);
  const currentIndex = EXPRESS_STEP_VIDEO_STAGES.indexOf(normalizedStage);
  if (currentIndex < 0 || currentIndex >= EXPRESS_STEP_VIDEO_STAGES.length - 1) {
    return null;
  }
  return EXPRESS_STEP_VIDEO_STAGES[currentIndex + 1];
}

export function getNextIncompleteExpressStepStage(stageKey, expressGenerationStatus = {}) {
  const normalizedStage = normalizeExpressStepStage(stageKey);
  const currentIndex = EXPRESS_STEP_VIDEO_STAGES.indexOf(normalizedStage);
  if (currentIndex < 0 || currentIndex >= EXPRESS_STEP_VIDEO_STAGES.length - 1) {
    return null;
  }

  for (let index = currentIndex + 1; index < EXPRESS_STEP_VIDEO_STAGES.length; index += 1) {
    const candidate = EXPRESS_STEP_VIDEO_STAGES[index];
    if (expressGenerationStatus?.[candidate] !== 'COMPLETED') {
      return candidate;
    }
  }

  return null;
}

export function buildInitialExpressStepGeneration({
  routeType = 'text_to_video',
  currentStep = 'prompt_generation',
  manualStepStages = [],
} = {}) {
  const normalizedStep = normalizeExpressStepStage(currentStep) || 'prompt_generation';
  const normalizedManualStepStages = normalizeExpressStepStageList(
    manualStepStages,
    [],
  );
  const now = new Date();
  return {
    enabled: true,
    routeType,
    route_type: routeType,
    status: 'PENDING',
    currentStep: normalizedStep,
    current_step: normalizedStep,
    currentStepLabel: EXPRESS_STEP_VIDEO_STAGE_LABELS[normalizedStep] || normalizedStep,
    current_step_label: EXPRESS_STEP_VIDEO_STAGE_LABELS[normalizedStep] || normalizedStep,
    nextStep: null,
    next_step: null,
    manualStepStages: normalizedManualStepStages,
    manual_step_stages: normalizedManualStepStages,
    waitingForProcessNext: false,
    waiting_for_process_next: false,
    requiresUserAction: false,
    requires_user_action: false,
    canProcessNext: false,
    can_process_next: false,
    createdAt: now,
    created_at: now,
    updatedAt: now,
    updated_at: now,
    completedSteps: {},
    completed_steps: {},
  };
}

export async function initializeExpressStepGeneration(sessionId, {
  routeType = 'text_to_video',
  currentStep = 'prompt_generation',
  manualStepStages = [],
} = {}) {
  if (!sessionId) {
    return null;
  }

  await getDBConnectionString();
  const initialState = buildInitialExpressStepGeneration({ routeType, currentStep, manualStepStages });
  return VideoSession.findByIdAndUpdate(
    sessionId,
    {
      $set: {
        isStepVideoGeneration: true,
        expressStepGeneration: initialState,
      },
    },
    { new: true },
  );
}

export async function markExpressStepStageCompleted(sessionId, stageKey, {
  routeType = null,
  resourceSummary = null,
  pause = undefined,
} = {}) {
  if (!sessionId) {
    return null;
  }

  const normalizedStage = normalizeExpressStepStage(stageKey);
  if (!normalizedStage) {
    return null;
  }

  await getDBConnectionString();
  const sessionData = await VideoSession.findById(sessionId)
    .select('expressGenerationStatus expressStepGeneration')
    .lean();
  const expressGenerationStatus = sessionData?.expressGenerationStatus || {};
  const manualStepStages = normalizeExpressStepStageList(
    sessionData?.expressStepGeneration?.manual_step_stages ||
      sessionData?.expressStepGeneration?.manualStepStages,
    [],
  );
  const now = new Date();
  const sequentialNextStep = getNextExpressStepStage(normalizedStage);
  const nextStep = getNextIncompleteExpressStepStage(normalizedStage, expressGenerationStatus);
  const label = EXPRESS_STEP_VIDEO_STAGE_LABELS[normalizedStage] || normalizedStage;
  const nextLabel = nextStep ? EXPRESS_STEP_VIDEO_STAGE_LABELS[nextStep] || nextStep : null;
  const shouldPauseForNextStep = Boolean(pause !== false && nextStep && manualStepStages.includes(nextStep));
  const completedStep = {
    step: normalizedStage,
    stepLabel: label,
    step_label: label,
    status: 'COMPLETED',
    completedAt: now,
    completed_at: now,
    nextStep: sequentialNextStep,
    next_step: sequentialNextStep,
    ...(resourceSummary ? { resourceSummary, resource_summary: resourceSummary } : {}),
  };

  const setPayload = {
    isStepVideoGeneration: true,
    'expressStepGeneration.enabled': true,
    'expressStepGeneration.status': shouldPauseForNextStep || !nextStep ? 'COMPLETED' : 'PENDING',
    'expressStepGeneration.currentStep': shouldPauseForNextStep || !nextStep ? normalizedStage : nextStep,
    'expressStepGeneration.current_step': shouldPauseForNextStep || !nextStep ? normalizedStage : nextStep,
    'expressStepGeneration.currentStepLabel': shouldPauseForNextStep || !nextStep ? label : nextLabel,
    'expressStepGeneration.current_step_label': shouldPauseForNextStep || !nextStep ? label : nextLabel,
    'expressStepGeneration.nextStep': shouldPauseForNextStep ? nextStep : null,
    'expressStepGeneration.next_step': shouldPauseForNextStep ? nextStep : null,
    'expressStepGeneration.manualStepStages': manualStepStages,
    'expressStepGeneration.manual_step_stages': manualStepStages,
    'expressStepGeneration.waitingForProcessNext': shouldPauseForNextStep,
    'expressStepGeneration.waiting_for_process_next': shouldPauseForNextStep,
    'expressStepGeneration.requiresUserAction': shouldPauseForNextStep,
    'expressStepGeneration.requires_user_action': shouldPauseForNextStep,
    'expressStepGeneration.canProcessNext': shouldPauseForNextStep,
    'expressStepGeneration.can_process_next': shouldPauseForNextStep,
    'expressStepGeneration.updatedAt': now,
    'expressStepGeneration.updated_at': now,
    [`expressStepGeneration.completedSteps.${normalizedStage}`]: completedStep,
    [`expressStepGeneration.completed_steps.${normalizedStage}`]: completedStep,
  };

  if (routeType) {
    setPayload['expressStepGeneration.routeType'] = routeType;
    setPayload['expressStepGeneration.route_type'] = routeType;
  }

  if (shouldPauseForNextStep) {
    setPayload.expressGenerationPending = false;
  } else if (nextStep) {
    setPayload.expressGenerationPending = true;
  }

  return VideoSession.findByIdAndUpdate(sessionId, { $set: setPayload }, { new: true });
}

export async function markExpressStepStagePending(sessionId, stageKey) {
  if (!sessionId) {
    return null;
  }

  const normalizedStage = normalizeExpressStepStage(stageKey);
  if (!normalizedStage) {
    return null;
  }

  await getDBConnectionString();
  const now = new Date();
  const label = EXPRESS_STEP_VIDEO_STAGE_LABELS[normalizedStage] || normalizedStage;
  return VideoSession.findByIdAndUpdate(
    sessionId,
    {
      $set: {
        isStepVideoGeneration: true,
        expressGenerationPending: true,
        'expressStepGeneration.enabled': true,
        'expressStepGeneration.status': 'PENDING',
        'expressStepGeneration.currentStep': normalizedStage,
        'expressStepGeneration.current_step': normalizedStage,
        'expressStepGeneration.currentStepLabel': label,
        'expressStepGeneration.current_step_label': label,
        'expressStepGeneration.nextStep': null,
        'expressStepGeneration.next_step': null,
        'expressStepGeneration.waitingForProcessNext': false,
        'expressStepGeneration.waiting_for_process_next': false,
        'expressStepGeneration.requiresUserAction': false,
        'expressStepGeneration.requires_user_action': false,
        'expressStepGeneration.canProcessNext': false,
        'expressStepGeneration.can_process_next': false,
        'expressStepGeneration.updatedAt': now,
        'expressStepGeneration.updated_at': now,
      },
    },
    { new: true },
  );
}
