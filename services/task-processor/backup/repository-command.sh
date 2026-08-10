#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

BACKUP_STATE_DIR="${BACKUP_STATE_DIR:-/backup-state}"

repository_command_main() {
  local command_name="${1:-}"
  shift || true
  if (( $# > 0 )); then
    backup_die 'Repository control commands do not accept additional arguments.'
    return 64
  fi

  backup_validate_runtime_gate
  backup_validate_restic_repository
  backup_load_cloud_credentials
  backup_require_command restic
  export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-$BACKUP_STATE_DIR/restic-cache}"
  mkdir -p "$RESTIC_CACHE_DIR"

  case "$command_name" in
    check)
      exec restic check
      ;;
    snapshots)
      exec restic snapshots
      ;;
    *)
      backup_die 'Expected repository command check or snapshots.'
      return 64
      ;;
  esac
}

repository_command_main "$@"
