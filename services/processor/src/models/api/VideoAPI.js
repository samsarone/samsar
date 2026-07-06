import { getDBConnectionString } from '../DBString.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import { createNewBlankQuickSession } from '../QuickSession.js';
import { upsertGlobalSessionMapping } from '../GlobalSession.js';
import VideoSession from '../../schema/VideoSession.js';

export async function requestImageListToVideo(userId, payload = {}, webhookUrl) {
  if (!userId) {
    throw new Error('userId is required.');
  }

  const {
    image_urls,
    metadata = {},
    prompt,
    duration,
  } = payload;

  if (
    !Array.isArray(image_urls) ||
    image_urls.length === 0 ||
    image_urls.some((url) => typeof url !== 'string' || url.trim() === '')
  ) {
    throw new Error('image_urls must be a non-empty array of strings.');
  }

  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new Error('prompt is required.');
  }

  const normalizedDuration = Number(duration);
  if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
    throw new Error('duration must be a positive number.');
  }

  const normalizedMetadata = isPlainObject(metadata) ? metadata : {};
  const creditCost = Math.ceil(75 * normalizedDuration);

  const creditResult = await deductGenerationCredits(userId, creditCost, {
    source: 'image_list_to_video',
    metadata: {
      duration: normalizedDuration,
      imageCount: image_urls.length,
      requestType: 'API',
    },
  });

  await getDBConnectionString();

  const sessionId = await createNewBlankQuickSession(userId);

  await VideoSession.findByIdAndUpdate(sessionId, {
    externalWebhook: webhookUrl,
    imageListToVideoRequest: {
      image_urls,
      metadata: normalizedMetadata,
      prompt: prompt.trim(),
      duration: normalizedDuration,
    },
  });

  await upsertGlobalSessionMapping({
    sessionId,
    sessionType: 'video',
    requestId: sessionId,
    provider: 'image_list_to_video',
    userId,
    metadata: normalizedMetadata,
    status: 'PENDING',
    requestType: 'API',
    sessionSubType: 'image_list_to_video',
  });

  return {
    request_id: sessionId,
    session_id: sessionId,
    creditsCharged: creditCost,
    remainingCredits: creditResult?.remainingCredits ?? null,
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
