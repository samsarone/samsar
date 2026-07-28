import assert from "node:assert/strict";
import test from "node:test";

import {
  MODEL_ADAPTERS_ACCOUNT_PANEL_KEY,
  areModelAdapterPreferencesEqual,
  buildModelProviderPriority,
  canManageModelAdapters,
  countModelAdapterModels,
  isLegacyModelAdaptersSettingsPath,
  isModelAdaptersAccountPath,
  normalizeModelAdapterResponse,
  reorderAdapterPreference,
  resetModelAdapterPreferences,
  updateModelAdapterPreference,
} from "./modelAdapterPreferences.mjs";

const RESPONSE = {
  updatedAt: "2026-07-28T12:00:00.000Z",
  stages: [
    {
      key: "inference",
      label: "Inference",
      models: [
        {
          modelKey: "gpt-5.6-sol",
          label: "GPT 5.6 Sol",
          availableAdapters: [
            { key: "openai", label: "OpenAI" },
            { key: "samsar", label: "Samsar API Key" },
            { key: "openai", label: "Duplicate OpenAI" },
          ],
          preference: ["unknown", "samsar", "samsar"],
          defaultPreference: ["openai", "samsar"],
        },
      ],
    },
    {
      key: "text_to_image",
      label: "Text to image",
      models: [
        {
          modelKey: "GPTIMAGE2",
          label: "GPT Image 2",
          availableAdapters: [
            { key: "openai", label: "OpenAI" },
          ],
          preference: [],
          defaultPreference: ["openai"],
        },
      ],
    },
  ],
};

test("model adapter access requires standalone edition and an admin user", () => {
  assert.equal(canManageModelAdapters({
    isStandaloneDeployment: true,
    isAdminUser: true,
  }), true);
  assert.equal(canManageModelAdapters({
    isStandaloneDeployment: true,
    isAdminUser: false,
  }), false);
  assert.equal(canManageModelAdapters({
    isStandaloneDeployment: false,
    isAdminUser: true,
  }), false);
});

test("recognizes the account-level model adapters path and its legacy settings path", () => {
  assert.equal(MODEL_ADAPTERS_ACCOUNT_PANEL_KEY, "model-adapters");
  assert.equal(
    isModelAdaptersAccountPath("/account/model-adapters"),
    true,
  );
  assert.equal(isModelAdaptersAccountPath("/account/settings/model-adapters"), false);
  assert.equal(isModelAdaptersAccountPath("/model-adapters"), false);
  assert.equal(
    isLegacyModelAdaptersSettingsPath("/account/settings/model-adapters"),
    true,
  );
  assert.equal(isLegacyModelAdaptersSettingsPath("/account/model-adapters"), false);
});

test("normalizes adapter rows and fills incomplete preferences deterministically", () => {
  const normalized = normalizeModelAdapterResponse(RESPONSE);
  const inferenceModel = normalized.stages[0].models[0];

  assert.equal(normalized.updatedAt, RESPONSE.updatedAt);
  assert.deepEqual(inferenceModel.availableAdapters, [
    { key: "openai", label: "OpenAI" },
    { key: "samsar", label: "Samsar API Key" },
  ]);
  assert.deepEqual(inferenceModel.preference, ["samsar", "openai"]);
  assert.deepEqual(inferenceModel.defaultPreference, ["openai", "samsar"]);
  assert.equal(countModelAdapterModels(normalized.stages), 2);
});

test("reorders without mutating the source and ignores invalid destinations", () => {
  const original = ["openai", "openrouter", "samsar"];
  assert.deepEqual(
    reorderAdapterPreference(original, 2, 0),
    ["samsar", "openai", "openrouter"],
  );
  assert.deepEqual(original, ["openai", "openrouter", "samsar"]);
  assert.deepEqual(
    reorderAdapterPreference(original, 0, 99),
    original,
  );
});

test("updates matching model preferences, builds the PUT map, and resets defaults", () => {
  const normalized = normalizeModelAdapterResponse(RESPONSE);
  const changedStages = updateModelAdapterPreference(
    normalized.stages,
    "gpt-5.6-sol",
    ["openai", "samsar"],
  );

  assert.deepEqual(buildModelProviderPriority(changedStages), {
    "gpt-5.6-sol": ["openai", "samsar"],
    GPTIMAGE2: ["openai"],
  });
  assert.equal(
    areModelAdapterPreferencesEqual(changedStages, normalized.stages),
    false,
  );

  const resetStages = resetModelAdapterPreferences(changedStages);
  assert.deepEqual(buildModelProviderPriority(resetStages), {
    "gpt-5.6-sol": ["openai", "samsar"],
    GPTIMAGE2: ["openai"],
  });
  assert.equal(
    areModelAdapterPreferencesEqual(resetStages, changedStages),
    true,
  );
});

test("malformed responses normalize to safe empty collections", () => {
  assert.deepEqual(normalizeModelAdapterResponse(null), {
    stages: [],
    updatedAt: null,
  });
  assert.equal(countModelAdapterModels(undefined), 0);
  assert.deepEqual(buildModelProviderPriority(undefined), {});
});
