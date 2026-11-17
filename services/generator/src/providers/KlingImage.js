import { fal } from '@fal-ai/client';
import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import { resizeAndSaveRemoteFile, saveRemoteFile } from '../utils/FileUtils.js';
import { isSubmissionOutcomeUnknown } from '../utils/ProviderSubmissionSafety.js';
import { buildKlingImageInput, getKlingImageOutputDimensions, KLING_IMAGE_APP_RESOLUTION, KLING_IMAGE_FAL_ENDPOINT } from '../consts/KlingImageModel.js';

fal.config({ credentials: process.env.FAL_API_KEY });

function providerMessage(value, depth = 0) {
  if (value == null || depth > 6) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(entry => providerMessage(entry, depth + 1)).filter(Boolean).join('; ');
  if (typeof value !== 'object') return '';
  for (const key of ['detail', 'msg', 'message', 'error', 'body']) {
    const message = providerMessage(value[key], depth + 1);
    if (message) return message;
  }
  return '';
}

function failureDetails(error) {
  const visited = new Set();
  let current = error, status = null, message = '';
  while (current && typeof current === 'object' && !visited.has(current)) {
    visited.add(current);
    const candidate = Number(current.status ?? current.statusCode ?? current.response?.status);
    if (status === null && Number.isInteger(candidate) && candidate > 0) status = candidate;
    message ||= providerMessage(current.body) || providerMessage(current.response?.data);
    current = current.cause;
  }
  return { status, message: message || providerMessage(error) || 'Unknown provider error' };
}

function acceptedPollError(error, phase) {
  return Object.assign(error instanceof Error ? error : new Error(failureDetails(error).message, { cause: error }), {
    nonPromptProviderFailure: true,
    preserveExpressImageLayer: true,
    providerPollFailure: true,
    providerPollPhase: phase,
  });
}

export async function handleKlingImageRequest(payload, dependencies = {}) {
  const status = String(payload.apiGenerationStatus || 'INIT').toUpperCase();
  if (status === 'INIT') return (dependencies.submitRequest || submitKlingImageRequest)(payload, dependencies);
  if (status === 'PENDING') return (dependencies.pollRequest || pollKlingImageRequest)(payload, dependencies);
  return status === 'FAILED' ? { image: null } : null;
}

export async function submitKlingImageRequest(payload, dependencies = {}) {
  const connect = dependencies.connect || getDBConnectionString;
  const Model = dependencies.imageGenerationModel || ImageGeneration;
  const submit = dependencies.queueSubmit || ((...args) => fal.queue.submit(...args));
  const logger = dependencies.logger || console;
  await connect();
  await Model.findByIdAndUpdate(payload._id, { rowLocked: true });
  try {
    const response = await submit(KLING_IMAGE_FAL_ENDPOINT, { input: buildKlingImageInput(payload) });
    const requestId = response?.request_id;
    if (typeof requestId !== 'string' || !requestId.trim()) {
      throw new Error('Kling Image 4 submission returned no request ID.');
    }
    await Model.findOneAndUpdate({ _id: payload._id }, {
      apiRequestId: requestId,
      apiGenerationStatus: 'PENDING',
      apiSubmittedAt: new Date(),
      submittedAdapter: 'fal',
      rowLocked: false,
    });
    return null;
  } catch (error) {
    logger.error('[KlingImage] Fal submission failed:', error);
    const details = failureDetails(error);
    // The shared dispatcher owns retries and submission uncertainty. Never
    // turn a lost acceptance receipt into a second paid provider submission.
    return {
      image: null,
      error: `Kling Image 4 submission failed: ${details.message}`,
      ...(details.status ? { status: details.status } : {}),
      ...(isSubmissionOutcomeUnknown(error) ? { submissionOutcomeUnknown: true } : {}),
    };
  }
}

export async function pollKlingImageRequest(payload, dependencies = {}) {
  const connect = dependencies.connect || getDBConnectionString;
  const Model = dependencies.imageGenerationModel || ImageGeneration;
  const status = dependencies.queueStatus || ((...args) => fal.queue.status(...args));
  const result = dependencies.queueResult || ((...args) => fal.queue.result(...args));
  const saveFile = dependencies.saveFile || saveRemoteFile;
  const resizeAndSaveFile = dependencies.resizeAndSaveFile || resizeAndSaveRemoteFile;
  await connect();
  await Model.findOneAndUpdate({ _id: payload._id }, { rowLocked: true });

  let state;
  try {
    state = await status(KLING_IMAGE_FAL_ENDPOINT, { requestId: payload.apiRequestId, logs: true });
  } catch (error) {
    throw acceptedPollError(error, 'status');
  }
  if (state.status === 'FAILED') {
    return {
      image: null,
      error: providerMessage(state.error) || providerMessage(state.logs?.findLast?.(entry => entry?.message)) || 'Kling Image 4 provider request failed.',
      definitiveAdapterFailure: true,
    };
  }
  if (state.status !== 'COMPLETED') {
    await Model.findOneAndUpdate({ _id: payload._id }, { rowLocked: false });
    return null;
  }

  let output;
  try {
    output = await result(KLING_IMAGE_FAL_ENDPOINT, { requestId: payload.apiRequestId });
  } catch (error) {
    const details = failureDetails(error);
    if ([400, 422].includes(details.status)) {
      return { image: null, error: `Kling Image 4 result failed (${details.status}): ${details.message}`,
        status: details.status, definitiveAdapterFailure: true };
    }
    throw acceptedPollError(error, 'result');
  }
  const imageUrl = (output.data?.images || output.images)?.[0]?.url;
  if (!imageUrl) throw acceptedPollError(new Error('Kling Image 4 result did not include an image URL.'), 'result');
  try {
    const dimensions = getKlingImageOutputDimensions(payload);
    if (dimensions) {
      return { image: await resizeAndSaveFile(imageUrl, dimensions), ...dimensions,
        resolution: KLING_IMAGE_APP_RESOLUTION };
    }
    return { image: await saveFile(imageUrl) };
  } catch (error) {
    throw acceptedPollError(error, 'download');
  }
}
