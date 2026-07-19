import { fal } from "@fal-ai/client";

import { getDBConnectionString } from "../DBString.js";
import ImageGeneration from "../schema/ImageGeneration.js";


import { saveRemoteFile } from "../utils/FileUtils.js";
import { getAccessibleMediaUrlForProvider } from "../utils/MediaReferenceUtils.js";


const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function handleBriaEditRequest(payload) {
  const { apiGenerationStatus, apiRequestId, model } = payload;
  if (apiGenerationStatus === 'INIT') {
    await submitBriaRequest(payload);
  } else if (apiGenerationStatus === 'PENDING') {
    const imageData = await pollBriaRequest(payload);

    return imageData;
  } else if (apiGenerationStatus === 'FAILED') {


    await markLayerImageGenerationAsFailed(payload);


  }

}

export async function submitBriaRequest(payload) {


  const { _id, model, prompt, aspectRatio } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });


  const falLink = getFalLinkForModel(model);


  let reqPayload = await getRequestPayloadForModel(payload);


  let response = await fal.queue.submit(falLink, {
    input: reqPayload,
  });


  const requestId = response.request_id;


  await ImageGeneration.findOneAndUpdate({
    _id: _id
  }, {
    apiRequestId: requestId,
    apiGenerationStatus: "PENDING",
    rowLocked: false
  });
}


export async function pollBriaRequest(payload) {

  const { _id, apiRequestId, model } = payload;
  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate({
    _id: _id
  }, {
    rowLocked: true
  });



  const falLink = getFalLinkForModel(model);


  let responseStatusData;
  try {

    responseStatusData = await fal.queue.status(falLink, {
      requestId: apiRequestId,
      logs: true,
    });

  } catch (error) {
    console.error("Error getting result from FAL: ", error);
    await ImageGeneration.findOneAndUpdate({
      _id: _id
    }, {
      generationStatus: "FAILED",
      apiGenerationStatus: "FAILED",
      rowLocked: false
    });
    return null;
  }

  const responseStatus = responseStatusData.status;


  if (responseStatus === 'COMPLETED') {

    const result = await fal.queue.result(falLink, {
      requestId: apiRequestId
    });

    await ImageGeneration.findOneAndUpdate({
      _id: _id
    }, {
      rowLocked: true
    });

    let imageRemoteUrl;


    if (model === 'BRIA_ERASER' || model === 'BRIA_BACKGROUNDREMOVE') {
      const fileImage = result.data.image;
      imageRemoteUrl = fileImage.url;
    } else if (model === 'BRIA_GENFILL') {
      const fileImages = result.data.images;
      imageRemoteUrl = fileImages[0].url;
    }


    const imageName = await saveRemoteFile(imageRemoteUrl);

    return {
      image: imageName
    }
  } else {
    await ImageGeneration.findOneAndUpdate({
      _id: _id
    }, {
      rowLocked: false
    });

    return null;
  }
}


function getFalLinkForModel(model) {
  if (model === 'BRIA_ERASER') {
    return 'fal-ai/bria/eraser'
  } else if (model === 'BRIA_GENFILL') {
    return 'fal-ai/bria/genfill'
  } else if (model === 'BRIA_BACKGROUNDREMOVE') {
    return 'fal-ai/bria/background/remove'
  }

}


async function getRequestPayloadForModel(inputPayload) {


  const {
    image,
    maskImage,
    prompt,
    model
  } = inputPayload;

  const imageUrl = await getAccessibleMediaUrlForProvider(image, { mediaKind: 'image' });
  const maskUrl = maskImage
    ? await getAccessibleMediaUrlForProvider(maskImage, { mediaKind: 'image' })
    : null;

  let payload;
  if (model === 'BRIA_ERASER') {
    payload = {
      "image_url": imageUrl,
      "mask_type": "manual"
    };
    if (maskUrl) {
      payload["mask_url"] = maskUrl;
    }

  } else if (model === 'BRIA_GENFILL') {
    payload = {
      "image_url": imageUrl,
      "prompt": prompt
    };
    if (maskUrl) {
      payload["mask_url"] = maskUrl;
    }
  } else if (model === 'BRIA_BACKGROUNDREMOVE') {
    payload = {
      "image_url": imageUrl
    };
  }


  return payload;


}
