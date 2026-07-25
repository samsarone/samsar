FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates cron \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY src ./src
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x /app/docker-entrypoint.sh

ENV NODE_ENV=production
ENV SAMSAR_ASSETS_V2_ROOT=/assets_v2
ENV CLEANUP_MIN_AGE_HOURS=4
ENV CLEANUP_CRON_SCHEDULE="17 */3 * * *"
ENV CLEANUP_ON_START=true
ENV CLEANUP_DRY_RUN=false

CMD ["/app/docker-entrypoint.sh"]
