import { getDBConnectionString } from "../DBString.js";
import ImageGeneration from "../schema/ImageGeneration.js";
import axios from 'axios';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';
import { saveRemoteFile } from "../utils/FileUtils.js";
import { usesLocalAssetStorage } from '../utils/Environment.js';

const GCP_PROJECT_ID =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GOOGLE_PROJECT_ID ||
  process.env.GCP_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  process.env.PROJECT_ID ||
  'samsarone';
const GCP_LOCATION =
  process.env.GOOGLE_IMAGEN_LOCATION ||
  process.env.GOOGLE_CLOUD_LOCATION ||
  process.env.GCP_LOCATION ||
  'us-central1';

// Variables to store the token and its timestamp
let cachedToken = null;
let tokenFetchTime = null;
const TOKEN_VALIDITY_SECONDS = 3600; // assume token is valid for 1 hour

export async function handleImagenRequest(payload) {
  const { apiGenerationStatus } = payload;
  if (apiGenerationStatus === 'INIT') {
    const imageData = await submitImagenRequest(payload);
    return imageData;
  } else if (apiGenerationStatus === 'PENDING') {
    // No longer polling since we get the image immediately.
    return null;
  } else if (apiGenerationStatus === 'FAILED') {
    // Handle failure if needed.
    return { image: null };
  }
}

async function getAccessToken() {
  // Check if we have a cached token and if it's still valid
  if (cachedToken && !isTokenExpired()) {
    return cachedToken;
  }

  // If no token or token expired, fetch a new one
  try {
    const token = execSync('gcloud auth print-access-token', { encoding: 'utf-8' }).trim();

    cachedToken = token;
    tokenFetchTime = Date.now();
    return token;
  } catch (err) {
    console.error("Error fetching access token:", err.message);
    process.exit(1);
  }
}

// Checks if the cached token is expired
function isTokenExpired() {
  if (!tokenFetchTime) return true;
  const now = Date.now();
  const elapsedSeconds = (now - tokenFetchTime) / 1000;
  return elapsedSeconds > TOKEN_VALIDITY_SECONDS;
}

export async function submitImagenRequest(payload) {
  const { _id, model, prompt, aspectRatio } = payload;


  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  const gcpLink = getGCPLinkForModel(model);

  let reqPayload = {
    "instances": [
      {
        "prompt": prompt,
      }
    ],
    "parameters": {
      "sampleCount": 1,
      "aspectRatio": aspectRatio,
    }
  };

  const token = await getAccessToken();
  const headers = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    }
  };


  let responseData;
  try {
    responseData = await axios.post(gcpLink, reqPayload, headers);



  } catch (error) {
    // Check if this is possibly an invalid/expired token error and we haven't retried yet
    if (
      shouldRetryForAuth(error) &&
      !payload._retry // use a flag to avoid infinite loops
    ) {
      // Clear out cached token so it will re-fetch
      cachedToken = null;
      tokenFetchTime = null;
      payload._retry = true; // set this so we don't retry multiple times in a loop

      // Fetch new token
      const freshToken = await getAccessToken();
      headers.headers['Authorization'] = `Bearer ${freshToken}`;

      try {
        responseData = await axios.post(gcpLink, reqPayload, headers);
      } catch (error2) {
        // If it fails again, handle as usual
        console.error("Retry after token refresh still failed:", error2.message);
        return await handleImageRequestError(_id, error2);
      }
    } else {
      // If it's some other error or we've already retried, handle it
      return await handleImageRequestError(_id, error);
    }
  }


  try {
    // If we reach here, we have a successful response
    const response = responseData.data;
    const predictions = response.predictions;
    if (!predictions || !predictions.length) {
      console.error("No predictions returned");
      return await handleImageRequestError(_id, "No predictions returned");
    }

    const resByteBase64 = predictions[0].bytesBase64Encoded;
    if (!resByteBase64) {
      console.error("No base64 image data returned");
      return await handleImageRequestError(_id, "No base64 image data returned");
    }

    // Decode and save the image locally
    const imageName = await saveBase64Image(resByteBase64);

    // Mark the generation as completed directly since we have the image now
    await ImageGeneration.findOneAndUpdate(
      { _id: _id },
      {
        apiGenerationStatus: "COMPLETED",
        rowLocked: false
      }
    );

    return { image: imageName };

  } catch (error) {



    await ImageGeneration.findOneAndUpdate(
      { _id: id },
      {
        generationStatus: "FAILED",
        apiGenerationStatus: "FAILED",
        rowLocked: false
      }
    );

    return { image: null };


  }


}

function getGCPLinkForModel(model) {
  let modelID;
  if (model === 'IMAGEN3') {
    modelID = 'imagen-3.0-generate-001';
  } else {
    modelID = 'imagen-3.0-fast-generate-001';
  }
  const url = `https://${GCP_LOCATION}-aiplatform.googleapis.com/v1/projects/${GCP_PROJECT_ID}/locations/${GCP_LOCATION}/publishers/google/models/${modelID}:predict`;
  return url;
}

/**
 * Helper to determine if an error might be due to an invalid or expired token.
 * Checks HTTP status 401 or an "UNAUTHENTICATED" message in the error response.
 */
function shouldRetryForAuth(error) {
  if (!error.response) return false;
  const status = error.response.status;
  if (status === 401) {
    return true;
  }
  const data = error.response.data;
  if (data?.error?.status && data.error.status.includes('UNAUTHENTICATED')) {
    return true;
  }
  return false;
}

/**
 * Handle the error by marking the DB record as FAILED, then return a null image.
 */
async function handleImageRequestError(id, error) {
  await ImageGeneration.findOneAndUpdate(
    { _id: id },
    {
      generationStatus: "FAILED",
      apiGenerationStatus: "FAILED",
      rowLocked: false
    }
  );

  return { image: null };
}

async function saveBase64Image(base64Str) {
  try {
    const buffer = Buffer.from(base64Str, 'base64');
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
    console.error(`Error saving image: ${error.message}`);
    throw error;
  }
}
