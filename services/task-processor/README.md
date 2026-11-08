# Scheduled maintenance

Hosted and standalone containers run completed-session frame cleanup immediately,
then every five minutes, retrying failed passes after one minute. Full maintenance
runs immediately, then every three hours, retrying failures after five minutes.
One dispatcher serializes both schedules so maintenance passes cannot overlap.
Native installations run once
per invocation so the host's existing cron schedule controls repetition.
`TASK_PROCESSOR_INTERVAL_HOURS` and `TASK_PROCESSOR_RETRY_MINUTES` override the
container schedule. Run native maintenance with `bash run_task.sh`; it loads the
service's `.env` and works from any working directory.

Container media roots default to `/assets` and `/assets_v2`. Native source
installs use the sibling `samsar_processor` directory; generated monorepos use
the sibling `processor` service. `SAMSAR_ASSETS_ROOT` and
`SAMSAR_ASSETS_V2_ROOT` override these paths. A missing `assets_v2` root fails
the run so an incorrect mount does not silently disable maintenance.

`STALE_SESSION_FRAME_CLEANUP_HOURS` defaults to `24` for native cron session frames and
`INTERMEDIATE_MEDIA_CLEANUP_HOURS` defaults to `48` for media in both
`/assets_v2/ai_video/temp` and the legacy `/assets/ai_video/temp`.
Explicit stage settings override those defaults. The legacy
`CLEANUP_MIN_AGE_HOURS` setting retains its `168`-hour fallback for other
cleanup stages; it does not override these two stage defaults. Invalid stage
retention values fail the affected cleanup stage.

Temporary-media cleanup removes old media only in those two temp directories.
It refuses symlinked cleanup roots and skips symlinked entries.
Final renders, generated resources and user resources remain protected. Containers
disable generation side effects by default; native cron retains the existing
generation behavior. See `TASK_PROCESSOR_ENABLE_FILE_CLEANUP` and
`TASK_PROCESSOR_ENABLE_GENERATION_SIDE_EFFECTS` for explicit overrides.

Native legacy frame cleanup selects sessions by `updatedAt`, then deletes an individual frame
directory only when that directory and every nested file and directory are
older than the frame retention period. A recent frame preserves its whole
session directory.

Container frame cleanup (including the three-hour sweep) uses the completed-session
policy instead: a session must have completed overall/video status, no pending
session/layer/branch/global-frame work, no frame/video/audio/AI queue entries, and
a nonempty final video in its local output directory. It rechecks database state,
final output, directory identity and the cache tree before removal. Unknown state,
database outages, changed trees and unsafe filesystem entries preserve caches.
It never sets regeneration flags or deletes final output, images or audio.

The five cache roots are `video/frames`, `ai_video/frames`, `global_videos/frames`,
`video/narrator_avatar/frames` and `video/narrator_avatar/joined_frames`, in both
media roots. Normal cleanup waits fifteen minutes after the newest session or
filesystem activity (`COMPLETED_SESSION_FRAME_CLEANUP_MINUTES`). At 80% filesystem
usage or less than 32 GiB available to applications, it may reclaim recently
completed sessions oldest-first until usage is below 75% and available space is
at least 64 GiB. Active and incomplete sessions remain protected under pressure.

Controls: `FRAME_CLEANUP_ENABLED`, `FRAME_CLEANUP_DRY_RUN`,
`FRAME_CLEANUP_INTERVAL_MINUTES`, `FRAME_CLEANUP_RETRY_MINUTES`,
`FRAME_CLEANUP_PRESSURE_USED_PERCENT`, `FRAME_CLEANUP_PRESSURE_AVAILABLE_GIB`,
`FRAME_CLEANUP_TARGET_USED_PERCENT` and `FRAME_CLEANUP_TARGET_AVAILABLE_GIB`.
Dry runs report candidates without removing files. Invalid settings fail closed.
MongoDB connections are awaited, bounded and retried after an outage; failure to
append a cron log does not prevent the runner from reporting through stdout/stderr.

Maintenance reports successes and failures to stdout/stderr as well as the
existing cron log files. Run the regression tests with `npm test`.
