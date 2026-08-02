function firstLayerIdentity(values) {
  const value = values.find((candidate) => (
    typeof candidate === 'string' || typeof candidate === 'number'
  ));
  return value === undefined ? '' : String(value);
}

export function resolveStudioCanvasLayerKey(layer, fallbackKey = '') {
  const layerId = firstLayerIdentity([
    layer?._id?.toString?.(),
    layer?._id,
    layer?.id?.toString?.(),
    layer?.id,
  ]);
  if (layerId) {
    return `layer:${layerId}`;
  }

  const durationOffset = Number(layer?.durationOffset);
  if (Number.isFinite(durationOffset)) {
    return `offset:${durationOffset}`;
  }

  return `fallback:${fallbackKey || 'current'}`;
}

export function isBlankStudioCanvas(activeItemList, videoLayer) {
  const hasCanvasItems = Array.isArray(activeItemList) && activeItemList.length > 0;
  const hasVideoLayer = typeof videoLayer === 'string'
    ? videoLayer.trim().length > 0
    : Boolean(videoLayer);

  return !hasCanvasItems && !hasVideoLayer;
}

export function shouldRestoreBlankCanvasOverlay({
  isCanvasBlank,
  wasCanvasBlank,
  layerKey,
  previousLayerKey,
}) {
  return Boolean(
    isCanvasBlank
    && (!wasCanvasBlank || layerKey !== previousLayerKey)
  );
}

export function shouldShowBlankCanvasOverlay({
  isCanvasBlank,
  isEditImageView,
  isOverlayOpen,
}) {
  return Boolean(isCanvasBlank && !isEditImageView && isOverlayOpen);
}

export function resolveBlankCanvasOverlayMaxHeight({
  frameTop,
  scrollportTop,
  scrollportBottom,
  stickyInset = 12,
  bottomInset = 12,
}) {
  const numericFrameTop = Number(frameTop);
  const numericScrollportTop = Number(scrollportTop);
  const numericScrollportBottom = Number(scrollportBottom);
  if (
    !Number.isFinite(numericFrameTop)
    || !Number.isFinite(numericScrollportTop)
    || !Number.isFinite(numericScrollportBottom)
  ) {
    return null;
  }

  const visibleTop = Math.max(
    numericFrameTop,
    numericScrollportTop + Math.max(0, Number(stickyInset) || 0)
  );
  return Math.max(
    0,
    Math.floor(numericScrollportBottom - visibleTop - Math.max(0, Number(bottomInset) || 0))
  );
}
