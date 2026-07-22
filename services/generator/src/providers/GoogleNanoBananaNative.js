import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import { getGoogleAccessToken, getGoogleCloudConfig } from '../inference/GoogleADC.js';
import { resolveLocalMediaReferencePath } from '../utils/MediaReferenceUtils.js';
import { getCurrentEnvironment } from '../utils/Environment.js';

const DEFAULT_NANOBANANA_2_MODEL = 'gemini-3.1-flash-image';
const DEFAULT_NANOBANANA_PRO_MODEL = 'gemini-3-pro-image-preview';
const DEFAULT_GOOGLE_IMAGE_LOCATION = 'global';
const DEFAULT_IMAGE_MIME_TYPE = 'image/png';
const DEFAULT_GOOGLE_IMAGE_ASPECT_RATIO = '1:1';
const GOOGLE_NATIVE_REQUEST_PREFIX = 'google-native-nanobanana:';
const MAX_INLINE_IMAGE_BYTES = 7 * 1024 * 1024;
const GOOGLE_NANOBANANA_GENERATION_MODELS = new Set(['NANOBANANA2', 'NANOBANANAPRO']);
const GOOGLE_IMAGE_ASPECT_RATIOS = new Set([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
]);
const GOOGLE_IMAGE_ASPECT_RATIO_ALIASES = new Map([
  ['square', '1:1'],
  ['portrait', '9:16'],
  ['vertical', '9:16'],
  ['story', '9:16'],
  ['stories', '9:16'],
  ['reel', '9:16'],
  ['reels', '9:16'],
  ['short', '9:16'],
  ['shorts', '9:16'],
  ['mobile', '9:16'],
  ['landscape', '16:9'],
  ['horizontal', '16:9'],
  ['wide', '16:9'],
  ['widescreen', '16:9'],
]);

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    const normalized = normalizeString(value);
    if (normalized) {
      return normalized;
    }
  }
  return '';
}

function envFlagEnabled(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function envFlagDisabled(value) {
  const normalized = normalizeString(value).toLowerCase();
  return normalized === 'false' || normalized === '0' || normalized === 'no';
}

function isGoogleNativeNanoBananaRequestId(requestId) {
  return normalizeString(requestId).startsWith(GOOGLE_NATIVE_REQUEST_PREFIX);
}

export function shouldUseGoogleNativeNanoBanana(payloadOrModel) {
  const payload = typeof payloadOrModel === 'object' && payloadOrModel !== null ? payloadOrModel : null;
  const model = payload ? payload.model : payloadOrModel;

  if (!GOOGLE_NANOBANANA_GENERATION_MODELS.has(model)) {
    return false;
  }

  if (
    envFlagEnabled(process.env.GOOGLE_NANOBANANA_USE_FAL) ||
    envFlagDisabled(process.env.GOOGLE_NANOBANANA_NATIVE_ENABLED)
  ) {
    return false;
  }

  const providerStatus = payload?.apiGenerationStatus || 'INIT';
  if (
    model === 'NANOBANANAPRO' &&
    normalizeString(process.env.CURRENT_ENV).toLowerCase() === 'production' &&
    normalizeString(process.env.FAL_API_KEY) &&
    providerStatus === 'INIT'
  ) {
    return false;
  }

  if (!payload) {
    return true;
  }

  if (providerStatus === 'INIT') {
    return true;
  }

  return isGoogleNativeNanoBananaRequestId(payload.apiRequestId);
}

export function resolveGoogleNanoBananaModel(model) {
  if (model === 'NANOBANANAPRO' || model === 'NANOBANANAPROEDIT') {
    const configuredModel = (
      normalizeString(process.env.GOOGLE_NANOBANANA_PRO_MODEL) ||
      normalizeString(process.env.GOOGLE_NANO_BANANA_PRO_MODEL) ||
      DEFAULT_NANOBANANA_PRO_MODEL
    );
    return configuredModel === 'gemini-3-pro-image'
      ? DEFAULT_NANOBANANA_PRO_MODEL
      : configuredModel;
  }

  return (
    normalizeString(process.env.GOOGLE_NANOBANANA_2_MODEL) ||
    normalizeString(process.env.GOOGLE_NANO_BANANA_2_MODEL) ||
    DEFAULT_NANOBANANA_2_MODEL
  );
}

function resolveGoogleImageLocation() {
  return (
    normalizeString(process.env.GOOGLE_NANOBANANA_LOCATION) ||
    normalizeString(process.env.GOOGLE_GEMINI_IMAGE_LOCATION) ||
    normalizeString(process.env.GOOGLE_GEMINI_LOCATION) ||
    normalizeString(process.env.GOOGLE_VERTEX_AI_LOCATION) ||
    DEFAULT_GOOGLE_IMAGE_LOCATION
  );
}

function buildVertexGenerateContentUrl({ projectId, location, model }) {
  const host = location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;

  return `https://${host}/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
}

function gcd(a, b) {
  let left = Math.abs(Math.round(a));
  let right = Math.abs(Math.round(b));
  while (right) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left || 1;
}

function closestSupportedAspectRatio(width, height, defaultValue = DEFAULT_GOOGLE_IMAGE_ASPECT_RATIO) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return defaultValue;
  }

  const divisor = gcd(width, height);
  const reduced = `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
  if (GOOGLE_IMAGE_ASPECT_RATIOS.has(reduced)) {
    return reduced;
  }

  const targetRatio = width / height;
  let bestRatio = defaultValue;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const supportedRatio of GOOGLE_IMAGE_ASPECT_RATIOS) {
    const [supportedWidth, supportedHeight] = supportedRatio.split(':').map(Number);
    const supportedNumericRatio = supportedWidth / supportedHeight;
    const distance = Math.abs(Math.log(targetRatio / supportedNumericRatio));
    if (distance < bestDistance) {
      bestDistance = distance;
      bestRatio = supportedRatio;
    }
  }

  return bestRatio;
}

function getAspectRatioFromString(aspectRatio) {
  const raw = normalizeString(aspectRatio);
  if (!raw) {
    return null;
  }

  const aliasKey = raw.toLowerCase().replace(/[\s_-]+/g, '');
  if (GOOGLE_IMAGE_ASPECT_RATIO_ALIASES.has(aliasKey)) {
    return GOOGLE_IMAGE_ASPECT_RATIO_ALIASES.get(aliasKey);
  }

  const match = raw.match(/(\d+(?:\.\d+)?)\s*(?::|x|×|\/|by|_)\s*(\d+(?:\.\d+)?)/i);
  if (!match) {
    return null;
  }

  const left = parseFloat(match[1]);
  const right = parseFloat(match[2]);
  return closestSupportedAspectRatio(left, right, null);
}

function getNumericPayloadValue(payload, keys) {
  for (const key of keys) {
    const parsed = Number(payload?.[key]);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function getAspectRatioFromPayloadDimensions(payload) {
  const width = getNumericPayloadValue(payload, [
    'width',
    'targetWidth',
    'target_width',
    'outputWidth',
    'output_width',
    'imageWidth',
    'image_width',
  ]);
  const height = getNumericPayloadValue(payload, [
    'height',
    'targetHeight',
    'target_height',
    'outputHeight',
    'output_height',
    'imageHeight',
    'image_height',
  ]);

  return width && height
    ? closestSupportedAspectRatio(width, height, null)
    : null;
}

export function normalizeGoogleNanoBananaAspectRatio(aspectRatio, defaultValue = DEFAULT_GOOGLE_IMAGE_ASPECT_RATIO) {
  return getAspectRatioFromString(aspectRatio) || defaultValue;
}

function normalizeImageSize(value) {
  const normalized = normalizeString(value).toUpperCase();
  if (['1K', '2K', '4K'].includes(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeImageCount(value, defaultValue = 1) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return Math.max(1, Math.min(Math.floor(parsed), 4));
}

function getImageReferencesFromPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const references = [];
  const seen = new Set();
  const pushReference = (value) => {
    const normalized = normalizeString(
      typeof value === 'string'
        ? value
        : value?.url || value?.image_url || value?.imageUrl || value?.src
    );
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    references.push(normalized);
  };

  const listKeys = [
    'imageReferences',
    'image_references',
    'image_urls',
    'imageUrls',
    'input_image_urls',
    'inputImageUrls',
    'images',
  ];
  for (const key of listKeys) {
    if (Array.isArray(payload[key])) {
      payload[key].forEach(pushReference);
    }
  }

  const scalarKeys = [
    'image',
    'image_url',
    'imageUrl',
    'imageRef',
    'inputImage',
    'input_image',
  ];
  for (const key of scalarKeys) {
    if (payload[key]) {
      pushReference(payload[key]);
    }
  }

  return references;
}

export function normalizeGoogleNanoBananaRequestPayload(payload = {}) {
  const inferredAspectRatio = getAspectRatioFromPayloadDimensions(payload);
  const rawAspectRatio =
    payload?.aspectRatio ??
    payload?.aspect_ratio ??
    payload?.ratio ??
    payload?.imageAspectRatio ??
    payload?.image_aspect_ratio ??
    payload?.outputAspectRatio ??
    payload?.output_aspect_ratio;
  const rawResolution =
    payload?.resolution ??
    payload?.imageSize ??
    payload?.image_size ??
    payload?.outputSize ??
    payload?.output_size ??
    payload?.size;
  const rawNumImages =
    payload?.numImages ??
    payload?.num_images ??
    payload?.sampleCount ??
    payload?.sample_count ??
    payload?.imageCount ??
    payload?.image_count;

  return {
    ...payload,
    prompt: firstNonEmptyString(payload?.prompt, payload?.text, payload?.input, payload?.description),
    aspectRatio: normalizeGoogleNanoBananaAspectRatio(
      rawAspectRatio,
      inferredAspectRatio || DEFAULT_GOOGLE_IMAGE_ASPECT_RATIO,
    ),
    resolution: normalizeImageSize(rawResolution),
    numImages: normalizeImageCount(rawNumImages),
  };
}

export function buildGoogleNanoBananaGenerationConfig({ aspectRatio, resolution }) {
  const imageConfig = {
    aspectRatio: normalizeGoogleNanoBananaAspectRatio(aspectRatio),
    imageOutputOptions: {
      mimeType: DEFAULT_IMAGE_MIME_TYPE,
    },
  };
  const imageSize = normalizeImageSize(resolution);
  if (imageSize) {
    imageConfig.imageSize = imageSize;
  }

  return {
    responseModalities: ['TEXT', 'IMAGE'],
    imageConfig,
  };
}

export function buildGoogleNanoBananaGenerateContentRequest({ prompt, imageParts = [], aspectRatio, resolution }) {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          { text: normalizeString(prompt) || 'Generate a high-quality image.' },
          ...imageParts,
        ],
      },
    ],
    generationConfig: buildGoogleNanoBananaGenerationConfig({ aspectRatio, resolution }),
  };
}

function parseDataUrl(dataUrl) {
  const match = normalizeString(dataUrl).match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    return null;
  }

  return {
    mimeType: match[1] || DEFAULT_IMAGE_MIME_TYPE,
    data: match[2],
  };
}

function getMimeTypeFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  return DEFAULT_IMAGE_MIME_TYPE;
}

function getLocalGenerationBasePath() {
  const currentEnv = getCurrentEnvironment();
  if (currentEnv === 'docker') {
    return path.join(process.env.SAMSAR_ASSETS_ROOT || '/assets', 'generations');
  }

  return path.join(process.cwd(), '..', 'samsar_processor', 'assets', 'generations');
}

function getLocalAssetsRoot(folderName) {
  const currentEnv = getCurrentEnvironment();
  if (currentEnv === 'docker' || currentEnv === 'staging') {
    if (folderName === 'assets_v2') {
      return process.env.SAMSAR_ASSETS_V2_ROOT || '/assets_v2';
    }
    if (folderName === 'assets') {
      return process.env.SAMSAR_ASSETS_ROOT || '/assets';
    }
    return `/${folderName}`;
  }

  return path.join(process.cwd(), '..', 'samsar_processor', folderName);
}

function getLocalGenerationPath(imageName) {
  return path.join(getLocalGenerationBasePath(), imageName);
}

function getLocalImageCandidatePaths(imageReference) {
  const reference = normalizeString(imageReference);
  if (!reference) {
    return [];
  }

  const candidates = [];
  if (path.isAbsolute(reference)) {
    candidates.push(reference);
  }

  const withoutQuery = reference.split('?')[0].split('#')[0];
  const normalized = withoutQuery.replace(/^[\\/]+/, '');
  const assetsV2RelativePath = normalized.replace(/^assets_v2\//, '');
  const assetsRelativePath = normalized.replace(/^assets\//, '');
  const generationRelativePath = normalized.startsWith('generations/')
    ? normalized.slice('generations/'.length)
    : normalized;

  if (normalized.startsWith('assets_v2/')) {
    candidates.push(path.join(getLocalAssetsRoot('assets_v2'), assetsV2RelativePath));
  }
  if (normalized.startsWith('assets/')) {
    candidates.push(path.join(getLocalAssetsRoot('assets'), assetsRelativePath));
  }
  if (normalized.startsWith('generations/')) {
    candidates.push(path.join(getLocalAssetsRoot('assets_v2'), 'generations', generationRelativePath));
    candidates.push(path.join(getLocalAssetsRoot('assets'), 'generations', generationRelativePath));
  }
  candidates.push(path.join(getLocalGenerationBasePath(), path.basename(generationRelativePath)));
  candidates.push(path.join(process.cwd(), normalized));

  return [...new Set(candidates)];
}

async function readLocalImageReference(imageReference) {
  const fileUrlPrefix = 'file://';
  let normalizedReference = normalizeString(imageReference);
  if (normalizedReference.startsWith(fileUrlPrefix)) {
    normalizedReference = new URL(normalizedReference).pathname;
  }

  for (const candidatePath of getLocalImageCandidatePaths(normalizedReference)) {
    try {
      const buffer = await readFile(candidatePath);
      return {
        mimeType: getMimeTypeFromPath(candidatePath),
        data: buffer.toString('base64'),
      };
    } catch {
    }
  }

  throw new Error(`Unable to read local image reference: ${imageReference}`);
}

async function fetchRemoteImageReference(imageReference) {
  const response = await fetch(imageReference);
  if (!response.ok) {
    throw new Error(`Unable to fetch image for Google Nano Banana request: ${response.status}`);
  }

  const mimeType = response.headers.get('content-type')?.split(';')?.[0] || DEFAULT_IMAGE_MIME_TYPE;
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_INLINE_IMAGE_BYTES) {
    throw new Error('Image is too large for inline Google Nano Banana input.');
  }

  return {
    mimeType,
    data: buffer.toString('base64'),
  };
}

export async function buildGoogleNanoBananaImagePart(imageReference) {
  const normalizedReference = normalizeString(
    typeof imageReference === 'string'
      ? imageReference
      : imageReference?.url || imageReference?.image_url || imageReference?.imageUrl
  );

  if (!normalizedReference) {
    return null;
  }

  const dataImage = parseDataUrl(normalizedReference);
  if (dataImage) {
    return { inlineData: dataImage };
  }

  const localPath = resolveLocalMediaReferencePath(normalizedReference);
  const inlineImage = localPath
    ? await readLocalImageReference(localPath)
    : /^https?:\/\//i.test(normalizedReference)
      ? await fetchRemoteImageReference(normalizedReference)
      : await readLocalImageReference(normalizedReference);

  return { inlineData: inlineImage };
}

async function buildImageParts(imageReferences = []) {
  const parts = [];
  for (const imageReference of imageReferences) {
    const imagePart = await buildGoogleNanoBananaImagePart(imageReference);
    if (imagePart) {
      parts.push(imagePart);
    }
  }
  return parts;
}

function extractImageBuffersFromResponse(payload) {
  const imageBuffers = [];
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    for (const part of parts) {
      const inlineData = part?.inlineData || part?.inline_data;
      const data = normalizeString(inlineData?.data);
      if (data) {
        imageBuffers.push(Buffer.from(data, 'base64'));
      }
    }
  }

  return imageBuffers;
}

function extractTextFromResponse(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  return candidates
    .flatMap((candidate) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .map((part) => normalizeString(part?.text))
    .filter(Boolean)
    .join('\n');
}

function isGoogleNanoBananaProviderInfrastructureError(error) {
  const message = normalizeString(error?.message).toLowerCase();
  if (!message) {
    return false;
  }

  return [
    'requires google_cloud_project',
    'requires google_project_id',
    'service account credentials',
    'google adc',
    'application default credentials',
    'access token',
    'permission_denied',
    'unauthenticated',
    'invalid_grant',
    'credentials',
    'quota',
    'billing',
    'resource_exhausted',
    'api has not been used',
    'api is disabled',
  ].some((pattern) => message.includes(pattern));
}

function markAsNonPromptProviderFailure(error) {
  error.nonPromptProviderFailure = true;
  error.preserveExpressImageLayer = true;
  return error;
}

async function callGoogleNanoBananaGenerateContent({
  model,
  prompt,
  aspectRatio,
  imageReferences = [],
  resolution,
}) {
  const config = getGoogleCloudConfig();
  const projectId = normalizeString(config.projectId);
  if (!projectId) {
    throw new Error('Google Nano Banana requires GOOGLE_CLOUD_PROJECT, GOOGLE_PROJECT_ID, or service account credentials containing project_id.');
  }

  const providerModel = resolveGoogleNanoBananaModel(model);
  const location = resolveGoogleImageLocation();
  const imageParts = await buildImageParts(imageReferences);
  const token = await getGoogleAccessToken(config);
  const requestBody = buildGoogleNanoBananaGenerateContentRequest({
    prompt,
    imageParts,
    aspectRatio,
    resolution,
  });

  const response = await fetch(buildVertexGenerateContentUrl({
    projectId,
    location,
    model: providerModel,
  }), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const responseText = await response.text();
  const payload = responseText ? JSON.parse(responseText) : {};
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Google Nano Banana failed with status ${response.status}`);
  }

  const imageBuffers = extractImageBuffersFromResponse(payload);
  if (!imageBuffers.length) {
    const textOutput = extractTextFromResponse(payload);
    throw new Error(textOutput || 'Google Nano Banana returned no image output.');
  }

  return imageBuffers;
}

export async function generateGoogleNanoBananaImages(request = {}) {
  const imageReferences = Array.isArray(request.imageReferences)
    ? request.imageReferences
    : getImageReferencesFromPayload(request);
  const normalizedPayload = normalizeGoogleNanoBananaRequestPayload(request);
  const totalCount = normalizedPayload.numImages;
  const buffers = [];

  while (buffers.length < totalCount) {
    const responseBuffers = await callGoogleNanoBananaGenerateContent({
      model: normalizedPayload.model,
      prompt: normalizedPayload.prompt,
      aspectRatio: normalizedPayload.aspectRatio,
      imageReferences,
      resolution: normalizedPayload.resolution,
    });
    buffers.push(...responseBuffers);
  }

  return buffers.slice(0, totalCount);
}

async function checkIfBlackImage(buffer) {
  const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels || 3;

  for (let i = 0; i < data.length; i += channels) {
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) {
      return false;
    }
  }

  return true;
}

export async function saveGoogleNanoBananaImageBuffer(buffer) {
  const pngBuffer = await sharp(buffer).png().toBuffer();
  const isBlackImage = await checkIfBlackImage(pngBuffer);
  if (isBlackImage) {
    throw new Error('Generated image is completely black.');
  }

  const randStr = Math.random().toString(36).substring(7);
  const imageName = `generation_${Date.now()}_${randStr}.png`;
  const savePath = getLocalGenerationPath(imageName);

  await mkdir(path.dirname(savePath), { recursive: true });
  await writeFile(savePath, pngBuffer);

  return imageName;
}

export function getGoogleNanoBananaLocalGenerationPath(imageName) {
  return getLocalGenerationPath(imageName);
}

export async function handleGoogleNanoBananaRequest(payload) {
  const { _id, model } = payload;
  const providerStatus = payload.apiGenerationStatus || 'INIT';

  if (providerStatus === 'FAILED') {
    return { image: null };
  }

  if (providerStatus !== 'INIT') {
    return null;
  }

  await getDBConnectionString();
  await ImageGeneration.findByIdAndUpdate(_id, { rowLocked: true });

  try {
    const normalizedPayload = normalizeGoogleNanoBananaRequestPayload(payload);
    const imageBuffers = await generateGoogleNanoBananaImages({
      model,
      prompt: normalizedPayload.prompt,
      aspectRatio: normalizedPayload.aspectRatio,
      resolution: normalizedPayload.resolution,
      numImages: 1,
    });

    const imageName = await saveGoogleNanoBananaImageBuffer(imageBuffers[0]);
    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        apiRequestId: `${GOOGLE_NATIVE_REQUEST_PREFIX}${Date.now()}`,
        apiGenerationStatus: 'COMPLETED',
        generationStatus: 'COMPLETED',
        rowLocked: false,
      }
    );

    return {
      image: imageName,
      provider: 'google-native-nanobanana',
    };
  } catch (error) {
    console.error('[GoogleNanoBananaNative] generation failed:', error);
    if (isGoogleNanoBananaProviderInfrastructureError(error)) {
      throw markAsNonPromptProviderFailure(error);
    }

    await ImageGeneration.findOneAndUpdate(
      { _id },
      {
        generationStatus: 'FAILED',
        apiGenerationStatus: 'FAILED',
        rowLocked: false,
        errorMessage: error?.message || 'Google Nano Banana generation failed',
      }
    );
    return { image: null };
  }
}
