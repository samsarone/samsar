import { fal } from "@fal-ai/client";
import { getDBConnectionString } from "../DBString.js";
import ImageGeneration from "../schema/ImageGeneration.js";
import axios from 'axios';


import { saveRemoteFile } from "../utils/FileUtils.js";
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function handleSeedreamRequest(payload) {
  const { apiGenerationStatus, apiRequestId, model } = payload;

  if (apiGenerationStatus === 'INIT') {
    await submitSeedreamRequest(payload);
  } else if (apiGenerationStatus === 'PENDING') {
    const imageData = await pollSeedreamRequest(payload);

    return imageData;
  } else if (apiGenerationStatus === 'FAILED') {

    return {
      image: null,
    };



  }

}

export async function submitSeedreamRequest(payload) {


  const { _id, model, prompt, aspectRatio } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });


  const falLink = getFalLinkForModel(model);

  const imageSize = getImageSizeFromAspectRatio(aspectRatio);


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
      apiSubmittedAt: new Date(),
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

export async function pollSeedreamRequest(payload) {
  const { _id, apiRequestId, model } = payload;
  await getDBConnectionString();
  await ImageGeneration.findOneAndUpdate(
    { _id: _id },
    { rowLocked: true }
  );

  const falLink = getFalLinkForModel(model);

  
  let responseStatusData;
  try {
    responseStatusData = await fal.queue.status(falLink, {
      requestId: apiRequestId,
      logs: true,
    });
  } catch (error) {
    await ImageGeneration.findOneAndUpdate({
      _id: _id
    }, {
      generationStatus: "FAILED",
      apiGenerationStatus: "FAILED",
      rowLocked: false
    });

    return { image: null };
  }

  const responseStatus = responseStatusData.status;

  if (responseStatus === "COMPLETED") {

    try {
      const result = await fal.queue.result(falLink, {
        requestId: apiRequestId,
      });

      await ImageGeneration.findOneAndUpdate(
        { _id: _id },
        { rowLocked: true }
      );




      const fileImages = result.images || result.data?.images;
      const imageRemoteUrl = fileImages[0].url;

      const imageName = await saveRemoteFile(imageRemoteUrl);

      return { image: imageName };
    } catch (error) {
      await ImageGeneration.findOneAndUpdate({
        _id: _id
      }, {
        generationStatus: "FAILED",
        apiGenerationStatus: "FAILED",
        rowLocked: false
      });

      return { image: null, error: "Image retrieval failed" };

    }


  } else {
    await ImageGeneration.findOneAndUpdate(
      { _id: _id },
      { rowLocked: false }
    );

    return null;
  }
}




function getFalLinkForModel(model) {
  return 'fal-ai/bytedance/seedream/v4.5/text-to-image';

}



function getImageSizeFromAspectRatio(aspectRatio) {

  switch (aspectRatio) {
    case '1:1':
      return {
        width: 1024,
        height: 1024
      };
    case '16:9':
      return {
        width: 1792,
        height: 1024
      };
    case '9:16':
      return {
        width: 1024,
        height: 1792
      }
    default:
      return {
        width: 1024,
        height: 1024
      } // default to 1:1 if unknown aspect ratio
  }

}
