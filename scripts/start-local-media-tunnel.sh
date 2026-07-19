#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SAMSAR_ROOT_ENV_FILE:-$ROOT_DIR/runtime/secrets/root.env}"
CONFIG_FILE="${SAMSAR_RUNTIME_CONFIG_FILE:-$ROOT_DIR/runtime/config/samsar.config.json}"
CONTAINER_NAME="${SAMSAR_MEDIA_TUNNEL_CONTAINER:-samsar-media-tunnel}"
NETWORK_NAME="${SAMSAR_DOCKER_NETWORK:-samsar_default}"
INTERNAL_MEDIA_URL="${SAMSAR_INTERNAL_MEDIA_BASE_URL:-http://media-gateway:80}"
CONFIGURED_TUNNEL_PROVIDER="$(node - "$CONFIG_FILE" <<'NODE' 2>/dev/null || true
const fs = require('node:fs');
const configPath = process.argv[2];
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  process.stdout.write(String(config.localMediaTunnel?.provider || config.mediaTunnel?.provider || ''));
} catch {}
NODE
)"
TUNNEL_PROVIDER="${SAMSAR_MEDIA_TUNNEL_PROVIDER:-${CONFIGURED_TUNNEL_PROVIDER:-cloudflared}}"
CLOUDFLARED_IMAGE="${SAMSAR_CLOUDFLARED_IMAGE:-cloudflare/cloudflared:latest}"
CLOUDFLARED_PROTOCOL="${SAMSAR_CLOUDFLARED_PROTOCOL:-http2}"
LOCALTUNNEL_IMAGE="${SAMSAR_LOCALTUNNEL_IMAGE:-node:20-alpine}"
ZROK_IMAGE="${SAMSAR_ZROK_IMAGE:-openziti/zrok:latest}"
ZROK_VOLUME="${SAMSAR_ZROK_VOLUME:-samsar-zrok-env}"
TUNNEL_HEALTH_PATH="${SAMSAR_MEDIA_TUNNEL_HEALTH_PATH:-/__samsar_media_health}"
TUNNEL_HEALTH_TIMEOUT_SECONDS="${SAMSAR_MEDIA_TUNNEL_HEALTH_TIMEOUT_SECONDS:-60}"
TUNNEL_HEALTH_MARKER="samsar-media-gateway"

mkdir -p "$(dirname "$ENV_FILE")"
touch "$ENV_FILE"

if ! docker network inspect "$NETWORK_NAME" >/dev/null 2>&1; then
  echo "Docker network '$NETWORK_NAME' was not found. Start Samsar Docker services first." >&2
  exit 1
fi

set_env_value() {
  local key="$1"
  local value="$2"
  local tmp_file
  tmp_file="$(mktemp)"
  if grep -q "^${key}=" "$ENV_FILE"; then
    awk -v key="$key" -v value="$value" 'BEGIN{updated=0} $0 ~ "^" key "=" {print key "=" value; updated=1; next} {print} END{if(!updated) print key "=" value}' "$ENV_FILE" > "$tmp_file"
  else
    cat "$ENV_FILE" > "$tmp_file"
    printf '%s=%s\n' "$key" "$value" >> "$tmp_file"
  fi
  mv "$tmp_file" "$ENV_FILE"
}

container_logs() {
  docker logs "$CONTAINER_NAME" 2>&1 || true
}

start_cloudflared_tunnel() {
  docker run -d \
    --name "$CONTAINER_NAME" \
    --network "$NETWORK_NAME" \
    --restart unless-stopped \
    "$CLOUDFLARED_IMAGE" \
    tunnel --no-autoupdate --protocol "$CLOUDFLARED_PROTOCOL" --url "$INTERNAL_MEDIA_URL" >/dev/null

  for _ in $(seq 1 45); do
    container_logs | grep -Eo 'https://[-a-zA-Z0-9]+\.trycloudflare\.com' | tail -n 1
    if container_logs | grep -Eq 'https://[-a-zA-Z0-9]+\.trycloudflare\.com'; then
      return 0
    fi
    sleep 1
  done
}

start_localtunnel() {
  local local_host
  local local_port
  local_host="$(node -e "const u = new URL(process.argv[1]); console.log(u.hostname || 'media-gateway')" "$INTERNAL_MEDIA_URL")"
  local_port="$(node -e "const u = new URL(process.argv[1]); console.log(u.port || (u.protocol === 'https:' ? '443' : '80'))" "$INTERNAL_MEDIA_URL")"

  docker run -d \
    --name "$CONTAINER_NAME" \
    --network "$NETWORK_NAME" \
    --restart unless-stopped \
    "$LOCALTUNNEL_IMAGE" \
    sh -lc "npx --yes localtunnel --local-host '$local_host' --port '$local_port'" >/dev/null

  for _ in $(seq 1 45); do
    container_logs | grep -Eo 'https://[-a-zA-Z0-9]+\.loca\.lt' | tail -n 1
    if container_logs | grep -Eq 'https://[-a-zA-Z0-9]+\.loca\.lt'; then
      return 0
    fi
    sleep 1
  done
}

ensure_zrok_enabled() {
  docker volume create "$ZROK_VOLUME" >/dev/null
  docker run --rm \
    --user 0:0 \
    -v "$ZROK_VOLUME:/home/ziggy/.zrok" \
    busybox:latest \
    sh -lc 'mkdir -p /home/ziggy/.zrok && chown -R 2171:2171 /home/ziggy/.zrok' >/dev/null

  if docker run --rm \
    -e HOME=/home/ziggy \
    -v "$ZROK_VOLUME:/home/ziggy/.zrok" \
    "$ZROK_IMAGE" status >/dev/null 2>&1; then
    return 0
  fi

  if [ -z "${ZROK_ENABLE_TOKEN:-}" ]; then
    cat >&2 <<'EOF'
zrok is not enabled for this Docker environment.

Set ZROK_ENABLE_TOKEN and run this script again, for example:
  SAMSAR_MEDIA_TUNNEL_PROVIDER=zrok ZROK_ENABLE_TOKEN=... scripts/start-local-media-tunnel.sh

Use the default cloudflared provider if you need a tokenless local media tunnel.
EOF
    exit 1
  fi

  docker run --rm \
    -e HOME=/home/ziggy \
    -v "$ZROK_VOLUME:/home/ziggy/.zrok" \
    "$ZROK_IMAGE" enable --headless "$ZROK_ENABLE_TOKEN" >/dev/null
}

start_zrok_tunnel() {
  ensure_zrok_enabled
  docker run -d \
    --name "$CONTAINER_NAME" \
    --network "$NETWORK_NAME" \
    --restart unless-stopped \
    -e HOME=/home/ziggy \
    -e PFXLOG_NO_JSON=true \
    -v "$ZROK_VOLUME:/home/ziggy/.zrok" \
    "$ZROK_IMAGE" \
    share public --headless "$INTERNAL_MEDIA_URL" >/dev/null

  for _ in $(seq 1 45); do
    container_logs | grep -Eo 'https://[-a-zA-Z0-9.]+\.share\.zrok\.io' | tail -n 1
    if container_logs | grep -Eq 'https://[-a-zA-Z0-9.]+\.share\.zrok\.io'; then
      return 0
    fi
    sleep 1
  done
}

docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true

case "$TUNNEL_PROVIDER" in
  cloudflared)
    tunnel_url="$(start_cloudflared_tunnel | tail -n 1 || true)"
    ;;
  localtunnel)
    tunnel_url="$(start_localtunnel | tail -n 1 || true)"
    ;;
  zrok)
    tunnel_url="$(start_zrok_tunnel | tail -n 1 || true)"
    ;;
  *)
    echo "Unsupported SAMSAR_MEDIA_TUNNEL_PROVIDER '$TUNNEL_PROVIDER'. Use cloudflared, localtunnel, or zrok." >&2
    exit 1
    ;;
esac

if [ -z "${tunnel_url:-}" ]; then
  container_logs >&2
  echo "Unable to discover $TUNNEL_PROVIDER tunnel URL." >&2
  exit 1
fi

tunnel_health_url="${tunnel_url%/}${TUNNEL_HEALTH_PATH}"
tunnel_health_deadline=$((SECONDS + TUNNEL_HEALTH_TIMEOUT_SECONDS))
tunnel_health_response=""
while [ "$SECONDS" -lt "$tunnel_health_deadline" ]; do
  tunnel_health_response="$(node - "$tunnel_health_url" <<'NODE' 2>/dev/null || true
const healthUrl = process.argv[2];
try {
  const response = await fetch(healthUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  });
  if (response.ok) {
    process.stdout.write((await response.text()).trim());
  }
} catch {}
NODE
)"
  if [ "$tunnel_health_response" = "$TUNNEL_HEALTH_MARKER" ]; then
    break
  fi
  sleep 1
done

if [ "$tunnel_health_response" != "$TUNNEL_HEALTH_MARKER" ]; then
  container_logs >&2
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  echo "The discovered $TUNNEL_PROVIDER URL did not reach the Samsar media gateway health endpoint." >&2
  exit 1
fi

set_env_value SAMSAR_PUBLIC_MEDIA_BASE_URL "$tunnel_url"
set_env_value SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL "$tunnel_url"
set_env_value SAMSAR_MEDIA_TUNNEL_PUBLIC_URL "$tunnel_url"
set_env_value MEDIA_PUBLIC_URL "$tunnel_url"
set_env_value SAMSAR_INTERNAL_MEDIA_BASE_URL "${SAMSAR_INTERNAL_MEDIA_BASE_URL:-http://media-gateway}"
set_env_value SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED "false"
set_env_value SAMSAR_MEDIA_TUNNEL_PROVIDER "$TUNNEL_PROVIDER"

if [ -f "$CONFIG_FILE" ]; then
  node - "$CONFIG_FILE" "$tunnel_url" "$TUNNEL_PROVIDER" <<'NODE'
const fs = require('node:fs');
const [configPath, tunnelUrl, tunnelProvider] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const configuredBrowserMediaUrl = String(config.publicUrls?.media || '').trim();
let configuredBrowserMediaHost = '';
try {
  configuredBrowserMediaHost = new URL(configuredBrowserMediaUrl).hostname.toLowerCase();
} catch {}
const browserMediaUsesLegacyTunnel = configuredBrowserMediaHost.endsWith('.trycloudflare.com') ||
  configuredBrowserMediaHost.endsWith('.loca.lt') ||
  configuredBrowserMediaHost.endsWith('.share.zrok.io');
if (browserMediaUsesLegacyTunnel) {
  config.publicUrls = {
    ...(config.publicUrls || {}),
    media: config.publicUrls?.processorApi || 'http://localhost:3002',
  };
}
config.localMediaTunnel = {
  ...(config.localMediaTunnel || config.mediaTunnel || {}),
  enabled: true,
  provider: tunnelProvider,
  publicUrl: tunnelUrl,
  refreshedAt: new Date().toISOString(),
};
const tempPath = `${configPath}.tmp-${process.pid}`;
fs.writeFileSync(tempPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(tempPath, configPath);
NODE
fi

echo "Samsar local media tunnel ($TUNNEL_PROVIDER): $tunnel_url"
echo "Updated $ENV_FILE"
echo "Updated $CONFIG_FILE"
echo "Provider workers will validate and read the refreshed tunnel URL from runtime config."
