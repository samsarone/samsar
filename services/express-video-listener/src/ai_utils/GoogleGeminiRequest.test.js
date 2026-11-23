import test from 'node:test';
import assert from 'node:assert/strict';
import { runGoogleGeminiRequest } from './GoogleGeminiRequest.js';

for (const failurePoint of ['headers', 'body', 'abort', 'malformed-json']) {
  test(`Gemini marks an unconfirmed ${failurePoint} failure as uncertain without replaying the POST`, async () => {
    let dispatches = 0;
    const { logger, events } = captureLogs();
    const original = Object.assign(new Error('private request detail'), failurePoint === 'abort'
      ? { name: 'AbortError' } : { code: 'ECONNRESET' });
    await assert.rejects(runGoogleGeminiRequest('https://provider.invalid', {}, {
      timeoutMs: 50, logger,
      fetchImpl: async () => {
        dispatches++;
        if (failurePoint === 'headers' || failurePoint === 'abort') throw original;
        return { ok: true, status: 200,
          text: async () => {
            if (failurePoint === 'body') throw original;
            return '{"private request detail":';
          } };
      },
    }), error => {
      assert.equal(error.providerOutcomeUncertain, true);
      assert.equal(error.retryable, false);
      assert.equal(typeof error.requestId, 'string');
      if (failurePoint !== 'malformed-json') assert.equal(error, original);
      return true;
    });
    assert.equal(dispatches, 1);
    assert.equal(events.at(-1).details.providerOutcomeUncertain, true);
    assert.equal(JSON.stringify(events).includes('private request detail'), false);
  });
}


function captureLogs() {
  const events = [];
  return {
    events,
    logger: Object.fromEntries(['info', 'warn', 'error'].map(level => [level,
      (event, details) => events.push({ level, event, details })])),
  };
}

for (const ok of [true, false]) {
  test(`Gemini deadline aborts a stalled ${ok ? 'success' : 'error'} response body without redispatching`, async () => {
    let fetchCount = 0;
    let signal;
    let destroyed = false;
    const { events, logger } = captureLogs();
    await assert.rejects(runGoogleGeminiRequest('https://provider.invalid', {}, {
      timeoutMs: 15, logger,
      fetchImpl: async (_url, request) => {
        fetchCount++;
        signal = request.signal;
        return {
          ok, status: ok ? 200 : 500,
          body: { destroy() { destroyed = true; } },
          text: () => new Promise(() => {}),
        };
      },
    }), error => {
      assert.equal(error.name, 'GoogleGeminiTimeoutError');
      assert.equal(error.code, 'ETIMEDOUT');
      assert.equal(error.status, 504);
      assert.equal(error.providerOutcomeUncertain, true);
      assert.equal(error.retryable, false);
      return true;
    });
    assert.equal(fetchCount, 1);
    assert.equal(signal.aborted, true);
    assert.equal(destroyed, true);
    assert.equal(events.at(-1).event, '[inference][google_gemini] request_timed_out');
    assert.equal(events.at(-1).details.phase, 'body');
  });
}

test('Gemini headers deadline settles even if fetch ignores abort and never returns', async () => {
  let signal;
  let fetchCount = 0;
  const { logger, events } = captureLogs();
  await assert.rejects(runGoogleGeminiRequest('https://provider.invalid', {}, {
    timeoutMs: 15, logger,
    fetchImpl: async (_url, request) => {
      signal = request.signal;
      fetchCount++;
      return new Promise(() => {});
    },
  }), { code: 'ETIMEDOUT' });
  assert.equal(fetchCount, 1);
  assert.equal(signal.aborted, true);
  assert.equal(events.at(-1).details.phase, 'headers');
});

test('Gemini streaming deadline remains active until stream collection finishes', async () => {
  let signal;
  const { logger } = captureLogs();
  await assert.rejects(runGoogleGeminiRequest('https://provider.invalid', {}, {
    timeoutMs: 15, logger, onText: () => {},
    collectStream: () => new Promise(() => {}),
    fetchImpl: async (_url, request) => {
      signal = request.signal;
      return { ok: true, status: 200, body: {} };
    },
  }), { code: 'ETIMEDOUT' });
  assert.equal(signal.aborted, true);
});

test('Gemini diagnostics retain safe finish/usage context and exclude prompts, output and credentials', async () => {
  const secret = 'DO-NOT-LOG-PROMPT-OUTPUT-OR-CREDENTIAL';
  const { logger, events } = captureLogs();
  let fetchCount = 0;
  let signal;
  const payload = {
    responseId: 'provider-receipt', candidates: [{
      content: { parts: [{ text: secret }] }, finishReason: 'STOP',
    }],
    usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 3, thoughtsTokenCount: 7, totalTokenCount: 21 },
  };
  const result = await runGoogleGeminiRequest('https://provider.invalid/' + secret, {
    body: secret, headers: { authorization: secret },
  }, {
    timeoutMs: 20, logger, model: 'gemini-4-carbon', sessionId: 'session', requestKey: 'repair:attempt-1',
    fetchImpl: async (_url, request) => {
      fetchCount++;
      signal = request.signal;
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    },
  });
  assert.deepEqual(result, payload);
  assert.equal(fetchCount, 1);
  assert.equal(events.at(-1).details.providerRequestId, 'provider-receipt');
  assert.equal(events.at(-1).details.finishReason, 'STOP');
  assert.equal(events.at(-1).details.characterCount, secret.length);
  assert.equal(events.at(-1).details.usage.thinkingTokens, 7);
  assert.equal(events.at(-1).details.sessionId, 'session');
  assert.equal(events.at(-1).details.requestKey, 'repair:attempt-1');
  assert.equal(JSON.stringify(events).includes(secret), false);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(signal.aborted, false, 'completion must clear the deadline');
});

test('Gemini empty completion records finish reason and blocking metadata without rejecting accounted usage', async () => {
  const { logger, events } = captureLogs();
  const payload = { candidates: [{ finishReason: 'MAX_TOKENS' }],
    promptFeedback: { blockReason: 'SAFETY', blockReasonMessage: 'private input' },
    usageMetadata: { thoughtsTokenCount: 300 } };
  const result = await runGoogleGeminiRequest('https://provider.invalid', {}, {
    timeoutMs: 50, logger,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(payload) }),
  });
  assert.deepEqual(result, payload);
  assert.equal(events.at(-1).level, 'warn');
  assert.equal(events.at(-1).details.characterCount, 0);
  assert.equal(events.at(-1).details.finishReason, 'MAX_TOKENS');
  assert.equal(events.at(-1).details.blockReason, 'SAFETY');
  assert.equal(JSON.stringify(events).includes('private input'), false);
});

test('Gemini provider errors preserve status but never log provider messages', async () => {
  const { logger, events } = captureLogs();
  await assert.rejects(runGoogleGeminiRequest('https://provider.invalid', {}, {
    timeoutMs: 50, logger,
    fetchImpl: async () => ({ ok: false, status: 429,
      text: async () => JSON.stringify({ error: { message: 'private provider text', status: 'RESOURCE_EXHAUSTED' } }) }),
  }), error => {
    assert.equal(error.status, 429);
    assert.equal(error.message, 'private provider text');
    assert.equal(error.providerOutcomeUncertain, undefined);
    assert.equal(error.retryable, undefined);
    return true;
  });
  assert.equal(events.at(-1).event, '[inference][google_gemini] request_failed');
  assert.equal(JSON.stringify(events).includes('private provider text'), false);
});

test('Gemini successful streaming returns collected payload with exactly one dispatch', async () => {
  const { logger } = captureLogs();
  let fetchCount = 0;
  const chunks = [];
  const payload = { candidates: [{ content: { parts: [{ text: 'done' }] }, finishReason: 'STOP' }] };
  const result = await runGoogleGeminiRequest('https://provider.invalid', {}, {
    timeoutMs: 50, logger, onText: text => chunks.push(text),
    collectStream: async (_body, onText) => { onText('done'); return payload; },
    fetchImpl: async () => { fetchCount++; return { ok: true, status: 200, body: {} }; },
  });
  assert.equal(fetchCount, 1);
  assert.deepEqual(result, payload);
  assert.deepEqual(chunks, ['done']);
});
