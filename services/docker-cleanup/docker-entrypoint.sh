#!/bin/sh
set -eu

CRON_FILE=/etc/cron.d/samsar-assets-v2-cleanup

run_startup_cleanup() {
  case "${CLEANUP_ON_START:-true}" in
    1|true|TRUE|yes|YES|on|ON)
      echo "[docker-cleanup] Running startup cleanup"
      node /app/src/cleanup.js || echo "[docker-cleanup] Startup cleanup failed; cron will continue"
      ;;
  esac
}

write_cron_file() {
  {
    echo "SHELL=/bin/sh"
    echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    echo "SAMSAR_ASSETS_V2_ROOT=${SAMSAR_ASSETS_V2_ROOT:-/assets_v2}"
    echo "CLEANUP_MIN_AGE_HOURS=${CLEANUP_MIN_AGE_HOURS:-24}"
    echo "CLEANUP_DRY_RUN=${CLEANUP_DRY_RUN:-false}"
    echo "CLEANUP_TARGETS=${CLEANUP_TARGETS:-}"
    echo "${CLEANUP_CRON_SCHEDULE:-17 */3 * * *} root node /app/src/cleanup.js >> /proc/1/fd/1 2>> /proc/1/fd/2"
  } > "$CRON_FILE"

  chmod 0644 "$CRON_FILE"
}

run_startup_cleanup
write_cron_file

echo "[docker-cleanup] Scheduled assets_v2 cleanup with cron: ${CLEANUP_CRON_SCHEDULE:-17 */3 * * *}"
exec cron -f
