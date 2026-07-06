# Runtime Modes

## Local

Runs source services directly on the host. Optional MongoDB and MinIO can still be started with Docker for convenience.

## Docker Compose

Runs services as containers with Compose profiles:

- `core`
- `workers`
- `local-mongo`
- `minio`
- `local-media`
- `logger`

## Kubernetes

Uses the Helm chart under `deploy/helm/samsar`. Optional MongoDB and MinIO should be deployed as StatefulSets with PVCs.
