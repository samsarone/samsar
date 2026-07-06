import { fal } from "@fal-ai/client";
const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function generateKlingVideoLayer(payload) {

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

const KLING_VIDEO_LINK = getKlingVideLinkForModel(model);

  const { request_id } = await fal.queue.submit(KLING_VIDEO_LINK, {
    input: inputPayload,
  });


  return request_id;
}


export async function listenToPendingKlingVideoRequest(payload) {

  const { generationId, model } = payload;


  const KLING_VIDEO_LINK = getKlingVideLinkForModel(model);


  const responseStatusData = await fal.queue.status(KLING_VIDEO_LINK, {
    requestId: generationId,
    logs: true,
  });


  const responseStatus = responseStatusData.status;


  if (responseStatus === 'COMPLETED') {

    const result = await fal.queue.result(KLING_VIDEO_LINK, {
      requestId: generationId
    });

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

function getKlingVideLinkForModel(model) {


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
