# Docker runtime recovery and maintenance builds

A Docker Desktop VM network stall can leave container processes alive while the
host Docker API, media tunnel, and provider downloads fail. A container restart
policy cannot recover a live VM with a stalled network. The host watchdog checks
the engine outside the VM and offers bounded, opt-in runtime recovery. It does
not fix a Docker Desktop or guest kernel driver defect.

Provider recovery is handled at the worker boundaries, independently of the host
watchdog. Video, audio and Express use one dependency-free network policy, with
byte-identical copies checked in CI so the source projects can still build
independently. Image and audio/video queues persist submission intent before paid
work. Accepted request IDs and completed output remain attached to that execution;
polling, downloads and delivery can retry within limits. An attempted submission
with unknown acceptance fails without replay or provider failover. Generation SDK
retries are disabled where they could repeat a paid POST. Existing definitive
content/authentication rejection handling remains separate from transport errors.

The shared worker safeguards apply to local and production builds. Host recovery
is opt-in and platform-specific. Only leases and failure receipts created by the
new protocol are recovered; this does not sweep or resume historical sessions.

## Check without changing runtime state

From the repository root, run:

```bash
npm run docker:check
npm run docker:watch -- --health-url http://localhost:3002/v1/health/live
```

Both commands report only. They never restart Docker or application containers.
The first checks once; the second polls every 15 seconds. Engine API requests have
a four-second total deadline. Application probes are optional; an unhealthy
application with a reachable engine does not trigger a VM restart.

State and an exclusive process lock are saved under `runtime/state/`. State is
private and persists the recovery budget across watchdog restarts. A malformed
state file fails closed instead of silently resetting the budget.

## Recover without resuming jobs

This mode is deliberately narrow: macOS Docker Desktop, the canonical raw VM
control socket, an independently verified engine ID, and Compose containers
belonging to this checkout. Before restarting the VM, it:

1. Verifies that the raw socket has the expected engine identity and that all
   running containers belong to this deployment or its setup wizard. Unrelated
   stopped containers must have automatic restart disabled as well.
2. Writes the persistent maintenance override.
3. Sets every application consumer's restart policy to `no`, stops it, and
   verifies that it is stopped with that restart policy.
4. Issues a bounded Docker Desktop restart only after those checks succeed.

The container inventory is checked again immediately before recovery; a newly
appearing or running consumer aborts the VM restart.

Inspect the expected identity through a previously trusted endpoint. If the
normal Desktop proxy is stalled, the canonical macOS socket is
`~/Library/Containers/com.docker.docker/Data/docker.raw.sock`; its `/info` response
contains `ID`. Do not substitute a different engine to make the checks pass.

```bash
node scripts/docker-runtime-watchdog.mjs --watch --recover --no-jobs \
  --expected-engine-id VERIFIED_ENGINE_ID
```

Recovery requires three consecutive engine failures, has a two-minute cooldown,
and permits at most two attempts in a rolling hour. The attempt is saved before
issuing the restart, so a timeout cannot immediately repeat it. The watchdog
exits when the budget is exhausted. Probe interval, timeout, threshold, cooldown,
and attempt count have validated bounded CLI options; see `--help`.

If the raw socket is also unresponsive, identity is unknown, a consumer cannot be
stopped, or another application is running on the engine, no-jobs recovery refuses
the VM restart. Do not restart Desktop first: existing `unless-stopped` consumers
could automatically resume old sessions. This tool does not start, resume, cancel,
or modify a session in MongoDB.

## Rebuild with HTTP available and consumers idle

With an existing saved runtime configuration and a reachable, verified engine:

```bash
npm run docker:maintenance
```

This bypasses the setup wizard, stops application consumers before building, and
rebuilds and starts the selected profiles with
`runtime/config/compose.jobs-disabled.json`. The processor serves health endpoints
and rejects other requests with maintenance status. Worker containers run an idle
command instead of loading their queue consumers; automatic container restart is
disabled for consumers. Data volumes and provider request records are preserved.

If only the verified canonical raw endpoint is responsive, explicitly select it
for this command; deployment never silently changes engines:

```bash
DOCKER_HOST="unix://$HOME/Library/Containers/com.docker.docker/Data/docker.raw.sock" \
  npm run docker:maintenance
```

The override is persistent. Later ordinary `docker:up`, `docker:restart`, or
`docker:update` commands continue using maintenance mode. Only an explicit operator
decision enables consumers again:

```bash
npm run docker:update -- --enable-jobs
```

That command can resume existing queued work. Do not run it during verification
that requires no jobs to start or resume.

## Deployment scope

The watchdog is not installed as a daemon or added to container images. Production
and local Compose services retain ordinary restart policies and gain processor
and Studio health checks. Those health checks report readiness; they do not
restart a healthy process because one request failed.

Explicit `--allow-job-resume` recovery supports recognized local Docker Desktop
endpoints or rootful native Linux Docker through
`systemctl --no-ask-password restart docker.service`. It may restart every eligible
container on that engine, so it requires the explicit flag. Remote contexts,
unrecognized runtimes, and rootless Docker are refused. The stricter `--no-jobs`
recovery path currently supports macOS Desktop only and fails closed elsewhere.
No command prunes images, removes volumes, or deletes generated media.
