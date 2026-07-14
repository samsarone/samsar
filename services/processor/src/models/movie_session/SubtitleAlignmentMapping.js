function normalizeMappingEntry(entry = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const sourceText = typeof entry.sourceText === 'string' ? entry.sourceText.trim() : '';
  const translatedText = typeof entry.translatedText === 'string'
    ? entry.translatedText.trim()
    : '';
  if (
    !sourceText ||
    !translatedText ||
    !normalizeSubtitleAlignmentCoverageText(sourceText) ||
    !normalizeSubtitleAlignmentCoverageText(translatedText)
  ) {
    return null;
  }

  return { sourceText, translatedText };
}

export function normalizeSubtitleAlignmentMap(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  const normalized = value.map(normalizeMappingEntry);
  return normalized.every(Boolean) ? normalized : [];
}

export function normalizeSubtitleAlignmentCoverageText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '');
}

export function getSubtitleAlignmentMapCoverage(
  value,
  sourceSpeechText,
  translatedSubtitleText,
) {
  const subtitleAlignmentMap = normalizeSubtitleAlignmentMap(value);
  const normalizedSourceSpeech = normalizeSubtitleAlignmentCoverageText(sourceSpeechText);
  const normalizedTranslatedSubtitle = normalizeSubtitleAlignmentCoverageText(
    translatedSubtitleText,
  );
  const normalizedMappedSource = subtitleAlignmentMap
    .map((entry) => normalizeSubtitleAlignmentCoverageText(entry.sourceText))
    .join('');
  const normalizedMappedTranslation = subtitleAlignmentMap
    .map((entry) => normalizeSubtitleAlignmentCoverageText(entry.translatedText))
    .join('');
  const hasComparableText = Boolean(
    subtitleAlignmentMap.length &&
    normalizedSourceSpeech &&
    normalizedTranslatedSubtitle,
  );
  const sourceMatches = hasComparableText &&
    normalizedMappedSource === normalizedSourceSpeech;
  const translationMatches = hasComparableText &&
    normalizedMappedTranslation === normalizedTranslatedSubtitle;

  return {
    subtitleAlignmentMap,
    sourceMatches,
    translationMatches,
    isComplete: sourceMatches && translationMatches,
  };
}

function getIntlSegments(value, granularity) {
  if (
    typeof value !== 'string' ||
    !value ||
    typeof Intl === 'undefined' ||
    typeof Intl.Segmenter !== 'function'
  ) {
    return [];
  }

  const segmenter = new Intl.Segmenter(undefined, { granularity });
  return Array.from(segmenter.segment(value));
}

function getWordBoundarySegments(value) {
  return getIntlSegments(value, 'word').filter((segment) => segment.isWordLike);
}

function getGraphemeBoundarySegments(value) {
  const intlSegments = getIntlSegments(value, 'grapheme');
  if (intlSegments.length > 0) {
    return intlSegments;
  }

  let index = 0;
  return Array.from(typeof value === 'string' ? value : '').map((segment) => {
    const currentIndex = index;
    index += segment.length;
    return { segment, index: currentIndex };
  });
}

function getTranslatedPhraseWeight(value) {
  const wordSegmentCount = getWordBoundarySegments(value).length;
  if (wordSegmentCount > 0) {
    return wordSegmentCount;
  }

  return Math.max(1, getGraphemeBoundarySegments(
    normalizeSubtitleAlignmentCoverageText(value),
  ).length);
}

function allocateBoundarySegmentCounts(weights, totalSegmentCount) {
  if (
    !Array.isArray(weights) ||
    weights.length === 0 ||
    totalSegmentCount < weights.length
  ) {
    return null;
  }

  const positiveWeights = weights.map((weight) => Math.max(1, Number(weight) || 1));
  let remainingSegments = totalSegmentCount;
  let remainingWeight = positiveWeights.reduce((total, weight) => total + weight, 0);

  return positiveWeights.map((weight, index) => {
    const remainingEntryCount = positiveWeights.length - index - 1;
    if (remainingEntryCount === 0) {
      return remainingSegments;
    }

    const proportionalCount = Math.round(
      (remainingSegments * weight) / remainingWeight,
    );
    const segmentCount = Math.max(
      1,
      Math.min(proportionalCount, remainingSegments - remainingEntryCount),
    );
    remainingSegments -= segmentCount;
    remainingWeight -= weight;
    return segmentCount;
  });
}

function sliceTextAcrossAlignmentEntries(text, alignmentMap) {
  const wordBoundarySegments = getWordBoundarySegments(text);
  const boundarySegments = wordBoundarySegments.length >= alignmentMap.length
    ? wordBoundarySegments
    : getGraphemeBoundarySegments(text);
  const segmentCounts = allocateBoundarySegmentCounts(
    alignmentMap.map((entry) => getTranslatedPhraseWeight(entry.translatedText)),
    boundarySegments.length,
  );
  if (!segmentCounts) {
    return [];
  }

  let startIndex = 0;
  let consumedSegmentCount = 0;
  return segmentCounts.map((segmentCount, index) => {
    consumedSegmentCount += segmentCount;
    const endIndex = index === segmentCounts.length - 1
      ? text.length
      : boundarySegments[consumedSegmentCount]?.index;
    if (!Number.isInteger(endIndex) || endIndex <= startIndex) {
      return '';
    }

    const slice = text.slice(startIndex, endIndex).trim();
    startIndex = endIndex;
    return slice;
  });
}

export function repairSubtitleAlignmentMapTranslationCoverage(
  value,
  sourceSpeechText,
  translatedSubtitleText,
) {
  const subtitleAlignmentMap = normalizeSubtitleAlignmentMap(value);
  const currentCoverage = getSubtitleAlignmentMapCoverage(
    subtitleAlignmentMap,
    sourceSpeechText,
    translatedSubtitleText,
  );
  if (currentCoverage.isComplete) {
    return subtitleAlignmentMap;
  }
  if (!currentCoverage.sourceMatches) {
    return [];
  }

  const translatedText = typeof translatedSubtitleText === 'string'
    ? translatedSubtitleText.trim()
    : '';
  if (!normalizeSubtitleAlignmentCoverageText(translatedText)) {
    return [];
  }

  const translatedSlices = sliceTextAcrossAlignmentEntries(
    translatedText,
    subtitleAlignmentMap,
  );
  if (
    translatedSlices.length !== subtitleAlignmentMap.length ||
    translatedSlices.some((slice) => !normalizeSubtitleAlignmentCoverageText(slice))
  ) {
    return [];
  }

  const repairedAlignmentMap = subtitleAlignmentMap.map((entry, index) => ({
    sourceText: entry.sourceText,
    translatedText: translatedSlices[index],
  }));
  const repairedCoverage = getSubtitleAlignmentMapCoverage(
    repairedAlignmentMap,
    sourceSpeechText,
    translatedText,
  );
  return repairedCoverage.isComplete ? repairedAlignmentMap : [];
}

export function isSubtitleAlignmentMapComplete(
  value,
  sourceSpeechText,
  translatedSubtitleText,
) {
  return getSubtitleAlignmentMapCoverage(
    value,
    sourceSpeechText,
    translatedSubtitleText,
  ).isComplete;
}
