const getIdentifierString = (value) => {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }

  if (typeof value === 'object' && typeof value.$oid === 'string') {
    return value.$oid;
  }

  const stringValue = value?.toString?.();
  return stringValue && stringValue !== '[object Object]' ? stringValue : '';
};

const getRecordIdentifier = (record = {}) => (
  record.id ?? record._id
);

const getParentSessionIdentifier = (record = {}) => (
  record.sessionId ??
  record.session_id ??
  record.videoSessionId ??
  record.video_session_id ??
  record.parentSessionId ??
  record.parent_session_id
);

export const getSessionIdentifier = (record = {}) => (
  getIdentifierString(getRecordIdentifier(record))
);

const hasSessionMetadata = (record = {}) => [
  'name',
  'layerCount',
  'layers',
  'sessionType',
  'sessionName',
  'thumbnail',
  'thumbnailUrl',
  'thumbnailURL',
  'previewImageUrl',
  'previewImageURL',
  'videoLink',
  'remoteURL',
  'publishedVideoURL',
  'isExpressGeneration',
  'sessionOwnerId',
  'isSessionOwner',
  'isImportedSession',
].some((field) => record[field] !== undefined);

const getLayerCount = (record = {}) => {
  if (Array.isArray(record.layers)) {
    return record.layers.length;
  }

  const layerCount = Number(record.layerCount);
  return Number.isInteger(layerCount) ? layerCount : 0;
};

const isExplicitVideoSessionRecord = (record = {}) => (
  record.recordType === 'session' && record.sessionType === 'video'
);

const hasDisplayableProjectLayers = (record = {}) => {
  const layerCount = getLayerCount(record);
  if (layerCount > 1) {
    return true;
  }

  return layerCount > 0 && Boolean(
    record.isExpressGeneration ||
    record.isStepVideoGeneration ||
    record.expressGenerationCreated ||
    record.expressGenerationPending ||
    record.expressGenerationFailed ||
    record.expressGenerationCancelled
  );
};

export const isLayerListRecord = (record = {}) => (
  Boolean(
    !isExplicitVideoSessionRecord(record) && (
      record.recordType === 'scene' ||
    record.recordType === 'layer' ||
    getParentSessionIdentifier(record) ||
    record.layerId ||
    record.layer_id ||
    record.sceneId ||
    record.scene_id ||
    record.imageSession ||
    record.layer ||
    record.scene ||
    record.durationOffset !== undefined ||
    record.duration !== undefined ||
    record.prompt !== undefined ||
    record.status !== undefined ||
    record.frames !== undefined ||
    record.layerAiVideoType ||
    record.layerBaseAiImageType ||
    record.connectedLayerId
    )
  )
);

export const isSessionListRecord = (record = {}) => (
  Boolean(
    record &&
    typeof record === 'object' &&
    getIdentifierString(getRecordIdentifier(record)) &&
    isExplicitVideoSessionRecord(record) &&
    !isLayerListRecord(record) &&
    hasDisplayableProjectLayers(record) &&
    hasSessionMetadata(record)
  )
);

export const normalizeSessionListData = (records) => {
  if (!Array.isArray(records)) {
    return [];
  }

  const sessionsById = new Map();

  records.forEach((record) => {
    if (!record || typeof record !== 'object') {
      return;
    }

    // A scene/layer row is never promoted into a project tile. Explicitly
    // tagged video sessions remain projects even when status/progress fields
    // overlap with fields also used by layer records.
    if (!isSessionListRecord(record)) {
      return;
    }

    const sessionIdentifier = getSessionIdentifier(record);
    if (!sessionIdentifier) {
      return;
    }

    if (sessionsById.has(sessionIdentifier)) {
      return;
    }

    sessionsById.set(sessionIdentifier, record);
  });

  return Array.from(sessionsById.values());
};
