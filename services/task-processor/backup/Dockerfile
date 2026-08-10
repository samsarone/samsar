FROM alpine:3.21.3@sha256:a8560b36e8b8210634f77d9f7f9efd7ffa463e380b75e2e74aff4511df3ef88c

LABEL org.opencontainers.image.title="Samsar production backup runtime" \
      org.opencontainers.image.description="Production-only logical database and encrypted S3 backup scheduler"

RUN apk add --no-cache \
      bash \
      ca-certificates \
      coreutils \
      gzip \
      mariadb-client \
      mariadb-connector-c \
      mongodb-tools \
      restic \
      sqlite \
      tini \
      util-linux \
    && test -f /usr/lib/mariadb/plugin/caching_sha2_password.so \
    && mkdir -p /opt/samsar-backup /backup-data /backup-state \
    && chmod 0700 /backup-state

COPY backup/common.sh \
     backup/disabled.sh \
     backup/entrypoint.sh \
     backup/healthcheck.sh \
     backup/repository-command.sh \
     backup/run-backup.sh \
     backup/scheduler.sh \
     backup/status.sh \
     /opt/samsar-backup/

RUN chmod 0555 /opt/samsar-backup/*.sh

VOLUME ["/backup-state"]
STOPSIGNAL SIGTERM

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD ["/opt/samsar-backup/healthcheck.sh"]

ENTRYPOINT ["/sbin/tini", "--", "/opt/samsar-backup/entrypoint.sh"]
CMD ["schedule"]
