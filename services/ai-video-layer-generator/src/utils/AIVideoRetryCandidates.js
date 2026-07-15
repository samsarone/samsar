function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeNullableScore(value) {
  if (value === null || value === undefined || value === '') return null;
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

export function selectRankedFallbackImage(
  candidates = [],
  retryCount = 0,
  { excludeSources = [] } = {},
) {
  const excluded = new Set(
    excludeSources.map(normalizeImageCandidateSource).filter(Boolean),
  );
  const seen = new Set();
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .map((candidate, originalIndex) => ({ candidate, originalIndex }))
    .filter(({ candidate }) => normalizeString(candidate?.src))
    .sort((left, right) => {
      const scoreDifference = (Number(right.candidate?.score) || 0) - (Number(left.candidate?.score) || 0);
      return scoreDifference || left.originalIndex - right.originalIndex;
    })
    .filter(({ candidate }) => {
      const sourceKey = normalizeImageCandidateSource(candidate.src);
      if (!sourceKey || seen.has(sourceKey)) return false;
      seen.add(sourceKey);
      return true;
    })
    .map(({ candidate }, rank) => ({
      ...candidate,
      src: normalizeString(candidate.src),
      description: normalizeString(candidate.description),
      score: normalizeNullableScore(candidate.score),
      rank,
    }))
    .filter((candidate) => !excluded.has(normalizeImageCandidateSource(candidate.src)));

  const desiredRank = Math.max(0, Number(retryCount) || 0);
  if (desiredRank >= ranked.length) return null;
  return { pass: ranked[desiredRank], rank: ranked[desiredRank].rank, candidates: ranked };
}

export function getRetryStartImageDescription(selectedCandidate, layer = {}) {
  if (selectedCandidate && typeof selectedCandidate === 'object') {
    return normalizeString(selectedCandidate.description);
  }
  return [
    layer?.activeImageCandidate?.description,
    layer?.imageSession?.activeImageDescription,
    layer?.activeImageDescription,
  ].map(normalizeString).find(Boolean) || '';
}

export async function prepareRankedFallbackImage({
  candidates = [],
  excludeSources = [],
  prepareImage,
} = {}) {
  if (typeof prepareImage !== 'function') {
    throw new TypeError('prepareImage must be a function');
  }

  const attemptedSources = [];
  const preparationErrors = [];
  while (true) {
    const selection = selectRankedFallbackImage(candidates, 0, {
      excludeSources: [...excludeSources, ...attemptedSources],
    });
    if (!selection?.pass) {
      return {
        selection: null,
        startImage: '',
        attemptedSources,
        preparationErrors,
      };
    }

    const candidate = selection.pass;
    attemptedSources.push(candidate.src);
    try {
      const startImage = await prepareImage(candidate);
      if (normalizeString(startImage)) {
        return {
          selection,
          startImage: normalizeString(startImage),
          attemptedSources,
          preparationErrors,
        };
      }
      preparationErrors.push({
        src: candidate.src,
        message: 'Fallback image preparation returned no image.',
      });
    } catch (error) {
      preparationErrors.push({
        src: candidate.src,
        message: error?.message || String(error),
      });
    }
  }
}

export function buildDeterministicRetryVideoPrompt({
  sceneAction,
  startImageDescription,
  cameraTransition,
} = {}) {
  const parts = [];
  if (normalizeString(sceneAction)) {
    parts.push(`Animate the starting frame according to this scene action: ${normalizeString(sceneAction)}.`);
  }
  if (normalizeString(startImageDescription)) {
    parts.push(`The starting frame shows: ${normalizeString(startImageDescription)}.`);
  }
  if (normalizeString(cameraTransition)) {
    parts.push(`Use this camera movement: ${normalizeString(cameraTransition)}.`);
  }
  parts.push('Preserve the existing people, objects, text, composition, and context; use realistic motion and do not introduce new elements.');
  return parts.join(' ').slice(0, 900);
}
