<h1 align="center">
  <a href="https://app.samsar.one">
    <img src="docs/brand/samsar-text-logo.svg" alt="Samsar" width="180">
  </a>
</h1>

<p align="center">
  <strong>Samsar is a generative video and media automation platform for turning prompts, product images, structured content, and creative ideas into finished videos and reusable studio assets.</strong>
</p>

<p align="center">
  It brings together one-shot text-to-video, image-list-to-video, image editing, audio generation, semantic search, recommendations, assistant workflows, multi-provider model routing, and detailed post-production controls across one integrated Studio and API surface.
</p>

<p align="center">
  <a href="https://app.samsar.one"><strong>Production app</strong></a>
  ·
  <a href="https://docs.samsar.one"><strong>Production API docs</strong></a>
  ·
  <a href="https://youtube.com/@samsar_one"><strong>Demo channel</strong></a>
  ·
  <a href="#quick-start"><strong>Setup wizard</strong></a>
</p>

<p align="center">
  <a href="https://github.com/samsarone/samsar/actions/workflows/ci.yml">
    <img src="https://github.com/samsarone/samsar/actions/workflows/ci.yml/badge.svg?branch=main" alt="Tests">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-48e894.svg" alt="MIT License">
  </a>
</p>

<p align="center">
  <a href="#features">Features</a>
  ·
  <a href="#quick-start">Quick start</a>
  ·
  <a href="#visual-workflows">Workflows</a>
  ·
  <a href="#documentation">Documentation</a>
  ·
  <a href="#adapters-models-and-storage">Adapters</a>
  ·
  <a href="#api">API</a>
  ·
  <a href="#deployment-and-operations">Operations</a>
</p>

---

## Features

- **One-shot Studio text-to-video up to 3 minutes** for documentary, infotainment, ed-tech, film summary, custom themes, and original ideas.
- **One-shot image-list-to-video** that turns product images into polished ad videos with optional narrator avatar, outro, and CTA.
- **One-click scene re-rolls after render** to fix small imperfections without rebuilding the full project.
- **Full Studio workspace** for detailed, granular post-processing.
- **Sandboxed local logging**, with logs and traces kept on your machine.
- **Multi-provider model routing** so each operation can use the best available provider and model.
- **Built-in search and recommendations** for creating a generative video library and Studio knowledge base.

## Quick start

Start with [hosted Studio](https://app.samsar.one) or the **[samsar-js client](https://www.npmjs.com/package/samsar-js)**. One Samsar API key connects your application to managed video, image, audio and inference workflows. Move into the setup wizard below when you want your own deployment and supported provider adapters.

| I want to… | Start here | Then explore |
| --- | --- | --- |
| Create in the browser | [Hosted Studio](https://app.samsar.one) | [Visual workflows](#visual-workflows) |
| Build with an API | [Hosted Samsar.js](https://docs.samsar.one/) | [Video](https://docs.samsar.one/video), [images](https://docs.samsar.one/image-api), [chat](https://docs.samsar.one/chat-api), [audio](https://docs.samsar.one/external-requests#audio) |
| Compare models and modalities | [Full model matrix](pages/model-matrix.md) | [Provider and adapter guide](pages/providers-and-models.md) |
| Run my own deployment | Setup steps below | Native inference, Samsar.js and compatible provider adapters |

<details open>
<summary><strong>First API request with hosted Samsar.js</strong></summary>

```bash
npm install samsar-js
```

```js
import SamsarClient from 'samsar-js';

const samsar = new SamsarClient({ apiKey: process.env.SAMSAR_API_KEY });
const available = await samsar.getSupportedTextToVideoModels();
console.log(available.data);

const job = await samsar.createVideoFromText({
  prompt: 'A cinematic product launch in a sunlit gallery.',
  image_model: 'GPTIMAGE2',
  video_model: 'RUNWAYML',
  duration: 30,
  aspect_ratio: '16:9',
});
console.log(job.data.request_id); // Save this ID and poll for completion.
```

Get a key from [Samsar](https://app.samsar.one/account/apiKeys), keep it in your server environment, and follow the [status and delivery contract](https://docs.samsar.one/video#get-status). Hosted requests use Samsar credits; see [pricing](https://docs.samsar.one/pricing). No local Docker installation is needed for this path.

</details>

The following steps install a **standalone deployment**.

### 1. Prepare

- Git.

> [!NOTE]
> Node.js, npm, and Yarn are not host prerequisites for a standalone installation. The setup wizard and its JavaScript tooling run inside Docker.

If you cloned this repository directly, stay at the repository root and continue to step 2.

<details>
<summary><strong>Using this repository as a deployable wrapper around sibling source projects?</strong></summary>

This parent-workspace workflow additionally requires `rsync`, Node.js, and npm:

```bash
cd samsar
npm run sync
```

The sync script excludes common secret and generated paths when copying projects into this monorepo. Skip this workflow in a standalone clone.

It also packages the Vast.ai FLUX.2 standalone utility under
`utils/vast-flux2`. From a synchronized workspace or standalone clone:

```bash
cd utils/vast-flux2
./provision-vast-flux2.sh --check
./provision-vast-flux2.sh --configure-samsar
```

For an already provisioned endpoint, register the latest securely saved
adapter with the running standalone Samsar processor:

```bash
cd utils/vast-flux2
./configure-samsar-custom-image-model.sh
```

The provisioner stores credentials outside the repository under
`~/.config/samsar/vast-flux2` with owner-only permissions. See
`utils/vast-flux2/README.md` for credential setup, URL output, instance
destruction, and advanced options.

</details>

<details>
<summary><strong>How the launcher handles Docker on each platform</strong></summary>

The direct setup launcher checks Docker before continuing:

| Platform | Bootstrap behavior |
| --- | --- |
| Linux | Requires Docker Engine 20.10.0+, Docker Compose 2.20.0+, and Buildx. Missing installations receive current packages; deficient existing installations are updated only through their existing installation channel without changing package families. |
| macOS | Requires Docker Desktop 4.84.0 or newer. Uses an existing compatible installation, or installs/updates it automatically when the Docker Desktop updater or Homebrew is available. |
| Windows | Requires Docker Desktop 4.84.0 or newer. `setup.ps1` detects per-user and all-users installations, uses the Docker Desktop updater or `winget` to install/update it, and runs the launcher through WSL 2 integration. |

Set `SAMSAR_SETUP_INSTALL_DOCKER=0` to disable automatic Docker installation and updates. An incompatible installation then produces a platform-specific manual update instruction instead of being changed.
On macOS without Homebrew, install [Docker Desktop for Mac](https://docs.docker.com/desktop/setup/install/mac-install/).
On Windows without `winget`, install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) and enable WSL 2 integration.
On Linux, the launcher does not replace an existing distro, Snap, rootless, or Docker Desktop installation with a different package family. It updates through a recognized existing channel when that is safe and otherwise links the matching [Docker Engine installation guide](https://docs.docker.com/engine/install/). Docker's convenience installer is used only as a fresh-install fallback, never to upgrade an existing Engine.
Arch requires a full system package upgrade, so the launcher asks for explicit confirmation (or requires `--yes`) before running `pacman -Syu`. Inside WSL, the launcher uses Docker Desktop's Windows integration and never installs or starts a competing in-distribution Engine.
The Linux version numbers are functional compatibility floors, not a recommendation to remain on an old patch; keep Docker on a current, vendor-supported release.

> [!IMPORTANT]
> On macOS, use Docker Desktop 4.84.0 or newer. Earlier releases predate the [4.45.0 wake-from-sleep VM fix](https://docs.docker.com/desktop/release-notes/#4450) and the [4.79.0 VM-wake API 500 fix](https://docs.docker.com/desktop/release-notes/#4790). The launcher verifies the installed app version before starting the setup wizard. When automatic Docker installation is enabled, it attempts an in-place update; otherwise it stops with an upgrade instruction.
>
> Windows uses the same Docker Desktop minimum so launcher behavior stays consistent across Desktop platforms. Native Linux does not contain Docker Desktop's macOS VM/network path; its separate Engine and Compose floors are based on Samsar's runtime and compose-file features.

</details>

### 2. Launch the setup wizard

Linux, macOS, or WSL:

```bash
./setup.sh
```

Windows PowerShell:

```powershell
.\setup.ps1
```

Windows Command Prompt:

```bat
setup.cmd
```

`npm run setup-wizard` remains available as a developer convenience, but is not required for installation.

The launcher installs or starts Docker when supported, builds and starts the containerized setup wizard, waits for it to respond, and opens a one-time authenticated URL on `http://localhost:8089`. The wizard binds to loopback by default; use `scripts/setup-wizard-remote.sh` for remote hosts so access travels through an SSH tunnel. Set `SAMSAR_SETUP_OPEN_BROWSER=0` to skip browser auto-open.

Complete the browser flow to write deployment config, render runtime env and model availability, build and start the selected Docker Compose profiles, publish the local media gateway when required, verify the processor API and Studio client, and prepare local login.

### 3. Open your local services

| Service | URL |
| --- | --- |
| Studio | `http://localhost:3000` |
| Processor API | `http://localhost:3002` |
| Local media through Processor API | `http://localhost:3002/assets_v2/...` |
| MinIO console (local storage mode) | `http://localhost:9001` (loopback; generated credentials in `runtime/secrets/minio.env`) |
| Grafana logs | `http://localhost:4000` (loopback; generated credentials in `runtime/secrets/grafana.env`) |

Stop the stack:

```bash
npm run docker:down
```

<details>
<summary><strong>What the five setup wizard steps configure</strong></summary>

| Step | What it configures | Runtime effect |
| --- | --- | --- |
| Providers | Inference routing, OpenAI, Google Cloud, Kimi K3, Alibaba Cloud, GMICloud through GenBlaze, OpenRouter, FAL, ElevenLabs, RunwayML, Samsar | Validates credentials and controls which models/actions appear in `runtime/config/available-models.json`. |
| Services | Processor, setup wizard, image generator, assistant query processor, audio generator, AI video layer generator, video renderer, frames processor, express video listener, and logger | Determines which Docker service families are enabled for the local runtime. |
| Mail and Data | Local or remote MongoDB, local MinIO, external S3/CloudFront, Backblaze B2, SMTP/SES/disabled mail | Writes database, storage, CDN, media, and mail settings. |
| Domain | Optional nginx reverse proxy for a public domain/subdomain, public IP, or private IP, with optional IP detection, port opening, and Let's Encrypt SSL for validated domains | Enables public or intranet access URLs for Studio and the processor API. |
| Admin | Organization and initial admin/login setup | Prepares Docker setup login and local access details. |

Use manual runtime config when you want direct control over credentials, provider selection, storage URLs, database settings, or mail settings.

[Explore every setup step, validation, generated file, and lifecycle stage →](pages/setup-wizard.md)

</details>

## Visual workflows

The diagrams below show the primary generation and discovery pipelines. Open any workflow to explore it, then select the diagram for its detailed documentation.

<details open>
<summary><strong>Text to Video</strong></summary>

<a href="pages/text-to-video.md">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme-diagrams/readme-text-to-video-pipeline-v3-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/readme-diagrams/readme-text-to-video-pipeline-v3.png">
    <img src="docs/readme-diagrams/readme-text-to-video-pipeline-v3.png" alt="Text-to-video pipeline from request validation through planning, parallel media generation, motion layers, final rendering, and terminal delivery" width="100%">
  </picture>
</a>

</details>

<details>
<summary><strong>Image List to Video</strong></summary>

<a href="pages/image-list-to-video.md">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme-diagrams/readme-image-list-to-video-pipeline-v3-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/readme-diagrams/readme-image-list-to-video-pipeline-v3.png">
    <img src="docs/readme-diagrams/readme-image-list-to-video-pipeline-v3.png" alt="Image-list-to-video pipeline from source preparation through the creative builder, parallel media jobs, motion layers, final rendering, and terminal delivery" width="100%">
  </picture>
</a>

</details>

<details>
<summary><strong>Search Embeddings</strong></summary>

<a href="pages/search.md">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme-diagrams/readme-search-embeddings-pipeline-v3-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/readme-diagrams/readme-search-embeddings-pipeline-v3.png">
    <img src="docs/readme-diagrams/readme-search-embeddings-pipeline-v3.png" alt="Search embeddings with separate index creation and stored-index query lanes, including vector-search and reranking fallbacks" width="100%">
  </picture>
</a>

</details>

<details>
<summary><strong>Recommendations</strong></summary>

<a href="pages/recommendations.md">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/readme-diagrams/readme-recommendations-pipeline-v3-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/readme-diagrams/readme-recommendations-pipeline-v3.png">
    <img src="docs/readme-diagrams/readme-recommendations-pipeline-v3.png" alt="Recommendations as a constrained wrapper over the shared semantic-search pipeline and reusable embedding corpus" width="100%">
  </picture>
</a>

</details>

## Documentation

Follow a workflow from the hosted Samsar.js API into its local deployment details. Each guide retains its endpoint, input, processing and verification sections.

| Workflow / guide | Hosted API reference | Repository guide |
| --- | --- | --- |
| Model matrix | [API overview](https://docs.samsar.one/) · [Models & pricing](https://docs.samsar.one/pricing) | [Every modality, model key and compatible adapter](pages/model-matrix.md) |
| Providers and Models | [Samsar managed provider API](https://docs.samsar.one/external-requests) | [Credentials, native options and routing](pages/providers-and-models.md) |
| Text to Video | [Video API](https://docs.samsar.one/video#post-videotext_to_video) | [Models, pipeline and status](pages/text-to-video.md) |
| Image List to Video | [Image-list API](https://docs.samsar.one/video#post-videoimage_list_to_video) | [Product videos, CTA and narrator settings](pages/image-list-to-video.md) |
| Image Edit | [Image API](https://docs.samsar.one/image-api) · [V2 edits](https://docs.samsar.one/v2#v2-image-edit-routes) | [Generation, enhancement and edits](pages/image-edit.md) |
| Speech, music, sound and lip sync | [Audio](https://docs.samsar.one/external-requests#audio) · [Video operations](https://docs.samsar.one/external-requests#video) | [Audio and performance guide](pages/audio-and-performance.md) |
| Inference and assistants | [Chat](https://docs.samsar.one/chat-api) · [Assistant](https://docs.samsar.one/assistant-api) | [Inference matrix](pages/model-matrix.md#inference) |
| Narrative and branching | [Narrative API](https://docs.samsar.one/narrative) | [Workflow allowlists](pages/providers-and-models.md#model-groups-used-by-video-apis) |
| Search | [Index and search](https://docs.samsar.one/chat-api#post-chatcreate_embedding) | [Templates, filters and indexing](pages/search.md) |
| Recommendations | [Similarity API](https://docs.samsar.one/chat-api#post-chatsimilar_to_embedding) | [Related content and product matching](pages/recommendations.md) |
| Text Enhance | [Enhance API](https://docs.samsar.one/chat-api#post-chatenhance) | [Inputs, billing and inference](pages/text-enhance.md) |
| Accounts and delivery | [External users](https://docs.samsar.one/external-users) · [Credits](https://docs.samsar.one/credits) · [Publications](https://docs.samsar.one/publications) | [Architecture](pages/architecture.md) |
| Setup and operations | [V2 API](https://docs.samsar.one/v2) | [Setup wizard](pages/setup-wizard.md) · [Architecture](pages/architecture.md) |

## Platform

### Repository layout

| Area | Directory | Purpose |
| --- | --- | --- |
| Studio app | `apps/samsar-client` | Samsar Studio and VidGenie frontend. Runs on port `3000` in Docker. |
| Setup wizard | `apps/setup-wizard` | Browser setup flow for providers, services, data, mail, and admin configuration. Runs on port `8089` when started. |
| Processor API | `services/processor` | Public API, Studio API, auth, billing, session orchestration, search/recommendation APIs, and status endpoints. Runs on port `3002`. |
| Generation workers | `services/generator`, `services/ai-video-layer-generator`, `services/video-generator`, `services/audio-generator`, `services/frames-processor` | Image generation/editing, AI video layers, final rendering, speech/music/sound effects, frame processing, and media processing. |
| Workflow workers | `services/express-video-listener`, `services/assistant-query-processor`, `services/task-processor` | Express video state machine, assistant queries, and scheduled/background tasks. |
| Provider gateway | `services/genblaze-gateway` | Local GenBlaze gateway for credential-scoped GMICloud inference and media models. |
| Runtime config | `runtime/config`, `runtime/secrets` | Generated deployment config, model availability, env files, and local secrets. Not committed. |
| Deployment | `deploy/compose` | Docker Compose stack and local deployment configuration. |
| Docs | `docs`, `pages` | Runtime notes, brand assets, and deeper Markdown documentation linked from this README. |

<details>
<summary><strong>View the Docker deployment architecture</strong></summary>

<a href="pages/architecture.md">
  <img src="assets/docker-deployment-architecture.png" alt="Docker deployment architecture" width="100%">
</a>

</details>

## Adapters, models, and storage

Start with the **Samsar.js managed adapter** for supported hosted workflows, then add compatible native or provider adapters to a standalone installation. Native inference and custom model endpoints can take precedence for their own models. Documentation order does not change the runtime’s configured routing.

### Model adapters

[Samsar.js](https://www.npmjs.com/package/samsar-js) is the common client and hosted service entry point. Supported deployment options include [OpenAI](https://platform.openai.com/docs/overview), [Anthropic](https://platform.claude.com/docs/en/api/overview), [Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs), [Kimi](https://platform.kimi.ai/docs/overview), [Alibaba Cloud](https://www.alibabacloud.com/help/en/model-studio/), [GMICloud](https://docs.gmicloud.ai/) through [GenBlaze](https://github.com/backblaze-labs/genblaze), [fal](https://fal.ai/docs/documentation), [OpenRouter](https://openrouter.ai/docs/quickstart), [ElevenLabs](https://elevenlabs.io/docs/overview/intro), and [Runway](https://docs.dev.runwayml.com/).

### Supported models by capability

The [complete model matrix](pages/model-matrix.md) lists **all 46 model keys in the standalone setup registry**, plus the additional Studio catalog, custom endpoints and managed service models. Each row includes the request key, hosted path, supported adapters, workflow scope and usage notes.

| Modality | Models in the deployment registry | Explore and build |
| --- | --- | --- |
| Inference & vision | GPT 6 Astra, Claude Opus 5.5, Gemini 3.1 Pro, Kimi K3, Qwen 3.8 Max | [Matrix](pages/model-matrix.md#inference) · [Hosted chat](https://docs.samsar.one/external-requests#chat) |
| Image generation | GPT Image 2.5, Seedream 5 Pro, Nano Banana 2 / Pro, Qwen Image 3.0 Pro, Wan 2.7 Pro | [Matrix](pages/model-matrix.md#image) · [Image API](https://docs.samsar.one/image-api) |
| Image editing | GPT Image 2.5 Edit, Nano Banana 2 / Pro Edit, BRIA Eraser / GenFill | [Matrix](pages/model-matrix.md#image-edit) · [Edit API](https://docs.samsar.one/v2#v2-image-edit-routes) |
| Video generation | Runway; Veo 3.1 text / fast / I2V / first-last-frame; Cosmos 3; Seedance 1.5 / 2.0 / 2.5; Kling 3 / 1.6 / 2.1 variants; Hailuo; Happy Horse 1.1 | [Every video key](pages/model-matrix.md#video) · [Video API](https://docs.samsar.one/video) |
| Speech | OpenAI TTS, Google TTS, ElevenLabs | [Matrix and request values](pages/model-matrix.md#speech) · [Audio API](https://docs.samsar.one/external-requests#audio) |
| Music | Lyria 3, ElevenLabs Music | [Matrix](pages/model-matrix.md#music) · [Audio API](https://docs.samsar.one/external-requests#audio) |
| Lip sync | Sync, LatentSync, Kling, Hummingbird, Creatify | [Matrix](pages/model-matrix.md#lip-sync) · [Video operations](https://docs.samsar.one/external-requests#video) |
| Sound effects | MMAudio V2, Mirelo AI; hosted audio also exposes SDAUDIO | [Matrix](pages/model-matrix.md#sound) · [Audio and performance](pages/audio-and-performance.md) |
| Embeddings & search | Managed OpenAI embeddings (`text-embedding-3-large`) | [Matrix](pages/model-matrix.md#embeddings) · [Search](pages/search.md) |
| Transcript alignment | Managed Whisper (`whisper-1`) | [Matrix](pages/model-matrix.md#transcription) · [Audio API](https://docs.samsar.one/external-requests#audio) |

<details>
<summary><strong>Understand model keys, workflow support and native exceptions</strong></summary>

- **Stable keys:** `GPTIMAGE2` now identifies GPT Image 2.5; `SEEDREAM` maps to Seedream 5 Pro; `HAPPYHORSEI2V` maps to Happy Horse 1.1 I2V. Use Samsar keys rather than an upstream provider ID.
- **Inference aliases:** current requests use `gpt-6-astra`; older setup files can contain `gpt-5.6-sol`, which the processor normalizes. `KIMIK3` is the setup key; use `kimi-k3` in inference requests.
- **Workflow scope:** the complete Studio catalog is larger than the Express and branching allowlists. A model listed for image generation is not automatically selectable for an Express scene.
- **Native-only model:** `QWENIMAGE3PRO` needs Alibaba Cloud standard pay-as-you-go credentials. It is not enabled by a Samsar key or Alibaba Token Plan.
- **Credential-scoped model routes:** GenBlaze enables only exact validated GMICloud mappings. Legacy GPT Image 2 mappings do not satisfy the GPT Image 2.5 contract.
- **Speech values:** Express uses `tts_model: 'OPENAI'`, `'GOOGLE'` or `'ELEVENLABS'`, not the setup labels `OPENAI_TTS` and `GOOGLE_TTS`.

</details>

### Minimal adapter setup

For hosted use, create a [Samsar API key](https://app.samsar.one/account/apiKeys) and initialize `samsar-js`. For standalone use, open **Providers** in `./setup.sh`, configure Samsar and any required native/provider keys, and validate them. The wizard writes secrets and computes deployment availability. **Settings → Model Adapters** controls supported per-model preference order.

| Path / adapter | What you supply | What to expect |
| --- | --- | --- |
| **Samsar.js** | `SAMSAR_API_KEY` | Managed routes for supported models using Samsar credits. [API reference](https://docs.samsar.one/external-requests). |
| Native inference | OpenAI, Anthropic, Google, Kimi or Alibaba credentials for the selected model | Native-first paths where supported. [Provider setup](pages/providers-and-models.md#provider-matrix). |
| Media adapters | Supported Google, OpenAI, Runway, fal, Alibaba or ElevenLabs credentials | Only the models and operations mapped to that adapter. [Per-model matrix](pages/model-matrix.md). |
| GMICloud through GenBlaze | `GMI_API_KEY` and validated model mappings | Credential-specific inference/media routes through the local gateway. [Gateway details](services/genblaze-gateway/README.md). |
| Custom model endpoint | Compatible endpoint and authorization | Your own registered adapter, including optional [Vast.ai FLUX.2](utils/vast-flux2/README.md). |

`npm run config:render` writes backend environment files and `runtime/config/available-models.json`. Studio and the Express API filter models using the current deployment configuration. Keep credentials in server-side secrets.

See [Providers and Models](pages/providers-and-models.md) for routing and exceptions. Seedance 2.5 uses 5-, 10- or 15-second 720p scene renders; hosted production uses GMICloud internally, while standalone follows the selected supported adapter.

### Storage adapters

<p align="center">
  <img src="https://img.shields.io/badge/MinIO-C72E49?logo=minio&amp;logoColor=white" alt="MinIO">
  <img src="https://img.shields.io/badge/S3_%2F_CloudFront-FF9900?logo=amazons3&amp;logoColor=white" alt="S3 and CloudFront">
  <img src="https://img.shields.io/badge/Backblaze_B2-E21E29?logo=backblaze&amp;logoColor=white" alt="Backblaze B2 Cloud Storage">
</p>

Choose one option under **Mail & Data → Media storage** in the setup wizard.

| Adapter | Wizard option | Configuration |
| --- | --- | --- |
| MinIO | **Local MinIO** | No cloud credentials. Starts the bundled S3-compatible service with bucket `samsar-resources`; media remains local and is served through the Processor API. |
| S3-compatible / AWS S3 | **External S3 / CloudFront** | Enter bucket, region, access key, secret key, and an HTTPS public CDN base URL. Add an endpoint for non-AWS S3, enable path-style URLs when required, and optionally add CloudFront signing keys. |
| Backblaze B2 Cloud Storage | **Backblaze B2** | Create a public bucket, then enter bucket name, Application Key ID, Application Key value, and its endpoint such as `s3.us-east-005.backblazeb2.com`. The wizard derives the public bucket URL and verifies region, bucket access, and `writeFiles`. Master keys upload through the native B2 API; standard application keys use the S3-compatible API. |

External S3 and B2 publish media for remote model providers. MinIO keeps media local and starts the local media tunnel automatically when a configured provider needs a public URL.

## API

Use **samsar-js** against `https://api.samsar.one/v1` for hosted workflows. The routes below are also served by the standalone processor at `http://localhost:3002`. To target it with the SDK, set `baseUrl: 'http://localhost:3002/v1'` and use credentials accepted by that processor. Auth accepts a Samsar API key, auth token, or app key where supported by the route. See the linked [API reference](https://docs.samsar.one/) for each contract.

The Studio one-shot flow exposes durations up to 3 minutes; the text-to-video API accepts requests from 10 to 240 seconds.

| Workflow | Main endpoints | Notes |
| --- | --- | --- |
| Health | `GET /v1/chat/health`, `GET /v1/image/health`, `GET /v1/video/health`, `GET /v2/health` | Per-route health checks for local verification. |
| Supported video models | `GET /v1/video/supported_models` | Returns text-to-video and image-list-to-video model lists filtered by deployment availability. |
| Text enhance | `POST /v1/chat/enhance` | Enhances copy from `message`, optional `metadata`, `language`, and `maxwords`. |
| Search indexing | `POST /v1/chat/create_embedding`, `POST /v1/chat/create_embedding_from_url`, `POST /v1/chat/generate_embeddings_from_plain_text` | Creates reusable embedding templates from records, URLs, or plain text. |
| Search query | `POST /v1/chat/search_against_embeddings` | Searches a template with `search_term`, filters, and optional reranking. |
| Recommendations | `POST /v1/chat/similar_to_embeddings` | Returns similar records from a template using text or structured search JSON. |
| Assistant workflows | `POST /v1/assistant/*`, `POST /v2/assistant/*` aliases | Runs assistant queries through the processor and configured inference provider. |
| Image edit/generation | `POST /v1/image/text_to_image`, `POST /v1/image/enhance`, `POST /v1/image/remove_branding`, `POST /v1/image/add_image_set` | Queues image sessions and returns request IDs for polling. |
| Image status | `GET /v1/image/status?request_id=...`, `GET /v1/image/list` | Polls and lists image API sessions. |
| Text-to-video | `POST /v1/video/text_to_video`, `POST /v2/text_to_video` | Requires prompt, image model, video model, and duration from 10 to 240 seconds. |
| Image-list-to-video | `POST /v1/video/image_list_to_video`, `POST /v2/image_list_to_video` | Uses image URLs, prompt/metadata, selected models, aspect ratio, and optional CTA/outro/footer/narrator settings. |
| Video status | `GET /v2/status`, `GET /v2/status_detailed`, `GET /v1/external_users/status` | Status endpoints support request IDs/session IDs; terminal provider/model failures include the exact stored error, with failed layer details in `status_detailed`. |

## Deployment and operations

<details>
<summary><strong>Manual Docker setup</strong></summary>

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

</details>

<details>
<summary><strong>Docker Compose profiles, volumes, and maintenance</strong></summary>

Validate the rendered Compose configuration:

```bash
npm run docker:config
```

`npm run docker:up` renders `runtime/secrets/root.env`, durable infrastructure credential env files, and `runtime/config/available-models.json`, then initializes authenticated MongoDB and starts the local default profiles. The setup wizard adds the reverse-proxy profile only when nginx access is enabled.

| Profile | Services |
| --- | --- |
| `core` | `client`, `processor` |
| `workers` | `generator`, `audio-generator`, `frames-processor`, `video-generator`, `ai-video-layer-generator`, `express-video-listener`, `assistant-query-processor`, `task-processor` |
| `local-mongo` | `mongo` |
| `minio` | `minio` |
| `genblaze` | `genblaze` (enabled only with a validated GMICloud provider) |
| `local-media` | `media-gateway`, `media-tunnel-controller` |
| `logger` | `loki`, `promtail`, `grafana` |
| `reverse-proxy` | Optional `reverse-proxy` nginx service when enabled by the setup wizard. |

Run `npm run docker:setup-assets` whenever fonts or logger config need to be refreshed. It installs subtitle/render fonts into `runtime/fonts`, copies them into running Samsar service containers, and recreates Promtail/Grafana only when `services.logger` is enabled.

Persistent Docker state is stored in `mongo-data`, `minio-data`, `media-assets`, `media-assets-v2`, `persistent-data`, `loki-data`, `promtail-data`, and `grafana-data`.

Inspect logs:

```bash
docker compose -f deploy/compose/docker-compose.yml logs -f processor client
```

Rebuild and replace only the frontend container:

```bash
docker compose -f deploy/compose/docker-compose.yml --profile core build client
docker compose -f deploy/compose/docker-compose.yml --profile core up -d --force-recreate --no-deps client
```

When making changes during an active generation session, prefer restarting only the affected client or API container.

> **Active jobs:** Avoid restarting generation workers while a video, audio, or sound-effect job is active unless you have confirmed the worker is stuck or the job can safely resume.

</details>

<a id="local-media"></a>

<details>
<summary><strong>Local media URLs and remote-provider access</strong></summary>

In local Docker, completed render URLs are expected to look like:

```text
http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4
```

That browser URL is served by the configured processor API from the mounted media volume. It is not an S3 or CloudFront URL unless external media publishing is enabled in runtime config.

When a remote provider must fetch local-only media, the `local-media` profile starts a Compose-managed Cloudflared controller. It starts a quick tunnel when runtime config enables a remote media consumer, validates the exact media-gateway health marker, atomically publishes `localMediaTunnel.publicUrl`, and replaces the tunnel when health checks fail or a worker writes the shared refresh marker. It does not mount the Docker socket or depend on the setup-wizard process.

For a manual runtime, start or recreate only the local-media services:

```bash
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml \
  --profile local-media up -d --build \
  media-gateway media-tunnel-controller
```

Inspect its lifecycle and current URL:

```bash
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml \
  --profile local-media logs -f media-tunnel-controller
```

Provider workers reload and validate the published URL before each public adapter request. Browser previews continue to use the configured processor or reverse-proxy URL.

The legacy `scripts/start-local-media-tunnel.sh` command remains a compatibility wrapper that starts and waits for the same Compose services instead of creating a second tunnel container.

</details>

<details>
<summary><strong>Runtime configuration and generated files</strong></summary>

The main config file is `runtime/config/samsar.config.json`. Its local Docker defaults are:

- `database.provider`: `local-mongo`
- `storage.mode`: `local-minio`
- `storage.provider`: `s3-compatible`
- `storage.backend`: `minio`
- `storage.staticCdnUrl`: `http://localhost:3002/`
- `storage.externalMediaPublishEnabled`: `false`
- `publicUrls.clientApp`: `http://localhost:3000`
- `publicUrls.processorApi`: `http://localhost:3002`
- `publicUrls.media`: `http://localhost:3002`
- `reverseProxy.enabled`: `false`

Enable only the providers you intend to use, then rerender:

```bash
npm run config:render
```

For a manual Alibaba Cloud setup, enable the provider in `runtime/config/samsar.config.json` and save this as `runtime/secrets/provider.credentials.json`:

```json
{
  "version": 1,
  "alibabaCloud": {
    "apiKey": "<alibaba-model-studio-api-key>",
    "apiHost": "https://workspace-id.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
  }
}
```

Protect it with `chmod 600 runtime/secrets/provider.credentials.json` before rendering. The setup wizard performs these steps automatically after validating the credentials.

Generated files:

- `runtime/secrets/root.env`: env consumed by Docker services.
- `runtime/secrets/application.env`: generated application signing and custom-adapter encryption secrets.
- `runtime/secrets/mongo.env`: generated local MongoDB root and application credentials. Services use the application account through the authenticated `MONGO_URL` in `root.env`.
- `runtime/secrets/minio.env`: generated local MinIO administrator credentials.
- `runtime/secrets/grafana.env`: generated Grafana administrator credentials.
- `runtime/secrets/provider.credentials.json`: setup-wizard-managed provider keys and validated endpoints. Keep it private and mode `0600`.
- `runtime/config/available-models.json`: model/action availability derived from enabled providers.
- `runtime/config/model-adapter-preferences.json`: standalone-admin adapter order overrides saved from **Settings → Model Adapters**. Config rendering preserves this file.

See [Architecture](pages/architecture.md) for storage and deployment defaults and [Providers and Models](pages/providers-and-models.md) for credential, availability, and fallback behavior.

</details>

### External access

> [!WARNING]
> Public reverse-proxy and domain access are disabled by default, but Docker publishes the Studio and processor ports on the host. Use host firewall rules or localhost-only Docker port bindings when the stack must not be reachable from other networks.

The setup wizard can optionally enable nginx for a public domain/subdomain, public IP, or private IP. For public domain access, add A records for the Studio and processor domains pointing to the machine IP in your DNS provider. For public/private IP access, the wizard can detect IP candidates and uses one machine IP: Studio at `http://<ip>` and the processor/media base at `http://<ip>/api`. For production deployment, non-SSL access needs port `80`; Let's Encrypt SSL setup uses ports `80` and `443`, then closes port `80` if Samsar opened it. The wizard can try to manage these host firewall rules automatically on supported Linux hosts.

Set a strong setup/admin password first and restrict access with HTTPS, firewall rules, and authentication.

For custom enterprise deployments behind a VPS, private network, or managed ingress, contact [hello@samsar.one](mailto:hello@samsar.one).

## Development

Run the fast, dependency-free test suite:

```bash
npm test
```

Validate the generated runtime files and full Docker Compose deployment configuration:

```bash
npm run test:deployment
```

GitHub Actions runs both checks for pull requests into `main` and pushes to `main`.

> [!CAUTION]
> Do not commit runtime credentials, generated assets, local uploads, dependency folders, or build output.

## Troubleshooting

<details>
<summary><strong>A local Docker page fails on first navigation</strong></summary>

If a local Docker page fails only on first navigation with a dynamic import error, the browser is usually holding an old frontend build while the container serves a newer build. Refresh the tab. The Docker client server also returns a reload module for missing hashed JS chunks so stale tabs can recover automatically.

</details>

<details>
<summary><strong>Local downloads open in a new tab</strong></summary>

Confirm the processor API can serve the mounted asset:

```bash
curl -I http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4
```

</details>

<details>
<summary><strong>Remote generation providers cannot fetch local media</strong></summary>

Open [Local media URLs and remote-provider access](#local-media), then inspect the Compose-managed tunnel lifecycle and current URL. Provider workers validate the exact asset and wait for a refreshed tunnel before dispatching.

</details>

<details>
<summary><strong>Grafana runs on a remote Docker host</strong></summary>

Set `GRAFANA_ROOT_URL` and optionally `GRAFANA_DOMAIN`, `GRAFANA_PORT`, or `LOKI_PORT` before starting Compose.

</details>

---

<p align="center">
  <a href="https://www.samsar.one/blog/">Blog</a>
  ·
  <a href="mailto:hello@samsar.one">Enterprise deployments</a>
</p>
