import { fal } from "@fal-ai/client";

import { getDBConnectionString } from "./DBString.js";
import ImageGeneration from "./schema/ImageGeneration.js";
import axios from 'axios';
import { markVideoSessionLayerAsFailed } from './VideoSession.js';
import { saveRemoteFile } from "./utils/FileUtils.js";
import {
  isTerminalProviderFailureStatus,
  markImageProviderRequestFailed,
} from './utils/ImageProviderStatus.js';

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function handleSanaRequest(payload) {
  const { apiGenerationStatus, apiRequestId, model } = payload;
  if (apiGenerationStatus === 'INIT') {
    await submitSanaRequest(payload);
  } else if (apiGenerationStatus === 'PENDING') {
    const imageData = await pollSanaRequest(payload);

    return imageData;
  } else if (apiGenerationStatus === 'FAILED') {


    return {
      image: null,
    };


  }

}

export async function submitSanaRequest(payload) {

  
  const { _id, model, prompt, aspectRatio } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  let imageSize = getImageSizeForAspectRation(aspectRatio);


  const falLink = getFalLinkForModel(model);


  let reqPayload = {
    prompt: prompt,
    "image_size": imageSize,
  };


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


export async function pollSanaRequest(payload) {

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
  if (isTerminalProviderFailureStatus(responseStatus)) {
    return markImageProviderRequestFailed(
      ImageGeneration,
      _id,
      `FAL ${model || 'image'} request failed with status ${responseStatus}.`
    );
  }

  if (responseStatus === 'COMPLETED') {

    const result = await fal.queue.result(falLink, {
      requestId: apiRequestId
    });

    await ImageGeneration.findOneAndUpdate({
      _id: _id
    }, {
      rowLocked: true
    });


    const fileImages = result.data.images;

    const imageRemoteUrl = fileImages[0].url;


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
  if (model === 'SANA') {
    return 'fal-ai/sana'
  } else if (model === 'SANA4.5B') {
    return 'fal-ai/sana/v1.5/4.8b'
  } else if (model === 'SANASPRINT') {
    return 'fal-ai/sana/sprint'
  }
}


function getImageSizeForAspectRation(aspectRatio) {
  if (aspectRatio === '1:1') {
    return {
      width: 1024,
      height: 1024
    }
  } else if (aspectRatio === '16:9') {
    return {
      width: 1792,
      height: 1024
    }
  } else if (aspectRatio === '9:16') {
    return {
      width: 1024,
      height: 1792
    }
  }
}
