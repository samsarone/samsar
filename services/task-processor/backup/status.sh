#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_STATE_DIR="${BACKUP_STATE_DIR:-/backup-state}"
BACKUP_STATUS_DIR="${BACKUP_STATUS_DIR:-$BACKUP_STATE_DIR/status}"

for status_name in scheduler-status run-status last-success; do
  status_path="$BACKUP_STATUS_DIR/$status_name.json"
  printf '%s:\n' "$status_name"
  if [[ -f "$status_path" ]]; then
    sed 's/^/  /' "$status_path"
  else
    printf '  unavailable\n'
  fi
done

printf 'health:\n  '
exec "$SCRIPT_DIR/healthcheck.sh"
