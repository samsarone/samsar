#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

BACKUP_STATE_DIR="${BACKUP_STATE_DIR:-/backup-state}"
BACKUP_STATUS_DIR="${BACKUP_STATUS_DIR:-$BACKUP_STATE_DIR/status}"
BACKUP_RUNNER="${BACKUP_RUNNER:-$SCRIPT_DIR/run-backup.sh}"
BACKUP_RETRY_MINUTES="${BACKUP_RETRY_MINUTES:-30}"
BACKUP_SCHEDULER_MAX_SLEEP_SECONDS="${BACKUP_SCHEDULER_MAX_SLEEP_SECONDS:-300}"

LAST_SUCCESS_FILE="$BACKUP_STATUS_DIR/last-success.json"
SCHEDULER_STATUS_FILE="$BACKUP_STATUS_DIR/scheduler-status.json"
SCHEDULER_STARTED_EPOCH=''

read_last_success_epoch() {
  local value
  value="$(backup_json_epoch_value "$LAST_SUCCESS_FILE" 'completedAtEpoch' || true)"
  if [[ "$value" =~ ^[0-9]+$ ]]; then
    printf '%s\n' "$value"
  else
    printf '0\n'
  fi
}

# Return today's configured UTC time when it is still ahead. When the schedule
# has passed but no successful run covers it, return now so restarts catch up.
# Otherwise return tomorrow's configured UTC time.
compute_next_attempt_epoch() {
  local now_epoch="$1"
  local last_success_epoch="$2"
  local day_start
  local scheduled_today
  local schedule_seconds

  schedule_seconds="$(backup_schedule_seconds)"
  day_start="$((now_epoch - now_epoch % 86400))"
  scheduled_today="$((day_start + schedule_seconds))"

  if (( now_epoch < scheduled_today )); then
    printf '%s\n' "$scheduled_today"
  elif (( last_success_epoch < scheduled_today )); then
    printf '%s\n' "$now_epoch"
  else
    printf '%s\n' "$((scheduled_today + 86400))"
  fi
}

write_scheduler_status() {
  local phase="$1"
  local now_epoch="$2"
  local next_attempt_epoch="$3"
  local last_exit_code="${4:-0}"
  local now_iso
  now_iso="$(backup_timestamp)"
  backup_atomic_write "$SCHEDULER_STATUS_FILE" "$(printf \
    '{\n  \"status\": \"%s\",\n  \"scheduleUtc\": \"%s\",\n  \"startedAtEpoch\": %s,\n  \"heartbeatAt\": \"%s\",\n  \"heartbeatAtEpoch\": %s,\n  \"nextAttemptEpoch\": %s,\n  \"lastExitCode\": %s\n}' \
    "$phase" "${BACKUP_SCHEDULE_UTC:-02:00}" "$SCHEDULER_STARTED_EPOCH" "$now_iso" "$now_epoch" \
    "$next_attempt_epoch" "$last_exit_code")"
}

wait_until_epoch() {
  local target_epoch="$1"
  local now_epoch
  local remaining
  local chunk

  while true; do
    now_epoch="$(date -u +%s)"
    remaining="$((target_epoch - now_epoch))"
    if (( remaining <= 0 )); then
      return
    fi
    if (( remaining > BACKUP_SCHEDULER_MAX_SLEEP_SECONDS )); then
      chunk="$BACKUP_SCHEDULER_MAX_SLEEP_SECONDS"
    else
      chunk="$remaining"
    fi
    write_scheduler_status 'waiting' "$now_epoch" "$target_epoch" 0
    sleep "$chunk"
  done
}

scheduler_main() {
  local now_epoch
  local next_attempt_epoch
  local last_success_epoch
  local exit_code=0

  backup_validate_runtime_gate
  backup_validate_schedule
  backup_require_positive_integer 'BACKUP_RETRY_MINUTES' "$BACKUP_RETRY_MINUTES"
  backup_require_positive_integer \
    'BACKUP_SCHEDULER_MAX_SLEEP_SECONDS' \
    "$BACKUP_SCHEDULER_MAX_SLEEP_SECONDS"
  if [[ ! -x "$BACKUP_RUNNER" ]]; then
    backup_die 'BACKUP_RUNNER is missing or not executable.'
    return 1
  fi
  mkdir -p "$BACKUP_STATUS_DIR"

  SCHEDULER_STARTED_EPOCH="$(date -u +%s)"
  last_success_epoch="$(read_last_success_epoch)"
  now_epoch="$SCHEDULER_STARTED_EPOCH"
  next_attempt_epoch="$(compute_next_attempt_epoch "$now_epoch" "$last_success_epoch")"
  backup_log "Daily scheduler active at ${BACKUP_SCHEDULE_UTC:-02:00} UTC."

  while true; do
    wait_until_epoch "$next_attempt_epoch"
    now_epoch="$(date -u +%s)"
    write_scheduler_status 'running' "$now_epoch" "$next_attempt_epoch" 0

    if "$BACKUP_RUNNER"; then
      exit_code=0
      last_success_epoch="$(read_last_success_epoch)"
      now_epoch="$(date -u +%s)"
      next_attempt_epoch="$(compute_next_attempt_epoch "$now_epoch" "$last_success_epoch")"
    else
      exit_code=$?
      now_epoch="$(date -u +%s)"
      next_attempt_epoch="$((now_epoch + BACKUP_RETRY_MINUTES * 60))"
      backup_log "Scheduled backup failed (exit $exit_code); retrying in $BACKUP_RETRY_MINUTES minute(s)."
    fi
    write_scheduler_status 'waiting' "$now_epoch" "$next_attempt_epoch" "$exit_code"
  done
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  scheduler_main "$@"
fi
