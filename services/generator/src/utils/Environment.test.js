import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDeploymentEdition,
  isDockerRuntime,
  isStandaloneEdition,
  usesExternalMediaPublishing,
  usesLocalAssetStorage,
} from './Environment.js';

test('normalizes the two deployment editions and legacy aliases', () => {
  assert.equal(getDeploymentEdition({ SAMSAR_DEPLOYMENT_EDITION: 'standalone' }), 'standalone');
  assert.equal(getDeploymentEdition({ SAMSAR_DEPLOYMENT_EDITION: 'production' }), 'production');
  assert.equal(getDeploymentEdition({ CURRENT_ENV: 'docker' }), 'standalone');
  assert.equal(getDeploymentEdition({ CURRENT_ENV: 'community' }), 'standalone');
  assert.equal(isStandaloneEdition({ SAMSAR_EDITION: 'standalone' }), true);
  assert.equal(isStandaloneEdition({ SAMSAR_EDITION: 'production' }), false);
});

test('keeps Docker runtime independent from production edition', () => {
  const productionDocker = {
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    CURRENT_ENV: 'production',
    SAMSAR_RUNTIME: 'docker',
  };
  assert.equal(getDeploymentEdition(productionDocker), 'production');
  assert.equal(isDockerRuntime(productionDocker), true);
  assert.equal(usesLocalAssetStorage(productionDocker), true);
});

test('explicit asset roots select mounted storage regardless of edition', () => {
  assert.equal(usesLocalAssetStorage({
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_ASSETS_V2_ROOT: '/assets_v2',
  }), true);
  assert.equal(isDockerRuntime({
    CURRENT_ENV: 'docker',
    SAMSAR_RUNTIME: 'server',
  }), false);
});

test('production Docker can opt into external S3 and CloudFront publishing', () => {
  const productionDocker = {
    CURRENT_ENV: 'production',
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
  };
  assert.equal(usesExternalMediaPublishing(productionDocker), false);
  assert.equal(usesExternalMediaPublishing({
    ...productionDocker,
    SAMSAR_EXTERNAL_MEDIA_PUBLISH_ENABLED: 'true',
  }), true);
  assert.equal(usesExternalMediaPublishing({
    ...productionDocker,
    SAMSAR_MEDIA_DELIVERY_MODE: 's3-cloudfront',
  }), true);
});
