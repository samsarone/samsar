# Setup Wizard

The setup wizard is the browser-driven local Docker setup path. Start it from the `samsar` mono-repo root:

```bash
npm run setup-wizard:docker
```

Open:

```text
http://localhost:8089
```

## Wizard Steps

| Step | Screen | What it gathers | Output |
| --- | --- | --- | --- |
| 1 | Providers | OpenAI API key, Google Cloud service account JSON/base64 JSON, FAL key, ElevenLabs key, Runway key, optional Samsar API key | Provider config and model/action availability. |
| 2 | Services | Processor, setup wizard, image generator, assistant query processor, audio generator, AI video layer generator, video renderer, frames processor, express video listener, logger | Docker service selection and local infrastructure flags. |
| 3 | Mail and Data | Local vs remote MongoDB, local MinIO vs external S3-compatible storage, static CDN URL, CloudFront signing fields, disabled/SMTP/SES mail | Database, storage, media, and mail config. |
| 4 | Admin | Organization name and admin/login details | Initial local setup/admin state. |

## Provider Logic

The wizard has two provider modes:

| Mode | Providers | Behavior |
| --- | --- | --- |
| Native | OpenAI, Google Cloud, FAL, ElevenLabs, RunwayML | Use direct provider credentials for the model families they support. |
| Universal fallback | Samsar API key | Enables all configured Samsar model/action families and can cover stages where native credentials are not provided. |

The provider list mirrors the runtime renderer and writes values that become `OPENAI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS_JSON_B64`, `FAL_API_KEY`, `ELEVENLABS_API_KEY`, `RUNWAY_API_KEY`, and `SAMSAR_API_KEY` in `runtime/secrets/root.env`.

## Services Catalog

The wizard labels the available software factory services as:

| Category | Services |
| --- | --- |
| Core | Samsar Studio, Image Editor, Processor API, Setup wizard |
| Text API | Search API, Recommendations API |
| Inference | Inference, Assistant |
| Generative media | Image Generation, Video Generation, Lip Sync, TTS, Sound Effects, Music |
| Workers | Image generator, assistant query processor, audio generator, AI video layer generator, video renderer, frames processor, express video listener |
| Infrastructure | Local MongoDB, local MinIO, media gateway, logger |

## Data and Mail Modes

| Setting | Local default | Remote/external option |
| --- | --- | --- |
| Database | `mongodb://mongo:27017/SamsarOne` | A `mongodb://` or `mongodb+srv://` connection string. |
| Storage | MinIO with bucket `samsar-resources` | S3-compatible bucket, endpoint, region, keys, force-path-style flag, and optional CloudFront signing. |
| Public media | `http://localhost:8080/` | `storage.staticCdnUrl` when external media publishing is enabled. |
| Mail | Disabled | SMTP or AWS SES. |

## Setup Run Lifecycle

When the wizard starts setup, the server performs these steps:

| Step | Meaning |
| --- | --- |
| `cleanup` | Clean previous containers. |
| `config` | Save deployment config under `runtime/config/samsar.config.json`. |
| `runtime` | Render `runtime/secrets/root.env` and `runtime/config/available-models.json`. |
| `compose` | Build and start Docker containers. |
| `media` | Publish/verify the local media gateway. |
| `processor` | Verify processor readiness at `/v1/health/ready`. |
| `client` | Verify Studio availability. |
| `login` | Prepare local login/setup redirect. |

Maintenance runs skip the initial cleanup/config flow and execute runtime render, image pull, Compose update/restart, media verification, processor verification, and client verification.

## Files Written

| File | Purpose |
| --- | --- |
| `runtime/config/samsar.config.json` | Main deployment configuration. |
| `runtime/config/available-models.json` | Enabled providers, models, actions, and derived audio availability. |
| `runtime/secrets/root.env` | Docker env file consumed by services. |
| `runtime/secrets/mail.credentials.json` | Sanitized and secret mail configuration when SMTP or SES is configured. |

## When to Use Manual Config Instead

Use the manual config path when you need deterministic reviewable changes to `runtime/config/samsar.config.json`, when you are testing provider edge cases, or when you are deploying to non-default infrastructure. After editing manually, run:

```bash
npm run config:render
npm run docker:setup-assets
npm run docker:up
```

`npm run docker:setup-assets` is the one-time Docker host preparation step. It installs render/subtitle fonts into `runtime/fonts`, copies them into any running Samsar service containers, and refreshes Loki/Promtail/Grafana only when the logger service is enabled.
