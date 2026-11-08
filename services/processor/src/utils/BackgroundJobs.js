const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

export function backgroundJobsEnabled(env = process.env) {
  const raw = env.SAMSAR_BACKGROUND_JOBS_ENABLED;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  const value = String(raw).trim().toLowerCase();
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  throw new Error('SAMSAR_BACKGROUND_JOBS_ENABLED must be a boolean value.');
}

// The disabled mode is an explicit maintenance boundary: do not even import
// recovery modules, since their initialization may otherwise acquire work.
export async function startProcessorBackgroundJobs({
  env = process.env,
  loadStarters,
  logger = console,
} = {}) {
  if (!backgroundJobsEnabled(env)) {
    logger.info?.('Processor maintenance mode: background job processing is disabled.');
    return () => {};
  }
  const starters = await loadStarters();
  const stops = [];
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const cleanup of [...stops].reverse()) cleanup();
  };
  try {
    for (const starter of starters) {
      const cleanup = starter();
      if (typeof cleanup === 'function') stops.push(cleanup);
    }
  } catch (error) {
    stop();
    throw error;
  }
  return stop;
}

const HEALTH_PATHS = new Set([
  '/v1/health/live', '/v1/health', '/v1/chat/health', '/v1/image/health', '/v1/video/health',
  '/v2/health', '/api/v2/health',
]);

export function processorMaintenanceMiddleware({ env = process.env } = {}) {
  return (req, res, next) => {
    if (backgroundJobsEnabled(env)) return next();
    const path = req.path || String(req.url || '').split('?')[0];
    if (['GET', 'HEAD'].includes(req.method) && HEALTH_PATHS.has(path)) return next();
    res.setHeader('Retry-After', '60');
    return res.status(503).json({
      error: 'This deployment is in maintenance mode. Job processing is disabled.',
      code: 'SAMSAR_MAINTENANCE_MODE',
    });
  };
}
