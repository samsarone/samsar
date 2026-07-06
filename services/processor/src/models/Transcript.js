import path from 'path';
import { createCanvas } from 'canvas';
import { getDBConnectionString } from './DBString.js';
import VideoSession from '../schema/VideoSession.js';
import { getCanvasDimensionsForAspectRatio } from '../utils/CanvasUtils.js';
import { getSessionFramesPerSecond } from '../utils/FpsUtils.js';
import { resolveSubtitleFont } from '../consts/SubtitleFonts.js';
import { transcribeWithOpenAI } from './transcripts/SpeechAlignment.js';


function getAlignerLanguageCode(languageCode = '') {
  if (typeof languageCode !== 'string') {
    return null;
  }
  const base = languageCode.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  return base && base !== 'en' ? base : null;
}

// Function to calculate the width of text
function calculateTextWidth(text, fontSize, fontFamily, canvasDimensions) {
  // Create a canvas context to measure the text
  const canvas = createCanvas(canvasDimensions.width, canvasDimensions.height);
  const context = canvas.getContext('2d');

  // Set the font with the correct size and family
  context.font = `${fontSize}px ${fontFamily}`;

  // Measure the text width
  const metrics = context.measureText(text);

  return metrics.width;
}

function secondsToFrame(timeInSeconds, framesPerSecond) {
  return Math.floor(timeInSeconds * framesPerSecond);
}

function calculateFrameOffset(startTime, endTime, layerDurationOffset = null, framesPerSecond) {
  if (layerDurationOffset !== null) {
    // Adjust times relative to the layer duration offset
    const relativeStartTime = startTime - layerDurationOffset;
    const relativeEndTime = endTime - layerDurationOffset;

    if (relativeStartTime < 0) {
      return null;
    }

    const frameOffset = secondsToFrame(relativeStartTime, framesPerSecond);
    const endFrame = secondsToFrame(relativeEndTime, framesPerSecond);
    const frameDuration = endFrame - frameOffset;
    return { frameDuration, frameOffset };
  } else {
    // Use absolute times
    const frameOffset = secondsToFrame(startTime, framesPerSecond);
    const endFrame = secondsToFrame(endTime, framesPerSecond);
    const frameDuration = endFrame - frameOffset;
    return { frameDuration, frameOffset };
  }
}



/**
 * Determines the number of layers based on the number of items.
 * @param {number} numItems - Number of items (words).
 * @returns {number} - Number of layers.
 */
function determineNumLayers(numItems) {


  if (numItems <= 1) {
    return 1;
  } else if (numItems <= 3) {
    return 2;
  } else if (numItems <= 6) {
    return 3;
  } else if (numItems <= 8) {
    return 4;
  } else if (numItems <= 12) {
    return 6;
  } else {
    return 6;
  }
}


export async function generateTranscriptsForSessionAudioLayer(sessionId, audioLayer) {
  await getDBConnectionString();
  let sessionData = await VideoSession.findById(sessionId);
  const framesPerSecond = getSessionFramesPerSecond(
    sessionData,
    'Transcript.generateTranscriptsForSessionAudioLayer'
  );

  // Find the corresponding video layer based on audioLayer.startTime
  const sessionLayers = sessionData.layers;
  let currentSessionLayer = null;

  // Find the video layer where the audioLayer's subtitles should be added
  for (let layer of sessionLayers) {
    const layerStartTime = layer.durationOffset;
    const layerEndTime = layer.durationOffset + layer.duration;
    if (audioLayer.startTime >= layerStartTime && audioLayer.startTime < layerEndTime) {
      currentSessionLayer = layer;
      break;
    }
  }

  if (!currentSessionLayer) {
    return;
  }



  const audioLayerId = audioLayer._id;

  // Use the layer's durationOffset (in seconds)
  const layerDurationOffset = currentSessionLayer.durationOffset;



  let layerActiveItems = currentSessionLayer.imageSession.activeItemList || [];
  const maxId = layerActiveItems.length - 1;

  const audioFilePath = audioLayer.selectedLocalAudioLink;
  const transcriptText = audioLayer.prompt;

  const pwd = process.cwd();
  let audioFileBase = path.join(pwd, 'assets'); // Adjust according to your file structure

  if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
    audioFileBase = 'assets'; // Use a different base for staging or docker
  }

  const audioLocalFilePath = `${audioFileBase}/${audioFilePath}`;

  const aspectRatio = sessionData.aspectRatio || '16:9';
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

  const alignerLanguageCode = getAlignerLanguageCode(sessionData.sessionLanguage || 'en');

  // Pass layerDurationOffset (in seconds) to alignWithGentle
	  const newRawLayers = await alignWithGentle(
	    audioLocalFilePath,
	    transcriptText,
	    canvasDimensions,
	    audioLayer.startTime,
	    layerDurationOffset,
	    audioLayerId,
	    alignerLanguageCode,
	    audioLayer.subtitleFont,
	    audioLayer.duration,
      framesPerSecond
	  );

    if (newRawLayers.length === 0) {
      return;
    }

  const newActiveItems = newRawLayers.map((layer, idx) => {
    return {
      id: `item_${maxId + idx + 1}`,
      ...layer
    };
  });

  currentSessionLayer.imageSession.activeItemList = [...layerActiveItems, ...newActiveItems];
  currentSessionLayer.frameGenerationPending = true;

  await sessionData.save();
}





export async function generateTranscriptsForSessionAudioLayers(sessionId, audioLayers) {
  await getDBConnectionString();
  let sessionData = await VideoSession.findById(sessionId);
  const framesPerSecond = getSessionFramesPerSecond(
    sessionData,
    'Transcript.generateTranscriptsForSessionAudioLayers'
  );
  let sessionLayers = sessionData.layers;

  for (let i = 0; i < audioLayers.length; i++) {
    const audioLayer = audioLayers[i];
    let currentSessionLayer = sessionLayers[i];

  const audioLayerId = audioLayer._id;
  if (!currentSessionLayer) {
    continue;
  }

    let layerActiveItems = currentSessionLayer.imageSession.activeItemList || [];
    const maxId = layerActiveItems.length - 1;

    const audioFilePath = audioLayer.selectedLocalAudioLink;
    const transcriptText = audioLayer.prompt;

    const pwd = process.cwd();
    const audioFileBase = path.join(pwd, 'assets'); // Adjust according to your file structure
    const audioLocalFilePath = `${audioFileBase}/${audioFilePath}`;

    const aspectRatio = sessionData.aspectRatio || '16:9';
    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

    // Get layerDurationOffset and audioStartTime
    const layerDurationOffset = currentSessionLayer.durationOffset;
    const audioStartTime = audioLayer.startTime;
    const alignerLanguageCode = getAlignerLanguageCode(sessionData.sessionLanguage || 'en');

    // Pass layerDurationOffset to alignWithGentle
	    const newRawLayers = await alignWithGentle(
	      audioLocalFilePath,
	      transcriptText,
	      canvasDimensions,
	      audioStartTime,
	      layerDurationOffset,
	      audioLayerId,
	      alignerLanguageCode,
	      audioLayer.subtitleFont,
	      audioLayer.duration,
        framesPerSecond
	    );

    if (newRawLayers.length === 0) {
      continue;
    }

    const newActiveItems = newRawLayers.map((layer, idx) => {
      return {
        id: `item_${maxId + idx + 1}`,
        ...layer
      };
    });

    currentSessionLayer.imageSession.activeItemList = [...layerActiveItems, ...newActiveItems];
    currentSessionLayer.frameGenerationPending = true;
  }

  await sessionData.save();
}


// ... [Imports and other functions remain unchanged] ...

/**
 * Maps each word to its start and end character positions in the transcriptText using Gentle's timing.
 * @param {string} transcriptText - The original transcript text.
 * @param {Array} words - Array of word objects from Gentle alignment.
 * @returns {Object} - Mapping of word index to character positions.
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

async function alignWithGentle(
  audioFilePath,
  transcriptText,
  canvasDimensions,
  audioStartTime = 0,
  layerDurationOffset = 0,
  audioLayerId,
  alignerLanguageCode = null,
  subtitleFont = null,
  audioDurationSeconds = null,
  framesPerSecond
) {

  try {
    const { words: alignedWords, transcriptText: resolvedTranscript } = await transcribeWithOpenAI(
      audioFilePath,
      transcriptText,
      alignerLanguageCode,
      audioDurationSeconds,
    );

    const validWords = (alignedWords || []).filter(wordInfo => wordInfo.word.trim() !== '');

    if (validWords.length === 0) {
      return [];
    }

    // Map each word to its position in the transcriptText
    const transcriptForMapping = resolvedTranscript || transcriptText || '';
    const wordPositions = transcriptForMapping
      ? mapWordsToTranscriptPositions(transcriptForMapping, validWords)
      : {};



    // Determine number of layers based on number of words
    const numLayers = determineNumLayers(validWords.length);

    // Calculate total duration
    const totalStart = parseFloat(validWords[0].start) || 0;
    const totalEnd = parseFloat(validWords[validWords.length - 1].end) || 0.5; // Ensure at least 0.5s
    const totalDuration = totalEnd - totalStart;

    // Calculate duration per layer
    const durationPerLayer = totalDuration / numLayers;

    // Initialize layers
    const layers = [];
    let currentLayer = {
      words: [],
      startTime: totalStart,
      endTime: totalStart + durationPerLayer
    };


    validWords.forEach((wordInfo, index) => {
      const wordStart = parseFloat(wordInfo.start) || 0;
      const wordEnd = parseFloat(wordInfo.end) || (wordStart + 0.5);

      // If adding this word exceeds the current layer's endTime, start a new layer
      if (wordStart >= currentLayer.endTime && layers.length < numLayers - 1) {
        layers.push({ ...currentLayer });
        currentLayer = {
          words: [],
          startTime: currentLayer.endTime,
          endTime: currentLayer.endTime + durationPerLayer
        };
      }

      currentLayer.words.push({ ...wordInfo, index });
      // Update the endTime to accommodate the word's end
      currentLayer.endTime = Math.max(currentLayer.endTime, wordEnd);
    });

    // Push the last layer
    if (currentLayer.words.length > 0) {
      layers.push({ ...currentLayer });
    }

    // Adjust layers to not exceed numLayers
    while (layers.length > numLayers) {
      // Merge the last two layers
      const lastLayer = layers.pop();
      layers[layers.length - 1].words = layers[layers.length - 1].words.concat(lastLayer.words);
      layers[layers.length - 1].endTime = lastLayer.endTime;
    }

    // If fewer layers, create empty layers (unlikely but safe)
    while (layers.length < numLayers) {
      layers.push({
        words: [],
        startTime: totalStart + layers.length * durationPerLayer,
        endTime: totalStart + (layers.length + 1) * durationPerLayer
      });
    }

    // Create text layers with substrings from the original transcript
    const newTextLayers = layers.map((layer, index) => {
      // **Define layerStartTime and layerEndTime here**

      const layerStartTime = audioStartTime + layer.startTime + (layerDurationOffset !== null ? layerDurationOffset : 0);
      const layerEndTime = audioStartTime + layer.endTime + (layerDurationOffset !== null ? layerDurationOffset : 0);
    
      const frameOffsetData = calculateFrameOffset(
        layerStartTime,
        layerEndTime,
        layerDurationOffset,
        framesPerSecond
      );


      if (!frameOffsetData) {
        return null;
      }

      const { frameDuration, frameOffset } = frameOffsetData;
 

      if (layer.words.length === 0) {
        // Handle empty layers if necessary
        return null; // Or skip adding this layer
      }

      // Get the indices of the first and last words in the layer
      const firstWordIndex = layer.words[0].index;
      const lastWordIndex = layer.words[layer.words.length - 1].index;

      // Get the start and end character positions from the mapping
      const firstWordPos = wordPositions[firstWordIndex];
      const lastWordPos = wordPositions[lastWordIndex];
      // Extract the substring from the original transcript
      const segmentTextEnd = lastWordPos?.end;
      let substring = '';
      if (firstWordPos && segmentTextEnd !== undefined && segmentTextEnd !== null && transcriptForMapping) {
        substring = transcriptForMapping.substring(firstWordPos.start, segmentTextEnd).toUpperCase();
      }

      if (!substring) {
        substring = layer.words.map((w) => w.word).join(' ').toUpperCase();
      }

      const textHeight = 80;
      const fontSize = 40;

      const fontFamily = resolveSubtitleFont(alignerLanguageCode || 'en', subtitleFont);

      // Calculate the width of the text
      const textWidth = calculateTextWidth(substring, fontSize, fontFamily, canvasDimensions);

      // Randomize font color between two options
      let fontColor = '#FAFAFA'; // Light color
      let randomNumBetween1To10 = Math.floor(Math.random() * 10) + 1;
      if (randomNumBetween1To10 % 4 === 0) {
        const customFontOptions = ['#fef9c3', '#cffafe', '#f3e8ff', '#fce7f3', '#93c5fd', '#f0abfc'];
        fontColor = customFontOptions[Math.floor(Math.random() * customFontOptions.length)];
      }

      // rotationAngle is a random number between -5 and 5
      let rotationAngle = 0;
      // if (index === 0) {
      //   rotationAngle = 0;
      // } else {
      //   rotationAngle = Math.floor(Math.random() * 11) - 5;
      // }
      const textX = canvasDimensions.width / 2; // Center horizontally
      const textY = canvasDimensions.height / 2 + 340;// Center vertically

      // if substring has more than 22 letters including spaces, set autoWrap to true
      const autoWrap = substring.length > 24;

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
          rotationAngle: rotationAngle
        },
        animation: 'fade-in',
        subType: 'subtitle',
        textType: "subtitle",
        audioLayerId: audioLayerId

      };

      
      return textItem;
    }).filter(layer => layer !== null); // Remove null layers

    return newTextLayers;

  } catch (error) {
    console.error(error);

    if (error.response) {
      console.error('Gentle API Error:', error.response.status, error.response.data);
    } else if (error.request) {
      console.error('Gentle API No Response:', error.request);
    } else {
      console.error('Gentle API Setup Error:', error.message);
    }
    return [];
  }
}
