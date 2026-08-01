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

export DEBIAN_FRONTEND=noninteractive
if command -v apt-get >/dev/null 2>&1; then
  apt-get -o Acquire::Retries=5 update
  apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates curl git
  apt-get clean
fi

if [[ ! -x "$APP_DIR/.venv/bin/python" ]]; then
  python -m venv --system-site-packages "$APP_DIR/.venv"
fi

"$APP_DIR/.venv/bin/python" - <<'PY'
import torch

if not torch.cuda.is_available():
    raise SystemExit("PyTorch cannot access a CUDA GPU in this Vast container")
print(f"CUDA preflight passed: {torch.cuda.get_device_name(0)}")
PY

"$APP_DIR/.venv/bin/python" -m pip install --retries 10 --timeout 60 --upgrade pip setuptools wheel
"$APP_DIR/.venv/bin/python" -m pip install --retries 10 --timeout 60 -r "$APP_DIR/requirements.txt"
"$APP_DIR/.venv/bin/python" -m pip install \
  --retries 10 \
  --timeout 60 \
  "${FLUX_DIFFUSERS_SPEC:-git+https://github.com/huggingface/diffusers.git}"

install_cloudflared() {
  local machine cloudflared_arch download_path
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) cloudflared_arch="amd64" ;;
    aarch64|arm64) cloudflared_arch="arm64" ;;
    *)
      echo "Unsupported architecture for cloudflared: $machine" >&2
      return 1
      ;;
  esac

  download_path="$(mktemp /tmp/cloudflared.XXXXXX)"
  curl --retry 8 --retry-all-errors --connect-timeout 20 -fsSL \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cloudflared_arch}" \
    -o "$download_path"
  install -m 0755 "$download_path" /usr/local/bin/cloudflared
  rm -f "$download_path"
}

if [[ "${FLUX_PUBLIC_MODE:-cloudflare}" == "cloudflare" ]] && ! command -v cloudflared >/dev/null 2>&1; then
  install_cloudflared
fi

chmod 0700 "$APP_DIR/start.sh"
mkdir -p "$APP_DIR/logs" "$APP_DIR/outputs" "${HF_HOME:-/workspace/.cache/huggingface}"
"$APP_DIR/start.sh"
