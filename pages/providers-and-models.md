# Providers and Models

Provider configuration is driven by `runtime/config/samsar.config.json` or the setup wizard. `npm run config:render` converts enabled providers into runtime env and `runtime/config/available-models.json`.

## Provider Matrix

| Provider | Credential field | Actions | Model families from setup/config logic |
| --- | --- | --- | --- |
| Samsar | `providers.samsar.apiKey` -> `SAMSAR_API_KEY` | Chat, assistant, image, video, audio, lip sync, sound effects, moderation, recommendations, search in the setup availability matrix | Universal fallback across `gpt-5.6-sol`, `gemini-3.1-pro`, `KIMIK3`, `QWEN3.8`, `GPTIMAGE2`, `SEEDREAM` (Seedream 5 Pro), `RUNWAYML`, VEO 3.1 I2V, FAL video models including `HAPPYHORSEI2V` (Happy Horse 1.1 I2V), Lyria, ElevenLabs, OpenAI TTS, Google TTS, sound effects, lip sync, NanoBanana. |
| OpenAI | `providers.openai.apiKey` -> `OPENAI_API_KEY` | Chat, assistant, image, audio, moderation, recommendations, search | `gpt-5.6-sol`, `GPTIMAGE2`, `OPENAI_TTS`. |
| Google Cloud | `providers.googleCloud.credentialsJsonB64`, `projectId` | Chat, assistant, image, video, audio, moderation | `gemini-3.1-pro`, `VEO3.1I2V`, `VEO3.1I2VFAST`, `LYRIA3`, `GOOGLE_TTS`, `NANOBANANA2`, `NANOBANANAPRO`. |
| Kimi K3 | `providers.kimi.apiKey` -> `KIMI_K3_API_KEY` | Chat, vision inference, strict structured output, assistant | `KIMIK3`, backed by the exact native `kimi-k3` model at `https://api.moonshot.ai/v1`. |
| OpenRouter | `runtime/secrets/provider.credentials.json` -> `OPENROUTER_API_KEY` | Chat, vision inference, assistant | `gpt-5.6-sol`, `gemini-3.1-pro`, `QWEN3.8`; each stable selection routes text and media-bearing requests to its corresponding OpenRouter model. The Gemini selection defaults to `google/gemini-3.1-pro-preview` and can be overridden with `providers.openrouter.gemini31ProModel`. |
| Alibaba Cloud | `runtime/secrets/provider.credentials.json` -> `ALIBABA_API_KEY`, `ALIBABA_API_HOST` | Native Qwen chat, vision inference, and assistant in Docker; image and video routing where supported | `QWEN3.8`, `WAN2.7PRO`, `HAPPYHORSEI2V`. Hosted Qwen inference does not use the native Alibaba adapter. |
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
| `modelProviderPriority` | Default compatible adapter order for each model. |
| `audio` | Derived audio provider availability for TTS, music, and sound effects. |

The video API reads this file through `DeploymentModelConfig` and filters `GET /v1/video/supported_models` responses to the deployment's available models.

## Standalone Model Adapter Preferences

The standalone administrator can open **Settings > Model Adapters** in the Samsar client to reorder the installed adapters for inference, text-to-image, and image-to-video models. Only models and adapters available in the current installation are shown.

The default order comes from `runtime/config/available-models.json`. Saved overrides are written atomically to `runtime/config/model-adapter-preferences.json`; rerunning `npm run config:render` does not overwrite that file. Resetting the setup wizard removes it together with the other generated runtime configuration.

For Text to Video, Image List to Video, and Studio work, a new request starts with the first configured adapter. A definitive provider failure advances the retry to the next configured adapter. Requests already submitted to an asynchronous provider remain pinned to that provider while polling, so changing the preference order cannot redirect an in-flight request.

This preference file is read only when `SAMSAR_DEPLOYMENT_EDITION=standalone`. Production and staging deployments keep their existing provider-routing behavior, and their settings UI does not expose this control.

## Fallback Rules

Inference routing depends on the deployment mode. Docker keeps the configurable native-first fallback chain. Kimi is always native-first with Samsar fallback; hosted Qwen inference is OpenRouter-only.

The code uses this fallback in two places:

| Area | Fallback behavior |
| --- | --- |
| Kimi K3 inference | `KIMIK3` uses `KIMI_K3_API_KEY` first and `SAMSAR_API_KEY` second. OpenRouter is not in this chain. The same selected model follows text, assistant, structured JSON, vision, and Express stages. |
| Hosted Qwen inference | In `production`, `external-production`, `staging`, and any other non-Docker runtime, `QWEN3.8` always uses `OPENROUTER_API_KEY`. Saved native or deployed authorization and Alibaba credentials do not override this rule. |
| Docker chat/inference compatibility | GPT, Gemini, and Qwen use their direct provider first, then `OPENROUTER_API_KEY`, then `SAMSAR_API_KEY`. Set `SAMSAR_QWEN_OPENROUTER_ONLY=true` to force Qwen through OpenRouter in Docker as well. |
| Express video stages | Text-to-image and image-to-video stages can be marked as deployed Samsar provider stages when the Samsar key is present and no native/custom adapter credential is available for the requested model. |

Current embedding/search implementation note: although the setup availability matrix includes `search` and `recommendations` for Samsar, `EmbeddingService` calls OpenAI embeddings directly with `text-embedding-3-large` and checks `OPENAI_API_KEY`. URL crawling also requires `FIRECRAWL_API_KEY`.

## Kimi K3 Adapter

`KIMIK3` is the stable setup/runtime model key and `kimi-k3` is the exact native provider model. Native requests use `https://api.moonshot.ai/v1`, always set high reasoning, normalize developer messages to system messages, and remove sampling fields that Kimi fixes internally. Structured-output requests preserve the existing response contract and force strict JSON schemas. Vision uses the same model: public images are converted to inline data, while supported video inputs are uploaded and referenced through Kimi file storage.

The runtime renderer writes `KIMI_K3_API_KEY` once into mode-`0600` `runtime/secrets/root.env`. Compose shares that env with `processor`, `generator`, `audio-generator`, `ai-video-layer-generator`, `express-video-listener`, and `assistant-query-processor`.

## OpenRouter Qwen Adapter

`QWEN3.8` is the stable public model key. The OpenRouter adapter uses the same provider model for text and vision requests:

| Request | Default OpenRouter model |
| --- | --- |
| Text only | `qwen/qwen3.8-max` |
| Contains image or video input | `qwen/qwen3.8-max` |

`OPENROUTER_QWEN_38_MAX_MODEL` overrides that mapping. Native Alibaba routing uses `qwen3.8-max` for text and vision, including Docker installations configured with a Token Plan endpoint; the renderer writes that shared selection as `ALIBABA_QWEN_MODEL`. OpenRouter requests explicitly use high reasoning for Qwen and Gemini and `xhigh` for GPT, with a 65,536-token completion allowance and a 10-minute minimum timeout. All external-assistant providers apply up to three exponential-backoff retries for transient, rate-limit, and malformed-response errors and honor provider `Retry-After` guidance. Payment-required and insufficient-credit failures are never retried.

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
| Inference models | `gpt-5.6-sol`, `gemini-3.1-pro`, `KIMIK3`, `QWEN3.8`. |
| Lip sync models | `SYNCLIPSYNC`, `LATENTSYNC`, `KLINGLIPSYNC`, `HUMMINGBIRDLIPSYNC`, `CREATIFYLIPSYNC`. |
| Sound effects | `MMAUDIOV2`, `MIRELOAI`. |

## Local Verification

After the stack is running:

```bash
curl http://localhost:3002/v1/video/supported_models
```

Use this response as the source of truth for the current Docker runtime. If a model is missing, check that the provider is enabled in `runtime/config/samsar.config.json`, rerun `npm run config:render`, and recreate the containers that need the updated env.
