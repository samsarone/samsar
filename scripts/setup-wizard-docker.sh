#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE_NAME="${SETUP_WIZARD_IMAGE:-samsar-setup-wizard:local}"
CONTAINER_NAME="${SETUP_WIZARD_CONTAINER_NAME:-samsar-setup-wizard-preview}"
HOST_PORT="${SETUP_WIZARD_PORT:-8089}"
CONTAINER_PORT="${SETUP_WIZARD_CONTAINER_PORT:-80}"
LOCAL_SETUP_WIZARD_URL="http://localhost:${HOST_PORT}"
PUBLIC_IP_TIMEOUT_SECONDS="${SAMSAR_SETUP_PUBLIC_IP_TIMEOUT_SECONDS:-2}"
READY_TIMEOUT_SECONDS="${SAMSAR_SETUP_READY_TIMEOUT_SECONDS:-30}"

extract_private_ipv4_addresses() {
  printf '%s\n' "$*" | tr -cs '0-9.' '\n' | awk -F. '
    NF == 4 {
      for (i = 1; i <= 4; i++) {
        if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) next
      }
      first = $1 + 0
      second = $2 + 0
      if ((first == 10 || (first == 192 && second == 168) || (first == 172 && second >= 16 && second <= 31)) && !seen[$0]++) {
        printf "%s%s", sep, $0
        sep = " "
      }
    }
  '
}

extract_public_ipv4_addresses() {
  printf '%s\n' "$*" | tr -cs '0-9.' '\n' | awk -F. '
    NF == 4 {
      for (i = 1; i <= 4; i++) {
        if ($i !~ /^[0-9]+$/ || $i < 0 || $i > 255) next
      }
      first = $1 + 0
      second = $2 + 0
      third = $3 + 0
      is_blocked = first == 0 || first == 10 || first == 127 || first >= 224 || (first == 100 && second >= 64 && second <= 127) || (first == 169 && second == 254) || (first == 172 && second >= 16 && second <= 31) || (first == 192 && second == 168) || (first == 198 && (second == 18 || second == 19)) || (first == 203 && second == 0 && third == 113)
      if (is_blocked) next
      if (!seen[$0]++) {
        printf "%s%s", sep, $0
        sep = " "
      }
    }
  '
}

detect_host_private_ips() {
  local detected_ips=""
  if command -v ipconfig >/dev/null 2>&1; then
    local default_interface
    default_interface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    if [[ -n "$default_interface" ]]; then
      detected_ips+=" $(ipconfig getifaddr "$default_interface" 2>/dev/null || true)"
    fi
    detected_ips+=" $(ipconfig getifaddr en0 2>/dev/null || true)"
    detected_ips+=" $(ipconfig getifaddr en1 2>/dev/null || true)"
  fi
  if command -v ip >/dev/null 2>&1; then
    detected_ips+=" $(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="src") {print $(i+1); exit}}')"
  fi
  if command -v hostname >/dev/null 2>&1; then
    detected_ips+=" $(hostname -I 2>/dev/null || true)"
  fi
  if command -v ifconfig >/dev/null 2>&1; then
    detected_ips+=" $(ifconfig 2>/dev/null | awk '/inet / && $2 !~ /^127\\./ {print $2}')"
  fi
  extract_private_ipv4_addresses "$detected_ips"
}

detect_host_public_ips() {
  local detected_ips=""
  local url
  if command -v curl >/dev/null 2>&1; then
    for url in "https://api.ipify.org" "https://ifconfig.me/ip"; do
      detected_ips+=" $(curl -fsS --max-time "$PUBLIC_IP_TIMEOUT_SECONDS" "$url" 2>/dev/null || true)"
      if [[ -n "$(extract_public_ipv4_addresses "$detected_ips")" ]]; then
        break
      fi
    done
  elif command -v wget >/dev/null 2>&1; then
    for url in "https://api.ipify.org" "https://ifconfig.me/ip"; do
      detected_ips+=" $(wget -q --timeout="$PUBLIC_IP_TIMEOUT_SECONDS" --tries=1 -O - "$url" 2>/dev/null || true)"
      if [[ -n "$(extract_public_ipv4_addresses "$detected_ips")" ]]; then
        break
      fi
    done
  fi
  extract_public_ipv4_addresses "$detected_ips"
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

detect_reachable_public_setup_ips() {
  local ip
  local reachable_ips=""
  for ip in $HOST_PUBLIC_IPS; do
    if http_get_succeeds "http://${ip}:${HOST_PORT}"; then
      reachable_ips+=" ${ip}"
    fi
  done
  extract_public_ipv4_addresses "$reachable_ips"
}

wait_for_setup_wizard() {
  local url="$1"
  local attempts="$READY_TIMEOUT_SECONDS"
  local attempt
  if ! [[ "$attempts" =~ ^[0-9]+$ ]] || (( attempts < 1 )); then
    attempts=30
  fi
  if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    echo "Skipping readiness check; curl or wget is not available."
    return 0
  fi
  echo "Waiting for setup wizard to respond..."
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if http_get_succeeds "$url"; then
      echo "Setup wizard is ready."
      return 0
    fi
    sleep 1
  done
  echo "Setup wizard did not respond within ${attempts}s; it may still be starting."
  return 1
}

browser_auto_open_enabled() {
  case "${SAMSAR_SETUP_OPEN_BROWSER:-1}" in
    0|false|FALSE|no|NO|off|OFF)
      return 1
      ;;
    *)
      return 0
      ;;
  esac
}

open_setup_wizard_browser() {
  local url="$1"
  local os_name
  if ! browser_auto_open_enabled; then
    echo "Browser auto-open disabled by SAMSAR_SETUP_OPEN_BROWSER."
    return 0
  fi

  os_name="$(uname -s 2>/dev/null || true)"
  if [[ "$os_name" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
    if open "$url" >/dev/null 2>&1; then
      echo "Opened setup wizard in your default browser: ${url}"
      return 0
    fi
  fi
  if command -v xdg-open >/dev/null 2>&1 && [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    if xdg-open "$url" >/dev/null 2>&1; then
      echo "Opened setup wizard in your default browser: ${url}"
      return 0
    fi
  fi
  if command -v wslview >/dev/null 2>&1; then
    if wslview "$url" >/dev/null 2>&1; then
      echo "Opened setup wizard in your default browser: ${url}"
      return 0
    fi
  fi
  if command -v cmd.exe >/dev/null 2>&1; then
    if cmd.exe /c start "" "$url" >/dev/null 2>&1; then
      echo "Opened setup wizard in your default browser: ${url}"
      return 0
    fi
  fi

  echo "No desktop browser opener detected; open one of the setup wizard URLs above."
  return 0
}

print_setup_wizard_urls() {
  local ip
  echo
  echo "Setup wizard URLs:"
  echo "  Local:   ${LOCAL_SETUP_WIZARD_URL}"
  if [[ -n "$HOST_PRIVATE_IPS" ]]; then
    for ip in $HOST_PRIVATE_IPS; do
      echo "  Private: http://${ip}:${HOST_PORT}"
    done
  else
    echo "  Private: not detected"
  fi
  if [[ -n "${REACHABLE_HOST_PUBLIC_IPS:-}" ]]; then
    for ip in $REACHABLE_HOST_PUBLIC_IPS; do
      echo "  Public:  http://${ip}:${HOST_PORT}"
    done
  else
    echo "  Public:  not available on TCP ${HOST_PORT}"
  fi
  echo "Remote setup: temporarily allow inbound TCP ${HOST_PORT} to this machine in your cloud/security group and host firewall, then close it after setup."
  echo
}

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not available on PATH." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop or Docker Engine first." >&2
  exit 1
fi

HOST_PRIVATE_IPS="$(extract_private_ipv4_addresses "${SAMSAR_SETUP_HOST_PRIVATE_IPS:-$(detect_host_private_ips)}")"
HOST_PUBLIC_IPS="$(extract_public_ipv4_addresses "${SAMSAR_SETUP_HOST_PUBLIC_IPS:-$(detect_host_public_ips)}")"

echo "Building ${IMAGE_NAME} from apps/setup-wizard..."
docker build -t "$IMAGE_NAME" "$ROOT_DIR/apps/setup-wizard"

existing_container_id="$(
  docker ps -aq --filter "name=^/${CONTAINER_NAME}$"
)"

if [[ -n "$existing_container_id" ]]; then
  echo "Replacing existing container ${CONTAINER_NAME}..."
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "Starting ${CONTAINER_NAME} on host port ${HOST_PORT}..."
if [[ -n "$HOST_PRIVATE_IPS" ]]; then
  echo "Detected host private IP candidates: ${HOST_PRIVATE_IPS}"
fi
echo "Public setup URL will be shown only if TCP ${HOST_PORT} responds on the detected public IP."
container_id="$(
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "0.0.0.0:${HOST_PORT}:${CONTAINER_PORT}" \
    --add-host=host.docker.internal:host-gateway \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$ROOT_DIR:$ROOT_DIR" \
    -e "SAMSAR_SETUP_ROOT_DIR=$ROOT_DIR" \
    -e "SAMSAR_SETUP_CLIENT_URL=http://localhost:3000" \
    -e "SAMSAR_SETUP_PROCESSOR_PUBLIC_URL=http://localhost:3002" \
    -e "SAMSAR_SETUP_HOST_PRIVATE_IPS=$HOST_PRIVATE_IPS" \
    "$IMAGE_NAME"
)"

echo "Started ${CONTAINER_NAME} (${container_id})."
if wait_for_setup_wizard "$LOCAL_SETUP_WIZARD_URL"; then
  REACHABLE_HOST_PUBLIC_IPS="$(detect_reachable_public_setup_ips)"
  print_setup_wizard_urls
  open_setup_wizard_browser "$LOCAL_SETUP_WIZARD_URL"
else
  REACHABLE_HOST_PUBLIC_IPS=""
  print_setup_wizard_urls
  echo "Open ${LOCAL_SETUP_WIZARD_URL} after the container finishes starting."
fi
