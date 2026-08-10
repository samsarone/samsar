#!/usr/bin/env bash

# Shared helpers for the standalone production backup runtime. Callers enable
# their own strict-mode settings so this file can also be sourced by tests.

backup_timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

backup_log() {
  printf '[samsar-backup] %s %s\n' "$(backup_timestamp)" "$*" >&2
}

backup_die() {
  backup_log "ERROR: $*"
  return 1
}

backup_is_true() {
  [[ "${1:-}" == 'true' ]]
}

backup_validate_runtime_gate() {
  if [[ "${BACKUP_ENABLED:-}" != 'true' ]]; then
    backup_die 'BACKUP_ENABLED must be explicitly set to true; refusing to run.'
    return 1
  fi

  if [[ "${SAMSAR_DEPLOYMENT_EDITION:-}" != 'production' ]]; then
    backup_die 'SAMSAR_DEPLOYMENT_EDITION must be exactly production; refusing to run.'
    return 1
  fi
}

backup_require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    backup_die "Required command is unavailable: $command_name"
    return 1
  fi
}

backup_require_positive_integer() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[1-9][0-9]*$ ]]; then
    backup_die "$name must be a positive integer."
    return 1
  fi
}

backup_require_nonnegative_integer() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    backup_die "$name must be a non-negative integer."
    return 1
  fi
}

backup_require_safe_scalar() {
  local name="$1"
  local value="$2"
  # Environment variables cannot contain NUL bytes. Explicitly reject the
  # remaining line-breaking characters before serializing values to config.
  if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    backup_die "$name contains unsupported control characters."
    return 1
  fi
}

backup_read_secret_file() {
  local path="$1"
  local destination_name="$2"
  local label="$3"
  local secret_value

  if [[ ! -f "$path" || ! -r "$path" ]]; then
    backup_die "$label file is missing or unreadable."
    return 1
  fi

  # Command substitution removes normal trailing newlines written by secret
  # provisioning tools. Embedded newlines remain and are rejected below.
  secret_value="$(<"$path")"
  if [[ -z "$secret_value" ]]; then
    backup_die "$label file is empty."
    return 1
  fi
  if [[ "$secret_value" == *$'\n'* || "$secret_value" == *$'\r'* ]]; then
    backup_die "$label file must contain exactly one line."
    return 1
  fi

  printf -v "$destination_name" '%s' "$secret_value"
  export "$destination_name"
}

backup_load_secret_input() {
  local direct_name="$1"
  local file_name="$2"
  local label="$3"
  local required="${4:-true}"
  local direct_value="${!direct_name-}"
  local file_value="${!file_name-}"

  if [[ -n "$direct_value" && -n "$file_value" ]]; then
    backup_die "$direct_name and $file_name are mutually exclusive."
    return 1
  fi

  if [[ -n "$file_value" ]]; then
    backup_read_secret_file "$file_value" "$direct_name" "$label"
    return
  fi

  if [[ -n "$direct_value" ]]; then
    backup_require_safe_scalar "$direct_name" "$direct_value"
    return
  fi

  if [[ "$required" == 'true' ]]; then
    backup_die "$direct_name or $file_name is required."
    return 1
  fi
}

backup_load_cloud_credentials() {
  if [[ -n "${RESTIC_PASSWORD:-}" || -n "${RESTIC_PASSWORD_COMMAND:-}" ]]; then
    backup_die 'RESTIC_PASSWORD_FILE is required; direct/password-command inputs are not accepted.'
    return 1
  fi
  if [[ -z "${RESTIC_PASSWORD_FILE:-}" ]]; then
    backup_die 'RESTIC_PASSWORD_FILE is required.'
    return 1
  fi
  if [[ ! -f "$RESTIC_PASSWORD_FILE" || ! -r "$RESTIC_PASSWORD_FILE" || ! -s "$RESTIC_PASSWORD_FILE" ]]; then
    backup_die 'RESTIC_PASSWORD_FILE is missing, unreadable, or empty.'
    return 1
  fi

  backup_load_secret_input \
    'AWS_ACCESS_KEY_ID' \
    'AWS_ACCESS_KEY_ID_FILE' \
    'AWS access key ID' || return 1
  backup_load_secret_input \
    'AWS_SECRET_ACCESS_KEY' \
    'AWS_SECRET_ACCESS_KEY_FILE' \
    'AWS secret access key' || return 1
  backup_load_secret_input \
    'AWS_SESSION_TOKEN' \
    'AWS_SESSION_TOKEN_FILE' \
    'AWS session token' \
    'false' || return 1
}

backup_validate_schedule() {
  local schedule="${BACKUP_SCHEDULE_UTC:-02:00}"
  if [[ ! "$schedule" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]]; then
    backup_die 'BACKUP_SCHEDULE_UTC must use zero-padded 24-hour HH:MM format.'
    return 1
  fi
}

backup_schedule_seconds() {
  local schedule="${BACKUP_SCHEDULE_UTC:-02:00}"
  local hours="${schedule%%:*}"
  local minutes="${schedule##*:}"
  # 10# avoids interpreting zero-padded values as octal.
  printf '%s\n' "$((10#$hours * 3600 + 10#$minutes * 60))"
}

backup_json_epoch_value() {
  local path="$1"
  local key="$2"
  [[ -f "$path" ]] || return 1
  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p" "$path" | head -n 1
}

backup_json_string_value() {
  local path="$1"
  local key="$2"
  [[ -f "$path" ]] || return 1
  sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$path" | head -n 1
}

backup_atomic_write() {
  local destination="$1"
  local temporary="${destination}.tmp.$$"
  umask 077
  mkdir -p "$(dirname "$destination")"
  printf '%s\n' "${2:-}" >"$temporary"
  mv -f "$temporary" "$destination"
}

backup_yaml_double_quote() {
  local value="$1"
  backup_require_safe_scalar 'MongoDB connection input' "$value" || return 1
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

backup_mysql_double_quote() {
  local value="$1"
  backup_require_safe_scalar 'MySQL connection input' "$value" || return 1
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

backup_validate_mongodb_uri() {
  local uri="$1"
  local remainder
  local path_and_query
  local database_path

  case "$uri" in
    mongodb://*|mongodb+srv://*) ;;
    *)
      backup_die 'BACKUP_MONGODB_URI must be a mongodb:// or mongodb+srv:// URI.'
      return 1
      ;;
  esac

  backup_require_safe_scalar 'BACKUP_MONGODB_URI' "$uri" || return 1
  remainder="${uri#*://}"
  if [[ "$remainder" == */* ]]; then
    path_and_query="${remainder#*/}"
    database_path="${path_and_query%%\?*}"
    if [[ -n "$database_path" ]]; then
      backup_die 'BACKUP_MONGODB_URI must not select a database; all MongoDB databases are dumped.'
      return 1
    fi
  elif [[ "$remainder" == *\?* ]]; then
    backup_die 'BACKUP_MONGODB_URI query options must follow an empty / path.'
    return 1
  fi
}

backup_load_mongodb_uri() {
  backup_load_secret_input \
    'BACKUP_MONGODB_URI' \
    'BACKUP_MONGODB_URI_FILE' \
    'MongoDB URI' || return 1
  backup_validate_mongodb_uri "$BACKUP_MONGODB_URI"
}

backup_validate_restic_repository() {
  local repository="${RESTIC_REPOSITORY:-}"
  if [[ "$repository" != s3:* ]]; then
    backup_die 'RESTIC_REPOSITORY must target an s3: repository.'
    return 1
  fi
  if [[ "$repository" == *://*@* ]]; then
    backup_die 'RESTIC_REPOSITORY must not contain embedded credentials.'
    return 1
  fi
  backup_require_safe_scalar 'RESTIC_REPOSITORY' "$repository"
}

backup_mount_is_read_only() {
  local path="$1"
  local options
  # -M requires the path itself to be a mount point; inheriting read-only from
  # an unrelated parent filesystem is not sufficient for source isolation.
  options="$(findmnt -n -o OPTIONS --mountpoint "$path" 2>/dev/null || true)"
  [[ ",$options," == *,ro,* ]]
}

backup_require_read_only_mount() {
  local label="$1"
  local path="$2"

  if [[ ! -d "$path" ]]; then
    backup_die "$label mount is missing."
    return 1
  fi
  if ! backup_mount_is_read_only "$path"; then
    backup_die "$label must be mounted read-only."
    return 1
  fi
}

backup_validate_token() {
  local name="$1"
  local value="$2"
  if [[ ! "$value" =~ ^[A-Za-z0-9._-]+$ ]]; then
    backup_die "$name may contain only letters, numbers, period, underscore, and hyphen."
    return 1
  fi
}
