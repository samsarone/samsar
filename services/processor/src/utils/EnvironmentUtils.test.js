import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEPLOYMENT_EDITION,
  DEPLOYMENT_RUNTIME,
  getDeploymentEdition,
  getDeploymentRuntime,
  isGoogleLoginEnabled,
  isPublicRegistrationEnabled,
  isSetupAdminBootstrapEnabled,
  shouldBypassGenerationCredits,
  shouldDefaultProviderUsageAuditEnabled,
} from './EnvironmentUtils.js';

test('deployment edition normalizes legacy community and docker values to standalone', () => {
  for (const value of ['standalone', 'community', 'docker']) {
    assert.equal(
      getDeploymentEdition({ CURRENT_ENV: value }),
      DEPLOYMENT_EDITION.STANDALONE,
    );
  }
  assert.equal(
    getDeploymentEdition({ CURRENT_ENV: 'production' }),
    DEPLOYMENT_EDITION.PRODUCTION,
  );
});

test('explicit deployment edition takes precedence over legacy CURRENT_ENV', () => {
  assert.equal(
    getDeploymentEdition({
      SAMSAR_DEPLOYMENT_EDITION: 'production',
      SAMSAR_EDITION: 'standalone',
      CURRENT_ENV: 'docker',
    }),
    DEPLOYMENT_EDITION.PRODUCTION,
  );
  assert.equal(
    getDeploymentEdition({
      SAMSAR_EDITION: 'community',
      CURRENT_ENV: 'production',
    }),
    DEPLOYMENT_EDITION.STANDALONE,
  );
});

test('SAMSAR_RUNTIME independently controls container behavior', () => {
  assert.equal(
    getDeploymentRuntime({
      SAMSAR_DEPLOYMENT_EDITION: 'production',
      SAMSAR_RUNTIME: 'docker',
      CURRENT_ENV: 'production',
    }),
    DEPLOYMENT_RUNTIME.CONTAINER,
  );
  assert.equal(
    getDeploymentRuntime({ SAMSAR_RUNTIME: 'host', CURRENT_ENV: 'docker' }),
    DEPLOYMENT_RUNTIME.HOST,
  );
  assert.equal(
    getDeploymentRuntime({ CURRENT_ENV: 'community' }),
    DEPLOYMENT_RUNTIME.CONTAINER,
  );
  assert.equal(
    getDeploymentRuntime({ SAMSAR_DEPLOYMENT_RUNTIME: 'Kubernetes' }),
    DEPLOYMENT_RUNTIME.CONTAINER,
  );
});

test('mounted asset roots preserve production Compose runtime compatibility', () => {
  assert.equal(
    getDeploymentRuntime({
      CURRENT_ENV: 'production',
      SAMSAR_ASSETS_V2_ROOT: '/assets_v2',
    }),
    DEPLOYMENT_RUNTIME.CONTAINER,
  );
});

test('auth and billing policies follow edition rather than runtime', () => {
  const productionDocker = {
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    SAMSAR_RUNTIME: 'docker',
  };
  assert.equal(isPublicRegistrationEnabled(productionDocker), true);
  assert.equal(isGoogleLoginEnabled(productionDocker), true);
  assert.equal(isSetupAdminBootstrapEnabled(productionDocker), false);
  assert.equal(shouldBypassGenerationCredits(productionDocker), false);
  assert.equal(shouldDefaultProviderUsageAuditEnabled(productionDocker), false);

  const standaloneDocker = {
    SAMSAR_DEPLOYMENT_EDITION: 'standalone',
    SAMSAR_RUNTIME: 'docker',
  };
  assert.equal(isPublicRegistrationEnabled(standaloneDocker), false);
  assert.equal(isGoogleLoginEnabled(standaloneDocker), false);
  assert.equal(isSetupAdminBootstrapEnabled(standaloneDocker), true);
  assert.equal(shouldBypassGenerationCredits(standaloneDocker), true);
  assert.equal(shouldDefaultProviderUsageAuditEnabled(standaloneDocker), true);
});
