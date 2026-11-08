import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { backgroundJobsEnabled, startProcessorBackgroundJobs, processorMaintenanceMiddleware } from './BackgroundJobs.js';

test('normal local and production startup remains enabled unless explicitly disabled', () => {
  assert.equal(backgroundJobsEnabled({}), true);
  assert.equal(backgroundJobsEnabled({ SAMSAR_DEPLOYMENT_EDITION: 'production' }), true);
  for (const value of ['true', '1', 'yes', 'ON']) assert.equal(backgroundJobsEnabled({ SAMSAR_BACKGROUND_JOBS_ENABLED: value }), true);
  for (const value of ['false', '0', 'no', 'OFF']) assert.equal(backgroundJobsEnabled({ SAMSAR_BACKGROUND_JOBS_ENABLED: value }), false);
  assert.throws(() => backgroundJobsEnabled({ SAMSAR_BACKGROUND_JOBS_ENABLED: 'maybe' }), /boolean/);
});

test('maintenance startup neither loads recovery modules nor claims or resumes any work', async () => {
  let imports = 0;
  const stop = await startProcessorBackgroundJobs({
    env: { SAMSAR_BACKGROUND_JOBS_ENABLED: 'false' },
    loadStarters: async () => { imports++; throw new Error('must never load'); },
    logger: { info() {} },
  });
  stop(); stop();
  assert.equal(imports, 0);
});

test('enabled startup starts each existing recovery once and cleans it up once', async () => {
  const events = [];
  const stop = await startProcessorBackgroundJobs({ env: {}, loadStarters: async () => [
    () => { events.push('start builder'); return () => events.push('stop builder'); },
    () => { events.push('start refund'); return () => events.push('stop refund'); },
  ] });
  assert.deepEqual(events, ['start builder', 'start refund']);
  stop(); stop();
  assert.deepEqual(events, ['start builder', 'start refund', 'stop refund', 'stop builder']);
});

test('a startup failure releases any recoveries already started', async () => {
  let stopped = 0;
  await assert.rejects(startProcessorBackgroundJobs({ env: {}, loadStarters: async () => [
    () => () => { stopped++; },
    () => { throw new Error('recovery start failed'); },
  ] }), /recovery start failed/);
  assert.equal(stopped, 1);
});

async function serve(t, env) {
  const app = express();
  const calls = { jobs: 0, reads: 0 };
  app.use(processorMaintenanceMiddleware({ env }));
  app.get('/v2/health', (_req, res) => res.json({ status: 'ok' }));
  app.post('/start-job', (_req, res) => { calls.jobs++; res.json({ accepted: true }); });
  app.get('/legacy-start-job', (_req, res) => { calls.jobs++; res.json({ accepted: true }); });
  app.get('/session', (_req, res) => { calls.reads++; res.json({ id: 'session' }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, calls };
}

test('maintenance HTTP stays live while rejecting job routes, webhooks and legacy GET side effects', async t => {
  const { url, calls } = await serve(t, { SAMSAR_BACKGROUND_JOBS_ENABLED: 'false' });
  assert.equal((await fetch(`${url}/v2/health`)).status, 200);
  for (const [path, method] of [['/start-job', 'POST'], ['/legacy-start-job', 'GET'], ['/webhooks/provider', 'POST'], ['/session', 'GET']]) {
    const response = await fetch(url + path, { method });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal((await response.json()).code, 'SAMSAR_MAINTENANCE_MODE');
  }
  assert.deepEqual(calls, { jobs: 0, reads: 0 });
});

test('ordinary enabled HTTP requests retain existing routing', async t => {
  const { url, calls } = await serve(t, {});
  assert.equal((await fetch(`${url}/start-job`, { method: 'POST' })).status, 200);
  assert.equal((await fetch(`${url}/session`)).status, 200);
  assert.deepEqual(calls, { jobs: 1, reads: 1 });
});
