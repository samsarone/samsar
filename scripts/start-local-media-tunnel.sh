#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SAMSAR_ROOT_ENV_FILE:-$ROOT_DIR/runtime/secrets/root.env}"
CONFIG_FILE="${SAMSAR_RUNTIME_CONFIG_FILE:-$ROOT_DIR/runtime/config/samsar.config.json}"
COMPOSE_FILE="$ROOT_DIR/deploy/compose/docker-compose.yml"
LEGACY_CONTAINER_NAME="${SAMSAR_MEDIA_TUNNEL_CONTAINER:-samsar-media-tunnel}"
START_TIMEOUT_SECONDS="${SAMSAR_MEDIA_TUNNEL_START_TIMEOUT_SECONDS:-180}"
STARTED_AT_MS="$(node -e 'process.stdout.write(String(Date.now()))')"

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"

# Remove only the obsolete pre-controller tunnel container. The Compose service
# below is now the sole owner of Cloudflared and the runtime tunnel URL.
docker rm -f "$LEGACY_CONTAINER_NAME" >/dev/null 2>&1 || true

docker compose \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  --profile local-media \
  up -d --build --no-deps --force-recreate \
  media-gateway media-tunnel-controller

node - "$CONFIG_FILE" "$STARTED_AT_MS" "$START_TIMEOUT_SECONDS" <<'NODE'
import fs from 'node:fs/promises';

const [configPath, startedAtRaw, timeoutSecondsRaw] = process.argv.slice(2);
const startedAt = Number(startedAtRaw);
const timeoutMs = Math.max(30, Number(timeoutSecondsRaw) || 180) * 1000;
const deadline = Date.now() + timeoutMs;
let lastUrl = '';
let lastError = '';

while (Date.now() < deadline) {
  try {
    const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
    const tunnel = config.localMediaTunnel || config.mediaTunnel || {};
    const refreshedAt = Date.parse(String(tunnel.refreshedAt || ''));
    const url = String(tunnel.publicUrl || tunnel.url || '').trim().replace(/\/+$/, '');
    lastUrl = url;
    if (
      tunnel.enabled !== false &&
      tunnel.managedBy === 'compose-media-tunnel-controller' &&
      Number.isFinite(refreshedAt) &&
      refreshedAt >= startedAt &&
      /^https:\/\/[-a-zA-Z0-9]+\.trycloudflare\.com$/.test(url)
    ) {
      process.stdout.write(`${url}\n`);
      process.exit(0);
    }
  } catch (error) {
    lastError = error?.message || String(error);
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const details = [lastUrl ? `last URL: ${lastUrl}` : '', lastError].filter(Boolean).join('; ');
throw new Error(`Compose media-tunnel-controller did not publish a fresh URL within ${timeoutMs / 1000}s${details ? ` (${details})` : ''}.`);
NODE

echo "The Compose media-tunnel-controller now owns the public provider-media URL."
echo "Provider workers read the current URL from $CONFIG_FILE before each outbound request."
