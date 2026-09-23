# Source security hardening — 22 September 2026

This batch updates eight source projects for the next monorepo sync. It does not
sync, deploy, change the monorepo, change Docker configuration, or migrate data.
Existing working-tree edits were preserved against a snapshot taken before this
batch. The installation score has not been reassessed; deployed installations
retain their existing behavior until these source changes are synced and rebuilt.

## Implemented

| Area | Result | Source projects |
| --- | --- | --- |
| Legacy identity verification | `/users/verify` returns HTTP 410. A supplied profile or FID cannot create an account, set privileged fields, or obtain an authentication token. Current email and Google sign-in remain available according to deployment policy. | processor |
| Password recovery | Responses contain a generic message instead of a user document, password hash, or reset code. Valid requests for unknown accounts receive the same success message. Reset codes require an expiration and are consumed atomically, including concurrent submissions and replacement by a newer reset request. Email normalization is consistent. | processor |
| Password correctness and cost | New registration preserves the supplied password's whitespace. Updating a password no longer performs an unused hash of the old password. Malformed credential types and blank new passwords are rejected. | processor |
| Public profile privacy | The public profile endpoint returns only FID, username, display name, profile image URL, and biography. It no longer returns account, billing, administrator, or adapter metadata. | processor |
| Studio access control | Generation/edit/mask polling, frame details, audio uploads, mask generation, and three legacy frame mutation routes now enforce account/session access. Image references must belong to the authorized parent. Owner access, imported editors, and valid editable shares retain access; revoked shares fail. Authorization binds to the actual target when multiple ID aliases are supplied. | processor |
| Segmentation authentication | Segmentation requires authentication. The client now supplies authentication for segmentation and mask polling. | processor, client |
| Public media validation | Shared network checks reject the full IPv4 loopback range, mapped IPv6 private addresses, IPv6 link-local ranges, and additional non-public ranges. Public IPv4/IPv6 media addresses remain allowed. These checks apply to the existing external-video URL validation paths. | processor |
| Worker concurrency | Assistant and final-video workers atomically claim an unlocked job. A worker that loses the claim skips it. The video worker uses the current claimed document rather than the earlier queue snapshot. | assistant-query-processor, video-generator |
| Log redaction | Existing structured loggers redact credential fields, bearer credentials, URL userinfo, sensitive query parameters, and JSON-encoded provider bodies. Preformatted structured logs also pass through redaction. Nested error causes are bounded. | processor, audio-generator, video-generator, frames-processor, express-video-listener |
| Video result usability | Completed ad-video polling uses the returned video link instead of stale component state, preserving absolute URLs and normalizing relative URLs. | client |
| Dependency advisories | Sharp 0.35.4, Nodemailer 9.1.1, qs 6.16.0, and client YAML 2.8.3 replace the affected versions. Unrelated packages and the client's YAML 1.x override are retained. | processor, generator, video-generator, audio-generator, express-video-listener, client |

## Verification

The final relevant test groups passed with no failures:

| Group | Passing tests | Runtime |
| --- | ---: | --- |
| Processor authentication, ownership, media delivery, external video, environment, and utilities | 188 | Node 24.21.0 |
| Client existing regression suite | 168 | Node 24.21.0 |
| Video worker claim, media/audio utilities, logging, and database configuration | 58 | Node 22.18.0 |
| Assistant worker claim and existing deployment/provider checks | 15 | Node 24.21.0 |
| Audio, frames, and express-video logger checks | 15 | Node 22.18.0 |
| **Total** | **444** | |

- Processor tests included owner/collaborator success and cross-account denial,
  legacy referenced frames, mounted audio writes, private route rejection,
  reset-code replay/concurrency/replacement, and existing Docker-local versus
  external-S3 media behavior. Persistence/provider boundaries were mocked for the
  new authorization and concurrency tests; they do not constitute a live MongoDB
  or provider integration test.
- All modified JavaScript files passed syntax checks; source repositories passed
  whitespace checks.
- All five updated backend lockfiles passed `npm ci --dry-run --ignore-scripts`.
  Their full npm dependency audits each reported zero known vulnerabilities at
  verification time. The updated client lockfile's bulk advisory lookup returned
  no matches and its frozen Yarn installation succeeded.
- Standalone and production Docker-edition client builds passed using a fresh
  installation from the updated Yarn lockfile in a temporary directory.
- Isolated patched-package smoke checks passed for Sharp PNG/JPEG/WebP processing,
  Nodemailer MIME composition, qs parsing/prototype protection, and YAML parsing.
  Existing source `node_modules` installations were not replaced.
- Monorepo tracked/pre-existing untracked files matched the pre-change snapshot.
  No source Dockerfile or deployment configuration was changed by this batch.

Docker was not running on the review machine. Linux container builds/startup,
real database concurrency, outbound provider calls, SMTP delivery, and complete
browser editing workflows have not been validated here. These checks remain
necessary in staging after the next coordinated source sync.

## Intentional behavior changes and remaining work

Clients using the unauthenticated legacy profile sign-in must migrate to a
verified sign-in flow. Public profiles intentionally omit private fields.
Private polling and segmentation now require credentials; the current source
client includes the corresponding headers. Previously issued authentication
tokens are not revoked by this patch. Reset codes lacking an expiration must be
replaced by requesting a new reset email.

The following larger findings remain outside this bounded patch:

- Connection-time DNS pinning and a comprehensive outbound download policy,
  including audio duplication, redirect/size limits, and explicitly trusted
  Docker-local media origins. IP classification alone does not eliminate SSRF.
- Purpose-specific hashed reset tokens, session revocation, authentication rate
  limits, and a coordinated cookie/session migration.
- Durable worker leases, heartbeats and fencing, atomic/idempotent billing across
  different jobs, and audio supervisor recovery. Atomic pickup does not prevent
  a long-running job being reclaimed under the existing stale-lock policy.
- Monorepo-owned setup-wizard dependencies, container resource/network controls,
  cleanup retention policy, and paginated library queries.
- Dialog accessibility needs coordinated testing with dropdowns that render
  outside the dialog. A generic modal replacement was excluded because it could
  block those controls. Broader polling and browser accessibility work remains.

The next deployment validation should cover email login/reset, Google sign-in
where enabled, standalone admin access, private and shared studio editing,
image/edit/mask polling, audio attachment, final-video rendering with two workers,
and both mounted-media and external-S3 playback. Re-score the resulting
installation only after sync, rebuild, and those deployment checks.
