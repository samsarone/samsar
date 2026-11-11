import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
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

async function createHttpSseServer(t) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    requests.push({ url: req.url, connection: req.headers.connection, socket: req.socket });
    if (req.url === '/stream') {
      res.status = (status) => { res.statusCode = status; return res; };
      res.set = (headers) => {
        for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
        return res;
      };
      await serveAssistantSnapshots(res, async () => ({
        assistantSessionVersion: 1,
        sessionMessageGenerationPending: true,
        assistantStream: { queryId: 'query', sequence: 1, status: 'streaming' },
      }), { pollMs: 1, maxMs: 5 });
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'PENDING' }));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return { port: server.address().port, requests };
}

function getHttpResponse(port, path, agent = false) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port, path, agent }, (res) => {
      const socket = res.socket;
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body, socket }));
    }).once('error', reject);
  });
}

test('SSE closes a Connection: close socket before a subsequent status request', { timeout: 3000 }, async (t) => {
  const { port, requests } = await createHttpSseServer(t);
  const response = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let raw = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SSE kept a Connection: close request socket open.'));
    }, 1000);
    socket.setEncoding('utf8');
    socket.once('connect', () => socket.write(
      'GET /stream HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n',
    ));
    socket.on('data', (chunk) => { raw += chunk; });
    socket.once('error', (error) => { clearTimeout(timer); reject(error); });
    socket.once('end', () => { clearTimeout(timer); resolve(raw); });
  });
  assert.match(response, /^HTTP\/1\.1 200 /);
  assert.match(response, /\r\nConnection: close\r\n/i);
  assert.match(response, /event: reconnect/);
  assert.ok(response.endsWith('0\r\n\r\n'));

  const status = await getHttpResponse(port, '/status');
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.body), { status: 'PENDING' });
  assert.deepEqual(requests.map(({ url }) => url), ['/stream', '/status']);
  assert.notStrictEqual(requests[0].socket, requests[1].socket);
});

test('HTTP/1.1 SSE naturally reuses a keep-alive socket for the next status request', { timeout: 3000 }, async (t) => {
  const { port, requests } = await createHttpSseServer(t);
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  t.after(() => agent.destroy());
  const stream = await getHttpResponse(port, '/stream', agent);
  assert.equal(stream.status, 200);
  assert.equal(stream.headers.connection, 'keep-alive');
  assert.match(stream.body, /event: reconnect/);

  const status = await getHttpResponse(port, '/status', agent);
  assert.equal(status.status, 200);
  assert.deepEqual(JSON.parse(status.body), { status: 'PENDING' });
  assert.strictEqual(stream.socket, status.socket);
  assert.deepEqual(requests.map(({ url }) => url), ['/stream', '/status']);
  assert.equal(requests[0].connection, 'keep-alive');
  assert.strictEqual(requests[0].socket, requests[1].socket);
});
