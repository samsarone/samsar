import assert from "node:assert/strict";
import test from "node:test";

import {
  STANDALONE_ADAPTER_KEYS,
  extractPrimaryAdapterByModel,
  getAdapterPresentation,
  getPrimaryAdapterKeyForModel,
  normalizeAdapterKey,
} from "./adapterPresentation.mjs";

test("defines a presentation for every standalone adapter", () => {
  assert.deepEqual(STANDALONE_ADAPTER_KEYS, [
    "openai",
    "googleCloud",
    "kimi",
    "alibabaCloud",
    "gmicloud",
    "samsar",
    "fal",
    "openrouter",
    "elevenlabs",
    "runway",
  ]);
  for (const adapterKey of STANDALONE_ADAPTER_KEYS) {
    const presentation = getAdapterPresentation(adapterKey);
    assert.equal(presentation.key, adapterKey);
    assert.ok(presentation.label);
    assert.ok(presentation.glyph);
  }
  assert.deepEqual(
    Object.fromEntries(STANDALONE_ADAPTER_KEYS.map((adapterKey) => [
      adapterKey,
      getAdapterPresentation(adapterKey).label,
    ])),
    {
      openai: "OpenAI",
      googleCloud: "Google Cloud",
      kimi: "Kimi",
      alibabaCloud: "Alibaba Cloud",
      samsar: "Samsar-js",
      gmicloud: "GMICloud via GenBlaze",
      fal: "Fal",
      openrouter: "OpenRouter",
      elevenlabs: "ElevenLabs",
      runway: "RunwayML",
    },
  );
});

test("normalizes provider implementation aliases", () => {
  assert.equal(normalizeAdapterKey("samsar-js"), "samsar");
  assert.equal(normalizeAdapterKey("deployed"), "samsar");
  assert.equal(normalizeAdapterKey("GenBlaze"), "gmicloud");
  assert.equal(normalizeAdapterKey("fal.ai"), "fal");
  assert.equal(normalizeAdapterKey("Moonshot AI"), "kimi");
  assert.equal(normalizeAdapterKey("OpenRouter AI"), "openrouter");
});

test("extracts the effective provider map before considering priority fallbacks", () => {
  const result = extractPrimaryAdapterByModel({
    deployment: {
      providers: ["fal", "gmicloud"],
      modelProviders: {
        GPTIMAGE2: "gmicloud",
      },
      modelProviderPriority: {
        GPTIMAGE2: ["openai", "gmicloud", "fal"],
        SEEDREAM: ["openai", "fal"],
      },
    },
  });

  assert.equal(result.GPTIMAGE2, "gmicloud");
  assert.equal(result.SEEDREAM, "fal");
});

test("uses a populated compatibility provider map when the primary envelope is empty", () => {
  const result = extractPrimaryAdapterByModel({
    deployment: { modelProviders: {} },
    available: { modelProviders: { ELEVENLABS_MUSIC: "elevenlabs" } },
  });

  assert.equal(result.ELEVENLABSMUSIC, "elevenlabs");
});

test("uses populated compatibility providers for a priority-only response", () => {
  const result = extractPrimaryAdapterByModel({
    deployment: {
      providers: [],
      modelProviderPriority: { SDAUDIO: ["fal", "samsar"] },
    },
    available: { providers: ["fal"] },
  });

  assert.equal(result.SDAUDIO, "fal");
});

test("fills legacy audio models from the standalone audio allow-list", () => {
  const result = extractPrimaryAdapterByModel({
    deployment: {
      modelProviders: { SDAUDIO: "samsar" },
      audio: {
        providers: ["fal", "samsar"],
        ttsProviders: ["PLAYAI"],
        musicProviders: ["LYRIA2", "CASSETTEAI", "AUDIOCRAFT"],
        soundEffectProviders: ["SDAUDIO"],
      },
    },
  });

  assert.deepEqual(result, {
    SDAUDIO: "samsar",
    PLAYAI: "fal",
    LYRIA2: "samsar",
    CASSETTEAI: "fal",
    AUDIOCRAFT: "samsar",
  });
});

test("resolves model aliases and custom adapter models", () => {
  const adapters = extractPrimaryAdapterByModel({
    deployment: {
      modelProviders: {
        KIMIK3: "kimi",
        "gpt-5.6-sol": "openai",
      },
    },
  });

  assert.equal(getPrimaryAdapterKeyForModel("kimi-k3", adapters), "kimi");
  assert.equal(getPrimaryAdapterKeyForModel("GPT 5.6 Sol", adapters), "openai");
  assert.equal(
    getPrimaryAdapterKeyForModel("CUSTOM_TEXT_TO_IMAGE:product-shots", adapters),
    "custom",
  );
  assert.equal(getPrimaryAdapterKeyForModel("CUSTOM_IMAGE_TO_VIDEO", adapters), "custom");
});

test("creates a readable fallback for future adapters", () => {
  assert.deepEqual(getAdapterPresentation("future_adapter"), {
    key: "future_adapter",
    label: "Future Adapter",
    mark: "glyph",
    glyph: "F",
  });
});
