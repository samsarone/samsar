# Setup Wizard

The setup wizard is the browser-driven local Docker setup path. Start it from the `samsar` mono-repo root:

```bash
npm run setup-wizard
```

The command prints setup wizard URLs for localhost and detected private IPs, and prints a public-IP setup URL only when TCP `8089` responds on that public address. It also waits for the wizard to respond and attempts to open `http://localhost:8089` in the default browser on hosts with desktop browser access. Set `SAMSAR_SETUP_OPEN_BROWSER=0` to skip browser auto-open.

## Wizard Steps

| Step | Screen | What it gathers | Output |
| --- | --- | --- | --- |
| 1 | Providers | Optional OpenRouter key, OpenAI API key, Google Cloud service account JSON/base64 JSON, Alibaba Cloud key/endpoint, FAL key, ElevenLabs key, Runway key, optional Samsar API key | Provider config and model/action availability. |
| 2 | Services | Processor, setup wizard, image generator, assistant query processor, audio generator, AI video layer generator, video renderer, frames processor, express video listener, logger | Docker service selection and local infrastructure flags. |
| 3 | Mail and Data | Local vs remote MongoDB, local MinIO vs external S3-compatible storage, static CDN URL, CloudFront signing fields, disabled/SMTP/SES mail | Database, storage, media, and mail config. |
| 4 | Domain | Optional nginx reverse proxy, public domain/subdomain, public IP, private IP, optional IP detection, optional firewall port opening, and optional Let's Encrypt SSL for validated public domains | Public or intranet access URLs for Studio and the processor API. |
| 5 | Admin | Organization name and admin/login details | Initial local setup/admin state. |

## Provider Logic

The wizard presents three provider groups:

| Mode | Providers | Behavior |
| --- | --- | --- |
| Inference Router | OpenRouter | One optional key enables the supported GPT 5.6 Sol, Gemini 3.1 Pro, and Qwen 3.7 text and vision inference paths. |
| Native | OpenAI, Google Cloud, Alibaba Cloud, FAL, ElevenLabs, RunwayML | Use direct provider credentials for the model families they support. |
| Universal fallback | Samsar API key | Enables all configured Samsar model/action families and can cover stages where native credentials are not provided. |

The provider list mirrors the runtime renderer and writes values that become `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS_JSON_B64`, `ALIBABA_API_KEY`, `FAL_API_KEY`, `ELEVENLABS_API_KEY`, `RUNWAY_API_KEY`, and `SAMSAR_API_KEY` in `runtime/secrets/root.env`. OpenRouter validation checks authenticated key metadata, rejects management-only keys, and binds setup to a one-hour, single-use credential token. OpenRouter and Alibaba values are stored in mode-`0600` `runtime/secrets/provider.credentials.json`, not in browser storage or the general runtime config. Validation tokens are also excluded from persisted browser state and the copyable config preview. All backend Compose services consume the same `root.env`, so a single OpenRouter secret covers every inference worker.

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

## Domain and Reverse Proxy

The Domain step is optional. If skipped, Docker keeps the default local URLs and uses the local media tunnel when an external AI provider must fetch locally stored media.

When enabled, the wizard can configure nginx for:

| Access type | Use when | Provider media behavior |
| --- | --- | --- |
| Public domain/subdomain | You have DNS names for Studio and the processor API. Add A records for both names pointing to the machine IP in your DNS provider. | Public URLs are used for returned media and external AI adapter input media. |
| Public IP | The server has a static public IPv4 address and DNS is not required. The wizard can detect and autofill the machine public IP. Studio uses `http://<public-ip>` and the processor API/media base uses `http://<public-ip>/api`. | Public URLs are used for returned media and external AI adapter input media. |
| Private IP | The server is reachable only inside an intranet/VPC. The wizard can detect and autofill RFC1918 private IP candidates. Studio uses `http://<private-ip>` and the processor API/media base uses `http://<private-ip>/api`. | Internal users can access the instance, but external AI providers still use the media tunnel. |

For production deployment without SSL, the machine must allow inbound access to port `80`. A detected public IP may be only the router or ISP address; Public IP mode is available only when that address can actually reach this machine on port `80`. If the public IP is not reachable, use Private IP for intranet access. SSL setup uses ports `80` and `443`; after certificate setup, the wizard closes port `80` if it opened that firewall rule itself. Any port opened by Samsar setup is recorded under `runtime/reverse-proxy/managed-firewall-ports.json` and closed before setup reset, delete, maintenance recreation, or Docker admin container recreation. Enabling public access exposes your instance, so set a strong admin password before opening it.

If public domains validate successfully, the wizard can optionally request and install a Let's Encrypt certificate. SSL setup requires the domains to resolve to the machine, port `80` to be reachable for certificate validation, and port `443` to be reachable for HTTPS access.

## Setup Run Lifecycle

When the wizard starts setup, the server performs these steps:

| Step | Meaning |
| --- | --- |
| `cleanup` | Clean previous containers. |
| `config` | Save deployment config under `runtime/config/samsar.config.json`. |
| `runtime` | Render `runtime/secrets/root.env` and `runtime/config/available-models.json`. |
| `firewall` | Try to open required nginx reverse proxy ports: `80` for non-SSL, `80` and `443` for SSL. |
| `compose` | Build and start Docker containers. |
| `proxy` | Start nginx, optionally request Let's Encrypt certificates, and validate configured public or private access. |
| `media` | Publish/verify the local media gateway. |
| `processor` | Verify processor readiness at `/v1/health/ready`. |
| `client` | Verify Studio availability. |
| `login` | Prepare local login/setup redirect. |

Maintenance runs skip the initial cleanup/config flow and execute runtime render, image pull, optional firewall update, Compose update/restart, reverse-proxy verification, media verification, processor verification, and client verification.

## Files Written

| File | Purpose |
| --- | --- |
| `runtime/config/samsar.config.json` | Main deployment configuration. |
| `runtime/config/available-models.json` | Enabled providers, models, actions, and derived audio availability. |
| `runtime/secrets/root.env` | Docker env file consumed by services. |
| `runtime/secrets/provider.credentials.json` | Mode-`0600` OpenRouter and validated Alibaba provider secrets. |
| `runtime/secrets/mail.credentials.json` | Sanitized and secret mail configuration when SMTP or SES is configured. |
| `runtime/reverse-proxy/nginx.conf` | Generated nginx config when the reverse proxy feature is enabled or safely disabled. |

## When to Use Manual Config Instead

Use the manual config path when you need deterministic reviewable changes to `runtime/config/samsar.config.json`, when you are testing provider edge cases, or when you are deploying to non-default infrastructure. After editing manually, run:

```bash
npm run config:render
npm run docker:setup-assets
npm run docker:up
```

`npm run docker:setup-assets` is the one-time Docker host preparation step. It installs render/subtitle fonts into `runtime/fonts`, copies them into any running Samsar service containers, and refreshes Loki/Promtail/Grafana only when the logger service is enabled.
