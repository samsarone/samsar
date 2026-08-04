# Text to Video

Text-to-video creates an express video directly from a prompt. The processor validates the prompt, models, duration, subtitles, provider availability, and credits before queuing the video generation pipeline.

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/video/text_to_video` | Main internal/authenticated user route. |
| `POST /v1/video/create` | Older create route that accepts `{ "input": ... }`. |
| `POST /v2/text_to_video` | `v2` alias delegated to the video route. |
| `POST /v1/external_users/text_to_video` | External-user scoped route. |
| `POST /v2/external/video/text_to_video` | `v2` external video route. |
| `POST /v2/video/step/text_to_video` | Step-video text-to-video route. |

## Required Fields

| Field | Rule |
| --- | --- |
| `prompt` | Required non-empty string. Maximum length is 4000 characters. |
| `image_model` | Required express image model. |
| `video_model` | Required express video model. |
| `duration` | Number from 10 to 240 seconds. |

The route accepts either a raw JSON body or an `input` object:

```json
{
  "input": {
    "prompt": "A cinematic product launch video for a new running shoe",
    "image_model": "NANOBANANAPRO",
    "video_model": "RUNWAYML",
    "duration": 30
  },
  "webhookUrl": "https://example.com/webhooks/samsar"
}
```

## Optional Fields

| Field | Meaning |
| --- | --- |
| `session_id` | Attach request to an existing session when supported. |
| `enable_subtitles` or `add_subtitles` | Boolean subtitle control. |
| `configuration`, `config`, `model_config`, `custom_model_config`, `custom_models` | Custom model/provider configuration. |
| `webhookUrl` | Best-effort terminal success/failure callback URL. |
| External-user fields | If external-user request signals are present, the route delegates to the external-user handler. |

## Supported Model Keys

Express image models:

| Model |
| --- |
| `GPTIMAGE2` |
| `NANOBANANAPRO` |
| `SEEDREAM` (Seedream 5 Pro) |
| `WAN2.7PRO` |
| `CUSTOM_TEXT_TO_IMAGE:<adapter-id>` (standalone custom adapter) |

Express video models:

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

Use the runtime endpoint for the current filtered deployment view:

```bash
curl http://localhost:3002/v1/video/supported_models
```

## Docker Pipeline

1. `processor` validates request shape, auth, credits, models, providers, and duration, then persists a durable builder job for a new or reused session.
2. The builder moderates the prompt, generates the theme once, and generates plus validates the narrative in up to three total attempts. A targeted repair path rewrites oversized speech items when possible.
3. The completed plan is persisted as scene and audio layers. `generator` scene-image jobs run in parallel with `audio-generator` speech jobs and one backing-track job; initial audio generation does not include sound effects.
4. `express-video-listener` joins the image, speech, and music gates, charges completed stages, handles configured step-mode pauses, and queues eligible image-to-video work.
5. `ai-video-layer-generator` submits and polls motion, lip-sync, and later sound-effect jobs. After base motion, the listener runs reflow, conditional lip sync, optional sound effects, optional narrator avatar, and best-effort transcript generation in order.
6. `frames-processor` renders linear layers or branch-path entries into frame manifests.
7. `video-generator` composes frames and enabled audio with FFmpeg, uploads the result, and persists the final URL.
8. The listener charges the final pipeline stage, settles the receipt or external request, records the terminal status, and sends the optional terminal webhook. The result is served by the local media gateway or external storage/CDN configuration.

## Status

Use these status endpoints after receiving a request/session ID:

```text
GET /v2/status?request_id=<request-id>
GET /v2/status_detailed?request_id=<request-id>
GET /v1/external_users/status?request_id=<external-request-id>
```

Final local Docker media links usually resolve under:

```text
http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4
```

## Validation Notes

- `prompt` is required and capped at 4000 characters.
- `duration` must be between 10 and 240 seconds.
- `image_model` must be an express image model.
- `video_model` must be an express video model.
- Deprecated `video_model_sub_type` and `videoModelSubType` request fields are stripped before validation.
