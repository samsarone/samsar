# Image List to Video

Image-list-to-video creates an express video from existing image URLs plus prompt and metadata. It is also the core API path for ad-style videos with generated CTA/outro/footer assets.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/video/image_list_to_video` | Internal/authenticated user route. |
| `POST /v2/image_list_to_video` | `v2` alias delegated to the video route. |
| `POST /v1/external_users/image_list_to_video` | External-user scoped route. |
| `POST /v2/external/video/image_to_video` | External video alias for image-to-video style requests. |
| `GET /v2/status`, `GET /v2/status_detailed` | Poll status for internal/API requests. |
| `GET /v1/external_users/status`, `GET /v1/external_users/status_detailed` | Poll external-user requests. |

## Required Fields

| Field | Meaning |
| --- | --- |
| `image_urls` | Non-empty array. Entries can be strings or objects containing `image_url`, `imageUrl`, `url`, `src`, `enhanced_url`, or `enhancedUrl`. |
| `video_model` | Express video model. Defaults to validation against supported models and must be one of the configured express video keys. |

The route also accepts `input` wrapping, so both raw payloads and `{ "input": { ... } }` are supported.

## Common Optional Fields

| Field | Meaning |
| --- | --- |
| `prompt` | Creative direction for the generated video. |
| `metadata` | Structured business/product/context metadata. |
| `language` | Language for generated narration/subtitles where applicable. |
| `image_model` or `imageModel` | Express image model used for generated images/outros. |
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

1. `processor` validates image URLs, provider availability, credits, model keys, aspect ratio, CTA/footer/narrator options, and auth.
2. It creates a video session and express step state in MongoDB.
3. `generator` creates or edits images when needed.
4. `audio-generator` produces speech, music, and sound effects when requested.
5. `ai-video-layer-generator` handles remote video generation/lip sync tasks.
6. `express-video-listener` coordinates stage completion and queues rendering.
7. `video-generator` renders the final output.
8. `media-gateway` serves local Docker outputs under `http://localhost:8080/assets_v2/...`.

## Validation Notes

- `image_urls` must be non-empty and fetchable.
- `aspect_ratio` falls back to `16:9` unless `9:16` is provided.
- `generate_outro_image`, `add_outro_animation`, and `add_footer_animation` must be booleans when provided.
- `cta_url` must be HTTP or HTTPS.
- If an external-user signal is present, the route delegates to the external-user handler and returns external request IDs.
