# Providers and Models

Provider configuration is driven by `runtime/config/samsar.config.json` or the setup wizard. `npm run config:render` converts enabled providers into runtime env and `runtime/config/available-models.json`.

## Provider Matrix

| Provider | Credential field | Actions | Model families from setup/config logic |
| --- | --- | --- | --- |
| Samsar | `providers.samsar.apiKey` -> `SAMSAR_API_KEY` | Chat, assistant, image, video, audio, lip sync, sound effects, moderation, recommendations, search in the setup availability matrix | Universal fallback across `gpt-5.6`, `gemini-3.1-pro`, `GPTIMAGE2`, `SEEDREAM` (Seedream 5 Pro), `RUNWAYML`, VEO 3.1 I2V, FAL video models including `HAPPYHORSEI2V` (Happy Horse 1.1 I2V), Lyria, ElevenLabs, OpenAI TTS, Google TTS, sound effects, lip sync, NanoBanana. |
| OpenAI | `providers.openai.apiKey` -> `OPENAI_API_KEY` | Chat, assistant, image, audio, moderation, recommendations, search | `gpt-5.6`, `GPTIMAGE2`, `OPENAI_TTS`. |
| Google Cloud | `providers.googleCloud.credentialsJsonB64`, `projectId` | Chat, assistant, image, video, audio, moderation | `gemini-3.1-pro`, `VEO3.1I2V`, `VEO3.1I2VFAST`, `LYRIA3`, `GOOGLE_TTS`, `NANOBANANA2`, `NANOBANANAPRO`. |
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

Native provider credentials are preferred when they exist. Docker deployments can also use `SAMSAR_API_KEY` as a deployed provider fallback.

The code uses this fallback in two places:

| Area | Fallback behavior |
| --- | --- |
| Chat/inference compatibility | In Docker, Samsar external inference can be used for OpenAI or Gemini model calls when the Samsar key is present and the matching native credential is absent. |
| Express video stages | Text-to-image and image-to-video stages can be marked as deployed Samsar provider stages when the Samsar key is present and no native/custom adapter credential is available for the requested model. |

Current embedding/search implementation note: although the setup availability matrix includes `search` and `recommendations` for Samsar, `EmbeddingService` calls OpenAI embeddings directly with `text-embedding-3-large` and checks `OPENAI_API_KEY`. URL crawling also requires `FIRECRAWL_API_KEY`.

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
| Inference models | `gpt-5.6`, `gemini-3.1-pro`. |
| Lip sync models | `SYNCLIPSYNC`, `LATENTSYNC`, `KLINGLIPSYNC`, `HUMMINGBIRDLIPSYNC`, `CREATIFYLIPSYNC`. |
| Sound effects | `MMAUDIOV2`, `MIRELOAI`. |

## Local Verification

After the stack is running:

```bash
curl http://localhost:3002/v1/video/supported_models
```

Use this response as the source of truth for the current Docker runtime. If a model is missing, check that the provider is enabled in `runtime/config/samsar.config.json`, rerun `npm run config:render`, and recreate the containers that need the updated env.
