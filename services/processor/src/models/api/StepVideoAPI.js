import mongoose from 'mongoose';
import dns from 'node:dns/promises';
import net from 'node:net';

import VideoSession from '../../schema/VideoSession.js';
import { getDBConnectionString } from '../DBString.js';
import {
  EXPRESS_STEP_VIDEO_STAGE_LABELS,
  EXPRESS_STEP_VIDEO_STAGES,
  DEFAULT_EXPRESS_STEP_MANUAL_STAGES,
  buildInitialExpressStepGeneration,
  initializeExpressStepGeneration,
  markExpressStepStagePending,
  normalizeExpressStepStageList,
  resolveExpressStepManualStages,
} from '../ExpressVideoStepState.js';
import { requestGenerateCustomAIVideo } from '../ai_video/index.js';
import {
  requestCreateVideo,
  requestCreateVideoFromImageListAndMetadata,
} from './MovieAPI.js';
import {
  buildVideoStatusDetailedResponse,
  buildVideoStatusResponse,
  normalizeResponseAssetUrl,
  normalizeResponseAssetUrlList,
} from './StatusAPI.js';
import { normalizeImageToVideoStartImagePayload } from './VideoInputPayloadAliases.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStatusString(value) {
  return normalizeString(value).toUpperCase();
}

function isCompletedStatus(value) {
  return ['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE'].includes(normalizeStatusString(value));
}

function hasFinalVideoResult(sessionData = {}, baseStatus = {}) {
  return [
    baseStatus.result_url,
    baseStatus.videoLink,
    baseStatus.remoteURL,
    sessionData.remoteURL,
    sessionData.videoLink,
    sessionData.videoVideoLink,
  ].some((value) => Boolean(normalizeString(value)));
}

function isFinalVideoGenerationCompleted(sessionData = {}, baseStatus = {}) {
  if (!hasFinalVideoResult(sessionData, baseStatus)) {
    return false;
  }

  return (
    isCompletedStatus(baseStatus.status) ||
    isCompletedStatus(sessionData?.expressGenerationStatus?.video_generation)
  );
}

function getStepSessionId(payload = {}) {
  return (
    normalizeString(payload.request_id) ||
    normalizeString(payload.requestId) ||
    normalizeString(payload.session_id) ||
    normalizeString(payload.sessionId) ||
    normalizeString(payload.video_session_id) ||
    normalizeString(payload.videoSessionId)
  );
}

function normalizeStepVideoPayload(payload = {}) {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : {};
}

export function normalizeStepImageToVideoPayload(payload = {}) {
  return normalizeImageToVideoStartImagePayload(normalizeStepVideoPayload(payload));
}

function getFirstStringValue(source = {}, keys = []) {
  for (const key of keys) {
    const value = normalizeString(source?.[key]);
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizeDurationSeconds(value, fallback = 5) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1, Math.round(parsed));
  }
  return fallback;
}

function getExternalStageModel(payload = {}, keys = [], fallbackModel) {
  return getFirstStringValue(payload, keys) || fallbackModel;
}

function buildStepVideoError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isPrivateOrLocalHostname(hostname) {
  const normalized = normalizeString(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized) {
    return true;
  }
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized.endsWith('.local') ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^fc[0-9a-f]{2}:/i.test(normalized) ||
    /^fd[0-9a-f]{2}:/i.test(normalized)
  );
}

function isPrivateOrLocalIpAddress(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/^\[|\]$/g, '');
  if (!net.isIP(normalized)) {
    return false;
  }
  return (
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized === '::1' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized) ||
    /^169\.254\./.test(normalized) ||
    /^fc[0-9a-f]{2}:/i.test(normalized) ||
    /^fd[0-9a-f]{2}:/i.test(normalized) ||
    /^fe80:/i.test(normalized)
  );
}

async function assertPublicHostnameResolution(url, mediaLabel) {
  const { hostname } = new URL(url);
  if (net.isIP(hostname)) {
    if (isPrivateOrLocalIpAddress(hostname)) {
      throw buildStepVideoError(`${mediaLabel} must resolve to a public network address.`);
    }
    return;
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: false });
    if (!addresses.length || addresses.some((address) => isPrivateOrLocalIpAddress(address.address))) {
      throw buildStepVideoError(`${mediaLabel} must resolve to a public network address.`);
    }
  } catch (error) {
    if (error?.status) {
      throw error;
    }
    throw buildStepVideoError(`${mediaLabel} hostname could not be resolved publicly: ${error?.message || String(error)}`);
  }
}

function normalizePublicMediaUrl(value, mediaLabel) {
  const urlValue = normalizeString(value);
  if (!urlValue) {
    return '';
  }
  if (/^data:/i.test(urlValue)) {
    throw buildStepVideoError(`${mediaLabel} must be a public http(s) URL. Raw media data is not accepted for external video endpoints.`);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(urlValue);
  } catch {
    throw buildStepVideoError(`${mediaLabel} must be a valid public http(s) URL.`);
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw buildStepVideoError(`${mediaLabel} must use http or https.`);
  }
  if (isPrivateOrLocalHostname(parsedUrl.hostname)) {
    throw buildStepVideoError(`${mediaLabel} must be publicly reachable; local or private network URLs are not accepted.`);
  }
  return parsedUrl.toString();
}

async function probePublicMediaUrl(url, mediaLabel, redirectsRemaining = 5) {
  const timeoutMs = Number(process.env.EXTERNAL_VIDEO_MEDIA_ACCESS_CHECK_TIMEOUT_MS) || 10000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Range: 'bytes=0-0' };

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.body) {
      try {
        await response.body.cancel();
      } catch {}
    }

    if (response.status >= 300 && response.status < 400) {
      if (redirectsRemaining <= 0) {
        throw buildStepVideoError(`${mediaLabel} access check exceeded the maximum redirect count.`);
      }
      const location = response.headers.get('location');
      if (!location) {
        throw buildStepVideoError(`${mediaLabel} access check returned a redirect without a location header.`);
      }
      const redirectUrl = normalizePublicMediaUrl(new URL(location, url).toString(), mediaLabel);
      await assertPublicHostnameResolution(redirectUrl, mediaLabel);
      return probePublicMediaUrl(redirectUrl, mediaLabel, redirectsRemaining - 1);
    }

    if (response.ok || response.status === 206) {
      return true;
    }
    throw buildStepVideoError(`${mediaLabel} is not publicly accessible. Access check returned HTTP ${response.status}.`, 400);
  } catch (error) {
    if (error?.status) {
      throw error;
    }
    throw buildStepVideoError(`${mediaLabel} is not publicly accessible. Access check failed: ${error?.message || String(error)}`, 400);
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveExternalStagePublicMediaUrl(payload = {}, {
  disallowedDataKeys = [],
  urlKeys = [],
  mediaLabel,
} = {}) {
  const dataValue = getFirstStringValue(payload, disallowedDataKeys);
  if (dataValue) {
    throw buildStepVideoError(`${mediaLabel} must be provided as a public URL. Raw media fields are not accepted for external video endpoints.`);
  }

  const urlValue = normalizePublicMediaUrl(getFirstStringValue(payload, urlKeys), mediaLabel);
  if (urlValue) {
    await assertPublicHostnameResolution(urlValue, mediaLabel);
    await probePublicMediaUrl(urlValue, mediaLabel);
  }
  return urlValue;
}

function buildStageOnlyExpressGenerationStatus(stageKey) {
  return EXPRESS_STEP_VIDEO_STAGES.reduce((status, candidateStage) => {
    status[candidateStage] = candidateStage === stageKey ? 'PENDING' : 'COMPLETED';
    return status;
  }, {});
}

function getStandaloneExternalStageKey(sessionData = {}) {
  const routeType = normalizeString(
    sessionData?.expressStepGeneration?.route_type ||
    sessionData?.expressStepGeneration?.routeType ||
    sessionData?.stepVideoRoute,
  );
  if (routeType === 'lip_sync' || routeType === 'lip_sync_generation') {
    return 'lip_sync_generation';
  }
  if (routeType === 'sound_effect' || routeType === 'sound_effect_generation') {
    return 'sound_effect_generation';
  }
  return null;
}

function hasCompletedStandaloneStageLayer(sessionData = {}, stageKey) {
  const layer = Array.isArray(sessionData.layers) ? sessionData.layers[0] : null;
  if (!layer) {
    return false;
  }
  if (stageKey === 'lip_sync_generation') {
    return Boolean(layer.lipSyncRemoteLink || layer.lipSyncVideoLayer);
  }
  if (stageKey === 'sound_effect_generation') {
    return Boolean(layer.soundEffectRemoteLink || layer.soundEffectVideoLayer);
  }
  return false;
}

async function maybeFinalizeStandaloneExternalStageSession(sessionData = {}) {
  const stageKey = getStandaloneExternalStageKey(sessionData);
  if (!stageKey || !hasCompletedStandaloneStageLayer(sessionData, stageKey)) {
    return sessionData;
  }

  const stepState = getStepState(sessionData) || {};
  if (normalizeStatusString(stepState.status) === 'COMPLETED') {
    return sessionData;
  }

  const now = new Date();
  const label = EXPRESS_STEP_VIDEO_STAGE_LABELS[stageKey] || stageKey;
  const completedStep = {
    step: stageKey,
    stepLabel: label,
    step_label: label,
    status: 'COMPLETED',
    completedAt: now,
    completed_at: now,
    nextStep: null,
    next_step: null,
  };

  await VideoSession.findByIdAndUpdate(sessionData._id, {
    $set: {
      expressGenerationPending: false,
      [`expressGenerationStatus.${stageKey}`]: 'COMPLETED',
      'expressStepGeneration.status': 'COMPLETED',
      'expressStepGeneration.currentStep': stageKey,
      'expressStepGeneration.current_step': stageKey,
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
      [`expressStepGeneration.completedSteps.${stageKey}`]: completedStep,
      [`expressStepGeneration.completed_steps.${stageKey}`]: completedStep,
    },
  });

  return (await VideoSession.findById(sessionData._id).lean()) || sessionData;
}

async function loadOwnedStepSession(userId, sessionId) {
  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    return null;
  }

  await getDBConnectionString();
  return VideoSession.findOne({
    _id: sessionId,
    userId: userId?.toString?.() || userId,
  }).lean();
}

function getStepState(sessionData = {}) {
  const rawStepState = sessionData.expressStepGeneration || {};
  if (rawStepState && Object.keys(rawStepState).length > 0) {
    return rawStepState;
  }
  if (sessionData.isStepVideoGeneration) {
    return buildInitialExpressStepGeneration();
  }
  return null;
}

function resolveCompletedStepState(stepState = {}, stepKey) {
  return (
    stepState.completedSteps?.[stepKey] ||
    stepState.completed_steps?.[stepKey] ||
    null
  );
}

function getItemImageUrl(item = {}, req = null) {
  return normalizeResponseAssetUrl((
    normalizeString(item.src) ||
    normalizeString(item.image) ||
    normalizeString(item.url) ||
    normalizeString(item.remoteURL) ||
    normalizeString(item.remoteUrl)
  ) || null, req);
}

function serializeStepImageItem(item = {}, index = 0, req = null, fallbackPrompt = null) {
  const url = getItemImageUrl(item, req);
  return {
    id: normalizeString(item.id) || item?._id?.toString?.() || `item_${index}`,
    item_id: normalizeString(item.id) || item?._id?.toString?.() || `item_${index}`,
    index,
    type: item?.type || 'image',
    url,
    raw_url:
      normalizeString(item.src) ||
      normalizeString(item.image) ||
      normalizeString(item.url) ||
      normalizeString(item.remoteURL) ||
      normalizeString(item.remoteUrl) ||
      null,
    src: normalizeString(item.src) || null,
    image: normalizeString(item.image) || null,
    is_base_image: item?.is_base_image === true,
    role: item?.is_base_image === true ? 'primary' : 'secondary',
    prompt:
      normalizeString(item.prompt) ||
      normalizeString(item.generationPrompt) ||
      normalizeString(item.sourcePrompt) ||
      fallbackPrompt ||
      null,
    description: item?.description || null,
    x: item?.x ?? null,
    y: item?.y ?? null,
    width: item?.width ?? null,
    height: item?.height ?? null,
    config: item?.config || null,
    animations: Array.isArray(item?.animations) ? item.animations : null,
  };
}

function serializeLayer(layer = {}, index = 0, req = null) {
  const activeItems = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const baseItem = activeItems.find((item) => item?.is_base_image) || activeItems[0] || null;
  const fallbackPrompt = layer?.imageSession?.prompt || layer.prompt || null;
  const aiVideoUrl = normalizeResponseAssetUrl(layer.aiVideoRemoteLink || layer.aiVideoLayer, req);
  const lipSyncUrl = normalizeResponseAssetUrl(layer.lipSyncRemoteLink || layer.lipSyncVideoLayer, req);
  const soundEffectUrl = normalizeResponseAssetUrl(layer.soundEffectRemoteLink || layer.soundEffectVideoLayer, req);
  const preferredVideo = lipSyncUrl
    ? { type: 'lip_sync', url: lipSyncUrl }
    : soundEffectUrl
      ? { type: 'sound_effect', url: soundEffectUrl }
      : aiVideoUrl
        ? { type: 'ai_video', url: aiVideoUrl }
        : { type: null, url: null };
  return {
    index,
    layer_id: layer?._id?.toString?.() || layer?._id || null,
    prompt: layer.prompt || null,
    duration: layer.duration ?? null,
    duration_offset: layer.durationOffset ?? null,
    image_generation_status: layer?.imageSession?.generationStatus || null,
    image_edit_status: layer?.imageSession?.editStatus || null,
    selected_image_url:
      getItemImageUrl(baseItem || {}, req) ||
      normalizeResponseAssetUrl(layer?.imageSession?.activeGeneratedImage, req) ||
      normalizeResponseAssetUrl(layer?.imageSession?.activeEditedImage, req) ||
      normalizeResponseAssetUrl(layer?.imageSession?.activeImageRemoteLink, req) ||
      null,
    active_items: activeItems.map((item, itemIndex) => (
      serializeStepImageItem(item, itemIndex, req, fallbackPrompt)
    )),
    ai_video_status: layer.aiVideoGenerationStatus || null,
    ai_video_url: aiVideoUrl,
    lip_sync_status: layer.lipSyncVideoGenerationStatus || null,
    lip_sync_url: lipSyncUrl,
    sound_effect_status: layer.soundEffectVideoGenerationStatus || null,
    sound_effect_url: soundEffectUrl,
    preferred_video_type: preferredVideo.type,
    preferred_video_url: preferredVideo.url,
  };
}

function serializeAudioLayer(layer = {}, index = 0, req = null) {
  return {
    index,
    audio_layer_id: layer?._id?.toString?.() || layer?._id || null,
    generation_type: layer.generationType || null,
    generation_status: layer.generationStatus || null,
    prompt: layer.prompt || null,
    start_time: layer.startTime ?? null,
    end_time: layer.endTime ?? null,
    duration: layer.duration ?? null,
    selected_audio_url:
      normalizeResponseAssetUrl(layer.selectedRemoteAudioLink, req) ||
      normalizeResponseAssetUrl(layer.selectedLocalAudioLink, req) ||
      (Array.isArray(layer.remoteAudioLinks) ? normalizeResponseAssetUrl(layer.remoteAudioLinks[0], req) : '') ||
      (Array.isArray(layer.localAudioLinks) ? normalizeResponseAssetUrl(layer.localAudioLinks[0], req) : '') ||
      null,
    remote_audio_links: normalizeResponseAssetUrlList(layer.remoteAudioLinks, req),
    speaker: layer.speaker || null,
    speaker_character_name: layer.speakerCharacterName || null,
    lyrics: layer.lyrics || null,
  };
}

function buildStepResources(sessionData = {}, stepKey, req = null) {
  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const audioLayers = Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [];
  const serializedLayers = layers.map((layer, index) => serializeLayer(layer, index, req));

  if (stepKey === 'prompt_generation') {
    const movieResourceList = sessionData.movieResourceList || null;
    return {
      input_prompt: sessionData.inputPrompt || sessionData.expressInputPrompt || null,
      language: sessionData.language || null,
      language_string: sessionData.languageString || null,
      scenes: Array.isArray(movieResourceList?.scenes) ? movieResourceList.scenes : [],
      movie_resource_list: movieResourceList,
    };
  }

  if (stepKey === 'image_generation') {
    return {
      layers: serializedLayers.map((layer) => ({
        index: layer.index,
        layer_id: layer.layer_id,
        prompt: layer.prompt,
        duration: layer.duration,
        duration_offset: layer.duration_offset,
        generation_status: layer.image_generation_status,
        edit_status: layer.image_edit_status,
        selected_image_url: layer.selected_image_url,
        active_items: layer.active_items,
      })),
    };
  }

  if (stepKey === 'speech_generation') {
    return {
      speech_layers: audioLayers
        .filter((layer) => layer?.generationType === 'speech')
        .map((layer, index) => serializeAudioLayer(layer, index, req)),
    };
  }

  if (stepKey === 'music_generation') {
    return {
      music_layers: audioLayers
        .filter((layer) => layer?.generationType === 'music')
        .map((layer, index) => serializeAudioLayer(layer, index, req)),
    };
  }

  if (stepKey === 'ai_video_generation') {
    return {
      layers: serializedLayers.map((layer) => ({
        index: layer.index,
        layer_id: layer.layer_id,
        prompt: layer.prompt,
        status: layer.ai_video_status,
        ai_video_url: layer.ai_video_url,
        preferred_video_type: layer.preferred_video_type,
        preferred_video_url: layer.preferred_video_url,
      })),
    };
  }

  if (stepKey === 'lip_sync_generation') {
    return {
      layers: serializedLayers.map((layer) => ({
        index: layer.index,
        layer_id: layer.layer_id,
        status: layer.lip_sync_status,
        lip_sync_url: layer.lip_sync_url,
        preferred_video_type: layer.preferred_video_type,
        preferred_video_url: layer.preferred_video_url,
      })),
    };
  }

  if (stepKey === 'sound_effect_generation') {
    return {
      layers: serializedLayers.map((layer) => ({
        index: layer.index,
        layer_id: layer.layer_id,
        status: layer.sound_effect_status,
        sound_effect_url: layer.sound_effect_url,
        preferred_video_type: layer.preferred_video_type,
        preferred_video_url: layer.preferred_video_url,
      })),
    };
  }

  if (stepKey === 'video_generation') {
    const resultUrl = normalizeResponseAssetUrl(
      sessionData.remoteURL || sessionData.videoLink || sessionData.videoVideoLink,
      req,
    );
    const videoLink = normalizeResponseAssetUrl(sessionData.videoLink || sessionData.videoVideoLink, req);
    return {
      result_url: resultUrl,
      remote_url: normalizeResponseAssetUrl(sessionData.remoteURL, req),
      video_link: videoLink,
      has_subtitles: sessionData.hasSubtitles ?? sessionData.has_subtitles ?? sessionData.enableSubtitles ?? true,
    };
  }

  return {};
}

function buildCompletedStepResources(sessionData = {}, stepState = {}, req = null) {
  return EXPRESS_STEP_VIDEO_STAGES.reduce((result, stepKey) => {
    const completedStep = resolveCompletedStepState(stepState, stepKey);
    if (!completedStep) {
      return result;
    }
    result[stepKey] = {
      step: stepKey,
      label: EXPRESS_STEP_VIDEO_STAGE_LABELS[stepKey] || stepKey,
      status: completedStep.status || 'COMPLETED',
      completed_at: completedStep.completed_at || completedStep.completedAt || null,
      resources: buildStepResources(sessionData, stepKey, req),
    };
    return result;
  }, {});
}

function normalizeStepStatus(sessionData = {}, stepState = {}, baseStatus = {}) {
  if (sessionData.expressGenerationFailed) {
    return 'FAILED';
  }
  if (isFinalVideoGenerationCompleted(sessionData, baseStatus)) {
    return 'COMPLETED';
  }
  const nextStep = stepState.next_step || stepState.nextStep;
  const waitingForProcessNext = Boolean(stepState.waiting_for_process_next || stepState.waitingForProcessNext);
  const canProcessNext = Boolean(stepState.can_process_next || stepState.canProcessNext);
  const requiresUserAction = Boolean(stepState.requires_user_action || stepState.requiresUserAction);
  if (nextStep && (waitingForProcessNext || canProcessNext || requiresUserAction)) {
    return 'COMPLETED';
  }
  const rawStatus = normalizeStatusString(stepState.status);
  if (rawStatus === 'COMPLETED' || rawStatus === 'PENDING' || rawStatus === 'INIT') {
    return rawStatus;
  }
  return sessionData.isStepVideoGeneration ? 'INIT' : 'PENDING';
}

export async function buildStepVideoStatus({ userId, sessionId, req }) {
  let sessionData = await loadOwnedStepSession(userId, sessionId);
  if (!sessionData) {
    return null;
  }
  sessionData = await maybeFinalizeStandaloneExternalStageSession(sessionData);

  const stepState = getStepState(sessionData);
  if (!stepState) {
    return null;
  }

  const baseStatus = await buildVideoStatusResponse({
    sessionId,
    requestId: sessionId,
    provider: null,
    req,
  });
  const finalVideoCompleted = isFinalVideoGenerationCompleted(sessionData, baseStatus || {});
  const status = normalizeStepStatus(sessionData, stepState, baseStatus || {});
  const finalVideoResultUrl = finalVideoCompleted
    ? normalizeResponseAssetUrl(
      baseStatus?.result_url ||
      sessionData.remoteURL ||
      baseStatus?.remoteURL ||
      sessionData.videoLink ||
      baseStatus?.videoLink ||
      sessionData.videoVideoLink,
      req,
    )
    : null;
  const currentStep = finalVideoCompleted
    ? 'video_generation'
    : stepState.current_step || stepState.currentStep || null;
  const currentStepLabel = currentStep
    ? EXPRESS_STEP_VIDEO_STAGE_LABELS[currentStep] || currentStep
    : null;
  const nextStep = finalVideoCompleted ? null : stepState.next_step || stepState.nextStep || null;
  const waitingForProcessNext = finalVideoCompleted
    ? false
    : Boolean(stepState.waiting_for_process_next || stepState.waitingForProcessNext);
  const requiresUserAction = Boolean(
    !finalVideoCompleted &&
    status === 'COMPLETED' &&
    nextStep &&
    (
      waitingForProcessNext ||
      stepState.requires_user_action ||
      stepState.requiresUserAction ||
      stepState.can_process_next ||
      stepState.canProcessNext
    ),
  );
  const manualStepStages = normalizeExpressStepStageList(
    stepState.manual_step_stages || stepState.manualStepStages,
    DEFAULT_EXPRESS_STEP_MANUAL_STAGES,
  );
  const autoAdvanceStepStages = EXPRESS_STEP_VIDEO_STAGES.filter((stage) => !manualStepStages.includes(stage));
  const requiredAction = requiresUserAction ? {
    type: 'process_next',
    reason: 'manual_step_checkpoint',
    current_step: currentStep,
    current_step_label: currentStepLabel,
    next_step: nextStep,
    next_step_label: EXPRESS_STEP_VIDEO_STAGE_LABELS[nextStep] || nextStep,
    process_next_url: '/v2/video/step/process_next',
  } : null;
  const completedResources = buildCompletedStepResources(sessionData, stepState, req);
  const currentStepResources =
    status === 'COMPLETED' && currentStep
      ? completedResources[currentStep] || {
        step: currentStep,
        label: EXPRESS_STEP_VIDEO_STAGE_LABELS[currentStep] || currentStep,
        status: 'COMPLETED',
        completed_at: stepState.updated_at || stepState.updatedAt || null,
        resources: buildStepResources(sessionData, currentStep, req),
      }
      : null;

  return {
    ...(baseStatus || {}),
    request_id: sessionId,
    session_id: sessionId,
    status,
    ...(finalVideoResultUrl ? {
      result_url: finalVideoResultUrl,
      result_urls: Array.isArray(baseStatus?.result_urls) && baseStatus.result_urls.length
        ? baseStatus.result_urls
        : [finalVideoResultUrl],
    } : {}),
    step_status: status,
    current_step: currentStep,
    current_step_label: currentStepLabel,
    next_step: nextStep,
    waiting_for_process_next: waitingForProcessNext,
    requires_user_action: requiresUserAction,
    requiresUserAction,
    can_process_next: requiresUserAction,
    canProcessNext: requiresUserAction,
    required_action: requiredAction,
    manual_step_stages: manualStepStages,
    auto_advance_step_stages: autoAdvanceStepStages,
    process_next_url: '/v2/video/step/process_next',
    step: {
      enabled: true,
      route_type: stepState.route_type || stepState.routeType || null,
      status,
      current_step: currentStep,
      current_step_label: currentStepLabel,
      next_step: nextStep,
      waiting_for_process_next: waitingForProcessNext,
      requires_user_action: requiresUserAction,
      requiresUserAction,
      can_process_next: requiresUserAction,
      canProcessNext: requiresUserAction,
      required_action: requiredAction,
      manual_step_stages: manualStepStages,
      auto_advance_step_stages: autoAdvanceStepStages,
      updated_at: stepState.updated_at || stepState.updatedAt || null,
    },
    current_step_resources: currentStepResources,
    completed_step_resources: completedResources,
  };
}

export async function buildStepVideoDetailedStatus({ userId, sessionId, req }) {
  const stepStatus = await buildStepVideoStatus({ userId, sessionId, req });
  if (!stepStatus) {
    return null;
  }

  const detailedStatus = await buildVideoStatusDetailedResponse({
    sessionId,
    requestId: sessionId,
    provider: null,
    req,
  });
  if (!detailedStatus) {
    return stepStatus;
  }

  return {
    ...detailedStatus,
    ...stepStatus,
    status_detail_schema: detailedStatus.status_detail_schema,
    session: detailedStatus.session,
  };
}

export async function requestStepTextToVideo({ userId, payload = {}, webhookUrl = null, req = null }) {
  const manualStepStages = resolveExpressStepManualStages(payload);
  const stepPayload = {
    ...normalizeStepVideoPayload(payload),
    manual_step_stages: manualStepStages,
    isStepVideoGeneration: true,
    stepVideoRoute: 'text_to_video',
  };
  const response = await requestCreateVideo(userId, stepPayload, webhookUrl);
  const sessionId = response?.session_id || response?.request_id;
  if (sessionId) {
    await initializeExpressStepGeneration(sessionId, {
      routeType: 'text_to_video',
      currentStep: 'prompt_generation',
      manualStepStages,
    });
  }
  const statusPayload = sessionId
    ? await buildStepVideoStatus({ userId, sessionId, req })
    : null;
  return {
    ...response,
    ...(statusPayload ? { step: statusPayload.step, status: statusPayload.status } : {}),
  };
}

export async function requestStepImageToVideo({ userId, payload = {}, webhookUrl = null, req = null }) {
  const manualStepStages = resolveExpressStepManualStages(payload);
  const stepPayload = {
    ...normalizeStepImageToVideoPayload(payload),
    manual_step_stages: manualStepStages,
    isStepVideoGeneration: true,
    stepVideoRoute: 'image_to_video',
  };
  const response = await requestCreateVideoFromImageListAndMetadata(userId, stepPayload, webhookUrl);
  const sessionId = response?.session_id || response?.request_id;
  if (sessionId) {
    await initializeExpressStepGeneration(sessionId, {
      routeType: 'image_to_video',
      currentStep: 'prompt_generation',
      manualStepStages,
    });
  }
  const statusPayload = sessionId
    ? await buildStepVideoStatus({ userId, sessionId, req })
    : null;
  return {
    ...response,
    ...(statusPayload ? { step: statusPayload.step, status: statusPayload.status } : {}),
	  };
	}

async function requestStepExternalVideoStage({
  userId,
  payload = {},
  stageKey,
  routeType,
  defaultModel,
  modelKeys,
  requiresAudio = false,
  req = null,
}) {
  await getDBConnectionString();
  const normalizedPayload = normalizeStepVideoPayload(payload);
  const model = getExternalStageModel(normalizedPayload, modelKeys, defaultModel);
  const duration = normalizeDurationSeconds(
    normalizedPayload.duration || normalizedPayload.audioDuration || normalizedPayload.audio_duration,
    5,
  );
  const aspectRatio = getFirstStringValue(normalizedPayload, ['aspect_ratio', 'aspectRatio']) || '16:9';
  const prompt = getFirstStringValue(normalizedPayload, ['prompt', 'audioPrompt', 'audio_prompt']);
  const videoUrl = await resolveExternalStagePublicMediaUrl(normalizedPayload, {
    disallowedDataKeys: ['video_data', 'videoData'],
    urlKeys: ['video_url', 'videoUrl', 'videoLink', 'video'],
    mediaLabel: 'video_url',
  });
  const audioUrl = requiresAudio
    ? await resolveExternalStagePublicMediaUrl(normalizedPayload, {
      disallowedDataKeys: ['audio_data', 'audioData'],
      urlKeys: ['audio_url', 'audioUrl', 'audioLink', 'audio'],
      mediaLabel: 'audio_url',
    })
    : '';

  if (!videoUrl) {
    const error = new Error('video_url is required and must be a publicly reachable URL.');
    error.status = 400;
    throw error;
  }
  if (requiresAudio && !audioUrl) {
    const error = new Error('audio_url is required and must be a publicly reachable URL.');
    error.status = 400;
    throw error;
  }

  const layerId = new mongoose.Types.ObjectId();
  const audioLayerId = new mongoose.Types.ObjectId();
  const now = new Date();
  const expressGenerationStatus = buildStageOnlyExpressGenerationStatus(stageKey);
  const expressStepGeneration = buildInitialExpressStepGeneration({
    routeType,
    currentStep: stageKey,
    manualStepStages: [],
  });

  const sessionDoc = new VideoSession({
    userId,
    sessionName: `${EXPRESS_STEP_VIDEO_STAGE_LABELS[stageKey] || routeType} request`,
    requestType: 'API',
    isExpressGeneration: true,
    isStepVideoGeneration: true,
    stepVideoRoute: routeType,
    aspectRatio,
    expressGenerationPending: true,
    expressGenerationStatus,
    expressStepGeneration,
    expressGenerativeVideoModel: model,
    layers: [{
      _id: layerId,
      imageSession: {
        userId,
        generations: [],
        activeItemList: [],
        generationStatus: 'COMPLETED',
        editStatus: 'COMPLETED',
        activeImageDescription: prompt,
      },
      prompt,
      videoGenerationPrompt: prompt,
      duration,
      durationOffset: 0,
      layerAiVideoType: stageKey === 'sound_effect_generation' ? 'sound_effect' : 'character',
      layerBaseAiImageType: stageKey === 'sound_effect_generation' ? 'sound_effect' : 'character',
      layerAISoundEffectPrompt: stageKey === 'sound_effect_generation' ? prompt : '',
      aiVideoLayer: videoUrl,
      aiVideoRemoteLink: videoUrl,
      hasAiVideoLayer: true,
      aiVideoGenerationPending: false,
      aiVideoGenerationStatus: 'COMPLETED',
      lipSyncGenerationPending: stageKey === 'lip_sync_generation',
      soundEffectGenerationPending: stageKey === 'sound_effect_generation',
      hasLipSyncVideoLayer: stageKey === 'lip_sync_generation',
      hasSoundEffectVideoLayer: stageKey === 'sound_effect_generation',
      lipSyncVideoGenerationStatus: stageKey === 'lip_sync_generation' ? 'PENDING' : 'COMPLETED',
      soundEffectVideoGenerationStatus: stageKey === 'sound_effect_generation' ? 'PENDING' : 'COMPLETED',
      status: 'pending',
    }],
    audioLayers: requiresAudio ? [{
      _id: audioLayerId,
      generationType: 'speech',
      prompt,
      startTime: 0,
      endTime: duration,
      duration,
      selectedRemoteAudioLink: audioUrl,
      remoteAudioLinks: [audioUrl],
      selectedLocalAudioLink: '',
      localAudioLinks: [],
      connectedLayerId: layerId.toString(),
      generationStatus: 'COMPLETED',
      isHuman: true,
      createdAt: now,
      updatedAt: now,
    }] : [],
  });

  await sessionDoc.save();

  await requestGenerateCustomAIVideo(userId, {
    sessionId: sessionDoc._id.toString(),
    videoSessionId: sessionDoc._id.toString(),
    currentLayerId: layerId.toString(),
    layerId: layerId.toString(),
    model,
    prompt,
    audioPrompt: prompt,
    duration,
    aspectRatio,
    videoUrl,
    videoLink: videoUrl,
    ...(requiresAudio ? { audioLink: audioUrl } : {}),
    isAudioVideoGeneration: true,
    isExpressGeneration: true,
    isVideoGPTGeneration: true,
    clipLayerToAiVideo: false,
    retryOnFail: false,
  });

  const statusPayload = await buildStepVideoStatus({
    userId,
    sessionId: sessionDoc._id.toString(),
    req,
  });

  return {
    request_id: sessionDoc._id.toString(),
    session_id: sessionDoc._id.toString(),
    status: statusPayload?.status || 'PENDING',
    step: statusPayload?.step || null,
  };
}

export async function requestStepLipSyncVideo({ userId, payload = {}, req = null }) {
  return requestStepExternalVideoStage({
    userId,
    payload,
    stageKey: 'lip_sync_generation',
    routeType: 'lip_sync',
    defaultModel: 'SYNCLIPSYNC',
    modelKeys: ['lip_sync_model', 'lipSyncModel', 'video_model', 'videoModel', 'model'],
    requiresAudio: true,
    req,
  });
}

export async function requestStepSoundEffectVideo({ userId, payload = {}, req = null }) {
  return requestStepExternalVideoStage({
    userId,
    payload,
    stageKey: 'sound_effect_generation',
    routeType: 'sound_effect',
    defaultModel: 'MIRELOAI',
    modelKeys: ['sound_effect_model', 'soundEffectModel', 'video_model', 'videoModel', 'model'],
    requiresAudio: false,
    req,
  });
}

export async function processNextStepVideoStage({ userId, sessionId, req = null }) {
  const sessionData = await loadOwnedStepSession(userId, sessionId);
  if (!sessionData) {
    const error = new Error('Step video request not found.');
    error.status = 404;
    throw error;
  }
  const stepState = getStepState(sessionData);
  if (!stepState) {
    const error = new Error('This video request is not a step video request.');
    error.status = 400;
    throw error;
  }
  if (sessionData.expressGenerationFailed) {
    const error = new Error(sessionData.expressGenerationError || 'Step video generation failed.');
    error.status = 409;
    throw error;
  }

  const status = normalizeStepStatus(sessionData, stepState);
  if (status === 'PENDING') {
    return buildStepVideoStatus({ userId, sessionId, req });
  }

  if (status !== 'COMPLETED') {
    const error = new Error('The current step is not completed yet.');
    error.status = 409;
    throw error;
  }

  const nextStep = stepState.next_step || stepState.nextStep;
  if (!nextStep) {
    return buildStepVideoStatus({ userId, sessionId, req });
  }

  await markExpressStepStagePending(sessionId, nextStep);
  return buildStepVideoStatus({ userId, sessionId, req });
}

export function getStepVideoSessionIdFromRequest(req) {
  return (
    normalizeString(req?.params?.request_id) ||
    normalizeString(req?.params?.session_id) ||
    getStepSessionId(req?.query || {}) ||
    getStepSessionId(req?.body?.input || {}) ||
    getStepSessionId(req?.body || {})
  );
}
