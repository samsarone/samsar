function getRecordId(record) {
  return record?._id?.toString?.() || record?.id?.toString?.() || null;
}

const imageSourceFields = [
  'previewUrl', 'preview_url', 'signedUrl', 'signed_url', 'displayUrl', 'display_url',
  'url', 'imageUrl', 'image_url', 'src', 'image',
];

function hasRenderableImageItemUrl(item = {}) {
  return imageSourceFields.some(field => typeof item[field] === 'string' && item[field].trim());
}

export function hasHydratedStudioLayers(sessionDetails) {
  const layers = Array.isArray(sessionDetails?.layers) ? sessionDetails.layers : [];
  if (layers.length === 0) {
    return false;
  }

  return layers.every((layer) => {
    const activeItemList = layer?.imageSession?.activeItemList;
    if (!Array.isArray(activeItemList)) {
      return false;
    }

    return activeItemList.every((item) => (
      item?.type !== 'image' || hasRenderableImageItemUrl(item)
    ));
  });
}

function restoreMissingLayerMedia(incoming, previous) {
  const previousItems = previous?.imageSession?.activeItemList;
  if (!Array.isArray(previousItems)) return incoming;
  const items = incoming?.imageSession?.activeItemList;
  if (!Array.isArray(items)) {
    // An ID-only projection has no changes to apply.
    const hasLayerFields = Object.keys(incoming).some(key => !['_id', 'id', 'imageSession'].includes(key));
    if (!hasLayerFields && !Object.keys(incoming.imageSession || {}).length) return previous;
    return { ...incoming, imageSession: { ...incoming.imageSession, activeItemList: previousItems } };
  }

  // Respect the incoming item order, removals and explicitly cleared sources.
  // Only restore omitted URL fields from the same item in the same scene.
  let restoredItems = items;
  for (const [index, item] of items.entries()) {
    if (item?.type !== 'image' || imageSourceFields.some(field => Object.hasOwn(item, field))) continue;
    const itemId = getRecordId(item);
    const oldItem = itemId && previousItems.find(old => old?.type === 'image' && getRecordId(old) === itemId);
    if (!oldItem || !hasRenderableImageItemUrl(oldItem)) continue;
    const media = {};
    for (const field of imageSourceFields) {
      if (Object.hasOwn(oldItem, field)) media[field] = oldItem[field];
    }
    if (restoredItems === items) restoredItems = items.slice();
    restoredItems[index] = { ...item, ...media };
  }
  return restoredItems === items ? incoming
    : { ...incoming, imageSession: { ...incoming.imageSession, activeItemList: restoredItems } };
}

export function mergeStudioSessionRefresh(
  previousSessionDetails,
  incomingSessionDetails,
  { requiredLayerIds = [] } = {}
) {
  if (!previousSessionDetails || !incomingSessionDetails) {
    return incomingSessionDetails || previousSessionDetails;
  }
  const previousId = getRecordId(previousSessionDetails);
  const incomingId = getRecordId(incomingSessionDetails);
  if (previousId && incomingId && previousId !== incomingId) return incomingSessionDetails;

  const previousLayers = Array.isArray(previousSessionDetails.layers)
    ? previousSessionDetails.layers
    : [];
  const incomingLayers = Array.isArray(incomingSessionDetails.layers)
    ? incomingSessionDetails.layers
    : [];
  const previousById = new Map(previousLayers.map(layer => [getRecordId(layer), layer]));
  const incomingLayerIds = new Set(incomingLayers.map(getRecordId).filter(Boolean));
  const isMissingRequiredLocalLayer = requiredLayerIds.some((layerId) => {
    const normalizedLayerId = layerId?.toString?.() || layerId;
    return normalizedLayerId
      && previousById.has(normalizedLayerId)
      && !incomingLayerIds.has(normalizedLayerId);
  });

  if (
    previousLayers.length > 0
    && (!Array.isArray(incomingSessionDetails.layers) || isMissingRequiredLocalLayer)
  ) {
    return {
      ...previousSessionDetails,
      ...incomingSessionDetails,
      layers: previousLayers,
    };
  }

  if (!previousLayers.length || !incomingLayers.length || hasHydratedStudioLayers(incomingSessionDetails)) {
    return incomingSessionDetails;
  }
  const layers = incomingLayers.map(layer => {
    const id = getRecordId(layer);
    return id ? restoreMissingLayerMedia(layer, previousById.get(id)) : layer;
  });
  if (layers.every((layer, index) => layer === incomingLayers[index])) return incomingSessionDetails;
  const retainedPreviousLayers = layers.length === previousLayers.length
    && layers.every((layer, index) => layer === previousLayers[index]);
  return { ...incomingSessionDetails, layers: retainedPreviousLayers ? previousLayers : layers };
}

export function resolveStudioSessionRefresh({
  previousSessionDetails,
  incomingSessionDetails,
  currentLayerId,
  selectedLayerIndex = 0,
  requiredLayerIds = [],
} = {}) {
  const sessionDetails = mergeStudioSessionRefresh(
    previousSessionDetails,
    incomingSessionDetails,
    { requiredLayerIds }
  );
  const layers = Array.isArray(sessionDetails?.layers) ? sessionDetails.layers : [];
  const matchingLayerIndex = currentLayerId
    ? layers.findIndex((layer) => getRecordId(layer) === currentLayerId)
    : -1;
  const fallbackIndex = Number.isInteger(selectedLayerIndex)
    ? Math.min(Math.max(selectedLayerIndex, 0), Math.max(layers.length - 1, 0))
    : 0;
  const currentLayerIndex = matchingLayerIndex >= 0 ? matchingLayerIndex : fallbackIndex;

  return {
    sessionDetails,
    layers,
    currentLayerIndex,
    currentLayer: layers[currentLayerIndex] || null,
  };
}
