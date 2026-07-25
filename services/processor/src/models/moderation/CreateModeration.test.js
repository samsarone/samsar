import assert from "node:assert/strict";
import test from "node:test";

process.env.OPENAI_MODERATION_REJECT_SCORE_THRESHOLD = "0.65";
process.env.GOOGLE_MODERATION_REJECT_SCORE_THRESHOLD = "0.7";

const {
  MODERATION_PROVIDERS,
  createNativeOpenAIModeration,
  getModerationDecision,
  getModerationForNarrative,
  getModerationResponseDecision,
  hasGoogleModerationCredential,
  isGoogleOnlyDeploymentProviderConfig,
  resolveModerationProvider,
  runModerationWithRetry,
  shouldUseGoogleModerationForInferenceContext,
} = await import("./CreateModeration.js");

const GOOGLE_CREDENTIALS_B64 = Buffer.from(JSON.stringify({
  type: "service_account",
  project_id: "docker-project",
  client_email: "moderation@example.invalid",
  private_key: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n",
})).toString("base64");

test("getModerationDecision rejects flagged moderation results", () => {
  assert.deepEqual(getModerationDecision({
    flagged: true,
    categories: { violence: true },
    category_scores: { violence: 0.99 },
  }), {
    safe: false,
    reason: "flagged",
    categories: ["violence"],
  });
});

test("narrative moderation allows broad non-graphic fantasy violence below the relaxed threshold", () => {
  assert.deepEqual(getModerationDecision({
    flagged: true,
    categories: {
      violence: true,
      "violence/graphic": false,
    },
    category_scores: {
      violence: 0.82,
      "violence/graphic": 0.08,
    },
  }, {
    provider: MODERATION_PROVIDERS.OPENAI,
    moderationContext: "narrative",
  }), {
    safe: true,
    reason: "passed_non_graphic_narrative_violence",
  });
});

test("narrative moderation still rejects graphic violence and extreme broad violence", () => {
  assert.deepEqual(getModerationDecision({
    flagged: true,
    categories: {
      violence: true,
      "violence/graphic": true,
    },
    category_scores: {
      violence: 0.82,
      "violence/graphic": 0.72,
    },
  }, {
    provider: MODERATION_PROVIDERS.OPENAI,
    moderationContext: "narrative",
  }), {
    safe: false,
    reason: "flagged",
    categories: ["violence/graphic"],
  });

  assert.deepEqual(getModerationDecision({
    flagged: true,
    categories: { violence: true },
    category_scores: { violence: 0.94 },
  }, {
    provider: MODERATION_PROVIDERS.OPENAI,
    moderationContext: "narrative",
  }), {
    safe: false,
    reason: "flagged",
    categories: ["violence"],
  });
});

test("narrative moderation never relaxes non-violence categories", () => {
  assert.deepEqual(getModerationDecision({
    flagged: true,
    categories: {
      violence: true,
      "self-harm": true,
    },
    category_scores: {
      violence: 0.8,
      "self-harm": 0.7,
    },
  }, {
    provider: MODERATION_PROVIDERS.OPENAI,
    moderationContext: "narrative",
  }), {
    safe: false,
    reason: "flagged",
    categories: ["self-harm"],
  });
});

test("getModerationDecision rejects high category scores before the API flag threshold", () => {
  assert.deepEqual(getModerationDecision({
    flagged: false,
    categories: { violence: false },
    category_scores: { violence: 0.66 },
  }), {
    safe: false,
    reason: "category_score",
    categories: ["violence"],
    threshold: 0.65,
  });
});

test("getModerationDecision uses the Google moderation score threshold", () => {
  assert.deepEqual(getModerationDecision({
    flagged: false,
    categories: { violence: false },
    category_scores: { violence: 0.66 },
  }, { provider: MODERATION_PROVIDERS.GOOGLE }), {
    safe: true,
    reason: "passed",
  });

  assert.deepEqual(getModerationDecision({
    flagged: false,
    categories: { violence: false },
    category_scores: { violence: 0.71 },
  }, { provider: MODERATION_PROVIDERS.GOOGLE }), {
    safe: false,
    reason: "category_score",
    categories: ["violence"],
    threshold: 0.7,
  });
});

test("getModerationResponseDecision rejects when any result is unsafe", () => {
  assert.deepEqual(getModerationResponseDecision({
    results: [
      { flagged: false, categories: {}, category_scores: {} },
      { flagged: true, categories: { violence: true }, category_scores: {} },
    ],
  }), {
    safe: false,
    reason: "flagged",
    categories: ["violence"],
  });
});

test("resolveModerationProvider defaults to OpenAI outside Docker", () => {
  assert.equal(resolveModerationProvider({
    env: { CURRENT_ENV: "production" },
  }), MODERATION_PROVIDERS.OPENAI);
});

test("production Docker retains production moderation routing", () => {
  assert.equal(resolveModerationProvider({
    env: {
      SAMSAR_DEPLOYMENT_EDITION: "production",
      SAMSAR_RUNTIME: "docker",
    },
    inferenceModel: "QWEN3.7",
  }), MODERATION_PROVIDERS.OPENAI);
});

test("Docker skips moderation when no supported moderation credential is present", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      OPENROUTER_API_KEY: "openrouter-is-not-a-moderation-endpoint",
    },
    availableModelConfig: { providers: ["openrouter", "fal"] },
  }), MODERATION_PROVIDERS.DISABLED);
});

test("Docker uses native OpenAI moderation when an OpenAI key is present", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      OPENAI_API_KEY: "openai-test-key",
    },
  }), MODERATION_PROVIDERS.OPENAI);
});

test("Docker Qwen skips moderation when only OpenRouter or Alibaba inference credentials are present", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      OPENROUTER_API_KEY: "openrouter-test-key",
      ALIBABA_CLOUD_API_KEY: "alibaba-test-key",
    },
    inferenceModel: "QWEN3.7",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.DISABLED);
});

test("Docker Qwen uses OpenAI first and Samsar-js second", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      OPENAI_API_KEY: "openai-test-key",
      SAMSAR_API_KEY: "samsar-test-key",
    },
    inferenceModel: "qwen3.7-plus",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.OPENAI);

  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      OPENROUTER_API_KEY: "openrouter-test-key",
      SAMSAR_API_KEY: "samsar-test-key",
    },
    inferenceModel: "QWEN3.7",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.SAMSAR);
});

test("Docker Qwen does not treat Google credentials as its moderation endpoint", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: GOOGLE_CREDENTIALS_B64,
      GOOGLE_CLOUD_PROJECT: "docker-project",
    },
    inferenceModel: "QWEN3.7",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.DISABLED);
});

test("Docker uses Google moderation when Google Cloud credentials are the only endpoint", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: GOOGLE_CREDENTIALS_B64,
      GOOGLE_CLOUD_PROJECT: "docker-project",
    },
  }), MODERATION_PROVIDERS.GOOGLE);
});

test("Docker prefers Google for Gemini text-to-video when Google and OpenAI are available", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      OPENAI_API_KEY: "openai-test-key",
      GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: GOOGLE_CREDENTIALS_B64,
      GOOGLE_CLOUD_PROJECT: "docker-project",
    },
    inferenceModel: "gemini-3.1-pro",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.GOOGLE);
});

test("Docker otherwise prefers OpenAI when multiple moderation endpoints are available", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      OPENAI_API_KEY: "openai-test-key",
      GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: GOOGLE_CREDENTIALS_B64,
      GOOGLE_CLOUD_PROJECT: "docker-project",
      SAMSAR_API_KEY: "samsar-test-key",
    },
    inferenceModel: "gpt-5.6-sol",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.OPENAI);
});

test("Docker uses the hosted Samsar moderation endpoint when only a Samsar key is present", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      SAMSAR_API_KEY: "samsar-test-key",
      SAMSAR_JS_API_URL: "https://api.example.invalid/v1",
    },
  }), MODERATION_PROVIDERS.SAMSAR);
});

test("Docker ignores malformed Google credentials instead of entering moderation", () => {
  const env = {
    CURRENT_ENV: "docker",
    GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: "not-valid-json",
    GOOGLE_CLOUD_PROJECT: "docker-project",
  };
  assert.equal(hasGoogleModerationCredential(env), false);
  assert.equal(resolveModerationProvider({ env }), MODERATION_PROVIDERS.DISABLED);

  const emptyCredentialEnv = {
    CURRENT_ENV: "docker",
    GOOGLE_APPLICATION_CREDENTIALS_JSON_B64: Buffer.from("{}").toString("base64"),
    GOOGLE_CLOUD_PROJECT: "docker-project",
  };
  assert.equal(hasGoogleModerationCredential(emptyCredentialEnv), false);

  assert.equal(hasGoogleModerationCredential({
    GOOGLE_APPLICATION_CREDENTIALS: "/definitely/missing/google-credentials.json",
    GOOGLE_CLOUD_PROJECT: "docker-project",
  }), false);
});

test("Docker explicit provider is honored only when its credential is configured", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      SAMSAR_MODERATION_PROVIDER: "google_cloud",
      OPENAI_API_KEY: "openai-test-key",
    },
  }), MODERATION_PROVIDERS.OPENAI);

  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "docker",
      SAMSAR_MODERATION_PROVIDER: "samsar-js",
      SAMSAR_API_KEY: "samsar-test-key",
    },
  }), MODERATION_PROVIDERS.SAMSAR);
});

test("production Gemini text-to-video prompts retain Google moderation routing", () => {
  assert.equal(resolveModerationProvider({
    env: { CURRENT_ENV: "production" },
    inferenceModel: "gemini-3.1-pro",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.GOOGLE);
});

test("production Qwen always uses native OpenAI moderation", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "production",
      SAMSAR_MODERATION_PROVIDER: "samsar-js",
      SAMSAR_API_KEY: "samsar-test-key",
      OPENAI_API_KEY: "openai-test-key",
    },
    inferenceModel: "QWEN3.7",
    routeType: "text_to_video",
  }), MODERATION_PROVIDERS.OPENAI);
});

test("explicit disabled provider skips moderation in every environment", () => {
  assert.equal(resolveModerationProvider({
    env: {
      CURRENT_ENV: "production",
      SAMSAR_MODERATION_PROVIDER: "disabled",
    },
  }), MODERATION_PROVIDERS.DISABLED);
});

test("isGoogleOnlyDeploymentProviderConfig accepts environment provider lists", () => {
  assert.equal(isGoogleOnlyDeploymentProviderConfig({
    env: { SAMSAR_DEPLOYMENT_PROVIDERS: "google_cloud" },
  }), true);
});

test("shouldUseGoogleModerationForInferenceContext recognizes Gemini text-to-video aliases", () => {
  assert.equal(shouldUseGoogleModerationForInferenceContext({
    inferenceModel: "gemini-3-pro-preview",
    routeType: "T2V",
  }), true);
});

test("runModerationWithRetry backs off and succeeds after transient 429 responses", async () => {
  let attempts = 0;
  const delays = [];
  const result = await runModerationWithRetry(async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error("rate limited");
      error.status = 429;
      throw error;
    }
    return "safe";
  }, {
    timeoutMs: 100,
    maxRetries: 3,
    retryBaseDelayMs: 5,
    retryMaxDelayMs: 50,
    sleep: async (delayMs) => delays.push(delayMs),
    logRetries: false,
  });

  assert.equal(result, "safe");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [5, 10]);
});

test("runModerationWithRetry honors Retry-After within the configured bound", async () => {
  let attempts = 0;
  const delays = [];
  await runModerationWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error("rate limited");
      error.status = 429;
      error.headers = { "retry-after": "0.02" };
      throw error;
    }
    return true;
  }, {
    timeoutMs: 100,
    maxRetries: 1,
    retryBaseDelayMs: 5,
    retryMaxDelayMs: 50,
    sleep: async (delayMs) => delays.push(delayMs),
    logRetries: false,
  });
  assert.deepEqual(delays, [20]);
});

test("runModerationWithRetry makes four total attempts for three retries", async () => {
  let attempts = 0;
  await assert.rejects(
    runModerationWithRetry(async () => {
      attempts += 1;
      const error = new Error("upstream unavailable");
      error.status = 503;
      throw error;
    }, {
      timeoutMs: 100,
      maxRetries: 3,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 5,
      sleep: async () => {},
      logRetries: false,
    }),
    (error) => error.status === 503 && error.moderationAttempts === 4,
  );
  assert.equal(attempts, 4);
});

test("runModerationWithRetry clamps configuration to three retries", async () => {
  let attempts = 0;
  await assert.rejects(runModerationWithRetry(async () => {
    attempts += 1;
    const error = new Error("upstream unavailable");
    error.status = 503;
    throw error;
  }, {
    timeoutMs: 100,
    maxRetries: 99,
    retryBaseDelayMs: 1,
    sleep: async () => {},
    logRetries: false,
  }));
  assert.equal(attempts, 4);
});

test("moderation retry timing configuration cannot defeat hard safety ceilings", async () => {
  let observedTimeoutMs = 0;
  const retryDelays = [];
  let attempts = 0;
  await assert.rejects(runModerationWithRetry(async ({ timeoutMs }) => {
    attempts += 1;
    observedTimeoutMs = timeoutMs;
    const error = new Error("rate limited");
    error.status = 429;
    error.headers = { "retry-after": "999" };
    throw error;
  }, {
    timeoutMs: 999_999,
    maxRetries: 99,
    retryBaseDelayMs: 999_999,
    retryMaxDelayMs: 999_999,
    sleep: async (delayMs) => retryDelays.push(delayMs),
    logRetries: false,
  }));

  assert.equal(observedTimeoutMs, 20_000);
  assert.equal(attempts, 4);
  assert.deepEqual(retryDelays, [10_000, 10_000, 10_000]);
});

test("runModerationWithRetry does not retry authentication failures", async () => {
  let attempts = 0;
  await assert.rejects(
    runModerationWithRetry(async () => {
      attempts += 1;
      const error = new Error("invalid key");
      error.status = 401;
      throw error;
    }, {
      timeoutMs: 100,
      maxRetries: 3,
      sleep: async () => {},
      logRetries: false,
    }),
    (error) => error.status === 401,
  );
  assert.equal(attempts, 1);
});

test("runModerationWithRetry hard-times a provider that never settles", async () => {
  const startedAt = Date.now();
  await assert.rejects(
    runModerationWithRetry(() => new Promise(() => {}), {
      timeoutMs: 20,
      maxRetries: 0,
      logRetries: false,
    }),
    (error) => error.code === "MODERATION_TIMEOUT" && error.status === 504,
  );
  assert.ok(Date.now() - startedAt < 500);
});

test("native OpenAI moderation disables SDK retries and sets the hard attempt timeout", async () => {
  let observedBody = null;
  let observedOptions = null;
  const response = {
    id: "modr_test",
    model: "omni-moderation-latest",
    results: [{ flagged: false, categories: {}, category_scores: {} }],
  };
  const result = await createNativeOpenAIModeration("a normal prompt", {
    openaiClient: {
      moderations: {
        create: async (body, options) => {
          observedBody = body;
          observedOptions = options;
          return response;
        },
      },
    },
    model: "omni-moderation-latest",
    timeoutMs: 321,
    maxRetries: 0,
    logRetries: false,
  });

  assert.equal(result, response);
  assert.deepEqual(observedBody, {
    input: "a normal prompt",
    model: "omni-moderation-latest",
  });
  assert.equal(observedOptions.timeout, 321);
  assert.equal(observedOptions.maxRetries, 0);
  assert.equal(observedOptions.signal instanceof AbortSignal, true);
});

test("native OpenAI moderation retries malformed transient responses", async () => {
  let attempts = 0;
  const result = await createNativeOpenAIModeration("a normal prompt", {
    openaiClient: {
      moderations: {
        create: async () => {
          attempts += 1;
          if (attempts === 1) {
            return { results: [{}] };
          }
          return {
            results: [{ flagged: false, categories: {}, category_scores: {} }],
          };
        },
      },
    },
    timeoutMs: 100,
    maxRetries: 1,
    retryBaseDelayMs: 1,
    sleep: async () => {},
    logRetries: false,
  });

  assert.equal(attempts, 2);
  assert.equal(result.results[0].flagged, false);
});

test("native OpenAI moderation resolves image media freshly for every retry", async () => {
  const requestData = [
    { type: "text", text: "A calm landscape" },
    {
      type: "image_url",
      image_url: {
        url: "http://localhost:3002/assets_v2/generations/session/moderation.png",
      },
    },
  ];
  const originalRequestData = JSON.parse(JSON.stringify(requestData));
  const bodies = [];
  let resolverCalls = 0;

  const result = await createNativeOpenAIModeration(requestData, {
    openaiClient: {
      moderations: {
        create: async (body) => {
          bodies.push(body);
          if (bodies.length === 1) {
            return { results: [{}] };
          }
          return {
            results: [{ flagged: false, categories: {}, category_scores: {} }],
          };
        },
      },
    },
    resolveMediaUrl: async (_source, options) => {
      resolverCalls += 1;
      assert.deepEqual(options, {
        mediaKind: "image",
        serviceName: "samsar_processor_openai_moderation",
      });
      return `https://fresh-${resolverCalls}.example/assets_v2/generations/session/moderation.png`;
    },
    timeoutMs: 100,
    maxRetries: 1,
    retryBaseDelayMs: 1,
    sleep: async () => {},
    logRetries: false,
  });

  assert.equal(result.results[0].flagged, false);
  assert.equal(resolverCalls, 2);
  assert.equal(
    bodies[0].input[1].image_url.url,
    "https://fresh-1.example/assets_v2/generations/session/moderation.png",
  );
  assert.equal(
    bodies[1].input[1].image_url.url,
    "https://fresh-2.example/assets_v2/generations/session/moderation.png",
  );
  assert.deepEqual(requestData, originalRequestData);
});

test("getModerationForNarrative skips without calling a provider in credential-less Docker", async () => {
  let called = false;
  const safe = await getModerationForNarrative("prompt", {
    env: { CURRENT_ENV: "docker" },
    moderationCall: async () => {
      called = true;
      throw new Error("must not be called");
    },
  });
  assert.equal(safe, true);
  assert.equal(called, false);
});

test("getModerationForNarrative allows a non-graphic Morgana-style fantasy action prompt", async () => {
  const prompt = [
    "Morgana — The Veiled Redeemer",
    "Morgana walks through a fantasy kingdom, secretly protecting mages condemned by unjust laws.",
    "Armored pursuers enter her ruined sanctuary and celestial bindings stop their advance.",
    "Living shadow consumes hostile enchantments while a translucent barrier shelters the outcasts.",
    "Burning shackles hold the pursuers motionless as Morgana leads the outcasts toward freedom.",
  ].join("\n");

  const safe = await getModerationForNarrative(prompt, {
    env: { CURRENT_ENV: "production" },
    moderationCall: async (provider, requestData) => {
      assert.equal(provider, MODERATION_PROVIDERS.OPENAI);
      assert.equal(requestData, prompt);
      return {
        results: [{
          flagged: true,
          categories: {
            violence: true,
            "violence/graphic": false,
          },
          category_scores: {
            violence: 0.82,
            "violence/graphic": 0.04,
          },
        }],
      };
    },
  });

  assert.equal(safe, true);
});

test("getModerationForNarrative fails open after provider errors in every environment", async (t) => {
  t.mock.method(console, "error", () => {});
  for (const env of [
    { CURRENT_ENV: "development" },
    { CURRENT_ENV: "production" },
    { CURRENT_ENV: "docker", OPENAI_API_KEY: "openai-test-key" },
  ]) {
    const safe = await getModerationForNarrative("prompt", {
      env,
      moderationCall: async () => {
        const error = new Error("provider unavailable");
        error.status = 503;
        throw error;
      },
    });
    assert.equal(safe, true);
  }
});

test("getModerationForNarrative fails open when production credentials are not configured", async (t) => {
  t.mock.method(console, "error", () => {});
  const safe = await getModerationForNarrative("prompt", {
    env: { CURRENT_ENV: "production" },
  });
  assert.equal(safe, true);
});

test("getModerationForNarrative fails open after an invalid provider response", async (t) => {
  t.mock.method(console, "error", () => {});
  const safe = await getModerationForNarrative("prompt", {
    env: { CURRENT_ENV: "production" },
    moderationCall: async () => ({ results: [] }),
  });
  assert.equal(safe, true);
});

test("getModerationForNarrative rejects only an explicit unsafe moderation result", async () => {
  const safe = await getModerationForNarrative("unsafe prompt", {
    env: { CURRENT_ENV: "production" },
    moderationCall: async () => ({
      results: [{
        flagged: true,
        categories: { "self-harm": true },
        category_scores: { "self-harm": 0.99 },
      }],
    }),
  });
  assert.equal(safe, false);
});

test("getModerationForNarrative propagates receipt observer failures without retrying", async (t) => {
  t.mock.method(console, "error", () => {});
  let calls = 0;
  const observerError = new Error("receipt persistence unavailable");
  observerError.code = "INFERENCE_USAGE_OBSERVER_FAILED";
  observerError.inferenceUsageObserverFailed = true;

  await assert.rejects(
    getModerationForNarrative("prompt", {
      env: {
        CURRENT_ENV: "docker",
        OPENAI_API_KEY: "openai-test-key",
      },
      moderationCall: async () => {
        calls += 1;
        throw observerError;
      },
    }),
    (error) => error === observerError,
  );
  assert.equal(calls, 1);
});

test("getModerationForNarrative has a caller-level deadline for a provider that never settles", async (t) => {
  t.mock.method(console, "error", () => {});
  const startedAt = Date.now();
  const safe = await getModerationForNarrative("prompt", {
    env: {
      CURRENT_ENV: "production",
      OPENAI_API_KEY: "openai-test-key",
    },
    totalTimeoutMs: 20,
    moderationCall: async () => new Promise(() => {}),
  });

  assert.equal(safe, true);
  assert.ok(Date.now() - startedAt < 500);
});

test("Docker Samsar moderation relies on one bounded hosted request", async (t) => {
  t.mock.method(console, "error", () => {});
  let calls = 0;
  const safe = await getModerationForNarrative("prompt", {
    env: {
      CURRENT_ENV: "docker",
      SAMSAR_API_KEY: "samsar-test-key",
    },
    samsarRequestTimeoutMs: 100,
    samsarClient: {
      createExternalModeration: async () => {
        calls += 1;
        const error = new Error("hosted endpoint unavailable");
        error.status = 503;
        throw error;
      },
    },
  });

  assert.equal(safe, true);
  assert.equal(calls, 1);
});

test("Docker Samsar request uses its dedicated hosted-endpoint timeout budget", async () => {
  const safe = await getModerationForNarrative("prompt", {
    env: {
      CURRENT_ENV: "docker",
      SAMSAR_API_KEY: "samsar-test-key",
    },
    samsarRequestTimeoutMs: 60,
    samsarClient: {
      createExternalModeration: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
          data: {
            results: [{ flagged: false, categories: {}, category_scores: {} }],
          },
        };
      },
    },
  });

  assert.equal(safe, true);
});
