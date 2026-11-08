import fs from 'node:fs';
import path from 'node:path';

export const JOB_CONSUMER_SERVICES = Object.freeze([
  'processor', 'generator', 'audio-generator', 'frames-processor',
  'video-generator', 'ai-video-layer-generator', 'express-video-listener',
  'assistant-query-processor', 'task-processor', 'docker-cleanup', 'genblaze',
]);

const idleNode = "console.info('Samsar maintenance: job processing is disabled.'); setInterval(() => {}, 60000);";

export function getJobsDisabledOverride() {
  const services = {};
  for (const service of JOB_CONSUMER_SERVICES) {
    services[service] = service === 'processor'
      ? { environment: { SAMSAR_BACKGROUND_JOBS_ENABLED: 'false' }, restart: 'no' }
      : {
          entrypoint: service === 'genblaze'
            ? ['python', '-c', "import time; print('Samsar maintenance: job processing is disabled.', flush=True); time.sleep(2147483647)"]
            : ['node', '-e', idleNode],
          command: [],
          environment: { SAMSAR_BACKGROUND_JOBS_ENABLED: 'false' },
          restart: 'no',
          healthcheck: { disable: true },
        };
  }
  return { 'x-samsar-jobs-disabled': true, services };
}

export function jobsDisabledOverridePath(root) {
  return path.join(root, 'runtime', 'config', 'compose.jobs-disabled.json');
}

export function writeJobsDisabledOverride(root) {
  const file = jobsDisabledOverridePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(getJobsDisabledOverride(), null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, file);
  return file;
}

// Maintenance remains active across ordinary updates. Resuming queue consumers
// requires an explicit operator action rather than merely omitting --no-jobs.
export function resolveJobsDisabledOverride(root, { noJobs = false, enableJobs = false } = {}) {
  if (noJobs && enableJobs) throw new Error('--no-jobs and --enable-jobs are mutually exclusive.');
  const file = jobsDisabledOverridePath(root);
  if (enableJobs) {
    fs.rmSync(file, { force: true });
    return null;
  }
  if (noJobs) return writeJobsDisabledOverride(root);
  if (!fs.existsSync(file)) return null;
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
    throw new Error('The saved jobs-disabled override is unreadable; refusing to enable jobs.');
  }
  if (JSON.stringify(saved) !== JSON.stringify(getJobsDisabledOverride())) {
    throw new Error('The saved jobs-disabled override is invalid; regenerate it with --no-jobs.');
  }
  return file;
}
