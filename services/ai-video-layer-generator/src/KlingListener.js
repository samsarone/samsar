import { fal } from "@fal-ai/client";
import { readProviderVideoResult } from './utils/ProviderNetworkRecovery.js';
import { isKlingV4Model, validateKlingV4Duration } from './utils/KlingModel.js';
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export function buildKlingInputPayload(payload) {
  if (isKlingV4Model(payload.model)) {
    const input = {
      prompt: payload.prompt,
      duration: validateKlingV4Duration(payload.duration ?? 5),
      resolution: '720p',
    };
    if (payload.model === 'KLINGIMGTOVID4') {
      if (!payload.startImage) throw new Error('Kling 4 image-to-video requires a starting image.');
      input.start_image_url = payload.startImage;
      if (payload.endImage) input.end_image_url = payload.endImage;
    } else if (['16:9', '9:16', '1:1', '21:9'].includes(payload.aspectRatio)) {
      input.aspect_ratio = payload.aspectRatio;
    }
    return input;
  }

  const { startImage , generationId, prompt, aspectRatio, model, duration = 5} = payload;

  let actualDuration = duration;
  const isKlingV3TextToVideo = model === 'KLINGTXTTOVID3PRO' || model === 'KLINGTXTTOVIDTURBO';
  const isKlingV3ImageToVideo = model === 'KLINGIMGTOVID3PRO' || model === 'KLINGIMGTOVIDTURBO';
  const generateAudio = payload.generateAudio === true || payload.generate_audio === true;

  let inputPayload = {
    prompt: prompt,
    duration: actualDuration,
  };
  if (isKlingV3TextToVideo || isKlingV3ImageToVideo) {
    inputPayload['generate_audio'] = generateAudio;
  }
  if (isKlingV3TextToVideo) {
    if (['16:9', '9:16', '1:1'].includes(aspectRatio)) {
      inputPayload['aspect_ratio'] = aspectRatio;
    }
  } else {
    inputPayload['image_url'] = startImage;
    if (aspectRatio === '9:16') {
      inputPayload['ratio'] = '9:16';
    }
    if (aspectRatio === '16:9') {
      inputPayload['ratio'] = '16:9';
    }
  }

  return inputPayload;
}

export async function generateKlingVideoLayer(payload, dependencies = {}) {
  const client = dependencies.fal || fal;
  const { request_id } = await client.queue.submit(getKlingVideoEndpoint(payload.model), {
    input: buildKlingInputPayload(payload),
  });


  return request_id;
}


export async function listenToPendingKlingVideoRequest(payload, dependencies = {}) {
  const client = dependencies.fal || fal;

  const { generationId, model } = payload;


  const KLING_VIDEO_LINK = getKlingVideoEndpoint(model);


  const responseStatusData = await client.queue.status(KLING_VIDEO_LINK, {
    requestId: generationId,
    logs: true,
  });


  const responseStatus = responseStatusData.status;


  if (responseStatus === 'COMPLETED') {

    const result = await readProviderVideoResult(() => client.queue.result(KLING_VIDEO_LINK, {
      requestId: generationId
    }));

    const videoURL = result.data.video.url;
    return {
      responseStatus: 'COMPLETED',
      remoteUrl: videoURL
    };
  } else if (responseStatus === 'FAILED'){
    
    return {
      responseStatus: 'FAILED'
    };
  } else {
    return {
      responseStatus: 'PENDING'
    }
  }

}

export function getKlingVideoEndpoint(model) {
  if (model === 'KLINGIMGTOVID4') return 'kling/v4/image-to-video';
  if (model === 'KLINGTXTTOVID4') return 'kling/v4/text-to-video';


  if (model === 'KLINGTXTTOVIDSTANDARD') {
    return 'fal-ai/kling-video/v1.6/standard/text-to-video';
  } else if (model === 'KLINGTXTTOVIDPRO') {
    return 'fal-ai/kling-video/v1.6/pro/text-to-video';
  } else if (model === 'KLINGIMGTOVIDSTANDARD') {
    return 'fal-ai/kling-video/v1.6/standard/image-to-video';
  } else if (model === 'KLINGIMGTOVIDPRO') {
    return 'fal-ai/kling-video/v1.6/standard/image-to-video';
  }  else if (model === 'KLINGIMGTOVIDPROMASTER') {
    return 'fal-ai/kling-video/v2/master/image-to-video';
  } else if (model === 'KLINGIMGTOVID2.1PRO') {
    return 'fal-ai/kling-video/v2.1/pro/image-to-video';
  } else if (model === 'KLINGIMGTOVID2.1MASTER') {
    return 'fal-ai/kling-video/v2.1/master/image-to-video';
  } else if (model === 'KLINGIMGTOVID2.1STANDARD') {
    return 'fal-ai/kling-video/v2.1/standard/image-to-video';
  } else if (model === 'KLINGTXTTOVIDTURBO' || model === 'KLINGTXTTOVID3PRO') {
    return 'fal-ai/kling-video/v3/pro/text-to-video';
  } else if (model === 'KLINGIMGTOVIDTURBO' || model === 'KLINGIMGTOVID3PRO') {
    return 'fal-ai/kling-video/v3/pro/image-to-video';
  } else {
    return null;
  }
}
