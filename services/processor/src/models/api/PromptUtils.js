import {
  IMAGE_GENERAITON_MODEL_TYPES,
  VIDEO_GENERATION_MODEL_TYPES,
} from '../../consts/ModelTypes.js';
import {
  TEXT_TO_VIDEO_IMAGE_MODEL_KEYS,
  TEXT_TO_VIDEO_VIDEO_MODEL_KEYS,
} from '../../consts/ExpressVideoModelOptions.js';

export const MAX_MOVIE_PROMPT_LENGTH = 4000;

export const DEPRECATED_VIDEO_MODEL_SUBTYPE_PAYLOAD_KEYS = [
  'video_model_sub_type',
  'videoModelSubType',
];

function resolveImageModelAlias(modelKey) {
  return modelKey;
}

export function stripDeprecatedVideoModelSubtypeOptions(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  DEPRECATED_VIDEO_MODEL_SUBTYPE_PAYLOAD_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      delete payload[key];
    }
  });

  return payload;
}

export function validateExpressImageModelKey(imageModel, options = {}) {
  const isRequired = options.required !== false;
  const hasValue = imageModel !== undefined && imageModel !== null && String(imageModel).trim().length > 0;
  const normalizedImageModel = typeof imageModel === 'string' ? imageModel.trim() : imageModel;

  if (!hasValue && !isRequired) {
    return {
      status: true,
      imageModel: null,
    };
  }

  const resolvedImageModel = resolveImageModelAlias(normalizedImageModel);
  const imageGenerationModelExists = IMAGE_GENERAITON_MODEL_TYPES.find(model => model.key === resolvedImageModel);

  if (!imageGenerationModelExists) {
    return {
      status: false,
      message: "Invalid image model"
    };
  }

  if (!imageGenerationModelExists.isExpressModel) {
    return {
      status: false,
      message: "Image model is not supported for this type"
    };
  }

  if (!TEXT_TO_VIDEO_IMAGE_MODEL_KEYS.includes(resolvedImageModel)) {
    return {
      status: false,
      message: "Image model is not supported for this type"
    };
  }

  return {
    status: true,
    imageModel: resolvedImageModel,
  };
}

export function validateMovieInput(payload) {

  let {
    prompt,
    image_model,
    video_model,
    duration,
  } = payload;

  const MIN_DURATION_SECONDS = 10;
  const MAX_DURATION_SECONDS = 240;

  if (typeof prompt !== 'string') {
    return {
      status: false,
      message: "Prompt is required"
    };
  }

  prompt = prompt.trim();

  if (!prompt) {
    return {
      status: false,
      message: "Prompt is required"
    };
  }

  if (prompt.length > MAX_MOVIE_PROMPT_LENGTH) {
    return {
      status: false,
      message: "Prompt is too long"
    };
  }



  const videoGenerationModelExists = VIDEO_GENERATION_MODEL_TYPES.find(model => model.key === video_model);
  const isSupportedExpressVideoModel = TEXT_TO_VIDEO_VIDEO_MODEL_KEYS.includes(video_model);

  if (!isSupportedExpressVideoModel) {
    return {
      status: false,
      message: videoGenerationModelExists ? "Video model is not supported for this type" : "Invalid video model"
    };
  }

  if (videoGenerationModelExists && !videoGenerationModelExists.isExpressModel) {
    return {
      status: false,
      message: "Video model is not supported for this type"
    };
  }

  const imageModelValidation = validateExpressImageModelKey(image_model);
  if (!imageModelValidation.status) {
    return {
      status: false,
      message: imageModelValidation.message,
    };
  }

  const durationValue = Number(duration);
  if (!Number.isFinite(durationValue)) {
    return {
      status: false,
      message: "Duration is invalid"
    };
  }

  if (durationValue < MIN_DURATION_SECONDS) {
    return {
      status: false,
      message: `Duration must be at least ${MIN_DURATION_SECONDS} seconds`
    };
  }

  if (durationValue > MAX_DURATION_SECONDS) {
    return {
      status: false,
      message: "Duration is too long"
    };
  }

  return {
    status: true,
    message: "Valid input"
  };



}

export function validateNarrativeInput(payload) {


  const {
    prompt_list,
    speaker,
    provider,
    add_generative_video,
    image_model,
    video_model,
  } = payload;

  if (!prompt_list || prompt_list.length === 0) {
    return {
      status: false,
      message: "Prompt list is required"
    };
  }

  if (prompt_list.length > 20) {
    return {
      status: false,
      message: "Too many lines"
    };
  }

  if (!image_model) {
    return {
      status: false,
      message: "Image model is required"
    };
  }

  const resolvedImageModel = resolveImageModelAlias(image_model);
  const imageGenerationModelExists = IMAGE_GENERAITON_MODEL_TYPES.find(model => model.key === resolvedImageModel);

  if (!imageGenerationModelExists) {
    return {
      status: false,
      message: "Invalid image model"
    };
  }

  if (!imageGenerationModelExists.isExpressModel) {
    return {
      status: false,
      message: "Image model is not supported for this type"
    };
  }

  if (add_generative_video) {
    if (!video_model) {
      return {
        status: false,
        message: "Video model is required"
      };
    }

    const videoGenerationModelExists = VIDEO_GENERATION_MODEL_TYPES.find(model => model.key === video_model);

    if (!videoGenerationModelExists) {
      return {
        status: false,
        message: "Invalid video model"
      };
    }

    if (!videoGenerationModelExists.isExpressModel) {
      return {
        status: false,
        message: "Video model is not supported for this type"
      };
    }
    

  }
  return true;

}
