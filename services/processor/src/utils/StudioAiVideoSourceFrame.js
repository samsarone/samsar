function getFirstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function getActiveImageItemSource(item = {}) {
  return getFirstNonEmptyString(
    item?.previewUrl,
    item?.preview_url,
    item?.signedUrl,
    item?.signed_url,
    item?.displayUrl,
    item?.display_url,
    item?.url,
    item?.imageUrl,
    item?.image_url,
    item?.src,
    item?.image,
  );
}

function getVisibleLayerItems(activeItemList = []) {
  return Array.isArray(activeItemList)
    ? activeItemList.filter((item) => item && item.isHidden !== true)
    : [];
}

function getRawAiVideoSourceImageItem(activeItemList = []) {
  const visibleItems = getVisibleLayerItems(activeItemList);
  if (visibleItems.length !== 1) {
    return null;
  }

  const [item] = visibleItems;
  if (
    item?.type !== 'image' ||
    item?.aiVideoSourceOriginal !== true ||
    !getActiveImageItemSource(item)
  ) {
    return null;
  }

  return item;
}

function canUseRawAiVideoSourceFrame(layer = {}) {
  const imageSession = layer?.imageSession || {};
  const activeItem = getRawAiVideoSourceImageItem(imageSession.activeItemList);
  if (activeItem) {
    return true;
  }

  const activeItems = getVisibleLayerItems(imageSession.activeItemList);
  if (activeItems.length > 0) {
    return false;
  }

  return Boolean(getRawAiVideoSourceImageItem(imageSession.previousActiveItemList));
}

export function normalizeStudioAiVideoSourceFramePayload(payload = {}, session = {}, currentLayer = {}) {
  if (payload.combineLayers !== true || payload.useStartFrame !== true) {
    return payload;
  }

  if (!canUseRawAiVideoSourceFrame(currentLayer)) {
    return payload;
  }

  if (payload.useEndFrame === true) {
    const layers = Array.isArray(session?.layers) ? session.layers : [];
    const currentLayerIndex = layers.findIndex(
      (layer) => layer?._id?.toString?.() === currentLayer?._id?.toString?.()
    );
    const nextLayer = currentLayerIndex >= 0 ? layers[currentLayerIndex + 1] : null;
    if (nextLayer && !canUseRawAiVideoSourceFrame(nextLayer)) {
      return payload;
    }
  }

  return {
    ...payload,
    combineLayers: false,
  };
}
