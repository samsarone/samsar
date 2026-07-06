import 'dotenv/config';
import * as fs from 'fs';
import path from "path";
import { mkdir, writeFile } from "fs/promises";
import sharp from "sharp";
import axios from "axios";
import { saveRemoteFile } from "../utils/FileUtils.js";

import OpenAI, { toFile } from "openai";
import {
  getDefaultUserInferenceModel,
  isGeminiInferenceModel,
} from '../inference/InferenceModels.js';
import { createGoogleGeminiChatCompletion } from '../inference/GoogleGemini.js';
import {
  createSamsarExternalChatCompletion,
  shouldUseSamsarExternalInference,
} from '../inference/SamsarExternalInferenceAdapter.js';
import {
  getAccessibleMediaUrlForProvider,
  resolveLocalMediaReferencePath,
} from '../utils/MediaReferenceUtils.js';

const API_KEY = process.env.OPENAI_API_KEY;
const GPT_IMAGE_MODEL = "gpt-image-2";
const GPT_IMAGE_QUALITY = "high";


const openai = new OpenAI({ apiKey: API_KEY || '' });

export async function handleGPTImageTwoRequest(payload) {

  const {
    prompt,
    aspectRatio = '1:1',
    retryCount = 0
  } = payload;

  const responseSize = getRequestDimensionsForDimensions(aspectRatio);


  try {

    const inputPayload = {
      model: GPT_IMAGE_MODEL,
      prompt: prompt,
      size: responseSize,
      quality: GPT_IMAGE_QUALITY,
      output_format: "png",
      n: 1
    };

    const image = await openai.images.generate(inputPayload);

    const imageData = image.data[0]['b64_json'];

    const imageBuffer = Buffer.from(imageData, 'base64');

    const isBlackImage = await checkIfBlackImage(imageBuffer);
    if (isBlackImage) {
      throw new Error("Generated image is completely black.");
    }

    const metadata = await sharp(imageBuffer).metadata();
    const imageName = await saveBufferToFile(imageBuffer);



    return {
      image: imageName,
      width: metadata.width,
      height: metadata.height,
      preserveOriginalForAiVideo: true
    };

  } catch (error) {
    let errorString = 'An error occurred while generating the image. Please try again with a different prompt.'
    if (error.error && error.error.message) {
      errorString = error.error.message;
    }
    return {
      'image': null,
      'error': errorString
    }
  }


}

export async function handleGPTImageOneRequest(payload) {
  return handleGPTImageTwoRequest(payload);
}

function getRequestDimensionsForDimensions(aspectRatio) {
  let responseSize = '1024x1024';
  if (aspectRatio === '16:9') {
    responseSize = '1536x864';
  } else if (aspectRatio === '9:16') {
    responseSize = '864x1536';
  }
  return responseSize;



}


export async function downloadToFile(url) {
  const localPath = resolveLocalMediaReferencePath(url);
  if (localPath) {
    return await toFile(
      fs.createReadStream(localPath),
      path.basename(localPath),
      { type: getImageMimeTypeFromPath(localPath) }
    );
  }

  const tsSeconds = Math.floor(Date.now() / 1000);
  const fileName = `image_${tsSeconds}.png`;
  const filePath = path.resolve(process.cwd(), fileName);

  const accessibleUrl = await getAccessibleMediaUrlForProvider(url);
  const fileData = await axios.get(accessibleUrl, { responseType: "arraybuffer" });
  await fs.promises.writeFile(filePath, Buffer.from(fileData.data));

  // Pass a *real* filename into the second parameter:
  const file = await toFile(
    fs.createReadStream(filePath),
    fileName,               // Instead of null
    { type: "image/png" }
  );

  return file;
}

function getImageMimeTypeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/png';
}


export async function getImage2OutpaintImageFromApi(payload) {

  const { maskImage, prompt, aspectRatio } = payload;


  const imageUrl = payload.image;


  const imageUrlLocalFile = await downloadToFile(imageUrl);

  const maskImageLocalFile = await downloadToFile(maskImage);



  const imageSize = getRequestDimensionsForDimensions(aspectRatio);

  const inputPayload = {
    image: imageUrlLocalFile,
    mask: maskImageLocalFile,
    prompt: prompt,
    size: imageSize,
    quality: GPT_IMAGE_QUALITY,
    output_format: "png",
    model: GPT_IMAGE_MODEL
  }

  try {
    const image = await openai.images.edit(
      inputPayload
    );

    const imageData = image.data[0]['b64_json'];


    const randStr = Math.random().toString(36).substring(7);


    const buffer = Buffer.from(imageData, 'base64');
    const isBlackImage = await checkIfBlackImage(buffer);
    if (isBlackImage) {
      throw new Error("Generated image is completely black.");
    }

    const imageName = await saveBufferToFile(buffer);


    return { image: imageName };

  } catch (error) {



    let errorString = 'An error occurred while editing the image. Please try again with a different prompt.'
    if (error.error && error.error.message) {
      errorString = error.error.message;
    }

    return {
      'image': null,
      'error': errorString
    }

  }
}

export async function getImage1OutpaintImageFromApi(payload) {
  return getImage2OutpaintImageFromApi(payload);
}

export async function getAlternatePromptFromPrompt(prompt, retryCount) {
  const systemPrompt = `
    You rewrite prompts for a generative text-to-image retry. Return one clean prompt that can be sent directly to an image model.
    Keep the scene relevant, visually specific, and concise.
    Remove minors, graphic violence, sexual content, private information, real-person likenesses, protected IP, exact character recipes, logos, franchise terms, and branded costume or design details.
    Replace risky elements with original, brand-free, non-identifying adult characters and general-audience imagery.
    For low retry counts, make the smallest useful edit. For higher retry counts, simplify the prompt while preserving the broad subject, setting, action, mood, composition, lighting, and art style.
    Output only one natural paragraph with no headings, labels, analysis, or policy notes.
  `;

  // User messages
  const userPrompt = `Please modify the following prompt to avoid content policy violations:\n\n${prompt}`;

  const messageList = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: `The Retry count is ${retryCount}.` },
    { role: 'user', content: userPrompt }
  ];

  // Send the request to your assistant LLM (implementation-dependent)
  const response = await sendAssistantMessageRequest(messageList);

  return response.content;
}



export async function sendAssistantMessageRequest(messageList, userInferenceModel = getDefaultUserInferenceModel()) {

  try {
    const payload = {
      messages: messageList,
      model: isGeminiInferenceModel(userInferenceModel) ? userInferenceModel : "gpt-4o-mini",
    };

    if (shouldUseSamsarExternalInference(payload)) {
      const response = await createSamsarExternalChatCompletion(payload);
      return response.choices[0].message;
    }

    if (isGeminiInferenceModel(userInferenceModel)) {
      const response = await createGoogleGeminiChatCompletion(messageList, userInferenceModel);
      return response.choices[0].message;
    }

    const response = await openai.chat.completions.create(payload);
    return response.choices[0].message;
  } catch (error) {
    let errorString = 'An error occurred while sending the message. Please try again with a different message.'
    throw new Error(errorString);
  }

}

async function saveBufferToFile(buffer) {
  const randStr = Math.random().toString(36).substring(7);
  const imageName = `generation_${Date.now()}_${randStr}.png`;

  let baseAssetsPath;

  if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
    baseAssetsPath = '/assets/generations';
  } else {
    const pwd = process.cwd();
    baseAssetsPath = path.join(pwd, '..', 'samsar_processor', 'assets', 'generations');
  }

  const savePath = path.join(baseAssetsPath, imageName);

  await mkdir(path.dirname(savePath), { recursive: true });
  await writeFile(savePath, buffer);

  return imageName;
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
