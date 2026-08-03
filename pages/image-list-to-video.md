# Image List to Video

Image-list-to-video creates an express video from existing image URLs plus prompt and metadata. It is also the core API path for ad-style videos with generated CTA/outro/footer assets.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/video/image_list_to_video` | Internal/authenticated user route. |
| `POST /v2/image_list_to_video` | `v2` alias delegated to the video route. |
| `POST /v1/external_users/image_list_to_video` | External-user scoped route. |
| `POST /v2/external/video/image_to_video` | Separate direct one-image AI-clip shortcut. It does not run the full image-list builder or media pipeline described below. |
| `POST /v2/external/video/direct_image_to_video` | Explicit alias for the same direct one-image AI-clip shortcut. |
| `POST /v2/video/step/image_to_video` | Step-video route for the full image-list builder. |
| `GET /v2/status`, `GET /v2/status_detailed` | Poll status for internal/API requests. |
| `GET /v1/external_users/status`, `GET /v1/external_users/status_detailed` | Poll external-user requests. |

## Required Fields

| Field | Meaning |
| --- | --- |
| `image_urls` | Non-empty array. Entries can be strings or objects containing `image_url`, `imageUrl`, `url`, `src`, `enhanced_url`, or `enhancedUrl`. |

`video_model` is optional. It defaults to `RUNWAYML` and, when provided, must be one of the configured image-list express video keys.

The route also accepts `input` wrapping, so both raw payloads and `{ "input": { ... } }` are supported.

## Common Optional Fields

| Field | Meaning |
| --- | --- |
| `prompt` | Creative direction for the generated video. |
| `metadata` | Structured business/product/context metadata. |
| `language` | Language for generated narration/subtitles where applicable. |
| `image_model` or `imageModel` | Optional model for explicit input-image enhancement. Existing prepared images are otherwise retained; CTA/outro composition does not depend on this model. |
| `aspect_ratio` or `aspectRatio` | `16:9` or `9:16`; defaults to `16:9`. |
| `enable_subtitles` or `add_subtitles` | Boolean. |
| `tts_model`, `ttsProvider`, `tts_provider` | Text-to-speech provider/model override. |
| `backingtrack_model`, `backing_track_model`, `music_provider` | Music/backing track override. |
| `inference_model` | Inference model override for narrative/planning steps. |
| `custom_adapters`, `configuration`, `model_config` | Custom model adapter configuration. |
| `webhookUrl` | Optional callback URL. |

## Ad Video and CTA Options

| Field | Meaning |
| --- | --- |
| `generate_outro_image` | Boolean. Generate an outro image. Defaults to true when CTA URL or CTA image data is provided. |
| `cta_url` or `ctaUrl` | HTTP/HTTPS CTA URL. Required when generated outro image is requested without an `outro_cta_image`. |
| `outro_cta_image` | Structured CTA image payload accepted by the video route. |
| `cta_text_top`, `cta_text_bottom`, `cta_logo` | Optional CTA text/logo fields. |
| `add_outro_animation` | Boolean. Defaults to true when generating an outro image. |
| `express_cta_generation`, `auto_generate_cta_text`, `generate_cta_texts` | Boolean aliases that enable express CTA generation. |
| `add_footer_animation` | Boolean footer animation control. |
| `footer_metadata` | Footer content/metadata. |
| `limit_single_narrator`, `add_narrator_avatar` | Narrator avatar controls. |

## Supported Models

Image-list-to-video uses the same express video model keys as text-to-video:

| Model | Credits per second in current pricing config |
| --- | --- |
| `RUNWAYML` | 30 |
| `VEO3.1I2V` | 60 |
| `VEO3.1I2VFAST` | 36 |
| `COSMOS3SUPERI2V` | 20 |
| `SEEDANCEI2V` | 30 |
| `KLINGIMGTOVID3PRO` | 36 |
| `KLINGIMGTOVIDTURBO` | 36 |
| `HAPPYHORSEI2V` (Happy Horse 1.1 I2V) | 36 |

Deployment availability still depends on enabled providers. Check:

```bash
curl http://localhost:3002/v1/video/supported_models
```

## Docker Pipeline

1. `processor` authenticates and validates image URLs, provider availability, credits, model keys, aspect ratio, CTA/footer/narrator options, and request aliases.
2. Before returning, it downloads each input, inspects orientation and target coverage, center-crops only when the source can cover the target, uploads the prepared copy, and persists a durable builder job.
3. The async builder describes the prepared images on a best-effort basis, moderates the prompt, extracts a theme, and generates plus validates the narrative in up to five total attempts. Optional CTA copy retries once before deterministic fallback text is used.
4. It builds supplied-image scene layers plus any requested outro, footer, or narrator-avatar assets, then queues image readiness/enhancement work, speech, and one backing-music track. The initial audio path does not create sound effects.
5. `express-video-listener` joins the image, speech, and music gates and queues eligible motion layers; generated terminal outro layers skip AI-video generation.
6. `ai-video-layer-generator` handles provider motion and lip-sync work. The listener then runs reflow, conditional lip sync, sound-effect check/fallback, optional narrator avatar, and nonblocking transcript generation in order.
7. `frames-processor` creates linear or branch-path frame manifests, after which `video-generator` mixes enabled audio, renders with FFmpeg, uploads the final output, and persists its URL.
8. The listener finalizes stage billing, settlement, status, and the optional terminal webhook. `processor` serves local Docker outputs from the mounted volume under its configured `/assets_v2/...` URL (default `http://localhost:3002/assets_v2/...`).

The standard and `v2` alias routes share this full pipeline. The external-user route wraps the same pipeline with an external request/public ID. Step mode also uses the same builder and can pause before configured manual stages. The direct `/v2/external/video/image_to_video` and `/v2/external/video/direct_image_to_video` aliases are intentionally separate: they accept one image and queue only the direct AI-video clip path.

## Validation Notes

- `image_urls` must be non-empty and fetchable.
- `aspect_ratio` falls back to `16:9` unless `9:16` is provided.
- `generate_outro_image`, `add_outro_animation`, and `add_footer_animation` must be booleans when provided.
- `cta_url` must be HTTP or HTTPS.
- If an external-user signal is present, the route delegates to the external-user handler and returns external request IDs.
