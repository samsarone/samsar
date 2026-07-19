ARG CLOUDFLARED_IMAGE=cloudflare/cloudflared:latest
FROM ${CLOUDFLARED_IMAGE} AS cloudflared

FROM node:20-alpine

RUN apk add --no-cache ca-certificates

COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY controller.mjs /app/controller.mjs

ENTRYPOINT ["node", "/app/controller.mjs"]
