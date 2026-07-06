#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${SAMSAR_ROOT_ENV_FILE:-$ROOT_DIR/runtime/secrets/root.env}"
CONFIG_FILE="${SAMSAR_RUNTIME_CONFIG_FILE:-$ROOT_DIR/runtime/config/samsar.config.json}"
CONTAINER_NAME="${SAMSAR_MEDIA_TUNNEL_CONTAINER:-samsar-media-tunnel}"
NETWORK_NAME="${SAMSAR_DOCKER_NETWORK:-samsar_default}"
INTERNAL_MEDIA_URL="${SAMSAR_INTERNAL_MEDIA_BASE_URL:-http://media-gateway:80}"
TUNNEL_PROVIDER="${SAMSAR_MEDIA_TUNNEL_PROVIDER:-cloudflared}"
CLOUDFLARED_IMAGE="${SAMSAR_CLOUDFLARED_IMAGE:-cloudflare/cloudflared:latest}"
LOCALTUNNEL_IMAGE="${SAMSAR_LOCALTUNNEL_IMAGE:-node:20-alpine}"
ZROK_IMAGE="${SAMSAR_ZROK_IMAGE:-openziti/zrok:latest}"
ZROK_VOLUME="${SAMSAR_ZROK_VOLUME:-samsar-zrok-env}"

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
    "$CLOUDFLARED_IMAGE" \
    tunnel --no-autoupdate --url "$INTERNAL_MEDIA_URL" >/dev/null

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

set_env_value SAMSAR_PUBLIC_MEDIA_BASE_URL "$tunnel_url"
set_env_value SAMSAR_EXTERNAL_MEDIA_PUBLIC_BASE_URL "$tunnel_url"
set_env_value MEDIA_PUBLIC_URL "$tunnel_url"
set_env_value SAMSAR_INTERNAL_MEDIA_BASE_URL "${SAMSAR_INTERNAL_MEDIA_BASE_URL:-http://media-gateway}"
set_env_value SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED "false"
set_env_value SAMSAR_MEDIA_TUNNEL_PROVIDER "$TUNNEL_PROVIDER"

if [ -f "$CONFIG_FILE" ]; then
  node - "$CONFIG_FILE" "$tunnel_url" <<'NODE'
const fs = require('node:fs');
const [configPath, tunnelUrl] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.publicUrls = {
  ...(config.publicUrls || {}),
  media: tunnelUrl,
};
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
NODE
fi

echo "Samsar local media tunnel ($TUNNEL_PROVIDER): $tunnel_url"
echo "Updated $ENV_FILE"
echo "Updated $CONFIG_FILE"
echo "Recreate workers that send media to remote Samsar so they read the new env."
