#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE_NAME="${SETUP_WIZARD_IMAGE:-samsar-setup-wizard:local}"
CONTAINER_NAME="${SETUP_WIZARD_CONTAINER_NAME:-samsar-setup-wizard-preview}"
HOST_PORT="${SETUP_WIZARD_PORT:-8089}"
HOST_BIND_ADDR="${SETUP_WIZARD_BIND_ADDR:-0.0.0.0}"
CONTAINER_PORT="${SETUP_WIZARD_CONTAINER_PORT:-80}"
LOCAL_SETUP_WIZARD_URL="http://localhost:${HOST_PORT}"
PUBLIC_IP_TIMEOUT_SECONDS="${SAMSAR_SETUP_PUBLIC_IP_TIMEOUT_SECONDS:-2}"
READY_TIMEOUT_SECONDS="${SAMSAR_SETUP_READY_TIMEOUT_SECONDS:-30}"
BOOTSTRAP_ENABLED="${SAMSAR_SETUP_BOOTSTRAP:-1}"
INSTALL_DOCKER_ENABLED="${SAMSAR_SETUP_INSTALL_DOCKER:-1}"
MIN_DOCKER_DESKTOP_MACOS_VERSION="4.84.0"
MIN_DOCKER_ENGINE_LINUX_VERSION="20.10.0"
MIN_DOCKER_COMPOSE_VERSION="2.20.0"
ALLOW_DOCKER_CONVENIENCE_SCRIPT="${SAMSAR_SETUP_ALLOW_DOCKER_CONVENIENCE_SCRIPT:-1}"
RESOURCE_CHECK_ENABLED="${SAMSAR_SETUP_RESOURCE_CHECK:-1}"
MIN_MEMORY_GB="${SAMSAR_SETUP_MIN_MEMORY_GB:-16}"
MIN_DISK_FREE_GB="${SAMSAR_SETUP_MIN_DISK_FREE_GB:-50}"
ASSUME_YES="${SAMSAR_SETUP_YES:-0}"
OPEN_SETUP_PORT_MODE="${SAMSAR_SETUP_OPEN_SETUP_PORT:-ask}"
OPEN_CLOUD_PORT_MODE="${SAMSAR_SETUP_OPEN_CLOUD_PORT:-ask}"
INSTALL_CLOUD_CLI_ENABLED="${SAMSAR_SETUP_INSTALL_CLOUD_CLI:-1}"
AZURE_NSG_PRIORITY="${SAMSAR_SETUP_AZURE_NSG_PRIORITY:-1000}"
DOCKER_GROUP_CHANGED=0
DOCKER_CMD=(docker)
OS_ID=""
OS_ID_LIKE=""
OS_PRETTY_NAME="$(uname -s 2>/dev/null || echo unknown)"
OS_VERSION_CODENAME=""
OS_UBUNTU_CODENAME=""
PACKAGE_MANAGER=""
CLOUD_ENVIRONMENT=""
DOCKER_ENGINE_VERSION=""
DOCKER_COMPOSE_VERSION=""
DOCKER_ENGINE_COMPATIBLE=0
DOCKER_COMPOSE_COMPATIBLE=0
DOCKER_BUILDX_AVAILABLE=0
DOCKER_ENGINE_PACKAGE_UPDATED=0
DOCKER_UPDATE_CHANNEL=""
DOCKER_UPDATE_GUIDE=""
PROVIDER_ENV_DOCKER_ARGS=()
PROVIDER_ENV_ALLOWLIST=""
DEFAULT_PROVIDER_ENV_NAMES=(
  SAMSAR_API_KEY
  OPENAI_API_KEY
  OPENROUTER_API_KEY
  GOOGLE_APPLICATION_CREDENTIALS_JSON_B64
  GOOGLE_APPLICATION_CREDENTIALS_JSON
  KIMI_K3_API_KEY
  ALIBABA_API_KEY
  ALIBABA_API_HOST
  DASHSCOPE_API_KEY
  DASHSCOPE_BASE_URL
  FAL_API_KEY
  ELEVENLABS_API_KEY
  ELEVENLABS_API_TOKEN
  RUNWAY_API_KEY
  RUNWAYML_API_KEY
)

log() {
  echo "[setup-wizard] $*"
}

warn() {
  echo "[setup-wizard] $*" >&2
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

build_provider_environment_forwarding() {
  local raw_custom_names name existing configured_name
  local -a provider_env_names
  provider_env_names=("${DEFAULT_PROVIDER_ENV_NAMES[@]}")
  raw_custom_names="${SAMSAR_SETUP_PROVIDER_ENV_NAMES:-}"
  raw_custom_names="${raw_custom_names//,/ }"

  for name in $raw_custom_names; do
    [[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] ||
      die "Invalid provider environment variable name: $name"
    existing=0
    for configured_name in "${provider_env_names[@]}"; do
      if [[ "$configured_name" == "$name" ]]; then
        existing=1
        break
      fi
    done
    if [[ "$existing" == 0 ]]; then
      provider_env_names+=("$name")
    fi
  done

  PROVIDER_ENV_DOCKER_ARGS=()
  for name in "${provider_env_names[@]}"; do
    if printenv "$name" >/dev/null 2>&1; then
      PROVIDER_ENV_DOCKER_ARGS+=(--env "$name=${!name}")
    fi
  done
  PROVIDER_ENV_ALLOWLIST="$(IFS=,; printf '%s' "${provider_env_names[*]}")"
}

version_at_least() {
  local current="${1%%[-+]*}"
  local required="${2%%[-+]*}"
  local index current_part required_part
  local -a current_parts required_parts

  IFS='.' read -r -a current_parts <<< "$current"
  IFS='.' read -r -a required_parts <<< "$required"

  for index in 0 1 2; do
    current_part="${current_parts[$index]:-0}"
    required_part="${required_parts[$index]:-0}"
    [[ "$current_part" =~ ^[0-9]+$ && "$required_part" =~ ^[0-9]+$ ]] || return 1
    if (( current_part > required_part )); then
      return 0
    fi
    if (( current_part < required_part )); then
      return 1
    fi
  done

  return 0
}

normalize_version() {
  local raw="${1:-}"
  raw="${raw#v}"
  if [[ "$raw" =~ ([0-9]+)\.([0-9]+)(\.([0-9]+))? ]]; then
    printf '%s.%s.%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[4]:-0}"
    return 0
  fi
  return 1
}

docker_desktop_macos_version() {
  local plist="/Applications/Docker.app/Contents/Info.plist"
  [[ "$(uname -s 2>/dev/null || true)" == "Darwin" && -r "$plist" ]] || return 1

  if command -v plutil >/dev/null 2>&1; then
    plutil -extract CFBundleShortVersionString raw -o - "$plist" 2>/dev/null && return 0
  fi
  if [[ -x /usr/libexec/PlistBuddy ]]; then
    /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist" 2>/dev/null
  fi
}

wait_for_docker_desktop_macos_version() {
  local attempt installed_version
  for attempt in $(seq 1 60); do
    installed_version="$(docker_desktop_macos_version || true)"
    if [[ -n "$installed_version" ]] &&
      version_at_least "$installed_version" "$MIN_DOCKER_DESKTOP_MACOS_VERSION"; then
      printf '%s\n' "$installed_version"
      return 0
    fi
    sleep 1
  done
  return 1
}

ensure_docker_desktop_macos_version() {
  local installed_version
  [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]] || return 0

  installed_version="$(docker_desktop_macos_version || true)"
  [[ -n "$installed_version" ]] ||
    die "Could not determine the installed Docker Desktop version. Install Docker Desktop ${MIN_DOCKER_DESKTOP_MACOS_VERSION} or newer from $(docker_install_docs_url)."

  if version_at_least "$installed_version" "$MIN_DOCKER_DESKTOP_MACOS_VERSION"; then
    log "Docker Desktop ${installed_version} satisfies the macOS minimum (${MIN_DOCKER_DESKTOP_MACOS_VERSION})."
    return 0
  fi

  warn "Docker Desktop ${installed_version} is older than the required macOS minimum ${MIN_DOCKER_DESKTOP_MACOS_VERSION}."
  enabled "$BOOTSTRAP_ENABLED" && enabled "$INSTALL_DOCKER_ENABLED" ||
    die "Update Docker Desktop to ${MIN_DOCKER_DESKTOP_MACOS_VERSION} or newer, then rerun setup. Guide: $(docker_install_docs_url)"

  if docker desktop update --help >/dev/null 2>&1; then
    log "Updating Docker Desktop to ${MIN_DOCKER_DESKTOP_MACOS_VERSION} or newer..."
    if docker desktop update --quiet; then
      installed_version="$(wait_for_docker_desktop_macos_version || true)"
      if [[ -n "$installed_version" ]]; then
        log "Docker Desktop updated to ${installed_version}."
        return 0
      fi
    else
      warn "Docker Desktop's in-place updater did not complete successfully."
    fi
  fi

  if command -v brew >/dev/null 2>&1 && brew list --cask docker >/dev/null 2>&1; then
    log "Updating Docker Desktop with Homebrew..."
    if brew upgrade --cask docker; then
      installed_version="$(wait_for_docker_desktop_macos_version || true)"
      if [[ -n "$installed_version" ]]; then
        log "Docker Desktop updated to ${installed_version}."
        return 0
      fi
    else
      warn "Homebrew could not update Docker Desktop."
    fi
  fi

  die "Docker Desktop ${MIN_DOCKER_DESKTOP_MACOS_VERSION} or newer is required on macOS. Update it from $(docker_install_docs_url), then rerun setup."
}

usage() {
  cat <<EOF
Usage: ./setup.sh [options]

Options:
  -y, --yes             Run non-interactively and open TCP ${HOST_PORT} in host/cloud firewalls when possible.
      --open-setup-port Open TCP ${HOST_PORT} in host/cloud firewalls when possible.
      --no-open-setup-port
                        Do not change firewall rules for TCP ${HOST_PORT}.
  -h, --help            Show this help text.

Environment:
  SAMSAR_SETUP_OPEN_SETUP_PORT=ask|true|false
  SAMSAR_SETUP_OPEN_CLOUD_PORT=ask|true|false
  SAMSAR_SETUP_INSTALL_DOCKER=1
  SAMSAR_SETUP_INSTALL_CLOUD_CLI=1
  SAMSAR_SETUP_AZURE_NSG_PRIORITY=1000
  SAMSAR_SETUP_YES=1
  SAMSAR_SETUP_MIN_DISK_FREE_GB=<gb>

Node.js and npm are not required on the host. They run inside the setup
wizard container. On supported Linux hosts, missing Docker CE, Buildx, and
the Compose plugin are installed automatically before the wizard starts.
Existing Linux installations must provide Engine ${MIN_DOCKER_ENGINE_LINUX_VERSION}+, Compose
${MIN_DOCKER_COMPOSE_VERSION}+, and Buildx; recognized package channels can be updated in place.
On macOS, Docker Desktop ${MIN_DOCKER_DESKTOP_MACOS_VERSION} or newer is required.
EOF
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -y|--yes)
        ASSUME_YES=1
        OPEN_SETUP_PORT_MODE=true
        OPEN_CLOUD_PORT_MODE=true
        shift
        ;;
      --open-setup-port)
        OPEN_SETUP_PORT_MODE=true
        OPEN_CLOUD_PORT_MODE=true
        shift
        ;;
      --no-open-setup-port)
        OPEN_SETUP_PORT_MODE=false
        OPEN_CLOUD_PORT_MODE=false
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "Unknown option: $1"
        ;;
    esac
  done
}

is_linux() {
  [[ "$(uname -s 2>/dev/null || true)" == "Linux" ]]
}

load_os_release() {
  if [[ -r /etc/os-release ]]; then
    # shellcheck disable=SC1091
    . /etc/os-release
    OS_ID="${ID:-}"
    OS_ID_LIKE="${ID_LIKE:-}"
    OS_PRETTY_NAME="${PRETTY_NAME:-$OS_PRETTY_NAME}"
    OS_VERSION_CODENAME="${VERSION_CODENAME:-}"
    OS_UBUNTU_CODENAME="${UBUNTU_CODENAME:-}"
  fi
}

detect_package_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    PACKAGE_MANAGER="apt"
  elif command -v dnf >/dev/null 2>&1; then
    PACKAGE_MANAGER="dnf"
  elif command -v yum >/dev/null 2>&1; then
    PACKAGE_MANAGER="yum"
  elif command -v apk >/dev/null 2>&1; then
    PACKAGE_MANAGER="apk"
  elif command -v pacman >/dev/null 2>&1; then
    PACKAGE_MANAGER="pacman"
  else
    PACKAGE_MANAGER=""
  fi
}

detect_cloud_environment() {
  local vendor product version_data
  vendor="$(cat /sys/class/dmi/id/sys_vendor 2>/dev/null || true)"
  product="$(cat /sys/class/dmi/id/product_name 2>/dev/null || true)"
  version_data="$(cat /sys/class/dmi/id/product_version 2>/dev/null || true)"
  case "${vendor} ${product} ${version_data}" in
    *Microsoft*|*Azure*)
      CLOUD_ENVIRONMENT="Azure"
      ;;
    *Amazon*|*EC2*)
      CLOUD_ENVIRONMENT="AWS EC2"
      ;;
    *Google*)
      CLOUD_ENVIRONMENT="Google Cloud"
      ;;
    *Oracle*)
      CLOUD_ENVIRONMENT="Oracle Cloud"
      ;;
    *)
      CLOUD_ENVIRONMENT=""
      ;;
  esac
}

format_mib_as_gib() {
  awk -v mib="${1:-0}" 'BEGIN { printf "%.1f GiB", mib / 1024 }'
}

format_kib_as_gib() {
  awk -v kib="${1:-0}" 'BEGIN { printf "%.1f GiB", kib / 1048576 }'
}

detect_total_memory_mib() {
  if [[ -r /proc/meminfo ]]; then
    awk '/^MemTotal:/ { printf "%d\n", int(($2 + 1023) / 1024); exit }' /proc/meminfo
    return 0
  fi
  if command -v free >/dev/null 2>&1; then
    free -m | awk '/^Mem:/ { print $2; exit }'
    return 0
  fi
  if command -v sysctl >/dev/null 2>&1; then
    sysctl -n hw.memsize 2>/dev/null | awk '{ printf "%d\n", int(($1 / 1048576) + 0.999) }'
    return 0
  fi
  return 1
}

detect_free_disk_kib() {
  df -Pk "$ROOT_DIR" 2>/dev/null | awk 'NR == 2 { print $4; exit }'
}

detect_largest_disk_summary() {
  df -Pk 2>/dev/null | awk '
    NR > 1 && $4 ~ /^[0-9]+$/ && $6 !~ /^\/(dev|proc|sys|run)(\/|$)/ {
      if ($4 > max) {
        max = $4
        mount = $6
      }
    }
    END {
      if (max > 0) {
        printf "%.1f GiB free at %s", max / 1048576, mount
      }
    }
  '
}

require_system_resources() {
  local memory_mib disk_free_kib required_memory_mib required_disk_free_kib largest_disk_summary
  enabled "$RESOURCE_CHECK_ENABLED" || return 0

  memory_mib="$(detect_total_memory_mib || true)"
  disk_free_kib="$(detect_free_disk_kib || true)"
  required_memory_mib=$((MIN_MEMORY_GB * 1024))
  required_disk_free_kib=$((MIN_DISK_FREE_GB * 1024 * 1024))

  if [[ -z "$memory_mib" || ! "$memory_mib" =~ ^[0-9]+$ ]]; then
    die "Unable to determine system memory. This setup requires at least ${MIN_MEMORY_GB} GB RAM."
  fi
  if [[ -z "$disk_free_kib" || ! "$disk_free_kib" =~ ^[0-9]+$ ]]; then
    die "Unable to determine free disk space for ${ROOT_DIR}. This setup requires at least ${MIN_DISK_FREE_GB} GB free disk."
  fi
  if (( memory_mib < required_memory_mib )); then
    die "System check failed: detected $(format_mib_as_gib "$memory_mib") RAM, but Samsar Docker setup requires at least ${MIN_MEMORY_GB} GB RAM."
  fi
  if (( disk_free_kib < required_disk_free_kib )); then
    largest_disk_summary="$(detect_largest_disk_summary || true)"
    if [[ -n "$largest_disk_summary" ]]; then
      warn "Largest detected non-system filesystem: ${largest_disk_summary}."
    fi
    warn "Attach or resize a disk so the Samsar repo and Docker data root have at least ${MIN_DISK_FREE_GB} GB free, then rerun this script."
    warn "For a constrained test-only deployment, lower the check with SAMSAR_SETUP_MIN_DISK_FREE_GB=<gb>."
    die "System check failed: detected $(format_kib_as_gib "$disk_free_kib") free on the filesystem containing ${ROOT_DIR}, but Samsar Docker setup requires at least ${MIN_DISK_FREE_GB} GB free disk."
  fi

  log "System check passed: $(format_mib_as_gib "$memory_mib") RAM, $(format_kib_as_gib "$disk_free_kib") free disk."
}

run_as_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    die "This setup needs root privileges for host package/service changes, but sudo is not installed."
  fi
}

run_as_root_preserve_env() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -E "$@"
  else
    die "This setup needs root privileges for host package/service changes, but sudo is not installed."
  fi
}

docker_install_docs_url() {
  if is_linux; then
    if is_wsl_environment; then
      echo "https://docs.docker.com/desktop/setup/install/windows-install/"
      return 0
    fi
    case "$OS_ID" in
      ubuntu|pop|linuxmint|elementary|neon)
        echo "https://docs.docker.com/engine/install/ubuntu/"
        ;;
      debian)
        echo "https://docs.docker.com/engine/install/debian/"
        ;;
      fedora)
        echo "https://docs.docker.com/engine/install/fedora/"
        ;;
      rhel)
        echo "https://docs.docker.com/engine/install/rhel/"
        ;;
      centos|rocky|almalinux|ol)
        echo "https://docs.docker.com/engine/install/centos/"
        ;;
      *)
        if [[ "$OS_ID_LIKE" == *ubuntu* ]]; then
          echo "https://docs.docker.com/engine/install/ubuntu/"
        elif [[ "$OS_ID_LIKE" == *debian* ]]; then
          echo "https://docs.docker.com/engine/install/debian/"
        elif [[ "$OS_ID_LIKE" == *fedora* ]]; then
          echo "https://docs.docker.com/engine/install/fedora/"
        elif [[ "$OS_ID_LIKE" == *rhel* ]]; then
          echo "https://docs.docker.com/engine/install/rhel/"
        else
          echo "https://docs.docker.com/engine/install/"
        fi
        ;;
    esac
    return 0
  fi

  case "$(uname -s 2>/dev/null || true)" in
    Darwin)
      echo "https://docs.docker.com/desktop/setup/install/mac-install/"
      ;;
    *)
      echo "https://docs.docker.com/get-docker/"
      ;;
  esac
}

is_wsl_environment() {
  grep -Eqi 'microsoft|wsl' /proc/sys/kernel/osrelease /proc/version 2>/dev/null
}

docker_update_docs_url() {
  if [[ -n "$DOCKER_UPDATE_GUIDE" ]]; then
    printf '%s\n' "$DOCKER_UPDATE_GUIDE"
  else
    docker_install_docs_url
  fi
}

print_docker_install_hint() {
  warn "Docker is not installed or not available on PATH."
  warn "Detected environment: ${OS_PRETTY_NAME}${CLOUD_ENVIRONMENT:+ on $CLOUD_ENVIRONMENT}"
  warn "Install guide: $(docker_install_docs_url)"
}

ensure_base_packages() {
  case "$PACKAGE_MANAGER" in
    apt)
      run_as_root apt-get update
      run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl gnupg git iproute2
      ;;
    dnf)
      run_as_root dnf install -y ca-certificates curl gnupg git iproute
      ;;
    yum)
      run_as_root yum install -y ca-certificates curl gnupg git iproute
      ;;
    apk)
      run_as_root apk add --no-cache bash ca-certificates curl git iproute2
      ;;
    pacman)
      # Arch does not support partial upgrades; synchronize the whole system
      # before installing bootstrap packages.
      run_as_root pacman -Syu --needed --noconfirm ca-certificates curl gnupg git iproute2
      ;;
    *)
      if ! command -v curl >/dev/null 2>&1; then
        die "No supported package manager was detected and curl is missing; cannot bootstrap prerequisites."
      fi
      ;;
  esac
}

docker_apt_repo_id() {
  case "$OS_ID" in
    ubuntu|pop|linuxmint|elementary|neon)
      echo "ubuntu"
      ;;
    debian)
      echo "debian"
      ;;
    *)
      if [[ "$OS_ID_LIKE" == *ubuntu* ]]; then
        echo "ubuntu"
      elif [[ "$OS_ID_LIKE" == *debian* ]]; then
        echo "debian"
      else
        return 1
      fi
      ;;
  esac
}

docker_apt_suite() {
  local repo_id="$1"
  if [[ "$repo_id" == "ubuntu" ]]; then
    echo "${OS_UBUNTU_CODENAME:-$OS_VERSION_CODENAME}"
  else
    echo "$OS_VERSION_CODENAME"
  fi
}

install_docker_apt() {
  local repo_id suite arch
  repo_id="$(docker_apt_repo_id)" || return 1
  suite="$(docker_apt_suite "$repo_id")"
  arch="$(dpkg --print-architecture)" || return 1
  [[ -n "$suite" ]] || return 1

  log "Configuring Docker apt repository for ${repo_id}/${suite}..."
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get remove -y docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc >/dev/null 2>&1 || true
  run_as_root install -m 0755 -d /etc/apt/keyrings || return 1
  run_as_root curl -fsSL "https://download.docker.com/linux/${repo_id}/gpg" -o /etc/apt/keyrings/docker.asc || return 1
  run_as_root chmod a+r /etc/apt/keyrings/docker.asc || return 1
  printf '%s\n' \
    "Types: deb" \
    "URIs: https://download.docker.com/linux/${repo_id}" \
    "Suites: ${suite}" \
    "Components: stable" \
    "Architectures: ${arch}" \
    "Signed-By: /etc/apt/keyrings/docker.asc" |
    run_as_root tee /etc/apt/sources.list.d/docker.sources >/dev/null || return 1
  run_as_root apt-get update || return 1
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || return 1
}

install_docker_amazon_linux() {
  [[ "$OS_ID" == "amzn" ]] || return 1
  log "Installing Docker from Amazon Linux packages..."
  run_as_root "$PACKAGE_MANAGER" install -y docker || return 1
  run_as_root "$PACKAGE_MANAGER" install -y docker-compose-plugin docker-buildx-plugin >/dev/null 2>&1 || true
}

install_docker_rpm() {
  local repo_id
  case "$OS_ID" in
    fedora)
      repo_id="fedora"
      ;;
    rhel)
      repo_id="rhel"
      ;;
    centos|rocky|almalinux|ol)
      repo_id="centos"
      ;;
    *)
      return 1
      ;;
  esac

  log "Configuring Docker rpm repository for ${repo_id}..."
  if [[ "$PACKAGE_MANAGER" == "dnf" ]]; then
    run_as_root dnf install -y dnf-plugins-core || return 1
    run_as_root dnf config-manager --add-repo "https://download.docker.com/linux/${repo_id}/docker-ce.repo" || return 1
    run_as_root dnf install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || return 1
  else
    run_as_root yum install -y yum-utils || return 1
    run_as_root yum-config-manager --add-repo "https://download.docker.com/linux/${repo_id}/docker-ce.repo" || return 1
    run_as_root yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin || return 1
  fi
}

install_docker_alpine() {
  [[ "$PACKAGE_MANAGER" == "apk" ]] || return 1
  log "Installing Docker from Alpine packages..."
  run_as_root apk add --no-cache docker docker-cli-compose docker-cli-buildx || return 1
}

approve_arch_full_upgrade() {
  warn "Arch Linux requires a full system upgrade before Docker packages can be safely installed or updated."
  if confirm_action "Run 'sudo pacman -Syu' and update Docker packages now?"; then
    return 0
  fi
  warn "No system packages were changed. Run 'sudo pacman -Syu docker docker-compose docker-buildx', then rerun setup."
  return 1
}

install_docker_arch() {
  [[ "$PACKAGE_MANAGER" == "pacman" ]] || return 1
  approve_arch_full_upgrade || return 1
  log "Installing Docker from Arch packages..."
  run_as_root pacman -Syu --needed --noconfirm \
    ca-certificates curl gnupg git iproute2 docker docker-compose docker-buildx || return 1
}

install_docker_convenience_script() {
  enabled "$ALLOW_DOCKER_CONVENIENCE_SCRIPT" || return 1
  command -v curl >/dev/null 2>&1 || return 1
  log "Falling back to Docker's convenience installer..."
  curl -fsSL https://get.docker.com -o /tmp/samsar-get-docker.sh || return 1
  run_as_root sh /tmp/samsar-get-docker.sh || return 1
  rm -f /tmp/samsar-get-docker.sh
}

install_docker_desktop_macos() {
  command -v brew >/dev/null 2>&1 || {
    warn "Automatic Docker Desktop installation on macOS requires Homebrew."
    warn "Install Homebrew from https://brew.sh or install Docker Desktop from $(docker_install_docs_url)."
    return 1
  }

  log "Installing the latest Docker Desktop available through Homebrew..."
  brew install --cask docker || return 1
  if [[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
    export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
  fi
}

install_docker_engine() {
  if [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]]; then
    if [[ -x /Applications/Docker.app/Contents/Resources/bin/docker ]]; then
      export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
    elif [[ ! -d /Applications/Docker.app ]]; then
      print_docker_install_hint
      enabled "$BOOTSTRAP_ENABLED" || exit 1
      enabled "$INSTALL_DOCKER_ENABLED" || die "Automatic Docker installation is disabled. Install Docker from $(docker_install_docs_url), then rerun this script."
      install_docker_desktop_macos ||
        die "Could not install Docker Desktop automatically. Use: $(docker_install_docs_url)"
    fi
    command -v docker >/dev/null 2>&1 ||
      die "Docker Desktop installation completed, but docker is still not on PATH. Restart the shell and rerun setup."
    return 0
  fi

  command -v docker >/dev/null 2>&1 && return 0
  print_docker_install_hint
  enabled "$BOOTSTRAP_ENABLED" || exit 1
  enabled "$INSTALL_DOCKER_ENABLED" || die "Automatic Docker installation is disabled. Install Docker from $(docker_install_docs_url), then rerun this script."

  is_linux || die "Automatic Docker installation is not supported on this host. Install Docker from the guide above, then rerun this script."
  if is_wsl_environment; then
    die "Install or update Docker Desktop on Windows, enable WSL integration for this distribution, and rerun setup. Guide: $(docker_install_docs_url)"
  fi

  log "Attempting automatic Docker installation..."
  if [[ "$PACKAGE_MANAGER" == "pacman" ]]; then
    install_docker_arch ||
      die "Arch Docker installation was not approved. Run 'sudo pacman -Syu docker docker-compose docker-buildx', then rerun setup."
  else
    ensure_base_packages
  fi
  case "$PACKAGE_MANAGER" in
    apt)
      install_docker_apt || install_docker_convenience_script || die "Could not install Docker automatically. Use: $(docker_install_docs_url)"
      ;;
    dnf|yum)
      install_docker_amazon_linux || install_docker_rpm || install_docker_convenience_script || die "Could not install Docker automatically. Use: $(docker_install_docs_url)"
      ;;
    apk)
      install_docker_alpine || die "Could not install Docker automatically. Use: $(docker_install_docs_url)"
      ;;
    pacman)
      ;;
    *)
      install_docker_convenience_script || die "Could not install Docker automatically. Use: $(docker_install_docs_url)"
      ;;
  esac

  command -v docker >/dev/null 2>&1 || die "Docker installation completed, but docker is still not on PATH. Use: $(docker_install_docs_url)"
}

start_docker_service() {
  local attempt context_name context_host docker_path
  if [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]]; then
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    command -v open >/dev/null 2>&1 || return 0
    log "Starting Docker Desktop..."
    open -ga Docker >/dev/null 2>&1 || true
    for attempt in $(seq 1 90); do
      docker info >/dev/null 2>&1 && return 0
      sleep 2
    done
    return 0
  fi

  is_linux || return 0
  docker info >/dev/null 2>&1 && return 0
  enabled "$BOOTSTRAP_ENABLED" || {
    warn "Host bootstrap is disabled; Docker services will not be started automatically."
    return 0
  }

  context_name="${DOCKER_CONTEXT:-$(docker context show 2>/dev/null || true)}"
  context_host="$(active_docker_endpoint || true)"
  if [[ -n "$context_host" && "$context_host" != unix://* ]]; then
    warn "The active Docker context uses ${context_host}; local Docker services will not be started."
    return 0
  fi
  if [[ "$context_name" == "desktop-linux" || "$context_host" == *'/.docker/desktop/docker.sock' ]]; then
    log "Starting Docker Desktop for Linux..."
    if docker desktop start --help >/dev/null 2>&1; then
      docker desktop start >/dev/null 2>&1 || true
    elif command -v systemctl >/dev/null 2>&1; then
      systemctl --user start docker-desktop >/dev/null 2>&1 || true
    fi
    for attempt in $(seq 1 90); do
      docker info >/dev/null 2>&1 && return 0
      sleep 2
    done
    return 0
  fi
  if is_wsl_environment; then
    warn "Docker Desktop is not reachable from WSL; an in-distribution system Engine will not be started."
    warn "Start or update Docker Desktop on Windows and enable WSL integration for this distribution."
    return 0
  fi
  if [[ "$context_name" == "rootless" || "$context_host" == unix:///run/user/* ]]; then
    warn "The active Docker context is rootless; the system Docker service will not be started."
    return 0
  fi
  if [[ -n "$context_host" && "$context_host" != "unix:///var/run/docker.sock" && "$context_host" != "unix:///run/docker.sock" ]]; then
    warn "The active Docker context uses ${context_host}; a different system Docker service will not be started."
    return 0
  fi

  docker_path="$(command -v docker 2>/dev/null || true)"
  log "Starting Docker service..."
  if [[ "$docker_path" == /snap/bin/* || "$(readlink -f "$docker_path" 2>/dev/null || true)" == /snap/docker/* ]]; then
    if command -v systemctl >/dev/null 2>&1; then
      run_as_root systemctl enable --now snap.docker.dockerd >/dev/null 2>&1 || true
    elif command -v snap >/dev/null 2>&1; then
      run_as_root snap start --enable docker >/dev/null 2>&1 || true
    fi
  elif command -v systemctl >/dev/null 2>&1; then
    run_as_root systemctl enable --now containerd >/dev/null 2>&1 || true
    run_as_root systemctl enable --now docker >/dev/null 2>&1 || run_as_root systemctl start docker >/dev/null 2>&1 || true
  elif command -v rc-service >/dev/null 2>&1; then
    run_as_root rc-update add docker default >/dev/null 2>&1 || true
    run_as_root rc-service docker start >/dev/null 2>&1 || true
  elif command -v service >/dev/null 2>&1; then
    run_as_root service docker start >/dev/null 2>&1 || true
  fi
}

target_docker_user() {
  if [[ -n "${SAMSAR_SETUP_TARGET_USER:-}" ]]; then
    echo "$SAMSAR_SETUP_TARGET_USER"
  elif [[ -n "${SUDO_USER:-}" && "${SUDO_USER:-}" != "root" ]]; then
    echo "$SUDO_USER"
  else
    id -un
  fi
}

ensure_docker_group_permissions() {
  local target_user
  is_linux || return 0
  enabled "$BOOTSTRAP_ENABLED" || {
    warn "Host bootstrap is disabled; Docker group membership will not be changed."
    return 0
  }
  target_user="$(target_docker_user)"
  [[ "$target_user" != "root" ]] || return 0
  id "$target_user" >/dev/null 2>&1 || return 0

  if ! getent group docker >/dev/null 2>&1; then
    log "Creating docker group..."
    run_as_root groupadd docker
  fi

  if ! id -nG "$target_user" | tr ' ' '\n' | grep -qx docker; then
    log "Adding ${target_user} to docker group..."
    run_as_root usermod -aG docker "$target_user"
    DOCKER_GROUP_CHANGED=1
  fi
}

try_docker_info() {
  "$@" info 2>&1 >/dev/null
}

docker_cli() {
  "${DOCKER_CMD[@]}" "$@"
}

active_docker_endpoint() {
  local context_name
  if [[ "${DOCKER_CMD[0]:-docker}" == "sudo" ]]; then
    context_name="$(docker_cli context show 2>/dev/null || true)"
  elif [[ -n "${DOCKER_CONTEXT:-}" ]]; then
    context_name="$DOCKER_CONTEXT"
  elif [[ -n "${DOCKER_HOST:-}" ]]; then
    printf '%s\n' "$DOCKER_HOST"
    return 0
  else
    context_name="$(docker_cli context show 2>/dev/null || true)"
  fi
  [[ -n "$context_name" ]] || return 1
  docker_cli context inspect "$context_name" --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null
}

select_docker_command() {
  local docker_info_output sudo_info_output requested_endpoint
  if docker_info_output="$(try_docker_info docker)"; then
    DOCKER_CMD=(docker)
    return 0
  fi

  if printf '%s\n' "$docker_info_output" | grep -Eqi 'permission denied|connect: permission denied|Got permission denied'; then
    ensure_docker_group_permissions
  fi

  requested_endpoint="$(active_docker_endpoint || true)"
  if [[ -z "$requested_endpoint" ]]; then
    warn "The active Docker endpoint could not be identified; sudo will not use a potentially different Docker context."
  elif [[ "$requested_endpoint" != "unix:///var/run/docker.sock" \
    && "$requested_endpoint" != "unix:///run/docker.sock" ]]; then
    warn "The active Docker endpoint is ${requested_endpoint}; sudo will not be redirected to root's different Docker context."
  elif command -v sudo >/dev/null 2>&1 && sudo_info_output="$(
    try_docker_info sudo env \
      -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_CONFIG \
      -u DOCKER_CERT_PATH -u DOCKER_TLS_VERIFY docker
  )"; then
    DOCKER_CMD=(
      sudo env
      -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_CONFIG
      -u DOCKER_CERT_PATH -u DOCKER_TLS_VERIFY docker
    )
    if (( DOCKER_GROUP_CHANGED )); then
      warn "Using sudo for Docker in this run. Start a new SSH session later to use Docker without sudo."
    else
      warn "Current user cannot access Docker directly; using sudo for Docker in this run."
    fi
    return 0
  fi

  warn "Docker is installed, but the Docker CLI cannot reach the daemon."
  if [[ -n "$docker_info_output" ]]; then
    warn "$docker_info_output"
  elif [[ -n "${sudo_info_output:-}" ]]; then
    warn "$sudo_info_output"
  fi
  die "Fix Docker using the install guide for this host: $(docker_install_docs_url)"
}

probe_linux_docker_requirements() {
  local raw_version

  DOCKER_ENGINE_VERSION=""
  DOCKER_COMPOSE_VERSION=""
  DOCKER_ENGINE_COMPATIBLE=0
  DOCKER_COMPOSE_COMPATIBLE=0
  DOCKER_BUILDX_AVAILABLE=0

  raw_version="$(docker_cli version --format '{{.Server.Version}}' 2>/dev/null || true)"
  DOCKER_ENGINE_VERSION="$(normalize_version "$raw_version" || true)"
  if [[ -n "$DOCKER_ENGINE_VERSION" ]] &&
    version_at_least "$DOCKER_ENGINE_VERSION" "$MIN_DOCKER_ENGINE_LINUX_VERSION"; then
    DOCKER_ENGINE_COMPATIBLE=1
  fi

  raw_version="$(docker_cli compose version --short 2>/dev/null || true)"
  if [[ -z "$raw_version" ]]; then
    raw_version="$(docker_cli compose version 2>/dev/null || true)"
  fi
  DOCKER_COMPOSE_VERSION="$(normalize_version "$raw_version" || true)"
  if [[ -n "$DOCKER_COMPOSE_VERSION" ]] &&
    version_at_least "$DOCKER_COMPOSE_VERSION" "$MIN_DOCKER_COMPOSE_VERSION"; then
    DOCKER_COMPOSE_COMPATIBLE=1
  fi

  if docker_cli buildx version >/dev/null 2>&1; then
    DOCKER_BUILDX_AVAILABLE=1
  fi
}

linux_docker_requirements_met() {
  (( DOCKER_ENGINE_COMPATIBLE && DOCKER_COMPOSE_COMPATIBLE && DOCKER_BUILDX_AVAILABLE ))
}

linux_docker_requirements_summary() {
  local engine_display="${DOCKER_ENGINE_VERSION:-not detected}"
  local compose_display="${DOCKER_COMPOSE_VERSION:-not installed}"
  local buildx_display="missing"
  (( DOCKER_BUILDX_AVAILABLE )) && buildx_display="available"
  printf 'Engine %s (required >= %s), Compose %s (required >= %s), Buildx %s' \
    "$engine_display" "$MIN_DOCKER_ENGINE_LINUX_VERSION" \
    "$compose_display" "$MIN_DOCKER_COMPOSE_VERSION" "$buildx_display"
}

docker_is_desktop_backed() {
  local details
  details="$(docker_cli info --format '{{.OperatingSystem}} {{.Name}}' 2>/dev/null || true)"
  printf '%s\n' "$details" | grep -Eqi 'docker[[:space:]-]*desktop'
}

docker_is_rootless() {
  local security_options
  security_options="$(docker_cli info --format '{{json .SecurityOptions}}' 2>/dev/null || true)"
  printf '%s\n' "$security_options" | grep -qi 'rootless'
}

docker_uses_local_unix_socket() {
  local context_host
  context_host="$(active_docker_endpoint || true)"
  [[ "$context_host" == "unix:///var/run/docker.sock" || "$context_host" == "unix:///run/docker.sock" ]]
}

active_docker_cli_paths() {
  local docker_path resolved_path
  docker_path="$(command -v docker 2>/dev/null || true)"
  [[ -n "$docker_path" ]] || return 1
  printf '%s\n' "$docker_path"
  resolved_path="$(readlink -f "$docker_path" 2>/dev/null || true)"
  if [[ -n "$resolved_path" && "$resolved_path" != "$docker_path" ]]; then
    printf '%s\n' "$resolved_path"
  fi
}

dpkg_owner_of_active_docker_cli() {
  local docker_path owner
  while IFS= read -r docker_path; do
    owner="$(dpkg-query -S "$docker_path" 2>/dev/null | head -n 1 | cut -d: -f1 || true)"
    if [[ -n "$owner" ]]; then
      printf '%s\n' "$owner"
      return 0
    fi
  done < <(active_docker_cli_paths)
  return 1
}

detect_apt_docker_family() {
  local owner owner_family="" installed_family="" family_count=0
  owner="$(dpkg_owner_of_active_docker_cli || true)"
  case "$owner" in
    docker-ce-cli) owner_family="docker-ce" ;;
    docker.io) owner_family="docker.io" ;;
    moby-cli) owner_family="moby" ;;
  esac
  [[ -n "$owner_family" ]] || {
    warn "The active Docker CLI is not owned by a recognized apt Docker package; no packages will be changed."
    return 1
  }

  if dpkg_package_installed docker-ce || dpkg_package_installed docker-ce-cli; then
    installed_family="docker-ce"
    ((family_count += 1))
  fi
  if dpkg_package_installed docker.io; then
    installed_family="docker.io"
    ((family_count += 1))
  fi
  if dpkg_package_installed moby-engine || dpkg_package_installed moby-cli; then
    installed_family="moby"
    ((family_count += 1))
  fi
  if (( family_count != 1 )) || [[ "$installed_family" != "$owner_family" ]]; then
    warn "Multiple or mismatched apt Docker package families were detected; no packages will be changed."
    return 1
  fi

  if (( ! DOCKER_ENGINE_COMPATIBLE )); then
    case "$owner_family" in
      docker-ce) dpkg_package_installed docker-ce || return 1 ;;
      docker.io) dpkg_package_installed docker.io || return 1 ;;
      moby) dpkg_package_installed moby-engine || return 1 ;;
    esac
  fi
  printf '%s\n' "$owner_family"
}

dpkg_package_installed() {
  command -v dpkg-query >/dev/null 2>&1 || return 1
  dpkg-query -W -f='${db:Status-Status}\n' "$1" 2>/dev/null | grep -qx installed
}

apt_package_available() {
  command -v apt-cache >/dev/null 2>&1 || return 1
  apt-cache show "$1" >/dev/null 2>&1
}

first_available_apt_package() {
  local package
  for package in "$@"; do
    if apt_package_available "$package"; then
      printf '%s\n' "$package"
      return 0
    fi
  done
  return 1
}

update_existing_docker_apt() {
  local family="" compose_package="" buildx_package=""
  local -a packages=()

  family="$(detect_apt_docker_family || true)"
  [[ -n "$family" ]] || return 1

  log "Refreshing apt metadata for the existing ${family} package channel..."
  run_as_root apt-get update || return 1

  if (( ! DOCKER_ENGINE_COMPATIBLE )); then
    case "$family" in
      docker-ce)
        packages+=(docker-ce docker-ce-cli containerd.io)
        ;;
      docker.io)
        packages+=(docker.io)
        ;;
      moby)
        packages+=(moby-engine moby-cli)
        ;;
    esac
    DOCKER_ENGINE_PACKAGE_UPDATED=1
  fi

  if (( ! DOCKER_COMPOSE_COMPATIBLE )); then
    case "$family" in
      docker-ce)
        compose_package="$(first_available_apt_package docker-compose-plugin || true)"
        ;;
      docker.io)
        compose_package="$(first_available_apt_package docker-compose-v2 || true)"
        ;;
      moby)
        compose_package="$(first_available_apt_package moby-compose || true)"
        ;;
    esac
    [[ -n "$compose_package" ]] || {
      warn "No Compose package candidate was found in the existing ${family} apt channel."
      return 1
    }
    packages+=("$compose_package")
  fi

  if (( ! DOCKER_BUILDX_AVAILABLE )); then
    case "$family" in
      docker-ce)
        buildx_package="$(first_available_apt_package docker-buildx-plugin || true)"
        ;;
      docker.io)
        buildx_package="$(first_available_apt_package docker-buildx || true)"
        ;;
      moby)
        buildx_package="$(first_available_apt_package moby-buildx || true)"
        ;;
    esac
    [[ -n "$buildx_package" ]] || {
      warn "No Buildx package was found in the existing ${family} apt channel."
      return 1
    }
    packages+=("$buildx_package")
  fi

  ((${#packages[@]} > 0)) || return 0
  log "Updating Docker requirements from the existing ${family} apt channel..."
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y "${packages[@]}" || return 1
  DOCKER_UPDATE_CHANNEL="apt:${family}"
}

rpm_package_installed() {
  command -v rpm >/dev/null 2>&1 || return 1
  rpm -q "$1" >/dev/null 2>&1
}

rpm_owner_of_active_docker_cli() {
  local docker_path owner
  while IFS= read -r docker_path; do
    owner="$(rpm -qf --queryformat '%{NAME}\n' "$docker_path" 2>/dev/null | head -n 1 || true)"
    if [[ -n "$owner" ]]; then
      printf '%s\n' "$owner"
      return 0
    fi
  done < <(active_docker_cli_paths)
  return 1
}

detect_rpm_docker_family() {
  local owner installed_family="" family_count=0
  owner="$(rpm_owner_of_active_docker_cli || true)"

  if rpm_package_installed docker-ce; then
    installed_family="docker-ce"
    ((family_count += 1))
  fi
  if rpm_package_installed moby-engine; then
    installed_family="moby"
    ((family_count += 1))
  fi
  if rpm_package_installed docker; then
    installed_family="docker"
    ((family_count += 1))
  fi
  if (( family_count != 1 )); then
    warn "Multiple or missing rpm Docker Engine package families were detected; no packages will be changed."
    return 1
  fi

  case "$installed_family:$owner" in
    docker-ce:docker-ce-cli|moby:moby-cli|moby:docker-cli|docker:docker|docker:docker-cli)
      ;;
    *)
      warn "The active Docker CLI package (${owner:-unknown}) does not match the installed ${installed_family} Engine family; no packages will be changed."
      return 1
      ;;
  esac
  printf '%s\n' "$installed_family"
}

rpm_cli_package_for_family() {
  local family="$1" owner
  owner="$(rpm_owner_of_active_docker_cli || true)"
  case "$family:$owner" in
    docker-ce:docker-ce-cli) printf 'docker-ce-cli\n' ;;
    moby:moby-cli) printf 'moby-cli\n' ;;
    moby:docker-cli|docker:docker-cli) printf 'docker-cli\n' ;;
    docker:docker) printf 'docker\n' ;;
    *) return 1 ;;
  esac
}

rpm_package_available() {
  "$PACKAGE_MANAGER" info "$1" >/dev/null 2>&1
}

first_available_rpm_package() {
  local package
  for package in "$@"; do
    if rpm_package_available "$package"; then
      printf '%s\n' "$package"
      return 0
    fi
  done
  return 1
}

update_existing_docker_rpm() {
  local family="" cli_package="" compose_package="" buildx_package=""
  local -a packages=()

  family="$(detect_rpm_docker_family || true)"
  [[ -n "$family" ]] || return 1

  if (( ! DOCKER_ENGINE_COMPATIBLE )); then
    case "$family" in
      docker-ce)
        packages+=(docker-ce docker-ce-cli containerd.io)
        ;;
      moby)
        cli_package="$(rpm_cli_package_for_family "$family" || true)"
        [[ -n "$cli_package" ]] || return 1
        packages+=(moby-engine "$cli_package")
        ;;
      docker)
        cli_package="$(rpm_cli_package_for_family "$family" || true)"
        [[ -n "$cli_package" ]] || return 1
        packages+=(docker)
        [[ "$cli_package" == "docker" ]] || packages+=("$cli_package")
        ;;
    esac
    DOCKER_ENGINE_PACKAGE_UPDATED=1
  fi

  if (( ! DOCKER_COMPOSE_COMPATIBLE )); then
    case "$family" in
      docker-ce)
        compose_package="$(first_available_rpm_package docker-compose-plugin || true)"
        ;;
      moby)
        compose_package="$(first_available_rpm_package moby-compose docker-compose || true)"
        ;;
      docker)
        compose_package="$(first_available_rpm_package docker-compose-plugin || true)"
        ;;
    esac
    [[ -n "$compose_package" ]] || {
      warn "No Compose package candidate was found in the existing ${family} rpm channel."
      return 1
    }
    packages+=("$compose_package")
  fi

  if (( ! DOCKER_BUILDX_AVAILABLE )); then
    case "$family" in
      docker-ce)
        buildx_package="$(first_available_rpm_package docker-buildx-plugin || true)"
        ;;
      moby)
        buildx_package="$(first_available_rpm_package moby-buildx docker-buildx || true)"
        ;;
      docker)
        buildx_package="$(first_available_rpm_package docker-buildx-plugin || true)"
        ;;
    esac
    [[ -n "$buildx_package" ]] || {
      warn "No Buildx package was found in the existing ${family} rpm channel."
      return 1
    }
    packages+=("$buildx_package")
  fi

  ((${#packages[@]} > 0)) || return 0
  log "Updating Docker requirements from the existing ${family} rpm channel..."
  run_as_root "$PACKAGE_MANAGER" install -y "${packages[@]}" || return 1
  DOCKER_UPDATE_CHANNEL="${PACKAGE_MANAGER}:${family}"
}

update_existing_docker_apk() {
  local docker_path owner=""
  local -a packages=()
  command -v apk >/dev/null 2>&1 || return 1
  while IFS= read -r docker_path; do
    owner="$(apk info --who-owns "$docker_path" 2>/dev/null || true)"
    [[ "$owner" =~ [[:space:]]owned[[:space:]]by[[:space:]](docker|docker-cli)-[0-9] ]] && break
    owner=""
  done < <(active_docker_cli_paths)
  if [[ -z "$owner" ]]; then
    warn "The active Docker CLI is not owned by an Alpine Docker package; no packages will be changed."
    return 1
  fi
  if (( ! DOCKER_ENGINE_COMPATIBLE )) && ! apk info -e docker >/dev/null 2>&1; then
    warn "The active deficient Engine is not owned by Alpine's docker package; no packages will be changed."
    return 1
  fi

  if (( ! DOCKER_ENGINE_COMPATIBLE )); then
    packages+=(docker)
    DOCKER_ENGINE_PACKAGE_UPDATED=1
  fi
  (( DOCKER_COMPOSE_COMPATIBLE )) || packages+=(docker-cli-compose)
  (( DOCKER_BUILDX_AVAILABLE )) || packages+=(docker-cli-buildx)

  ((${#packages[@]} > 0)) || return 0
  log "Updating Docker requirements from the existing Alpine package channel..."
  run_as_root apk add --no-cache --upgrade "${packages[@]}" || return 1
  DOCKER_UPDATE_CHANNEL="apk"
}

snap_docker_installed() {
  command -v snap >/dev/null 2>&1 && snap list docker >/dev/null 2>&1
}

active_docker_cli_is_snap() {
  local docker_path
  while IFS= read -r docker_path; do
    [[ "$docker_path" == /snap/bin/* || "$docker_path" == /snap/docker/* ]] && return 0
  done < <(active_docker_cli_paths)
  return 1
}

active_docker_cli_is_arch_package() {
  local docker_path owner
  while IFS= read -r docker_path; do
    owner="$(pacman -Qoq "$docker_path" 2>/dev/null | head -n 1 || true)"
    [[ "$owner" == "docker" ]] && return 0
  done < <(active_docker_cli_paths)
  return 1
}

update_existing_docker_snap() {
  snap_docker_installed && active_docker_cli_is_snap || {
    warn "The installed Docker snap does not own the active Docker CLI; the snap will not be refreshed."
    return 1
  }
  log "Refreshing the existing Docker snap..."
  run_as_root snap refresh docker || return 1
  (( DOCKER_ENGINE_COMPATIBLE )) || DOCKER_ENGINE_PACKAGE_UPDATED=1
  DOCKER_UPDATE_CHANNEL="snap"
}

update_existing_docker_desktop_linux() {
  local attempt
  if is_wsl_environment; then
    DOCKER_UPDATE_GUIDE="https://docs.docker.com/desktop/setup/install/windows-install/"
  else
    DOCKER_UPDATE_GUIDE="https://docs.docker.com/desktop/setup/install/linux/"
  fi
  if ! docker_cli desktop update --help >/dev/null 2>&1; then
    warn "This Docker Desktop installation does not provide the supported in-place update command."
    warn "Update Docker Desktop using ${DOCKER_UPDATE_GUIDE}, then rerun setup."
    return 1
  fi

  log "Updating Docker Desktop through its in-place updater..."
  if ! docker_cli desktop update --quiet; then
    warn "Docker Desktop's in-place updater failed. Update it using ${DOCKER_UPDATE_GUIDE}, then rerun setup."
    return 1
  fi
  DOCKER_UPDATE_CHANNEL="desktop-linux"

  # Desktop updates can briefly restart their VM. Wait for the active context
  # instead of starting or replacing a native Linux Engine.
  for attempt in $(seq 1 90); do
    docker_cli info >/dev/null 2>&1 && return 0
    sleep 2
  done
  warn "Docker Desktop was updated, but its engine did not become ready within three minutes."
  return 1
}

update_existing_docker_linux() {
  DOCKER_ENGINE_PACKAGE_UPDATED=0
  DOCKER_UPDATE_CHANNEL=""

  if docker_is_desktop_backed; then
    log "This Linux environment is backed by Docker Desktop; native Linux packages will not be changed."
    update_existing_docker_desktop_linux
    return
  fi
  if docker_is_rootless; then
    warn "A rootless Docker daemon is active; update it using the same rootless installation method, then rerun setup."
    return 1
  fi
  if ! docker_uses_local_unix_socket; then
    warn "The active Docker endpoint is remote, custom, or could not be identified; local packages cannot safely update it."
    return 1
  fi

  if snap_docker_installed && active_docker_cli_is_snap; then
    update_existing_docker_snap
    return
  fi

  case "$PACKAGE_MANAGER" in
    apt)
      update_existing_docker_apt
      ;;
    dnf|yum)
      update_existing_docker_rpm
      ;;
    apk)
      update_existing_docker_apk
      ;;
    pacman)
      if ! active_docker_cli_is_arch_package; then
        warn "The active Docker CLI is not owned by the Arch docker package; no packages will be changed."
        return 1
      fi
      approve_arch_full_upgrade || return 1
      log "Updating Docker requirements with a full Arch system upgrade..."
      run_as_root pacman -Syu --needed --noconfirm docker docker-compose docker-buildx || return 1
      DOCKER_ENGINE_PACKAGE_UPDATED=1
      DOCKER_UPDATE_CHANNEL="pacman"
      ;;
    *)
      warn "No supported package provenance was found for the existing Docker installation."
      return 1
      ;;
  esac
}

running_docker_engine_meets_minimum() {
  local raw_version current_version
  raw_version="$(docker_cli version --format '{{.Server.Version}}' 2>/dev/null || true)"
  current_version="$(normalize_version "$raw_version" || true)"
  [[ -n "$current_version" ]] && version_at_least "$current_version" "$MIN_DOCKER_ENGINE_LINUX_VERSION"
}

restart_updated_docker_engine_if_needed() {
  local attempt
  (( DOCKER_ENGINE_PACKAGE_UPDATED )) || return 0
  running_docker_engine_meets_minimum && return 0

  log "Restarting Docker to activate the updated Engine..."
  if [[ "$DOCKER_UPDATE_CHANNEL" == "snap" ]]; then
    run_as_root snap restart docker >/dev/null 2>&1 || true
  elif command -v systemctl >/dev/null 2>&1; then
    run_as_root systemctl restart docker >/dev/null 2>&1 || true
  elif command -v rc-service >/dev/null 2>&1; then
    run_as_root rc-service docker restart >/dev/null 2>&1 || true
  elif command -v service >/dev/null 2>&1; then
    run_as_root service docker restart >/dev/null 2>&1 || true
  fi

  for attempt in $(seq 1 30); do
    docker_cli info >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

ensure_linux_docker_requirements() {
  is_linux || return 0
  probe_linux_docker_requirements
  if linux_docker_requirements_met; then
    log "Docker requirements satisfied: $(linux_docker_requirements_summary)."
    return 0
  fi

  warn "Docker requirements are not satisfied: $(linux_docker_requirements_summary)."
  if docker_is_desktop_backed; then
    if is_wsl_environment; then
      DOCKER_UPDATE_GUIDE="https://docs.docker.com/desktop/setup/install/windows-install/"
    else
      DOCKER_UPDATE_GUIDE="https://docs.docker.com/desktop/setup/install/linux/"
    fi
  fi
  if ! enabled "$BOOTSTRAP_ENABLED" || ! enabled "$INSTALL_DOCKER_ENABLED"; then
    die "Automatic Docker management is disabled. Update Docker using $(docker_update_docs_url), then rerun setup."
  fi

  update_existing_docker_linux ||
    die "Could not safely update this Docker installation in place. Update it through its existing installation channel using $(docker_update_docs_url), then rerun setup."

  restart_updated_docker_engine_if_needed ||
    die "Docker was updated, but its daemon did not become ready. Restart Docker and rerun setup."
  start_docker_service
  select_docker_command
  probe_linux_docker_requirements
  linux_docker_requirements_met ||
    die "Docker is still incompatible after the update: $(linux_docker_requirements_summary). Update it through its existing installation channel using $(docker_update_docs_url), then rerun setup."

  log "Docker requirements satisfied after update: $(linux_docker_requirements_summary)."
}

detect_docker_socket_path() {
  local endpoint socket_path
  if [[ -n "${SAMSAR_SETUP_DOCKER_SOCKET:-}" ]]; then
    [[ "$SAMSAR_SETUP_DOCKER_SOCKET" == /* ]] ||
      die "SAMSAR_SETUP_DOCKER_SOCKET must be an absolute local path."
    printf '%s\n' "$SAMSAR_SETUP_DOCKER_SOCKET"
    return 0
  fi

  if docker_is_desktop_backed; then
    if [[ "$(uname -s 2>/dev/null || true)" == "Darwin" && -S /var/run/docker.sock ]]; then
      # Preserve Docker Desktop for Mac's supported compatibility symlink; it
      # is known to work for ordinary containers and avoids host socket sharing.
      printf '/var/run/docker.sock\n'
    elif is_wsl_environment; then
      printf '/var/run/docker.sock\n'
    else
      # Desktop containers run in a VM. Docker documents the raw VM socket for
      # container-to-Engine access instead of bind-mounting the host user socket.
      printf '/var/run/docker.sock.raw\n'
    fi
    return 0
  fi

  endpoint="$(active_docker_endpoint || true)"
  [[ -n "$endpoint" ]] ||
    die "Could not determine the active Docker context endpoint; set SAMSAR_SETUP_DOCKER_SOCKET to its local Unix socket path."
  [[ "$endpoint" == unix://* ]] ||
    die "The setup wizard needs a local Unix Docker socket, but the active context uses ${endpoint}."
  socket_path="${endpoint#unix://}"
  [[ "$socket_path" == /* ]] ||
    die "The active Docker context returned a non-absolute socket path: ${socket_path}"
  printf '%s\n' "$socket_path"
}

is_interactive_terminal() {
  [[ -t 0 && -t 1 ]]
}

confirm_action() {
  local prompt="$1"
  local answer
  if enabled "$ASSUME_YES"; then
    return 0
  fi
  if ! is_interactive_terminal; then
    return 1
  fi
  read -r -p "${prompt} [y/N] " answer
  case "$answer" in
    y|Y|yes|YES|Yes)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

print_cloud_port_hint() {
  case "$CLOUD_ENVIRONMENT" in
    Azure)
      warn "Azure still requires an inbound Network Security Group rule for TCP ${HOST_PORT} if public access is needed."
      ;;
    "AWS EC2")
      warn "AWS EC2 still requires an inbound Security Group rule for TCP ${HOST_PORT} if public access is needed."
      ;;
    "Google Cloud")
      warn "Google Cloud still requires a VPC firewall ingress rule for TCP ${HOST_PORT} if public access is needed."
      ;;
    "Oracle Cloud")
      warn "Oracle Cloud still requires a security list or network security group ingress rule for TCP ${HOST_PORT} if public access is needed."
      ;;
    *)
      warn "If this is a cloud VM, also allow inbound TCP ${HOST_PORT} in the provider firewall or security group."
      ;;
  esac
}

azure_metadata_text() {
  local path="$1"
  command -v curl >/dev/null 2>&1 || return 1
  curl -fsS -H Metadata:true --max-time 3 \
    "http://169.254.169.254/metadata/instance/${path}?api-version=2021-02-01&format=text" 2>/dev/null
}

azure_managed_identity_available() {
  command -v curl >/dev/null 2>&1 || return 1
  curl -sS -H Metadata:true --max-time 3 \
    "http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://management.azure.com/" 2>/dev/null |
    grep -q '"access_token"'
}

install_azure_cli_if_needed() {
  command -v az >/dev/null 2>&1 && return 0
  azure_managed_identity_available || return 1
  enabled "$INSTALL_CLOUD_CLI_ENABLED" || return 1
  enabled "$BOOTSTRAP_ENABLED" || return 1
  is_linux || return 1
  case "$PACKAGE_MANAGER" in
    apt)
      ensure_base_packages
      log "Installing Azure CLI for Azure Network Security Group automation..."
      curl -sL https://aka.ms/InstallAzureCLIDeb | run_as_root_preserve_env bash -
      ;;
    *)
      return 1
      ;;
  esac
  command -v az >/dev/null 2>&1
}

ensure_azure_cli_authenticated() {
  local subscription_id="$1"
  command -v az >/dev/null 2>&1 || return 1
  if ! az account show >/dev/null 2>&1; then
    log "Trying Azure CLI managed identity login..."
    az login --identity --allow-no-subscriptions >/dev/null 2>&1 || return 1
  fi
  if [[ -n "$subscription_id" ]]; then
    az account set --subscription "$subscription_id" >/dev/null 2>&1 || return 1
  fi
}

print_azure_open_port_hint() {
  local resource_group="$1"
  local vm_name="$2"
  local port="$3"
  local subscription_id="${4:-}"
  warn "Azure NSG auto-open was not completed. Run this from an authenticated Azure CLI:"
  if [[ -n "$subscription_id" ]]; then
    warn "  az account set --subscription ${subscription_id}"
  fi
  warn "  az vm open-port --resource-group ${resource_group:-<resource-group>} --name ${vm_name:-<vm-name>} --port ${port} --priority ${AZURE_NSG_PRIORITY}"
}

open_azure_cloud_port() {
  local port="$1"
  local resource_group vm_name subscription_id priority
  resource_group="$(azure_metadata_text compute/resourceGroupName || true)"
  vm_name="$(azure_metadata_text compute/name || true)"
  subscription_id="$(azure_metadata_text compute/subscriptionId || true)"

  if [[ -z "$resource_group" || -z "$vm_name" ]]; then
    warn "Could not detect Azure resource group and VM name from instance metadata."
    print_azure_open_port_hint "$resource_group" "$vm_name" "$port" "$subscription_id"
    return 1
  fi

  if ! install_azure_cli_if_needed; then
    warn "Azure CLI is not available/authenticated on this VM, or no managed identity is available for automatic Azure login."
    print_azure_open_port_hint "$resource_group" "$vm_name" "$port" "$subscription_id"
    return 1
  fi

  if ! ensure_azure_cli_authenticated "$subscription_id"; then
    warn "Azure CLI is installed but not authenticated, and managed identity login did not succeed."
    print_azure_open_port_hint "$resource_group" "$vm_name" "$port" "$subscription_id"
    return 1
  fi

  log "Opening Azure NSG inbound TCP ${port} for VM ${resource_group}/${vm_name}..."
  for priority in "$AZURE_NSG_PRIORITY" 1001 1002 1010 1100 1200 1500 2000; do
    if az vm open-port \
      --resource-group "$resource_group" \
      --name "$vm_name" \
      --port "$port" \
      --priority "$priority" \
      --only-show-errors >/dev/null; then
      log "Azure NSG rule is open for TCP ${port} at priority ${priority}."
      return 0
    fi
  done

  warn "Azure CLI could not create an inbound NSG rule for TCP ${port}."
  print_azure_open_port_hint "$resource_group" "$vm_name" "$port" "$subscription_id"
  return 1
}

maybe_open_cloud_setup_port() {
  is_linux || return 0
  case "$OPEN_CLOUD_PORT_MODE" in
    0|false|FALSE|no|NO|off|OFF)
      print_cloud_port_hint
      return 0
      ;;
    1|true|TRUE|yes|YES|on|ON)
      if [[ "$CLOUD_ENVIRONMENT" == "Azure" ]]; then
        open_azure_cloud_port "$HOST_PORT" || true
      else
        print_cloud_port_hint
      fi
      return 0
      ;;
    ask|"")
      if [[ "$CLOUD_ENVIRONMENT" == "Azure" ]] && confirm_action "Open TCP ${HOST_PORT} in the Azure Network Security Group if Azure CLI permissions are available?"; then
        open_azure_cloud_port "$HOST_PORT" || true
      else
        print_cloud_port_hint
      fi
      return 0
      ;;
    *)
      die "Invalid SAMSAR_SETUP_OPEN_CLOUD_PORT value: ${OPEN_CLOUD_PORT_MODE}. Use ask, true, or false."
      ;;
  esac
}

open_host_tcp_port() {
  local port="$1"
  is_linux || return 0
  if command -v ufw >/dev/null 2>&1; then
    log "Opening TCP ${port} with ufw..."
    run_as_root ufw allow "${port}/tcp"
    run_as_root ufw reload >/dev/null 2>&1 || true
    return 0
  fi
  if command -v firewall-cmd >/dev/null 2>&1; then
    log "Opening TCP ${port} with firewalld..."
    run_as_root firewall-cmd --permanent --add-port="${port}/tcp"
    run_as_root firewall-cmd --reload
    return 0
  fi
  if command -v iptables >/dev/null 2>&1; then
    log "Opening TCP ${port} with iptables..."
    if ! run_as_root iptables -C INPUT -p tcp --dport "$port" -j ACCEPT >/dev/null 2>&1; then
      run_as_root iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
    fi
    warn "iptables rule added for this boot. Make it persistent with your distribution firewall tooling if needed."
    return 0
  fi
  warn "No supported host firewall manager found. Open TCP ${port} manually on this host if remote access is needed."
  return 1
}

maybe_open_setup_wizard_host_port() {
  is_linux || return 0
  case "$OPEN_SETUP_PORT_MODE" in
    0|false|FALSE|no|NO|off|OFF)
      log "Skipping host firewall change for TCP ${HOST_PORT}."
      maybe_open_cloud_setup_port
      return 0
      ;;
    1|true|TRUE|yes|YES|on|ON)
      open_host_tcp_port "$HOST_PORT" || true
      maybe_open_cloud_setup_port
      return 0
      ;;
    ask|"")
      if confirm_action "Open TCP ${HOST_PORT} in the host firewall for remote setup access?"; then
        open_host_tcp_port "$HOST_PORT" || true
      else
        log "Host firewall change skipped for TCP ${HOST_PORT}."
      fi
      maybe_open_cloud_setup_port
      return 0
      ;;
    *)
      die "Invalid SAMSAR_SETUP_OPEN_SETUP_PORT value: ${OPEN_SETUP_PORT_MODE}. Use ask, true, or false."
      ;;
  esac
}

bootstrap_host() {
  load_os_release
  detect_package_manager
  detect_cloud_environment
  log "Detected environment: ${OS_PRETTY_NAME}${CLOUD_ENVIRONMENT:+ on $CLOUD_ENVIRONMENT}"
  require_system_resources

  install_docker_engine
  start_docker_service
  if [[ "$(uname -s 2>/dev/null || true)" == "Darwin" ]]; then
    ensure_docker_desktop_macos_version
    start_docker_service
  fi
  select_docker_command
  ensure_linux_docker_requirements
}

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

parse_args "$@"
bootstrap_host
maybe_open_setup_wizard_host_port
build_provider_environment_forwarding

HOST_PRIVATE_IPS="$(extract_private_ipv4_addresses "${SAMSAR_SETUP_HOST_PRIVATE_IPS:-$(detect_host_private_ips)}")"
HOST_PUBLIC_IPS="$(extract_public_ipv4_addresses "${SAMSAR_SETUP_HOST_PUBLIC_IPS:-$(detect_host_public_ips)}")"
DOCKER_SOCKET_PATH="$(detect_docker_socket_path)"
REMOTE_INSTALL="${SAMSAR_SETUP_REMOTE_INSTALL:-}"
if [[ -z "$REMOTE_INSTALL" && -n "$CLOUD_ENVIRONMENT" ]]; then
  REMOTE_INSTALL=1
fi
AZURE_RESOURCE_GROUP=""
AZURE_VM_NAME=""
AZURE_SUBSCRIPTION_ID=""
if [[ "$CLOUD_ENVIRONMENT" == "Azure" ]]; then
  AZURE_RESOURCE_GROUP="$(azure_metadata_text compute/resourceGroupName || true)"
  AZURE_VM_NAME="$(azure_metadata_text compute/name || true)"
  AZURE_SUBSCRIPTION_ID="$(azure_metadata_text compute/subscriptionId || true)"
fi

echo "Building ${IMAGE_NAME} from apps/setup-wizard..."
docker_cli build -t "$IMAGE_NAME" "$ROOT_DIR/apps/setup-wizard"

existing_container_id="$(
  docker_cli ps -aq --filter "name=^/${CONTAINER_NAME}$"
)"

if [[ -n "$existing_container_id" ]]; then
  echo "Replacing existing container ${CONTAINER_NAME}..."
  docker_cli rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "Starting ${CONTAINER_NAME} on host port ${HOST_PORT}..."
if [[ -n "$HOST_PRIVATE_IPS" ]]; then
  echo "Detected host private IP candidates: ${HOST_PRIVATE_IPS}"
fi
echo "Setup wizard bind address: ${HOST_BIND_ADDR}:${HOST_PORT}"
echo "Public setup URL will be shown only if TCP ${HOST_PORT} responds on the detected public IP."
container_id="$(
docker_cli run -d \
    --name "$CONTAINER_NAME" \
    --restart unless-stopped \
    -p "${HOST_BIND_ADDR}:${HOST_PORT}:${CONTAINER_PORT}" \
    --health-cmd "node -e \"fetch('http://127.0.0.1:${CONTAINER_PORT}/api/setup/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))\"" \
    --health-interval 15s \
    --health-timeout 5s \
    --health-retries 4 \
    --health-start-period 10s \
    --add-host=host.docker.internal:host-gateway \
    -v "${DOCKER_SOCKET_PATH}:/var/run/docker.sock" \
    -v "$ROOT_DIR:$ROOT_DIR" \
    -e "SAMSAR_SETUP_ROOT_DIR=$ROOT_DIR" \
    -e "SAMSAR_SETUP_CLIENT_URL=http://localhost:3000" \
    -e "SAMSAR_SETUP_PROCESSOR_PUBLIC_URL=http://localhost:3002" \
    -e "SAMSAR_SETUP_HOST_PRIVATE_IPS=$HOST_PRIVATE_IPS" \
    -e "SAMSAR_SETUP_HOST_PUBLIC_IPS=$HOST_PUBLIC_IPS" \
    -e "SAMSAR_SETUP_REMOTE_INSTALL=$REMOTE_INSTALL" \
    -e "SAMSAR_SETUP_CLOUD_ENVIRONMENT=$CLOUD_ENVIRONMENT" \
    -e "SAMSAR_SETUP_CLOUD_RESOURCE_GROUP=$AZURE_RESOURCE_GROUP" \
    -e "SAMSAR_SETUP_CLOUD_VM_NAME=$AZURE_VM_NAME" \
    -e "SAMSAR_SETUP_CLOUD_SUBSCRIPTION_ID=$AZURE_SUBSCRIPTION_ID" \
    -e "SAMSAR_SETUP_PROVIDER_ENV_NAMES=$PROVIDER_ENV_ALLOWLIST" \
    -e "SAMSAR_MEDIA_TUNNEL_PROVIDER=${SAMSAR_MEDIA_TUNNEL_PROVIDER:-}" \
    -e "SAMSAR_CLOUDFLARED_PROTOCOL=${SAMSAR_CLOUDFLARED_PROTOCOL:-}" \
    -e "ZROK_ENABLE_TOKEN=${ZROK_ENABLE_TOKEN:-}" \
    ${PROVIDER_ENV_DOCKER_ARGS[@]+"${PROVIDER_ENV_DOCKER_ARGS[@]}"} \
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
