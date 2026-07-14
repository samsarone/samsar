
import fs from 'fs';
import { createCanvas } from 'canvas';
import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';
import { addSubtitlesForSessionForAudio } from './TransscriptUtils.js';
import { getAccentForText } from './AccentUtils.js';
import { resolveSubtitleFont } from '../../consts/SubtitleFonts.js';
import { transcribeWithOpenAI } from './SpeechAlignment.js';
import { getFramesPerSecondFromValue } from '../../utils/FpsUtils.js';


/**
 * Aligns speech with text using Gentle and groups words into layers.
 * Extracts substrings from the original transcript based on word groups.
 * @param {string} audioFilePath - Path to the audio file.
 * @param {string} transcriptText - The transcript text.
 * @returns {Array} - Array of text layer objects.
 */


function mapWordsToTranscriptPositions(transcriptText, words) {
  const wordPositions = {};
  let currentIndex = 0;

  words.forEach((wordInfo, index) => {
    const word = wordInfo.word.trim();
    if (!word) return;

    // Find the exact position of the word in the transcriptText starting from currentIndex
    const searchText = transcriptText.slice(currentIndex).toLowerCase();
    const targetWord = word.toLowerCase();

    const foundIndex = searchText.indexOf(targetWord);
    if (foundIndex !== -1) {
      const start = currentIndex + foundIndex;
      const end = start + targetWord.length;
      wordPositions[index] = { start, end };
      currentIndex = end;
    }
  });


  return wordPositions;
}

 
function determineNumLayers(numItems) {


  if (numItems <= 1) {
    return 1;
  } else if (numItems <= 2) {
    return 2;
  } else if (numItems <= 4) {
    return 3;
  } else if (numItems <= 6) {
    return 4;
  } else if (numItems <= 8) {
    return 6;
  } else {
    return 8;
  }
}

function secondsToFrame(timeInSeconds, framesPerSecond) {
  return Math.floor(timeInSeconds * framesPerSecond);
}



function calculateFrameOffset(startTime, endTime, framesPerSecond) {
  const frameOffset = secondsToFrame(startTime, framesPerSecond);
  const effectiveFrameOffset = frameOffset;
  const endFrame = Math.floor(endTime * framesPerSecond);
  const frameDuration = endFrame - effectiveFrameOffset;
  return { frameDuration, frameOffset: effectiveFrameOffset };
}


function calculateTextWidth(text, fontSize, fontFamily) {
  // Create a canvas context to measure the text
  const canvas = createCanvas(1024, 1024);
  const context = canvas.getContext('2d');

  // Set the font with the correct size and family
  context.font = `${fontSize}px ${fontFamily}`;

  // Measure the text width
  const metrics = context.measureText(text);
  return metrics.width;
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

function normalizeAlignmentWordsForCache(words = []) {
  if (!Array.isArray(words)) {
    return [];
  }

  return words
    .map((wordInfo) => {
      const rawWord = typeof wordInfo?.word === 'string'
        ? wordInfo.word
        : (typeof wordInfo?.alignedWord === 'string' ? wordInfo.alignedWord : '');
      const start = Number(wordInfo?.start);
      const end = Number(wordInfo?.end);

      if (!rawWord.trim() || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return null;
      }

      return {
        alignedWord: rawWord,
        word: rawWord,
        start: Math.max(0, start),
        end: Math.max(0, end),
        case: wordInfo?.case || 'success',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

export function getCachedTranscriptAlignment(audioLayer = {}, transcriptText = '', languageCode = null, audioSource = null) {
  const alignment = audioLayer?.transcriptAlignment;
  if (!alignment || typeof alignment !== 'object') {
    return null;
  }

  const cachedWords = normalizeAlignmentWordsForCache(alignment.words);
  if (cachedWords.length === 0) {
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

export function buildTranscriptAlignmentCache({
  words = [],
  transcriptText = '',
  sourceText = '',
  languageCode = null,
  audioSource = null,
  durationSeconds = null,
} = {}) {
  const normalizedWords = normalizeAlignmentWordsForCache(words);
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

export async function buildSubtitleLayersFromAlignment(
  alignedWords,
  transcriptText,
  canvasDimensions,
  subtitleFont,
  subtitleWordAnimation,
  audioLayerStartFrame,
  audioLayerId,
  alignerLanguageCode = null,
  framesPerSecond,
  userInferenceModel,
) {
  const effectiveFramesPerSecond = getFramesPerSecondFromValue(framesPerSecond);

  const validWords = normalizeAlignmentWordsForCache(alignedWords)
    .filter(wordInfo => wordInfo.word.trim() !== '');

  if (validWords.length === 0) {
    return [];
  }

    const transcriptForMapping = transcriptText || '';
    const wordPositions = transcriptForMapping
      ? mapWordsToTranscriptPositions(transcriptForMapping, validWords)
      : {};
    const numLayers = determineNumLayers(validWords.length);

    // Calculate total duration
    const totalStart = parseFloat(validWords[0].start) || 0;
    const totalEnd = parseFloat(validWords[validWords.length - 1].end) || 0.5;
    const totalDuration = totalEnd - totalStart;
    const durationPerLayer = totalDuration / numLayers;

    // Build layers
    const layers = [];
    let currentLayer = {
      words: [],
      startTime: totalStart,
      endTime: totalStart + durationPerLayer
    };

    validWords.forEach((wordInfo, index) => {
      const wordStart = parseFloat(wordInfo.start) || 0;
      const wordEnd = parseFloat(wordInfo.end) || (wordStart + 0.5);

      if (wordStart >= currentLayer.endTime && layers.length < numLayers - 1) {
        layers.push({ ...currentLayer });
        currentLayer = {
          words: [],
          startTime: currentLayer.endTime,
          endTime: currentLayer.endTime + durationPerLayer
        };
      }

      currentLayer.words.push({ ...wordInfo, index });
      currentLayer.endTime = Math.max(currentLayer.endTime, wordEnd);
    });

    if (currentLayer.words.length > 0) {
      layers.push({ ...currentLayer });
    }

    while (layers.length > numLayers) {
      const lastLayer = layers.pop();
      layers[layers.length - 1].words = layers[layers.length - 1].words.concat(lastLayer.words);
      layers[layers.length - 1].endTime = lastLayer.endTime;
    }

    while (layers.length < numLayers) {
      layers.push({
        words: [],
        startTime: totalStart + layers.length * durationPerLayer,
        endTime: totalStart + (layers.length + 1) * durationPerLayer
      });
    }

    const newTextLayersPromises = layers.map(async (layer, index) => {
      const { frameDuration, frameOffset } = calculateFrameOffset(
        layer.startTime,
        layer.endTime,
        effectiveFramesPerSecond
      );

      if (layer.words.length === 0) {
        return null;
      }

      const firstWordIndex = layer.words[0].index;
      const lastWordIndex = layer.words[layer.words.length - 1].index;

      const firstWordPos = wordPositions[firstWordIndex];
      const lastWordPos = wordPositions[lastWordIndex];

      const segmentTextEnd = lastWordPos?.end;
      let substring = '';
      if (firstWordPos && segmentTextEnd !== undefined && segmentTextEnd !== null && transcriptForMapping) {
        substring = transcriptForMapping.substring(firstWordPos.start, segmentTextEnd).toUpperCase();
      }

      if (!substring) {
        substring = layer.words.map((w) => w.word).join(' ').toUpperCase();
      }

      const textHeight = 100;
      let fontSize = 56;
      if (canvasDimensions.width < 1024) {
        fontSize = 54;
      }

      const fontFamily = resolveSubtitleFont(alignerLanguageCode || 'en', subtitleFont);



      // Calculate the width of the text
      const textWidth = calculateTextWidth(substring, fontSize, fontFamily);

      let rotationAngle = 0;
      const textX = canvasDimensions.width / 2;
      const textY = canvasDimensions.height / 2 + 300;

      // if substring length > some threshold, enable autoWrap
      // let autoWrap = substring.length > 24;
      // if (canvasDimensions.width < 1024) {
      //   autoWrap = substring.length > 12;
      // }

      const autoWrap = true;

      let breakTextWidth = 800;
      if (canvasDimensions.width > 1024) {
        breakTextWidth = 1200;
      }
      const wordData = layer.words.map(w => {
        const wordStartTime = (parseFloat(w.start) || 0);
        const wordEndTime = (parseFloat(w.end));
        const wordDuration = wordEndTime - wordStartTime;

        const wordFrameOffset = secondsToFrame(wordStartTime, effectiveFramesPerSecond) + audioLayerStartFrame;
        const wordFrameDuration = Math.max(1, secondsToFrame(wordDuration, effectiveFramesPerSecond));
        return {
          word: w.word.trim().toUpperCase(),
          frameOffset: wordFrameOffset,
          frameDuration: wordFrameDuration
        };
      });


      let textAccent;

      if (subtitleWordAnimation === 'system_preset') {
        textAccent = await getAccentForText(substring, userInferenceModel);
      }

      // Determine fontColor based on textAccent
      let fontColor = '#FAFAFA'; // default to white if no accent
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
            fontColor = '#FAFAFA'; // fallback to white
        }
      }


      const textItem = {
        type: 'text',
        text: substring,
        config: {
          width: textWidth,
          height: textHeight,
          fontSize: fontSize,
          fontFamily: fontFamily,
          fillColor: fontColor,
          autoWrap: autoWrap,
          strokeColor: '#000000',
          strokeWidth: 8,
          textAlign: 'center',
          capitalizeLetters: true,
          fontEmphasis: 'bold',
          textShadow: true,
          x: textX,
          y: textY,
          frameDuration: frameDuration,
          frameOffset: frameOffset,
          rotationAngle: rotationAngle,
        },
        animation: 'fade-in',
        subType: 'subtitle',
        words: wordData,
        wordAnimation: subtitleWordAnimation,
        textAccent: textAccent,
        breakTextWidth: breakTextWidth,
        audioLayerId: audioLayerId,

      };


      return textItem;
    });

    const newTextLayers = (await Promise.all(newTextLayersPromises)).filter(layer => layer !== null);
    return newTextLayers;
}

export async function alignSpeechLayerWithGentle(
  audioFilePath,
  transcriptText,
  canvasDimensions,
  subtitleFont,
  subtitleWordAnimation,
  audioLayerStartFrame,
  audioLayerId,
  alignerLanguageCode = null,
  audioDurationSeconds = null,
  framesPerSecond,
  options = {}
) {
  if (!audioFilePath || !fs.existsSync(audioFilePath)) {
    console.error("Audio file not found at path:", audioFilePath);
    return options.returnAlignment ? { rawLayers: [], alignment: null } : [];
  }

  try {
    const { words: alignedWords, transcriptText: resolvedTranscript } = await transcribeWithOpenAI(
      audioFilePath,
      transcriptText,
      alignerLanguageCode,
      audioDurationSeconds,
    );

    const rawLayers = await buildSubtitleLayersFromAlignment(
      alignedWords,
      resolvedTranscript || transcriptText,
      canvasDimensions,
      subtitleFont,
      subtitleWordAnimation,
      audioLayerStartFrame,
      audioLayerId,
      alignerLanguageCode,
      framesPerSecond,
      options.inferenceModel,
    );

    const alignment = buildTranscriptAlignmentCache({
      words: alignedWords,
      transcriptText: resolvedTranscript || transcriptText || '',
      sourceText: options.sourceText || transcriptText || '',
      languageCode: alignerLanguageCode,
      audioSource: options.audioSource || audioFilePath,
      durationSeconds: audioDurationSeconds,
    });

    return options.returnAlignment ? { rawLayers, alignment } : rawLayers;
  } catch (error) {
    if (error.response) {
      console.error('Gentle API Error:', error.response.status, error.response.data);
    } else if (error.request) {
      console.error('Gentle API No Response:', error.request);
    } else {
      console.error('Gentle API Setup Error:', error.message);
    }
    return options.returnAlignment ? { rawLayers: [], alignment: null } : [];
  }
}
