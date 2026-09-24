# Providers and Models

Begin with **[hosted Samsar.js](https://docs.samsar.one/)** for managed workflows. Choose a model in the [full matrix](model-matrix.md), read its [API contract](https://docs.samsar.one/), then configure a standalone adapter only when you need it. Native inference and custom model endpoints can lead their own model-specific paths.

For standalone deployments, provider configuration is driven by `runtime/config/samsar.config.json` or the setup wizard. `npm run config:render` converts enabled providers into runtime env and `runtime/config/available-models.json`. The documentation presents Samsar.js first; the runtime follows validated configuration and saved model preferences.

## Provider Matrix

| Adapter / provider docs | Credential | How it fits |
| --- | --- | --- |
| [Samsar.js](https://docs.samsar.one/external-requests) | `SAMSAR_API_KEY` | Call the hosted Samsar service using Samsar credits. The samsar-js client is the common entry point. |
| [OpenAI](https://platform.openai.com/docs/overview) | `OPENAI_API_KEY` | Native GPT inference, image and speech adapters; also required for local embedding indexes. |
| [Anthropic](https://platform.claude.com/docs/en/api/overview) | `ANTHROPIC_API_KEY` | Native Claude inference and assistant adapter. |
| [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs) | `Google service account / configured Google credentials` | Gemini, Nano Banana, Veo, Google speech and Lyria. Music credentials and model access are validated separately. |
| [Kimi](https://platform.kimi.ai/docs/overview) | `KIMI_K3_API_KEY` | Native Kimi text, vision and structured output; Samsar is the supported alternative. |
| [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/) | `ALIBABA_API_KEY` | Native Qwen inference in Docker, Qwen Image, Wan and Happy Horse. Qwen Image requires standard pay-as-you-go access. |
| [GMICloud via GenBlaze](https://docs.gmicloud.ai/) · [GenBlaze source](https://github.com/backblaze-labs/genblaze) | `GMI_API_KEY` | Only exact model and operation mappings validated for your credential are enabled by the local GenBlaze gateway. |
| [fal](https://fal.ai/docs/documentation) | `FAL_API_KEY` | Supported media, speech, music, lip-sync and sound-effect adapters. |
| [OpenRouter](https://openrouter.ai/docs/quickstart) | `OPENROUTER_API_KEY` | Supported inference and vision routes. This does not enable image, video or audio generation. |
| [ElevenLabs](https://elevenlabs.io/docs/overview/intro) | `ELEVENLABS_API_KEY` | Direct music adapter. Speech is enabled through fal in the setup registry; do not assume a direct key enables every speech route. |
| [Runway](https://docs.dev.runwayml.com/) | `RUNWAY_API_KEY` | Native Runway video adapter. |
| [Custom endpoint](https://github.com/samsarone/samsar/blob/main/utils/vast-flux2/README.md) | `Adapter URL and server-side authorization` | Register a compatible endpoint in your standalone deployment. Available only after configuration. |

The [per-model matrix](model-matrix.md) is the compatibility reference. A provider key does not enable every model from that provider. The Samsar adapter is not universal: Qwen Image 3.0 Pro and Seedance 2.0 have native/provider-only setup paths, and some Studio catalog entries are not advertised by setup.

<details>
<summary><strong>Hosted client or standalone Samsar adapter?</strong></summary>

- **Hosted client:** initialize `new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY })`. Requests go to `https://api.samsar.one/v1` by default. Samsar manages its upstream providers.
- **Standalone with Samsar adapter:** configure `SAMSAR_API_KEY` in the wizard so local workers can call supported hosted generation/inference operations through Samsar.js.
- **Standalone API client:** set `baseUrl: 'http://localhost:3002/v1'` and use an API credential accepted by your local processor. Provider credentials belong in the local setup configuration.

[External requests API and SDK examples](https://docs.samsar.one/external-requests#samsar-js).

</details>

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

Hosted clients continue to call Samsar.js regardless of the upstream provider used internally. Standalone routing is model-specific: it combines native adapters, the Samsar adapter, optional provider routes and saved administrator preferences.

| Area | Runtime behavior |
| --- | --- |
| Native inference | The model’s native adapter can lead its chain. Use the generated priority and **Settings → Model Adapters** to see the effective order; GMICloud and OpenRouter are supported only for their mapped models. |
| Kimi K3 | Native Kimi first, Samsar alternative. No OpenRouter fallback. Text, vision and structured output use the same selected model. |
| Hosted Qwen | Non-Docker hosted runtimes route `QWEN3.8` through OpenRouter internally. Native Alibaba credentials do not override that hosted rule. |
| Docker Qwen | Native Alibaba is available; `SAMSAR_QWEN_OPENROUTER_ONLY=true` can force the OpenRouter policy. |
| Qwen Image | `QWENIMAGE3PRO` is native Alibaba only, with standard pay-as-you-go credentials. |
| Express media | Supported Samsar, native and custom adapters depend on the selected model. An accepted asynchronous job stays pinned to its submitting adapter while polling. |
| GMICloud / GenBlaze | Exact credential-validated model and operation mappings are required. An approximate model match is not used as a substitute. |
| GPT Image 2.5 | `GPTIMAGE2` and `GPTIMAGE2EDIT` exclude legacy GenBlaze GPT Image 2 routes. |

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

Public model keys can remain stable when their backing provider version changes: `GPTIMAGE2` → GPT Image 2.5; `SEEDREAM` → Seedream 5 Pro; `HAPPYHORSEI2V` → Happy Horse 1.1 I2V.

| Workflow | Selection rule | Reference |
| --- | --- | --- |
| Express image generation | Uses the explicit Express image allowlist; Qwen Image additionally requires its native standalone adapter. Nano Banana 2 is in the general image catalog but not the current Express list. | [Image matrix](model-matrix.md#image) |
| Express motion | Uses the Express video allowlist, filtered for the target deployment. Seedance 2.0 is provider-billed standalone. | [Video matrix](model-matrix.md#video) |
| Branching narrative | Uses a narrower inference, image and video allowlist. Do not copy every Express model into a branching request. | [Narrative API](https://docs.samsar.one/narrative) · [Branching flags](model-matrix.md) |
| Speech and music | Express `tts_model` uses `OPENAI`, `GOOGLE`, `ELEVENLABS`; `backingtrack_model` uses `LYRIA3` or `ELEVENLABS_MUSIC`. | [Audio guide](audio-and-performance.md) |
| Lip sync and video sound | Separate model fields and video-operation routes. These are not interchangeable with an audio-only generation request. | [Lip sync](model-matrix.md#lip-sync) · [Sound](model-matrix.md#sound) |

[Discover Express model availability](https://docs.samsar.one/video#get-videosupported_models) with `samsar.getSupportedTextToVideoModels()`. For every setup model, its API link and supported adapters, use the [generated full model matrix](model-matrix.md).

## Local Verification

After the stack is running:

```bash
curl http://localhost:3002/v1/video/supported_models
```

Use this response as the source of truth for the current Docker runtime. If a model is missing, check that the provider is enabled in `runtime/config/samsar.config.json`, rerun `npm run config:render`, and recreate the containers that need the updated env.
