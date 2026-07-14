import { resolveSubtitleFont } from '../consts/SubtitleFonts.js';

const DEFAULT_FRAMES_PER_SECOND = 24;
const MAPPED_SUBTITLE_RENDER_MODES = new Set([
  'mapped',
  'timed_mapped',
  'translated_mapped',
  'translated_cue',
]);
const NO_SPACE_SUBTITLE_LANGUAGES = new Set(['ja', 'th', 'zh']);

const LANGUAGE_ALIASES = Object.freeze({
  eng: 'en',
  spa: 'es',
  fre: 'fr',
  fra: 'fr',
  jpn: 'ja',
  jp: 'ja',
  tha: 'th',
  zho: 'zh',
  chi: 'zh',
  cn: 'zh',
  ben: 'bn',
  hin: 'hi',
  san: 'sa',
  lat: 'la',
});

export function normalizeComparableSubtitleLanguage(languageCode = '') {
  if (typeof languageCode !== 'string') {
    return '';
  }

  const normalized = languageCode.trim().toLowerCase().replace(/_/g, '-');
  if (!normalized || normalized === 'auto') {
    return '';
  }

  const exactAlias = LANGUAGE_ALIASES[normalized];
  if (exactAlias) {
    return exactAlias;
  }

  const baseCode = normalized.split('-')[0];
  return LANGUAGE_ALIASES[baseCode] || baseCode;
}

function firstConcreteLanguage(...values) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (normalizeComparableSubtitleLanguage(trimmed)) {
      return trimmed;
    }
  }
  return '';
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function findItemAudioLayer(session = {}, item = {}) {
  const audioLayerId = item.audioLayerId?.toString?.() || '';
  if (!audioLayerId || !Array.isArray(session.audioLayers)) {
    return null;
  }

  return session.audioLayers.find(
    (audioLayer) => audioLayer?._id?.toString?.() === audioLayerId,
  ) || null;
}

function normalizeAlignmentText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .normalize('NFKC')
    .replace(/[\u2018\u2019`]/g, "'")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeSubtitleAlignmentEntry(entry = {}) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const sourceText = firstNonEmptyString(
    entry.sourceText,
    entry.source_text,
    entry.source,
  );
  const translatedText = firstNonEmptyString(
    entry.translatedText,
    entry.translated_text,
    entry.targetText,
    entry.target_text,
    entry.translation,
  );

  if (!sourceText || !translatedText || !normalizeAlignmentText(sourceText)) {
    return null;
  }

  return { sourceText, translatedText };
}

export function normalizeSubtitleAlignmentMap(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  const normalized = value.map(normalizeSubtitleAlignmentEntry);
  return normalized.every(Boolean) ? normalized : [];
}

function getSubtitleAlignmentMap(item = {}, audioLayer = {}) {
  const candidates = [
    item.subtitleAlignmentMap,
    item.subtitle_alignment_map,
    audioLayer.subtitleAlignmentMap,
    audioLayer.subtitle_alignment_map,
    item.subtitleWordMapping,
    item.subtitle_word_mapping,
    audioLayer.subtitleWordMapping,
    audioLayer.subtitle_word_mapping,
  ];

  for (const candidate of candidates) {
    const normalized = normalizeSubtitleAlignmentMap(candidate);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return [];
}

function normalizeTimedWord(wordInfo = {}) {
  if (!wordInfo || typeof wordInfo !== 'object' || Array.isArray(wordInfo)) {
    return null;
  }

  const word = firstNonEmptyString(
    wordInfo.word,
    wordInfo.text,
    wordInfo.alignedWord,
    wordInfo.aligned_word,
  );
  const frameOffset = Number(wordInfo.frameOffset ?? wordInfo.frame_offset);
  const frameDuration = Number(wordInfo.frameDuration ?? wordInfo.frame_duration);

  if (
    !word ||
    !Number.isFinite(frameOffset) ||
    !Number.isFinite(frameDuration) ||
    frameDuration <= 0
  ) {
    return null;
  }

  return {
    ...wordInfo,
    word,
    frameOffset,
    frameDuration: Math.max(1, frameDuration),
  };
}

function normalizeTimedWords(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }

  const normalized = value.map(normalizeTimedWord);
  return normalized.every(Boolean) ? normalized : [];
}

function buildTimedWordsFromTranscriptAlignment(audioLayer = {}, session = {}) {
  const alignmentWords = audioLayer?.transcriptAlignment?.words;
  if (!Array.isArray(alignmentWords) || alignmentWords.length === 0) {
    return [];
  }

  const configuredFramesPerSecond = Number(session.framesPerSecond);
  const framesPerSecond = Number.isFinite(configuredFramesPerSecond) && configuredFramesPerSecond > 0
    ? configuredFramesPerSecond
    : DEFAULT_FRAMES_PER_SECOND;
  const audioStartTime = Number(audioLayer.startTime);
  const audioStartFrame = Number.isFinite(audioStartTime)
    ? Math.round(audioStartTime * framesPerSecond)
    : 0;

  const timedWords = alignmentWords.map((wordInfo) => {
    const word = firstNonEmptyString(
      wordInfo?.word,
      wordInfo?.text,
      wordInfo?.alignedWord,
      wordInfo?.aligned_word,
    );
    const start = Number(wordInfo?.start);
    const end = Number(wordInfo?.end);
    if (!word || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return null;
    }

    const frameOffset = audioStartFrame + Math.round(start * framesPerSecond);
    const frameEnd = audioStartFrame + Math.round(end * framesPerSecond);
    return {
      word,
      frameOffset,
      frameDuration: Math.max(1, frameEnd - frameOffset),
    };
  });

  return timedWords.every(Boolean) ? timedWords : [];
}

function getTargetWordJoiner(subtitleLanguage) {
  const normalizedLanguage = normalizeComparableSubtitleLanguage(subtitleLanguage);
  return NO_SPACE_SUBTITLE_LANGUAGES.has(normalizedLanguage) ? '' : ' ';
}

function getGraphemeCount(value, locale = 'en') {
  const text = typeof value === 'string' ? value : '';
  if (!text) {
    return 1;
  }

  try {
    const segmenter = new Intl.Segmenter(locale || 'en', { granularity: 'grapheme' });
    return Math.max(1, Array.from(segmenter.segment(text)).length);
  } catch {
    return Math.max(1, Array.from(text).length);
  }
}

function tokenizeTranslatedPhrase(value, subtitleLanguage) {
  const text = firstNonEmptyString(value);
  if (!text) {
    return [];
  }

  const normalizedLanguage = normalizeComparableSubtitleLanguage(subtitleLanguage);
  if (!NO_SPACE_SUBTITLE_LANGUAGES.has(normalizedLanguage)) {
    const rawTokens = text.split(/\s+/u).filter(Boolean);
    const tokens = [];
    let leadingNonWordText = '';
    rawTokens.forEach((token) => {
      if (/[\p{L}\p{N}]/u.test(token)) {
        tokens.push(leadingNonWordText ? `${leadingNonWordText} ${token}` : token);
        leadingNonWordText = '';
        return;
      }

      if (tokens.length > 0) {
        tokens[tokens.length - 1] += ` ${token}`;
      } else {
        leadingNonWordText = leadingNonWordText
          ? `${leadingNonWordText} ${token}`
          : token;
      }
    });
    if (leadingNonWordText && tokens.length > 0) {
      tokens[tokens.length - 1] += ` ${leadingNonWordText}`;
    }
    return tokens.length > 0 ? tokens : rawTokens;
  }

  try {
    const segmenter = new Intl.Segmenter(normalizedLanguage || 'en', {
      granularity: 'word',
    });
    const tokens = [];
    let leadingNonWordText = '';
    Array.from(segmenter.segment(text)).forEach((entry) => {
      const segment = typeof entry?.segment === 'string' ? entry.segment : '';
      if (!segment.trim()) {
        return;
      }

      if (entry.isWordLike === true) {
        tokens.push(`${leadingNonWordText}${segment}`);
        leadingNonWordText = '';
        return;
      }

      if (tokens.length > 0) {
        // Keep punctuation visually attached to the word it follows so it does
        // not receive an independent highlight interval or page transition.
        tokens[tokens.length - 1] += segment;
      } else {
        leadingNonWordText += segment;
      }
    });

    if (leadingNonWordText && tokens.length > 0) {
      tokens[tokens.length - 1] += leadingNonWordText;
    }
    return tokens.length > 0 ? tokens : [text];
  } catch {
    return [text];
  }
}

function groupTokensToAvailableFrames(tokens, frameDuration, joiner) {
  const availableFrames = Math.max(1, Math.floor(frameDuration));
  if (tokens.length <= availableFrames) {
    return tokens;
  }

  return Array.from({ length: availableFrames }, (_, groupIndex) => {
    const startIndex = Math.floor((groupIndex * tokens.length) / availableFrames);
    const endIndex = Math.floor(((groupIndex + 1) * tokens.length) / availableFrames);
    return tokens.slice(startIndex, Math.max(startIndex + 1, endIndex)).join(joiner);
  });
}

/**
 * A translation mapping may legitimately map one source word to several target
 * words. Keep the source span, but divide it into non-overlapping target-word
 * spans so visual wrapping never highlights the whole translated phrase more
 * than once. The division is weighted by grapheme count and remains frame-exact.
 */
export function splitMappedSubtitlePhraseTimings(
  words,
  { subtitleLanguage = '' } = {},
) {
  const timedWords = normalizeTimedWords(words);
  if (timedWords.length === 0) {
    return [];
  }

  const normalizedLanguage = normalizeComparableSubtitleLanguage(subtitleLanguage);
  const internalJoiner = getTargetWordJoiner(subtitleLanguage);

  return timedWords.flatMap((wordInfo, phraseIndex) => {
    const frameDuration = Math.max(1, Math.round(wordInfo.frameDuration));
    const rawTokens = tokenizeTranslatedPhrase(wordInfo.word, subtitleLanguage);
    const tokens = groupTokensToAvailableFrames(rawTokens, frameDuration, internalJoiner);

    if (tokens.length <= 1) {
      return [{ ...wordInfo, frameDuration }];
    }

    const weights = tokens.map((token) => getGraphemeCount(token, normalizedLanguage));
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    const boundaries = [0];
    let cumulativeWeight = 0;

    for (let index = 0; index < tokens.length - 1; index += 1) {
      cumulativeWeight += weights[index];
      const proportionalBoundary = Math.round(
        (frameDuration * cumulativeWeight) / totalWeight,
      );
      const minimumBoundary = boundaries[index] + 1;
      const maximumBoundary = frameDuration - (tokens.length - index - 1);
      boundaries.push(Math.min(
        maximumBoundary,
        Math.max(minimumBoundary, proportionalBoundary),
      ));
    }
    boundaries.push(frameDuration);

    return tokens.map((token, tokenIndex) => ({
      ...wordInfo,
      word: token,
      frameOffset: wordInfo.frameOffset + boundaries[tokenIndex],
      frameDuration: boundaries[tokenIndex + 1] - boundaries[tokenIndex],
      joinerBefore: tokenIndex === 0 ? wordInfo.joinerBefore : internalJoiner,
      translatedPhrase: wordInfo.translatedText || wordInfo.word,
      translatedPhraseIndex: phraseIndex,
      translatedPhraseTokenIndex: tokenIndex,
      translatedPhraseTokenCount: tokens.length,
    }));
  });
}

function findAlignmentMapSlicesForSourceWords(timedSourceWords, normalizedMap) {
  const normalizedSourceText = timedSourceWords
    .map((wordInfo) => normalizeAlignmentText(wordInfo.word))
    .join('');
  if (!normalizedSourceText) {
    return [];
  }

  const candidates = [];
  for (let startIndex = 0; startIndex < normalizedMap.length; startIndex += 1) {
    let accumulatedSourceText = '';
    for (let endIndex = startIndex; endIndex < normalizedMap.length; endIndex += 1) {
      accumulatedSourceText += normalizeAlignmentText(normalizedMap[endIndex].sourceText);

      if (accumulatedSourceText === normalizedSourceText) {
        candidates.push({ startIndex, endIndex });
        break;
      }

      if (!normalizedSourceText.startsWith(accumulatedSourceText)) {
        break;
      }
    }
  }

  return candidates;
}

function mapAlignmentSliceToTimedWords(
  timedSourceWords,
  normalizedMap,
  { startIndex, endIndex },
  subtitleLanguage,
) {
  const mappedWords = [];
  const joinerBefore = getTargetWordJoiner(subtitleLanguage);
  let sourceCursor = 0;

  for (let mappingIndex = startIndex; mappingIndex <= endIndex; mappingIndex += 1) {
    const mapping = normalizedMap[mappingIndex];
    const expectedSource = normalizeAlignmentText(mapping.sourceText);
    if (!expectedSource) {
      return [];
    }

    const sourceStartIndex = sourceCursor;
    let accumulatedSource = '';
    let matched = false;

    while (sourceCursor < timedSourceWords.length) {
      accumulatedSource += normalizeAlignmentText(timedSourceWords[sourceCursor].word);
      sourceCursor += 1;

      if (accumulatedSource === expectedSource) {
        matched = true;
        break;
      }

      if (!expectedSource.startsWith(accumulatedSource)) {
        return [];
      }
    }

    if (!matched) {
      return [];
    }

    const matchedSourceWords = timedSourceWords.slice(sourceStartIndex, sourceCursor);
    const firstSourceWord = matchedSourceWords[0];
    const sourceEndFrame = matchedSourceWords.reduce(
      (latestEnd, wordInfo) => Math.max(
        latestEnd,
        wordInfo.frameOffset + wordInfo.frameDuration,
      ),
      firstSourceWord.frameOffset + firstSourceWord.frameDuration,
    );

    mappedWords.push({
      word: mapping.translatedText,
      frameOffset: firstSourceWord.frameOffset,
      frameDuration: Math.max(1, sourceEndFrame - firstSourceWord.frameOffset),
      sourceText: mapping.sourceText,
      translatedText: mapping.translatedText,
      sourceWordStartIndex: sourceStartIndex,
      sourceWordEndIndex: sourceCursor - 1,
      mappingIndex,
      joinerBefore: mappedWords.length === 0 ? '' : joinerBefore,
    });
  }

  const hasUnmappedSourceWords = timedSourceWords
    .slice(sourceCursor)
    .some((wordInfo) => Boolean(normalizeAlignmentText(wordInfo.word)));
  return hasUnmappedSourceWords ? [] : mappedWords;
}

export function mapSubtitleAlignmentToTimedWords(
  sourceWords,
  alignmentMap,
  { subtitleLanguage = '' } = {},
) {
  const timedSourceWords = normalizeTimedWords(sourceWords);
  const normalizedMap = normalizeSubtitleAlignmentMap(alignmentMap);
  if (timedSourceWords.length === 0 || normalizedMap.length === 0) {
    return [];
  }

  const candidates = findAlignmentMapSlicesForSourceWords(timedSourceWords, normalizedMap);
  for (const candidate of candidates) {
    const mappedWords = mapAlignmentSliceToTimedWords(
      timedSourceWords,
      normalizedMap,
      candidate,
      subtitleLanguage,
    );
    if (mappedWords.length > 0) {
      return mappedWords;
    }
  }

  return [];
}

function getTimedWordFrameSpan(words) {
  const timedWords = normalizeTimedWords(words);
  if (timedWords.length === 0) {
    return null;
  }

  return timedWords.reduce((span, wordInfo) => ({
    start: Math.min(span.start, wordInfo.frameOffset),
    end: Math.max(span.end, wordInfo.frameOffset + wordInfo.frameDuration),
  }), {
    start: timedWords[0].frameOffset,
    end: timedWords[0].frameOffset + timedWords[0].frameDuration,
  });
}

function getFrameSpanOverlap(firstSpan, secondSpan) {
  return Math.max(
    0,
    Math.min(firstSpan.end, secondSpan.end) - Math.max(firstSpan.start, secondSpan.start),
  );
}

function getFrameSpanGap(firstSpan, secondSpan) {
  if (getFrameSpanOverlap(firstSpan, secondSpan) > 0) {
    return 0;
  }
  if (firstSpan.end <= secondSpan.start) {
    return secondSpan.start - firstSpan.end;
  }
  return firstSpan.start - secondSpan.end;
}

function findMappedWordSlicesForSourceText(mappedWords, sourceWords) {
  const normalizedSourceText = normalizeTimedWords(sourceWords)
    .map((wordInfo) => normalizeAlignmentText(wordInfo.word))
    .join('');
  if (!normalizedSourceText) {
    return [];
  }

  const candidates = [];
  for (let startIndex = 0; startIndex < mappedWords.length; startIndex += 1) {
    let accumulatedSourceText = '';
    for (let endIndex = startIndex; endIndex < mappedWords.length; endIndex += 1) {
      accumulatedSourceText += normalizeAlignmentText(mappedWords[endIndex].sourceText);
      if (accumulatedSourceText === normalizedSourceText) {
        candidates.push(mappedWords.slice(startIndex, endIndex + 1));
        break;
      }
      if (!normalizedSourceText.startsWith(accumulatedSourceText)) {
        break;
      }
    }
  }
  return candidates;
}

function selectMappedWordsForSourceSegment(
  fullMappedWords,
  segmentSourceWords,
  toleranceFrames = 1,
) {
  const segmentSpan = getTimedWordFrameSpan(segmentSourceWords);
  if (!segmentSpan || !Array.isArray(fullMappedWords) || fullMappedWords.length === 0) {
    return [];
  }

  const exactSourceCandidates = findMappedWordSlicesForSourceText(
    fullMappedWords,
    segmentSourceWords,
  );
  if (exactSourceCandidates.length > 0) {
    const scoredCandidates = exactSourceCandidates.map((candidate) => {
      const candidateSpan = getTimedWordFrameSpan(candidate);
      return {
        candidate,
        overlap: getFrameSpanOverlap(segmentSpan, candidateSpan),
        gap: getFrameSpanGap(segmentSpan, candidateSpan),
      };
    }).sort((first, second) => (
      second.overlap - first.overlap || first.gap - second.gap
    ));

    const bestMatch = scoredCandidates[0];
    if (bestMatch.overlap > 0 || bestMatch.gap <= toleranceFrames) {
      return bestMatch.candidate;
    }
  }

  const overlappingWords = fullMappedWords.filter((wordInfo) => {
    const wordSpan = getTimedWordFrameSpan([wordInfo]);
    return getFrameSpanOverlap(segmentSpan, wordSpan) > 0;
  });
  if (overlappingWords.length > 0) {
    return overlappingWords;
  }

  return fullMappedWords.filter((wordInfo) => {
    const wordSpan = getTimedWordFrameSpan([wordInfo]);
    return getFrameSpanGap(segmentSpan, wordSpan) <= toleranceFrames;
  });
}

function joinMappedSubtitleText(mappedWords, subtitleLanguage) {
  const defaultJoiner = getTargetWordJoiner(subtitleLanguage);
  return mappedWords.map((wordInfo, index) => {
    const joiner = index === 0
      ? ''
      : typeof wordInfo.joinerBefore === 'string'
        ? wordInfo.joinerBefore
        : defaultJoiner;
    return `${joiner}${wordInfo.word}`;
  }).join('').trim();
}

function wordsMatchTranslatedText(words, translatedText) {
  const normalizedWords = normalizeAlignmentText(
    words.map((wordInfo) => wordInfo.word).join(' '),
  );
  const normalizedTranslatedText = normalizeAlignmentText(translatedText);
  return Boolean(
    normalizedWords &&
    normalizedTranslatedText &&
    normalizedWords === normalizedTranslatedText
  );
}

function isExplicitMappedSubtitleItem(item = {}) {
  const renderMode = typeof item.subtitleRenderMode === 'string'
    ? item.subtitleRenderMode.trim().toLowerCase()
    : '';
  return (
    MAPPED_SUBTITLE_RENDER_MODES.has(renderMode) ||
    item.subtitleTimingMapped === true ||
    item.subtitle_timing_mapped === true ||
    item.subtitleAlignmentMapped === true ||
    item.subtitle_alignment_mapped === true
  );
}

function isExplicitStaticSubtitleItem(item = {}) {
  const renderMode = typeof item.subtitleRenderMode === 'string'
    ? item.subtitleRenderMode.trim().toLowerCase()
    : '';
  return (
    renderMode === 'static' ||
    item.isStaticSubtitle === true ||
    item.config?.staticSubtitle === true
  );
}

export function isMappedTranslatedSubtitleItem(item = {}) {
  return (
    item?.type === 'text' &&
    item?.subType === 'subtitle' &&
    isExplicitMappedSubtitleItem(item) &&
    normalizeTimedWords(item.words).length > 0
  );
}

export function getSubtitleTranslationContext(session = {}, item = {}) {
  const audioLayer = findItemAudioLayer(session, item) || {};
  const audioLanguage = firstConcreteLanguage(
    item.audioLanguage,
    item.audio_language,
    audioLayer.speechLanguage,
    audioLayer.speech_language,
    audioLayer.languageCode,
    audioLayer.language_code,
    session.sessionLanguage,
    session.session_language,
    session.language,
  );
  const subtitleLanguage = firstConcreteLanguage(
    item.subtitleLanguage,
    item.subtitle_language,
    audioLayer.subtitleLanguage,
    audioLayer.subtitle_language,
    session.subtitleLanguage,
    session.subtitle_language,
    audioLanguage,
  );
  const normalizedAudioLanguage = normalizeComparableSubtitleLanguage(audioLanguage);
  const normalizedSubtitleLanguage = normalizeComparableSubtitleLanguage(subtitleLanguage);
  const translationRequired =
    item.subtitleTranslationRequired === true ||
    item.subtitle_translation_required === true ||
    audioLayer.subtitleTranslationRequired === true ||
    audioLayer.subtitle_translation_required === true ||
    session.subtitleTranslationRequired === true ||
    session.subtitle_translation_required === true;

  return {
    audioLanguage,
    subtitleLanguage,
    translationRequired,
    isTranslated:
      session.enableSubtitles !== false &&
      Boolean(normalizedAudioLanguage) &&
      Boolean(normalizedSubtitleLanguage) &&
      normalizedAudioLanguage !== normalizedSubtitleLanguage,
  };
}

export function isStaticSubtitleItem(item = {}, session = {}) {
  if (item?.type !== 'text' || item?.subType !== 'subtitle') {
    return false;
  }

  if (isMappedTranslatedSubtitleItem(item)) {
    return false;
  }

  if (item.isStaticSubtitle === true || item.subtitleRenderMode === 'static') {
    return true;
  }

  return getSubtitleTranslationContext(session, item).isTranslated;
}

export function isMotionlessSubtitleItem(item = {}, session = {}) {
  return isStaticSubtitleItem(item, session) || isMappedTranslatedSubtitleItem(item);
}

function getTranslatedSubtitleText(item = {}, audioLayer = {}, alignmentMap = []) {
  const mappedText = alignmentMap.map((mapping) => mapping.translatedText).join(
    getTargetWordJoiner(item.subtitleLanguage || audioLayer.subtitleLanguage),
  );

  if (isExplicitMappedSubtitleItem(item)) {
    return firstNonEmptyString(
      item.text,
      item.subtitleText,
      item.subtitle_text,
      mappedText,
      audioLayer.subtitleText,
      audioLayer.subtitle_text,
    );
  }

  return firstNonEmptyString(
    item.subtitleText,
    item.subtitle_text,
    mappedText,
    audioLayer.subtitleText,
    audioLayer.subtitle_text,
    item.text,
  );
}

function getStaticTranslatedSubtitleText(item = {}, audioLayer = {}, alignmentMap = []) {
  const mappedText = alignmentMap.map((mapping) => mapping.translatedText).join(
    getTargetWordJoiner(item.subtitleLanguage || audioLayer.subtitleLanguage),
  );

  if (isExplicitStaticSubtitleItem(item)) {
    return firstNonEmptyString(
      item.text,
      item.subtitleText,
      item.subtitle_text,
      audioLayer.subtitleText,
      audioLayer.subtitle_text,
      mappedText,
    );
  }

  return firstNonEmptyString(
    item.subtitleText,
    item.subtitle_text,
    audioLayer.subtitleText,
    audioLayer.subtitle_text,
    mappedText,
    item.text,
  );
}

function getLocalizedSpeakerName(item = {}, audioLayer = {}) {
  return firstNonEmptyString(
    item.subtitleSpeakerCharacterName,
    item.subtitle_speaker_character_name,
    audioLayer.subtitleSpeakerCharacterName,
    audioLayer.subtitle_speaker_character_name,
    item.speaker,
  );
}

function getSafeSubtitleFonts(item, targetLanguage) {
  const existingConfig = item.config || {};
  const fontFamily = resolveSubtitleFont(
    targetLanguage,
    existingConfig.fontFamily || item.fontFamily,
  );
  // Speaker labels should feel like part of the subtitle, not a second caption
  // style. Use the exact same target-language-safe family as the body text.
  const speakerFontFamily = fontFamily;

  return { existingConfig, fontFamily, speakerFontFamily };
}

function prepareMappedSubtitleItem(item, session, translationContext, audioLayer) {
  const alignmentMap = getSubtitleAlignmentMap(item, audioLayer);
  const targetLanguage = firstConcreteLanguage(
    item.subtitleLanguage,
    item.subtitle_language,
    translationContext.subtitleLanguage,
    translationContext.audioLanguage,
  );
  let translatedText = getTranslatedSubtitleText(item, audioLayer, alignmentMap);
  let timedWords = normalizeTimedWords(item.words);

  const itemAlreadyMapped = (
    isExplicitMappedSubtitleItem(item) ||
    wordsMatchTranslatedText(timedWords, translatedText)
  );

  if (!itemAlreadyMapped) {
    const segmentSourceWords = timedWords;
    const fullSourceWords = buildTimedWordsFromTranscriptAlignment(audioLayer, session);
    let mappedWords = [];

    if (segmentSourceWords.length > 0 && fullSourceWords.length > 0) {
      const fullMappedWords = mapSubtitleAlignmentToTimedWords(
        fullSourceWords,
        alignmentMap,
        { subtitleLanguage: targetLanguage },
      );
      mappedWords = selectMappedWordsForSourceSegment(
        fullMappedWords,
        segmentSourceWords,
      );
    }

    if (mappedWords.length === 0) {
      const sourceWords = segmentSourceWords.length > 0
        ? segmentSourceWords
        : fullSourceWords;
      mappedWords = mapSubtitleAlignmentToTimedWords(sourceWords, alignmentMap, {
        subtitleLanguage: targetLanguage,
      });
    }

    timedWords = mappedWords;
    if (timedWords.length > 0) {
      translatedText = joinMappedSubtitleText(timedWords, targetLanguage);
    }
  }

  if (!translatedText || timedWords.length === 0) {
    return null;
  }

  const targetWordJoiner = getTargetWordJoiner(targetLanguage);
  timedWords = timedWords.map((wordInfo, index) => ({
    ...wordInfo,
    joinerBefore: index === 0
      ? ''
      : typeof wordInfo.joinerBefore === 'string'
        ? wordInfo.joinerBefore
        : targetWordJoiner,
  }));

  const { existingConfig, fontFamily, speakerFontFamily } = getSafeSubtitleFonts(
    item,
    targetLanguage,
  );
  const breakTextWidth = existingConfig.breakTextWidth ?? item.breakTextWidth;
  const speaker = getLocalizedSpeakerName(item, audioLayer);
  const { animation: _ignoredAnimation, ...itemWithoutLegacyAnimation } = item;

  return {
    ...itemWithoutLegacyAnimation,
    text: translatedText,
    config: {
      ...existingConfig,
      fontFamily,
      speakerFontFamily,
      autoWrap: true,
      breakLongWords: true,
      ...(breakTextWidth != null ? { breakTextWidth } : {}),
      staticSubtitle: false,
    },
    animations: [],
    words: timedWords,
    wordAnimation: item.wordAnimation || audioLayer.subtitleWordAnimation || 'highlight',
    textAccent: item.textAccent || null,
    ...(speaker ? { speaker } : {}),
    speakerFont: speakerFontFamily,
    speakerFontFamily,
    subtitleLanguage: targetLanguage || null,
    audioLanguage: translationContext.audioLanguage || item.audioLanguage || null,
    subtitleRenderMode: 'translated_cue',
    subtitleTimingMapped: true,
    subtitleAlignmentMapped: true,
    subtitleTimingBase:
      item.subtitleTimingBase || item.subtitle_timing_base || 'session',
    isStaticSubtitle: false,
  };
}

function getSubtitleItemFrameRange(item = {}) {
  const frameOffset = Number(item?.config?.frameOffset);
  const frameDuration = Number(item?.config?.frameDuration);
  if (
    !Number.isFinite(frameOffset) ||
    !Number.isFinite(frameDuration) ||
    frameDuration < 0
  ) {
    return null;
  }

  return {
    startFrame: frameOffset,
    endFrame: frameOffset + frameDuration,
  };
}

function getCombinedSubtitleItemFrameRange(items = []) {
  const ranges = items.map(getSubtitleItemFrameRange).filter(Boolean);
  if (ranges.length === 0) {
    return null;
  }

  return {
    startFrame: Math.min(...ranges.map((range) => range.startFrame)),
    endFrame: Math.max(...ranges.map((range) => range.endFrame)),
  };
}

function applyCombinedSubtitleItemFrameRange(item, range) {
  if (!item || !range) {
    return item;
  }

  return {
    ...item,
    config: {
      ...(item.config || {}),
      frameOffset: range.startFrame,
      frameDuration: Math.max(1, range.endFrame - range.startFrame),
    },
  };
}

function getMappedCueIdentity(wordInfo = {}) {
  const mappingIndex = Number(wordInfo.mappingIndex);
  const sourceText = normalizeAlignmentText(wordInfo.sourceText);
  const translatedText = normalizeAlignmentText(firstNonEmptyString(
    wordInfo.translatedText,
    wordInfo.translatedPhrase,
  ));
  const identityText = sourceText || translatedText
    ? `${sourceText}:${translatedText}`
    : normalizeAlignmentText(wordInfo.word);
  if (
    wordInfo.mappingIndex != null &&
    Number.isInteger(mappingIndex) &&
    mappingIndex >= 0
  ) {
    // Some producers restart mappingIndex for each segment. Keep the index for
    // ordering, but include phrase identity so unrelated local index 0 cues do
    // not collapse together.
    return `mapping:${mappingIndex}:${identityText}`;
  }

  const sourceWordStartIndex = Number(wordInfo.sourceWordStartIndex);
  const sourceWordEndIndex = Number(wordInfo.sourceWordEndIndex);
  const hasSourceWordStartIndex = (
    wordInfo.sourceWordStartIndex != null && Number.isInteger(sourceWordStartIndex)
  );
  const hasSourceWordEndIndex = (
    wordInfo.sourceWordEndIndex != null && Number.isInteger(sourceWordEndIndex)
  );
  if (
    sourceText ||
    hasSourceWordStartIndex ||
    hasSourceWordEndIndex
  ) {
    return [
      'text',
      sourceText,
      translatedText,
      hasSourceWordStartIndex ? sourceWordStartIndex : '',
      hasSourceWordEndIndex ? sourceWordEndIndex : '',
    ].join(':');
  }

  const frameOffset = Number(wordInfo.frameOffset);
  const frameDuration = Number(wordInfo.frameDuration);
  return `timing:${frameOffset}:${frameDuration}:${normalizeAlignmentText(wordInfo.word)}`;
}

function collapseMappedWordsToUniqueCues(mappedItems, subtitleLanguage) {
  const cueGroups = [];
  const cueGroupsByIdentity = new Map();
  let sequenceIndex = 0;

  mappedItems.forEach((item) => {
    normalizeTimedWords(item.words).forEach((wordInfo) => {
      const identity = getMappedCueIdentity(wordInfo);
      const startFrame = wordInfo.frameOffset;
      const endFrame = wordInfo.frameOffset + wordInfo.frameDuration;
      const identityGroups = cueGroupsByIdentity.get(identity) || [];
      const existing = identityGroups.find((group) => (
        startFrame < group.endFrame && endFrame > group.startFrame
      ));

      if (!existing) {
        const group = {
          identity,
          occurrenceIndex: identityGroups.length,
          sequenceIndex,
          words: [wordInfo],
          startFrame,
          endFrame,
        };
        identityGroups.push(group);
        cueGroupsByIdentity.set(identity, identityGroups);
        cueGroups.push(group);
        sequenceIndex += 1;
        return;
      }

      existing.words.push(wordInfo);
      existing.startFrame = Math.min(existing.startFrame, startFrame);
      existing.endFrame = Math.max(existing.endFrame, endFrame);
    });
  });

  const defaultJoiner = getTargetWordJoiner(subtitleLanguage);
  return cueGroups
    .sort((first, second) => (
      first.startFrame - second.startFrame || first.sequenceIndex - second.sequenceIndex
    ))
    .map((group, cueIndex) => {
      const firstWord = group.words[0];
      const translatedPhrase = firstNonEmptyString(
        firstWord.translatedText,
        firstWord.translatedPhrase,
      );
      const word = translatedPhrase || group.words.map((wordInfo, wordIndex) => {
        const joiner = wordIndex === 0
          ? ''
          : typeof wordInfo.joinerBefore === 'string'
            ? wordInfo.joinerBefore
            : defaultJoiner;
        return `${joiner}${wordInfo.word}`;
      }).join('').trim();

      return {
        ...firstWord,
        word,
        frameOffset: group.startFrame,
        frameDuration: Math.max(1, group.endFrame - group.startFrame),
        joinerBefore: cueIndex === 0 ? '' : defaultJoiner,
        translatedPhrase: word,
        translatedCueIndex: cueIndex,
        translatedCueIdentity: `${group.identity}:occurrence:${group.occurrenceIndex}`,
      };
    });
}

function getTranslatedSubtitleGroupKey(item, itemIndex) {
  const audioLayerId = item?.audioLayerId?.toString?.() || '';
  return audioLayerId ? `audio:${audioLayerId}` : `item:${itemIndex}`;
}

function getOrderedSubtitleGroupItems(groupItems) {
  return [...groupItems].sort((first, second) => {
    const firstRange = getSubtitleItemFrameRange(first.item);
    const secondRange = getSubtitleItemFrameRange(second.item);
    const firstStart = firstRange?.startFrame ?? Number.POSITIVE_INFINITY;
    const secondStart = secondRange?.startFrame ?? Number.POSITIVE_INFINITY;
    return firstStart - secondStart || first.index - second.index;
  });
}

function prepareTranslatedSubtitleGroup(groupItems, session) {
  const orderedItems = getOrderedSubtitleGroupItems(groupItems);
  const ownerEntry = orderedItems[0];
  const owner = ownerEntry.item;
  const translationContext = ownerEntry.translationContext;
  const audioLayer = findItemAudioLayer(session, owner) || {};
  const combinedRange = getCombinedSubtitleItemFrameRange(
    orderedItems.map((entry) => entry.item),
  );
  const mappedResults = orderedItems.map((entry) => prepareMappedSubtitleItem(
    entry.item,
    session,
    entry.translationContext,
    findItemAudioLayer(session, entry.item) || audioLayer,
  ));
  const mappedItems = mappedResults.filter(Boolean);

  if (mappedItems.length !== orderedItems.length) {
    // A partially mapped group would silently lose the unmatched source cue.
    // Prefer one complete, non-repeating static translation for the group.
    return applyCombinedSubtitleItemFrameRange(
      prepareStaticSubtitleItem(owner, session, translationContext),
      combinedRange,
    );
  }

  const targetLanguage = firstConcreteLanguage(
    mappedItems[0].subtitleLanguage,
    translationContext.subtitleLanguage,
    translationContext.audioLanguage,
  );
  const words = collapseMappedWordsToUniqueCues(mappedItems, targetLanguage);
  if (words.length === 0) {
    return applyCombinedSubtitleItemFrameRange(
      prepareStaticSubtitleItem(owner, session, translationContext),
      combinedRange,
    );
  }

  const preparedOwner = mappedItems[0];
  return applyCombinedSubtitleItemFrameRange({
    ...preparedOwner,
    text: joinMappedSubtitleText(words, targetLanguage),
    words,
    subtitleRenderMode: 'translated_cue',
    subtitleTimingMapped: true,
    subtitleAlignmentMapped: true,
    isStaticSubtitle: false,
  }, combinedRange);
}

function prepareStaticSubtitleItem(item, session, translationContext = getSubtitleTranslationContext(session, item)) {
  const audioLayer = findItemAudioLayer(session, item) || {};
  const alignmentMap = getSubtitleAlignmentMap(item, audioLayer);
  const targetLanguage = firstConcreteLanguage(
    item.subtitleLanguage,
    item.subtitle_language,
    translationContext.subtitleLanguage,
    translationContext.audioLanguage,
  );
  const { existingConfig, fontFamily, speakerFontFamily } = getSafeSubtitleFonts(
    item,
    targetLanguage,
  );
  const breakTextWidth = existingConfig.breakTextWidth ?? item.breakTextWidth;
  const speaker = getLocalizedSpeakerName(item, audioLayer);
  const translatedText = translationContext.isTranslated
    ? getStaticTranslatedSubtitleText(item, audioLayer, alignmentMap)
    : firstNonEmptyString(item.text);
  const { animation: _ignoredAnimation, ...itemWithoutLegacyAnimation } = item;

  return {
    ...itemWithoutLegacyAnimation,
    ...(translatedText ? { text: translatedText } : {}),
    config: {
      ...existingConfig,
      fontFamily,
      speakerFontFamily,
      autoWrap: true,
      ...(breakTextWidth != null ? { breakTextWidth } : {}),
      staticSubtitle: true,
    },
    animations: [],
    words: [],
    wordAnimation: null,
    textAccent: null,
    ...(speaker ? { speaker } : {}),
    speakerFont: speakerFontFamily,
    speakerFontFamily,
    subtitleLanguage: targetLanguage || null,
    audioLanguage: translationContext.audioLanguage || item.audioLanguage || null,
    subtitleRenderMode: 'static',
    isStaticSubtitle: true,
  };
}

export function prepareLayerSubtitlesForRendering(layer = {}, session = {}) {
  const activeItemList = layer?.imageSession?.activeItemList;
  if (!Array.isArray(activeItemList) || activeItemList.length === 0) {
    return layer;
  }

  const translatedGroups = new Map();
  const translatedGroupKeyByIndex = new Map();

  activeItemList.forEach((item, index) => {
    if (item?.type !== 'text' || item?.subType !== 'subtitle') {
      return;
    }

    const translationContext = getSubtitleTranslationContext(session, item);
    if (
      !translationContext.isTranslated ||
      isExplicitStaticSubtitleItem(item)
    ) {
      return;
    }

    const groupKey = getTranslatedSubtitleGroupKey(item, index);
    const groupItems = translatedGroups.get(groupKey) || [];
    groupItems.push({ item, index, translationContext });
    translatedGroups.set(groupKey, groupItems);
    translatedGroupKeyByIndex.set(index, groupKey);
  });

  const preparedTranslatedGroups = new Map(
    Array.from(translatedGroups.entries()).map(([groupKey, groupItems]) => [
      groupKey,
      {
        firstIndex: Math.min(...groupItems.map((entry) => entry.index)),
        item: prepareTranslatedSubtitleGroup(groupItems, session),
      },
    ]),
  );

  let changed = preparedTranslatedGroups.size > 0;
  const preparedActiveItemList = activeItemList.flatMap((item, index) => {
    const translatedGroupKey = translatedGroupKeyByIndex.get(index);
    if (translatedGroupKey) {
      const preparedGroup = preparedTranslatedGroups.get(translatedGroupKey);
      return index === preparedGroup.firstIndex && preparedGroup.item
        ? [preparedGroup.item]
        : [];
    }

    if (item?.type !== 'text' || item?.subType !== 'subtitle') {
      return [item];
    }

    const translationContext = getSubtitleTranslationContext(session, item);
    if (!isStaticSubtitleItem(item, session)) {
      return [item];
    }

    changed = true;
    return [prepareStaticSubtitleItem(item, session, translationContext)];
  });

  if (!changed) {
    return layer;
  }

  return {
    ...layer,
    imageSession: {
      ...layer.imageSession,
      activeItemList: preparedActiveItemList,
    },
  };
}
