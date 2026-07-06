#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

IMAGE_NAME="${SETUP_WIZARD_IMAGE:-samsar-setup-wizard:local}"
CONTAINER_NAME="${SETUP_WIZARD_CONTAINER_NAME:-samsar-setup-wizard-preview}"
HOST_PORT="${SETUP_WIZARD_PORT:-8089}"
CONTAINER_PORT="${SETUP_WIZARD_CONTAINER_PORT:-80}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not available on PATH." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Start Docker Desktop or Docker Engine first." >&2
  exit 1
fi

echo "Building ${IMAGE_NAME} from apps/setup-wizard..."
docker build -t "$IMAGE_NAME" "$ROOT_DIR/apps/setup-wizard"

existing_container_id="$(
  docker ps -aq --filter "name=^/${CONTAINER_NAME}$"
)"

if [[ -n "$existing_container_id" ]]; then
  echo "Replacing existing container ${CONTAINER_NAME}..."
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

echo "Starting ${CONTAINER_NAME} on http://localhost:${HOST_PORT}..."
container_id="$(
docker run -d \
    --name "$CONTAINER_NAME" \
    -p "${HOST_PORT}:${CONTAINER_PORT}" \
    --add-host=host.docker.internal:host-gateway \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v "$ROOT_DIR:$ROOT_DIR" \
    -e "SAMSAR_SETUP_ROOT_DIR=$ROOT_DIR" \
    -e "SAMSAR_SETUP_CLIENT_URL=http://localhost:3000" \
    -e "SAMSAR_SETUP_PROCESSOR_PUBLIC_URL=http://localhost:3002" \
    "$IMAGE_NAME"
)"

echo "Started ${CONTAINER_NAME} (${container_id})."
echo "Open http://localhost:${HOST_PORT}"
