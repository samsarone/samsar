import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldUseDirectDockerMail } from './MailTransport.js';

const ENV_KEYS = [
  'CURRENT_ENV',
  'SAMSAR_DEPLOYMENT_EDITION',
  'SAMSAR_RUNTIME',
  'MAIL_PROVIDER',
  'SMTP_HOST',
];
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

function setEnvironment(values) {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

test.afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

test('production Docker preserves the queued production mail path', () => {
  setEnvironment({
    CURRENT_ENV: 'production',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
    MAIL_PROVIDER: 'smtp',
    SMTP_HOST: 'smtp.example.com',
  });
  assert.equal(shouldUseDirectDockerMail(), false);
});

test('standalone uses direct mail only when it is explicitly configured', () => {
  setEnvironment({
    CURRENT_ENV: 'standalone',
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_RUNTIME: 'docker',
  });
  assert.equal(shouldUseDirectDockerMail(), false);

  process.env.MAIL_PROVIDER = 'smtp';
  process.env.SMTP_HOST = 'smtp.example.com';
  assert.equal(shouldUseDirectDockerMail(), true);
});
