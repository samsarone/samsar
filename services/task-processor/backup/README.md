# Samsar production backup runtime

This directory builds a separate backup container. It does not run inside the
Node task-processor loop and is intentionally inert unless
`BACKUP_ENABLED=true` **and** `SAMSAR_DEPLOYMENT_EDITION=production`.

Each successful run:

1. takes a logical `mongodump` archive of every MongoDB database;
2. takes a `--single-transaction` dump of the configured Ghost MySQL database;
3. uses SQLite's online backup API and runs `PRAGMA quick_check` on the copy;
4. creates a restic snapshot containing those dumps plus the read-only Ghost
   content, media, MinIO, persistent, and license volumes;
5. applies daily/weekly/monthly retention, pruning repository data only on the
   configured UTC weekday; and
6. runs `restic check` before recording the snapshot as the last success.

Restic encrypts data and metadata client-side before upload. Database credential
files are staged separately from the snapshot payload and removed at the end of
the run. Source volumes are rejected unless the container sees them as
read-only, and a `flock` lock prevents scheduled and manual runs from overlapping.

## Image and commands

Build from the task-processor repository root so the Dockerfile can copy only
the backup scripts:

```sh
docker build -f backup/Dockerfile -t samsar-backup .
```

The entrypoint exposes these commands:

| Command | Behavior |
| --- | --- |
| `schedule` | Default daily UTC scheduler; catches up a missed run after restart and retries failures. |
| `run-once` | Performs one backup immediately; always enforces enabled + production gates. |
| `check` | Loads file credentials and runs a repository metadata check. |
| `snapshots` | Loads file credentials and lists repository snapshots. |
| `status` | Prints the persisted scheduler/run/success state and current health result. |
| `health` | Runs the container health check directly. |

`check` and `snapshots` deliberately accept no extra arguments so callers cannot
override password or repository settings. When `BACKUP_ENABLED` is not exactly
`true`, `schedule` remains alive in an explicit disabled state and `health`
returns `ok status=disabled`; `run-once`, `check`, and `snapshots` still fail.
Setting `BACKUP_ENABLED=true` in any non-production edition always fails closed.

## Required configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `BACKUP_ENABLED` | none | Must be exactly `true` to schedule or run backups. |
| `SAMSAR_DEPLOYMENT_EDITION` | none | Must be exactly `production` whenever backup is enabled. |
| `RESTIC_REPOSITORY` | none | Must be an `s3:` repository without embedded credentials, for example `s3:s3.amazonaws.com/samsar-backup/production`. |
| `RESTIC_PASSWORD_FILE` | none | Required readable, non-empty secret file. Direct `RESTIC_PASSWORD` and `RESTIC_PASSWORD_COMMAND` are rejected. Keep this permanently; snapshots cannot be decrypted without it. |
| `AWS_ACCESS_KEY_ID_FILE` | none | Preferred access-key secret file. Direct `AWS_ACCESS_KEY_ID` is supported, but direct + file conflicts fail. |
| `AWS_SECRET_ACCESS_KEY_FILE` | none | Preferred secret-key file. Direct `AWS_SECRET_ACCESS_KEY` is supported, but direct + file conflicts fail. |
| `BACKUP_MONGODB_URI` / `BACKUP_MONGODB_URI_FILE` | none | Exactly one is required. Prefer the file form for a credential-bearing URI. The URI must leave the database path empty so every database is dumped. |
| `BACKUP_MYSQL_PASSWORD` | none | Ghost database password. `BACKUP_MYSQL_PASSWORD_FILE` is an alternative; setting both fails. |

An optional session credential can use `AWS_SESSION_TOKEN_FILE` or
`AWS_SESSION_TOKEN`, with the same direct-vs-file conflict rule. MongoDB has no
implicit connection fallback: set exactly one of `BACKUP_MONGODB_URI` and
`BACKUP_MONGODB_URI_FILE`. Its URI must have an empty database path so
`mongodump` includes every database.

Suggested Docker secret paths are:

```text
/run/secrets/restic-password
/run/secrets/aws-access-key-id
/run/secrets/aws-secret-access-key
/run/secrets/mongodb-backup-uri
```

Do not bake these files into the image or put them below `/backup-data`.

## Runtime settings

| Variable | Default | Purpose |
| --- | --- | --- |
| `BACKUP_SCHEDULE_UTC` | `02:00` | Zero-padded daily UTC `HH:MM`. |
| `BACKUP_RETRY_MINUTES` | `30` | Delay after a failed scheduled attempt. |
| `BACKUP_MYSQL_HOST` | `blog-db` | Ghost MySQL service. |
| `BACKUP_MYSQL_PORT` | `3306` | Ghost MySQL port. |
| `BACKUP_MYSQL_USER` | `samsar_blog` | Least-privilege Ghost application user. |
| `BACKUP_MYSQL_DATABASE` | `samsar_blog` | The one database passed to `mysqldump --databases`. |
| `BACKUP_RETENTION_DAILY` | `14` | Daily snapshots retained. |
| `BACKUP_RETENTION_WEEKLY` | `8` | Weekly snapshots retained. |
| `BACKUP_RETENTION_MONTHLY` | `12` | Monthly snapshots retained. |
| `BACKUP_PRUNE_WEEKDAY_UTC` | `7` | Restic prune weekday, Monday `1` through Sunday `7`. Retention still runs daily. |
| `BACKUP_RESTIC_HOST` | `samsar-production` | Restic host grouping. |
| `BACKUP_RESTIC_TAG` | `samsar-production` | Restic retention selector. |
| `BACKUP_MONGODB_USE_OPLOG` | `false` | Enable only for a Mongo replica set that supports `mongodump --oplog`. |
| `BACKUP_HEALTH_MAX_SUCCESS_AGE_HOURS` | `36` | Maximum age of the most recent verified snapshot. |
| `BACKUP_HEALTH_INITIAL_SUCCESS_GRACE_HOURS` | `26` | Bounded new-scheduler grace before its first success; a failed first attempt bypasses the grace and is unhealthy. |
| `BACKUP_HEALTH_MAX_RUN_HOURS` | `12` | Maximum age of a scheduler's running state. |

The MySQL dump explicitly requires TLS with `--ssl`, but passes
`--skip-ssl-verify-server-cert` because the production database uses an
internal self-signed certificate. The database is reached only over the private
Compose network; TLS itself is never disabled. A trusted internal CA should
replace this verification exception if one becomes available.

The writable `/backup-state` volume holds Restic cache and pack scratch data,
temporary logical dumps, the concurrency lock, and status. It must have enough
free space for one compressed Mongo dump, one compressed MySQL dump, one SQLite
copy, and Restic's concurrent temporary packs.
Retention explicitly groups snapshots by host and tag rather than source path,
because each logical-dump staging directory has a unique run ID.
Before each snapshot, the dedicated single-writer repository removes all stale
Restic locks so a container replacement cannot block the next daily run. The
configured weekly maintenance day runs an explicit prune even when retention
does not remove a snapshot, reclaiming orphan packs from interrupted uploads.

## Required mounts

All application data mounts must use `:ro`. Only `/backup-state` is writable.

| Container path | Snapshot content |
| --- | --- |
| `/backup-data/blog-content` | Ghost content and uploaded blog assets |
| `/backup-data/media-assets` | Legacy production media |
| `/backup-data/media-assets-v2` | Current production media |
| `/backup-data/minio-data` | Private MinIO object data |
| `/backup-data/persistent-data` | Persistent application state |
| `/backup-data/license-data` | License state |
| `/backup-data/blog-analytics` | Source for the consistent `analytics.sqlite` copy; the live SQLite files themselves are not passed to restic |
| `/backup-state` | Writable backup state and staging volume |

The raw Mongo and MySQL volumes must **not** be mounted. Their logical dumps are
the restore artifacts. The MinIO and filesystem snapshots are read-only scans of
live volumes; applications may continue writing while restic reads them.

## Initial backup and operations

After starting the scheduler container, create and verify the initial snapshot:

```sh
docker compose run --rm --no-deps backup run-once
docker compose exec backup status
docker compose exec backup snapshots
docker compose exec backup check
```

Successful state is written atomically beneath `/backup-state/status`:

- `scheduler-status.json` contains scheduler start, heartbeat, and next-attempt epochs;
- `run-status.json` contains the current or most recent run result; and
- `last-success.json` contains the verified snapshot ID and completion time.

Health is green during the bounded first-run grace, becomes unhealthy immediately
when the initial attempt fails, and later becomes unhealthy when the last success
is stale or the scheduler is overdue. Health does not contact S3 on every probe.

To restore, use the same repository and password file in an isolated recovery
environment. Restore the snapshot to a new directory, validate
`MANIFEST.sha256`, then feed `mongodb-all.archive.gz` to `mongorestore --archive
--gzip`, feed `mysql-ghost.sql.gz` to the MySQL client, and replace analytics using
the backed-up SQLite file. Never restore directly over running production data.

## Private S3 bucket permissions

Create the bucket outside this container. Block all public access, enable default
server-side encryption in addition to restic's client-side encryption, and
consider versioning plus lifecycle cleanup for non-current versions. A dedicated
IAM principal should be scoped to only the backup bucket/prefix. Restic retention
and prune need object deletion; the principal does not need bucket creation or
permissions for other buckets.

For a bucket dedicated entirely to this repository, the policy actions are
typically limited to:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": "arn:aws:s3:::samsar-backup"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": "arn:aws:s3:::samsar-backup/*"
    }
  ]
}
```

Adjust both resources when a repository prefix or different bucket name is used.
