import { generateSdAudioLayer, listenToPendingSDAudioRequest } from './SDAudio.js';
import { generateCustomSoundEffectLayer, listenToPendingCustomSoundEffectRequest } from './CustomSoundEffect.js';
import AudioGeneration from '../schema/AudioGeneration.js';
import { getDBConnectionString } from '../DBString.js';
import VideoSession from '../schema/VideoSession.js';
import { markAudioGenerationAsFailed } from '../music/audioUtils.js';
import fs from 'fs';
import path from 'path';
import { getProcessorAssetsV2Path, toAssetsV2RelativePath } from '../utils/AssetPaths.js';
import { uploadAudioAssetToCDN } from '../AWS.js';
import { recordProviderUsageLog } from '../utils/ProviderUsageAudit.js';
import {
  finalizeStandaloneExternalAudioGeneration,
  isStandaloneExternalAudioRequest,
} from '../external/StandaloneExternalAudio.js';
import {
  DOCKER_AUDIO_PROVIDER,
  hasDockerSoundEffectProviderPriority,
  isInitialDockerAudioRoutingRequest,
  resolveDockerSoundEffectProvider,
} from '../consts/DockerProviderPriority.js';
import {
  processSamsarExternalSoundEffectRequest,
} from '../external/SamsarExternalAudioAdapter.js';

async function fetchBuffer(url) {
  const fetchImpl = typeof globalThis.fetch === 'function'
    ? globalThis.fetch.bind(globalThis)
    : (await import('node-fetch')).default;

  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio from ${url}: ${response.status} ${response.statusText}`);
  }

  if (typeof response.arrayBuffer === 'function') {
    return Buffer.from(await response.arrayBuffer());
  }

  return await response.buffer();
}

export async function processMusicEffectRequest(payload) {
  // This function processes music effect requests


  await getDBConnectionString();

  const { model, status } = payload;
  const provider = resolveDockerSoundEffectProvider(model, payload);
  const submittedAdapter = provider || (
    model === 'CUSTOM_TEXT_TO_SOUND_EFFECT' ? DOCKER_AUDIO_PROVIDER.CUSTOM : ''
  );

  if (status === 'INIT' && submittedAdapter && payload?._id) {
    payload.submittedAdapter = submittedAdapter;
    await AudioGeneration.findByIdAndUpdate(payload._id, { submittedAdapter });
  }

  if (
    !provider &&
    model !== 'CUSTOM_TEXT_TO_SOUND_EFFECT' &&
    isInitialDockerAudioRoutingRequest(payload) &&
    hasDockerSoundEffectProviderPriority(model)
  ) {
    throw new Error(`No configured Docker sound-effect provider for ${model}.`);
  }

  if (provider === DOCKER_AUDIO_PROVIDER.SAMSAR && model !== 'CUSTOM_TEXT_TO_SOUND_EFFECT') {
    await processSamsarExternalSoundEffectRequest(payload);
    return;
  }



  if (status === 'INIT') {
    await requestSoundEffect(payload);
  } else if (status === 'PENDING') {
    await listenToPendingSoundEffectRequest(payload);
  }

}

async function requestSoundEffect(payload) {
  // This function requests sound effect

  const { model } = payload;


  let requestId;
  if (model === 'SDAUDIO') {

    
    requestId = await generateSdAudioLayer(payload);

    if (requestId) {
      await recordProviderUsageLog({
        payload,
        requestType: 'text_to_sound_effect',
        callType: 'text_to_sound_effect',
        provider: 'fal',
        model,
        providerRequestId: requestId,
        source: 'sound_effect_generator',
        service: 'samsar_audio_generator',
        status: 'requested',
        metadata: {
          duration: payload?.duration || payload?.secondsTotal,
        },
      });
    }



  } else if (model === 'CUSTOM_TEXT_TO_SOUND_EFFECT') {
    requestId = await generateCustomSoundEffectLayer(payload);
  }

  if (requestId) {

    
    await AudioGeneration.findOneAndUpdate({
      _id: payload._id
    }, {
      status: 'PENDING',
      generationId: requestId,
      ...(model === 'CUSTOM_TEXT_TO_SOUND_EFFECT' ? { apiRequestId: requestId } : {}),
      rowLocked: false,
    });

  } else {

  }

}

async function listenToPendingSoundEffectRequest(payload) {
  // This function listens to pending sound effect requests



  const { model } = payload;

  let responseData;
  if (model === 'SDAUDIO') {    
    responseData = await listenToPendingSDAudioRequest(payload);
  } else if (model === 'CUSTOM_TEXT_TO_SOUND_EFFECT') {
    responseData = await listenToPendingCustomSoundEffectRequest(payload);
  }

  if (responseData && responseData.remoteUrl) {
    // process the file


    await markSoundEffectGenerationAsCompleted(payload, responseData);
  } else if (responseData?.responseStatus === 'FAILED' && model === 'CUSTOM_TEXT_TO_SOUND_EFFECT') {
    await markAudioGenerationAsFailed(
      payload._id,
      responseData.error || 'Custom sound effect generation failed.'
    );
    await AudioGeneration.findByIdAndDelete(payload._id);
  } else {
    await AudioGeneration.findOneAndUpdate({
      _id: payload._id
    }, {
      rowLocked: false,
    });
  }

}


async function markSoundEffectGenerationAsCompleted(payload, responseData) {
  await getDBConnectionString();

  // save the remote file to local
  const { remoteUrl } = responseData;


  const { sessionId, audioLayerId } = payload;




  const audioFileBase = path.join('video', 'audio', sessionId, audioLayerId, 'sound.mp3');
  const audioAssetPath = toAssetsV2RelativePath(audioFileBase);
  const audioSaveFilePath = getProcessorAssetsV2Path(audioFileBase);

  const audioFileFolder = path.dirname(audioSaveFilePath);
  if (!fs.existsSync(audioFileFolder)) {
    fs.mkdirSync(audioFileFolder, { recursive: true });
  }

  const buffer = await fetchBuffer(remoteUrl);
  await fs.promises.writeFile(audioSaveFilePath, buffer);

  if (isStandaloneExternalAudioRequest(payload)) {
    const standaloneRemoteFilePath = await uploadAudioAssetToCDN(audioSaveFilePath, audioAssetPath);
    if (await finalizeStandaloneExternalAudioGeneration({
      payload,
      resultUrl: standaloneRemoteFilePath,
      resultUrls: [standaloneRemoteFilePath],
      localAudioPath: audioAssetPath,
      remoteAudioData: [{ audio_url: standaloneRemoteFilePath, title: 'Sound Effect' }],
      title: 'Sound Effect',
    })) {
      return;
    }
  }


  await VideoSession.findOneAndUpdate({
    _id: sessionId,
    "audioLayers._id": audioLayerId
  }, {
    $set: {
      "audioLayers.$.localAudioLinks": [audioAssetPath],
      "audioLayers.$.generationStatus": 'COMPLETED',
      "audioLayers.$.streamDownloadPending": false,
    }
  });

  await AudioGeneration.findByIdAndDelete(payload._id);




  // update audioLayer in video session
}
