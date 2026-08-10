#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

case "${1:-schedule}" in
  schedule)
    shift || true
    if (( $# > 0 )); then
      backup_die 'schedule does not accept additional arguments.'
      exit 64
    fi
    if [[ "${BACKUP_ENABLED:-}" != 'true' ]]; then
      exec "$SCRIPT_DIR/disabled.sh" "$@"
    fi
    backup_validate_runtime_gate
    exec "$SCRIPT_DIR/scheduler.sh" "$@"
    ;;
  run-once)
    shift || true
    if (( $# > 0 )); then
      backup_die 'run-once does not accept additional arguments.'
      exit 64
    fi
    backup_validate_runtime_gate
    exec "$SCRIPT_DIR/run-backup.sh" "$@"
    ;;
  check|snapshots)
    command_name="$1"
    shift || true
    backup_validate_runtime_gate
    exec "$SCRIPT_DIR/repository-command.sh" "$command_name" "$@"
    ;;
  status)
    shift || true
    if (( $# > 0 )); then
      backup_die 'status does not accept additional arguments.'
      exit 64
    fi
    exec "$SCRIPT_DIR/status.sh" "$@"
    ;;
  health)
    shift || true
    if (( $# > 0 )); then
      backup_die 'health does not accept additional arguments.'
      exit 64
    fi
    exec "$SCRIPT_DIR/healthcheck.sh" "$@"
    ;;
  *)
    backup_die 'Unknown command. Expected schedule, run-once, check, snapshots, status, or health.'
    exit 64
    ;;
esac
