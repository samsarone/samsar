import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cleanupCompletedSessionFrames, getCompletedFrameCleanupSkipReason } from '../src/CompletedFrameCleanup.js';

const GIB = 1024 ** 3;
const MINUTE = 60_000;
const NOW = Date.UTC(2030, 0, 1);
const IDS = ['1'.repeat(24), '2'.repeat(24), '3'.repeat(24), '4'.repeat(24)];
const PREFIXES = ['video/frames', 'ai_video/frames', 'global_videos/frames',
  'video/narrator_avatar/frames', 'video/narrator_avatar/joined_frames'];
const quiet = { info() {}, warn() {} };

function capacity({ total = 400 * GIB, free = 300 * GIB, available = 290 * GIB } = {}) {
  return { bsize: 1, blocks: total, bfree: free, bavail: available };
}

function completed(id, updated = NOW - 60 * MINUTE) {
  return { _id: id, updatedAt: new Date(updated), videoLink: `/video/output/${id}/final.mp4`,
    expressGenerationPending: false, videoGenerationPending: false, frameGenerationPending: false,
    expressGenerationFailed: false,
    expressGenerationStatus: { status: 'COMPLETED', video_generation: 'COMPLETED' }, layers: [] };
}

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'completed-frame-cleanup-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const assets = path.join(directory, 'assets');
  const assetsV2 = path.join(directory, 'assets_v2');
  await Promise.all([fs.mkdir(assets), fs.mkdir(assetsV2)]);
  const states = new Map();
  const removals = [];
  let disk = capacity();
  let afterRemove = () => {};
  const implementation = {
    ...fs,
    statfs: async () => disk,
    rm: async (filename, options) => {
      removals.push(filename);
      await fs.rm(filename, options);
      await afterRemove(filename);
    },
  };
  async function create(id, { root = assetsV2, prefixes = [PREFIXES[0]], age = 30 * MINUTE,
    session = completed(id), output = true, size = 5 } = {}) {
    states.set(id, { session, hasActiveJobs: false });
    const trees = [];
    for (const prefix of prefixes) {
      const cache = path.join(root, prefix, id);
      const layer = path.join(cache, 'layer');
      await fs.mkdir(layer, { recursive: true });
      const frame = path.join(layer, '0.png');
      await fs.writeFile(frame, 'frame');
      if (size !== 5) await fs.truncate(frame, size);
      const timestamp = new Date(NOW - age);
      for (const entry of [frame, layer, cache]) await fs.utimes(entry, timestamp, timestamp);
      trees.push(cache);
    }
    if (output) {
      const final = path.join(root, 'video/output', id, 'final.mp4');
      await fs.mkdir(path.dirname(final), { recursive: true });
      await fs.writeFile(final, output === 'empty' ? '' : 'FINAL VIDEO MUST SURVIVE');
    }
    return trees;
  }
  async function run(options = {}) {
    return cleanupCompletedSessionFrames({ assetsRoots: [assets, assetsV2],
      loadSessionState: async (id) => states.get(id), env: {}, now: NOW,
      logger: quiet, fsImpl: implementation, ...options });
  }
  return { directory, assets, assetsV2, states, removals, implementation, create, run,
    setDisk(value) { disk = value; }, onRemove(callback) { afterRemove = callback; } };
}

test('normal cleanup removes only the five completed-session cache prefixes, preserving final/source media', async (t) => {
  const f = await fixture(t);
  const caches = await f.create(IDS[0], { prefixes: PREFIXES });
  const retained = [
    `video/output/${IDS[0]}/final.mp4`, `video/generations/${IDS[0]}/clip.mp4`,
    `video/audio/${IDS[0]}/speech.mp3`, `generations/${IDS[0]}/source.png`,
    `joined_frames/${IDS[0]}/not-an-allowed-prefix.png`, 'video/frames/not-a-session/frame.png',
  ];
  for (const relative of retained.slice(1)) {
    const filename = path.join(f.assetsV2, relative);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, 'KEEP');
  }
  const result = await f.run();
  assert.equal(result.deletedSessions, 1);
  assert.equal(result.deletedDirectories, 5);
  assert.equal(result.deletedFiles, 5);
  assert.equal(result.deletedBytes, 25);
  for (const cache of caches) await assert.rejects(fs.stat(cache), { code: 'ENOENT' });
  for (const relative of retained) assert.ok((await fs.stat(path.join(f.assetsV2, relative))).isFile());
  assert.equal(await fs.readFile(path.join(f.assetsV2, retained[0]), 'utf8'), 'FINAL VIDEO MUST SURVIVE');
});

test('pressure reclaims a 232 GiB completed cache younger than 24 hours instead of keeping the legacy age guard', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0], { age: 5 * MINUTE, session: completed(IDS[0], NOW - 4 * MINUTE), size: 232 * GIB });
  f.setDisk(capacity({ free: 13 * GIB, available: 0 }));
  f.onRemove(() => f.setDisk(capacity({ free: 245 * GIB, available: 232 * GIB })));
  const result = await f.run({ env: { STALE_SESSION_FRAME_CLEANUP_HOURS: '24', CLEANUP_MIN_AGE_HOURS: '168' } });
  assert.equal(result.pressureFilesystems, 1);
  assert.equal(result.deletedBytes, 232 * GIB);
  assert.equal(result.deletedDirectories, 1);
  assert.equal(result.recoveredFilesystems, 1);
});

test('pressure deletion is oldest-first and stops only when both hysteresis targets hold', async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 3; index++) {
    await f.create(IDS[index], { age: (60 - index * 20) * MINUTE,
      session: completed(IDS[index], NOW - (60 - index * 20) * MINUTE) });
  }
  f.setDisk(capacity({ free: 20 * GIB, available: 5 * GIB }));
  f.onRemove(() => f.setDisk(f.removals.length === 1
    ? capacity({ free: 100 * GIB, available: 64 * GIB }) // Exactly 75% used is not below the target.
    : capacity({ free: 101 * GIB, available: 65 * GIB })));
  const result = await f.run();
  assert.deepEqual(f.removals.map((name) => path.basename(name)), [IDS[0], IDS[1]]);
  assert.equal(result.recoveredFilesystems, 1);
  assert.ok(await fs.stat(path.join(f.assetsV2, PREFIXES[0], IDS[2])));
});

test('available bytes exclude ext4 reserved blocks, even below the percentage trigger', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0], { age: MINUTE, session: completed(IDS[0], NOW) });
  f.setDisk(capacity({ free: 100 * GIB, available: 0 })); // 75% used but no non-root available space.
  f.onRemove(() => f.setDisk(capacity({ free: 120 * GIB, available: 80 * GIB })));
  const result = await f.run();
  assert.equal(result.pressureFilesystems, 1);
  assert.equal(result.deletedDirectories, 1);
});

test('negative non-root available space is treated as zero under pressure', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0], { age: MINUTE });
  f.setDisk(capacity({ free: 10 * GIB, available: -GIB }));
  f.onRemove(() => f.setDisk(capacity({ free: 120 * GIB, available: 80 * GIB })));
  const result = await f.run();
  assert.equal(result.pressureFilesystems, 1);
  assert.equal(result.deletedDirectories, 1);
});

test('percentage pressure triggers independently of available bytes', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0], { age: MINUTE });
  f.setDisk(capacity({ total: 1000 * GIB, free: 200 * GIB, available: 190 * GIB }));
  f.onRemove(() => f.setDisk(capacity({ total: 1000 * GIB, free: 260 * GIB, available: 250 * GIB })));
  const result = await f.run();
  assert.equal(result.pressureFilesystems, 1);
  assert.equal(result.deletedDirectories, 1);
});

test('normal grace follows both newest cache activity and session updates', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0], { age: 5 * MINUTE });
  await f.create(IDS[1], { age: 60 * MINUTE, session: completed(IDS[1], NOW - 5 * MINUTE) });
  await f.create(IDS[2], { age: 60 * MINUTE });
  const result = await f.run();
  assert.equal(result.skippedGrace, 2);
  assert.deepEqual(f.removals.map((name) => path.basename(name)), [IDS[2]]);
});

test('recent copy ctime prevents cleanup even if old file mtimes were preserved', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0]);
  const result = await f.run({ now: Date.now() });
  assert.equal(result.deletedDirectories, 0);
  assert.equal(result.skippedGrace, 1);
});

test('pending flags and queued work override inherited COMPLETED state under pressure', async (t) => {
  const f = await fixture(t);
  const cases = [
    { expressGenerationPending: true }, { videoGenerationPending: true },
    { frameGenerationPending: true }, { framesGenerationPending: true },
    { isFrameGenerating: true }, { layers: [{ lipSyncGenerationPending: true }] },
    { global_videos: [{ framesGenerationPending: true }] },
    { globalVideos: [{ framesGenerationStatus: 'PROCESSING' }] },
    { branchRenderPaths: [{ timeline: [{ frameGenerationPending: true }] }] },
  ];
  for (const fields of cases) {
    assert.equal(getCompletedFrameCleanupSkipReason({ session: { ...completed(IDS[0]), ...fields }, hasActiveJobs: false }), 'skippedActive');
  }
  await f.create(IDS[0], { session: { ...completed(IDS[0]), expressGenerationPending: true } });
  await f.create(IDS[1]);
  f.states.get(IDS[1]).hasActiveJobs = true;
  f.setDisk(capacity({ free: 13 * GIB, available: 0 }));
  const result = await f.run();
  assert.equal(result.skippedActive, 2);
  assert.equal(result.deletedDirectories, 0);
});

test('failed, unfinished, unknown and missing/empty-final-output sessions are preserved', async (t) => {
  const f = await fixture(t);
  const inputs = [
    { session: { ...completed(IDS[0]), expressGenerationFailed: true } },
    { session: { ...completed(IDS[0]), expressGenerationStatus: { status: 'COMPLETED', video_generation: 'PENDING' } } },
    { session: { ...completed(IDS[0]), videoLink: '' } },
    { output: false }, { output: 'empty' }, { unknown: true },
  ];
  for (let index = 0; index < inputs.length; index++) {
    const id = (index + 1).toString(16).repeat(24);
    const input = inputs[index];
    await f.create(id, input);
    if (input.unknown) f.states.delete(id);
  }
  f.setDisk(capacity({ free: 13 * GIB, available: 0 }));
  const result = await f.run();
  assert.equal(result.deletedDirectories, 0);
  assert.equal(result.skippedIncomplete, 2);
  assert.equal(result.skippedMissingOutput, 3);
  assert.equal(result.skippedUnknown, 1);
  assert.equal(getCompletedFrameCleanupSkipReason({ session: completed(IDS[0]) }), 'skippedUnknown');
});

test('DB unavailability fails closed and stops the pass without leaking database details', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0]);
  const messages = [];
  await assert.rejects(f.run({
    loadSessionState: async () => { throw new Error('mongodb://secret:password@host'); },
    logger: { warn: (...args) => messages.push(args) },
  }), /could not verify session state/);
  assert.equal(f.removals.length, 0);
  assert.equal(JSON.stringify(messages).includes('password'), false);
});

test('DB is rechecked immediately before deletion and newly queued work is kept', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0]);
  let calls = 0;
  const result = await f.run({ loadSessionState: async (id) => {
    calls++;
    return { ...f.states.get(id), hasActiveJobs: calls > 1 };
  } });
  assert.equal(result.skippedActive, 1);
  assert.equal(f.removals.length, 0);
});

test('work starting during the final tree walk prevents deletion even without any frame changes', async (t) => {
  const f = await fixture(t);
  const [cache] = await f.create(IDS[0]);
  const frame = await fs.realpath(path.join(cache, 'layer/0.png'));
  let frameInspections = 0;
  const result = await f.run({ fsImpl: { ...f.implementation,
    lstat: async (filename) => {
      const stats = await fs.lstat(filename);
      if (filename === frame && ++frameInspections === 2) f.states.get(IDS[0]).hasActiveJobs = true;
      return stats;
    },
  } });
  assert.equal(frameInspections, 2);
  assert.equal(result.skippedActive, 1);
  assert.equal(f.removals.length, 0);
  assert.equal(await fs.readFile(frame, 'utf8'), 'frame');
});

test('changed frame trees and changed session versions are kept after revalidation', async (t) => {
  for (const change of ['tree', 'session']) {
    const f = await fixture(t);
    const [cache] = await f.create(IDS[0]);
    let calls = 0;
    const result = await f.run({ loadSessionState: async (id) => {
      if (++calls === 2) {
        if (change === 'tree') await fs.writeFile(path.join(cache, 'layer/0.png'), 'NEW FRAME');
        else f.states.get(id).session.updatedAt = new Date(NOW);
      }
      return f.states.get(id);
    } });
    assert.equal(result.skippedChanged, 1);
    assert.equal(f.removals.length, 0);
  }
});

test('symlink entries and unsupported filesystem entries cannot be recursively removed', async (t) => {
  const f = await fixture(t);
  const [cache] = await f.create(IDS[0]);
  const outside = path.join(f.directory, 'outside.txt');
  await fs.writeFile(outside, 'KEEP OUTSIDE');
  await fs.symlink(outside, path.join(cache, 'linked.png'));
  const result = await f.run();
  assert.equal(result.skippedUnsafe, 1);
  assert.equal(f.removals.length, 0);
  assert.equal(await fs.readFile(outside, 'utf8'), 'KEEP OUTSIDE');
});

test('a prefix swapped for a symlink between DB checks preserves both original and outside trees', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0]);
  const prefix = path.join(f.assetsV2, PREFIXES[0]);
  const retained = prefix + '-held';
  const outside = path.join(f.directory, 'outside');
  await fs.mkdir(path.join(outside, IDS[0]), { recursive: true });
  await fs.writeFile(path.join(outside, IDS[0], 'outside.png'), 'KEEP');
  let calls = 0;
  const result = await f.run({ loadSessionState: async (id) => {
    if (++calls === 2) { await fs.rename(prefix, retained); await fs.symlink(outside, prefix); }
    return f.states.get(id);
  } });
  assert.equal(result.skippedUnsafe, 1);
  assert.equal(f.removals.length, 0);
  assert.equal(await fs.readFile(path.join(outside, IDS[0], 'outside.png'), 'utf8'), 'KEEP');
  assert.ok(await fs.stat(path.join(retained, IDS[0], 'layer/0.png')));
});

test('a root swapped for a symlink during discovery is rejected', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0], { root: f.assets });
  const outside = path.join(f.directory, 'outside');
  await fs.mkdir(outside);
  let swapped = false;
  const result = await f.run({ assetsRoots: [f.assets], fsImpl: { ...f.implementation,
    realpath: async (filename) => {
      if (filename === f.assets && !swapped) {
        swapped = true;
        await fs.rename(f.assets, f.assets + '-held');
        await fs.symlink(outside, f.assets);
      }
      return fs.realpath(filename);
    },
  } });
  assert.equal(result.skippedUnsafe, 1);
  assert.equal(f.removals.length, 0);
});

test('a final video replaced with a symlink cannot authorize cache deletion', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0]);
  const final = path.join(f.assetsV2, 'video/output', IDS[0], 'final.mp4');
  const outside = path.join(f.directory, 'outside.mp4');
  await fs.writeFile(outside, 'KEEP');
  let calls = 0;
  const result = await f.run({ loadSessionState: async (id) => {
    if (++calls === 2) { await fs.unlink(final); await fs.symlink(outside, final); }
    return f.states.get(id);
  } });
  assert.equal(result.skippedMissingOutput, 1);
  assert.equal(f.removals.length, 0);
  assert.equal(await fs.readFile(outside, 'utf8'), 'KEEP');
});

test('dry-run reports eligible frame bytes without removing anything', async (t) => {
  const f = await fixture(t);
  const [cache] = await f.create(IDS[0]);
  const result = await f.run({ env: { FRAME_CLEANUP_DRY_RUN: 'true' } });
  assert.equal(result.deletedDirectories, 0);
  assert.equal(result.wouldDeleteDirectories, 1);
  assert.equal(result.wouldDeleteBytes, 5);
  assert.equal(f.removals.length, 0);
  assert.ok(await fs.stat(cache));
});

test('disabled cleanup performs no filesystem or database work', async () => {
  const result = await cleanupCompletedSessionFrames({ env: { FRAME_CLEANUP_ENABLED: 'false' },
    fsImpl: {}, loadSessionState: async () => { throw new Error('must not load'); } });
  assert.equal(result.enabled, false);
  assert.equal(result.deletedDirectories, 0);
});

test('unsafe root traversal and filesystem-capacity failures are fail-closed', async (t) => {
  const f = await fixture(t);
  await f.create(IDS[0]);
  const result = await f.run({ assetsRoots: ['/', path.join(f.assets, '..', 'assets_v2') + '/../assets_v2'] });
  assert.equal(result.rootsScanned, 0);
  assert.equal(result.skippedUnsafe, 2);
  await assert.rejects(f.run({ fsImpl: { ...f.implementation, statfs: async () => { throw new Error('unavailable'); } } }), /unavailable/);
  assert.equal(f.removals.length, 0);
});
