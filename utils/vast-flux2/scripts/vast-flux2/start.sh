#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/workspace/flux2-api"
RUNTIME_ENV="$APP_DIR/runtime.env"

if [[ ! -f "$RUNTIME_ENV" ]]; then
  echo "Missing $RUNTIME_ENV" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$RUNTIME_ENV"
set +a

mkdir -p "$APP_DIR/logs" "$APP_DIR/outputs"

stop_managed_process() {
  local pid_file="$1"
  local expected="$2"
  local pid cmdline

  [[ -f "$pid_file" ]] || return 0
  pid="$(tr -cd '0-9' < "$pid_file")"
  [[ -n "$pid" && -r "/proc/$pid/cmdline" ]] || return 0
  cmdline="$(tr '\0' ' ' < "/proc/$pid/cmdline")"
  if [[ "$cmdline" == *"$expected"* ]]; then
    kill "$pid" || true
    for _ in {1..30}; do
      kill -0 "$pid" 2>/dev/null || return 0
      sleep 1
    done
    kill -9 "$pid" || true
  fi
}

stop_managed_process "$APP_DIR/uvicorn.pid" "uvicorn"
rm -f "$APP_DIR/public-url.txt"

cd "$APP_DIR"
nohup "$APP_DIR/.venv/bin/uvicorn" server:app \
  --host 0.0.0.0 \
  --port "${FLUX_PORT:-8000}" \
  --proxy-headers \
  --forwarded-allow-ips='*' \
  >"$APP_DIR/logs/server.log" 2>&1 &
echo "$!" > "$APP_DIR/uvicorn.pid"

if [[ "${FLUX_PUBLIC_MODE:-cloudflare}" != "cloudflare" ]]; then
  exit 0
fi

stop_managed_process "$APP_DIR/cloudflared.pid" "cloudflared"
: > "$APP_DIR/logs/cloudflared.log"
nohup cloudflared tunnel \
  --url "http://127.0.0.1:${FLUX_PORT:-8000}" \
  --protocol http2 \
  --no-autoupdate \
  >"$APP_DIR/logs/cloudflared.log" 2>&1 &
echo "$!" > "$APP_DIR/cloudflared.pid"

for _ in {1..90}; do
  public_url="$(grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$APP_DIR/logs/cloudflared.log" | head -n 1 || true)"
  if [[ -n "$public_url" ]]; then
    printf '%s\n' "$public_url" > "$APP_DIR/public-url.txt"
    exit 0
  fi
  if ! kill -0 "$(tr -cd '0-9' < "$APP_DIR/cloudflared.pid")" 2>/dev/null; then
    echo "cloudflared stopped before publishing a URL" >&2
    tail -n 40 "$APP_DIR/logs/cloudflared.log" >&2 || true
    exit 1
  fi
  sleep 2
done

echo "Timed out waiting for the Cloudflare quick-tunnel URL" >&2
tail -n 40 "$APP_DIR/logs/cloudflared.log" >&2 || true
exit 1
