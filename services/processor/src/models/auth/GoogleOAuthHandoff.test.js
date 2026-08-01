import assert from 'node:assert/strict';
import test from 'node:test';

import {
  consumeGoogleOAuthHandoff,
  issueGoogleOAuthHandoff,
} from './GoogleOAuthHandoff.js';

function createMemoryModel() {
  const records = [];
  return {
    records,
    async create(record) {
      records.push({ ...record });
      return record;
    },
    findOneAndDelete(query) {
      return {
        async lean() {
          const index = records.findIndex((record) => (
            record.codeHash === query.codeHash &&
            record.nonceHash === query.nonceHash &&
            record.expiresAt > query.expiresAt.$gt
          ));
          if (index < 0) return null;
          return records.splice(index, 1)[0];
        },
      };
    },
  };
}

test('handoff codes are hashed, short-lived, nonce-bound, and atomically single-use', async () => {
  const model = createMemoryModel();
  const issuedAt = new Date('2026-08-01T00:00:00.000Z');
  const nonce = 'N'.repeat(43);
  const nonceHash = (await import('./GoogleOAuthState.js')).hashGoogleOAuthValue(nonce);
  const connect = async () => {};
  const handoff = await issueGoogleOAuthHandoff({
    userId: 'user-123',
    nonceHash,
    redirect: '/blog/a-post/#comments',
    isNewUser: true,
  }, {
    model,
    connect,
    now: () => issuedAt,
    randomBytesImpl: () => Buffer.alloc(32, 7),
    env: { SAMSAR_GOOGLE_OAUTH_HANDOFF_TTL_SECONDS: '45' },
  });

  assert.match(handoff.code, /^[A-Za-z0-9_-]{32,128}$/);
  assert.notEqual(model.records[0].codeHash, handoff.code);
  assert.equal(model.records[0].nonceHash, nonceHash);
  assert.equal(model.records[0].expiresAt.toISOString(), '2026-08-01T00:00:45.000Z');

  await assert.rejects(
    consumeGoogleOAuthHandoff({ code: handoff.code, nonce: 'X'.repeat(43) }, {
      model,
      connect,
      now: () => new Date('2026-08-01T00:00:01.000Z'),
    }),
    /invalid or has expired/,
  );
  assert.equal(model.records.length, 1, 'a nonce mismatch must not consume the code');

  assert.deepEqual(await consumeGoogleOAuthHandoff({ code: handoff.code, nonce }, {
    model,
    connect,
    now: () => new Date('2026-08-01T00:00:01.000Z'),
  }), {
    userId: 'user-123',
    redirect: '/blog/a-post/#comments',
    isNewUser: true,
  });
  assert.equal(model.records.length, 0);

  await assert.rejects(
    consumeGoogleOAuthHandoff({ code: handoff.code, nonce }, {
      model,
      connect,
      now: () => new Date('2026-08-01T00:00:02.000Z'),
    }),
    /invalid or has expired/,
  );
});

test('expired handoff codes cannot be exchanged', async () => {
  const model = createMemoryModel();
  const nonce = 'Z'.repeat(43);
  const nonceHash = (await import('./GoogleOAuthState.js')).hashGoogleOAuthValue(nonce);
  const connect = async () => {};
  const handoff = await issueGoogleOAuthHandoff({
    userId: 'user-456',
    nonceHash,
    redirect: '/blog/',
  }, {
    model,
    connect,
    now: () => new Date('2026-08-01T00:00:00.000Z'),
    randomBytesImpl: () => Buffer.alloc(32, 8),
    env: { SAMSAR_GOOGLE_OAUTH_HANDOFF_TTL_SECONDS: '30' },
  });

  await assert.rejects(
    consumeGoogleOAuthHandoff({ code: handoff.code, nonce }, {
      model,
      connect,
      now: () => new Date('2026-08-01T00:00:31.000Z'),
    }),
    /invalid or has expired/,
  );
  assert.equal(model.records.length, 1, 'TTL cleanup is asynchronous; expiry is still enforced in the query');
});
