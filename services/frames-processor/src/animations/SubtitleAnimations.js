// SubtitleAnimations.js

import { wrapText } from '../utils/TextUtils.js';
import { getFramesPerSecondFromValue } from '../utils/FpsUtils.js';

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

function getSpeakerStyles(config = {}) {
  const baseFontSize = config.fontSize || 40;
  const speakerFontSize = config.speakerFontSize || Math.round(baseFontSize * 0.8);
  const speakerFontFamily = config.speakerFontFamily || config.fontFamily || DEFAULT_FONT_FALLBACKS[0];
  const speakerFontEmphasis = config.speakerFontEmphasis || config.fontEmphasis || 'bold';
  const speakerFillColor = config.speakerFillColor || config.fillColor || '#FFFFFF';
  const speakerStrokeColor = config.speakerStrokeColor ?? config.strokeColor;
  const speakerStrokeWidth = config.speakerStrokeWidth ?? (config.strokeWidth ? config.strokeWidth + 1 : 3);

  const resolvedFamily = buildFontStack(speakerFontFamily, 'speaker');

  return {
    fontString: buildFontString(speakerFontSize, speakerFontEmphasis, resolvedFamily),
    fillColor: speakerFillColor,
    strokeColor: speakerStrokeColor,
    strokeWidth: speakerStrokeWidth,
  };
}

function getSpeakerLabel(item) {
  if (item && item.showSpeaker && item.speaker) {
    return `${item.speaker}`.toUpperCase() + ':';
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


  const hasAnimations = Array.isArray(animations) && animations.length > 0;

  if (item.subType === 'subtitle') {
    const existingConfig = item.config || {};
    item.config = {
      ...existingConfig,
      autoWrap: false,
      linePaddingPx: existingConfig.linePaddingPx != null ? existingConfig.linePaddingPx : 0,
    };
  }

  // Keep track of original text for after our animations
  const originalText = item.text;

  if (!hasAnimations) {


    renderText(ctx, item, elapsedTime, durationOffset, effectiveFramesPerSecond);
    // Revert the text to original after rendering
    item.text = originalText;
    return;
  }

  animations.sort((a, b) => a.startFrame - b.startFrame);

  let animationApplied = false;

  animations.forEach(animation => {
    const { type, startFrame, endFrame } = animation;
    const startTime = startFrame * (1000 / effectiveFramesPerSecond);
    const endTime = endFrame * (1000 / effectiveFramesPerSecond);
    const totalDuration = endTime - startTime;
    const animationElapsed = elapsedTime - startTime;

    if (animationElapsed >= 0 && animationElapsed <= totalDuration) {
      const t = animationElapsed / totalDuration; // Progress [0,1]

      switch (type) {
        case 'typewriter':
          applyTypewriterEffect(ctx, item, t, elapsedTime, durationOffset, effectiveFramesPerSecond);
          animationApplied = true;
          break;
        case 'fade-in':
          applyFadeInEffect(ctx, item, t, elapsedTime, durationOffset, effectiveFramesPerSecond);
          animationApplied = true;
          break;
        case 'fade-out':
          applyFadeOutEffect(ctx, item, t, elapsedTime, durationOffset, effectiveFramesPerSecond);
          animationApplied = true;
          break;
        case 'slide-in':
          applySlideInEffect(ctx, item, t, elapsedTime, durationOffset, effectiveFramesPerSecond);
          animationApplied = true;
          break;
        case 'slide-out':
          applySlideOutEffect(ctx, item, t, elapsedTime, durationOffset, effectiveFramesPerSecond);
          animationApplied = true;
          break;
        default:
          renderText(ctx, item, elapsedTime, durationOffset, effectiveFramesPerSecond);
          animationApplied = true;
      }
    } else if (animationElapsed > totalDuration) {
      // After animation ends
      if (type === 'fade-in' || type === 'slide-in' || type === 'typewriter') {
        // Render normally after these animations complete
        renderText(ctx, item, elapsedTime, durationOffset, effectiveFramesPerSecond);
        animationApplied = true;
      }
      // For fade-out and slide-out, do not render after animation ends
    }
  });

  if (!animationApplied) {
    const lastAnimation = animations[animations.length - 1];
    if (
      lastAnimation &&
      (lastAnimation.type === 'fade-in' ||
        lastAnimation.type === 'slide-in' ||
        lastAnimation.type === 'typewriter')
    ) {
      renderText(ctx, item, elapsedTime, durationOffset, effectiveFramesPerSecond);
    }
  }

  // Revert text back to original
  item.text = originalText;
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
    item.words,
    item.wordAnimation,
    item.textAccent,
    speakerLabel,
    durationOffset,
    framesPerSecond
  );
}

function applyFadeInEffect(ctx, item, t, elapsedTime, durationOffset = 0, framesPerSecond) {
  ctx.save();
  ctx.globalAlpha = t;
  renderText(ctx, item, elapsedTime, durationOffset, framesPerSecond);
  ctx.restore();
}

function applyFadeOutEffect(ctx, item, t, elapsedTime, durationOffset = 0, framesPerSecond) {
  ctx.save();
  ctx.globalAlpha = 1 - t;
  renderText(ctx, item, elapsedTime, durationOffset, framesPerSecond);
  ctx.restore();
}

function applySlideInEffect(ctx, item, t, elapsedTime, durationOffset = 0, framesPerSecond) {
  // Just fade in for simplicity
  ctx.save();
  ctx.globalAlpha = t;
  renderText(ctx, item, elapsedTime, durationOffset, framesPerSecond);
  ctx.restore();
}

function applySlideOutEffect(ctx, item, t, elapsedTime, durationOffset = 0, framesPerSecond) {
  // Just fade out for simplicity
  ctx.save();
  ctx.globalAlpha = 1 - t;
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

  const resolvedFontFamily = buildFontStack(fontFamily, item?.subType || 'text', item?.text || item?.speaker);

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

function wrapWords(ctx, wordsArray, maxWidth, config) {
  const lines = [];
  let currentLine = [];
  let currentLineWidth = 0;

  const spaceWidth = ctx.measureText(' ').width;

  for (let i = 0; i < wordsArray.length; i++) {
    const w = wordsArray[i];
    const wordWidth = ctx.measureText(w.word).width;
    const spaceNeeded = currentLine.length > 0 ? spaceWidth : 0;
    if (
      currentLineWidth + wordWidth + spaceNeeded > maxWidth &&
      currentLine.length > 0
    ) {
      lines.push(currentLine);
      currentLine = [w];
      currentLineWidth = wordWidth;
    } else {
      currentLine.push(w);
      currentLineWidth += wordWidth + spaceNeeded;
    }
  }

  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  return lines;
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
    framesPerSecond
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
  framesPerSecond
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
  } = config;



  const canvasWidth = ctx.canvas.width;
  const canvasHeight = ctx.canvas.height;
  const canvasCenterX = canvasWidth / 2;
  const canvasCenterY = y ? y : canvasHeight / 2;

  // If we have word-level info, do special word rendering
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  if (Array.isArray(wordsArray) && wordsArray.length > 0) {
    const durationOffsetSeconds = Number(durationOffset) || 0;
    const durationOffsetFrames = Math.round(durationOffsetSeconds * effectiveFramesPerSecond);
    const currentFrameGlobal = Math.round((elapsedTime * effectiveFramesPerSecond) / 1000);
    const currentFrameLocal = currentFrameGlobal - durationOffsetFrames;
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
    };

    let linesOfWords = [wordsArray];
    if (autoWrap) {
      const maxWidth = breakTextWidth;
      linesOfWords = wrapWords(ctx, wordsArray, maxWidth, config);
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
    lines = lines.flatMap(line => wrapText(ctx, line, maxWidth));
  }

  const speakerGapPx = config.speakerGapPx != null ? config.speakerGapPx : fontSize * 0.35;
  const speakerStyles = speakerLabel ? getSpeakerStyles(config) : null;

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
    wordSpacing = 1.0,
    wordPaddingPx = 0,
    linePaddingPx = 0
  } = config;

  const speakerGapPx = config.speakerGapPx != null ? config.speakerGapPx : fontSize * 0.35;
  const speakerStyles = speakerLabel ? getSpeakerStyles(config) : null;

  ctx.textAlign = 'left';




  const naturalSpaceWidth = ctx.measureText(' ').width;
  const effectiveSpaceWidth = naturalSpaceWidth * wordSpacing + wordPaddingPx;

  const lineHeightPx = fontSize * lineHeight;
  const lineCount = linesOfWords.length;
  const totalHeight = lineCount * lineHeightPx + (lineCount - 1) * linePaddingPx;
  const startY = centerY - totalHeight / 2 + lineHeightPx / 2;

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

  let currentFrame = Math.round((elapsedTime * framesPerSecond) / 1000);
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

  linesOfWords.forEach((wordsArray, lineIndex) => {
    const prefixWidth = speakerLabel && lineIndex === 0
      ? measureSpeakerLabelWidth(ctx, speakerLabel, speakerStyles, speakerGapPx)
      : 0;

    // Calculate total width of this line
    let totalWidth = prefixWidth;
    for (let i = 0; i < wordsArray.length; i++) {
      const w = wordsArray[i];
      const wordWidth = ctx.measureText(w.word).width;
      totalWidth += wordWidth;
      if (i < wordsArray.length - 1) {
        totalWidth += effectiveSpaceWidth;
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
      const wordStartFrame = (Number(w.frameOffset) || 0) + wordOffsetBase;
      const wordFrameDuration = Math.max(1, Number(w.frameDuration) || 0);
      const wordEndFrame = wordStartFrame + wordFrameDuration; // end is exclusive
      const isActive = currentFrame >= wordStartFrame && currentFrame < wordEndFrame;





      if (wordAnimation === 'system_preset' && isActive && textAccent) {


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
      } else if (wordAnimation === 'highlight' && isActive) {
        // Draw highlight rectangle behind word
        const wordWidth = ctx.measureText(w.word).width;
        const rectHeight = fontSize * 1.2;
        const rectX = currentX;
        const rectY = lineY - rectHeight / 2;

        const originalFillStyle = ctx.fillStyle;
        const originalStrokeStyle = ctx.strokeStyle;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
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

      currentX += ctx.measureText(w.word).width + effectiveSpaceWidth;
    }
  });
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
