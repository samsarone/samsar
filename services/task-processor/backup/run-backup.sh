#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
source "$SCRIPT_DIR/common.sh"

BACKUP_STATE_DIR="${BACKUP_STATE_DIR:-/backup-state}"
BACKUP_SOURCE_ROOT="${BACKUP_SOURCE_ROOT:-/backup-data}"
BACKUP_WORK_DIR="${BACKUP_WORK_DIR:-$BACKUP_STATE_DIR/work}"
BACKUP_STATUS_DIR="${BACKUP_STATUS_DIR:-$BACKUP_STATE_DIR/status}"
BACKUP_TEMP_DIR="$BACKUP_STATE_DIR/tmp"

BACKUP_BLOG_CONTENT_PATH="${BACKUP_BLOG_CONTENT_PATH:-$BACKUP_SOURCE_ROOT/blog-content}"
BACKUP_MEDIA_ASSETS_PATH="${BACKUP_MEDIA_ASSETS_PATH:-$BACKUP_SOURCE_ROOT/media-assets}"
BACKUP_MEDIA_ASSETS_V2_PATH="${BACKUP_MEDIA_ASSETS_V2_PATH:-$BACKUP_SOURCE_ROOT/media-assets-v2}"
BACKUP_MINIO_DATA_PATH="${BACKUP_MINIO_DATA_PATH:-$BACKUP_SOURCE_ROOT/minio-data}"
BACKUP_PERSISTENT_DATA_PATH="${BACKUP_PERSISTENT_DATA_PATH:-$BACKUP_SOURCE_ROOT/persistent-data}"
BACKUP_LICENSE_DATA_PATH="${BACKUP_LICENSE_DATA_PATH:-$BACKUP_SOURCE_ROOT/license-data}"
BACKUP_SQLITE_MOUNT_PATH="${BACKUP_SQLITE_MOUNT_PATH:-$BACKUP_SOURCE_ROOT/blog-analytics}"
BACKUP_SQLITE_DATABASE="${BACKUP_SQLITE_DATABASE:-$BACKUP_SQLITE_MOUNT_PATH/analytics.sqlite}"

BACKUP_RETENTION_DAILY="${BACKUP_RETENTION_DAILY:-14}"
BACKUP_RETENTION_WEEKLY="${BACKUP_RETENTION_WEEKLY:-8}"
BACKUP_RETENTION_MONTHLY="${BACKUP_RETENTION_MONTHLY:-12}"
BACKUP_PRUNE_WEEKDAY_UTC="${BACKUP_PRUNE_WEEKDAY_UTC:-7}"
BACKUP_RESTIC_HOST="${BACKUP_RESTIC_HOST:-samsar-production}"
BACKUP_RESTIC_TAG="${BACKUP_RESTIC_TAG:-samsar-production}"

RUN_ID=''
RUN_ROOT=''
RUN_STARTED='false'
RUN_SUCCEEDED='false'
SNAPSHOT_ID=''

write_run_status() {
  local status="$1"
  local epoch="$2"
  local exit_code="${3:-0}"
  local completed_at
  completed_at="$(backup_timestamp)"
  backup_atomic_write "$BACKUP_STATUS_DIR/run-status.json" "$(printf \
    '{\n  \"status\": \"%s\",\n  \"runId\": \"%s\",\n  \"updatedAt\": \"%s\",\n  \"updatedAtEpoch\": %s,\n  \"exitCode\": %s\n}' \
    "$status" "$RUN_ID" "$completed_at" "$epoch" "$exit_code")"
}

write_last_success() {
  local epoch="$1"
  local completed_at
  completed_at="$(backup_timestamp)"
  backup_atomic_write "$BACKUP_STATUS_DIR/last-success.json" "$(printf \
    '{\n  \"status\": \"success\",\n  \"runId\": \"%s\",\n  \"snapshotId\": \"%s\",\n  \"completedAt\": \"%s\",\n  \"completedAtEpoch\": %s\n}' \
    "$RUN_ID" "$SNAPSHOT_ID" "$completed_at" "$epoch")"
}

cleanup_run() {
  local exit_code=$?
  trap - EXIT

  if [[ "$RUN_STARTED" == 'true' && "$RUN_SUCCEEDED" != 'true' ]]; then
    write_run_status 'failed' "$(date -u +%s)" "$exit_code" || true
    backup_log "Backup run $RUN_ID failed (exit $exit_code)."
  fi

  if [[ -n "$RUN_ROOT" && -d "$RUN_ROOT" ]]; then
    rm -rf -- "$RUN_ROOT"
  fi
  exit "$exit_code"
}

validate_configuration() {
  local state_real
  local source_real
  local temp_real
  local path
  local path_real
  local secret_path

  backup_validate_runtime_gate
  backup_validate_restic_repository
  backup_validate_schedule
  backup_require_positive_integer 'BACKUP_RETENTION_DAILY' "$BACKUP_RETENTION_DAILY"
  backup_require_positive_integer 'BACKUP_RETENTION_WEEKLY' "$BACKUP_RETENTION_WEEKLY"
  backup_require_positive_integer 'BACKUP_RETENTION_MONTHLY' "$BACKUP_RETENTION_MONTHLY"
  if [[ ! "$BACKUP_PRUNE_WEEKDAY_UTC" =~ ^[1-7]$ ]]; then
    backup_die 'BACKUP_PRUNE_WEEKDAY_UTC must be 1 (Monday) through 7 (Sunday).'
    return 1
  fi
  backup_validate_token 'BACKUP_RESTIC_HOST' "$BACKUP_RESTIC_HOST"
  backup_validate_token 'BACKUP_RESTIC_TAG' "$BACKUP_RESTIC_TAG"

  for path in \
    "$BACKUP_STATE_DIR" \
    "$BACKUP_WORK_DIR" \
    "$BACKUP_STATUS_DIR" \
    "$BACKUP_TEMP_DIR"; do
    if [[ "$path" == *$'\n'* || "$path" == *$'\r'* || "$path" == *"'"* ]]; then
      backup_die 'Backup state paths contain unsupported characters.'
      return 1
    fi
  done

  mkdir -p "$BACKUP_STATE_DIR" "$BACKUP_WORK_DIR" "$BACKUP_STATUS_DIR" "$BACKUP_TEMP_DIR"
  chmod 0700 "$BACKUP_TEMP_DIR"
  if [[ ! -d "$BACKUP_SOURCE_ROOT" ]]; then
    backup_die 'BACKUP_SOURCE_ROOT is missing.'
    return 1
  fi
  state_real="$(realpath "$BACKUP_STATE_DIR")"
  source_real="$(realpath "$BACKUP_SOURCE_ROOT")"
  temp_real="$(realpath "$BACKUP_TEMP_DIR")"
  case "$state_real/" in
    "$source_real/"*)
      backup_die 'BACKUP_STATE_DIR must not be inside BACKUP_SOURCE_ROOT.'
      return 1
      ;;
  esac
  case "$temp_real/" in
    "$state_real/"*) ;;
    *)
      backup_die 'Restic temporary storage must resolve inside BACKUP_STATE_DIR.'
      return 1
      ;;
  esac

  for path in \
    "$BACKUP_BLOG_CONTENT_PATH" \
    "$BACKUP_MEDIA_ASSETS_PATH" \
    "$BACKUP_MEDIA_ASSETS_V2_PATH" \
    "$BACKUP_MINIO_DATA_PATH" \
    "$BACKUP_PERSISTENT_DATA_PATH" \
    "$BACKUP_LICENSE_DATA_PATH" \
    "$BACKUP_SQLITE_MOUNT_PATH"; do
    if [[ ! -e "$path" ]]; then
      backup_die 'A configured backup source path is missing.'
      return 1
    fi
    path_real="$(realpath "$path")"
    case "$path_real/" in
      "$source_real/"*) ;;
      *)
        backup_die 'Every backup source mount must resolve inside BACKUP_SOURCE_ROOT.'
        return 1
        ;;
    esac
  done

  backup_require_read_only_mount 'blog content' "$BACKUP_BLOG_CONTENT_PATH"
  backup_require_read_only_mount 'media assets' "$BACKUP_MEDIA_ASSETS_PATH"
  backup_require_read_only_mount 'media assets v2' "$BACKUP_MEDIA_ASSETS_V2_PATH"
  backup_require_read_only_mount 'MinIO data' "$BACKUP_MINIO_DATA_PATH"
  backup_require_read_only_mount 'persistent data' "$BACKUP_PERSISTENT_DATA_PATH"
  backup_require_read_only_mount 'license data' "$BACKUP_LICENSE_DATA_PATH"
  backup_require_read_only_mount 'blog analytics SQLite' "$BACKUP_SQLITE_MOUNT_PATH"

  if [[ ! -f "$BACKUP_SQLITE_DATABASE" || ! -r "$BACKUP_SQLITE_DATABASE" ]]; then
    backup_die 'Configured SQLite database is missing or unreadable.'
    return 1
  fi
  path_real="$(realpath "$BACKUP_SQLITE_DATABASE")"
  case "$path_real" in
    "$source_real/"*) ;;
    *)
      backup_die 'Configured SQLite database must resolve inside BACKUP_SOURCE_ROOT.'
      return 1
      ;;
  esac

  backup_load_mongodb_uri
  backup_load_secret_input \
    'BACKUP_MYSQL_PASSWORD' \
    'BACKUP_MYSQL_PASSWORD_FILE' \
    'MySQL backup password'
  backup_load_cloud_credentials

  # Credential files must never be reachable from a snapshotted source tree.
  for secret_path in \
    "${RESTIC_PASSWORD_FILE:-}" \
    "${AWS_ACCESS_KEY_ID_FILE:-}" \
    "${AWS_SECRET_ACCESS_KEY_FILE:-}" \
    "${AWS_SESSION_TOKEN_FILE:-}" \
    "${BACKUP_MYSQL_PASSWORD_FILE:-}" \
    "${BACKUP_MONGODB_URI_FILE:-}"; do
    [[ -n "$secret_path" ]] || continue
    path_real="$(realpath "$secret_path")"
    case "$path_real" in
      "$source_real"|"$source_real/"*)
        backup_die 'Credential files must be mounted outside BACKUP_SOURCE_ROOT.'
        return 1
        ;;
    esac
  done

  for path in flock findmnt gzip sha256sum mongodump mysqldump sqlite3 restic realpath; do
    backup_require_command "$path"
  done
}

write_mongodb_config() {
  local destination="$1"
  umask 077
  printf 'uri: %s\n' "$(backup_yaml_double_quote "$BACKUP_MONGODB_URI")" >"$destination"
}

write_mysql_config() {
  local destination="$1"
  local host="${BACKUP_MYSQL_HOST:-blog-db}"
  local port="${BACKUP_MYSQL_PORT:-3306}"
  local user="${BACKUP_MYSQL_USER:-samsar_blog}"
  local database="${BACKUP_MYSQL_DATABASE:-samsar_blog}"

  backup_require_positive_integer 'BACKUP_MYSQL_PORT' "$port"
  backup_require_safe_scalar 'BACKUP_MYSQL_HOST' "$host"
  backup_require_safe_scalar 'BACKUP_MYSQL_USER' "$user"
  if [[ ! "$database" =~ ^[A-Za-z0-9_$-]+$ ]]; then
    backup_die 'BACKUP_MYSQL_DATABASE contains unsupported characters.'
    return 1
  fi

  umask 077
  {
    printf '[client]\n'
    printf 'protocol=tcp\n'
    printf 'host=%s\n' "$(backup_mysql_double_quote "$host")"
    printf 'port=%s\n' "$port"
    printf 'user=%s\n' "$(backup_mysql_double_quote "$user")"
    printf 'password=%s\n' "$(backup_mysql_double_quote "$BACKUP_MYSQL_PASSWORD")"
  } >"$destination"
}

dump_mongodb() {
  local private_dir="$1"
  local dump_dir="$2"
  local config="$private_dir/mongodump.yml"
  local output="$dump_dir/mongodb-all.archive.gz"
  local arguments=()

  write_mongodb_config "$config"
  arguments+=("--config=$config" "--archive=$output" '--gzip' '--quiet')
  if backup_is_true "${BACKUP_MONGODB_USE_OPLOG:-false}"; then
    arguments+=('--oplog')
  elif [[ "${BACKUP_MONGODB_USE_OPLOG:-false}" != 'false' ]]; then
    backup_die 'BACKUP_MONGODB_USE_OPLOG must be true or false.'
    return 1
  fi

  backup_log 'Creating logical MongoDB dump for all databases.'
  mongodump "${arguments[@]}"
  [[ -s "$output" ]] || backup_die 'MongoDB dump is empty.'
  gzip -t "$output"
}

dump_mysql() {
  local private_dir="$1"
  local dump_dir="$2"
  local config="$private_dir/mysql.cnf"
  local output="$dump_dir/mysql-ghost.sql.gz"

  write_mysql_config "$config"
  backup_log 'Creating transactional dump of the configured Ghost MySQL database.'
  mysqldump \
    "--defaults-extra-file=$config" \
    --ssl \
    --skip-ssl-verify-server-cert \
    --databases "${BACKUP_MYSQL_DATABASE:-samsar_blog}" \
    --single-transaction \
    --quick \
    --skip-lock-tables \
    --no-tablespaces \
    --routines \
    --events \
    --triggers \
    --hex-blob \
    --default-character-set=utf8mb4 \
    | gzip -c >"$output"
  [[ -s "$output" ]] || backup_die 'MySQL dump is empty.'
  gzip -t "$output"
}

dump_sqlite() {
  local dump_dir="$1"
  local output="$dump_dir/blog-analytics.sqlite"
  local check_result

  backup_log 'Creating consistent SQLite backup through the SQLite backup API.'
  sqlite3 -readonly "$BACKUP_SQLITE_DATABASE" \
    '.timeout 30000' \
    ".backup '$output'"
  [[ -s "$output" ]] || backup_die 'SQLite backup is empty.'
  check_result="$(sqlite3 -readonly "$output" 'PRAGMA quick_check;')"
  if [[ "$check_result" != 'ok' ]]; then
    backup_die 'SQLite backup integrity check failed.'
    return 1
  fi
}

write_payload_manifest() {
  local payload_dir="$1"
  local created_at
  created_at="$(backup_timestamp)"
  (
    cd "$payload_dir"
    sha256sum \
      dumps/mongodb-all.archive.gz \
      dumps/mysql-ghost.sql.gz \
      dumps/blog-analytics.sqlite \
      >MANIFEST.sha256
  )
  backup_atomic_write "$payload_dir/manifest.json" "$(printf \
    '{\n  \"schemaVersion\": 1,\n  \"edition\": \"production\",\n  \"runId\": \"%s\",\n  \"createdAt\": \"%s\",\n  \"mongoScope\": \"all-databases\",\n  \"mysqlScope\": \"database:%s\",\n  \"sqliteMethod\": \"online-backup-api\",\n  \"filesystemSources\": [\n    \"blog-content\",\n    \"media-assets\",\n    \"media-assets-v2\",\n    \"minio-data\",\n    \"persistent-data\",\n    \"license-data\"\n  ]\n}' \
    "$RUN_ID" "$created_at" "${BACKUP_MYSQL_DATABASE:-samsar_blog}")"
}

ensure_restic_repository() {
  if restic cat config >/dev/null 2>&1; then
    return
  fi
  backup_log 'Initializing encrypted restic repository.'
  restic init
}

run_restic_backup() {
  local payload_dir="$1"
  local result_file="$2"
  local source_paths=(
    "$payload_dir"
    "$BACKUP_BLOG_CONTENT_PATH"
    "$BACKUP_MEDIA_ASSETS_PATH"
    "$BACKUP_MEDIA_ASSETS_V2_PATH"
    "$BACKUP_MINIO_DATA_PATH"
    "$BACKUP_PERSISTENT_DATA_PATH"
    "$BACKUP_LICENSE_DATA_PATH"
  )
  local forget_arguments=(
    --host "$BACKUP_RESTIC_HOST"
    --tag "$BACKUP_RESTIC_TAG"
    --group-by host,tags
    --keep-daily "$BACKUP_RETENTION_DAILY"
    --keep-weekly "$BACKUP_RETENTION_WEEKLY"
    --keep-monthly "$BACKUP_RETENTION_MONTHLY"
  )
  local weekday_utc

  ensure_restic_repository
  # The repository is dedicated to this runtime and the outer flock prevents a
  # second local writer. Removing stale locks makes crash recovery automatic.
  restic unlock --remove-all >/dev/null

  backup_log 'Writing encrypted incremental snapshot to the configured private S3 repository.'
  restic backup \
    --json \
    --one-file-system \
    --host "$BACKUP_RESTIC_HOST" \
    --tag "$BACKUP_RESTIC_TAG" \
    "${source_paths[@]}" \
    >"$result_file"

  SNAPSHOT_ID="$(sed -n 's/.*\"snapshot_id\"[[:space:]]*:[[:space:]]*\"\([0-9a-f][0-9a-f]*\)\".*/\1/p' "$result_file" | tail -n 1)"
  if [[ ! "$SNAPSHOT_ID" =~ ^[0-9a-f]{8,64}$ ]]; then
    backup_die 'restic completed without returning a valid snapshot ID.'
    return 1
  fi

  # Confirm the new snapshot is addressable before applying retention.
  restic snapshots "$SNAPSHOT_ID" --json >/dev/null

  weekday_utc="$(date -u +%u)"
  if [[ "$weekday_utc" == "$BACKUP_PRUNE_WEEKDAY_UTC" ]]; then
    backup_log 'Applying snapshot retention and the scheduled weekly repository prune.'
    restic forget "${forget_arguments[@]}"
    restic prune
  else
    backup_log 'Applying snapshot retention; repository pruning is deferred to its UTC weekday.'
    restic forget "${forget_arguments[@]}"
  fi

  backup_log 'Verifying restic repository metadata.'
  restic check
}

main() {
  local lock_file
  local payload_dir
  local private_dir
  local dump_dir
  local restic_result
  local completed_epoch

  umask 077
  validate_configuration
  export TMPDIR="$BACKUP_TEMP_DIR"
  export RESTIC_CACHE_DIR="${RESTIC_CACHE_DIR:-$BACKUP_STATE_DIR/restic-cache}"
  mkdir -p "$RESTIC_CACHE_DIR"

  lock_file="$BACKUP_STATE_DIR/backup.lock"
  exec 9>"$lock_file"
  if ! flock -n 9; then
    backup_log 'Another backup run owns the lock; refusing a concurrent run.'
    return 75
  fi

  RUN_ID="$(date -u '+%Y%m%dT%H%M%SZ')-$$"
  RUN_ROOT="$BACKUP_WORK_DIR/$RUN_ID"
  payload_dir="$RUN_ROOT/payload"
  private_dir="$RUN_ROOT/private"
  dump_dir="$payload_dir/dumps"
  restic_result="$RUN_ROOT/restic-backup.jsonl"
  mkdir -p "$dump_dir" "$private_dir"
  RUN_STARTED='true'
  trap cleanup_run EXIT
  write_run_status 'running' "$(date -u +%s)"

  dump_mongodb "$private_dir" "$dump_dir"
  dump_mysql "$private_dir" "$dump_dir"
  dump_sqlite "$dump_dir"
  write_payload_manifest "$payload_dir"
  run_restic_backup "$payload_dir" "$restic_result"

  completed_epoch="$(date -u +%s)"
  write_last_success "$completed_epoch"
  write_run_status 'success' "$completed_epoch" 0
  RUN_SUCCEEDED='true'
  backup_log "Backup run $RUN_ID completed successfully with snapshot $SNAPSHOT_ID."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
