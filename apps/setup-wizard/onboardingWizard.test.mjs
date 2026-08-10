import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { PROVIDER_GROUP_DEFINITIONS } from './src/constants/providerGroups.js';

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
      getInitialSetupBootstrapToken,
      hydrateBackblazeDataConfig,
    } = await vite.ssrLoadModule(
      '/src/components/OnboardingWizard.jsx',
    );

    assert.deepEqual(
      PROVIDER_GROUP_DEFINITIONS.map(({ key, title, providerKeys }) => ({ key, title, providerKeys })),
      [
        {
          key: 'inference',
          title: 'Inference',
          providerKeys: ['openai', 'googleCloud', 'alibabaCloud', 'kimi', 'openrouter'],
        },
        {
          key: 'universal',
          title: 'Universal adapters',
          providerKeys: ['gmicloud', 'samsar'],
        },
        {
          key: 'media',
          title: 'Media',
          providerKeys: ['fal', 'elevenlabs', 'runway'],
        },
      ],
    );

    assert.doesNotThrow(() => {
      renderToStaticMarkup(React.createElement(OnboardingWizard));
    });

    const localInfrastructure = buildInfrastructureConfig({
      databaseMode: 'local',
      storageMode: 'local',
    });
    assert.equal(localInfrastructure.database.mongoUrl, '');
    assert.equal(localInfrastructure.storage.accessKeyId, '');
    assert.equal(localInfrastructure.storage.secretAccessKey, '');

    const localValues = new Map();
    const sessionValues = new Map();
    let replacedUrl = '';
    const bootstrapToken = getInitialSetupBootstrapToken({
      location: {
        hash: '#bootstrap=one-time-token',
        pathname: '/',
        search: '',
      },
      localStorage: {
        getItem: (key) => localValues.get(key) || null,
        setItem: (key, value) => localValues.set(key, value),
      },
      sessionStorage: {
        getItem: (key) => sessionValues.get(key) || null,
        setItem: (key, value) => sessionValues.set(key, value),
      },
      history: {
        replaceState: (_state, _title, url) => {
          replacedUrl = url;
        },
      },
    });
    assert.equal(bootstrapToken, 'one-time-token');
    assert.equal(localValues.get('samsarSetupBootstrapToken'), 'one-time-token');
    assert.equal(replacedUrl, '/');

    const restoredBootstrapToken = getInitialSetupBootstrapToken({
      location: { hash: '', pathname: '/', search: '' },
      localStorage: {
        getItem: (key) => localValues.get(key) || null,
        setItem: (key, value) => localValues.set(key, value),
      },
      sessionStorage: {
        getItem: () => null,
        setItem: () => {},
      },
      history: { replaceState: () => {} },
    });
    assert.equal(restoredBootstrapToken, 'one-time-token');

    localValues.clear();
    sessionValues.set('samsarSetupBootstrapToken', 'legacy-session-token');
    const migratedBootstrapToken = getInitialSetupBootstrapToken({
      location: { hash: '', pathname: '/', search: '' },
      localStorage: {
        getItem: (key) => localValues.get(key) || null,
        setItem: (key, value) => localValues.set(key, value),
      },
      sessionStorage: {
        getItem: (key) => sessionValues.get(key) || null,
        setItem: (key, value) => sessionValues.set(key, value),
      },
      history: { replaceState: () => {} },
    });
    assert.equal(migratedBootstrapToken, 'legacy-session-token');
    assert.equal(localValues.get('samsarSetupBootstrapToken'), 'legacy-session-token');

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
