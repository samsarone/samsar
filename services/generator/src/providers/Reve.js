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


export async function handleReveRequest(payload) {

  const { apiGenerationStatus, apiRequestId, model } = payload;


  if (apiGenerationStatus === 'INIT') {
    await submitReveRequest(payload);
  } else if (apiGenerationStatus === 'PENDING') {
    const imageData = await pollReveRequest(payload);

    return imageData;
  } else if (apiGenerationStatus === 'FAILED') {
    return {
      image: null,
    };

  }

}

export async function submitReveRequest(payload) {


  const { _id, model, prompt, aspectRatio } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  let imageSize = getImageSizeForAspectRation(aspectRatio);


  const falLink = getFalLinkForModel(model);


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


export async function pollReveRequest(payload) {

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
  return 'fal-ai/lumina-image/v2';
}



function getImageSizeForAspectRation(aspectRatio) {
  if (aspectRatio === '1:1') {
    return 'square';
  } else if (aspectRatio === '16:9') {
    return 'landscape_16_9';
  } else if (aspectRatio === '9:16') {
    return 'portrait_9_16';
  }
}



// Function to check if the image is all black
async function checkIfBlackImage(buffer) {
  try {
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });

    // Check if all pixels are black (i.e., RGB all zero)
    for (let i = 0; i < data.length; i += 3) {
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) {
        return false; // At least one non-black pixel found
      }
    }

    return true; // All pixels are black
  } catch (error) {
    console.error(`Error checking image for black pixels: ${error.message}`);
    throw error;
  }
}
