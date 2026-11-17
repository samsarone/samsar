import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beginImageSubmissionAttempt, deferAcceptedImagePoll, observeImageSubmissionFailure,
  resolveImageSubmissionAttempt, runImageSubmissionAttempt,
} from './ImageSubmissionAttempt.js';

function fixture(initial = {}) {
  let row = { _id: 'job', operationType: 'GENERATE', apiGenerationStatus: 'INIT', ...initial };
  const events = [];
  const Model = {
    async updateOne(filter, update) {
      if (Object.hasOwn(filter, 'imageSubmissionAttempt') && filter.imageSubmissionAttempt === null &&
          row.imageSubmissionAttempt != null) return { matchedCount: 0 };
      if (filter.$or && row.imageSubmissionAttempt &&
          !['ACCEPTED', 'COMPLETED', 'REJECTED'].includes(row.imageSubmissionAttempt.state)) return { matchedCount: 0 };
      if (filter['imageSubmissionAttempt.token'] && row.imageSubmissionAttempt?.token !== filter['imageSubmissionAttempt.token']) {
        return { matchedCount: 0 };
      }
      if (filter['imageSubmissionAttempt.state'] &&
          !filter['imageSubmissionAttempt.state'].$in.includes(row.imageSubmissionAttempt?.state)) return { matchedCount: 0 };
      if (Object.hasOwn(filter, 'imageSubmissionAttempt.pollFailures')) {
        const expected = filter['imageSubmissionAttempt.pollFailures'];
        const actual = row.imageSubmissionAttempt?.pollFailures;
        if (expected && typeof expected === 'object' && expected.$exists === false
          ? actual !== undefined : actual !== expected) return { matchedCount: 0 };
      }
      if (filter.submissionOutcomeUnknown?.$ne === true && row.submissionOutcomeUnknown === true) return { matchedCount: 0 };
      if (filter.apiRequestId && row.apiRequestId !== filter.apiRequestId) return { matchedCount: 0 };
      for (const field of ['apiGenerationStatus', 'apiEditStatus']) {
        if (filter[field] && row[field] !== filter[field]) return { matchedCount: 0 };
      }
      for (const [key, value] of Object.entries(update.$set || {})) {
        if (key.startsWith('imageSubmissionAttempt.')) row.imageSubmissionAttempt[key.split('.')[1]] = value;
        else row[key] = structuredClone(value);
      }
      events.push(structuredClone(update));
      return { matchedCount: 1 };
    },
    findById() { return { lean: async () => structuredClone(row) }; },
  };
  return { Model, events, payload: () => structuredClone(row), row: () => row };
}

test('image submission intent is durable before the provider starts, and accepted IDs are retained', async () => {
  const f = fixture();
  await runImageSubmissionAttempt(f.payload(), async () => {
    assert.equal(f.row().imageSubmissionAttempt.state, 'SUBMITTING');
    f.row().apiGenerationStatus = 'PENDING';
    f.row().apiRequestId = 'accepted-upstream-id';
  }, { Model: f.Model, token: 'owner' });
  assert.equal(f.row().imageSubmissionAttempt.state, 'ACCEPTED');
  assert.equal(f.row().apiRequestId, 'accepted-upstream-id');
});

test('competing guarded image dispatchers can begin only one provider submission', async () => {
  const f = fixture();
  const first = f.payload();
  const second = f.payload();
  const outcomes = await Promise.allSettled([
    beginImageSubmissionAttempt(first, { Model: f.Model, token: 'first' }),
    beginImageSubmissionAttempt(second, { Model: f.Model, token: 'second' }),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
});

test('a marker write failure never reaches the provider, even when the write committed', async () => {
  const f = fixture();
  const update = f.Model.updateOne;
  f.Model.updateOne = async (...args) => { await update(...args); throw new Error('Mongo connection reset'); };
  let posts = 0;
  await assert.rejects(runImageSubmissionAttempt(f.payload(), async () => { posts++; }, { Model: f.Model }), /Mongo/);
  assert.equal(posts, 0);
  await assert.rejects(beginImageSubmissionAttempt(f.payload(), { Model: f.Model }), /refusing to submit/);
});

test('accepted upstream work whose receipt cannot be persisted is never resubmitted or failed over', async () => {
  const f = fixture();
  let posts = 0;
  await assert.rejects(runImageSubmissionAttempt(f.payload(), async () => {
    posts++;
    // Simulate the remote accepting a POST while Mongo loses its connection.
    throw Object.assign(new Error('Mongo network reset while saving accepted ID'), { code: 'ECONNRESET' });
  }, { Model: f.Model }), /Mongo network/);
  assert.equal(f.row().imageSubmissionAttempt.state, 'UNKNOWN');
  f.row().failureRetryCount = 1;
  f.row().adapterProvider = 'different-adapter';
  await assert.rejects(runImageSubmissionAttempt(f.payload(), async () => { posts++; }, { Model: f.Model }), /refusing to submit/);
  assert.equal(posts, 1);
});

test('legacy pending rows continue polling their saved IDs without new marker writes', async () => {
  const f = fixture({ apiGenerationStatus: 'PENDING', apiRequestId: 'legacy-id' });
  let polls = 0;
  for (let count = 0; count < 100; count++) {
    await runImageSubmissionAttempt(f.payload(), async () => { polls++; }, { Model: f.Model });
  }
  assert.equal(polls, 100);
  assert.equal(f.row().apiRequestId, 'legacy-id');
  assert.deepEqual(f.events, []);
});

test('accepted polling failures keep one request ID and fail after a bounded number without resubmission', async () => {
  const f = fixture();
  await runImageSubmissionAttempt(f.payload(), async () => {
    f.row().apiGenerationStatus = 'PENDING'; f.row().apiRequestId = 'same-id';
  }, { Model: f.Model });
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(await deferAcceptedImagePoll(f.payload(), { Model: f.Model, now: 1000 }), true);
    assert.equal(f.row().apiRequestId, 'same-id');
    assert.equal(f.row().apiGenerationStatus, 'PENDING');
    assert.equal(f.row().imageSubmissionAttempt.pollFailures, attempt);
    assert.equal(f.row().nextAttemptAfter.getTime(), 1000 + 15000 * (2 ** (attempt - 1)));
  }
  await assert.rejects(deferAcceptedImagePoll(f.payload(), { Model: f.Model }), /polling failed repeatedly/);
  f.row().apiGenerationStatus = 'INIT';
  await assert.rejects(beginImageSubmissionAttempt(f.payload(), { Model: f.Model }), /refusing to submit/);
});

for (const initialMarker of [undefined, null]) {
  test(`legacy pending row with ${initialMarker === null ? 'null' : 'missing'} marker gets three backed-off reads without another generation`, async () => {
    const submittedAt = new Date('2026-11-17T16:56:25Z');
    const f = fixture({ apiGenerationStatus: 'PENDING', apiRequestId: 'legacy-accepted-id',
      apiSubmittedAt: submittedAt, submittedAdapter: 'fal', rowLocked: true,
      imageSubmissionAttempt: initialMarker, generationRetryCount: 2, filterRetryCount: 1 });
    let reads = 0;
    for (const [index, delay] of [15000, 30000, 60000].entries()) {
      const payload = f.payload();
      await runImageSubmissionAttempt(payload, async () => { reads++; }, { Model: f.Model });
      assert.equal(await deferAcceptedImagePoll(payload, { Model: f.Model, now: 1000, token: 'legacy-owner' }), true);
      assert.equal(f.row().nextAttemptAfter.getTime(), 1000 + delay);
      assert.equal(f.row().imageSubmissionAttempt.pollFailures, index + 1);
      assert.equal(f.row().imageSubmissionAttempt.state, 'ACCEPTED');
      assert.equal(f.row().imageSubmissionAttempt.token, 'legacy-owner');
      assert.equal(f.row().imageSubmissionAttempt.startedAt.getTime(), submittedAt.getTime());
      assert.equal(f.row().apiRequestId, 'legacy-accepted-id');
      assert.equal(f.row().submittedAdapter, 'fal');
      assert.equal(f.row().apiGenerationStatus, 'PENDING');
      assert.equal(f.row().generationRetryCount, 2);
      assert.equal(f.row().filterRetryCount, 1);
    }
    await runImageSubmissionAttempt(f.payload(), async () => { reads++; }, { Model: f.Model });
    await assert.rejects(deferAcceptedImagePoll(f.payload(), { Model: f.Model }), {
      code: 'IMAGE_PROVIDER_POLL_RETRIES_EXHAUSTED',
    });
    assert.equal(reads, 4); // The initial failed read plus three additional reads.
    assert.equal(f.row().imageSubmissionAttempt.pollFailures, 3);
    assert.equal(f.row().apiRequestId, 'legacy-accepted-id');
    f.row().apiGenerationStatus = 'INIT';
    await assert.rejects(beginImageSubmissionAttempt(f.payload(), { Model: f.Model }), /refusing to submit/);
  });
}

test('a successful pending read does not consume the accepted failure budget', async () => {
  const f = fixture({ apiGenerationStatus: 'PENDING', apiRequestId: 'still-running',
    imageSubmissionAttempt: { state: 'ACCEPTED', token: 'owner', pollFailures: 2 } });
  for (let count = 0; count < 100; count++) {
    await runImageSubmissionAttempt(f.payload(), async () => null, { Model: f.Model });
  }
  assert.equal(f.row().imageSubmissionAttempt.pollFailures, 2);
  assert.deepEqual(f.events, []);
  await deferAcceptedImagePoll(f.payload(), { Model: f.Model, now: 1000 });
  assert.equal(f.row().imageSubmissionAttempt.pollFailures, 3);
  assert.equal(f.row().nextAttemptAfter.getTime(), 61000);
});

for (const withMarker of [false, true]) {
  test(`${withMarker ? 'guarded' : 'legacy'} concurrent polling recoveries cannot duplicate or reset their retry allowance`, async () => {
    const f = fixture({ apiGenerationStatus: 'PENDING', apiRequestId: 'same-request',
      ...(withMarker ? { imageSubmissionAttempt: { state: 'ACCEPTED', token: 'owner' } } : {}) });
    const first = f.payload();
    const second = f.payload();
    const outcomes = await Promise.allSettled([
      deferAcceptedImagePoll(first, { Model: f.Model, token: 'first' }),
      deferAcceptedImagePoll(second, { Model: f.Model, token: 'second' }),
    ]);
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(result => result.status === 'rejected').length, 1);
    assert.equal(f.row().imageSubmissionAttempt.pollFailures, 1);
    assert.equal(f.events.length, 1);
    assert.equal(f.row().apiRequestId, 'same-request');
  });
}

for (const state of ['SUBMITTING', 'UNKNOWN', 'REJECTED', 'COMPLETED']) {
  test(`poll recovery cannot turn a ${state} marker into accepted work`, async () => {
    const f = fixture({ apiGenerationStatus: 'PENDING', apiRequestId: 'saved-id',
      imageSubmissionAttempt: { state, token: 'original' } });
    assert.equal(await deferAcceptedImagePoll(f.payload(), { Model: f.Model }), false);
    assert.deepEqual(f.events, []);
  });
}

test('poll recovery cannot alter a different provider request or a concurrently rejected marker', async () => {
  for (const mutate of [
    row => { row.apiRequestId = 'new-request'; },
    row => { row.imageSubmissionAttempt.state = 'REJECTED'; },
    row => { row.submissionOutcomeUnknown = true; },
  ]) {
    const f = fixture({ apiGenerationStatus: 'PENDING', apiRequestId: 'old-request',
      imageSubmissionAttempt: { state: 'ACCEPTED', token: 'owner' } });
    const payload = f.payload();
    mutate(f.row());
    await assert.rejects(deferAcceptedImagePoll(payload, { Model: f.Model }), /acceptance is unknown/);
    assert.deepEqual(f.events, []);
  }
});

test('an explicitly unknown legacy submission is not upgraded or resubmitted', async () => {
  const f = fixture({ apiGenerationStatus: 'PENDING', apiRequestId: 'legacy-id', submissionOutcomeUnknown: true });
  assert.equal(await deferAcceptedImagePoll(f.payload(), { Model: f.Model }), false);
  assert.deepEqual(f.events, []);
});

test('edit and upscale poll retries preserve edit provider state and request identity', async () => {
  for (const operationType of ['EDIT', 'UPSCALE']) {
    const f = fixture({ operationType, apiGenerationStatus: 'INIT', apiEditStatus: 'PENDING', apiRequestId: 'edit-id' });
    assert.equal(await deferAcceptedImagePoll(f.payload(), { Model: f.Model, now: 1000 }), true);
    assert.equal(f.row().apiEditStatus, 'PENDING');
    assert.equal(f.row().apiGenerationStatus, 'INIT');
    assert.equal(f.row().apiRequestId, 'edit-id');
    assert.equal(f.row().nextAttemptAfter.getTime(), 16000);
  }
});

test('an explicit failed accepted job permits normal retry, while polling errors cannot release it', async () => {
  const f = fixture();
  await runImageSubmissionAttempt(f.payload(), async () => {
    f.row().apiGenerationStatus = 'PENDING'; f.row().apiRequestId = 'same-id';
  }, { Model: f.Model });
  const payload = f.payload();
  await observeImageSubmissionFailure(payload, { status: 503 }, { Model: f.Model });
  assert.equal(f.row().imageSubmissionAttempt.state, 'ACCEPTED');
  await observeImageSubmissionFailure(payload, { definitiveAdapterFailure: true }, { Model: f.Model });
  assert.equal(f.row().imageSubmissionAttempt.state, 'REJECTED');
  f.row().apiGenerationStatus = 'INIT';
  await beginImageSubmissionAttempt(f.payload(), { Model: f.Model });
  assert.equal(f.row().imageSubmissionAttempt.state, 'SUBMITTING');
});

for (const rejection of [{ status: 422, error: 'Invalid prompt' }, { status: 429, error: 'Rate limit' },
  { error: 'Request rejected by content policy', definitive: true }]) {
  test(`definitive rejection permits the existing intentional retry: ${rejection.status || 'content'}`, async () => {
    const f = fixture();
    const payload = f.payload();
    await beginImageSubmissionAttempt(payload, { Model: f.Model, token: 'first' });
    await observeImageSubmissionFailure(payload, rejection, { Model: f.Model, definitive: rejection.definitive });
    assert.equal(f.row().imageSubmissionAttempt.state, 'REJECTED');
    assert.equal(payload.submissionOutcomeUnknown, undefined);
    await beginImageSubmissionAttempt(f.payload(), { Model: f.Model, token: 'retry' });
    assert.equal(f.row().imageSubmissionAttempt.token, 'retry');
  });
}

test('an ambiguous error overrides a definitive adapter flag and cannot permit another POST', async () => {
  const f = fixture();
  const payload = f.payload();
  await beginImageSubmissionAttempt(payload, { Model: f.Model });
  await observeImageSubmissionFailure(payload, { definitiveAdapterFailure: true, submissionOutcomeUnknown: true }, { Model: f.Model });
  assert.equal(f.row().imageSubmissionAttempt.state, 'UNKNOWN');
  await observeImageSubmissionFailure(payload, { status: 422, definitiveAdapterFailure: true }, { Model: f.Model });
  assert.equal(f.row().imageSubmissionAttempt.state, 'UNKNOWN');
  await assert.rejects(beginImageSubmissionAttempt(f.payload(), { Model: f.Model }), /refusing to submit/);
});

test('finishing a previous intentional attempt cannot fail or alter a newer claimed attempt', async () => {
  const f = fixture();
  const first = f.payload();
  await runImageSubmissionAttempt(first, async () => {
    await resolveImageSubmissionAttempt(first, 'COMPLETED', { Model: f.Model });
    f.row().filterRetryCount = 1;
    await beginImageSubmissionAttempt(f.payload(), { Model: f.Model, token: 'new-attempt-owner' });
  }, { Model: f.Model, token: 'first-owner' });
  assert.equal(f.row().imageSubmissionAttempt.state, 'SUBMITTING');
  assert.equal(f.row().imageSubmissionAttempt.token, 'new-attempt-owner');
});

test('a returned image permits scoring retries, while delivery failure cannot regenerate the same attempt', async () => {
  const f = fixture();
  const payload = f.payload();
  await beginImageSubmissionAttempt(payload, { Model: f.Model });
  await resolveImageSubmissionAttempt(payload, 'COMPLETED', { Model: f.Model });
  await assert.rejects(beginImageSubmissionAttempt(f.payload(), { Model: f.Model }), /already returned a result/);
  f.row().failureRetryCount = 1;
  await assert.rejects(beginImageSubmissionAttempt(f.payload(), { Model: f.Model }), /already returned a result/);
  f.row().filterRetryCount = 1;
  await beginImageSubmissionAttempt(f.payload(), { Model: f.Model, token: 'intentional-scoring-retry' });
  assert.equal(f.row().imageSubmissionAttempt.token, 'intentional-scoring-retry');
});

test('a swallowed submit failure with no accepted ID fails closed instead of returning to INIT', async () => {
  const f = fixture();
  let posts = 0;
  await assert.rejects(runImageSubmissionAttempt(f.payload(), async () => { posts++; return null; }, { Model: f.Model }), /acceptance is unknown/);
  assert.equal(f.row().imageSubmissionAttempt.state, 'UNKNOWN');
  await assert.rejects(runImageSubmissionAttempt(f.payload(), async () => { posts++; }, { Model: f.Model }), /refusing to submit/);
  assert.equal(posts, 1);
});

test('image edits and upscales use their edit state for submission versus polling', async () => {
  for (const operationType of ['EDIT', 'UPSCALE']) {
    const f = fixture({ operationType, apiGenerationStatus: 'INIT', apiEditStatus: 'PENDING', apiRequestId: 'edit-id' });
    await runImageSubmissionAttempt(f.payload(), async () => {}, { Model: f.Model });
    assert.deepEqual(f.events, []);
  }
});
