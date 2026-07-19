# Providers and Models

Provider configuration is driven by `runtime/config/samsar.config.json` or the setup wizard. `npm run config:render` converts enabled providers into runtime env and `runtime/config/available-models.json`.

## Provider Matrix

| Provider | Credential field | Actions | Model families from setup/config logic |
| --- | --- | --- | --- |
| Samsar | `providers.samsar.apiKey` -> `SAMSAR_API_KEY` | Chat, assistant, image, video, audio, lip sync, sound effects, moderation, recommendations, search in the setup availability matrix | Universal fallback across `gpt-5.6-sol`, `gemini-3.1-pro`, `GPTIMAGE2`, `SEEDREAM` (Seedream 5 Pro), `RUNWAYML`, VEO 3.1 I2V, FAL video models including `HAPPYHORSEI2V` (Happy Horse 1.1 I2V), Lyria, ElevenLabs, OpenAI TTS, Google TTS, sound effects, lip sync, NanoBanana. |
| OpenAI | `providers.openai.apiKey` -> `OPENAI_API_KEY` | Chat, assistant, image, audio, moderation, recommendations, search | `gpt-5.6-sol`, `GPTIMAGE2`, `OPENAI_TTS`. |
| Google Cloud | `providers.googleCloud.credentialsJsonB64`, `projectId` | Chat, assistant, image, video, audio, moderation | `gemini-3.1-pro`, `VEO3.1I2V`, `VEO3.1I2VFAST`, `LYRIA3`, `GOOGLE_TTS`, `NANOBANANA2`, `NANOBANANAPRO`. |
| OpenRouter | `runtime/secrets/provider.credentials.json` -> `OPENROUTER_API_KEY` | Chat, vision inference, assistant | `gpt-5.6-sol`, `gemini-3.1-pro`, `QWEN3.7`; each stable selection routes text and media-bearing requests to its corresponding OpenRouter model. The Gemini selection defaults to `google/gemini-3.1-pro-preview` and can be overridden with `providers.openrouter.gemini31ProModel`. |
| Alibaba Cloud | `runtime/secrets/provider.credentials.json` -> `ALIBABA_API_KEY`, `ALIBABA_API_HOST` | Native Qwen chat, vision inference, and assistant in Docker; image and video routing where supported | `QWEN3.7`, `WAN2.7PRO`, `HAPPYHORSEI2V`. Hosted Qwen inference does not use the native Alibaba adapter. |
| FAL | `providers.fal.apiKey` -> `FAL_API_KEY` | Image, video, audio, lip sync, sound effects | `SEEDREAM` (Seedream 5 Pro), `NANOBANANA2`, `NANOBANANAPRO`, `VEO3.1I2V`, `VEO3.1I2VFAST`, `COSMOS3SUPERI2V`, `SEEDANCEI2V`, `KLINGIMGTOVID3PRO`, `KLINGIMGTOVIDTURBO`, `HAPPYHORSEI2V` (Happy Horse 1.1 I2V), `ELEVENLABS_MUSIC`, `ELEVENLABS`, `MMAUDIOV2`, `MIRELOAI`, `SYNCLIPSYNC`, `LATENTSYNC`, `KLINGLIPSYNC`, `HUMMINGBIRDLIPSYNC`, `CREATIFYLIPSYNC`. |
| ElevenLabs | `providers.elevenlabs.apiKey` -> `ELEVENLABS_API_KEY`, `ELEVENLABS_API_TOKEN` | Audio | `ELEVENLABS`, `ELEVENLABS_MUSIC`. |
| RunwayML | `providers.runway.apiKey` -> `RUNWAY_API_KEY`, `RUNWAYML_API_KEY` | Video | `RUNWAYML`. |

## Generated Availability

The renderer script builds availability by unioning enabled provider capabilities:

```bash
npm run config:render
cat runtime/config/available-models.json
```

The generated file contains:

| Key | Meaning |
| --- | --- |
| `providers` | Enabled provider keys. |
| `models` | Available model identifiers from enabled providers. |
| `actions` | Available action families such as `chat`, `image`, `video`, `search`, `recommendations`, `audio`, `lip_sync`, and `sound_effect`. |
| `audio` | Derived audio provider availability for TTS, music, and sound effects. |

The video API reads this file through `DeploymentModelConfig` and filters `GET /v1/video/supported_models` responses to the deployment's available models.

## Fallback Rules

Inference routing depends on the deployment mode. Docker keeps the configurable native-first fallback chain. Hosted Qwen inference is OpenRouter-only.

The code uses this fallback in two places:

| Area | Fallback behavior |
| --- | --- |
| Hosted Qwen inference | In `production`, `external-production`, `staging`, and any other non-Docker runtime, `QWEN3.7` always uses `OPENROUTER_API_KEY`. Saved native or deployed authorization and Alibaba credentials do not override this rule. |
| Docker chat/inference compatibility | GPT, Gemini, and Qwen use their direct provider first, then `OPENROUTER_API_KEY`, then `SAMSAR_API_KEY`. Set `SAMSAR_QWEN_OPENROUTER_ONLY=true` to force Qwen through OpenRouter in Docker as well. |
| Express video stages | Text-to-image and image-to-video stages can be marked as deployed Samsar provider stages when the Samsar key is present and no native/custom adapter credential is available for the requested model. |

Current embedding/search implementation note: although the setup availability matrix includes `search` and `recommendations` for Samsar, `EmbeddingService` calls OpenAI embeddings directly with `text-embedding-3-large` and checks `OPENAI_API_KEY`. URL crawling also requires `FIRECRAWL_API_KEY`.

## OpenRouter Qwen Adapter

`QWEN3.7` is the stable public model key. The OpenRouter adapter uses the same provider model for text and vision requests:

| Request | Default OpenRouter model |
| --- | --- |
| Text only | `qwen/qwen3.7-max` |
| Contains image or video input | `qwen/qwen3.7-max` |

`OPENROUTER_QWEN_37_MAX_MODEL` overrides that mapping. OpenRouter requests explicitly use high reasoning for Qwen and Gemini and `xhigh` for GPT, with a 65,536-token completion allowance and a 10-minute minimum timeout. All external-assistant providers apply up to three exponential-backoff retries for transient, rate-limit, and malformed-response errors and honor provider `Retry-After` guidance. Payment-required and insufficient-credit failures are never retried.

The adapter policy is shared by the processor, generator, audio generator, AI video layer generator, express video listener, and assistant query processor. `configuration.custom_adapters` is a separate media-operation feature and cannot override the hosted Qwen inference route.

## Model Groups Used by Video APIs

Public API keys remain stable when their backing provider model is upgraded. The current version mappings are:

| Stable key | Current provider model |
| --- | --- |
| `SEEDREAM` | Seedream 5 Pro |
| `HAPPYHORSEI2V` | Happy Horse 1.1 I2V |

| Group | Models |
| --- | --- |
| Express image models | `GPTIMAGE2`, `NANOBANANA2`, `NANOBANANAPRO`, `SEEDREAM`, `CUSTOM_TEXT_TO_IMAGE`. |
| Express video models | `RUNWAYML`, `VEO3.1I2V`, `VEO3.1I2VFAST`, `COSMOS3SUPERI2V`, `SEEDANCEI2V`, `KLINGIMGTOVID3PRO`, `KLINGIMGTOVIDTURBO`, `HAPPYHORSEI2V`. |
| Inference models | `gpt-5.6-sol`, `gemini-3.1-pro`, `QWEN3.7`. |
| Lip sync models | `SYNCLIPSYNC`, `LATENTSYNC`, `KLINGLIPSYNC`, `HUMMINGBIRDLIPSYNC`, `CREATIFYLIPSYNC`. |
| Sound effects | `MMAUDIOV2`, `MIRELOAI`. |

## Local Verification

After the stack is running:

```bash
curl http://localhost:3002/v1/video/supported_models
```

Use this response as the source of truth for the current Docker runtime. If a model is missing, check that the provider is enabled in `runtime/config/samsar.config.json`, rerun `npm run config:render`, and recreate the containers that need the updated env.
