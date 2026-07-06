import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';
import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import User from '../../schema/User.js';
import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';
import { getSessionFramesPerSecond } from '../../utils/FpsUtils.js';
import { addSubtitlesForAudioLayer, addSubtitlesForSessionForAudio } from './TransscriptUtils.js';

import {
  alignSpeechLayerWithGentle,
  buildSubtitleLayersFromAlignment,
  getCachedTranscriptAlignment,
} from './Aligner.js';

function getAlignerLanguageCode(languageCode = '') {
  if (typeof languageCode !== 'string') {
    return null;
  }
  const base = languageCode.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  return base && base !== 'en' ? base : null;
}



function secondsToFrame(timeInSeconds, framesPerSecond) {
  return Math.floor(timeInSeconds * framesPerSecond);
}

async function getSubtitleLayersForAudioLayer({
  sessionId,
  audioLayer,
  audioLayerId,
  audioLocalFilePath,
  audioSource,
  transcriptText,
  canvasDimensions,
  subtitleFont,
  subtitleWordAnimation,
  audioLayerStartFrame,
  alignerLanguageCode,
  framesPerSecond,
}) {
  const cachedAlignment = getCachedTranscriptAlignment(
    audioLayer,
    transcriptText,
    alignerLanguageCode,
    audioSource
  );

  if (cachedAlignment) {
    try {
      return await buildSubtitleLayersFromAlignment(
        cachedAlignment.words,
        cachedAlignment.transcriptText || transcriptText,
        canvasDimensions,
        subtitleFont,
        subtitleWordAnimation,
        audioLayerStartFrame,
        audioLayerId,
        alignerLanguageCode,
        framesPerSecond
      );
    } catch (error) {
      console.error('Failed to build subtitles from cached transcript alignment', {
        sessionId,
        audioLayerId,
        error: error?.message || error,
      });
      return [];
    }
  }

  const alignmentResult = await alignSpeechLayerWithGentle(
    audioLocalFilePath,
    transcriptText,
    canvasDimensions,
    subtitleFont,
    subtitleWordAnimation,
    audioLayerStartFrame,
    audioLayerId,
    alignerLanguageCode,
    audioLayer.duration,
    framesPerSecond,
    {
      returnAlignment: true,
      sourceText: transcriptText,
      audioSource,
    }
  );

  if (alignmentResult?.alignment) {
    await VideoSession.updateOne(
      { _id: sessionId, 'audioLayers._id': audioLayerId },
      { $set: { 'audioLayers.$.transcriptAlignment': alignmentResult.alignment } }
    );
  }

  return Array.isArray(alignmentResult?.rawLayers) ? alignmentResult.rawLayers : [];
}

export async function removeTranscriptsForSessionAudioLayer(sessionId, audioLayerId) {
  // Ensure database connection
  await getDBConnectionString();

  // Load the video session data, populating image sessions for all layers
  const sessionData = await VideoSession.findById(sessionId).populate({
    path: 'layers.imageSession',
    model: 'Session'
  });
  const alignerLanguageCode = getAlignerLanguageCode(sessionData.sessionLanguage || 'en');

  if (!sessionData) {
    throw new Error('Session not found');
  }

  // Iterate over each layer in the session
  const sessionLayers = sessionData.layers;
  for (let i = 0; i < sessionLayers.length; i++) {
    let layer = sessionLayers[i];
    let layerActiveItems = layer.imageSession.activeItemList;

    if (!layerActiveItems || layerActiveItems.length === 0) {
      continue;
    }

    // Filter out subtitles that belong to this audioLayerId
    layerActiveItems = layerActiveItems.filter(item => {
      if (
        item.type === 'text' &&
        item.subType === 'subtitle' &&
        item.audioLayerId === audioLayerId
      ) {
        return false; // Remove this item
      }
      return true; // Keep this item
    });

    // Update the layer's activeItemList
    layer.imageSession.activeItemList = layerActiveItems;

    // Mark the layer for re-generation
    layer.frameGenerationPending = true;
  }


  // Save the session data after removing subtitles
  await sessionData.save();
}




export async function regenerateTranscriptsForSessionAudioLayer(sessionId, audioLayer) {


  // Ensure database connection
  await getDBConnectionString();

  // Load the video session data, populating image sessions for all layers
  const sessionData = await VideoSession.findById(sessionId).populate({
    path: 'layers.imageSession',
    model: 'Session'
  });
  const framesPerSecond = getSessionFramesPerSecond(
    sessionData,
    'AudioLayerTranscript.regenerateTranscriptsForSessionAudioLayer'
  );

  if (!sessionData) {
    throw new Error('Session not found');
  }

  const alignerLanguageCode = getAlignerLanguageCode(sessionData.sessionLanguage || 'en');
  const audioLayerId = audioLayer._id.toString();


  await removeTranscriptsForSessionAudioLayer(sessionId, audioLayerId);


  // Now generate the transcripts for the audioLayer
  const audioFilePath = audioLayer.selectedLocalAudioLink;
  const transcriptText = audioLayer.prompt;

  const pwd = process.cwd();
  const audioFileBase = path.join(pwd, 'assets'); // Adjust path to where your audio files are stored

  const audioLocalFilePath = path.join(audioFileBase, audioFilePath);

  const aspectRatio = sessionData.aspectRatio || '16:9';
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

  const startFrame = secondsToFrame(audioLayer.startTime, framesPerSecond);
  const subFont = audioLayer.subtitleFont || 'Montserrat';
  const subtitleWordAnimation = audioLayer.subtitleWordAnimation || 'highlight';
  // Generate new subtitle items
  let newRawLayers = await getSubtitleLayersForAudioLayer({
    sessionId,
    audioLayer,
    audioLayerId,
    audioLocalFilePath,
    audioSource: audioFilePath,
    transcriptText,
    canvasDimensions,
    subtitleFont: subFont,
    subtitleWordAnimation,
    audioLayerStartFrame: startFrame,
    alignerLanguageCode,
    framesPerSecond,
  });


  let speaker = 'Narrator';

  if (audioLayer.speakerCharacterName) {
    speaker = audioLayer.speakerCharacterName;
    newRawLayers.forEach(layer => {
      layer.speaker = speaker;
      layer.showSpeaker = true;
    });
  }



  // Add the new subtitles to the session
  await addSubtitlesForAudioLayer(sessionId, audioLayerId, newRawLayers);

  // Save the updated session data
  await sessionData.save();
}

export async function generateTranscriptsForSessionAudioLayer(sessionId, audioLayer) {

  await getDBConnectionString();
  let sessionData = await VideoSession.findById(sessionId);
  const framesPerSecond = getSessionFramesPerSecond(
    sessionData,
    'AudioLayerTranscript.generateTranscriptsForSessionAudioLayer'
  );
  const alignerLanguageCode = getAlignerLanguageCode(sessionData.sessionLanguage || 'en');
  const userId = sessionData.userId;
  const userData = await User.findById(userId);

  const sessionSpeakerFont = sessionData.expressGenerationSpeakerFont;
  const sessionTextFont = sessionData.expressGenerationTextFont;
  const expressGenerationSpeakerFont = sessionSpeakerFont || userData.expressGenerationSpeakerFont;
  const expressGenerationTextFont = sessionTextFont || userData.expressGenerationTextFont;



  const audioLayerId = audioLayer._id.toString();

  const audioFilePath = audioLayer.selectedLocalAudioLink;
  const transcriptText = audioLayer.prompt;

  const pwd = process.cwd();
  const audioFileBase = path.join(pwd, 'assets'); // Adjust according to your file structure
  const audioLocalFilePath = `${audioFileBase}/${audioFilePath}`;

  const aspectRatio = sessionData.aspectRatio || '16:9';
  const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

  const audioLayerStartFrame = secondsToFrame(audioLayer.startTime, framesPerSecond);


  const subtitleFont = audioLayer.subtitleFont || expressGenerationTextFont || 'Montserrat';



  const subtitleWordAnimation = audioLayer.subtitleWordAnimation || 'highlight';


  const newRawLayers = await getSubtitleLayersForAudioLayer({
    sessionId,
    audioLayer,
    audioLayerId,
    audioLocalFilePath,
    audioSource: audioFilePath,
    transcriptText,
    canvasDimensions,
    subtitleFont,
    subtitleWordAnimation,
    audioLayerStartFrame,
    alignerLanguageCode,
    framesPerSecond,
  });
  


  let speaker = 'Narrator';

  if (audioLayer.speakerCharacterName) {
    speaker = audioLayer.speakerCharacterName;
    newRawLayers.forEach(layer => {
      layer.speaker = speaker;
      layer.showSpeaker = true;
      layer.speakerFont = expressGenerationSpeakerFont;
    });
  }




  if (newRawLayers.length === 0) {
    return;
  }

  // Save the updated session data
  await sessionData.save();


  // Use addSubtitlesForSessionForAudio to distribute subtitles based on their timings
  await addSubtitlesForAudioLayer(sessionId, audioLayerId, newRawLayers);


}
