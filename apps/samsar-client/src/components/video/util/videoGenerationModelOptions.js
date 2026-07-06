import { VIDEO_GENERATION_MODEL_TYPES } from "../../../constants/Types.ts";
import { VIDEO_MODEL_PRICES } from "../../../constants/ModelPrices.jsx";

const getPricingMap = () =>
  new Map(VIDEO_MODEL_PRICES.map((entry) => [entry.key, entry]));

const VIDEO_MODEL_PRIORITY = {
  RUNWAYML: 0,
  "VEO3.1": 10,
  "VEO3.1FAST": 11,
  "VEO3.1I2V": 10,
  "VEO3.1FLIV": 11,
  "VEO3.1I2VFAST": 12,
  COSMOS3SUPERI2V: 13,
};

const getVideoModelPriority = (key = "") =>
  Object.prototype.hasOwnProperty.call(VIDEO_MODEL_PRIORITY, key)
    ? VIDEO_MODEL_PRIORITY[key]
    : Number.MAX_SAFE_INTEGER;

const sortVideoModelsByPriority = (models = []) =>
  [...models].sort((a, b) => {
    const priorityDelta = getVideoModelPriority(a?.key) - getVideoModelPriority(b?.key);
    if (priorityDelta !== 0) return priorityDelta;
    return 0;
  });

const normalizeVideoCapabilityFlags = (entry = {}) => ({
  // Support both legacy (*ToVid) and current (*ToVideo) fields.
  isImageToVideoModel:
    typeof entry.isImageToVideoModel === "boolean"
      ? entry.isImageToVideoModel
      : Boolean(entry.isImgToVidModel),
  isTextToVideoModel:
    typeof entry.isTextToVideoModel === "boolean"
      ? entry.isTextToVideoModel
      : Boolean(entry.isTextToVidModel),
});

const supportsImageToVideoFlag = (entry) =>
  normalizeVideoCapabilityFlags(entry).isImageToVideoModel;

const supportsTextToVideoFlag = (entry) =>
  normalizeVideoCapabilityFlags(entry).isTextToVideoModel;

const hasImageInCanvas = (activeItemList) =>
  Array.isArray(activeItemList) &&
  activeItemList.some((item) => item?.type === "image");

const getModelCapabilities = (model, pricingEntry) => ({
  supportsImageToVideo:
    supportsImageToVideoFlag(model) || supportsImageToVideoFlag(pricingEntry),
  supportsTextToVideo:
    supportsTextToVideoFlag(model) || supportsTextToVideoFlag(pricingEntry),
  supportsFirstLastFrameToVideo:
    Boolean(model?.isFirstLastFrameToVideoModel) ||
    Boolean(pricingEntry?.isFirstLastFrameToVideoModel),
});

const layerHasStartingImage = (layer, fallbackActiveItemList) => {
  const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : fallbackActiveItemList;

  return (
    Array.isArray(activeItemList) &&
    activeItemList.some(
      (item) => item?.type === "image" && item?.src && item?.isHidden !== true
    )
  );
};

const layerHasAiVideoLayer = (layer) =>
  Boolean(
    layer?.aiVideoLayer ||
      layer?.aiVideoRemoteLink ||
      layer?.hasAiVideoLayer ||
      layer?.aiVideoGenerationPending
  );

const getNextLayer = (currentLayer, layers = []) => {
  if (!currentLayer?._id || !Array.isArray(layers)) return null;
  const currentLayerId = currentLayer._id.toString();
  const currentLayerIndex = layers.findIndex(
    (layer) => layer?._id?.toString?.() === currentLayerId
  );
  return currentLayerIndex >= 0 ? layers[currentLayerIndex + 1] || null : null;
};

const canUseFirstLastFrameToVideo = ({
  activeItemList,
  currentLayer,
  sessionDetails,
}) => {
  const layers = Array.isArray(sessionDetails?.layers) ? sessionDetails.layers : [];
  const nextLayer = getNextLayer(currentLayer, layers);

  return Boolean(
    currentLayer &&
      sessionDetails?.isExpressGeneration !== true &&
      !layerHasAiVideoLayer(currentLayer) &&
      layerHasStartingImage(currentLayer, activeItemList) &&
      layerHasStartingImage(nextLayer)
  );
};

const resolveDropdownMode = ({ mode, hasImageItem }) => {
  if (mode === "image" || mode === "text") {
    return mode;
  }
  return hasImageItem ? "image" : "text";
};

export const getVideoGenerationModelDropdownData = ({
  activeItemList,
  mode,
  currentLayer,
  sessionDetails,
}) => {
  const hasImageItem = hasImageInCanvas(activeItemList);
  const dropdownMode = resolveDropdownMode({ mode, hasImageItem });
  const pricingMap = getPricingMap();
  const supportsFirstLastFrameToVideo = canUseFirstLastFrameToVideo({
    activeItemList,
    currentLayer,
    sessionDetails,
  });

  const availableModels = VIDEO_GENERATION_MODEL_TYPES.filter((model) => {
    const pricingEntry = pricingMap.get(model.key);
    if (!pricingEntry?.prices?.length) return false;

    const capabilities = getModelCapabilities(model, pricingEntry);
    if (capabilities.supportsFirstLastFrameToVideo) {
      return dropdownMode === "image" && supportsFirstLastFrameToVideo;
    }

    return dropdownMode === "image"
      ? capabilities.supportsImageToVideo
      : capabilities.supportsTextToVideo;
  });
  const prioritizedModels = sortVideoModelsByPriority(availableModels);

  return {
    hasImageItem,
    dropdownMode,
    supportsFirstLastFrameToVideo,
    availableModels: prioritizedModels,
    availableModelKeys: prioritizedModels.map((model) => model.key),
    availableModelKeysSignature: prioritizedModels.map((model) => model.key).join("|"),
  };
};

export const getVideoGenerationModelMeta = (modelKey) => {
  const modelDef = VIDEO_GENERATION_MODEL_TYPES.find((model) => model.key === modelKey);
  const pricing = VIDEO_MODEL_PRICES.find((entry) => entry.key === modelKey);
  const capabilities = getModelCapabilities(modelDef, pricing);

  return {
    modelDef,
    pricing,
    ...capabilities,
  };
};

export const getModelPriceForAspect = (pricingEntry, aspectRatio) => {
  if (!pricingEntry?.prices?.length) return null;
  return (
    pricingEntry.prices.find((price) => price.aspectRatio === aspectRatio) ||
    pricingEntry.prices[0]
  );
};
