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

export async function handleHunyuanRequest(payload) {
  const { apiGenerationStatus, apiRequestId, model } = payload;

  if (apiGenerationStatus === 'INIT') {
    await submitHunyuanRequest(payload);
  } else if (apiGenerationStatus === 'PENDING') {
    const imageData = await pollHunyuanRequest(payload);

    return imageData;
  } else if (apiGenerationStatus === 'FAILED') {

    return {
      image: null,
    };



  }

}

export async function submitHunyuanRequest(payload) {


  const { _id, model, prompt, aspectRatio } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });


  const falLink = getFalLinkForModel(model);

  const imageSize = getImageSizeFromAspectRatio(aspectRatio);


  let reqPayload = {
    prompt: prompt,
    "image_size": imageSize,
    "enable_safety_checker": true,

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

export async function pollHunyuanRequest(payload) {
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
  return 'fal-ai/hunyuan-image/v3/text-to-image';

}



function getImageSizeFromAspectRatio(aspectRatio) {

  switch (aspectRatio) {
    case '1:1':
      return 'square_hd';
    case '16:9':
      return 'landscape_16_9'
    case '9:16':
      return 'portrait_16_9';

    default:
      return 'square_hd';
  }

}
