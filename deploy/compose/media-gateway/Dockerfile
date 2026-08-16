FROM nginx:stable-alpine

# curl is not used by nginx or the BusyBox-based healthcheck. Removing it also
# removes its nghttp2 dependency from the runtime image.
RUN apk upgrade --no-cache \
  && apk del --no-cache curl
