import test from 'node:test';
import assert from 'node:assert/strict';
import VideoSession from '../../schema/VideoSession.js';
import { pauseVideoSessionRender, resumeVideoSessionRender, cancelVideoSessionRender } from './VideoSessionCancelAPI.js';

const id = '507f1f77bcf86cd799439011';
function harness(t, extra = {}) {
  const session = { _id: id, isExpressGeneration: true, expressGenerationStatus: { image_generation: 'PENDING' },
    hostedAgentBilling: { version: 2, state: 'ACTIVE' }, ...extra };
  const calls = [];
  t.mock.method(VideoSession, 'findOne', filter => {
    assert.equal(filter.userId, 'owner');
    return { select() { return this; }, lean: async () => session, then: resolve => Promise.resolve(session).then(resolve) };
  });
  t.mock.method(VideoSession, 'updateOne', async () => { calls.push('legacy write'); });
  const dependencies = { connect: async () => {},
    control: async (...args) => { calls.push(args); return { ok: true }; },
    settle: async (...args) => { calls.push(['legacy', ...args]); return { ok: true, legacy: true }; },
  };
  return { session, calls, dependencies };
}
for (const [fn, outcome] of [[pauseVideoSessionRender, 'PAUSED'], [resumeVideoSessionRender, 'ACTIVE'], [cancelVideoSessionRender, 'CANCELLED']]) {
  test(`${outcome} uses one durable control operation without a second unfenced state write`, async t => {
    const h = harness(t);
    const result = await fn('owner', { session_id: id }, h.dependencies);
    assert.equal(result.session_id, id); assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0][0], id); assert.equal(h.calls[0][1], outcome);
    assert.equal(h.calls[0][2].expressGenerationPending, outcome === 'ACTIVE');
  });
}
test('resume reuses video that finished during pause', async t => {
  const h = harness(t, { videoLink: 'render.mp4', expressGenerationPaused: true, hostedAgentBilling: { version: 2, state: 'PAUSED' } });
  assert.equal((await resumeVideoSessionRender('owner', { session_id: id }, h.dependencies)).resumed, true);
});
test('resume refuses failed, cancelled and already completed requests', async t => {
  const h = harness(t);
  for (const field of ['expressGenerationFailed', 'expressGenerationCancelled', 'videoLink']) {
    h.session[field] = true;
    await assert.rejects(resumeVideoSessionRender('owner', { session_id: id }, h.dependencies), { status: 409 });
    delete h.session[field];
  }
  assert.equal(h.calls.length, 0);
});
test('failed funding never enables work', async t => {
  const h = harness(t); h.dependencies.control = async () => { throw Object.assign(Error('Insufficient credits'), { code: 'INSUFFICIENT_CREDITS' }); };
  await assert.rejects(resumeVideoSessionRender('owner', { session_id: id }, h.dependencies), { code: 'INSUFFICIENT_CREDITS' });
  assert.equal(h.calls.length, 0);
});
test('legacy pause still uses its existing state and settlement path', async t => {
  const h = harness(t, { hostedAgentBilling: undefined });
  await pauseVideoSessionRender('owner', { session_id: id }, h.dependencies);
  assert.equal(h.calls[0], 'legacy write'); assert.equal(h.calls[1][0], 'legacy');
});
