const PENDING_STATUSES = new Set(['PENDING', 'IN_PROGRESS', 'RUNNING', 'PROCESSING', 'INIT']);
const FAILED_STATUSES = new Set(['FAILED', 'ERROR', 'CANCELLED', 'CANCELED', 'TIMEOUT']);

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function firstText(values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function normalizeStatus(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function getRecordId(record = {}, fallback = '') {
  return record?._id?.toString?.() || record?._id || record?.id?.toString?.() || record?.id || fallback;
}

function normalizeDetailedImageItem(item = {}, index = 0) {
  const source = firstText([
    item.url,
    item.previewUrl,
    item.signedUrl,
    item.src,
    item.image,
    item.rawUrl,
  ]);

  return {
    ...item,
    id: item.id || item.itemId || `status_image_${index}`,
    type: item.type || 'image',
    src: source,
    image: source,
    url: source,
    is_base_image: item.is_base_image === true || item.isPrimary === true || item.role === 'primary',
    animations: Array.isArray(item.animations) ? item.animations : [],
  };
}

function normalizeDetailedLayer(layer = {}, index = 0) {
  const layerId = getRecordId(layer, `status_layer_${index}`);
  const image = isPlainObject(layer.image) ? layer.image : {};
  const imageUrl = firstText([
    image.url,
    layer.preview?.type === 'image' ? layer.preview?.url : '',
    layer.frameImages?.startFrameUrl,
    layer.aiLayerStartFrame,
    layer.baseLayerStartFrame,
  ]);
  let activeItemList = Array.isArray(layer.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : Array.isArray(image.items)
      ? image.items.map(normalizeDetailedImageItem).filter((item) => item.src)
      : [];

  if (activeItemList.length === 0 && imageUrl) {
    activeItemList = [normalizeDetailedImageItem({
      id: `status_base_image_${layerId}`,
      url: imageUrl,
      isPrimary: true,
      is_base_image: true,
      x: 0,
      y: 0,
    })];
  }

  const aiVideo = isPlainObject(layer.aiVideo) ? layer.aiVideo : {};
  const lipSyncVideo = isPlainObject(layer.lipSyncVideo) ? layer.lipSyncVideo : {};
  const soundEffectVideo = isPlainObject(layer.soundEffectVideo) ? layer.soundEffectVideo : {};
  const userVideo = isPlainObject(layer.userVideo) ? layer.userVideo : {};
  const aiVideoUrl = firstText([aiVideo.url, layer.aiVideoRemoteLink, layer.aiVideoLayer]);
  const lipSyncVideoUrl = firstText([lipSyncVideo.url, layer.lipSyncRemoteLink, layer.lipSyncVideoLayer]);
  const soundEffectVideoUrl = firstText([
    soundEffectVideo.url,
    layer.soundEffectRemoteLink,
    layer.soundEffectVideoLayer,
  ]);
  const userVideoUrl = firstText([userVideo.url, layer.userVideoRemoteLink, layer.userVideoLayer]);

  return {
    ...layer,
    _id: layerId,
    id: layerId,
    durationOffset: layer.durationOffset ?? layer.startTime ?? 0,
    imageSession: {
      ...(isPlainObject(layer.imageSession) ? layer.imageSession : {}),
      generationStatus: image.status || layer.imageSession?.generationStatus || 'INIT',
      prompt: image.prompt || layer.imageSession?.prompt || layer.prompt || '',
      activeImageDescription: image.description || layer.imageSession?.activeImageDescription || '',
      activeImageRemoteLink: imageUrl || layer.imageSession?.activeImageRemoteLink || '',
      activeGeneratedImage: imageUrl || layer.imageSession?.activeGeneratedImage || '',
      activeSelectedImage: imageUrl || layer.imageSession?.activeSelectedImage || '',
      activeItemList,
    },
    layerAiVideoType: layer.layerAiVideoType || layer.aiVideoType,
    hasAiVideoLayer: Boolean(aiVideoUrl),
    aiVideoLayer: aiVideoUrl || layer.aiVideoLayer,
    aiVideoRemoteLink: aiVideoUrl || layer.aiVideoRemoteLink,
    aiVideoGenerationStatus: aiVideo.status || layer.aiVideoGenerationStatus,
    aiVideoGenerationPending: PENDING_STATUSES.has(normalizeStatus(aiVideo.status)),
    hasLipSyncVideoLayer: Boolean(lipSyncVideoUrl),
    lipSyncVideoLayer: lipSyncVideoUrl || layer.lipSyncVideoLayer,
    lipSyncRemoteLink: lipSyncVideoUrl || layer.lipSyncRemoteLink,
    lipSyncVideoGenerationStatus: lipSyncVideo.status || layer.lipSyncVideoGenerationStatus,
    lipSyncGenerationPending: PENDING_STATUSES.has(normalizeStatus(lipSyncVideo.status)),
    hasSoundEffectVideoLayer: Boolean(soundEffectVideoUrl),
    soundEffectVideoLayer: soundEffectVideoUrl || layer.soundEffectVideoLayer,
    soundEffectRemoteLink: soundEffectVideoUrl || layer.soundEffectRemoteLink,
    soundEffectVideoGenerationStatus: soundEffectVideo.status || layer.soundEffectVideoGenerationStatus,
    soundEffectGenerationPending: PENDING_STATUSES.has(normalizeStatus(soundEffectVideo.status)),
    hasUserVideoLayer: Boolean(userVideoUrl),
    userVideoLayer: userVideoUrl || layer.userVideoLayer,
    userVideoRemoteLink: userVideoUrl || layer.userVideoRemoteLink,
    userVideoGenerationStatus: userVideo.status || layer.userVideoGenerationStatus,
    userVideoGenerationPending: PENDING_STATUSES.has(normalizeStatus(userVideo.status)),
  };
}

function normalizeDetailedAudioLayer(layer = {}, index = 0) {
  const layerId = getRecordId(layer, `status_audio_${index}`);
  const source = firstText([
    layer.url,
    layer.selectedRemoteAudioLink,
    layer.selectedLocalAudioLink,
  ]);

  return {
    ...layer,
    _id: layerId,
    id: layerId,
    generationType: layer.generationType || layer.type || 'audio',
    generationStatus: layer.generationStatus || layer.status,
    selectedRemoteAudioLink: source || layer.selectedRemoteAudioLink,
    remoteAudioLinks: source ? [source] : layer.remoteAudioLinks,
  };
}

function finiteNumber(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) {
    return null;
  }
  const normalized = typeof value === 'number' ? value : Number(value.trim());
  return Number.isFinite(normalized) ? normalized : null;
}

function getBranchPath(branching, pathId) {
  if (!isPlainObject(branching) || !Array.isArray(branching.paths)) {
    return null;
  }

  const normalizedPathId = firstText([pathId]);
  if (normalizedPathId) {
    return branching.paths.find((path) => firstText([path?.path_id]) === normalizedPathId) || null;
  }

  const defaultPathId = firstText([branching.default_path_id]);
  return branching.paths.find((path) => firstText([path?.path_id]) === defaultPathId) ||
    branching.paths.find((path) => path?.is_default === true) ||
    branching.paths[0] ||
    null;
}

function sortBySequenceIndex(items = []) {
  return [...items].sort((left, right) => (
    (finiteNumber(left?.sequence_index) ?? Number.MAX_SAFE_INTEGER) -
    (finiteNumber(right?.sequence_index) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function applyPathTiming(item = {}, timelineItem = {}, sequenceIndex = 0) {
  const startTime = finiteNumber(timelineItem.start_time) ??
    finiteNumber(item.startTime) ??
    finiteNumber(item.durationOffset) ??
    0;
  const suppliedEndTime = finiteNumber(timelineItem.end_time);
  const suppliedDuration = finiteNumber(timelineItem.duration);
  const duration = suppliedDuration ?? (
    suppliedEndTime === null ? finiteNumber(item.duration) : suppliedEndTime - startTime
  );
  const endTime = suppliedEndTime ?? (
    duration === null ? finiteNumber(item.endTime) : startTime + duration
  );

  return {
    ...item,
    index: sequenceIndex,
    startTime,
    durationOffset: startTime,
    ...(endTime === null ? {} : { endTime }),
    ...(duration === null ? {} : { duration }),
    branchSequenceIndex: sequenceIndex,
    branchSceneIndex: finiteNumber(timelineItem.scene_index),
  };
}

/**
 * Projects one normalized branch path from canonical detailed-status asset pools.
 * The returned layers/audio layers are clones with path-local timing; canonical
 * inputs and the branching manifest are never mutated.
 */
export function materializeBranchPathPreview({
  branching,
  canonicalLayers = [],
  canonicalAudioLayers = [],
  pathId,
} = {}) {
  const path = getBranchPath(branching, pathId);
  if (!path) {
    return null;
  }

  const canonicalLayerById = new Map(
    canonicalLayers
      .map((layer) => [firstText([getRecordId(layer)]), layer])
      .filter(([id]) => id)
  );
  const timeline = sortBySequenceIndex(Array.isArray(path.timeline) ? path.timeline : []);
  const layers = timeline.flatMap((timelineItem, index) => {
    const layerId = firstText([timelineItem?.layer_id]);
    const layer = canonicalLayerById.get(layerId);
    if (!layer) return [];
    return [{
      ...applyPathTiming(layer, timelineItem, index),
      branchPathId: path.path_id,
    }];
  });
  const projectedLayerIndexById = new Map(
    layers.map((layer, index) => [firstText([getRecordId(layer)]), index])
  );

  const canonicalAudioLayerById = new Map(
    canonicalAudioLayers
      .map((layer) => [firstText([getRecordId(layer)]), layer])
      .filter(([id]) => id)
  );
  const audioTimeline = sortBySequenceIndex(
    Array.isArray(path.audio_timeline) ? path.audio_timeline : []
  );
  const audioLayers = audioTimeline.flatMap((timelineItem, index) => {
    const audioLayerId = firstText([timelineItem?.audio_layer_id]);
    const audioLayer = canonicalAudioLayerById.get(audioLayerId);
    if (!audioLayer) return [];
    const connectedLayerId = firstText([
      timelineItem?.connected_layer_id,
      audioLayer.connectedLayerId,
    ]);
    const projectedConnectedLayerIndex = projectedLayerIndexById.get(connectedLayerId);

    return [{
      ...applyPathTiming(audioLayer, timelineItem, index),
      branchPathId: path.path_id,
      ...(connectedLayerId ? { connectedLayerId } : {}),
      ...(projectedConnectedLayerIndex === undefined
        ? finiteNumber(timelineItem?.connected_layer_index) === null
          ? {}
          : { connectedLayerIndex: finiteNumber(timelineItem.connected_layer_index) }
        : { connectedLayerIndex: projectedConnectedLayerIndex }),
      ...(finiteNumber(timelineItem?.connected_layer_start_time_offset) === null
        ? {}
        : {
          connectedLayerStartTimeOffset: finiteNumber(
            timelineItem.connected_layer_start_time_offset
          ),
        }),
    }];
  });

  return {
    path,
    pathId: path.path_id,
    layers,
    audioLayers,
    hasTimeline: timeline.length > 0,
    hasAudioTimeline: audioTimeline.length > 0,
  };
}

export async function fetchDetailedVideoGenerationStatus({
  axiosClient,
  apiServer,
  requestId,
  headers,
}) {
  if (!axiosClient || !apiServer || !requestId) {
    throw new Error('Video generation status request is missing required parameters.');
  }

  const normalizedApiServer = apiServer.replace(/\/+$/, '');
  try {
    const { data } = await axiosClient.get(
      `${normalizedApiServer}/v2/video/step/${encodeURIComponent(requestId)}/status_detailed`,
      headers
    );
    return data;
  } catch (error) {
    const statusCode = error?.response?.status;
    if (statusCode && statusCode !== 400 && statusCode !== 404) {
      throw error;
    }
  }

  const query = new URLSearchParams({ request_id: requestId }).toString();
  const { data } = await axiosClient.get(
    `${normalizedApiServer}/v2/status_detailed?${query}`,
    headers
  );
  return data;
}

export function buildStudioSessionDetailsFromStatus(data) {
  if (!isPlainObject(data)) {
    return null;
  }

  const sessionPreview = isPlainObject(data.session) ? data.session : {};
  const sessionId = firstText([
    getRecordId(sessionPreview),
    data.session_id,
    data.sessionId,
    data.request_id,
    data.requestId,
  ]);
  const canonicalLayers = Array.isArray(sessionPreview.layers)
    ? sessionPreview.layers.map(normalizeDetailedLayer)
    : Array.isArray(data.layers)
      ? data.layers.map(normalizeDetailedLayer)
      : [];
  const canonicalAudioLayers = Array.isArray(sessionPreview.audioLayers)
    ? sessionPreview.audioLayers.map(normalizeDetailedAudioLayer)
    : [];
  const branching = isPlainObject(sessionPreview.branching)
    ? sessionPreview.branching
    : isPlainObject(data.branching)
      ? data.branching
      : null;
  const materializedDefaultPath = branching
    ? materializeBranchPathPreview({
      branching,
      canonicalLayers,
      canonicalAudioLayers,
    })
    : null;
  const layers = materializedDefaultPath?.hasTimeline
    ? materializedDefaultPath.layers
    : canonicalLayers;
  const audioLayers = materializedDefaultPath?.hasAudioTimeline
    ? materializedDefaultPath.audioLayers
    : canonicalAudioLayers;
  const normalizedStatus = normalizeStatus(data.status || sessionPreview.status);
  const statusIsPending = PENDING_STATUSES.has(normalizedStatus);
  const statusIsFailed = FAILED_STATUSES.has(normalizedStatus);
  const expressGenerationStatus = data.expressGenerationStatus || sessionPreview.expressGenerationStatus || sessionPreview.stages;
  const hasStartedGeneration = Boolean(
    sessionPreview.isExpressGeneration ||
    data.isExpressGeneration ||
    expressGenerationStatus ||
    firstText([sessionPreview.inputPrompt, data.inputPrompt]) ||
    layers.length
  );

  if (!sessionId && layers.length === 0 && !expressGenerationStatus) {
    return null;
  }

  return {
    ...sessionPreview,
    _id: sessionId || sessionPreview._id,
    id: sessionId || sessionPreview.id,
    layers,
    audioLayers,
    ...(branching
      ? {
        branching,
        canonicalLayers,
        canonicalAudioLayers,
        defaultBranchPathId: materializedDefaultPath?.pathId || branching.default_path_id,
      }
      : {}),
    globalAudioLayers: Array.isArray(sessionPreview.globalAudioLayers)
      ? sessionPreview.globalAudioLayers.map(normalizeDetailedAudioLayer)
      : sessionPreview.globalAudioLayers,
    aspectRatio: sessionPreview.aspectRatio || data.aspectRatio || '16:9',
    isExpressGeneration: data.isExpressGeneration ?? sessionPreview.isExpressGeneration ?? hasStartedGeneration,
    expressGenerationStatus,
    expressGenerationPending:
      data.expressGenerationPending ??
      sessionPreview.expressGenerationPending ??
      (hasStartedGeneration && statusIsPending),
    videoGenerationPending:
      data.videoGenerationPending ??
      sessionPreview.videoGenerationPending ??
      (hasStartedGeneration && statusIsPending),
    expressGenerationPaused: data.expressGenerationPaused ?? sessionPreview.expressGenerationPaused ?? normalizedStatus === 'PAUSED',
    expressGenerationFailed: data.expressGenerationFailed ?? sessionPreview.expressGenerationFailed ?? statusIsFailed,
    expressGenerationCancelled:
      data.expressGenerationCancelled ??
      sessionPreview.expressGenerationCancelled ??
      ['CANCELLED', 'CANCELED'].includes(normalizedStatus),
    expressGenerationError:
      data.expressGenerationError ||
      data.message ||
      data.error ||
      sessionPreview.expressGenerationError,
    videoLink: firstText([
      sessionPreview.videoLink,
      sessionPreview.result?.videoLink,
      data.videoLink,
      data.result_url,
    ]) || null,
    remoteURL: firstText([
      sessionPreview.remoteURL,
      sessionPreview.result?.remoteURL,
      data.remoteURL,
    ]) || null,
  };
}
