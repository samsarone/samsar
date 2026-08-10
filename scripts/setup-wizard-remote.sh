#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST=""
IDENTITY_FILE="${SAMSAR_SETUP_SSH_KEY:-}"
REMOTE_DIR="${SAMSAR_SETUP_REMOTE_DIR:-~/samsar}"
LOCAL_PORT="${SAMSAR_SETUP_LOCAL_PORT:-8089}"
REMOTE_PORT="${SETUP_WIZARD_PORT:-8089}"
PULL_REPO="${SAMSAR_SETUP_REMOTE_PULL:-1}"
OPEN_BROWSER="${SAMSAR_SETUP_REMOTE_OPEN_BROWSER:-1}"
CHECK_ONLY="${SAMSAR_SETUP_REMOTE_CHECK_ONLY:-0}"
MIN_DISK_FREE_GB="${SAMSAR_SETUP_MIN_DISK_FREE_GB:-}"
SSH_OPTIONS=()
REMOTE_SETUP_ARGS=()

log() {
  echo "[setup-wizard-remote] $*"
}

warn() {
  echo "[setup-wizard-remote] $*" >&2
}

die() {
  warn "$*"
  exit 1
}

enabled() {
  case "${1:-}" in
    0|false|FALSE|no|NO|off|OFF)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

usage() {
  cat <<EOF
Usage: ./scripts/setup-wizard-remote.sh <user@host> [options]

Starts the setup wizard on a remote Linux host and opens it locally through SSH.
No public cloud port or Azure/AWS/GCP firewall rule is required.

Options:
  -i, --identity <path>       SSH private key.
      --remote-dir <path>     Remote repo directory. Default: ~/samsar
      --local-port <port>     Local browser port. Default: 8089
      --remote-port <port>    Remote setup wizard port. Default: 8089
      --min-disk-free-gb <gb> Override remote disk preflight threshold.
      --no-pull              Do not git pull before starting the remote wizard.
      --no-open-browser      Print the URL without opening a browser.
      --check-only           Verify the tunnel and exit.
      --ssh-option <key=value>
                              Extra ssh -o option, for example ProxyJump=bastion.
  -h, --help                  Show this help text.

Examples:
  ./scripts/setup-wizard-remote.sh azureuser@172.188.83.14 -i /path/to/key.pem
  SAMSAR_SETUP_MIN_DISK_FREE_GB=20 ./scripts/setup-wizard-remote.sh azureuser@172.188.83.14 -i /path/to/key.pem
EOF
}

quote_arg() {
  printf '%q' "$1"
}

quote_args() {
  local quoted_args=()
  local arg
  for arg in "$@"; do
    quoted_args+=("$(quote_arg "$arg")")
  done
  printf '%s' "${quoted_args[*]}"
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -i|--identity)
        [[ $# -ge 2 ]] || die "$1 requires a path."
        IDENTITY_FILE="$2"
        shift 2
        ;;
      --remote-dir)
        [[ $# -ge 2 ]] || die "$1 requires a path."
        REMOTE_DIR="$2"
        shift 2
        ;;
      --local-port)
        [[ $# -ge 2 ]] || die "$1 requires a port."
        LOCAL_PORT="$2"
        shift 2
        ;;
      --remote-port)
        [[ $# -ge 2 ]] || die "$1 requires a port."
        REMOTE_PORT="$2"
        shift 2
        ;;
      --min-disk-free-gb)
        [[ $# -ge 2 ]] || die "$1 requires a value."
        MIN_DISK_FREE_GB="$2"
        shift 2
        ;;
      --no-pull)
        PULL_REPO=0
        shift
        ;;
      --pull)
        PULL_REPO=1
        shift
        ;;
      --no-open-browser)
        OPEN_BROWSER=0
        shift
        ;;
      --check-only)
        CHECK_ONLY=1
        OPEN_BROWSER=0
        shift
        ;;
      --ssh-option)
        [[ $# -ge 2 ]] || die "$1 requires a value."
        SSH_OPTIONS+=("-o" "$2")
        shift 2
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      --)
        shift
        REMOTE_SETUP_ARGS+=("$@")
        break
        ;;
      -*)
        die "Unknown option: $1"
        ;;
      *)
        if [[ -z "$REMOTE_HOST" ]]; then
          REMOTE_HOST="$1"
        else
          die "Unexpected positional argument: $1"
        fi
        shift
        ;;
    esac
  done
}

validate_port() {
  local port="$1"
  [[ "$port" =~ ^[0-9]+$ ]] && (( port > 0 && port < 65536 ))
}

port_is_free() {
  local port="$1"
  if command -v nc >/dev/null 2>&1; then
    ! nc -z 127.0.0.1 "$port" >/dev/null 2>&1
    return
  fi
  ! (echo >"/dev/tcp/127.0.0.1/${port}") >/dev/null 2>&1
}

find_local_port() {
  local requested_port="$1"
  local port
  validate_port "$requested_port" || die "Invalid local port: $requested_port"
  for ((port = requested_port; port < requested_port + 100; port++)); do
    if port_is_free "$port"; then
      echo "$port"
      return 0
    fi
  done
  die "No free local port found near $requested_port."
}

remote_cd_expr() {
  local suffix
  case "$REMOTE_DIR" in
    ~)
      printf '$HOME'
      ;;
    ~/*)
      suffix="${REMOTE_DIR#~/}"
      printf '$HOME/%s' "$(quote_arg "$suffix")"
      ;;
    *)
      quote_arg "$REMOTE_DIR"
      ;;
  esac
}

build_remote_command() {
  local command remote_env extra_args
  command="set -euo pipefail; cd $(remote_cd_expr);"
  if enabled "$PULL_REPO"; then
    command+=" if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git fetch origin --prune; git pull --ff-only; fi;"
  fi

  remote_env="SAMSAR_SETUP_OPEN_BROWSER=0 SETUP_WIZARD_BIND_ADDR=127.0.0.1 SETUP_WIZARD_PORT=$(quote_arg "$REMOTE_PORT") SAMSAR_SETUP_REMOTE_INSTALL=1 SAMSAR_SETUP_OPEN_SETUP_PORT=false SAMSAR_SETUP_OPEN_CLOUD_PORT=false"
  if [[ -n "$MIN_DISK_FREE_GB" ]]; then
    remote_env+=" SAMSAR_SETUP_MIN_DISK_FREE_GB=$(quote_arg "$MIN_DISK_FREE_GB")"
  fi

  if ((${#REMOTE_SETUP_ARGS[@]})); then
    extra_args="$(quote_args "${REMOTE_SETUP_ARGS[@]}")"
  else
    extra_args=""
  fi
  command+=" ${remote_env} ./setup.sh --no-open-setup-port"
  if [[ -n "$extra_args" ]]; then
    command+=" ${extra_args}"
  fi
  printf '%s' "$command"
}

open_browser() {
  local url="$1"
  enabled "$OPEN_BROWSER" || return 0
  case "$(uname -s 2>/dev/null || true)" in
    Darwin)
      command -v open >/dev/null 2>&1 && open "$url" >/dev/null 2>&1 && return 0
      ;;
  esac
  if command -v xdg-open >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    xdg-open "$url" >/dev/null 2>&1 && return 0
  fi
  if command -v wslview >/dev/null 2>&1; then
    wslview "$url" >/dev/null 2>&1 && return 0
  fi
  if command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /c start "" "$url" >/dev/null 2>&1 && return 0
  fi
  return 0
}

http_get_succeeds() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 2 "$url" >/dev/null 2>&1
  elif command -v wget >/dev/null 2>&1; then
    wget -q --timeout=2 --tries=1 -O /dev/null "$url" >/dev/null 2>&1
  else
    return 2
  fi
}

wait_for_local_tunnel() {
  local url="$1"
  local attempt
  for ((attempt = 1; attempt <= 30; attempt++)); do
    if http_get_succeeds "${url}/api/setup/health"; then
      return 0
    fi
    sleep 1
  done
  return 1
}

parse_args "$@"
[[ -n "$REMOTE_HOST" ]] || {
  usage
  exit 1
}
validate_port "$REMOTE_PORT" || die "Invalid remote port: $REMOTE_PORT"
LOCAL_PORT="$(find_local_port "$LOCAL_PORT")"

SSH_ARGS=()
if [[ -n "$IDENTITY_FILE" ]]; then
  SSH_ARGS+=("-i" "$IDENTITY_FILE")
fi
SSH_ARGS+=("${SSH_OPTIONS[@]}")

REMOTE_COMMAND="$(build_remote_command)"
log "Starting setup wizard on ${REMOTE_HOST}."
ssh "${SSH_ARGS[@]}" "$REMOTE_HOST" "bash -lc $(quote_arg "$REMOTE_COMMAND")"
REMOTE_TOKEN_COMMAND="set -euo pipefail; cd $(remote_cd_expr); cat runtime/secrets/setup-bootstrap.token"
SETUP_BOOTSTRAP_TOKEN="$(
  ssh "${SSH_ARGS[@]}" "$REMOTE_HOST" "bash -lc $(quote_arg "$REMOTE_TOKEN_COMMAND")"
)"
[[ "$SETUP_BOOTSTRAP_TOKEN" =~ ^[a-f0-9]{64}$ ]] ||
  die 'Remote setup bootstrap token was missing or invalid.'

LOCAL_URL="http://localhost:${LOCAL_PORT}"
LOCAL_AUTH_URL="${LOCAL_URL}/#bootstrap=${SETUP_BOOTSTRAP_TOKEN}"
log "Opening SSH tunnel: ${LOCAL_URL} -> ${REMOTE_HOST}:127.0.0.1:${REMOTE_PORT}"
ssh \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  "${SSH_ARGS[@]}" \
  -N \
  -L "127.0.0.1:${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
  "$REMOTE_HOST" &
TUNNEL_PID=$!

cleanup() {
  kill "$TUNNEL_PID" >/dev/null 2>&1 || true
  wait "$TUNNEL_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if ! wait_for_local_tunnel "$LOCAL_URL"; then
  die "SSH tunnel opened, but the setup wizard did not respond at ${LOCAL_URL}."
fi

log "Setup wizard is ready through the authenticated SSH tunnel."
open_browser "$LOCAL_AUTH_URL"

if enabled "$CHECK_ONLY"; then
  log "Check-only mode completed; closing tunnel."
  exit 0
fi

echo
echo "Keep this terminal open while using the setup wizard."
echo "Press Ctrl-C here to close the SSH tunnel."
wait "$TUNNEL_PID"
