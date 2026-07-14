import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';
import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../../schema/VideoSession.js';
import User from '../../schema/User.js';

import { getCanvasDimensionsForAspectRatio } from '../../utils/CanvasUtils.js';
import { getSessionFramesPerSecond } from '../../utils/FpsUtils.js';
import { addSubtitlesForSessionForAudio } from './TransscriptUtils.js';
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

// Function to calculate the width of text
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
  inferenceModel,
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
        framesPerSecond,
        inferenceModel,
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
      inferenceModel,
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



export async function generateTranscriptsForSessionAudioLayers(sessionId, audioLayers) {
  await getDBConnectionString();
  let sessionData = await VideoSession.findById(sessionId);
  const framesPerSecond = getSessionFramesPerSecond(
    sessionData,
    'TranscriptGenerator.generateTranscriptsForSessionAudioLayers'
  );
  const alignerLanguageCode = getAlignerLanguageCode(sessionData.sessionLanguage || 'en');

  const userId = sessionData.userId;
  const userData = await User.findById(userId);
  const inferenceModel =
    sessionData.expressGenerationInferenceModel ||
    sessionData.inferenceModel ||
    userData?.selectedInferenceModel;

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

    const subtitleFont = audioLayer.subtitleFont || expressGenerationTextFont;
    const subtitleWordAnimation = audioLayer.subtitleWordAnimation || 'highlight';


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
      inferenceModel,
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

    await addSubtitlesForSessionForAudio(sessionId, audioLayerId, newRawLayers);
  }

  // After processing all audio layers, save changes to the session again if needed
  await sessionData.save();
}


export async function generateTranscriptsForSessionAudioLayersAfterLayer(sessionId, connectedLayerIndex) {

  await getDBConnectionString();
  let sessionData = await VideoSession.findOne({ _id: sessionId });
  const framesPerSecond = getSessionFramesPerSecond(
    sessionData,
    'TranscriptGenerator.generateTranscriptsForSessionAudioLayersAfterLayer'
  );
  const alignerLanguageCode = getAlignerLanguageCode(sessionData.sessionLanguage || 'en');


  const userId = sessionData.userId;
  const userData = await User.findById(userId);
  const inferenceModel =
    sessionData.expressGenerationInferenceModel ||
    sessionData.inferenceModel ||
    userData?.selectedInferenceModel;

  const sessionSpeakerFont = sessionData.expressGenerationSpeakerFont;
  const sessionTextFont = sessionData.expressGenerationTextFont;
  const expressGenerationSpeakerFont = sessionSpeakerFont || userData.expressGenerationSpeakerFont;
  const expressGenerationTextFont = sessionTextFont || userData.expressGenerationTextFont;

  let sessionLayers = sessionData.layers;

  // Remove all existing subtitle text items from each layer before generating new transcripts
  for (let i = connectedLayerIndex + 1; i < sessionLayers.length; i++) {
    const layer = sessionLayers[i];


    if (layer.imageSession && layer.imageSession.activeItemList && layer.imageSession.activeItemList.length > 0) {
      layer.imageSession.activeItemList = layer.imageSession.activeItemList.filter(item => !(item.type === 'text' && item.subType === 'subtitle'));
    }

    const connectedLayerId = layer._id.toString();
    const connectedAudioLayer = sessionData.audioLayers.find(audioLayer => audioLayer.connectedLayerId === connectedLayerId && 
      audioLayer.generationType === 'speech'
    );

    if (connectedAudioLayer) {
      const audioLayer = connectedAudioLayer;
      const audioLayerId = audioLayer._id.toString();
  
      const subtitleFont = audioLayer.subtitleFont || expressGenerationTextFont;
      const subtitleWordAnimation = audioLayer.subtitleWordAnimation || 'highlight';
  
  
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
        inferenceModel,
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

  
      await addSubtitlesForSessionForAudio(sessionId, audioLayerId, newRawLayers);




    }
  }


}
