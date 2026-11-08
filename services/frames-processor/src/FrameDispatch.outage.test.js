import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./main.js', import.meta.url), 'utf8');
const dispatcher = source.slice(source.indexOf('function scheduleNextFrameTask()'),
  source.indexOf('\nasync function generateFramesForSession('));

function harness({ claimFails = false, persistenceFails = false } = {}) {
  const state = { claims: 0, bodies: 0, errors: 0, failures: 0 };
  const context = vm.createContext({
    taskQueue: [{ _id: 'frame-job' }], ongoingTasks: 0, MAX_CONCURRENT_TASKS: 1,
    childProcessesMap: new Map(), getChildCombinationKey: () => 'session:layer',
    FrameGeneration: { findOneAndUpdate() {
      state.claims++;
      return { lean: async () => {
        if (claimFails) throw Object.assign(new Error('Mongo disconnected'), { code: 'ECONNRESET' });
        return { _id: 'frame-job', sessionId: 'session', layerId: 'layer', numRetries: 2 };
      } };
    } },
    VideoSession: { findById: async () => ({ layers: [{ _id: 'layer' }] }) },
    isBranchedFrameGeneration: () => false,
    generateFramesForSession: async () => { state.bodies++; throw new Error('render failed'); },
    markFrameGenerationFailed: async () => {
      state.failures++;
      if (persistenceFails) throw Object.assign(new Error('Mongo disconnected'), { code: 'ECONNRESET' });
    },
    ObsoleteFrameGenerationError: class extends Error {},
    FatalFrameGenerationError: class extends Error {},
    console: { error: () => { state.errors++; }, warn() {} },
  });
  vm.runInContext(dispatcher, context);
  return { state, context, async dispatch() {
    vm.runInContext('scheduleNextFrameTask()', context);
    await new Promise(resolve => setImmediate(resolve));
  } };
}

test('a detached Mongo claim failure is observed without running or replaying the frame body', async () => {
  const h = harness({ claimFails: true });
  await h.dispatch();
  assert.equal(h.state.claims, 1);
  assert.equal(h.state.bodies, 0);
  assert.equal(h.state.errors, 1);
  assert.equal(h.context.ongoingTasks, 0);
});

test('failure persistence outages release the local slot without replaying the render', async () => {
  const h = harness({ persistenceFails: true });
  await h.dispatch();
  assert.equal(h.state.claims, 1);
  assert.equal(h.state.bodies, 1);
  assert.equal(h.state.failures, 1);
  assert.equal(h.context.ongoingTasks, 0);
  assert.equal(h.context.childProcessesMap.size, 0);
  assert.equal(h.state.errors, 3);
});
