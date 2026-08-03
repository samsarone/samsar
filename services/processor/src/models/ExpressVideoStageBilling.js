import VideoSession from '../schema/VideoSession.js';
import ExternalUserRequest from '../schema/ExternalUserRequest.js';
import User from '../schema/User.js';
import ExternalUser from '../schema/ExternalUser.js';
import { getDBConnectionString } from './DBString.js';
import {
  assertAPIKeyUsageLimitForDebit,
  deductGenerationCredits,
} from './GenerationCredits.js';
import { reserveExternalRequestCredits } from './external/User.js';
import { shouldBypassGenerationCredits } from '../utils/EnvironmentUtils.js';
import { normalizeAPIKeyUsageContext } from './api/RequestAuthContext.js';
import {
  EXPRESS_VIDEO_FIXED_PRICING_COMPONENTS_PER_SECOND,
  EXPRESS_VIDEO_OPTIONAL_ADDON_CREDITS_PER_SECOND,
  getExpressVideoStageCreditsPerSecond,
} from '../consts/pricing/ExpressVideoPricingDistribution.js';

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
const EXPRESS_VIDEO_ESTIMATE_STAGE_KEYS = Object.freeze([
  EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE,
  EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION,
  EXPRESS_VIDEO_BILLING_STAGES.SPEECH_GENERATION,
  EXPRESS_VIDEO_BILLING_STAGES.MUSIC_GENERATION,
  EXPRESS_VIDEO_BILLING_STAGES.AI_VIDEO_GENERATION,
  EXPRESS_VIDEO_BILLING_STAGES.LIP_SYNC_GENERATION,
  EXPRESS_VIDEO_BILLING_STAGES.SOUND_EFFECT_GENERATION,
  EXPRESS_VIDEO_BILLING_STAGES.NARRATOR_AVATAR_GENERATION,
  EXPRESS_VIDEO_BILLING_STAGES.PIPELINE,
]);

export function buildStandaloneProviderBilledEstimate(durationSeconds) {
  const normalizedDuration = Number(durationSeconds);
  return {
    durationSeconds: Number.isFinite(normalizedDuration) && normalizedDuration > 0
      ? normalizedDuration
      : 0,
    totalCredits: 0,
    stages: {},
    requiredCredits: 0,
    availableCredits: null,
    creditsBypassed: true,
  };
}

export function buildStandaloneProviderBilledStageReceipt(stageMetadata, waivedAt = new Date()) {
  const {
    pricingAddons: _pricingAddons,
    creditDistribution: stageCreditDistribution = {},
    ...providerBilledMetadata
  } = stageMetadata || {};
  const {
    pricingAddons: _creditDistributionPricingAddons,
    ...creditDistribution
  } = stageCreditDistribution || {};
  return {
    ...providerBilledMetadata,
    status: 'WAIVED',
    reason: 'standalone_provider_billed',
    creditsPerSecond: 0,
    baseCreditsPerSecond: 0,
    surchargeCreditsPerSecond: 0,
    creditsCharged: 0,
    creditDistribution: {
      ...creditDistribution,
      credits: 0,
      creditsPerSecond: 0,
    },
    chargedAt: waivedAt,
    remainingCredits: null,
  };
}

function normalizeStageKey(stageKey) {
  return typeof stageKey === 'string' ? stageKey.trim().toLowerCase() : '';
}

function normalizeModelKey(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function resolveExpressRouteType(sessionData = {}) {
  const routeType = typeof sessionData.builderRouteType === 'string'
    ? sessionData.builderRouteType.trim().toLowerCase()
    : '';
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
  const imageModel = normalizeModelKey(sessionData?.expressGenerationImageModel);
  if (
    stageKey === EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION &&
    imageModel.startsWith('CUSTOM_TEXT_TO_IMAGE:')
  ) {
    return true;
  }
  if (!adapter?.base_url) {
    return false;
  }
  if (stageKey === EXPRESS_VIDEO_BILLING_STAGES.IMAGE_GENERATION) {
    return imageModel === 'CUSTOM_TEXT_TO_IMAGE' && Boolean(adapter.text_to_image);
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

function getStageSurchargeCreditsPerSecond(sessionData, stageKey) {
  let surchargeCreditsPerSecond = 0;

  if (
    stageKey === EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE &&
    sessionData?.expressCtaGeneration === true
  ) {
    surchargeCreditsPerSecond +=
      EXPRESS_VIDEO_OPTIONAL_ADDON_CREDITS_PER_SECOND.express_cta_generation;
  }

  // NarrativeRequest-backed sessions do not run prompt generation again, but
  // the express render still uses the selected model's full unit price. Move
  // that fixed allocation onto pipeline finalization instead of mislabeling it
  // as a second narrative-inference charge.
  if (
    stageKey === EXPRESS_VIDEO_BILLING_STAGES.PIPELINE &&
    sessionData?.expressGenerationNarrativeReused === true
  ) {
    surchargeCreditsPerSecond +=
      EXPRESS_VIDEO_FIXED_PRICING_COMPONENTS_PER_SECOND.inference;
  }

  return surchargeCreditsPerSecond;
}

function getLayerEndTime(layer) {
  const durationOffset = Number(layer?.durationOffset);
  const duration = Number(layer?.duration);
  if (!Number.isFinite(durationOffset) || !Number.isFinite(duration)) {
    return 0;
  }
  return Math.max(0, durationOffset + duration);
}

function isBranchedVideoSession(sessionData = {}) {
  return typeof sessionData?.narrativeType === 'string' &&
    sessionData.narrativeType.trim().toLowerCase() === 'branched';
}

export function resolveCumulativeLayerDurationSeconds(sessionData = {}) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  const seenLayerIds = new Set();

  return layers.reduce((total, layer, index) => {
    const duration = Number(layer?.duration);
    if (!Number.isFinite(duration) || duration <= 0) {
      return total;
    }

    const rawIdentity = layer?._id ?? layer?.id ?? layer?.branchAssetKey;
    const normalizedIdentity = rawIdentity === null || rawIdentity === undefined
      ? `index:${index}`
      : rawIdentity?.toString?.() || String(rawIdentity);
    if (seenLayerIds.has(normalizedIdentity)) {
      return total;
    }
    seenLayerIds.add(normalizedIdentity);
    return total + duration;
  }, 0);
}

export function resolveExpressVideoBillingDurationSeconds(sessionData = {}, stageKey = null) {
  const normalizedStageKey = normalizeStageKey(stageKey);
  if (isBranchedVideoSession(sessionData)) {
    // This value is fixed when the canonical branch layer catalog is
    // materialized. Speech/AI timing may later retime playback layers, but all
    // stage receipts must use one contractual duration so preflight and final
    // settlement cannot mix two different cumulative totals.
    const configuredDuration = Number(sessionData.expressGenerationBillingDurationSeconds);
    if (Number.isFinite(configuredDuration) && configuredDuration > 0) {
      return configuredDuration;
    }

    const cumulativeLayerDuration = resolveCumulativeLayerDurationSeconds(sessionData);
    if (cumulativeLayerDuration > 0) {
      return cumulativeLayerDuration;
    }
  }

  const stageDuration = Number(
    sessionData?.expressGenerationBillingStageDurations?.[normalizedStageKey],
  );
  if (normalizedStageKey && Number.isFinite(stageDuration) && stageDuration > 0) {
    return stageDuration;
  }

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
  if (Number.isFinite(layerDuration) && layerDuration > 0) {
    return layerDuration;
  }

  const scenes = Array.isArray(sessionData.movieResourceList?.scenes)
    ? sessionData.movieResourceList.scenes
    : [];
  const finalSceneEndTime = Number(scenes[scenes.length - 1]?.endTime);
  return Number.isFinite(finalSceneEndTime) && finalSceneEndTime > 0 ? finalSceneEndTime : 0;
}

export function buildInitialExpressVideoCreditCharges(durationSeconds) {
  const normalizedDuration = Number(durationSeconds);
  return {
    version: 1,
    durationSeconds: Number.isFinite(normalizedDuration) && normalizedDuration > 0 ? normalizedDuration : 0,
    totalCharged: 0,
    stages: {},
  };
}

export function buildInitialReusedNarrativeExpressVideoCreditCharges(
  durationSeconds,
  sourceNarrativeRequestId,
) {
  const initialCharges = buildInitialExpressVideoCreditCharges(durationSeconds);
  const stageKey = EXPRESS_VIDEO_BILLING_STAGES.NARRATIVE_INFERENCE;
  const normalizedSourceNarrativeRequestId = sourceNarrativeRequestId === null ||
    sourceNarrativeRequestId === undefined
    ? null
    : String(sourceNarrativeRequestId).trim() || null;

  return {
    ...initialCharges,
    stages: {
      ...initialCharges.stages,
      [stageKey]: {
        stageKey,
        statusKey: STAGE_STATUS_KEYS[stageKey],
        stageLabel: STAGE_LABELS[stageKey],
        status: 'WAIVED',
        reason: 'reused_narrative_request',
        sourceNarrativeRequestId: normalizedSourceNarrativeRequestId,
        durationSeconds: initialCharges.durationSeconds,
        creditsPerSecond: 0,
        creditsCharged: 0,
        creditDistribution: {
          stageKey,
          stageLabel: STAGE_LABELS[stageKey],
          credits: 0,
          creditsPerSecond: 0,
          durationSeconds: initialCharges.durationSeconds,
        },
      },
    },
  };
}

export function estimateExpressVideoCreditsForPreflight({
  durationSeconds,
  videoModel,
  imageModel = null,
  backingTrackModel = null,
  expressGenerationType = null,
  expressCtaGeneration = false,
  addNarratorAvatar = false,
  customAdapters = null,
  customAdapterOperationUsage = null,
  samsarExternalProviderStages = null,
  expressGenerationNarrativeReused = false,
  excludedStageKeys = [],
} = {}) {
  const normalizedDuration = Number(durationSeconds);
  const billableDuration = Number.isFinite(normalizedDuration) && normalizedDuration > 0
    ? normalizedDuration
    : 0;
  const sessionData = {
    expressGenerativeVideoModel: videoModel,
    expressGenerationImageModel: imageModel,
    backingTrackModel,
    expressGenerationType,
    expressCtaGeneration: expressCtaGeneration === true,
    expressGenerationNarrativeReused: expressGenerationNarrativeReused === true,
    custom_adapters: customAdapters,
    customAdapterOperationUsage,
    samsarExternalProviderStages,
  };

  let totalCredits = 0;
  const stages = {};
  const rawExcludedStageKeys = excludedStageKeys instanceof Set
    ? [...excludedStageKeys]
    : Array.isArray(excludedStageKeys)
      ? excludedStageKeys
      : typeof excludedStageKeys === 'string'
        ? [excludedStageKeys]
        : [];
  const normalizedExcludedStageKeys = new Set(
    rawExcludedStageKeys.map(normalizeStageKey).filter(Boolean),
  );

  for (const stageKey of EXPRESS_VIDEO_ESTIMATE_STAGE_KEYS) {
    if (normalizedExcludedStageKeys.has(stageKey)) {
      continue;
    }
    if (stageKey === EXPRESS_VIDEO_BILLING_STAGES.NARRATOR_AVATAR_GENERATION && addNarratorAvatar !== true) {
      continue;
    }

    const customStage = isCustomStageConfigured(sessionData, stageKey);
    const baseCreditsPerSecond = customStage
      ? 0
      : getExpressVideoStageCreditsPerSecond(stageKey, videoModel);
    const surchargeCreditsPerSecond = customStage
      ? 0
      : getStageSurchargeCreditsPerSecond(sessionData, stageKey);
    const creditsPerSecond = baseCreditsPerSecond + surchargeCreditsPerSecond;
    const creditsCharged = billableDuration > 0 && creditsPerSecond > 0
      ? Math.ceil(billableDuration * creditsPerSecond)
      : 0;

    totalCredits += creditsCharged;
    stages[stageKey] = {
      stageKey,
      creditsPerSecond,
      baseCreditsPerSecond,
      surchargeCreditsPerSecond,
      creditsCharged,
      customStage,
    };
  }

  return {
    durationSeconds: billableDuration,
    totalCredits,
    stages,
  };
}

function buildInsufficientExpressVideoCreditsError({
  routeType,
  requiredCredits,
  availableCredits,
  estimate,
}) {
  const label = routeType === 'image_list_to_video' ? 'image_list_to_video' : 'text_to_video';
  const error = new Error(
    `Insufficient credits for ${label}. Estimated required credits: ${requiredCredits}; available credits: ${availableCredits}.`
  );
  error.status = 402;
  error.code = 'INSUFFICIENT_CREDITS';
  error.requiredCredits = requiredCredits;
  error.availableCredits = availableCredits;
  error.estimate = estimate;
  return error;
}

async function resolveExpressPreflightCreditBalance(userId, payload = {}) {
  if (payload.isExternalUserRequest === true && payload.externalRequestUserId) {
    const externalUser = await ExternalUser.findById(payload.externalRequestUserId)
      .select('generationCredits')
      .lean();
    if (!externalUser) {
      const error = new Error('External user not found for credit validation.');
      error.status = 404;
      throw error;
    }
    return Number(externalUser.generationCredits) || 0;
  }

  const user = await User.findById(userId)
    .select('generationCredits')
    .lean();
  if (!user) {
    const error = new Error('User not found for credit validation.');
    error.status = 404;
    throw error;
  }
  return Number(user.generationCredits) || 0;
}

export async function assertSufficientExpressVideoCreditsForPreflight({
  userId,
  payload,
  routeType,
  durationSeconds,
  videoModel,
  imageModel,
  backingTrackModel = null,
  expressGenerationType,
  expressCtaGeneration = false,
  addNarratorAvatar = false,
  customAdapters = null,
  customAdapterOperationUsage = null,
  samsarExternalProviderStages = null,
  expressGenerationNarrativeReused = false,
  excludedStageKeys = [],
}, dependencies = {}) {
  const {
    assertAPIKeyLimit = assertAPIKeyUsageLimitForDebit,
    resolveCreditBalance = resolveExpressPreflightCreditBalance,
    shouldBypassCredits = shouldBypassGenerationCredits,
  } = dependencies;
  const estimate = estimateExpressVideoCreditsForPreflight({
    durationSeconds,
    videoModel,
    imageModel,
    backingTrackModel,
    expressGenerationType,
    expressCtaGeneration,
    addNarratorAvatar,
    customAdapters,
    customAdapterOperationUsage,
    samsarExternalProviderStages,
    expressGenerationNarrativeReused,
    excludedStageKeys,
  });
  if (shouldBypassCredits()) {
    return buildStandaloneProviderBilledEstimate(estimate.durationSeconds);
  }
  const requiredCredits = Math.ceil(Number(estimate.totalCredits) || 0);
  const availableCredits = await resolveCreditBalance(userId, payload);

  if (requiredCredits > availableCredits) {
    throw buildInsufficientExpressVideoCreditsError({
      routeType,
      requiredCredits,
      availableCredits,
      estimate,
    });
  }

  const apiKeyUsage = normalizeAPIKeyUsageContext(payload?.apiKeyUsage);
  await assertAPIKeyLimit(
    userId,
    requiredCredits,
    apiKeyUsage?.apiKeyId ? { apiKeyId: apiKeyUsage.apiKeyId } : {},
  );

  return {
    ...estimate,
    requiredCredits,
    availableCredits,
  };
}

function buildStageMetadata({
  sessionData,
  stageKey,
  statusKey,
  durationSeconds,
  creditsPerSecond,
  baseCreditsPerSecond,
  surchargeCreditsPerSecond,
  creditsCharged,
  requestType,
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
    ...(Number.isFinite(baseCreditsPerSecond) && baseCreditsPerSecond !== creditsPerSecond
      ? { baseCreditsPerSecond }
      : {}),
    ...(Number.isFinite(surchargeCreditsPerSecond) && surchargeCreditsPerSecond > 0
      ? {
        surchargeCreditsPerSecond,
        pricingAddons: {
          express_cta_generation: surchargeCreditsPerSecond,
        },
      }
      : {}),
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
    requestType: requestType || null,
    ...(apiKeyId ? { apiKeyId } : {}),
  };
}

async function findExternalRequestForSession(sessionData) {
  const externalRequestId = typeof sessionData?.externalRequestId === 'string'
    ? sessionData.externalRequestId.trim()
    : '';
  const sessionId = sessionData?._id?.toString?.() || sessionData?._id;

  if (!externalRequestId && !sessionId) {
    return null;
  }

  return ExternalUserRequest.findOne({
    ...(externalRequestId ? { externalRequestId } : { upstreamSessionId: sessionId }),
  });
}

async function chargeExternalStage(
  { sessionData, creditsCharged, stageMetadata },
  reserveCredits = reserveExternalRequestCredits,
) {
  const requestRecord = await findExternalRequestForSession(sessionData);
  if (!requestRecord) {
    const error = new Error('External request record not found for stage billing.');
    error.code = 'EXTERNAL_REQUEST_NOT_FOUND';
    throw error;
  }

  const currentCreditsCharged = Number(requestRecord.creditsCharged) || 0;
  return reserveCredits({
    externalRequestId: requestRecord.externalRequestId,
    creditsToReserve: currentCreditsCharged + creditsCharged,
    auditSource: `express_video_stage_${stageMetadata.stageKey}`,
    auditMetadata: stageMetadata,
  });
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
    error: errorMessage,
  };
}

export async function chargeExpressVideoStageCredits({
  sessionId,
  stageKey,
  requestType = null,
}, dependencies = {}) {
  const {
    connect = getDBConnectionString,
    deductCredits = deductGenerationCredits,
    reserveExternalCredits = reserveExternalRequestCredits,
    shouldBypassCredits = shouldBypassGenerationCredits,
  } = dependencies;
  await connect();

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

  const durationSeconds = resolveExpressVideoBillingDurationSeconds(
    sessionData,
    normalizedStageKey,
  );
  const videoModel = normalizeModelKey(sessionData.expressGenerativeVideoModel);
  const baseCreditsPerSecond = getExpressVideoStageCreditsPerSecond(normalizedStageKey, videoModel);
  const surchargeCreditsPerSecond = getStageSurchargeCreditsPerSecond(sessionData, normalizedStageKey);
  const creditsPerSecond = baseCreditsPerSecond + surchargeCreditsPerSecond;
  const creditsCharged = Number.isFinite(durationSeconds) && durationSeconds > 0
    ? Math.ceil(durationSeconds * creditsPerSecond)
    : 0;
  const stageMetadata = buildStageMetadata({
    sessionData,
    stageKey: normalizedStageKey,
    statusKey,
    durationSeconds,
    creditsPerSecond,
    baseCreditsPerSecond,
    surchargeCreditsPerSecond,
    creditsCharged,
    requestType,
  });
  const creditsBypassed = shouldBypassCredits();

  if (isCustomStageConfigured(sessionData, normalizedStageKey)) {
    const waivedAt = new Date();
    const receiptMetadata = creditsBypassed
      ? buildStandaloneProviderBilledStageReceipt(stageMetadata, waivedAt)
      : stageMetadata;
    const stageReceipt = {
      ...receiptMetadata,
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
      ...(creditsBypassed ? { creditsBypassed: true } : {}),
      stage: stageReceipt,
    };
  }

  if (creditsBypassed) {
    const waivedAt = new Date();
    const stageReceipt = buildStandaloneProviderBilledStageReceipt(stageMetadata, waivedAt);
    await VideoSession.findByIdAndUpdate(sessionId, {
      $set: {
        'expressGenerationCreditCharges.version': 1,
        'expressGenerationCreditCharges.durationSeconds': durationSeconds,
        'expressGenerationCreditCharges.updatedAt': waivedAt,
        [`expressGenerationCreditCharges.stages.${normalizedStageKey}`]: stageReceipt,
      },
    });
    return {
      ok: true,
      stageKey: normalizedStageKey,
      creditsCharged: 0,
      creditsBypassed: true,
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
        const externalRequest = await chargeExternalStage(
          { sessionData, creditsCharged, stageMetadata },
          reserveExternalCredits,
        );
        remainingCredits = externalRequest?.remainingCreditsSnapshot ?? null;
      } else {
        const deduction = await deductCredits(sessionData.userId, creditsCharged, {
          source: `express_video_stage_${normalizedStageKey}`,
          metadata: stageMetadata,
          apiKeyId: sessionData?.apiKeyUsage?.apiKeyId || sessionData?.apiKeyId || null,
        });
        remainingCredits = deduction?.remainingCredits ?? null;
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
