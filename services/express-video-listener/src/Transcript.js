import fs from 'fs';
import { createCanvas } from 'canvas';
import OpenAI from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import { promisify } from 'util';
import { getDBConnectionString } from './DBString.js';
import VideoSession from './schema/VideoSession.js';
import User from './schema/User.js';
import { DEFAULT_LATIN_SUBTITLE_FONT, resolveSubtitleFont } from './consts/SubtitleFonts.js';

import { getCanvasDimensionsForAspectRatio } from './utils/CanvasUtils.js';
import { addSubtitlesForSessionForAudio } from './utils/TranscriptUtils.js';
import { getAccentForText } from './ai_video/assistant/OpenAi.js';
import {
  resolveRequestInferenceAuthorization,
  resolveRequestInferenceModel,
} from './ai_utils/RequestInferenceModel.js';
import { getFramesPerSecondFromValue, resolveFramesPerSecond } from './utils/FpsUtils.js';
import { recordProviderUsageLog } from './utils/ProviderUsageAudit.js';
import { resolveLocalAssetPath } from './utils/LocalAssetPath.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1';
const WORD_TIMESTAMP_TRANSCRIPTION_MODEL =
  process.env.OPENAI_WORD_TIMESTAMP_TRANSCRIPTION_MODEL || 'whisper-1';
const CJK_CHARACTER_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;
// Constants
const SEGMENT_BOUNDARY_REGEX = /[.!?,;:]/;
const SEGMENT_CLOSER_REGEX = /["'’”)\]\}]/;
const MAX_WORDS_PER_SEGMENT = 8;

// Function to calculate the width of text
function calculateTextWidth(text, fontSize, fontFamily, canvasDimensions) {
  const fallbackFont = DEFAULT_LATIN_SUBTITLE_FONT;
  try {
    const canvas = createCanvas(canvasDimensions.width, canvasDimensions.height);
    const context = canvas.getContext('2d');

    context.font = `${fontSize}px ${fontFamily}`;
    const metrics = context.measureText(text);
    const width = metrics?.width;

    if (Number.isFinite(width) && width > 0) {
      return width;
    }
    throw new Error('Invalid text width measurement');
  } catch {
    try {
      const canvas = createCanvas(canvasDimensions.width, canvasDimensions.height);
      const context = canvas.getContext('2d');
      context.font = `${fontSize}px ${fallbackFont}`;
      const metrics = context.measureText(text);
      const width = metrics?.width;
      if (Number.isFinite(width) && width > 0) {
        return width;
      }
    } catch {
    }
  }

  return Math.max(1, Math.ceil(text.length * fontSize * 0.6));
}

function secondsToFrame(timeInSeconds, framesPerSecond) {
  return Math.floor(timeInSeconds * framesPerSecond);
}

function calculateFrameOffset(startTime, endTime, framesPerSecond) {
  const frameOffset = secondsToFrame(startTime, framesPerSecond);
  const effectiveFrameOffset = frameOffset + 1;
  const endFrame = Math.floor(endTime * framesPerSecond);
  const frameDuration = Math.max(endFrame - effectiveFrameOffset, 1);
  return { frameDuration, frameOffset: frameOffset };
}

function getTranscriptSource(audioLayer = {}) {
  if (Array.isArray(audioLayer.remoteAudioData) && audioLayer.remoteAudioData.length > 0) {
    const remoteTranscript = audioLayer.remoteAudioData[0]?.transcript || audioLayer.remoteAudioData[0]?.text;
    if (remoteTranscript) {
      return remoteTranscript;
    }
  }
  return audioLayer.transcriptText ||
    audioLayer.transcript ||
    audioLayer.prompt ||
    audioLayer.instructions ||
    '';
}

function normalizeLanguageCode(languageCode = '') {
  if (typeof languageCode !== 'string') {
    return '';
  }
  return languageCode.trim().toLowerCase();
}

const SUBTITLE_LANGUAGE_ALIASES = Object.freeze({
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

function normalizeComparableLanguageCode(languageCode = '') {
  const normalized = normalizeLanguageCode(languageCode).replace(/_/g, '-');
  if (!normalized || normalized === 'auto') {
    return '';
  }

  const exactAlias = SUBTITLE_LANGUAGE_ALIASES[normalized];
  if (exactAlias) {
    return exactAlias;
  }

  const baseCode = normalized.split('-')[0];
  return SUBTITLE_LANGUAGE_ALIASES[baseCode] || baseCode;
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function firstConcreteLanguageString(...values) {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed && normalizeComparableLanguageCode(trimmed)) {
      return trimmed;
    }
  }
  return '';
}

function getTranslatedSubtitleContext(session = {}, audioLayer = {}) {
  const audioLanguage = firstConcreteLanguageString(
    audioLayer.speechLanguage,
    audioLayer.speech_language,
    audioLayer.languageCode,
    audioLayer.language_code,
    session.sessionLanguage,
    session.session_language,
    session.language,
  );
  const subtitleLanguage = firstConcreteLanguageString(
    audioLayer.subtitleLanguage,
    audioLayer.subtitle_language,
    session.subtitleLanguage,
    session.subtitle_language,
    audioLanguage,
  );
  const normalizedAudioLanguage = normalizeComparableLanguageCode(audioLanguage);
  const normalizedSubtitleLanguage = normalizeComparableLanguageCode(subtitleLanguage);
  const translationRequired =
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

function getTranslatedSubtitleText(audioLayer = {}) {
  return firstNonEmptyString(audioLayer.subtitleText, audioLayer.subtitle_text);
}

function normalizeSubtitleAlignmentMapEntry(entry = {}) {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const sourceText = firstNonEmptyString(
    entry.sourceText,
    entry.source_text,
    entry.originalText,
    entry.original_text,
    entry.source,
    entry.original,
  );
  const translatedText = firstNonEmptyString(
    entry.translatedText,
    entry.translated_text,
    entry.targetText,
    entry.target_text,
    entry.translation,
    entry.target,
  );

  if (!sourceText || !translatedText) {
    return null;
  }

  return { sourceText, translatedText };
}

function getSubtitleAlignmentMap(audioLayer = {}) {
  const rawMapping =
    audioLayer.subtitleAlignmentMap ??
    audioLayer.subtitle_alignment_map ??
    audioLayer.subtitleWordMapping ??
    audioLayer.subtitle_word_mapping;

  if (!Array.isArray(rawMapping)) {
    return [];
  }

  return rawMapping
    .map(normalizeSubtitleAlignmentMapEntry)
    .filter(Boolean);
}

function getTranslatedSubtitleSpeakerName(audioLayer = {}) {
  return firstNonEmptyString(
    audioLayer.subtitleSpeakerCharacterName,
    audioLayer.subtitle_speaker_character_name,
    audioLayer.translatedSpeakerCharacterName,
    audioLayer.translated_speaker_character_name,
  );
}

function getTranscriptionLanguageCode(languageCode = '') {
  const normalized = normalizeLanguageCode(languageCode);
  if (!normalized || normalized === 'en') {
    return null;
  }
  const baseCode = normalized.replace(/_/g, '-').split('-')[0];
  if (baseCode === 'en') {
    return null;
  }
  return baseCode === 'cn' ? 'zh' : baseCode;
}

function findBoundaryEnd(wordPos, transcriptText) {
  if (!wordPos || !transcriptText) {
    return null;
  }

  const safeStart = Math.max(0, Number(wordPos.start) || 0);
  const safeEnd = Math.min(transcriptText.length, Number(wordPos.end) || 0);

  // Handle cases where the matched "word" span already includes punctuation (common in some transcript APIs).
  // Walk backwards from the end of the matched span and treat trailing punctuation as a boundary.
  for (let i = safeEnd - 1; i >= safeStart; i -= 1) {
    const char = transcriptText[i];
    if (!char || char.trim() === '') continue;
    if (SEGMENT_CLOSER_REGEX.test(char)) continue;
    if (SEGMENT_BOUNDARY_REGEX.test(char)) {
      return i + 1; // exclusive end (includes punctuation)
    }
    break;
  }

  // Otherwise look just after the word span for punctuation (allowing whitespace/closers in-between).
  for (let i = safeEnd; i < transcriptText.length; i += 1) {
    const char = transcriptText[i];
    if (!char || char.trim() === '') {
      continue;
    }
    if (SEGMENT_CLOSER_REGEX.test(char)) {
      continue;
    }
    if (SEGMENT_BOUNDARY_REGEX.test(char)) {
      return i + 1; // exclusive end (includes punctuation)
    }
    break;
  }
  return null;
}

function wordEndsWithBoundary(wordValue) {
  if (!wordValue || typeof wordValue !== 'string') return false;
  const trimmed = wordValue.trim();
  if (!trimmed) return false;

  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    const char = trimmed[i];
    if (!char || char.trim() === '') continue;
    if (SEGMENT_CLOSER_REGEX.test(char)) continue;
    return SEGMENT_BOUNDARY_REGEX.test(char);
  }
  return false;
}

function buildSubtitleSegments(validWords, wordPositions, transcriptText) {
  const segments = [];
  let currentSegment = [];
  let currentBoundaryEnd = null;

  validWords.forEach((wordInfo, index) => {
    const wordWithIndex = { ...wordInfo, index };
    const wordPos = wordPositions[index];

    currentSegment.push(wordWithIndex);

    const boundaryEndFromTranscript = wordPos ? findBoundaryEnd(wordPos, transcriptText) : null;
    const boundaryFromWordToken = wordEndsWithBoundary(wordInfo?.word);
    const reachedMax = currentSegment.length >= MAX_WORDS_PER_SEGMENT;

    if (boundaryEndFromTranscript) {
      currentBoundaryEnd = boundaryEndFromTranscript;
    } else if (boundaryFromWordToken && wordPos) {
      // Boundary punctuation is likely part of the matched span; use the word's end index for substring extraction.
      currentBoundaryEnd = Number(wordPos.end) || null;
    }

    if (boundaryEndFromTranscript || boundaryFromWordToken || reachedMax) {
      segments.push({
        words: currentSegment,
        boundaryEnd: currentBoundaryEnd,
      });
      currentSegment = [];
      currentBoundaryEnd = null;
    }
  });

  if (currentSegment.length > 0) {
    segments.push({
      words: currentSegment,
      boundaryEnd: currentBoundaryEnd,
    });
  }

  return segments;
}

function getSubtitleYPosition(aspectRatio, canvasDimensions) {
  const { height } = canvasDimensions;
  if (aspectRatio === '9:16') {
    return Math.round(height * 0.91);
  }
  if (aspectRatio === '16:9') {
    return Math.round(height * 0.88);
  }
  return Math.round(height * 0.9);
}

function resolveLanguageFontCandidates({
  languageCode,
  fontPreferencesByLanguage,
  hasFontPreferences,
  defaultTextFont,
  defaultSpeakerFont,
}) {
  const normalizedLanguage = normalizeLanguageCode(languageCode).replace(/_/g, '-');
  const baseLanguage = normalizedLanguage.split('-')[0];
  const languagePreferences =
    fontPreferencesByLanguage[normalizedLanguage] ||
    fontPreferencesByLanguage[baseLanguage] ||
    {};
  const textFontCandidate =
    languagePreferences.expressGenerationTextFont ||
    (!hasFontPreferences ? defaultTextFont : null);
  const speakerFontCandidate =
    languagePreferences.expressGenerationSpeakerFont ||
    (!hasFontPreferences ? defaultSpeakerFont : null);

  return {
    subtitleFont: resolveSubtitleFont(normalizedLanguage || 'en', textFontCandidate),
    speakerFont: resolveSubtitleFont(normalizedLanguage || 'en', speakerFontCandidate),
  };
}

function resolveConnectedSceneLayer(session = {}, audioLayer = {}) {
  const layers = Array.isArray(session.layers) ? session.layers : [];
  const connectedLayerId = audioLayer.connectedLayerId?.toString?.() || '';
  if (connectedLayerId) {
    const connectedLayer = layers.find(
      (layer) => layer?._id?.toString?.() === connectedLayerId,
    );
    if (connectedLayer) {
      return connectedLayer;
    }
  }

  const connectedLayerIndex = Number(audioLayer.connectedLayerIndex);
  if (Number.isInteger(connectedLayerIndex) && connectedLayerIndex >= 0) {
    return layers[connectedLayerIndex] || null;
  }

  return null;
}

function getStaticSubtitleTiming(session = {}, audioLayer = {}) {
  const connectedSceneLayer = resolveConnectedSceneLayer(session, audioLayer);
  const audioStartTime = Number(audioLayer.startTime);

  if (connectedSceneLayer) {
    const sceneStartTime = Number(connectedSceneLayer.durationOffset);
    const sceneDuration = Number(connectedSceneLayer.duration);
    if (Number.isFinite(sceneDuration) && sceneDuration > 0) {
      return {
        frameOffsetSeconds:
          Number.isFinite(sceneStartTime) && Number.isFinite(audioStartTime)
            ? sceneStartTime - audioStartTime
            : 0,
        durationSeconds: sceneDuration,
        source: 'connected_scene',
      };
    }
  }

  const audioDuration = Number(audioLayer.duration);
  return {
    frameOffsetSeconds: 0,
    durationSeconds: Number.isFinite(audioDuration) && audioDuration > 0 ? audioDuration : null,
    source: 'audio_layer',
  };
}

function buildStaticTranslatedSubtitleItem({
  subtitleText,
  canvasDimensions,
  subtitleFont,
  audioLayerId,
  aspectRatio,
  speakerDetails = {},
  subtitleLanguage,
  audioLanguage,
  audioDurationSeconds,
  frameOffsetSeconds = 0,
  framesPerSecond,
}) {
  const text = typeof subtitleText === 'string' ? subtitleText.trim() : '';
  if (!text) {
    return null;
  }

  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  const parsedDurationSeconds = Number(audioDurationSeconds);
  const durationSeconds = Number.isFinite(parsedDurationSeconds) && parsedDurationSeconds > 0
    ? parsedDurationSeconds
    : 1 / effectiveFramesPerSecond;
  const frameDuration = Math.max(1, Math.floor(durationSeconds * effectiveFramesPerSecond));
  const parsedFrameOffsetSeconds = Number(frameOffsetSeconds);
  const frameOffset = Number.isFinite(parsedFrameOffsetSeconds)
    ? Math.floor(parsedFrameOffsetSeconds * effectiveFramesPerSecond)
    : 0;
  const fontSize = canvasDimensions.width < 1024 ? 42 : 48;
  const textHeight = 90;
  const targetLanguage = subtitleLanguage || audioLanguage || 'en';
  const fontFamily = resolveSubtitleFont(targetLanguage, subtitleFont);
  const speakerFontFamily = resolveSubtitleFont(
    targetLanguage,
    speakerDetails.speakerFont || fontFamily,
  );
  const textWidth = calculateTextWidth(text, fontSize, fontFamily, canvasDimensions);
  const subtitleY = getSubtitleYPosition(aspectRatio, canvasDimensions);
  const breakTextWidth = Math.max(1, canvasDimensions.width - 200);
  const speakerFontSize = Math.round(fontSize * 0.78);

  return {
    type: 'text',
    text,
    config: {
      width: textWidth,
      height: textHeight,
      fontSize,
      fontFamily,
      fillColor: '#FFFFFF',
      autoWrap: true,
      breakTextWidth,
      strokeColor: '#000000',
      strokeWidth: 3,
      textAlign: 'center',
      capitalizeLetters: false,
      fontEmphasis: 'bold',
      textShadow: {
        color: 'rgba(0, 0, 0, 0.35)',
        blur: 6,
        offsetX: 2,
        offsetY: 2,
      },
      linePaddingPx: 2,
      lineHeight: 1.12,
      speakerGapPx: 18,
      x: canvasDimensions.width / 2,
      y: subtitleY,
      frameDuration,
      frameOffset,
      rotationAngle: 0,
      speakerFontFamily,
      speakerFontSize,
      speakerFillColor: '#FFD166',
      speakerStrokeColor: '#000000',
      speakerStrokeWidth: 3,
      speakerFontEmphasis: 'bold',
      staticSubtitle: true,
    },
    subType: 'subtitle',
    animations: [],
    words: [],
    wordAnimation: null,
    textAccent: null,
    breakTextWidth,
    audioLayerId,
    speaker: speakerDetails.speaker,
    showSpeaker: Boolean(speakerDetails.showSpeaker),
    speakerFontFamily,
    subtitleLanguage: targetLanguage,
    audioLanguage: audioLanguage || null,
    subtitleRenderMode: 'static',
    isStaticSubtitle: true,
  };
}


export async function generateTranscriptsForSessionAudioLayers(sessionId) {



	  try {
	    await getDBConnectionString();
	    let originalSessionData = await VideoSession.findById(sessionId);
	    if (!originalSessionData) {
	      throw new Error(`Session not found for transcript generation: ${sessionId}`);
	    }
      if (originalSessionData.enableSubtitles === false) {
        return;
      }

	    const userId = originalSessionData.userId;
	    const userData = await User.findById(userId);
	    if (!userData) {
	      throw new Error(`User not found for transcript generation: ${userId}`);
	    }

    const expressGenerationSpeakerFont = userData.expressGenerationSpeakerFont || 'Rampart One';
    const expressGenerationTextFont = userData.expressGenerationTextFont || DEFAULT_LATIN_SUBTITLE_FONT;
    const rawFontPreferences = userData.fontPreferences;
    const fontPreferences =
      rawFontPreferences instanceof Map ? Object.fromEntries(rawFontPreferences) : rawFontPreferences;
    const fontPreferencesByLanguage = fontPreferences && typeof fontPreferences === 'object' ? fontPreferences : {};
    const hasFontPreferences = Object.keys(fontPreferencesByLanguage).length > 0;


    const isSpeechLayer = (layer = {}) => {
      const rawType = layer?.generationType;
      if (typeof rawType !== 'string') return false;
      return rawType.trim().toLowerCase() === 'speech';
    };

    const originalAudioLayers = originalSessionData.audioLayers.filter(isSpeechLayer);


	    await fixDurationsForSpeechLayers(sessionId, originalAudioLayers);


	    let sessionData = await VideoSession.findById(sessionId);
	    if (!sessionData) {
	      throw new Error(`Session not found after duration fix: ${sessionId}`);
	    }

    const isMovieGen = sessionData.isMovieGen;
    const framesPerSecond = resolveFramesPerSecond(sessionData, userData);
    const inferenceModel = resolveRequestInferenceModel({
      session: sessionData,
      user: userData,
    });
    const selectedInferenceModelAuthorization = resolveRequestInferenceAuthorization({
      session: sessionData,
      user: userData,
    });

    const sessionLanguageCode = normalizeLanguageCode(sessionData.sessionLanguage || 'EN');
    const languageForFonts = sessionLanguageCode || 'en';


    const allAudioLayers = Array.isArray(sessionData.audioLayers) ? sessionData.audioLayers : [];
    let audioLayers = allAudioLayers.filter(isSpeechLayer);

    let processedSpeechLayers = 0;
    let skippedEmptyTranscript = 0;
    let skippedMissingAudioLink = 0;
    let alignmentEmpty = 0;
    let layersWithErrors = 0;
    let subtitleItemsAttempted = 0;

    if (audioLayers.length === 0) {
      return;
    }



    for (let i = 0; i < audioLayers.length; i++) {
      const audioLayer = audioLayers[i];
      const audioLayerId = audioLayer?._id?.toString?.() || null;

      try {
        const translatedSubtitleContext = getTranslatedSubtitleContext(sessionData, audioLayer);
        const sourceTranscriptText = firstNonEmptyString(getTranscriptSource(audioLayer));
        const translatedSubtitleText = getTranslatedSubtitleText(audioLayer);
        const subtitleAlignmentMap = getSubtitleAlignmentMap(audioLayer);
        const usesMappedTranslatedSubtitles =
          translatedSubtitleContext.isTranslated &&
          Boolean(sourceTranscriptText.trim()) &&
          subtitleAlignmentMap.length > 0;
        const usesStaticTranslatedSubtitles =
          translatedSubtitleContext.isTranslated && !usesMappedTranslatedSubtitles;
        const transcriptionLanguageCode = getTranscriptionLanguageCode(
          translatedSubtitleContext.audioLanguage || sessionData.sessionLanguage || 'EN',
        );
        const layerFontLanguage = firstConcreteLanguageString(
          translatedSubtitleContext.subtitleLanguage,
          translatedSubtitleContext.audioLanguage,
          languageForFonts,
        );
        const layerFonts = resolveLanguageFontCandidates({
          languageCode: layerFontLanguage,
          fontPreferencesByLanguage,
          hasFontPreferences,
          defaultTextFont: expressGenerationTextFont,
          defaultSpeakerFont: expressGenerationSpeakerFont,
        });
        const subtitleFont = layerFonts.subtitleFont;
        const speakerFont = layerFonts.speakerFont;
        const configuredSubtitleWordAnimation = audioLayer.subtitleWordAnimation;
        const subtitleWordAnimation =
          usesMappedTranslatedSubtitles && configuredSubtitleWordAnimation === 'none'
            ? 'highlight'
            : (configuredSubtitleWordAnimation || 'highlight');
        const audioFilePath = audioLayer.selectedLocalAudioLink;
        const transcriptText = translatedSubtitleContext.isTranslated
          ? translatedSubtitleText
          : sourceTranscriptText;
        const alignmentTranscriptText = usesMappedTranslatedSubtitles
          ? sourceTranscriptText
          : transcriptText;

        if (!transcriptText || !transcriptText.trim()) {
          skippedEmptyTranscript++;
          if (translatedSubtitleContext.isTranslated) {
            console.warn('Translated subtitle text is missing; clearing subtitles for speech layer', {
              sessionId,
              audioLayerId,
              audioLanguage: translatedSubtitleContext.audioLanguage,
              subtitleLanguage: translatedSubtitleContext.subtitleLanguage,
            });
            await addSubtitlesForSessionForAudio(sessionId, audioLayerId, []);
          }
          continue;
        }

        if (
          !translatedSubtitleContext.isTranslated &&
          (!audioFilePath || typeof audioFilePath !== 'string')
        ) {
          skippedMissingAudioLink++;
          continue;
        }

        const audioLocalFilePath = typeof audioFilePath === 'string'
          ? resolveLocalAssetPath(audioFilePath)
          : null;

        const aspectRatio = sessionData.aspectRatio;
        const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
        const audiotLayerStartFrame = secondsToFrame(audioLayer.startTime, framesPerSecond);

        let showSpeaker = false;
        let speaker = 'Narrator';

        if (isMovieGen) {
          showSpeaker = true;
          const localizedSubtitleSpeaker = translatedSubtitleContext.isTranslated
            ? getTranslatedSubtitleSpeakerName(audioLayer)
            : '';
          if (localizedSubtitleSpeaker || audioLayer.speakerCharacterName) {
            speaker = localizedSubtitleSpeaker || audioLayer.speakerCharacterName;
          }
        }

        const speakerDetails = {
          showSpeaker,
          speaker,
          speakerFont,
        };

        const buildStaticTranslatedFallback = () => {
          const staticSubtitleTiming = getStaticSubtitleTiming(sessionData, audioLayer);
          const staticSubtitleItem = buildStaticTranslatedSubtitleItem({
            subtitleText: transcriptText,
            canvasDimensions,
            subtitleFont,
            audioLayerId,
            aspectRatio,
            speakerDetails,
            subtitleLanguage: translatedSubtitleContext.subtitleLanguage,
            audioLanguage: translatedSubtitleContext.audioLanguage,
            audioDurationSeconds: staticSubtitleTiming.durationSeconds,
            frameOffsetSeconds: staticSubtitleTiming.frameOffsetSeconds,
            framesPerSecond,
          });
          return staticSubtitleItem ? [staticSubtitleItem] : [];
        };

        let newRawLayers = [];
        let alignmentToCache = null;
        if (usesStaticTranslatedSubtitles) {
          newRawLayers = buildStaticTranslatedFallback();
        } else {
          try {
            const cachedAlignment = getCachedTranscriptAlignment(
              audioLayer,
              alignmentTranscriptText,
              transcriptionLanguageCode,
              audioFilePath
            );
            const transcriptAuditContext = {
              userId,
              sessionId,
              audioLayerId,
              inferenceModel,
              selectedInferenceModelAuthorization,
              jobType: 'Express video',
              isExpressGeneration: sessionData.isExpressGeneration || sessionData.isMovieGen,
              requestType: 'transcription',
              source: 'express_video_transcription',
              localRequestId: `${sessionId}:${audioLayerId}:transcription`,
            };
            const mappedSubtitleOptions = usesMappedTranslatedSubtitles
              ? {
                subtitleAlignmentMap,
                subtitleTranscriptText: transcriptText,
                subtitleLanguage: translatedSubtitleContext.subtitleLanguage,
                audioLanguage: translatedSubtitleContext.audioLanguage,
                sourceTranscriptText: alignmentTranscriptText,
              }
              : {};
            const alignmentResult = await alignWithGentle(
              audioLocalFilePath,
              alignmentTranscriptText,
              canvasDimensions,
              subtitleFont,
              subtitleWordAnimation,
              audiotLayerStartFrame,
              audioLayerId,
              aspectRatio,
              speakerDetails,
              transcriptionLanguageCode,
              audioLayer.duration,
              framesPerSecond,
              cachedAlignment
                ? {
                  alignmentWords: cachedAlignment.words,
                  alignmentTranscriptText: cachedAlignment.transcriptText || alignmentTranscriptText,
                  auditContext: transcriptAuditContext,
                  ...mappedSubtitleOptions,
                }
                : {
                  returnAlignment: true,
                  sourceText: alignmentTranscriptText,
                  audioSource: audioFilePath,
                  auditContext: transcriptAuditContext,
                  ...mappedSubtitleOptions,
                }
            );
            if (cachedAlignment) {
              newRawLayers = alignmentResult;
            } else {
              newRawLayers = Array.isArray(alignmentResult?.rawLayers) ? alignmentResult.rawLayers : [];
              alignmentToCache = alignmentResult?.alignment || null;
            }
          } catch (err) {
            layersWithErrors++;
            console.error('Alignment generation failed; continuing', {
              sessionId,
              audioLayerId,
              audioFilePath: audioLocalFilePath,
              error: err?.response?.data || err?.message || err,
              stack: err?.stack,
            });
            newRawLayers = [];
          }

          if (usesMappedTranslatedSubtitles && newRawLayers.length === 0) {
            console.warn('Mapped translated subtitle alignment unavailable; using static fallback', {
              sessionId,
              audioLayerId,
              audioLanguage: translatedSubtitleContext.audioLanguage,
              subtitleLanguage: translatedSubtitleContext.subtitleLanguage,
              mappingEntries: subtitleAlignmentMap.length,
            });
            newRawLayers = buildStaticTranslatedFallback();
          }
        }

        if (!Array.isArray(newRawLayers) || newRawLayers.length === 0) {
          alignmentEmpty++;
        } else {
          subtitleItemsAttempted += newRawLayers.length;
        }

        try {
          await addSubtitlesForSessionForAudio(sessionId, audioLayerId, newRawLayers);
          if (alignmentToCache) {
            await VideoSession.updateOne(
              { _id: sessionId, 'audioLayers._id': audioLayerId },
              { $set: { 'audioLayers.$.transcriptAlignment': alignmentToCache } }
            );
          }
        } catch (err) {
          layersWithErrors++;
          console.error('Failed to persist subtitles for audio layer; continuing', {
            sessionId,
            audioLayerId,
            error: err?.response?.data || err?.message || err,
            stack: err?.stack,
          });
        }
        processedSpeechLayers++;
      } catch (err) {
        layersWithErrors++;
        console.error('Transcript generation failed for audio layer; continuing', {
          sessionId,
          audioLayerId,
          error: err?.response?.data || err?.message || err,
          stack: err?.stack,
        });
      }
    }

    await sessionData.save();
  } catch (err) {
    console.error('Transcript generation failed (generateTranscriptsForSessionAudioLayers)', {
      sessionId,
      error: err?.response?.data || err?.message || err,
      stack: err?.stack,
    });
    throw err;
  }
}


async function fixDurationsForSpeechLayers(sessionId) {

  // Fetch the session data
  let session = await VideoSession.findOne({ _id: sessionId });

  const layers = session.layers;

  let speechLayerIndex = 0;

  // Iterate over the audioLayers in the session
  for (let i = 0; i < session.audioLayers.length; i++) {
    let currentAudioLayer = session.audioLayers[i];

    // Only process layers with generationType 'speech'
    if (currentAudioLayer.generationType === 'speech') {

      const corrLayer = layers[speechLayerIndex];

      // Calculate the new endTime
      currentAudioLayer.endTime = currentAudioLayer.startTime + currentAudioLayer.duration ;

      // Mark the nested subdocument as modified
      session.markModified(`audioLayers.${i}.endTime`);
      speechLayerIndex++;
    }
  }

  // Save the session to persist changes
  await session.save();
}



function normalizeTranscriptToken(value) {
  if (!value || typeof value !== 'string') return '';
  return value
    .replace(/[’`]/g, "'")
    .toLowerCase();
}

function extractWordToken(value) {
  if (!value || typeof value !== 'string') return '';
  const normalized = value.replace(/[’`]/g, "'");
  const match = normalized.match(/[\p{L}\p{N}_']+/u);
  return match ? match[0] : '';
}

function tokenizeTranscript(transcriptText) {
  const tokens = [];
  const regex = /[\p{L}\p{N}_']+/gu;
  let match;
  while ((match = regex.exec(transcriptText)) !== null) {
    tokens.push({
      raw: match[0],
      normalized: normalizeTranscriptToken(match[0]),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

function mapWordsToTranscriptPositions(transcriptText, words) {
  const wordPositions = {};

  if (!transcriptText || typeof transcriptText !== 'string' || !Array.isArray(words) || words.length === 0) {
    return wordPositions;
  }

  const transcriptTokens = tokenizeTranscript(transcriptText);
  if (!transcriptTokens.length) {
    return wordPositions;
  }

  let tokenIndex = 0;

  words.forEach((wordInfo, index) => {
    const token = normalizeTranscriptToken(extractWordToken(wordInfo?.word || ''));
    if (!token) return;

    for (let i = tokenIndex; i < transcriptTokens.length; i += 1) {
      if (transcriptTokens[i].normalized === token) {
        wordPositions[index] = { start: transcriptTokens[i].start, end: transcriptTokens[i].end };
        tokenIndex = i + 1;
        return;
      }
    }
  });

  return wordPositions;
}

function buildFallbackSegments(validWords) {
  const segments = [];
  for (let i = 0; i < validWords.length; i += MAX_WORDS_PER_SEGMENT) {
    const chunk = validWords.slice(i, i + MAX_WORDS_PER_SEGMENT).map((wordInfo, idx) => ({
      ...wordInfo,
      index: i + idx,
    }));
    segments.push({ words: chunk, boundaryEnd: null });
  }
  return segments;
}

function sanitizeTranscriptForAlignment(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return '';
  }
  return rawText
    .normalize('NFKC')
    .replace(/[^\p{L}\p{M}\p{N}_\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSegmenterLocale(languageCode) {
  const normalizedLanguage = typeof languageCode === 'string'
    ? languageCode.trim().toLowerCase().replace(/_/g, '-')
    : '';
  const locale = normalizedLanguage === 'cn' ? 'zh' : normalizedLanguage;

  if (
    !locale ||
    typeof Intl === 'undefined' ||
    typeof Intl.getCanonicalLocales !== 'function'
  ) {
    return undefined;
  }

  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}

function normalizeTranscriptionLanguageCode(languageCode) {
  if (typeof languageCode !== 'string') {
    return undefined;
  }
  const baseLanguage = languageCode.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  if (!baseLanguage || baseLanguage === 'auto') {
    return undefined;
  }
  return baseLanguage === 'cn' ? 'zh' : baseLanguage;
}

function tokenizeTranscriptForAlignment(rawText, languageCode) {
  const cleanedTranscript = sanitizeTranscriptForAlignment(rawText);
  if (!cleanedTranscript) {
    return [];
  }

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(normalizeSegmenterLocale(languageCode), {
        granularity: 'word',
      });
      const segmentedWords = Array.from(segmenter.segment(cleanedTranscript))
        .filter((entry) => entry?.isWordLike)
        .map((entry) => entry.segment.trim())
        .filter(Boolean);
      if (segmentedWords.length > 0) {
        return segmentedWords;
      }
    } catch {
      // Continue to deterministic whitespace/grapheme tokenization below.
    }
  }

  const whitespaceTokens = cleanedTranscript.split(/\s+/).filter(Boolean);
  if (
    whitespaceTokens.length === 1 &&
    CJK_CHARACTER_REGEX.test(whitespaceTokens[0])
  ) {
    return Array.from(whitespaceTokens[0]).filter((character) =>
      /[\p{L}\p{M}\p{N}_']/u.test(character));
  }
  return whitespaceTokens;
}

function buildTimedWordAlignment(wordsList, audioDurationSeconds, caseLabel) {
  const tokens = Array.isArray(wordsList)
    ? wordsList.map((word) => (typeof word === 'string' ? word.trim() : '')).filter(Boolean)
    : [];

  if (!tokens.length) {
    return [];
  }

  let durationSeconds = Number(audioDurationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    durationSeconds = (0.5 * tokens.length) || 0.5;
  }

  const step = durationSeconds / Math.max(tokens.length, 1);
  return tokens.map((word, idx) => {
    const start = Math.round(idx * step * 1000) / 1000;
    const end = Math.round(Math.min(durationSeconds, (idx + 1) * step) * 1000) / 1000;
    return {
      alignedWord: word,
      word,
      start,
      end,
      case: caseLabel,
    };
  });
}

const ffprobeAsync = promisify(ffmpeg.ffprobe);

async function getAudioDurationSeconds(audioFilePath) {
  if (!audioFilePath || typeof audioFilePath !== 'string') {
    return null;
  }

  try {
    const metadata = await ffprobeAsync(audioFilePath);
    const formatDuration = Number(metadata?.format?.duration);
    if (Number.isFinite(formatDuration) && formatDuration > 0) {
      return formatDuration;
    }

    const audioStream = Array.isArray(metadata?.streams)
      ? metadata.streams.find((stream) => stream?.codec_type === 'audio')
      : null;
    const streamDuration = Number(audioStream?.duration);
    if (Number.isFinite(streamDuration) && streamDuration > 0) {
      return streamDuration;
    }
  } catch {
  }

  return null;
}

function resolveEffectiveAudioDurationSeconds(requestedDurationSeconds, probedDurationSeconds) {
  const requested = Number(requestedDurationSeconds);
  const probed = Number(probedDurationSeconds);

  const hasRequested = Number.isFinite(requested) && requested > 0;
  const hasProbed = Number.isFinite(probed) && probed > 0;

  if (hasRequested && hasProbed) {
    return Math.min(requested, probed);
  }
  if (hasProbed) {
    return probed;
  }
  if (hasRequested) {
    return requested;
  }
  return null;
}

function normalizeAlignedWords(rawWords, maxDurationSeconds = null) {
  if (!Array.isArray(rawWords) || rawWords.length === 0) {
    return [];
  }

  const durationLimit = Number(maxDurationSeconds);
  const hasLimit = Number.isFinite(durationLimit) && durationLimit > 0;

  return rawWords
    .map((wordInfo) => {
      const rawWord = typeof wordInfo?.word === 'string' ? wordInfo.word : '';
      if (!rawWord.trim()) {
        return null;
      }

      const start = Number(wordInfo?.start);
      const end = Number(wordInfo?.end);

      const safeStart = Number.isFinite(start) ? Math.max(start, 0) : 0;
      let safeEnd = Number.isFinite(end) ? end : (safeStart + 0.5);

      if (!Number.isFinite(safeEnd) || safeEnd <= safeStart) {
        safeEnd = safeStart + 0.5;
      }

      if (hasLimit) {
        if (safeStart >= durationLimit) {
          return null;
        }
        safeEnd = Math.min(safeEnd, durationLimit);
      }

      return {
        alignedWord: rawWord,
        word: rawWord,
        start: safeStart,
        end: safeEnd,
        case: wordInfo?.case || 'success',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function normalizeMappingMatchText(value = '') {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function findSourceAlignmentSpan(alignedWords, sourceText, startIndex = 0) {
  const target = normalizeMappingMatchText(sourceText);
  if (!target || !Array.isArray(alignedWords) || alignedWords.length === 0) {
    return null;
  }

  for (let start = Math.max(0, startIndex); start < alignedWords.length; start += 1) {
    let accumulated = '';
    for (let end = start; end < alignedWords.length; end += 1) {
      accumulated += normalizeMappingMatchText(alignedWords[end]?.word || '');
      if (!accumulated) {
        continue;
      }
      if (accumulated === target) {
        return { start, end };
      }
      if (!target.startsWith(accumulated)) {
        break;
      }
    }
  }

  return null;
}

function joinMappedTranslatedText(mapping = []) {
  return mapping
    .map((entry) => entry.translatedText)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([,.;:!?、。，！？])/gu, '$1')
    .trim();
}

function buildMappedSubtitleAlignment(alignedWords = [], rawMapping = [], subtitleText = '') {
  const sourceWords = normalizeAlignedWords(alignedWords);
  const mapping = Array.isArray(rawMapping)
    ? rawMapping.map(normalizeSubtitleAlignmentMapEntry).filter(Boolean)
    : [];

  if (sourceWords.length === 0 || mapping.length === 0 || sourceWords.length < mapping.length) {
    return null;
  }

  const mappedWords = [];
  let sourceCursor = 0;
  let exactMatchCount = 0;

  for (let mappingIndex = 0; mappingIndex < mapping.length; mappingIndex += 1) {
    const entry = mapping[mappingIndex];
    if (sourceCursor >= sourceWords.length) {
      return null;
    }

    const exactSpan = findSourceAlignmentSpan(sourceWords, entry.sourceText, sourceCursor);
    let spanStart = sourceCursor;
    let spanEnd;
    let matchType;

    if (exactSpan) {
      // Include any unmatched transcription token before the ordered match so
      // the target timeline remains continuous rather than silently dropping time.
      spanEnd = exactSpan.end;
      matchType = exactSpan.start === sourceCursor ? 'exact' : 'ordered_exact';
      exactMatchCount += 1;
    } else {
      const remainingMappings = mapping.length - mappingIndex - 1;
      const availableWords = sourceWords.length - sourceCursor;
      const maxWordsForEntry = Math.max(1, availableWords - remainingMappings);
      const estimatedSourceWordCount = Math.max(1, tokenizeTranscript(entry.sourceText).length);
      spanEnd = sourceCursor + Math.min(estimatedSourceWordCount, maxWordsForEntry) - 1;
      matchType = 'ordered_fallback';
    }

    if (mappingIndex === mapping.length - 1) {
      spanEnd = sourceWords.length - 1;
    }

    const firstSourceWord = sourceWords[spanStart];
    const lastSourceWord = sourceWords[spanEnd];
    if (!firstSourceWord || !lastSourceWord) {
      return null;
    }

    mappedWords.push({
      word: entry.translatedText,
      alignedWord: entry.translatedText,
      start: firstSourceWord.start,
      end: lastSourceWord.end,
      case: 'translated_mapping',
      sourceText: entry.sourceText,
      translatedText: entry.translatedText,
      sourceWordStartIndex: spanStart,
      sourceWordEndIndex: spanEnd,
      mappingIndex,
      matchType,
    });
    sourceCursor = spanEnd + 1;
  }

  return {
    words: mappedWords,
    sourceWords,
    mapping,
    transcriptText: firstNonEmptyString(subtitleText, joinMappedTranslatedText(mapping)),
    exactMatchCount,
    usedFallback: exactMatchCount !== mapping.length,
  };
}

function mapTranslatedPhrasesToTranscriptPositions(transcriptText, words = []) {
  const positions = {};
  if (typeof transcriptText !== 'string' || !transcriptText.trim() || !Array.isArray(words)) {
    return positions;
  }

  const comparableTranscript = transcriptText.toLocaleLowerCase();
  let cursor = 0;
  words.forEach((wordInfo, index) => {
    const phrase = typeof wordInfo?.word === 'string' ? wordInfo.word.trim() : '';
    if (!phrase) {
      return;
    }
    const phraseIndex = comparableTranscript.indexOf(phrase.toLocaleLowerCase(), cursor);
    if (phraseIndex < 0) {
      return;
    }
    positions[index] = { start: phraseIndex, end: phraseIndex + phrase.length };
    cursor = phraseIndex + phrase.length;
  });

  return positions;
}

function getMappedSubtitleItemMetadata(options = {}, mappedAlignment = null) {
  if (!mappedAlignment) {
    return {};
  }

  return {
    subtitleTranslationRequired: true,
    subtitleRenderMode: 'mapped',
    isStaticSubtitle: false,
    subtitleAlignmentMapped: true,
    subtitleAlignmentMap: mappedAlignment.mapping,
    subtitleLanguage: options.subtitleLanguage || null,
    audioLanguage: options.audioLanguage || null,
    sourceTranscriptText: options.sourceTranscriptText || null,
    subtitleText: mappedAlignment.transcriptText || null,
  };
}

function normalizeAlignmentCacheText(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function normalizeAlignmentCacheSource(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeAlignmentCacheLanguage(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function getCachedTranscriptAlignment(audioLayer = {}, transcriptText = '', languageCode = null, audioSource = null) {
  const alignment = audioLayer?.transcriptAlignment;
  if (!alignment || typeof alignment !== 'object') {
    return null;
  }

  const cachedWords = normalizeAlignedWords(alignment.words, alignment.durationSeconds || audioLayer?.duration);
  if (!hasAuthoritativeWordTimings(cachedWords)) {
    return null;
  }

  const cachedSourceText = normalizeAlignmentCacheText(alignment.sourceText);
  const nextSourceText = normalizeAlignmentCacheText(transcriptText);
  if (cachedSourceText && nextSourceText && cachedSourceText !== nextSourceText) {
    return null;
  }

  const cachedAudioSource = normalizeAlignmentCacheSource(alignment.audioSource);
  const nextAudioSource = normalizeAlignmentCacheSource(audioSource);
  if (cachedAudioSource && nextAudioSource && cachedAudioSource !== nextAudioSource) {
    return null;
  }

  const cachedLanguage = normalizeAlignmentCacheLanguage(alignment.languageCode);
  const nextLanguage = normalizeAlignmentCacheLanguage(languageCode);
  if (cachedLanguage && nextLanguage && cachedLanguage !== nextLanguage) {
    return null;
  }

  return {
    ...alignment,
    words: cachedWords,
    transcriptText: alignment.transcriptText || transcriptText || alignment.sourceText || '',
  };
}

function buildTranscriptAlignmentCache({
  words = [],
  transcriptText = '',
  sourceText = '',
  languageCode = null,
  audioSource = null,
  durationSeconds = null,
} = {}) {
  if (!hasAuthoritativeWordTimings(words)) {
    return null;
  }
  const normalizedWords = normalizeAlignedWords(words, durationSeconds);
  if (normalizedWords.length === 0) {
    return null;
  }

  const resolvedDuration = Number(durationSeconds);

  return {
    version: 1,
    provider: 'openai',
    transcriptText: transcriptText || sourceText || '',
    sourceText: sourceText || transcriptText || '',
    languageCode: languageCode || null,
    audioSource: audioSource || null,
    durationSeconds: Number.isFinite(resolvedDuration) && resolvedDuration > 0 ? resolvedDuration : null,
    generatedAt: new Date(),
    words: normalizedWords.map((wordInfo) => ({
      word: wordInfo.word,
      alignedWord: wordInfo.alignedWord || wordInfo.word,
      start: Math.round(wordInfo.start * 1000) / 1000,
      end: Math.round(wordInfo.end * 1000) / 1000,
      case: wordInfo.case || 'success',
    })),
  };
}

function normalizeRawWordEntry(wordInfo = {}) {
  const rawWord = typeof wordInfo?.word === 'string'
    ? wordInfo.word
    : (typeof wordInfo?.text === 'string' ? wordInfo.text : '');
  const rawStart = wordInfo?.start;
  const rawEnd = wordInfo?.end;
  const hasAuthoritativeTiming = (
    Number.isFinite(rawStart) &&
    Number.isFinite(rawEnd) &&
    rawStart >= 0 &&
    rawEnd > rawStart
  );
  return {
    word: rawWord,
    start: Number(rawStart),
    end: Number(rawEnd),
    case: wordInfo?.case || (hasAuthoritativeTiming ? 'success' : 'invalid_timestamp_fallback'),
  };
}

function getRawWordText(wordInfo = {}) {
  return typeof wordInfo?.word === 'string'
    ? wordInfo.word
    : (typeof wordInfo?.text === 'string' ? wordInfo.text : '');
}

function hasAuthoritativeWordTimings(rawWords) {
  if (!Array.isArray(rawWords)) {
    return false;
  }

  const nonemptyWords = rawWords.filter((wordInfo) => getRawWordText(wordInfo).trim());
  return nonemptyWords.length > 0 && nonemptyWords.every((wordInfo) => {
    const start = wordInfo?.start;
    const end = wordInfo?.end;
    const timingCase = typeof wordInfo?.case === 'string' ? wordInfo.case : 'success';
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      timingCase === 'success'
    );
  });
}

function hasExplicitWordTimings(response = {}) {
  if (Array.isArray(response?.words) && response.words.length > 0) {
    return hasAuthoritativeWordTimings(response.words);
  }
  if (Array.isArray(response?.segments)) {
    const transcriptSegments = response.segments.filter((segment) => {
      const hasText = typeof segment?.text === 'string' && Boolean(segment.text.trim());
      const hasWords = Array.isArray(segment?.words) && segment.words.length > 0;
      return hasText || hasWords;
    });
    return transcriptSegments.length > 0 && transcriptSegments.every((segment) =>
      Array.isArray(segment?.words) && hasAuthoritativeWordTimings(segment.words));
  }
  return false;
}

function collectRawWordsFromResponse(response = {}, languageCode) {
  const rawWords = Array.isArray(response?.words)
    ? response.words.map(normalizeRawWordEntry)
    : [];

  if (!rawWords.length && Array.isArray(response?.segments)) {
    response.segments.forEach((segment) => {
      if (!segment) return;
      if (Array.isArray(segment.words) && segment.words.length > 0) {
        rawWords.push(...segment.words.map(normalizeRawWordEntry));
        return;
      }

      const segmentText = typeof segment.text === 'string' ? segment.text.trim() : '';
      const segmentStart = Number(segment.start);
      const segmentEnd = Number(segment.end);
      if (!segmentText || !Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) {
        return;
      }

      const segmentWords = tokenizeTranscriptForAlignment(segmentText, languageCode);
      if (!segmentWords.length) {
        return;
      }

      const duration = segmentEnd - segmentStart;
      const step = duration / segmentWords.length;
      segmentWords.forEach((word, idx) => {
        rawWords.push({
          word,
          start: segmentStart + idx * step,
          end: segmentStart + (idx + 1) * step,
          case: 'segment_fallback',
        });
      });
    });
  }

  return rawWords;
}

function normalizeModelName(model) {
  return typeof model === 'string' ? model.trim().toLowerCase() : '';
}

function getWordTimestampCapability(model) {
  const normalizedModel = normalizeModelName(model);
  if (!normalizedModel) {
    return false;
  }
  if (normalizedModel === 'whisper-1' || normalizedModel.startsWith('whisper-1-')) {
    return true;
  }
  if (
    normalizedModel.includes('gpt-4o-transcribe') ||
    normalizedModel.includes('gpt-4o-mini-transcribe')
  ) {
    return false;
  }
  return null;
}

function buildTranscriptionAttempts(
  transcriptionModel = TRANSCRIPTION_MODEL,
  wordTimestampModel = WORD_TIMESTAMP_TRANSCRIPTION_MODEL,
) {
  const configuredModel = typeof transcriptionModel === 'string'
    ? transcriptionModel.trim()
    : '';
  const alignmentModel = typeof wordTimestampModel === 'string'
    ? wordTimestampModel.trim()
    : '';
  const attempts = [];

  const addTimestampAttempt = (model) => {
    if (!model || getWordTimestampCapability(model) === false) {
      return;
    }
    if (attempts.some((attempt) =>
      normalizeModelName(attempt.model) === normalizeModelName(model) &&
      attempt.response_format === 'verbose_json')) {
      return;
    }
    attempts.push({
      model,
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
      requiresExplicitWordTimings: true,
    });
  };

  addTimestampAttempt(configuredModel);
  addTimestampAttempt(alignmentModel);

  if (configuredModel) {
    attempts.push({
      model: configuredModel,
      response_format: 'json',
      requiresExplicitWordTimings: false,
    });
  }

  return attempts;
}

async function transcribeWithOpenAI(
  audioFilePath,
  transcriptText,
  languageCode,
  audioDurationSeconds = null,
  auditContext = {},
  options = {},
) {
  try {
    const transcriptionModel = options.transcriptionModel || TRANSCRIPTION_MODEL;
    const wordTimestampModel = options.wordTimestampModel || WORD_TIMESTAMP_TRANSCRIPTION_MODEL;
    const transcriptionClient = options.openaiClient || openai;
    const createReadStream = options.createReadStream || fs.createReadStream;
    const recordUsageLog = options.recordUsageLog || recordProviderUsageLog;

    const requestPayloadBase = {
      language: normalizeTranscriptionLanguageCode(languageCode),
      prompt: transcriptText && transcriptText.trim() ? transcriptText : undefined,
    };

    const attempts = buildTranscriptionAttempts(transcriptionModel, wordTimestampModel);

    let response = null;
    let lastError = null;

    for (const attempt of attempts) {
      const fileStream = createReadStream(audioFilePath);
      const { requiresExplicitWordTimings, ...requestAttempt } = attempt;
      const payload = { ...requestPayloadBase, ...requestAttempt, file: fileStream };
      try {
        const candidateResponse = await transcriptionClient.audio.transcriptions.create(payload);
        await recordUsageLog({
          payload: auditContext,
          userId: auditContext.userId,
          sessionId: auditContext.sessionId,
          audioLayerId: auditContext.audioLayerId,
          localRequestId: auditContext.localRequestId,
          providerRequestId: candidateResponse?.id,
          idempotencyKey: [
            'samsar_express_video_listener',
            auditContext.localRequestId,
            'transcription',
            attempt.model,
            attempt.response_format,
            candidateResponse?.id || Date.now(),
          ].filter(Boolean).join(':'),
          requestType: 'transcription',
          callType: 'transcription',
          provider: 'openai',
          model: attempt.model,
          source: auditContext.source || 'express_video_transcription',
          service: 'samsar_express_video_listener',
          status: 'requested',
          metadata: {
            responseFormat: attempt.response_format,
            languageCode,
            audioDurationSeconds,
          },
        });
        if (requiresExplicitWordTimings) {
          try {
            if (hasExplicitWordTimings(candidateResponse)) {
              console.info('OpenAI transcription returned word timestamps', {
                model: attempt.model,
                responseFormat: attempt.response_format,
              });
            } else {
              lastError = new Error(
                `OpenAI transcription model ${attempt.model} returned no explicit word timestamps`,
              );
              console.warn('OpenAI transcription missing word timestamps; trying the next alignment model', {
                model: attempt.model,
                responseFormat: attempt.response_format,
              });
              continue;
            }
          } catch (parseErr) {
            lastError = parseErr;
            console.warn('Failed to parse timestamped transcription; trying the next alignment model', {
              model: attempt.model,
              responseFormat: attempt.response_format,
              error: parseErr?.message || parseErr,
            });
            continue;
          }
        }
        response = candidateResponse;
        break;
      } catch (err) {
        lastError = err;
        if (requiresExplicitWordTimings) {
          console.warn('OpenAI timestamped transcription failed; trying the next alignment model', {
            model: attempt.model,
            responseFormat: attempt.response_format,
            error: err?.response?.data || err?.message || err,
          });
        }
      } finally {
        if (fileStream && typeof fileStream.destroy === 'function') {
          fileStream.destroy();
        }
      }
    }

    if (!response) {
      throw lastError || new Error('OpenAI transcription failed');
    }

    const durationSeconds = (() => {
      if (!response || typeof response !== 'object') {
        return null;
      }
      const direct = Number(response.duration);
      if (Number.isFinite(direct) && direct > 0) {
        return direct;
      }
      const usage = response.usage;
      const seconds = usage && typeof usage === 'object' && usage.type === 'duration' ? Number(usage.seconds) : NaN;
      if (Number.isFinite(seconds) && seconds > 0) {
        return seconds;
      }
      return null;
    })();

    const effectiveDurationSeconds = (Number.isFinite(durationSeconds) && durationSeconds > 0)
      ? durationSeconds
      : audioDurationSeconds;

    const openAiTranscript = (typeof response === 'string') ? response : (response?.text || '');
    const rawWords = collectRawWordsFromResponse(response, languageCode);

    let words = rawWords
      .map((w) => {
        const rawWord = typeof w.word === 'string' ? w.word : (typeof w.text === 'string' ? w.text : '');
        const start = Number(w.start);
        const end = Number(w.end);
        const safeStart = Number.isFinite(start) ? start : 0;
        const safeEnd = Number.isFinite(end) ? end : safeStart + 0.5;
        return {
          alignedWord: rawWord,
          word: rawWord,
          start: safeStart,
          end: safeEnd,
          case: w.case || 'success',
        };
      })
      .filter((w) => w.word.trim() !== '');

    if (!words.length) {
      const fallbackTranscript = transcriptText?.trim() ? transcriptText : openAiTranscript;
      if (fallbackTranscript) {
        words = buildTimedWordAlignment(
          tokenizeTranscriptForAlignment(fallbackTranscript, languageCode),
          effectiveDurationSeconds,
          'fallback',
        );
      }
    }

    return {
      words: normalizeAlignedWords(words, effectiveDurationSeconds),
      transcriptText: transcriptText && transcriptText.trim() ? transcriptText : openAiTranscript,
    };
  } catch (err) {
    console.error('OpenAI transcription failed', err?.response?.data || err?.message || err);

    const fallbackTranscript = transcriptText?.trim() ? transcriptText : '';
    const words = buildTimedWordAlignment(
      tokenizeTranscriptForAlignment(fallbackTranscript, languageCode),
      audioDurationSeconds,
      'fallback_error',
    );

    return { words: normalizeAlignedWords(words, audioDurationSeconds), transcriptText: fallbackTranscript };
  }
}

// ... (no changes in imports and initial code)

async function alignWithGentle(
  audioFilePath,
  transcriptText,
  canvasDimensions,
  subtitleFont,
  subtitleWordAnimation,
  audioLayerStartFrame,
  audioLayerId,
  aspectRatio,
  speakerDetails = {},
  transcriptionLanguageCode,
  audioDurationSeconds = null,
  framesPerSecond,
  options = {}
) {
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);
  const cachedWords = Array.isArray(options.alignmentWords)
    ? normalizeAlignedWords(options.alignmentWords, audioDurationSeconds)
    : null;

  if (!cachedWords && (!audioFilePath || !fs.existsSync(audioFilePath))) {
    console.error('Audio file missing; cannot generate alignment', { audioFilePath, audioLayerId });
    return options.returnAlignment ? { rawLayers: [], alignment: null } : [];
  }

  try {
    let effectiveDurationSeconds = audioDurationSeconds;
    let alignedWords = cachedWords || [];
    let resolvedTranscript = options.alignmentTranscriptText || transcriptText;

    if (!cachedWords) {
      const probedDurationSeconds = await getAudioDurationSeconds(audioFilePath);
      effectiveDurationSeconds = resolveEffectiveAudioDurationSeconds(audioDurationSeconds, probedDurationSeconds);
      const openAiResult = await transcribeWithOpenAI(
        audioFilePath,
        transcriptText,
        transcriptionLanguageCode,
        effectiveDurationSeconds,
        options.auditContext,
      );
      alignedWords = normalizeAlignedWords(openAiResult?.words, effectiveDurationSeconds);
      resolvedTranscript = openAiResult?.transcriptText || transcriptText;
    }

    const sourceValidWords = (alignedWords || []).filter(wordInfo => wordInfo.word.trim() !== '');

    if (sourceValidWords.length === 0) {
      return options.returnAlignment ? { rawLayers: [], alignment: null } : [];
    }

    const requestsMappedSubtitle = Array.isArray(options.subtitleAlignmentMap);
    const mappedSubtitleAlignment = requestsMappedSubtitle
      ? buildMappedSubtitleAlignment(
        sourceValidWords,
        options.subtitleAlignmentMap,
        options.subtitleTranscriptText,
      )
      : null;

    if (requestsMappedSubtitle && !mappedSubtitleAlignment) {
      const alignment = cachedWords ? null : buildTranscriptAlignmentCache({
        words: alignedWords,
        transcriptText: resolvedTranscript || transcriptText || '',
        sourceText: options.sourceText || transcriptText || '',
        languageCode: transcriptionLanguageCode,
        audioSource: options.audioSource || audioFilePath,
        durationSeconds: effectiveDurationSeconds,
      });
      return options.returnAlignment ? { rawLayers: [], alignment } : [];
    }

    const validWords = mappedSubtitleAlignment?.words || sourceValidWords;
    const transcriptForMapping = mappedSubtitleAlignment?.transcriptText || resolvedTranscript || transcriptText || '';
    const wordPositions = transcriptForMapping
      ? (
        mappedSubtitleAlignment
          ? mapTranslatedPhrasesToTranscriptPositions(transcriptForMapping, validWords)
          : mapWordsToTranscriptPositions(transcriptForMapping, validWords)
      )
      : {};
    let segments = buildSubtitleSegments(validWords, wordPositions, transcriptForMapping);
    if (!segments || segments.length === 0) {
      segments = buildFallbackSegments(validWords);
    }

    const subtitleY = getSubtitleYPosition(aspectRatio, canvasDimensions);

    const newTextLayersPromises = segments.map(async (segment) => {
      if (!segment.words || segment.words.length === 0) {
        return null;
      }

      const firstWord = segment.words[0];
      const lastWord = segment.words[segment.words.length - 1];

      const firstWordPos = wordPositions[firstWord.index];
      const lastWordPos = wordPositions[lastWord.index];

      const subtitleStart = parseFloat(firstWord.start) || 0;
      const subtitleEnd = parseFloat(lastWord.end) || (subtitleStart + 0.6);

      const { frameDuration, frameOffset } = calculateFrameOffset(
        subtitleStart,
        subtitleEnd,
        effectiveFramesPerSecond
      );

      const segmentTextEnd = segment.boundaryEnd || lastWordPos?.end;

      let substring = '';
      if (firstWordPos && segmentTextEnd !== undefined && segmentTextEnd !== null && transcriptForMapping) {
        substring = transcriptForMapping.substring(firstWordPos.start, segmentTextEnd).trim().toUpperCase();
      }

      if (!substring) {
        substring = segment.words.map(w => w.word).join(' ').trim().toUpperCase();
      }

      if (!substring) {
        return null;
      }

      const textHeight = 90;
      let fontSize = 48;
      if (canvasDimensions.width < 1024) {
        fontSize = 42;
      }


      const fontFamily = subtitleFont ? subtitleFont : DEFAULT_LATIN_SUBTITLE_FONT;



      // Calculate the width of the text
      const textWidth = calculateTextWidth(substring, fontSize, fontFamily, canvasDimensions);

      let rotationAngle = 0;
      const textX = canvasDimensions.width / 2;
      const textY = subtitleY;

      const autoWrap = Boolean(mappedSubtitleAlignment);

      const breakTextWidth = canvasDimensions.width - 200;

      const wordData = segment.words.map(w => {
        const wordStartTime = (parseFloat(w.start) || 0);
        const wordEndTime = (parseFloat(w.end));
        const wordDuration = wordEndTime - wordStartTime;

        const wordFrameOffset = secondsToFrame(wordStartTime, effectiveFramesPerSecond) + audioLayerStartFrame;
        const wordFrameDuration = Math.max(1, secondsToFrame(wordDuration, effectiveFramesPerSecond));
        const item = {
          word: w.word.trim().toUpperCase(),
          frameOffset: wordFrameOffset,
          frameDuration: wordFrameDuration
        };
        if (mappedSubtitleAlignment) {
          item.sourceText = w.sourceText;
          item.translatedText = w.translatedText;
          item.sourceWordStartIndex = w.sourceWordStartIndex;
          item.sourceWordEndIndex = w.sourceWordEndIndex;
          item.mappingIndex = w.mappingIndex;
          item.mappingMatchType = w.matchType;
        }
        return item;
      });

      const subtitleSourceWords = mappedSubtitleAlignment
        ? mappedSubtitleAlignment.sourceWords
          .slice(firstWord.sourceWordStartIndex, lastWord.sourceWordEndIndex + 1)
          .map((sourceWord) => {
            const sourceWordStart = parseFloat(sourceWord.start) || 0;
            const sourceWordEnd = parseFloat(sourceWord.end);
            return {
              word: sourceWord.word,
              frameOffset: secondsToFrame(sourceWordStart, effectiveFramesPerSecond) + audioLayerStartFrame,
              frameDuration: Math.max(
                1,
                secondsToFrame(sourceWordEnd - sourceWordStart, effectiveFramesPerSecond),
              ),
            };
          })
        : undefined;


      let textAccent;

      if (subtitleWordAnimation === 'system_preset') {
        textAccent = await getAccentForText(substring, {
          ...(options.auditContext || {}),
          requestType: 'subtitle_accent_inference',
          source: 'express_video_subtitle_accent',
          localRequestId: `${options.auditContext?.localRequestId || audioLayerId}:subtitle_accent:${firstWord.index}`,
          sourceTask: 'subtitle_accent',
        });
      }

      // Determine fontColor based on textAccent
      let fontColor = '#FFFFFF'; // default to white if no accent
      if (textAccent) {
        switch (textAccent) {
          case 'bleeding':
            fontColor = '#FF0000'; // red
            break;
          case 'glowing':
            fontColor = '#FFFF00'; // yellow
            break;
          case 'throbbing':
            fontColor = '#FF00FF'; // magenta
            break;
          case 'shimmering':
            fontColor = '#00FFFF'; // cyan
            break;
          case 'wobbling':
            fontColor = '#00FF00'; // green
            break;
          case 'rising':
            fontColor = '#ADD8E6'; // light blue
            break;
          default:
            fontColor = '#FFFFFF'; // fallback to white
        }
      }


      const speakerFontSize = Math.round(fontSize * 0.78);

      const textItem = {
        type: 'text',
        text: substring,
        config: {
          width: textWidth,
          height: textHeight,
          fontSize: fontSize,
          fontFamily: subtitleFont,
          fillColor: fontColor,
          autoWrap: autoWrap,
          strokeColor: '#000000',
          strokeWidth: 3,
          textAlign: 'center',
          capitalizeLetters: true,
          fontEmphasis: 'bold',
          textShadow: {
            color: 'rgba(0, 0, 0, 0.35)',
            blur: 6,
            offsetX: 2,
            offsetY: 2
          },
          linePaddingPx: 2,
          lineHeight: 1.12,
          speakerGapPx: 18,
          x: textX,
          y: textY,
          frameDuration: frameDuration,
          frameOffset: frameOffset,
          rotationAngle: rotationAngle,
          speakerFontFamily: speakerDetails.speakerFont || DEFAULT_LATIN_SUBTITLE_FONT,
          speakerFontSize,
          speakerFillColor: '#FFD166',
          speakerStrokeColor: '#000000',
          speakerStrokeWidth: 3,
          speakerFontEmphasis: 'bold',
        },
        animation: 'fade-in',
        subType: 'subtitle',
        words: wordData,
        wordAnimation: subtitleWordAnimation,
        textAccent: textAccent,
        breakTextWidth: breakTextWidth,
        audioLayerId: audioLayerId,
        speaker: speakerDetails.speaker,
        showSpeaker: Boolean(speakerDetails.showSpeaker),
        speakerFontFamily: speakerDetails.speakerFont,
        ...(subtitleSourceWords ? { subtitleSourceWords } : {}),
        ...getMappedSubtitleItemMetadata(options, mappedSubtitleAlignment),
      };

      return textItem;
    });

    const newTextLayers = (await Promise.all(newTextLayersPromises)).filter(layer => layer !== null);
    const alignment = cachedWords ? null : buildTranscriptAlignmentCache({
      words: alignedWords,
      transcriptText: resolvedTranscript || transcriptText || '',
      sourceText: options.sourceText || transcriptText || '',
      languageCode: transcriptionLanguageCode,
      audioSource: options.audioSource || audioFilePath,
      durationSeconds: effectiveDurationSeconds,
    });
    return options.returnAlignment ? { rawLayers: newTextLayers, alignment } : newTextLayers;
  } catch (err) {
    console.error('Failed to generate alignment/subtitles', {
      audioFilePath,
      audioLayerId,
      language: transcriptionLanguageCode || 'auto',
      error: err?.response?.data || err?.message || err,
    });
    return options.returnAlignment ? { rawLayers: [], alignment: null } : [];
  }
}

export const __testOnly__ = {
  normalizeComparableLanguageCode,
  getTranscriptionLanguageCode,
  getTranslatedSubtitleContext,
  getTranslatedSubtitleText,
  getSubtitleAlignmentMap,
  getTranslatedSubtitleSpeakerName,
  buildMappedSubtitleAlignment,
  mapTranslatedPhrasesToTranscriptPositions,
  getMappedSubtitleItemMetadata,
  resolveLanguageFontCandidates,
  resolveConnectedSceneLayer,
  getStaticSubtitleTiming,
  buildStaticTranslatedSubtitleItem,
  tokenizeTranscriptForAlignment,
  getWordTimestampCapability,
  buildTranscriptionAttempts,
  transcribeWithOpenAI,
  hasExplicitWordTimings,
  hasAuthoritativeWordTimings,
  buildTranscriptAlignmentCache,
  getCachedTranscriptAlignment,
};
