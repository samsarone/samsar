import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./Image.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function getAndProcessPendingImageGenerationRows()');
const poller = source.slice(start, source.indexOf('\nasync function claimPendingImageGenerationRequest(', start)).replace('export ', '');

for (const failure of ['connect', 'billing', 'poll']) {
  test(`image intake survives a ${failure} outage and reconnects without replaying a job`, async () => {
    const stop = new Error('stop fixture loop');
    const state = { ticks: 0, connects: 0, polls: 0, billing: 0, errors: 0 };
    const context = vm.createContext({
      Date,
      getTimeout: async () => { if (++state.ticks > 2) throw stop; },
      getDBConnectionString: async () => {
        state.connects++;
        if (failure === 'connect' && state.connects === 1) throw new Error('Mongo unavailable');
      },
      ImageGeneration: { updateMany: async () => {
        state.billing++;
        if (failure === 'billing' && state.billing === 1) throw new Error('Mongo unavailable');
      } },
      recoverImageBillingRequests: async () => {},
      processPendingImageRequests: async () => {
        state.polls++;
        if (failure === 'poll' && state.polls === 1) throw new Error('Mongo unavailable');
      },
      console: { error: () => { state.errors++; } },
    });
    const run = vm.runInContext(`${poller}\ngetAndProcessPendingImageGenerationRows`, context);
    await assert.rejects(run(), error => error === stop);
    assert.equal(state.connects, 2);
    assert.equal(state.errors, 1);
    assert.equal(state.polls, failure === 'poll' ? 2 : 1);
  });
}
