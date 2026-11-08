import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import { buildSecureMediaDeliveryUrl, withMediaDeliveryUrlCache } from './AWS.js';

test('media signing is reused within a response, isolated across concurrent responses, and refreshed next time', async (t) => {
  const configuration = {
    CURRENT_ENV: 'production', SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_MEDIA_DELIVERY_MODE: 'external-s3',
    CLOUDFRONT_KEY_PAIR_ID: 'test-pair', CLOUDFRONT_PRIVATE_KEY: 'fake-key-for-mocked-signer',
    CLOUDFRONT_PRIVATE_KEY_BASE64: '', AWS_CLOUDFRONT_PRIVATE_KEY_BASE64: '',
  };
  for (const [key, value] of Object.entries(configuration)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => previous === undefined ? delete process.env[key] : (process.env[key] = previous));
  }
  const signer = t.mock.method(crypto, 'createSign', () => ({ update() {}, sign() { return Buffer.from('test-signature'); } }));
  const key = 'assets_v2/video/test.mp4';
  await Promise.all([0, 1].map(() => withMediaDeliveryUrlCache(async () => {
    const first = buildSecureMediaDeliveryUrl(key);
    await Promise.resolve();
    assert.equal(buildSecureMediaDeliveryUrl(key), first);
    assert.equal(withMediaDeliveryUrlCache(() => buildSecureMediaDeliveryUrl(key)), first);
    assert.equal(buildSecureMediaDeliveryUrl('https://unrelated.example/test.mp4'), null);
  })));
  assert.equal(signer.mock.callCount(), 2);
  withMediaDeliveryUrlCache(() => buildSecureMediaDeliveryUrl(key));
  assert.equal(signer.mock.callCount(), 3);
  buildSecureMediaDeliveryUrl(key);
  buildSecureMediaDeliveryUrl(key);
  assert.equal(signer.mock.callCount(), 5);
});
