function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNullableNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;

  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

export function normalizeImageCandidateSource(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';

  let pathname = normalized;
  if (/^https?:\/\//i.test(normalized)) {
    try {
      pathname = decodeURIComponent(new URL(normalized).pathname);
    } catch {
      pathname = normalized;
    }
  }

  const withoutQuery = pathname.split('?')[0].split('#')[0].replace(/^\/+/, '');
  const generationsIndex = withoutQuery.indexOf('generations/');
  return generationsIndex >= 0
    ? withoutQuery.slice(generationsIndex)
    : withoutQuery.replace(/^assets_v2\//, '').replace(/^assets\//, '');
}

export function getLayerImageDescription(layer = {}) {
  const candidates = [
    layer?.activeImageCandidate?.description,
    layer?.imageSession?.activeImageDescription,
    layer?.activeImageDescription,
  ];
  return candidates.map(normalizeString).find(Boolean) || '';
}

export function getLayerActiveImageSources(layer = {}) {
  const activeItemList = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const baseItem = activeItemList.find((item) => item?.is_base_image === true);
  const values = [
    layer?.activeImageCandidate?.src,
    layer?.activeImageCandidate?.remoteSrc,
    layer?.imageSession?.activeGeneratedImage,
    layer?.imageSession?.activeEditedImage,
    layer?.imageSession?.activeImageRemoteLink,
    layer?.imageSession?.activeSelectedImage,
    baseItem?.src,
    baseItem?.url,
    baseItem?.imageUrl,
  ];

  return [...new Set(values.map(normalizeString).filter(Boolean))];
}

export function buildRankedFallbackStartImages(layer = {}) {
  const excludedSources = new Set(
    getLayerActiveImageSources(layer).map(normalizeImageCandidateSource).filter(Boolean),
  );
  const seenSources = new Set();

  return (Array.isArray(layer?.filterPasses) ? layer.filterPasses : [])
    .map((candidate, originalIndex) => ({ candidate, originalIndex }))
    .filter(({ candidate }) => normalizeString(candidate?.src))
    .sort((left, right) => {
      const scoreDifference = (Number(right.candidate?.score) || 0) - (Number(left.candidate?.score) || 0);
      return scoreDifference || left.originalIndex - right.originalIndex;
    })
    .filter(({ candidate }) => {
      const sourceKey = normalizeImageCandidateSource(candidate.src);
      if (!sourceKey || excludedSources.has(sourceKey) || seenSources.has(sourceKey)) {
        return false;
      }
      seenSources.add(sourceKey);
      return true;
    })
    .map(({ candidate }, rank) => ({
      src: normalizeString(candidate.src),
      description: normalizeString(candidate.description),
      score: normalizeNullableNumber(candidate.score),
      rank,
    }));
}

export function buildAiVideoRetryQueueFields(payload = {}) {
  const initialStartImageSources = Array.isArray(payload.initialStartImageSources)
    ? [...new Set(payload.initialStartImageSources.map(normalizeString).filter(Boolean))]
    : [];
  const fallbackStartImages = Array.isArray(payload.fallbackStartImages)
    ? payload.fallbackStartImages
      .map((candidate) => ({
        src: normalizeString(candidate?.src),
        description: normalizeString(candidate?.description),
        score: normalizeNullableNumber(candidate?.score),
        rank: normalizeNullableNumber(candidate?.rank),
      }))
      .filter((candidate) => candidate.src)
    : [];
  const promptSeedContext = payload.promptSeedContext &&
    typeof payload.promptSeedContext === 'object' &&
    !Array.isArray(payload.promptSeedContext)
    ? { ...payload.promptSeedContext }
    : null;

  return {
    startImageDescription: normalizeString(payload.startImageDescription),
    initialStartImageSources,
    fallbackStartImages,
    promptSeedContext,
    userInferenceModel: normalizeString(payload.userInferenceModel) || null,
    ...(['high', 'xhigh'].includes(normalizeString(payload.inferenceEffort).toLowerCase())
      ? { inferenceEffort: normalizeString(payload.inferenceEffort).toLowerCase() }
      : {}),
    selectedInferenceModelAuthorization:
      normalizeString(payload.selectedInferenceModelAuthorization) || null,
  };
}

export function buildAiVideoPromptSeedContext({
  layer,
  sceneAction,
  resolvedPrompt,
  promptStrategy,
  layerIndex,
  layerCount,
  sceneDescriptions,
  cameraTransition,
  videoTone,
  userInferenceModel,
  inferenceEffort,
  selectedInferenceModelAuthorization,
  useShortFormPrompt = false,
} = {}) {
  const normalizedResolvedPrompt = normalizeString(resolvedPrompt);
  const normalizedPromptStrategy = normalizeString(promptStrategy);

  return {
    sceneAction: normalizeString(sceneAction) || normalizeString(layer?.prompt),
    ...(normalizedResolvedPrompt ? { resolvedPrompt: normalizedResolvedPrompt } : {}),
    ...(normalizedPromptStrategy ? { promptStrategy: normalizedPromptStrategy } : {}),
    startImageDescription: getLayerImageDescription(layer),
    sceneDescriptions: Array.isArray(sceneDescriptions)
      ? sceneDescriptions.map((description) => normalizeString(description))
      : [],
    cameraTransition: normalizeString(cameraTransition),
    indexData: {
      isStartScene: layerIndex === 0,
      isEndScene: layerIndex === layerCount - 1,
    },
    isSpeakerTransition: normalizeString(layer?.layerAiVideoType).toLowerCase() === 'character',
    videoTone: normalizeString(videoTone) || 'grounded',
    userInferenceModel: normalizeString(userInferenceModel),
    selectedInferenceModelAuthorization: normalizeString(selectedInferenceModelAuthorization),
    useShortFormPrompt: useShortFormPrompt === true,
    reasoningEffort: normalizeString(inferenceEffort).toLowerCase() === 'xhigh' ? 'xhigh' : 'high',
  };
}
