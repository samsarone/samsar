#!/usr/bin/env bash
set -euo pipefail

# Installs Docker-visible fonts and, when enabled in runtime config, repairs the
# local Loki/Promtail/Grafana logger stack used by the Compose deployment.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/deploy/compose/docker-compose.yml"
CONFIG_FILE="${ROOT_DIR}/runtime/config/samsar.config.json"
ROOT_ENV_FILE="${ROOT_DIR}/runtime/secrets/root.env"
GRAFANA_ENV_FILE="${ROOT_DIR}/runtime/secrets/grafana.env"
FONT_DIR="${SAMSAR_DOCKER_FONT_DIR:-${ROOT_DIR}/runtime/fonts}"
LOKI_PORT="${LOKI_PORT:-4100}"
GRAFANA_PORT="${GRAFANA_PORT:-4000}"

INSTALL_FONTS=true
SETUP_LOGGER=auto
FORCE_DOWNLOAD=false
COPY_TO_RUNNING_CONTAINERS=true
RECREATE_LOGGER=true

FONT_SERVICES=(
  processor
  generator
  audio-generator
  assistant-query-processor
  ai-video-layer-generator
  express-video-listener
  frames-processor
  video-generator
  task-processor
  mail-processor
)

FONTS=(
  "Montserrat|Montserrat.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf"
  "Inter|Inter.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz,wght%5D.ttf"
  "Poppins|Poppins-Regular.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/poppins/Poppins-Regular.ttf"
  "NotoSans|NotoSans.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf"
  "NotoSansJP|NotoSansJP.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
  "NotoSansKR|NotoSansKR.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notosanskr/NotoSansKR%5Bwght%5D.ttf"
  "NotoSansSC|NotoSansSC.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf"
  "NotoSansTC|NotoSansTC.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf"
  "NotoSansThai|NotoSansThai.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notosansthai/NotoSansThai%5Bwdth,wght%5D.ttf"
  "MPLUSRounded1c|MPLUSRounded1c-Regular.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/mplusrounded1c/MPLUSRounded1c-Regular.ttf"
  "Sarabun|Sarabun.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun/Sarabun-Regular.ttf"
  "NotoSansArabic|NotoSansArabic.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notosansarabic/NotoSansArabic%5Bwdth,wght%5D.ttf"
  "NotoSansHebrew|NotoSansHebrew.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notosanshebrew/NotoSansHebrew%5Bwdth,wght%5D.ttf"
  "NotoSansDevanagari|NotoSansDevanagari.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notosansdevanagari/NotoSansDevanagari%5Bwdth,wght%5D.ttf"
  "NotoSerifDevanagari|NotoSerifDevanagari.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifdevanagari/NotoSerifDevanagari%5Bwdth,wght%5D.ttf"
  "Cairo|Cairo.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/cairo/Cairo%5Bslnt,wght%5D.ttf"
  "Hind|Hind.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/hind/Hind-Regular.ttf"
  "Mukta|Mukta.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/mukta/Mukta-Regular.ttf"
  "NotoSansBengali|NotoSansBengali.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notosansbengali/NotoSansBengali%5Bwdth,wght%5D.ttf"
  "NotoSerifBengali|NotoSerifBengali.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/notoserifbengali/NotoSerifBengali%5Bwdth,wght%5D.ttf"
  "HindSiliguri|HindSiliguri.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/hindsiliguri/HindSiliguri-Regular.ttf"
  "Pretendard|Pretendard.ttf|https://cdn.jsdelivr.net/npm/pretendard@1.3.9/dist/public/variable/PretendardVariable.ttf"
  "Neonderthaw|Neonderthaw.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/neonderthaw/Neonderthaw-Regular.ttf"
  "Monoton|Monoton.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/monoton/Monoton-Regular.ttf"
  "BungeeOutline|BungeeOutline.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/bungeeoutline/BungeeOutline-Regular.ttf"
  "Orbitron|Orbitron.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/orbitron/Orbitron%5Bwght%5D.ttf"
  "RampartOne|RampartOne.ttf|https://raw.githubusercontent.com/google/fonts/main/ofl/rampartone/RampartOne-Regular.ttf"
)

usage() {
  cat <<'EOF'
Usage: scripts/setup-docker-runtime-assets.sh [options]

Installs fonts into runtime/fonts for Docker containers and optionally repairs
the local Loki/Promtail/Grafana stack when runtime config has services.logger
enabled.

Options:
  --fonts-only             Install fonts and skip logger setup.
  --logger-only            Setup logger and skip font install.
  --skip-fonts             Skip font install.
  --skip-logger            Skip logger setup.
  --force                  Redownload fonts even when files already exist.
  --no-container-copy      Do not copy fonts into currently running containers.
  --no-logger-recreate     Do not force-recreate promtail/grafana.
  -h, --help               Show this help.
EOF
}

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing dependency: $1"
    exit 1
  fi
}

docker_available() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

run_compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --fonts-only)
        INSTALL_FONTS=true
        SETUP_LOGGER=never
        ;;
      --logger-only)
        INSTALL_FONTS=false
        SETUP_LOGGER=always
        ;;
      --skip-fonts)
        INSTALL_FONTS=false
        ;;
      --skip-logger)
        SETUP_LOGGER=never
        ;;
      --force)
        FORCE_DOWNLOAD=true
        ;;
      --no-container-copy)
        COPY_TO_RUNNING_CONTAINERS=false
        ;;
      --no-logger-recreate)
        RECREATE_LOGGER=false
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        log "Unknown option: $1"
        usage
        exit 1
        ;;
    esac
    shift
  done
}

download_fonts() {
  require_cmd curl
  mkdir -p "$FONT_DIR"

  log "Installing fonts into ${FONT_DIR}"

  local entry font_name font_file font_url target tmp_file
  for entry in "${FONTS[@]}"; do
    IFS='|' read -r font_name font_file font_url <<<"$entry"
    target="${FONT_DIR}/${font_file}"

    if [ -s "$target" ] && [ "$FORCE_DOWNLOAD" != "true" ]; then
      log "Font already present: ${font_file}"
      continue
    fi

    log "Downloading ${font_name}"
    tmp_file="$(mktemp)"
    if ! curl -fL --retry 3 --connect-timeout 20 -o "$tmp_file" "$font_url"; then
      rm -f "$tmp_file"
      log "Failed to download ${font_name} from ${font_url}"
      exit 1
    fi

    mv "$tmp_file" "$target"
    chmod 0644 "$target"
  done

  log "Font install complete."
}

copy_fonts_to_running_containers() {
  if [ "$COPY_TO_RUNNING_CONTAINERS" != "true" ]; then
    return
  fi

  if ! docker_available; then
    log "Docker is not running; fonts will be mounted on the next Compose recreate."
    return
  fi

  local copied_any=false
  local service containers container
  for service in "${FONT_SERVICES[@]}"; do
    containers="$(docker ps \
      --filter "label=com.docker.compose.project=samsar" \
      --filter "label=com.docker.compose.service=${service}" \
      --format '{{.Names}}' || true)"

    while IFS= read -r container; do
      if [ -z "$container" ]; then
        continue
      fi

      log "Copying fonts into running container ${container}"
      docker exec -u 0 "$container" sh -c 'mkdir -p /usr/local/share/fonts'
      docker cp "${FONT_DIR}/." "${container}:/usr/local/share/fonts"
      docker exec -u 0 "$container" sh -c 'fc-cache -f /usr/local/share/fonts >/dev/null 2>&1 || true'
      copied_any=true
    done <<<"$containers"
  done

  if [ "$copied_any" = "false" ]; then
    log "No running Samsar service containers found for immediate font copy."
  fi
}

logger_enabled_by_config() {
  if [ "$SETUP_LOGGER" = "always" ]; then
    return 0
  fi
  if [ "$SETUP_LOGGER" = "never" ]; then
    return 1
  fi

  if [ ! -f "$CONFIG_FILE" ]; then
    return 0
  fi

  if ! command -v node >/dev/null 2>&1; then
    log "Node is not available to read runtime config; assuming logger is enabled."
    return 0
  fi

  node -e '
const fs = require("fs");
const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
process.exit(config.services && config.services.logger === false ? 1 : 0);
' "$CONFIG_FILE"
}

validate_logger_files() {
  local missing=0
  local required_files=(
    "${ROOT_DIR}/deploy/compose/logger/loki-config.yml"
    "${ROOT_DIR}/deploy/compose/logger/promtail-config.yml"
    "${ROOT_DIR}/deploy/compose/logger/grafana/provisioning/datasources/loki.yml"
    "${ROOT_DIR}/deploy/compose/logger/grafana/provisioning/dashboards/default.yml"
    "${ROOT_DIR}/deploy/compose/logger/grafana/provisioning/dashboards/docker/docker-logs-overview.json"
  )

  local file
  for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
      log "Missing logger file: ${file}"
      missing=1
    fi
  done

  if [ "$missing" -ne 0 ]; then
    exit 1
  fi
}

ensure_runtime_env_file() {
  if [ -s "$ROOT_ENV_FILE" ] && [ -s "$GRAFANA_ENV_FILE" ]; then
    return
  fi

  if ! command -v node >/dev/null 2>&1; then
    log "Missing runtime credential env files; run npm run config:render before logger setup."
    exit 1
  fi

  log "Rendering runtime credential env files."
  node "${ROOT_DIR}/scripts/generate-runtime-config.mjs"
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-30}"
  local attempt

  for attempt in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "${name} is reachable at ${url}"
      return 0
    fi
    sleep 2
  done

  log "${name} did not become reachable at ${url}"
  return 1
}

show_loki_labels() {
  local labels
  labels="$(curl -fsS "http://localhost:${LOKI_PORT}/loki/api/v1/label/app/values" 2>/dev/null || true)"
  if [ -n "$labels" ]; then
    log "Loki app labels: ${labels}"
  fi
}

setup_logger_stack() {
  if ! logger_enabled_by_config; then
    if [ "$SETUP_LOGGER" = "never" ]; then
      log "Logger setup was skipped by command option."
    else
      log "Logger is disabled in runtime config; skipping Loki/Promtail/Grafana setup."
    fi
    return
  fi

  require_cmd docker
  require_cmd curl

  if ! docker_available; then
    log "Docker is not running; cannot setup logger containers."
    exit 1
  fi

  validate_logger_files
  ensure_runtime_env_file
  log "Validating Compose logger configuration."
  run_compose --profile logger config >/dev/null

  log "Ensuring Loki is running."
  run_compose --profile logger up -d loki

  if [ "$RECREATE_LOGGER" = "true" ]; then
    log "Recreating Promtail and Grafana so mounts/config are refreshed."
    run_compose --profile logger up -d --force-recreate --no-deps promtail grafana
  else
    log "Starting Promtail and Grafana without forced recreate."
    run_compose --profile logger up -d promtail grafana
  fi

  wait_for_http "Loki" "http://localhost:${LOKI_PORT}/ready" 30 || true
  if wait_for_http "Grafana" "http://localhost:${GRAFANA_PORT}/api/health" 30; then
    run_compose --profile logger exec -T grafana sh -ec \
      'grafana cli --homepath /usr/share/grafana admin reset-admin-password "$GF_SECURITY_ADMIN_PASSWORD" >/dev/null'
    log "Grafana administrator authentication synchronized."
  fi
  show_loki_labels
}

main() {
  parse_args "$@"

  if [ "$INSTALL_FONTS" = "true" ]; then
    download_fonts
    copy_fonts_to_running_containers
  fi

  setup_logger_stack

  log "Docker runtime asset setup complete."
}

main "$@"
