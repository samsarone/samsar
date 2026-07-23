import fs from 'fs';
import path from 'path';
import { usesLocalAssetStorage } from './Environment.js';
import axios from 'axios';
import { createCanvas } from 'canvas';
import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import User from '../schema/User.js';

import { getCanvasDimensionsForAspectRatio } from './CanvasUtils.js';
import { addSubtitlesForSessionForAudio } from './TranscriptUtils.js';
import { getAccentForText } from './OpenAI.js';
import { resolveFramesPerSecond } from './FpsUtils.js';

const AUDIO_UTIL_SERVER = process.env.ALIGNER_SERVER || 'http://localhost:5000';

const { default: FormData } = await import('form-data');

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

function calculateFrameOffset(startTime, endTime, framesPerSecond) {
  const frameOffset = secondsToFrame(startTime, framesPerSecond);
  const effectiveFrameOffset = frameOffset + 1;
  const endFrame = Math.floor(endTime * framesPerSecond);
  const frameDuration = endFrame - effectiveFrameOffset;
  return { frameDuration, frameOffset: frameOffset };
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

export async function generateTranscriptsForSessionAudioLayers(sessionId, audioLayers) {
  await getDBConnectionString();
  let sessionData = await VideoSession.findById(sessionId);

  const userId = sessionData.userId;
  const userData = await User.findById(userId);
  const framesPerSecond = resolveFramesPerSecond(sessionData, userData);

  const expressGenerationSpeakerFont = userData.expressGenerationSpeakerFont;
  const expressGenerationTextFont = userData.expressGenerationTextFont;

  let sessionLayers = sessionData.layers;

  // Remove all existing subtitle text items from each layer before generating new transcripts
  for (let i = 0; i < sessionLayers.length; i++) {
    const layer = sessionLayers[i];
    if (layer.imageSession && layer.imageSession.activeItemList && layer.imageSession.activeItemList.length > 0) {
      layer.imageSession.activeItemList = layer.imageSession.activeItemList.filter(item => !(item.type === 'text' && item.subType === 'subtitle'));
    }
  }

  // Save the session after removing old subtitles
  await sessionData.save();

  for (let i = 0; i < audioLayers.length; i++) {
    const audioLayer = audioLayers[i];
    const audioLayerId = audioLayer._id.toString();

    const subtitleFont = expressGenerationTextFont;
    const subtitleWordAnimation = audioLayer.subtitleWordAnimation || 'highlight';


    const audioFilePath = audioLayer.selectedLocalAudioLink;
    const transcriptText = audioLayer.prompt;

    const pwd = process.cwd();
    let audioFileBase = path.join(pwd, '../', 'samsar_processor', 'assets_v2');
    if (usesLocalAssetStorage()) {
      audioFileBase = process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
    }
    const audioLocalFilePath = `${audioFileBase}/${audioFilePath}`;

    const aspectRatio = sessionData.aspectRatio;
    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);


    const audioLayerStartFrame = secondsToFrame(audioLayer.startTime, framesPerSecond);


    const newRawLayers = await alignSpeechLayerWithGentle(
      audioLocalFilePath,
      transcriptText,
      canvasDimensions,
      subtitleFont,
      subtitleWordAnimation,
      audioLayerStartFrame,
      audioLayerId,
      framesPerSecond,

  
    )


    let speaker = 'Narrator';

    if (audioLayer.speakerCharacterName) {
      speaker = audioLayer.speakerCharacterName;
      newRawLayers.forEach(layer => {
        layer.speaker = speaker;
        layer.showSpeaker = true;
        layer.speakerFont = expressGenerationSpeakerFont;
      });
    }

    await addSubtitlesForSessionForAudio(sessionId, audioLayerId, newRawLayers);
  }

  // After processing all audio layers, save changes to the session again if needed
  await sessionData.save();
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
    } else {
      // If the word is not found, skip mapping and log a warning
    }
  });


  return wordPositions;
}

// ... (no changes in imports and initial code)

async function alignWithGentle(audioFilePath, transcriptText, canvasDimensions, subtitleFont, subtitleWordAnimation,
  audioLayerStartFrame, audioLayerId
) {


  if (!audioFilePath || !fs.existsSync(audioFilePath)) {
    console.error("Audio file not found at path:", audioFilePath);
    return [];
  }

  const audioData = fs.createReadStream(audioFilePath);

  const formData = new FormData();
  formData.append('audio', audioData, {
    filename: 'audio.mp3', // Update filename to match actual format
    contentType: 'audio/mpeg', // Correct MIME type for MP3
  });
  formData.append('transcript', transcriptText);



  try {
    const response = await axios.post(
      `${AUDIO_UTIL_SERVER}/align_speech`,
      formData,
      {
        headers: formData.getHeaders(),
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );

    const alignmentResult = response.data;

    if (!alignmentResult.words) {
      return [];
    }

    const words = alignmentResult.words;
    const validWords = words.filter(wordInfo => wordInfo.word.trim() !== '');

    if (validWords.length === 0) {
      return [];
    }

    const wordPositions = mapWordsToTranscriptPositions(transcriptText, validWords);
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
        framesPerSecond
      );

      if (layer.words.length === 0) {
        return null;
      }

      const firstWordIndex = layer.words[0].index;
      const lastWordIndex = layer.words[layer.words.length - 1].index;

      const firstWordPos = wordPositions[firstWordIndex];
      const lastWordPos = wordPositions[lastWordIndex];

      if (!firstWordPos || !lastWordPos) {
        return null;
      }

      const substring = transcriptText.substring(firstWordPos.start, lastWordPos.end).toUpperCase();

      const textHeight = 100;
      let fontSize = 56;
      if (canvasDimensions.width < 1024) {
        fontSize = 54;
      }


      const fontFamily = subtitleFont ? subtitleFont : 'Montserrat';



      // Calculate the width of the text
      const textWidth = calculateTextWidth(substring, fontSize, fontFamily, canvasDimensions);

      let rotationAngle = 0;
      const textX = canvasDimensions.width / 2;
      let textY = canvasDimensions.height / 2 + 340;

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

        const wordFrameOffset = secondsToFrame(wordStartTime, framesPerSecond) + audioLayerStartFrame;
        const wordFrameDuration = secondsToFrame(wordDuration, framesPerSecond);
        return {
          word: w.word.trim().toUpperCase(),
          frameOffset: wordFrameOffset,
          frameDuration: wordFrameDuration
        };
      });


      let textAccent;

      if (subtitleWordAnimation === 'system_preset') {
        textAccent = await getAccentForText(substring);
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
          fontFamily: subtitleFont,
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

// ... (no changes in the rendering code)

