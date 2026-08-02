import { IMAGE_GENERAITON_MODEL_TYPES, IMAGE_EDIT_MODEL_TYPES } from './constants.js';
import axios from 'axios';
import path from 'path';
import { saveGeneratedFile } from './Files.js';
import { getImageFromAPI } from './OpenAI.js';

import { getImage2OutpaintImageFromApi } from './providers/GPTImageOne.js';

import { handleFluxEditRequest } from './edit/FluxEditor.js';
import { handleBriaEditRequest } from './providers/Bria.js';
import { handleNanoBananaEditDispatch } from './edit/NanoBananaRouting/NanoBananaDispatcher.js';
import {
  handleGenBlazeImageEditRequest,
  shouldUseGenBlazeImageEditProvider,
} from './providers/GenBlazeImageEdit.js';
import {
  handleSamsarExternalImageEditRequest,
  shouldUseSamsarExternalImageEditProvider,
} from './providers/SamsarExternalImage.js';


const IMAGE_PROCESSOR_SERVER = process.env.IMAGE_PROCESSOR_SERVER;


export async function getImageFromText(payload) {
  const { prompt, model , aspectRatio} = payload;


  if (model === IMAGE_GENERAITON_MODEL_TYPES['SDXL']) {
    const imageURL = await getImageFromWebModel(prompt);
    return imageURL;
  } else if (model === IMAGE_GENERAITON_MODEL_TYPES['DALLE3']) {
    const response = await getImageFromAPI(prompt, aspectRatio);
    return response;
  } 
}

export async function getEditImageFromText(payload) {

  const { prompt, model, image, maskImage, guidanceScale, numInferenceSteps, strength } = payload;

  if (shouldUseGenBlazeImageEditProvider(payload)) {
    return handleGenBlazeImageEditRequest(payload);
  }
  if (shouldUseSamsarExternalImageEditProvider(payload)) {
    return handleSamsarExternalImageEditRequest(payload);
  }

  
  if (model.startsWith('FLUX')) {

    const editResponse = await handleFluxEditRequest(payload);
    return editResponse;

  } else if (model.startsWith("BRIA")) {
    const editResponse = await handleBriaEditRequest(payload);
    return editResponse;

  } else if (model === 'GPTIMAGE2EDIT' || model === 'GPTIMAGE1EDIT') {
    const editResponse = await getImage2OutpaintImageFromApi(payload);
    return editResponse;
  } else if (
    model === 'NANOBANANA2EDIT' ||
    model === 'NANOBANANAPROEDIT' ||
    model === 'NANOBANANAEDIT'
  ) {
    const imageURL = await handleNanoBananaEditDispatch(payload);
    return imageURL;
  }

}

async function getImageFromWebModel(prompt) {
  const response = await axios.post(`${IMAGE_PROCESSOR_SERVER}/generate`, {
    prompt
  });
  const imageData = response.data.image;
  const imageName = await saveGeneratedFile(imageData);
  return imageName;
}


async function getEditedImageFromWebModel(payload) {
  const response = await axios.post(`${IMAGE_PROCESSOR_SERVER}/edit`, payload);
  const imageData = response.data.image;
  const imageName = await saveGeneratedFile(imageData);
  return imageName;
}
