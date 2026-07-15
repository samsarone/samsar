function firstText(values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

function getLayerId(layer = {}) {
  return layer?._id?.toString?.() || layer?._id || layer?.id?.toString?.() || layer?.id || null;
}

function hasRenderableImageItemUrl(item = {}) {
  const candidate = firstText([
    item.previewUrl,
    item.signedUrl,
    item.displayUrl,
    item.url,
    item.imageUrl,
    item.src,
    item.image,
  ]);
  return Boolean(
    candidate && (
      /^(https?:|data:|blob:)/i.test(candidate) ||
      candidate.startsWith('/') ||
      candidate.includes('/')
    )
  );
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

export function mergeStudioSessionRefresh(previousSessionDetails, incomingSessionDetails) {
  if (!previousSessionDetails || !incomingSessionDetails) {
    return incomingSessionDetails || previousSessionDetails;
  }

  const previousLayers = Array.isArray(previousSessionDetails.layers)
    ? previousSessionDetails.layers
    : [];
  if (previousLayers.length > 0 && !hasHydratedStudioLayers(incomingSessionDetails)) {
    return {
      ...previousSessionDetails,
      ...incomingSessionDetails,
      layers: previousLayers,
    };
  }

  return incomingSessionDetails;
}

export function resolveStudioSessionRefresh({
  previousSessionDetails,
  incomingSessionDetails,
  currentLayerId,
  selectedLayerIndex = 0,
} = {}) {
  const sessionDetails = mergeStudioSessionRefresh(
    previousSessionDetails,
    incomingSessionDetails
  );
  const layers = Array.isArray(sessionDetails?.layers) ? sessionDetails.layers : [];
  const matchingLayerIndex = currentLayerId
    ? layers.findIndex((layer) => getLayerId(layer) === currentLayerId)
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
