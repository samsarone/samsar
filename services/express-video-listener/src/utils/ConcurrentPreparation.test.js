import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareConcurrentlyAndCommitInOrder, resolvePreparationConcurrency } from './ConcurrentPreparation.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('out-of-order preparation is bounded and commits incrementally in source order', async () => {
  const prepared = Array.from({ length: 4 }, deferred);
  const firstCommit = deferred();
  const started = [], committed = [];
  let activeCommits = 0;
  const task = prepareConcurrentlyAndCommitInOrder([0, 1, 2, 3], {
    concurrency: 2,
    prepare: async index => { started.push(index); return prepared[index].promise; },
    commit: async value => {
      assert.equal(activeCommits++, 0);
      committed.push(value);
      if (value === 0) await firstCommit.promise;
      activeCommits--;
    },
  });
  await flush();
  assert.deepEqual(started, [0, 1]);
  prepared[1].resolve(1);
  await flush();
  assert.deepEqual(committed, []);
  prepared[0].resolve(0);
  await flush();
  assert.deepEqual(committed, [0]);
  assert.deepEqual(started, [0, 1]);
  firstCommit.resolve();
  await flush();
  assert.deepEqual(committed, [0, 1]);
  assert.deepEqual(started, [0, 1, 2, 3]);
  prepared[3].resolve(3); prepared[2].resolve(2);
  await task;
  assert.deepEqual(committed, [0, 1, 2, 3]);
});

test('a later rejected preparation is handled and never committed', async () => {
  const first = deferred();
  const expected = new Error('provider unavailable');
  const committed = [];
  const task = prepareConcurrentlyAndCommitInOrder([0, 1], {
    prepare: async index => { if (index === 1) throw expected; return first.promise; },
    commit: async value => { committed.push(value); },
  });
  await flush();
  first.resolve(0);
  await assert.rejects(task, error => error === expected);
  assert.deepEqual(committed, [0]);
});

test('stopping dispatch drains work without starting further preparations or commits', async () => {
  const tail = deferred();
  const started = [], committed = [];
  let finished = false;
  const task = prepareConcurrentlyAndCommitInOrder([0, 1, 2], {
    concurrency: 2,
    prepare: async index => { started.push(index); return index === 1 ? tail.promise : index; },
    commit: async value => { committed.push(value); return false; },
  }).then(() => { finished = true; });
  await flush();
  assert.deepEqual(started, [0, 1]);
  assert.deepEqual(committed, [0]);
  assert.equal(finished, false);
  tail.reject(new Error('late failure'));
  await task;
});

test('a failed commit prevents later mutations and still drains prepared work', async () => {
  const committed = [];
  await assert.rejects(prepareConcurrentlyAndCommitInOrder([0, 1, 2], {
    prepare: async index => index,
    commit: async value => { committed.push(value); throw new Error('database unavailable'); },
  }), /database unavailable/);
  assert.deepEqual(committed, [0]);
});

test('concurrency one retains sequential preparation and commits', async () => {
  const events = [];
  await prepareConcurrentlyAndCommitInOrder([0, 1], {
    concurrency: 1,
    prepare: async index => { events.push(`prepare:${index}`); return index; },
    commit: async value => { events.push(`commit:${value}`); },
  });
  assert.deepEqual(events, ['prepare:0', 'commit:0', 'prepare:1', 'commit:1']);
  for (const value of [undefined, '', 0, -1, 1.5, 'bad', Infinity]) {
    assert.equal(resolvePreparationConcurrency(value), 3);
  }
  assert.equal(resolvePreparationConcurrency('2'), 2);
  assert.equal(resolvePreparationConcurrency(100), 8);
});
