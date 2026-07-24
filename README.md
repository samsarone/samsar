# Samsar

[![Tests](https://github.com/samsarone/samsar/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/samsarone/samsar/actions/workflows/ci.yml)

Samsar is a generative video and media automation platform for turning prompts, product images, structured content, and creative ideas into finished videos and reusable studio assets. It brings together one-shot text-to-video, image-list-to-video, image editing, audio generation, semantic search, recommendations, assistant workflows, multi-provider model routing, and detailed post-production controls across one integrated Studio and API surface.

## Architecture

<!-- README image cache refresh: 2026-07-09 -->

![Text to Video](https://static.samsar.one/unauthenticated/readme/readme-text-to-video-pipeline-v2.png)

![Image List to Video](https://static.samsar.one/unauthenticated/readme/readme-image-list-to-video-pipeline-v2.png)

![Search Embeddings](https://static.samsar.one/unauthenticated/readme/readme-search-embeddings-pipeline-v2.png)

![Recommendations](https://static.samsar.one/unauthenticated/readme/readme-recommendations-pipeline-v2.png)

## Features

- One-shot text-to-video up to 3 minutes for documentary, infotainment, ed-tech, film summary, custom themes, and original ideas.
- One-shot image-list-to-video that turns product images into polished ad videos with optional narrator avatar, outro, and CTA.
- One-click scene re-rolls after render to fix small imperfections without rebuilding the full project.
- Full Studio workspace for detailed, granular post-processing.
- Sandboxed local logging, with logs and traces kept on your machine.
- Multi-provider model routing so each operation can use the best available provider and model.
- Built-in search and recommendations for creating a generative video library and Studio knowledge base.

## Documentation

| Page | Use it for |
| --- | --- |
| [Architecture](pages/architecture.md) | Docker service topology, request flow, runtime config, storage, logging, and deployment modes. |
| [Providers and Models](pages/providers-and-models.md) | Provider credentials, supported model families, fallback behavior, and generated model availability. |
| [Setup Wizard](pages/setup-wizard.md) | UI-driven setup steps, validation, generated files, and Docker setup lifecycle. |
| [Search](pages/search.md) | Embedding-backed indexing, semantic search, filters, and status endpoints. |
| [Recommendations](pages/recommendations.md) | Similarity and recommendation workflows built on embedding templates. |
| [Text Enhance](pages/text-enhance.md) | Copy enhancement endpoint, inputs, billing headers, and inference routing. |
| [Image Edit](pages/image-edit.md) | Image enhancement, branding removal, text-to-image, image set expansion, title generation, and status polling. |
| [Image List to Video](pages/image-list-to-video.md) | Image-list-to-video and ad-style CTA video generation from image URLs plus metadata. |
| [Text to Video](pages/text-to-video.md) | One-shot prompt-to-video generation, model selection, duration limits, and status flow. |

## Layout

| Area | Directory | Purpose |
| --- | --- | --- |
| Studio app | `apps/samsar-client` | Samsar Studio and VidGenie frontend. Runs on port `3000` in Docker. |
| Setup wizard | `apps/setup-wizard` | Browser setup flow for providers, services, data, mail, and admin configuration. Runs on port `8089` when started. |
| Processor API | `services/processor` | Public API, Studio API, auth, billing, session orchestration, search/recommendation APIs, and status endpoints. Runs on port `3002`. |
| Generation workers | `services/generator`, `services/ai-video-layer-generator`, `services/video-generator`, `services/audio-generator`, `services/frames-processor` | Image generation/editing, AI video layers, final rendering, speech/music/sound effects, frame processing, and media processing. |
| Workflow workers | `services/express-video-listener`, `services/assistant-query-processor`, `services/task-processor` | Express video state machine, assistant queries, and scheduled/background tasks. |
| Runtime config | `runtime/config`, `runtime/secrets` | Generated deployment config, model availability, env files, and local secrets. Not committed. |
| Deployment | `deploy/compose` | Docker Compose stack and local deployment configuration. |
| Docs | `docs`, `pages` | Runtime notes, brand assets, and deeper Markdown documentation linked from this README. |

## Tests

Run the fast, dependency-free test suite:

```bash
npm test
```

Validate the generated runtime files and full Docker Compose deployment configuration:

```bash
npm run test:deployment
```

GitHub Actions runs both checks for pull requests into `main` and pushes to `main`.

## Services

| Capability | Primary APIs or surfaces | Docker services involved |
| --- | --- | --- |
| Studio workspace | Browser app at `http://localhost:3000` | `client`, `processor`, media gateway, workers as needed |
| Text-to-video | `POST /v1/video/text_to_video`, `POST /v2/text_to_video` | `processor`, `generator`, `audio-generator`, `ai-video-layer-generator`, `express-video-listener`, `video-generator`, `frames-processor` |
| Image-list-to-video and ad video | `POST /v1/video/image_list_to_video`, `POST /v2/image_list_to_video` | Same express video pipeline, plus image validation and optional CTA/outro/footer generation |
| Image generation and edit | `POST /v1/image/text_to_image`, `POST /v1/image/enhance`, `POST /v1/image/remove_branding`, `POST /v1/image/add_image_set` | `processor`, `generator`, MongoDB, media storage |
| Search | `POST /v1/chat/create_embedding`, `POST /v1/chat/search_against_embeddings` | `processor`, MongoDB, OpenAI embedding credentials |
| Recommendations | `POST /v1/chat/similar_to_embeddings` | `processor`, MongoDB, OpenAI embedding credentials |
| Text enhance | `POST /v1/chat/enhance` | `processor`, configured inference provider, MongoDB for user/session state |
| Assistant workflows | `POST /v1/assistant/*`, `POST /v2/assistant/*` aliases | `processor`, `assistant-query-processor`, configured inference provider |
| Audio, speech, music, sound effects | Studio tools and video generation stages | `audio-generator`, configured OpenAI, Google, ElevenLabs, FAL, or Samsar provider |
| Local media delivery | `http://localhost:3002/assets_v2/...` | `processor`, `minio`, Docker volumes |
| Observability | Grafana at `http://localhost:4000` | `loki`, `promtail`, `grafana` |

## Installation

### **1. Prerequisites**

- Git.
- Node.js 20+ with npm.
- Docker running with the Compose plugin.
- `rsync`, only when syncing source projects from the parent workspace.

Install Docker from the official Docker docs for your platform:

| Platform | Docker install path |
| --- | --- |
| macOS | [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/) |
| Windows | [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) |
| Linux desktop | [Docker Desktop for Linux](https://docs.docker.com/desktop/setup/install/linux/) |
| Linux server / Docker CE | [Docker Engine install](https://docs.docker.com/engine/install/) |
| Linux Compose plugin only | [Docker Compose plugin install](https://docs.docker.com/compose/install/linux/) |

Confirm Docker is installed and running before starting setup:

```bash
docker info
docker compose version
```

From the parent workspace checkout, enter the Samsar deployable monorepo. If you cloned this repository directly, start from the repository root instead.

```bash
cd samsar
```

Sync source projects only when this repository is being used as the deployable wrapper around sibling source projects. Skip this in a standalone clone.

```bash
npm run sync
```

### **2. One-Step Command to Start the Setup Wizard**

```bash
npm run setup-wizard
```

The command builds and starts the setup wizard container, prints localhost/private-IP setup URLs, prints a public-IP setup URL only when TCP `8089` responds on that public address, waits for the wizard to respond, and tries to open `http://localhost:8089` in the default browser on hosts with desktop browser access. Set `SAMSAR_SETUP_OPEN_BROWSER=0` to skip browser auto-open. After you complete the browser flow, the wizard writes deployment config, renders runtime env and model availability, builds and starts the selected Docker Compose profiles, publishes the local media gateway when required, verifies the processor API and Studio client, and prepares local login.

Open the local services after setup completes:

| Service | URL |
| --- | --- |
| Studio | `http://localhost:3000` |
| Processor API | `http://localhost:3002` |
| Local media through Processor API | `http://localhost:3002/assets_v2/...` |
| MinIO console | `http://localhost:9001` |
| Grafana logs | `http://localhost:4000` |

Stop the stack:

```bash
npm run docker:down
```

## Setup Wizard

Use the setup wizard when you want a UI-driven local Docker setup flow. Use the manual `runtime/config/samsar.config.json` flow when you want direct control over credentials, provider selection, storage URLs, database settings, or mail settings.

The wizard follows five configuration steps:

| Step | What it configures | Runtime effect |
| --- | --- | --- |
| Providers | Inference routing, OpenAI, Google Cloud, Alibaba Cloud, FAL, ElevenLabs, RunwayML, Samsar | Controls which models/actions appear in `runtime/config/available-models.json`. |
| Services | Processor, setup wizard, image generator, assistant query processor, audio generator, AI video layer generator, video renderer, frames processor, express video listener, and logger | Determines which Docker service families are enabled for the local runtime. |
| Mail and Data | Local or remote MongoDB, local MinIO or external S3-compatible storage, SMTP/SES/disabled mail | Writes database, storage, CDN, media, and mail settings. |
| Domain | Optional nginx reverse proxy for a public domain/subdomain, public IP, or private IP, with optional IP detection, port opening, and Let's Encrypt SSL for validated domains | Enables public or intranet access URLs for Studio and the processor API. |
| Admin | Organization and initial admin/login setup | Prepares Docker setup login and local access details. |

All provider keys are optional and enable different capabilities. A Samsar API key enables all capabilities and can also be used as a universal fallback with other provider keys.

For Alibaba Cloud, enter the Model Studio API key and, when using a workspace endpoint, its API host or full OpenAI-compatible base URL. The wizard validates the endpoint once before setup, stores the validated credential in `runtime/secrets/provider.credentials.json`, and renders `ALIBABA_API_KEY` and `ALIBABA_API_HOST` only into the backend Docker environment. The key is not retained in browser session storage or written to `runtime/config/samsar.config.json`.

During setup, the wizard saves deployment config, renders runtime env, starts containers, configures the optional reverse proxy, publishes the local media gateway when required, verifies the processor API and client, and prepares local login. See [Setup Wizard](pages/setup-wizard.md) for the detailed lifecycle.

## Manual Docker Setup

Use this path only when you do not want the browser setup wizard to write runtime config for you.

Create a local runtime config:

```bash
mkdir -p runtime/config runtime/secrets
cp -n samsar.config.example.json runtime/config/samsar.config.json
```

Edit `runtime/config/samsar.config.json` for provider enablement, non-secret provider settings, storage, database, and public URLs. Provider credentials can be kept in `runtime/secrets/provider.credentials.json`. The checked-in example is safe for local Docker defaults: local MongoDB, local MinIO-compatible storage, local media gateway, and no external provider enabled.

Render env files:

```bash
npm run config:render
```

Install Docker-visible fonts and prepare the optional local logger stack:

```bash
npm run docker:setup-assets
```

Start the complete local Docker stack:

```bash
npm run docker:up
```

## Providers

Provider availability is explicit. `npm run config:render` reads `runtime/config/samsar.config.json` and the optional `runtime/secrets/provider.credentials.json`, writes `runtime/secrets/root.env`, and generates `runtime/config/available-models.json` from enabled providers. The video API then filters supported model responses through that generated availability file.

| Provider | Enables | Models and families from the setup logic |
| --- | --- | --- |
| Samsar API key | Universal fallback for configured Docker deployments | All configured Docker model families in the setup logic, including `gpt-5.6-sol`, `gemini-3.1-pro`, `QWEN3.7`, chat, assistant, image, image edit, video, audio, lip sync, sound effects, and NanoBanana families. |
| OpenAI | Chat, assistant, image, image edit, audio, moderation, search, recommendations | `gpt-5.6-sol`, `GPTIMAGE2`, `GPTIMAGE2EDIT`, `OPENAI_TTS`. |
| Google Cloud | Gemini, image, image edit, video, audio, moderation | `gemini-3.1-pro`, `VEO3.1I2V`, `VEO3.1I2VFAST`, `LYRIA3`, `GOOGLE_TTS`, `NANOBANANA2`, `NANOBANANA2EDIT`, `NANOBANANAPRO`, `NANOBANANAPROEDIT`. |
| Alibaba Cloud | Native Qwen inference in Docker, plus Alibaba media models | Public model key `QWEN3.7` is available through the native adapter only when `CURRENT_ENV=docker`; Alibaba media-model routing is independent of the hosted Qwen inference rule. |
| FAL | Image, image edit, video, audio, lip sync, sound effects | `SEEDREAM` (Seedream 5 Pro), `NANOBANANA2`, `NANOBANANA2EDIT`, `NANOBANANAPRO`, `NANOBANANAPROEDIT`, VEO via FAL, `COSMOS3SUPERI2V`, `SEEDANCEI2V`, Kling image-to-video, `HAPPYHORSEI2V` (Happy Horse 1.1 I2V), ElevenLabs/PlayAI/CassetteAI/AudioCraft via FAL, `MMAUDIOV2`, `MIRELOAI`, and lip sync model families. |
| ElevenLabs | Speech and music | `ELEVENLABS`, `ELEVENLABS_MUSIC`. |
| RunwayML | Video generation and image-to-video | `RUNWAYML`. |

Provider precedence and deployment-specific routing are documented in [Providers and Models](pages/providers-and-models.md).

## Inference Adapters

The built-in inference adapters normalize stable model selections, text and vision payloads, structured output, timeouts, retries, and provider authorization across the processor and inference workers. They are separate from `configuration.custom_adapters`, which are user-supplied media-operation endpoints for workflows such as text-to-image, image-to-video, speech, music, and sound effects.

Transient external-inference requests retry up to three times after the initial attempt, with exponential backoff and provider `Retry-After` support.

The same adapter contract is used by `processor`, `generator`, `audio-generator`, `ai-video-layer-generator`, `express-video-listener`, and `assistant-query-processor`. This keeps provider selection consistent across chat, assistant, prompt generation, vision analysis, and express-video stages.

### OpenRouter

OpenRouter is an optional inference router for supported GPT, Gemini, and Qwen text/vision workflows. Configure `OPENROUTER_API_KEY` through the setup wizard or `runtime/secrets/provider.credentials.json`; see [Providers and Models](pages/providers-and-models.md) for routing and model details.

## API

All routes below are served by the processor API at `http://localhost:3002` in local Docker. Auth accepts a Samsar API key, auth token, or app key where supported by the route.

| Workflow | Main endpoints | Notes |
| --- | --- | --- |
| Health | `GET /v1/chat/health`, `GET /v1/image/health`, `GET /v1/video/health`, `GET /v2/health` | Per-route health checks for local verification. |
| Supported video models | `GET /v1/video/supported_models` | Returns text-to-video and image-list-to-video model lists filtered by deployment availability. |
| Text enhance | `POST /v1/chat/enhance` | Enhances copy from `message`, optional `metadata`, `language`, and `maxwords`. |
| Search indexing | `POST /v1/chat/create_embedding`, `POST /v1/chat/create_embedding_from_url`, `POST /v1/chat/generate_embeddings_from_plain_text` | Creates reusable embedding templates from records, URLs, or plain text. |
| Search query | `POST /v1/chat/search_against_embeddings` | Searches a template with `search_term`, filters, and optional reranking. |
| Recommendations | `POST /v1/chat/similar_to_embeddings` | Returns similar records from a template using text or structured search JSON. |
| Image edit/generation | `POST /v1/image/text_to_image`, `POST /v1/image/enhance`, `POST /v1/image/remove_branding`, `POST /v1/image/add_image_set` | Queues image sessions and returns request IDs for polling. |
| Image status | `GET /v1/image/status?request_id=...`, `GET /v1/image/list` | Polls and lists image API sessions. |
| Text-to-video | `POST /v1/video/text_to_video`, `POST /v2/text_to_video` | Requires prompt, image model, video model, and duration from 10 to 240 seconds. |
| Image-list-to-video | `POST /v1/video/image_list_to_video`, `POST /v2/image_list_to_video` | Uses image URLs, prompt/metadata, selected models, aspect ratio, and optional CTA/outro/footer/narrator settings. |
| Video status | `GET /v2/status`, `GET /v2/status_detailed`, `GET /v1/external_users/status` | Status endpoints support request IDs/session IDs and detailed external request reporting. |

## Docker Compose

After the setup wizard completes, or after `npm run config:render` in the manual flow, validate the rendered Compose configuration:

```bash
npm run docker:config
```

`npm run docker:up` renders `runtime/secrets/root.env` and `runtime/config/available-models.json`, then starts the local default profiles. The setup wizard adds the reverse-proxy profile only when nginx access is enabled.

| Profile | Services |
| --- | --- |
| `core` | `client`, `processor` |
| `workers` | `generator`, `audio-generator`, `frames-processor`, `video-generator`, `ai-video-layer-generator`, `express-video-listener`, `assistant-query-processor`, `task-processor` |
| `local-mongo` | `mongo` |
| `minio` | `minio` |
| `local-media` | `media-gateway`, `media-tunnel-controller` |
| `logger` | `loki`, `promtail`, `grafana` |
| `reverse-proxy` | Optional `reverse-proxy` nginx service when enabled by the setup wizard. |

Run `npm run docker:setup-assets` during manual setup or whenever fonts/logger config need to be refreshed. The script installs subtitle/render fonts into `runtime/fonts`, copies them into any running Samsar service containers, and recreates Promtail/Grafana only when `services.logger` is enabled so Docker logs are available in local Grafana.

Persistent Docker state is stored in named volumes:

- `mongo-data`
- `minio-data`
- `media-assets`
- `media-assets-v2`
- `persistent-data`
- `loki-data`
- `promtail-data`
- `grafana-data`

To inspect logs:

```bash
docker compose -f deploy/compose/docker-compose.yml logs -f processor client
```

To rebuild and replace only the frontend container:

```bash
docker compose -f deploy/compose/docker-compose.yml --profile core build client
docker compose -f deploy/compose/docker-compose.yml --profile core up -d --force-recreate --no-deps client
```

Avoid restarting generation workers while a video, audio, or sound-effect job is active unless you have confirmed the worker is stuck or the job can safely resume.

## Media URLs

In local Docker, completed render URLs are expected to look like:

```bash
http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4
```

That browser URL is served by the configured processor API from the mounted media volume. It is not an S3 or CloudFront URL unless external media publishing is enabled in runtime config.

If the setup wizard configures a reverse proxy, browser media URLs use that configured processor API origin. Public/private IP installs use one machine IP: Studio is served at `http://<ip>` and processor/media URLs use `http://<ip>/api`. External AI adapters still use the separately managed, validated media tunnel unless external S3/CloudFront publishing is explicitly enabled.

When a remote provider must fetch local-only media from your Docker stack, Samsar needs a public media base URL. The `local-media` profile includes a Compose-managed Cloudflared controller. It starts a quick tunnel when runtime config enables a remote media consumer, validates the exact media-gateway health marker, atomically publishes `localMediaTunnel.publicUrl`, and replaces the tunnel when its health checks fail or a worker writes the shared refresh marker. It does not mount the Docker socket and does not depend on the setup-wizard process.

For a manual runtime, start or recreate only the local-media services with:

```bash
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml \
  --profile local-media up -d --build \
  media-gateway media-tunnel-controller
```

Inspect its lifecycle and the current URL with:

```bash
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml \
  --profile local-media logs -f media-tunnel-controller
```

Provider workers reload and validate the published URL before each public adapter request. The controller keeps `publicUrls.media` on the configured processor/reverse-proxy URL, so the temporary tunnel is never used for browser previews.

The legacy `scripts/start-local-media-tunnel.sh` command remains as a compatibility wrapper; it now starts and waits for these same Compose services instead of creating a second tunnel container.

## Runtime Config

The main config file is:

```bash
runtime/config/samsar.config.json
```

The example config uses local Docker defaults:

- `database.provider`: `local-mongo`
- `storage.provider`: `s3-compatible`
- `storage.staticCdnUrl`: `http://localhost:3002/`
- `storage.externalMediaPublishEnabled`: `false`
- `publicUrls.clientApp`: `http://localhost:3000`
- `publicUrls.processorApi`: `http://localhost:3002`
- `publicUrls.media`: `http://localhost:3002`
- `reverseProxy.enabled`: `false`

Provider enablement is configured under `providers`. Enable only the providers you intend to use, then rerender config:

```bash
npm run config:render
```

For a manual Alibaba Cloud setup, enable the provider in `runtime/config/samsar.config.json` and create the following mode-`0600` secret file. The setup wizard performs these steps automatically after validating the credentials.

```json
{
  "version": 1,
  "alibabaCloud": {
    "apiKey": "<alibaba-model-studio-api-key>",
    "apiHost": "https://workspace-id.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
  }
}
```

Save it as `runtime/secrets/provider.credentials.json`, then run `chmod 600 runtime/secrets/provider.credentials.json` before rendering the runtime config.

Generated files:

- `runtime/secrets/root.env`: env consumed by Docker services.
- `runtime/secrets/provider.credentials.json`: setup-wizard-managed provider keys and validated endpoints. Keep this file private and mode `0600`.
- `runtime/config/available-models.json`: model/action availability derived from enabled providers.

## API Providers

All API provider keys are optional. Add only the credentials needed for the generative features you want to enable. Common minimal setups are:

- `Samsar API key` only
- `Alibaba Cloud` only for native Qwen 3.7 inference and assistant workflows in Docker
- `Alibaba Cloud + Samsar API key` for native Qwen with Samsar fallback in Docker
- `OpenAI + FAL`
- `OpenAI + Samsar API key`
- `Google Cloud service account + FAL`

Provider keys can provide direct or routed inference while still using the Samsar media generation pipeline inside your environment. The setup wizard stores sensitive provider credentials in `runtime/secrets/provider.credentials.json`; `npm run config:render` then renders them into `runtime/secrets/root.env` for backend Docker services only. Do not commit `runtime/` or copy keys into browser/client-side code.

| Provider | Runtime config | How to get the key |
| --- | --- | --- |
| Samsar API key | `providers.samsar.apiKey` -> `SAMSAR_API_KEY` | Go to [app.samsar.one](https://app.samsar.one), register or log in, then open [Billing](https://app.samsar.one/account/billing) to add credits or set up automatic recharge. Open [API Keys](https://app.samsar.one/account/apiKeys), create a new API key, copy it, and paste it into the setup wizard Step 1 field labeled **Samsar universal fallback**. This key can act as the universal fallback for supported model families. |
| OpenAI | `providers.openai.apiKey` -> `OPENAI_API_KEY` | Go to [OpenAI API keys](https://platform.openai.com/api-keys), choose the correct project, create a new secret key, and paste it into the setup wizard or config. The key is shown only once. |
| Google Cloud | `providers.googleCloud.projectId`, `providers.googleCloud.credentialsJsonB64` -> `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS_JSON_B64` | Use a Google Cloud service account JSON key, not a standard API key. In [Google Cloud Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts), create or select a service account with the minimum required permissions for your installation. Leave **Principals with access** blank. Then open **Keys** -> **Add key** -> **Create new key** -> **JSON**. Paste the JSON in the setup wizard, or base64 it for manual config with `base64 < service-account.json | tr -d '\n'`. |
| Alibaba Cloud | `runtime/secrets/provider.credentials.json` -> `ALIBABA_API_KEY`, `ALIBABA_API_HOST` | Create a Model Studio API key in the [Alibaba Cloud Model Studio console](https://modelstudio.console.alibabacloud.com/). In the setup wizard, paste the key and optionally provide the workspace API host, such as `workspace-id.ap-southeast-1.maas.aliyuncs.com`, or its full `/compatible-mode/v1` endpoint. Leave the host blank to use the international Model Studio endpoint. |
| FAL | `providers.fal.apiKey` -> `FAL_API_KEY` | Create a key from the [fal dashboard](https://fal.ai/dashboard/keys) or follow the [fal authentication docs](https://fal.ai/docs/documentation/setting-up/authentication). Samsar uses `FAL_API_KEY`; fal SDK examples may call the same credential `FAL_KEY`. |

## External Access

External IP access is not enabled by default. Keep the Docker stack on localhost unless you intentionally want public access to your generative server.

The setup wizard can optionally enable nginx for a public domain/subdomain, public IP, or private IP. For public domain access, add A records for the Studio and processor domains pointing to the machine IP in your DNS provider. For public/private IP access, the wizard can detect IP candidates and uses a single IP with the processor under `/api`. For production deployment, non-SSL access needs port `80`; Let's Encrypt SSL setup uses ports `80` and `443`, then closes port `80` if Samsar opened it. The wizard can try to manage these host firewall rules automatically on supported Linux hosts. Warning: this allows public access to your instance, so set a strong setup/admin password first and restrict access with HTTPS, firewall rules, and authentication.

For custom enterprise deployments behind a VPS, private network, or managed ingress, contact `hello@samsar.one`.

## Troubleshooting

If a local Docker page fails only on first navigation with a dynamic import error, the browser is usually holding an old frontend build while the container serves a newer build. Refresh the tab. The Docker client server also returns a reload module for missing hashed JS chunks so stale tabs can recover automatically.

If local downloads open in a new tab instead of downloading, confirm the processor API can serve the mounted asset:

```bash
curl -I http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4
```

If remote generation providers cannot fetch local media, confirm the setup wizard remains available to service JIT tunnel-refresh requests. A `samsar-media-tunnel` container should be running; provider workers validate the exact asset and wait for a refreshed tunnel before dispatching.

For a remote Docker host, set `GRAFANA_ROOT_URL` and optionally `GRAFANA_DOMAIN`, `GRAFANA_PORT`, or `LOKI_PORT` before starting Compose.

## Links

Use these public surfaces for the live product, developer reference, publishing, and demo channels.

| Surface | Link | Purpose |
| --- | --- | --- |
| Production app | [app.samsar.one](https://app.samsar.one) | Live Samsar creation workspace for production users. |
| Demo channel | [youtube.com/@samsar_one](https://youtube.com/@samsar_one) | Published demos, product walkthroughs, and generated media examples. |
| Production API docs | [docs.samsar.one](https://docs.samsar.one) | Public API documentation and integration reference. |
| Blog | [blog.samsar.one](https://blog.samsar.one) | Product writing, updates, and long-form publishing. |

## Notes

Do not commit runtime credentials, generated assets, local uploads, dependency folders, or build output. The sync script excludes common secret and generated paths when copying projects into this monorepo.

When making changes during an active generation session, prefer restarting only the affected client or API container. Restart generation workers only after checking logs and confirming the in-flight job can resume safely.
