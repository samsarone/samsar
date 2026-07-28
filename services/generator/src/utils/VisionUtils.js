/********************************************
 * Vision Utils
 ********************************************/
import { getDBConnectionString } from "../DBString.js";
import VideoSession from "../schema/VideoSession.js";
import { getAccessibleMediaUrlForProvider } from './MediaReferenceUtils.js';
import { getCurrentEnvironment } from './Environment.js';
import {
  DEFAULT_INFERENCE_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  KIMI_K3_INFERENCE_MODEL,
  QWEN_37_INFERENCE_MODEL,
  getDefaultUserInferenceModel,
  isGeminiInferenceModel,
  isKimiInferenceModel,
  isQwenInferenceModel,
} from '../inference/InferenceModels.js';
import { createCompatibleInferenceChatCompletion } from '../OpenAI.js';
import { withInferenceAuthorization } from '../inference/RequestInferenceModel.js';

const IMAGE_ACCESSIBILITY_TIMEOUT_MS = 2500;
const VISION_INFERENCE_MAX_RETRIES = normalizeNonNegativeInteger(
  process.env.VISION_INFERENCE_MAX_RETRIES,
  3,
);
const VISION_INFERENCE_RETRY_BASE_DELAY_MS = normalizePositiveInteger(
  process.env.VISION_INFERENCE_RETRY_BASE_DELAY_MS,
  5000,
);
const VISION_INFERENCE_RETRY_MAX_DELAY_MS = Math.max(
  VISION_INFERENCE_RETRY_BASE_DELAY_MS,
  normalizePositiveInteger(process.env.VISION_INFERENCE_RETRY_MAX_DELAY_MS, 60000),
);
const QWEN_VISION_DESCRIPTION_MAX_TOKENS = Math.min(
  normalizePositiveInteger(process.env.QWEN_VISION_DESCRIPTION_MAX_TOKENS, 8192),
  8192,
);
const QWEN_VISION_SCORE_MAX_TOKENS = Math.min(
  normalizePositiveInteger(process.env.QWEN_VISION_SCORE_MAX_TOKENS, 1024),
  1024,
);

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value || '');
}

async function isUrlReachable(url = '') {
  if (!isHttpUrl(url)) {
    return true;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_ACCESSIBILITY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }
    return response.ok;
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveVisionImageUrl(remoteImageUrl = '') {
  const imageUrl = normalizeString(remoteImageUrl);
  if (!imageUrl || imageUrl.startsWith('data:')) {
    return imageUrl;
  }

  if (getCurrentEnvironment() !== 'docker') {
    return imageUrl;
  }

  if (await isUrlReachable(imageUrl)) {
    return imageUrl;
  }

  const error = new Error(
    'The Docker vision image URL became unreachable before provider dispatch; the request will be retried.',
  );
  error.name = 'SamsarMediaTunnelError';
  error.code = 'SAMSAR_MEDIA_TUNNEL_UNREACHABLE';
  error.retryable = true;
  error.imageUrl = imageUrl;
  throw error;
}

function resolveVisionInferenceModel(userInferenceModel = getDefaultUserInferenceModel()) {
  if (isQwenInferenceModel(userInferenceModel)) {
    return QWEN_37_INFERENCE_MODEL;
  }
  if (isKimiInferenceModel(userInferenceModel)) {
    return KIMI_K3_INFERENCE_MODEL;
  }
  return isGeminiInferenceModel(userInferenceModel)
    ? GEMINI_31_PRO_INFERENCE_MODEL
    : DEFAULT_INFERENCE_MODEL;
}

function getQwenVisionMaxTokens(inferenceModel, operation) {
  if (!isQwenInferenceModel(inferenceModel)) {
    return undefined;
  }
  return operation === 'score'
    ? QWEN_VISION_SCORE_MAX_TOKENS
    : QWEN_VISION_DESCRIPTION_MAX_TOKENS;
}

function getErrorMessage(error) {
  if (error?.message) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getVisionInferenceErrorStatus(error) {
  const visited = new Set();
  let current = error;
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const status = Number(
      current.status ??
      current.statusCode ??
      current.response?.status ??
      current.error?.status,
    );
    if (Number.isInteger(status) && status > 0) {
      return status;
    }
    current = current.cause;
  }
  return null;
}

function isRetryableVisionInferenceError(error) {
  const status = getVisionInferenceErrorStatus(error);
  if (status !== null) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  const code = normalizeString(error?.code || error?.cause?.code).toUpperCase();
  if (['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENETUNREACH'].includes(code)) {
    return true;
  }

  // Provider adapters do not always preserve a status/code. These calls contain
  // only the provider request, so an unknown adapter error is safe to retry.
  return true;
}

function getVisionInferenceRetryDelayMs(retryNumber) {
  const retryIndex = Math.max(0, normalizeNonNegativeInteger(retryNumber, 1) - 1);
  return Math.min(
    VISION_INFERENCE_RETRY_MAX_DELAY_MS,
    VISION_INFERENCE_RETRY_BASE_DELAY_MS * (2 ** retryIndex),
  );
}

export async function runVisionInferenceWithRetry(operation, {
  operationName = 'vision inference',
  model = null,
  imageReference = '',
  maxRetries = VISION_INFERENCE_MAX_RETRIES,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  logger = console,
  finalErrorFactory = (error) => markVisionProviderError(error),
} = {}) {
  const retryLimit = normalizeNonNegativeInteger(maxRetries, VISION_INFERENCE_MAX_RETRIES);
  const maxAttempts = retryLimit + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation({ attempt, maxAttempts });
    } catch (error) {
      const retryable = isRetryableVisionInferenceError(error);
      const willRetry = retryable && attempt < maxAttempts;
      const logContext = {
        attempt,
        maxAttempts,
        model,
        status: getVisionInferenceErrorStatus(error),
        imageReference: summarizeImageReferenceForLog(imageReference),
        error: getErrorMessage(error),
        willRetry,
      };
      logger.error(`[vision_scoring] ${operationName} request failed`, logContext);

      if (!willRetry) {
        throw finalErrorFactory(error, attempt, maxAttempts);
      }

      const retryNumber = attempt;
      const delayMs = getVisionInferenceRetryDelayMs(retryNumber);
      logger.warn(`[vision_scoring] ${operationName} retry scheduled`, {
        ...logContext,
        retryNumber,
        delayMs,
      });
      await sleep(delayMs);
    }
  }

  throw buildVisionProviderError(`${operationName} failed without a response.`);
}

function markVisionProviderError(error) {
  if (error && typeof error === 'object') {
    error.nonPromptProviderFailure = true;
    error.preserveExpressImageLayer = true;
  }
  return error;
}

function buildVisionProviderError(message, cause) {
  const error = new Error(message);
  error.cause = cause;
  return markVisionProviderError(error);
}

function summarizeImageReferenceForLog(value = '') {
  if (typeof value !== 'string') {
    return '';
  }
  if (value.startsWith('data:')) {
    const mimeType = value.slice(5, value.indexOf(';base64,'));
    return `data:${mimeType || 'unknown'};base64,<${value.length} chars>`;
  }
  return value.length > 220 ? `${value.slice(0, 220)}...` : value;
}

export async function addVisionDescriptionsForLayerImage(
  sessionId,
  layerId,
  remoteImageUrl,
  videoMode = 'cinematic',
  userInferenceModel = getDefaultUserInferenceModel(),
  requestedAspectRatio = '',
  imageThemeContext = '',
  inferenceAuthorization,
) {
  await getDBConnectionString();

  // We will no longer fetch the session to store the data here
  // This function just returns the generated description

  // Actually retrieve the description
  const responseData = await getDescriptionForImage(
    remoteImageUrl,
    videoMode,
    userInferenceModel,
    requestedAspectRatio,
    imageThemeContext,
    inferenceAuthorization,
  );

  // Return it to the caller but do NOT store in DB
  return responseData;
}

async function getDescriptionForImage(
  activeImageRemoteLink,
  videoMode = 'cinematic',
  userInferenceModel = getDefaultUserInferenceModel(),
  requestedAspectRatio = '',
  imageThemeContext = '',
  inferenceAuthorization,
) {
  const inferenceModel = resolveVisionInferenceModel(userInferenceModel);

  const aspectRatioText = requestedAspectRatio
    ? `Requested aspect ratio/orientation: ${requestedAspectRatio}.`
    : `Requested aspect ratio/orientation: not provided.`;
  const themeContextText = imageThemeContext
    ? `Expected visual theme/style context:\n${imageThemeContext}`
    : '';
  const orientationAuditText =
`First check the content's natural up direction. If a 90-degree rotation makes the subject, environment, text, or diagrams read more upright, flag whole-image or content-level sideways rotation.
For technical images, flag garbled or unreadable labels, equations, axes, charts, and UI text.
Flag detached limbs or body parts unless context-justified.`
  const visionSystemBasePrompt = videoMode === 'grounded'
    ? `You are analyzing a single generative frame image so downstream scoring can verify prompt adherence, physical realism, and factual/contextual accuracy.`
    : `You are analyzing a single generative frame image so downstream scoring can verify prompt adherence and visual quality.`;
  const visionSystemPrompt = `${visionSystemBasePrompt}\n${aspectRatioText}\n${themeContextText}\n${orientationAuditText}`;

  let userPrompt =
`Describe the image and all the artifacts in the image in detail.
Describe the visual medium/style, such as anime/cel-shaded illustration, photorealistic photo, CGI, black-and-white, or other obvious theme/style.
Describe the scene and the objects in the scene including the theme, cinematography and the lighting.
Thoroughly describe any actors in the image, including their identity, gender, appearance, clothing, actions and position relative to the camera.
Describe any imperfections in the image, such as incorrect anatomy, extra hands/fingers, improper physics, out-of-place characters or objects, rotated/sideways/upside-down output, content turned 90 degrees relative to the requested aspect ratio/orientation, clipped output, or other visual issues.
If expected visual theme/style context is provided, state whether the image matches it or instead appears to use a different visual medium/style.
Begin with a brief orientation audit sentence that states if the image content is upright, rotated, sideways, upside down, or appears like a landscape scene turned into a portrait canvas.
For technical images, explicitly mention rotated labels/text and garbled or unreadable labels, equations, charts, axes, or UI text.
Provide an information-dense, condensed and thorough description in 3000 characters or less without any line breaks or special formatting..`;



  if (videoMode === 'grounded') {
    userPrompt = `
    Describe the image and all the artifacts in the image in detail.
    Describe the visual medium/style, such as anime/cel-shaded illustration, photorealistic photo, CGI, black-and-white, or other obvious theme/style.
    Describe the scene and the objects in the scene including any text, illustrations, diagrams as well as general theme of the image.
    Thoroughly describe what context the image describes and any actors in the image, including their identity, gender, appearance, clothing, actions and position relative to the camera.
    Describe any imperfections in the image, such as incorrect anatomy, extra hands/fingers, improper physics, out-of-place characters or objects, rotated/sideways/upside-down output, content turned 90 degrees relative to the requested aspect ratio/orientation, or other visual issues.
    Describe any out-of-place objects such as extra hands, extra fingers, live fish swimming outside water etc.
    Describe gender and clothing of characters including if there is partial nudity.
    Check if the image fully covers the canvas. Note any black borders, letterboxing, empty space, rotated/sideways/upside-down output, content turned 90 degrees relative to the requested aspect ratio/orientation, or clipping where it fails to extend edge-to-edge.
    If expected visual theme/style context is provided, state whether the image matches it or instead appears to use a different visual medium/style.
    Begin with a brief orientation audit sentence that states if the image content is upright, rotated, sideways, upside down, or appears like a landscape scene turned into a portrait canvas.
    For technical images, explicitly mention rotated labels/text and garbled or unreadable labels, equations, charts, axes, or UI text.
    Provide an information-dense, condensed and thorough description in 3000 characters or less without any line breaks or special formatting.`;
  }

  const buildActivePayload = (providerImageUrl) => ({
      model: inferenceModel,
      ...(isQwenInferenceModel(inferenceModel)
        ? { max_tokens: getQwenVisionMaxTokens(inferenceModel, 'description') }
        : {}),
      ...(!isGeminiInferenceModel(inferenceModel) && !isQwenInferenceModel(inferenceModel)
        ? { reasoning_effort: GPT_56_SOL_REASONING_EFFORT }
        : {}),
      messages: [
        {
          role: "developer",
          content: visionSystemPrompt,
        },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt },
            {
              type: "image_url",
              image_url: {
                url: providerImageUrl,
              },
            },
          ],
        },
      ],
    });

  const response = await runVisionInferenceWithRetry(
    async () => {
      const accessibleUrl = await getAccessibleMediaUrlForProvider(activeImageRemoteLink, {
        preferDataUrl: false,
        preferInternalDockerUrl: false,
        mediaKind: 'image',
      });
      const providerImageUrl = await resolveVisionImageUrl(accessibleUrl);
      const activePayload = {
        ...buildActivePayload(providerImageUrl),
        externalMaxRetries: 0,
        maxRetries: 0,
      };
      const routingPayload = withInferenceAuthorization(activePayload, inferenceAuthorization);
      return createCompatibleInferenceChatCompletion(routingPayload);
    },
    {
      operationName: 'image description',
      model: inferenceModel,
      imageReference: activeImageRemoteLink,
      finalErrorFactory: (error, attempt) => buildVisionProviderError(
        `Vision image description failed after ${attempt} attempts: ${getErrorMessage(error)}`,
        error,
      ),
    },
  );

  return response.choices[0].message.content;
}









export async function assignScoreForTheImage(
  imagePrompt,
  imageDescription,
  videoMode = 'cinematic',
  userInferenceModel = getDefaultUserInferenceModel(),
  requestedAspectRatio = '',
  imageThemeContext = '',
  imageThemeStyle = '',
  inferenceAuthorization,
) {

  const aspectRatioText = requestedAspectRatio || '';
  const themeStyleText = typeof imageThemeStyle === 'string'
    ? imageThemeStyle.trim()
    : (imageThemeStyle ? JSON.stringify(imageThemeStyle) : '');
  const themeContextSection = [
    imageThemeContext
      ? `Expected visual scene context for this scoring request:\n${imageThemeContext}\n`
      : '',
    themeStyleText
      ? `Theme:\n${themeStyleText}\n`
      : '',
  ].join('');
  const scoringSourceText = imageThemeContext || themeStyleText
    ? 'Use the input prompt, expected visual scene context, and Theme as the source of truth and the image description as the evidence.'
    : 'Use the input prompt as the source of truth and the image description as the evidence.';

  const sceneTypeLabel = videoMode === 'grounded' ? 'grounded express-video scene' : 'express-video scene';
  const groundedInstruction = videoMode === 'grounded'
    ? `For grounded scenes, evaluate factual, scientific, technical, contextual, and physical realism more strictly than cinematic style alone.
`
    : '';
  const groundedDeductionRules = videoMode === 'grounded'
    ? `- Minors are depicted prominently.
- The image has exact resemblance to real individuals or copyrighted characters.
`
    : '';
  const contextDetails = videoMode === 'grounded'
    ? 'required historical, contextual, scientific, or technical details'
    : 'required contextual details';
  const importantDetails = videoMode === 'grounded'
    ? 'composition, diagrams, illustrations, labels, or important scene details are missing, incorrect, added, irrelevant, or not recognizable'
    : 'composition, or important scene details are missing, incorrect, added, or not recognizable';
  const characterDefects = videoMode === 'grounded'
    ? 'Human characters have biologically implausible anatomy, extra or missing hands/fingers/limbs, partial bodies, distorted faces, or other visible defects'
    : 'Characters or central objects have visible defects such as incorrect anatomy, extra or missing limbs/fingers, partial bodies, distorted faces, malformed objects, or broken rendering';

  const systemPrompt =
`You are an image-scoring assistant. Score whether the generated image is appropriate as the frame layer image for the current ${sceneTypeLabel}.
${themeContextSection}${scoringSourceText} Start from 100 and deduct points in proportion to issue severity. Do not add points.
${groundedInstruction}

Deduct points when:
- The scene theme, setting, style, cinematography, lighting, or ${contextDetails} do not match the prompt.
- Required subjects, actions, objects, relationships, ${importantDetails}.
- Prompt-specified character attributes such as gender, race, ethnicity, age, identity, clothing, appearance, pose, or role do not match the image.
- ${characterDefects}.
- Objects, creatures, or characters are unnaturally placed, physically inconsistent, incorrectly interacting with the environment, or contextually wrong for the scene.
- Text visible in the image has spelling, grammar, content, or placement errors relative to the prompt.
- For technical or diagram images, labels, equations, charts, axes, or UI text are rotated, garbled, unreadable, or incorrectly oriented relative to the image.
${groundedDeductionRules}- The image contains partial nudity or NSFW content.
- The central subject is spatially misaligned, imbalanced, or unnaturally positioned relative to the scene.
- Heavily penalize contextless detached hands or body parts.
- The image visual medium/style/theme does not match the requested prompt, expected visual scene context, or Theme. Apply a severe deduction when the description says or clearly implies a different medium/style or conflicts with the provided Theme; for example, if anime, animated, cel-shaded, manga, cartoon, or illustrated style is requested but the description says photorealistic, photographic, live-action, real-world photo, or not anime/cel-shaded, return a score from 0 to 10.
- If description style conflicts with Theme, score near zero.
- The image does not visually cover the canvas because of black borders, empty margins, or letterboxing.
- The image description says or clearly implies the visual content is rotated, sideways, upside down, turned 90 degrees, or only upright after rotating the image. Apply a severe deduction for this issue and return a score from 0 to 5.
Return only a single integer between 0 and 100.`;

  const messages = [
    {
      role: "developer",
      content: systemPrompt,
    },
    {
      role: "user",
      content: `${aspectRatioText ? `Requested Aspect Ratio/Orientation:\n${aspectRatioText}\n\n` : ''}Input Prompt:\n${imagePrompt}\n\nImage Description:\n${imageDescription}`,
    },
  ];

  const inferenceModel = resolveVisionInferenceModel(userInferenceModel);
  const inferencePayload = {
    model: inferenceModel,
    externalMaxRetries: 0,
    maxRetries: 0,
    ...(isQwenInferenceModel(inferenceModel)
      ? { max_tokens: getQwenVisionMaxTokens(inferenceModel, 'score') }
      : {}),
    ...(!isGeminiInferenceModel(inferenceModel) && !isQwenInferenceModel(inferenceModel)
      ? { reasoning_effort: GPT_56_SOL_REASONING_EFFORT }
      : {}),
    messages,
  };
  const routingPayload = withInferenceAuthorization(inferencePayload, inferenceAuthorization);
  const response = await runVisionInferenceWithRetry(
    () => createCompatibleInferenceChatCompletion(routingPayload),
    {
      operationName: 'image score',
      model: inferencePayload.model,
    },
  );



  const responsePayload = response.choices[0].message.content;

  return responsePayload;
}

export const __testOnly__ = {
  getDescriptionForImage,
  getVisionInferenceErrorStatus,
  getVisionInferenceRetryDelayMs,
  getQwenVisionMaxTokens,
  isRetryableVisionInferenceError,
  resolveVisionInferenceModel,
};
