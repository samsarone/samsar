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


export async function handleImagenFalRequest(payload) {

  const { apiGenerationStatus, apiRequestId, model } = payload;

  if (apiGenerationStatus === 'INIT') {
    await submitImagenRequest(payload);
  } else if (apiGenerationStatus === 'PENDING') {
    const imageData = await pollImagenRequest(payload);

    return imageData;
  } else if (apiGenerationStatus === 'FAILED') {

    return {
      image: null,
    };

  }

}

export async function submitImagenRequest(payload) {


  const { _id, model, prompt, aspectRatio } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });


  const falLink = getFalLinkForModel(model);


  let reqPayload = {
    prompt: prompt,
    "aspect_ratio": aspectRatio,
    "num_images": 1,

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


export async function pollImagenRequest(payload) {

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

    return {
      image: null,
    };
  }

  const responseStatus = responseStatusData.status;

  if (responseStatus === 'COMPLETED') {

    try {

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

    } catch (error) {
      console.error("Error saving image: ", error);

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

  return "fal-ai/imagen4/preview";
}



function getImageSizeForAspectRation(aspectRatio) {
  if (aspectRatio === '1:1') {
    return '1:1';
  } else if (aspectRatio === '16:9') {
    return '16_9';
  } else if (aspectRatio === '9:16') {
    return '9:16';
  }
}




