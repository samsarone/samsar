# Samsar GenBlaze gateway

This is an internal-only HTTP wrapper around the library-only
[Backblaze Labs GenBlaze](https://github.com/backblaze-labs/genblaze) GMICloud
connector. It runs only for standalone Docker installations that enable
GMICloud. Other Samsar services reach it at `http://genblaze:8080/v1`; the
container should not publish port 8080 to the host.

## Credential-bound model catalog

The catalog is deliberately closed and generated during setup. It contains
only mappings verified for the configured GMICloud credential, and its SHA-256
credential fingerprint must match `GMI_API_KEY` at gateway startup. The file is
mounted read-only and has this shape:

```json
{
  "version": 1,
  "provider": "gmicloud",
  "credentialFingerprint": "<sha256>",
  "models": {
    "QWEN3.8": {
      "text": {"modelId": "<exact GMI id>", "operation": "chat.completions"},
      "vision": {"modelId": "<exact GMI id>", "operation": "chat.completions"}
    },
    "GPTIMAGE2": {
      "image": {"modelId": "gpt-image-2-generate", "operation": "image.generate"}
    },
    "ELEVENLABS": {
      "audio": {"modelId": "elevenlabs-tts-multilingual-v2", "operation": "audio.generate"}
    }
  }
}
```

The gateway-side allowlist currently understands these Samsar contracts:

- inference/vision: `gpt-5.6-sol`, `gemini-3.1-pro`, `QWEN3.8`;
- image generation: `GPTIMAGE2`, `SEEDREAM`, `NANOBANANA2`,
  `NANOBANANAPRO`;
- image editing: `GPTIMAGE2EDIT`, `NANOBANANA2EDIT`,
  `NANOBANANAPROEDIT`, `BRIA_ERASER`, `BRIA_GENFILL`;
- video generation: `VEO3.1`, `VEO3.1FAST`, `VEO3.1I2V`,
  `VEO3.1I2VFAST`, `VEO3.1FLIV`, `SEEDANCEI2V`,
  `KLINGIMGTOVID3PRO`, `KLINGIMGTOVIDTURBO`, `KLINGIMGTOVIDPRO`,
  `KLINGIMGTOVID2.1MASTER`,
  `KLINGIMGTOVID2.1PRO`, `KLINGIMGTOVID2.1STANDARD`, `HAILUOPRO`,
  `HAPPYHORSEI2V`;
- speech: `ELEVENLABS` through the exact
  `elevenlabs-tts-multilingual-v2` or `elevenlabs-tts-v3` route, and the
  dormant `OPENAI_TTS` contract through `gpt-4o-mini-tts` only when that exact
  route is returned for the configured credential.

Only routes present in the generated file are advertised or callable. Every
inference/vision contract uses its corresponding inference model for vision,
including `Qwen/Qwen3.8-Max` for both Qwen text and vision. If an optional
vision mapping is absent, text remains available and a vision request gets a
clear 400 response.

Media payloads keep Samsar's public request shape, then use strict per-model
wire translations before GenBlaze submits them: GPT Image count becomes `n`;
Seedream ratio and Fal size aliases become an exact Seedream 5 Pro `size`
within BytePlus's model-specific pixel limits; Nano resolution/output format
become `image_size`/`image_output_format`; Veo uses its camelCase fields; Kling
v3 uses string duration, `sound=on|off`, and the selected `mode=pro|std`;
legacy Kling routes accept only their exact 5/10-second fields; Seedance uses
`ratio`; Hailuo Pro is fixed to the supported six-second `1080P` combination;
and HappyHorse uses `audio`. Unknown provider parameters are rejected rather
than silently forwarded. ElevenLabs maps Samsar `prompt` to `text` and
`voice` to `voice_id`, and accepts only `mp3_44100_128`; OpenAI speech maps
`prompt` to `input` and `output_format` to `response_format` while preserving
`voice` and optional `instructions`.

GPT Image 2 edit, Nano Banana edit, BRIA eraser, and BRIA generative fill use
their exact edit operations. Nano's multi-output image-set operation bypasses
GMICloud because the route cannot preserve the requested output count.
`BRIA_BACKGROUNDREMOVE` remains omitted because no exact current route was
verified. `WAN2.7PRO` is also omitted because the live GMI route cannot preserve
Samsar's supported aspect ratios. `KLINGTXTTOVID3PRO` remains on Fal/Samsar
because the live GMI text-to-video route has no aspect-ratio field for Samsar's
`1:1`, `16:9`, and `9:16` contract. Other non-curated audio models remain on
existing adapters.

An unsupported model returns `404 GENBLAZE_MODEL_UNSUPPORTED`. This is
intentional: the calling service can continue to the next configured adapter
without sending a request to an approximate model.

## HTTP API

`GET /health/live` confirms that the process is running. `GET /health/ready`
confirms that the credential is loaded and the GenBlaze providers initialized.
Neither endpoint contacts GMICloud or submits a discovery probe.

`GET /v1/models` returns the curated catalog in OpenAI list format.

`POST /v1/chat/completions` accepts an OpenAI-compatible JSON body. The gateway
maps the Samsar model id, invokes GenBlaze, and returns `ChatResponse.raw`
unchanged. Streaming is not exposed because the pinned GMICloud connector does
not implement it.

The media API submits and polls the verified image/video/audio intersections:

```text
POST /v1/media/requests
{
  "model": "SAMSAR_MODEL_ID",
  "modality": "image|video|audio",
  "prompt": "...",
  "input_urls": ["https://public.example/input.png"],
  "params": {}
}

202 {"request_id":"<opaque signed id>","status":"pending"}

GET /v1/media/requests/<opaque signed id>
200 {"status":"pending|succeeded|failed|cancelled","assets":[],"error":null}
```

POST calls the GenBlaze provider's `submit` once. GET calls `poll` once and, on
completion, `fetch_output` once. The opaque id is an AES-GCM-sealed envelope
containing the upstream job id and curated model id, so the gateway needs no job
database and does not block waiting for generation. Media inputs remain public
URLs. Veo maps two inputs to image/last-frame, Seedance maps them to
first/last-frame, Kling maps them to image/image-tail, and HappyHorse maps its
single input to first-frame. Hailuo's optional source maps to first-frame-image,
and the exact legacy Kling routes map one source to image without changing the
external Samsar request shape.

Seedance 2.0 is not included in the curated gateway catalog while its provider
failure rate remains unsuitable for production workflows.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `GMI_API_KEY` | yes | Credential created at <https://console.gmicloud.ai/> |
| `GMI_CHAT_BASE_URL` | no | Tenant/VPC override for the OpenAI-compatible chat endpoint |
| `GMI_BASE_URL` | no | GenBlaze connector override for the media request-queue endpoint |
| `GENBLAZE_UPSTREAM_TIMEOUT_SECONDS` | no | Per-request upstream timeout; defaults to 120 seconds |
| `GENBLAZE_JOB_TOKEN_SECRET` | no | Separate encryption key for opaque media ids; defaults to `GMI_API_KEY` |
| `GENBLAZE_MODEL_CATALOG_PATH` | production | Read-only setup-generated credential/model mapping; an absent path exposes an empty development catalog |

Do not set `GMI_BASE_URL` to GMICloud's chat `/v1` URL; GenBlaze reserves that
variable for the media request queue. Secrets are never returned by the API.

## Local verification

```sh
python3.11 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/pytest -q
```

The GenBlaze license text is retained in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
