/********************************************
 * Vision Utils
 ********************************************/
import { getDBConnectionString } from "../DBString.js";
import VideoSession from "../schema/VideoSession.js";
import OpenAI from "openai";
import { getAccessibleMediaUrlForProvider } from './MediaReferenceUtils.js';
import { getCurrentEnvironment } from './Environment.js';
import {
  DEFAULT_INFERENCE_MODEL,
  GEMINI_31_PRO_INFERENCE_MODEL,
  GPT_56_SOL_REASONING_EFFORT,
  QWEN_37_INFERENCE_MODEL,
  getDefaultUserInferenceModel,
  isGeminiInferenceModel,
  isQwenInferenceModel,
} from '../inference/InferenceModels.js';
import { createGoogleGeminiChatCompletion } from '../inference/GoogleGemini.js';
import { createQwenChatCompletion } from '../inference/Qwen.js';
import {
  createSamsarExternalChatCompletion,
  shouldUseSamsarExternalInference,
} from '../inference/SamsarExternalInferenceAdapter.js';
import { withInferenceAuthorization } from '../inference/RequestInferenceModel.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const IMAGE_ACCESSIBILITY_TIMEOUT_MS = 2500;

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value || '');
}

function parsePathAndSuffix(reference = '') {
  const normalized = normalizeString(reference);
  if (!normalized) {
    return { path: '', suffix: '' };
  }

  try {
    const parsedUrl = new URL(normalized);
    return {
      path: parsedUrl.pathname || '',
      suffix: `${parsedUrl.search || ''}${parsedUrl.hash || ''}`,
    };
  } catch {
    const hashIndex = normalized.indexOf('#');
    const queryIndex = normalized.indexOf('?');
    const splitIndex = Math.min(
      hashIndex >= 0 ? hashIndex : Infinity,
      queryIndex >= 0 ? queryIndex : Infinity,
    );

    if (splitIndex === Infinity) {
      return { path: normalized, suffix: '' };
    }
    return {
      path: normalized.slice(0, splitIndex),
      suffix: normalized.slice(splitIndex),
    };
  }
}

function buildTunnelizedMediaUrl(reference = '') {
  const mediaPublicBase = normalizeString(process.env.MEDIA_PUBLIC_URL);
  if (!mediaPublicBase) {
    return '';
  }

  const { path, suffix } = parsePathAndSuffix(reference);
  if (!path) {
    return mediaPublicBase;
  }

  const normalizedBase = mediaPublicBase.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${normalizedBase}/${normalizedPath}${suffix}`;
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

  const tunnelUrlForNonHttp = buildTunnelizedMediaUrl(imageUrl);
  if (!isHttpUrl(imageUrl) && tunnelUrlForNonHttp) {
    if (await isUrlReachable(tunnelUrlForNonHttp)) {
      return tunnelUrlForNonHttp;
    }
    return imageUrl;
  }

  if (await isUrlReachable(imageUrl)) {
    return imageUrl;
  }

  const tunnelUrl = tunnelUrlForNonHttp;
  if (!tunnelUrl || tunnelUrl === imageUrl) {
    return imageUrl;
  }

  if (await isUrlReachable(tunnelUrl)) {
    console.warn('[vision_scoring] Falling back to tunnelized image URL for visibility check', {
      originalUrl: imageUrl,
      tunnelUrl,
    });
    return tunnelUrl;
  }

  return imageUrl;
}

function resolveVisionInferenceModel(userInferenceModel = getDefaultUserInferenceModel()) {
  if (isQwenInferenceModel(userInferenceModel)) {
    return QWEN_37_INFERENCE_MODEL;
  }
  return isGeminiInferenceModel(userInferenceModel)
    ? GEMINI_31_PRO_INFERENCE_MODEL
    : DEFAULT_INFERENCE_MODEL;
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

  const accessibleUrl = await getAccessibleMediaUrlForProvider(remoteImageUrl, {
    preferDataUrl: getCurrentEnvironment() === 'docker',
    preferInternalDockerUrl: true,
  });
  const remoteUrl = await resolveVisionImageUrl(accessibleUrl);

  // Actually retrieve the description
  const responseData = await getDescriptionForImage(
    remoteUrl,
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
  let attempts = 0;
  const maxRetries = 2;
  let backoff = 1000;
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

  const activePayload = {
    model: inferenceModel,
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
              url: activeImageRemoteLink,
            },
          },
        ],
      },
    ],
  };
  const routingPayload = withInferenceAuthorization(activePayload, inferenceAuthorization);

  while (attempts <= maxRetries) {
    try {

      const response = shouldUseSamsarExternalInference(routingPayload)
        ? await createSamsarExternalChatCompletion(routingPayload)
        : isQwenInferenceModel(inferenceModel)
          ? await createQwenChatCompletion(routingPayload)
          : isGeminiInferenceModel(inferenceModel)
            ? await createGoogleGeminiChatCompletion(activePayload.messages, inferenceModel)
            : await openai.chat.completions.create(activePayload);
      const responsePayload = response.choices[0].message.content;

      return responsePayload;
    } catch (error) {
      attempts++;
      const errorMessage = getErrorMessage(error);
      console.error('[vision_scoring] image description request failed', {
        attempt: attempts,
        maxAttempts: maxRetries + 1,
        model: activePayload.model,
        imageReference: summarizeImageReferenceForLog(activeImageRemoteLink),
        error: errorMessage,
      });
      if (attempts > maxRetries) {
        throw buildVisionProviderError(
          `Vision image description failed after ${attempts} attempts: ${errorMessage}`,
          error,
        );
      }
      await new Promise(resolve => setTimeout(resolve, backoff));
      backoff *= 2; // Exponential backoff
    }
  }
  throw buildVisionProviderError('Vision image description failed without a response.');
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
    ...(!isGeminiInferenceModel(inferenceModel) && !isQwenInferenceModel(inferenceModel)
      ? { reasoning_effort: GPT_56_SOL_REASONING_EFFORT }
      : {}),
    messages,
  };
  const routingPayload = withInferenceAuthorization(inferencePayload, inferenceAuthorization);
  let response;
  try {
    response = shouldUseSamsarExternalInference(routingPayload)
      ? await createSamsarExternalChatCompletion(routingPayload)
      : isQwenInferenceModel(inferenceModel)
        ? await createQwenChatCompletion(routingPayload)
        : isGeminiInferenceModel(inferenceModel)
          ? await createGoogleGeminiChatCompletion(messages, inferenceModel)
          : await openai.chat.completions.create(inferencePayload);
  } catch (error) {
    console.error('[vision_scoring] image score request failed', {
      model: inferencePayload.model,
      error: getErrorMessage(error),
    });
    throw markVisionProviderError(error);
  }



  const responsePayload = response.choices[0].message.content;

  return responsePayload;
}
