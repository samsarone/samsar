#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

BACKUP_STATE_DIR="${BACKUP_STATE_DIR:-/backup-state}"
BACKUP_STATUS_DIR="${BACKUP_STATUS_DIR:-$BACKUP_STATE_DIR/status}"

mkdir -p "$BACKUP_STATUS_DIR"
now_epoch="$(date -u +%s)"
backup_atomic_write "$BACKUP_STATUS_DIR/scheduler-status.json" "$(printf \
  '{\n  \"status\": \"disabled\",\n  \"heartbeatAt\": \"%s\",\n  \"heartbeatAtEpoch\": %s\n}' \
  "$(backup_timestamp)" "$now_epoch")"
backup_log 'Daily backups are disabled because BACKUP_ENABLED is not true.'

while true; do
  sleep 3600
done
