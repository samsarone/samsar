# Use Node base with Debian (Linux) packages
FROM node:20-bullseye

# Install native deps (canvas, etc.)
RUN apt-get update && apt-get install -y \
  build-essential \
  libcairo2-dev \
  libpango1.0-dev \
  libjpeg-dev \
  libgif-dev \
  librsvg2-dev \
  python3 \
  pkg-config \
  && rm -rf /var/lib/apt/lists/*

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
RUN yarn build --mode staging


# Expose
EXPOSE 3000

# Start preview server
CMD ["yarn", "preview", "--host", "--port", "3000"]
