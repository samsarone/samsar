# Image Edit

The image API supports text-to-image, image enhancement, branding removal, image-list expansion into a generated set, title assignment, rollup banners, and status/listing endpoints. Requests are accepted by the processor and fulfilled by image generation workers.

## Docker Services

| Service | Role |
| --- | --- |
| `processor` | Auth, validation, credit charge, ImageGeneration record creation, status and listing. |
| `generator` | Picks up image generation/edit sessions and calls configured image providers. |
| `mongo` | Image session, global session, user, and credit state. |
| `minio` and `media-gateway` | Local storage and public media URLs. |

## Main Endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/image/text_to_image` | Generate one or more images from a text prompt. Aliases: `/v1/image/generate`, `/v1/image/generations`. |
| `POST /v1/image/enhance` | Enhance/upscale an existing image URL. |
| `POST /v1/image/remove_branding` | Queue an edit that removes branding/watermark-like content from an image URL. |
| `POST /v1/image/add_image_set` | Expand a list of input images into a generated image set. |
| `POST /v1/image/assign_title` | Generate a title for an image from URL, multipart file, or raw image upload. |
| `GET /v1/image/status?request_id=...` | Poll image request status. |
| `GET /v1/image/list` | List image sessions for the authenticated user. |

`v2` delegates are also available for common external image routes, including `/v2/image/enhance`, `/v2/image/remove_branding`, `/v2/image/add_image_set`, `/v2/image/text_to_image`, and `/v2/external/image/status`.

## Text to Image

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `prompt` | Yes | Source prompt. |
| `aspect_ratio` or `aspectRatio` | No | Defaults to `1:1`. |
| `model` or `mode` | No | Defaults to `NANOBANANA2`. |
| `num_images` or `numImages` | No | Positive number, defaults to one image. |
| `metadata` | No | Stored with the image request. |

The route creates an `ImageGeneration` record with operation type `GENERATE` and returns request/session identifiers for status polling.

## Enhance

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `image_url` | Yes | Existing image to enhance. |
| `resolution` | No | One of `0.5k`, `1k`, `2k`, `4k`. Defaults to `1k`. |
| `aspect_ratio` | No | Ratio string such as `16:9`, `9:16`, or `1:1`. Defaults to `16:9`. |

The current route queues mode `NANOBANANA2EDIT`.

## Branding Removal

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `image_url` | Yes | Existing image to edit. |

The current route queues mode `NANOBANANA2EDIT`.

## Image Set Expansion

Request fields:

| Field | Required | Meaning |
| --- | --- | --- |
| `image_urls` | Yes | Non-empty array of image URLs. |
| `num_images` | Yes | Target output count. |
| `prompt` | No | User prompt to guide the generated set. |
| `metadata` | No | Context used for prompt generation. |
| `aspect_ratio` | No | Defaults to `1:1`. |

The processor first describes input images, builds a generation prompt, and queues an edit request with case type `image_list_to_image_set`.

## Status and Listing

Use status polling after any queued image request:

```text
GET /v1/image/status?request_id=<request-id>
```

List sessions:

```text
GET /v1/image/list?case_type=image_enhance
```

Optional list query fields include `limit`, `case_type`, `rollup_ready`, and `include_rollup_ready`.

## Provider Availability

Image routes depend on enabled image providers. The setup wizard maps image generation/editing to OpenAI, Google Cloud, FAL, and Samsar fallback model families. In local Docker, rerun `npm run config:render` after changing providers.
