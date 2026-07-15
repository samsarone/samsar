
import {
  Suspense,
  lazy,
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Tooltip } from 'react-tooltip';
import { resolveVidgenieLoadedProjectView } from './vidgenieProjectViewState.mjs';
import {
  FaChevronCircleDown,
  FaChevronDown,
  FaChevronRight,
  FaCog,
  FaSpinner,
  FaImage,
  FaUpload,
  FaPlus,
  FaArrowUp,
  FaArrowDown,
  FaTrash,
  FaLink,
  FaMicrophone,
  FaStopCircle,
  FaPause,
  FaPlay,
  FaRedo,
  FaCheck,
  FaLanguage,
  FaClosedCaptioning,
  FaUserCircle,
  FaClone,
} from 'react-icons/fa';
import axios from 'axios';
import { ToastContainer, toast } from 'react-toastify';

import { useUser } from '../../contexts/UserContext.jsx';
import { useColorMode } from '../../contexts/ColorMode.jsx';
import { useAlertDialog } from '../../contexts/AlertDialogContext.jsx';
import { useLocalization } from '../../contexts/LocalizationContext.jsx';

import AuthContainer, { AUTH_DIALOG_OPTIONS } from '../auth/AuthContainer.jsx';
import SingleSelect from '../common/SingleSelect.jsx';
import ProgressIndicator from './ProgressIndicator.jsx';
import AssistantHome from '../assistant/AssistantHome.jsx';
import PrimaryPublicButton from '../common/buttons/PrimaryPublicButton.tsx';
import PublishOptionsDialog from '../video/toolbars/frame_toolbar/PublishOptionsDialog.jsx';
import VidgenieSkeletonLoader from './VidgenieSkeletonLoader.jsx';
import VideoEditAdvancedDialog from '../video/advanced/VideoEditAdvancedDialog.jsx';
import { PURCHASE_CREDITS_ROUTE } from '../account/PurchaseCreditsPromptDialog.jsx';

import {
  IMAGE_GENERAITON_MODEL_TYPES,
  INFERENCE_MODEL_TYPES,
  PIXVERRSE_VIDEO_STYLES,
  VIDEO_GENERATION_MODEL_TYPES,
} from '../../constants/Types.ts';
import { IMAGE_MODEL_PRICES } from '../../constants/ModelPrices.jsx';
import {
  getExpressVideoCreditsPerSecond,
  getExpressVideoPricingDistributionPerSecond,
} from '../../constants/pricing/ExpressVideoPricingDistribution.js';
import { SUPPORTED_LANGUAGES, resolveLanguageCode } from '../../constants/supportedLanguages.js';
import { getHeaders } from '../../utils/web.jsx';
import { getSessionType } from '../../utils/environment.jsx';
import {
  DEFAULT_VIDGENIE_SUBTITLES_ENABLED,
  buildVidgenieLanguageFields,
} from './vidgenieSubtitleLanguage.mjs';
import {
  buildSubtitleRegenerationLanguageFields,
  isTranslatedSubtitleRegeneration,
  resolveSessionAudioLanguage,
  resolveSubtitleRegenerationDefault,
} from '../../utils/subtitleRegenerationLanguage.mjs';
import {
  getVideoPostProcessingRequestUrls,
  isMissingVideoPostProcessingRoute,
} from '../../utils/videoPostProcessingApi.mjs';
import {
  filterOptionsForDeploymentModelValues,
  normalizeDeploymentModelValue,
} from '../../utils/deploymentProviders.js';
import useRealtimeTranscription from '../../hooks/useRealtimeTranscription.js';
import { useDeploymentModelAvailability } from '../../hooks/useDeploymentModelAvailability.js';
import { useInferenceModelAvailability } from '../../hooks/useInferenceModelAvailability.js';

import 'react-tooltip/dist/react-tooltip.css';
import 'react-toastify/dist/ReactToastify.css';
import './mobileStyles.css';

const LazyAceEditor = lazy(async () => {
  const [aceModule, reactAceModule] = await Promise.all([
    import('ace-builds'),
    import('react-ace'),
    import('ace-builds/src-noconflict/mode-json'),
    import('ace-builds/src-noconflict/theme-monokai'),
    import('ace-builds/src-noconflict/ext-language_tools'),
  ]);

  const ace = aceModule.default || aceModule;
  ace.config.set('useWorker', false);

  return { default: reactAceModule.default || reactAceModule };
});

function JsonAceEditor({ height = '520px', ...props }) {
  return (
    <Suspense
      fallback={(
        <div
          className="flex items-center justify-center bg-[#272822] text-sm text-slate-300"
          style={{ height }}
          role="status"
        >
          Loading JSON editor...
        </div>
      )}
    >
      <LazyAceEditor {...props} height={height} />
    </Suspense>
  );
}

// ───────────────────────────────────────────────────────────
//  Environment constants
// ───────────────────────────────────────────────────────────
const API_SERVER = import.meta.env.VITE_PROCESSOR_API;
const CDN_URI = import.meta.env.VITE_STATIC_CDN_URL;
const PROCESSOR_API_URL = API_SERVER;
const VIDEO_API_BASE = `${API_SERVER}/v2`;
const VIDEO_STATUS_ENDPOINT = `${API_SERVER}/v2/status`;
const VIDEO_STATUS_DETAILED_ENDPOINT = `${API_SERVER}/v2/status_detailed`;
const VIDEO_STEP_API_BASE = `${VIDEO_API_BASE}/video/step`;
const STATIC_ASSET_BASE_URL = (
  CDN_URI ||
  'https://static.samsar.one'
).replace(/\/+$/, '');
const USER_RESOURCES_PREFIX = 'user_resources/';
const DIRECT_PROCESSOR_ASSET_PREFIXES = [
  'assets_v2/',
  'assets/',
  'generations/',
  'intermediates/',
  'temp_images/',
  'video/',
  'ai_video/',
];
const ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY = 'advancedVideoEditPendingSession';
const POST_PROCESSING_PENDING_SESSION_KEY = 'vidgeniePostProcessingPendingSession';
const VIDGENIE_REQUEST_STEP_MODE_STORAGE_PREFIX = 'vidgenieRequestStepMode';

// ───────────────────────────────────────────────────────────
//  Polling constants
// ───────────────────────────────────────────────────────────
const DEFAULT_POLL = 5_000;    // 5 s while online & healthy
const OFFLINE_POLL = 30_000;   // 30 s while offline
const MAX_BACKOFF = 60_000;    // 1 min cap
const TIMELINE_PREVIEW_SESSION_REFRESH_MS = 10_000;
const VOICE_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const VOICE_TRANSCRIPTION_WORD_LIMIT = 2000;
const VIDGENIE_PROMPT_MAX_LENGTH = 4000;
const VIDGENIE_IMAGE_MODEL_ORDER = [
  'GPTIMAGE2',
  'NANOBANANA2',
  'NANOBANANAPRO',
  'SEEDREAM',
  'WAN2.7PRO',
];
const VIDGENIE_IMAGE_MODEL_LABELS = {
  GPTIMAGE2: 'GPT Image 2',
  NANOBANANA2: 'Nano Banana 2',
  NANOBANANAPRO: 'NanoBanana Pro',
  SEEDREAM: 'Seedream',
  'WAN2.7PRO': 'Wan2.7 Pro',
};
const DEFAULT_VIDEO_GENERATION_MODEL = 'RUNWAYML';
const VIDGENIE_VIDEO_MODEL_ORDER = [
  'RUNWAYML',
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
  'COSMOS3SUPERI2V',
  'SEEDANCEI2V',
  'KLINGIMGTOVID3PRO',
  'HAPPYHORSEI2V',
];
const VIDGENIE_VIDEO_MODEL_LABELS = {
  RUNWAYML: 'RunwayML Gen 4.5 (Default)',
  'VEO3.1I2V': 'VEO3.1 I2V',
  'VEO3.1I2VFAST': 'VEO3.1 I2V Fast',
  COSMOS3SUPERI2V: 'Nvidia Cosmos 3',
  SEEDANCEI2V: 'Seedance 1.5',
  KLINGIMGTOVID3PRO: 'Kling 3 Pro',
  HAPPYHORSEI2V: 'Happy Horse 1.1 I2V',
};
const VIDGENIE_TEXT_VIDEO_MODEL_STORAGE_KEY = 'defaultVIdGPTVideoGenerationModel';
const VIDGENIE_IMAGE_LIST_VIDEO_MODEL_STORAGE_KEY = 'defaultVidgenieImageListVideoGenerationModel';
const VIDGENIE_IMAGE_LIST_VIDEO_MODEL_ORDER = [
  'RUNWAYML',
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
  'COSMOS3SUPERI2V',
  'SEEDANCEI2V',
  'KLINGIMGTOVID3PRO',
  'HAPPYHORSEI2V',
];
const TEXT_TO_VIDEO_IMAGE_MODEL_KEYS = VIDGENIE_IMAGE_MODEL_ORDER;
const IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS = VIDGENIE_IMAGE_MODEL_ORDER;
const TEXT_TO_VIDEO_VIDEO_MODEL_KEYS = [
  'RUNWAYML',
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
  'COSMOS3SUPERI2V',
  'SEEDANCEI2V',
  'KLINGIMGTOVID3PRO',
  'HAPPYHORSEI2V',
  'CUSTOM_IMAGE_TO_VIDEO',
];
const IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS = [
  'RUNWAYML',
  'VEO3.1I2V',
  'VEO3.1I2VFAST',
  'COSMOS3SUPERI2V',
  'SEEDANCEI2V',
  'KLINGIMGTOVID3PRO',
  'HAPPYHORSEI2V',
  'CUSTOM_IMAGE_TO_VIDEO',
];
const DEFAULT_INFERENCE_MODEL = 'gpt-5.6-sol';
const INFERENCE_MODEL_LABEL_BY_VALUE = INFERENCE_MODEL_TYPES.reduce((result, option) => {
  result[option.value] = option.label;
  return result;
}, {});
const JSON_MODE_ASPECT_RATIOS = ['16:9', '9:16'];
const JSON_MODE_VIDEO_MODEL_SUB_TYPES = ['anime', '3d_animation', 'clay', 'comic', 'cyberpunk'];
const GENERATION_STEP_MODE_ONE_STEP = 'one_step';
const GENERATION_STEP_MODE_TWO_STEP = 'two_step';
const TWO_STEP_MANUAL_STAGES = ['ai_video_generation'];
const STEP_IMAGE_GENERATION_POLL_MS = 1_500;
const STEP_IMAGE_GENERATION_TIMEOUT_MS = 180_000;
const OUTRO_CTA_TYPE_QR = 'qr';
const OUTRO_CTA_TYPE_IMAGE = 'image';
const OUTRO_CTA_TYPE_OPTIONS = [
  { value: OUTRO_CTA_TYPE_QR, label: 'URL QR code' },
  { value: OUTRO_CTA_TYPE_IMAGE, label: 'CTA image' },
];
const DEFAULT_ADVANCED_OPTIONS = Object.freeze({
  tone: 'grounded',
  generate_outro_image: false,
  outro_cta_type: OUTRO_CTA_TYPE_QR,
  cta_url: '',
  cta_text_top: '',
  cta_text_bottom: '',
  cta_logo: '',
  outro_cta_image_url: '',
  footer_metadata: '',
  limit_single_narrator: false,
  add_narrator_avatar: false,
});
const DEFAULT_POST_PROCESSING_FORM = Object.freeze({
  outroCtaType: OUTRO_CTA_TYPE_QR,
  ctaUrl: '',
  ctaTextTop: '',
  ctaTextBottom: '',
  ctaLogo: '',
  outroCtaImageUrl: '',
  footerCtaText: '',
  footerCtaLogo: '',
  footerCtaUrl: '',
  translationLanguage: '',
  translationEnableSubtitles: true,
  translationTranslateOutro: true,
  translationTranslateFooter: true,
  subtitleLanguage: '',
  rerollLayerIndexes: [],
});
const POST_PROCESSING_ACTIONS = Object.freeze([
  { key: 'retranslate', label: 'Retranslate', icon: FaLanguage },
  { key: 'avatar', label: 'Avatar', icon: FaUserCircle },
  { key: 'subtitles', label: 'Subtitles', icon: FaClosedCaptioning },
  { key: 'generated_outro', label: 'Outro CTA', icon: FaImage },
  { key: 'footer_cta', label: 'Footer CTA', icon: FaLink },
  { key: 'reroll_layers', label: 'Reroll scenes', icon: FaRedo },
  { key: 'clone_render', label: 'Clone', icon: FaClone },
  { key: 'advanced_edits', label: 'Edits', icon: FaCog },
]);
const INITIAL_EXPRESS_GENERATION_STATUS = Object.freeze({
  prompt_generation: 'PENDING',
  image_generation: 'PENDING',
  audio_generation: 'PENDING',
  frame_generation: 'INIT',
  video_generation: 'INIT',
  ai_video_generation: 'INIT',
  speech_generation: 'INIT',
  music_generation: 'INIT',
  delete_reflow: 'INIT',
});

const VIDGENIE_TONE_OPTIONS = [
  { value: 'grounded', label: 'Grounded' },
  { value: 'cinematic', label: 'Cinematic' },
];

const VIDGENIE_STEP_MODE_OPTIONS = [
  {
    value: GENERATION_STEP_MODE_ONE_STEP,
    label: '1-step',
    description: 'Render the full video automatically.',
  },
  {
    value: GENERATION_STEP_MODE_TWO_STEP,
    label: '2-step',
    description: 'Review images before video generation.',
  },
];

const CUSTOM_ADAPTER_OPERATION_OPTIONS = [
  { key: 'text_to_image', label: 'Text to image' },
  { key: 'text_to_video', label: 'Text to video' },
  { key: 'image_to_video', label: 'Image to video' },
  { key: 'text_to_speech', label: 'Text to speech' },
  { key: 'text_to_music', label: 'Text to music' },
  { key: 'text_to_sound_effect', label: 'Text to sound effect' },
];

function hasTextValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createEmptyImageListItem() {
  return {
    image_url: '',
    image_text: '',
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string' && reader.result.trim()) {
        resolve(reader.result);
        return;
      }
      reject(new Error('Could not read image file.'));
    };
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

function formatAllowedJsonValues(values) {
  return values.join(', ');
}

function findDefaultVideoModelOption(options = [], savedValue = '') {
  const saved = savedValue ? options.find((model) => model.value === savedValue) : null;
  if (saved) return saved;

  return (
    options.find((model) => model.value === DEFAULT_VIDEO_GENERATION_MODEL) ||
    options[0] ||
    null
  );
}

function coerceSupportedInferenceModelKey(value) {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'qwen3.7' ||
    normalized === 'qwen3.7-max' ||
    normalized === 'qwen3.7-plus' ||
    normalized === 'qwen-3.7' ||
    normalized === 'qwen 3.7' ||
    normalized === 'qwen37' ||
    normalized === 'qwen37max' ||
    normalized === 'qwen37plus' ||
    normalized === 'alibaba qwen 3.7' ||
    normalized === 'alibaba cloud qwen 3.7'
  ) {
    return 'QWEN3.7';
  }
  if (
    normalized === 'gemini-3.1-pro' ||
    normalized === 'gemini-3.1-pro-preview' ||
    normalized === 'gemini-3-pro' ||
    normalized === 'gemini-3-pro-preview' ||
    normalized === 'gemini 3.1 pro' ||
    normalized === 'gemini 3.1 pro preview' ||
    normalized === 'gemini 3 pro' ||
    normalized === 'gemini 3 pro preview' ||
    normalized === 'gemini31pro' ||
    normalized === 'gemini31propreview' ||
    normalized === 'gemini3pro' ||
    normalized === 'gemini3propreview'
  ) {
    return 'gemini-3.1-pro';
  }
  if (normalized === DEFAULT_INFERENCE_MODEL || normalized.startsWith(`${DEFAULT_INFERENCE_MODEL}-`)) {
    return DEFAULT_INFERENCE_MODEL;
  }
  if (
    normalized === 'gpt-5.6' ||
    normalized === 'gpt 5.6 sol' ||
    normalized === 'gpt56' ||
    normalized === 'gpt56sol'
  ) {
    return DEFAULT_INFERENCE_MODEL;
  }
  return '';
}

function normalizeInferenceModelKey(value) {
  const supportedKey = coerceSupportedInferenceModelKey(value);
  if (supportedKey) {
    return supportedKey;
  }
  return DEFAULT_INFERENCE_MODEL;
}

function getInferenceModelOption(value, fallbackValue = DEFAULT_INFERENCE_MODEL, options = INFERENCE_MODEL_TYPES) {
  const modelOptions = Array.isArray(options) ? options : INFERENCE_MODEL_TYPES;
  if (modelOptions.length === 0) return null;
  const normalizedValue = normalizeInferenceModelKey(value || fallbackValue);
  return (
    modelOptions.find((option) => option.value === normalizedValue) ||
    modelOptions.find((option) => option.value === DEFAULT_INFERENCE_MODEL) ||
    modelOptions[0]
  );
}

function isSupportedInferenceModelKey(value, options = INFERENCE_MODEL_TYPES) {
  const modelOptions = Array.isArray(options) ? options : INFERENCE_MODEL_TYPES;
  const supportedKey = coerceSupportedInferenceModelKey(value);
  return modelOptions.some((option) => option.value === supportedKey);
}

function getInferenceModelDisplayLabel(value) {
  const normalizedValue = normalizeInferenceModelKey(value);
  return INFERENCE_MODEL_LABEL_BY_VALUE[normalizedValue] || normalizedValue;
}

function normalizeModeToken(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : '';
}

function getNestedValue(source, path) {
  return path.reduce((current, key) => (
    current && typeof current === 'object' ? current[key] : undefined
  ), source);
}

function sessionHasImageListInput(session) {
  if (!isPlainObject(session)) return false;
  const candidates = [
    session.image_urls,
    session.imageUrls,
    session.input_image_urls,
    session.inputImageUrls,
    session.expressImageUrls,
    session.expressImageList,
    session.imageListPayload,
    session.expressGenerationBuilder?.image_urls,
    session.expressGenerationBuilder?.input?.image_urls,
    session.expressGenerationBuilder?.payload?.image_urls,
  ];
  return candidates.some((candidate) => Array.isArray(candidate) && candidate.length > 0);
}

function resolveVidgenieGenerationModeFromSession(session) {
  if (!isPlainObject(session)) return null;

  const nestedSessionMode = isPlainObject(session.session)
    ? resolveVidgenieGenerationModeFromSession(session.session)
    : null;
  if (nestedSessionMode) {
    return nestedSessionMode;
  }

  const modeCandidatePaths = [
    ['expressGenerationType'],
    ['generationType'],
    ['requestType'],
    ['sessionSubType'],
    ['session_sub_type'],
    ['cloneType'],
    ['expressGenerationBuilder', 'routeType'],
    ['expressGenerationBuilder', 'builderRouteType'],
    ['expressGenerationBuilder', 'expressGenerationType'],
    ['expressGenerationBuilder', 'sessionSubType'],
    ['metadata', 'routeType'],
    ['metadata', 'builderRouteType'],
    ['metadata', 'expressGenerationType'],
    ['metadata', 'sessionSubType'],
  ];
  const modeTokens = modeCandidatePaths
    .map((path) => normalizeModeToken(getNestedValue(session, path)))
    .filter(Boolean);

  if (modeTokens.some((token) =>
    token === 'text_to_video' ||
    token === 'text_video' ||
    token === 'texttovideo'
  )) {
    return 'T2V';
  }

  if (modeTokens.some((token) =>
    token === 'image_list_to_video' ||
    token === 'image_to_video' ||
    token === 'imagelist_to_video' ||
    token === 'imagetovideo'
  )) {
    return 'I2V';
  }

  if (sessionHasImageListInput(session)) {
    return 'I2V';
  }

  if (session.isExpressGeneration === true) {
    return 'I2V';
  }

  if (hasTextValue(session.inputPrompt) || hasTextValue(session.expressInputPrompt)) {
    return 'T2V';
  }

  return null;
}

function resolveInferenceModelFromSession(session) {
  if (!isPlainObject(session)) return '';

  const nestedSessionModel = isPlainObject(session.session)
    ? resolveInferenceModelFromSession(session.session)
    : '';
  if (nestedSessionModel) {
    return nestedSessionModel;
  }

  const inferenceModelCandidatePaths = [
    ['expressGenerationInferenceModel'],
    ['inferenceModel'],
    ['inference_model'],
    ['selectedInferenceModel'],
    ['expressStepGeneration', 'inferenceModel'],
    ['expressStepGeneration', 'inference_model'],
    ['expressGenerationBuilder', 'inferenceModel'],
    ['expressGenerationBuilder', 'inference_model'],
    ['metadata', 'inferenceModel'],
    ['metadata', 'inference_model'],
  ];

  const rawValue = inferenceModelCandidatePaths
    .map((path) => getNestedValue(session, path))
    .find((value) => typeof value === 'string' && value.trim());
  return rawValue ? normalizeInferenceModelKey(rawValue) : '';
}

function resolveJsonImageModelAlias(modelKey) {
  return modelKey;
}

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return false;
  }
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function getOutroCtaImageMiddleImage(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (!isPlainObject(value)) {
    return '';
  }
  return (
    value.middle_image ??
    value.middleImage ??
    value.center_image ??
    value.centerImage ??
    value.middle ??
    value.center ??
    value.url ??
    value.image_url ??
    value.imageUrl ??
    value.public_url ??
    value.publicUrl ??
    value.src ??
    value.data_url ??
    value.dataUrl ??
    value.image_data ??
    value.imageData ??
    ''
  );
}

function hasOutroCtaImagePayload(value) {
  const middleImage = getOutroCtaImageMiddleImage(value);
  if (typeof middleImage === 'string') {
    return middleImage.trim().length > 0;
  }
  return hasOutroCtaImagePayload(middleImage);
}

function validateOutroCtaImagePayload(value) {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== 'string' && !isPlainObject(value)) {
    return 'JSON input.outro_cta_image must be a string or object when provided.';
  }
  const middleImage = getOutroCtaImageMiddleImage(value);
  if (typeof middleImage !== 'string' || middleImage.trim().length === 0) {
    return 'JSON input.outro_cta_image.middle_image is required when provided.';
  }
  const trimmedMiddleImage = middleImage.trim();
  if (!isHttpUrl(trimmedMiddleImage) && !trimmedMiddleImage.startsWith('data:image/')) {
    return 'JSON input.outro_cta_image.middle_image must be an http(s) URL or image data URL.';
  }
  return null;
}

function sessionHasOutroImage(session) {
  if (!session || typeof session !== 'object') {
    return false;
  }

  if (session.hasOutroImage === true) {
    return true;
  }

  if (hasTextValue(session.outroImageURL) || hasTextValue(session.outroImageUrl)) {
    return true;
  }

  if (isPlainObject(session.outroImageMetadata)) {
    return true;
  }

  return Array.isArray(session.layers) && session.layers.some((layer) =>
    isPlainObject(layer?.outroImageMetadata)
  );
}

function payloadRequestsGeneratedOutro(payload) {
  if (!isPlainObject(payload)) {
    return false;
  }

  const candidates = [payload];
  if (isPlainObject(payload.input)) {
    candidates.push(payload.input);
    if (isPlainObject(payload.input.input)) {
      candidates.push(payload.input.input);
    }
  }

  return candidates.some((candidate) => {
    if (candidate.generate_outro_image === true || candidate.generateOutroImage === true) {
      return true;
    }

    const ctaUrl = candidate.cta_url ?? candidate.ctaUrl;
    const outroCtaImage =
      candidate.outro_cta_image ??
      candidate.outroCtaImage ??
      candidate.cta_image ??
      candidate.ctaImage;
    const outroImageUrl =
      candidate.outro_image_url ??
      candidate.outroImageUrl ??
      candidate.new_outro_image_url ??
      candidate.newOutroImageUrl;

    return (hasTextValue(ctaUrl) || hasOutroCtaImagePayload(outroCtaImage)) && !hasTextValue(outroImageUrl);
  });
}

function createDefaultPostProcessingForm() {
  return cloneJsonValue(DEFAULT_POST_PROCESSING_FORM);
}

function normalizeRerollLayerIndexes(value) {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  const indexes = source
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1);
  return [...new Set(indexes)].sort((a, b) => a - b);
}

function normalizeRerollLayerType(layer) {
  const value = layer?.layerBaseAiImageType || layer?.layerAiVideoType;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function looksLikeStudioVideoRoute(value) {
  return typeof value === 'string' && /^\/?video\/[a-f0-9]{24}$/i.test(value.trim());
}

function isDirectProcessorAssetPath(value) {
  return DIRECT_PROCESSOR_ASSET_PREFIXES.some((prefix) => value.startsWith(prefix));
}

function isRemoteUserResourcePath(value) {
  return value.startsWith('assets_v2/user_resources/') ||
    value.startsWith(USER_RESOURCES_PREFIX);
}

function buildProcessorAssetUrl(relativePath) {
  const normalizedPath = String(relativePath || '').replace(/^\/+/, '');
  return PROCESSOR_API_URL ? `${PROCESSOR_API_URL}/${normalizedPath}` : `/${normalizedPath}`;
}

function hasExpiredCloudFrontSignature(url) {
  const expires = Number(url.searchParams.get('Expires'));
  return Number.isFinite(expires) && expires > 0 && expires * 1000 <= Date.now() + 60_000;
}

function getProcessorAssetFallbackUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';

  const relativePath = trimmed.replace(/^\/+/, '');
  if (isDirectProcessorAssetPath(relativePath) && !isRemoteUserResourcePath(relativePath)) {
    return buildProcessorAssetUrl(relativePath);
  }

  if (!/^https?:\/\//i.test(trimmed)) {
    return '';
  }

  try {
    const parsedUrl = new URL(trimmed);
    const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
    return isDirectProcessorAssetPath(pathname) && !isRemoteUserResourcePath(pathname)
      ? buildProcessorAssetUrl(pathname)
      : '';
  } catch {
    return '';
  }
}

function normalizeRerollAssetUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (looksLikeStudioVideoRoute(trimmed)) return '';
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    return trimmed;
  }

  const relativePath = trimmed.replace(/^\/+/, '');
  if (isRemoteUserResourcePath(relativePath)) {
    return `${STATIC_ASSET_BASE_URL}/${relativePath}`;
  }
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    try {
      const parsedUrl = new URL(trimmed);
      const pathname = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, '');
      if (isRemoteUserResourcePath(pathname)) {
        return `${STATIC_ASSET_BASE_URL}/${pathname}${parsedUrl.search || ''}`;
      }
      if (
        isDirectProcessorAssetPath(pathname) &&
        !isRemoteUserResourcePath(pathname) &&
        hasExpiredCloudFrontSignature(parsedUrl)
      ) {
        return buildProcessorAssetUrl(pathname);
      }
    } catch {
      return trimmed;
    }
    return trimmed;
  }
  if (isDirectProcessorAssetPath(relativePath)) {
    return buildProcessorAssetUrl(relativePath);
  }
  return `${PROCESSOR_API_URL}/${relativePath}`;
}

function getRerollAssetUrlPair(values = []) {
  for (const value of values) {
    const url = normalizeRerollAssetUrl(value);
    if (!url) continue;
    const fallbackUrl = getProcessorAssetFallbackUrl(value) || getProcessorAssetFallbackUrl(url);
    return {
      url,
      fallbackUrl: fallbackUrl && fallbackUrl !== url ? fallbackUrl : '',
    };
  }
  return { url: '', fallbackUrl: '' };
}

function isRerollCandidateLayer(layer) {
  const layerType = normalizeRerollLayerType(layer);
  return Boolean(
    layer &&
    layer.skipAiVideoGeneration !== true &&
    layerType !== 'none' &&
    layerType !== 'outro'
  );
}

function getRawItemAssetUrl(item) {
  if (!item || typeof item !== 'object') return '';
  return (
    item.url ||
    item.previewUrl ||
    item.preview_url ||
    item.signedUrl ||
    item.signed_url ||
    item.displayUrl ||
    item.display_url ||
    item.src ||
    item.imageUrl ||
    item.image_url ||
    item.rawUrl ||
    item.raw_url ||
    item.enhanced_url ||
    item.enhancedUrl ||
    item.assetPath ||
    item.path ||
    (typeof item.image === 'string' && item.image.includes('/') ? item.image : '')
  );
}

function getLayerVisualUrl(layer) {
  const detailedItemUrl = Array.isArray(layer?.image?.items)
    ? layer.image.items.find((item) => item?.isPrimary)?.url || layer.image.items[0]?.url
    : '';
  const rawActiveItems = Array.isArray(layer?.imageSession?.activeItemList)
    ? layer.imageSession.activeItemList
    : [];
  const rawBaseItem = rawActiveItems.find((item) => item?.is_base_image === true) ||
    rawActiveItems.find((item) => item?.type === 'image') ||
    rawActiveItems[0] ||
    null;
  const frameImages = layer?.frameImages || {};
  const candidates = [
    frameImages.startFrameUrl,
    frameImages.startFrame,
    frameImages.aiLayerStartFrame,
    frameImages.baseLayerStartFrame,
    frameImages.aiVideoThumbnailPath,
    frameImages.thumbnailPath,
    layer?.aiLayerStartFrame,
    layer?.baseLayerStartFrame,
    layer?.aiVideoThumbnailPath,
    layer?.thumbnailPath,
    layer?.preview?.type !== 'video' ? layer?.preview?.url : '',
    layer?.image?.url,
    detailedItemUrl,
    getRawItemAssetUrl(rawBaseItem),
    layer?.imageSession?.activeImageRemoteLink,
    layer?.imageSession?.activeGeneratedImage,
    layer?.imageSession?.activeEditedImage,
    layer?.imageSession?.activeSelectedImage,
    layer?.thumbnailPath,
    layer?.aiVideoThumbnailPath,
  ];
  return getRerollAssetUrlPair(candidates);
}

function getLayerPreviewVideoUrlPair(layer) {
  const candidates = [
    layer?.lipSyncVideo?.url,
    layer?.soundEffectVideo?.url,
    layer?.userVideo?.url,
    layer?.aiVideo?.url,
    layer?.preview?.type === 'video' ? layer?.preview?.url : '',
    layer?.lipSyncRemoteLink,
    layer?.soundEffectRemoteLink,
    layer?.userVideoRemoteLink,
    layer?.aiVideoRemoteLink,
    layer?.lipSyncVideoLayer,
    layer?.soundEffectVideoLayer,
    layer?.userVideoLayer,
    layer?.aiVideoLayer,
  ];
  return getRerollAssetUrlPair(candidates);
}

function getRerollPromptPreview(layer) {
  const prompt =
    layer?.originalImagePrompt ||
    layer?.sourcePrompt ||
    layer?.originalPrompt ||
    layer?.imageSession?.originalImagePrompt ||
    layer?.imageSession?.sourcePrompt ||
    layer?.imageSession?.originalPrompt ||
    layer?.image?.prompt ||
    layer?.imageSession?.prompt ||
    layer?.prompt ||
    '';
  return typeof prompt === 'string' ? prompt.trim().slice(0, 80) : '';
}

function getRerollCandidateLayers(session) {
  const layers = Array.isArray(session?.layers) ? session.layers : [];
  return layers
    .map((layer, index) => {
      const visualUrlPair = getLayerVisualUrl(layer);
      const videoUrlPair = getLayerPreviewVideoUrlPair(layer);
      return {
        layer,
        layerIndex: index + 1,
        layerId: layer?._id || layer?.id || `${index + 1}`,
        duration: Number(layer?.duration) || 0,
        promptPreview: getRerollPromptPreview(layer),
        visualUrl: visualUrlPair.url,
        visualFallbackUrl: visualUrlPair.fallbackUrl,
        videoUrl: videoUrlPair.url,
        videoFallbackUrl: videoUrlPair.fallbackUrl,
      };
    })
    .filter((item) => isRerollCandidateLayer(item.layer));
}

function getRerollLocalCreditEstimate({
  layerIndexes,
  candidateLayers,
  imageModel,
  videoModel,
  aspectRatio,
}) {
  const selectedIndexes = normalizeRerollLayerIndexes(layerIndexes);
  if (!selectedIndexes.length) {
    return null;
  }

  const selectedIndexSet = new Set(selectedIndexes);
  const selectedLayers = candidateLayers.filter((item) => selectedIndexSet.has(item.layerIndex));
  if (!selectedLayers.length) {
    return null;
  }

  const imageCreditsPerLayer = getImageCreditsForModel(imageModel, aspectRatio);
  const videoStageCreditsPerSecond =
    getExpressVideoPricingDistributionPerSecond(videoModel)?.video ?? 0;
  const durationSeconds = selectedLayers.reduce((total, item) => total + (Number(item.duration) || 0), 0);
  const imageCredits = Math.ceil(imageCreditsPerLayer * selectedLayers.length);
  const aiVideoCredits = Math.ceil(Math.max(0, durationSeconds * videoStageCreditsPerSecond));

  return {
    totalCredits: imageCredits + aiVideoCredits,
    imageCredits,
    aiVideoCredits,
  };
}

function RerollScenePreviewTile({
  item,
  isSelected,
  isPlaying,
  isDisabled,
  colorMode,
  mutedText,
  activeActionClass,
  inactiveActionClass,
  onToggleSelect,
  onTogglePlayback,
}) {
  const videoRef = useRef(null);
  const [currentVideoUrl, setCurrentVideoUrl] = useState(item.videoUrl || '');
  const [currentVisualUrl, setCurrentVisualUrl] = useState(item.visualUrl || '');
  const [videoLoadFailed, setVideoLoadFailed] = useState(false);

  useEffect(() => {
    setCurrentVideoUrl(item.videoUrl || '');
    setCurrentVisualUrl(item.visualUrl || '');
    setVideoLoadFailed(false);
  }, [item.videoFallbackUrl, item.videoUrl, item.visualFallbackUrl, item.visualUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying && currentVideoUrl && !videoLoadFailed) {
      const playPromise = video.play();
      if (playPromise?.catch) playPromise.catch(() => undefined);
    } else {
      video.pause();
    }
  }, [currentVideoUrl, isPlaying, videoLoadFailed]);

  const handleVideoError = () => {
    if (item.videoFallbackUrl && currentVideoUrl !== item.videoFallbackUrl) {
      setCurrentVideoUrl(item.videoFallbackUrl);
      setVideoLoadFailed(false);
      return;
    }
    setVideoLoadFailed(true);
    if (isPlaying) {
      onTogglePlayback(null);
    }
  };

  const handleImageError = () => {
    if (item.visualFallbackUrl && currentVisualUrl !== item.visualFallbackUrl) {
      setCurrentVisualUrl(item.visualFallbackUrl);
      return;
    }
    setCurrentVisualUrl('');
  };

  const handlePlaybackClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (isDisabled || !currentVideoUrl || videoLoadFailed) return;

    const video = videoRef.current;
    if (isPlaying) {
      video?.pause();
      onTogglePlayback(null);
      return;
    }

    onTogglePlayback(item.layerId);
  };

  const handleSelect = () => {
    if (!isDisabled) {
      onToggleSelect(item.layerIndex);
    }
  };

  const handleSelectKeyDown = (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleSelect();
    }
  };

  const canAttemptPlayback = Boolean(currentVideoUrl) && !videoLoadFailed;
  const shouldShowVideo = isPlaying && canAttemptPlayback;

  return (
    <div
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      onClick={handleSelect}
      onKeyDown={handleSelectKeyDown}
      aria-pressed={isSelected}
      aria-disabled={isDisabled}
      className={`
        min-h-[146px] rounded-lg p-1.5 text-left text-xs ring-1 transition
        ${isSelected ? activeActionClass : inactiveActionClass}
        ${isDisabled ? 'cursor-not-allowed opacity-50' : 'active:scale-[0.99]'}
      `}
    >
      <div className={`relative aspect-video w-full overflow-hidden rounded-md ${
        colorMode === 'dark' ? 'bg-slate-900' : 'bg-slate-100'
      }`}>
        {currentVisualUrl ? (
          <img
            src={currentVisualUrl}
            alt={`Scene ${item.layerIndex}`}
            loading="lazy"
            onError={handleImageError}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className={`flex h-full w-full items-center justify-center ${mutedText}`}>
            <FaImage className="h-5 w-5" aria-hidden="true" />
          </div>
        )}
        {shouldShowVideo ? (
          <video
            ref={videoRef}
            src={currentVideoUrl}
            preload="auto"
            autoPlay
            playsInline
            loop
            muted
            onError={handleVideoError}
            onLoadedData={() => setVideoLoadFailed(false)}
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : null}
        <span className="absolute left-1.5 top-1.5 rounded bg-black/65 px-1.5 py-0.5 text-[11px] font-semibold text-white">
          Scene {item.layerIndex}
        </span>
        {canAttemptPlayback ? (
          <button
            type="button"
            disabled={isDisabled}
            aria-label={`${isPlaying ? 'Pause' : 'Play'} scene ${item.layerIndex} preview`}
            title={`${isPlaying ? 'Pause' : 'Play'} scene preview`}
            onClick={handlePlaybackClick}
            className={`
              absolute bottom-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full
              bg-black/70 text-white shadow transition hover:bg-black/85
              ${isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
            `}
          >
            {isPlaying ? (
              <FaPause className="h-3 w-3" aria-hidden="true" />
            ) : (
              <FaPlay className="h-3 w-3 translate-x-px" aria-hidden="true" />
            )}
          </button>
        ) : null}
        {isSelected ? (
          <span className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-cyan-300 text-slate-950 shadow">
            <FaCheck className="h-3 w-3" aria-hidden="true" />
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate font-semibold">Scene {item.layerIndex}</span>
        <span className={mutedText}>{item.duration ? `${item.duration}s` : ''}</span>
      </div>
      {item.promptPreview ? (
        <div className={`mt-1 truncate ${mutedText}`}>{item.promptPreview}</div>
      ) : null}
    </div>
  );
}

function getJsonModelByKey(modelTypes, modelKey) {
  if (typeof modelKey !== 'string') {
    return null;
  }
  const normalizedKey = modelKey.trim();
  return modelTypes.find((model) => model.key === normalizedKey) || null;
}

function imageModelSupportsAspectRatio(modelKey, aspectRatio) {
  const normalizedKey = resolveJsonImageModelAlias(modelKey);
  const pricing = IMAGE_MODEL_PRICES.find((model) => model.key === normalizedKey);
  if (!pricing || !Array.isArray(pricing.prices)) {
    return false;
  }
  return pricing.prices.some((price) => price.aspectRatio === aspectRatio);
}

function getImageCreditsForModel(modelKey, aspectRatio) {
  const normalizedKey = resolveJsonImageModelAlias(modelKey || '');
  const pricing = IMAGE_MODEL_PRICES.find((model) => model.key === normalizedKey);
  const price =
    pricing?.prices?.find((entry) => entry.aspectRatio === aspectRatio)?.price ??
    pricing?.prices?.find((entry) => entry.aspectRatio === '1:1')?.price ??
    pricing?.prices?.[0]?.price;
  return Number.isFinite(Number(price)) ? Number(price) : 0;
}

function videoModelSupportsAspectRatio(modelKey, aspectRatio) {
  const model = getJsonModelByKey(VIDEO_GENERATION_MODEL_TYPES, modelKey);
  if (!model) {
    return false;
  }
  return Array.isArray(model.supportedAspectRatios)
    ? model.supportedAspectRatios.includes(aspectRatio)
    : true;
}

function normalizeJsonInputAliases(input) {
  if (!isPlainObject(input)) {
    return;
  }

  const aliases = [
    ['aspect_ratio', ['aspectRatio']],
    ['image_model', ['imageModel']],
    ['video_model', ['videoModel']],
    ['video_model_sub_type', ['videoModelSubType']],
    ['enable_subtitles', ['enableSubtitles']],
    ['subtitle_language', ['subtitleLanguage']],
    ['font_key', ['fontKey']],
    ['generate_outro_image', ['generateOutroImage']],
    ['add_outro_animation', ['addOutroAnimation']],
    ['add_outro_focus_area', ['addOutroFocusArea']],
    ['outro_focust_area', ['outro_focus_area', 'outroFocustArea', 'outroFocusArea']],
    ['cta_url', ['ctaUrl']],
    ['cta_text_top', ['ctaTextTop']],
    ['cta_text_bottom', ['ctaTextBottom']],
    ['cta_logo', ['ctaLogo']],
    ['outro_cta_image', ['outroCtaImage', 'cta_image', 'ctaImage']],
    ['add_footer_animation', ['addFooterAnimation']],
    ['footer_metadata', ['footerMetadata']],
    ['limit_single_narrator', ['limitSingleNarrator']],
    ['add_narrator_avatar', ['addNarratorAvatar']],
    ['inference_model', ['inferenceModel']],
  ];

  for (const [canonicalName, aliasNames] of aliases) {
    if (input[canonicalName] !== undefined) {
      continue;
    }
    const aliasName = aliasNames.find((name) => input[name] !== undefined);
    if (aliasName) {
      input[canonicalName] = input[aliasName];
    }
  }
}

function buildDefaultJsonModeInput({
  mode,
  imageModel,
  videoModel,
  duration,
  aspectRatio,
  language,
  enableSubtitles,
  subtitleLanguage,
  inferenceModel,
}) {
  const normalizedAspectRatio = aspectRatio === '9:16' ? '9:16' : '16:9';
  const normalizedLanguage = language || 'en';
  const normalizedVideoModel = videoModel || '';
  const languageFields = buildVidgenieLanguageFields({
    audioLanguage: normalizedLanguage,
    enableSubtitles,
    subtitleLanguage,
  });

  if (mode === 'I2V') {
    return JSON.stringify(
      {
        image_urls: [
          {
            image_url: 'https://cdn.example.com/frame-1.png',
            title: 'Opening frame',
            image_text: 'Describe what should drive the first scene.',
          },
          {
            image_url: 'https://cdn.example.com/frame-2.png',
            title: 'Second frame',
            image_text: 'Describe what should drive the second scene.',
          },
        ],
        metadata: {
          project: 'launch_trailer',
        },
        prompt: 'Create a polished short video from these images.',
        image_model: imageModel || '',
        video_model: normalizedVideoModel,
        aspect_ratio: normalizedAspectRatio,
        ...languageFields,
        font_key: 'Poppins',
        inference_model: normalizeInferenceModelKey(inferenceModel),
        limit_single_narrator: false,
        add_narrator_avatar: false,
        add_footer_animation: true,
        footer_metadata: [
          {
            url: 'https://example.com',
            title: 'Learn more',
          },
          {
            url: 'https://example.com',
            title: 'Get started',
          },
        ],
        generate_outro_image: true,
        cta_url: 'https://example.com',
        cta_text_top: 'Build with SamsarOne',
        cta_text_bottom: 'Scan or visit example.com',
      },
      null,
      2,
    );
  }

  return JSON.stringify(
    {
      prompt: 'A 30 second launch teaser for a new travel app',
      image_model: imageModel || '',
      video_model: normalizedVideoModel,
      duration: duration || 30,
      tone: 'grounded',
      aspect_ratio: normalizedAspectRatio,
      ...languageFields,
      font_key: 'Poppins',
      inference_model: normalizeInferenceModelKey(inferenceModel),
    },
    null,
    2,
  );
}

function extractJsonLikeSegment(rawJson) {
  const source = typeof rawJson === 'string' ? rawJson.trim() : '';
  if (!source || source.startsWith('{') || source.startsWith('[')) {
    return source;
  }

  let inString = false;
  let quote = '';
  let escaped = false;
  let startIndex = -1;
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      quote = char;
      continue;
    }

    if (char !== '{' && char !== '[') {
      continue;
    }

    const opening = char;
    const closing = opening === '{' ? '}' : ']';
    startIndex = index;
    depth = 1;

    for (let cursor = index + 1; cursor < source.length; cursor += 1) {
      const innerChar = source[cursor];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (innerChar === '\\') {
          escaped = true;
        } else if (innerChar === quote) {
          inString = false;
          quote = '';
        }
        continue;
      }

      if (innerChar === '"' || innerChar === "'" || innerChar === '`') {
        inString = true;
        quote = innerChar;
        continue;
      }

      if (innerChar === opening) {
        depth += 1;
      } else if (innerChar === closing) {
        depth -= 1;
        if (depth === 0) {
          return source.slice(startIndex, cursor + 1);
        }
      }
    }

    return source.slice(startIndex);
  }

  return source;
}

function stripJsonLikeComments(source) {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const nextChar = source[index + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === '/' && nextChar === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      output += '\n';
      continue;
    }

    if (char === '/' && nextChar === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function normalizeSingleQuotedJsonLikeStrings(source) {
  let output = '';
  let inDoubleString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inDoubleString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inDoubleString = false;
      }
      continue;
    }

    if (char === '"') {
      inDoubleString = true;
      output += char;
      continue;
    }

    if (char !== "'") {
      output += char;
      continue;
    }

    let value = '';
    index += 1;

    for (; index < source.length; index += 1) {
      const innerChar = source[index];
      const nextChar = source[index + 1];

      if (innerChar === "'") {
        break;
      }

      if (innerChar === '\\') {
        if (nextChar === undefined) {
          value += '\\';
          break;
        }
        if (nextChar === 'n') value += '\n';
        else if (nextChar === 'r') value += '\r';
        else if (nextChar === 't') value += '\t';
        else if (nextChar === 'b') value += '\b';
        else if (nextChar === 'f') value += '\f';
        else if (nextChar === '\n') {
          // JavaScript line continuation in a pasted object literal.
        } else {
          value += nextChar;
        }
        index += 1;
        continue;
      }

      value += innerChar;
    }

    output += JSON.stringify(value);
  }

  return output;
}

function quoteUnquotedJsonLikeKeys(source) {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  const isKeyStart = (char) => /[A-Za-z_$]/.test(char);
  const isKeyChar = (char) => /[A-Za-z0-9_$-]/.test(char);

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (!isKeyStart(char)) {
      output += char;
      continue;
    }

    let previousIndex = output.length - 1;
    while (previousIndex >= 0 && /\s/.test(output[previousIndex])) {
      previousIndex -= 1;
    }
    const previousChar = previousIndex >= 0 ? output[previousIndex] : '';

    let cursor = index + 1;
    while (cursor < source.length && isKeyChar(source[cursor])) {
      cursor += 1;
    }

    let colonIndex = cursor;
    while (colonIndex < source.length && /\s/.test(source[colonIndex])) {
      colonIndex += 1;
    }

    if ((previousChar === '{' || previousChar === ',') && source[colonIndex] === ':') {
      output += JSON.stringify(source.slice(index, cursor));
      index = cursor - 1;
      continue;
    }

    output += char;
  }

  return output;
}

function removeTrailingJsonLikeCommas(source) {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      quote = char;
      output += char;
      continue;
    }

    if (char === ',') {
      let nextIndex = index + 1;
      while (nextIndex < source.length && /\s/.test(source[nextIndex])) {
        nextIndex += 1;
      }
      if (source[nextIndex] === '}' || source[nextIndex] === ']') {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function repairJsonLikeInput(rawJson) {
  return removeTrailingJsonLikeCommas(
    quoteUnquotedJsonLikeKeys(
      normalizeSingleQuotedJsonLikeStrings(
        stripJsonLikeComments(extractJsonLikeSegment(rawJson)),
      ),
    ),
  ).trim();
}

function parseJsonOrRepair(rawJson) {
  const trimmed = typeof rawJson === 'string' ? rawJson.trim() : '';
  try {
    return {
      value: JSON.parse(trimmed),
      normalizedJson: null,
      repaired: false,
    };
  } catch (originalError) {
    const repairedJson = repairJsonLikeInput(trimmed);
    try {
      const value = JSON.parse(repairedJson);
      return {
        value,
        normalizedJson: JSON.stringify(value, null, 2),
        repaired: repairedJson !== trimmed,
      };
    } catch {
      return { error: originalError };
    }
  }
}

function getJsonErrorLocation(rawJson, error) {
  const message = error?.message || '';
  const lineColumnMatch = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColumnMatch) {
    return {
      row: Math.max(0, Number(lineColumnMatch[1]) - 1),
      column: Math.max(0, Number(lineColumnMatch[2]) - 1),
    };
  }

  const positionMatch = message.match(/position\s+(\d+)/i);
  if (!positionMatch) {
    return { row: 0, column: 0 };
  }

  const errorIndex = Math.max(0, Number(positionMatch[1]));
  const beforeError = rawJson.slice(0, errorIndex);
  const lines = beforeError.split('\n');
  return {
    row: Math.max(0, lines.length - 1),
    column: Math.max(0, lines[lines.length - 1]?.length || 0),
  };
}

function getJsonParseErrorDetails(rawJson, error) {
  const trimmed = typeof rawJson === 'string' ? rawJson.trim() : '';
  const location = getJsonErrorLocation(rawJson, error);
  if (/^(const|let|var)\s/.test(trimmed) || /^await\s/.test(trimmed) || /samsar\.\w+\(/.test(trimmed)) {
    return {
      ...location,
      error: 'JSON mode accepts raw JSON only. Paste the request body object, not JavaScript or SDK code. JSON needs double-quoted keys and strings, and no const/await/function call wrapper.',
    };
  }
  if (error?.message?.includes('Expected property name') || /[{,]\s*[A-Za-z_$][\w$-]*\s*:/.test(trimmed)) {
    return {
      ...location,
      error: 'Invalid JSON: property names must be wrapped in double quotes. Use "image_urls": instead of image_urls:.',
    };
  }

  return {
    ...location,
    error: `Invalid JSON: ${error.message}`,
  };
}

function normalizeJsonEndpoint(value, selectedMode = 'T2V') {
  const rawEndpoint =
    typeof value === 'string' && value.trim().length > 0
      ? value.trim().toLowerCase()
      : '';
  const normalizedEndpoint = rawEndpoint
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/+/, '')
    .replace(/^v\d+\//, '')
    .replace(/^video\//, '')
    .replace(/-/g, '_');

  if (
    normalizedEndpoint === 'image_list_to_video' ||
    normalizedEndpoint === 'image_to_video' ||
    normalizedEndpoint.endsWith('/image_to_video') ||
    normalizedEndpoint.endsWith('/image_list_to_video')
  ) {
    return { endpoint: 'image_list_to_video' };
  }

  if (
    normalizedEndpoint === 'text_to_video' ||
    normalizedEndpoint.endsWith('/text_to_video')
  ) {
    return { endpoint: 'text_to_video' };
  }

  if (rawEndpoint) {
    return {
      error: 'JSON endpoint must be text_to_video, image_list_to_video, image_to_video, or a matching /v2/video/step route.',
    };
  }

  return {
    endpoint: selectedMode === 'I2V' ? 'image_list_to_video' : 'text_to_video',
  };
}

function validateJsonSessionId(payload, input, currentSessionId) {
  const sessionIds = [
    payload.session_id,
    payload.sessionId,
    payload.sessionID,
    input.session_id,
    input.sessionId,
    input.sessionID,
  ].filter((value) => typeof value === 'string' && value.trim().length > 0);

  const mismatchedSessionId = sessionIds.find((value) => value.trim() !== currentSessionId);
  if (mismatchedSessionId) {
    return {
      error: 'JSON session_id must match the current Vidgenie session.',
    };
  }

  return {};
}

function hasJsonImageUrlValue(item) {
  if (typeof item === 'string') {
    return item.trim().length > 0;
  }
  if (!isPlainObject(item)) {
    return false;
  }
  return [
    item.image_url,
    item.imageUrl,
    item.url,
    item.src,
    item.enhanced_url,
    item.enhancedUrl,
  ].some((value) => typeof value === 'string' && value.trim().length > 0);
}

function validateCommonJsonInput(input, inferenceModelOptions = INFERENCE_MODEL_TYPES) {
  if (!isPlainObject(input)) {
    return 'JSON input must be an object.';
  }

  const aspectRatio = input.aspect_ratio || '16:9';

  if (
    input.aspect_ratio !== undefined &&
    !JSON_MODE_ASPECT_RATIOS.includes(input.aspect_ratio)
  ) {
    return `JSON input.aspect_ratio must be one of: ${formatAllowedJsonValues(JSON_MODE_ASPECT_RATIOS)}.`;
  }

  if (input.language !== undefined) {
    if (typeof input.language !== 'string') {
      return 'JSON input.language must be a string when provided.';
    }
    const normalizedLanguage = resolveLanguageCode(input.language, '');
    if (!normalizedLanguage) {
      const languageValues = ['auto', ...SUPPORTED_LANGUAGES.map((lang) => lang.code)];
      return `JSON input.language must be one of: ${formatAllowedJsonValues(languageValues)}.`;
    }
    input.language = normalizedLanguage;
  }

  if (input.font_key !== undefined && typeof input.font_key !== 'string') {
    return 'JSON input.font_key must be a string when provided.';
  }

  if (
    input.enable_subtitles !== undefined &&
    typeof input.enable_subtitles !== 'boolean'
  ) {
    return 'JSON input.enable_subtitles must be a boolean when provided.';
  }

  if (input.subtitle_language !== undefined) {
    if (typeof input.subtitle_language !== 'string') {
      return 'JSON input.subtitle_language must be a string when provided.';
    }
    const normalizedSubtitleLanguage = resolveLanguageCode(input.subtitle_language, '');
    if (!normalizedSubtitleLanguage || normalizedSubtitleLanguage === 'auto') {
      const subtitleLanguageValues = SUPPORTED_LANGUAGES.map((lang) => lang.code);
      return `JSON input.subtitle_language must be one of: ${formatAllowedJsonValues(subtitleLanguageValues)}.`;
    }
    input.subtitle_language = normalizedSubtitleLanguage;
  }

  if (
    input.add_outro_animation !== undefined &&
    typeof input.add_outro_animation !== 'boolean'
  ) {
    return 'JSON input.add_outro_animation must be a boolean when provided.';
  }

  if (
    input.add_outro_focus_area !== undefined &&
    typeof input.add_outro_focus_area !== 'boolean'
  ) {
    return 'JSON input.add_outro_focus_area must be a boolean when provided.';
  }

  if (
    input.generate_outro_image !== undefined &&
    typeof input.generate_outro_image !== 'boolean'
  ) {
    return 'JSON input.generate_outro_image must be a boolean when provided.';
  }

  if (
    input.add_footer_animation !== undefined &&
    typeof input.add_footer_animation !== 'boolean'
  ) {
    return 'JSON input.add_footer_animation must be a boolean when provided.';
  }

  if (
    input.footer_metadata !== undefined &&
    !Array.isArray(input.footer_metadata)
  ) {
    return 'JSON input.footer_metadata must be an array when provided.';
  }

  if (input.cta_url !== undefined && typeof input.cta_url !== 'string') {
    return 'JSON input.cta_url must be a string when provided.';
  }

  const outroCtaImageError = validateOutroCtaImagePayload(input.outro_cta_image);
  if (outroCtaImageError) {
    return outroCtaImageError;
  }

  if (
    input.generate_outro_image === true &&
    (typeof input.cta_url !== 'string' || input.cta_url.trim().length === 0) &&
    !hasOutroCtaImagePayload(input.outro_cta_image)
  ) {
    return 'JSON input.cta_url or input.outro_cta_image is required when generate_outro_image is true.';
  }

  if (hasTextValue(input.cta_url) && !isHttpUrl(input.cta_url)) {
    return 'JSON input.cta_url must be an http or https URL.';
  }

  if (input.cta_text_top !== undefined && typeof input.cta_text_top !== 'string') {
    return 'JSON input.cta_text_top must be a string when provided.';
  }

  if (input.cta_text_bottom !== undefined && typeof input.cta_text_bottom !== 'string') {
    return 'JSON input.cta_text_bottom must be a string when provided.';
  }

  if (input.cta_logo !== undefined && typeof input.cta_logo !== 'string') {
    return 'JSON input.cta_logo must be a string when provided.';
  }

  if (Array.isArray(input.footer_metadata)) {
    const invalidFooterIndex = input.footer_metadata.findIndex((entry) => {
      if (!isPlainObject(entry)) return true;
      const url = entry.url ?? entry.ctaUrl ?? entry.cta_url;
      const title = entry.title ?? entry.ctaText ?? entry.cta_text ?? entry.text ?? entry.name ?? entry.label;
      const logo = entry.logoUrl ?? entry.ctaLogo ?? entry.cta_logo ?? entry.logo_url ?? entry.footer_logo_url;
      if (url !== undefined && (typeof url !== 'string' || !isHttpUrl(url))) return true;
      if (title !== undefined && typeof title !== 'string') return true;
      if (logo !== undefined && typeof logo !== 'string') return true;
      return !hasTextValue(url) && !hasTextValue(title) && !hasTextValue(logo);
    });
    if (invalidFooterIndex >= 0) {
      return `JSON input.footer_metadata[${invalidFooterIndex}] must include a valid http(s) url, title/text, or logo URL.`;
    }
  }

  if (input.add_footer_animation === true && (!Array.isArray(input.footer_metadata) || input.footer_metadata.length === 0)) {
    return 'JSON input.footer_metadata must include at least one item when add_footer_animation is true.';
  }

  if (input.inference_model !== undefined) {
    if (typeof input.inference_model !== 'string') {
      return 'JSON input.inference_model must be a string when provided.';
    }
    if (!isSupportedInferenceModelKey(input.inference_model, inferenceModelOptions)) {
      const allowedModels = inferenceModelOptions.map((option) => option.value).join(', ');
      return `JSON input.inference_model must be one of: ${allowedModels || 'no configured models'}.`;
    }
    input.inference_model = normalizeInferenceModelKey(input.inference_model);
    input.inferenceModel = input.inference_model;
  }

  if (input.add_outro_focus_area === true && input.add_outro_animation !== true) {
    return 'JSON input.add_outro_focus_area requires add_outro_animation to be true.';
  }

  if (input.outro_focust_area !== undefined) {
    if (!isPlainObject(input.outro_focust_area)) {
      return 'JSON input.outro_focust_area must be an object when provided.';
    }
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isFinite(Number(input.outro_focust_area[key]))) {
        return `JSON input.outro_focust_area.${key} must be a finite number.`;
      }
    }
  }

  if (aspectRatio && !JSON_MODE_ASPECT_RATIOS.includes(aspectRatio)) {
    return `JSON input.aspect_ratio must be one of: ${formatAllowedJsonValues(JSON_MODE_ASPECT_RATIOS)}.`;
  }

  return null;
}

function isModelAllowedByDeployment(modelKey, modelValues = [], isDockerInstall = false) {
  if (!isDockerInstall) return true;
  const allowedModels = new Set(modelValues.map(normalizeDeploymentModelValue).filter(Boolean));
  return allowedModels.has(normalizeDeploymentModelValue(modelKey));
}

function getConfiguredModelError(fieldName, modelValues = []) {
  const allowedModels = formatAllowedJsonValues(modelValues);
  return `JSON input.${fieldName} must be one of the configured Docker models: ${allowedModels || 'none'}.`;
}

function validateStageImageModel(
  input,
  {
    stageName,
    allowedModelKeys,
    deploymentModelValues,
    isDockerInstall,
    required = true,
  }
) {
  if (typeof input.image_model !== 'string' || input.image_model.trim().length === 0) {
    return required ? `JSON input.image_model is required for ${stageName}.` : null;
  }

  const resolvedImageModel = resolveJsonImageModelAlias(input.image_model.trim());
  const imageModel = getJsonModelByKey(IMAGE_GENERAITON_MODEL_TYPES, resolvedImageModel);
  if (!imageModel || !allowedModelKeys.includes(resolvedImageModel)) {
    return `JSON input.image_model must be one of: ${formatAllowedJsonValues(allowedModelKeys)}.`;
  }
  if (!isModelAllowedByDeployment(resolvedImageModel, deploymentModelValues, isDockerInstall)) {
    return getConfiguredModelError('image_model', deploymentModelValues);
  }
  if (imageModel.isExpressModel !== true) {
    return 'JSON input.image_model must be an express model.';
  }
  if (!imageModelSupportsAspectRatio(resolvedImageModel, input.aspect_ratio || '16:9')) {
    return `JSON input.image_model ${resolvedImageModel} does not support aspect_ratio ${input.aspect_ratio || '16:9'}.`;
  }

  return null;
}

function validateTextToVideoJsonInput(
  input,
  inferenceModelOptions = INFERENCE_MODEL_TYPES,
  deploymentModelAvailability = {}
) {
  const commonError = validateCommonJsonInput(input, inferenceModelOptions);
  if (commonError) return commonError;
  const isDockerInstall = deploymentModelAvailability?.isDockerInstall === true;
  const textToVideoImageModelValues = deploymentModelAvailability?.textToVideoImageModelValues || [];
  const textToVideoVideoModelValues = deploymentModelAvailability?.textToVideoVideoModelValues || [];

  if (typeof input.prompt !== 'string' || input.prompt.trim().length === 0) {
    return 'JSON input.prompt is required for text_to_video.';
  }

  if (input.prompt.trim().length > VIDGENIE_PROMPT_MAX_LENGTH) {
    return `JSON input.prompt must be ${VIDGENIE_PROMPT_MAX_LENGTH} characters or fewer.`;
  }

  const imageModelError = validateStageImageModel(input, {
    stageName: 'text_to_video',
    allowedModelKeys: TEXT_TO_VIDEO_IMAGE_MODEL_KEYS,
    deploymentModelValues: textToVideoImageModelValues,
    isDockerInstall,
  });
  if (imageModelError) return imageModelError;

  if (typeof input.video_model !== 'string' || input.video_model.trim().length === 0) {
    return 'JSON input.video_model is required for text_to_video.';
  }

  const videoModelKey = input.video_model.trim();
  const videoModel = getJsonModelByKey(VIDEO_GENERATION_MODEL_TYPES, videoModelKey);
  if (!videoModel || !TEXT_TO_VIDEO_VIDEO_MODEL_KEYS.includes(videoModelKey)) {
    return `JSON input.video_model must be one of: ${formatAllowedJsonValues(TEXT_TO_VIDEO_VIDEO_MODEL_KEYS)}.`;
  }
  if (!isModelAllowedByDeployment(videoModelKey, textToVideoVideoModelValues, isDockerInstall)) {
    return getConfiguredModelError('video_model', textToVideoVideoModelValues);
  }
  if (videoModel.isExpressModel !== true) {
    return 'JSON input.video_model must be an express model.';
  }
  if (!videoModelSupportsAspectRatio(videoModelKey, input.aspect_ratio || '16:9')) {
    return `JSON input.video_model ${videoModelKey} does not support aspect_ratio ${input.aspect_ratio || '16:9'}.`;
  }

  if (
    input.video_model_sub_type !== undefined &&
    !JSON_MODE_VIDEO_MODEL_SUB_TYPES.includes(input.video_model_sub_type)
  ) {
    return `JSON input.video_model_sub_type must be one of: ${formatAllowedJsonValues(JSON_MODE_VIDEO_MODEL_SUB_TYPES)}.`;
  }

  const durationValue = Number(input.duration);
  if (!Number.isFinite(durationValue)) {
    return 'JSON input.duration is required for text_to_video.';
  }

  if (durationValue < 10 || durationValue > 240) {
    return 'JSON input.duration must be between 10 and 240 seconds.';
  }

  return null;
}

function validateImageListToVideoJsonInput(
  input,
  inferenceModelOptions = INFERENCE_MODEL_TYPES,
  deploymentModelAvailability = {}
) {
  const commonError = validateCommonJsonInput(input, inferenceModelOptions);
  if (commonError) return commonError;
  const isDockerInstall = deploymentModelAvailability?.isDockerInstall === true;
  const imageListToVideoImageModelValues = deploymentModelAvailability?.imageListToVideoImageModelValues || [];
  const imageListToVideoVideoModelValues = deploymentModelAvailability?.imageListToVideoVideoModelValues || [];

  const imageModelError = validateStageImageModel(input, {
    stageName: 'image_list_to_video',
    allowedModelKeys: IMAGE_LIST_TO_VIDEO_IMAGE_MODEL_KEYS,
    deploymentModelValues: imageListToVideoImageModelValues,
    isDockerInstall,
    required: false,
  });
  if (imageModelError) return imageModelError;

  if (!Array.isArray(input.image_urls) || input.image_urls.length === 0) {
    return 'JSON input.image_urls must be a non-empty array for image_list_to_video.';
  }

  if (input.image_urls.some((item) => !hasJsonImageUrlValue(item))) {
    return 'JSON input.image_urls entries must be non-empty URL strings or objects with image_url, imageUrl, url, src, enhanced_url, or enhancedUrl.';
  }

  if (input.metadata !== undefined && !isPlainObject(input.metadata)) {
    return 'JSON input.metadata must be an object when provided.';
  }

  if (input.prompt !== undefined && typeof input.prompt !== 'string') {
    return 'JSON input.prompt must be a string when provided.';
  }

  if (input.video_model !== undefined && typeof input.video_model !== 'string') {
    return 'JSON input.video_model must be a string when provided.';
  }

  if (hasTextValue(input.video_model)) {
    const videoModelKey = input.video_model.trim();
    const videoModel = getJsonModelByKey(VIDEO_GENERATION_MODEL_TYPES, videoModelKey);
    if (!videoModel || !IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS.includes(videoModelKey)) {
      return `JSON input.video_model must be one of: ${formatAllowedJsonValues(IMAGE_LIST_TO_VIDEO_VIDEO_MODEL_KEYS)}.`;
    }
    if (!isModelAllowedByDeployment(videoModelKey, imageListToVideoVideoModelValues, isDockerInstall)) {
      return getConfiguredModelError('video_model', imageListToVideoVideoModelValues);
    }
    if (!videoModelSupportsAspectRatio(videoModelKey, input.aspect_ratio || '16:9')) {
      return `JSON input.video_model ${videoModelKey} does not support aspect_ratio ${input.aspect_ratio || '16:9'}.`;
    }
  }

  if (
    input.add_footer_animation === true &&
    Array.isArray(input.footer_metadata) &&
    input.footer_metadata.length < input.image_urls.length
  ) {
    return 'JSON input.footer_metadata must include one item for each image when add_footer_animation is true.';
  }

  if (
    input.limit_single_narrator !== undefined &&
    typeof input.limit_single_narrator !== 'boolean'
  ) {
    return 'JSON input.limit_single_narrator must be a boolean when provided.';
  }

  if (
    input.add_narrator_avatar !== undefined &&
    typeof input.add_narrator_avatar !== 'boolean'
  ) {
    return 'JSON input.add_narrator_avatar must be a boolean when provided.';
  }

  return null;
}

function buildJsonModeRequest(
  rawJson,
  currentSessionId,
  selectedMode = 'T2V',
  inferenceModelOptions = INFERENCE_MODEL_TYPES,
  deploymentModelAvailability = {}
) {
  if (!hasTextValue(rawJson)) {
    return { error: 'JSON input is required.' };
  }

  const parsedInput = parseJsonOrRepair(rawJson);
  if (parsedInput.error) {
    return getJsonParseErrorDetails(rawJson, parsedInput.error);
  }
  const parsed = parsedInput.value;

  if (!isPlainObject(parsed)) {
    return { error: 'JSON input must be an object.' };
  }

  const payload = cloneJsonValue(parsed);
  const rawEndpoint =
    payload.endpoint ??
    payload.route ??
    payload.path ??
    payload.url;

  delete payload.endpoint;
  delete payload.route;
  delete payload.path;
  delete payload.url;
  delete payload.method;

  const input = isPlainObject(payload.input) ? payload.input : payload;
  normalizeJsonInputAliases(input);
  const sessionValidation = validateJsonSessionId(payload, input, currentSessionId);
  if (sessionValidation.error) {
    return sessionValidation;
  }

  const endpointResult = normalizeJsonEndpoint(rawEndpoint, selectedMode);
  if (endpointResult.error) {
    return endpointResult;
  }

  const inputValidationError =
    endpointResult.endpoint === 'image_list_to_video'
      ? validateImageListToVideoJsonInput(input, inferenceModelOptions, deploymentModelAvailability)
      : validateTextToVideoJsonInput(input, inferenceModelOptions, deploymentModelAvailability);
  if (inputValidationError) {
    return { error: inputValidationError };
  }

  input.session_id = currentSessionId;
  if (isPlainObject(payload.input)) {
    payload.input = input;
  }

  return {
    endpoint: endpointResult.endpoint,
    payload,
    ...(parsedInput.repaired && parsedInput.normalizedJson
      ? { normalizedJson: parsedInput.normalizedJson }
      : {}),
  };
}

function parseOptionalJsonValue(rawValue, label, validator) {
  if (!hasTextValue(rawValue)) {
    return { value: null };
  }

  const parsedValue = parseJsonOrRepair(rawValue);
  if (parsedValue.error) {
    return { error: `${label} must be valid JSON.` };
  }

  try {
    if (validator && !validator(parsedValue.value)) {
      return { error: `${label} must be valid JSON in the expected shape.` };
    }
    return { value: parsedValue.value, normalizedJson: parsedValue.normalizedJson };
  } catch {
    return { error: `${label} must be valid JSON.` };
  }
}

function normalizeSavedCustomAdapters(customAdapters) {
  return isPlainObject(customAdapters) ? customAdapters : {};
}

function getCustomAdapterOperationLabel(operationKey) {
  return (
    CUSTOM_ADAPTER_OPERATION_OPTIONS.find((operation) => operation.key === operationKey)?.label ||
    operationKey
  );
}

function getSavedCustomEndpointRows(customAdapters) {
  const savedAdapters = normalizeSavedCustomAdapters(customAdapters);
  const configuredEndpoints = Array.isArray(savedAdapters.custom_endpoints)
    ? savedAdapters.custom_endpoints
    : Array.isArray(savedAdapters.customEndpoints)
      ? savedAdapters.customEndpoints
      : [];

  const endpointRows = configuredEndpoints
    .map((endpoint, index) => {
      if (!isPlainObject(endpoint)) {
        return null;
      }
      const operationKey =
        hasTextValue(endpoint.operation) && CUSTOM_ADAPTER_OPERATION_OPTIONS.some(
          (operation) => operation.key === endpoint.operation.trim()
        )
          ? endpoint.operation.trim()
          : 'image_to_video';
      const baseUrl = endpoint.base_url || endpoint.baseUrl;
      const modelEndpoint =
        endpoint.endpoint ||
        endpoint.path ||
        endpoint.route ||
        endpoint.url ||
        endpoint[operationKey];
      if (!hasTextValue(baseUrl) || !hasTextValue(modelEndpoint)) {
        return null;
      }
      return {
        id: hasTextValue(endpoint.id) ? endpoint.id.trim() : `custom_endpoint_${index + 1}`,
        name: hasTextValue(endpoint.name) ? endpoint.name.trim() : modelEndpoint.trim(),
        provider: hasTextValue(endpoint.provider) ? endpoint.provider.trim() : 'fal',
        operationKey,
        operationLabel: getCustomAdapterOperationLabel(operationKey),
        baseUrl: baseUrl.trim(),
        endpoint: modelEndpoint.trim(),
      };
    })
    .filter(Boolean);

  if (endpointRows.length > 0) {
    return endpointRows;
  }

  if (!hasTextValue(savedAdapters.base_url)) {
    return [];
  }

  return CUSTOM_ADAPTER_OPERATION_OPTIONS
    .map((operation) => {
      const endpoint = savedAdapters[operation.key];
      if (!hasTextValue(endpoint)) {
        return null;
      }
      return {
        id: `legacy_${operation.key}`,
        name: operation.label,
        provider: 'fal',
        operationKey: operation.key,
        operationLabel: operation.label,
        baseUrl: savedAdapters.base_url.trim(),
        endpoint: endpoint.trim(),
      };
    })
    .filter(Boolean);
}

function getAvailableCustomAdapterEndpoints(customAdapters) {
  return getSavedCustomEndpointRows(customAdapters);
}

function buildSelectedCustomAdaptersPayload(customAdapters, selectedEndpointId = '') {
  if (!hasTextValue(selectedEndpointId)) {
    return null;
  }

  const selectedEndpoint = getSavedCustomEndpointRows(customAdapters).find(
    (endpoint) => endpoint.id === selectedEndpointId
  );
  if (!selectedEndpoint) {
    return null;
  }

  const payload = {
    base_url: selectedEndpoint.baseUrl,
    custom_endpoint_id: selectedEndpoint.id,
    custom_endpoint_name: selectedEndpoint.name,
    custom_endpoint_provider: selectedEndpoint.provider,
  };
  if (hasTextValue(selectedEndpoint.operationKey) && hasTextValue(selectedEndpoint.endpoint)) {
    payload[selectedEndpoint.operationKey] = selectedEndpoint.endpoint;
  }

  return CUSTOM_ADAPTER_OPERATION_OPTIONS.some((operation) => payload[operation.key])
    ? payload
    : null;
}

function buildAdvancedRequestConfiguration({
  isTextToVideo,
  advancedOptions,
  customAdapters,
  selectedCustomAdapterEndpointId,
  selectedInferenceModel,
  inferenceModelOptions = INFERENCE_MODEL_TYPES,
}) {
  const input = {};
  const root = {};

  const inferenceModelValue = selectedInferenceModel?.value || selectedInferenceModel;
  if (!isSupportedInferenceModelKey(inferenceModelValue, inferenceModelOptions)) {
    const allowedLabels = inferenceModelOptions.map((option) => option.label).join(', ');
    return { error: `Inference model must be one of: ${allowedLabels || 'no configured models'}.` };
  }
  input.inference_model = normalizeInferenceModelKey(inferenceModelValue);
  input.inferenceModel = input.inference_model;

  if (isTextToVideo && hasTextValue(advancedOptions.tone)) {
    input.tone = advancedOptions.tone.trim();
  }

  const shouldGenerateOutro = advancedOptions.generate_outro_image === true;
  if (shouldGenerateOutro) {
    input.generate_outro_image = true;
    const outroCtaType =
      advancedOptions.outro_cta_type === OUTRO_CTA_TYPE_IMAGE
        ? OUTRO_CTA_TYPE_IMAGE
        : OUTRO_CTA_TYPE_QR;

    if (outroCtaType === OUTRO_CTA_TYPE_IMAGE) {
      const middleImageUrl = advancedOptions.outro_cta_image_url?.trim() || '';
      if (!middleImageUrl) {
        return { error: 'CTA image URL or upload is required when CTA image outro is enabled.' };
      }
      if (!isHttpUrl(middleImageUrl)) {
        return { error: 'CTA image URL must be a valid http or https URL.' };
      }

      const outroCtaImage = {
        middle_image: { url: middleImageUrl },
      };
      if (hasTextValue(advancedOptions.cta_text_top)) {
        outroCtaImage.top_text = advancedOptions.cta_text_top.trim();
      }
      if (hasTextValue(advancedOptions.cta_text_bottom)) {
        outroCtaImage.bottom_text = advancedOptions.cta_text_bottom.trim();
      }
      input.outro_cta_image = outroCtaImage;
    } else {
      if (!hasTextValue(advancedOptions.cta_url)) {
        return { error: 'CTA URL is required when generated QR outro is enabled.' };
      }
      input.cta_url = advancedOptions.cta_url.trim();
      if (hasTextValue(advancedOptions.cta_text_top)) {
        input.cta_text_top = advancedOptions.cta_text_top.trim();
      }
      if (hasTextValue(advancedOptions.cta_text_bottom)) {
        input.cta_text_bottom = advancedOptions.cta_text_bottom.trim();
      }
      if (hasTextValue(advancedOptions.cta_logo)) {
        input.cta_logo = advancedOptions.cta_logo.trim();
      }
    }
  }

  if (hasTextValue(advancedOptions.footer_metadata)) {
    const parsedFooterMetadata = parseOptionalJsonValue(
      advancedOptions.footer_metadata,
      'Footer metadata',
      Array.isArray,
    );
    if (parsedFooterMetadata.error) {
      return { error: parsedFooterMetadata.error };
    }
    if (!parsedFooterMetadata.value || parsedFooterMetadata.value.length === 0) {
      return { error: 'Footer metadata must include at least one item.' };
    }
    input.footer_metadata = parsedFooterMetadata.value;
  }

  if (!isTextToVideo) {
    if (advancedOptions.add_narrator_avatar === true) {
      input.add_narrator_avatar = true;
      input.limit_single_narrator = true;
    } else if (advancedOptions.limit_single_narrator === true) {
      input.limit_single_narrator = true;
    }
  }

  const selectedCustomAdapters = buildSelectedCustomAdaptersPayload(
    customAdapters,
    selectedCustomAdapterEndpointId,
  );
  if (selectedCustomAdapters) {
    root.configuration = {
      custom_adapters: selectedCustomAdapters,
    };
  }

  return {
    input,
    root,
  };
}

function buildStepGenerationInput(stepMode) {
  const isTwoStep = stepMode === GENERATION_STEP_MODE_TWO_STEP;
  const autoRenderFullVideo = !isTwoStep;
  const manualStepStages = isTwoStep ? TWO_STEP_MANUAL_STAGES : [];

  return {
    generation_step_mode: stepMode,
    generationStepMode: stepMode,
    auto_render_full_video: autoRenderFullVideo,
    autoRenderFullVideo,
    manual_step_stages: manualStepStages,
    manualStepStages,
  };
}

function normalizeGenerationStepMode(stepMode) {
  return stepMode === GENERATION_STEP_MODE_TWO_STEP
    ? GENERATION_STEP_MODE_TWO_STEP
    : GENERATION_STEP_MODE_ONE_STEP;
}

function getRequestStepModeStorageKey(requestId) {
  return requestId ? `${VIDGENIE_REQUEST_STEP_MODE_STORAGE_PREFIX}:${requestId}` : null;
}

function persistRequestStepMode(requestIds, stepMode) {
  if (typeof window === 'undefined') return;
  const normalizedStepMode = normalizeGenerationStepMode(stepMode);
  const ids = Array.isArray(requestIds) ? requestIds : [requestIds];
  ids.forEach((requestId) => {
    const storageKey = getRequestStepModeStorageKey(requestId);
    if (!storageKey) return;
    try {
      window.localStorage.setItem(storageKey, normalizedStepMode);
    } catch {
      // Ignore storage failures; the in-memory request mode still protects the active request.
    }
  });
}

function getPersistedRequestStepMode(requestId) {
  if (typeof window === 'undefined') return null;
  const storageKey = getRequestStepModeStorageKey(requestId);
  if (!storageKey) return null;
  try {
    const storedStepMode = window.localStorage.getItem(storageKey);
    return storedStepMode === GENERATION_STEP_MODE_ONE_STEP || storedStepMode === GENERATION_STEP_MODE_TWO_STEP
      ? storedStepMode
      : null;
  } catch {
    return null;
  }
}

function attachStepGenerationInput(payload, stepMode) {
  const stepInput = buildStepGenerationInput(stepMode);
  const nextPayload = {
    ...cloneJsonValue(payload),
    ...stepInput,
  };

  if (isPlainObject(nextPayload.input)) {
    nextPayload.input = {
      ...nextPayload.input,
      ...stepInput,
    };
  }

  return nextPayload;
}

function getStepGenerationEndpoint(endpoint) {
  return endpoint === 'image_list_to_video'
    ? `${VIDEO_STEP_API_BASE}/image_to_video`
    : `${VIDEO_STEP_API_BASE}/text_to_video`;
}

function extractVideoResultUrl(data) {
  const resultUrls = Array.isArray(data?.result_urls) ? data.result_urls : [];
  const candidates = [
    data?.result_url,
    data?.result?.url,
    data?.session?.result?.url,
    resultUrls[0],
    data?.remoteURL,
    data?.remoteUrl,
    data?.remote_url,
    data?.session?.remoteURL,
    data?.session?.remoteUrl,
    data?.session?.remote_url,
    data?.session?.result?.remoteURL,
    data?.session?.result?.remoteUrl,
    data?.session?.result?.remote_url,
    data?.publishedVideoURL,
    data?.published_video_url,
    data?.session?.publishedVideoURL,
    data?.session?.published_video_url,
    data?.videoLink,
    data?.video_link,
    data?.session?.videoLink,
    data?.session?.video_link,
    data?.session?.result?.videoLink,
    data?.session?.result?.video_link,
    data?.result?.videoLink,
    data?.result?.video_link,
  ];

  return (
    candidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0)
    || null
  );
}

function isStepStatusRequestingProcessNext(data) {
  const step = data?.step || {};
  return Boolean(
    data?.requires_user_action ||
    data?.requiresUserAction ||
    data?.can_process_next ||
    data?.canProcessNext ||
    step.requires_user_action ||
    step.requiresUserAction ||
    step.can_process_next ||
    step.canProcessNext
  );
}

function isStepStatusWaitingForApproval(data, activeStepMode) {
  if (normalizeGenerationStepMode(activeStepMode) !== GENERATION_STEP_MODE_TWO_STEP) {
    return false;
  }
  return isStepStatusRequestingProcessNext(data);
}

function isFailedGenerationStatus(status) {
  const normalizedStatus = typeof status === 'string' ? status.trim().toUpperCase() : '';
  return normalizedStatus === 'FAILED' || normalizedStatus === 'ERROR' || normalizedStatus === 'CANCELLED';
}

function normalizeGenerationStatus(status) {
  return typeof status === 'string' ? status.trim().toUpperCase() : '';
}

function isCompletedGenerationStatus(status) {
  const normalizedStatus = normalizeGenerationStatus(status);
  return normalizedStatus === 'COMPLETED' ||
    normalizedStatus === 'SUCCESS' ||
    normalizedStatus === 'SUCCEEDED' ||
    normalizedStatus === 'DONE';
}

function hasExpressGenerationStatusProgress(status) {
  if (!isPlainObject(status)) {
    return false;
  }

  return Object.entries(status).some(([key, value]) => {
    const normalizedStatus = normalizeGenerationStatus(value);
    if (!normalizedStatus) {
      return false;
    }

    const initialStatus = INITIAL_EXPRESS_GENERATION_STATUS[key];
    if (!initialStatus) {
      return normalizedStatus !== 'INIT' && normalizedStatus !== 'PENDING';
    }

    return normalizedStatus !== initialStatus;
  });
}

function hasMeaningfulGenerationArrayValue(value) {
  if (!Array.isArray(value)) {
    return false;
  }

  return value.some((item) => {
    if (hasTextValue(item)) {
      return true;
    }
    if (!isPlainObject(item)) {
      return false;
    }

    return [
      item.text,
      item.prompt,
      item.image_url,
      item.imageUrl,
      item.url,
      item.src,
    ].some(hasTextValue);
  });
}

function hasStartedGenerationLayer(layer) {
  if (!isPlainObject(layer)) {
    return false;
  }

  const imageSession = isPlainObject(layer.imageSession) ? layer.imageSession : {};
  const frameImages = isPlainObject(layer.frameImages) ? layer.frameImages : {};
  const preview = isPlainObject(layer.preview) ? layer.preview : {};
  const stringCandidates = [
    layer.prompt,
    layer.videoGenerationPrompt,
    layer.aiVideoRemoteLink,
    layer.aiVideoLayer,
    layer.lipSyncRemoteLink,
    layer.lipSyncVideoLayer,
    layer.soundEffectRemoteLink,
    layer.soundEffectVideoLayer,
    layer.userVideoRemoteLink,
    layer.userVideoLayer,
    layer.aiLayerStartFrame,
    layer.baseLayerStartFrame,
    layer.aiVideoThumbnailPath,
    layer.thumbnailPath,
    frameImages.startFrameUrl,
    frameImages.startFrame,
    frameImages.aiLayerStartFrame,
    frameImages.baseLayerStartFrame,
    frameImages.aiVideoThumbnailPath,
    frameImages.thumbnailPath,
    preview.url,
    imageSession.prompt,
    imageSession.activeSelectedImage,
    imageSession.activeGeneratedImage,
    imageSession.activeEditedImage,
    imageSession.activeImageRemoteLink,
    imageSession.activeImageDescription,
  ];

  return stringCandidates.some(hasTextValue) ||
    hasMeaningfulGenerationArrayValue(imageSession.activeItemList);
}

function hasStartedGenerationSession(data) {
  if (!isPlainObject(data)) {
    return false;
  }

  if (
    Boolean(data.expressGenerationPaused) ||
    Boolean(data.expressGenerationCreated) ||
    Boolean(data.quickSessionCreatedAt) ||
    Boolean(data.isStepVideoGeneration) ||
    hasTextValue(data.inputPrompt) ||
    hasTextValue(data.expressInputPrompt) ||
    hasTextValue(data.expressGenerationType) ||
    hasMeaningfulGenerationArrayValue(data.textList) ||
    hasMeaningfulGenerationArrayValue(data.image_urls) ||
    hasMeaningfulGenerationArrayValue(data.imageUrls) ||
    (Array.isArray(data.layers) && data.layers.some(hasStartedGenerationLayer))
  ) {
    return true;
  }

  if (isPlainObject(data.session) && hasStartedGenerationSession(data.session)) {
    return true;
  }

  return hasExpressGenerationStatusProgress(data.expressGenerationStatus);
}

function isSessionGenerationPending(data, forcePending = false) {
  if (!isPlainObject(data)) {
    return false;
  }

  const hasStartedGeneration = hasStartedGenerationSession(data);
  const backendPending = Boolean(
    hasStartedGeneration &&
    (data.videoGenerationPending || data.expressGenerationPending)
  );

  if (!backendPending && extractVideoResultUrl(data)) {
    return false;
  }

  return Boolean(forcePending || backendPending);
}

function buildDockerAnonymousSessionDetailsFromStatus(data) {
  if (!isPlainObject(data)) {
    return data;
  }

  const sessionPreview = isPlainObject(data.session) ? data.session : {};
  const normalizedStatus = normalizeGenerationStatus(data.status);
  const statusIndicatesPending = ['PENDING', 'IN_PROGRESS', 'RUNNING', 'PROCESSING'].includes(normalizedStatus);
  const mergedSessionDetails = {
    ...sessionPreview,
    ...data,
    session: data.session,
    layers: Array.isArray(sessionPreview.layers) ? sessionPreview.layers : data.layers,
  };
  const hasStartedGeneration = hasStartedGenerationSession(mergedSessionDetails);

  return {
    ...mergedSessionDetails,
    expressGenerationStatus: data.expressGenerationStatus || sessionPreview.expressGenerationStatus,
    expressGenerationPending:
      data.expressGenerationPending ??
      sessionPreview.expressGenerationPending ??
      (hasStartedGeneration && statusIndicatesPending),
    videoGenerationPending:
      data.videoGenerationPending ??
      sessionPreview.videoGenerationPending ??
      (hasStartedGeneration && statusIndicatesPending),
    isExpressGeneration:
      data.isExpressGeneration ??
      sessionPreview.isExpressGeneration ??
      hasStartedGeneration,
  };
}

function extractErrorText(value) {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (!isPlainObject(value)) {
    return '';
  }
  return (
    extractErrorText(value.message) ||
    extractErrorText(value.error) ||
    extractErrorText(value.detail) ||
    extractErrorText(value.details)
  );
}

function getDetailedGenerationFailureStatus(data) {
  if (!isPlainObject(data)) {
    return '';
  }

  const topLevelStatus = normalizeGenerationStatus(data.status);
  if (isCompletedGenerationStatus(topLevelStatus)) {
    return '';
  }

  if (data.expressGenerationCancelled) {
    return 'CANCELLED';
  }
  if (data.expressGenerationFailed) {
    return 'FAILED';
  }

  const statusCandidates = [
    data.status,
    data.step_status,
    data.stepStatus,
    data.step?.status,
    data.expressGenerationStatus?.status,
  ];

  if (isPlainObject(data.expressGenerationStatus)) {
    statusCandidates.push(...Object.values(data.expressGenerationStatus));
  }
  if (isPlainObject(data.session?.stages)) {
    statusCandidates.push(...Object.values(data.session.stages));
  }

  return statusCandidates
    .map(normalizeGenerationStatus)
    .find(isFailedGenerationStatus) || '';
}

function getDetailedGenerationErrorMessage(data, failureStatus = '') {
  const candidates = [
    data?.expressGenerationError,
    data?.generationError,
    data?.errorMessage,
    data?.message,
    data?.error,
    data?.step?.error,
    data?.step?.errorMessage,
    data?.step?.message,
    data?.session?.error,
    data?.session?.errorMessage,
    data?.session?.message,
    data?.session?.generationError,
    data?.session?.result?.error,
    data?.session?.result?.message,
  ];

  const errorText = candidates.map(extractErrorText).find(Boolean);
  if (errorText) {
    return errorText;
  }

  return normalizeGenerationStatus(failureStatus) === 'CANCELLED'
    ? 'Video generation was cancelled.'
    : 'Video generation failed.';
}

export default function OneshotEditor() {
  // ─────────────────────────────────────────────────────────
  //  Context / Router hooks
  // ─────────────────────────────────────────────────────────
  const { user, getUserAPI } = useUser();
  const { colorMode } = useColorMode();
  const { t, language } = useLocalization();
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { openAlertDialog, closeAlertDialog } = useAlertDialog();
  const showLoginDialog = useCallback(() => {
    const redirectTo = user?._id
      ? `${location.pathname}${location.search || ''}`
      : '/vidgenie';
    openAlertDialog(<AuthContainer redirectTo={redirectTo} />, undefined, false, AUTH_DIALOG_OPTIONS);
  }, [location.pathname, location.search, openAlertDialog, user]);

  const goToPurchaseCredits = useCallback(() => {
    closeAlertDialog();
    navigate(PURCHASE_CREDITS_ROUTE);
  }, [closeAlertDialog, navigate]);

  const activeSessionIdRef = useRef(id);
  const initialGuestSessionRef = useRef(undefined);
  if (initialGuestSessionRef.current === undefined) {
    const candidate = location.state?.guestSession;
    const candidateId = candidate?._id?.$oid || candidate?._id || candidate?.id;
    initialGuestSessionRef.current =
      candidate?.isGuestSession === true && String(candidateId || '') === String(id || '')
        ? candidate
        : null;
  }
  const currentPollRequestIdRef = useRef(null);
  const activeRequestIdRef = useRef(null);
  const postProcessingPollActionRef = useRef('');

  const lastWakePoll = useRef(Date.now());

  const currentEnv = getSessionType();

  const voiceSessionStartRef = useRef(null);
  const voiceSessionTimeoutRef = useRef(null);
  const voiceWordCountRef = useRef(0);
  const voiceWordLimitRef = useRef(VOICE_TRANSCRIPTION_WORD_LIMIT);
  const stopAllVoiceCaptureRef = useRef(() => {});
  const voiceSessionTimeoutLabelRef = useRef(t("vidgenie.voiceTimeoutTenMinutes"));

  const clearVoiceSessionTimeout = useCallback(() => {
    if (voiceSessionTimeoutRef.current) {
      clearTimeout(voiceSessionTimeoutRef.current);
      voiceSessionTimeoutRef.current = null;
    }
  }, []);

  const countWords = useCallback((value) => {
    if (!value) return 0;
    return value
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
  }, []);

  const transcriptHeaders = useMemo(() => getHeaders(), [user]);
  const normalizeVideoUrl = (url) => {
    if (typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
      return trimmed;
    }
    return `${API_SERVER}/${trimmed.replace(/^\/+/, '')}`;
  };
  const getNormalizedLatestVideoUrl = (data) => normalizeVideoUrl(extractVideoResultUrl(data));

  // ✨ UI tokens for light/dark surfaces
  const surfaceCard =
    colorMode === 'dark'
      ? 'bg-[#0f1629] text-slate-100 border border-[#1f2a3d] shadow-[0_16px_40px_rgba(0,0,0,0.38)]'
      : 'bg-white text-slate-900 border border-slate-200 shadow-sm';

  const controlShell =
    colorMode === 'dark'
      ? 'bg-[#111a2f] ring-1 ring-[#1f2a3d] hover:ring-rose-400/40'
      : 'bg-white ring-1 ring-slate-200 hover:ring-slate-300 shadow-sm';

  const mutedText = colorMode === 'dark' ? 'text-slate-400' : 'text-slate-500';

  useEffect(() => {
    activeSessionIdRef.current = id;
  }, [id]);


  // ─────────────────────────────────────────────────────────
  //  Basic session & form state
  // ─────────────────────────────────────────────────────────
  // Keep the stable skeleton visible until the handed-off sample has hydrated all
  // dependent editor state; otherwise mobile briefly paints a blank/default form.
  const [sessionDetails, setSessionDetails] = useState(null);
  const [sessionLoadFailed, setSessionLoadFailed] = useState(false);
  const [sessionLoadError, setSessionLoadError] = useState('');
  const [promptText, setPromptText] = useState('');
  const clampPromptText = useCallback((value) => {
    if (typeof value !== 'string') return '';
    return value.length > VIDGENIE_PROMPT_MAX_LENGTH
      ? value.slice(0, VIDGENIE_PROMPT_MAX_LENGTH)
      : value;
  }, []);
  const updatePromptText = useCallback((value) => {
    setPromptText(clampPromptText(value));
  }, [clampPromptText]);
  const handlePromptTextChange = useCallback((event) => {
    updatePromptText(event.target.value);
  }, [updatePromptText]);
  const promptCharacterCount = promptText.length;
  const promptCounterLabel = t(
    "vidgenie.promptCharacterCount",
    { count: promptCharacterCount, max: VIDGENIE_PROMPT_MAX_LENGTH },
    "{count}/{max} characters"
  );
  const promptCounterClass =
    promptCharacterCount >= VIDGENIE_PROMPT_MAX_LENGTH ? 'text-amber-500' : mutedText;
  const [generationMode, setGenerationMode] = useState('T2V');
  const [generationStepMode, setGenerationStepMode] = useState(GENERATION_STEP_MODE_ONE_STEP);
  const [isJsonMode, setIsJsonMode] = useState(false);
  const [jsonInputText, setJsonInputText] = useState('');
  const [isJsonInputDirty, setIsJsonInputDirty] = useState(false);
  const [jsonValidationMessage, setJsonValidationMessage] = useState('');
  const [isJsonRequestExpanded, setIsJsonRequestExpanded] = useState(false);
  const [jsonCopyStatus, setJsonCopyStatus] = useState('');
  const [activeRequestId, setActiveRequestId] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isRenderPauseResumePending, setIsRenderPauseResumePending] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUnpublishing, setIsUnpublishing] = useState(false);
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false);
  const [postProcessingAction, setPostProcessingAction] = useState('generated_outro');
  const [postProcessingForm, setPostProcessingForm] = useState(() => createDefaultPostProcessingForm());
  const [postProcessingPendingAction, setPostProcessingPendingAction] = useState('');
  const [postProcessingMessage, setPostProcessingMessage] = useState('');
  const [postProcessingError, setPostProcessingError] = useState('');
  const [isRerollPreviewRefreshing, setIsRerollPreviewRefreshing] = useState(false);
  const [playingRerollLayerId, setPlayingRerollLayerId] = useState(null);
  const [currentRenderGeneratedOutro, setCurrentRenderGeneratedOutro] = useState(false);
  const [isCompletedRequestExpanded, setIsCompletedRequestExpanded] = useState(false);
  const completedRequestCollapseKeyRef = useRef('');

  const postProcessingAudioLanguage = useMemo(
    () => resolveSessionAudioLanguage(sessionDetails),
    [sessionDetails]
  );
  const postProcessingDefaultSubtitleLanguage = useMemo(
    () => resolveSubtitleRegenerationDefault(sessionDetails),
    [sessionDetails]
  );

  useEffect(() => {
    if (!postProcessingDefaultSubtitleLanguage) {
      return;
    }

    setPostProcessingForm((current) => (
      current.subtitleLanguage
        ? current
        : {
            ...current,
            subtitleLanguage: postProcessingDefaultSubtitleLanguage,
          }
    ));
  }, [postProcessingDefaultSubtitleLanguage]);

  useEffect(() => {
    activeRequestIdRef.current = activeRequestId;
  }, [activeRequestId]);

  // ─────────────────────────────────────────────────────────
  //  Online / offline & polling support
  // ─────────────────────────────────────────────────────────
  const [, setIsOnline] = useState(navigator.onLine);
  const [, setPollDelay] = useState(DEFAULT_POLL);
  const pollDelayRef = useRef(DEFAULT_POLL);
  const assistantDelayRef = useRef(DEFAULT_POLL);
  const lastTimelinePreviewSessionRefreshRef = useRef(0);

  useEffect(() => {
    const onLine = () => {
      setIsOnline(true);
      setPollDelay(DEFAULT_POLL);
    };
    const offLine = () => {
      setIsOnline(false);
      setPollDelay(OFFLINE_POLL);
    };

    window.addEventListener('online', onLine);
    window.addEventListener('offline', offLine);
    return () => {
      window.removeEventListener('online', onLine);
      window.removeEventListener('offline', offLine);
    };
  }, []);

  // ─────────────────────────────────────────────────────────
  //  Polling handles / refs
  // ─────────────────────────────────────────────────────────
  const pollIntervalRef = useRef(null);   // generation poll (setTimeout)
  const activeRequestStepModeRef = useRef(GENERATION_STEP_MODE_ONE_STEP);
  const assistantPollRef = useRef(null);   // assistant poll (setInterval)
  const pollErrorCountRef = useRef(0);
  const assistantErrorCountRef = useRef(0);

  const pollTimeoutRef = useRef(null);
  const assistantTimeoutRef = useRef(null);

  // ─────────────────────────────────────────────────────────
  //  Assistant / Chatbot state
  // ─────────────────────────────────────────────────────────
  const [sessionMessages, setSessionMessages] = useState([]);
  const [isAssistantQueryGenerating, setIsAssistantQueryGenerating] = useState(false);

  // ─────────────────────────────────────────────────────────
  //  Generation state
  // ─────────────────────────────────────────────────────────
  const [isGenerationPending, setIsGenerationPending] = useState(false);
  const [isGenerationWaitingForApproval, setIsGenerationWaitingForApproval] = useState(false);
  const [isProcessingNextStep, setIsProcessingNextStep] = useState(false);
  const [expressGenerationStatus, setExpressGenerationStatus] = useState(null);
  const [generationStatusDetails, setGenerationStatusDetails] = useState(null);
  const [videoLink, setVideoLink] = useState(null);
  const [postProcessingPreviewVideoLink, setPostProcessingPreviewVideoLink] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [showResultDisplay, setShowResultDisplay] = useState(false);
  const currentRenderHasOutro = useMemo(() => (
    currentRenderGeneratedOutro ||
    sessionHasOutroImage(sessionDetails) ||
    sessionHasOutroImage(generationStatusDetails) ||
    sessionHasOutroImage(generationStatusDetails?.session)
  ), [currentRenderGeneratedOutro, generationStatusDetails, sessionDetails]);
  const rerollCandidateSourceSession =
    (Array.isArray(generationStatusDetails?.session?.layers) && generationStatusDetails.session.layers.length
      ? generationStatusDetails.session
      : null) ||
    (Array.isArray(generationStatusDetails?.layers) && generationStatusDetails.layers.length
      ? generationStatusDetails
      : null) ||
    sessionDetails;
  const rerollCandidateLayers = useMemo(
    () => getRerollCandidateLayers(rerollCandidateSourceSession),
    [rerollCandidateSourceSession],
  );
  const rerollLayerIndexes = useMemo(
    () => normalizeRerollLayerIndexes(postProcessingForm.rerollLayerIndexes),
    [postProcessingForm.rerollLayerIndexes],
  );
  const rerollLayerIndexKey = rerollLayerIndexes.join(',');

  useEffect(() => {
    const handleVisibility = () => {
      if (
        !document.hidden &&
        Date.now() - lastWakePoll.current > 2000 &&
        isGenerationPending &&
        activeRequestIdRef.current
      ) {
        lastWakePoll.current = Date.now();
        pollGenerationStatus(activeRequestIdRef.current, true); // Restart fresh
        startAssistantQueryPoll(true);  // Optional: restart assistant poll
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [id, isGenerationPending]);

  // ─────────────────────────────────────────────────────────
  //  Misc state
  // ─────────────────────────────────────────────────────────
  useState([]);
  useState('');
  const [, setExpandedVideoId] = useState(null);
  const [imageListItems, setImageListItems] = useState(() => [createEmptyImageListItem()]);
  const [uploadingImageIndex, setUploadingImageIndex] = useState(null);
  const [imageUploadError, setImageUploadError] = useState('');
  const [uploadingOutroCtaImage, setUploadingOutroCtaImage] = useState(false);
  const [outroCtaImageUploadError, setOutroCtaImageUploadError] = useState('');
  const [voiceStatusMessage, setVoiceStatusMessage] = useState(null);
  const [voiceError, setVoiceError] = useState(null);
  const [isBrowserRecognitionActive, setIsBrowserRecognitionActive] = useState(false);
  const voiceBasePromptRef = useRef('');
  const voiceTranscriptRef = useRef('');
  const voiceStatusTimeoutRef = useRef(null);
  const browserRecognitionRef = useRef(null);
  const speechRecognitionCtor = useMemo(() => {
    if (typeof window === 'undefined') return null;
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }, []);
  const isBrowserSpeechSupported = Boolean(speechRecognitionCtor);

  const setAdvancedVideoEditPendingSession = (nextSessionId) => {
    if (!nextSessionId || typeof window === 'undefined') return;
    sessionStorage.setItem(
      ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY,
      JSON.stringify({ sessionId: nextSessionId, startedAt: Date.now() })
    );
  };

  const setPostProcessingPendingSession = (nextSessionId, previewVideoUrl = null) => {
    if (!nextSessionId || typeof window === 'undefined') return;
    sessionStorage.setItem(
      POST_PROCESSING_PENDING_SESSION_KEY,
      JSON.stringify({
        sessionId: nextSessionId,
        startedAt: Date.now(),
        ...(previewVideoUrl ? { previewVideoUrl } : {}),
      })
    );
  };

  const getPostProcessingPreviewVideoLink = (candidateSessionId) => {
    if (!candidateSessionId || typeof window === 'undefined') return null;
    try {
      const rawValue = sessionStorage.getItem(POST_PROCESSING_PENDING_SESSION_KEY);
      if (!rawValue) return null;
      const parsedValue = JSON.parse(rawValue);
      if (parsedValue?.sessionId !== candidateSessionId) return null;
      return typeof parsedValue?.previewVideoUrl === 'string' && parsedValue.previewVideoUrl.trim()
        ? parsedValue.previewVideoUrl.trim()
        : null;
    } catch {
      return null;
    }
  };

  const shouldForceAdvancedVideoEditPolling = (candidateSessionId) => {
    if (!candidateSessionId || typeof window === 'undefined') return false;
    try {
      const rawValue = sessionStorage.getItem(ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY);
      if (!rawValue) return false;
      const parsedValue = JSON.parse(rawValue);
      const startedAt = Number(parsedValue?.startedAt);
      const isFresh = Number.isFinite(startedAt) && Date.now() - startedAt < 10 * 60 * 1000;
      return parsedValue?.sessionId === candidateSessionId && isFresh;
    } catch {
      return false;
    }
  };

  const shouldUsePostProcessingStatusPolling = (candidateSessionId) => {
    if (!candidateSessionId || typeof window === 'undefined') return false;
    try {
      const rawValue = sessionStorage.getItem(POST_PROCESSING_PENDING_SESSION_KEY);
      if (!rawValue) return false;
      const parsedValue = JSON.parse(rawValue);
      const startedAt = Number(parsedValue?.startedAt);
      const isFresh = Number.isFinite(startedAt) && Date.now() - startedAt < 10 * 60 * 1000;
      return parsedValue?.sessionId === candidateSessionId && isFresh;
    } catch {
      return false;
    }
  };

  const clearAdvancedVideoEditPendingSession = (candidateSessionId) => {
    if (!candidateSessionId || typeof window === 'undefined') return;
    try {
      const rawValue = sessionStorage.getItem(ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY);
      if (!rawValue) return;
      const parsedValue = JSON.parse(rawValue);
      if (parsedValue?.sessionId === candidateSessionId) {
        sessionStorage.removeItem(ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY);
      }
    } catch {
      sessionStorage.removeItem(ADVANCED_VIDEO_EDIT_PENDING_SESSION_KEY);
    }
  };

  const clearPostProcessingPendingSession = (candidateSessionId) => {
    if (!candidateSessionId || typeof window === 'undefined') return;
    try {
      const rawValue = sessionStorage.getItem(POST_PROCESSING_PENDING_SESSION_KEY);
      if (!rawValue) return;
      const parsedValue = JSON.parse(rawValue);
      if (parsedValue?.sessionId === candidateSessionId) {
        sessionStorage.removeItem(POST_PROCESSING_PENDING_SESSION_KEY);
        setPostProcessingPreviewVideoLink(null);
      }
    } catch {
      sessionStorage.removeItem(POST_PROCESSING_PENDING_SESSION_KEY);
      setPostProcessingPreviewVideoLink(null);
    }
  };

  const handleVoiceSessionStarted = useCallback((sessionInfo) => {
    setVoiceError(null);
    setVoiceStatusMessage(t("vidgenie.voiceListening"));
    voiceTranscriptRef.current = '';
    voiceWordCountRef.current = 0;
    const rawLimit = sessionInfo?.maxTranscriptWords;
    const parsedLimit =
      typeof rawLimit === 'number'
        ? rawLimit
        : rawLimit
          ? parseInt(rawLimit, 10)
          : null;
    voiceWordLimitRef.current =
      Number.isFinite(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : VOICE_TRANSCRIPTION_WORD_LIMIT;
    const now = Date.now();
    voiceSessionStartRef.current = now;
    clearVoiceSessionTimeout();
    let timeoutMs = VOICE_SESSION_TIMEOUT_MS;
    if (sessionInfo?.expiresAt) {
      const expiresAtMs = new Date(sessionInfo.expiresAt).getTime();
      if (!Number.isNaN(expiresAtMs)) {
        timeoutMs = Math.min(
          VOICE_SESSION_TIMEOUT_MS,
          Math.max(0, expiresAtMs - now),
        );
      }
    }
    let timeoutLabel = t("vidgenie.voiceTimeoutTenMinutes");
    if (timeoutMs <= 0 || timeoutMs < 60_000) {
      timeoutLabel = t("vidgenie.voiceTimeoutLessThanMinute");
    } else {
      const timeoutMinutes = Math.ceil(timeoutMs / 60_000);
      timeoutLabel =
        timeoutMinutes === 1
          ? t("vidgenie.voiceTimeoutMinute")
          : t("vidgenie.voiceTimeoutMinutes", { count: timeoutMinutes });
    }
    voiceSessionTimeoutLabelRef.current = timeoutLabel;
    if (timeoutMs <= 0) {
      setVoiceStatusMessage(null);
      setVoiceError(
        t("vidgenie.voiceSessionExpired", { duration: voiceSessionTimeoutLabelRef.current })
      );
      stopAllVoiceCaptureRef.current?.();
      return;
    }
    voiceSessionTimeoutRef.current = setTimeout(() => {
      setVoiceStatusMessage(null);
      setVoiceError(
        t("vidgenie.voiceSessionExpired", { duration: voiceSessionTimeoutLabelRef.current })
      );
      stopAllVoiceCaptureRef.current?.();
    }, timeoutMs);
  }, [clearVoiceSessionTimeout, t]);

  const handleVoiceSessionEnded = useCallback(() => {
    clearVoiceSessionTimeout();
    voiceSessionStartRef.current = null;
    voiceWordCountRef.current = 0;
    voiceWordLimitRef.current = VOICE_TRANSCRIPTION_WORD_LIMIT;
    voiceSessionTimeoutLabelRef.current = t("vidgenie.voiceTimeoutTenMinutes");
    setVoiceStatusMessage(t("vidgenie.voiceStopped"));
    voiceBasePromptRef.current = '';
    voiceTranscriptRef.current = '';
  }, [clearVoiceSessionTimeout, t]);

  const handleVoiceTranscription = useCallback((transcript, isFinal) => {
    const base = voiceBasePromptRef.current || '';

    const sanitizeTranscript = (value) => {
      if (!value) return '';
      let cleaned = value.replace(/I['’]m listening and ready whenever you are!/gi, '');
      cleaned = cleaned.replace(/\s+/g, ' ').trimStart();
      return cleaned;
    };

    const cleanedTranscript = sanitizeTranscript(transcript);
    if (!cleanedTranscript) {
      voiceTranscriptRef.current = '';
      if (isFinal) {
        setVoiceStatusMessage(t("vidgenie.voiceNoSpeech"));
      }
      return;
    }

    const wordLimit = voiceWordLimitRef.current || VOICE_TRANSCRIPTION_WORD_LIMIT;
    const totalWords = countWords(cleanedTranscript);
    if (totalWords > wordLimit) {
      const limitedTranscript = cleanedTranscript
        .split(/\s+/)
        .slice(0, wordLimit)
        .join(' ');
      const nextPrompt = clampPromptText(`${base}${limitedTranscript}`);
      voiceTranscriptRef.current = nextPrompt.slice(Math.min(base.length, nextPrompt.length));
      setPromptText(nextPrompt);
      voiceBasePromptRef.current = nextPrompt;
      setVoiceStatusMessage(null);
      setVoiceError(t("vidgenie.voiceTranscriptLimit", { count: wordLimit }));
      stopAllVoiceCaptureRef.current?.();
      return;
    }
    voiceWordCountRef.current = totalWords;

    const nextPrompt = clampPromptText(`${base}${cleanedTranscript}`);
    const nextTranscript = nextPrompt.slice(Math.min(base.length, nextPrompt.length));
    if (nextTranscript === voiceTranscriptRef.current) {
      return;
    }
    voiceTranscriptRef.current = nextTranscript;

    setPromptText(nextPrompt);
    if (isFinal) {
      voiceBasePromptRef.current = nextPrompt;
    }

    setVoiceStatusMessage(
      isFinal ? t("vidgenie.voiceCaptured") : t("vidgenie.voiceTranscribing")
    );
  }, [clampPromptText, countWords, t]);

  const {
    startTranscription: startVoiceTranscription,
    stopTranscription: stopVoiceTranscription,
    isSupported: isVoiceSupported,
    isInitializing: isVoiceInitializing,
    isRecording: isVoiceRecording,
    error: realtimeVoiceError,
  } = useRealtimeTranscription({
    transcriptEndpoint: `${API_SERVER}/video_session/get_transcription_key`,
    transcriptHeaders,
    onTranscription: handleVoiceTranscription,
    onSessionStarted: handleVoiceSessionStarted,
    onSessionEnded: handleVoiceSessionEnded,
    onError: (message) => setVoiceError(message),
  });

  const startBrowserRecognition = useCallback(() => {
    if (!speechRecognitionCtor) {
      return false;
    }

    try {
      const recognition = new speechRecognitionCtor();
      recognition.continuous = true;
      recognition.interimResults = true;
      const browserLanguage = typeof navigator !== 'undefined' && navigator.language
        ? navigator.language
        : 'en-US';
      recognition.lang = browserLanguage;

      recognition.onstart = () => {
        handleVoiceSessionStarted();
        setIsBrowserRecognitionActive(true);
      };

      recognition.onerror = (event) => {
        const message =
          event.error === 'not-allowed'
            ? t("vidgenie.voiceMicrophoneDenied")
            : t("vidgenie.voiceRecognitionError");
        setVoiceError(message);
      };

      recognition.onend = () => {
        browserRecognitionRef.current = null;
        setIsBrowserRecognitionActive(false);
        handleVoiceSessionEnded();
      };

      recognition.onresult = (event) => {
        if (!event.results?.length) return;
        let combined = '';
        for (let i = 0; i < event.results.length; i += 1) {
          combined += event.results[i][0].transcript;
        }
        const latest = event.results[event.results.length - 1];
        handleVoiceTranscription(combined, latest?.isFinal ?? false);
      };

      browserRecognitionRef.current = recognition;
      recognition.start();
      return true;
    } catch  {

      browserRecognitionRef.current = null;
      setIsBrowserRecognitionActive(false);
      setVoiceError(t("vidgenie.voiceRecognitionFailed"));
      return false;
    }
  }, [handleVoiceSessionEnded, handleVoiceSessionStarted, handleVoiceTranscription, speechRecognitionCtor, t]);

  const stopBrowserRecognition = useCallback(() => {
    const recognition = browserRecognitionRef.current;
    if (!recognition) return;

    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;

    try {
      recognition.stop();
    } catch {
      /* ignore */
    }

    browserRecognitionRef.current = null;
    setIsBrowserRecognitionActive(false);
    handleVoiceSessionEnded();
  }, [handleVoiceSessionEnded]);

  const stopAllVoiceCapture = useCallback(() => {
    clearVoiceSessionTimeout();
    voiceSessionStartRef.current = null;
    voiceWordCountRef.current = 0;
    voiceWordLimitRef.current = VOICE_TRANSCRIPTION_WORD_LIMIT;
    voiceSessionTimeoutLabelRef.current = t("vidgenie.voiceTimeoutTenMinutes");
    if (isVoiceRecording || isVoiceInitializing) {
      stopVoiceTranscription();
    }
    stopBrowserRecognition();
  }, [
    clearVoiceSessionTimeout,
    isVoiceInitializing,
    isVoiceRecording,
    stopBrowserRecognition,
    stopVoiceTranscription,
  ]);

  useEffect(() => {
    stopAllVoiceCaptureRef.current = stopAllVoiceCapture;
    return () => {
      if (stopAllVoiceCaptureRef.current === stopAllVoiceCapture) {
        stopAllVoiceCaptureRef.current = () => {};
      }
    };
  }, [stopAllVoiceCapture]);

  const isVoiceBusy = isVoiceRecording || isVoiceInitializing || isBrowserRecognitionActive;

  useEffect(() => {
    if (generationMode === 'I2V' && isVoiceBusy) {
      stopAllVoiceCapture();
    }
  }, [generationMode, isVoiceBusy, stopAllVoiceCapture]);

  const handleToggleVoiceRecording = useCallback(() => {
    if (isVoiceBusy) {
      stopAllVoiceCapture();
      return;
    }

    if (!user) {
      setVoiceStatusMessage(null);
      setVoiceError(t("vidgenie.voiceLoginRequired"));
      showLoginDialog();
      return;
    }

    const isEmailVerified = user?.isEmailVerified ?? user?.emailVerified ?? false;
    if (!isEmailVerified) {
      setVoiceStatusMessage(null);
      setVoiceError(t("vidgenie.voiceVerifyEmail"));
      return;
    }

    if (!isBrowserSpeechSupported && !isVoiceSupported) {
      setVoiceError(t("vidgenie.voiceNotSupported"));
      return;
    }

    const currentPrompt = promptText || '';
    voiceBasePromptRef.current =
      currentPrompt && !/\s$/.test(currentPrompt)
        ? `${currentPrompt} `
        : currentPrompt;
    voiceTranscriptRef.current = '';

    setVoiceError(null);
    setVoiceStatusMessage(t("vidgenie.voiceConnecting"));

    if (isBrowserSpeechSupported) {
      const started = startBrowserRecognition();
      if (!started && isVoiceSupported) {
        startVoiceTranscription();
      }
      return;
    }

    startVoiceTranscription();
  }, [
    isVoiceBusy,
    stopAllVoiceCapture,
    user,
    showLoginDialog,
    isBrowserSpeechSupported,
    isVoiceSupported,
    promptText,
    startBrowserRecognition,
    startVoiceTranscription,
    t,
  ]);

  useEffect(() => {
    if (realtimeVoiceError) {
      setVoiceError(realtimeVoiceError);
    }
  }, [realtimeVoiceError]);

  useEffect(() => {
    if (voiceStatusTimeoutRef.current) {
      clearTimeout(voiceStatusTimeoutRef.current);
      voiceStatusTimeoutRef.current = null;
    }
    if (!voiceStatusMessage) return;
    if (isVoiceBusy) return;
    voiceStatusTimeoutRef.current = setTimeout(() => {
      setVoiceStatusMessage(null);
      voiceStatusTimeoutRef.current = null;
    }, 2500);
    return () => {
      if (voiceStatusTimeoutRef.current) {
        clearTimeout(voiceStatusTimeoutRef.current);
        voiceStatusTimeoutRef.current = null;
      }
    };
  }, [voiceStatusMessage, isVoiceBusy]);

  useEffect(() => {
    return () => {
      if (voiceStatusTimeoutRef.current) {
        clearTimeout(voiceStatusTimeoutRef.current);
      }
      stopAllVoiceCapture();
    };
  }, [stopAllVoiceCapture]);

  // ─────────────────────────────────────────────────────────
  //  Fetch latest videos (once)
  // ─────────────────────────────────────────────────────────
  useEffect(() => { fetchLatestVideos(); }, []);

  const languageOptions = useMemo(() => {
    const autoLabel = t("vidgenie.languageAuto", {}, "Auto");
    return [
      { label: autoLabel, value: 'auto' },
      ...SUPPORTED_LANGUAGES.map((lang) => ({
        label: lang.name,
        value: lang.code,
      })),
    ];
  }, [t]);

  const subtitleLanguageOptions = useMemo(() => [
    {
      label: t("vidgenie.subtitleLanguageSameAsAudio", {}, "Same as audio"),
      value: '',
    },
    ...SUPPORTED_LANGUAGES.map((lang) => ({
      label: lang.name,
      value: lang.code,
    })),
  ], [t]);

  const defaultLanguageOption = useMemo(() => {
    const match = languageOptions.find((opt) => opt.value === language);
    return match || languageOptions[0];
  }, [languageOptions, language]);

  const [selectedLanguageOption, setSelectedLanguageOption] = useState(
    () => defaultLanguageOption
  );
  const [enableSubtitles, setEnableSubtitles] = useState(DEFAULT_VIDGENIE_SUBTITLES_ENABLED);
  const [selectedSubtitleLanguageOption, setSelectedSubtitleLanguageOption] = useState(
    () => subtitleLanguageOptions[0]
  );
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [advancedOptions, setAdvancedOptions] = useState(() => ({
    ...DEFAULT_ADVANCED_OPTIONS,
  }));
  const [selectedInferenceModel, setSelectedInferenceModel] = useState(() =>
    getInferenceModelOption(user?.selectedInferenceModel)
  );
  const {
    isDockerInstall: isDockerInferenceModelFilteringEnabled,
    isLoading: isInferenceModelAvailabilityLoading,
    inferenceModelOptions,
    hasConfiguredInferenceModels,
  } = useInferenceModelAvailability();
  const {
    isDockerInstall: isDockerModelFilteringEnabled,
    isLoading: isDeploymentModelAvailabilityLoading,
    textToVideoImageModelValues,
    textToVideoVideoModelValues,
    imageListToVideoImageModelValues,
    imageListToVideoVideoModelValues,
  } = useDeploymentModelAvailability();
  const deploymentModelAvailability = useMemo(() => ({
    isDockerInstall: isDockerModelFilteringEnabled,
    textToVideoImageModelValues,
    textToVideoVideoModelValues,
    imageListToVideoImageModelValues,
    imageListToVideoVideoModelValues,
  }), [
    imageListToVideoImageModelValues,
    imageListToVideoVideoModelValues,
    isDockerModelFilteringEnabled,
    textToVideoImageModelValues,
    textToVideoVideoModelValues,
  ]);
  const isDockerInferenceUnavailable =
    isDockerInferenceModelFilteringEnabled &&
    (isInferenceModelAvailabilityLoading || !hasConfiguredInferenceModels);
  const [selectedCustomAdapterEndpointId, setSelectedCustomAdapterEndpointId] = useState('');

  const updateAdvancedOption = useCallback((key, value) => {
    setAdvancedOptions((prev) => {
      const next = {
        ...prev,
        [key]: value,
      };
      if (key === 'add_narrator_avatar' && value === true) {
        next.limit_single_narrator = true;
      }
      return next;
    });
  }, []);

  const toggleSelectedCustomAdapterEndpoint = useCallback((endpointId) => {
    setSelectedCustomAdapterEndpointId((current) => (
      current === endpointId ? '' : endpointId
    ));
  }, []);

  useEffect(() => {
    const sessionInferenceModel = resolveInferenceModelFromSession(sessionDetails);
    setSelectedInferenceModel((current) => {
      const targetModel =
        sessionInferenceModel ||
        user?.selectedInferenceModel ||
        current?.value ||
        DEFAULT_INFERENCE_MODEL;
      return getInferenceModelOption(targetModel, user?.selectedInferenceModel, inferenceModelOptions);
    });
  }, [inferenceModelOptions, sessionDetails, user?.selectedInferenceModel]);

  const availableCustomAdapterEndpoints = useMemo(
    () => getAvailableCustomAdapterEndpoints(user?.custom_adapters),
    [user?.custom_adapters],
  );

  useEffect(() => {
    if (!availableCustomAdapterEndpoints.length) {
      setSelectedCustomAdapterEndpointId('');
      return;
    }

    const availableIds = new Set(availableCustomAdapterEndpoints.map((endpoint) => endpoint.id));
    setSelectedCustomAdapterEndpointId((current) => (
      current && availableIds.has(current) ? current : ''
    ));
  }, [availableCustomAdapterEndpoints]);

  useEffect(() => {
    setSelectedLanguageOption((prev) => {
      const match = languageOptions.find((opt) => opt.value === prev?.value);
      return match || defaultLanguageOption;
    });
  }, [languageOptions, defaultLanguageOption]);

  useEffect(() => {
    setSelectedSubtitleLanguageOption((prev) => {
      const match = subtitleLanguageOptions.find((opt) => opt.value === prev?.value);
      return match || subtitleLanguageOptions[0];
    });
  }, [subtitleLanguageOptions]);

  // ─────────────────────────────────────────────────────────
  //  Aspect-ratio select
  // ─────────────────────────────────────────────────────────
  const aspectRatioOptions = useMemo(
    () => [
      { label: t("vidgenie.aspectRatioLandscape"), value: '16:9' },
      { label: t("vidgenie.aspectRatioPortrait"), value: '9:16' },
    ],
    [t]
  );
  const [selectedAspectRatioOption, setSelectedAspectRatioOption] = useState(() => {
    const stored = localStorage.getItem('defaultVidGPTAspectRatio');
    const found = aspectRatioOptions.find((o) => o.value === stored);
    return found || aspectRatioOptions[0];
  });
  useEffect(() => {
    setSelectedAspectRatioOption((prev) => {
      const stored = localStorage.getItem('defaultVidGPTAspectRatio');
      const targetValue = prev?.value || stored;
      const found = aspectRatioOptions.find((o) => o.value === targetValue);
      return found || aspectRatioOptions[0];
    });
  }, [aspectRatioOptions]);

  // ─────────────────────────────────────────────────────────
  //  Image-model select & styles
  // ─────────────────────────────────────────────────────────
  const stageDeploymentImageModelValues = generationMode === 'I2V'
    ? imageListToVideoImageModelValues
    : textToVideoImageModelValues;
  const stageImageModels = useMemo(() => {
    const availableModelMap = new Map(
      IMAGE_GENERAITON_MODEL_TYPES
        .filter((m) => {
          const modelPricing = IMAGE_MODEL_PRICES.find(
            (imp) => imp.key.toLowerCase() === m.key.toLowerCase()
          )?.prices || [];
          const hasAspect = modelPricing.find(
            (p) => p.aspectRatio === selectedAspectRatioOption.value
          );
          return m.isExpressModel && hasAspect;
        })
        .map((model) => [model.key, model])
    );

    const orderedModels = VIDGENIE_IMAGE_MODEL_ORDER
      .map((modelKey) => {
        const model = availableModelMap.get(modelKey);
        if (!model) return null;
        return {
          label: VIDGENIE_IMAGE_MODEL_LABELS[modelKey] || model.name,
          value: model.key,
          imageStyles: model.imageStyles,
        };
      })
      .filter(Boolean);
    return isDockerModelFilteringEnabled
      ? filterOptionsForDeploymentModelValues(orderedModels, stageDeploymentImageModelValues)
      : orderedModels;
  }, [
    isDockerModelFilteringEnabled,
    selectedAspectRatioOption.value,
    stageDeploymentImageModelValues,
  ]);

  const [selectedImageModel, setSelectedImageModel] = useState(() => {
    const saved = localStorage.getItem('defaultVidGPTImageGenerationModel');
    const found = stageImageModels.find((m) => m.value === saved);
    return found || stageImageModels[0];
  });

  useEffect(() => {
    setSelectedImageModel((prev) => {
      if (!stageImageModels.length) return null;
      if (prev?.value) {
        const existing = stageImageModels.find((m) => m.value === prev.value);
        if (existing) return existing;
      }

      const saved = localStorage.getItem('defaultVidGPTImageGenerationModel');
      const found = stageImageModels.find((m) => m.value === saved);
      return found || stageImageModels[0];
    });
  }, [stageImageModels]);

  const [selectedImageStyle, setSelectedImageStyle] = useState(() => {
    const saved = localStorage.getItem('defaultVidGPTImageGenerationModel');
    const foundModel = stageImageModels.find((m) => m.value === saved) || stageImageModels[0];
    if (foundModel?.imageStyles?.length) {
      const firstStyle = foundModel.imageStyles[0];
      return { label: firstStyle, value: firstStyle };
    }
    return null;
  });

  // When image-model changes, verify / reset style
  useEffect(() => {
    if (!selectedImageModel) return;
    const modelCfg = IMAGE_GENERAITON_MODEL_TYPES.find(
      (m) => m.key === selectedImageModel.value
    );
    if (modelCfg?.imageStyles?.length) {
      const styleExists = modelCfg.imageStyles.includes(selectedImageStyle?.value);
      if (!selectedImageStyle || !styleExists) {
        const firstStyle = modelCfg.imageStyles[0];
        setSelectedImageStyle({ label: firstStyle, value: firstStyle });
      }
    } else {
      setSelectedImageStyle(null);
    }
  }, [selectedImageModel]);

  // ─────────────────────────────────────────────────────────
  //  Video-model select
  // ─────────────────────────────────────────────────────────
  const expressVideoModels = useMemo(() => {
    const availableModelMap = new Map(
      VIDEO_GENERATION_MODEL_TYPES
        .filter(
          (m) =>
            m.isExpressModel &&
            m.supportedAspectRatios?.includes(selectedAspectRatioOption.value)
        )
        .map((model) => [model.key, model])
    );

    const orderedModels = VIDGENIE_VIDEO_MODEL_ORDER
      .map((modelKey) => {
        const model = availableModelMap.get(modelKey);
        if (!model) return null;
        return {
          label: VIDGENIE_VIDEO_MODEL_LABELS[modelKey] || model.name,
          value: model.key,
          ...model,
        };
      })
      .filter(Boolean);
    return isDockerModelFilteringEnabled
      ? filterOptionsForDeploymentModelValues(orderedModels, textToVideoVideoModelValues)
      : orderedModels;
  }, [
    isDockerModelFilteringEnabled,
    selectedAspectRatioOption.value,
    textToVideoVideoModelValues,
  ]);

  const imageListVideoModels = useMemo(() => {
    const availableModelMap = new Map(
      VIDEO_GENERATION_MODEL_TYPES
        .filter(
          (m) =>
            VIDGENIE_IMAGE_LIST_VIDEO_MODEL_ORDER.includes(m.key) &&
            m.supportedAspectRatios?.includes(selectedAspectRatioOption.value)
        )
        .map((model) => [model.key, model])
    );

    const orderedModels = VIDGENIE_IMAGE_LIST_VIDEO_MODEL_ORDER
      .map((modelKey) => {
        const model = availableModelMap.get(modelKey);
        if (!model) return null;
        return {
          label: VIDGENIE_VIDEO_MODEL_LABELS[modelKey] || model.name,
          value: model.key,
          ...model,
        };
      })
      .filter(Boolean);
    return isDockerModelFilteringEnabled
      ? filterOptionsForDeploymentModelValues(orderedModels, imageListToVideoVideoModelValues)
      : orderedModels;
  }, [
    imageListToVideoVideoModelValues,
    isDockerModelFilteringEnabled,
    selectedAspectRatioOption.value,
  ]);

  const [selectedVideoModel, setSelectedVideoModel] = useState(() => {
    const saved = localStorage.getItem(VIDGENIE_TEXT_VIDEO_MODEL_STORAGE_KEY);
    return findDefaultVideoModelOption(expressVideoModels, saved);
  });

  useEffect(() => {
    if (generationMode !== 'T2V' || !expressVideoModels.length) return;

    setSelectedVideoModel((prev) => {
      if (prev?.value) {
        const existing = expressVideoModels.find((m) => m.value === prev.value);
        if (existing) return existing;
      }

      const saved = localStorage.getItem(VIDGENIE_TEXT_VIDEO_MODEL_STORAGE_KEY);
      return findDefaultVideoModelOption(expressVideoModels, saved);
    });
  }, [generationMode, expressVideoModels]);

  useEffect(() => {
    if (generationMode !== 'I2V' || !imageListVideoModels.length) return;

    setSelectedVideoModel((prev) => {
      if (prev?.value) {
        const existing = imageListVideoModels.find((m) => m.value === prev.value);
        if (existing) return existing;
      }

      const saved = localStorage.getItem(VIDGENIE_IMAGE_LIST_VIDEO_MODEL_STORAGE_KEY);
      return findDefaultVideoModelOption(imageListVideoModels, saved);
    });
  }, [generationMode, imageListVideoModels]);

  // Video-model subtype (Pixverse or otherwise)
  const [selectedVideoModelSubType, setSelectedVideoModelSubType] = useState(null);
  useEffect(() => {
    if (selectedVideoModel?.value?.startsWith('PIXVERSE')) {
      if (!selectedVideoModelSubType) {
        const firstPixStyle = PIXVERRSE_VIDEO_STYLES[0];
        setSelectedVideoModelSubType({ label: firstPixStyle, value: firstPixStyle });
      }
    } else if (selectedVideoModel?.modelSubTypes?.length) {
      if (!selectedVideoModelSubType) {
        const firstSub = selectedVideoModel.modelSubTypes[0];
        setSelectedVideoModelSubType({ label: firstSub, value: firstSub });
      }
    } else {
      setSelectedVideoModelSubType(null);
    }
  }, [selectedVideoModel]);

  // Duration select
  const durationOptions = useMemo(
    () => [
      { label: t("vidgenie.duration10"), value: 10 },
      { label: t("vidgenie.duration30"), value: 30 },
      { label: t("vidgenie.duration60"), value: 60 },
      { label: t("vidgenie.duration90"), value: 90 },
      { label: t("vidgenie.duration120"), value: 120 },
      { label: t("vidgenie.duration180"), value: 180 },
    ],
    [t]
  );
  const [selectedDurationOption, setSelectedDurationOption] = useState(() => {
    const saved = parseInt(localStorage.getItem('defaultVidGPTDuration') || '', 10);
    const found = durationOptions.find((d) => d.value === saved);
    if (found) {
      return found;
    }
    const defaultOption = durationOptions.find((d) => d.value === 30);
    return defaultOption || durationOptions[0];
  });
  useEffect(() => {
    setSelectedDurationOption((prev) => {
      const saved = parseInt(localStorage.getItem('defaultVidGPTDuration') || '', 10);
      const targetValue = prev?.value || saved;
      const found = durationOptions.find((d) => d.value === targetValue);
      return found || durationOptions[0];
    });
  }, [durationOptions]);

  // ─────────────────────────────────────────────────────────
  //  Persist selections to localStorage
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (selectedImageModel?.value) {
      localStorage.setItem('defaultVidGPTImageGenerationModel', selectedImageModel.value);
      localStorage.setItem('defaultImageModel', selectedImageModel.value);
    }
  }, [selectedImageModel]);

  useEffect(() => {
    if (selectedVideoModel?.value) {
      const storageKey = generationMode === 'I2V'
        ? VIDGENIE_IMAGE_LIST_VIDEO_MODEL_STORAGE_KEY
        : VIDGENIE_TEXT_VIDEO_MODEL_STORAGE_KEY;
      localStorage.setItem(storageKey, selectedVideoModel.value);
      localStorage.setItem('defaultVideoModel', selectedVideoModel.value);
    }
  }, [generationMode, selectedVideoModel]);

  useEffect(() => {
    if (selectedAspectRatioOption?.value) {
      localStorage.setItem('defaultVidGPTAspectRatio', selectedAspectRatioOption.value);
    }
  }, [selectedAspectRatioOption]);

  useEffect(() => {
    if (selectedDurationOption?.value) {
      localStorage.setItem('defaultVidGPTDuration', selectedDurationOption.value.toString());
    }
  }, [selectedDurationOption]);

  // ─────────────────────────────────────────────────────────
  //  Credits / disable form
  // ─────────────────────────────────────────────────────────
  const isGuestPreview = !user?._id;
  const isDisabled = isGuestPreview || (user.generationCredits < 300 && currentEnv !== 'docker');

  // ─────────────────────────────────────────────────────────
  //  CLEAN-UP ALL POLLS WHEN COMPONENT UNMOUNTS
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current);
      if (assistantPollRef.current) clearInterval(assistantPollRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
      if (assistantTimeoutRef.current) clearTimeout(assistantTimeoutRef.current);
    };
  }, []);

  // ─────────────────────────────────────────────────────────
  //  IMPORTANT: RESET & CLEAR POLLS WHENEVER `id` CHANGES
  // ─────────────────────────────────────────────────────────

  useEffect(() => {
    // Abort ALL polling
    if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current);
    if (assistantPollRef.current) clearInterval(assistantPollRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    if (assistantTimeoutRef.current) clearTimeout(assistantTimeoutRef.current);

    pollIntervalRef.current = null;
    assistantPollRef.current = null;
    pollTimeoutRef.current = null;
    assistantTimeoutRef.current = null;

    pollErrorCountRef.current = 0;
    assistantErrorCountRef.current = 0;
    pollDelayRef.current = DEFAULT_POLL;
    assistantDelayRef.current = DEFAULT_POLL;

    resetForm();
    setPostProcessingPreviewVideoLink(getPostProcessingPreviewVideoLink(id));

    if (currentPollRequestIdRef.current === id) return;

    if (id) {
      // Fetch session, and ONLY trigger polling if still pending
      getSessionDetails().then((data) => {
        const usePostProcessingPoll = shouldUsePostProcessingStatusPolling(id);
        if (
          user?._id &&
          getHeaders() &&
          isSessionGenerationPending(data, shouldForceAdvancedVideoEditPolling(id) || usePostProcessingPoll) &&
          !activeRequestIdRef.current
        ) {
          if (usePostProcessingPoll) {
            pollPostProcessingStatus(id);
          } else {
            pollGenerationStatus(id);
          }
        } else {
          // clear any existing pending polls
          if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current);
          if (assistantPollRef.current) clearInterval(assistantPollRef.current);
        }
      });
    }
  }, [id]);

  // ─────────────────────────────────────────────────────────
  //  Handle download
  // ─────────────────────────────────────────────────────────
  async function handleDownloadVideo() {
    const fallbackUrl = normalizeVideoUrl(videoLink);
    let downloadUrl = fallbackUrl;

    try {
      setIsDownloadingVideo(true);
      const latestUrl = await refreshLatestVideoLink();
      downloadUrl = latestUrl || fallbackUrl;
      if (!downloadUrl) return;

      const headers = downloadUrl.startsWith(API_SERVER) ? getHeaders() : null;
      const response = await axios.get(downloadUrl, {
        responseType: 'blob',
        ...(headers || {}),
      });
      const blobUrl = URL.createObjectURL(new Blob([response.data], {
        type: response.headers?.['content-type'] || 'video/mp4',
      }));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `Rendition_${dateNowStr}.mp4`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch  {
      if (downloadUrl) {
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.setAttribute('download', `Rendition_${dateNowStr}.mp4`);
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } finally {
      setIsDownloadingVideo(false);
    }
  }

  const publishQuickSession = async (formPayload) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    setIsPublishing(true);

    try {
      const normalizedTags =
        typeof formPayload.tags === 'string'
          ? formPayload.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
          : Array.isArray(formPayload.tags)
            ? formPayload.tags.map((tag) => tag.trim()).filter(Boolean)
            : [];

      const sessionId = formPayload?.id || id;
      const latestSessionDetails = (await getSessionDetails()) || sessionDetails;
      const latestRawVideoLink = extractVideoResultUrl(latestSessionDetails);
      const latestVideoUrl = normalizeVideoUrl(latestRawVideoLink) || videoLink || null;

      const aspectRatioForPublish =
        latestSessionDetails?.aspectRatio ||
        latestSessionDetails?.publishedAspectRatio ||
        selectedAspectRatioOption?.value ||
        null;

      const selectedLanguageValue =
        typeof selectedLanguageOption === 'string'
          ? selectedLanguageOption
          : selectedLanguageOption?.value ?? selectedLanguageOption?.label;
      const fallbackLanguageCode = resolveLanguageCode(selectedLanguageValue);

      const sessionLanguage =
        typeof formPayload.sessionLanguage === 'string' && formPayload.sessionLanguage.trim().length > 0
          ? formPayload.sessionLanguage.trim()
          : typeof latestSessionDetails?.sessionLanguage === 'string' &&
            latestSessionDetails.sessionLanguage.trim().length > 0
            ? latestSessionDetails.sessionLanguage.trim()
            : typeof latestSessionDetails?.language === 'string' &&
              latestSessionDetails.language.trim().length > 0
              ? latestSessionDetails.language.trim()
              : typeof fallbackLanguageCode === 'string' && fallbackLanguageCode.trim().length > 0
                ? fallbackLanguageCode.trim()
                : null;

      const languageString =
        typeof formPayload.languageString === 'string' && formPayload.languageString.trim().length > 0
          ? formPayload.languageString.trim()
          : typeof latestSessionDetails?.languageString === 'string' &&
            latestSessionDetails.languageString.trim().length > 0
            ? latestSessionDetails.languageString.trim()
            : selectedLanguageOption?.value &&
              selectedLanguageOption.value !== 'auto' &&
              typeof selectedLanguageOption?.label === 'string' &&
              selectedLanguageOption.label.trim().length > 0
              ? selectedLanguageOption.label.trim()
              : null;

      const publishPayload = {
        ...formPayload,
        id: sessionId,
        tags: normalizedTags,
        aspectRatio: aspectRatioForPublish,
        ispublishedVideo: true,
      };
      if (sessionLanguage) {
        publishPayload.sessionLanguage = sessionLanguage;
      }
      if (languageString) {
        publishPayload.languageString = languageString;
      }
      if (latestRawVideoLink) {
        publishPayload.videoLink = latestRawVideoLink;
      }
      if (latestVideoUrl) {
        publishPayload.renderedVideoURL = latestVideoUrl;
      }
      const latestThumbnailUrl = [
        formPayload.splashImage,
        latestSessionDetails?.splashImage,
        latestSessionDetails?.publishedSplashImage,
      ].find((value) => typeof value === 'string' && value.trim());
      if (latestThumbnailUrl) {
        publishPayload.splashImage = latestThumbnailUrl;
      }

      const publishResponse = await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/publish_session`,
        publishPayload,
        headers
      );

      const responseData = publishResponse.data || {};
      const publishedSession = responseData.session;
      const publishedPublication = responseData.publication || responseData;
      setSessionDetails((currentSessionDetails) => ({
        ...(currentSessionDetails || latestSessionDetails || {}),
        ...(publishedSession && typeof publishedSession === 'object' ? publishedSession : {}),
        ispublishedVideo: true,
        publishedTitle:
          publishedSession?.publishedTitle ||
          publishedPublication?.title ||
          publishPayload.title ||
          currentSessionDetails?.publishedTitle ||
          null,
        publishedDescription:
          typeof publishedSession?.publishedDescription === 'string'
            ? publishedSession.publishedDescription
            : typeof publishedPublication?.description === 'string'
              ? publishedPublication.description
              : publishPayload.description || '',
        publishedTags:
          publishedSession?.publishedTags ||
          publishedPublication?.tags ||
          normalizedTags,
        publishedAspectRatio:
          publishedSession?.publishedAspectRatio ||
          publishPayload.aspectRatio ||
          null,
        publishedVideoURL:
          publishedSession?.publishedVideoURL ||
          publishedPublication?.videoURL ||
          latestVideoUrl ||
          currentSessionDetails?.publishedVideoURL ||
          null,
        publishedAt:
          publishedSession?.publishedAt ||
          publishedPublication?.updatedAt ||
          currentSessionDetails?.publishedAt ||
          new Date().toISOString(),
        publishedPublicationId:
          publishedSession?.publishedPublicationId ||
          publishedPublication?._id ||
          publishedPublication?.id ||
          currentSessionDetails?.publishedPublicationId ||
          null,
      }));

      toast.success('Video published successfully.', {
        position: 'bottom-center',
        autoClose: 3000,
        hideProgressBar: true,
        className: 'custom-toast',
      });
    } catch (error) {
      toast.error(error?.response?.data?.error || 'Unable to publish video.', {
        position: 'bottom-center',
        autoClose: 5000,
        hideProgressBar: true,
        className: 'custom-toast',
      });
    } finally {
      setIsPublishing(false);
    }
  };

  const handlePublishClick = () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    openAlertDialog(
      <PublishOptionsDialog
        onClose={closeAlertDialog}
        onSubmit={(payload) => {
          closeAlertDialog();
          publishQuickSession(payload);
        }}
        extraProps={{ sessionId: id }}
      />
    );
  };

  const handleUnpublishClick = async () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    const confirmation = window.confirm('Are you sure you want to unpublish this video?');
    if (!confirmation) {
      return;
    }

    setIsUnpublishing(true);

    try {
      await axios.post(
        `${PROCESSOR_API_URL}/video_sessions/unpublish_session`,
        { sessionId: id },
        headers
      );

      await getSessionDetails();
    } catch  {

    } finally {
      setIsUnpublishing(false);
    }
  };

  // ─────────────────────────────────────────────────────────
  //  Generation-status poller
  // ─────────────────────────────────────────────────────────
  const fetchDetailedGenerationStatus = async (requestId, headers) => {
    try {
      const { data } = await axios.get(
        `${VIDEO_STEP_API_BASE}/${encodeURIComponent(requestId)}/status_detailed`,
        headers
      );
      return data;
    } catch (error) {
      const statusCode = error?.response?.status;
      if (statusCode && statusCode !== 400 && statusCode !== 404) {
        throw error;
      }
      const query = new URLSearchParams({ request_id: requestId }).toString();
      const { data } = await axios.get(
        `${VIDEO_STATUS_DETAILED_ENDPOINT}?${query}`,
        headers
      );
      return data;
    }
  };

  const fetchBasicGenerationStatus = async (requestId, headers) => {
    const query = new URLSearchParams({ request_id: requestId }).toString();
    const { data } = await axios.get(
      `${VIDEO_STATUS_ENDPOINT}?${query}`,
      headers
    );
    return data;
  };

  const statusDetailsHasTimelineVideo = (data) => {
    const sessionPreview = data?.session || {};
    const layers = Array.isArray(sessionPreview.layers) ? sessionPreview.layers : [];
    const globalVideos = Array.isArray(sessionPreview.globalVideos) ? sessionPreview.globalVideos : [];

    return (
      globalVideos.some((video) => Boolean(video?.url)) ||
      layers.some((layer) => Boolean(
        layer?.aiVideo?.url ||
        layer?.lipSyncVideo?.url ||
        layer?.soundEffectVideo?.url ||
        layer?.userVideo?.url ||
        (layer?.preview?.type === 'video' && layer?.preview?.url)
      ))
    );
  };

  const maybeRefreshSessionDetailsForTimelinePreview = (data) => {
    if (!statusDetailsHasTimelineVideo(data)) {
      return;
    }

    const now = Date.now();
    if (now - lastTimelinePreviewSessionRefreshRef.current < TIMELINE_PREVIEW_SESSION_REFRESH_MS) {
      return;
    }

    lastTimelinePreviewSessionRefreshRef.current = now;
    getSessionDetails().catch(() => undefined);
  };

  const fetchPostProcessingGenerationStatus = async (requestId, headers) => {
    try {
      return await fetchDetailedGenerationStatus(requestId, headers);
    } catch (error) {
      const statusCode = error?.response?.status;
      if (statusCode !== 400 && statusCode !== 404) {
        throw error;
      }
      return fetchBasicGenerationStatus(requestId, headers);
    }
  };

  const refreshDetailedGenerationStatus = async (requestId, headers) => {
    const data = await fetchDetailedGenerationStatus(requestId, headers);
    if (data?.expressGenerationStatus) {
      setExpressGenerationStatus(data.expressGenerationStatus);
    }
    setGenerationStatusDetails(data);
    maybeRefreshSessionDetailsForTimelinePreview(data);
    return data;
  };

  const pollPostProcessingStatus = (requestId = activeRequestIdRef.current || id, immediate = false) => {
    if (!requestId) return;

    currentPollRequestIdRef.current = requestId;
    if (activeRequestIdRef.current !== requestId) {
      activeRequestIdRef.current = requestId;
      setActiveRequestId(requestId);
    }

    if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current);
    if (immediate) pollDelayRef.current = 0;

    const doPoll = async () => {
      if (currentPollRequestIdRef.current !== requestId) {
        return;
      }

      let continuePolling = true;

      try {
        const headers = getHeaders();
        const data = await fetchPostProcessingGenerationStatus(requestId, headers);

        pollDelayRef.current = DEFAULT_POLL;
        if (data?.expressGenerationStatus) {
          setExpressGenerationStatus(data.expressGenerationStatus);
        }
        setGenerationStatusDetails(data);
        maybeRefreshSessionDetailsForTimelinePreview(data);

        const normalizedStatus = normalizeGenerationStatus(data?.status);
        const isPausedStatus =
          normalizedStatus === 'PAUSED' ||
          data?.expressGenerationPaused === true ||
          data?.session?.expressGenerationPaused === true;
        if (isPausedStatus) {
          continuePolling = false;
          setIsGenerationPending(false);
          setIsGenerationWaitingForApproval(false);
          setIsPaused(true);
          setShowResultDisplay(true);
          return;
        }

        setIsPaused(false);
        setIsGenerationWaitingForApproval(false);

        let videoActualLink = normalizeVideoUrl(extractVideoResultUrl(data));
        if (isCompletedGenerationStatus(normalizedStatus)) {
          if (!videoActualLink) {
            const latestSessionDetails = await getSessionDetails();
            if (currentPollRequestIdRef.current !== requestId) {
              return;
            }
            videoActualLink = getNormalizedLatestVideoUrl(latestSessionDetails);
          }

          if (videoActualLink) {
            continuePolling = false;
            const completedPostProcessingAction = postProcessingPollActionRef.current;
            postProcessingPollActionRef.current = '';
            setIsGenerationPending(false);
            setIsGenerationWaitingForApproval(false);
            setIsPaused(false);
            setShowResultDisplay(true);
            clearAdvancedVideoEditPendingSession(data.session_id || requestId);
            clearPostProcessingPendingSession(data.session_id || requestId);
            if (completedPostProcessingAction === 'reroll_layers') {
              setPostProcessingForm((current) => ({
                ...current,
                rerollLayerIndexes: [],
              }));
              setPostProcessingAction('generated_outro');
            }
            setVideoLink(videoActualLink);
            return;
          }
        }

        const failureStatus = getDetailedGenerationFailureStatus(data);
        if (failureStatus) {
          continuePolling = false;
          setIsGenerationPending(false);
          setIsGenerationWaitingForApproval(false);
          setIsPaused(false);
          clearAdvancedVideoEditPendingSession(data.session_id || requestId);
          clearPostProcessingPendingSession(data.session_id || requestId);
          postProcessingPollActionRef.current = '';
          setErrorMessage({ error: getDetailedGenerationErrorMessage(data, failureStatus) });
        }
      } catch (err) {
        const failureStatus = getDetailedGenerationFailureStatus(err?.response?.data);
        if (failureStatus) {
          continuePolling = false;
          setIsGenerationPending(false);
          setIsGenerationWaitingForApproval(false);
          setIsPaused(false);
          clearAdvancedVideoEditPendingSession(requestId);
          clearPostProcessingPendingSession(requestId);
          postProcessingPollActionRef.current = '';
          setErrorMessage({
            error: getDetailedGenerationErrorMessage(err.response.data, failureStatus),
          });
          return;
        }

        pollDelayRef.current = Math.min(
          pollDelayRef.current ? pollDelayRef.current * 2 : DEFAULT_POLL,
          MAX_BACKOFF
        );
      } finally {
        if (continuePolling && currentPollRequestIdRef.current === requestId) {
          const nextDelay = navigator.onLine ? pollDelayRef.current : OFFLINE_POLL;
          pollIntervalRef.current = setTimeout(doPoll, nextDelay);
        }
      }
    };

    doPoll();
  };

  const pollStepImageGeneration = async ({ requestId, layerId, headers }) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < STEP_IMAGE_GENERATION_TIMEOUT_MS) {
      const { data } = await axios.get(
        `${PROCESSOR_API_URL}/image_sessions/generate_status?id=${encodeURIComponent(requestId)}&layerId=${encodeURIComponent(layerId)}`,
        headers
      );
      const normalizedStatus = typeof data?.status === 'string' ? data.status.trim().toUpperCase() : '';
      if (normalizedStatus === 'COMPLETED') {
        return data;
      }
      if (normalizedStatus === 'FAILED' || normalizedStatus === 'ERROR') {
        throw new Error(data?.generationError || 'Image generation failed.');
      }
      await wait(STEP_IMAGE_GENERATION_POLL_MS);
    }
    throw new Error('Image generation timed out.');
  };

  const handleSelectStepImage = async ({ scene, activeItemList }) => {
    const requestId = activeRequestIdRef.current || activeRequestId || id;
    const layerId = scene?.id;
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    if (!requestId || !layerId || !Array.isArray(activeItemList) || !activeItemList.length) {
      return;
    }

    await axios.post(
      `${PROCESSOR_API_URL}/image_sessions/update_active_item_list`,
      {
        sessionId: requestId,
        layerId,
        activeItemList,
        prompt: activeItemList[0]?.prompt || activeItemList[0]?.generationPrompt || scene?.prompt || null,
      },
      headers
    );
    await refreshDetailedGenerationStatus(requestId, headers);
  };

  const handleRegenerateStepImage = async ({ scene, item, prompt, isPrimary }) => {
    const requestId = activeRequestIdRef.current || activeRequestId || id;
    const layerId = scene?.id;
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    if (!requestId || !layerId || !prompt?.trim()) {
      return;
    }
    if (!selectedImageModel?.value) {
      setErrorMessage({ error: 'Please select an available image model before regenerating this scene.' });
      return;
    }

    await axios.post(
      `${PROCESSOR_API_URL}/image_sessions/request_generate`,
      {
        videoSessionId: requestId,
        layerId,
        prompt: prompt.trim(),
        model: selectedImageModel.value,
        imageStyle: selectedImageStyle?.value,
        aspectRatio: generationStatusDetails?.session?.aspectRatio || selectedAspectRatioOption?.value || '16:9',
        skipApplyThemeToPrompt: true,
        preserveLayerPrompt: true,
        preserveActiveSelectedImage: true,
        appendGeneratedImageCandidate: true,
        replaceActiveItemId: isPrimary ? null : item?.id || item?.itemId || item?.item_id || null,
      },
      headers
    );
    await pollStepImageGeneration({ requestId, layerId, headers });
    await refreshDetailedGenerationStatus(requestId, headers);
    getUserAPI();
  };

  const processNextStepRequest = async (requestId, headers) => {
    const { data } = await axios.post(
      `${VIDEO_STEP_API_BASE}/${encodeURIComponent(requestId)}/process_next`,
      {},
      headers
    );
    if (data?.expressGenerationStatus) {
      setExpressGenerationStatus(data.expressGenerationStatus);
    }
    setGenerationStatusDetails(data);
    setIsGenerationWaitingForApproval(false);
    setIsGenerationPending(true);
    return data;
  };

  const pollGenerationStatus = (requestId = activeRequestIdRef.current || id, immediate = false) => {
    if (!requestId) return;

    const persistedStepMode =
      getPersistedRequestStepMode(requestId) ||
      getPersistedRequestStepMode(id);
    if (persistedStepMode) {
      activeRequestStepModeRef.current = persistedStepMode;
    }

    currentPollRequestIdRef.current = requestId;
    if (activeRequestIdRef.current !== requestId) {
      activeRequestIdRef.current = requestId;
      setActiveRequestId(requestId);
    }

    if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current);
    if (immediate) pollDelayRef.current = 0;

    const doPoll = async () => {
      if (currentPollRequestIdRef.current !== requestId) {
        // Abort polling: request has changed
        return;
      }

      let continuePolling = true;

      try {
        const headers = getHeaders();
        const data = await fetchDetailedGenerationStatus(requestId, headers);

        pollDelayRef.current = DEFAULT_POLL;
        if (data?.expressGenerationStatus) {
          setExpressGenerationStatus(data.expressGenerationStatus);
        }
        setGenerationStatusDetails(data);
        maybeRefreshSessionDetailsForTimelinePreview(data);

        const isPausedStatus =
          normalizeGenerationStatus(data?.status) === 'PAUSED' ||
          data?.expressGenerationPaused === true ||
          data?.session?.expressGenerationPaused === true;
        if (isPausedStatus) {
          continuePolling = false;
          setIsGenerationPending(false);
          setIsGenerationWaitingForApproval(false);
          setIsPaused(true);
          setShowResultDisplay(true);
          return;
        }

        setIsPaused(false);

        const currentStepMode = normalizeGenerationStepMode(activeRequestStepModeRef.current);
        const isWaitingForApproval = isStepStatusWaitingForApproval(data, currentStepMode);
        if (isWaitingForApproval) {
          continuePolling = false;
          setIsGenerationPending(false);
          setIsGenerationWaitingForApproval(true);
          return;
        }

        setIsGenerationWaitingForApproval(false);

        const normalizedStatus = normalizeGenerationStatus(data?.status);
        let videoActualLink = normalizeVideoUrl(extractVideoResultUrl(data));
        if (isCompletedGenerationStatus(normalizedStatus)) {
          if (!videoActualLink) {
            const latestSessionDetails = await getSessionDetails();
            if (currentPollRequestIdRef.current !== requestId) {
              return;
            }
            videoActualLink = getNormalizedLatestVideoUrl(latestSessionDetails);
          }

          if (videoActualLink) {
            continuePolling = false;
            postProcessingPollActionRef.current = '';
            setIsGenerationPending(false);
            setIsGenerationWaitingForApproval(false);
            setIsPaused(false);
            setShowResultDisplay(true);
            clearAdvancedVideoEditPendingSession(data.session_id || requestId);
            clearPostProcessingPendingSession(data.session_id || requestId);
            setVideoLink(videoActualLink);
            return;
          }
        }

        const failureStatus = getDetailedGenerationFailureStatus(data);
        if (failureStatus) {
          continuePolling = false;
          setIsGenerationPending(false);
          setIsGenerationWaitingForApproval(false);
          setIsPaused(false);
          clearAdvancedVideoEditPendingSession(data.session_id || requestId);
          setErrorMessage({ error: getDetailedGenerationErrorMessage(data, failureStatus) });
        }
      } catch (err) {
        const failureStatus = getDetailedGenerationFailureStatus(err?.response?.data);
        if (failureStatus) {
          continuePolling = false;
          setIsGenerationPending(false);
          setIsGenerationWaitingForApproval(false);
          setIsPaused(false);
          clearAdvancedVideoEditPendingSession(requestId);
          setErrorMessage({
            error: getDetailedGenerationErrorMessage(err.response.data, failureStatus),
          });
          return;
        }

        pollDelayRef.current = Math.min(
          pollDelayRef.current ? pollDelayRef.current * 2 : DEFAULT_POLL,
          MAX_BACKOFF
        );

      } finally {
        if (continuePolling && currentPollRequestIdRef.current === requestId) {
          const nextDelay = navigator.onLine ? pollDelayRef.current : OFFLINE_POLL;
          pollIntervalRef.current = setTimeout(doPoll, nextDelay);
        }
      }
    };

    doPoll();
  };

  const handlePauseRender = async () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const requestId = id || activeRequestIdRef.current || activeRequestId;
    if (!requestId || isRenderPauseResumePending) {
      return;
    }

    try {
      setIsRenderPauseResumePending(true);
      const { data } = await axios.post(
        `${VIDEO_API_BASE}/pause_render`,
        { input: { videoSessionId: requestId } },
        headers
      );

      if (pollIntervalRef.current) clearTimeout(pollIntervalRef.current);
      pollIntervalRef.current = null;
      currentPollRequestIdRef.current = null;
      setIsGenerationPending(false);
      setIsGenerationWaitingForApproval(false);
      setIsPaused(true);
      setShowResultDisplay(true);
      setExpressGenerationStatus(data?.expressGenerationStatus || expressGenerationStatus);
      setGenerationStatusDetails((current) => ({
        ...(current || {}),
        status: 'PAUSED',
        expressGenerationPaused: true,
        expressGenerationPending: false,
        expressGenerationStatus: data?.expressGenerationStatus || current?.expressGenerationStatus || expressGenerationStatus,
      }));
      setSessionDetails((current) => current
        ? {
            ...current,
            expressGenerationPaused: true,
            expressGenerationPending: false,
            videoGenerationPending: false,
            expressGenerationStatus: data?.expressGenerationStatus || current.expressGenerationStatus,
          }
        : current);
    } catch (err) {
      const apiMessage = err?.response?.data?.message || err?.message;
      setErrorMessage({ error: apiMessage || 'Unable to pause render.' });
    } finally {
      setIsRenderPauseResumePending(false);
    }
  };

  const handleResumeRender = async () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    const requestId = id || activeRequestIdRef.current || activeRequestId;
    if (!requestId || isRenderPauseResumePending) {
      return;
    }

    try {
      setIsRenderPauseResumePending(true);
      const { data } = await axios.post(
        `${VIDEO_API_BASE}/resume_render`,
        { input: { videoSessionId: requestId } },
        headers
      );

      setErrorMessage(null);
      setIsPaused(false);
      setIsGenerationPending(true);
      setIsGenerationWaitingForApproval(false);
      setShowResultDisplay(true);
      setVideoLink(null);
      setExpressGenerationStatus(data?.expressGenerationStatus || expressGenerationStatus);
      setGenerationStatusDetails((current) => ({
        ...(current || {}),
        status: 'PENDING',
        expressGenerationPaused: false,
        expressGenerationPending: true,
        expressGenerationStatus: data?.expressGenerationStatus || current?.expressGenerationStatus || expressGenerationStatus,
      }));
      setSessionDetails((current) => current
        ? {
            ...current,
            expressGenerationPaused: false,
            expressGenerationPending: true,
            videoGenerationPending: true,
            expressGenerationStatus: data?.expressGenerationStatus || current.expressGenerationStatus,
          }
        : current);
      setActiveRequestId(requestId);
      activeRequestIdRef.current = requestId;
      pollGenerationStatus(requestId, true);
    } catch (err) {
      const apiMessage = err?.response?.data?.message || err?.message;
      setErrorMessage({ error: apiMessage || 'Unable to resume render.' });
    } finally {
      setIsRenderPauseResumePending(false);
    }
  };

  const handleProcessNextStep = useCallback(async () => {
    const requestId = activeRequestIdRef.current || activeRequestId || id;
    if (
      !requestId ||
      isProcessingNextStep ||
      activeRequestStepModeRef.current !== GENERATION_STEP_MODE_TWO_STEP
    ) {
      return;
    }
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    setIsProcessingNextStep(true);
    setErrorMessage(null);
    try {
      await processNextStepRequest(requestId, headers);
      pollGenerationStatus(requestId, true);
    } catch (error) {
      const apiMessage = error?.response?.data?.message || error?.message;
      setErrorMessage({ error: apiMessage || 'Unable to continue video generation.' });
    } finally {
      setIsProcessingNextStep(false);
    }
  }, [
    activeRequestId,
    id,
    isProcessingNextStep,
    showLoginDialog,
  ]);

  useEffect(() => {
    if (
      !isGenerationWaitingForApproval ||
      activeRequestStepModeRef.current === GENERATION_STEP_MODE_TWO_STEP
    ) {
      return;
    }

    const requestId = activeRequestIdRef.current || activeRequestId || id;
    setIsGenerationWaitingForApproval(false);
    setIsGenerationPending(true);
    if (requestId) {
      pollGenerationStatus(requestId, true);
    }
  }, [activeRequestId, id, isGenerationWaitingForApproval]);


  // ─────────────────────────────────────────────────────────
  //  Assistant-query poller
  // ─────────────────────────────────────────────────────────
  const startAssistantQueryPoll = () => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    if (assistantPollRef.current) clearInterval(assistantPollRef.current);
    assistantErrorCountRef.current = 0;

    assistantPollRef.current = setInterval(() => {
      axios
        .get(`${PROCESSOR_API_URL}/assistants/assistant_query_status?id=${id}`, headers)
        .then((res) => {
          assistantErrorCountRef.current = 0;
          const data = res.data;
          if (data.status === 'COMPLETED') {
            clearInterval(assistantPollRef.current);
            setSessionMessages(data.sessionDetails.sessionMessages);
            setIsAssistantQueryGenerating(false);
          }
        })
        .catch(() => {

          assistantErrorCountRef.current += 1;
          if (assistantErrorCountRef.current >= 3) {
            clearInterval(assistantPollRef.current);
            setIsAssistantQueryGenerating(false);
          }
        });
    }, 1000);
  };

  // ─────────────────────────────────────────────────────────
  //  Submit assistant query
  // ─────────────────────────────────────────────────────────
  const submitAssistantQuery = (query) => {
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    setSessionMessages([]);
    setIsAssistantQueryGenerating(true);

    axios
      .post(
        `${PROCESSOR_API_URL}/assistants/submit_assistant_query`,
        { id, query },
        headers
      )
      .then(() => startAssistantQueryPoll())
      .catch(() => {

        setIsAssistantQueryGenerating(false);
      });
  };

  // Placeholder: fetchSessionImageLayers
  const getSessionImageLayers = () => {
    /* ... */
  };

  // ─────────────────────────────────────────────────────────
  //  Fetch session details
  // ─────────────────────────────────────────────────────────
  const getSessionDetails = async () => {

    try {
      setSessionLoadFailed(false);
      setSessionLoadError('');
      const canUseAnonymousDockerStatus = currentEnv === 'docker';
      let headers = user?._id ? getHeaders() : null;
      if (!headers && !canUseAnonymousDockerStatus && user?._id) {
        await getUserAPI();
        headers = getHeaders();
      }

      let data;
      if (!headers && initialGuestSessionRef.current) {
        data = initialGuestSessionRef.current;
        initialGuestSessionRef.current = null;
      } else if (headers) {
        let sessionResponse;
        try {
          sessionResponse = await axios.get(
            `${API_SERVER}/video_sessions/session_details?id=${encodeURIComponent(id)}&cacheBust=${Date.now()}`,
            headers
          );
        } catch (sessionDetailsError) {
          if (sessionDetailsError?.response?.status === 401) {
            await getUserAPI();
            headers = getHeaders();
            if (headers) {
              try {
                sessionResponse = await axios.get(
                  `${API_SERVER}/video_sessions/session_details?id=${encodeURIComponent(id)}&cacheBust=${Date.now()}`,
                  headers
                );
              } catch {
                sessionResponse = null;
              }
            }
          }

          if (!sessionResponse) {
            try {
              const statusData = await fetchDetailedGenerationStatus(id, headers);
              const fallbackSession = buildDockerAnonymousSessionDetailsFromStatus(statusData);
              if (isPlainObject(fallbackSession) && (
                isPlainObject(fallbackSession.session) ||
                Array.isArray(fallbackSession.layers) ||
                isPlainObject(fallbackSession.expressGenerationStatus)
              )) {
                setGenerationStatusDetails(statusData);
                data = fallbackSession;
              } else {
                throw sessionDetailsError;
              }
            } catch {
              throw sessionDetailsError;
            }
          }
        }
        data = data || sessionResponse?.data;
      } else if (canUseAnonymousDockerStatus) {
        const statusData = await fetchDetailedGenerationStatus(id);
        if (statusData?.expressGenerationStatus) {
          setExpressGenerationStatus(statusData.expressGenerationStatus);
        }
        setGenerationStatusDetails(statusData);
        data = buildDockerAnonymousSessionDetailsFromStatus(statusData);
      } else {
        const sessionResponse = await axios.get(
          `${API_SERVER}/video_sessions/session_details?id=${encodeURIComponent(id)}&cacheBust=${Date.now()}`
        );
        data = sessionResponse.data;
      }

      if (!data) {
        setSessionLoadFailed(true);
        return null;
      }
      setSessionDetails(data);
      const forceAdvancedEditPoll = shouldForceAdvancedVideoEditPolling(id);
      const usePostProcessingPoll = shouldUsePostProcessingStatusPolling(id);
      const latestVideoUrl = getNormalizedLatestVideoUrl(data);
      const hasPausedGeneration = Boolean(data.expressGenerationPaused);
      const hasPendingGeneration = isSessionGenerationPending(
        data,
        forceAdvancedEditPoll || usePostProcessingPoll
      );
      const failureStatus = getDetailedGenerationFailureStatus(data);
      const loadedProjectView = resolveVidgenieLoadedProjectView({
        hasPausedGeneration,
        hasPendingGeneration,
        hasStartedGeneration: hasStartedGenerationSession(data),
        latestVideoUrl,
        failureStatus,
      });
      const isCurrentSessionRequest =
        !activeRequestIdRef.current ||
        activeRequestIdRef.current === id;
      const resolvedGenerationMode = resolveVidgenieGenerationModeFromSession(data);
      if (resolvedGenerationMode) {
        setGenerationMode(resolvedGenerationMode);
      }

      if (data.inputPrompt) {
        updatePromptText(data.inputPrompt);
      }


      if (!activeRequestIdRef.current) {
        if (hasPausedGeneration) {
          setIsPaused(true);
          setIsGenerationPending(false);
          setIsGenerationWaitingForApproval(false);
          setShowResultDisplay(true);
          setExpressGenerationStatus(data.expressGenerationStatus);
          if (headers && !usePostProcessingPoll) {
            refreshDetailedGenerationStatus(id, headers).catch(() => undefined);
          }
        } else if (hasPendingGeneration) {
          setIsPaused(false);
          setIsGenerationPending(true);
          setShowResultDisplay(true);
          setExpressGenerationStatus(data.expressGenerationStatus);
          if (usePostProcessingPoll) {
            if (headers && isCurrentSessionRequest) {
              pollPostProcessingStatus(id);
            }
          } else {
            if (headers) {
              refreshDetailedGenerationStatus(id, headers).catch(() => undefined);
            }
            if (headers && isCurrentSessionRequest) {
              pollGenerationStatus(id);
            }
          }
        } else if (latestVideoUrl) {
          setVideoLink(latestVideoUrl);
          setIsPaused(false);
          setIsGenerationPending(false);
          setShowResultDisplay(true);
          setExpressGenerationStatus(data.expressGenerationStatus);
          if (headers && !usePostProcessingPoll) {
            refreshDetailedGenerationStatus(id, headers).catch(() => undefined);
          }
          clearAdvancedVideoEditPendingSession(id);
          clearPostProcessingPendingSession(id);
        } else if (loadedProjectView.showResultDisplay) {
          setIsPaused(false);
          setIsGenerationPending(false);
          setIsGenerationWaitingForApproval(false);
          setShowResultDisplay(true);
          setExpressGenerationStatus(data.expressGenerationStatus);
          if (failureStatus) {
            setErrorMessage({
              error: getDetailedGenerationErrorMessage(data, failureStatus),
            });
          }
          if (headers && !usePostProcessingPoll) {
            refreshDetailedGenerationStatus(id, headers)
              .then((statusData) => {
                const detailedFailureStatus = getDetailedGenerationFailureStatus(statusData);
                if (detailedFailureStatus) {
                  setErrorMessage({
                    error: getDetailedGenerationErrorMessage(statusData, detailedFailureStatus),
                  });
                }
              })
              .catch(() => undefined);
          }
        }
      } else if (hasPendingGeneration && activeRequestIdRef.current === id) {
        setIsPaused(false);
        setIsGenerationPending(true);
        setShowResultDisplay(true);
        setExpressGenerationStatus(data.expressGenerationStatus);
        if (usePostProcessingPoll) {
          pollPostProcessingStatus(id);
        } else {
          refreshDetailedGenerationStatus(id, headers).catch(() => undefined);
          pollGenerationStatus(id);
        }
      } else if (hasPausedGeneration) {
        setIsPaused(true);
        setIsGenerationPending(false);
        setIsGenerationWaitingForApproval(false);
        setShowResultDisplay(true);
        setExpressGenerationStatus(data.expressGenerationStatus);
        if (headers && !usePostProcessingPoll) {
          refreshDetailedGenerationStatus(id, headers).catch(() => undefined);
        }
      } else if (!hasPendingGeneration && latestVideoUrl) {
        setVideoLink(latestVideoUrl);
        setIsPaused(false);
        setIsGenerationPending(false);
        setShowResultDisplay(true);
        setExpressGenerationStatus(data.expressGenerationStatus);
        if (headers && !usePostProcessingPoll) {
          refreshDetailedGenerationStatus(id, headers).catch(() => undefined);
        }
        clearAdvancedVideoEditPendingSession(id);
        clearPostProcessingPendingSession(id);
      } else if (loadedProjectView.showResultDisplay) {
        setIsPaused(false);
        setIsGenerationPending(false);
        setIsGenerationWaitingForApproval(false);
        setShowResultDisplay(true);
        setExpressGenerationStatus(data.expressGenerationStatus);
        if (failureStatus) {
          setErrorMessage({
            error: getDetailedGenerationErrorMessage(data, failureStatus),
          });
        }
        if (headers && !usePostProcessingPoll) {
          refreshDetailedGenerationStatus(id, headers)
            .then((statusData) => {
              const detailedFailureStatus = getDetailedGenerationFailureStatus(statusData);
              if (detailedFailureStatus) {
                setErrorMessage({
                  error: getDetailedGenerationErrorMessage(statusData, detailedFailureStatus),
                });
              }
            })
            .catch(() => undefined);
        }
      }

      if (data.sessionMessages) setSessionMessages(data.sessionMessages);
      return data;
    } catch (error) {
      const apiMessage = error?.response?.data?.error || error?.response?.data?.message;
      setSessionLoadError(apiMessage || 'The project could not be loaded. Please try again.');
      setSessionLoadFailed(true);
      return null;
    }
  };

  useEffect(() => {
    if (currentEnv !== 'docker' || !id) {
      return undefined;
    }

    let didCancel = false;

    const hydrateDockerAnonymousPreview = async () => {
      try {
        const statusData = await fetchDetailedGenerationStatus(id);
        if (didCancel) {
          return;
        }

        if (statusData?.expressGenerationStatus) {
          setExpressGenerationStatus(statusData.expressGenerationStatus);
        }
        setGenerationStatusDetails(statusData);

        const data = buildDockerAnonymousSessionDetailsFromStatus(statusData);
        setSessionDetails(data);

        const latestVideoUrl = getNormalizedLatestVideoUrl(data);
        const hasPausedGeneration = Boolean(data?.expressGenerationPaused);
        const hasPendingGeneration = isSessionGenerationPending(data);

        if (hasPausedGeneration) {
          setIsPaused(true);
          setIsGenerationPending(false);
          setIsGenerationWaitingForApproval(false);
          setShowResultDisplay(true);
          return;
        }

        if (hasPendingGeneration) {
          setIsPaused(false);
          setIsGenerationPending(true);
          setIsGenerationWaitingForApproval(false);
          setShowResultDisplay(true);
          if (!activeRequestIdRef.current) {
            pollGenerationStatus(id, true);
          }
          return;
        }

        if (latestVideoUrl) {
          setVideoLink(latestVideoUrl);
          setIsPaused(false);
          setIsGenerationPending(false);
          setShowResultDisplay(true);
        }
      } catch {
        // Docker anonymous preview is best-effort; the basic status poll still drives progress text.
      }
    };

    hydrateDockerAnonymousPreview();

    return () => {
      didCancel = true;
    };
  }, [currentEnv, id]);

  async function refreshLatestVideoLink() {
    const latestSessionDetails = await getSessionDetails();
    const latestVideoUrl = getNormalizedLatestVideoUrl(latestSessionDetails) || normalizeVideoUrl(videoLink);
    if (latestVideoUrl) {
      setVideoLink(latestVideoUrl);
    }
    return latestVideoUrl;
  }

  // ─────────────────────────────────────────────────────────
  //  Fetch latest videos
  // ─────────────────────────────────────────────────────────
  const fetchLatestVideos = async () => {
    /* ... */
  };

  // ─────────────────────────────────────────────────────────
  //  Toggle inline-playback
  // ─────────────────────────────────────────────────────────


  // ─────────────────────────────────────────────────────────
  //  Image-list source controls
  // ─────────────────────────────────────────────────────────
  const updateImageListItem = useCallback((index, patch) => {
    setImageListItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );
  }, []);

  const addImageListItem = useCallback(() => {
    setImageListItems((current) => [...current, createEmptyImageListItem()]);
  }, []);

  const removeImageListItem = useCallback((index) => {
    setImageListItems((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      return next.length ? next : [createEmptyImageListItem()];
    });
  }, []);

  const moveImageListItem = useCallback((fromIndex, toIndex) => {
    setImageListItems((current) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= current.length ||
        toIndex >= current.length
      ) {
        return current;
      }
      const next = [...current];
      const [movedItem] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, movedItem);
      return next;
    });
  }, []);

  const uploadImageListFile = useCallback(async (index, file) => {
    if (!file || uploadingImageIndex !== null) {
      return;
    }
    if (!file.type?.startsWith('image/')) {
      setImageUploadError('Upload an image file.');
      return;
    }
    if (!user) {
      showLoginDialog();
      return;
    }
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    setUploadingImageIndex(index);
    setImageUploadError('');
    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      const { data } = await axios.post(
        `${VIDEO_API_BASE}/upload_image_data`,
        { input: { image_data: [imageDataUrl] } },
        headers
      );
      const uploadedUrl = Array.isArray(data?.image_urls)
        ? data.image_urls.find((url) => typeof url === 'string' && url.trim())
        : '';
      if (!uploadedUrl) {
        throw new Error('Upload did not return an image URL.');
      }
      setImageListItems((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index
            ? {
                ...item,
                image_url: uploadedUrl.trim(),
              }
            : item
        )
      );
    } catch (err) {
      const apiMessage = err?.response?.data?.message || err?.message;
      setImageUploadError(apiMessage || 'Image upload failed.');
    } finally {
      setUploadingImageIndex(null);
    }
  }, [showLoginDialog, uploadingImageIndex, user]);

  const handleImageListUploadInput = useCallback((index, event) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) {
      uploadImageListFile(index, file).catch(() => undefined);
    }
  }, [uploadImageListFile]);

  const handleImageListUploadDrop = useCallback((index, event) => {
    event.preventDefault();
    event.stopPropagation();
    const file = Array.from(event.dataTransfer.files || []).find((candidate) =>
      candidate.type?.startsWith('image/')
    );
    if (file) {
      uploadImageListFile(index, file).catch(() => undefined);
      return;
    }
    setImageUploadError('Drop an image file.');
  }, [uploadImageListFile]);

  const uploadOutroCtaImageFile = useCallback(async (file, target = 'advanced') => {
    if (!file || uploadingOutroCtaImage) {
      return;
    }
    if (!file.type?.startsWith('image/')) {
      setOutroCtaImageUploadError('Upload an image file.');
      return;
    }
    if (!user) {
      showLoginDialog();
      return;
    }
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    setUploadingOutroCtaImage(true);
    setOutroCtaImageUploadError('');
    try {
      const imageDataUrl = await readFileAsDataUrl(file);
      const { data } = await axios.post(
        `${VIDEO_API_BASE}/upload_image_data`,
        { input: { image_data: [imageDataUrl] } },
        headers
      );
      const uploadedUrl = Array.isArray(data?.image_urls)
        ? data.image_urls.find((url) => typeof url === 'string' && url.trim())
        : '';
      if (!uploadedUrl) {
        throw new Error('Upload did not return an image URL.');
      }
      if (target === 'post_processing') {
        setPostProcessingForm((current) => ({
          ...current,
          outroCtaType: OUTRO_CTA_TYPE_IMAGE,
          outroCtaImageUrl: uploadedUrl.trim(),
        }));
        setPostProcessingError('');
        setPostProcessingMessage('');
      } else {
        updateAdvancedOption('outro_cta_type', OUTRO_CTA_TYPE_IMAGE);
        updateAdvancedOption('outro_cta_image_url', uploadedUrl.trim());
      }
    } catch (err) {
      const apiMessage = err?.response?.data?.message || err?.message;
      setOutroCtaImageUploadError(apiMessage || 'CTA image upload failed.');
    } finally {
      setUploadingOutroCtaImage(false);
    }
  }, [showLoginDialog, updateAdvancedOption, uploadingOutroCtaImage, user]);

  const handleOutroCtaImageUploadInput = useCallback((event, target = 'advanced') => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) {
      uploadOutroCtaImageFile(file, target).catch(() => undefined);
    }
  }, [uploadOutroCtaImageFile]);

  // ─────────────────────────────────────────────────────────
  //  Submit the text-to-video request
  // ─────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();

    const submittedGenerationStepMode = normalizeGenerationStepMode(generationStepMode);

    if (!user) {
      showLoginDialog();
      return;
    }
    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }
    if (!id) return;
    if (isVoiceBusy) {
      stopAllVoiceCapture();
    }

    if (isJsonMode) {
      if (isDockerModelFilteringEnabled && isDeploymentModelAvailabilityLoading) {
        setJsonValidationMessage('Docker model availability is still loading.');
        setErrorMessage(null);
        setShowResultDisplay(false);
        return;
      }
      const jsonRequest = buildJsonModeRequest(
        jsonInputText,
        id,
        generationMode,
        inferenceModelOptions,
        deploymentModelAvailability
      );
      if (jsonRequest.error) {
        setJsonValidationMessage(jsonRequest.error);
        setErrorMessage(null);
        setShowResultDisplay(false);
        return;
      }

      if (jsonRequest.normalizedJson && jsonRequest.normalizedJson !== jsonInputText.trim()) {
        setJsonInputText(jsonRequest.normalizedJson);
      }
      setJsonValidationMessage('');
      setIsJsonRequestExpanded(false);
      setJsonCopyStatus('');
      setErrorMessage(null);
      setIsSubmitting(true);
      setIsGenerationPending(true);
      setIsPaused(false);
      setShowResultDisplay(true);
      setVideoLink(null);
      setExpressGenerationStatus(null);
      setGenerationStatusDetails(null);
      setIsGenerationWaitingForApproval(false);
      setActiveRequestId(null);
      activeRequestIdRef.current = null;
      activeRequestStepModeRef.current = submittedGenerationStepMode;
      setCurrentRenderGeneratedOutro(payloadRequestsGeneratedOutro(jsonRequest.payload));

      try {
        const { data } = await axios.post(
          getStepGenerationEndpoint(jsonRequest.endpoint),
          attachStepGenerationInput(jsonRequest.payload, submittedGenerationStepMode),
          headers
        );
        const requestId = data?.request_id || data?.session_id || data?.sessionID;
        if (!requestId) {
          throw new Error('Missing request id in response.');
        }
        setActiveRequestId(requestId);
        activeRequestIdRef.current = requestId;
        persistRequestStepMode([requestId, id], submittedGenerationStepMode);
        pollGenerationStatus(requestId);
      } catch (err) {
        const apiMessage = err?.response?.data?.message || err?.message;
        setErrorMessage({ error: apiMessage || 'An unexpected error occurred.' });
        setIsGenerationPending(false);
        setIsGenerationWaitingForApproval(false);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    const isTextToVideo = generationMode === 'T2V';
    const trimmedPromptText = promptText.trim();
    if (trimmedPromptText.length > VIDGENIE_PROMPT_MAX_LENGTH) {
      setErrorMessage({
        error: t(
          "vidgenie.promptTooLong",
          { max: VIDGENIE_PROMPT_MAX_LENGTH },
          "Prompt must be {max} characters or fewer."
        ),
      });
      return;
    }
    if (isTextToVideo && !trimmedPromptText) {
      setErrorMessage({ error: 'Please enter some text before submitting.' });
      return;
    }
    const normalizedImageListItems = imageListItems
      .map((item) => ({
        image_url: (item.image_url || '').trim(),
        image_text: (item.image_text || '').trim(),
      }))
      .filter((item) => item.image_url);

    const invalidImageUrl = normalizedImageListItems.find((item) => !isHttpUrl(item.image_url));
    if (!isTextToVideo && normalizedImageListItems.length === 0) {
      setErrorMessage({ error: 'Please add at least one image URL or upload an image.' });
      return;
    }
    if (!isTextToVideo && invalidImageUrl) {
      setErrorMessage({ error: 'Image URLs must be valid http(s) URLs.' });
      return;
    }
    if (isDockerModelFilteringEnabled && isDeploymentModelAvailabilityLoading) {
      setErrorMessage({ error: 'Docker model availability is still loading.' });
      return;
    }
    if (
      !selectedImageModel?.value ||
      !stageImageModels.some((model) => model.value === selectedImageModel.value)
    ) {
      setErrorMessage({ error: 'Please select an available image model before submitting.' });
      return;
    }
    if (isTextToVideo && !selectedVideoModel?.value) {
      setErrorMessage({ error: 'Please select a video model before submitting.' });
      return;
    }
    const advancedRequestConfiguration = buildAdvancedRequestConfiguration({
      isTextToVideo,
      advancedOptions,
      customAdapters: user?.custom_adapters,
      selectedCustomAdapterEndpointId,
      selectedInferenceModel,
      inferenceModelOptions,
    });
    if (advancedRequestConfiguration.error) {
      setErrorMessage({ error: advancedRequestConfiguration.error });
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    setIsGenerationPending(true);
    setIsPaused(false);
    setShowResultDisplay(true);
    setVideoLink(null);
    setExpressGenerationStatus(null);
    setGenerationStatusDetails(null);
    setIsGenerationWaitingForApproval(false);
    setActiveRequestId(null);
    activeRequestIdRef.current = null;
    activeRequestStepModeRef.current = submittedGenerationStepMode;

    const requestInput = {
      image_model: selectedImageModel.value,
      aspect_ratio: selectedAspectRatioOption.value,
    };
    if (isTextToVideo) {
      requestInput.prompt = trimmedPromptText;
      requestInput.video_model = selectedVideoModel.value;
      requestInput.duration = selectedDurationOption.value;
      requestInput.tone = advancedRequestConfiguration.input.tone || 'grounded';
      if (selectedVideoModelSubType?.value) {
        requestInput.video_model_sub_type = selectedVideoModelSubType.value;
      }
      if (selectedImageStyle?.value) {
        requestInput.image_style = selectedImageStyle.value;
      }
    }

    const selectedLanguageValue =
      typeof selectedLanguageOption === 'string'
        ? selectedLanguageOption
        : selectedLanguageOption?.value ?? selectedLanguageOption?.label;
    const resolvedAudioLanguage = resolveLanguageCode(selectedLanguageValue);
    const selectedSubtitleLanguageValue =
      typeof selectedSubtitleLanguageOption === 'string'
        ? selectedSubtitleLanguageOption
        : selectedSubtitleLanguageOption?.value ?? selectedSubtitleLanguageOption?.label;
    const resolvedSubtitleLanguage = resolveLanguageCode(selectedSubtitleLanguageValue, '');
    Object.assign(requestInput, buildVidgenieLanguageFields({
      audioLanguage: resolvedAudioLanguage,
      enableSubtitles,
      subtitleLanguage: resolvedSubtitleLanguage,
    }));
    Object.assign(requestInput, advancedRequestConfiguration.input);
    const stepGenerationInput = buildStepGenerationInput(submittedGenerationStepMode);
    Object.assign(requestInput, stepGenerationInput);
    setCurrentRenderGeneratedOutro(requestInput.generate_outro_image === true);

    try {
      if (!isTextToVideo) {
        requestInput.image_urls = normalizedImageListItems.map((item) => {
          const imagePayload = {};
          imagePayload.image_url = item.image_url;
          if (item.image_text) {
            imagePayload.image_text = item.image_text;
          }
          return imagePayload;
        });
        if (selectedVideoModel?.value) {
          requestInput.video_model = selectedVideoModel.value;
        }
        if (trimmedPromptText) {
          requestInput.prompt = trimmedPromptText;
        }
      }

      const payload = {
        input: { ...requestInput, session_id: id },
        ...advancedRequestConfiguration.root,
        ...stepGenerationInput,
      };
      const endpoint = isTextToVideo
        ? `${VIDEO_STEP_API_BASE}/text_to_video`
        : `${VIDEO_STEP_API_BASE}/image_to_video`;
      const { data } = await axios.post(endpoint, payload, headers);
      const requestId = data?.request_id || data?.session_id || data?.sessionID;
      if (!requestId) {
        throw new Error('Missing request id in response.');
      }
      setActiveRequestId(requestId);
      activeRequestIdRef.current = requestId;
      persistRequestStepMode([requestId, id], submittedGenerationStepMode);
      pollGenerationStatus(requestId);
    } catch (err) {

      const apiMessage = err?.response?.data?.message;
      setErrorMessage({ error: apiMessage || 'An unexpected error occurred.' });
      setIsGenerationPending(false);
      setIsGenerationWaitingForApproval(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────
  //  Reset the entire form
  // ─────────────────────────────────────────────────────────
  const resetForm = () => {
    stopAllVoiceCapture();
    voiceBasePromptRef.current = '';
    voiceTranscriptRef.current = '';
    setVoiceStatusMessage(null);
    setVoiceError(null);
    setPromptText('');
    setShowResultDisplay(false);
    setErrorMessage(null);
    setVideoLink(null);
    setExpressGenerationStatus(null);
    setGenerationStatusDetails(null);
    setIsGenerationPending(false);
    setIsGenerationWaitingForApproval(false);
    setIsProcessingNextStep(false);
    setIsSubmitting(false);
    setActiveRequestId(null);
    activeRequestIdRef.current = null;
    activeRequestStepModeRef.current = GENERATION_STEP_MODE_ONE_STEP;
    currentPollRequestIdRef.current = null;
    postProcessingPollActionRef.current = '';
    setSessionMessages([]);
    setIsAssistantQueryGenerating(false);   // ⬅️ NEW
    setIsPaused(false);                     // ⬅️ NEW
    setSessionDetails(null);                // ⬅️ NEW
    setImageListItems([createEmptyImageListItem()]);
    setUploadingImageIndex(null);
    setImageUploadError('');
    setUploadingOutroCtaImage(false);
    setOutroCtaImageUploadError('');
    setEnableSubtitles(DEFAULT_VIDGENIE_SUBTITLES_ENABLED);
    setSelectedSubtitleLanguageOption(subtitleLanguageOptions[0]);
    setGenerationStepMode(GENERATION_STEP_MODE_ONE_STEP);
    setSelectedImageStyle(null);
    setIsAdvancedOpen(false);
    setAdvancedOptions({ ...DEFAULT_ADVANCED_OPTIONS });
    setSelectedInferenceModel(getInferenceModelOption(user?.selectedInferenceModel, DEFAULT_INFERENCE_MODEL, inferenceModelOptions));
    setSelectedCustomAdapterEndpointId('');
    setPricingDetailsDisplay(false);        // ⬅️ NEW
    setSelectedVideoModelSubType(null);     // ⬅️ NEW
    setExpandedVideoId(null);               // ⬅️ NEW
    setIsJsonInputDirty(false);
    setJsonValidationMessage('');
    setPostProcessingAction('generated_outro');
    setPostProcessingForm(createDefaultPostProcessingForm());
    setPostProcessingPendingAction('');
    setPostProcessingMessage('');
    setPostProcessingError('');
    setCurrentRenderGeneratedOutro(false);
    setIsCompletedRequestExpanded(false);
    completedRequestCollapseKeyRef.current = '';
  };


  // ─────────────────────────────────────────────────────────
  //  Utility: view in Studio
  // ─────────────────────────────────────────────────────────
  const viewInStudio = () => navigate(`/video/${id}`);

  const handleGenerationModeChange = (mode) => {
    setGenerationMode(mode);
    if (isJsonMode) {
      setIsJsonInputDirty(false);
      setJsonValidationMessage('');
      setErrorMessage(null);
    }
  };

  const toggleJsonMode = () => {
    if (isVoiceBusy) {
      stopAllVoiceCapture();
    }
    setJsonValidationMessage('');
    setErrorMessage(null);
    setIsJsonMode((enabled) => !enabled);
  };

  const handleAdvancedVideoEditAccepted = useCallback((requestInfo) => {
    const nextSessionId = requestInfo?.sessionId || requestInfo?.requestId;
    const nextRequestId = requestInfo?.requestId || nextSessionId;
    const useBasicStatusPoll = requestInfo?.pollMode === 'status';
    const currentPreviewVideoUrl = useBasicStatusPoll
      ? (normalizeVideoUrl(videoLink) || getNormalizedLatestVideoUrl(sessionDetails))
      : null;
    closeAlertDialog();

    if (!nextRequestId) {
      return;
    }

    setErrorMessage(null);
    setVideoLink(null);
    setShowResultDisplay(true);
    setIsPaused(false);
    setIsGenerationPending(requestInfo?.status !== 'CANCELLED');
    setIsGenerationWaitingForApproval(false);
    setActiveRequestId(nextRequestId);
    activeRequestIdRef.current = nextRequestId;
    activeRequestStepModeRef.current = GENERATION_STEP_MODE_ONE_STEP;

    if (nextSessionId && nextSessionId !== id) {
      if (useBasicStatusPoll) {
        setPostProcessingPreviewVideoLink(currentPreviewVideoUrl);
        setPostProcessingPendingSession(nextSessionId, currentPreviewVideoUrl);
      } else {
        setAdvancedVideoEditPendingSession(nextSessionId);
      }
      navigate(`/vidgenie/${nextSessionId}`);
      return;
    }

    if (useBasicStatusPoll) {
      setPostProcessingPreviewVideoLink(currentPreviewVideoUrl);
      setPostProcessingPendingSession(nextRequestId, currentPreviewVideoUrl);
      pollPostProcessingStatus(nextRequestId, true);
    } else {
      pollGenerationStatus(nextRequestId, true);
    }
  }, [closeAlertDialog, id, navigate, sessionDetails, videoLink]);

  const openAdvancedVideoEditDialog = useCallback(() => {
    openAlertDialog(
      <VideoEditAdvancedDialog
        sessionId={id}
        currentSession={sessionDetails}
        onClose={closeAlertDialog}
        onRequestAccepted={handleAdvancedVideoEditAccepted}
      />,
      undefined,
      true,
      { hideBorder: true, hideCloseButton: true, centerContent: true }
    );
  }, [closeAlertDialog, handleAdvancedVideoEditAccepted, id, openAlertDialog, sessionDetails]);

  const updatePostProcessingFormField = useCallback((field, value) => {
    setPostProcessingForm((current) => ({
      ...current,
      [field]: value,
    }));
    setPostProcessingError('');
    setPostProcessingMessage('');
  }, []);

  const selectPostProcessingAction = useCallback((actionKey) => {
    setPostProcessingAction(actionKey);
    setPostProcessingError('');
    setPostProcessingMessage('');
    setPlayingRerollLayerId(null);

    if (actionKey !== 'reroll_layers') {
      return;
    }

    const requestId = activeRequestIdRef.current || activeRequestId || id;
    const headers = getHeaders();
    if (!requestId || !headers) {
      return;
    }

    setIsRerollPreviewRefreshing(true);
    refreshDetailedGenerationStatus(requestId, headers)
      .catch(() => {
        setPostProcessingError('Unable to refresh scene previews. You can still reroll using the available scene list.');
      })
      .finally(() => {
        setIsRerollPreviewRefreshing(false);
      });
  }, [activeRequestId, id, refreshDetailedGenerationStatus]);

  const toggleRerollLayerIndex = useCallback((layerIndex) => {
    setPostProcessingForm((current) => {
      const currentIndexes = normalizeRerollLayerIndexes(current.rerollLayerIndexes);
      const nextIndexes = currentIndexes.includes(layerIndex)
        ? currentIndexes.filter((index) => index !== layerIndex)
        : [...currentIndexes, layerIndex].sort((a, b) => a - b);
      return {
        ...current,
        rerollLayerIndexes: nextIndexes,
      };
    });
    setPostProcessingError('');
    setPostProcessingMessage('');
  }, []);

  const toggleRerollLayerPlayback = useCallback((layerId) => {
    setPlayingRerollLayerId((currentLayerId) => (
      currentLayerId === layerId ? null : layerId
    ));
  }, []);

  const submitPostProcessingOperation = useCallback(async (actionKey) => {
    if (!user) {
      showLoginDialog();
      return;
    }

    const headers = getHeaders();
    if (!headers) {
      showLoginDialog();
      return;
    }

    if (!id || postProcessingPendingAction) {
      return;
    }

    const hasExistingOutro = currentRenderHasOutro;
    let endpoint = '';
    let payload = { videoSessionId: id };
    let successLabel = 'Post-processing';

    try {
      if (actionKey === 'retranslate') {
        const languageCode = resolveLanguageCode(postProcessingForm.translationLanguage, '');
        if (!languageCode || languageCode === 'auto') {
          throw new Error('Choose a target language for retranslation.');
        }

        payload = {
          ...payload,
          language: languageCode,
          enable_subtitles: postProcessingForm.translationEnableSubtitles === true,
          translate_outro: postProcessingForm.translationTranslateOutro !== false,
          translate_footer: postProcessingForm.translationTranslateFooter !== false,
        };
        endpoint = 'retranslate_video';
        successLabel = 'Retranslation';
      } else if (actionKey === 'add_subtitles') {
        payload = {
          ...payload,
          ...buildSubtitleRegenerationLanguageFields({
            selectedLanguage: postProcessingForm.subtitleLanguage,
            audioLanguage: postProcessingAudioLanguage,
          }),
        };
        endpoint = 'add_subtitles';
        successLabel = 'Subtitle regeneration';
      } else if (actionKey === 'remove_subtitles') {
        const shouldRemove = window.confirm('Remove subtitles and render a new version?');
        if (!shouldRemove) {
          return;
        }

        endpoint = 'remove_subtitles';
        successLabel = 'Subtitle removal';
      } else if (actionKey === 'regenerate_avatar') {
        const shouldRegenerateAvatar = window.confirm(
          'Generate a fresh narrator avatar and render a new version?'
        );
        if (!shouldRegenerateAvatar) {
          return;
        }

        endpoint = 'regenerate_avatar';
        successLabel = 'Narrator avatar regeneration';
      } else if (actionKey === 'clone_render') {
        endpoint = 'clone';
        successLabel = 'Clone render';
      } else if (actionKey === 'generated_outro') {
        const outroCtaType =
          postProcessingForm.outroCtaType === OUTRO_CTA_TYPE_IMAGE
            ? OUTRO_CTA_TYPE_IMAGE
            : OUTRO_CTA_TYPE_QR;
        const ctaTextTop = postProcessingForm.ctaTextTop.trim();
        const ctaTextBottom = postProcessingForm.ctaTextBottom.trim();
        const ctaLogo = postProcessingForm.ctaLogo.trim();

        payload = {
          ...payload,
          generate_outro_image: true,
        };

        if (outroCtaType === OUTRO_CTA_TYPE_IMAGE) {
          const middleImageUrl = postProcessingForm.outroCtaImageUrl.trim();
          if (!middleImageUrl) {
            throw new Error('CTA image URL or upload is required.');
          }
          if (!isHttpUrl(middleImageUrl)) {
            throw new Error('Enter a valid CTA image URL.');
          }

          const outroCtaImage = {
            middle_image: { url: middleImageUrl },
          };
          if (ctaTextTop) outroCtaImage.top_text = ctaTextTop;
          if (ctaTextBottom) outroCtaImage.bottom_text = ctaTextBottom;
          payload.outro_cta_image = outroCtaImage;
        } else {
          const ctaUrl = postProcessingForm.ctaUrl.trim();
          if (!isHttpUrl(ctaUrl)) {
            throw new Error('Enter a valid outro CTA URL.');
          }
          payload.cta_url = ctaUrl;
          if (ctaTextTop) payload.cta_text_top = ctaTextTop;
          if (ctaTextBottom) payload.cta_text_bottom = ctaTextBottom;
          if (ctaLogo) payload.cta_logo = ctaLogo;
        }

        endpoint = hasExistingOutro ? 'update_outro_image' : 'add_outro_image';
        successLabel = hasExistingOutro ? 'Outro CTA update' : 'Outro CTA add';
      } else if (actionKey === 'footer_cta') {
        const ctaText = postProcessingForm.footerCtaText.trim();
        const ctaLogo = postProcessingForm.footerCtaLogo.trim();
        const ctaUrl = postProcessingForm.footerCtaUrl.trim();
        if (!ctaText && !ctaLogo && !ctaUrl) {
          throw new Error('Add footer text, logo, or URL.');
        }
        if (ctaUrl && !isHttpUrl(ctaUrl)) {
          throw new Error('Enter a valid footer URL.');
        }

        payload = { ...payload };
        if (ctaText) payload.cta_text = ctaText;
        if (ctaLogo) payload.cta_logo = ctaLogo;
        if (ctaUrl) payload.cta_url = ctaUrl;

        endpoint = 'update_footer_image';
        successLabel = 'Footer update';
      } else if (actionKey === 'remove_footer') {
        const shouldRemove = window.confirm('Remove the footer CTA and render a new version?');
        if (!shouldRemove) {
          return;
        }

        payload = {
          ...payload,
          remove_footer: true,
        };
        endpoint = 'update_footer_image';
        successLabel = 'Footer removal';
      } else if (actionKey === 'reroll_layers') {
        if (!rerollLayerIndexes.length) {
          throw new Error('Select at least one scene to reroll.');
        }

        payload = {
          ...payload,
          layer_indexes: rerollLayerIndexes,
        };
        endpoint = 'reroll-layers';
        successLabel = 'Scene reroll';
      } else {
        return;
      }

      setPostProcessingPendingAction(actionKey);
      setPostProcessingError('');
      setPostProcessingMessage('');
      setErrorMessage(null);
      setPlayingRerollLayerId(null);

      const requestBody = { input: payload };
      const { primaryUrl, legacyUrl } = getVideoPostProcessingRequestUrls(
        API_SERVER,
        endpoint
      );
      let response;
      try {
        response = await axios.post(primaryUrl, requestBody, headers);
      } catch (requestError) {
        const supportsLegacyVideoRoute =
          endpoint === 'add_subtitles' || endpoint === 'remove_subtitles';
        if (
          !supportsLegacyVideoRoute ||
          !isMissingVideoPostProcessingRoute(requestError, primaryUrl)
        ) {
          throw requestError;
        }
        response = await axios.post(legacyUrl, requestBody, headers);
      }
      const { data } = response;

      const nextSessionId = data?.sessionID || data?.session_id || data?.sessionId || data?.request_id;
      const nextRequestId = data?.request_id || data?.session_id || data?.sessionID || nextSessionId;
      if (!nextRequestId) {
        throw new Error('Post-processing did not return a request id.');
      }

      postProcessingPollActionRef.current = actionKey;
      setPostProcessingMessage(`${successLabel} queued.`);
      if (actionKey === 'generated_outro') {
        setCurrentRenderGeneratedOutro(true);
      }
      getUserAPI();
      handleAdvancedVideoEditAccepted({
        sessionId: nextSessionId,
        requestId: nextRequestId,
        status: data?.status,
        pollMode: 'status',
      });
    } catch (error) {
      const apiMessage = error?.response?.data?.message || error?.message;
      setPostProcessingError(apiMessage || 'Unable to start post-processing.');
    } finally {
      setPostProcessingPendingAction('');
    }
  }, [
    getUserAPI,
    handleAdvancedVideoEditAccepted,
    id,
    postProcessingAudioLanguage,
    postProcessingForm,
    postProcessingPendingAction,
    rerollLayerIndexes,
    currentRenderHasOutro,
    showLoginDialog,
    user,
  ]);

  // ─────────────────────────────────────────────────────────
  //  Purchase credits
  // ─────────────────────────────────────────────────────────
  const purchaseCreditsForUser = goToPurchaseCredits;

  // ─────────────────────────────────────────────────────────
  //  Pricing info
  // ─────────────────────────────────────────────────────────
  const [pricingDetailsDisplay, setPricingDetailsDisplay] = useState(false);
  const togglePricingDetailsDisplay = () => setPricingDetailsDisplay(!pricingDetailsDisplay);

  const selectedVideoModelKey = selectedVideoModel?.value || '';
  const hasSelectedCustomAdapters = hasTextValue(selectedCustomAdapterEndpointId);
  const creditsPerSecondVideo = useMemo(() => {
    return getExpressVideoCreditsPerSecond(selectedVideoModelKey) ?? (generationMode === 'I2V' ? 60 : 30);
  }, [generationMode, selectedVideoModelKey]);


  const expectedCreditsPerSecond = useMemo(() => {
    return creditsPerSecondVideo;
  }, [creditsPerSecondVideo]);

  const pricingInfoDisplay = (
    <div className="relative">
      <div
        className={`flex items-center gap-1 font-medium text-sm cursor-pointer select-none ${colorMode === 'dark' ? 'text-neutral-100' : 'text-slate-700'}`}
        onClick={togglePricingDetailsDisplay}
      >
        {isJsonMode || currentEnv === 'docker' || hasSelectedCustomAdapters ? (
          <div>{t("vidgenie.pricingApiCharge")}</div>
        ) : (
          <div className="inline-flex items-center">
            {t("vidgenie.pricingCreditsPerSecond", { credits: expectedCreditsPerSecond })}
          </div>
        )}
        <FaChevronCircleDown
          className={`inline-flex ml-1 transition-transform duration-300 ${pricingDetailsDisplay ? 'rotate-180' : ''}`}
        />
      </div>
      {pricingDetailsDisplay && (
        <div className={`mt-2 text-sm text-left ${mutedText} transition-opacity duration-300`}>
          {isJsonMode || currentEnv === 'docker' || hasSelectedCustomAdapters ? (
            <div>{t("vidgenie.pricingApiCharge")}</div>
          ) : (
            <>
              <div>{t("vidgenie.pricingTotalShown")}</div>
              <div>{t("vidgenie.pricingExample", { credits: 60 * creditsPerSecondVideo })}</div>
            </>
          )}
        </div>
      )}
    </div>
  );

  const jsonModeLanguageValue =
    typeof selectedLanguageOption === 'string'
      ? selectedLanguageOption
      : selectedLanguageOption?.value ?? selectedLanguageOption?.label;
  const jsonModeSubtitleLanguageValue =
    typeof selectedSubtitleLanguageOption === 'string'
      ? selectedSubtitleLanguageOption
      : selectedSubtitleLanguageOption?.value ?? selectedSubtitleLanguageOption?.label;
  const jsonModeDefaultInput = useMemo(() => (
    buildDefaultJsonModeInput({
      mode: generationMode,
      imageModel: selectedImageModel?.value || '',
      videoModel: selectedVideoModel?.value || '',
      duration: selectedDurationOption?.value || 30,
      aspectRatio: selectedAspectRatioOption?.value || '16:9',
      language: resolveLanguageCode(jsonModeLanguageValue, 'en'),
      enableSubtitles,
      subtitleLanguage: resolveLanguageCode(jsonModeSubtitleLanguageValue, ''),
      inferenceModel: selectedInferenceModel?.value || inferenceModelOptions[0]?.value || user?.selectedInferenceModel || DEFAULT_INFERENCE_MODEL,
    })
  ), [
    enableSubtitles,
    generationMode,
    jsonModeLanguageValue,
    jsonModeSubtitleLanguageValue,
    selectedAspectRatioOption?.value,
    selectedDurationOption?.value,
    selectedImageModel?.value,
    selectedInferenceModel?.value,
    inferenceModelOptions,
    selectedVideoModel?.value,
    user?.selectedInferenceModel,
  ]);

  useEffect(() => {
    if (!isJsonInputDirty) {
      setJsonInputText(jsonModeDefaultInput);
    }
  }, [isJsonInputDirty, jsonModeDefaultInput]);

  const jsonModeValidation = useMemo(() => {
    if (!isJsonMode) {
      return { error: '' };
    }
    return buildJsonModeRequest(
      jsonInputText,
      id,
      generationMode,
      inferenceModelOptions,
      deploymentModelAvailability
    );
  }, [deploymentModelAvailability, generationMode, id, inferenceModelOptions, isJsonMode, jsonInputText]);

  useEffect(() => {
    const normalizedJson = jsonModeValidation.normalizedJson;
    if (!isJsonMode || !normalizedJson || normalizedJson === jsonInputText.trim()) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setJsonInputText((current) => {
        const currentValidation = buildJsonModeRequest(
          current,
          id,
          generationMode,
          inferenceModelOptions,
          deploymentModelAvailability
        );
        return currentValidation.normalizedJson || current;
      });
      setJsonValidationMessage('');
    }, 600);

    return () => window.clearTimeout(timeoutId);
  }, [
    deploymentModelAvailability,
    generationMode,
    id,
    inferenceModelOptions,
    isJsonMode,
    jsonInputText,
    jsonModeValidation.normalizedJson,
  ]);

  const jsonRequestDisplayText = jsonModeValidation.normalizedJson || jsonInputText;
  const copyJsonRequestToClipboard = useCallback(async () => {
    if (!jsonRequestDisplayText.trim()) {
      return;
    }
    try {
      await navigator.clipboard.writeText(jsonRequestDisplayText);
      setJsonCopyStatus('Copied');
    } catch {
      setJsonCopyStatus('Copy failed');
    }
  }, [jsonRequestDisplayText]);

  useEffect(() => {
    if (!jsonCopyStatus) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => setJsonCopyStatus(''), 1800);
    return () => window.clearTimeout(timeoutId);
  }, [jsonCopyStatus]);

  const jsonEditorErrorMessage = isJsonMode ? (jsonModeValidation.error || '') : '';
  const jsonEditorAnnotations = useMemo(() => {
    if (!jsonEditorErrorMessage) {
      return [];
    }

    return [
      {
        row: Number.isFinite(jsonModeValidation.row) ? jsonModeValidation.row : 0,
        column: Number.isFinite(jsonModeValidation.column) ? jsonModeValidation.column : 0,
        type: 'error',
        text: jsonEditorErrorMessage,
      },
    ];
  }, [
    jsonEditorErrorMessage,
    jsonModeValidation.column,
    jsonModeValidation.row,
  ]);

  // ─────────────────────────────────────────────────────────
  //  Render-state helpers
  // ─────────────────────────────────────────────────────────
  const renderState = useMemo(() => {
    if (isPaused) return 'paused';
    if (isGenerationPending || isGenerationWaitingForApproval) return 'pending';
    if (videoLink) return 'complete';
    return 'idle';
  }, [isGenerationPending, isGenerationWaitingForApproval, isPaused, videoLink]);
  const sessionInferenceModelKey = useMemo(
    () => resolveInferenceModelFromSession(sessionDetails),
    [sessionDetails],
  );
  const sessionInferenceModelLabel = sessionInferenceModelKey
    ? getInferenceModelDisplayLabel(sessionInferenceModelKey)
    : '';
  const shouldCollapseOriginalRequest = renderState === 'complete' && Boolean(videoLink);
  const shouldShowOriginalRequestInputs =
    !shouldCollapseOriginalRequest || isCompletedRequestExpanded;
  useEffect(() => {
    if (!shouldCollapseOriginalRequest) {
      completedRequestCollapseKeyRef.current = '';
      return;
    }

    const collapseKey = id || activeRequestId || videoLink || 'completed-render';
    if (completedRequestCollapseKeyRef.current !== collapseKey) {
      completedRequestCollapseKeyRef.current = collapseKey;
      setIsCompletedRequestExpanded(false);
    }
  }, [activeRequestId, id, shouldCollapseOriginalRequest, videoLink]);
  const shouldCollapseJsonEditorForProgress =
    isJsonMode && showResultDisplay && (
      isGenerationPending ||
      isGenerationWaitingForApproval ||
      isPaused ||
      Boolean(videoLink)
    );

  const isFormDisabled = renderState !== 'idle' || isDisabled;
  const isModeToggleDisabled = isDisabled || renderState === 'pending' || renderState === 'paused' || isSubmitting;
  const isGenerationActionDisabled =
    isFormDisabled ||
    isSubmitting ||
    Boolean(jsonEditorErrorMessage) ||
    isDockerInferenceUnavailable;
  const dockerInferenceUnavailableMessage = isDockerInferenceModelFilteringEnabled
    ? isInferenceModelAvailabilityLoading
      ? 'Loading configured inference models...'
      : hasConfiguredInferenceModels
        ? ''
        : 'Configure OpenAI, Google Cloud, Alibaba Cloud, OpenRouter, or a Samsar API key in setup to enable VidGenie inference.'
    : '';
  const isCompletedSessionPublished = Boolean(sessionDetails?.ispublishedVideo);
  const rerollEstimateImageModel =
    rerollCandidateSourceSession?.expressGenerationImageModel ||
    rerollCandidateSourceSession?.imageModel ||
    sessionDetails?.expressGenerationImageModel ||
    sessionDetails?.imageModel ||
    selectedImageModel?.value ||
    '';
  const rerollEstimateVideoModel =
    rerollCandidateSourceSession?.expressGenerativeVideoModel ||
    rerollCandidateSourceSession?.videoGenerationModel ||
    rerollCandidateSourceSession?.videoModel ||
    sessionDetails?.expressGenerativeVideoModel ||
    sessionDetails?.videoGenerationModel ||
    sessionDetails?.videoModel ||
    selectedVideoModel?.value ||
    '';
  const rerollEstimateAspectRatio =
    rerollCandidateSourceSession?.aspectRatio ||
    rerollCandidateSourceSession?.aspect_ratio ||
    sessionDetails?.aspectRatio ||
    selectedAspectRatioOption?.value ||
    '16:9';
  const rerollLocalCreditEstimate = useMemo(() => getRerollLocalCreditEstimate({
    layerIndexes: rerollLayerIndexes,
    candidateLayers: rerollCandidateLayers,
    imageModel: rerollEstimateImageModel,
    videoModel: rerollEstimateVideoModel,
    aspectRatio: rerollEstimateAspectRatio,
  }), [
    rerollCandidateLayers,
    rerollEstimateAspectRatio,
    rerollEstimateImageModel,
    rerollEstimateVideoModel,
    rerollLayerIndexKey,
  ]);
  const renderCompletedVideoActions = (extraClasses = '') => {
    if (renderState !== 'complete' || !videoLink) {
      return null;
    }

    return (
      <div className={`flex flex-col justify-center gap-2 sm:flex-row ${extraClasses}`}>
        <PrimaryPublicButton
          extraClasses="w-full sm:w-auto px-4 py-2 rounded-xl shadow-sm hover:shadow-md transition active:scale-[0.98]"
          onClick={viewInStudio}
          isDisabled={isGuestPreview}
        >
          View&nbsp;in&nbsp;Studio
        </PrimaryPublicButton>
        <PrimaryPublicButton
          extraClasses="w-full sm:w-auto px-4 py-2 rounded-xl shadow-sm hover:shadow-md transition active:scale-[0.98]"
          onClick={
            isCompletedSessionPublished
              ? handleUnpublishClick
              : handlePublishClick
          }
          isPending={
            isCompletedSessionPublished ? isUnpublishing : isPublishing
          }
          isDisabled={isGuestPreview || isPublishing || isUnpublishing}
        >
          {isCompletedSessionPublished
            ? isUnpublishing
              ? t("vidgenie.unpublishing")
              : t("vidgenie.unpublish")
            : isPublishing
              ? t("vidgenie.publishing")
              : t("vidgenie.publish")}
        </PrimaryPublicButton>
        <PrimaryPublicButton
          extraClasses="w-full sm:w-auto px-4 py-2 rounded-xl shadow-sm hover:shadow-md transition active:scale-[0.98]"
          onClick={handleDownloadVideo}
          isPending={isDownloadingVideo}
          isDisabled={isGuestPreview || !videoLink}
        >
          {isDownloadingVideo ? 'Downloading' : t("common.download")}
        </PrimaryPublicButton>
      </div>
    );
  };
  const renderCompletedPostProcessingControls = (extraClasses = '') => {
    if (isGuestPreview || renderState !== 'complete' || !videoLink) {
      return null;
    }

    const hasExistingOutro = currentRenderHasOutro;
    const isAnyPostProcessingPending = Boolean(postProcessingPendingAction);
    const panelClass =
      colorMode === 'dark'
        ? 'bg-[#0b1224] text-slate-100 ring-white/10'
        : 'bg-white text-slate-900 ring-slate-200';
    const inputClass =
      colorMode === 'dark'
        ? 'border-white/10 bg-[#111a2f] text-slate-100 placeholder:text-slate-500 focus:border-cyan-300'
        : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:border-blue-400';
    const subtleButtonClass =
      colorMode === 'dark'
        ? 'border-white/10 text-slate-100 hover:border-white/20 hover:bg-white/5'
        : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50';
    const activeActionClass =
      colorMode === 'dark'
        ? 'bg-cyan-400/15 text-cyan-100 ring-cyan-300/25'
        : 'bg-blue-50 text-blue-700 ring-blue-200';
    const inactiveActionClass =
      colorMode === 'dark'
        ? 'text-slate-300 ring-white/10 hover:bg-white/5'
        : 'text-slate-600 ring-slate-200 hover:bg-slate-50';
    const submitButtonClass =
      'inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60';
    const primarySubmitClass =
      colorMode === 'dark'
        ? `${submitButtonClass} bg-cyan-300 text-slate-950 hover:bg-cyan-200`
        : `${submitButtonClass} bg-blue-600 text-white hover:bg-blue-700`;
    const secondarySubmitClass = `${submitButtonClass} border ${subtleButtonClass}`;
    const dangerSubmitClass =
      colorMode === 'dark'
        ? `${submitButtonClass} border border-rose-300/30 text-rose-100 hover:bg-rose-400/10`
        : `${submitButtonClass} border border-rose-200 text-rose-700 hover:bg-rose-50`;
    const fieldClass = `min-h-[40px] w-full rounded-lg border px-3 py-2 text-sm outline-none transition ${inputClass}`;
    const checkboxClass = 'mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500';
    const isGeneratedOutroPending = postProcessingPendingAction === 'generated_outro';
    const isFooterPending = postProcessingPendingAction === 'footer_cta';
    const isRemoveFooterPending = postProcessingPendingAction === 'remove_footer';
    const isRetranslatePending = postProcessingPendingAction === 'retranslate';
    const isAddSubtitlesPending = postProcessingPendingAction === 'add_subtitles';
    const isRemoveSubtitlesPending = postProcessingPendingAction === 'remove_subtitles';
    const isAvatarPending = postProcessingPendingAction === 'regenerate_avatar';
    const isClonePending = postProcessingPendingAction === 'clone_render';
    const isRerollPending = postProcessingPendingAction === 'reroll_layers';
    const rerollQuoteTotalCredits = Number(rerollLocalCreditEstimate?.totalCredits);
    const rerollQuoteImageCredits = Number(rerollLocalCreditEstimate?.imageCredits);
    const rerollQuoteVideoCredits = Number(rerollLocalCreditEstimate?.aiVideoCredits);
    const hasRerollQuote = Number.isFinite(rerollQuoteTotalCredits);
    const isRerollSubmitDisabled =
      isAnyPostProcessingPending ||
      isRerollPreviewRefreshing ||
      !rerollLayerIndexes.length;
    const useTranslatedSubtitleRegeneration = isTranslatedSubtitleRegeneration({
      selectedLanguage: postProcessingForm.subtitleLanguage,
      audioLanguage: postProcessingAudioLanguage,
    });

    const panelWidthClass =
      postProcessingAction === 'reroll_layers' || postProcessingAction === 'retranslate'
        ? 'max-w-5xl'
        : 'max-w-3xl';

    return (
      <div className={`mx-auto w-full ${panelWidthClass} rounded-xl p-3 ring-1 ${panelClass} ${extraClasses}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold">Post-processing</div>
          <div className="flex flex-wrap items-center gap-2">
            {POST_PROCESSING_ACTIONS.map((action) => {
              const Icon = action.icon;
              const isActive = postProcessingAction === action.key;
              const isDisabled =
                isAnyPostProcessingPending;
              return (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => selectPostProcessingAction(action.key)}
                  disabled={isDisabled}
                  title={action.label}
                  className={`
                    inline-flex min-h-[34px] items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 transition
                    ${isActive ? activeActionClass : inactiveActionClass}
                    ${isDisabled ? 'cursor-not-allowed opacity-50' : 'active:scale-[0.98]'}
                  `}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-3">
          {postProcessingAction === 'retranslate' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <select
                  value={postProcessingForm.translationLanguage}
                  onChange={(event) =>
                    updatePostProcessingFormField('translationLanguage', event.target.value)
                  }
                  disabled={isAnyPostProcessingPending}
                  aria-label="Retranslation language"
                  className={fieldClass}
                >
                  <option value="">Choose target language</option>
                  {SUPPORTED_LANGUAGES.map((languageOption) => (
                    <option key={languageOption.code} value={languageOption.code}>
                      {languageOption.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => submitPostProcessingOperation('retranslate')}
                  disabled={isAnyPostProcessingPending || !postProcessingForm.translationLanguage}
                  className={primarySubmitClass}
                >
                  {isRetranslatePending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaLanguage className="h-3.5 w-3.5" aria-hidden="true" />}
                  Retranslate video
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${inactiveActionClass}`}>
                  <input
                    type="checkbox"
                    checked={postProcessingForm.translationEnableSubtitles}
                    onChange={(event) =>
                      updatePostProcessingFormField('translationEnableSubtitles', event.target.checked)
                    }
                    disabled={isAnyPostProcessingPending}
                    className={checkboxClass}
                  />
                  <span>Add translated subtitles</span>
                </label>
                <label className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${inactiveActionClass}`}>
                  <input
                    type="checkbox"
                    checked={postProcessingForm.translationTranslateOutro}
                    onChange={(event) =>
                      updatePostProcessingFormField('translationTranslateOutro', event.target.checked)
                    }
                    disabled={isAnyPostProcessingPending}
                    className={checkboxClass}
                  />
                  <span>Translate outro</span>
                </label>
                <label className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ring-1 ${inactiveActionClass}`}>
                  <input
                    type="checkbox"
                    checked={postProcessingForm.translationTranslateFooter}
                    onChange={(event) =>
                      updatePostProcessingFormField('translationTranslateFooter', event.target.checked)
                    }
                    disabled={isAnyPostProcessingPending}
                    className={checkboxClass}
                  />
                  <span>Translate footer</span>
                </label>
              </div>
            </div>
          )}

          {postProcessingAction === 'avatar' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => submitPostProcessingOperation('regenerate_avatar')}
                disabled={isAnyPostProcessingPending}
                className={primarySubmitClass}
              >
                {isAvatarPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaUserCircle className="h-3.5 w-3.5" aria-hidden="true" />}
                Regenerate narrator avatar
              </button>
            </div>
          )}

          {postProcessingAction === 'subtitles' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[190px] flex-1 sm:max-w-xs">
                  <span className={`mb-1 block text-[11px] font-medium ${mutedText}`}>
                    Subtitle language <span className="font-normal opacity-75">(optional)</span>
                  </span>
                  <select
                    value={postProcessingForm.subtitleLanguage}
                    onChange={(event) =>
                      updatePostProcessingFormField('subtitleLanguage', event.target.value)
                    }
                    disabled={isAnyPostProcessingPending}
                    aria-label="Subtitle regeneration language"
                    className={`${fieldClass} !min-h-[36px] !py-1.5`}
                  >
                    <option value="">Same as audio</option>
                    {SUPPORTED_LANGUAGES.map((languageOption) => (
                      <option key={languageOption.code} value={languageOption.code}>
                        {languageOption.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => submitPostProcessingOperation('add_subtitles')}
                  disabled={isAnyPostProcessingPending}
                  className={primarySubmitClass}
                >
                  {isAddSubtitlesPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaClosedCaptioning className="h-3.5 w-3.5" aria-hidden="true" />}
                  Generate / regenerate subtitles
                </button>
                <button
                  type="button"
                  onClick={() => submitPostProcessingOperation('remove_subtitles')}
                  disabled={isAnyPostProcessingPending}
                  className={dangerSubmitClass}
                >
                  {isRemoveSubtitlesPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaTrash className="h-3.5 w-3.5" aria-hidden="true" />}
                  Remove subtitles
                </button>
              </div>
              {useTranslatedSubtitleRegeneration ? (
                <p className={`text-xs ${mutedText}`}>
                  Audio stays unchanged; subtitle text will be translated and aligned to the original speech.
                </p>
              ) : null}
            </div>
          )}

          {postProcessingAction === 'generated_outro' && (
            <div className="space-y-3">
              <select
                value={postProcessingForm.outroCtaType || OUTRO_CTA_TYPE_QR}
                onChange={(event) => {
                  updatePostProcessingFormField('outroCtaType', event.target.value);
                  setOutroCtaImageUploadError('');
                }}
                disabled={isAnyPostProcessingPending}
                className={fieldClass}
                aria-label="Outro CTA type"
              >
                {OUTRO_CTA_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={postProcessingForm.ctaTextTop}
                  onChange={(event) => updatePostProcessingFormField('ctaTextTop', event.target.value)}
                  placeholder="Top text"
                  aria-label="Outro top text"
                  className={fieldClass}
                />
                <input
                  type="text"
                  value={postProcessingForm.ctaTextBottom}
                  onChange={(event) => updatePostProcessingFormField('ctaTextBottom', event.target.value)}
                  placeholder="Bottom text"
                  aria-label="Outro bottom text"
                  className={fieldClass}
                />
                {postProcessingForm.outroCtaType === OUTRO_CTA_TYPE_IMAGE ? (
                  <div className="sm:col-span-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        type="url"
                        value={postProcessingForm.outroCtaImageUrl}
                        onChange={(event) => {
                          updatePostProcessingFormField('outroCtaImageUrl', event.target.value);
                          setOutroCtaImageUploadError('');
                        }}
                        placeholder="CTA / logo URL"
                        aria-label="CTA image URL"
                        disabled={isAnyPostProcessingPending || uploadingOutroCtaImage}
                        className={`${fieldClass} flex-1`}
                      />
                      <label
                        className={`
                          inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition
                          ${subtleButtonClass}
                          ${isAnyPostProcessingPending || uploadingOutroCtaImage ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
                        `}
                      >
                        <input
                          type="file"
                          accept="image/*,image/heic,image/heif,.heic,.heif"
                          onChange={(event) => handleOutroCtaImageUploadInput(event, 'post_processing')}
                          disabled={isAnyPostProcessingPending || uploadingOutroCtaImage}
                          className="sr-only"
                        />
                        {uploadingOutroCtaImage ? (
                          <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <FaUpload className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {uploadingOutroCtaImage ? 'Uploading...' : 'Upload image'}
                      </label>
                    </div>
                    {outroCtaImageUploadError ? (
                      <p className="mt-1 text-[11px] text-rose-500">
                        {outroCtaImageUploadError}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <input
                    type="url"
                    value={postProcessingForm.ctaUrl}
                    onChange={(event) => updatePostProcessingFormField('ctaUrl', event.target.value)}
                    placeholder="Outro CTA URL"
                    aria-label="Outro CTA URL"
                    className={fieldClass}
                  />
                )}
              </div>
              <button
                type="button"
                onClick={() => submitPostProcessingOperation('generated_outro')}
                disabled={isAnyPostProcessingPending}
                className={primarySubmitClass}
              >
                {isGeneratedOutroPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                {hasExistingOutro ? 'Update outro CTA' : 'Add outro CTA'}
              </button>
            </div>
          )}

          {postProcessingAction === 'footer_cta' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  type="text"
                  value={postProcessingForm.footerCtaText}
                  onChange={(event) => updatePostProcessingFormField('footerCtaText', event.target.value)}
                  placeholder="Footer text"
                  aria-label="Footer CTA text"
                  className={fieldClass}
                />
                <input
                  type="url"
                  value={postProcessingForm.footerCtaUrl}
                  onChange={(event) => updatePostProcessingFormField('footerCtaUrl', event.target.value)}
                  placeholder="Footer URL"
                  aria-label="Footer CTA URL"
                  className={fieldClass}
                />
                <input
                  type="url"
                  value={postProcessingForm.footerCtaLogo}
                  onChange={(event) => updatePostProcessingFormField('footerCtaLogo', event.target.value)}
                  placeholder="Footer logo URL"
                  aria-label="Footer CTA logo URL"
                  className={fieldClass}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => submitPostProcessingOperation('footer_cta')}
                  disabled={isAnyPostProcessingPending}
                  className={primarySubmitClass}
                >
                  {isFooterPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
                  Update footer
                </button>
                <button
                  type="button"
                  onClick={() => submitPostProcessingOperation('remove_footer')}
                  disabled={isAnyPostProcessingPending}
                  className={dangerSubmitClass}
                >
                  {isRemoveFooterPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaTrash className="h-3.5 w-3.5" aria-hidden="true" />}
                  Remove footer
                </button>
              </div>
            </div>
          )}

          {postProcessingAction === 'advanced_edits' && (
            <button
              type="button"
              onClick={openAdvancedVideoEditDialog}
              disabled={isAnyPostProcessingPending}
              className={secondarySubmitClass}
            >
              <FaCog className="h-3.5 w-3.5" aria-hidden="true" />
              Open advanced edits
            </button>
          )}

          {postProcessingAction === 'clone_render' && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => submitPostProcessingOperation('clone_render')}
                disabled={isAnyPostProcessingPending}
                className={secondarySubmitClass}
              >
                {isClonePending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaClone className="h-3.5 w-3.5" aria-hidden="true" />}
                Clone render
              </button>
            </div>
          )}

          {postProcessingAction === 'reroll_layers' && (
            <div className="space-y-3">
              {isRerollPreviewRefreshing ? (
                <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${
                  colorMode === 'dark' ? 'bg-white/[0.04] text-slate-300' : 'bg-slate-50 text-slate-600'
                }`}>
                  <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Refreshing scene previews
                </div>
              ) : null}
              {rerollCandidateLayers.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {rerollCandidateLayers.map((item) => {
                    const isSelected = rerollLayerIndexes.includes(item.layerIndex);
                    return (
                      <RerollScenePreviewTile
                        key={item.layerId}
                        item={item}
                        isSelected={isSelected}
                        isPlaying={playingRerollLayerId === item.layerId}
                        isDisabled={isAnyPostProcessingPending}
                        colorMode={colorMode}
                        mutedText={mutedText}
                        activeActionClass={activeActionClass}
                        inactiveActionClass={inactiveActionClass}
                        onToggleSelect={toggleRerollLayerIndex}
                        onTogglePlayback={toggleRerollLayerPlayback}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className={`rounded-lg px-3 py-2 text-sm ${mutedText}`}>
                  No rerollable scenes found.
                </div>
              )}

              <div className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                colorMode === 'dark' ? 'bg-white/[0.04] text-slate-100' : 'bg-slate-50 text-slate-800'
              }`}>
                {hasRerollQuote ? (
                  <span>
                    Estimated credits: {rerollQuoteTotalCredits}
                    {Number.isFinite(rerollQuoteImageCredits) && Number.isFinite(rerollQuoteVideoCredits)
                      ? ` (${rerollQuoteImageCredits} image + ${rerollQuoteVideoCredits} AI video)`
                      : ''}
                  </span>
                ) : (
                  <span className={mutedText}>Select scenes to estimate credits.</span>
                )}
              </div>

              <button
                type="button"
                onClick={() => submitPostProcessingOperation('reroll_layers')}
                disabled={isRerollSubmitDisabled}
                className={primarySubmitClass}
              >
                {isRerollPending ? <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FaRedo className="h-3.5 w-3.5" aria-hidden="true" />}
                Reroll selected scenes
              </button>
            </div>
          )}
        </div>

        {postProcessingError ? (
          <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-500">
            {postProcessingError}
          </div>
        ) : null}
        {postProcessingMessage ? (
          <div className={`mt-3 rounded-lg px-3 py-2 text-sm font-semibold ${
            colorMode === 'dark'
              ? 'bg-emerald-400/10 text-emerald-200'
              : 'bg-emerald-50 text-emerald-700'
          }`}>
            {postProcessingMessage}
          </div>
        ) : null}
      </div>
    );
  };
  const jsonModeButtonLabel = isJsonMode
    ? t("vidgenie.wizardMode", {}, "Wizard mode")
    : t("vidgenie.jsonMode", {}, "JSON mode");
  const dateNowStr = new Date().toISOString().replace(/[:.]/g, '-');
  const toggleShell =
    colorMode === 'dark'
      ? 'bg-[#0b1226] ring-1 ring-white/10'
      : 'bg-white ring-1 ring-slate-200';
  const toggleActive =
    colorMode === 'dark'
      ? 'bg-indigo-500 text-white shadow'
      : 'bg-indigo-600 text-white shadow';
  const toggleInactive =
    colorMode === 'dark'
      ? 'text-slate-300 hover:text-white hover:bg-white/5'
      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100';
  const modeTooltipClassName = `vidgenie-mode-tooltip ${
    colorMode === 'dark'
      ? 'vidgenie-mode-tooltip--dark'
      : 'vidgenie-mode-tooltip--light'
  }`;
  const textToVideoTooltip = t(
    "vidgenie.textToVideoTabTooltip",
    {},
    "Create videos in any style or theme from text prompts."
  );
  const imageToVideoTooltip = t(
    "vidgenie.imageToVideoTabTooltip",
    {},
    "Create marketing or ad videos from image list + product description"
  );
  const imagePickerShell =
    colorMode === 'dark'
      ? 'bg-gray-950/90 text-white ring-white/10'
      : 'bg-white text-slate-900 ring-slate-200';
  const advancedInputClasses = `
    w-full rounded-lg px-3 py-2 text-sm outline-none ring-1 transition
    ${colorMode === 'dark'
      ? 'bg-[#0b1224] text-slate-100 ring-white/10 focus:ring-indigo-400/60 placeholder:text-slate-500'
      : 'bg-white text-slate-900 ring-slate-200 focus:ring-indigo-500/50 placeholder:text-slate-400'
    }
  `;
  const advancedCompactSelectClasses = `
    h-8 w-36 shrink-0 rounded-lg px-2 text-xs outline-none ring-1 transition sm:w-48
    ${colorMode === 'dark'
      ? 'bg-[#0b1224] text-slate-100 ring-white/10 focus:ring-indigo-400/60'
      : 'bg-white text-slate-900 ring-slate-200 focus:ring-indigo-500/50'
    }
  `;
  const advancedLabelClasses = `block text-[11px] font-medium mb-1 ${mutedText}`;
  const advancedSectionBorder = colorMode === 'dark' ? 'border-white/10' : 'border-slate-200';
  const advancedRowBg = colorMode === 'dark' ? 'bg-white/[0.03]' : 'bg-slate-50';
  const stepModeShell =
    colorMode === 'dark'
      ? 'bg-white/[0.03] ring-white/10'
      : 'bg-slate-50 ring-slate-200';
  const stepModeSelectedClasses =
    colorMode === 'dark'
      ? 'bg-white/10 text-slate-100 ring-white/10'
      : 'bg-white text-slate-900 ring-slate-200 shadow-sm';
  const stepModeInactiveClasses =
    colorMode === 'dark'
      ? 'text-slate-400 hover:bg-white/[0.06] hover:text-slate-200'
      : 'text-slate-500 hover:bg-white hover:text-slate-800';
  const secondaryActionClasses =
    colorMode === 'dark'
      ? 'bg-white/[0.03] text-slate-200 ring-white/10 hover:bg-white/[0.06]'
      : 'bg-slate-50 text-slate-700 ring-slate-200 hover:bg-white';
  const headerTitle = isJsonMode
    ? generationMode === 'I2V'
      ? t("vidgenie.titleJsonImageListMode", {}, "JSON image-list video request")
      : t("vidgenie.titleJsonTextMode", {}, "JSON text video request")
    : generationMode === 'T2V'
      ? t("vidgenie.titleTextToVideo")
      : t("vidgenie.titleImageListToVideo");
  const renderSubmitButton = () => {
    if (shouldCollapseJsonEditorForProgress) {
      return null;
    }

    return (
      <>
        <div className="mt-4 flex w-full justify-end">
          <PrimaryPublicButton
            onClick={handleSubmit}
            isDisabled={isGenerationActionDisabled}
            extraClasses="!m-0 w-full sm:w-auto !min-h-9 !rounded-xl !px-5 !py-2 text-sm shadow-sm hover:shadow-md transition active:scale-[0.98]"
          >
            {isSubmitting ? t("vidgenie.submitting") : t("vidgenie.submit")}
          </PrimaryPublicButton>
        </div>
        {dockerInferenceUnavailableMessage ? (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm font-medium ${
            colorMode === 'dark'
              ? 'border-amber-300/20 bg-amber-300/10 text-amber-100'
              : 'border-amber-300 bg-amber-50 text-amber-800'
          }`}>
            {dockerInferenceUnavailableMessage}
          </div>
        ) : null}
      </>
    );
  };
  const renderGenerationControlsRow = ({ showAdvancedToggle = true, className = '' } = {}) => (
    <div className={`flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between ${className}`}>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
        <div
          className={`grid w-full grid-cols-2 items-center gap-1 rounded-xl p-1 text-sm ring-1 sm:inline-flex sm:w-auto ${stepModeShell}`}
          role="radiogroup"
          aria-label="Generation steps"
        >
          {VIDGENIE_STEP_MODE_OPTIONS.map((option) => {
            const isSelected = generationStepMode === option.value;
            return (
              <label
                key={option.value}
                title={option.description}
                className={`
                  inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-center font-medium ring-1 ring-transparent transition sm:px-3
                  ${isSelected ? stepModeSelectedClasses : stepModeInactiveClasses}
                  ${isFormDisabled ? 'cursor-not-allowed opacity-60' : ''}
                `}
              >
                <input
                  type="radio"
                  name="generationStepMode"
                  value={option.value}
                  checked={isSelected}
                  disabled={isFormDisabled}
                  onChange={() => setGenerationStepMode(option.value)}
                  className="sr-only"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>

        {showAdvancedToggle && (
          <button
            type="button"
            onClick={() => setIsAdvancedOpen((open) => !open)}
            disabled={isFormDisabled}
            aria-expanded={isAdvancedOpen}
            className={`
              inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium ring-1 transition sm:w-auto
              ${secondaryActionClasses}
              ${isFormDisabled ? 'cursor-not-allowed opacity-60' : ''}
            `}
          >
            <span>Advanced</span>
            {isAdvancedOpen ? (
              <FaChevronDown className="h-3 w-3" aria-hidden="true" />
            ) : (
              <FaChevronRight className="h-3 w-3" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  );
  if (!sessionDetails) {
    if (sessionLoadFailed) {
      return (
        <div className={`mx-auto mt-6 w-full max-w-lg rounded-2xl border p-6 text-center ${
          colorMode === 'dark'
            ? 'border-white/10 bg-[#0f1629] text-slate-100'
            : 'border-slate-200 bg-white text-slate-900'
        }`}>
          <h1 className="text-xl font-semibold">Unable to open this VidGenie project</h1>
          <p className={`mt-2 text-sm ${mutedText}`}>
            {isGuestPreview
              ? 'This sample is no longer available. Log in to create in your own workspace.'
              : sessionLoadError || 'The project could not be loaded. Please try again.'}
          </p>
          <button
            type="button"
            onClick={isGuestPreview ? showLoginDialog : () => void getSessionDetails()}
            className="mt-5 inline-flex min-h-10 items-center justify-center rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            {isGuestPreview ? 'Log in to create' : 'Try again'}
          </button>
        </div>
      );
    }
    return <VidgenieSkeletonLoader />;
  }

  // ─────────────────────────────────────────────────────────
  //  JSX
  // ─────────────────────────────────────────────────────────
  return (
    <div className="vidgenie-editor-shell relative mx-auto mt-2 w-full max-w-6xl overflow-x-hidden px-2 sm:mt-5 sm:px-6">
      {isGuestPreview && (
        <div
          className={`mt-2 flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:mt-6 sm:flex-row sm:items-center sm:justify-between ${
            colorMode === 'dark'
              ? 'border-cyan-300/20 bg-cyan-300/10 text-cyan-50'
              : 'border-blue-200 bg-blue-50 text-blue-950'
          }`}
          role="status"
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold">Sample VidGenie project</div>
            <p className={`mt-0.5 text-xs ${colorMode === 'dark' ? 'text-cyan-100/75' : 'text-blue-800'}`}>
              You can preview this project. Log in to create videos in your own workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={showLoginDialog}
            className={`inline-flex min-h-10 w-full shrink-0 items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition sm:w-auto ${
              colorMode === 'dark'
                ? 'bg-cyan-200 text-slate-950 hover:bg-cyan-100'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            Log in to create
          </button>
        </div>
      )}
      {/* ───────── HEADER ───────── */}
      <div
        className={`
          ${surfaceCard}
          vidgenie-editor-card relative mt-2 flex flex-col rounded-2xl p-3 transition-shadow duration-300 hover:shadow-xl sm:mt-6 sm:p-8
        `}
      >
        {/* 1️⃣ Heading */}
        <div className="flex flex-col gap-3 text-left sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
          <div className="flex min-w-0 flex-1 flex-col items-stretch justify-center gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-start">
            <div className="min-w-0 break-words text-lg font-semibold leading-tight tracking-tight sm:text-2xl">
              {headerTitle}
            </div>
            <div className={`inline-flex w-full items-center justify-center gap-1 rounded-full p-1 sm:w-auto ${toggleShell}`}>
              <button
                type="button"
                disabled={isModeToggleDisabled}
                onClick={() => handleGenerationModeChange('T2V')}
                aria-pressed={generationMode === 'T2V'}
                aria-label={t("vidgenie.titleTextToVideo")}
                data-tooltip-id="vidgenie-t2v-mode-tooltip"
                data-tooltip-content={textToVideoTooltip}
                className={`flex-1 rounded-full px-4 py-1.5 text-xs font-semibold transition sm:flex-none ${generationMode === 'T2V' ? toggleActive : toggleInactive}`}
              >
                T2V
              </button>
              <button
                type="button"
                disabled={isModeToggleDisabled}
                onClick={() => handleGenerationModeChange('I2V')}
                aria-pressed={generationMode === 'I2V'}
                aria-label={t("vidgenie.titleImageListToVideo")}
                data-tooltip-id="vidgenie-i2v-mode-tooltip"
                data-tooltip-content={imageToVideoTooltip}
                className={`flex-1 rounded-full px-4 py-1.5 text-xs font-semibold transition sm:flex-none ${generationMode === 'I2V' ? toggleActive : toggleInactive}`}
              >
                I2V
              </button>
            </div>
            <Tooltip
              id="vidgenie-t2v-mode-tooltip"
              place="bottom"
              offset={10}
              delayShow={120}
              opacity={1}
              className={modeTooltipClassName}
              classNameArrow="vidgenie-mode-tooltip-arrow"
            />
            <Tooltip
              id="vidgenie-i2v-mode-tooltip"
              place="bottom"
              offset={10}
              delayShow={120}
              opacity={1}
              className={modeTooltipClassName}
              classNameArrow="vidgenie-mode-tooltip-arrow"
            />
          </div>

          <div className="vidgenie-header-actions flex w-full flex-wrap items-center justify-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
            <div
              className={`
                vidgenie-pricing-pill px-3 py-1.5 rounded-full text-center transition
                ${colorMode === 'dark'
                  ? 'bg-[#111a2f] text-slate-100 ring-1 ring-[#1f2a3d]'
                  : 'bg-white text-slate-900 ring-1 ring-slate-200'
                }
              `}
            >
              {pricingInfoDisplay}
            </div>

            {sessionDetails?.isExpressGeneration && (
              <>
                <span
                  className={`
                    inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold
                    ${colorMode === 'dark'
                      ? 'bg-cyan-400/12 text-cyan-200 ring-1 ring-cyan-300/25'
                      : 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200'
                    }
                  `}
                >
                  Express
                </span>
                {sessionInferenceModelLabel && (
                  <span
                    className={`
                      inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold
                      ${colorMode === 'dark'
                        ? 'bg-violet-400/12 text-violet-200 ring-1 ring-violet-300/25'
                        : 'bg-violet-50 text-violet-700 ring-1 ring-violet-200'
                      }
                    `}
                  >
                    Inference: {sessionInferenceModelLabel}
                  </span>
                )}
                <button
                  type="button"
                  onClick={openAdvancedVideoEditDialog}
                  disabled={isGuestPreview}
                  title="Advanced video edits"
                  aria-label="Advanced video edits"
                  className={`
                    inline-flex h-9 w-9 items-center justify-center rounded-full transition
                    ${colorMode === 'dark'
                      ? 'border border-white/10 text-slate-100 hover:border-white/20 hover:bg-white/5'
                      : 'border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }
                    ${isGuestPreview ? 'cursor-not-allowed opacity-50' : ''}
                  `}
                >
                  <FaCog />
                </button>
              </>
            )}

            {renderState !== 'complete' && (
              <button
                type="button"
                onClick={toggleJsonMode}
                disabled={isModeToggleDisabled}
                aria-pressed={isJsonMode}
                className={`
                  inline-flex items-center gap-2 text-xs sm:text-sm px-3 py-1.5 rounded-full
                  transition-all duration-200
                  ${isJsonMode
                    ? toggleActive
                    : colorMode === 'dark'
                      ? 'border border-white/10 hover:border-white/20 hover:bg-white/5 active:scale-[0.98]'
                      : 'border border-slate-200 hover:border-slate-300 hover:bg-slate-50 active:scale-[0.98]'
                  }
                  ${isModeToggleDisabled ? 'opacity-60 cursor-not-allowed' : ''}
                `}
              >
                {jsonModeButtonLabel}
              </button>
            )}

            {(renderState === 'pending' || renderState === 'paused') && (
              <div
                className="flex items-center gap-2 text-xs sm:text-sm"
                aria-live="polite"
                role="status"
              >
                {renderState === 'paused' ? (
                  <FaPause className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <FaSpinner className="animate-spin h-4 w-4" aria-hidden="true" />
                )}
                <span className="hidden sm:inline">
                  {renderState === 'paused'
                    ? t("common.paused", {}, "Paused")
                    : t("vidgenie.renderingShort")}
                </span>
                <span className="sr-only">
                  {renderState === 'paused'
                    ? t("common.paused", {}, "Paused")
                    : t("vidgenie.renderingAria")}
                </span>
                <button
                  type="button"
                  onClick={renderState === 'paused' ? handleResumeRender : handlePauseRender}
                  disabled={isRenderPauseResumePending}
                  title={renderState === 'paused'
                    ? t("common.play", {}, "Resume render")
                    : t("common.pause", {}, "Pause render")}
                  aria-label={renderState === 'paused'
                    ? t("common.play", {}, "Resume render")
                    : t("common.pause", {}, "Pause render")}
                  className={`
                    inline-flex h-8 w-8 items-center justify-center rounded-full transition
                    ${colorMode === 'dark'
                      ? 'border border-white/10 text-slate-100 hover:border-white/20 hover:bg-white/5'
                      : 'border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }
                    ${isRenderPauseResumePending ? 'cursor-not-allowed opacity-60' : 'active:scale-[0.98]'}
                  `}
                >
                  {isRenderPauseResumePending ? (
                    <FaSpinner className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : renderState === 'paused' ? (
                    <FaPlay className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <FaPause className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            )}

          </div>
        </div>

        {renderCompletedVideoActions('mt-3 w-full sm:w-auto sm:self-end')}

        {shouldCollapseOriginalRequest && (
          <div className={`mt-4 rounded-xl p-3 ring-1 ${
            colorMode === 'dark'
              ? 'bg-[#0b1224] ring-white/10'
              : 'bg-slate-50 ring-slate-200'
          }`}>
            <button
              type="button"
              onClick={() => setIsCompletedRequestExpanded((expanded) => !expanded)}
              aria-expanded={isCompletedRequestExpanded}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Original request</span>
                <span className={`mt-0.5 block text-xs ${mutedText}`}>
                  Prompt, source images, settings
                </span>
              </span>
              {isCompletedRequestExpanded ? (
                <FaChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              ) : (
                <FaChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
            </button>
          </div>
        )}

        {!isJsonMode && shouldShowOriginalRequestInputs && (
          <>
        {/* 2️⃣ Options grid */}
        <div className="vidgenie-options-section w-full mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {/* Aspect Ratio */}
            <div className="group w-full">
              <div className={`w-full md:w-full ${controlShell} rounded-xl p-2 transition-transform duration-200 group-hover:translate-y-[-1px] relative z-10 focus-within:z-50 group-hover:z-50`}>
                <SingleSelect
                  value={selectedAspectRatioOption}
                  onChange={setSelectedAspectRatioOption}
                  options={aspectRatioOptions}
                  isDisabled={isFormDisabled}
                  className="w-full"
                />
              </div>
              <p className={`text-[11px] mt-1 ${mutedText}`}>{t("vidgenie.aspectRatio")}</p>
            </div>

            {/* Image Model */}
            <div className="group w-full">
              <div className={`w-full md:w-full ${controlShell} rounded-xl p-2 transition-transform duration-200 group-hover:translate-y-[-1px] relative z-10 focus-within:z-50 group-hover:z-50`}>
                <SingleSelect
                  value={selectedImageModel}
                  onChange={setSelectedImageModel}
                  options={stageImageModels}
                  isDisabled={isFormDisabled}
                  className="w-full"
                />
              </div>
              <p className={`text-[11px] mt-1 ${mutedText}`}>{t("vidgenie.imageModel")}</p>
            </div>

            {/* Image Style (conditional) */}
            {(() => {
              const modelCfg = IMAGE_GENERAITON_MODEL_TYPES.find(
                (m) => m.key === selectedImageModel?.value
              );
              if (modelCfg?.imageStyles) {
                return (
                  <div className="group w-full">
                    <div className={`w-full md:w-full ${controlShell} rounded-xl p-2 transition-transform duration-200 group-hover:translate-y-[-1px] relative z-10 focus-within:z-50 group-hover:z-50`}>
                      <SingleSelect
                        value={selectedImageStyle}
                        onChange={setSelectedImageStyle}
                        options={modelCfg.imageStyles.map((s) => ({ label: s, value: s }))}
                        isDisabled={isFormDisabled}
                        className="w-full"
                      />
                    </div>
                    <p className={`text-[11px] mt-1 ${mutedText}`}>{t("vidgenie.imageStyle")}</p>
                  </div>
                );
              }
              return null;
            })()}

            {generationMode === 'T2V' && (
              <>
                {/* Video Model */}
                <div className="group w-full">
                  <div className={`w-full md:w-full ${controlShell} rounded-xl p-2 transition-transform duration-200 group-hover:translate-y-[-1px] relative z-10 focus-within:z-50 group-hover:z-50`}>
                    <SingleSelect
                      value={selectedVideoModel}
                      onChange={setSelectedVideoModel}
                      options={expressVideoModels}
                      isDisabled={isFormDisabled}
                      className="w-full"
                    />
                  </div>
                  <p className={`text-[11px] mt-1 ${mutedText}`}>{t("vidgenie.videoModel")}</p>
                </div>

                {/* Pixverse Style */}
                {selectedVideoModel?.value?.startsWith('PIXVERSE') && selectedVideoModelSubType && (
                  <div className="group w-full">
                    <div className={`w-full md:w-full ${controlShell} rounded-xl p-2 transition-transform duration-200 group-hover:translate-y-[-1px] relative z-10 focus-within:z-50 group-hover:z-50`}>
                      <SingleSelect
                        value={selectedVideoModelSubType}
                        onChange={setSelectedVideoModelSubType}
                        options={PIXVERRSE_VIDEO_STYLES.map((s) => ({ label: s, value: s }))}
                        isDisabled={isFormDisabled}
                        className="w-full"
                      />
                  </div>
                    <p className={`text-[11px] mt-1 ${mutedText}`}>{t("vidgenie.pixverseStyle")}</p>
                  </div>
                )}

                {/* Generic Sub-type */}
                {selectedVideoModel?.modelSubTypes?.length && selectedVideoModelSubType && (
                  <div className="group w-full">
                    <div className={`w-full md:w-full ${controlShell} rounded-xl p-2 transition-transform duration-200 group-hover:translate-y-[-1px] relative z-10 focus-within:z-50 group-hover:z-50`}>
                      <SingleSelect
                        value={selectedVideoModelSubType}
                        onChange={setSelectedVideoModelSubType}
                        options={selectedVideoModel.modelSubTypes.map((s) => ({ label: s, value: s }))}
                        isDisabled={isFormDisabled}
                        className="w-full"
                      />
                  </div>
                    <p className={`text-[11px] mt-1 ${mutedText}`}>{t("vidgenie.videoSubType")}</p>
                  </div>
                )}
              </>
            )}

            {generationMode === 'I2V' && (
              <div className="group w-full">
                <div className={`w-full md:w-full ${controlShell} rounded-xl p-2 transition-transform duration-200 group-hover:translate-y-[-1px] relative z-10 focus-within:z-50 group-hover:z-50`}>
                  <SingleSelect
                    value={selectedVideoModel}
                    onChange={setSelectedVideoModel}
                    options={imageListVideoModels}
                    isDisabled={isFormDisabled}
                    truncateLabels
                    className="w-full"
                  />
                </div>
                <p className={`text-[11px] mt-1 ${mutedText}`}>{t("vidgenie.videoModel")}</p>
              </div>
            )}

            {/* Duration */}
            {generationMode === 'T2V' && (
              <div className="group w-full">
                <div className={`w-full md:w-full ${controlShell} rounded-xl p-2 transition-transform duration-200 group-hover:translate-y-[-1px] relative z-10 focus-within:z-50 group-hover:z-50`}>
                  <SingleSelect
                    value={selectedDurationOption}
                    onChange={setSelectedDurationOption}
                    options={durationOptions}
                    isDisabled={isFormDisabled}
                    className="w-full"
                  />
                </div>
                <p className={`text-[11px] mt-1 ${mutedText}`}>{t("vidgenie.maxDuration")}</p>
              </div>
            )}

            {/* Audio language */}
            <div className="group w-full">
              <div className={`w-full md:w-full ${controlShell} rounded-xl p-2 transition-transform duration-200 group-hover:translate-y-[-1px] relative z-10 focus-within:z-50 group-hover:z-50`}>
                <SingleSelect
                  value={selectedLanguageOption}
                  onChange={setSelectedLanguageOption}
                  options={languageOptions}
                  isDisabled={isFormDisabled}
                  className="w-full"
                />
              </div>
              <p className={`text-[11px] mt-1 ${mutedText}`}>
                {t("vidgenie.audioLanguage", {}, "Audio language")}
              </p>
            </div>

            <div className="group w-full">
              <label
                className={`flex items-start gap-3 ${controlShell} rounded-xl p-3 transition-transform duration-200 group-hover:translate-y-[-1px] cursor-pointer`}
              >
                <input
                  type="checkbox"
                  checked={enableSubtitles}
                  onChange={(e) => setEnableSubtitles(e.target.checked)}
                  disabled={isFormDisabled}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    {t("vidgenie.enableSubtitles")}
                  </div>
                  <p className={`mt-1 text-[11px] ${mutedText}`}>
                    {t("vidgenie.enableSubtitlesHelp")}
                  </p>
                </div>
              </label>
            </div>

          </div>
        </div>

        <div className={`vidgenie-advanced-section mt-4 border-t ${advancedSectionBorder} pt-3`}>
          {renderGenerationControlsRow({ showAdvancedToggle: true })}

          {isAdvancedOpen && (
            <div className="mt-3 space-y-5">
              {enableSubtitles && (
                <div className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 ${advancedRowBg}`}>
                  <label
                    htmlFor="vidgenie-subtitle-language"
                    className={`min-w-0 text-xs font-medium ${mutedText}`}
                  >
                    {t("vidgenie.subtitleLanguage", {}, "Subtitle language")}
                  </label>
                  <select
                    id="vidgenie-subtitle-language"
                    value={
                      typeof selectedSubtitleLanguageOption === 'string'
                        ? selectedSubtitleLanguageOption
                        : selectedSubtitleLanguageOption?.value || ''
                    }
                    onChange={(event) => {
                      const nextOption = subtitleLanguageOptions.find(
                        (option) => option.value === event.target.value
                      );
                      setSelectedSubtitleLanguageOption(nextOption || subtitleLanguageOptions[0]);
                    }}
                    disabled={isFormDisabled}
                    title={t(
                      "vidgenie.subtitleLanguageHelp",
                      {},
                      "Choose a different language to translate subtitle text."
                    )}
                    className={advancedCompactSelectClasses}
                  >
                    {subtitleLanguageOptions.map((option) => (
                      <option key={option.value || 'same-as-audio'} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className={advancedLabelClasses}>Inference model</label>
                <select
                  value={selectedInferenceModel?.value || inferenceModelOptions[0]?.value || ''}
                  onChange={(event) =>
                    setSelectedInferenceModel(getInferenceModelOption(event.target.value, DEFAULT_INFERENCE_MODEL, inferenceModelOptions))
                  }
                  disabled={isFormDisabled || isDockerInferenceUnavailable}
                  className={advancedInputClasses}
                >
                  {inferenceModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {isDockerInferenceModelFilteringEnabled ? (
                  <p className={`mt-1 text-[11px] ${mutedText}`}>
                    {isInferenceModelAvailabilityLoading
                      ? 'Loading configured model options...'
                      : hasConfiguredInferenceModels
                        ? 'Only models supported by your configured Docker providers are shown.'
                        : 'No inference model is configured for this Docker installation.'}
                  </p>
                ) : null}
              </div>

              {generationMode === 'T2V' && (
                <div>
                  <label className={advancedLabelClasses}>Tone</label>
                  <select
                    value={advancedOptions.tone}
                    onChange={(event) => updateAdvancedOption('tone', event.target.value)}
                    disabled={isFormDisabled}
                    className={advancedInputClasses}
                  >
                    {VIDGENIE_TONE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {generationMode === 'I2V' && (
                <div className={`border-t ${advancedSectionBorder} pt-4 space-y-3`}>
                  <div className="grid grid-cols-1 gap-3">
                    <label className={`flex items-start gap-3 rounded-xl px-3 py-3 ${advancedRowBg}`}>
                      <input
                        type="checkbox"
                        checked={advancedOptions.add_narrator_avatar}
                        onChange={(event) =>
                          updateAdvancedOption('add_narrator_avatar', event.target.checked)
                        }
                        disabled={isFormDisabled}
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-sm font-medium">Add narrator avatar</span>
                    </label>
                  </div>

                </div>
              )}

              <div className={`border-t ${advancedSectionBorder} pt-4 space-y-3`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Outro image
                </div>
                <label className={`flex items-start gap-3 rounded-xl px-3 py-3 ${advancedRowBg}`}>
                  <input
                    type="checkbox"
                    checked={advancedOptions.generate_outro_image}
                    onChange={(event) =>
                      updateAdvancedOption('generate_outro_image', event.target.checked)
                    }
                    disabled={isFormDisabled}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-sm font-medium">Generate CTA outro</span>
                </label>
                {advancedOptions.generate_outro_image && (
                  <div className="space-y-3">
                    <div>
                      <label className={advancedLabelClasses}>Outro CTA</label>
                      <select
                        value={advancedOptions.outro_cta_type || OUTRO_CTA_TYPE_QR}
                        onChange={(event) => {
                          updateAdvancedOption('outro_cta_type', event.target.value);
                          setOutroCtaImageUploadError('');
                        }}
                        disabled={isFormDisabled}
                        className={advancedInputClasses}
                      >
                        {OUTRO_CTA_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {advancedOptions.outro_cta_type === OUTRO_CTA_TYPE_IMAGE ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className={advancedLabelClasses}>Top text</label>
                          <input
                            type="text"
                            value={advancedOptions.cta_text_top}
                            onChange={(event) =>
                              updateAdvancedOption('cta_text_top', event.target.value)
                            }
                            disabled={isFormDisabled}
                            className={advancedInputClasses}
                            placeholder="Shop the drop"
                          />
                        </div>
                        <div>
                          <label className={advancedLabelClasses}>Bottom text</label>
                          <input
                            type="text"
                            value={advancedOptions.cta_text_bottom}
                            onChange={(event) =>
                              updateAdvancedOption('cta_text_bottom', event.target.value)
                            }
                            disabled={isFormDisabled}
                            className={advancedInputClasses}
                            placeholder="Limited availability"
                          />
                        </div>
                        <div className="md:col-span-2">
                          <label className={advancedLabelClasses}>CTA / logo URL</label>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              type="url"
                              value={advancedOptions.outro_cta_image_url}
                              onChange={(event) => {
                                updateAdvancedOption('outro_cta_image_url', event.target.value);
                                setOutroCtaImageUploadError('');
                              }}
                              disabled={isFormDisabled || uploadingOutroCtaImage}
                              className={`${advancedInputClasses} flex-1`}
                              placeholder="https://cdn.example.com/logo.png"
                            />
                            <label
                              className={`
                                inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold
                                ${colorMode === 'dark'
                                  ? 'bg-slate-800 text-slate-100 ring-1 ring-slate-700 hover:bg-slate-700'
                                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50'}
                                ${isFormDisabled || uploadingOutroCtaImage ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
                              `}
                            >
                              <input
                                type="file"
                                accept="image/*,image/heic,image/heif,.heic,.heif"
                                onChange={handleOutroCtaImageUploadInput}
                                disabled={isFormDisabled || uploadingOutroCtaImage}
                                className="sr-only"
                              />
                              {uploadingOutroCtaImage ? (
                                <FaSpinner className="animate-spin text-xs" />
                              ) : (
                                <FaUpload className="text-xs" />
                              )}
                              {uploadingOutroCtaImage ? 'Uploading...' : 'Upload image'}
                            </label>
                          </div>
                          {outroCtaImageUploadError ? (
                            <p className="mt-1 text-[11px] text-rose-500">
                              {outroCtaImageUploadError}
                            </p>
                          ) : null}
                          {hasTextValue(advancedOptions.outro_cta_image_url) ? (
                            <p className={`mt-1 text-[11px] ${mutedText}`}>
                              This image will replace the QR code in the outro center area.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className={advancedLabelClasses}>CTA URL</label>
                          <input
                            type="url"
                            value={advancedOptions.cta_url}
                            onChange={(event) => updateAdvancedOption('cta_url', event.target.value)}
                            disabled={isFormDisabled}
                            className={advancedInputClasses}
                            placeholder="https://example.com/book"
                          />
                        </div>
                        <div>
                          <label className={advancedLabelClasses}>CTA top text</label>
                          <input
                            type="text"
                            value={advancedOptions.cta_text_top}
                            onChange={(event) =>
                              updateAdvancedOption('cta_text_top', event.target.value)
                            }
                            disabled={isFormDisabled}
                            className={advancedInputClasses}
                          />
                        </div>
                        <div>
                          <label className={advancedLabelClasses}>CTA bottom text</label>
                          <input
                            type="text"
                            value={advancedOptions.cta_text_bottom}
                            onChange={(event) =>
                              updateAdvancedOption('cta_text_bottom', event.target.value)
                            }
                            disabled={isFormDisabled}
                            className={advancedInputClasses}
                          />
                        </div>
                        <div>
                          <label className={advancedLabelClasses}>CTA logo URL</label>
                          <input
                            type="url"
                            value={advancedOptions.cta_logo}
                            onChange={(event) => updateAdvancedOption('cta_logo', event.target.value)}
                            disabled={isFormDisabled}
                            className={advancedInputClasses}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className={`border-t ${advancedSectionBorder} pt-4 space-y-3`}>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Footer
                </div>
                <div>
                  <label className={advancedLabelClasses}>Footer metadata JSON</label>
                  <TextareaAutosize
                    minRows={3}
                    maxRows={8}
                    value={advancedOptions.footer_metadata}
                    onChange={(event) =>
                      updateAdvancedOption('footer_metadata', event.target.value)
                    }
                    disabled={isFormDisabled}
                    className={advancedInputClasses}
                    placeholder='[{"url":"https://example.com/book","title":"Book now"}]'
                  />
                </div>
              </div>

              {availableCustomAdapterEndpoints.length > 0 && (
                <div className={`border-t ${advancedSectionBorder} pt-4 space-y-3`}>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Custom Endpoint
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {availableCustomAdapterEndpoints.map((endpoint) => (
                      <label
                        key={endpoint.id}
                        className={`flex items-start gap-3 rounded-xl px-3 py-3 ${advancedRowBg}`}
                      >
                        <input
                          type="radio"
                          name="vidgenie-custom-endpoint"
                          checked={selectedCustomAdapterEndpointId === endpoint.id}
                          onChange={() => toggleSelectedCustomAdapterEndpoint(endpoint.id)}
                          disabled={isFormDisabled}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{endpoint.name}</span>
                          <span className={`block text-[11px] ${mutedText}`}>
                            {endpoint.operationLabel}
                          </span>
                          <span className={`block truncate text-[11px] ${mutedText}`}>
                            {endpoint.endpoint}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
          </>
        )}
      </div>
      {/* ───── /HEADER ───── */}

      {/* Error */}
      {errorMessage?.error && !showResultDisplay && (
        <div className="text-red-500 mt-3 font-semibold bg-red-500/10 border border-red-500/20 rounded-lg p-3">
          {errorMessage.error}
        </div>
      )}

      {/* Progress indicator / result */}
      {showResultDisplay && (
        <div className="mt-5 transition-all duration-500 ease-out">
          {renderState === 'complete' && postProcessingAction === 'reroll_layers' ? (
            <>
              <ProgressIndicator
                isGenerationPending={false}
                isGenerationPaused={false}
                isGenerationWaitingForApproval={false}
                isProcessingNextStep={false}
                expressGenerationStatus={expressGenerationStatus}
                generationStatusDetails={generationStatusDetails}
                videoLink={null}
                errorMessage={errorMessage}
                rawSessionDetails={sessionDetails}
                canProcessNextStep={false}
                canReviewStepImages={false}
                purchaseCreditsForUser={purchaseCreditsForUser}
                viewInStudio={viewInStudio}
                enableScrollableLayerTimeline
                onProcessNextStep={handleProcessNextStep}
                onSelectStepImage={handleSelectStepImage}
                onRegenerateStepImage={handleRegenerateStepImage}
              />
              {renderCompletedPostProcessingControls('mt-3')}
            </>
          ) : (
            <>
              <ProgressIndicator
                isGenerationPending={isGenerationPending}
                isGenerationPaused={isPaused}
                isGenerationWaitingForApproval={isGenerationWaitingForApproval}
                isProcessingNextStep={isProcessingNextStep}
                expressGenerationStatus={expressGenerationStatus}
                generationStatusDetails={generationStatusDetails}
                videoLink={videoLink}
                pendingPreviewVideoLink={postProcessingPreviewVideoLink}
                errorMessage={errorMessage}
                rawSessionDetails={sessionDetails}
                canProcessNextStep={activeRequestStepModeRef.current === GENERATION_STEP_MODE_TWO_STEP}
                canReviewStepImages={
                  activeRequestStepModeRef.current === GENERATION_STEP_MODE_TWO_STEP &&
                  (
                    generationMode === 'T2V' ||
                    generationStatusDetails?.session?.generationType === 'TEXT_TO_VIDEO'
                  )
                }
                purchaseCreditsForUser={purchaseCreditsForUser}
                viewInStudio={viewInStudio}
                enableScrollableLayerTimeline
                onProcessNextStep={handleProcessNextStep}
                onSelectStepImage={handleSelectStepImage}
                onRegenerateStepImage={handleRegenerateStepImage}
              />
              {renderCompletedPostProcessingControls('mt-3')}
            </>
          )}
        </div>
      )}

      {/* ───────── Submission form ───────── */}
      {shouldShowOriginalRequestInputs && (
      <form onSubmit={handleSubmit}>
        {isJsonMode && shouldCollapseJsonEditorForProgress ? (
          <div className={`mt-4 rounded-2xl p-4 ring-1 transition ${
            colorMode === 'dark'
              ? 'bg-[#0b1224] text-slate-100 ring-white/10'
              : 'bg-white text-slate-900 ring-slate-200'
          }`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold">JSON request hidden during render</div>
                <p className={`mt-1 text-xs ${mutedText}`}>
                  Progress stays visible. Expand this panel only when you need to inspect or copy the submitted request.
                </p>
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <button
                  type="button"
                  onClick={() => setIsJsonRequestExpanded((expanded) => !expanded)}
                  className={`w-full rounded-full px-3 py-1.5 text-xs font-semibold transition sm:w-auto ${
                    colorMode === 'dark'
                      ? 'border border-white/10 hover:bg-white/5'
                      : 'border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {isJsonRequestExpanded ? 'Hide JSON' : 'View JSON'}
                </button>
                <button
                  type="button"
                  onClick={copyJsonRequestToClipboard}
                  className={`w-full rounded-full px-3 py-1.5 text-xs font-semibold transition sm:w-auto ${
                    colorMode === 'dark'
                      ? 'border border-white/10 hover:bg-white/5'
                      : 'border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {jsonCopyStatus || 'Copy JSON'}
                </button>
              </div>
            </div>

            {isJsonRequestExpanded && (
              <div className="mt-4 max-w-full overflow-hidden rounded-xl ring-1 ring-white/10">
                <JsonAceEditor
                  mode="json"
                  theme="monokai"
                  name="vidgenieJsonSubmittedInput"
                  width="100%"
                  height="360px"
                  fontSize={13}
                  showPrintMargin={false}
                  showGutter
                  highlightActiveLine={false}
                  readOnly
                  value={jsonRequestDisplayText}
                  editorProps={{ $blockScrolling: true }}
                  setOptions={{
                    enableBasicAutocompletion: false,
                    enableLiveAutocompletion: false,
                    enableSnippets: false,
                    showLineNumbers: true,
                    tabSize: 2,
                    useWorker: false,
                  }}
                  className="vidgenie-json-editor"
                />
              </div>
            )}
          </div>
        ) : isJsonMode ? (
          <div className="mt-4">
            {renderGenerationControlsRow({ showAdvancedToggle: false, className: 'mb-3' })}
            <div className={`max-w-full overflow-hidden rounded-2xl ring-1 transition ${
              jsonEditorErrorMessage
                ? 'ring-red-500/50'
                : colorMode === 'dark'
                  ? 'ring-white/10'
                  : 'ring-slate-200'
            }`}>
              <JsonAceEditor
                mode="json"
                theme="monokai"
                name="vidgenieJsonInput"
                width="100%"
                height="520px"
                fontSize={14}
                showPrintMargin={false}
                showGutter
                highlightActiveLine
                readOnly={isFormDisabled}
                annotations={jsonEditorAnnotations}
                placeholder={jsonModeDefaultInput}
                editorProps={{ $blockScrolling: true }}
                setOptions={{
                  enableBasicAutocompletion: true,
                  enableLiveAutocompletion: true,
                  enableSnippets: false,
                  showLineNumbers: true,
                  tabSize: 2,
                  useWorker: false,
                }}
                className="vidgenie-json-editor"
                value={jsonInputText}
                onChange={(value) => {
                  setJsonInputText(value);
                  setIsJsonInputDirty(true);
                  setJsonCopyStatus('');
                  if (jsonValidationMessage) {
                    setJsonValidationMessage('');
                  }
                }}
              />
            </div>
            <input type="hidden" name="jsonInputText" value={jsonInputText} />
            {jsonEditorErrorMessage ? (
              <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm font-medium text-red-500">
                {Number.isFinite(jsonModeValidation.row) && Number.isFinite(jsonModeValidation.column)
                  ? `Line ${jsonModeValidation.row + 1}, column ${jsonModeValidation.column + 1}: `
                  : ''}
                {jsonEditorErrorMessage}
              </div>
            ) : (
              <div className={`mt-2 rounded-lg border p-3 text-sm font-medium ${
                colorMode === 'dark'
                  ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-200'
                  : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700'
              }`}>
                Valid JSON for {generationMode === 'I2V' ? 'image-list to video' : 'text to video'}.
              </div>
            )}
            {jsonValidationMessage && jsonValidationMessage !== jsonEditorErrorMessage && (
              <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm font-medium text-red-500">
                {jsonValidationMessage}
              </div>
            )}
          </div>
        ) : generationMode === 'T2V' ? (
          <>
            <div className="relative mt-4">
              <TextareaAutosize
                minRows={8}
                maxRows={20}
                disabled={isFormDisabled}
                readOnly={isVoiceBusy}
                className={`
                  vidgenie-prompt-textarea
                  w-full pl-4 pt-4 pr-16 p-2 rounded-2xl resize-none placeholder:opacity-60
                  focus:outline-none focus:ring-2 focus:ring-indigo-500/60 ring-1 transition
                  ${colorMode === 'dark'
                    ? 'bg-gray-950/90 text-white ring-white/10 focus:ring-indigo-500/50'
                    : 'bg-white text-slate-900 ring-slate-200 focus:ring-indigo-500/50'
                  }
                  ${isVoiceBusy ? 'opacity-95' : ''}
                `}
                placeholder={t("vidgenie.promptPlaceholder")}
                name="promptText"
                value={promptText}
                maxLength={VIDGENIE_PROMPT_MAX_LENGTH}
                onChange={handlePromptTextChange}
              />
              <button
                type="button"
                onClick={handleToggleVoiceRecording}
                disabled={isFormDisabled || (!isVoiceSupported && !isBrowserSpeechSupported)}
                aria-pressed={isVoiceBusy}
                className={`
                  absolute bottom-3 right-3 h-11 w-11 rounded-full flex items-center justify-center
                  transition-all duration-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2
                  ${colorMode === 'dark'
                    ? 'bg-indigo-500/80 hover:bg-indigo-500 text-white focus:ring-indigo-400/70 focus:ring-offset-slate-900'
                    : 'bg-indigo-500 hover:bg-indigo-600 text-white focus:ring-indigo-500/40 focus:ring-offset-white'}
                  ${isVoiceBusy ? 'animate-pulse scale-105' : ''}
                  ${isVoiceInitializing && !isBrowserRecognitionActive ? 'opacity-70 cursor-wait' : 'cursor-pointer'}
                  ${(!isVoiceSupported && !isBrowserSpeechSupported) ? 'opacity-40 cursor-not-allowed hover:bg-indigo-500' : ''}
                `}
                title={
                  (!isVoiceSupported && !isBrowserSpeechSupported)
                    ? t("vidgenie.voiceNotSupported")
                    : isVoiceBusy
                      ? t("vidgenie.voiceStop")
                      : t("vidgenie.voiceStart")
                }
              >
                {isVoiceInitializing && !isBrowserRecognitionActive ? (
                  <FaSpinner className="animate-spin text-lg" />
                ) : isVoiceBusy ? (
                  <FaStopCircle className="text-lg" />
                ) : (
                  <FaMicrophone className="text-lg" />
                )}
                <span className="sr-only">
                  {isVoiceBusy ? t("vidgenie.voiceButtonSrStop") : t("vidgenie.voiceButtonSrStart")}
                </span>
              </button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="min-w-0">
                {voiceError ? (
                  <span className="text-red-500">{voiceError}</span>
                ) : voiceStatusMessage ? (
                  <span className={colorMode === 'dark' ? 'text-white/70' : 'text-slate-600'}>
                    {voiceStatusMessage}
                  </span>
                ) : (
                  <span className={colorMode === 'dark' ? 'text-white/50' : 'text-slate-400'}>
                    {isBrowserSpeechSupported || isVoiceSupported
                      ? t("vidgenie.voiceUseMic")
                      : t("vidgenie.voiceUnavailable")}
                  </span>
                )}
              </div>
              <span className={`shrink-0 tabular-nums ${promptCounterClass}`}>
                {promptCounterLabel}
              </span>
            </div>
          </>
        ) : (
          <div className="mt-4 space-y-4">
            <div className={`rounded-lg ring-1 p-3 transition ${imagePickerShell}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Image scenes</div>
                  <div className={`mt-0.5 text-[11px] ${mutedText}`}>
                    Paste public URLs or upload local images to create URLs.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={addImageListItem}
                  disabled={isFormDisabled || uploadingImageIndex !== null}
                  className={`
                    inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition
                    ${colorMode === 'dark'
                      ? 'bg-white/10 text-white hover:bg-white/15 disabled:opacity-50'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50'
                    }
                  `}
                >
                  <FaPlus className="text-xs" />
                  Add image
                </button>
              </div>

              {imageUploadError && (
                <div className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm font-medium text-red-500">
                  {imageUploadError}
                </div>
              )}

              <div className="space-y-3">
                {imageListItems.map((item, index) => {
                  const imageUrl = item.image_url.trim();
                  const isUploadingThisImage = uploadingImageIndex === index;
                  return (
                    <div
                      key={`image-list-item-${index}`}
                      className={`
                        rounded-lg p-3 ring-1
                        ${colorMode === 'dark'
                          ? 'bg-white/[0.03] ring-white/10'
                          : 'bg-slate-50 ring-slate-200'
                        }
                      `}
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-medium">Image {index + 1}</div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => moveImageListItem(index, index - 1)}
                            disabled={isFormDisabled || uploadingImageIndex !== null || index === 0}
                            title="Move image up"
                            aria-label="Move image up"
                            className={`
                              inline-flex h-8 w-8 items-center justify-center rounded-lg transition
                              ${colorMode === 'dark'
                                ? 'text-slate-200 hover:bg-white/10 disabled:opacity-40'
                                : 'text-slate-600 hover:bg-slate-200 disabled:opacity-40'
                              }
                            `}
                          >
                            <FaArrowUp className="text-xs" />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveImageListItem(index, index + 1)}
                            disabled={isFormDisabled || uploadingImageIndex !== null || index === imageListItems.length - 1}
                            title="Move image down"
                            aria-label="Move image down"
                            className={`
                              inline-flex h-8 w-8 items-center justify-center rounded-lg transition
                              ${colorMode === 'dark'
                                ? 'text-slate-200 hover:bg-white/10 disabled:opacity-40'
                                : 'text-slate-600 hover:bg-slate-200 disabled:opacity-40'
                              }
                            `}
                          >
                            <FaArrowDown className="text-xs" />
                          </button>
                          <button
                            type="button"
                            onClick={() => removeImageListItem(index)}
                            disabled={isFormDisabled || uploadingImageIndex !== null}
                            title="Remove image"
                            aria-label="Remove image"
                            className={`
                              inline-flex h-8 w-8 items-center justify-center rounded-lg transition
                              ${colorMode === 'dark'
                                ? 'text-rose-200 hover:bg-rose-500/15 disabled:opacity-40'
                                : 'text-rose-600 hover:bg-rose-50 disabled:opacity-40'
                              }
                            `}
                          >
                            <FaTrash className="text-xs" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[96px_minmax(0,1fr)]">
                        <div
                          className={`
                            mx-auto flex aspect-square w-full max-w-[96px] items-center justify-center overflow-hidden rounded-lg ring-1 md:mx-0
                            ${colorMode === 'dark'
                              ? 'bg-black/20 ring-white/10'
                              : 'bg-white ring-slate-200'
                            }
                          `}
                        >
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={`Image ${index + 1}`}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <FaImage className={`text-xl ${mutedText}`} />
                          )}
                        </div>

                        <div className="min-w-0 space-y-2">
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                            <div>
                              <label className={`mb-1 block text-[11px] font-medium ${mutedText}`}>
                                Image URL
                              </label>
                              <input
                                type="url"
                                value={item.image_url}
                                onChange={(event) => {
                                  updateImageListItem(index, { image_url: event.target.value });
                                  if (imageUploadError) {
                                    setImageUploadError('');
                                  }
                                }}
                                disabled={isFormDisabled}
                                className={advancedInputClasses}
                                placeholder="https://..."
                              />
                            </div>
                            <label
                              className={`
                                mt-auto inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-xs font-semibold transition
                                ${isFormDisabled || uploadingImageIndex !== null ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}
                                ${colorMode === 'dark'
                                  ? 'border-indigo-300/30 bg-indigo-400/10 text-indigo-100 hover:bg-indigo-400/15'
                                  : 'border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100'
                                }
                              `}
                              onDragOver={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onDrop={(event) => {
                                if (isFormDisabled || uploadingImageIndex !== null) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  return;
                                }
                                handleImageListUploadDrop(index, event);
                              }}
                            >
                              <input
                                type="file"
                                accept="image/*,image/heic,image/heif,.heic,.heif"
                                onChange={(event) => handleImageListUploadInput(index, event)}
                                disabled={isFormDisabled || uploadingImageIndex !== null}
                                className="sr-only"
                              />
                              {isUploadingThisImage ? (
                                <FaSpinner className="animate-spin text-xs" />
                              ) : (
                                <FaUpload className="text-xs" />
                              )}
                              {isUploadingThisImage ? 'Uploading...' : 'Upload to URL'}
                            </label>
                          </div>
                          <div>
                            <label className={`mb-1 block text-[11px] font-medium ${mutedText}`}>
                              Image description
                            </label>
                            <TextareaAutosize
                              minRows={2}
                              maxRows={5}
                              value={item.image_text}
                              onChange={(event) => updateImageListItem(index, { image_text: event.target.value })}
                              disabled={isFormDisabled}
                              className={advancedInputClasses}
                              placeholder="What is in this image and what matters for this scene"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="space-y-2">
              <label className={`block text-sm font-semibold ${colorMode === 'dark' ? 'text-slate-100' : 'text-slate-900'}`}>
                Video styling prompt
              </label>
              <TextareaAutosize
                minRows={4}
                maxRows={12}
                disabled={isFormDisabled}
                className={`
                  vidgenie-prompt-textarea
                  w-full pl-4 pt-4 pr-4 p-2 rounded-2xl resize-none placeholder:opacity-60
                  focus:outline-none focus:ring-2 focus:ring-indigo-500/60 ring-1 transition
                  ${colorMode === 'dark'
                    ? 'bg-gray-950/90 text-white ring-white/10 focus:ring-indigo-500/50'
                    : 'bg-white text-slate-900 ring-slate-200 focus:ring-indigo-500/50'
                  }
                `}
                placeholder={t(
                  "vidgenie.imageListPromptPlaceholder",
                  {},
                  "Describe the motion, pacing, and story that should connect these images..."
                )}
                name="promptText"
                value={promptText}
                maxLength={VIDGENIE_PROMPT_MAX_LENGTH}
                onChange={handlePromptTextChange}
              />
            </div>
            <div className={`text-right text-xs tabular-nums ${promptCounterClass}`}>
              {promptCounterLabel}
            </div>
          </div>
        )}
      </form>
      )}
      {shouldShowOriginalRequestInputs && renderSubmitButton()}

      {/* ───────── Assistant Chat ───────── */}
      {shouldShowOriginalRequestInputs && (
      <div className={`vidgenie-assistant-anchor mt-6 rounded-2xl p-3 sm:p-4 ring-1 transition-shadow hover:shadow-sm ${
        colorMode === 'dark'
          ? 'bg-[#0f1629] text-slate-100 ring-[#1f2a3d]'
          : 'bg-white text-slate-900 ring-slate-200'
      }`}>
        <AssistantHome
          submitAssistantQuery={submitAssistantQuery}
          sessionId={id}
          sessionMessages={sessionMessages}
          onSessionMessagesChange={setSessionMessages}
          onSessionDetailsChange={setSessionDetails}
          onAssistantQueryGeneratingChange={setIsAssistantQueryGenerating}
          isAssistantQueryGenerating={isAssistantQueryGenerating}
          getSessionImageLayers={getSessionImageLayers}
        />
      </div>
      )}
      <ToastContainer
        position="bottom-center"
        autoClose={5000}
        hideProgressBar
        newestOnTop={false}
        closeOnClick
        pauseOnFocusLoss
        draggable
      />
    </div>
  );
}
