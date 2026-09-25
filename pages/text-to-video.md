# Text to Video

Text-to-video creates an express video directly from a prompt. The processor validates the prompt, models, duration, subtitles, provider availability, and credits before queuing the video generation pipeline.

## Hosted Samsar.js

[Hosted Video API](https://docs.samsar.one/video#post-videotext_to_video) · [Image model matrix](model-matrix.md#image) · [Video model matrix](model-matrix.md#video) · [Adapter deployment](providers-and-models.md)

Start with `samsar-js` against the hosted API. The same workflow can run through a standalone processor with compatible adapters.

```js
import SamsarClient from 'samsar-js';
const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const job = await samsar.createVideoFromText({
  prompt: 'A welcoming introduction to a boutique hotel.',
  image_model: 'GPTIMAGE2.5',
  video_model: 'RUNWAYML',
  duration: 30,
  tts_model: 'OPENAI',
  backingtrack_model: 'LYRIA3',
});
console.log(job.data.request_id);
```

This creates a planned multi-stage video. The selected `video_model` animates scene images; it does not have to be a raw text-to-video model.

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

Choose from the [image matrix](model-matrix.md#image) and [video matrix](model-matrix.md#video). Those tables are generated from the same Express and branching allowlists used by this checkout.

| Stage | Request field | Where to compare |
| --- | --- | --- |
| Planning | `inference_model` | [Inference and vision](model-matrix.md#inference) |
| Scene images | `image_model` | [Express-capable image models](model-matrix.md#image) |
| Scene motion | `video_model` | [Express-capable video models](model-matrix.md#video) |
| Narration | `tts_model` | [Speech values](model-matrix.md#speech) |
| Backing track | `backingtrack_model` | [Music](model-matrix.md#music) |

**Native exception:** `QWENIMAGE3PRO` requires standalone Alibaba pay-as-you-go access. **Provider-billed exception:** Seedance 2.0 requires fal or the exact validated GenBlaze route. Named custom image adapters use the returned `CUSTOM_TEXT_TO_IMAGE:<adapter-id>` key.

Start with the hosted [pricing table](https://docs.samsar.one/pricing#video-models) for managed billing. Provider-billed standalone routes use their own provider account and should not be assigned a fixed Samsar rate from a static table.

```js
const available = await samsar.getSupportedTextToVideoModels();
console.log(available.data);
```

For a standalone processor, the same discovery endpoint is `http://localhost:3002/v1/video/supported_models`. It reports the filtered Express view, not the entire Studio catalog.

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
