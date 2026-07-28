import assert from 'node:assert/strict';
import test from 'node:test';

import express from 'express';

import usersRouter from './users.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_RUNTIME',
];
const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function withUsersServer(callback) {
  const app = express();
  app.use(express.json());
  app.use('/users', usersRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    return await callback(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test.afterEach(restoreEnv);

test('production does not expose model adapter preference routes', async () => {
  process.env.CURRENT_ENV = 'production';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'production';
  process.env.SAMSAR_RUNTIME = 'docker';

  await withUsersServer(async (baseUrl) => {
    const getResponse = await fetch(`${baseUrl}/users/model_adapters`);
    const putResponse = await fetch(`${baseUrl}/users/model_adapters`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modelProviderPriority: {} }),
    });

    assert.equal(getResponse.status, 404);
    assert.equal(putResponse.status, 404);
  });
});

test('standalone model adapter routes require authentication', async () => {
  process.env.CURRENT_ENV = 'standalone';
  process.env.SAMSAR_DEPLOYMENT_EDITION = 'standalone';
  process.env.SAMSAR_RUNTIME = 'docker';

  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    await withUsersServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/users/model_adapters`);
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: 'Unauthorized' });
    });
  } finally {
    console.error = originalConsoleError;
  }
});
