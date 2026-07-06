import { getDBConnectionString } from './DBString.js';
import VideoSession from './schema/VideoSession.js';
import User from './schema/User.js';
import ExternalUser from './schema/ExternalUser.js';
import ExternalUserRequest from './schema/ExternalUserRequest.js';
import GenerationCreditTransaction from './schema/GenerationCreditTransaction.js';
import { getExpressVideoStageCreditsPerSecond } from './consts/ExpressVideoPricingDistribution.js';

export const EXPRESS_VIDEO_BILLING_STAGES = Object.freeze({
  NARRATIVE_INFERENCE: 'narrative_inference',
  IMAGE_GENERATION: 'image_generation',
  SPEECH_GENERATION: 'speech_generation',
  MUSIC_GENERATION: 'music_generation',
  SOUND_EFFECT_GENERATION: 'sound_effect_generation',
  LIP_SYNC_GENERATION: 'lip_sync_generation',
  NARRATOR_AVATAR_GENERATION: 'narrator_avatar_generation',
  AI_VIDEO_GENERATION: 'ai_video_generation',
  PIPELINE: 'pipeline',
});

const STAGE_STATUS_KEYS = Object.freeze({
  [EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE]: 'prompt_generation',
  [EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION]: 'image_generation',
  [EXPRESS_VIDEO_BILLING_STAGES.SPEECH_GENERATION]: 'speech_generation',
  [EXPRESS_VIDEO_BILLING_STAGES.MUSIC_GENERATION]: 'music_generation',
  [EXPRESS_VIDEO_BILLING_STAGES.SOUND_EFFECT_GENERATION]: 'sound_effect_generation',
  [EXPRESS_VIDEO_BILLING_STAGES.LIP_SYNC_GENERATION]: 'lip_sync_generation',
  [EXPRESS_VIDEO_BILLING_STAGES.NARRATOR_AVATAR_GENERATION]: 'narrator_avatar_generation',
  [EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION]: 'ai_video_generation',
  [EXPRESS_VIDEO_BILLING_STAGES.PIPELINE]: 'video_generation',
});

const STAGE_LABELS = Object.freeze({
  [EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE]: 'Narrative inference',
  [EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION]: 'Image generation/edit',
  [EXPRESS_VIDEO_BILLING_STAGES.SPEECH_GENERATION]: 'Speech generation',
  [EXPRESS_VIDEO_BILLING_STAGES.MUSIC_GENERATION]: 'Music generation',
  [EXPRESS_VIDEO_BILLING_STAGES.SOUND_EFFECT_GENERATION]: 'Sound effects generation',
  [EXPRESS_VIDEO_BILLING_STAGES.LIP_SYNC_GENERATION]: 'Lip sync generation',
  [EXPRESS_VIDEO_BILLING_STAGES.NARRATOR_AVATAR_GENERATION]: 'Narrator avatar generation',
  [EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION]: 'AI video generation',
  [EXPRESS_VIDEO_BILLING_STAGES.PIPELINE]: 'Pipeline finalization',
});

const STAGE_BILLING_HANDLED_STATUSES = new Set(['CHARGED', 'CUSTOM_SUCCEEDED', 'WAIVED']);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStageKey(stageKey) {
  return normalizeString(stageKey).toLowerCase();
}

function normalizeModelKey(value) {
  return normalizeString(value).toUpperCase();
}

function resolveExpressRouteType(sessionData = {}) {
  const routeType = normalizeString(sessionData?.builderRouteType).toLowerCase();
  if (routeType === 'image_list_to_video' || routeType === 'text_to_video') {
    return routeType;
  }

  const expressGenerationType = normalizeModelKey(sessionData?.expressGenerationType);
  return expressGenerationType === 'IMAGE_LIST_TO_VIDEO'
    ? 'image_list_to_video'
    : 'text_to_video';
}

function hasCustomStageFallback(sessionData, stageKey) {
  return sessionData?.expressGenerationCustomStageResults?.[stageKey]?.fallbackUsed === true;
}

function isSamsarExternalStageConfigured(sessionData, stageKey) {
  const stageConfig = sessionData?.samsarExternalProviderStages?.[stageKey];
  return Boolean(stageConfig && typeof stageConfig === 'object');
}

function isCustomStageConfigured(sessionData, stageKey) {
  if (hasCustomStageFallback(sessionData, stageKey)) {
    return false;
  }
  if (isSamsarExternalStageConfigured(sessionData, stageKey)) {
    return true;
  }
  const usage = sessionData?.customAdapterOperationUsage?.[stageKey];
  if (usage) {
    return true;
  }
  const adapter = sessionData?.custom_adapters;
  if (!adapter?.base_url) {
    return false;
  }
  if (stageKey === EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION) {
    return normalizeModelKey(sessionData?.expressGenerationImageModel) === 'CUSTOM_TEXT_TO_IMAGE' && Boolean(adapter.text_to_image);
  }
  if (stageKey === EXPRESS_VIDEO_BILLING_STAGES.SPEECH_GENERATION) {
    return Boolean(adapter.text_to_speech);
  }
  if (stageKey === EXPRESS_VIDEO_BILLING_STAGES.MUSIC_GENERATION) {
    return normalizeModelKey(sessionData?.backingTrackModel) === 'CUSTOM_TEXT_TO_MUSIC' && Boolean(adapter.text_to_music);
  }
  if (stageKey === EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION) {
    return normalizeModelKey(sessionData?.expressGenerativeVideoModel) === 'CUSTOM_IMAGE_TO_VIDEO' && Boolean(adapter.image_to_video);
  }
  if (stageKey === EXPRESS_VIDEO_BILLING_STAGES.SOUND_EFFECT_GENERATION) {
    return Boolean(adapter.text_to_sound_effect);
  }
  return false;
}

function isInternalBillingExternalUser(externalUser) {
  if (!externalUser) {
    return false;
  }
  const provider = normalizeString(externalUser.provider).toLowerCase();
  const userType = normalizeString(externalUser.userType).toLowerCase();
  const billingMode = normalizeString(externalUser.metadata?.billingMode).toLowerCase();

  return (
    provider === 'internal' ||
    provider === 'samsar_internal' ||
    userType === 'internal' ||
    userType === 'internal_user' ||
    Boolean(externalUser.customerSubAccountId || externalUser.customerSubAccountPublicId) ||
    billingMode === 'customer_sub_account' ||
    billingMode === 'internal'
  );
}

function getLayerEndTime(layer) {
  const durationOffset = Number(layer?.durationOffset);
  const duration = Number(layer?.duration);
  if (!Number.isFinite(durationOffset) || !Number.isFinite(duration)) {
    return 0;
  }
  return Math.max(0, durationOffset + duration);
}

function resolveExpressVideoBillingDurationSeconds(sessionData = {}) {
  const configuredDuration = Number(sessionData.expressGenerationBillingDurationSeconds);
  if (Number.isFinite(configuredDuration) && configuredDuration > 0) {
    return configuredDuration;
  }

  const totalDuration = Number(sessionData.totalDuration);
  if (Number.isFinite(totalDuration) && totalDuration > 0) {
    return totalDuration;
  }

  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const layerDuration = layers.reduce((maxDuration, layer) => Math.max(maxDuration, getLayerEndTime(layer)), 0);
  return Number.isFinite(layerDuration) && layerDuration > 0 ? layerDuration : 0;
}

function buildStageMetadata({
  sessionData,
  stageKey,
  statusKey,
  durationSeconds,
  creditsPerSecond,
  creditsCharged,
}) {
  const apiKeyId =
    sessionData?.apiKeyUsage?.apiKeyId ||
    sessionData?.apiKeyId ||
    null;

  return {
    sessionId: sessionData?._id?.toString?.() || sessionData?._id || null,
    stageKey,
    statusKey,
    stageLabel: STAGE_LABELS[stageKey] || stageKey,
    routeType: resolveExpressRouteType(sessionData),
    durationSeconds,
    creditsPerSecond,
    creditsCharged,
    creditDistribution: {
      stageKey,
      stageLabel: STAGE_LABELS[stageKey] || stageKey,
      credits: creditsCharged,
      creditsPerSecond,
      durationSeconds,
    },
    videoGenerationModel: sessionData?.expressGenerativeVideoModel || null,
    expressGenerationType: sessionData?.expressGenerationType || null,
    requestType: sessionData?.requestType || null,
    ...(apiKeyId ? { apiKeyId } : {}),
  };
}

async function recordGenerationCreditTransaction({ userId, amount, direction, source, metadata, balanceAfter }) {
  if (!userId || !Number.isFinite(Number(amount)) || Number(amount) <= 0 || !direction) {
    return null;
  }

  const transaction = new GenerationCreditTransaction({
    userId,
    amount,
    direction,
    source,
    metadata,
    balanceAfter,
  });
  await transaction.save();
  return transaction;
}

async function deductInternalUserCredits({ userId, creditsCharged, stageMetadata }) {
  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, generationCredits: { $gte: creditsCharged } },
    { $inc: { generationCredits: -creditsCharged } },
    { new: true, projection: { generationCredits: 1 } },
  );

  if (!updatedUser) {
    const error = new Error('Insufficient credits');
    error.code = 'INSUFFICIENT_CREDITS';
    throw error;
  }

  await recordGenerationCreditTransaction({
    userId,
    amount: creditsCharged,
    direction: 'debit',
    source: `express_video_stage_${stageMetadata.stageKey}`,
    metadata: stageMetadata,
    balanceAfter: updatedUser.generationCredits,
  });

  return updatedUser.generationCredits;
}

async function findExternalRequestForSession(sessionData) {
  const externalRequestId = normalizeString(sessionData?.externalRequestId);
  const sessionId = sessionData?._id?.toString?.() || sessionData?._id;

  if (!externalRequestId && !sessionId) {
    return null;
  }

  return ExternalUserRequest.findOne({
    ...(externalRequestId ? { externalRequestId } : { upstreamSessionId: sessionId }),
  });
}

async function chargeExternalStage({ sessionData, creditsCharged, stageMetadata }) {
  const requestRecord = await findExternalRequestForSession(sessionData);
  if (!requestRecord) {
    const error = new Error('External request record not found for stage billing.');
    error.code = 'EXTERNAL_REQUEST_NOT_FOUND';
    throw error;
  }

  const externalUser = await ExternalUser.findById(requestRecord.externalUserId);
  if (!externalUser) {
    const error = new Error('External user not found for stage billing.');
    error.code = 'EXTERNAL_USER_NOT_FOUND';
    throw error;
  }

  let remainingCredits = null;
  if (isInternalBillingExternalUser(externalUser) && externalUser.internalUserId) {
    remainingCredits = await deductInternalUserCredits({
      userId: externalUser.internalUserId,
      creditsCharged,
      stageMetadata: {
        ...stageMetadata,
        externalRequestId: requestRecord.externalRequestId,
        externalUserId: requestRecord.externalUserId?.toString?.() || requestRecord.externalUserId,
      },
    });
    await ExternalUser.findByIdAndUpdate(externalUser._id, {
      $inc: { totalCreditsUsed: creditsCharged },
      $set: { generationCredits: remainingCredits, lastActivityAt: new Date() },
    });
  } else {
    const updatedExternalUser = await ExternalUser.findOneAndUpdate(
      { _id: externalUser._id, generationCredits: { $gte: creditsCharged } },
      {
        $inc: {
          generationCredits: -creditsCharged,
          totalCreditsUsed: creditsCharged,
        },
        $set: {
          lastActivityAt: new Date(),
        },
      },
      { new: true },
    );
    if (!updatedExternalUser) {
      const error = new Error('Insufficient credits');
      error.code = 'INSUFFICIENT_CREDITS';
      throw error;
    }
    remainingCredits = updatedExternalUser.generationCredits;
  }

  await ExternalUserRequest.findByIdAndUpdate(requestRecord._id, {
    $inc: { creditsCharged },
    $set: { remainingCreditsSnapshot: remainingCredits },
  });

  return remainingCredits;
}

async function markStageBillingFailed({ sessionId, stageKey, statusKey, error }) {
  const errorMessage = error?.code === 'INSUFFICIENT_CREDITS'
    ? `Insufficient credits while charging ${STAGE_LABELS[stageKey] || stageKey}.`
    : error?.message || `Unable to charge ${STAGE_LABELS[stageKey] || stageKey}.`;

  await VideoSession.findByIdAndUpdate(sessionId, {
    $set: {
      [`expressGenerationCreditCharges.stages.${stageKey}.status`]: 'FAILED',
      [`expressGenerationCreditCharges.stages.${stageKey}.error`]: errorMessage,
      [`expressGenerationCreditCharges.stages.${stageKey}.failedAt`]: new Date(),
      [`expressGenerationStatus.${statusKey}`]: 'FAILED',
      'expressGenerationStatus.status': 'FAILED',
      expressGenerationPending: false,
      expressGenerationFailed: true,
      expressGenerationError: errorMessage,
    },
  });

  return {
    ok: false,
    stageKey,
    errorCode: error?.code || null,
    error: errorMessage,
  };
}

export async function chargeExpressVideoStageCredits({ sessionId, stageKey }) {
  await getDBConnectionString();

  const normalizedStageKey = normalizeStageKey(stageKey);
  const statusKey = STAGE_STATUS_KEYS[normalizedStageKey] || normalizedStageKey;
  if (!sessionId || !normalizedStageKey) {
    return { ok: false, stageKey: normalizedStageKey, error: 'Missing sessionId or stageKey.' };
  }

  const sessionData = await VideoSession.findById(sessionId).lean();
  if (!sessionData) {
    return { ok: false, stageKey: normalizedStageKey, error: 'Session not found.' };
  }

  const existingStage = sessionData.expressGenerationCreditCharges?.stages?.[normalizedStageKey];
  if (STAGE_BILLING_HANDLED_STATUSES.has(existingStage?.status)) {
    return { ok: true, stageKey: normalizedStageKey, alreadyCharged: true, stage: existingStage };
  }

  const durationSeconds = resolveExpressVideoBillingDurationSeconds(sessionData);
  const videoModel = normalizeModelKey(sessionData.expressGenerativeVideoModel);
  const creditsPerSecond = getExpressVideoStageCreditsPerSecond(normalizedStageKey, videoModel);
  const creditsCharged = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.ceil(durationSeconds * creditsPerSecond)
    : 0;
  const stageMetadata = buildStageMetadata({
    sessionData,
    stageKey: normalizedStageKey,
    statusKey,
    durationSeconds,
    creditsPerSecond,
    creditsCharged,
  });

  if (isCustomStageConfigured(sessionData, normalizedStageKey)) {
    const waivedAt = new Date();
    const stageReceipt = {
      ...stageMetadata,
      status: 'CUSTOM_SUCCEEDED',
      creditsCharged: 0,
      customOperation: sessionData?.customAdapterOperationUsage?.[normalizedStageKey] || null,
      chargedAt: waivedAt,
      remainingCredits: null,
    };
    await VideoSession.findByIdAndUpdate(sessionId, {
      $set: {
        'expressGenerationCreditCharges.version': 1,
        'expressGenerationCreditCharges.durationSeconds': durationSeconds,
        'expressGenerationCreditCharges.updatedAt': waivedAt,
        [`expressGenerationCreditCharges.stages.${normalizedStageKey}`]: stageReceipt,
        [`expressGenerationCustomStageResults.${normalizedStageKey}.status`]: 'CUSTOM_SUCCEEDED',
        [`expressGenerationCustomStageResults.${normalizedStageKey}.completedAt`]: waivedAt,
      },
    });
    return {
      ok: true,
      stageKey: normalizedStageKey,
      creditsCharged: 0,
      customOperation: true,
      stage: stageReceipt,
    };
  }

  const claimedSession = await VideoSession.findOneAndUpdate(
    {
      _id: sessionId,
      [`expressGenerationCreditCharges.stages.${normalizedStageKey}.status`]: {
        $nin: ['CHARGED', 'CHARGING', 'CUSTOM_SUCCEEDED', 'WAIVED'],
      },
    },
    {
      $set: {
        'expressGenerationCreditCharges.version': 1,
        'expressGenerationCreditCharges.durationSeconds': durationSeconds,
        [`expressGenerationCreditCharges.stages.${normalizedStageKey}`]: {
          ...stageMetadata,
          status: 'CHARGING',
          chargedAt: null,
        },
      },
    },
    { new: true },
  ).lean();

  if (!claimedSession) {
    const currentSession = await VideoSession.findById(sessionId)
      .select(`expressGenerationCreditCharges.stages.${normalizedStageKey}`)
      .lean();
    return {
      ok: true,
      stageKey: normalizedStageKey,
      alreadyCharged: true,
      stage: currentSession?.expressGenerationCreditCharges?.stages?.[normalizedStageKey] || null,
    };
  }

  let remainingCredits = null;
  try {
    if (creditsCharged > 0) {
      if (sessionData.isExternalUserRequest) {
        remainingCredits = await chargeExternalStage({ sessionData, creditsCharged, stageMetadata });
      } else {
        remainingCredits = await deductInternalUserCredits({
          userId: sessionData.userId,
          creditsCharged,
          stageMetadata,
        });
      }
    }
  } catch (error) {
    return markStageBillingFailed({
      sessionId,
      stageKey: normalizedStageKey,
      statusKey,
      error,
    });
  }

  const chargedAt = new Date();
  const stageReceipt = {
    ...stageMetadata,
    status: 'CHARGED',
    chargedAt,
    remainingCredits,
  };

  await VideoSession.findByIdAndUpdate(sessionId, {
    $set: {
      'expressGenerationCreditCharges.version': 1,
      'expressGenerationCreditCharges.durationSeconds': durationSeconds,
      'expressGenerationCreditCharges.updatedAt': chargedAt,
      [`expressGenerationCreditCharges.stages.${normalizedStageKey}`]: stageReceipt,
    },
    $inc: {
      'expressGenerationCreditCharges.totalCharged': creditsCharged,
    },
  });

  return {
    ok: true,
    stageKey: normalizedStageKey,
    creditsCharged,
    remainingCredits,
    stage: stageReceipt,
  };
}
