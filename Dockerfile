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
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

ENV NODE_ENV=production
CMD ["node", "index.js"]
