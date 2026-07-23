import { fal } from "@fal-ai/client";
import { getDBConnectionString } from "../DBString.js";
import ImageGeneration from "../schema/ImageGeneration.js";
import axios from 'axios';
import { markVideoSessionLayerAsFailed } from '../VideoSession.js';
import { IMAGE_EDIT_MODEL_TYPES } from "../constants.js";
import { getAccessibleMediaUrlForProvider } from '../utils/MediaReferenceUtils.js';
import { usesLocalAssetStorage } from '../utils/Environment.js';



import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const FAL_API_KEY = process.env.FAL_API_KEY;

fal.config({
  credentials: FAL_API_KEY
});


export async function handleFluxEditRequest(payload) {
  const { apiEditStatus, apiRequestId, model } = payload;


  if (apiEditStatus === 'INIT') {
    await submitFluxEditRequest(payload);
  } else if (apiEditStatus === 'PENDING') {

    const imageData = await pollFluxRequest(payload);



    return imageData;
  } else if (apiEditStatus === 'FAILED') {


    await markLayerImageGenerationAsFailed(payload);


  }

}

export async function submitFluxEditRequest(payload) {
  const { _id, model, prompt, aspectRatio } = payload;
  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  let imageSize = getImageSizeForAspectRation(aspectRatio);


  const falLink = getFalLinkForModel(model);



  const editModelValue = IMAGE_EDIT_MODEL_TYPES.find((em) => em.key === model);



  const imageUrl = await getAccessibleMediaUrlForProvider(payload.image, { mediaKind: 'image' });
  const maskUrl = payload.maskImage
    ? await getAccessibleMediaUrlForProvider(payload.maskImage, { mediaKind: 'image' })
    : null;

  let reqPayload =  {
      prompt: prompt,
      image_size: imageSize,
      safety_tolerance: 3,
      image_url: imageUrl,
      output_format: 'png'
  };

  if (editModelValue.editType === 'inpaint' && maskUrl) {

    reqPayload['mask_url'] = maskUrl;
  }




  let response = await fal.queue.submit(falLink, {
    input: reqPayload,
  });


  const requestId = response.request_id;


  
  await ImageGeneration.findOneAndUpdate({
    _id: _id
  }, {
    apiRequestId: requestId,
    apiEditStatus: "PENDING",
    rowLocked: false
  });


}


export async function pollFluxRequest(payload) {
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
      editStatus: "FAILED",
      apiEditStatus: "FAILED",
      rowLocked: false
    });
    return null;
  }

  const responseStatus = responseStatusData.status;



  if (responseStatus === 'COMPLETED') {



    let result;

    try {
     result = await fal.queue.result(falLink, {
      requestId: apiRequestId
    });

  } catch (error) {

  }





    await ImageGeneration.findOneAndUpdate({
      _id: _id
    }, {
      rowLocked: true
    });


    const fileImages = result.images;


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
  if (model === 'FLUX1.1PROREDUX') {
    return "fal-ai/flux-pro/v1.1/redux";
  } else if (model === 'FLUX1.1PROULTRAREDUX') {
    return "fal-ai/flux-pro/v1.1-ultra/redux";
  } else if (model === 'FLUX1PROFILL') {
    return "fal-ai/flux-pro/v1/fill";
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


async function saveRemoteFile(remoteImageUrl) {
  try {
    // Use axios to download the image as a stream
    const response = await axios({
      method: 'get',
      url: remoteImageUrl,
      responseType: 'arraybuffer'  // This ensures we get the data as a buffer
    });

    const buffer = Buffer.from(response.data);  // Convert the response data to a buffer

    const randStr = Math.random().toString(36).substring(7);
    const imageName = `generation_${Date.now()}_${randStr}.png`;

    const pwd = process.cwd();
    let savePath = path.join(pwd, '..', 'samsar_processor', 'assets', 'generations', imageName);

    if (usesLocalAssetStorage()) {
      savePath = path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'generations', imageName);
    }
    
    // Ensure the directory exists
    await mkdir(path.dirname(savePath), { recursive: true });

    // Write the file to the filesystem
    await writeFile(savePath, buffer);

    return imageName;

  } catch (error) {
    console.error(`Error downloading or saving image: ${error.message}`);
    throw error;
  }
}
