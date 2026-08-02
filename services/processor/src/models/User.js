
import { generateAuthToken, verifyAuthToken } from './Auth.js';
import 'dotenv/config';
import User from '../schema/User.js';
import GenerationCreditTransaction from '../schema/GenerationCreditTransaction.js';
import mongoose from 'mongoose';

import CouponCode from '../schema/CouponCode.js';
import dayjs from 'dayjs';
import { cancelSubscription, createPaymentPlanWithFreeTrial } from './Payment.js';
import { deleteGlobalSessionsForUser } from './GlobalSession.js';

import ImageGeneration from '../schema/ImageGeneration.js';
import GeneratedImage from '../schema/generations/GeneratedImage.js';
import GeneratedMusic from '../schema/generations/GeneratedMusic.js';
import GeneratedAIVideo from '../schema/generations/GeneratedAIVideo.js';

import { generateAPIKey } from '../utils/ApiKeyUtils.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';

import { getDBConnectionString } from './DBString.js';
import { SUPPORTED_LANGUAGES, isSupportedLanguage, normalizeSupportedLanguage } from '../consts/SupportedLanguages.js';
import { DEFAULT_LATIN_SUBTITLE_FONT, getSubtitleFontsForLanguage } from '../consts/SubtitleFonts.js';
import {
  isKnownTTSSpeaker,
  normalizeTTSSpeakerGender,
  TTS_PROVIDER_ELEVENLABS,
  TTS_PROVIDER_GOOGLE,
  TTS_PROVIDER_OPENAI,
} from '../consts/TTSSpeakers.js';
import { deleteObjectsWithPrefix } from './AWS.js';
import {
  notifyAdminForNewsletterSubscription,
  prepareUserForVerifiedNewsletterSubscription,
} from './Newsletter.js';
import {
  DEFAULT_INFERENCE_MODEL,
  normalizeInferenceModel,
} from '../consts/InferenceModels.js';
import { isSetupAdminBootstrapEnabled, isStandaloneEdition } from '../utils/EnvironmentUtils.js';

export const DEFAULT_TEXT_MODEL = DEFAULT_INFERENCE_MODEL;
export const API_KEY_USAGE_LIMIT_PERIODS = Object.freeze({
  MONTHLY: 'monthly',
  TOTAL: 'total',
});
const USER_GENERATION_BUCKET = process.env.USER_GENERATIONS_BUCKET ||
  process.env.AWS_USER_GENERATIONS_BUCKET ||
  process.env.AWS_GENERATIONS_BUCKET ||
  process.env.MEDIA_BUCKET_NAME ||
  process.env.STATIC_CDN_BUCKET ||
  process.env.SAMSAR_EXTERNAL_MEDIA_BUCKET ||
  'samsar-resources';
const USER_GENERATION_PREFIX = process.env.USER_GENERATIONS_PREFIX || 'user_resources';
const CUSTOM_ADAPTER_SECRET_PREFIX = 'enc:v1:';
const CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX = 'CUSTOM_TEXT_TO_IMAGE:';
const CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN = '{request_id}';
const CUSTOM_ADAPTER_HEADER_KEY_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const CUSTOM_ADAPTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_CUSTOM_ADAPTER_ENDPOINTS = 20;

function normalizeBackingTrackModel(value) {
  return value === 'LYRIA2' ? 'LYRIA3' : value;
}

export function normalizeAssistantModel(value) {
  return normalizeInferenceModel(value);
}

function getCustomAdapterSecretKey() {
  const secret =
    process.env.CUSTOM_ADAPTER_SECRET_KEY ||
    process.env.CUSTOM_CREDENTIALS_SECRET ||
    process.env.TOKEN_SECRET;
  if (!secret || !secret.trim()) {
    throw new Error('CUSTOM_ADAPTER_SECRET_KEY or TOKEN_SECRET is required to save custom adapter credentials.');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function isEncryptedCustomAdapterSecret(value) {
  return typeof value === 'string' && value.startsWith(CUSTOM_ADAPTER_SECRET_PREFIX);
}

function encryptCustomAdapterSecret(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || isEncryptedCustomAdapterSecret(normalized)) {
    return normalized;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getCustomAdapterSecretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(normalized, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    CUSTOM_ADAPTER_SECRET_PREFIX.slice(0, -1),
    iv.toString('base64'),
    tag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

function hasCustomAdapterSecret(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function encryptStoredCustomAdapterSecrets(customAdapters) {
  if (!customAdapters || typeof customAdapters !== 'object') {
    return false;
  }

  let changed = false;
  if (
    typeof customAdapters.api_key === 'string' &&
    customAdapters.api_key.trim() &&
    !isEncryptedCustomAdapterSecret(customAdapters.api_key.trim())
  ) {
    customAdapters.api_key = encryptCustomAdapterSecret(customAdapters.api_key);
    changed = true;
  }

  if (Array.isArray(customAdapters.custom_endpoints)) {
    customAdapters.custom_endpoints.forEach((endpoint) => {
      if (endpoint && typeof endpoint === 'object') {
        for (const secretField of ['api_key', 'header_value']) {
          if (
            typeof endpoint[secretField] === 'string' &&
            endpoint[secretField].trim() &&
            !isEncryptedCustomAdapterSecret(endpoint[secretField].trim())
          ) {
            endpoint[secretField] = encryptCustomAdapterSecret(endpoint[secretField]);
            changed = true;
          }
        }
      }
    });
  }

  return changed;
}

function getExistingCustomEndpointSecret(currentCustomAdapters, endpoint, secretField = 'api_key') {
  const currentEndpoints = Array.isArray(currentCustomAdapters?.custom_endpoints)
    ? currentCustomAdapters.custom_endpoints
    : [];
  const endpointId = typeof endpoint?.id === 'string' ? endpoint.id.trim() : '';
  const operation = typeof endpoint?.operation === 'string' ? endpoint.operation.trim() : '';
  const baseUrl = typeof endpoint?.base_url === 'string' ? endpoint.base_url.trim() : '';
  const modelEndpoint = typeof endpoint?.endpoint === 'string' ? endpoint.endpoint.trim() : '';

  const match = currentEndpoints.find((currentEndpoint) => {
    if (!currentEndpoint || typeof currentEndpoint !== 'object') {
      return false;
    }
    if (endpointId && currentEndpoint.id === endpointId) {
      return true;
    }
    return (
      currentEndpoint.operation === operation &&
      currentEndpoint.base_url === baseUrl &&
      currentEndpoint.endpoint === modelEndpoint
    );
  });

  return typeof match?.[secretField] === 'string' ? match[secretField].trim() : '';
}

function sanitizeCustomAdaptersForClient(customAdapters) {
  if (!customAdapters || typeof customAdapters !== 'object') {
    return customAdapters || null;
  }
  const source = typeof customAdapters.toObject === 'function'
    ? customAdapters.toObject()
    : JSON.parse(JSON.stringify(customAdapters));
  const sanitized = { ...source };

  if (hasCustomAdapterSecret(sanitized.api_key)) {
    sanitized.has_api_key = true;
  }
  delete sanitized.api_key;

  if (Array.isArray(sanitized.custom_endpoints)) {
    sanitized.custom_endpoints = sanitized.custom_endpoints.map((endpoint) => {
      if (!endpoint || typeof endpoint !== 'object') {
        return endpoint;
      }
      const nextEndpoint = { ...endpoint };
      if (hasCustomAdapterSecret(nextEndpoint.api_key)) {
        nextEndpoint.has_api_key = true;
      }
      if (hasCustomAdapterSecret(nextEndpoint.header_value)) {
        nextEndpoint.has_header_value = true;
      }
      delete nextEndpoint.api_key;
      delete nextEndpoint.header_value;
      return nextEndpoint;
    });
  }

  return sanitized;
}

export function formatUserClientProfile(user, extras = {}) {
  if (!user) {
    return user;
  }
  const profile = typeof user.toObject === 'function'
    ? user.toObject()
    : JSON.parse(JSON.stringify(user));

  delete profile.password;
  delete profile.verificationCode;
  delete profile.verificationCodeExpiresAt;
  delete profile.userApiKeys;
  delete profile.oauthRefreshTokens;
  delete profile.authenticationKey;

  if (Object.prototype.hasOwnProperty.call(profile, 'custom_adapters')) {
    profile.custom_adapters = sanitizeCustomAdaptersForClient(profile.custom_adapters);
  }

  return {
    ...profile,
    ...extras,
  };
}

export async function ensureDefaultTextModelsForUser(user) {
  if (!user) {
    return user;
  }

  let hasChanges = false;
  const normalizedInferenceModel = normalizeInferenceModel(user.selectedInferenceModel);
  if (user.selectedInferenceModel !== normalizedInferenceModel) {
    user.selectedInferenceModel = normalizedInferenceModel;
    hasChanges = true;
  }
  const normalizedAssistantModel = normalizeAssistantModel(user.selectedAssistantModel);
  if (user.selectedAssistantModel !== normalizedAssistantModel) {
    user.selectedAssistantModel = normalizedAssistantModel;
    hasChanges = true;
  }
  if (encryptStoredCustomAdapterSecrets(user.custom_adapters)) {
    hasChanges = true;
  }

  if (hasChanges && typeof user.save === 'function') {
    await user.save();
  }

  return user;
}

const buildDefaultFontPreferences = () => {
  const defaults = {};
  SUPPORTED_LANGUAGES.forEach((languageCode) => {
    const fonts = getSubtitleFontsForLanguage(languageCode);
    const defaultFont = (Array.isArray(fonts) && fonts[0]) ? fonts[0] : DEFAULT_LATIN_SUBTITLE_FONT;
    defaults[languageCode] = {
      expressGenerationTextFont: defaultFont,
      expressGenerationSpeakerFont: defaultFont,
    };
  });
  return defaults;
};

const normalizeFontPreferencesPayload = (fontPreferences) => {
  if (!fontPreferences || typeof fontPreferences !== 'object') {
    return {};
  }

  const normalized = {};
  Object.entries(fontPreferences).forEach(([languageCode, prefs]) => {
    const normalizedLanguage = normalizeSupportedLanguage(languageCode);
    if (!normalizedLanguage || !prefs || typeof prefs !== 'object') {
      return;
    }

    const textFont =
      typeof prefs.expressGenerationTextFont === 'string' ? prefs.expressGenerationTextFont.trim() : '';
    const speakerFont =
      typeof prefs.expressGenerationSpeakerFont === 'string' ? prefs.expressGenerationSpeakerFont.trim() : '';

    if (!textFont && !speakerFont) {
      return;
    }

    normalized[normalizedLanguage] = {
      ...(textFont ? { expressGenerationTextFont: textFont } : {}),
      ...(speakerFont ? { expressGenerationSpeakerFont: speakerFont } : {}),
    };
  });

  return normalized;
};

function normalizeHttpUrl(value, { requireRequestId = false } = {}) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return '';
  }
  if (requireRequestId && !normalized.includes(CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN)) {
    return '';
  }
  try {
    const candidate = requireRequestId
      ? normalized.replaceAll(CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN, 'request-id')
      : normalized;
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? normalized : '';
  } catch {
    return '';
  }
}

function customAdapterValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function normalizeCustomAdaptersPayload(customAdapters, currentCustomAdapters = null) {
  if (customAdapters === undefined) {
    return undefined;
  }
  if (customAdapters === null) {
    return null;
  }
  if (!customAdapters || typeof customAdapters !== 'object' || Array.isArray(customAdapters)) {
    const error = new Error('custom_adapters must be an object when provided.');
    error.status = 400;
    throw error;
  }

  const normalized = {};
  const operationKeys = [
    'text_to_video',
    'image_to_video',
    'text_to_image',
    'text_to_speech',
    'text_to_music',
    'text_to_sound_effect',
  ];
  const authorizationKeys = operationKeys.map((key) => `${key}_authorization`);
  for (const key of [
    'api_key',
    'base_url',
    ...operationKeys,
    ...authorizationKeys,
  ]) {
    const value = customAdapters[key];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== 'string') {
      const error = new Error(`custom_adapters.${key} must be a string when provided.`);
      error.status = 400;
      throw error;
    }
    const trimmed = value.trim();
    if (trimmed) {
      if (authorizationKeys.includes(key) && !['native', 'deployed'].includes(trimmed)) {
        const error = new Error(`custom_adapters.${key} must be either native or deployed.`);
        error.status = 400;
        throw error;
      }
      normalized[key] = key === 'api_key' ? encryptCustomAdapterSecret(trimmed) : trimmed;
    }
  }

  const rawCustomEndpoints = Array.isArray(customAdapters.custom_endpoints)
    ? customAdapters.custom_endpoints
    : Array.isArray(customAdapters.customEndpoints)
      ? customAdapters.customEndpoints
      : [];
  const normalizedCustomEndpoints = [];
  if (rawCustomEndpoints.length > MAX_CUSTOM_ADAPTER_ENDPOINTS) {
    throw customAdapterValidationError(`A maximum of ${MAX_CUSTOM_ADAPTER_ENDPOINTS} custom endpoints is allowed.`);
  }
  const endpointIds = new Set();
  rawCustomEndpoints.forEach((endpoint, index) => {
    if (!endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) {
      const error = new Error(`custom_adapters.custom_endpoints[${index}] must be an object when provided.`);
      error.status = 400;
      throw error;
    }

    const operation =
      typeof endpoint.operation === 'string' ? endpoint.operation.trim() : '';
    if (!operationKeys.includes(operation)) {
      const error = new Error(`custom_adapters.custom_endpoints[${index}].operation is invalid.`);
      error.status = 400;
      throw error;
    }

    const id = typeof endpoint.id === 'string' && endpoint.id.trim()
      ? endpoint.id.trim()
      : `custom_endpoint_${index + 1}`;
    if (!CUSTOM_ADAPTER_ID_PATTERN.test(id)) {
      throw customAdapterValidationError(
        `custom_adapters.custom_endpoints[${index}].id may only contain letters, numbers, dots, underscores, and hyphens.`,
      );
    }
    if (endpointIds.has(id)) {
      throw customAdapterValidationError(`custom_adapters.custom_endpoints[${index}].id must be unique.`);
    }
    endpointIds.add(id);

    const submittedGenerateUrl =
      typeof endpoint.generate_url === 'string'
        ? endpoint.generate_url.trim()
        : typeof endpoint.generateUrl === 'string'
          ? endpoint.generateUrl.trim()
          : '';
    if (operation === 'text_to_image' && submittedGenerateUrl) {
      const name = typeof endpoint.name === 'string' ? endpoint.name.trim() : '';
      const statusUrl =
        typeof endpoint.status_url === 'string'
          ? endpoint.status_url.trim()
          : typeof endpoint.statusUrl === 'string'
            ? endpoint.statusUrl.trim()
            : '';
      const resultUrl =
        typeof endpoint.result_url === 'string'
          ? endpoint.result_url.trim()
          : typeof endpoint.resultUrl === 'string'
            ? endpoint.resultUrl.trim()
            : '';
      if (!name) {
        throw customAdapterValidationError(`custom_adapters.custom_endpoints[${index}].name is required.`);
      }
      if (name.length > 120) {
        throw customAdapterValidationError(`custom_adapters.custom_endpoints[${index}].name is too long.`);
      }
      if ([submittedGenerateUrl, statusUrl, resultUrl].some((url) => url.length > 4096)) {
        throw customAdapterValidationError(`custom_adapters.custom_endpoints[${index}] contains a URL that is too long.`);
      }
      if (!normalizeHttpUrl(submittedGenerateUrl)) {
        throw customAdapterValidationError(`custom_adapters.custom_endpoints[${index}].generate_url must be a valid HTTP or HTTPS URL.`);
      }
      if (!normalizeHttpUrl(statusUrl, { requireRequestId: true })) {
        throw customAdapterValidationError(
          `custom_adapters.custom_endpoints[${index}].status_url must be an HTTP or HTTPS URL containing ${CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN}.`,
        );
      }
      if (!normalizeHttpUrl(resultUrl, { requireRequestId: true })) {
        throw customAdapterValidationError(
          `custom_adapters.custom_endpoints[${index}].result_url must be an HTTP or HTTPS URL containing ${CUSTOM_TEXT_TO_IMAGE_REQUEST_ID_TOKEN}.`,
        );
      }

      const headerKey = typeof endpoint.header_key === 'string'
        ? endpoint.header_key.trim()
        : typeof endpoint.headerKey === 'string'
          ? endpoint.headerKey.trim()
          : 'Authorization';
      if (headerKey.length > 128 || (headerKey && !CUSTOM_ADAPTER_HEADER_KEY_PATTERN.test(headerKey))) {
        throw customAdapterValidationError(`custom_adapters.custom_endpoints[${index}].header_key is invalid.`);
      }
      const submittedHeaderValue = typeof endpoint.header_value === 'string'
        ? endpoint.header_value.trim()
        : typeof endpoint.headerValue === 'string'
          ? endpoint.headerValue.trim()
          : '';
      if (submittedHeaderValue.includes('\n') || submittedHeaderValue.includes('\r')) {
        throw customAdapterValidationError(`custom_adapters.custom_endpoints[${index}].header_value is invalid.`);
      }
      if (submittedHeaderValue.length > 8192) {
        throw customAdapterValidationError(`custom_adapters.custom_endpoints[${index}].header_value is too long.`);
      }
      const headerValue = submittedHeaderValue || getExistingCustomEndpointSecret(
        currentCustomAdapters,
        { id },
        'header_value',
      );

      normalizedCustomEndpoints.push({
        id,
        model_key: `${CUSTOM_TEXT_TO_IMAGE_MODEL_PREFIX}${id}`,
        name,
        provider: 'custom',
        operation,
        generate_url: submittedGenerateUrl,
        status_url: statusUrl,
        result_url: resultUrl,
        header_key: headerKey || 'Authorization',
        ...(headerValue ? { header_value: encryptCustomAdapterSecret(headerValue) } : {}),
      });
      return;
    }

    const baseUrl =
      typeof endpoint.base_url === 'string'
        ? endpoint.base_url.trim()
        : typeof endpoint.baseUrl === 'string'
          ? endpoint.baseUrl.trim()
          : '';
    const modelEndpoint =
      typeof endpoint.endpoint === 'string'
        ? endpoint.endpoint.trim()
        : typeof endpoint.path === 'string'
          ? endpoint.path.trim()
          : typeof endpoint.route === 'string'
            ? endpoint.route.trim()
            : typeof endpoint.url === 'string'
              ? endpoint.url.trim()
              : '';
    if (!baseUrl) {
      const error = new Error(`custom_adapters.custom_endpoints[${index}].base_url is required.`);
      error.status = 400;
      throw error;
    }
    if (!modelEndpoint) {
      const error = new Error(`custom_adapters.custom_endpoints[${index}].endpoint is required.`);
      error.status = 400;
      throw error;
    }

    const submittedApiKey =
      typeof endpoint.api_key === 'string'
        ? endpoint.api_key.trim()
        : typeof endpoint.apiKey === 'string'
          ? endpoint.apiKey.trim()
          : '';
    const apiKey = submittedApiKey || getExistingCustomEndpointSecret(currentCustomAdapters, {
      id: typeof endpoint.id === 'string' ? endpoint.id.trim() : `custom_endpoint_${index + 1}`,
      operation,
      base_url: baseUrl,
      endpoint: modelEndpoint,
    });
    const name = typeof endpoint.name === 'string' ? endpoint.name.trim() : '';
    const provider = typeof endpoint.provider === 'string' && endpoint.provider.trim()
      ? endpoint.provider.trim()
      : 'fal';
    normalizedCustomEndpoints.push({
      id,
      name: name || modelEndpoint,
      provider,
      operation,
      base_url: baseUrl,
      ...(apiKey ? { api_key: encryptCustomAdapterSecret(apiKey) } : {}),
      endpoint: modelEndpoint,
    });
  });

  if (normalizedCustomEndpoints.length > 0) {
    normalized.custom_endpoints = normalizedCustomEndpoints;
  }

  if (Object.keys(normalized).length === 0) {
    return null;
  }
  const hasLegacyOperation = operationKeys.some((key) => normalized[key]);
  if (
    hasLegacyOperation &&
    !normalized.api_key &&
    typeof currentCustomAdapters?.api_key === 'string' &&
    currentCustomAdapters.api_key.trim()
  ) {
    normalized.api_key = encryptCustomAdapterSecret(currentCustomAdapters.api_key.trim());
  }
  if (hasLegacyOperation && !normalized.base_url) {
    const error = new Error('custom_adapters.base_url is required when custom_adapters is provided.');
    error.status = 400;
    throw error;
  }
  return normalized;
}

const normalizeBooleanFlag = (value) => value === true;

const normalizeSpeakerSelectionList = (provider, rawSpeakers) => {
  if (!Array.isArray(rawSpeakers)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  rawSpeakers.forEach((speakerValue) => {
    if (typeof speakerValue !== 'string') {
      return;
    }

    const trimmed = speakerValue.trim();
    if (!trimmed || seen.has(trimmed) || !isKnownTTSSpeaker(provider, trimmed)) {
      return;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

const normalizeGoogleSpeakerSelectionList = (rawSpeakers) => {
  if (!Array.isArray(rawSpeakers)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  rawSpeakers.forEach((speakerValue) => {
    if (typeof speakerValue !== 'string') {
      return;
    }

    const trimmed = speakerValue.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  });

  return normalized;
};

const getGoogleLanguageCodeFromSpeakerValue = (speakerValue = '') => {
  if (typeof speakerValue !== 'string') {
    return '';
  }

  const languageMatch = speakerValue.trim().match(/^[a-z]{2,3}(?:-[A-Z0-9]{2,4})?/);
  return languageMatch?.[0] || '';
};

const normalizeGoogleSpeakerDetailsPayload = (speakerDetails, selectedGoogleSpeakers = []) => {
  const selectedValues = new Set(selectedGoogleSpeakers);
  const seen = new Set();
  const normalized = [];

  const rawSpeakerDetails = Array.isArray(speakerDetails) ? speakerDetails : [];
  rawSpeakerDetails.forEach((speaker) => {
    if (!speaker || typeof speaker !== 'object' || Array.isArray(speaker)) {
      return;
    }

    const value = typeof speaker.value === 'string' && speaker.value.trim()
      ? speaker.value.trim()
      : typeof speaker.voiceId === 'string' && speaker.voiceId.trim()
        ? speaker.voiceId.trim()
        : typeof speaker.name === 'string' && speaker.name.trim()
          ? speaker.name.trim()
          : '';
    if (!value || seen.has(value) || (selectedValues.size > 0 && !selectedValues.has(value))) {
      return;
    }

    const voiceId = typeof speaker.voiceId === 'string' && speaker.voiceId.trim()
      ? speaker.voiceId.trim()
      : value;
    const languageCodes = Array.isArray(speaker.languageCodes)
      ? speaker.languageCodes.filter((languageCode) => typeof languageCode === 'string' && languageCode.trim())
      : [];
    const languageCode = typeof speaker.languageCode === 'string' && speaker.languageCode.trim()
      ? speaker.languageCode.trim()
      : languageCodes[0] || '';
    const gender = normalizeTTSSpeakerGender(
      speaker.Gender || speaker.genderCode || speaker.gender || speaker.ssmlGender
    );

    seen.add(value);
    normalized.push({
      provider: TTS_PROVIDER_GOOGLE,
      value,
      voiceId,
      name: typeof speaker.name === 'string' && speaker.name.trim() ? speaker.name.trim() : voiceId,
      label: typeof speaker.label === 'string' && speaker.label.trim() ? speaker.label.trim() : voiceId,
      shortLabel:
        typeof speaker.shortLabel === 'string' && speaker.shortLabel.trim()
          ? speaker.shortLabel.trim()
          : '',
      languageCode,
      languageCodes,
      Gender: gender,
      gender: typeof speaker.gender === 'string' ? speaker.gender.trim() : '',
      genderLabel: typeof speaker.genderLabel === 'string' ? speaker.genderLabel.trim() : '',
      naturalSampleRateHertz: Number.isFinite(Number(speaker.naturalSampleRateHertz))
        ? Number(speaker.naturalSampleRateHertz)
        : null,
      voiceType: typeof speaker.voiceType === 'string' ? speaker.voiceType.trim() : '',
      previewRequiresAuth: speaker.previewRequiresAuth !== false,
    });
  });

  selectedGoogleSpeakers.forEach((speakerValue) => {
    if (seen.has(speakerValue)) {
      return;
    }

    const languageCode = getGoogleLanguageCodeFromSpeakerValue(speakerValue);
    seen.add(speakerValue);
    normalized.push({
      provider: TTS_PROVIDER_GOOGLE,
      value: speakerValue,
      voiceId: speakerValue,
      name: speakerValue,
      label: speakerValue,
      shortLabel: speakerValue,
      languageCode,
      languageCodes: languageCode ? [languageCode] : [],
      Gender: null,
      gender: '',
      genderLabel: '',
      naturalSampleRateHertz: null,
      voiceType: '',
      previewRequiresAuth: true,
    });
  });

  return normalized;
};

const normalizeSpeakerOptionsPayload = (speakerOptions) => {
  if (!speakerOptions || typeof speakerOptions !== 'object' || Array.isArray(speakerOptions)) {
    return null;
  }

  const googleSpeakers = normalizeGoogleSpeakerSelectionList(speakerOptions.googleSpeakers);
  const normalized = {
    allowOpenAI: normalizeBooleanFlag(speakerOptions.allowOpenAI),
    allowElevenLabs: normalizeBooleanFlag(speakerOptions.allowElevenLabs),
    allowGoogle: normalizeBooleanFlag(speakerOptions.allowGoogle),
    openAISpeakers: normalizeSpeakerSelectionList(
      TTS_PROVIDER_OPENAI,
      speakerOptions.openAISpeakers,
    ),
    elevenLabsSpeakers: normalizeSpeakerSelectionList(
      TTS_PROVIDER_ELEVENLABS,
      speakerOptions.elevenLabsSpeakers,
    ),
    googleSpeakers,
    googleSpeakerDetails: normalizeGoogleSpeakerDetailsPayload(
      speakerOptions.googleSpeakerDetails,
      googleSpeakers,
    ),
  };

  const hasSelections =
    normalized.allowOpenAI ||
    normalized.allowElevenLabs ||
    normalized.allowGoogle ||
    normalized.openAISpeakers.length > 0 ||
    normalized.elevenLabsSpeakers.length > 0 ||
    normalized.googleSpeakers.length > 0 ||
    normalized.googleSpeakerDetails.length > 0;

  return hasSelections ? normalized : null;
};

const toComparableSpeakerOptions = (speakerOptions) => {
  if (!speakerOptions) {
    return null;
  }

  if (typeof speakerOptions.toObject === 'function') {
    return speakerOptions.toObject();
  }

  return JSON.parse(JSON.stringify(speakerOptions));
};


export async function verifyUserSession(payload) {

  await getDBConnectionString();


  let userData;
  let userExists = await User.findOne({ fid: payload.fid });
  if (!userExists) {
    const userModel = new User(payload);
    userData = await userModel.save();
  } else {
    userData = userExists;
  }
  await ensureDefaultTextModelsForUser(userData);
  const userId = userData._id.toString();
  const authToken = generateAuthToken(userId);
  let returnUserPayload = Object.assign({}, userData._doc, { authToken });
  return returnUserPayload;
}


export async function verifyUserToken(payload) {
  const authToken = payload.authToken;
  const decodedData = verifyAuthToken(authToken);
  const userId = decodedData._id;
  await getDBConnectionString();
  let userData = await User.findOne({ _id: userId });

  await ensureDefaultTextModelsForUser(userData);
  return userData;
}



export async function setUserData(payload) {

  // This function should return a session object
  const db = await getDBConnectionString();
  let userData;
  let userExists = await User.findOne({ fid: payload.fid });
  if (userExists) {

    userData = await userExists.save({});
  } else {
    const userModel = new User(payload);
    userData = await userModel.save();
  }
  await ensureDefaultTextModelsForUser(userData);
  return userData;
}

export async function getUserData(fid) {

  fid = fid.toString();

  await getDBConnectionString();
  const userData = await User.findOne({
    fid: fid
  });
  await ensureDefaultTextModelsForUser(userData);
  return userData;
}


export async function verifyEmail(payload) {

  const { email, verificationCode } = payload;

  await getDBConnectionString();

  const user = await User.findOne({
    email,
    verificationCode,
  });



  if (!user) {
    throw new Error('Invalid verification code');
  }

  // Check if the verification code is expired
  const now = dayjs();
  const verificationExpiresAt = dayjs(user.verificationCodeExpiresAt);

  if (now.isAfter(verificationExpiresAt)) {
    throw new Error('Verification code has expired');
  }

  // If valid, set isEmailVerified to true and save the user
  user.isEmailVerified = true;
  user.verificationCode = null; // Optionally, you can nullify the verification code after successful verification
  user.verificationCodeExpiresAt = null; // Optionally, you can nullify the expiration time as well
  const shouldNotifyNewsletterAdmin = prepareUserForVerifiedNewsletterSubscription(user, {
    source: user.weeklyNewsletterSubscriptionSource || 'email_verification',
  });

  const saveDataRes = await user.save();

  if (shouldNotifyNewsletterAdmin) {
    notifyAdminForNewsletterSubscription(saveDataRes).catch((error) => {
      console.error('Newsletter subscription admin notification failed:', error);
    });
  }


  const userId = saveDataRes._id.toString();
  const authToken = generateAuthToken(userId);
  let returnUserPayload = Object.assign({}, saveDataRes._doc, { authToken });
  return returnUserPayload;

}



export async function requestApplyCreditsCoupon(userId, payload) {
  const { couponCode } = payload;
  await getDBConnectionString();
  const user = await User.findOne({ _id: userId });

  const couponData = await CouponCode.findOne({ couponCode });
  if (!couponData) {
    throw new Error('Invalid coupon code');
  }

  // Check that redemptionType is 'credit'
  if (couponData.redemptionType !== 'credit') {
    throw new Error('Invalid coupon code for credits');
  }

  // Check if the coupon is active
  if (!couponData.redemptionActive) {
    throw new Error('Coupon code is not active');
  }

  // Check if the coupon has reached its redemption limit
  if (
    couponData.redemptionLimit !== null &&
    couponData.redemptionCount >= couponData.redemptionLimit
  ) {
    throw new Error('Coupon code has reached its redemption limit');
  }

  // Check if the coupon has expired
  if (couponData.redemptionEndDate && couponData.redemptionEndDate < new Date()) {
    throw new Error('Coupon code has expired');
  }

  // Check if the user has already redeemed the coupon
  const userAlreadyRedeemed = couponData.redeemedUsers.includes(userId);
  if (userAlreadyRedeemed) {
    throw new Error('User has already redeemed this coupon code');
  }

  // Update user's generationCredits
  user.generationCredits = (user.generationCredits || 0) + couponData.redemptionValue;
  await user.save();

  // Update coupon data: increment redemptionCount and add userId to redeemedUsers
  await CouponCode.updateOne(
    { couponCode },
    { $push: { redeemedUsers: userId }, $inc: { redemptionCount: 1 } }
  );

  // Return success message and updated credits
  return {
    message: 'Coupon code applied successfully',
    generationCredits: user.generationCredits,
  };
}



export async function updateUserDetails(userId, payload) {
  await getDBConnectionString();
  const user = await User.findOne({ _id: userId });
  const hasSpeakerOptionsPayload =
    payload && Object.prototype.hasOwnProperty.call(payload, 'speakerOptions');
  const hasCustomAdaptersPayload =
    payload && (
      Object.prototype.hasOwnProperty.call(payload, 'custom_adapters') ||
      Object.prototype.hasOwnProperty.call(payload, 'customAdapters')
    );

  if (hasCustomAdaptersPayload && !isStandaloneEdition()) {
    const error = new Error('Custom adapters are only available in standalone deployments.');
    error.status = 403;
    throw error;
  }

  const {
    username,
    contentFilterRating,
    selectedInferenceModel,
    selectedInferenceModelAuthorization,
    selectedNotifyOnCompletion,
    selectedAssistantModel,
    selectedAssistantModelAuthorization,
    expressGenerationSpeakerFont,
    expressGenerationTextFont,
    fontPreferences,
    backingTrackModel,
    backingTrackModelAuthorization,
    agentVideoModel,
    agentVideoModelAuthorization,
    agentImageModel,
    agentImageModelAuthorization,
    defaultAgentDuration,
    agentSoundEffectModel,
    agentSoundEffectModelAuthorization,
    preferredLanguage,
    videoFramesPerSecond,
    speakerOptions,
    custom_adapters,
    customAdapters,

  } = payload;

  let contentFilterActualValue = contentFilterRating
    ? parseInt(contentFilterRating)
    : undefined;

  let hasChanges = false;
  const normalizedCurrentInferenceModel = normalizeInferenceModel(user.selectedInferenceModel);
  if (user.selectedInferenceModel !== normalizedCurrentInferenceModel) {
    user.selectedInferenceModel = normalizedCurrentInferenceModel;
    hasChanges = true;
  }
  const normalizedCurrentAssistantModel = normalizeAssistantModel(user.selectedAssistantModel);
  if (user.selectedAssistantModel !== normalizedCurrentAssistantModel) {
    user.selectedAssistantModel = normalizedCurrentAssistantModel;
    hasChanges = true;
  }

  // Username
  if (username && user.username !== username) {
    user.username = username;
    hasChanges = true;
  }

  // Content Filter
  if (
    typeof contentFilterActualValue === "number" &&
    user.contentFilterRating !== contentFilterActualValue
  ) {
    user.contentFilterRating = contentFilterActualValue;
    hasChanges = true;
  }

  // Inference Model
  if (
    selectedInferenceModel &&
    user.selectedInferenceModel !== normalizeInferenceModel(selectedInferenceModel)
  ) {
    user.selectedInferenceModel = normalizeInferenceModel(selectedInferenceModel);
    hasChanges = true;
  }

  if (
    selectedInferenceModelAuthorization &&
    ['native', 'deployed'].includes(selectedInferenceModelAuthorization) &&
    user.selectedInferenceModelAuthorization !== selectedInferenceModelAuthorization
  ) {
    user.selectedInferenceModelAuthorization = selectedInferenceModelAuthorization;
    hasChanges = true;
  }

  // Assistant Model
  if (
    selectedAssistantModel &&
    user.selectedAssistantModel !== normalizeAssistantModel(selectedAssistantModel)
  ) {
    user.selectedAssistantModel = normalizeAssistantModel(selectedAssistantModel);
    hasChanges = true;
  }

  if (
    selectedAssistantModelAuthorization &&
    ['native', 'deployed'].includes(selectedAssistantModelAuthorization) &&
    user.selectedAssistantModelAuthorization !== selectedAssistantModelAuthorization
  ) {
    user.selectedAssistantModelAuthorization = selectedAssistantModelAuthorization;
    hasChanges = true;
  }

  // Notify on Completion
  if (
    selectedNotifyOnCompletion !== undefined &&
    user.selectedNotifyOnCompletion !== selectedNotifyOnCompletion
  ) {
    user.selectedNotifyOnCompletion = selectedNotifyOnCompletion;
    hasChanges = true;
  }

  // Speaker Font
  if (
    expressGenerationSpeakerFont &&
    user.expressGenerationSpeakerFont !== expressGenerationSpeakerFont
  ) {
    user.expressGenerationSpeakerFont = expressGenerationSpeakerFont;
    hasChanges = true;
  }

  // Text Font
  if (
    expressGenerationTextFont &&
    user.expressGenerationTextFont !== expressGenerationTextFont
  ) {
    user.expressGenerationTextFont = expressGenerationTextFont;
    hasChanges = true;
  }

  if (fontPreferences && typeof fontPreferences === 'object') {
    const normalizedPreferences = normalizeFontPreferencesPayload(fontPreferences);
    if (Object.keys(normalizedPreferences).length > 0) {
      const currentPreferences =
        user.fontPreferences && typeof user.fontPreferences === 'object'
          ? (user.fontPreferences instanceof Map ? Object.fromEntries(user.fontPreferences) : user.fontPreferences)
          : buildDefaultFontPreferences();
      const mergedPreferences = { ...currentPreferences };

      Object.entries(normalizedPreferences).forEach(([languageCode, prefs]) => {
        mergedPreferences[languageCode] = {
          ...(mergedPreferences[languageCode] || {}),
          ...prefs,
        };
      });

      user.fontPreferences = mergedPreferences;
      hasChanges = true;
    }
  }

  const normalizedBackingTrackModel = normalizeBackingTrackModel(backingTrackModel);
  if (normalizedBackingTrackModel && user.backingTrackModel !== normalizedBackingTrackModel) {
    user.backingTrackModel = normalizedBackingTrackModel;
    hasChanges = true;
  }

  if (
    backingTrackModelAuthorization &&
    ['native', 'deployed'].includes(backingTrackModelAuthorization) &&
    user.backingTrackModelAuthorization !== backingTrackModelAuthorization
  ) {
    user.backingTrackModelAuthorization = backingTrackModelAuthorization;
    hasChanges = true;
  }

  if (hasSpeakerOptionsPayload) {
    const normalizedSpeakerOptions = normalizeSpeakerOptionsPayload(speakerOptions);
    const currentSpeakerOptions = toComparableSpeakerOptions(user.speakerOptions);

    if (JSON.stringify(currentSpeakerOptions) !== JSON.stringify(normalizedSpeakerOptions)) {
      user.speakerOptions = normalizedSpeakerOptions;
      hasChanges = true;
    }
  }

  if (agentVideoModel && user.agentVideoModel !== agentVideoModel) {

    user.agentVideoModel = agentVideoModel;
    hasChanges = true;
  }

  if (
    agentVideoModelAuthorization &&
    ['native', 'deployed'].includes(agentVideoModelAuthorization) &&
    user.agentVideoModelAuthorization !== agentVideoModelAuthorization
  ) {
    user.agentVideoModelAuthorization = agentVideoModelAuthorization;
    hasChanges = true;
  }

  if (agentImageModel && user.agentImageModel !== agentImageModel) {
    user.agentImageModel = agentImageModel;
    hasChanges = true;
  }

  if (
    agentImageModelAuthorization &&
    ['native', 'deployed'].includes(agentImageModelAuthorization) &&
    user.agentImageModelAuthorization !== agentImageModelAuthorization
  ) {
    user.agentImageModelAuthorization = agentImageModelAuthorization;
    hasChanges = true;
  }
  
  if (agentSoundEffectModel && user.agentSoundEffectModel !== agentSoundEffectModel) {
    user.agentSoundEffectModel = agentSoundEffectModel;
    hasChanges = true;
  }

  if (
    agentSoundEffectModelAuthorization &&
    ['native', 'deployed'].includes(agentSoundEffectModelAuthorization) &&
    user.agentSoundEffectModelAuthorization !== agentSoundEffectModelAuthorization
  ) {
    user.agentSoundEffectModelAuthorization = agentSoundEffectModelAuthorization;
    hasChanges = true;
  }
  

  if (defaultAgentDuration && user.defaultAgentDuration !== defaultAgentDuration) {
    user.defaultAgentDuration = defaultAgentDuration;
    hasChanges = true;
  }

  if (preferredLanguage && isSupportedLanguage(preferredLanguage) && user.preferredLanguage !== preferredLanguage.toLowerCase()) {
    user.preferredLanguage = preferredLanguage.toLowerCase();
    hasChanges = true;
  }

  if (videoFramesPerSecond !== undefined) {
    const parsedFps = Number(videoFramesPerSecond);
    if (
      Number.isFinite(parsedFps) &&
      (parsedFps === 16 || parsedFps === 24 || parsedFps === 30) &&
      user.videoFramesPerSecond !== parsedFps
    ) {
      user.videoFramesPerSecond = parsedFps;
      hasChanges = true;
    }
  }

  if (hasCustomAdaptersPayload) {
    const rawCustomAdapters = Object.prototype.hasOwnProperty.call(payload, 'custom_adapters')
      ? custom_adapters
      : customAdapters;
    const currentCustomAdapters = user.custom_adapters
      ? JSON.parse(JSON.stringify(user.custom_adapters))
      : null;
    const normalizedCustomAdapters = normalizeCustomAdaptersPayload(rawCustomAdapters, currentCustomAdapters);

    if (JSON.stringify(currentCustomAdapters) !== JSON.stringify(normalizedCustomAdapters)) {
      user.custom_adapters = normalizedCustomAdapters;
      hasChanges = true;
    }
  }

  

  // Save changes if necessary
  if (hasChanges) {
    await user.save();
  }

  return user;
}

export async function updateUserPreferredLanguage(userId, preferredLanguage) {
  await getDBConnectionString();
  const user = await User.findOne({ _id: userId });
  if (!user) {
    throw new Error('User not found');
  }

  if (!isSupportedLanguage(preferredLanguage)) {
    throw new Error('Unsupported language code');
  }

  const normalized = preferredLanguage.toLowerCase();
  if (user.preferredLanguage !== normalized) {
    user.preferredLanguage = normalized;
    await user.save();
  }

  return user;
}


const normalizeUserGenerationPrefix = () => {
  if (!USER_GENERATION_PREFIX) return '';
  return USER_GENERATION_PREFIX.endsWith('/')
    ? USER_GENERATION_PREFIX.slice(0, -1)
    : USER_GENERATION_PREFIX;
};

async function deleteUserS3Generations(userId) {
  const prefixBase = normalizeUserGenerationPrefix();
  if (!prefixBase) {
    return;
  }

  const prefix = `${prefixBase}/${userId}/`;
  try {
    await deleteObjectsWithPrefix({
      bucketName: USER_GENERATION_BUCKET,
      prefix,
    });
  } catch (err) {
    console.error('[deleteGenerations] Failed to delete user S3 assets', {
      userId,
      bucket: USER_GENERATION_BUCKET,
      prefix,
      error: err?.message,
    });
    throw new Error('Unable to delete user generations from storage');
  }
}

async function getUserOrThrow(userId) {
  await getDBConnectionString();
  const user = await User.findOne({ _id: userId });
  if (!user) {
    throw new Error('User not found');
  }
  return user;
}

export async function deleteUser(userId) {
  const user = await getUserOrThrow(userId);

  if (user.isPremiumUser) {
    // cancel premium membership before deleting the user
    await cancelSubscription(userId);
  }

  await deleteProjects(userId);
  await deleteGenerations(userId);

  // Delete the user
  await User.deleteOne({ _id: userId });
}

export async function deleteProjects(userId) {
  await getUserOrThrow(userId);

  const { deleteVideoSessionsForUser } = await import('./VideoSession.js');

  // Delete the user's projects
  await Promise.all([
    deleteVideoSessionsForUser(userId),
    deleteGlobalSessionsForUser(userId),
  ]);

  // Return success message
  return { message: 'Projects deleted successfully' };
}

export async function deleteGenerations(userId) {
  await getUserOrThrow(userId);

  // Delete the user's generations from databases
  await Promise.all([
    GeneratedImage.deleteMany({ userId }),
    GeneratedMusic.deleteMany({ userId }),
    GeneratedAIVideo.deleteMany({ userId }),
    ImageGeneration.deleteMany({ userId }),
  ]);

  // Delete user-tagged S3 assets
  await deleteUserS3Generations(userId);

  // Return success message
  return { message: 'Generations deleted successfully' };
}



function toMongoObjectId(value) {
  const normalized = value?.toString?.();
  return normalized && mongoose.Types.ObjectId.isValid(normalized)
    ? new mongoose.Types.ObjectId(normalized)
    : value;
}

function getFirstDefinedValue(...values) {
  return values.find((value) => value !== undefined);
}

export function normalizeAPIKeyUsageLimitInput(payload = {}) {
  const usageLimit = getFirstDefinedValue(
    payload.usageLimit,
    payload.usage_limit,
    payload.creditLimit,
    payload.credit_limit,
    payload.limit,
  );
  const usageLimitPeriod = getFirstDefinedValue(
    payload.usageLimitPeriod,
    payload.usage_limit_period,
    payload.usageLimitType,
    payload.usage_limit_type,
    payload.limitPeriod,
    payload.limit_period,
  );

  const normalizedPeriod = typeof usageLimitPeriod === 'string'
    ? usageLimitPeriod.trim().toLowerCase()
    : usageLimitPeriod;
  const clearsLimit =
    usageLimit === null ||
    usageLimit === '' ||
    ['none', 'no_limit', 'unlimited', null].includes(normalizedPeriod);

  if (usageLimit === undefined && usageLimitPeriod === undefined) {
    return {
      usageLimit: null,
      usageLimitPeriod: null,
    };
  }

  if (clearsLimit) {
    return {
      usageLimit: null,
      usageLimitPeriod: null,
    };
  }

  if (!Object.values(API_KEY_USAGE_LIMIT_PERIODS).includes(normalizedPeriod)) {
    const error = new Error('API key usage limit period must be monthly, total, or none.');
    error.status = 400;
    throw error;
  }

  const numericLimit = Number(usageLimit);
  if (!Number.isFinite(numericLimit) || numericLimit <= 0) {
    const error = new Error('API key usage limit must be a positive credit amount.');
    error.status = 400;
    throw error;
  }

  return {
    usageLimit: numericLimit,
    usageLimitPeriod: normalizedPeriod,
  };
}

function normalizeAPIKeyUsageLimitFields(apiKey = {}) {
  const usageLimit = Number(apiKey.usageLimit);
  const usageLimitPeriod =
    typeof apiKey.usageLimitPeriod === 'string'
      ? apiKey.usageLimitPeriod.trim().toLowerCase()
      : null;

  if (
    !Number.isFinite(usageLimit) ||
    usageLimit <= 0 ||
    !Object.values(API_KEY_USAGE_LIMIT_PERIODS).includes(usageLimitPeriod)
  ) {
    return {
      usageLimit: null,
      usageLimitPeriod: null,
    };
  }

  return {
    usageLimit,
    usageLimitPeriod,
  };
}

function getCurrentMonthStart() {
  return dayjs().startOf('month').toDate();
}

async function getAPIKeyUsageSummaries(userId, apiKeys = []) {
  const keyIds = apiKeys
    .map((apiKey) => apiKey?._id?.toString?.())
    .filter(Boolean);

  if (keyIds.length === 0) {
    return new Map();
  }

  const userObjectId = toMongoObjectId(userId);
  const keyObjectIds = keyIds.map(toMongoObjectId);
  const monthStart = getCurrentMonthStart();

  const [totalUsage, monthlyUsage] = await Promise.all([
    GenerationCreditTransaction.aggregate([
      {
        $match: {
          userId: userObjectId,
          apiKeyId: { $in: keyObjectIds },
          direction: 'debit',
        },
      },
      {
        $group: {
          _id: '$apiKeyId',
          total: { $sum: '$amount' },
        },
      },
    ]),
    GenerationCreditTransaction.aggregate([
      {
        $match: {
          userId: userObjectId,
          apiKeyId: { $in: keyObjectIds },
          direction: 'debit',
          createdAt: { $gte: monthStart },
        },
      },
      {
        $group: {
          _id: '$apiKeyId',
          total: { $sum: '$amount' },
        },
      },
    ]),
  ]);

  const usageByKey = new Map();
  for (const keyId of keyIds) {
    usageByKey.set(keyId, {
      totalCreditsUsed: 0,
      monthlyCreditsUsed: 0,
    });
  }

  for (const row of totalUsage) {
    const keyId = row?._id?.toString?.();
    if (!keyId) continue;
    usageByKey.set(keyId, {
      ...(usageByKey.get(keyId) || {}),
      totalCreditsUsed: Math.max(0, Number(row.total) || 0),
    });
  }

  for (const row of monthlyUsage) {
    const keyId = row?._id?.toString?.();
    if (!keyId) continue;
    usageByKey.set(keyId, {
      ...(usageByKey.get(keyId) || {}),
      monthlyCreditsUsed: Math.max(0, Number(row.total) || 0),
    });
  }

  return usageByKey;
}

function formatAPIKeyForClient(apiKey, usageSummary = {}) {
  const keyObject = typeof apiKey?.toObject === 'function'
    ? apiKey.toObject()
    : { ...(apiKey || {}) };
  const keyId = keyObject?._id?.toString?.() || keyObject?._id;
  const normalizedLimit = normalizeAPIKeyUsageLimitFields(keyObject);
  const totalCreditsUsed = Math.max(0, Number(usageSummary.totalCreditsUsed) || 0);
  const monthlyCreditsUsed = Math.max(0, Number(usageSummary.monthlyCreditsUsed) || 0);
  const currentPeriodCreditsUsed = normalizedLimit.usageLimitPeriod === API_KEY_USAGE_LIMIT_PERIODS.MONTHLY
    ? monthlyCreditsUsed
    : totalCreditsUsed;
  const remainingCredits = normalizedLimit.usageLimit
    ? Math.max(0, normalizedLimit.usageLimit - currentPeriodCreditsUsed)
    : null;

  return {
    ...keyObject,
    _id: keyId,
    ...normalizedLimit,
    usage: {
      totalCreditsUsed,
      monthlyCreditsUsed,
      currentPeriodCreditsUsed,
      remainingCredits,
    },
  };
}

export async function getAPIKeyAuthContextFromAPIKey(API_KEY) {
  await getDBConnectionString();

  if (API_KEY === null || API_KEY === undefined || API_KEY === '') {
    return null;
  }

  // API keys are opaque credentials. Do not require the current prefix here so
  // legacy 40-character keys continue to authenticate after format changes.
  const userData = await User.findOne(
    { 'userApiKeys.apiKey': API_KEY },
    '_id userApiKeys'
  );

  if (!userData) {
    return null;
  }

  const matchingApiKey = userData.userApiKeys?.find((item) => item.apiKey === API_KEY);
  if (!matchingApiKey) {
    return null;
  }

  if (matchingApiKey.expiresAt && !dayjs(matchingApiKey.expiresAt).isAfter(dayjs())) {
    const error = new Error('Your api key has expired, please generate a new api key.');
    error.code = 'API_KEY_EXPIRED';
    throw error;
  }

  const userId = userData._id?.toString();
  if (!userId) {
    return null;
  }

  const normalizedLimit = normalizeAPIKeyUsageLimitFields(matchingApiKey);

  return {
    userId,
    apiKeyId: matchingApiKey._id?.toString?.() || null,
    apiKeyUsageLimit: normalizedLimit.usageLimit,
    apiKeyUsageLimitPeriod: normalizedLimit.usageLimitPeriod,
  };
}

export async function getUserIdFromAPIKey(API_KEY) {
  const apiKeyContext = await getAPIKeyAuthContextFromAPIKey(API_KEY);
  return apiKeyContext?.userId || null;
}


// src/controllers/UserController.js

export async function getAPIKeysForUser(userId) {
  await getDBConnectionString();
  const userData = await User.findOne({ _id: userId }, 'userApiKeys');
  if (!userData) {
    return [];
  }

  const apiKeys = userData.userApiKeys || [];
  const usageByKey = await getAPIKeyUsageSummaries(userId, apiKeys);

  return apiKeys.map((apiKey) => {
    const keyId = apiKey?._id?.toString?.();
    return formatAPIKeyForClient(apiKey, usageByKey.get(keyId));
  });
}



export async function createAPIKeyForUser(userId, expiresAt = null, usageLimitPayload = {}) {
  await getDBConnectionString();
  const userData = await User.findOne({ _id: userId });
  if (!userData) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const normalizedExpiryInput = typeof expiresAt === 'string'
    ? expiresAt.trim().toLowerCase()
    : expiresAt;

  let resolvedExpiryDate = null;
  if (normalizedExpiryInput && normalizedExpiryInput !== 'never') {
    const parsedExpiryDate = dayjs(expiresAt);
    if (!parsedExpiryDate.isValid()) {
      throw new Error('Invalid API key expiry date.');
    }
    resolvedExpiryDate = parsedExpiryDate.toDate();
  }

  const newAPIKeyString = generateAPIKey();
  const normalizedUsageLimit = normalizeAPIKeyUsageLimitInput(usageLimitPayload);
  const newAPIKey = {
    apiKey: newAPIKeyString,
    expiresAt: resolvedExpiryDate,
    userId: userId,
    usageLimit: normalizedUsageLimit.usageLimit,
    usageLimitPeriod: normalizedUsageLimit.usageLimitPeriod,
  };

  userData.userApiKeys.push(newAPIKey);
  await userData.save();

  // Return the newly created API key subdocument
  const createdKey = userData.userApiKeys[userData.userApiKeys.length - 1];

  return formatAPIKeyForClient(createdKey);
}

export async function updateUserAPIKeyLimit(userId, keyId, usageLimitPayload = {}) {
  await getDBConnectionString();
  const userData = await User.findOne({ _id: userId, 'userApiKeys._id': keyId });
  if (!userData) {
    const error = new Error('API key not found.');
    error.status = 404;
    throw error;
  }

  const apiKey = userData.userApiKeys.id(keyId);
  if (!apiKey) {
    const error = new Error('API key not found.');
    error.status = 404;
    throw error;
  }

  const normalizedUsageLimit = normalizeAPIKeyUsageLimitInput(usageLimitPayload);
  apiKey.usageLimit = normalizedUsageLimit.usageLimit;
  apiKey.usageLimitPeriod = normalizedUsageLimit.usageLimitPeriod;

  await userData.save();

  const usageByKey = await getAPIKeyUsageSummaries(userId, [apiKey]);
  return formatAPIKeyForClient(apiKey, usageByKey.get(apiKey._id?.toString?.()));
}


export async function deleteUserAPIKey(userId, keyId) {
  await getDBConnectionString();
  const userData = await User.findOne({ _id: userId });

  // Remove the API key with matching _id
  userData.userApiKeys.pull({ _id: keyId });

  await userData.save();
}

// src/controllers/UserController.js

export async function deleteAllAPIKeysForUser(userId) {
  await getDBConnectionString();
  const userData = await User.findOne({ _id: userId });
  userData.userApiKeys = [];  // Clear the array
  await userData.save();
}

export async function startFreeTrial(userId) {
  await getDBConnectionString();
  const userData = await User.findOne({ _id: userId });


  if (userData.hasFreeTrialClaimed) {
    throw new Error('User has already used the free trial');
  }



  const freeTrialEndDate = dayjs().add(15, 'days').toDate();


  const paymentSessionData = await createPaymentPlanWithFreeTrial(userId, freeTrialEndDate);

  return paymentSessionData;
}

export async function getAppUserDetails(userId) {
  await getDBConnectionString();
  const userData
    = await User.findOne({
      _id: userId
    });

  let userResponse = userData.toObject();
  const reponseData = {
    createdBy: userResponse._id,
    email: userResponse.email,
    isPremiumUser: userResponse.isPremiumUser,
    isEmailVerified: userResponse.isEmailVerified,
    creatorHandle: userResponse.username,
    userPreferenceTags: userResponse.userPreferenceTags,
    preferenceTagsAdded: userResponse.preferenceTagsAdded,
  }

  return reponseData;
}

export async function updateAppUserPreferences(userId, payload) {


  const tags = payload;
  let tagMap;
  try {
    tagMap = payload.map(function (tag) {
      return tag.toLowerCase().trim();
    });

  } catch (error) {
    throw new Error('Invalid tags provided');
  }

  await getDBConnectionString();
  let user = await User.findOne({ _id: userId });

  user.preferenceTagsAdded = true;
  user.userPreferenceTags = tagMap;

  await user.save();

  return user;


}



export async function createTempUser(email, stripePaymentId) {
  await getDBConnectionString();
  let newUser = new User({
    email: email,
    stripePaymentId: stripePaymentId,
    isPremiumUser: false,
    hasFreeTrialClaimed: false,
    generationCredits: 0,
    userApiKeys: [],
    isTempUser: true,
  });


  const savedUser = await newUser.save();
  return savedUser;
  
}


export async function getOrCreateAdminFallbackUser() {
  await getDBConnectionString();

  let user = await User.findOne({ username: 'admin' });

  if (!user) {
    const hashedPassword = await bcrypt.hash('admin', 10);

    user = new User({
      username: 'admin',
      email: 'admin@local.machine',
      password: hashedPassword,
      isEmailVerified: true,
      isPremiumUser: true,
      generationCredits: 100000,
      hasFreeTrialClaimed: true,
      userApiKeys: [],
      role: 'admin',
    });

    await user.save();
  } else {
    let needsSave = false;
    if (!user.isEmailVerified) {
      user.isEmailVerified = true;
      needsSave = true;
    }
    if (!user.isPremiumUser) {
      user.isPremiumUser = true;
      needsSave = true;
    }
    if ((Number(user.generationCredits) || 0) < 100000) {
      user.generationCredits = 100000;
      needsSave = true;
    }
    if (!user.hasFreeTrialClaimed) {
      user.hasFreeTrialClaimed = true;
      needsSave = true;
    }
    if (needsSave) {
      await user.save();
    }
  }

  await ensureDefaultTextModelsForUser(user);
  const authToken = generateAuthToken(user._id.toString());
  return formatUserClientProfile(user, { authToken });
}

function normalizeDockerAdminEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function buildUsernameFromAdminEmail(email) {
  const localPart = email.split('@')[0] || 'admin';
  const normalized = localPart
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return normalized || 'admin';
}

export async function bootstrapDockerAdminUser(payload = {}) {
  if (!isSetupAdminBootstrapEnabled()) {
    throw new Error('Admin bootstrap is only available in standalone deployments.');
  }

  const email = normalizeDockerAdminEmail(payload.email);
  const password = typeof payload.password === 'string' ? payload.password : '';
  const organizationName = typeof payload.organizationName === 'string' ? payload.organizationName.trim() : '';

  if (!email || !email.includes('@')) {
    throw new Error('A valid admin email is required.');
  }
  if (!password || password.length < 8) {
    throw new Error('Admin password must be at least 8 characters.');
  }

  await getDBConnectionString();

  const hashedPassword = await bcrypt.hash(password, 10);
  let user = await User.findOne({ email });
  const now = new Date();

  if (!user) {
    user = new User({
      email,
      username: buildUsernameFromAdminEmail(email),
      displayName: organizationName ? `${organizationName} Admin` : 'Samsar Admin',
      password: hashedPassword,
      isEmailVerified: true,
      isAdminUser: true,
      isPremiumUser: true,
      generationCredits: 100000,
      hasFreeTrialClaimed: true,
      selectedNotifyOnCompletion: process.env.SAMSAR_MAIL_CONFIGURED === 'true',
      userApiKeys: [],
    });
  } else {
    user.password = hashedPassword;
    user.username = user.username || buildUsernameFromAdminEmail(email);
    user.displayName = user.displayName || (organizationName ? `${organizationName} Admin` : 'Samsar Admin');
    user.isEmailVerified = true;
    user.isAdminUser = true;
    user.isPremiumUser = true;
    user.generationCredits = Math.max(Number(user.generationCredits) || 0, 100000);
    user.hasFreeTrialClaimed = true;
    if (process.env.SAMSAR_MAIL_CONFIGURED === 'true') {
      user.selectedNotifyOnCompletion = true;
    }
  }

  user.dockerAdminBootstrappedAt = now;
  user.dockerAdminOrganizationName = organizationName;

  await user.save();
  await ensureDefaultTextModelsForUser(user);
  return user;
}
