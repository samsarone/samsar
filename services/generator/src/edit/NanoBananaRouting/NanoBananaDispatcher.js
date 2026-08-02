import {
  pollNanoBananaEditRequest,
  submitNanoBananaEditRequest,
  submitNanoBananaGetImageSetFromImageListRequest,
  submitNanoBananaRemoveLogoRequest,
  submitNanoBananaEnhanceRequest,

  pollNanoBananaRemoveLogoRequest,
  pollNanoBananaGetImageSetFromImageListRequest,
  pollNanoBananaEnhanceRequest,
  updateGlobalSessionStatus,


} from './NanoBananaEdit.js';
import {
  handleGoogleNanoBananaEditDispatch,
  shouldUseGoogleNativeNanoBananaEdit,
} from './GoogleNanoBananaEdit.js';
import {
  handleSamsarExternalImageEditRequest,
  shouldUseSamsarExternalImageEditProvider,
} from '../../providers/SamsarExternalImage.js';
import {
  DOCKER_ADAPTER_PROVIDER,
  resolveDockerImageEditProvider,
  resolveNextDockerImageEditProvider,
} from '../../consts/DockerProviderPriority.js';
import ImageGeneration from '../../schema/ImageGeneration.js';
import { markVideoSessionLayerAsFailed } from '../../VideoSession.js';
import { isStandaloneEdition } from '../../utils/Environment.js';

const CASE_TYPE_HANDLERS = {
  image_edit: {
    submit: submitNanoBananaEditRequest,
    poll: pollNanoBananaEditRequest,
  },
  logo_remove: {
    submit: submitNanoBananaRemoveLogoRequest,
    poll: pollNanoBananaRemoveLogoRequest,
  },
  image_enhance: {
    submit: submitNanoBananaEnhanceRequest,
    poll: pollNanoBananaEnhanceRequest,
  },
  enhance_image: {
    submit: submitNanoBananaEnhanceRequest,
    poll: pollNanoBananaEnhanceRequest,
  },
  image_list_to_image_set: {
    submit: submitNanoBananaGetImageSetFromImageListRequest,
    poll: pollNanoBananaGetImageSetFromImageListRequest,
  },
};

function normalizeAdapterProvider(value) {
  const normalized = typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    : '';
  if (['google', 'googlecloud', 'gcp', 'vertex', 'vertexai'].includes(normalized)) {
    return DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD;
  }
  if (normalized === 'fal') {
    return DOCKER_ADAPTER_PROVIDER.FAL;
  }
  if (normalized === 'samsar') {
    return DOCKER_ADAPTER_PROVIDER.SAMSAR;
  }
  if (['gmi', 'gmicloud', 'genblaze'].includes(normalized)) {
    return DOCKER_ADAPTER_PROVIDER.GMICLOUD;
  }
  return '';
}

export function resolveNanoBananaEditAdapterProvider(payload = {}) {
  if (!isStandaloneEdition()) {
    return '';
  }
  const pinnedProvider = normalizeAdapterProvider(
    payload?.adapterProviderOverride || payload?.adapterProvider,
  );
  if (pinnedProvider) {
    return pinnedProvider;
  }
  const requestId = typeof payload?.apiRequestId === 'string'
    ? payload.apiRequestId.trim().toLowerCase()
    : '';
  if (requestId.startsWith('google-native-nanobanana-edit:')) {
    return DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD;
  }
  if (requestId.startsWith('samsar-external-image:')) {
    return DOCKER_ADAPTER_PROVIDER.SAMSAR;
  }
  if (requestId.startsWith('genblaze-image-edit:')) {
    return DOCKER_ADAPTER_PROVIDER.GMICLOUD;
  }
  const externalProvider = normalizeAdapterProvider(payload?.externalProvider);
  return externalProvider || resolveDockerImageEditProvider(payload?.model);
}

export function resolveNanoBananaImageSetAdapterProvider(payload = {}) {
  const provider = resolveNanoBananaEditAdapterProvider(payload);
  if (
    provider !== DOCKER_ADAPTER_PROVIDER.GMICLOUD ||
    resolveCaseType(payload?.case_type) !== 'image_list_to_image_set'
  ) {
    return provider;
  }
  return resolveNextDockerImageEditProvider(payload?.model, provider);
}

export async function handleNanoBananaEditDispatch(payload) {
  const { apiEditStatus = 'INIT', case_type, model } = payload || {};
  let standaloneProvider = resolveNanoBananaEditAdapterProvider(payload);
  const caseType = resolveCaseType(case_type);
  if (
    standaloneProvider === DOCKER_ADAPTER_PROVIDER.GMICLOUD &&
    caseType === 'image_list_to_image_set'
  ) {
    const nextProvider = resolveNanoBananaImageSetAdapterProvider(payload);
    if (!nextProvider) {
      return handleUnsupportedGmiCloudImageSet(payload);
    }
    standaloneProvider = nextProvider;
  }
  const routedPayload = standaloneProvider
    ? {
      ...payload,
      adapterProvider: standaloneProvider,
      adapterProviderOverride: standaloneProvider,
    }
    : payload;
  if (apiEditStatus === 'INIT' && standaloneProvider && payload?._id) {
    try {
      await ImageGeneration.findByIdAndUpdate(payload._id, {
        adapterProvider: standaloneProvider,
        adapterProviderOverride: standaloneProvider,
      });
    } catch {
    }
  }

  if (
    standaloneProvider === DOCKER_ADAPTER_PROVIDER.SAMSAR ||
    (!standaloneProvider && shouldUseSamsarExternalImageEditProvider(payload))
  ) {
    return await handleSamsarExternalImageEditRequest(routedPayload);
  }

  const dockerProvider = standaloneProvider || resolveDockerImageEditProvider(model);
  if (
    dockerProvider === DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD ||
    (!dockerProvider && shouldUseGoogleNativeNanoBananaEdit(payload))
  ) {
    return await handleGoogleNanoBananaEditDispatch(routedPayload);
  }

  let handler = CASE_TYPE_HANDLERS[caseType];

  if (!handler && caseType === 'image_enhance') {
    handler = CASE_TYPE_HANDLERS.enhance_image;
  } else if (!handler && caseType === 'enhance_image') {
    handler = CASE_TYPE_HANDLERS.image_enhance;
  }

  if (!handler && caseType.includes('enhance')) {
    handler = CASE_TYPE_HANDLERS.enhance_image || CASE_TYPE_HANDLERS.image_enhance;
  }

  if (!handler) {
    return handleUnsupportedCaseType(payload, caseType);
  }

  try {
    if (apiEditStatus === 'INIT') {
      const submitResult = await handler.submit(routedPayload);
      if (submitResult?.error) {
        throw new Error(submitResult.error);
      }
      return null;
    }

    if (apiEditStatus === 'PENDING') {
      const pollResult = await handler.poll(routedPayload);
      return pollResult?.error
        ? { ...pollResult, definitiveAdapterFailure: true }
        : pollResult;
    }

    if (apiEditStatus === 'COMPLETED') {
      // Allow idempotent polling to pull down the final assets without failing the request
      return await handler.poll(routedPayload);
    }

    if (apiEditStatus === 'FAILED') {
      return await markCaseAsFailed(routedPayload, caseType, `NanoBanana request failed for case_type ${caseType}`);
    }

    return handleUnsupportedCaseType(routedPayload, caseType);
  } catch (error) {
    return await markCaseAsFailed(routedPayload, caseType, error?.message || 'NanoBanana dispatcher error');
  }
}

async function handleUnsupportedGmiCloudImageSet(payload) {
  const message = 'GMICloud image editing does not preserve Samsar multi-output image-set requests.';
  if (payload?.deferAdapterFailureFinalization === true) {
    return { error: message, definitiveAdapterFailure: true };
  }
  return markCaseAsFailed(payload, 'image_list_to_image_set', message);
}

function normalizeCaseType(caseType) {
  if (typeof caseType === 'string' && caseType.trim().length > 0) {
    return caseType.trim().toLowerCase();
  }
  return 'image_edit';
}

function resolveCaseType(caseType) {
  const normalized = normalizeCaseType(caseType);
  if (normalized === 'image_enhance' || normalized === 'enhance_image') {
    return 'enhance_image';
  }
  if (normalized === 'upscale' || normalized === 'upscale_image') {
    return 'enhance_image';
  }
  return normalized;
}

async function handleUnsupportedCaseType(payload, caseType) {
  const message = `Unsupported NanoBanana case_type: ${caseType}`;
  return await markCaseAsFailed(payload, caseType, message);
}

async function markCaseAsFailed(payload, caseType, message) {
  if (payload?.deferAdapterFailureFinalization === true) {
    return { error: message, definitiveAdapterFailure: true };
  }


  try {
    await ImageGeneration.findOneAndUpdate(
      { _id: payload?._id },
      {
        editStatus: 'FAILED',
        apiEditStatus: 'FAILED',
        generationStatus: 'FAILED',
        apiGenerationStatus: 'FAILED',
        rowLocked: false,
        errorMessage: message,
      }
    );
  } catch {
  }

  if (payload?._id) {
    try {
      await updateGlobalSessionStatus(payload._id, { status: 'FAILED', errorMessage: message });
    } catch {
    }
  }

  if (payload?.requestType !== 'API') {
    try {
      await markVideoSessionLayerAsFailed(payload);
    } catch {
    }
  }

  return { error: message };
}
