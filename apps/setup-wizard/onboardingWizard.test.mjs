import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

test('fresh setup wizard renders before provider validation exists', async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL('.', import.meta.url)),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
  });

  try {
    const {
      default: OnboardingWizard,
      buildInfrastructureConfig,
      hydrateBackblazeDataConfig,
    } = await vite.ssrLoadModule(
      '/src/components/OnboardingWizard.jsx',
    );

    assert.doesNotThrow(() => {
      renderToStaticMarkup(React.createElement(OnboardingWizard));
    });

    const infrastructure = buildInfrastructureConfig({
      storageMode: 'backblazeB2',
      s3Bucket: 'customer-media',
      s3Region: 'wrong-region-is-ignored',
      s3Endpoint: 's3.us-east-005.backblazeb2.com',
      backblazeCredentialType: 'master',
      s3AccessKeyId: 'application-key-id',
      s3SecretAccessKey: 'application-key',
      staticCdnUrl: 'https://obsolete.example.com/',
    });
    assert.equal(infrastructure.storage.mediaBucketName, 'customer-media');
    assert.equal(infrastructure.storage.region, 'us-east-005');
    assert.equal(infrastructure.storage.credentialType, 'master');
    assert.equal(
      infrastructure.storage.s3Endpoint,
      'https://s3.us-east-005.backblazeb2.com',
    );
    assert.equal(
      infrastructure.storage.staticCdnUrl,
      'https://customer-media.s3.us-east-005.backblazeb2.com/',
    );

    const hydrated = hydrateBackblazeDataConfig({
      storageMode: 'backblazeB2',
      s3Bucket: '',
      s3Endpoint: '',
    }, {
      mode: 'backblaze-b2',
      mediaBucketName: 'saved-customer-media',
      s3Endpoint: 'https://s3.us-east-005.backblazeb2.com',
      staticCdnUrl: 'https://saved-customer-media.s3.us-east-005.backblazeb2.com/',
      credentialType: 'application',
      accessKeyId: 'must-not-be-exposed',
      secretAccessKey: 'must-not-be-exposed',
    });
    assert.equal(hydrated.s3Bucket, 'saved-customer-media');
    assert.equal(hydrated.s3Endpoint, 'https://s3.us-east-005.backblazeb2.com');
    assert.equal(hydrated.backblazeCredentialType, 'application');
    assert.equal(hydrated.s3AccessKeyId, '');
    assert.equal(hydrated.s3SecretAccessKey, '');
  } finally {
    await vite.close();
  }
});
