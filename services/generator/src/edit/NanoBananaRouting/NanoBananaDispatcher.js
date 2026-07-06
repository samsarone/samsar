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
} from '../../consts/DockerProviderPriority.js';
import ImageGeneration from '../../schema/ImageGeneration.js';
import { markVideoSessionLayerAsFailed } from '../../VideoSession.js';

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

export async function handleNanoBananaEditDispatch(payload) {
  const { apiEditStatus = 'INIT', case_type, model } = payload || {};

  if (shouldUseSamsarExternalImageEditProvider(payload)) {
    return await handleSamsarExternalImageEditRequest(payload);
  }

  const dockerProvider = resolveDockerImageEditProvider(model);
  if (
    dockerProvider === DOCKER_ADAPTER_PROVIDER.GOOGLE_CLOUD ||
    (!dockerProvider && shouldUseGoogleNativeNanoBananaEdit(payload))
  ) {
    return await handleGoogleNanoBananaEditDispatch(payload);
  }

  const caseType = resolveCaseType(case_type);
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
      const submitResult = await handler.submit(payload);
      if (submitResult?.error) {
        throw new Error(submitResult.error);
      }
      return null;
    }

    if (apiEditStatus === 'PENDING') {
      return await handler.poll(payload);
    }

    if (apiEditStatus === 'COMPLETED') {
      // Allow idempotent polling to pull down the final assets without failing the request
      return await handler.poll(payload);
    }

    if (apiEditStatus === 'FAILED') {
      return await markCaseAsFailed(payload, caseType, `NanoBanana request failed for case_type ${caseType}`);
    }

    return handleUnsupportedCaseType(payload, caseType);
  } catch (error) {
    return await markCaseAsFailed(payload, caseType, error?.message || 'NanoBanana dispatcher error');
  }
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
