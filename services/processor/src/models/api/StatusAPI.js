import VideoSession from '../../schema/VideoSession.js';
import GeneratedImage from '../../schema/generations/GeneratedImage.js';
import { buildSecureMediaDeliveryUrl } from '../AWS.js';
import { resolveDockerLocalPublicAssetBaseUrl } from '../../consts/DockerDeploymentUrls.js';
import { isContainerRuntime, isStandaloneEdition } from '../../utils/EnvironmentUtils.js';

const DEFAULT_STATIC_ASSET_BASE_URL = 'https://static.samsar.one';
const USER_RESOURCES_PREFIX = 'user_resources/';
const SECURE_ASSET_PREFIX = (process.env.SECURE_ASSET_PREFIX || 'assets_v2').replace(/^\/+|\/+$/g, '');
const BRANCHED_VIDEO_STATUS_SCHEMA = 'branched_video_status.v1';
const COMPLETED_INTERACTIVE_VIDEO_DETAIL_SCHEMA = 'interactive_video_manifest.v1';
const BRANCH_COMPLETED_STATUSES = new Set(['COMPLETED', 'SUCCESS', 'SUCCEEDED', 'DONE']);
const BRANCH_FAILED_STATUSES = new Set(['FAILED', 'ERROR', 'TIMEOUT']);

const VIDEO_STATUS_BRANCH_PROJECTION = [
  'branchRenderPaths.pathId',
  'branchRenderPaths.leafNodeId',
  'branchRenderPaths.ordinal',
  'branchRenderPaths.duration',
  'branchRenderPaths.nodeIds',
  'branchRenderPaths.selectionTrail',
  'branchRenderPaths.branchingHint',
  'branchRenderPaths.branchingDescription',
  'branchRenderPaths.branchPointId',
  'branchRenderPaths.divergenceSceneIndex',
  'branchRenderPaths.switchAtSeconds',
  'branchRenderPaths.thumbnailUrl',
  'branchRenderPaths.thumbnailPath',
  'branchRenderPaths.frameGenerationStatus',
  'branchRenderPaths.frameGenerationPending',
  'branchRenderPaths.frameGenerationError',
  'branchRenderPaths.videoGenerationStatus',
  'branchRenderPaths.videoGenerationPending',
  'branchRenderPaths.videoGenerationError',
  'branchRenderPaths.videoGenerationCompletedAt',
  'branchRenderPaths.videoLink',
  'branchRenderPaths.remoteURL',
];

const VIDEO_STATUS_DETAILED_BRANCH_PROJECTION = [
  ...VIDEO_STATUS_BRANCH_PROJECTION,
  'branchRenderPaths.timeline.sequenceIndex',
  'branchRenderPaths.timeline.pathSequenceIndex',
  'branchRenderPaths.timeline.sceneIndex',
  'branchRenderPaths.timeline.layerId',
  'branchRenderPaths.timeline.duration',
  'branchRenderPaths.timeline.durationOffset',
  'branchRenderPaths.timeline.startTime',
  'branchRenderPaths.timeline.endTime',
  'branchRenderPaths.timeline.frameGenerationStatus',
  'branchRenderPaths.timeline.frameGenerationPending',
  'branchRenderPaths.timeline.frameGenerationError',
  'branchRenderPaths.timeline.error',
  'branchRenderPaths.audioTimeline.sequenceIndex',
  'branchRenderPaths.audioTimeline.pathSequenceIndex',
  'branchRenderPaths.audioTimeline.sceneIndex',
  'branchRenderPaths.audioTimeline.audioLayerId',
  'branchRenderPaths.audioTimeline.connectedLayerId',
  'branchRenderPaths.audioTimeline.connectedLayerIndex',
  'branchRenderPaths.audioTimeline.duration',
  'branchRenderPaths.audioTimeline.startTime',
  'branchRenderPaths.audioTimeline.endTime',
  'branchRenderPaths.audioTimeline.connectedLayerStartTimeOffset',
];

export const VIDEO_STATUS_SESSION_PROJECTION = [
  'remoteURL',
  'videoLink',
  'narrativeType',
  'sourceNarrativeRequestId',
  'sourceNarrativeType',
  'branchingMeta',
  'branchingTimeline',
  'renderPlanVersion',
  'defaultBranchPathId',
  'branchRenderCompletionFinalized',
  'branchRenderCompletedAt',
  ...VIDEO_STATUS_BRANCH_PROJECTION,
  'expressGenerationStatus',
  'expressGenerationCreditCharges',
  'generationError',
  'expressGenerationError',
  'lastAiVideoLayerGenerationError',
  'expressGenerationFailed',
  'expressGenerationPending',
  'expressGenerationPaused',
  'expressGenerationCancelled',
  'videoGenerationPending',
  'builderStatus',
  'builderRouteType',
  'builderSessionSubType',
  'expressGenerativeVideoModel',
  'expressGenerativeVideoModelSubType',
  'videoGenerationModelSubType',
  'enableSubtitles',
  'hasSubtitles',
  'has_subtitles',
  'subtitleLanguage',
  'subtitleLanguageString',
  'subtitleLanguageExplicit',
  'subtitleTranslationRequired',
  'sessionLanguage',
  'language',
  'language_code',
  'langauge',
  'languageString',
  'addFooterAnimation',
  'footerMetadata',
  'footerLogoImagePath',
  'footerCtaText',
  'footerCtaUrl',
  'footerCtaLogo',
  'layers.addFooterAnimation',
  'layers.footerMetadata',
  'layers.footerLogoImagePath',
  'layers.footer_logo_image_path',
  'layers.imageSession.generationStatus',
  'layers.imageSession.generationError',
  'layers.imageSession.editStatus',
  'layers.imageSession.editError',
  'layers.aiVideoGenerationStatus',
  'layers.aiVideoGenerationError',
  'layers.lipSyncVideoGenerationStatus',
  'layers.lipSyncVideoGenerationError',
  'layers.soundEffectVideoGenerationStatus',
  'layers.soundEffectVideoGenerationError',
  'layers.userVideoGenerationStatus',
  'layers.userVideoGenerationError',
].join(' ');

export const VIDEO_STATUS_DETAILED_SESSION_PROJECTION = [
  'remoteURL',
  'videoLink',
  'narrativeType',
  'sourceNarrativeRequestId',
  'sourceNarrativeType',
  'branchingMeta',
  'branchingTimeline',
  'renderPlanVersion',
  'defaultBranchPathId',
  'branchRenderCompletionFinalized',
  'branchRenderCompletedAt',
  ...VIDEO_STATUS_DETAILED_BRANCH_PROJECTION,
  'expressGenerationStatus',
  'expressGenerationCreditCharges',
  'generationError',
  'expressGenerationError',
  'lastAiVideoLayerGenerationError',
  'expressGenerationFailed',
  'expressGenerationPending',
  'expressGenerationPaused',
  'expressGenerationPausedAt',
  'expressGenerationResumedAt',
  'expressGenerationCancelled',
  'videoGenerationPending',
  'builderStatus',
  'builderRouteType',
  'builderSessionSubType',
  'expressGenerativeVideoModel',
  'expressGenerativeVideoModelSubType',
  'videoGenerationModelSubType',
  'enableSubtitles',
  'hasSubtitles',
  'has_subtitles',
  'subtitleLanguage',
  'subtitleLanguageString',
  'subtitleLanguageExplicit',
  'subtitleTranslationRequired',
  'sessionLanguage',
  'language',
  'language_code',
  'langauge',
  'languageString',
  'addFooterAnimation',
  'footerMetadata',
  'footerLogoImagePath',
  'footerCtaText',
  'footerCtaUrl',
  'footerCtaLogo',
  'aspectRatio',
  'framesPerSecond',
  'totalDuration',
  'inputPrompt',
  'expressInputPrompt',
  'expressGenerationType',
  'isExpressGeneration',
  'isStepVideoGeneration',
  'expressStepGeneration',
  'createdAt',
  'updatedAt',
  'generations',
  'layers._id',
  'layers.prompt',
  'layers.videoGenerationPrompt',
  'layers.status',
  'layers.duration',
  'layers.durationOffset',
  'layers.addFooterAnimation',
  'layers.footerMetadata',
  'layers.footerLogoImagePath',
  'layers.footer_logo_image_path',
  'layers.imageSession.generationStatus',
  'layers.imageSession.generationError',
  'layers.imageSession.editStatus',
  'layers.imageSession.editError',
  'layers.imageSession.activeSelectedImage',
  'layers.imageSession.activeGeneratedImage',
  'layers.imageSession.activeEditedImage',
  'layers.imageSession.activeImageRemoteLink',
  'layers.imageSession.activeImageDescription',
  'layers.imageSession.prompt',
  'layers.imageSession.activeItemList',
  'layers.filterPasses',
  'layers.refilterImageScore',
  'layers.aiVideoGenerationStatus',
  'layers.aiVideoGenerationError',
  'layers.aiVideoRemoteLink',
  'layers.aiVideoLayer',
  'layers.hasAiVideoLayer',
  'layers.aiLayerStartFrame',
  'layers.aiLayerEndFrame',
  'layers.baseLayerStartFrame',
  'layers.baseLayerEndFrame',
  'layers.aiVideoThumbnailPath',
  'layers.thumbnailPath',
  'layers.lipSyncVideoGenerationStatus',
  'layers.lipSyncVideoGenerationError',
  'layers.lipSyncRemoteLink',
  'layers.lipSyncVideoLayer',
  'layers.hasLipSyncVideoLayer',
  'layers.lipSyncThumbnailPath',
  'layers.soundEffectVideoGenerationStatus',
  'layers.soundEffectVideoGenerationError',
  'layers.soundEffectRemoteLink',
  'layers.soundEffectVideoLayer',
  'layers.hasSoundEffectVideoLayer',
  'layers.soundEffectThumbnailPath',
  'layers.userVideoGenerationStatus',
  'layers.userVideoGenerationError',
  'layers.userVideoRemoteLink',
  'layers.userVideoLayer',
  'layers.hasUserVideoLayer',
  'layers.userVideoThumbnailPath',
  'layers.layerAiVideoType',
  'layers.layerBaseAiImageType',
  'layers.layerAISoundEffectPrompt',
  'audioLayers._id',
  'audioLayers.prompt',
  'audioLayers.subtitleText',
  'audioLayers.subtitleLanguage',
  'audioLayers.speechLanguage',
  'audioLayers.subtitleTranslationRequired',
  'audioLayers.subtitleAlignmentMap',
  'audioLayers.subtitleSpeakerCharacterName',
  'audioLayers.generationType',
  'audioLayers.generationStatus',
  'audioLayers.generationError',
  'audioLayers.duration',
  'audioLayers.startTime',
  'audioLayers.endTime',
  'audioLayers.sourceTrimStartTime',
  'audioLayers.connectedLayerId',
  'audioLayers.connectedLayerIndex',
  'audioLayers.audioBindingMode',
  'audioLayers.bindToLayer',
  'audioLayers.selectedRemoteAudioLink',
  'audioLayers.remoteAudioLinks',
  'audioLayers.selectedLocalAudioLink',
  'audioLayers.localAudioLinks',
  'audioLayers.speaker',
  'audioLayers.provider',
  'audioLayers.languageCode',
  'audioLayers.languageCodes',
  'audioLayers.speakerVoiceId',
  'audioLayers.speakerLabel',
  'audioLayers.speakerDetails',
  'audioLayers.speakerCharacterName',
  'audioLayers.lyrics',
  'audioLayers.addSubtitles',
  'audioLayers.addTranscriptionsRequired',
  'audioLayers.subtitleFont',
  'audioLayers.subtitleWordAnimation',
  'audioLayers.transcriptAlignment',
  'audioLayers.volume',
  'audioLayers.isEnabled',
  'audioLayers.defaultSelected',
  'global_audio_layers._id',
  'global_audio_layers.prompt',
  'global_audio_layers.generationType',
  'global_audio_layers.generationStatus',
  'global_audio_layers.generationError',
  'global_audio_layers.duration',
  'global_audio_layers.startTime',
  'global_audio_layers.endTime',
  'global_audio_layers.sourceTrimStartTime',
  'global_audio_layers.selectedRemoteAudioLink',
  'global_audio_layers.remoteAudioLinks',
  'global_audio_layers.selectedLocalAudioLink',
  'global_audio_layers.localAudioLinks',
  'global_audio_layers.speaker',
  'global_audio_layers.provider',
  'global_audio_layers.languageCode',
  'global_audio_layers.languageCodes',
  'global_audio_layers.speakerVoiceId',
  'global_audio_layers.speakerLabel',
  'global_audio_layers.speakerDetails',
  'global_audio_layers.speakerCharacterName',
  'global_audio_layers.lyrics',
  'global_audio_layers.addSubtitles',
  'global_audio_layers.subtitleFont',
  'global_audio_layers.subtitleWordAnimation',
  'global_audio_layers.transcriptAlignment',
  'global_audio_layers.volume',
  'global_audio_layers.isEnabled',
  'global_audio_layers.defaultSelected',
  'global_videos._id',
  'global_videos.startTime',
  'global_videos.endTime',
  'global_videos.duration',
  'global_videos.url',
  'global_videos.remoteURL',
  'global_videos.assetPath',
  'global_videos.source',
  'global_videos.title',
  'global_videos.framesPerSecond',
  'global_videos.framesGenerationStatus',
].join(' ');

const EXPRESS_STATUS_STAGE_ORDER = [
  'prompt_generation',
  'image_generation',
  'speech_generation',
  'music_generation',
  'audio_generation',
  'ai_video_generation',
  'lip_sync_generation',
  'sound_effect_generation',
  'delete_reflow',
  'timeline_reflowed',
  'transcript_generation',
  'frame_generation',
  'video_generation',
];

const PREVIEW_STAGE_ORDER = [
  'prompt_generation',
  'image_generation',
  'speech_generation',
  'music_generation',
  'audio_generation',
  'ai_video_generation',
  'lip_sync_generation',
  'sound_effect_generation',
  'video_generation',
];

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNonEmptyString(value) {
  const normalized = normalizeString(value);
  return normalized || null;
}

function isTerminalGenerationFailureStatus(value) {
  const normalized = normalizeString(value).toUpperCase();
  return BRANCH_FAILED_STATUSES.has(normalized) || /FAIL|ERROR|TIMEOUT/.test(normalized);
}

function buildLayerGenerationFailure(layer = {}, layerIndex = 0) {
  const candidates = [
    {
      stage: 'ai_video_generation',
      status: layer.aiVideoGenerationStatus,
      message: layer.aiVideoGenerationError,
    },
    {
      stage: 'lip_sync_generation',
      status: layer.lipSyncVideoGenerationStatus,
      message: layer.lipSyncVideoGenerationError,
    },
    {
      stage: 'sound_effect_generation',
      status: layer.soundEffectVideoGenerationStatus,
      message: layer.soundEffectVideoGenerationError,
    },
    {
      stage: 'user_video_generation',
      status: layer.userVideoGenerationStatus,
      message: layer.userVideoGenerationError,
    },
    {
      stage: 'image_generation',
      status: layer.imageSession?.generationStatus,
      message: layer.imageSession?.generationError,
    },
    {
      stage: 'image_edit',
      status: layer.imageSession?.editStatus,
      message: layer.imageSession?.editError,
    },
  ];
  const failure = candidates.find(({ status, message }) => (
    isTerminalGenerationFailureStatus(status) && normalizeNonEmptyString(message)
  ));
  if (!failure) {
    return null;
  }

  return {
    message: normalizeNonEmptyString(failure.message),
    stage: failure.stage,
    layer_id: toObjectIdString(layer._id),
    layer_index: layerIndex,
  };
}

export function resolveVideoGenerationFailure(sessionData = {}) {
  const layers = Array.isArray(sessionData?.layers) ? sessionData.layers : [];
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    const failure = buildLayerGenerationFailure(layers[layerIndex], layerIndex);
    if (failure) {
      return failure;
    }
  }

  const stageStatuses = sessionData?.expressGenerationStatus &&
    typeof sessionData.expressGenerationStatus === 'object'
    ? Object.values(sessionData.expressGenerationStatus)
    : [];
  const hasAggregateFailure = sessionData?.expressGenerationFailed === true ||
    stageStatuses.some(isTerminalGenerationFailureStatus);
  const sessionGenerationError = normalizeNonEmptyString(sessionData?.generationError);
  const hasActiveGeneration = sessionData?.expressGenerationPending === true ||
    sessionData?.videoGenerationPending === true ||
    stageStatuses.some((status) => ['PENDING', 'IN_PROGRESS', 'RUNNING', 'PROCESSING']
      .includes(normalizeString(status).toUpperCase()));
  const hasCompletedOutput = Boolean(sessionData?.videoLink || sessionData?.remoteURL);
  if (
    sessionGenerationError &&
    (hasAggregateFailure || (!hasActiveGeneration && !hasCompletedOutput))
  ) {
    return { message: sessionGenerationError, stage: 'video_generation' };
  }
  if (!hasAggregateFailure) {
    return null;
  }

  const aggregateError = normalizeNonEmptyString(
    sessionData?.lastAiVideoLayerGenerationError || sessionData?.expressGenerationError,
  );
  return aggregateError
    ? { message: aggregateError, stage: 'video_generation' }
    : null;
}

function isBranchedVideoSession(sessionData = {}) {
  return [sessionData?.narrativeType, sessionData?.sourceNarrativeType]
    .some((value) => normalizeNonEmptyString(value)?.toLowerCase() === 'branched');
}

function normalizeBranchStageStatus(value) {
  const normalized = normalizeNonEmptyString(value)?.toUpperCase() || '';
  if (normalized === 'COMPLETED') return 'COMPLETED';
  if (BRANCH_FAILED_STATUSES.has(normalized) || /FAIL|ERROR|TIMEOUT/.test(normalized)) return 'FAILED';
  if (normalized.includes('CANCEL')) return 'CANCELLED';
  if (normalized.includes('PAUS')) return 'PAUSED';
  if (!normalized || normalized === 'INIT' || normalized === 'INITIALIZED') return 'INIT';
  return 'PENDING';
}

function normalizeBranchSelectionTrail(selectionTrail = []) {
  return (Array.isArray(selectionTrail) ? selectionTrail : []).map((choice) => compactObject({
    branch_point_id: normalizeNonEmptyString(choice?.branchPointId || choice?.branch_point_id),
    node_id: normalizeNonEmptyString(choice?.nodeId || choice?.node_id || choice?.childNodeId),
    parent_node_id: normalizeNonEmptyString(choice?.parentNodeId || choice?.parent_node_id),
    level: normalizeNumber(choice?.level),
    child_index: normalizeNumber(choice?.childIndex ?? choice?.child_index),
    branch_ordinal: normalizeNumber(choice?.branchOrdinal ?? choice?.branch_ordinal),
    divergence_scene_index: normalizeNumber(
      choice?.divergenceSceneIndex ?? choice?.divergence_scene_index,
    ),
    switch_at_seconds: normalizeNumber(choice?.switchAtSeconds ?? choice?.switch_at_seconds),
    path_name: normalizeNonEmptyString(choice?.pathName || choice?.path_name),
    path_description: normalizeNonEmptyString(choice?.pathDescription || choice?.path_description),
  }));
}

function buildNormalizedBranchTimeline(timeline = []) {
  return (Array.isArray(timeline) ? timeline : []).map((entry, index) => {
    const sequenceIndex = normalizeNumber(entry?.pathSequenceIndex ?? entry?.sequenceIndex) ?? index;
    const startTime = normalizeNumber(entry?.startTime ?? entry?.durationOffset) ?? 0;
    const duration = normalizeNumber(entry?.duration);
    const endTime = normalizeNumber(entry?.endTime) ?? (
      duration === null ? null : startTime + duration
    );
    return compactObject({
      sequence_index: sequenceIndex,
      scene_index: normalizeNumber(entry?.sceneIndex),
      layer_id: toObjectIdString(entry?.layerId),
      start_time: startTime,
      end_time: endTime,
      duration,
      frame_generation: {
        status: normalizeBranchStageStatus(entry?.frameGenerationStatus),
        pending: normalizeBoolean(entry?.frameGenerationPending),
        error: normalizeNonEmptyString(entry?.frameGenerationError || entry?.error),
      },
    });
  });
}

function buildNormalizedBranchAudioTimeline(audioTimeline = []) {
  return (Array.isArray(audioTimeline) ? audioTimeline : []).map((entry, index) => {
    const startTime = normalizeNumber(entry?.startTime) ?? 0;
    const duration = normalizeNumber(entry?.duration);
    const endTime = normalizeNumber(entry?.endTime) ?? (
      duration === null ? null : startTime + duration
    );
    return compactObject({
      sequence_index: normalizeNumber(entry?.pathSequenceIndex ?? entry?.sequenceIndex) ?? index,
      scene_index: normalizeNumber(entry?.sceneIndex),
      audio_layer_id: toObjectIdString(entry?.audioLayerId),
      connected_layer_id: toObjectIdString(entry?.connectedLayerId),
      connected_layer_index: normalizeNumber(entry?.connectedLayerIndex),
      start_time: startTime,
      end_time: endTime,
      duration,
      connected_layer_start_time_offset: normalizeNumber(entry?.connectedLayerStartTimeOffset),
    });
  });
}

function buildNormalizedBranchPath(path = {}, sourceOrdinal = 0, defaultPathId = null, req = null, {
  detailed = false,
} = {}) {
  const pathId = normalizeNonEmptyString(path?.pathId);
  const videoLink = normalizeResponseAssetUrl(path?.videoLink, req);
  const resultUrl = normalizeResponseAssetUrl(selectResponseMediaSource({
    local: path?.videoLink,
    remote: path?.remoteURL,
  }), req);
  const remoteURL = resultUrl;
  const thumbnailUrl = normalizeResponseAssetUrl(
    path?.thumbnailUrl || path?.thumbnailPath,
    req,
  );
  const frameStatus = normalizeBranchStageStatus(path?.frameGenerationStatus);
  const videoStatus = normalizeBranchStageStatus(path?.videoGenerationStatus);
  const videoComplete = videoStatus === 'COMPLETED' && Boolean(resultUrl);
  const failed = frameStatus === 'FAILED' || videoStatus === 'FAILED';
  const cancelled = frameStatus === 'CANCELLED' || videoStatus === 'CANCELLED';
  const timeline = detailed ? buildNormalizedBranchTimeline(path?.timeline) : [];
  const audioTimeline = detailed ? buildNormalizedBranchAudioTimeline(path?.audioTimeline) : [];
  const selectionTrail = normalizeBranchSelectionTrail(path?.selectionTrail);
  const immediateSelection = selectionTrail.at(-1) || {};
  const completedTimelineItems = timeline.filter((entry) => (
    entry?.frame_generation?.status === 'COMPLETED'
  )).length;
  const pathStatus = failed
    ? 'FAILED'
    : cancelled
      ? 'CANCELLED'
      : videoComplete
        ? 'COMPLETED'
        : frameStatus === 'INIT' && videoStatus === 'INIT'
          ? 'INIT'
          : 'PENDING';

  return compactObject({
    path_id: pathId,
    leaf_node_id: normalizeNonEmptyString(path?.leafNodeId || pathId),
    ordinal: Number.isInteger(path?.ordinal) ? path.ordinal : sourceOrdinal,
    is_default: Boolean(pathId && pathId === defaultPathId),
    node_ids: normalizeStringList(path?.nodeIds),
    duration: normalizeNumber(path?.duration),
    branching_hint: normalizeNonEmptyString(path?.branchingHint || immediateSelection.path_name),
    branching_description: normalizeNonEmptyString(
      path?.branchingDescription || immediateSelection.path_description,
    ),
    branch_point_id: normalizeNonEmptyString(
      path?.branchPointId || immediateSelection.branch_point_id,
    ),
    divergence_scene_index: normalizeNumber(
      path?.divergenceSceneIndex ?? immediateSelection.divergence_scene_index,
    ),
    switch_at_seconds: normalizeNumber(
      path?.switchAtSeconds ?? immediateSelection.switch_at_seconds,
    ),
    thumbnail_url: thumbnailUrl,
    status: pathStatus,
    current_stage: pathStatus === 'COMPLETED' || pathStatus === 'FAILED' || pathStatus === 'CANCELLED'
      ? null
      : frameStatus === 'COMPLETED'
        ? 'video_generation'
        : 'frame_generation',
    stages: {
      frame_generation: frameStatus,
      video_generation: videoStatus,
    },
    stage_details: {
      frame_generation: {
        status: frameStatus,
        pending: normalizeBoolean(path?.frameGenerationPending),
        ...(detailed
          ? {
            completed_items: completedTimelineItems,
            total_items: timeline.length,
          }
          : {}),
        error: normalizeNonEmptyString(path?.frameGenerationError),
      },
      video_generation: {
        status: videoStatus,
        pending: normalizeBoolean(path?.videoGenerationPending),
        completed_at: path?.videoGenerationCompletedAt || null,
        error: normalizeNonEmptyString(path?.videoGenerationError),
      },
    },
    result_url: videoComplete ? resultUrl : null,
    video_link: videoComplete ? videoLink : null,
    remote_url: videoComplete ? remoteURL : null,
    selection_trail: selectionTrail,
    error: normalizeNonEmptyString(path?.videoGenerationError || path?.frameGenerationError),
    ...(detailed
      ? {
        timeline,
        audio_timeline: audioTimeline,
      }
      : {}),
  });
}

function compareNormalizedBranchPaths(left = {}, right = {}) {
  const ordinalDifference = (normalizeNumber(left.ordinal) ?? Number.MAX_SAFE_INTEGER) -
    (normalizeNumber(right.ordinal) ?? Number.MAX_SAFE_INTEGER);
  if (ordinalDifference !== 0) return ordinalDifference;
  return normalizeString(left.path_id).localeCompare(normalizeString(right.path_id));
}

function buildNormalizedBranchChoicePoints(sessionData = {}, paths = []) {
  const branchingMeta = sessionData?.branchingMeta && typeof sessionData.branchingMeta === 'object'
    ? sessionData.branchingMeta
    : {};
  const branchingTimeline = sessionData?.branchingTimeline &&
    typeof sessionData.branchingTimeline === 'object'
    ? sessionData.branchingTimeline
    : {};
  const configuredBranchPoints = Array.isArray(branchingTimeline.choicePoints) &&
    branchingTimeline.choicePoints.length > 0
    ? branchingTimeline.choicePoints
    : Array.isArray(branchingMeta.branchPoints)
      ? branchingMeta.branchPoints
      : [];
  const allTrailEntries = paths.flatMap((path) => (
    (Array.isArray(path.selection_trail) ? path.selection_trail : [])
      .map((choice) => ({ ...choice, leaf_path_id: path.path_id }))
  ));

  const buildOptions = (branchPoint = {}, matchingTrailEntries = []) => {
    const configuredOptions = Array.isArray(branchPoint.options)
      ? branchPoint.options
      : Array.isArray(branchPoint.divergencePaths)
        ? branchPoint.divergencePaths
        : [];
    const sourceOptions = configuredOptions.length
      ? configuredOptions
      : Array.from(new Map(matchingTrailEntries.map((choice) => [choice.node_id, choice])).values());

    return sourceOptions.map((option, optionIndex) => {
      const childNodeId = normalizeNonEmptyString(
        option?.childNodeId || option?.child_node_id || option?.node_id,
      );
      const matchingChoice = matchingTrailEntries.find((choice) => choice.node_id === childNodeId) || {};
      const configuredLeafPathIds = normalizeStringList(
        option?.leafPathIds || option?.leaf_path_ids,
      );
      return compactObject({
        child_node_id: childNodeId,
        branch_ordinal: normalizeNumber(
          option?.branchOrdinal ?? option?.branch_ordinal ?? matchingChoice.branch_ordinal,
        ) ?? optionIndex + 1,
        path_name: normalizeNonEmptyString(
          option?.branchingHint ||
          option?.path_name ||
          option?.pathName ||
          matchingChoice.path_name,
        ),
        path_description: normalizeNonEmptyString(
          option?.description ||
          option?.path_description ||
          option?.pathDescription ||
          matchingChoice.path_description,
        ),
        leaf_path_ids: configuredLeafPathIds.length > 0
          ? configuredLeafPathIds
          : paths
            .filter((path) => path.selection_trail?.some((choice) => choice.node_id === childNodeId))
            .map((path) => path.path_id)
            .filter(Boolean),
      });
    });
  };

  if (configuredBranchPoints.length) {
    return configuredBranchPoints.map((branchPoint) => {
      const branchPointId = normalizeNonEmptyString(
        branchPoint?.branchPointId || branchPoint?.branch_point_id,
      );
      const parentNodeId = normalizeNonEmptyString(
        branchPoint?.parentNodeId || branchPoint?.parent_node_id,
      );
      const matchingTrailEntries = allTrailEntries.filter((choice) => (
        (branchPointId && choice.branch_point_id === branchPointId) ||
        (!branchPointId && parentNodeId && choice.parent_node_id === parentNodeId)
      ));
      const timingChoice = matchingTrailEntries[0] || {};
      return compactObject({
        branch_point_id: branchPointId,
        parent_node_id: parentNodeId,
        level: normalizeNumber(branchPoint?.level ?? timingChoice.level),
        divergence_scene_index: normalizeNumber(
          branchPoint?.divergenceSceneIndex ??
          branchPoint?.divergence_scene_index ??
          timingChoice.divergence_scene_index,
        ),
        switch_at_seconds: normalizeNumber(
          branchPoint?.switchAtSeconds ??
          branchPoint?.switch_at_seconds ??
          timingChoice.switch_at_seconds,
        ),
        options: buildOptions(branchPoint, matchingTrailEntries),
      });
    });
  }

  const groupedTrailEntries = new Map();
  allTrailEntries.forEach((choice) => {
    const key = choice.branch_point_id || `${choice.parent_node_id || 'root'}:${choice.level || 0}`;
    const existing = groupedTrailEntries.get(key) || [];
    existing.push(choice);
    groupedTrailEntries.set(key, existing);
  });
  return Array.from(groupedTrailEntries.entries()).map(([branchPointId, choices]) => {
    const firstChoice = choices[0] || {};
    return compactObject({
      branch_point_id: branchPointId,
      parent_node_id: firstChoice.parent_node_id,
      level: firstChoice.level,
      divergence_scene_index: firstChoice.divergence_scene_index,
      switch_at_seconds: firstChoice.switch_at_seconds,
      options: buildOptions({}, choices),
    });
  });
}

export function buildNormalizedBranchingStatus(sessionData = {}, req = null, { detailed = false } = {}) {
  if (!isBranchedVideoSession(sessionData) || !Array.isArray(sessionData?.branchRenderPaths)) {
    return null;
  }

  const branchingTimeline = sessionData?.branchingTimeline &&
    typeof sessionData.branchingTimeline === 'object'
    ? sessionData.branchingTimeline
    : {};
  const defaultPathId = normalizeNonEmptyString(
    sessionData?.defaultBranchPathId || branchingTimeline.defaultPathId,
  );
  const paths = sessionData.branchRenderPaths
    .map((path, ordinal) => buildNormalizedBranchPath(path, ordinal, defaultPathId, req, { detailed }))
    .sort(compareNormalizedBranchPaths);
  if (!paths.length) {
    return null;
  }

  const effectiveDefaultPathId = paths.some((path) => path.path_id === defaultPathId)
    ? defaultPathId
    : paths[0]?.path_id || null;
  paths.forEach((path) => {
    path.is_default = path.path_id === effectiveDefaultPathId;
  });

  const completedPaths = paths.filter((path) => path.status === 'COMPLETED');
  const failedPaths = paths.filter((path) => path.status === 'FAILED');
  const cancelledPaths = paths.filter((path) => path.status === 'CANCELLED');
  const frameCompletedPaths = paths.filter((path) => (
    path.status === 'COMPLETED' || path.stages?.frame_generation === 'COMPLETED'
  ));
  const videoCompletedPaths = completedPaths;
  const allPathsComplete = completedPaths.length === paths.length;
  const allPathsInit = paths.every((path) => path.status === 'INIT');
  const renderUnitsCompleted = frameCompletedPaths.length + videoCompletedPaths.length;
  const renderUnitsTotal = paths.length * 2;
  const progressPercent = allPathsComplete
    ? 100
    : renderUnitsTotal > 0
      ? Math.round((renderUnitsCompleted / renderUnitsTotal) * 1000) / 10
      : 0;
  const expressStatus = normalizeBranchStageStatus(sessionData?.expressGenerationStatus?.status);
  const hasExplicitGenerationFailureState =
    typeof sessionData?.expressGenerationFailed === 'boolean';
  const hasExplicitGenerationCancellationState =
    typeof sessionData?.expressGenerationCancelled === 'boolean';
  const sessionCancelled = sessionData?.expressGenerationCancelled === true ||
    (!hasExplicitGenerationCancellationState && expressStatus === 'CANCELLED');
  const sessionFailed = sessionData?.expressGenerationFailed === true ||
    (!hasExplicitGenerationFailureState && expressStatus === 'FAILED');
  const aggregateStatus =
    sessionCancelled ||
    cancelledPaths.length > 0
    ? 'CANCELLED'
    : sessionFailed || failedPaths.length > 0
      ? 'FAILED'
      : sessionData?.expressGenerationPaused || expressStatus === 'PAUSED'
        ? 'PAUSED'
        : allPathsComplete
          ? 'COMPLETED'
          : expressStatus === 'INIT' && renderUnitsCompleted === 0 && allPathsInit
            ? 'INIT'
            : 'PENDING';
  const outputsReady = allPathsComplete && aggregateStatus === 'COMPLETED';
  const branchingMeta = sessionData?.branchingMeta && typeof sessionData.branchingMeta === 'object'
    ? sessionData.branchingMeta
    : {};
  const choicePoints = buildNormalizedBranchChoicePoints(sessionData, paths);
  const outputPaths = outputsReady
    ? paths.map((path) => compactObject({
      path_id: path.path_id,
      leaf_node_id: path.leaf_node_id,
      ordinal: path.ordinal,
      is_default: path.is_default,
      url: path.result_url,
      thumbnail_url: path.thumbnail_url,
      duration: path.duration,
      selection_trail: path.selection_trail,
    }))
    : [];
  const defaultOutput = outputPaths.find((path) => path.path_id === effectiveDefaultPathId) || outputPaths[0];

  return compactObject({
    schema: BRANCHED_VIDEO_STATUS_SCHEMA,
    status: aggregateStatus,
    is_complete: allPathsComplete,
    finalized: sessionData?.branchRenderCompletionFinalized === true,
    completed_at: sessionData?.branchRenderCompletedAt || null,
    render_plan_version: normalizeNumber(sessionData?.renderPlanVersion),
    default_path_id: effectiveDefaultPathId,
    summary: {
      total_paths: paths.length,
      completed_paths: completedPaths.length,
      pending_paths: Math.max(
        0,
        paths.length - completedPaths.length - failedPaths.length - cancelledPaths.length,
      ),
      failed_paths: failedPaths.length,
      cancelled_paths: cancelledPaths.length,
      frame_paths_completed: frameCompletedPaths.length,
      video_paths_completed: videoCompletedPaths.length,
      progress_percent: progressPercent,
    },
    tree: {
      root_node_id: normalizeNonEmptyString(
        branchingTimeline.rootNodeId || branchingMeta.rootNodeId,
      ),
      num_levels: normalizeNumber(branchingMeta.numLevels),
      branching_factor: normalizeNumber(branchingMeta.branchingFactor),
      node_count: normalizeNumber(branchingMeta.nodeCount),
      leaf_node_ids: normalizeStringList(branchingMeta.leafNodeIds).length
        ? normalizeStringList(branchingMeta.leafNodeIds)
        : paths.map((path) => path.leaf_node_id).filter(Boolean),
      branch_scene_indices: (Array.isArray(branchingMeta.branchSceneIndices)
        ? branchingMeta.branchSceneIndices
        : []).map(normalizeNumber).filter((value) => value !== null),
      choice_points: choicePoints,
    },
    paths,
    outputs: {
      ready: outputsReady,
      default_path_id: effectiveDefaultPathId,
      ...(outputsReady
        ? {
          default_url: defaultOutput?.url || null,
          paths: outputPaths,
        }
        : {}),
    },
  });
}

function normalizePublicStatusFieldName(value) {
  return normalizeString(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function isBranchedStatusBillingField(fieldName) {
  const normalized = normalizePublicStatusFieldName(fieldName);
  return /(^|_)billing($|_)/.test(normalized) ||
    /(^|_)credits?($|_)/.test(normalized) ||
    /(^|_)(cost|price|pricing|payment|transaction)($|_)/.test(normalized) ||
    ['usage', 'metering', 'token_usage'].includes(normalized);
}

function stripBranchedStatusBilling(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stripBranchedStatusBilling(entry));
  }
  if (!value || typeof value !== 'object' || value instanceof Date) {
    return value;
  }

  return Object.entries(value).reduce((result, [key, entryValue]) => {
    if (!isBranchedStatusBillingField(key)) {
      result[key] = stripBranchedStatusBilling(entryValue);
    }
    return result;
  }, {});
}

function isBranchedStatusPayload(payload = {}) {
  return normalizeNonEmptyString(
    payload?.narrative_type || payload?.narrativeType || payload?.session?.narrativeType,
  )?.toLowerCase() === 'branched' || Boolean(payload?.branching || payload?.session?.branching);
}

function buildCompletedBranchChoicePoint(choicePoint = {}) {
  const options = (Array.isArray(choicePoint?.options) ? choicePoint.options : [])
    .map((option) => compactObject({
      child_node_id: normalizeNonEmptyString(option?.child_node_id),
      path_name: normalizeNonEmptyString(option?.path_name),
      path_description: normalizeNonEmptyString(option?.path_description),
      leaf_path_ids: normalizeStringList(option?.leaf_path_ids),
    }));

  return compactObject({
    branch_point_id: normalizeNonEmptyString(choicePoint?.branch_point_id),
    parent_node_id: normalizeNonEmptyString(choicePoint?.parent_node_id),
    switch_at_seconds: normalizeNumber(choicePoint?.switch_at_seconds),
    options,
  });
}

function buildCompletedBranchOutputPath(path = {}) {
  const pathId = normalizeNonEmptyString(path?.path_id);
  const url = normalizeNonEmptyString(path?.url || path?.result_url);
  if (!pathId || !url) {
    return null;
  }

  return compactObject({
    path_id: pathId,
    url,
    thumbnail_url: normalizeNonEmptyString(path?.thumbnail_url),
    duration: normalizeNumber(path?.duration),
    is_default: path?.is_default === true,
  });
}

/**
 * Final branched renders use a compact manifest: one path-aware video list and
 * media-relative choice timing. Generation diagnostics remain available while
 * work is pending or failed, but are not repeated after completion.
 */
export function buildCompletedBranchingManifest(branching = {}) {
  const outputPaths = (Array.isArray(branching?.outputs?.paths)
    ? branching.outputs.paths
    : Array.isArray(branching?.paths)
      ? branching.paths
      : [])
    .map((path) => buildCompletedBranchOutputPath(path))
    .filter(Boolean);
  if (!outputPaths.length) {
    return null;
  }

  const defaultPathId = normalizeNonEmptyString(branching?.default_path_id) ||
    outputPaths.find((path) => path.is_default)?.path_id ||
    outputPaths[0].path_id;
  outputPaths.forEach((path) => {
    path.is_default = path.path_id === defaultPathId;
  });
  const defaultOutput = outputPaths.find((path) => path.is_default) || outputPaths[0];
  const choicePoints = (Array.isArray(branching?.tree?.choice_points)
    ? branching.tree.choice_points
    : [])
    .map((choicePoint) => buildCompletedBranchChoicePoint(choicePoint));

  return compactObject({
    schema: normalizeNonEmptyString(branching?.schema) || BRANCHED_VIDEO_STATUS_SCHEMA,
    status: 'COMPLETED',
    completed_at: branching?.completed_at || null,
    default_path_id: defaultPathId,
    timing: {
      origin: 'media',
      unit: 'seconds',
    },
    tree: {
      root_node_id: normalizeNonEmptyString(branching?.tree?.root_node_id),
      choice_points: choicePoints,
    },
    outputs: {
      ready: true,
      default_path_id: defaultPathId,
      default_url: defaultOutput?.url,
      paths: outputPaths,
    },
  });
}

function buildCompletedInteractiveSession(session = {}, payload = {}, branching = {}) {
  const resultUrl = normalizeNonEmptyString(
    payload?.result_url || branching?.outputs?.default_url || session?.result?.url,
  );

  return compactObject({
    id: toObjectIdString(session?.id || session?._id || payload?.session_id),
    requestId: toObjectIdString(session?.requestId || payload?.request_id),
    type: 'video',
    routeType: normalizeNonEmptyString(session?.routeType),
    aspectRatio: normalizeNonEmptyString(session?.aspectRatio),
    framesPerSecond: normalizeNumber(session?.framesPerSecond),
    duration: normalizeNumber(session?.duration),
    language: normalizeNonEmptyString(session?.language || payload?.result_language),
    hasSubtitles: session?.hasSubtitles ?? payload?.has_subtitles,
    hasFooter: session?.hasFooter ?? payload?.has_footer,
    narrativeType: 'branched',
    defaultBranchPathId: normalizeNonEmptyString(branching?.default_path_id),
    result: {
      url: resultUrl,
      hasSubtitles: session?.result?.hasSubtitles ?? session?.hasSubtitles ?? payload?.has_subtitles,
      hasFooter: session?.result?.hasFooter ?? session?.hasFooter ?? payload?.has_footer,
      language: normalizeNonEmptyString(
        session?.result?.language || session?.language || payload?.result_language,
      ),
    },
  });
}

/**
 * Converts internal status data to its public HTTP representation. Singular
 * sessions are returned untouched to preserve the existing linear contract.
 */
export function serializePublicVideoStatusResponse(payload = {}) {
  if (!isBranchedStatusPayload(payload)) {
    return payload;
  }

  const sanitizedPayload = stripBranchedStatusBilling(payload);
  const sourceBranching = sanitizedPayload.branching || sanitizedPayload.session?.branching;
  const completed = BRANCH_COMPLETED_STATUSES.has(
    normalizeNonEmptyString(sanitizedPayload.status)?.toUpperCase(),
  ) && sourceBranching?.outputs?.ready === true;
  if (!completed) {
    return sanitizedPayload;
  }

  const branching = buildCompletedBranchingManifest(sourceBranching);
  if (!branching) {
    return sanitizedPayload;
  }

  const resultUrl = normalizeNonEmptyString(
    sanitizedPayload.result_url || branching.outputs?.default_url,
  );
  return compactObject({
    session_id: toObjectIdString(sanitizedPayload.session_id),
    request_id: toObjectIdString(sanitizedPayload.request_id),
    external_request_id: normalizeNonEmptyString(sanitizedPayload.external_request_id),
    external_session_id: normalizeNonEmptyString(sanitizedPayload.external_session_id),
    status: 'COMPLETED',
    type: normalizeNonEmptyString(sanitizedPayload.type) || 'video',
    provider: normalizeNonEmptyString(sanitizedPayload.provider),
    narrative_type: 'branched',
    source_narrative_request_id: toObjectIdString(sanitizedPayload.source_narrative_request_id),
    render_plan_version: normalizeNumber(sanitizedPayload.render_plan_version),
    default_path_id: branching.default_path_id,
    result_url: resultUrl,
    has_subtitles: sanitizedPayload.has_subtitles,
    has_footer: sanitizedPayload.has_footer,
    result_language: normalizeNonEmptyString(sanitizedPayload.result_language),
    branching,
    ...(sanitizedPayload.session
      ? {
        status_detail_schema: COMPLETED_INTERACTIVE_VIDEO_DETAIL_SCHEMA,
        session: buildCompletedInteractiveSession(
          sanitizedPayload.session,
          sanitizedPayload,
          branching,
        ),
      }
      : {}),
  });
}

/** Builds public usage headers without placing billing details in branched JSON. */
export function buildVideoStatusUsageHeaders(payload = {}, {
  creditsCharged,
  remainingCredits,
} = {}) {
  if (!isBranchedStatusPayload(payload)) {
    return {};
  }

  const stageCharges = payload?.expressGenerationCreditCharges ||
    payload?.express_generation_credit_charges;
  const resolvedCreditsCharged = normalizeNumber(creditsCharged) ??
    normalizeNumber(payload?.creditsCharged ?? payload?.credits_charged) ??
    normalizeNumber(stageCharges?.totalCharged);
  const resolvedRemainingCredits = normalizeNumber(remainingCredits);

  return {
    ...(resolvedCreditsCharged === null
      ? {}
      : { 'x-credits-charged': String(resolvedCreditsCharged) }),
    ...(resolvedRemainingCredits === null
      ? {}
      : { 'x-credits-remaining': String(resolvedRemainingCredits) }),
  };
}

function buildLegacyBranchResultsFromPaths(paths = []) {
  return (Array.isArray(paths) ? paths : []).map((path) => {
    return compactObject({
      path_id: path.path_id,
      leaf_node_id: path.leaf_node_id,
      ordinal: path.ordinal,
      status: path.status,
      result_url: path.result_url,
      video_link: path.video_link,
      remote_url: path.remote_url,
      thumbnail_url: path.thumbnail_url,
      duration: path.duration,
      selection_trail: path.selection_trail,
      error: path.error,
    });
  });
}

export function buildBranchVideoResults(sessionData = {}, req = null) {
  const branching = buildNormalizedBranchingStatus(sessionData, req);
  return branching ? buildLegacyBranchResultsFromPaths(branching.paths) : [];
}

function getDefaultBranchVideoResult(sessionData = {}, branchResults = []) {
  const defaultPathId = normalizeNonEmptyString(sessionData?.defaultBranchPathId);
  return branchResults.find((result) => result.path_id === defaultPathId) || branchResults[0] || null;
}

export function reconcileDetailedBranchStatus(baseStatus = {}, sessionData = {}, branching = null) {
  const normalizedStatus = { ...baseStatus };
  if (!branching) {
    return normalizedStatus;
  }

  normalizedStatus.branching = branching;
  normalizedStatus.branch_results = buildLegacyBranchResultsFromPaths(branching.paths);
  normalizedStatus.default_path_id = branching.default_path_id;
  if (branching.outputs?.ready && branching.status === 'COMPLETED') {
    normalizedStatus.status = 'COMPLETED';
    normalizedStatus.result_url = branching.outputs.default_url;
    normalizedStatus.result_urls = branching.outputs.paths.map((path) => path.url);
    normalizedStatus.has_subtitles = resolveVideoHasSubtitles(sessionData);
    normalizedStatus.has_footer = resolveVideoHasFooter(sessionData);
    normalizedStatus.result_language = resolveVideoResultLanguage(sessionData);
    delete normalizedStatus.generationError;
    delete normalizedStatus.expressGenerationError;
    delete normalizedStatus.error;
    delete normalizedStatus.message;
    return normalizedStatus;
  }

  delete normalizedStatus.result_url;
  delete normalizedStatus.result_urls;
  delete normalizedStatus.videoLink;
  delete normalizedStatus.remoteURL;
  if (['FAILED', 'CANCELLED', 'PAUSED'].includes(branching.status)) {
    normalizedStatus.status = branching.status;
  } else if (BRANCH_COMPLETED_STATUSES.has(normalizedStatus.status)) {
    normalizedStatus.status = 'PENDING';
  }
  return normalizedStatus;
}

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function shouldReturnDockerLocalAssetReferences() {
  const configuredMode = String(process.env.SAMSAR_MEDIA_DELIVERY_MODE || process.env.MEDIA_DELIVERY_MODE || '')
    .trim()
    .toLowerCase();
  if (configuredMode === 'docker-local' || configuredMode === 'local-filesystem') {
    return true;
  }
  if (configuredMode === 's3-cloudfront' || configuredMode === 'external-s3') {
    return false;
  }
  const externalBucket = normalizeString(
    process.env.MEDIA_BUCKET_NAME ||
    process.env.STATIC_CDN_BUCKET ||
    process.env.SAMSAR_EXTERNAL_MEDIA_BUCKET,
  );
  const externalBaseUrl = normalizeString(
    process.env.STATIC_CDN_URL || process.env.SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL,
  );
  if (externalBucket && /^https:\/\//i.test(externalBaseUrl)) {
    return false;
  }
  const externalMediaPublishEnabled = isTruthyEnv(
    process.env.SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED || process.env.EXTERNAL_MEDIA_PUBLISH_ENABLED,
  );
  return isContainerRuntime() && !externalMediaPublishEnabled;
}

function normalizeDockerLocalSecureAssetReference(value) {
  if (!shouldReturnDockerLocalAssetReferences()) {
    return null;
  }

  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  let relativePath = normalized.replace(/^\/+/, '');
  if (/^https?:\/\//i.test(normalized)) {
    try {
      relativePath = decodeURIComponent(new URL(normalized).pathname).replace(/^\/+/, '');
    } catch {
      return null;
    }
  }

  if (relativePath.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return `${resolveDockerLocalPublicAssetBaseUrl()}/${relativePath}`;
  }

  if (relativePath.startsWith(USER_RESOURCES_PREFIX)) {
    return `${resolveDockerLocalPublicAssetBaseUrl()}/${SECURE_ASSET_PREFIX}/${relativePath}`;
  }

  return null;
}

function resolveRequestAssetBaseUrl(req) {
  const configuredBase =
    normalizeString(process.env.API_SERVER) ||
    normalizeString(process.env.PUBLIC_API_BASE_URL) ||
    normalizeString(process.env.PUBLIC_BASE_URL);
  if (configuredBase) {
    return configuredBase.replace(/\/+$/, '');
  }

  const host = req?.get?.('host');
  if (!host) {
    return null;
  }

  return `${req.protocol || 'https'}://${host}`;
}

function normalizeStandaloneRequestAssetReference(value, req = null) {
  if (!req || !isStandaloneEdition() || !isContainerRuntime()) {
    return null;
  }

  const normalized = normalizeNonEmptyString(value);
  if (
    !normalized ||
    /^https?:\/\//i.test(normalized) ||
    /^data:/i.test(normalized) ||
    /^blob:/i.test(normalized) ||
    normalized.startsWith('//')
  ) {
    return null;
  }

  const relativePath = normalized.replace(/^\/+/, '');
  if (!relativePath.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return null;
  }

  const requestBaseUrl = resolveRequestAssetBaseUrl(req);
  return requestBaseUrl ? `${requestBaseUrl}/${relativePath}` : null;
}

function resolveStaticAssetBaseUrl() {
  return (
    normalizeString(process.env.STATIC_CDN_URL) ||
    normalizeString(process.env.PUBLIC_STATIC_CDN_URL) ||
    DEFAULT_STATIC_ASSET_BASE_URL
  ).replace(/\/+$/, '');
}

function normalizeUserResourcesAssetUrl(value) {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  const staticBaseUrl = resolveStaticAssetBaseUrl();
  const relativePath = normalized.replace(/^\/+/, '');
  if (relativePath.startsWith(USER_RESOURCES_PREFIX)) {
    return buildSecureMediaDeliveryUrl(`${SECURE_ASSET_PREFIX}/${relativePath}`) ||
      `${staticBaseUrl}/${relativePath}`;
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      const pathname = parsedUrl.pathname.replace(/^\/+/, '');
      if (pathname.startsWith(USER_RESOURCES_PREFIX)) {
        return buildSecureMediaDeliveryUrl(`${SECURE_ASSET_PREFIX}/${pathname}`) ||
          `${staticBaseUrl}/${pathname}${parsedUrl.search || ''}`;
      }
    } catch {
      return null;
    }
  }

  return null;
}

function normalizeSecureMediaAssetUrl(value) {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      if (pathname.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
        return buildSecureMediaDeliveryUrl(pathname);
      }
    } catch {
      return null;
    }
    return null;
  }

  const relativePath = normalized.replace(/^\/+/, '');
  if (relativePath.startsWith(`${SECURE_ASSET_PREFIX}/`)) {
    return buildSecureMediaDeliveryUrl(relativePath);
  }

  return null;
}

export function normalizeResponseAssetUrl(value, req = null) {
  const normalized = normalizeNonEmptyString(value);
  if (!normalized) {
    return null;
  }

  const standaloneRequestAssetUrl = normalizeStandaloneRequestAssetReference(normalized, req);
  if (standaloneRequestAssetUrl) {
    return standaloneRequestAssetUrl;
  }

  const dockerLocalSecureAssetUrl = normalizeDockerLocalSecureAssetReference(normalized);
  if (dockerLocalSecureAssetUrl) {
    return dockerLocalSecureAssetUrl;
  }

  const secureMediaUrl = normalizeSecureMediaAssetUrl(normalized);
  if (secureMediaUrl) {
    return secureMediaUrl;
  }

  const userResourcesUrl = normalizeUserResourcesAssetUrl(normalized);
  if (userResourcesUrl) {
    return userResourcesUrl;
  }

  if (
    /^https?:\/\//i.test(normalized) ||
    /^data:/i.test(normalized) ||
    /^blob:/i.test(normalized)
  ) {
    return normalized;
  }

  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  const responsePath = normalizeRawImageAssetReference(normalized) || normalized;
  const baseUrl = resolveRequestAssetBaseUrl(req);
  if (!baseUrl) {
    return responsePath;
  }

  return `${baseUrl}/${responsePath.replace(/^\/+/, '')}`;
}

export function normalizeResponseAssetUrlList(values, req = null) {
  return normalizeStringList(values)
    .map((value) => normalizeResponseAssetUrl(value, req))
    .filter(Boolean);
}

function normalizeStringList(values) {
  return Array.isArray(values)
    ? values.map((value) => normalizeString(value)).filter(Boolean)
    : [];
}

function pickFirstString(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function normalizeResponseMediaCandidates(values) {
  const candidates = Array.isArray(values) ? values : [values];
  return [...new Set(candidates.map((value) => normalizeString(value)).filter(Boolean))];
}

export function selectResponseMediaSources({ local = [], remote = [] } = {}) {
  const localCandidates = Array.isArray(local) ? local : [local];
  const remoteCandidates = Array.isArray(remote) ? remote : [remote];
  const preferred = shouldReturnDockerLocalAssetReferences()
    ? normalizeResponseMediaCandidates(localCandidates)
    : normalizeResponseMediaCandidates(remoteCandidates);
  if (preferred.length > 0) {
    return preferred;
  }
  return shouldReturnDockerLocalAssetReferences()
    ? normalizeResponseMediaCandidates(remoteCandidates)
    : normalizeResponseMediaCandidates(localCandidates);
}

export function selectResponseMediaSource(candidates = {}) {
  return selectResponseMediaSources(candidates)[0] || null;
}

function normalizeNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

function toObjectIdString(value) {
  return value?.toString?.() || value || null;
}

function compactObject(payload = {}) {
  return Object.entries(payload).reduce((result, [key, value]) => {
    if (value === undefined || value === null) {
      return result;
    }
    if (Array.isArray(value) && value.length === 0) {
      return result;
    }
    if (value instanceof Date) {
      result[key] = value;
      return result;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = compactObject(value);
      if (Object.keys(nested).length === 0) {
        return result;
      }
      result[key] = nested;
      return result;
    }
    result[key] = value;
    return result;
  }, {});
}

function resolveVideoHasSubtitles(sessionData = {}) {
  if (typeof sessionData.hasSubtitles === 'boolean') {
    return sessionData.hasSubtitles;
  }
  if (typeof sessionData.has_subtitles === 'boolean') {
    return sessionData.has_subtitles;
  }
  if (typeof sessionData.enableSubtitles === 'boolean') {
    return sessionData.enableSubtitles;
  }
  return true;
}

function normalizeResultLanguage(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'auto') {
    return null;
  }

  return trimmed.toLowerCase();
}

function resolveVideoResultLanguage(sessionData = {}) {
  return (
    normalizeResultLanguage(sessionData.sessionLanguage) ||
    normalizeResultLanguage(sessionData.language) ||
    normalizeResultLanguage(sessionData.language_code) ||
    normalizeResultLanguage(sessionData.langauge) ||
    'en'
  );
}

function hasFooterMetadata(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasFooterMetadata(entry));
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  return Boolean(
    value.url ||
    value.cta_url ||
    value.ctaUrl ||
    value.title ||
    value.cta_text ||
    value.ctaText ||
    value.text ||
    value.cta_logo ||
    value.ctaLogo ||
    value.logoUrl ||
    value.logoImagePath ||
    value.footerLogoImagePath
  );
}

export function resolveVideoHasFooter(sessionData = {}) {
  if (!sessionData || typeof sessionData !== 'object') {
    return false;
  }

  if (
    sessionData.addFooterAnimation === true &&
    (
      hasFooterMetadata(sessionData.footerMetadata) ||
      Boolean(
        sessionData.footerLogoImagePath ||
        sessionData.footerCtaText ||
        sessionData.footerCtaUrl ||
        sessionData.footerCtaLogo
      )
    )
  ) {
    return true;
  }

  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  return layers.some((layer) => (
    layer?.addFooterAnimation === true &&
    (
      hasFooterMetadata(layer.footerMetadata) ||
      Boolean(layer.footerLogoImagePath || layer.footer_logo_image_path)
    )
  ));
}

async function loadVideoStatusSnapshot(sessionId) {
  if (!sessionId) {
    return null;
  }

  const sessionData = await VideoSession.findById(sessionId)
    .select(VIDEO_STATUS_SESSION_PROJECTION)
    .lean();

  if (!sessionData) {
    return null;
  }

  const provider =
    sessionData.expressGenerativeVideoModel ||
    sessionData.expressGenerativeVideoModelSubType ||
    sessionData.videoGenerationModelSubType ||
    null;

  return {
    ...sessionData,
    provider,
  };
}

async function loadVideoDetailedStatusSnapshot(sessionId) {
  if (!sessionId) {
    return null;
  }

  const sessionData = await VideoSession.findById(sessionId)
    .select(VIDEO_STATUS_DETAILED_SESSION_PROJECTION)
    .lean();

  if (!sessionData) {
    return null;
  }

  const provider =
    sessionData.expressGenerativeVideoModel ||
    sessionData.expressGenerativeVideoModelSubType ||
    sessionData.videoGenerationModelSubType ||
    null;

  return {
    ...sessionData,
    provider,
  };
}

async function loadGeneratedImageCandidates(sessionId) {
  if (!sessionId) {
    return [];
  }

  try {
    return await GeneratedImage.find({ sessionId: sessionId.toString() })
      .select('url description prompt createdAt')
      .sort({ createdAt: 1 })
      .lean();
  } catch {
    return [];
  }
}

function getItemAssetUrl(item = {}) {
  return pickFirstString(
    item.src,
    item.image,
    item.url,
    item.selectedImageUrl,
    item.selected_image_url,
    item.generatedImage?.url,
    item.generatedImage?.src,
    item.generated_image?.url,
    item.generated_image?.src,
    item.remoteURL,
    item.remoteUrl,
    item.remote_url,
  );
}

function normalizeRawImageAssetReference(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return null;
  }
  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsedUrl = new URL(normalized);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      if (pathname.startsWith(`${SECURE_ASSET_PREFIX}/`) || pathname.startsWith(USER_RESOURCES_PREFIX)) {
        return pathname;
      }
    } catch {}
  }
  if (
    !/^https?:\/\//i.test(normalized) &&
    !normalized.startsWith('/') &&
    !normalized.includes('/') &&
    /\.(png|jpe?g|webp|gif)$/i.test(normalized)
  ) {
    return `/generations/${normalized}`;
  }
  return normalized;
}

function getImageAssetKey(value) {
  const normalized = normalizeRawImageAssetReference(value);
  if (!normalized) {
    return null;
  }
  try {
    const parsed = new URL(normalized);
    return decodeURIComponent(parsed.pathname).split('/').filter(Boolean).pop() || normalized;
  } catch {
    return decodeURIComponent(normalized.split('?')[0]).split('/').filter(Boolean).pop() || normalized;
  }
}

function getItemPrompt(item = {}, fallbackPrompt = null) {
  return pickFirstString(
    item.prompt,
    item.generationPrompt,
    item.sourcePrompt,
    item.imagePrompt,
    item.secondaryPrompt,
    fallbackPrompt,
  );
}

function normalizePromptForCandidateMatch(value) {
  return normalizeString(value).replace(/\s+/g, ' ');
}

function getLayerCandidatePromptKeys(layer = {}) {
  return [
    layer.prompt,
    layer.imageSession?.prompt,
  ]
    .map((value) => normalizePromptForCandidateMatch(value))
    .filter(Boolean);
}

function buildGeneratedImageCandidatesByLayer(sessionData = {}, generatedImages = []) {
  const layers = Array.isArray(sessionData.layers) ? sessionData.layers : [];
  const promptToLayerIndexes = new Map();

  layers.forEach((layer, index) => {
    getLayerCandidatePromptKeys(layer).forEach((promptKey) => {
      const existing = promptToLayerIndexes.get(promptKey) || [];
      existing.push(index);
      promptToLayerIndexes.set(promptKey, existing);
    });
  });

  const candidatesByLayer = new Map();
  generatedImages.forEach((candidate) => {
    const promptKey = normalizePromptForCandidateMatch(candidate?.prompt);
    const layerIndexes = promptToLayerIndexes.get(promptKey) || [];
    layerIndexes.forEach((layerIndex) => {
      const existing = candidatesByLayer.get(layerIndex) || [];
      existing.push(candidate);
      candidatesByLayer.set(layerIndex, existing);
    });
  });

  return candidatesByLayer;
}

function serializeDetailedImageItem(item = {}, index = 0, {
  req = null,
  fallbackPrompt = null,
  selectedImageUrl = null,
} = {}) {
  const rawUrl = getItemAssetUrl(item);
  const normalizedRawUrl = normalizeRawImageAssetReference(rawUrl);
  const url = normalizeResponseAssetUrl(normalizedRawUrl || rawUrl, req);
  const normalizedSelectedUrl = normalizeResponseAssetUrl(
    normalizeRawImageAssetReference(selectedImageUrl) || selectedImageUrl,
    req,
  );
  const isPrimary = item?.is_base_image === true || (
    Boolean(url) &&
    Boolean(normalizedSelectedUrl) &&
    url === normalizedSelectedUrl
  );

  return compactObject({
    id: normalizeNonEmptyString(item.id) || toObjectIdString(item._id) || `item_${index}`,
    itemId: normalizeNonEmptyString(item.id) || toObjectIdString(item._id) || `item_${index}`,
    index,
    type: normalizeNonEmptyString(item.type) || 'image',
    role: isPrimary ? 'primary' : 'secondary',
    isPrimary,
    is_base_image: item?.is_base_image === true,
    url,
    rawUrl: normalizedRawUrl,
    src: normalizeRawImageAssetReference(item.src || rawUrl),
    image: normalizeRawImageAssetReference(item.image || rawUrl),
    remoteURL: normalizeNonEmptyString(item.remoteURL || item.remoteUrl || item.remote_url),
    prompt: getItemPrompt(item, fallbackPrompt),
    description: normalizeNonEmptyString(item.description),
    x: normalizeNumber(item.x),
    y: normalizeNumber(item.y),
    width: normalizeNumber(item.width),
    height: normalizeNumber(item.height),
    config: item.config && typeof item.config === 'object' ? item.config : null,
    animations: Array.isArray(item.animations) ? item.animations : null,
    createdAt: item.createdAt || item.created_at || null,
  });
}

function serializeSecondaryImageCandidate(candidate = {}, index = 0, {
  req = null,
  fallbackPrompt = null,
  source = 'generated_image',
} = {}) {
  const rawUrl = normalizeRawImageAssetReference(
    candidate.url ||
    candidate.src ||
    candidate.image ||
    candidate.imageUrl ||
    candidate.image_url,
  );
  const url = normalizeResponseAssetUrl(rawUrl, req);
  if (!url && !rawUrl) {
    return null;
  }

  return compactObject({
    id: normalizeNonEmptyString(candidate.id) || `${source}_${index}`,
    itemId: normalizeNonEmptyString(candidate.id) || `${source}_${index}`,
    index,
    type: 'image',
    role: 'secondary',
    isPrimary: false,
    is_base_image: false,
    source,
    url,
    rawUrl,
    src: rawUrl,
    image: rawUrl,
    prompt: getItemPrompt(candidate, fallbackPrompt),
    description: normalizeNonEmptyString(candidate.description),
    score: normalizeNumber(candidate.score),
    createdAt: candidate.createdAt || candidate.created_at || null,
  });
}

function buildDetailedImageItems(
  layer = {},
  req = null,
  selectedImageUrl = null,
  generatedImageCandidates = [],
) {
  const activeItems = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const fallbackPrompt = pickFirstString(layer?.imageSession?.prompt, layer.prompt);
  const selectedUrl = selectedImageUrl || getLayerSelectedImageUrl(layer);
  let serializedItems = activeItems
    .filter((item) => normalizeString(item?.type).toLowerCase() === 'image' || getItemAssetUrl(item))
    .map((item, index) => serializeDetailedImageItem(item, index, {
      req,
      fallbackPrompt,
      selectedImageUrl: selectedUrl,
    }))
    .filter((item) => item.url || item.rawUrl || item.src || item.image);

  const normalizedSelectedUrl = normalizeResponseAssetUrl(selectedUrl, req);
  const rawSelectedUrl = normalizeRawImageAssetReference(selectedUrl);
  if (serializedItems.length === 0 && normalizedSelectedUrl) {
    serializedItems = [compactObject({
      id: 'item_0',
      itemId: 'item_0',
      index: 0,
      type: 'image',
      role: 'primary',
      isPrimary: true,
      is_base_image: true,
      url: normalizedSelectedUrl,
      rawUrl: rawSelectedUrl,
      src: rawSelectedUrl,
      image: rawSelectedUrl,
      prompt: fallbackPrompt,
    })];
  }

  const seenAssetKeys = new Set(
    serializedItems
      .map((item) => getImageAssetKey(item.rawUrl || item.src || item.image || item.url))
      .filter(Boolean),
  );
  const secondaryCandidates = [];
  const pushCandidate = (candidate, source) => {
    const rawUrl = candidate?.url || candidate?.src || candidate?.image || candidate?.imageUrl || candidate?.image_url;
    const assetKey = getImageAssetKey(rawUrl);
    if (!assetKey || seenAssetKeys.has(assetKey)) {
      return;
    }
    const serialized = serializeSecondaryImageCandidate(candidate, serializedItems.length + secondaryCandidates.length, {
      req,
      fallbackPrompt,
      source,
    });
    if (!serialized) {
      return;
    }
    seenAssetKeys.add(assetKey);
    secondaryCandidates.push(serialized);
  };

  const filterPasses = Array.isArray(layer?.filterPasses) ? layer.filterPasses : [];
  filterPasses.forEach((pass, index) => pushCandidate({
    id: `filter_pass_${index}`,
    src: pass.src,
    url: pass.src,
    description: pass.description,
    score: pass.score,
    prompt: pass.prompt,
  }, 'filter_pass'));
  generatedImageCandidates.forEach((candidate, index) => pushCandidate({
    id: `generated_${index}`,
    url: candidate.url,
    description: candidate.description,
    prompt: candidate.prompt,
    createdAt: candidate.createdAt,
  }, 'generated_image'));

  serializedItems = [...serializedItems, ...secondaryCandidates];
  if (serializedItems.length === 0) {
    return [];
  }

  const hasPrimary = serializedItems.some((item) => item.isPrimary);
  if (!hasPrimary) {
    serializedItems[0] = {
      ...serializedItems[0],
      role: 'primary',
      isPrimary: true,
      is_base_image: true,
    };
  }

  return serializedItems;
}

function getLayerSelectedImageUrl(layer = {}) {
  const activeItems = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const baseImageItem = activeItems.find((item) => item?.is_base_image === true) ||
    activeItems.find((item) => normalizeString(item?.type).toLowerCase() === 'image') ||
    activeItems[0] ||
    null;

  const activeItemUrl = getItemAssetUrl(baseImageItem || {});
  if (activeItemUrl) {
    return activeItemUrl;
  }
  return selectResponseMediaSource({
    local: [
      layer?.imageSession?.activeGeneratedImage,
      layer?.imageSession?.activeEditedImage,
      layer?.imageSession?.activeSelectedImage,
    ],
    remote: layer?.imageSession?.activeImageRemoteLink,
  });
}

function buildAssetStatus(rawStatus, fallbackUrl = null) {
  const normalized = normalizeString(rawStatus).toUpperCase();
  if (normalized) {
    return normalized;
  }
  return fallbackUrl ? 'COMPLETED' : 'INIT';
}

function buildVideoAsset({
  status,
  error,
  url,
  hasAsset,
  req,
}) {
  const normalizedUrl = normalizeResponseAssetUrl(url, req);
  if (!normalizedUrl && !hasAsset && !normalizeString(status)) {
    return null;
  }

  return {
    status: buildAssetStatus(status, normalizedUrl),
    url: normalizedUrl,
    error: isTerminalGenerationFailureStatus(status)
      ? normalizeNonEmptyString(error)
      : null,
  };
}

function buildImageAssetReference(value, req = null) {
  const rawUrl = normalizeRawImageAssetReference(value)?.replace(/^\/+/, '');
  const url = normalizeResponseAssetUrl(rawUrl || value, req);
  if (!url && !rawUrl) {
    return null;
  }
  return compactObject({
    url,
    rawUrl,
  });
}

function isImageListToVideoDetailedPreview(sessionData = {}) {
  const routeType = normalizeString(
    sessionData.expressStepGeneration?.routeType ||
    sessionData.expressStepGeneration?.route_type,
  ).toLowerCase();
  return sessionData.isStepVideoGeneration === true &&
    (routeType === 'image_to_video' || routeType === 'image_list_to_video');
}

function buildLayerPreview({
  image,
  aiVideo,
  lipSyncVideo,
  soundEffectVideo,
  userVideo,
}) {
  if (lipSyncVideo?.url) {
    return { stage: 'lip_sync_generation', type: 'video', url: lipSyncVideo.url };
  }
  if (soundEffectVideo?.url) {
    return { stage: 'sound_effect_generation', type: 'video', url: soundEffectVideo.url };
  }
  if (aiVideo?.url) {
    return { stage: 'ai_video_generation', type: 'video', url: aiVideo.url };
  }
  if (userVideo?.url) {
    return { stage: 'user_video', type: 'video', url: userVideo.url };
  }
  if (image?.url) {
    return { stage: 'image_generation', type: 'image', url: image.url };
  }
  return null;
}

function buildLayerFrameImages(layer = {}, req = null) {
  const startFrame = pickFirstString(
    layer.aiLayerStartFrame,
    layer.aiVideoThumbnailPath,
    layer.thumbnailPath,
    layer.baseLayerStartFrame,
    layer.imageSession?.videoRenderStartFrameImage,
  );
  const endFrame = pickFirstString(
    layer.aiLayerEndFrame,
    layer.baseLayerEndFrame,
    layer.imageSession?.videoRenderEndFrameImage,
  );

  return compactObject({
    startFrame,
    startFrameUrl: normalizeResponseAssetUrl(startFrame, req),
    endFrame,
    endFrameUrl: normalizeResponseAssetUrl(endFrame, req),
    aiLayerStartFrame: normalizeNonEmptyString(layer.aiLayerStartFrame),
    baseLayerStartFrame: normalizeNonEmptyString(layer.baseLayerStartFrame),
    thumbnailPath: normalizeNonEmptyString(layer.thumbnailPath),
    aiVideoThumbnailPath: normalizeNonEmptyString(layer.aiVideoThumbnailPath),
    lipSyncThumbnailPath: normalizeNonEmptyString(layer.lipSyncThumbnailPath),
    soundEffectThumbnailPath: normalizeNonEmptyString(layer.soundEffectThumbnailPath),
    userVideoThumbnailPath: normalizeNonEmptyString(layer.userVideoThumbnailPath),
  });
}

function serializeDetailedLayer(
  layer = {},
  index = 0,
  req = null,
  generatedImageCandidates = [],
  options = {},
) {
  const startTime = normalizeNumber(layer.durationOffset) ?? 0;
  const duration = normalizeNumber(layer.duration);
  const endTime = duration === null ? null : startTime + duration;
  const selectedImageUrl = getLayerSelectedImageUrl(layer);
  const imageUrl = normalizeResponseAssetUrl(selectedImageUrl, req);
  const imageItems = buildDetailedImageItems(layer, req, selectedImageUrl, generatedImageCandidates);
  const frameImages = buildLayerFrameImages(layer, req);
  const editedImage = options.includeEditedImage
    ? buildImageAssetReference(layer?.imageSession?.activeEditedImage, req)
    : null;
  const image = compactObject({
    status: buildAssetStatus(layer?.imageSession?.generationStatus, imageUrl),
    error: isTerminalGenerationFailureStatus(layer?.imageSession?.generationStatus)
      ? normalizeNonEmptyString(layer?.imageSession?.generationError)
      : null,
    editStatus: normalizeNonEmptyString(layer?.imageSession?.editStatus),
    editError: isTerminalGenerationFailureStatus(layer?.imageSession?.editStatus)
      ? normalizeNonEmptyString(layer?.imageSession?.editError)
      : null,
    url: imageUrl,
    editedImage: editedImage?.url,
    editedImageRawUrl: editedImage?.rawUrl,
    prompt: normalizeNonEmptyString(layer?.imageSession?.prompt || layer?.prompt),
    description: normalizeNonEmptyString(
      layer?.imageSession?.activeImageDescription || layer?.activeImageDescription,
    ),
    items: imageItems,
  });
  const aiVideo = buildVideoAsset({
    status: layer.aiVideoGenerationStatus,
    error: layer.aiVideoGenerationError,
    url: selectResponseMediaSource({
      local: layer.aiVideoLayer,
      remote: layer.aiVideoRemoteLink,
    }),
    hasAsset: layer.hasAiVideoLayer === true,
    req,
  });
  const lipSyncVideo = buildVideoAsset({
    status: layer.lipSyncVideoGenerationStatus,
    error: layer.lipSyncVideoGenerationError,
    url: selectResponseMediaSource({
      local: layer.lipSyncVideoLayer,
      remote: layer.lipSyncRemoteLink,
    }),
    hasAsset: layer.hasLipSyncVideoLayer === true,
    req,
  });
  const soundEffectVideo = buildVideoAsset({
    status: layer.soundEffectVideoGenerationStatus,
    error: layer.soundEffectVideoGenerationError,
    url: selectResponseMediaSource({
      local: layer.soundEffectVideoLayer,
      remote: layer.soundEffectRemoteLink,
    }),
    hasAsset: layer.hasSoundEffectVideoLayer === true,
    req,
  });
  const userVideo = buildVideoAsset({
    status: layer.userVideoGenerationStatus,
    error: layer.userVideoGenerationError,
    url: selectResponseMediaSource({
      local: layer.userVideoLayer,
      remote: layer.userVideoRemoteLink,
    }),
    hasAsset: layer.hasUserVideoLayer === true,
    req,
  });
  const preview = buildLayerPreview({
    image,
    aiVideo,
    lipSyncVideo,
    soundEffectVideo,
    userVideo,
  });
  const shouldExposeBaseAiVideo = !(
    lipSyncVideo?.url ||
    soundEffectVideo?.url ||
    userVideo?.url
  );

  return compactObject({
    index,
    id: toObjectIdString(layer._id),
    startTime,
    endTime,
    duration,
    status: normalizeNonEmptyString(layer.status),
    prompt: normalizeNonEmptyString(layer.prompt),
    videoPrompt: normalizeNonEmptyString(layer.videoGenerationPrompt),
    aiVideoType: normalizeNonEmptyString(layer.layerAiVideoType),
    baseImageType: normalizeNonEmptyString(layer.layerBaseAiImageType),
    soundEffectPrompt: normalizeNonEmptyString(layer.layerAISoundEffectPrompt),
    aiLayerStartFrame: normalizeNonEmptyString(layer.aiLayerStartFrame),
    baseLayerStartFrame: normalizeNonEmptyString(layer.baseLayerStartFrame),
    thumbnailPath: normalizeNonEmptyString(layer.thumbnailPath),
    aiVideoThumbnailPath: normalizeNonEmptyString(layer.aiVideoThumbnailPath),
    frameImages,
    image,
    editedImage,
    aiVideo: shouldExposeBaseAiVideo ? aiVideo : undefined,
    lipSyncVideo,
    soundEffectVideo,
    userVideo,
    preview,
  });
}

function getAudioLayerUrl(layer = {}) {
  return selectResponseMediaSource({
    local: [
      layer.selectedLocalAudioLink,
      ...normalizeStringList(layer.localAudioLinks),
    ],
    remote: [
      layer.selectedRemoteAudioLink,
      ...normalizeStringList(layer.remoteAudioLinks),
    ],
  });
}

function serializeDetailedAudioLayer(layer = {}, index = 0, req = null) {
  const startTime = normalizeNumber(layer.startTime) ?? 0;
  const duration = normalizeNumber(layer.duration);
  const endTime = normalizeNumber(layer.endTime) ?? (
    duration === null ? null : startTime + duration
  );
  const url = normalizeResponseAssetUrl(getAudioLayerUrl(layer), req);
  const transcriptAlignment = layer.transcriptAlignment &&
    typeof layer.transcriptAlignment === 'object' &&
    !Array.isArray(layer.transcriptAlignment)
    ? layer.transcriptAlignment
    : null;

  return compactObject({
    index,
    id: toObjectIdString(layer._id),
    type: normalizeNonEmptyString(layer.generationType) || 'audio',
    status: buildAssetStatus(layer.generationStatus, url),
    startTime,
    endTime,
    duration,
    sourceTrimStartTime: normalizeNumber(layer.sourceTrimStartTime),
    prompt: normalizeNonEmptyString(layer.prompt),
    subtitleText: normalizeNonEmptyString(layer.subtitleText),
    subtitleLanguage: normalizeNonEmptyString(layer.subtitleLanguage),
    speechLanguage: normalizeNonEmptyString(layer.speechLanguage),
    subtitleTranslationRequired: normalizeBoolean(layer.subtitleTranslationRequired),
    subtitleAlignmentMap: Array.isArray(layer.subtitleAlignmentMap)
      ? layer.subtitleAlignmentMap
      : undefined,
    subtitleSpeakerCharacterName: normalizeNonEmptyString(layer.subtitleSpeakerCharacterName),
    url,
    remoteAudioLinks: normalizeResponseAssetUrlList(selectResponseMediaSources({
      local: [
        layer.selectedLocalAudioLink,
        ...normalizeStringList(layer.localAudioLinks),
      ],
      remote: [
        layer.selectedRemoteAudioLink,
        ...normalizeStringList(layer.remoteAudioLinks),
      ],
    }), req),
    volume: normalizeNumber(layer.volume),
    isEnabled: normalizeBoolean(layer.isEnabled),
    defaultSelected: normalizeBoolean(layer.defaultSelected),
    speaker: normalizeNonEmptyString(layer.speaker),
    provider: normalizeNonEmptyString(layer.provider),
    languageCode: normalizeNonEmptyString(layer.languageCode),
    languageCodes: Array.isArray(layer.languageCodes) ? layer.languageCodes : undefined,
    speakerVoiceId: normalizeNonEmptyString(layer.speakerVoiceId),
    speakerLabel: normalizeNonEmptyString(layer.speakerLabel),
    speakerDetails: layer.speakerDetails && typeof layer.speakerDetails === 'object'
      ? layer.speakerDetails
      : undefined,
    speakerCharacterName: normalizeNonEmptyString(layer.speakerCharacterName),
    lyrics: normalizeNonEmptyString(layer.lyrics),
    connectedLayerId: normalizeNonEmptyString(layer.connectedLayerId),
    connectedLayerIndex: normalizeNumber(layer.connectedLayerIndex),
    audioBindingMode: normalizeNonEmptyString(layer.audioBindingMode),
    bindToLayer: normalizeBoolean(layer.bindToLayer),
    addSubtitles: normalizeBoolean(layer.addSubtitles),
    addTranscriptionsRequired: normalizeBoolean(layer.addTranscriptionsRequired),
    subtitleFont: normalizeNonEmptyString(layer.subtitleFont),
    subtitleWordAnimation: normalizeNonEmptyString(layer.subtitleWordAnimation),
    transcriptAlignment,
  });
}

function serializeDetailedGlobalVideo(globalVideo = {}, index = 0, req = null) {
  const url = normalizeResponseAssetUrl(
    selectResponseMediaSource({
      local: [globalVideo.assetPath, globalVideo.url],
      remote: globalVideo.remoteURL,
    }),
    req,
  );
  const startTime = normalizeNumber(globalVideo.startTime) ?? 0;
  const duration = normalizeNumber(globalVideo.duration);
  const endTime = normalizeNumber(globalVideo.endTime) ?? (
    duration === null ? null : startTime + duration
  );

  return compactObject({
    index,
    id: toObjectIdString(globalVideo._id),
    type: 'video',
    source: normalizeNonEmptyString(globalVideo.source),
    title: normalizeNonEmptyString(globalVideo.title),
    status: buildAssetStatus(globalVideo.framesGenerationStatus, url),
    startTime,
    endTime,
    duration,
    url,
    framesPerSecond: normalizeNumber(globalVideo.framesPerSecond),
  });
}

function normalizeStageStatusMap(rawStatus = {}) {
  if (!rawStatus || typeof rawStatus !== 'object' || Array.isArray(rawStatus)) {
    return {};
  }

  return Object.entries(rawStatus).reduce((result, [key, value]) => {
    if (typeof value === 'string') {
      result[key] = value.trim().toUpperCase();
    } else if (value !== undefined && value !== null) {
      result[key] = value;
    }
    return result;
  }, {});
}

function isCompletedStageStatus(value) {
  const normalized = normalizeString(value).toUpperCase();
  return normalized === 'COMPLETED' ||
    normalized === 'SUCCESS' ||
    normalized === 'SUCCEEDED' ||
    normalized === 'DONE';
}

function resolveCurrentStage(stageStatusMap = {}) {
  for (const stage of EXPRESS_STATUS_STAGE_ORDER) {
    const status = stageStatusMap[stage];
    if (!status || !isCompletedStageStatus(status)) {
      return stage;
    }
  }
  return 'video_generation';
}

function resolveCompletedStages(stageStatusMap = {}) {
  return EXPRESS_STATUS_STAGE_ORDER.filter((stage) => isCompletedStageStatus(stageStatusMap[stage]));
}

function resolvePreviewStage({
  stageStatusMap,
  layers,
  audioLayers,
  globalAudioLayers,
  globalVideos,
  resultUrl,
}) {
  const hasLayerImage = layers.some((layer) => Boolean(layer.image?.url));
  const hasAiVideo = layers.some((layer) => Boolean(layer.aiVideo?.url || layer.userVideo?.url));
  const hasLipSyncVideo = layers.some((layer) => Boolean(layer.lipSyncVideo?.url));
  const hasSoundEffectVideo = layers.some((layer) => Boolean(layer.soundEffectVideo?.url));
  const hasSpeech = audioLayers.some((layer) => layer.type === 'speech' && Boolean(layer.url));
  const hasMusic = [...audioLayers, ...globalAudioLayers].some((layer) => layer.type !== 'speech' && Boolean(layer.url));
  const hasGlobalVideo = globalVideos.some((video) => Boolean(video.url));
  const availability = {
    video_generation: Boolean(resultUrl),
    sound_effect_generation: hasSoundEffectVideo,
    lip_sync_generation: hasLipSyncVideo,
    ai_video_generation: hasAiVideo || hasGlobalVideo,
    audio_generation: hasSpeech || hasMusic,
    music_generation: hasMusic,
    speech_generation: hasSpeech,
    image_generation: hasLayerImage,
    prompt_generation: true,
  };

  for (let index = PREVIEW_STAGE_ORDER.length - 1; index >= 0; index -= 1) {
    const stage = PREVIEW_STAGE_ORDER[index];
    if (availability[stage]) {
      return stage;
    }
  }

  return hasLayerImage ? 'image_generation' : 'prompt_generation';
}

function resolveSessionDuration(sessionData = {}, layers = [], audioLayers = [], globalAudioLayers = [], globalVideos = []) {
  const explicitDuration = normalizeNumber(sessionData.totalDuration);
  if (explicitDuration !== null && explicitDuration > 0) {
    return explicitDuration;
  }

  const endTimes = [
    ...layers.map((layer) => normalizeNumber(layer.endTime)),
    ...audioLayers.map((layer) => normalizeNumber(layer.endTime)),
    ...globalAudioLayers.map((layer) => normalizeNumber(layer.endTime)),
    ...globalVideos.map((video) => normalizeNumber(video.endTime)),
  ].filter((value) => value !== null);

  return endTimes.length ? Math.max(...endTimes) : 0;
}

export function buildNormalizedVideoSessionPreview(
  sessionData = {},
  statusPayload = {},
  req = null,
  { generatedImageCandidates = [], branching: suppliedBranching = null } = {},
) {
  const generatedImageCandidatesByLayer = buildGeneratedImageCandidatesByLayer(
    sessionData,
    generatedImageCandidates,
  );
  const includeEditedImage = isImageListToVideoDetailedPreview(sessionData);
  const layers = (Array.isArray(sessionData.layers) ? sessionData.layers : [])
    .map((layer, index) => serializeDetailedLayer(
      layer,
      index,
      req,
      generatedImageCandidatesByLayer.get(index) || [],
      { includeEditedImage },
    ));
  const audioLayers = (Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [])
    .map((layer, index) => serializeDetailedAudioLayer(layer, index, req));
  const globalAudioLayers = (Array.isArray(sessionData.global_audio_layers) ? sessionData.global_audio_layers : [])
    .map((layer, index) => serializeDetailedAudioLayer(layer, index, req));
  const globalVideos = (Array.isArray(sessionData.global_videos) ? sessionData.global_videos : [])
    .map((video, index) => serializeDetailedGlobalVideo(video, index, req));
  const stageStatusMap = normalizeStageStatusMap(sessionData.expressGenerationStatus);
  const resultUrl = normalizeResponseAssetUrl(statusPayload.result_url, req);
  const preferredSessionResultUrl = normalizeResponseAssetUrl(selectResponseMediaSource({
    local: sessionData.videoLink,
    remote: sessionData.remoteURL,
  }), req);
  const currentStage = resolveCurrentStage(stageStatusMap);
  const branching = suppliedBranching || buildNormalizedBranchingStatus(
    sessionData,
    req,
    { detailed: true },
  );
  const branchResults = branching
    ? buildLegacyBranchResultsFromPaths(branching.paths)
    : [];
  const previewStage = resolvePreviewStage({
    stageStatusMap,
    layers,
    audioLayers,
    globalAudioLayers,
    globalVideos,
    resultUrl,
  });
  const terminalSessionStatus = ['FAILED', 'CANCELLED', 'CANCELED']
    .includes(normalizeString(statusPayload.status).toUpperCase());
  const generationFailure = terminalSessionStatus
    ? resolveVideoGenerationFailure(sessionData)
    : null;
  const generationError = terminalSessionStatus
    ? normalizeNonEmptyString(
      statusPayload.generationError ||
      statusPayload.expressGenerationError ||
      generationFailure?.message,
    )
    : null;

  return compactObject({
    id: toObjectIdString(sessionData._id),
    requestId: toObjectIdString(statusPayload.request_id || sessionData._id),
    type: 'video',
    routeType: sessionData.isStepVideoGeneration ? 'step' : 'express',
    aspectRatio: normalizeNonEmptyString(sessionData.aspectRatio),
    framesPerSecond: normalizeNumber(sessionData.framesPerSecond),
    duration: resolveSessionDuration(sessionData, layers, audioLayers, globalAudioLayers, globalVideos),
    language:
      normalizeNonEmptyString(sessionData.sessionLanguage) ||
      normalizeNonEmptyString(sessionData.language) ||
      normalizeNonEmptyString(sessionData.language_code) ||
      normalizeNonEmptyString(sessionData.langauge),
    languageString: normalizeNonEmptyString(sessionData.languageString),
    subtitleLanguage: normalizeNonEmptyString(sessionData.subtitleLanguage),
    subtitleLanguageString: normalizeNonEmptyString(sessionData.subtitleLanguageString),
    subtitleLanguageExplicit: normalizeBoolean(sessionData.subtitleLanguageExplicit),
    subtitleTranslationRequired: normalizeBoolean(sessionData.subtitleTranslationRequired),
    hasSubtitles: resolveVideoHasSubtitles(sessionData),
    hasFooter: resolveVideoHasFooter(sessionData),
    inputPrompt: normalizeNonEmptyString(sessionData.inputPrompt || sessionData.expressInputPrompt),
    inferenceModel: normalizeNonEmptyString(
      sessionData.expressGenerationInferenceModel || sessionData.inferenceModel,
    ),
    expressGenerationInferenceModel: normalizeNonEmptyString(
      sessionData.expressGenerationInferenceModel || sessionData.inferenceModel,
    ),
    generationType: normalizeNonEmptyString(sessionData.expressGenerationType),
    provider: normalizeNonEmptyString(statusPayload.provider || sessionData.provider),
    expressGenerationFailed: normalizeBoolean(sessionData.expressGenerationFailed),
    expressGenerationCancelled: normalizeBoolean(sessionData.expressGenerationCancelled),
    generationError,
    expressGenerationError: generationError,
    error: generationError,
    narrativeType:
      normalizeNonEmptyString(sessionData.narrativeType) ||
      normalizeNonEmptyString(sessionData.sourceNarrativeType) ||
      'singular',
    sourceNarrativeRequestId: toObjectIdString(sessionData.sourceNarrativeRequestId),
    renderPlanVersion: normalizeNumber(sessionData.renderPlanVersion),
    defaultBranchPathId: normalizeNonEmptyString(sessionData.defaultBranchPathId),
    branchingMeta: sessionData.branchingMeta || null,
    branchResults,
    branching,
    currentStage,
    previewStage,
    completedStages: resolveCompletedStages(stageStatusMap),
    stages: stageStatusMap,
    layers,
    audioLayers,
    globalAudioLayers,
    globalVideos,
    result: {
      url: resultUrl || preferredSessionResultUrl,
      remoteURL: preferredSessionResultUrl,
      videoLink: normalizeResponseAssetUrl(sessionData.videoLink, req),
      hasSubtitles: resolveVideoHasSubtitles(sessionData),
      hasFooter: resolveVideoHasFooter(sessionData),
      language: resolveVideoResultLanguage(sessionData),
    },
    createdAt: sessionData.createdAt || null,
    updatedAt: sessionData.updatedAt || null,
  });
}

export async function buildVideoStatusResponse({
  sessionId,
  requestId,
  provider,
  req,
  defaultResultUrl,
  defaultResultUrls,
}) {
  if (!sessionId) {
    return null;
  }

  try {
    const sessionSnapshot = await loadVideoStatusSnapshot(sessionId);
    if (!sessionSnapshot) {
      return null;
    }

    const stageVideoStatusRaw =
      typeof sessionSnapshot?.expressGenerationStatus?.video_generation === 'string'
        ? sessionSnapshot.expressGenerationStatus.video_generation.trim().toUpperCase()
        : '';
    const stageVideoFailed =
      stageVideoStatusRaw.includes('FAIL') ||
      stageVideoStatusRaw.includes('ERROR') ||
      stageVideoStatusRaw.includes('TIMEOUT');
    const stageVideoCanceled = stageVideoStatusRaw.includes('CANCEL');
    const generationFailure = resolveVideoGenerationFailure(sessionSnapshot);
    const hasExplicitGenerationFailureState =
      typeof sessionSnapshot?.expressGenerationFailed === 'boolean';
    const hasExplicitGenerationCancellationState =
      typeof sessionSnapshot?.expressGenerationCancelled === 'boolean';
    const expressGenerationFailed = sessionSnapshot?.expressGenerationFailed === true;
    const expressGenerationCancelled = sessionSnapshot?.expressGenerationCancelled === true;
    const expressGenerationPaused = Boolean(sessionSnapshot?.expressGenerationPaused);
    const statusRaw = typeof sessionSnapshot?.expressGenerationStatus?.status === 'string'
      ? sessionSnapshot.expressGenerationStatus.status.trim().toUpperCase()
      : '';
    const statusRawFailed = isTerminalGenerationFailureStatus(statusRaw);
    const statusRawCanceled = statusRaw.includes('CANCEL');
    const canUseStatusRaw = Boolean(statusRaw) && (
      (!statusRawFailed && !statusRawCanceled) ||
      (statusRawFailed && !hasExplicitGenerationFailureState) ||
      (statusRawCanceled && !hasExplicitGenerationCancellationState)
    );
    const normalizedDefaultUrls = Array.isArray(defaultResultUrls)
      ? defaultResultUrls.filter(Boolean)
      : [];
    const completionStatusSet = BRANCH_COMPLETED_STATUSES;
    const branching = buildNormalizedBranchingStatus(sessionSnapshot, req);
    const branchedSession = isBranchedVideoSession(sessionSnapshot);
    const branchResults = branching
      ? buildLegacyBranchResultsFromPaths(branching.paths)
      : [];
    const defaultBranchResult = getDefaultBranchVideoResult(sessionSnapshot, branchResults);
    const branchResultUrls = branching?.outputs?.ready
      ? branching.outputs.paths.map((result) => result.url).filter(Boolean)
      : [];
    const allBranchResultsCompleted = branching?.is_complete === true;
    const stageVideoCompleted = completionStatusSet.has(stageVideoStatusRaw);
    const host = req?.get?.('host');
    const normalizedVideoLink = sessionSnapshot?.videoLink
      ? sessionSnapshot.videoLink.startsWith('http')
        ? sessionSnapshot.videoLink
        : host
          ? `${req.protocol}://${host}/${sessionSnapshot.videoLink.replace(/^\//, '')}`
          : sessionSnapshot.videoLink
      : null;
    const completionUrl = normalizeResponseAssetUrl(defaultBranchResult?.result_url
      || selectResponseMediaSource({
        local: normalizedVideoLink,
        remote: [sessionSnapshot?.remoteURL, defaultResultUrl, normalizedDefaultUrls[0]],
      }), req);
    const isInteractiveDraft =
      sessionSnapshot?.builderStatus === 'DRAFT' &&
      sessionSnapshot?.builderSessionSubType === 'interactive_video_draft' &&
      !sessionSnapshot?.expressGenerationPending &&
      !sessionSnapshot?.videoGenerationPending;
    let normalizedStatus = isInteractiveDraft
      ? 'INIT'
      : completionUrl ? 'COMPLETED' : 'PENDING';
    if (!isInteractiveDraft && (
      expressGenerationCancelled ||
      (!hasExplicitGenerationCancellationState && stageVideoCanceled)
    )) {
      normalizedStatus = 'CANCELLED';
    } else if (!isInteractiveDraft && (
      expressGenerationFailed ||
      (!hasExplicitGenerationFailureState && stageVideoFailed)
    )) {
      normalizedStatus = 'FAILED';
    } else if (!isInteractiveDraft && expressGenerationPaused) {
      normalizedStatus = 'PAUSED';
    } else if (!isInteractiveDraft && completionUrl && stageVideoCompleted) {
      normalizedStatus = 'COMPLETED';
    } else if (!isInteractiveDraft && canUseStatusRaw) {
      normalizedStatus = statusRaw;
    } else if (!isInteractiveDraft && (
      sessionSnapshot.expressGenerationPending ||
      sessionSnapshot.videoGenerationPending ||
      stageVideoStatusRaw === 'PENDING' ||
      stageVideoStatusRaw === 'INIT' ||
      stageVideoStatusRaw === 'IN_PROGRESS'
    )) {
      normalizedStatus = 'PENDING';
    } else if (!isInteractiveDraft && completionUrl) {
      normalizedStatus = 'COMPLETED';
    }
    if (branching?.status === 'FAILED') {
      normalizedStatus = 'FAILED';
    } else if (branching?.status === 'CANCELLED') {
      normalizedStatus = 'CANCELLED';
    } else if (branching?.status === 'PAUSED') {
      normalizedStatus = 'PAUSED';
    }
    const shouldReportCompleted = completionStatusSet.has(normalizedStatus)
      && Boolean(completionUrl)
      && (!branchedSession || allBranchResultsCompleted);

    const expressGenerationCreditCharges = sessionSnapshot?.expressGenerationCreditCharges || {
      totalCharged: 0,
      stages: {},
    };
    const totalCreditsCharged = Number(expressGenerationCreditCharges?.totalCharged) || 0;

    const payload = {
      session_id: sessionId.toString(),
      request_id: (requestId || sessionId).toString(),
      status: shouldReportCompleted
        ? 'COMPLETED'
        : completionStatusSet.has(normalizedStatus)
          ? 'PENDING'
          : normalizedStatus,
      type: 'video',
      provider: provider || sessionSnapshot?.provider || null,
      narrative_type: branchedSession ? 'branched' : 'singular',
      source_narrative_request_id: toObjectIdString(sessionSnapshot?.sourceNarrativeRequestId),
      render_plan_version: normalizeNumber(sessionSnapshot?.renderPlanVersion),
      default_path_id:
        branching?.default_path_id || normalizeNonEmptyString(sessionSnapshot?.defaultBranchPathId),
      ...(branchResults.length > 0 ? { branch_results: branchResults } : {}),
      ...(branching ? { branching } : {}),
      expressGenerationStatus: sessionSnapshot?.expressGenerationStatus,
      ...(hasExplicitGenerationFailureState ? { expressGenerationFailed } : {}),
      ...(hasExplicitGenerationCancellationState ? { expressGenerationCancelled } : {}),
      expressGenerationPaused,
      expressGenerationCreditCharges,
      express_generation_credit_charges: expressGenerationCreditCharges,
      creditsCharged: totalCreditsCharged,
      credits_charged: totalCreditsCharged,
    };

    const generationError = normalizeNonEmptyString(
      generationFailure?.message ||
      sessionSnapshot?.generationError ||
      sessionSnapshot?.expressGenerationError,
    );
    if (generationError && ['FAILED', 'CANCELLED'].includes(payload.status)) {
      payload.generationError = generationError;
      payload.expressGenerationError = generationError;
      payload.error = generationError;
      payload.message = generationError;
    }

    if (sessionSnapshot?.videoLink && (!branchedSession || shouldReportCompleted)) {
      payload.videoLink = normalizeResponseAssetUrl(sessionSnapshot.videoLink, req);
    }

    if (sessionSnapshot?.remoteURL && (!branchedSession || shouldReportCompleted)) {
      payload.remoteURL = normalizeResponseAssetUrl(selectResponseMediaSource({
        local: sessionSnapshot.videoLink,
        remote: sessionSnapshot.remoteURL,
      }), req);
    }

    if (shouldReportCompleted) {
      payload.result_url = completionUrl;
      payload.result_urls = branchResultUrls.length
        ? branchResultUrls
        : normalizeResponseAssetUrlList(selectResponseMediaSources({
          local: [completionUrl],
          remote: normalizedDefaultUrls,
        }), req);
      payload.has_subtitles = resolveVideoHasSubtitles(sessionSnapshot);
      payload.has_footer = resolveVideoHasFooter(sessionSnapshot);
      payload.result_language = resolveVideoResultLanguage(sessionSnapshot);
    }

    return payload;
  } catch (error) {
    return null;
  }
}

export async function buildVideoStatusDetailedResponse({
  sessionId,
  requestId,
  provider,
  req,
  defaultResultUrl,
  defaultResultUrls,
}) {
  const baseStatus = await buildVideoStatusResponse({
    sessionId,
    requestId,
    provider,
    req,
    defaultResultUrl,
    defaultResultUrls,
  });

  if (!baseStatus) {
    return null;
  }

  const sessionSnapshot = await loadVideoDetailedStatusSnapshot(sessionId);
  if (!sessionSnapshot) {
    return null;
  }
  const generatedImageCandidates = await loadGeneratedImageCandidates(sessionId);
  const branching = buildNormalizedBranchingStatus(sessionSnapshot, req, { detailed: true });
  const normalizedBaseStatus = reconcileDetailedBranchStatus(
    baseStatus,
    sessionSnapshot,
    branching,
  );
  const session = buildNormalizedVideoSessionPreview(sessionSnapshot, normalizedBaseStatus, req, {
    generatedImageCandidates,
    branching,
  });

  return {
    ...normalizedBaseStatus,
    status_detail_schema: 'video_session_preview.v1',
    session: branching ? { ...session, branching } : session,
  };
}
