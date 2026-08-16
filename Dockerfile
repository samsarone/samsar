# Generic service Dockerfile used by Compose/Kubernetes builds after project sync.
# SERVICE_PATH should point at one synced app/service directory.
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    ffmpeg \
    python3 \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    fontconfig \
  && rm -rf /var/lib/apt/lists/*

ARG SERVICE_PATH
COPY ${SERVICE_PATH}/ ./
RUN test -f package-lock.json \
  || (echo "Missing ${SERVICE_PATH}/package-lock.json. Commit the service lockfile before building." >&2; exit 1)
RUN npm ci --omit=dev --include=optional --no-audit --no-fund
COPY packages/backblaze-native-client/ /app/node_modules/@samsar/backblaze-native-client/

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    libcairo2 \
    libpango-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    fontconfig \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=build /app /app

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe
CMD ["node", "index.js"]
