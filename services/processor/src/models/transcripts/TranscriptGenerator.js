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
import { resolveGeneratedSubtitleLayers } from './SubtitleRerunFallback.js';
import { resolveSubtitleAudioSource } from './SubtitleAudioSource.js';
import { resolveAudioLinkToLocalPath } from '../audio/AudioUtils.js';
import { resolvePaddedSpeechTimingWindow } from './SpeechAlignment.js';

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
  const speechTimingWindow = resolvePaddedSpeechTimingWindow(audioLayer);

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

  const resolvedAudioSource = await resolveSubtitleAudioSource({
    audioLayer,
    // AudioUtils is the canonical assets_v2-versus-legacy resolver. In
    // particular, it avoids turning assets_v2/foo into assets/assets_v2/foo.
    preferredLocalFilePath: resolveAudioLinkToLocalPath(
      audioLayer.selectedLocalAudioLink || audioLayer.localAudioLinks?.[0],
    ),
  });
  let alignmentResult;
  try {
    if (resolvedAudioSource.isTemporary) {
      console.warn('Recovered subtitle-alignment audio from durable media storage', {
        sessionId,
        audioLayerId,
        objectKey: resolvedAudioSource.objectKey,
      });
    }
    alignmentResult = await alignSpeechLayerWithGentle(
      resolvedAudioSource.filePath,
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
        // Keep the logical source stable so the new cache remains reusable
        // even when alignment temporarily materialized a remote object.
        audioSource,
        inferenceModel,
        speechTimingWindow,
      }
    );
  } finally {
    await resolvedAudioSource.cleanup();
  }

  if (alignmentResult?.alignment) {
    await VideoSession.updateOne(
      { _id: sessionId, 'audioLayers._id': audioLayerId },
      { $set: { 'audioLayers.$.transcriptAlignment': alignmentResult.alignment } }
    );
  }

  return Array.isArray(alignmentResult?.rawLayers) ? alignmentResult.rawLayers : [];
}



export async function generateTranscriptsForSessionAudioLayers(
  sessionId,
  audioLayers,
  { requireNonEmptySubtitles = false } = {},
) {
  if (
    requireNonEmptySubtitles &&
    (!Array.isArray(audioLayers) || audioLayers.length === 0)
  ) {
    throw new Error('Subtitle regeneration requires at least one speech audio layer.');
  }
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


    const audioSource =
      audioLayer.selectedLocalAudioLink ||
      audioLayer.localAudioLinks?.[0] ||
      audioLayer.selectedRemoteAudioLink ||
      audioLayer.remoteAudioLinks?.[0] ||
      audioLayer.remoteAudioData?.[0]?.audio_url ||
      null;
    const transcriptText = audioLayer.prompt;

    const aspectRatio = sessionData.aspectRatio;
    const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);


    const audioLayerStartFrame = secondsToFrame(audioLayer.startTime, framesPerSecond);


    const generatedRawLayers = await getSubtitleLayersForAudioLayer({
      sessionId,
      audioLayer,
      audioLayerId,
      audioSource,
      transcriptText,
      canvasDimensions,
      subtitleFont,
      subtitleWordAnimation,
      audioLayerStartFrame,
      alignerLanguageCode,
      framesPerSecond,
      inferenceModel,
    });

    const newRawLayers = resolveGeneratedSubtitleLayers(generatedRawLayers, {
      requireNonEmpty: requireNonEmptySubtitles,
      audioLayer,
      session: sessionData,
      canvasDimensions,
      framesPerSecond,
    });


    let speaker = 'Narrator';

    const subtitleSpeakerCharacterName =
      audioLayer.subtitleSpeakerCharacterName || audioLayer.speakerCharacterName;
    if (subtitleSpeakerCharacterName) {
      speaker = subtitleSpeakerCharacterName;
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
  
  
      const audioSource =
        audioLayer.selectedLocalAudioLink ||
        audioLayer.localAudioLinks?.[0] ||
        audioLayer.selectedRemoteAudioLink ||
        audioLayer.remoteAudioLinks?.[0] ||
        audioLayer.remoteAudioData?.[0]?.audio_url ||
        null;
      const transcriptText = audioLayer.prompt;
  
      const aspectRatio = sessionData.aspectRatio;
      const canvasDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);
  
  
      const audioLayerStartFrame = secondsToFrame(audioLayer.startTime, framesPerSecond);
  
  
      const generatedRawLayers = await getSubtitleLayersForAudioLayer({
        sessionId,
        audioLayer,
        audioLayerId,
        audioSource,
        transcriptText,
        canvasDimensions,
        subtitleFont,
        subtitleWordAnimation,
        audioLayerStartFrame,
        alignerLanguageCode,
        framesPerSecond,
        inferenceModel,
      });
      const newRawLayers = resolveGeneratedSubtitleLayers(generatedRawLayers, {
        audioLayer,
        session: sessionData,
        canvasDimensions,
        framesPerSecond,
      });
      let speaker = 'Narrator';
  
      const subtitleSpeakerCharacterName =
        audioLayer.subtitleSpeakerCharacterName || audioLayer.speakerCharacterName;
      if (subtitleSpeakerCharacterName) {
        speaker = subtitleSpeakerCharacterName;
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
