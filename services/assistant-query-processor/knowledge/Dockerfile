# syntax=docker/dockerfile:1.7
FROM node:20-bookworm-slim AS assistant-knowledge-build
WORKDIR /opt/assistant-knowledge
COPY index.mjs ./
COPY snapshot/ ./snapshot/
RUN --network=none node index.mjs build
FROM scratch AS artifact
COPY --from=assistant-knowledge-build /opt/assistant-knowledge/release/ /
