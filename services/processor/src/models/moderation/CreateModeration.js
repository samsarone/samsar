import OpenAI from "openai";

import { isGeminiInferenceModel } from "../../consts/InferenceModels.js";
import { createGoogleModerationForNarrative } from "./GoogleModeration.js";

export const MODERATION_PROVIDERS = Object.freeze({
  OPENAI: "openai",
  GOOGLE: "google",
  DISABLED: "disabled",
});

const OPENAI_API_KEY = typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "";
const OPENAI_MODERATION_MODEL = process.env.OPENAI_MODERATION_MODEL || "omni-moderation-latest";
const DEFAULT_MODERATION_REJECT_SCORE_THRESHOLD = 0.65;
const OPENAI_MODERATION_REJECT_SCORE_THRESHOLD = parseModerationScoreThreshold(
  process.env.OPENAI_MODERATION_REJECT_SCORE_THRESHOLD ||
  process.env.MODERATION_REJECT_SCORE_THRESHOLD,
  DEFAULT_MODERATION_REJECT_SCORE_THRESHOLD,
);
const GOOGLE_MODERATION_REJECT_SCORE_THRESHOLD = parseModerationScoreThreshold(
  process.env.GOOGLE_MODERATION_REJECT_SCORE_THRESHOLD ||
  process.env.MODERATION_REJECT_SCORE_THRESHOLD,
  DEFAULT_MODERATION_REJECT_SCORE_THRESHOLD,
);


const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
const missingProviderWarningLogged = new Set();

function parseModerationScoreThreshold(value, fallback) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, parsed));
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProviderName(value) {
  const normalized = normalizeString(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (!normalized) {
    return "";
  }

  if (normalized === "openai") {
    return MODERATION_PROVIDERS.OPENAI;
  }

  if (
    normalized === "google" ||
    normalized === "googlecloud" ||
    normalized === "gcp" ||
    normalized === "vertex" ||
    normalized === "vertexai"
  ) {
    return MODERATION_PROVIDERS.GOOGLE;
  }

  if (["disabled", "disable", "none", "off", "skip"].includes(normalized)) {
    return MODERATION_PROVIDERS.DISABLED;
  }

  return "";
}

function getModerationRejectScoreThreshold(provider) {
  const normalizedProvider = normalizeProviderName(provider);
  if (normalizedProvider === MODERATION_PROVIDERS.GOOGLE) {
    return GOOGLE_MODERATION_REJECT_SCORE_THRESHOLD;
  }
  return OPENAI_MODERATION_REJECT_SCORE_THRESHOLD;
}

function normalizeDeploymentProviderName(value) {
  const normalized = normalizeProviderName(value);
  if (normalized) {
    return normalized;
  }

  const compact = normalizeString(value).toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "samsar" || compact === "samsarapikey" || compact === "deployed") {
    return "samsar";
  }
  if (compact === "fal") {
    return "fal";
  }
  if (compact === "runway" || compact === "runwayml") {
    return "runway";
  }

  return "";
}

function parseProviderList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  const normalized = normalizeString(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[,\s]+/)
    .map(normalizeString)
    .filter(Boolean);
}

function getExplicitModerationProvider(env = process.env) {
  return normalizeProviderName(
    env.SAMSAR_MODERATION_PROVIDER ||
    env.MODERATION_PROVIDER ||
    env.CONTENT_MODERATION_PROVIDER
  );
}

function getConfiguredDeploymentProviders({ env = process.env, availableModelConfig = null } = {}) {
  const envProviders = parseProviderList(
    env.SAMSAR_DEPLOYMENT_PROVIDERS ||
    env.DEPLOYMENT_PROVIDERS ||
    env.SAMSAR_MODEL_PROVIDERS
  );
  const providers = envProviders.length > 0
    ? envProviders
    : parseProviderList(availableModelConfig?.providers);

  return [
    ...new Set(
      providers
        .map(normalizeDeploymentProviderName)
        .filter(Boolean)
    ),
  ];
}

export function isGoogleOnlyDeploymentProviderConfig({ env = process.env, availableModelConfig = null } = {}) {
  const providers = getConfiguredDeploymentProviders({ env, availableModelConfig });
  return providers.length === 1 && providers[0] === MODERATION_PROVIDERS.GOOGLE;
}

function isTextToVideoModerationRoute(routeType) {
  const normalized = normalizeString(routeType).toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "text_to_video" || normalized === "t2v" || normalized === "vidgpt";
}

export function shouldUseGoogleModerationForInferenceContext({
  inferenceModel = null,
  routeType = null,
} = {}) {
  return isTextToVideoModerationRoute(routeType) && isGeminiInferenceModel(inferenceModel);
}

export function resolveModerationProvider({
  env = process.env,
  availableModelConfig = undefined,
  inferenceModel = null,
  routeType = null,
} = {}) {
  const explicitProvider = getExplicitModerationProvider(env);
  const useGoogleForInferenceContext = shouldUseGoogleModerationForInferenceContext({
    inferenceModel,
    routeType,
  });

  if (explicitProvider === MODERATION_PROVIDERS.GOOGLE) {
    return useGoogleForInferenceContext
      ? MODERATION_PROVIDERS.GOOGLE
      : MODERATION_PROVIDERS.OPENAI;
  }

  if (explicitProvider) {
    return explicitProvider;
  }

  if (useGoogleForInferenceContext) {
    return MODERATION_PROVIDERS.GOOGLE;
  }

  return MODERATION_PROVIDERS.OPENAI;
}

function warnMissingProviderOnce(provider, message) {
  if (missingProviderWarningLogged.has(provider)) {
    return;
  }
  missingProviderWarningLogged.add(provider);
}

export function getModerationDecision(moderationResult, options = {}) {
  if (!moderationResult) {
    return { safe: false, reason: "missing_result" };
  }
  const rejectScoreThreshold = getModerationRejectScoreThreshold(options.provider);

  const categories = moderationResult.categories || {};
  const flaggedCategories = Object
    .entries(categories)
    .filter(([, flagged]) => flagged === true)
    .map(([category]) => category);

  if (moderationResult.flagged === true || flaggedCategories.length > 0) {
    return {
      safe: false,
      reason: "flagged",
      categories: flaggedCategories,
    };
  }

  const categoryScores = moderationResult.category_scores || {};
  const highScoreCategories = Object
    .entries(categoryScores)
    .filter(([, score]) => {
      const normalizedScore = Number(score);
      return (
        Number.isFinite(normalizedScore) &&
        normalizedScore >= rejectScoreThreshold
      );
    })
    .map(([category]) => category);

  if (highScoreCategories.length > 0) {
    return {
      safe: false,
      reason: "category_score",
      categories: highScoreCategories,
      threshold: rejectScoreThreshold,
    };
  }

  return { safe: true, reason: "passed" };
}


export async function createModerationForImage() {

}

export async function createModerationForVideo() {

}

async function createModerationWithOpenAI(requestData) {
  if (!openai) {
    warnMissingProviderOnce(
      MODERATION_PROVIDERS.OPENAI,
      "OPENAI_API_KEY is not set; skipping native moderation check.",
    );
    return null;
  }

  return openai.moderations.create({
    input: requestData,
    model: OPENAI_MODERATION_MODEL,
  });
}

async function createModerationWithProvider(provider, requestData, options = {}) {
  if (provider === MODERATION_PROVIDERS.GOOGLE) {
    return createGoogleModerationForNarrative(requestData, options);
  }

  if (provider === MODERATION_PROVIDERS.DISABLED) {
    return null;
  }

  return createModerationWithOpenAI(requestData);
}

export async function getModerationForNarrative(requestData, options = {}) {

  let isContentSafe = true;
  const provider = resolveModerationProvider(options);

  if (provider === MODERATION_PROVIDERS.DISABLED) {
    warnMissingProviderOnce(
      MODERATION_PROVIDERS.DISABLED,
      "Native moderation is disabled by configuration.",
    );
    return isContentSafe;
  }

  try {
    const moderation = await createModerationWithProvider(provider, requestData, options);
    const moderationResult = moderation?.results?.[0];
    if (!moderationResult) {
      return isContentSafe;
    }
    const moderationDecision = getModerationDecision(moderationResult, { provider });


    if (!moderationDecision.safe) {
      isContentSafe = false;
    }

  } catch (error) {
    console.error("ERROR IN MODERATION", {
      provider,
      message: error?.message || error,
      status: error?.status || error?.response?.status || null,
    });
  }

  return isContentSafe;
}
