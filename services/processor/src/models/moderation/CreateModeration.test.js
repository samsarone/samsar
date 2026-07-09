import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || "test";
process.env.OPENAI_MODERATION_REJECT_SCORE_THRESHOLD = "0.65";
process.env.GOOGLE_MODERATION_REJECT_SCORE_THRESHOLD = "0.7";

const {
  MODERATION_PROVIDERS,
  getModerationDecision,
  isGoogleOnlyDeploymentProviderConfig,
  resolveModerationProvider,
  shouldUseGoogleModerationForInferenceContext,
} = await import("./CreateModeration.js");

test("getModerationDecision rejects flagged moderation results", () => {
  assert.deepEqual(getModerationDecision({
    flagged: true,
    categories: {
      violence: true,
    },
    category_scores: {
      violence: 0.99,
    },
  }), {
    safe: false,
    reason: "flagged",
    categories: ["violence"],
  });
});

test("getModerationDecision rejects high category scores before the API flag threshold", () => {
  assert.deepEqual(getModerationDecision({
    flagged: false,
    categories: {
      violence: false,
    },
    category_scores: {
      violence: 0.66,
    },
  }), {
    safe: false,
    reason: "category_score",
    categories: ["violence"],
    threshold: 0.65,
  });
});

test("getModerationDecision allows category scores below the adjusted threshold", () => {
  assert.deepEqual(getModerationDecision({
    flagged: false,
    categories: {
      violence: false,
    },
    category_scores: {
      violence: 0.64,
    },
  }), {
    safe: true,
    reason: "passed",
  });
});

test("getModerationDecision uses the Google moderation score threshold", () => {
  assert.deepEqual(getModerationDecision({
    flagged: false,
    categories: {
      violence: false,
    },
    category_scores: {
      violence: 0.66,
    },
  }, { provider: MODERATION_PROVIDERS.GOOGLE }), {
    safe: true,
    reason: "passed",
  });

  assert.deepEqual(getModerationDecision({
    flagged: false,
    categories: {
      violence: false,
    },
    category_scores: {
      violence: 0.71,
    },
  }, { provider: MODERATION_PROVIDERS.GOOGLE }), {
    safe: false,
    reason: "category_score",
    categories: ["violence"],
    threshold: 0.7,
  });
});

test("getModerationDecision allows clean moderation results", () => {
  assert.deepEqual(getModerationDecision({
    flagged: false,
    categories: {
      violence: false,
    },
    category_scores: {
      violence: 0.01,
    },
  }), {
    safe: true,
    reason: "passed",
  });
});

test("resolveModerationProvider defaults to OpenAI outside docker", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "production",
    },
    availableModelConfig: {
      providers: ["googleCloud"],
    },
  }), MODERATION_PROVIDERS.OPENAI);
});

test("resolveModerationProvider keeps OpenAI for docker google-only provider config without Gemini inference", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
    },
    availableModelConfig: {
      providers: ["googleCloud"],
    },
  }), MODERATION_PROVIDERS.OPENAI);
});

test("resolveModerationProvider uses Google for production Gemini text-to-video prompts", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "production",
    },
    availableModelConfig: {
      providers: ["openai"],
    },
    inferenceModel: "gemini-3.1-pro",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.GOOGLE);
});

test("resolveModerationProvider uses Google for docker google-only Gemini text-to-video prompts", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
    },
    availableModelConfig: {
      providers: ["googleCloud"],
    },
    inferenceModel: "gemini-3.1-pro",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.GOOGLE);
});

test("resolveModerationProvider keeps OpenAI for GPT 5.5 text-to-video prompts", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "production",
    },
    availableModelConfig: {
      providers: ["googleCloud"],
    },
    inferenceModel: "gpt-5.5",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.OPENAI);

  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
    },
    availableModelConfig: {
      providers: ["googleCloud"],
    },
    inferenceModel: "gpt-5.5",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.OPENAI);
});

test("resolveModerationProvider keeps OpenAI for Gemini prompts outside text-to-video", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "production",
    },
    availableModelConfig: {
      providers: ["openai"],
    },
    inferenceModel: "gemini-3.1-pro",
    routeType: "image_list_to_video",
  }), MODERATION_PROVIDERS.OPENAI);
});

test("resolveModerationProvider keeps OpenAI when docker config includes another provider", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
    },
    availableModelConfig: {
      providers: ["googleCloud", "openai"],
    },
  }), MODERATION_PROVIDERS.OPENAI);
});

test("resolveModerationProvider honors explicit Google provider for Gemini text-to-video context", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "production",
      SAMSAR_MODERATION_PROVIDER: "google_cloud",
    },
    availableModelConfig: {
      providers: ["openai"],
    },
    inferenceModel: "gemini-3.1-pro",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.GOOGLE);
});

test("resolveModerationProvider does not let explicit Google provider force GPT moderation to Vertex", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "production",
      SAMSAR_MODERATION_PROVIDER: "google_cloud",
    },
    inferenceModel: "gpt-5.5",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.OPENAI);
});

test("resolveModerationProvider honors explicit OpenAI provider over Gemini text-to-video context", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "production",
      SAMSAR_MODERATION_PROVIDER: "openai",
    },
    availableModelConfig: {
      providers: ["googleCloud"],
    },
    inferenceModel: "gemini-3.1-pro",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.OPENAI);
});

test("isGoogleOnlyDeploymentProviderConfig accepts environment provider lists", () => {
  assert.equal(isGoogleOnlyDeploymentProviderConfig({
    env: {
      SAMSAR_DEPLOYMENT_PROVIDERS: "google_cloud",
    },
  }), true);
});

test("shouldUseGoogleModerationForInferenceContext recognizes Gemini text-to-video aliases", () => {
  assert.equal(shouldUseGoogleModerationForInferenceContext({
    inferenceModel: "gemini-3-pro-preview",
    routeType: "T2V",
  }), true);
});
