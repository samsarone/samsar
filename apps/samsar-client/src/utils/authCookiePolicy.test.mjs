import test from 'node:test';
import assert from 'node:assert/strict';

import { getAuthCookiePolicy } from './authCookiePolicy.mjs';

test('remote production shares auth across Samsar subdomains', () => {
  assert.deepEqual(getAuthCookiePolicy('production', 'app.samsar.one'), {
    cookieName: 'authToken',
    domain: '.samsar.one',
    isSharedAcrossSubdomains: true,
  });
});

test('Docker uses a distinct host-only auth cookie even on a Samsar subdomain', () => {
  assert.deepEqual(getAuthCookiePolicy('docker', 'admin.samsar.one'), {
    cookieName: 'samsarHostAuthToken',
    domain: null,
    isSharedAcrossSubdomains: false,
  });
});

test('staging and development use host-only auth cookies', () => {
  for (const environment of ['staging', 'development', undefined]) {
    const policy = getAuthCookiePolicy(environment, 'localhost');
    assert.equal(policy.cookieName, 'samsarHostAuthToken');
    assert.equal(policy.domain, null);
    assert.equal(policy.isSharedAcrossSubdomains, false);
  }
});

test('production builds do not share cookies from non-Samsar domains', () => {
  for (const hostname of ['customer.example', 'samsar.one.example', 'evilsamsar.one']) {
    const policy = getAuthCookiePolicy('production', hostname);
    assert.equal(policy.cookieName, 'samsarHostAuthToken');
    assert.equal(policy.domain, null);
    assert.equal(policy.isSharedAcrossSubdomains, false);
  }
});
