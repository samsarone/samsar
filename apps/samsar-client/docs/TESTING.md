# Client regression tests

Use the client's committed `yarn.lock` with Yarn 1.22.22. CI uses Node 24.
No production API, credentials, paid generation, or running backend is needed.
The new Vitest configs do not load local `.env` files.

```sh
yarn install --frozen-lockfile
yarn test:browser:install
yarn test:ci
```

On Linux CI, install browser system dependencies with
`yarn playwright install --with-deps chromium`.

## Commands

| Command | Scope |
| --- | --- |
| `yarn test` | Existing Node tests plus Vitest unit/hook tests |
| `yarn test:node` | All `src/**/*.test.mjs` files, recursively |
| `yarn test:unit` | React hook/context and error-boundary tests in jsdom |
| `yarn test:watch` | Unit tests in watch mode |
| `yarn test:browser` | Headless Chromium component tests through Vitest/Playwright |
| `yarn test:browser:watch` | Browser tests interactively with a visible browser |
| `yarn test:ci` | Node, unit, and browser suites; fails on any failing suite |
| `yarn test:sync` | The same complete gate for sync callers |

The existing Node suites keep their runner and assertions. New Vitest tests live
under `test/unit` and `test/browser`, so neither runner discovers the other's
files. Empty Vitest suites fail rather than silently passing. CI rejects `.only`.

## Initial protection

- Canvas history: undo/redo, divergent edits, duplicate saves, mutation isolation,
  retained-history limits, refreshes, and switching scenes.
- Authentication: signed-out/login-token bootstrap, successful profiles,
  invalid-token cleanup, transient failures, logout with requests in flight, and
  out-of-order profile responses.
- Error recovery: healthy rendering, delayed startup errors, immediate later
  errors, and timer cleanup on unmount.
- Chromium: real render/cancel buttons, pending-save restrictions, render versus
  download state, guest controls, the publish dropdown, and keyboard operation of
  the inference-effort select.

Browser tests exercise real components and browser events with controlled user
context. They do not verify a full editor, backend generation, downloaded media,
canvas accuracy, or audiovisual synchronization. Add those as separate browser
or end-to-end scenarios; do not infer full application coverage from these tests.

## GitHub Actions

`.github/workflows/client-tests.yml` runs on source-repository pushes, pull
requests, and manual dispatches. It installs frozen dependencies, runs all three
suites, builds the production client, and uploads Vitest JUnit results and browser
failure screenshots. It uses read-only repository permissions and no secrets.

### Samsar monorepo activation

The source-owned template is `docs/ci/monorepo-client-tests.yml`. After syncing,
copy that file to the **monorepo root** as
`.github/workflows/client-tests.yml`, then commit it there. The template detects
`apps/samsar-client` and uses that client's lockfile without installing other
workspaces. It is an additional client job; keep the existing deployment CI.

GitHub does not execute the workflow copied into
`apps/samsar-client/.github/workflows`. The monorepo-root installation is required
and has deliberately not been performed by this source-only change.

### Sync activation

After dependencies and Chromium are installed, the source sync caller should run
this before copying or promoting projects, propagating any nonzero exit code:

```sh
npm --prefix "$SOURCE_ROOT/samsar_client" run test:sync
```

The command is ready for sync integration. This change does not modify external
sync scripts, trigger synchronization, commit, push, or enable branch protection.
Require the `Node, Vitest and Chromium regressions` check in repository settings
if merges must be blocked on these tests.

## Adding tests

Use `test/unit/*.test.jsx` for React state and API behavior with controlled
responses. Use `test/browser/*.test.jsx` for actual browser interactions. Prefer
observable behavior and accessible controls over snapshots or implementation
internals. Keep API responses local, reset storage, and clean up timers/mocks.
JUnit files are written under `test-results` when `CI` is set.
