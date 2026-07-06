# Docker Cleanup

Cron container for deleting stale internal `assets_v2` media transformations.

The cleanup is intentionally scoped to transient frame/cache paths:

- `video/frames/<sessionId>`
- `ai_video/frames/<sessionId>`
- `video/narrator_avatar/frames/<sessionId>`
- `video/narrator_avatar/joined_frames/<sessionId>`
- old media files in `ai_video/temp`

It does not clean final renders, API generated resources, generated music, user resources, outro assets, or AI video generation outputs.

## Environment

- `SAMSAR_ASSETS_V2_ROOT`: defaults to `/assets_v2`
- `CLEANUP_MIN_AGE_HOURS`: defaults to `24`
- `CLEANUP_CRON_SCHEDULE`: defaults to `17 3 * * *`
- `CLEANUP_ON_START`: defaults to `true`
- `CLEANUP_DRY_RUN`: defaults to `false`
- `CLEANUP_TARGETS`: optional comma-separated list of supported target ids or paths

Run once locally:

```sh
SAMSAR_ASSETS_V2_ROOT=/path/to/assets_v2 npm run cleanup
```

Run tests:

```sh
npm test
```
