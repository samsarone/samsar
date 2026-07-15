// SubtitleAnimations.js

import { wrapText } from '../utils/TextUtils.js';
import { getFramesPerSecondFromValue } from '../utils/FpsUtils.js';
import { getSubtitleEndFrameExclusive } from '../utils/FrameTimingUtils.js';
import {
  isMappedTranslatedSubtitleItem,
  isStaticSubtitleItem,
} from '../utils/SubtitleRenderPolicy.js';

const textWordCustomAnimations = [
  'bleeding',
  'glowing',
  'throbbing',
  'shimmering',
  'wobbling',
  'rising'
];

const DEFAULT_FONT_FALLBACKS = ['Poppins', 'Montserrat', 'Arial', 'sans-serif'];
const THAI_FONT_FALLBACKS = ['Sarabun', ...DEFAULT_FONT_FALLBACKS];
const GENERIC_LATIN_FONTS = ['poppins', 'montserrat', 'arial', 'sans-serif'];
const fontStackLog = new Set();
const thaiFontWarnings = new Set();
const THAI_RANGE_REGEX = /[\u0E00-\u0E7F]/;
const MAX_SUBTITLE_LINES_PER_PAGE = 2;
const SUBTITLE_EDGE_FADE_FRAMES = 3;
const HIGHLIGHT_EDGE_FADE_FRAMES = 2;
const TRANSLATED_CUE_EDGE_FADE_FRAMES = 3;
const TRANSLATED_CUE_HOLD_FRAMES = 4;
const TRANSLATED_PAGE_HANDOFF_FRAMES = 2;
const PORTRAIT_SUBTITLE_SIDE_PADDING_RATIO = 0.1;
const LANDSCAPE_SUBTITLE_SIDE_PADDING_RATIO = 0.06;
const MIN_SUBTITLE_SIDE_PADDING_PX = 48;
const MAX_SUBTITLE_SIDE_PADDING_PX = 144;

function getDimensionAwareSubtitleWidth(ctx, item, config = {}) {
  const canvasWidth = Number(ctx?.canvas?.width);
  const canvasHeight = Number(ctx?.canvas?.height);
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0) {
    const configuredWidth = Number(config.breakTextWidth ?? item?.breakTextWidth);
    return Number.isFinite(configuredWidth) && configuredWidth > 0
      ? configuredWidth
      : 800;
  }

  const isPortrait = Number.isFinite(canvasHeight) && canvasHeight > canvasWidth;
  const paddingRatio = isPortrait
    ? PORTRAIT_SUBTITLE_SIDE_PADDING_RATIO
    : LANDSCAPE_SUBTITLE_SIDE_PADDING_RATIO;
  const sidePadding = Math.min(
    MAX_SUBTITLE_SIDE_PADDING_PX,
    Math.max(MIN_SUBTITLE_SIDE_PADDING_PX, canvasWidth * paddingRatio),
  );
  const safeWidth = Math.max(1, canvasWidth - sidePadding * 2);
  const configuredWidth = Number(config.breakTextWidth ?? item?.breakTextWidth);

  return Number.isFinite(configuredWidth) && configuredWidth > 0
    ? Math.min(configuredWidth, safeWidth)
    : safeWidth;
}

function toFontListString(fonts) {
  return fonts.map((font) => (font.includes(' ') ? `"${font}"` : font)).join(', ');
}

function getFontStyle(emphasis) {
  if (emphasis === 'bold') {
    return 'bold ';
  }
  if (emphasis === 'italic') {
    return 'italic ';
  }
  return '';
}

function buildFontString(fontSize, fontEmphasis, fontFamily) {
  return `${getFontStyle(fontEmphasis)}${fontSize}px ${fontFamily}`;
}

function buildFontStack(fontFamily, itemLabel = 'text', sampleText = '') {
  const hasThaiText = THAI_RANGE_REGEX.test(sampleText || '');
  const normalizedFont = fontFamily && typeof fontFamily === 'string' ? fontFamily.trim() : '';
  const preferThaiDefaults =
    hasThaiText &&
    (!normalizedFont || GENERIC_LATIN_FONTS.includes(normalizedFont.toLowerCase()));

  const stack = [];

  if (preferThaiDefaults) {
    stack.push(THAI_FONT_FALLBACKS[0]);
  } else if (normalizedFont && normalizedFont.length > 0) {
    stack.push(normalizedFont);
  } else {
    stack.push('Noto Sans');
  }

  stack.push(...(hasThaiText ? THAI_FONT_FALLBACKS : DEFAULT_FONT_FALLBACKS));

  const deduped = [...new Set(stack)];
  const fontListString = toFontListString(deduped);
  const logKey = `${itemLabel}:${deduped[0]}`;

  if (!fontStackLog.has(logKey)) {
    const contextNote = hasThaiText ? ' (Thai glyphs detected; Thai-safe defaults applied)' : '';
    console.info(`[SubtitleFonts] Using font stack for ${itemLabel}: ${fontListString}${contextNote}`);
    fontStackLog.add(logKey);
  }

  if (hasThaiText && !deduped.some((font) => font.toLowerCase().includes('thai') || font.toLowerCase().includes('sarabun'))) {
    if (!thaiFontWarnings.has(deduped[0])) {
      console.warn(
        `[SubtitleFonts] Thai text detected but primary font "${deduped[0]}" may not include Thai glyphs. Stack: ${fontListString}`
      );
      thaiFontWarnings.add(deduped[0]);
    }
  }

  return fontListString;
}

function getEffectiveConfig(item) {
  const config = item?.config || {};
  if (item?.speakerFont && !config.speakerFontFamily) {
    return { ...config, speakerFontFamily: item.speakerFont };
  }
  return config;
}

function getSpeakerStyles(config = {}, bodyFontString = '') {
  const speakerFontFamily = config.fontFamily || DEFAULT_FONT_FALLBACKS[0];
  const speakerFillColor = config.fillColor || '#BFDBFE';
  const speakerStrokeColor = config.strokeColor;
  const speakerStrokeWidth = config.strokeWidth;
  const resolvedBodyFont = typeof bodyFontString === 'string' && bodyFontString.trim()
    ? bodyFontString
    : buildFontString(
      config.fontSize || 40,
      config.fontEmphasis,
      buildFontStack(speakerFontFamily, 'subtitle'),
    );
  const bodyFontSize = Number(config.fontSize);
  const speakerFontSize = (Number.isFinite(bodyFontSize) ? bodyFontSize : 40) + 1;
  const speakerFontString = resolvedBodyFont.replace(
    /(?:\d+(?:\.\d+)?)px/u,
    `${speakerFontSize}px`,
  );

  return {
    // The label is part of the caption. Preserve the exact resolved weight,
    // family, and glyph fallbacks, with only the requested one-pixel lift.
    fontString: speakerFontString,
    fillColor: speakerFillColor,
    strokeColor: speakerStrokeColor,
    strokeWidth: speakerStrokeWidth,
  };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function multiplyContextAlpha(ctx, factor) {
  const currentAlpha = Number(ctx.globalAlpha);
  ctx.globalAlpha = (Number.isFinite(currentAlpha) ? currentAlpha : 1) * clamp01(factor);
}

function getSubtitleItemEdgeAlpha(item, elapsedTime, durationOffset, framesPerSecond) {
  const config = item?.config || {};
  const cueStartFrameSession = Number(
    item?.subtitleCueStartFrameSession ?? item?.subtitle_cue_start_frame_session,
  );
  const cueEndFrameSession = Number(
    item?.subtitleCueEndFrameSession ?? item?.subtitle_cue_end_frame_session,
  );
  if (
    Number.isFinite(cueStartFrameSession) &&
    Number.isFinite(cueEndFrameSession) &&
    cueEndFrameSession > cueStartFrameSession
  ) {
    const currentFrameSession = (Number(elapsedTime) * framesPerSecond) / 1000;
    const cueDuration = cueEndFrameSession - cueStartFrameSession;
    const fadeFrames = Math.max(
      1,
      Math.min(SUBTITLE_EDGE_FADE_FRAMES, Math.floor(cueDuration / 2) || 1),
    );
    const fadeIn = smoothstep(
      (currentFrameSession - cueStartFrameSession + 1) / fadeFrames,
    );
    const fadeOut = smoothstep(
      (cueEndFrameSession - currentFrameSession) / fadeFrames,
    );
    return Math.min(fadeIn, fadeOut);
  }

  const startFrame = Number(config.frameOffset);
  const frameDuration = Number(config.frameDuration);
  if (
    !Number.isFinite(startFrame) ||
    !Number.isFinite(frameDuration) ||
    frameDuration <= 0
  ) {
    return 1;
  }

  const durationOffsetSeconds = Number(durationOffset) || 0;
  const durationOffsetFrames = durationOffsetSeconds * framesPerSecond;
  const currentFrameLocal = (
    (Number(elapsedTime) - durationOffsetSeconds * 1000) * framesPerSecond
  ) / 1000;
  const endFrame = getSubtitleEndFrameExclusive(item, {
    durationOffsetFrames,
  }) ?? (startFrame + frameDuration);
  const effectiveDuration = Math.max(1, endFrame - startFrame);
  const fadeFrames = Math.max(
    1,
    Math.min(SUBTITLE_EDGE_FADE_FRAMES, Math.floor(effectiveDuration / 2) || 1),
  );
  const fadeIn = smoothstep((currentFrameLocal - startFrame + 1) / fadeFrames);
  const fadeOut = smoothstep((endFrame - currentFrameLocal) / fadeFrames);
  return Math.min(fadeIn, fadeOut);
}

const ENTRANCE_ANIMATIONS = new Set(['fade-in', 'slide-in', 'typewriter']);
const EXIT_ANIMATIONS = new Set(['fade-out', 'slide-out']);

function getAnimationPriority(type) {
  if (EXIT_ANIMATIONS.has(type)) {
    return 3;
  }
  if (type === 'typewriter') {
    return 2;
  }
  return ENTRANCE_ANIMATIONS.has(type) ? 1 : 0;
}

function renderAnimationState(
  ctx,
  item,
  state,
  elapsedTime,
  durationOffset,
  framesPerSecond,
) {
  const linearProgress = state.totalDuration > 0
    ? clamp01((elapsedTime - state.startTime) / state.totalDuration)
    : 1;
  const progress = smoothstep(linearProgress);

  switch (state.type) {
    case 'typewriter':
      applyTypewriterEffect(ctx, item, progress, elapsedTime, durationOffset, framesPerSecond);
      break;
    case 'fade-in':
      applyFadeInEffect(ctx, item, progress, elapsedTime, durationOffset, framesPerSecond);
      break;
    case 'fade-out':
      applyFadeOutEffect(ctx, item, progress, elapsedTime, durationOffset, framesPerSecond);
      break;
    case 'slide-in':
      applySlideInEffect(ctx, item, progress, elapsedTime, durationOffset, framesPerSecond);
      break;
    case 'slide-out':
      applySlideOutEffect(ctx, item, progress, elapsedTime, durationOffset, framesPerSecond);
      break;
    default:
      renderText(ctx, item, elapsedTime, durationOffset, framesPerSecond);
  }
}

function getSpeakerLabel(item) {
  if (item && item.showSpeaker && item.speaker) {
    const label = `${item.speaker}`.trim();
    if (!label) {
      return null;
    }
    return /[:：]$/u.test(label) ? label : `${label}:`;
  }
  return null;
}

function measureSpeakerLabelWidth(ctx, speakerLabel, speakerStyles, speakerGapPx) {
  if (!speakerLabel || !speakerStyles) {
    return 0;
  }
  const originalFont = ctx.font;
  ctx.font = speakerStyles.fontString;
  const width = ctx.measureText(speakerLabel).width + speakerGapPx;
  ctx.font = originalFont;
  return width;
}

function drawSpeakerLabel(ctx, speakerLabel, speakerStyles, x, y, shadowConfig) {
  if (!speakerLabel || !speakerStyles) {
    return;
  }

  const originalFont = ctx.font;
  const originalFill = ctx.fillStyle;
  const originalStroke = ctx.strokeStyle;
  const originalLineWidth = ctx.lineWidth;
  const originalShadowColor = ctx.shadowColor;
  const originalShadowBlur = ctx.shadowBlur;
  const originalShadowOffsetX = ctx.shadowOffsetX;
  const originalShadowOffsetY = ctx.shadowOffsetY;

  ctx.font = speakerStyles.fontString;
  if (speakerStyles.strokeColor && speakerStyles.strokeWidth) {
    ctx.strokeStyle = speakerStyles.strokeColor;
    ctx.lineWidth = speakerStyles.strokeWidth;
  }
  ctx.fillStyle = speakerStyles.fillColor;

  if (shadowConfig) {
    const {
      color = ctx.shadowColor,
      blur = ctx.shadowBlur,
      offsetX = ctx.shadowOffsetX,
      offsetY = ctx.shadowOffsetY
    } = shadowConfig;

    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = offsetX;
    ctx.shadowOffsetY = offsetY;
  }

  if (speakerStyles.strokeColor && speakerStyles.strokeWidth) {
    ctx.strokeText(speakerLabel, x, y);
  }
  ctx.fillText(speakerLabel, x, y);

  ctx.font = originalFont;
  ctx.fillStyle = originalFill;
  ctx.strokeStyle = originalStroke;
  ctx.lineWidth = originalLineWidth;
  ctx.shadowColor = originalShadowColor;
  ctx.shadowBlur = originalShadowBlur;
  ctx.shadowOffsetX = originalShadowOffsetX;
  ctx.shadowOffsetY = originalShadowOffsetY;
}

export function applyTextSubtitleAnimations(ctx, item, elapsedTime, durationOffset = 0, framesPerSecond) {
  const { animations } = item;
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  const renderAsStaticSubtitle = isStaticSubtitleItem(item);
  const renderAsMappedSubtitle = isMappedTranslatedSubtitleItem(item);

  const hasAnimations =
    !renderAsStaticSubtitle &&
    !renderAsMappedSubtitle &&
    Array.isArray(animations) &&
    animations.length > 0;

  if (item.subType === 'subtitle') {
    const existingConfig = item.config || {};
    const breakTextWidth = getDimensionAwareSubtitleWidth(ctx, item, existingConfig);
    item.config = {
      ...existingConfig,
      // Persisted subtitle items can predate responsive wrapping or carry a
      // width from a different render aspect ratio. Always constrain captions
      // to the current canvas so portrait renders cannot clip at either edge.
      autoWrap: true,
      breakTextWidth,
      breakLongWords: true,
      linePaddingPx: existingConfig.linePaddingPx != null ? existingConfig.linePaddingPx : 0,
      ...(renderAsStaticSubtitle ? { staticSubtitle: true } : {}),
    };
  }

  const originalText = item.text;
  ctx.save();
  multiplyContextAlpha(
    ctx,
    renderAsMappedSubtitle
      ? 1
      : getSubtitleItemEdgeAlpha(
        item,
        elapsedTime,
        durationOffset,
        effectiveFramesPerSecond,
      ),
  );

  try {
    if (renderAsStaticSubtitle) {
      renderText(
        ctx,
        {
          ...item,
          animations: [],
          words: [],
          wordAnimation: null,
          textAccent: null,
        },
        elapsedTime,
        durationOffset,
        effectiveFramesPerSecond,
      );
      return;
    }

    if (!hasAnimations) {
      renderText(ctx, item, elapsedTime, durationOffset, effectiveFramesPerSecond);
      return;
    }

    const millisecondsPerFrame = 1000 / effectiveFramesPerSecond;
    const animationStates = animations.map((animation, originalIndex) => {
      const startFrame = Number(animation?.startFrame);
      const endFrame = Number(animation?.endFrame);
      if (!Number.isFinite(startFrame) || !Number.isFinite(endFrame)) {
        return null;
      }

      const startTime = startFrame * millisecondsPerFrame;
      const endTime = Math.max(startTime, endFrame * millisecondsPerFrame);
      return {
        ...animation,
        originalIndex,
        startTime,
        endTime,
        totalDuration: endTime - startTime,
      };
    }).filter(Boolean).sort((first, second) => (
      first.startTime - second.startTime ||
      getAnimationPriority(first.type) - getAnimationPriority(second.type) ||
      first.originalIndex - second.originalIndex
    ));

    if (animationStates.length === 0) {
      renderText(ctx, item, elapsedTime, durationOffset, effectiveFramesPerSecond);
      return;
    }

    const activeState = animationStates.filter((state) => (
      elapsedTime >= state.startTime && elapsedTime < state.endTime
    )).at(-1);

    if (activeState) {
      renderAnimationState(
        ctx,
        item,
        activeState,
        elapsedTime,
        durationOffset,
        effectiveFramesPerSecond,
      );
      return;
    }

    const lastStartedState = animationStates.filter(
      (state) => elapsedTime >= state.startTime,
    ).at(-1);
    if (lastStartedState) {
      if (!EXIT_ANIMATIONS.has(lastStartedState.type)) {
        renderText(ctx, item, elapsedTime, durationOffset, effectiveFramesPerSecond);
      }
      return;
    }

    if (EXIT_ANIMATIONS.has(animationStates[0].type)) {
      renderText(ctx, item, elapsedTime, durationOffset, effectiveFramesPerSecond);
    }
  } finally {
    item.text = originalText;
    ctx.restore();
  }
}

function applyTypewriterEffect(ctx, item, t, elapsedTime, durationOffset = 0, framesPerSecond) {
  const { text } = item;
  const config = getEffectiveConfig(item);
  const speakerLabel = getSpeakerLabel(item);

  setupTextContext(ctx, config, item);

  const totalCharacters = text.length;
  const currentCharacters = Math.floor(totalCharacters * t);
  const displayText = text.substring(0, currentCharacters);

  // Typewriter: no word highlight, just partial text
  renderExactText(
    ctx,
    displayText,
    config,
    elapsedTime,
    [],
    null,
    item.textAccent,
    speakerLabel,
    durationOffset,
    framesPerSecond
  );
}

function applyFadeInEffect(ctx, item, t, elapsedTime, durationOffset = 0, framesPerSecond) {
  ctx.save();
  multiplyContextAlpha(ctx, t);
  renderText(ctx, item, elapsedTime, durationOffset, framesPerSecond);
  ctx.restore();
}

function applyFadeOutEffect(ctx, item, t, elapsedTime, durationOffset = 0, framesPerSecond) {
  ctx.save();
  multiplyContextAlpha(ctx, 1 - t);
  renderText(ctx, item, elapsedTime, durationOffset, framesPerSecond);
  ctx.restore();
}

function applySlideInEffect(ctx, item, t, elapsedTime, durationOffset = 0, framesPerSecond) {
  // Just fade in for simplicity
  ctx.save();
  multiplyContextAlpha(ctx, t);
  renderText(ctx, item, elapsedTime, durationOffset, framesPerSecond);
  ctx.restore();
}

function applySlideOutEffect(ctx, item, t, elapsedTime, durationOffset = 0, framesPerSecond) {
  // Just fade out for simplicity
  ctx.save();
  multiplyContextAlpha(ctx, 1 - t);
  renderText(ctx, item, elapsedTime, durationOffset, framesPerSecond);
  ctx.restore();
}

function setupTextContext(ctx, config, item) {
  let {
    fontSize = 40,
    fontFamily,
    fillColor = '#BFDBFE', // Default to a Tailwind -200 shade
    strokeColor,
    strokeWidth,
    fontEmphasis,
    textShadow
  } = config;

  const normalizedFontFamily = typeof fontFamily === 'string' ? fontFamily.trim() : '';
  if (!normalizedFontFamily) {
    fontFamily = item?.subType === 'subtitle' ? 'Poppins' : 'Montserrat';
  } else {
    fontFamily = normalizedFontFamily;
  }

  const fontSample = [item?.text, item?.speaker]
    .filter((value) => typeof value === 'string' && value.trim())
    .join(' ');
  const resolvedFontFamily = buildFontStack(fontFamily, item?.subType || 'text', fontSample);

  ctx.textBaseline = 'middle';
  ctx.font = buildFontString(fontSize, fontEmphasis, resolvedFontFamily);
  ctx.fillStyle = fillColor;
  ctx.textAlign = 'center'; // Force center alignment

  if (textShadow) {
    const {
      color = 'rgba(0, 0, 0, 0.3)',
      blur = 4,
      offsetX = 2,
      offsetY = 2
    } = textShadow;

    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = offsetX;
    ctx.shadowOffsetY = offsetY;
  } else {
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }
}

function getWordJoinerWidth(ctx, wordInfo, config = {}) {
  const {
    wordSpacing = 1.0,
    wordPaddingPx = 0,
  } = config;
  const joiner = typeof wordInfo?.joinerBefore === 'string'
    ? wordInfo.joinerBefore
    : ' ';

  if (!joiner) {
    return 0;
  }

  return ctx.measureText(joiner).width * wordSpacing + wordPaddingPx;
}

function groupDisplayChunksToAvailableFrames(chunks, frameDuration, joiner) {
  const availableFrames = Math.max(1, Math.floor(frameDuration));
  if (chunks.length <= availableFrames) {
    return chunks;
  }

  return Array.from({ length: availableFrames }, (_, groupIndex) => {
    const startIndex = Math.floor((groupIndex * chunks.length) / availableFrames);
    const endIndex = Math.floor(((groupIndex + 1) * chunks.length) / availableFrames);
    return chunks.slice(startIndex, Math.max(startIndex + 1, endIndex)).join(joiner);
  });
}

function splitTimedWordAcrossChunks(ctx, wordInfo, rawChunks, internalJoiner) {
  const frameDuration = Math.max(1, Math.round(Number(wordInfo.frameDuration) || 0));
  const chunks = groupDisplayChunksToAvailableFrames(
    rawChunks,
    frameDuration,
    internalJoiner,
  );
  if (chunks.length <= 1) {
    return [wordInfo];
  }

  const widths = chunks.map((chunk) => Math.max(1, ctx.measureText(chunk).width));
  const totalWidth = widths.reduce((total, width) => total + width, 0);
  const boundaries = [0];
  let cumulativeWidth = 0;

  for (let index = 0; index < chunks.length - 1; index += 1) {
    cumulativeWidth += widths[index];
    const proportionalBoundary = Math.round(
      (frameDuration * cumulativeWidth) / totalWidth,
    );
    const minimumBoundary = boundaries[index] + 1;
    const maximumBoundary = frameDuration - (chunks.length - index - 1);
    boundaries.push(Math.min(
      maximumBoundary,
      Math.max(minimumBoundary, proportionalBoundary),
    ));
  }
  boundaries.push(frameDuration);

  return chunks.map((chunk, chunkIndex) => ({
    ...wordInfo,
    word: chunk,
    frameOffset: (Number(wordInfo.frameOffset) || 0) + boundaries[chunkIndex],
    frameDuration: boundaries[chunkIndex + 1] - boundaries[chunkIndex],
    joinerBefore: chunkIndex === 0 ? wordInfo.joinerBefore : internalJoiner,
    visualChunkIndex: chunkIndex,
    visualChunkCount: chunks.length,
  }));
}

function expandLongTimedWords(ctx, wordsArray, maxWidth, config = {}) {
  if (!config.breakLongWords) {
    return wordsArray;
  }

  return wordsArray.flatMap((wordInfo) => {
    if (ctx.measureText(wordInfo.word).width <= maxWidth) {
      return [wordInfo];
    }

    const chunks = wrapText(ctx, wordInfo.word, maxWidth, { breakLongWords: true })
      .filter((chunk) => typeof chunk === 'string' && chunk.length > 0);
    if (chunks.length <= 1) {
      return [wordInfo];
    }

    const internalJoiner = /\s/u.test(wordInfo.word) ? ' ' : '';
    return splitTimedWordAcrossChunks(ctx, wordInfo, chunks, internalJoiner);
  });
}

function wrapWords(ctx, wordsArray, maxWidth, config, speakerPrefixWidth = 0) {
  const lines = [];
  let currentLine = [];
  let currentLineWidth = 0;

  const narrowestLineWidth = Math.max(1, maxWidth - speakerPrefixWidth);
  const renderWords = expandLongTimedWords(ctx, wordsArray, narrowestLineWidth, config);

  for (let i = 0; i < renderWords.length; i++) {
    const w = renderWords[i];
    const wordWidth = ctx.measureText(w.word).width;
    const joinerWidth = currentLine.length > 0
      ? getWordJoinerWidth(ctx, w, config)
      : 0;
    const isPageFirstLine = lines.length % MAX_SUBTITLE_LINES_PER_PAGE === 0;
    const availableLineWidth = Math.max(
      1,
      maxWidth - (isPageFirstLine ? speakerPrefixWidth : 0),
    );
    if (
      currentLineWidth + wordWidth + joinerWidth > availableLineWidth &&
      currentLine.length > 0
    ) {
      lines.push(currentLine);
      currentLine = [w];
      currentLineWidth = wordWidth;
    } else {
      currentLine.push(w);
      currentLineWidth += wordWidth + joinerWidth;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
}

function getTranslatedPhraseKey(wordInfo) {
  if (
    typeof wordInfo?.translatedCueIdentity === 'string' &&
    wordInfo.translatedCueIdentity.trim()
  ) {
    return `cue:${wordInfo.translatedCueIdentity.trim()}`;
  }
  if (wordInfo?.mappingIndex != null) {
    return `mapping:${wordInfo.mappingIndex}`;
  }
  if (wordInfo?.translatedPhraseIndex != null) {
    return `phrase:${wordInfo.translatedPhraseIndex}`;
  }
  if (wordInfo?.sourceWordStartIndex != null || wordInfo?.sourceWordEndIndex != null) {
    return `source:${wordInfo.sourceWordStartIndex ?? ''}:${wordInfo.sourceWordEndIndex ?? ''}`;
  }
  // Older mapped items do not carry phrase metadata. Keep their words in one
  // legacy cue, matching the historical whole-caption presentation. Current
  // translated items always carry a mapping/cue identity and are isolated by
  // the branches above.
  return 'legacy-caption';
}

function dedupeTranslatedCueWords(wordsArray) {
  const seen = new Set();
  return wordsArray
    .map((wordInfo, originalIndex) => ({ wordInfo, originalIndex }))
    .filter(({ wordInfo }) => wordInfo && typeof wordInfo.word === 'string' && wordInfo.word.trim())
    .sort((first, second) => (
      (Number(first.wordInfo.frameOffset) || 0) - (Number(second.wordInfo.frameOffset) || 0) ||
      first.originalIndex - second.originalIndex
    ))
    .filter(({ wordInfo, originalIndex }) => {
      const identity = [
        getTranslatedPhraseKey(wordInfo),
        wordInfo.translatedPhraseTokenIndex ?? wordInfo.visualChunkIndex ?? '',
        wordInfo.word,
        Number(wordInfo.frameOffset) || 0,
        Number(wordInfo.frameDuration) || 0,
      ].join('|');
      if (seen.has(identity)) {
        return false;
      }
      seen.add(identity);
      return true;
    })
    .map(({ wordInfo }) => wordInfo);
}

function groupTranslatedCueWords(wordsArray) {
  const groups = [];
  wordsArray.forEach((wordInfo) => {
    const key = getTranslatedPhraseKey(wordInfo);
    const previous = groups.at(-1);
    if (previous?.key === key) {
      previous.words.push(wordInfo);
    } else {
      groups.push({ key, words: [wordInfo] });
    }
  });
  return groups;
}

function buildTranslatedCuePages(
  ctx,
  wordsArray,
  maxWidth,
  config,
  speakerPrefixWidth,
) {
  const pages = [];
  const groups = groupTranslatedCueWords(dedupeTranslatedCueWords(wordsArray));
  groups.forEach((group, semanticCueIndex) => {
    const lines = wrapWords(
      ctx,
      group.words,
      maxWidth,
      config,
      speakerPrefixWidth,
    );
    for (let index = 0; index < lines.length; index += MAX_SUBTITLE_LINES_PER_PAGE) {
      pages.push({
        cueKey: group.key,
        semanticCueIndex,
        lines: lines.slice(index, index + MAX_SUBTITLE_LINES_PER_PAGE),
      });
    }
  });
  return pages;
}

function resolveTranslatedCueFrameState(pages, frameContext) {
  const allWords = pages.flatMap((page) => page.lines.flat());
  if (allWords.length === 0) {
    return null;
  }

  const wordOffsets = allWords
    .map((wordInfo) => Number(wordInfo.frameOffset))
    .filter(Number.isFinite);
  const timingMode = resolveWordTimingMode(wordOffsets, frameContext);
  let currentFrame = frameContext?.currentFrameGlobal ?? 0;
  let wordOffsetBase = 0;

  if (timingMode === 'layer') {
    currentFrame = frameContext?.currentFrameLocal ?? currentFrame;
  } else if (timingMode === 'item') {
    currentFrame = frameContext?.currentFrameLocal ?? currentFrame;
    wordOffsetBase = Number(frameContext?.itemStartFrameLocal) || 0;
  }

  const rawPages = pages.map((page) => {
    const entries = page.lines.flat().map((wordInfo) => {
      const startFrame = (Number(wordInfo.frameOffset) || 0) + wordOffsetBase;
      const duration = Math.max(1, Number(wordInfo.frameDuration) || 0);
      return { startFrame, endFrame: startFrame + duration };
    });
    return {
      ...page,
      rawStartFrame: Math.min(...entries.map((entry) => entry.startFrame)),
      rawEndFrame: Math.max(...entries.map((entry) => entry.endFrame)),
    };
  });

  const cueStarts = [];
  rawPages.forEach((page, index) => {
    const previousStart = cueStarts[index - 1];
    cueStarts.push(index === 0
      ? page.rawStartFrame
      : Math.max(page.rawStartFrame, previousStart + 1));
  });

  const timedPages = rawPages.map((page, index) => {
    const startFrame = cueStarts[index];
    const nextStartFrame = cueStarts[index + 1];
    const naturalEndFrame = Math.max(startFrame + 1, page.rawEndFrame);
    const heldEndFrame = naturalEndFrame + TRANSLATED_CUE_HOLD_FRAMES;
    const endFrame = Number.isFinite(nextStartFrame)
      ? Math.max(startFrame + 1, Math.min(nextStartFrame, heldEndFrame))
      : naturalEndFrame;
    return { ...page, startFrame, endFrame };
  });

  const activePage = timedPages
    .filter((page) => currentFrame >= page.startFrame && currentFrame < page.endFrame)
    .at(-1);
  if (!activePage) {
    return null;
  }

  const semanticCuePages = timedPages.filter(
    (page) => page.semanticCueIndex === activePage.semanticCueIndex,
  );
  const semanticCueStartFrame = Math.min(
    ...semanticCuePages.map((page) => page.startFrame),
  );
  const semanticCueEndFrame = Math.max(
    ...semanticCuePages.map((page) => page.endFrame),
  );
  const duration = Math.max(1, semanticCueEndFrame - semanticCueStartFrame);
  const fadeFrames = Math.max(
    1,
    Math.min(TRANSLATED_CUE_EDGE_FADE_FRAMES, Math.floor(duration / 2) || 1),
  );
  const fadeIn = smoothstep(
    (currentFrame - semanticCueStartFrame + 1) / fadeFrames,
  );
  const fadeOut = smoothstep(
    (semanticCueEndFrame - currentFrame) / fadeFrames,
  );
  const activePageIndex = timedPages.indexOf(activePage);
  const previousPage = timedPages[activePageIndex - 1];
  const nextPage = timedPages[activePageIndex + 1];
  const hasPreviousSemanticPage = (
    previousPage?.semanticCueIndex === activePage.semanticCueIndex
  );
  const hasNextSemanticPage = (
    nextPage?.semanticCueIndex === activePage.semanticCueIndex
  );
  const pageFadeIn = hasPreviousSemanticPage
    ? smoothstep(
      (currentFrame - activePage.startFrame + 1) / TRANSLATED_PAGE_HANDOFF_FRAMES,
    )
    : 1;
  const pageFadeOut = hasNextSemanticPage
    ? smoothstep(
      (activePage.endFrame - currentFrame) / TRANSLATED_PAGE_HANDOFF_FRAMES,
    )
    : 1;
  return {
    lines: activePage.lines,
    // Long phrases can change two-line layout pages without replaying the cue
    // entrance animation. A one-frame symmetric dip makes that text swap soft
    // while preserving one semantic fade epoch and never double-painting pages.
    alpha: Math.min(fadeIn, fadeOut, pageFadeIn, pageFadeOut),
  };
}

function renderTranslatedCuePage(
  ctx,
  cueState,
  config,
  centerX,
  centerY,
  speakerLabel,
) {
  if (!cueState || cueState.lines.length === 0) {
    return;
  }

  const {
    fontSize = 40,
    strokeColor,
    strokeWidth,
    lineHeight = 1.2,
    linePaddingPx = 0,
  } = config;
  const speakerGapPx = config.speakerGapPx != null ? config.speakerGapPx : fontSize * 0.35;
  const speakerStyles = speakerLabel ? getSpeakerStyles(config, ctx.font) : null;
  const lineHeightPx = fontSize * lineHeight;
  const totalHeight = cueState.lines.length * lineHeightPx +
    (cueState.lines.length - 1) * linePaddingPx;
  const startY = centerY - totalHeight / 2 + lineHeightPx / 2;
  const originalTextAlign = ctx.textAlign;

  ctx.save();
  ctx.textAlign = 'left';
  multiplyContextAlpha(ctx, cueState.alpha);

  cueState.lines.forEach((words, lineIndex) => {
    const prefixWidth = speakerLabel && lineIndex === 0
      ? measureSpeakerLabelWidth(ctx, speakerLabel, speakerStyles, speakerGapPx)
      : 0;
    const wordsWidth = words.reduce((total, wordInfo, wordIndex) => (
      total +
      (wordIndex > 0 ? getWordJoinerWidth(ctx, wordInfo, config) : 0) +
      ctx.measureText(wordInfo.word).width
    ), 0);
    const lineY = startY + lineIndex * (lineHeightPx + linePaddingPx);
    let currentX = centerX - (prefixWidth + wordsWidth) / 2;

    if (speakerLabel && lineIndex === 0) {
      drawSpeakerLabel(ctx, speakerLabel, speakerStyles, currentX, lineY, config.textShadow);
      currentX += prefixWidth;
    }

    if (strokeColor && strokeWidth) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
    }

    words.forEach((wordInfo, wordIndex) => {
      if (wordIndex > 0) {
        currentX += getWordJoinerWidth(ctx, wordInfo, config);
      }
      if (strokeColor && strokeWidth) {
        ctx.strokeText(wordInfo.word, currentX, lineY);
      }
      ctx.fillText(wordInfo.word, currentX, lineY);
      currentX += ctx.measureText(wordInfo.word).width;
    });
  });

  ctx.restore();
  ctx.textAlign = originalTextAlign;
}

function renderText(ctx, item, elapsedTime, durationOffset = 0, framesPerSecond) {
  const { text, words, wordAnimation, textAccent } = item;
  const config = getEffectiveConfig(item);
  const speakerLabel = getSpeakerLabel(item);


  setupTextContext(ctx, config, item);
  renderExactText(
    ctx,
    text,
    config,
    elapsedTime,
    words,
    wordAnimation,
    textAccent,
    speakerLabel,
    durationOffset,
    framesPerSecond,
    {
      translatedCueMode: isMappedTranslatedSubtitleItem(item),
      wordTimingMode:
        item.subtitleTimingBase ||
        item.subtitle_timing_base ||
        item.wordTimingBase ||
        item.word_timing_base ||
        null,
    },
  );
}

/**
 * Renders the exact text. If wordsArray is present, it will do word-level
 * rendering (so we can highlight or animate words). Otherwise, it will
 * just do simple line-based rendering.
 */
function renderExactText(
  ctx,
  text,
  config,
  elapsedTime,
  wordsArray,
  wordAnimation,
  textAccent,
  speakerLabel = null,
  durationOffset = 0,
  framesPerSecond,
  { translatedCueMode = false, wordTimingMode = null } = {},
) {
  const {
    fontSize = 40,
    strokeColor,
    strokeWidth,
    lineHeight = 1.2,
    linePaddingPx = 0,
    autoWrap,
    y,
    width,
    wordSpacing = 1.0,
    wordPaddingPx = 0,
    breakTextWidth = 800,
    staticSubtitle = false,
  } = config;



  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = y ? y : canvasHeight / 2;

  // If we have word-level info, do special word rendering
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  if (Array.isArray(wordsArray) && wordsArray.length > 0) {
    const durationOffsetSeconds = Number(durationOffset) || 0;
    const durationOffsetFrames = durationOffsetSeconds * effectiveFramesPerSecond;
    const currentFrameLocal = (
      (elapsedTime - durationOffsetSeconds * 1000) * effectiveFramesPerSecond
    ) / 1000;
    const currentFrameGlobal = currentFrameLocal + durationOffsetFrames;
    const itemStartFrameLocal = Number(config.frameOffset) || 0;
    const itemFrameDurationLocal = Number(config.frameDuration) || 0;
    const itemEndFrameLocal = itemStartFrameLocal + itemFrameDurationLocal;
    const itemStartFrameGlobal = durationOffsetFrames + itemStartFrameLocal;
    const itemEndFrameGlobal = itemStartFrameGlobal + itemFrameDurationLocal;

    const frameContext = {
      currentFrameGlobal,
      currentFrameLocal,
      durationOffsetFrames,
      itemStartFrameLocal,
      itemEndFrameLocal,
      itemStartFrameGlobal,
      itemEndFrameGlobal,
      itemFrameDurationLocal,
      wordTimingMode,
    };

    if (translatedCueMode) {
      const speakerGapPx = config.speakerGapPx != null
        ? config.speakerGapPx
        : fontSize * 0.35;
      const speakerStyles = speakerLabel ? getSpeakerStyles(config, ctx.font) : null;
      const speakerPrefixWidth = speakerStyles
        ? measureSpeakerLabelWidth(ctx, speakerLabel, speakerStyles, speakerGapPx)
        : 0;
      const cuePages = buildTranslatedCuePages(
        ctx,
        wordsArray,
        breakTextWidth,
        { ...config, breakLongWords: true },
        speakerPrefixWidth,
      );
      const cueState = resolveTranslatedCueFrameState(cuePages, frameContext);
      renderTranslatedCuePage(
        ctx,
        cueState,
        config,
        canvasCenterX,
        canvasCenterY,
        speakerLabel,
      );
      return;
    }

    let linesOfWords = [wordsArray];
    if (autoWrap) {
      const maxWidth = breakTextWidth;
      const speakerGapPx = config.speakerGapPx != null
        ? config.speakerGapPx
        : fontSize * 0.35;
      const speakerStyles = speakerLabel ? getSpeakerStyles(config, ctx.font) : null;
      const speakerPrefixWidth = speakerStyles
        ? measureSpeakerLabelWidth(ctx, speakerLabel, speakerStyles, speakerGapPx)
        : 0;
      linesOfWords = wrapWords(
        ctx,
        wordsArray,
        maxWidth,
        config,
        speakerPrefixWidth,
      );
    }

    renderWordsWithHighlight(
      ctx,
      linesOfWords,
      config,
      elapsedTime,
      wordAnimation,
      textAccent,
      canvasCenterX,
      canvasCenterY,
      speakerLabel,
      frameContext,
      effectiveFramesPerSecond
    );
    return;
  }

  // Otherwise, just render normal text lines
  let lines = text.split('\n');
  if (autoWrap) {
    const maxWidth = breakTextWidth;
    lines = lines.flatMap(line => wrapText(ctx, line, maxWidth, {
      breakLongWords: staticSubtitle || config.breakLongWords === true,
    }));
  }

  const speakerGapPx = config.speakerGapPx != null ? config.speakerGapPx : fontSize * 0.35;
  const speakerStyles = speakerLabel ? getSpeakerStyles(config, ctx.font) : null;

  // Calculate line spacing
  const lineCount = lines.length;
  const lineHeightPx = fontSize * lineHeight;
  const totalHeight = lineCount * lineHeightPx + (lineCount - 1) * linePaddingPx;
  const startY = canvasCenterY - totalHeight / 2 + lineHeightPx / 2;

  if (strokeColor && strokeWidth) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
  }

  // Optionally, a subtle fade on edges
  const fadeDist = 50;

  const originalTextAlign = ctx.textAlign;
  ctx.textAlign = 'left';

  lines.forEach((line, i) => {
    const lineY = startY + i * (lineHeightPx + linePaddingPx);
    const speakerPrefixWidth = speakerStyles && i === 0
      ? measureSpeakerLabelWidth(ctx, speakerLabel, speakerStyles, speakerGapPx)
      : 0;
    const textWidth = ctx.measureText(line).width;
    const lineWidth = textWidth + speakerPrefixWidth;
    const lineStartX = canvasCenterX - lineWidth / 2;
    const lineEndX = canvasCenterX + lineWidth / 2;
    let currentX = lineStartX;

    const gradient = ctx.createLinearGradient(lineStartX, 0, lineEndX, 0);

    const fadeStartRatio = fadeDist / lineWidth;
    const fadeEndRatio = 1 - fadeDist / lineWidth;

    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(Math.min(fadeStartRatio, 1), ctx.fillStyle);
    gradient.addColorStop(Math.max(fadeEndRatio, 0), ctx.fillStyle);
    gradient.addColorStop(1, 'rgba(0,0,0,0)');

    const originalFillStyle = ctx.fillStyle;
    const originalStrokeStyle = ctx.strokeStyle;

    if (speakerStyles && i === 0) {
      drawSpeakerLabel(ctx, speakerLabel, speakerStyles, currentX, lineY, config.textShadow);
      currentX += speakerPrefixWidth;
      if (strokeColor && strokeWidth) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
      }
    }

    ctx.fillStyle = gradient;
    if (strokeColor && strokeWidth) {
      ctx.strokeStyle = gradient;
      ctx.strokeText(line, currentX, lineY);
    }
    ctx.fillText(line, currentX, lineY);

    ctx.fillStyle = originalFillStyle;
    ctx.strokeStyle = originalStrokeStyle;
  });

  ctx.textAlign = originalTextAlign;
}

function resolveWordTimingMode(wordOffsets, frameContext) {
  if (!frameContext || typeof frameContext !== 'object' || !Array.isArray(wordOffsets)) {
    return 'global';
  }

  const explicitMode = typeof frameContext.wordTimingMode === 'string'
    ? frameContext.wordTimingMode.trim().toLowerCase()
    : '';
  if (explicitMode === 'session' || explicitMode === 'global') {
    return 'global';
  }
  if (explicitMode === 'layer' || explicitMode === 'local') {
    return 'layer';
  }
  if (explicitMode === 'item' || explicitMode === 'relative') {
    return 'item';
  }

  const offsets = wordOffsets.filter((value) => Number.isFinite(value));
  if (offsets.length === 0) {
    return 'global';
  }

  const {
    itemStartFrameLocal,
    itemEndFrameLocal,
    itemStartFrameGlobal,
    itemEndFrameGlobal,
    itemFrameDurationLocal,
  } = frameContext;

  const toleranceFrames = 2;
  let globalHits = 0;
  let localHits = 0;
  let itemHits = 0;

  offsets.forEach((offset) => {
    if (
      Number.isFinite(itemStartFrameGlobal) &&
      Number.isFinite(itemEndFrameGlobal) &&
      offset >= itemStartFrameGlobal - toleranceFrames &&
      offset <= itemEndFrameGlobal + toleranceFrames
    ) {
      globalHits += 1;
    }

    if (
      Number.isFinite(itemStartFrameLocal) &&
      Number.isFinite(itemEndFrameLocal) &&
      offset >= itemStartFrameLocal - toleranceFrames &&
      offset <= itemEndFrameLocal + toleranceFrames
    ) {
      localHits += 1;
    }

    if (
      Number.isFinite(itemFrameDurationLocal) &&
      offset >= -toleranceFrames &&
      offset <= itemFrameDurationLocal + toleranceFrames
    ) {
      itemHits += 1;
    }
  });

  const total = offsets.length;
  const ratioGlobal = globalHits / total;
  const ratioLocal = localHits / total;
  const ratioItem = itemHits / total;

  const minOffset = Math.min(...offsets);
  const startsNearZero = minOffset >= -toleranceFrames && minOffset <= toleranceFrames;

  // Prefer global if it matches a clear majority (keeps backward compatibility).
  if (ratioGlobal >= 0.6 && globalHits >= localHits && globalHits >= itemHits) {
    return 'global';
  }

  // Item-relative words typically start around 0 and fit within the item duration.
  if (startsNearZero && ratioItem >= 0.6 && itemHits >= localHits && itemHits > globalHits) {
    return 'item';
  }

  // Layer-local words should fall within the item's local frame window.
  if (ratioLocal >= 0.6 && localHits >= itemHits && localHits > globalHits) {
    return 'layer';
  }

  // Fallback: pick the strongest signal, biasing away from "item" unless it's obvious.
  if (localHits > globalHits && localHits >= itemHits) {
    return 'layer';
  }

  if (startsNearZero && itemHits > globalHits && itemHits > localHits) {
    return 'item';
  }

  return 'global';
}

function getTimedWordEntries(linesOfWords, wordOffsetBase) {
  const entries = [];
  linesOfWords.forEach((wordsArray, lineIndex) => {
    wordsArray.forEach((wordInfo, wordIndex) => {
      const startFrame = (Number(wordInfo.frameOffset) || 0) + wordOffsetBase;
      const frameDuration = Math.max(1, Number(wordInfo.frameDuration) || 0);
      entries.push({
        wordInfo,
        lineIndex,
        wordIndex,
        sequenceIndex: entries.length,
        startFrame,
        endFrame: startFrame + frameDuration,
      });
    });
  });
  return entries;
}

function selectLatestTimedEntry(entries) {
  return entries.reduce((selected, entry) => {
    if (!selected || entry.startFrame > selected.startFrame) {
      return entry;
    }
    if (
      entry.startFrame === selected.startFrame &&
      entry.sequenceIndex > selected.sequenceIndex
    ) {
      return entry;
    }
    return selected;
  }, null);
}

function selectSubtitlePage(linesOfWords, entries, activeEntry, currentFrame) {
  const pageCount = Math.ceil(linesOfWords.length / MAX_SUBTITLE_LINES_PER_PAGE);
  if (pageCount <= 1 || entries.length === 0) {
    return { lines: linesOfWords, alpha: 1 };
  }

  const latestStartedEntry = selectLatestTimedEntry(
    entries.filter((entry) => currentFrame >= entry.startFrame),
  );
  const referenceEntry = activeEntry || latestStartedEntry || entries[0];
  const pageIndex = Math.floor(referenceEntry.lineIndex / MAX_SUBTITLE_LINES_PER_PAGE);
  const firstLineIndex = pageIndex * MAX_SUBTITLE_LINES_PER_PAGE;
  const lastLineIndex = Math.min(
    linesOfWords.length,
    firstLineIndex + MAX_SUBTITLE_LINES_PER_PAGE,
  );
  const pageEntries = entries.filter((entry) => (
    entry.lineIndex >= firstLineIndex && entry.lineIndex < lastLineIndex
  ));
  const pageStartFrame = Math.min(...pageEntries.map((entry) => entry.startFrame));
  const pageEndFrame = Math.max(...pageEntries.map((entry) => entry.endFrame));
  const pageDuration = Math.max(1, pageEndFrame - pageStartFrame);
  const fadeFrames = Math.max(
    1,
    Math.min(SUBTITLE_EDGE_FADE_FRAMES, Math.floor(pageDuration / 2) || 1),
  );
  const fadeIn = smoothstep((currentFrame - pageStartFrame + 1) / fadeFrames);
  const fadeOut = smoothstep((pageEndFrame - currentFrame) / fadeFrames);

  return {
    lines: linesOfWords.slice(firstLineIndex, lastLineIndex),
    alpha: Math.min(fadeIn, fadeOut),
  };
}

function getHighlightEdgeAlpha(activeEntry, currentFrame) {
  if (!activeEntry) {
    return 0;
  }

  const duration = Math.max(1, activeEntry.endFrame - activeEntry.startFrame);
  const fadeFrames = Math.max(
    1,
    Math.min(HIGHLIGHT_EDGE_FADE_FRAMES, Math.floor(duration / 2) || 1),
  );
  const fadeIn = smoothstep((currentFrame - activeEntry.startFrame + 1) / fadeFrames);
  const fadeOut = smoothstep((activeEntry.endFrame - currentFrame) / fadeFrames);
  return Math.min(fadeIn, fadeOut);
}

function renderWordsWithHighlight(
  ctx,
  linesOfWords,
  config,
  elapsedTime,
  wordAnimation,
  textAccent,
  centerX,
  centerY,
  speakerLabel,
  frameContext,
  framesPerSecond
) {
  const {
    fontSize = 40,
    strokeColor = '#BFDBFE',
    strokeWidth = 2,
    lineHeight = 1.2,
    fillColor = '#BFDBFE',
    linePaddingPx = 0
  } = config;

  const speakerGapPx = config.speakerGapPx != null ? config.speakerGapPx : fontSize * 0.35;
  const speakerStyles = speakerLabel
    ? getSpeakerStyles(config, ctx.font)
    : null;

  // Resolve which time-base word timings are using (global vs layer-local vs item-relative).
  const wordOffsets = [];
  for (let i = 0; i < linesOfWords.length; i += 1) {
    const wordsArray = linesOfWords[i];
    for (let j = 0; j < wordsArray.length; j += 1) {
      const offset = Number(wordsArray[j]?.frameOffset);
      if (Number.isFinite(offset)) {
        wordOffsets.push(offset);
      }
    }
  }

  const timingMode = resolveWordTimingMode(wordOffsets, frameContext);

  let currentFrame = (elapsedTime * framesPerSecond) / 1000;
  let wordOffsetBase = 0;

  if (frameContext && typeof frameContext === 'object') {
    if (timingMode === 'layer') {
      currentFrame = frameContext.currentFrameLocal;
    } else if (timingMode === 'item') {
      currentFrame = frameContext.currentFrameLocal;
      wordOffsetBase = Number(frameContext.itemStartFrameLocal) || 0;
    } else {
      currentFrame = frameContext.currentFrameGlobal;
    }
  }

  const timedEntries = getTimedWordEntries(linesOfWords, wordOffsetBase);
  const activeEntry = selectLatestTimedEntry(timedEntries.filter((entry) => (
    currentFrame >= entry.startFrame && currentFrame < entry.endFrame
  )));
  const selectedPage = selectSubtitlePage(
    linesOfWords,
    timedEntries,
    activeEntry,
    currentFrame,
  );
  const visibleLines = selectedPage.lines;
  const highlightEdgeAlpha = getHighlightEdgeAlpha(activeEntry, currentFrame);

  const originalTextAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  ctx.save();
  multiplyContextAlpha(ctx, selectedPage.alpha);

  const lineHeightPx = fontSize * lineHeight;
  const lineCount = visibleLines.length;
  const totalHeight = lineCount * lineHeightPx + (lineCount - 1) * linePaddingPx;
  const startY = centerY - totalHeight / 2 + lineHeightPx / 2;

  visibleLines.forEach((wordsArray, lineIndex) => {
    const prefixWidth = speakerLabel && lineIndex === 0
      ? measureSpeakerLabelWidth(ctx, speakerLabel, speakerStyles, speakerGapPx)
      : 0;

    // Calculate total width of this line
    let totalWidth = prefixWidth;
    for (let i = 0; i < wordsArray.length; i++) {
      const w = wordsArray[i];
      const wordWidth = ctx.measureText(w.word).width;
      totalWidth += wordWidth;
      if (i > 0) {
        totalWidth += getWordJoinerWidth(ctx, w, config);
      }
    }


    const lineY = startY + lineIndex * (lineHeightPx + linePaddingPx);

    if (strokeColor && strokeWidth) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
    }

    let currentX = centerX - totalWidth / 2;

    if (speakerLabel && lineIndex === 0) {
      drawSpeakerLabel(ctx, speakerLabel, speakerStyles, currentX, lineY, config.textShadow);
      currentX += prefixWidth;

      if (strokeColor && strokeWidth) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
      }
    }

    for (let i = 0; i < wordsArray.length; i++) {
      const w = wordsArray[i];
      if (i > 0) {
        currentX += getWordJoinerWidth(ctx, w, config);
      }
      const isActive = activeEntry?.wordInfo === w;





      if (wordAnimation === 'system_preset' && isActive && textAccent) {
        if (strokeColor && strokeWidth) {
          ctx.strokeText(w.word, currentX, lineY);
        }
        ctx.fillText(w.word, currentX, lineY);
        ctx.save();
        multiplyContextAlpha(ctx, highlightEdgeAlpha);
        renderWordWithAccent(
          ctx,
          w.word,
          textAccent,
          currentX,
          lineY,
          elapsedTime,
          strokeColor,
          strokeWidth,
          fillColor
        );
        ctx.restore();
      } else if (wordAnimation === 'highlight' && isActive) {
        // Draw highlight rectangle behind word
        const wordWidth = ctx.measureText(w.word).width;
        const rectHeight = fontSize * 1.2;
        const rectX = currentX;
        const rectY = lineY - rectHeight / 2;

        const originalFillStyle = ctx.fillStyle;
        const originalStrokeStyle = ctx.strokeStyle;

        const highlightAlpha = 0.08 + 0.14 * highlightEdgeAlpha;
        ctx.fillStyle = `rgba(255, 255, 255, ${highlightAlpha.toFixed(3)})`;
        ctx.fillRect(rectX, rectY, wordWidth, rectHeight);

        ctx.fillStyle = originalFillStyle;
        ctx.strokeStyle = originalStrokeStyle;

        if (strokeColor && strokeWidth) {
          ctx.strokeText(w.word, currentX, lineY);
        }
        ctx.fillText(w.word, currentX, lineY);
      } else {
        if (strokeColor && strokeWidth) {
          ctx.strokeText(w.word, currentX, lineY);
        }
        ctx.fillText(w.word, currentX, lineY);
      }
      currentX += ctx.measureText(w.word).width;
    }
  });

  ctx.restore();
  ctx.textAlign = originalTextAlign;
}

function renderWordWithAccent(
  ctx,
  word,
  accent,
  x,
  y,
  elapsedTime,
  strokeColor,
  strokeWidth,
  fillColor
) {
  ctx.save();

  const t = elapsedTime / 1000;
  const osc = Math.sin(t * 2 * Math.PI);
  const oscPos = (osc + 1) / 2;

  switch (accent) {
    case 'bleeding':
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor || fillColor;
      ctx.shadowColor = 'rgba(251,207,232,0.5)'; // rose-200
      ctx.shadowBlur = 5 + 5 * oscPos;
      ctx.shadowOffsetY = 2 + 2 * oscPos;
      drawText(ctx, word, x, y, strokeColor, strokeWidth);
      break;
    case 'glowing':
      ctx.shadowColor = 'rgba(254,240,138,0.8)'; // yellow-200
      ctx.shadowBlur = 10 + 10 * oscPos;
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor || fillColor;
      drawText(ctx, word, x, y, strokeColor, strokeWidth);
      break;
    case 'throbbing':
      const scaleFactor = 1 + 0.02 * osc;
      ctx.translate(x, y);
      ctx.scale(scaleFactor, scaleFactor);
      ctx.translate(-x, -y);
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor || fillColor;
      drawText(ctx, word, x, y, strokeColor, strokeWidth);
      break;
    case 'shimmering':
      const wordWidth = ctx.measureText(word).width;
      const gradX = x - wordWidth / 2;
      const gradient = ctx.createLinearGradient(gradX, y, gradX + wordWidth, y);
      const shift = (t % 1) * wordWidth;
      gradient.addColorStop(Math.max(0, shift / wordWidth - 0.1), fillColor);
      gradient.addColorStop(Math.min(1, shift / wordWidth), '#EFF6FF'); // blue-50
      gradient.addColorStop(Math.min(1, shift / wordWidth + 0.1), fillColor);

      ctx.fillStyle = gradient;
      ctx.strokeStyle = strokeColor || fillColor;
      drawText(ctx, word, x, y, strokeColor, strokeWidth);
      break;
    case 'wobbling':
      const wobbleX = x + 2 * osc;
      ctx.fillStyle = '#E9D5FF'; // purple-200
      ctx.strokeStyle = strokeColor || '#E9D5FF';
      drawText(ctx, word, wobbleX, y, strokeColor, strokeWidth);
      break;
    case 'rising':
      const riseAmount = -10 * oscPos;
      const originalAlpha = ctx.globalAlpha;
      ctx.globalAlpha = 1 - 0.1 * oscPos;
      ctx.fillStyle = '#A7F3D0'; // emerald-200
      ctx.strokeStyle = strokeColor || '#A7F3D0';
      drawText(ctx, word, x, y + riseAmount, strokeColor, strokeWidth);
      ctx.globalAlpha = originalAlpha;
      break;
    default:
      ctx.fillStyle = fillColor;
      ctx.strokeStyle = strokeColor || fillColor;
      drawText(ctx, word, x, y, strokeColor, strokeWidth);
      break;
  }

  ctx.restore();
}

function drawText(ctx, text, x, y, strokeColor, strokeWidth) {
  if (strokeColor && strokeWidth) {
    ctx.strokeText(text, x, y);
  }
  ctx.fillText(text, x, y);
}
