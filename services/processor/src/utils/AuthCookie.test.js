import assert from 'node:assert/strict';
import test from 'node:test';

import { getAuthCookieDomain, normalizeAuthCookieDomain } from './AuthCookie.js';

test('auth cookie domain accepts normalized parent domains', () => {
  assert.equal(normalizeAuthCookieDomain(' .Samsar.One '), '.samsar.one');
  assert.equal(normalizeAuthCookieDomain('app.example.com'), 'app.example.com');
});

test('auth cookie domain is omitted for local, IP, URL, and malformed values', () => {
  for (const value of [
    '',
    'localhost',
    '127.0.0.1',
    'https://example.com',
    'example.com:443',
    '../example.com',
    'single-label',
  ]) {
    assert.equal(normalizeAuthCookieDomain(value), '');
  }
});

test('SAMSAR_AUTH_COOKIE_DOMAIN takes precedence over the compatibility alias', () => {
  assert.equal(getAuthCookieDomain({
    SAMSAR_AUTH_COOKIE_DOMAIN: '.primary.example',
    AUTH_COOKIE_DOMAIN: '.fallback.example',
  }), '.primary.example');
  assert.equal(getAuthCookieDomain({ AUTH_COOKIE_DOMAIN: '.fallback.example' }), '.fallback.example');
});
