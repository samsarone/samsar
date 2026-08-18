import { Agent, fetch as undiciFetch } from 'undici';

import { getDBConnectionString } from '../DBString.js';
import ImageGeneration from '../schema/ImageGeneration.js';
import { isStandaloneEdition } from '../utils/Environment.js';
import { saveRemoteFile } from '../utils/FileUtils.js';
import { isSubmissionOutcomeUnknown } from '../utils/ProviderSubmissionSafety.js';
import {
  isAlibabaImageInfrastructureError,
  requestAlibabaImageGeneration,
} from './AlibabaCloudImage.js';
import { buildAlibabaQwenImage3Request } from './QwenImage3Payload.js';

export const MIN_ALIBABA_QWEN_IMAGE_3_TIMEOUT_MS = 6 * 60 * 1000;

let alibabaQwenImage3Dispatcher;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getAlibabaQwenImage3TimeoutMs(options = {}) {
  const env = options.env || process.env;
  const configuredTimeoutMs = Number(
    options.timeoutMs ??
      env?.ALIBABA_QWEN_IMAGE_3_PRO_TIMEOUT_MS ??
      env?.ALIBABA_IMAGE_GENERATION_TIMEOUT_MS,
  );
  return Math.max(
    MIN_ALIBABA_QWEN_IMAGE_3_TIMEOUT_MS,
    Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
      ? configuredTimeoutMs
      : MIN_ALIBABA_QWEN_IMAGE_3_TIMEOUT_MS,
  );
}

export function getAlibabaQwenImage3Dispatcher() {
  if (!alibabaQwenImage3Dispatcher) {
    // Node's default fetch transport stops waiting for response headers after
    // five minutes. Qwen Image 3.0 Pro is synchronous, so let the model-specific
    // AbortController own the complete six-minute request deadline instead.
    alibabaQwenImage3Dispatcher = new Agent({
      headersTimeout: 0,
      bodyTimeout: 0,
    });
  }
  return alibabaQwenImage3Dispatcher;
}

function markAsNonPromptProviderFailure(error) {
  error.nonPromptProviderFailure = true;
  error.preserveExpressImageLayer = true;
  return error;
}

function normalizeError(error, fallbackMessage) {
  return error && typeof error === 'object'
    ? error
    : new Error(normalizeString(error) || fallbackMessage);
}

function markAsUnsafeToResubmit(error) {
  error.submissionOutcomeUnknown = true;
  return markAsNonPromptProviderFailure(error);
}

function isAmbiguousAlibabaQwenSubmissionError(error) {
  if (error?.providerSubmissionAttempted === false) {
    return false;
  }

  const status = Number(error?.status ?? error?.statusCode ?? error?.response?.status);
  // A successful HTTP response that cannot be decoded or does not contain its
  // generated image is also unsafe to repeat: Alibaba may already have billed it.
  if (Number.isInteger(status) && status >= 200 && status < 300) {
    return true;
  }

  return isSubmissionOutcomeUnknown(error);
}

export async function requestAlibabaQwenImage3(payload = {}, options = {}) {
  return requestAlibabaImageGeneration(buildAlibabaQwenImage3Request(payload), {
    ...options,
    providerName: 'Alibaba Qwen Image 3.0 Pro',
    timeoutMs: getAlibabaQwenImage3TimeoutMs(options),
    fetchImpl: options.fetchImpl || undiciFetch,
    dispatcher: options.dispatcher || getAlibabaQwenImage3Dispatcher(),
  });
}

export async function handleAlibabaQwenImage3Request(payload = {}, dependencies = {}) {
  const { _id } = payload;
  const providerStatus = normalizeString(payload.apiGenerationStatus || 'INIT').toUpperCase();
  if (providerStatus === 'FAILED') {
    return { image: null };
  }
  if (providerStatus !== 'INIT') {
    return null;
  }

  const isStandalone = dependencies.isStandalone || isStandaloneEdition;
  if (!isStandalone()) {
    return {
      image: null,
      error: 'Qwen Image 3.0 Pro with Alibaba Cloud is available only in standalone deployments.',
    };
  }

  const connect = dependencies.connect || getDBConnectionString;
  const imageGenerationModel = dependencies.imageGenerationModel || ImageGeneration;
  const requestImage = dependencies.requestImage || requestAlibabaQwenImage3;
  const saveFile = dependencies.saveFile || saveRemoteFile;
  const submittedAt = new Date();
  let providerRequestId = '';
  let providerResultUrl = '';
  let providerSubmissionAccepted = false;

  await connect();
  await imageGenerationModel.findByIdAndUpdate(_id, { rowLocked: true });

  try {
    const result = await requestImage(payload);
    providerSubmissionAccepted = true;
    providerRequestId = normalizeString(result?.requestId) ||
      `alibaba-qwen-image-3:${Date.now()}`;
    providerResultUrl = normalizeString(result?.imageUrl);
    if (!providerResultUrl) {
      const missingResultError = new Error(
        'Alibaba Qwen Image 3.0 Pro returned no image URL.',
      );
      missingResultError.providerSubmissionAttempted = true;
      missingResultError.providerResponseReceived = true;
      missingResultError.status = 200;
      throw missingResultError;
    }

    // Persist the accepted provider result before downloading it. The shared
    // safety flag acts as a fail-closed latch until local persistence succeeds,
    // so a crash or download failure cannot create a second billed generation.
    await imageGenerationModel.findOneAndUpdate(
      { _id },
      {
        apiRequestId: providerRequestId,
        apiGenerationStatus: 'PENDING',
        apiSubmittedAt: submittedAt,
        externalProvider: 'alibabaCloud',
        providerResultUrl,
        providerSubmissionAccepted: true,
        submissionOutcomeUnknown: true,
        rowLocked: true,
      },
    );

    const imageName = await saveFile(providerResultUrl);

    await imageGenerationModel.findOneAndUpdate(
      { _id },
      {
        apiRequestId: providerRequestId,
        apiGenerationStatus: 'COMPLETED',
        generationStatus: 'COMPLETED',
        externalProvider: 'alibabaCloud',
        providerResultUrl,
        providerSubmissionAccepted: true,
        submissionOutcomeUnknown: false,
        rowLocked: false,
      },
    );

    return {
      image: imageName,
      provider: 'alibabaCloud',
      providerRequestId,
    };
  } catch (caughtError) {
    const error = normalizeError(
      caughtError,
      'Alibaba Qwen Image 3.0 Pro generation failed.',
    );
    const message = error.message;
    const ambiguousSubmission = !providerSubmissionAccepted &&
      isAmbiguousAlibabaQwenSubmissionError(error);
    const preventResubmission = providerSubmissionAccepted || ambiguousSubmission;
    const errorProviderRequestId = providerRequestId ||
      normalizeString(error?.providerRequestId);
    if (preventResubmission) {
      markAsUnsafeToResubmit(error);
    }

    try {
      await imageGenerationModel.findOneAndUpdate(
        { _id },
        {
          generationStatus: 'FAILED',
          apiGenerationStatus: 'FAILED',
          generationError: message,
          ...(errorProviderRequestId ? { apiRequestId: errorProviderRequestId } : {}),
          ...(providerResultUrl ? { providerResultUrl } : {}),
          providerSubmissionAccepted,
          submissionOutcomeUnknown: preventResubmission,
          externalProvider: 'alibabaCloud',
          rowLocked: false,
        },
      );
    } catch (persistenceFailure) {
      const persistenceError = normalizeError(
        persistenceFailure,
        'Unable to persist Alibaba Qwen Image 3.0 Pro failure state.',
      );
      if (preventResubmission) {
        markAsUnsafeToResubmit(persistenceError);
      }
      persistenceError.cause ||= error;
      throw persistenceError;
    }

    if (preventResubmission) {
      throw error;
    }
    if (isAlibabaImageInfrastructureError(error)) {
      throw markAsNonPromptProviderFailure(error);
    }
    return { image: null, error: message };
  }
}
