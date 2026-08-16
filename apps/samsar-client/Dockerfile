# Build the static client with a supported Node release.
FROM node:24-bookworm-slim AS build

# Set working directory
WORKDIR /app

# Copy only dependency files and install cleanly
COPY package.json yarn.lock ./
RUN corepack enable \
  && corepack prepare yarn@1.22.22 --activate \
  && yarn install --frozen-lockfile --non-interactive \
  && yarn esbuild --version

# Copy rest of the app
COPY . .

ARG VITE_PROCESSOR_API=http://localhost:3002
ARG VITE_CLIENT_URL=http://localhost:3000
ARG VITE_STATIC_CDN_URL=https://static.samsar.one
ARG VITE_PUBLISHER_URL=https://gallery.samsar.one
ARG VITE_AUTH_COOKIE_DOMAIN
ARG VITE_SAMSAR_DEPLOYMENT_EDITION=standalone
ARG VITE_CURRENT_ENV=standalone
ARG VITE_DOCKER_INSTALL=true
ARG VITE_SETUP_WIZARD_API=http://localhost:8089

ENV VITE_PROCESSOR_API=${VITE_PROCESSOR_API} \
    VITE_CLIENT_URL=${VITE_CLIENT_URL} \
    VITE_STATIC_CDN_URL=${VITE_STATIC_CDN_URL} \
    VITE_PUBLISHER_URL=${VITE_PUBLISHER_URL} \
    VITE_AUTH_COOKIE_DOMAIN=${VITE_AUTH_COOKIE_DOMAIN} \
    VITE_SAMSAR_DEPLOYMENT_EDITION=${VITE_SAMSAR_DEPLOYMENT_EDITION} \
    VITE_CURRENT_ENV=${VITE_CURRENT_ENV} \
    VITE_DOCKER_INSTALL=${VITE_DOCKER_INSTALL} \
    VITE_SETUP_WIZARD_API=${VITE_SETUP_WIZARD_API}

# Build app
RUN yarn build --mode staging \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /root/.cache /usr/local/share/.cache/yarn \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx \
    /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Serve only the static build output in the runtime image.
FROM nginx:stable-alpine AS runtime

RUN apk upgrade --no-cache \
  && apk del --no-cache curl

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist_build/ /usr/share/nginx/html/

# Expose
EXPOSE 3000

# Start nginx in the foreground
CMD ["nginx", "-g", "daemon off;"]
