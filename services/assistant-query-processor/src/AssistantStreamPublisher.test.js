import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistantStreamPublisher } from './AssistantStreamPublisher.js';

test('slow snapshot storage coalesces progress without stalling provider consumption', async () => {
  let release; const snapshots = [];
  const publisher = createAssistantStreamPublisher(async snapshot => {
    snapshots.push(snapshot);
    if (snapshots.length === 1) await new Promise(resolve => { release = resolve; });
  }, { queryId: 'q', intervalMs: 0 });
  await publisher.onText('H');
  await publisher.onText('Hello');
  assert.equal(snapshots.length, 1);
  release();
  await publisher.finish('billing_pending');
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1].text, 'Hello');
  assert.equal(snapshots[1].status, 'billing_pending');
});

test('recovery preserves partial text and advances snapshot sequence', async () => {
  const snapshots = [];
  const publisher = createAssistantStreamPublisher(snapshot => snapshots.push(snapshot), { queryId: 'q' });
  publisher.restore({ queryId: 'q', text: 'Partial', sequence: 7 });
  await publisher.finish('interrupted');
  assert.equal(snapshots[0].text, 'Partial');
  assert.equal(snapshots[0].sequence, 8);
});

test('first text and a trailing chunk publish while the provider is still running', async () => {
  const snapshots = [];
  const publisher = createAssistantStreamPublisher(snapshot => snapshots.push(snapshot), { queryId: 'q', intervalMs: 20 });
  await publisher.finish('streaming');
  await publisher.onText('First');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(snapshots.at(-1).text, 'First');
  await publisher.onText('First sentence');
  // No more provider events and no finish call: the buffered text must flush.
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(snapshots.at(-1).text, 'First sentence');
  assert.equal(snapshots.at(-1).status, 'streaming');
  await publisher.finish('billing_pending');
});

test('finishing flushes pending text once and cancels trailing progress writes', async () => {
  const snapshots = [];
  const publisher = createAssistantStreamPublisher(snapshot => snapshots.push(snapshot), { queryId: 'q', intervalMs: 20 });
  await publisher.onText('First');
  await new Promise(resolve => setImmediate(resolve));
  await publisher.onText('Last');
  await publisher.finish('interrupted');
  await publisher.onText('Late callback');
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots.at(-1).text, 'Last');
  assert.equal(snapshots.at(-1).status, 'interrupted');
});
