import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { openServerSentEvents, serveAssistantSnapshots } from './ServerSentEvents.js';

export class Response extends EventEmitter {
  frames = [];
  status(value) { this.statusCode = value; return this; }
  set(value) { this.headers = value; }
  write(value) { this.frames.push(value); return true; }
  end() { this.writableEnded = true; this.emit('close'); }
  destroy() { this.destroyed = true; this.emit('close'); }
}

test('SSE authorizes before opening headers and rechecks each snapshot', async () => {
  const rejected = new Response();
  await assert.rejects(serveAssistantSnapshots(rejected, async () => { throw new Error('Denied'); }), /Denied/);
  assert.equal(rejected.statusCode, undefined);
  const res = new Response(); let reads = 0;
  await serveAssistantSnapshots(res, async () => {
    if (++reads > 1) throw Object.assign(new Error('Access revoked'), { status: 403 });
    return { sessionMessageGenerationPending: true, assistantSessionVersion: 2 };
  }, { pollMs: 1 });
  assert.equal(reads, 2);
  assert.match(res.frames.join(''), /event: error\ndata: .*403/);
  assert.equal(res.writableEnded, true);
});

test('snapshots replace state through completion and disable proxy buffering', async () => {
  const res = new Response(); let reads = 0;
  await serveAssistantSnapshots(res, async () => ({ assistantSessionVersion: 1,
    sessionMessageGenerationPending: ++reads < 3,
    assistantStream: { queryId: 'q', sequence: reads, text: 'hello'.slice(0, reads), status: reads < 3 ? 'streaming' : 'completed' },
  }), { pollMs: 1 });
  assert.equal(res.headers['X-Accel-Buffering'], 'no');
  assert.equal(res.frames.filter(frame => frame.includes('event: snapshot')).length, 3);
  assert.match(res.frames.at(-1), /event: settled/);
});

test('a disconnected or slow reader closes cleanly without buffering indefinitely', async () => {
  const res = new Response(); const stream = openServerSentEvents(res);
  res.writableLength = 2 * 1024 * 1024;
  assert.equal(stream.send('snapshot', { text: 'test' }), false);
  assert.equal(stream.closed, true);
  assert.equal(res.destroyed, true);
  assert.equal(stream.send('completed', {}), false);
  stream.end();
});

test('bounded streams explicitly request reconnect and retain latest snapshot identity', async () => {
  const res = new Response();
  await serveAssistantSnapshots(res, async () => ({ assistantSessionVersion: 3,
    sessionMessageGenerationPending: true, assistantStream: { queryId: 'query', sequence: 8, status: 'streaming' },
  }), { pollMs: 2, maxMs: 5 });
  assert.match(res.frames[0], /id: 3:query:8:streaming/);
  assert.equal(res.frames.filter(frame => frame.includes('event: snapshot')).length, 1);
  assert.match(res.frames.at(-1), /event: reconnect/);
});

test('flushes each snapshot while the response remains open', () => {
  const res = new Response();
  let flushed = '';
  res.flush = () => { flushed = res.frames.join(''); };
  const stream = openServerSentEvents(res);
  stream.send('snapshot', { text: 'First words' });
  assert.match(flushed, /First words/);
  assert.ok(!res.writableEnded);
  stream.send('snapshot', { text: 'First words continue' });
  assert.match(flushed, /First words continue/);
  stream.end();
});
