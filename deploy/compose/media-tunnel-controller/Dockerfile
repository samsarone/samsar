ARG CLOUDFLARED_IMAGE=cloudflare/cloudflared:latest
FROM ${CLOUDFLARED_IMAGE} AS cloudflared

FROM node:24-alpine3.24

RUN apk upgrade --no-cache \
  && apk add --no-cache ca-certificates \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY controller.mjs /app/controller.mjs

ENTRYPOINT ["node", "/app/controller.mjs"]
