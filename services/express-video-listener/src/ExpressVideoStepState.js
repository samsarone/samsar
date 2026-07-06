import { getDBConnectionString } from './DBString.js';
import VideoSession from './schema/VideoSession.js';

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

function normalizeExpressStepStage(stageKey) {
  return typeof stageKey === 'string' ? stageKey.trim().toLowerCase() : '';
}

function normalizeExpressStepStageList(value, fallback = []) {
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

export async function pauseExpressStepAfterCompletedStage(sessionId, stageKey, {
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

  if (shouldPauseForNextStep) {
    setPayload.expressGenerationPending = false;
  } else if (nextStep) {
    setPayload.expressGenerationPending = true;
  }

  const session = await VideoSession.findByIdAndUpdate(sessionId, { $set: setPayload }, { new: true });
  return {
    session,
    paused: shouldPauseForNextStep,
    nextStep,
    completedStep: normalizedStage,
  };
}
