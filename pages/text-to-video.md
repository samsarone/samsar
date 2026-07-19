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
| `webhookUrl` | Callback URL for status updates. |
| External-user fields | If external-user request signals are present, the route delegates to the external-user handler. |

## Supported Model Keys

Express image models:

| Model |
| --- |
| `GPTIMAGE2` |
| `NANOBANANA2` |
| `NANOBANANAPRO` |
| `SEEDREAM` (Seedream 5 Pro) |
| `CUSTOM_TEXT_TO_IMAGE` |

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

1. `processor` validates request shape, auth, credits, models, and duration.
2. The request is converted into a video session and queued express video state.
3. `generator` creates source images from the prompt.
4. `audio-generator` handles speech, music, and sound effects if required by the generated plan.
5. `ai-video-layer-generator` handles image-to-video tasks for generated visual layers.
6. `express-video-listener` watches stage completion, billing state, and render readiness.
7. `video-generator` renders the final video.
8. The result is served by the local media gateway or external storage/CDN configuration.

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
