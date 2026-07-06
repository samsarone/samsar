import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import AudioGeneration from './schema/AudioGeneration.js';
import VideoSession from './schema/VideoSession.js';
import { upsertGeneratedMusicArtifact } from './music/audioUtils.js';
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from './utils/AssetPaths.js';

ffmpeg.setFfmpegPath(ffmpegPath);

import { promisify } from 'util';
import { getDBConnectionString } from './DBString.js';

const mkdir = promisify(fs.mkdir);

export async function attemptDownloadStream(audioRemoteLinks, sessionId, audioLayerId, videoSessionData, payload) {

  
  await getDBConnectionString();
  const imageGenerationFolder = getProcessorAssetsV2Path('video', 'audio', sessionId, audioLayerId);
  const imageGenerationBase = path.join('video', 'audio', sessionId);

  if (!fs.existsSync(imageGenerationFolder)) {
    await mkdir(imageGenerationFolder, { recursive: true });
  }

  let audioLayerData = videoSessionData.audioLayers.find(layer => layer._id.toString() === payload.audioLayerId);

  if (!audioLayerData) {
    return;
  }

  const downloadPromises = audioRemoteLinks.map(audioRemoteLink => {
    const audioLinkName = audioRemoteLink.split('?item_id=').pop();
    const imageGenerationPath = path.join(imageGenerationFolder, `${audioLinkName}.mp3`);
    const localGenerationBasePath = toAssetsV2RelativePath(imageGenerationBase, audioLayerId, `${audioLinkName}.mp3`);
    return processRemoteAudio(sessionId, audioLayerId, audioRemoteLink, imageGenerationPath).then(() => localGenerationBasePath);
  });

  const localAudioPaths = await Promise.all(downloadPromises);

  try {
    if (localAudioPaths && localAudioPaths.length > 0) {
      videoSessionData = await VideoSession.findOne({ '_id': sessionId });
      audioLayerData = videoSessionData.audioLayers.find(layer => layer._id.toString() === payload.audioLayerId);

      audioLayerData.localAudioLinks = localAudioPaths;
      videoSessionData.audioGenerationPending = false;
      audioLayerData.streamDownloadPending = false;

      if (audioLayerData.defaultSelected) {
        audioLayerData.selectedLocalAudioLink = audioLayerData.localAudioLinks[0];
        audioLayerData.selectedRemoteAudioLink = audioLayerData.remoteAudioLinks[0];
        audioLayerData.generationStatus = 'COMPLETED';
      } else if (audioLayerData.isEnabled) {
        const remoteSelectedPath = audioLayerData.selectedRemoteAudioLink;
        const remoteSelectedItemName = remoteSelectedPath.split('?item_id=').pop();
        const remoteSelectedFileName = `${remoteSelectedItemName}.mp3`;

        const localCorrespondingPath = localAudioPaths.find(localPath => localPath.includes(remoteSelectedFileName));
        audioLayerData.selectedLocalAudioLink = localCorrespondingPath;
        audioLayerData.generationStatus = 'COMPLETED';
      }


      await VideoSession.findOneAndUpdate(
        { _id: videoSessionData._id, 'audioLayers._id': audioLayerId },
        {
          $set: {

            'audioLayers.$.localAudioLinks': audioLayerData.localAudioLinks,
            'audioLayers.$.streamDownloadPending': audioLayerData.streamDownloadPending,
            'audioLayers.$.selectedLocalAudioLink': audioLayerData.selectedLocalAudioLink,
            'audioLayers.$.selectedRemoteAudioLink': audioLayerData.selectedRemoteAudioLink,
            'audioLayers.$.generationStatus': audioLayerData.generationStatus,
            audioGenerationPending: false,
          }
        },
        { new: true }
      );

      const audioGenRecord = await AudioGeneration.findOne({ _id: payload._id });
      await upsertGeneratedMusicArtifact({
        sessionData: videoSessionData,
        currentAudioLayer: audioLayerData,
        audioGeneration: audioGenRecord,
        localAudioPath: audioLayerData.selectedLocalAudioLink || localAudioPaths[0],
      });

      if (audioGenRecord) {
        await AudioGeneration.deleteOne({ _id: payload._id });
      }
    }
  } catch (error) {

    const audioGenRecord = await AudioGeneration.findOne({ _id: payload._id });
    if (audioGenRecord) {
      await AudioGeneration.deleteOne({ _id: payload._id });
    }
  }
}

async function processRemoteAudio(sessionId, audioLayerId, url, outputFilePath) {
  try {
    await saveRemoteAudio(sessionId, audioLayerId, url, outputFilePath);
  } catch (error) {
    console.error('Error processing stream:', error);
  }
}

async function saveRemoteAudio(sessionId, audioLayerId, url, outputFilePath) {
  if (!fs.existsSync(path.dirname(outputFilePath))) {
    fs.mkdirSync(path.dirname(outputFilePath), { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outputFilePath);
    const startTime = Date.now();
    let recording = true;

    axios({
      url,
      method: 'GET',
      responseType: 'stream',
    }).then(response => {

      response.data.pipe(writer);

      const checkDurationInterval = setInterval(async () => {
        const elapsedTime = (Date.now() - startTime) / 1000;
        const audioLayerDuration = await getDurationForAudioLayer(sessionId, audioLayerId);
        if (elapsedTime >= audioLayerDuration && recording) { // Stop after audio duration
          response.data.unpipe(writer);
          writer.end();
          clearInterval(checkDurationInterval);
          recording = false;
        }
      }, 1000); // Check every second

      writer.on('finish', () => {
        resolve();
      });

      writer.on('error', (err) => {
        clearInterval(checkDurationInterval);
        reject(err);
      });

      response.data.on('error', (err) => {
        clearInterval(checkDurationInterval);
        reject(err);
      });
    }).catch(err => {
      reject(err);
    });
  });
}

async function getDurationForAudioLayer(sessionId, audioLayerId) {
  const videoSessionData = await VideoSession.findOne({ _id: sessionId });
  if (!videoSessionData) {
    return 0;
  }

  const audioLayerData = videoSessionData.audioLayers.find(layer => layer._id.toString() === audioLayerId);
  if (!audioLayerData) {
    return 0;
  }

  const audioDuration = audioLayerData.duration;
  return audioDuration;
}
