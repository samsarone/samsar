import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyNetworkOutage, isNetworkOutageError, decideNetworkOutageAction,
  createNetworkOutageCircuit, createDependencyHealthProbe,
} from './NetworkOutagePolicy.js';

const disconnected = () => Object.assign(new Error('Disconnected https://secret.example/?token=private'), { code: 'ECONNRESET' });

test('classifies nested and aggregate transport errors without exposing sensitive details', () => {
  const error = new AggregateError([new Error('wrapped', { cause: disconnected() })]);
  assert.deepEqual(classifyNetworkOutage(error), { kind: 'transport', retryable: true, code: 'ECONNRESET' });
  assert.equal(JSON.stringify(classifyNetworkOutage(error)).includes('private'), false);
  error.cause = error;
  assert.equal(isNetworkOutageError(error), true);
  const cycle = new Error('url https://secret.example'); cycle.cause = cycle;
  assert.equal(isNetworkOutageError(cycle), false);
});

test('provider terminal responses remain distinct from transient HTTP and transport outages', () => {
  assert.deepEqual(classifyNetworkOutage({ response: { status: 403 } }), { kind: 'provider_terminal', retryable: false, code: 'PROVIDER_HTTP_TERMINAL', status: 403 });
  for (const status of [408, 425, 429, 500, 503, 530]) assert.equal(classifyNetworkOutage({ status }).kind, 'transient_http');
  assert.equal(classifyNetworkOutage({ name: 'TimeoutError' }).kind, 'transport');
  assert.equal(classifyNetworkOutage({ code: 'ENETDOWN' }).kind, 'transport');
  assert.equal(classifyNetworkOutage({ code: 'ERR_CANCELED', name: 'CanceledError' }).kind, 'transport');
  assert.equal(decideNetworkOutageAction({ phase: 'poll', error: { code: 'ERR_CANCELED' }, attempt: 1 }).action, 'retry');
  assert.equal(classifyNetworkOutage({ message: 'Connection error in a content prompt' }).kind, 'other');
});

test('an ambiguous attempted submission is never automatically replayed', () => {
  assert.deepEqual(decideNetworkOutageAction({ phase: 'submit', error: disconnected() }), {
    action: 'fail', code: 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN', maySubmit: false, sameRequestRequired: true,
  });
  assert.equal(decideNetworkOutageAction({ phase: 'submit', error: disconnected(), providerRequestId: 'accepted-id' }).action, 'poll');
  assert.equal(decideNetworkOutageAction({ phase: 'submit', error: disconnected(), providerRequestId: {} }).action, 'fail');
  assert.equal(decideNetworkOutageAction({ phase: 'submit', error: new Error('Receipt missing') }).code, 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN');
  assert.equal(decideNetworkOutageAction({ phase: 'submit', error: { status: 403 } }).action, 'terminal');
});

test('safe recovery phases retain original request identity and terminate after a finite budget', () => {
  for (const phase of ['prepare', 'poll', 'result', 'download', 'deliver']) {
    const retry = decideNetworkOutageAction({ phase, error: disconnected(), attempt: 1, maxAttempts: 3 });
    assert.equal(retry.action, 'retry');
    assert.equal(retry.maySubmit, false);
    assert.equal(retry.sameRequestRequired, true);
    assert.equal(decideNetworkOutageAction({ phase, error: disconnected(), attempt: 3, maxAttempts: 3 }).action, 'fail');
  }
  assert.equal(decideNetworkOutageAction({ phase: 'unknown', error: disconnected() }).code, 'PROVIDER_NETWORK_REPLAY_UNSAFE');
  assert.equal(decideNetworkOutageAction({ phase: 'poll', error: { status: 403 } }).action, 'terminal');
});

test('default admission requires no health request or additional configuration', async () => {
  let instant = 0;
  const circuit = createNetworkOutageCircuit({ now: () => instant, cooldownMs: 20, maxFailures: 2 });
  assert.equal((await circuit.gate()).allowed, true);
  circuit.recordFailure(disconnected());
  assert.equal((await circuit.gate()).state, 'cooldown');
  instant = 20;
  assert.equal((await circuit.gate()).allowed, true);
  assert.equal(circuit.snapshot().failures, 1);
  circuit.recordFailure(disconnected());
  assert.equal((await circuit.gate()).state, 'exhausted');
  instant = 40;
  assert.equal((await circuit.gate()).allowed, true);
  circuit.recordSuccess();
  assert.equal(circuit.snapshot().failures, 0);
});

test('provider-specific throttling and terminal responses never open the shared transport circuit', async () => {
  const circuit = createNetworkOutageCircuit();
  for (const status of [403, 429, 503]) circuit.recordFailure({ status });
  assert.equal((await circuit.gate()).allowed, true);
  assert.equal(circuit.snapshot().failures, 0);
});

test('configured health probes are single-flight and respect cooldown before bounded recovery', async () => {
  let instant = 0, calls = 0, resolveProbe;
  const circuit = createNetworkOutageCircuit({ now: () => instant, cooldownMs: 20, probe: async () => {
    calls++;
    return new Promise(resolve => { resolveProbe = resolve; });
  } });
  const first = circuit.gate(), second = circuit.gate();
  await Promise.resolve();
  assert.equal(calls, 1);
  resolveProbe({ ok: false });
  assert.equal((await first).state, 'blocked');
  assert.equal((await second).allowed, false);
  assert.equal((await circuit.gate({ forceProbe: true })).state, 'cooldown');
  assert.equal(calls, 1);
  instant = 20;
  const retry = circuit.gate(); await Promise.resolve();
  resolveProbe({ ok: true });
  assert.equal((await retry).allowed, true);
  assert.equal(calls, 2);
  assert.equal(circuit.snapshot().failures, 0);
});

test('hung dependency probes abort and exhaust without throwing or provider submission', async () => {
  let signal;
  const circuit = createNetworkOutageCircuit({ maxFailures: 1, probeTimeoutMs: 5, probe: async options => {
    signal = options.signal;
    return new Promise(() => {});
  } });
  const result = await circuit.gate();
  assert.equal(result.state, 'exhausted');
  assert.equal(result.allowed, false);
  assert.equal(signal.aborted, true);
  assert.equal(result.code, 'NETWORK_DEPENDENCY_UNAVAILABLE');
});

test('a late probe cannot overwrite a newer confirmed recovery or outage', async () => {
  let finish;
  const circuit = createNetworkOutageCircuit({ probe: () => new Promise(resolve => { finish = resolve; }) });
  const pending = circuit.gate(); await Promise.resolve();
  circuit.recordSuccess();
  finish({ ok: false });
  assert.equal((await pending).allowed, true);
  const next = circuit.gate({ forceProbe: true }); await Promise.resolve();
  circuit.recordFailure(disconnected());
  finish({ ok: true });
  assert.equal((await next).allowed, false);
});

test('optional dependency probes use only the explicitly configured read-only endpoint', async () => {
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    calls++;
    assert.equal(options.method, 'HEAD');
    assert.equal(options.redirect, 'error');
    return { ok: true };
  };
  assert.equal(createDependencyHealthProbe({ env: { PROCESSOR_URL: 'https://unrequested.example', SAMSAR_PUBLIC_MEDIA_BASE_URL: 'https://unrequested.example' }, fetchImpl }), null);
  assert.equal(calls, 0);
  const probe = createDependencyHealthProbe({ env: { SAMSAR_NETWORK_DEPENDENCY_HEALTH_URL: 'http://known-dependency/health' }, fetchImpl });
  assert.deepEqual(await probe(), { ok: true });
  assert.equal(calls, 1);
  const invalid = createDependencyHealthProbe({ env: { SAMSAR_NETWORK_DEPENDENCY_HEALTH_URL: 'file:///secret' }, fetchImpl });
  assert.deepEqual(await invalid(), { ok: false });
  assert.equal(calls, 1);
});


test('a known admission deferral is safe pre-submit waiting and does not amplify circuit failures', () => {
  const error = Object.assign(new Error('Known intake gate blocked'), { code: 'NETWORK_OUTAGE_GATE_BLOCKED', providerRequestSent: false });
  assert.equal(decideNetworkOutageAction({ phase: 'submit', error, attempt: 1 }).action, 'retry');
  assert.equal(decideNetworkOutageAction({ phase: 'submit', error, attempt: 3 }).code, 'PROVIDER_NETWORK_RETRY_EXHAUSTED');
  const circuit = createNetworkOutageCircuit();
  circuit.recordFailure(error);
  assert.equal(circuit.snapshot().failures, 0);
  error.providerRequestSent = true;
  assert.equal(decideNetworkOutageAction({ phase: 'submit', error }).code, 'PROVIDER_SUBMISSION_OUTCOME_UNKNOWN');
});
