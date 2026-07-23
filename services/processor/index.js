import './src/config/loadEnv.js';
import cluster from 'cluster';
import { installStructuredLogger } from './src/utils/StructuredLogger.js';
import { resolveProcessorWorkerPlan } from './src/utils/CpuBudget.js';

const PORT = 3002;
const DEFAULT_HTTP_SERVER_TIMEOUT_MS = 11 * 60 * 1000;

function getHttpServerTimeoutMs() {
  const parsed = Number(process.env.SAMSAR_HTTP_SERVER_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_HTTP_SERVER_TIMEOUT_MS;
}

installStructuredLogger({
  serviceName: process.env.SERVICE_NAME || 'samsar_processor',
  component: cluster.isPrimary ? 'cluster_primary' : 'cluster_worker',
});

if (cluster.isPrimary) {
  const workerPlan = resolveProcessorWorkerPlan();
  const workerCpuBudgets = new Map();
  const forkWorker = (cpuBudget) => {
    // This value is a ceiling for CPU-bound child tools, not a core reservation.
    // Idle workers remain idle and do not hold a persistent CPU thread pool.
    const worker = cluster.fork({
      ...process.env,
      // Keep the operator's total process limit intact while assigning this
      // worker its fair share. The separate key also survives dotenv override
      // behavior when a local .env file contains SAMSAR_PROCESS_CPU_LIMIT.
      SAMSAR_PROCESS_CPU_BUDGET: String(cpuBudget),
    });
    workerCpuBudgets.set(worker.id, cpuBudget);
    return worker;
  };

  console.info('samsar_processor CPU worker plan', workerPlan);
  workerPlan.workerCpuBudgets.forEach(forkWorker);

  cluster.on('exit', (worker, code, signal) => {
    const workerCpuBudget = workerCpuBudgets.get(worker?.id)
      || workerPlan.workerCpuBudgets[0]
      || 1;
    workerCpuBudgets.delete(worker?.id);
    console.error('samsar_processor worker exited; restarting', {
      workerId: worker?.id || null,
      pid: worker?.process?.pid || null,
      code,
      signal,
      cpuBudget: workerCpuBudget,
    });
    forkWorker(workerCpuBudget);
  });
} else {
  const {
    configureProcessorSharpConcurrency,
  } = await import('./src/utils/SharpResources.js');
  const sharpThreadLimit = configureProcessorSharpConcurrency();
  console.info('samsar_processor Sharp worker ceiling', {
    workerId: cluster.worker?.id || null,
    threadLimit: sharpThreadLimit,
  });

  // Keep the cluster primary lightweight, and configure native CPU ceilings
  // before app startup can initiate font-sample or request-time image work.
  const { default: app } = await import('./app.js');
  const [
    { startPersistedTextToVideoBuilderRecovery },
    { startCreateSingleNarrativeRequestRecovery },
    { startCreateBranchingNarrativeRequestRecovery },
    { startTextToInteractiveVideoRecovery },
  ] = await Promise.all([
    import('./src/models/api/MovieAPI.js'),
    import('./src/models/api/NarrativeAPI.js'),
    import('./src/models/api/BranchingNarrativeAPI.js'),
    import('./src/models/api/TextToInteractiveVideoAPI.js'),
  ]);

  const server = app.listen(PORT, '0.0.0.0');
  const stopBuilderRecovery = startPersistedTextToVideoBuilderRecovery();
  const stopNarrativeRecovery = startCreateSingleNarrativeRequestRecovery();
  const stopBranchingNarrativeRecovery = startCreateBranchingNarrativeRequestRecovery();
  const stopInteractiveVideoRecovery = startTextToInteractiveVideoRecovery();
  const timeoutMs = getHttpServerTimeoutMs();
  server.timeout = timeoutMs;
  server.requestTimeout = timeoutMs;
  server.headersTimeout = timeoutMs + 5000;
  server.on('error', (error) => {
    console.error('samsar_processor HTTP server failed', error);
  });
  server.on('close', stopBuilderRecovery);
  server.on('close', stopNarrativeRecovery);
  server.on('close', stopBranchingNarrativeRecovery);
  server.on('close', stopInteractiveVideoRecovery);
}
