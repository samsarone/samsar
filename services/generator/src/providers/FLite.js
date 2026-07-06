import { fal } from "@fal-ai/client";

import { getDBConnectionString } from "../DBString.js";
import ImageGeneration from "../schema/ImageGeneration.js";
import axios from 'axios';
import sharp from 'sharp';
import { saveRemoteFile } from "../utils/FileUtils.js";

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function handleFLiteRequest(payload) {

  const { apiGenerationStatus, apiRequestId, model, imageStyle } = payload;



  if (apiGenerationStatus === 'INIT') {
    await submitFLiteRequest(payload);
  } else if (apiGenerationStatus === 'PENDING') {
    const imageData = await pollFLiteRequest(payload);

    return imageData;
  } else if (apiGenerationStatus === 'FAILED') {

    return {
      image: null,
    };

  }

}

export async function submitFLiteRequest(payload) {


  const { _id, model, prompt, aspectRatio , imageStyle } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  let imageSize = getImageSizeForAspectRation(aspectRatio);


  const falLink = getFalLinkForModel(imageStyle);


  let reqPayload = {
    prompt: prompt,
    "image_size": imageSize,

  };



  try {

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
  } catch (error) {
    console.error("Error submitting request to FAL: ", error);
    await ImageGeneration.findOneAndUpdate({
      _id: _id
    }, {
      generationStatus: "FAILED",
      apiGenerationStatus: "FAILED",
      rowLocked: false
    });
    return {
      image: null,
    };
  }
}


export async function pollFLiteRequest(payload) {

  const { _id, apiRequestId, model , imageStyle,  } = payload;
  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate({
    _id: _id
  }, {
    rowLocked: true
  });



  const falLink = getFalLinkForModel(imageStyle);


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
    return {
      image: null,
    };
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

    try {

      const fileImages = result.data.images;

      const imageRemoteUrl = fileImages[0].url;


      const imageName = await saveRemoteFile(imageRemoteUrl);

      return {
        image: imageName
      }

    } catch (error) {
      console.error("Error saving image: ", error);
      await ImageGeneration.findOneAndUpdate({
        _id: _id
      }, {
        generationStatus: "FAILED",
        apiGenerationStatus: "FAILED",
        rowLocked: false,
      });
      return {
        image: null,
      };
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
  if (model === 'texture') {
    return 'fal-ai/f-lite/texture';
  }
  return 'fal-ai/f-lite/standard';
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


