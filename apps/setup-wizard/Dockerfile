FROM node:24 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=optional --no-audit --no-fund

COPY . .
RUN npm run build

FROM docker:29.6.2-cli-alpine3.24 AS docker-cli

FROM docker/compose-bin:v5.4.0 AS compose-cli

FROM node:24-alpine3.24

RUN apk upgrade --no-cache

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
COPY --from=compose-cli /docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --include=optional --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force \
  && rm -rf /usr/local/lib/node_modules/npm \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder /app/dist ./dist
COPY server.mjs ./server.mjs
COPY openrouterValidation.mjs ./openrouterValidation.mjs
COPY gmiCloudValidation.mjs ./gmiCloudValidation.mjs
COPY genblazeCompose.mjs ./genblazeCompose.mjs
COPY storageConfig.mjs ./storageConfig.mjs
COPY backblazeValidation.mjs ./backblazeValidation.mjs
COPY src/constants/providerEnvironment.js ./src/constants/providerEnvironment.js
COPY src/constants/configurationEnvironment.js ./src/constants/configurationEnvironment.js

ENV SETUP_WIZARD_STATIC_DIR=/app/dist
EXPOSE 80
CMD ["node", "server.mjs"]
