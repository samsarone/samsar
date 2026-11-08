import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchAndProcessAudiocraftMusicRequest } from './AudioCraftGenerator.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json' },
});
const reset = () => Object.assign(new Error('mock transport reset'), { code: 'ECONNRESET' });

function fixture(fetchImpl, overrides = {}) {
  const row = { _id: 'job', status: 'INIT', musicGenerationStatus: 'INIT', model: 'AUDIOCRAFT',
    prompt: 'A quiet instrumental', duration: 5, numRetries: 0, ...overrides };
  const completeCalls = [], failures = [], writes = [];
  const Model = { async findOneAndUpdate(filter, update) {
    if (filter.status && row.status !== filter.status || filter.apiRequestId && row.apiRequestId !== filter.apiRequestId) return null;
    Object.assign(row, update.$set || update);
    for (const field of Object.keys(update.$unset || {})) delete row[field];
    writes.push(structuredClone(update));
    return structuredClone(row);
  } };
  const dependencies = { Model, fetchImpl, connect: async () => {}, env: { REPLICATE_API_TOKEN: 'mock-token' },
    complete: async (...args) => completeCalls.push(args), markFailed: async (...args) => failures.push(args) };
  return { row, writes, completeCalls, failures, dependencies,
    run: () => dispatchAndProcessAudiocraftMusicRequest(structuredClone(row), dependencies) };
}

for (const failure of ['503', 'ECONNRESET']) {
  test(`AudioCraft sends exactly one POST after ${failure} and reports ambiguous acceptance`, async () => {
    let posts = 0;
    const f = fixture(async (url, options) => {
      assert.equal(url, 'https://api.replicate.com/v1/predictions');
      assert.equal(options.method, 'POST');
      assert.ok(options.signal instanceof AbortSignal);
      posts++;
      if (failure === 'ECONNRESET') throw reset();
      return json({ detail: 'unavailable' }, 503);
    });
    await assert.rejects(f.run(), { submissionOutcomeUnknown: true });
    assert.equal(posts, 1);
    assert.equal(f.row.status, 'INIT');
    assert.equal(f.writes.length, 0);
  });
}

test('a lost acceptance write does not begin polling or repeat the POST', async () => {
  let requests = 0;
  const f = fixture(async () => { requests++; return json({ id: 'accepted', status: 'starting' }); });
  f.dependencies.Model.findOneAndUpdate = async () => { throw reset(); };
  await assert.rejects(f.run(), { submissionOutcomeUnknown: true });
  assert.equal(requests, 1);
});

test('accepted prediction IDs and output URLs survive poll/download faults without another POST', async () => {
  let posts = 0, polls = 0, downloads = 0;
  const f = fixture(async (url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    if (options.method === 'POST') {
      posts++;
      const body = JSON.parse(options.body);
      assert.equal(body.input.model_version, 'stereo-large');
      assert.equal(body.input.output_format, 'mp3');
      assert.equal(body.input.duration, 5);
      assert.equal(body.version, '671ac645ce5e552cc63a54a2bbff63fcf798043055d2dac5fc9e36a837eedcfb');
      return json({ id: 'accepted', status: 'starting' });
    }
    assert.equal(f.row.apiRequestId, 'accepted', 'identity is saved before any GET');
    if (url.endsWith('/predictions/accepted')) {
      if (++polls === 1) throw reset();
      return json({ id: 'accepted', status: 'succeeded', output: 'https://delivery.example/audio.mp3' });
    }
    assert.equal(url, 'https://delivery.example/audio.mp3');
    assert.equal(f.row.replicateOutputUrl, url, 'output is saved before download');
    if (++downloads === 1) throw reset();
    return new Response(new Uint8Array([1, 2, 3]));
  });
  await f.run();
  assert.equal(f.row.status, 'PENDING');
  await assert.rejects(f.run(), { code: 'ECONNRESET' });
  await assert.rejects(f.run(), { code: 'ECONNRESET' });
  await f.run();
  assert.equal(posts, 1);
  assert.equal(polls, 2);
  assert.equal(downloads, 2);
  assert.equal(f.row.apiRequestId, 'accepted');
  assert.equal(f.completeCalls.length, 1);
  assert.equal(f.completeCalls[0][0].status, 'COMPLETED');
  assert.deepEqual(f.completeCalls[0][1], Buffer.from([1, 2, 3]));
});

test('definitive content failure queues its bounded intentional retry without recursive submission', async () => {
  let posts = 0;
  const f = fixture(async (_url, options) => {
    if (options.method === 'POST') { posts++; return json({ id: 'new-prediction', status: 'starting' }); }
    return json({ id: 'failed-prediction', status: 'failed', error: 'Content rejected' });
  }, { status: 'PENDING', musicGenerationStatus: 'PENDING', apiRequestId: 'failed-prediction', generationId: 'failed-prediction' });
  await f.run();
  assert.equal(posts, 0);
  assert.equal(f.row.status, 'INIT');
  assert.equal(f.row.numRetries, 1);
  assert.equal(f.row.apiRequestId, undefined);
  assert.equal(f.row.providerSubmissionStartedAt, null);
  await f.run();
  assert.equal(posts, 1);
  assert.equal(f.row.apiRequestId, 'new-prediction');
});

test('terminal content exhaustion fails without another prediction', async () => {
  const f = fixture(async () => json({ id: 'failed', status: 'failed', error: 'Content rejected' }), {
    status: 'PENDING', musicGenerationStatus: 'PENDING', apiRequestId: 'failed', numRetries: 3,
  });
  await f.run();
  assert.deepEqual(f.failures, [['job', 'Content rejected']]);
  assert.equal(f.row.apiRequestId, 'failed');
});

test('a pending legacy row without a prediction ID fails safely without POST replay', async () => {
  const f = fixture(async () => assert.fail('an unpollable accepted row cannot be submitted again'), {
    status: 'PENDING', musicGenerationStatus: 'PENDING',
  });
  await assert.rejects(f.run(), { submissionOutcomeUnknown: true, providerRequestUnpollable: true });
});

test('a definitive inaccessible output reaches central terminal handling with its prediction ID', async () => {
  const f = fixture(async () => new Response('denied', { status: 403 }), {
    status: 'PENDING', musicGenerationStatus: 'PENDING', apiRequestId: 'accepted', replicateOutputUrl: 'https://delivery.example/audio.mp3',
  });
  await assert.rejects(f.run(), { status: 403, providerMediaUnavailable: true });
  assert.equal(f.row.apiRequestId, 'accepted');
});

for (const invalid of [{}, null, [], { id: 'accepted', status: 'unexpected' }, { id: 'different-id', status: 'processing' }]) {
  test(`malformed accepted prediction stays a recoverable read failure: ${JSON.stringify(invalid)}`, async () => {
    let requests = 0;
    const f = fixture(async (_url, options) => {
      assert.notEqual(options.method, 'POST');
      requests++;
      return json(invalid);
    }, { status: 'PENDING', musicGenerationStatus: 'PENDING', apiRequestId: 'accepted' });
    await assert.rejects(f.run(), { status: 502 });
    assert.equal(requests, 1);
    assert.equal(f.row.apiRequestId, 'accepted');
    assert.equal(f.row.status, 'PENDING');
  });
}

test('a submit receipt without a valid prediction status is ambiguous and cannot begin polling', async () => {
  let posts = 0;
  const f = fixture(async () => { posts++; return json({ id: 'accepted' }); });
  await assert.rejects(f.run(), { submissionOutcomeUnknown: true });
  assert.equal(posts, 1);
  assert.equal(f.writes.length, 0);
});
