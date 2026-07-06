import { fal } from "@fal-ai/client";
import { getDBConnectionString } from "./DBString.js";
import ImageGeneration from "./schema/ImageGeneration.js";
import axios from 'axios';
import { markVideoSessionLayerAsFailed } from './VideoSession.js';
import { getCanvasDimensionsForAspectRatio } from './utils/CanvasUtils.js';
import sharp from 'sharp';
import { resizeAndSaveRemoteFile } from "./utils/FileUtils.js";

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function handleRecraftRequest(payload) {
  const { apiGenerationStatus, apiRequestId, model } = payload;
  if (apiGenerationStatus === 'INIT') {
    await submitRecraftRequest(payload);
  } else if (apiGenerationStatus === 'PENDING') {
    const imageData = await pollRecraftRequest(payload);

    return imageData;
  } else if (apiGenerationStatus === 'FAILED') {
    await markVideoSessionLayerAsFailed(payload);
    return {
      image: null,
    };

  }

}

export async function submitRecraftRequest(payload) {
  let { _id, model, prompt, aspectRatio, imageStyle } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  const imageSize = getCanvasDimensionsForAspectRatio(aspectRatio);

  const falLink = getRecraftLinkForModel(model);



  
  if (!imageStyle) {
    imageStyle = 'digital_illustration';
  }

  const inputPayload = {
    prompt: prompt,
    "image_size": imageSize,
    "style": imageStyle,
  }





  const response = await fal.queue.submit(falLink, {
    input: inputPayload,
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


export async function pollRecraftRequest(payload) {
  const { _id, apiRequestId, model, aspectRatio } = payload;
  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate({
    _id: _id
  }, {
    rowLocked: true
  });



  const falLink = getRecraftLinkForModel(model);


  const responseStatusData = await fal.queue.status(falLink, {
    requestId: apiRequestId,
    logs: true,
  });


  const responseStatus = responseStatusData.status;

  if (responseStatus === 'COMPLETED') {

    let result;
    try {

      result = await fal.queue.result(falLink, {
        requestId: apiRequestId
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

    await ImageGeneration.findOneAndUpdate({
      _id: _id
    }, {
      rowLocked: true
    });


    const fileImages = result.data.images;

    const imageRemoteUrl = fileImages[0].url;


    const newDimensions = getCanvasDimensionsForAspectRatio(aspectRatio);

    const imageName = await resizeAndSaveRemoteFile(imageRemoteUrl, newDimensions);

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


function getRecraftLinkForModel(model) {
  if (model === 'RECRAFTV3') {
  return "fal-ai/recraft-v3";
  } else {
    return 'fal-ai/recraft-20b';
  }
}

function getImageSizeForAspectRation(aspectRatio) {
  if (aspectRatio === '1:1') {
    return 'square';
  } else if (aspectRatio === '16:9') {
    return 'landscape_16_9';
  } else if (aspectRatio === '9:16') {
    return 'portrait_16_9';
  }
}




