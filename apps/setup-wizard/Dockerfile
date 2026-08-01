FROM node:20 AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=optional --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:20-alpine

RUN apk add --no-cache bash docker-cli docker-cli-compose git

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --include=optional --ignore-scripts --no-audit --no-fund

COPY --from=builder /app/dist ./dist
COPY server.mjs ./server.mjs
COPY openrouterValidation.mjs ./openrouterValidation.mjs
COPY src/constants/providerEnvironment.js ./src/constants/providerEnvironment.js

ENV SETUP_WIZARD_STATIC_DIR=/app/dist
EXPOSE 80
CMD ["node", "server.mjs"]
