import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OPENROUTER_KEY_VALIDATION_URL,
  createOpenRouterValidationRegistry,
  validateOpenRouterProviderCredential,
} from './openrouterValidation.mjs';

test('validates an OpenRouter credential against the authenticated key endpoint', async () => {
  let observedRequest = null;
  const result = await validateOpenRouterProviderCredential({
    openrouterApiKey: 'openrouter-test-key',
  }, {
    fetchImpl: async (url, options) => {
      observedRequest = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { label: 'test-key' } }),
      };
    },
  });

  assert.equal(observedRequest.url, OPENROUTER_KEY_VALIDATION_URL);
  assert.equal(observedRequest.options.headers.Authorization, 'Bearer openrouter-test-key');
  assert.equal(result.providers.openrouter.ok, true);
  assert.equal(result.providers.openrouter.validationMode, 'remote_key');
});

test('rejects invalid keys and public catalog-shaped responses', async () => {
  await assert.rejects(
    validateOpenRouterProviderCredential({ openrouterApiKey: 'invalid-key' }, {
      fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Unauthorized' } }),
      }),
    }),
    /rejected the API key/i,
  );

  await assert.rejects(
    validateOpenRouterProviderCredential({ openrouterApiKey: 'invalid-key' }, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [] }),
      }),
    }),
    /key-validation response/i,
  );
});

test('rejects management keys that cannot call inference endpoints', async () => {
  await assert.rejects(
    validateOpenRouterProviderCredential({ openrouterApiKey: 'management-key' }, {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { is_management_key: true } }),
      }),
    }),
    /management keys cannot be used for inference/i,
  );
});

test('reports upstream validation failures without claiming the key was rejected', async () => {
  await assert.rejects(
    validateOpenRouterProviderCredential({ openrouterApiKey: 'possibly-valid-key' }, {
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: { message: 'Internal server error' } }),
      }),
    }),
    /validation failed with status 500/i,
  );
});

test('skips validation when no OpenRouter key was entered', async () => {
  assert.deepEqual(await validateOpenRouterProviderCredential(), { providers: {} });
});

test('binds validation tokens to a credential and consumes them once', () => {
  let tokenIndex = 0;
  const registry = createOpenRouterValidationRegistry({
    tokenFactory: () => `token-${++tokenIndex}`,
  });

  const matchingToken = registry.register('openrouter-key');
  assert.equal(registry.consume(matchingToken, 'openrouter-key'), true);
  assert.equal(registry.consume(matchingToken, 'openrouter-key'), false);

  const mismatchedToken = registry.register('openrouter-key');
  assert.equal(registry.consume(mismatchedToken, 'changed-key'), false);
  assert.equal(registry.consume(mismatchedToken, 'openrouter-key'), false);
});

test('expires validation tokens after the configured TTL', () => {
  let currentTime = 1_000;
  const registry = createOpenRouterValidationRegistry({
    ttlMs: 500,
    now: () => currentTime,
    tokenFactory: () => 'expiring-token',
  });

  const token = registry.register('openrouter-key');
  currentTime = 1_500;
  assert.equal(registry.consume(token, 'openrouter-key'), false);
});
