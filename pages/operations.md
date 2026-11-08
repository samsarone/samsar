# Deployment and operations

[README](../README.md) · [Setup wizard](setup-wizard.md) · [Architecture](architecture.md)

Use the [setup wizard](setup-wizard.md) for the first installation. This guide covers manual configuration, storage, media access, and maintenance. The `npm run` commands require Node.js and npm on the host; the direct setup launchers do not.

## Manual configuration

Create a local configuration without overwriting an existing one:

```bash
mkdir -p runtime/config runtime/secrets
cp -n samsar.config.example.json runtime/config/samsar.config.json
```

Edit `runtime/config/samsar.config.json` for provider enablement, database, storage, mail, and public URLs. The example uses local MongoDB, local MinIO, and no enabled external provider. Save provider credentials through the wizard or in the appropriate protected runtime files; see [provider configuration](providers-and-models.md).

```bash
npm run config:render
npm run docker:setup-assets
npm run docker:up
```

The last command starts the wizard and waits for it before building application images. With saved configuration, deployment continues automatically; otherwise finish it in the wizard. Application build failures leave the wizard available. See [setup lifecycle](setup-wizard.md#existing-installations-and-updates).

`docker:setup-assets` installs render/subtitle fonts into `runtime/fonts`, copies them into running service containers, and refreshes logger configuration when logging is enabled. Run it again when those assets change.

### Runtime files

The [generated-file inventory](setup-wizard.md#files-written) describes the config and secret files. Services consume `runtime/secrets/root.env`; model availability is generated in `runtime/config/available-models.json`. Standalone adapter order is saved in `runtime/config/model-adapter-preferences.json` and survives config rendering.

Local defaults include:

| Setting | Value |
| --- | --- |
| `database.provider` | `local-mongo` |
| `storage.mode` / `storage.provider` / `storage.backend` | `local-minio` / `s3-compatible` / `minio` |
| `storage.staticCdnUrl` | `http://localhost:3002/` |
| `storage.externalMediaPublishEnabled` | `false` |
| `publicUrls.clientApp` | `http://localhost:3000` |
| `publicUrls.processorApi` / `publicUrls.media` | `http://localhost:3002` |
| `reverseProxy.enabled` | `false` |

For manual Alibaba Cloud configuration, enable the provider in the main config and add its credentials to `runtime/secrets/provider.credentials.json`, preserving any other provider entries:

```json
{
  "version": 1,
  "alibabaCloud": {
    "apiKey": "<alibaba-model-studio-api-key>",
    "apiHost": "https://workspace-id.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
  }
}
```

Use your validated endpoint and protect the file with `chmod 600 runtime/secrets/provider.credentials.json` before rendering. The wizard performs credential validation and saving for you.

## Storage options

Choose **Mail & Data → Media storage** in the wizard.

| Option | Configuration and behavior |
| --- | --- |
| **Local MinIO** | Bundled S3-compatible service with bucket `samsar-resources`; generated credentials, no cloud account. Browser media is served through the processor. |
| **External S3 / CloudFront** | Bucket, region, keys, and an HTTPS public CDN base URL. Non-AWS stores can supply an endpoint and path-style URLs; CloudFront signing is optional. |
| **Backblaze B2** | Public bucket, Application Key ID/value, and endpoint such as `s3.us-east-005.backblazeb2.com`. The wizard derives the bucket URL and validates region, access, and `writeFiles`. Master keys use native B2 uploads; standard application keys use the S3-compatible API. |

External S3 and B2 publish media for remote model providers. Local MinIO uses the media tunnel when a configured remote provider needs a public URL.

## Commands and persistent data

| Command | Behavior |
| --- | --- |
| `npm run docker:config` | Render and validate Compose configuration. |
| `npm run docker:up` | Start the wizard, then build/deploy saved configuration. |
| `npm run docker:update` | Rebuild and replace changed services. |
| `npm run docker:restart` | Rebuild the configured stack, preserving volumes. |
| `npm run docker:down` | Stop the stack, preserving volumes. |
| `npm run docker:maintenance` | Rebuild with HTTP available and job consumers disabled. |
| `npm run docker:check` / `npm run docker:watch` | Inspect Docker health without restarting it. |

Maintenance persists until explicitly disabled. Read [maintenance and recovery](../docs/docker-runtime-recovery.md) for resume commands, opt-in recovery, and production scope.

[Compose profiles](architecture.md#compose-profiles) select services. Persistent state uses `mongo-data`, `minio-data`, `media-assets`, `media-assets-v2`, `persistent-data`, `loki-data`, `promtail-data`, and `grafana-data`.

Inspect application logs:

```bash
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml logs -f processor client
```

Rebuild only the frontend:

```bash
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml --profile core build client
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml --profile core up -d --force-recreate --no-deps client
```

Avoid restarting generation workers during active jobs unless you have confirmed they can safely resume. Prefer replacing only the affected client or API container.

## Local media

Completed local render URLs normally look like:

```text
http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4
```

The processor serves that browser URL from the mounted media volume. External object storage/CDN URLs are used when external media publishing is enabled.

When a remote provider needs local-only media, the `local-media` profile runs a media gateway and a Cloudflared controller. The controller checks the gateway health marker, publishes `localMediaTunnel.publicUrl` atomically, and replaces unhealthy tunnels. It also responds to worker refresh requests and does not mount the Docker socket or depend on the wizard process.

Start or recreate those services:

```bash
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml --profile local-media \
  up -d --build media-gateway media-tunnel-controller
```

Inspect the tunnel lifecycle and current URL:

```bash
docker compose --env-file runtime/secrets/root.env \
  -f deploy/compose/docker-compose.yml --profile local-media \
  logs -f media-tunnel-controller
```

Workers reload and validate provider-visible URLs before dispatch. Browser previews keep using the configured processor or reverse-proxy URL. The legacy `scripts/start-local-media-tunnel.sh` command delegates to these same Compose services.

## External access

Studio and processor ports are published on the host even when the optional reverse proxy is disabled. Use firewall rules or localhost-only bindings to restrict access.

The wizard can configure nginx for a public domain, public IP, or private IP. Domain installs need DNS A records pointing to the host. IP installs use `http://<ip>` for Studio and `http://<ip>/api` for the processor/media base. Set a strong admin password before opening access.

Non-SSL public access needs port `80`. Let's Encrypt setup uses `80` and `443`, then closes `80` if Samsar opened it. See [domain and reverse proxy setup](setup-wizard.md#domain-and-reverse-proxy) for detection, supported firewall automation, and HTTPS behavior. For remote wizard access, use [the SSH tunnel launcher](setup-wizard.md#local-access).

## Source workspace sync

This workflow applies when the monorepo sits beside its original source projects. It requires `rsync`, Node.js, and npm. Skip it in a standalone clone.

Run from the monorepo root:

```bash
npm run sync
```

The sync excludes common secret and generated paths. To sync, start the wizard, and rebuild the configured local stack in one command:

```bash
npm run sync:restart
```

All image builds finish before application containers are replaced; data volumes are preserved. A fresh install leaves configuration and deployment to the wizard. `npm run docker:restart` follows the same flow without a source sync.

Use `develop` for integration, then merge validated changes into `main` through a pull request. Make service changes in their original source projects before syncing.

The sync also packages the [Vast.ai FLUX.2 utility](../utils/vast-flux2/README.md). Its guide covers provisioning, registering a custom adapter, credential storage outside the repository, and instance destruction.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| First navigation fails with a dynamic import error | Refresh the tab; it may hold an older frontend build. The client server also supplies a reload module for missing hashed chunks. |
| A download opens a new tab or media is missing | Confirm the processor can serve the mounted file with `curl -I http://localhost:3002/assets_v2/video/output/<session-id>/<file>.mp4`. |
| A remote provider cannot fetch local media | Inspect the [media tunnel](#local-media) logs and current URL. Workers validate the exact asset and wait for a refreshed tunnel before dispatch. |
| Grafana runs on a remote Docker host | Set `GRAFANA_ROOT_URL` and, where needed, `GRAFANA_DOMAIN`, `GRAFANA_PORT`, or `LOKI_PORT` before starting Compose. |
| Containers run but Docker networking is stalled | Use the read-only checks in [Docker runtime recovery](../docs/docker-runtime-recovery.md#check-without-changing-runtime-state). |
