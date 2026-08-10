#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

BACKUP_STATE_DIR="${BACKUP_STATE_DIR:-/backup-state}"
BACKUP_STATUS_DIR="${BACKUP_STATUS_DIR:-$BACKUP_STATE_DIR/status}"
BACKUP_HEALTH_MAX_SUCCESS_AGE_HOURS="${BACKUP_HEALTH_MAX_SUCCESS_AGE_HOURS:-36}"
BACKUP_HEALTH_SCHEDULER_GRACE_SECONDS="${BACKUP_HEALTH_SCHEDULER_GRACE_SECONDS:-900}"
BACKUP_HEALTH_MAX_RUN_HOURS="${BACKUP_HEALTH_MAX_RUN_HOURS:-12}"
BACKUP_HEALTH_INITIAL_SUCCESS_GRACE_HOURS="${BACKUP_HEALTH_INITIAL_SUCCESS_GRACE_HOURS:-26}"

health_fail() {
  printf '[samsar-backup-health] %s\n' "$1" >&2
  return 1
}

healthcheck_main() {
  local now_epoch
  local success_epoch
  local success_status
  local scheduler_phase
  local scheduler_heartbeat
  local scheduler_started
  local next_attempt
  local max_success_age_seconds
  local max_run_age_seconds
  local last_success_file="$BACKUP_STATUS_DIR/last-success.json"
  local scheduler_status_file="$BACKUP_STATUS_DIR/scheduler-status.json"
  local run_status_file="$BACKUP_STATUS_DIR/run-status.json"
  local run_status

  if [[ "${BACKUP_ENABLED:-}" != 'true' ]]; then
    printf 'ok status=disabled\n'
    return 0
  fi

  backup_validate_runtime_gate >/dev/null
  backup_validate_schedule >/dev/null
  backup_require_positive_integer \
    'BACKUP_HEALTH_MAX_SUCCESS_AGE_HOURS' \
    "$BACKUP_HEALTH_MAX_SUCCESS_AGE_HOURS" >/dev/null
  backup_require_positive_integer \
    'BACKUP_HEALTH_SCHEDULER_GRACE_SECONDS' \
    "$BACKUP_HEALTH_SCHEDULER_GRACE_SECONDS" >/dev/null
  backup_require_positive_integer \
    'BACKUP_HEALTH_MAX_RUN_HOURS' \
    "$BACKUP_HEALTH_MAX_RUN_HOURS" >/dev/null
  backup_require_positive_integer \
    'BACKUP_HEALTH_INITIAL_SUCCESS_GRACE_HOURS' \
    "$BACKUP_HEALTH_INITIAL_SUCCESS_GRACE_HOURS" >/dev/null

  now_epoch="$(date -u +%s)"
  success_status="$(backup_json_string_value "$last_success_file" 'status' || true)"
  success_epoch="$(backup_json_epoch_value "$last_success_file" 'completedAtEpoch' || true)"
  if [[ "$success_status" != 'success' || ! "$success_epoch" =~ ^[0-9]+$ ]]; then
    scheduler_started="$(backup_json_epoch_value "$scheduler_status_file" 'startedAtEpoch' || true)"
    run_status="$(backup_json_string_value "$run_status_file" 'status' || true)"
    if [[ "$run_status" == 'failed' ]]; then
      health_fail 'The initial backup attempt failed.'
      return 1
    fi
    if [[ ! "$scheduler_started" =~ ^[0-9]+$ ]] \
      || (( now_epoch - scheduler_started > BACKUP_HEALTH_INITIAL_SUCCESS_GRACE_HOURS * 3600 )); then
      health_fail 'No successful backup was created within the initial grace period.'
      return 1
    fi
    success_epoch=0
  else
    max_success_age_seconds="$((BACKUP_HEALTH_MAX_SUCCESS_AGE_HOURS * 3600))"
    if (( now_epoch - success_epoch > max_success_age_seconds )); then
      health_fail 'The last successful backup is too old.'
      return 1
    fi
  fi

  scheduler_phase="$(backup_json_string_value "$scheduler_status_file" 'status' || true)"
  scheduler_heartbeat="$(backup_json_epoch_value "$scheduler_status_file" 'heartbeatAtEpoch' || true)"
  next_attempt="$(backup_json_epoch_value "$scheduler_status_file" 'nextAttemptEpoch' || true)"
  if [[ ! "$scheduler_heartbeat" =~ ^[0-9]+$ || ! "$next_attempt" =~ ^[0-9]+$ ]]; then
    health_fail 'Scheduler state is missing or invalid.'
    return 1
  fi

  case "$scheduler_phase" in
    waiting)
      if (( now_epoch > next_attempt + BACKUP_HEALTH_SCHEDULER_GRACE_SECONDS )); then
        health_fail 'Scheduler is overdue for its next backup attempt.'
        return 1
      fi
      ;;
    running)
      max_run_age_seconds="$((BACKUP_HEALTH_MAX_RUN_HOURS * 3600))"
      if (( now_epoch - scheduler_heartbeat > max_run_age_seconds )); then
        health_fail 'The active backup run exceeded the health time limit.'
        return 1
      fi
      ;;
    *)
      health_fail 'Scheduler state has an unknown status.'
      return 1
      ;;
  esac

  printf 'ok last_success_epoch=%s scheduler=%s next_attempt_epoch=%s\n' \
    "$success_epoch" "$scheduler_phase" "$next_attempt"
}

healthcheck_main "$@"
