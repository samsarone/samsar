# Generic service Dockerfile used by Compose/Kubernetes builds after project sync.
# SERVICE_PATH should point at one synced app/service directory.
ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-slim AS runtime

ARG SERVICE_PATH
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
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

COPY ${SERVICE_PATH}/ ./
RUN test -f package-lock.json \
  || (echo "Missing ${SERVICE_PATH}/package-lock.json. Commit the service lockfile before building." >&2; exit 1)
RUN npm ci --omit=dev --include=optional --no-audit --no-fund
COPY packages/backblaze-native-client/ /app/node_modules/@samsar/backblaze-native-client/

ENV NODE_ENV=production \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe
CMD ["node", "index.js"]
