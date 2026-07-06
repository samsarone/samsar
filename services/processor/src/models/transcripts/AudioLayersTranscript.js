import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';
import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';
import { getSessionFramesPerSecond } from '../../utils/FpsUtils.js';
import { addSubtitlesForSessionForAudio } from './TransscriptUtils.js';
import { alignSpeechLayerWithGentle } from './Aligner.js';
function getAlignerLanguageCode(languageCode = '') {
  if (typeof languageCode !== 'string') {
    return null;
  }
  const base = languageCode.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  return base && base !== 'en' ? base : null;
}

// Function to calculate the width of text


function secondsToFrame(timeInSeconds, framesPerSecond) {
  return Math.floor(timeInSeconds * framesPerSecond);
}


/**
 * Determines the number of layers based on the number of items.
 * @param {number} numItems - Number of items (words).
 * @returns {number} - Number of layers.
 */

export async function generateTranscriptsForSessionAudioLayers(sessionId, audioLayers) {
  await getDBConnectionString();
  let sessionData = await VideoSession.findById(sessionId);
  const framesPerSecond = getSessionFramesPerSecond(
    sessionData,
    'AudioLayersTranscript.generateTranscriptsForSessionAudioLayers'
  );
  const alignerLanguageCode = getAlignerLanguageCode(sessionData.sessionLanguage || 'en');

  const userId = sessionData.userId;
  const userData = await User.findById(userId);

  const sessionSpeakerFont = sessionData.expressGenerationSpeakerFont;
  const sessionTextFont = sessionData.expressGenerationTextFont;
  const expressGenerationSpeakerFont = sessionSpeakerFont || userData.expressGenerationSpeakerFont;
  const expressGenerationTextFont = sessionTextFont || userData.expressGenerationTextFont;

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

    const audioFilePath = audioLayer.selectedLocalAudioLink;
    const transcriptText = audioLayer.prompt;

    const pwd = process.cwd();
    let audioFileBase = path.join(pwd, '../', 'samsar_processor', 'assets');
    if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
      audioFileBase = '/assets'; // Docker staging volume mount path
    }
    const audioLocalFilePath = `${audioFileBase}/${audioFilePath}`;

    const aspectRatio = sessionData.aspectRatio;
    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);



  const audioLayerStartFrame = secondsToFrame(audioLayer.startTime, framesPerSecond);

  const subtitleFont = audioLayer.subtitleFont || expressGenerationTextFont;

  const subtitleWordAnimation = audioLayer.subtitleWordAnimation || 'highlight';



    const newRawLayers = await alignSpeechLayerWithGentle(
      audioLocalFilePath,
      transcriptText,
      canvasDimensions,
      subtitleFont,
      subtitleWordAnimation,
      audioLayerStartFrame,
      audioLayerId,
      alignerLanguageCode,
      audioLayer.duration,
      framesPerSecond

    )


  if (showSpeaker) {
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
