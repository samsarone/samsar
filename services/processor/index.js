import cluster from 'cluster';
import app from './app.js';
import { installStructuredLogger } from './src/utils/StructuredLogger.js';

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
  const numCPUs = 2;

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.error('samsar_processor worker exited; restarting', {
      workerId: worker?.id || null,
      pid: worker?.process?.pid || null,
      code,
      signal,
    });
    cluster.fork();
  });
} else {
  const server = app.listen(PORT, '0.0.0.0');
  const timeoutMs = getHttpServerTimeoutMs();
  server.timeout = timeoutMs;
  server.requestTimeout = timeoutMs;
  server.headersTimeout = timeoutMs + 5000;
  server.on('error', (error) => {
    console.error('samsar_processor HTTP server failed', error);
  });
}
