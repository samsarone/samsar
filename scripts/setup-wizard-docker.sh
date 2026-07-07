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
INSTALL_NODE_ENABLED="${SAMSAR_SETUP_INSTALL_NODE:-1}"
INSTALL_YARN_ENABLED="${SAMSAR_SETUP_INSTALL_YARN:-1}"
NODE_MAJOR="${SAMSAR_SETUP_NODE_MAJOR:-22}"
MIN_NODE_MAJOR="${SAMSAR_SETUP_MIN_NODE_MAJOR:-20}"
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

usage() {
  cat <<EOF
Usage: npm run setup-wizard -- [options]

Options:
  -y, --yes             Run non-interactively and open TCP ${HOST_PORT} in host/cloud firewalls when possible.
      --open-setup-port Open TCP ${HOST_PORT} in host/cloud firewalls when possible.
      --no-open-setup-port
                        Do not change firewall rules for TCP ${HOST_PORT}.
  -h, --help            Show this help text.

Environment:
  SAMSAR_SETUP_OPEN_SETUP_PORT=ask|true|false
  SAMSAR_SETUP_OPEN_CLOUD_PORT=ask|true|false
  SAMSAR_SETUP_INSTALL_CLOUD_CLI=1
  SAMSAR_SETUP_AZURE_NSG_PRIORITY=1000
  SAMSAR_SETUP_YES=1
  SAMSAR_SETUP_MIN_DISK_FREE_GB=<gb>
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
      run_as_root pacman -Sy --needed --noconfirm ca-certificates curl gnupg git iproute2
      ;;
    *)
      if ! command -v curl >/dev/null 2>&1; then
        die "No supported package manager was detected and curl is missing; cannot bootstrap prerequisites."
      fi
      ;;
  esac
}

installed_node_major() {
  if ! command -v node >/dev/null 2>&1; then
    return 1
  fi
  node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/'
}

node_prerequisites_satisfied() {
  local major
  major="$(installed_node_major || true)"
  [[ -n "$major" ]] && [[ "$major" =~ ^[0-9]+$ ]] && (( major >= MIN_NODE_MAJOR )) && command -v npm >/dev/null 2>&1
}

install_nodejs() {
  if node_prerequisites_satisfied; then
    return 0
  fi
  enabled "$INSTALL_NODE_ENABLED" || die "Node.js/npm are missing or too old. Install Node.js ${NODE_MAJOR}.x, then rerun this script."

  log "Installing Node.js ${NODE_MAJOR}.x and npm..."
  ensure_base_packages
  case "$PACKAGE_MANAGER" in
    apt)
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | run_as_root_preserve_env bash -
      run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
      ;;
    dnf)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | run_as_root_preserve_env bash -
      run_as_root dnf install -y nodejs
      ;;
    yum)
      curl -fsSL "https://rpm.nodesource.com/setup_${NODE_MAJOR}.x" | run_as_root_preserve_env bash -
      run_as_root yum install -y nodejs
      ;;
    apk)
      run_as_root apk add --no-cache nodejs npm
      ;;
    pacman)
      run_as_root pacman -Sy --needed --noconfirm nodejs npm
      ;;
    *)
      die "Cannot auto-install Node.js on ${OS_PRETTY_NAME}. Install Node.js ${NODE_MAJOR}.x from https://nodejs.org/en/download and rerun this script."
      ;;
  esac

  node_prerequisites_satisfied || die "Node.js/npm installation did not complete successfully."
}

install_yarn_if_needed() {
  local yarn_version
  enabled "$INSTALL_YARN_ENABLED" || return 0
  [[ -f "$ROOT_DIR/package.json" ]] || return 0
  grep -q '"packageManager"[[:space:]]*:[[:space:]]*"yarn@' "$ROOT_DIR/package.json" || return 0
  command -v yarn >/dev/null 2>&1 && return 0
  command -v npm >/dev/null 2>&1 || return 0

  yarn_version="$(
    sed -n 's/.*"packageManager"[[:space:]]*:[[:space:]]*"yarn@\([^"+]*\).*/\1/p' "$ROOT_DIR/package.json" | head -n 1
  )"
  yarn_version="${yarn_version:-1.22.22}"
  log "Installing Yarn ${yarn_version}..."
  run_as_root npm install -g "yarn@${yarn_version}"
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
  run_as_root apk add --no-cache docker docker-cli-compose || return 1
}

install_docker_arch() {
  [[ "$PACKAGE_MANAGER" == "pacman" ]] || return 1
  log "Installing Docker from Arch packages..."
  run_as_root pacman -Sy --needed --noconfirm docker docker-compose || return 1
}

install_docker_convenience_script() {
  enabled "$ALLOW_DOCKER_CONVENIENCE_SCRIPT" || return 1
  command -v curl >/dev/null 2>&1 || return 1
  log "Falling back to Docker's convenience installer..."
  curl -fsSL https://get.docker.com -o /tmp/samsar-get-docker.sh || return 1
  run_as_root sh /tmp/samsar-get-docker.sh || return 1
  rm -f /tmp/samsar-get-docker.sh
}

install_docker_engine() {
  command -v docker >/dev/null 2>&1 && return 0
  print_docker_install_hint
  enabled "$BOOTSTRAP_ENABLED" || exit 1
  is_linux || die "Automatic Docker installation is only supported for Linux hosts. Install Docker manually from the guide above, then rerun this script."

  log "Attempting automatic Docker installation..."
  ensure_base_packages
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
      install_docker_arch || die "Could not install Docker automatically. Use: $(docker_install_docs_url)"
      ;;
    *)
      install_docker_convenience_script || die "Could not install Docker automatically. Use: $(docker_install_docs_url)"
      ;;
  esac

  command -v docker >/dev/null 2>&1 || die "Docker installation completed, but docker is still not on PATH. Use: $(docker_install_docs_url)"
}

start_docker_service() {
  is_linux || return 0
  log "Starting Docker service..."
  if command -v systemctl >/dev/null 2>&1; then
    run_as_root systemctl enable --now containerd >/dev/null 2>&1 || true
    run_as_root systemctl enable --now docker >/dev/null 2>&1 || run_as_root systemctl start docker >/dev/null 2>&1 || true
    run_as_root systemctl enable --now snap.docker.dockerd >/dev/null 2>&1 || true
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

select_docker_command() {
  local docker_info_output sudo_info_output
  if docker_info_output="$(try_docker_info docker)"; then
    DOCKER_CMD=(docker)
    return 0
  fi

  if printf '%s\n' "$docker_info_output" | grep -Eqi 'permission denied|connect: permission denied|Got permission denied'; then
    ensure_docker_group_permissions
  fi

  if command -v sudo >/dev/null 2>&1 && sudo_info_output="$(try_docker_info sudo docker)"; then
    DOCKER_CMD=(sudo docker)
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

detect_docker_socket_path() {
  if [[ -n "${SAMSAR_SETUP_DOCKER_SOCKET:-}" ]]; then
    echo "$SAMSAR_SETUP_DOCKER_SOCKET"
  elif [[ "${DOCKER_HOST:-}" == unix://* ]]; then
    echo "${DOCKER_HOST#unix://}"
  elif [[ -S /var/run/docker.sock ]]; then
    echo "/var/run/docker.sock"
  elif [[ -n "${XDG_RUNTIME_DIR:-}" && -S "${XDG_RUNTIME_DIR}/docker.sock" ]]; then
    echo "${XDG_RUNTIME_DIR}/docker.sock"
  else
    echo "/var/run/docker.sock"
  fi
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
  ensure_base_packages
  case "$PACKAGE_MANAGER" in
    apt)
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

  if enabled "$BOOTSTRAP_ENABLED" && is_linux; then
    install_nodejs
    install_yarn_if_needed
  fi

  install_docker_engine
  start_docker_service
  select_docker_command
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
    -p "${HOST_BIND_ADDR}:${HOST_PORT}:${CONTAINER_PORT}" \
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
