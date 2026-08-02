export function hasActionableStudioLayer(layer) {
  if (!layer || typeof layer !== 'object') {
    return false;
  }

  const layerId = layer?._id?.toString?.() || layer?._id;
  return Boolean(layerId);
}

export function canRemoveStudioScene(layers) {
  return Array.isArray(layers) && layers.length > 1;
}
