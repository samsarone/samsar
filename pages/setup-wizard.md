# Setup Wizard

The setup wizard is the browser-driven local Docker setup path. Node.js and
npm run inside its Docker image and are not required on the host.

Start it from the `samsar` mono-repo root on Linux, macOS, or WSL:

```bash
./setup.sh
```

On Windows, use either native launcher:

```powershell
.\setup.ps1
```

```bat
setup.cmd
```

The launcher requires Docker Engine 20.10.0+, Docker Compose 2.20.0+, and
Buildx on native Linux, and Docker Desktop 4.84.0+ on macOS and Windows.
Missing installations receive current packages. When an existing installation
is below those compatibility floors, the launcher attempts an in-place update
through Docker Desktop, Homebrew, `winget`, or the existing Linux package
channel, as appropriate. It never changes the package family of an existing
Linux installation. macOS 4.84.0 includes the wake-from-sleep VM and VM-wake
API fixes that motivated the Desktop floor; Windows uses the same floor for a
consistent Desktop lifecycle. Set `SAMSAR_SETUP_INSTALL_DOCKER=0` to disable
automatic installation and updates; the launcher then prints a manual update
instruction for an incompatible installation.
Arch users are asked before the required full `pacman -Syu` transaction. WSL
uses Docker Desktop's Windows integration and does not install a second Engine
inside the distribution.
The Linux values are functional compatibility floors; keep Docker on a
current, vendor-supported patch release.
`npm run setup-wizard` remains an optional developer alias.

The command prints setup wizard URLs for localhost and detected private IPs,
and prints a public-IP setup URL only when TCP `8089` responds on that public
address. It also waits for the wizard to respond and attempts to open
`http://localhost:8089` in the default browser on hosts with desktop browser
access. Set `SAMSAR_SETUP_OPEN_BROWSER=0` to skip browser auto-open.

## Wizard Steps

| Step | Screen | What it gathers | Output |
| --- | --- | --- | --- |
| 1 | Providers | Optional OpenRouter key, OpenAI API key, Google Cloud service account JSON/base64 JSON, Kimi K3 API key, Alibaba Cloud key/endpoint, FAL key, ElevenLabs key, Runway key, optional Samsar API key | Provider config and model/action availability. |
| 2 | Services | Processor, setup wizard, image generator, assistant query processor, audio generator, AI video layer generator, video renderer, frames processor, express video listener, logger | Docker service selection and local infrastructure flags. |
| 3 | Mail and Data | Local vs remote MongoDB, local MinIO vs external S3-compatible storage, static CDN URL, CloudFront signing fields, disabled/SMTP/SES mail | Database, storage, media, and mail config. |
| 4 | Domain | Optional nginx reverse proxy, public domain/subdomain, public IP, private IP, optional IP detection, optional firewall port opening, and optional Let's Encrypt SSL for validated public domains | Public or intranet access URLs for Studio and the processor API. |
| 5 | Admin | Organization name and admin/login details | Initial local setup/admin state. |

## Provider Logic

At the top of Providers, **Enter values** remains the default and shows the existing credential fields. **Bash environment** switches those fields to variable references such as `$OPENAI_API_KEY` or `${OPENAI_API_KEY}`. The launcher forwards the standard provider variable names into the isolated setup service; the service resolves and validates them without returning raw values to the browser. To use a custom exported name, include it in `SAMSAR_SETUP_PROVIDER_ENV_NAMES` before launching, for example `SAMSAR_SETUP_PROVIDER_ENV_NAMES=LIVE_DEMO_KEY ./setup.sh`, then enter `$LIVE_DEMO_KEY` for the matching provider.

The wizard presents three provider groups:

| Mode | Providers | Behavior |
| --- | --- | --- |
| Inference Router | OpenRouter | One optional key enables the supported GPT 5.6 Sol, Gemini 3.1 Pro, and Qwen 3.8 Max text and vision inference paths. |
| Native | OpenAI, Google Cloud, Kimi K3, Alibaba Cloud, FAL, ElevenLabs, RunwayML | Use direct provider credentials for the model families they support. Kimi K3 enables `KIMIK3` inference, assistant, strict structured-output, and vision requests. |
| Universal fallback | Samsar API key | Enables all configured Samsar model/action families and can cover stages where native credentials are not provided. |

The provider list mirrors the runtime renderer and writes values that become `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS_JSON_B64`, `KIMI_K3_API_KEY`, `ALIBABA_API_KEY`, `FAL_API_KEY`, `ELEVENLABS_API_KEY`, `RUNWAY_API_KEY`, and `SAMSAR_API_KEY` in `runtime/secrets/root.env`. Kimi validation runs through the processor provider-validation API; its browser field is redacted from persisted session state and must be re-entered after a resumed validation. OpenRouter validation checks authenticated key metadata, rejects management-only keys, and binds setup to a one-hour, single-use credential token. OpenRouter and Alibaba values are stored in mode-`0600` `runtime/secrets/provider.credentials.json`; Kimi is stored in the mode-`0600` runtime config. Validation tokens are excluded from persisted browser state and the copyable config preview. All backend Compose services consume the same `root.env`, so one Kimi secret covers the processor and every inference worker.

For Kimi requests, the provider order is native Kimi followed by Samsar. The exact native model is `kimi-k3` for both inference and vision, and all Kimi requests use high reasoning. OpenRouter is not part of the Kimi fallback chain.

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
| Browser media | Configured processor API (`http://localhost:3002/` by default) | Public CloudFront/CDN URL when external media publishing is enabled. |
| Mail | Disabled | SMTP or AWS SES. |

## Domain and Reverse Proxy

The Domain step is optional. If skipped, Docker keeps the default local URLs and uses the local media tunnel when an external AI provider must fetch locally stored media.

When enabled, the wizard can configure nginx for:

| Access type | Use when | Provider media behavior |
| --- | --- | --- |
| Public domain/subdomain | You have DNS names for Studio and the processor API. Add A records for both names pointing to the machine IP in your DNS provider. | Browser media uses the processor URL; external adapters use the managed tunnel unless external S3/CloudFront is enabled. |
| Public IP | The server has a static public IPv4 address and DNS is not required. The wizard can detect and autofill the machine public IP. Studio uses `http://<public-ip>` and the processor API/media base uses `http://<public-ip>/api`. | Browser media uses the processor URL; external adapters use the managed tunnel unless external S3/CloudFront is enabled. |
| Private IP | The server is reachable only inside an intranet/VPC. The wizard can detect and autofill RFC1918 private IP candidates. Studio uses `http://<private-ip>` and the processor API/media base uses `http://<private-ip>/api`. | Internal users access the processor URL; external adapters use the managed tunnel. |

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
| `runtime/config/available-models.json` | Enabled providers, models, actions, provider key/endpoint types, and derived audio availability. |
| `runtime/secrets/root.env` | Docker env file consumed by services, including the shared `KIMI_K3_API_KEY` for inference consumers. |
| `runtime/secrets/provider.credentials.json` | Mode-`0600` OpenRouter and validated Alibaba provider secrets plus Alibaba key/endpoint type. |
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
