import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAuthCookiePolicy,
  normalizeAuthCookieDomain,
  resolveAuthCookieDomain,
} from './authCookiePolicy.mjs';

test('production shares auth across an explicitly configured hosted domain', () => {
  assert.deepEqual(getAuthCookiePolicy('production', 'app.samsar.one', '.samsar.one'), {
    cookieName: 'authToken',
    domain: '.samsar.one',
    isSharedAcrossSubdomains: true,
  });
});

test('production supports custom shared domains', () => {
  assert.deepEqual(getAuthCookiePolicy('production', 'studio.customer.example', 'customer.example'), {
    cookieName: 'authToken',
    domain: '.customer.example',
    isSharedAcrossSubdomains: true,
  });
});

test('production is host-only when no cookie domain is configured', () => {
  assert.deepEqual(getAuthCookiePolicy('production', 'app.samsar.one'), {
    cookieName: 'authToken',
    domain: null,
    isSharedAcrossSubdomains: false,
  });
});

test('standalone and legacy non-production aliases stay host-only', () => {
  for (const environment of ['community', 'standalone', 'docker', 'staging', 'development', undefined]) {
    const policy = getAuthCookiePolicy(environment, 'app.samsar.one', '.samsar.one');
    assert.equal(policy.cookieName, 'samsarHostAuthToken');
    assert.equal(policy.domain, null);
    assert.equal(policy.isSharedAcrossSubdomains, false);
  }
});

test('invalid or mismatched domains fall back to host-only cookies', () => {
  for (const [configuredDomain, hostname] of [
    ['.samsar.one', 'customer.example'],
    ['https://samsar.one', 'app.samsar.one'],
    ['localhost', 'localhost'],
    ['.com', 'app.com'],
  ]) {
    const policy = getAuthCookiePolicy('production', hostname, configuredDomain);
    assert.equal(policy.cookieName, 'authToken');
    assert.equal(policy.domain, null);
    assert.equal(policy.isSharedAcrossSubdomains, false);
  }
});

test('cookie domains are normalized and limited to the current host hierarchy', () => {
  assert.equal(normalizeAuthCookieDomain(' Customer.Example. '), '.customer.example');
  assert.equal(resolveAuthCookieDomain('.customer.example', 'studio.customer.example'), '.customer.example');
  assert.equal(resolveAuthCookieDomain('.customer.example', 'notcustomer.example'), null);
});
