import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./GenerationProcessor.js', import.meta.url), 'utf8');
const start = source.indexOf('export async function generatePendingVideoRequests()');
const end = source.indexOf('\n}', start) + 2;
const workerSource = source.slice(start, end).replace('export ', '');

test('competing video workers process only the job they atomically claim', async () => {
  let locked = false;
  let sessionReads = 0;
  let deletions = 0;
  const context = vm.createContext({
    isShuttingDown: false, STALE_VIDEO_GENERATION_LOCK_MS: 60_000,
    getDBConnectionString: async () => {}, repairMissingDockerFinalVideoRequests: async () => {},
    VideoGeneration: {
      updateMany: async () => ({ modifiedCount: 0 }),
      find: () => ({ sort: async () => [{ _id: 'job', videoSessionId: 'stale-session' }] }),
      findOneAndUpdate: async (filter, update, options) => {
        assert.equal(filter.rowLocked, false);
        assert.equal(update.$set.rowLocked, true);
        assert.equal(options.new, true);
        if (locked) return null;
        locked = true;
        return { _id: 'job', videoSessionId: 'current-session' };
      },
      findByIdAndDelete: async () => { deletions += 1; },
    },
    VideoSession: { findById: async (id) => {
      assert.equal(id, 'current-session');
      sessionReads += 1;
      return null;
    } }, console,
  });
  const processPending = vm.runInContext(`${workerSource}\n;generatePendingVideoRequests;`, context);
  await Promise.all([processPending(), processPending()]);
  assert.equal(sessionReads, 1);
  assert.equal(deletions, 1);
});
