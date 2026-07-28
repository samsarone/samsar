import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRODUCTION_DEPLOYMENT_EDITION,
  STANDALONE_DEPLOYMENT_EDITION,
  normalizeDeploymentEdition,
  resolveDeploymentEdition,
} from './deploymentEdition.mjs';

test('normalizes supported deployment editions and legacy standalone aliases', () => {
  assert.equal(normalizeDeploymentEdition('production'), PRODUCTION_DEPLOYMENT_EDITION);
  assert.equal(normalizeDeploymentEdition('standalone'), STANDALONE_DEPLOYMENT_EDITION);
  assert.equal(normalizeDeploymentEdition('community'), STANDALONE_DEPLOYMENT_EDITION);
  assert.equal(normalizeDeploymentEdition('docker'), STANDALONE_DEPLOYMENT_EDITION);
  assert.equal(normalizeDeploymentEdition('staging'), null);
});

test('prefers the explicit edition over legacy environment signals', () => {
  assert.equal(resolveDeploymentEdition({
    deploymentEdition: 'production',
    currentEnvironment: 'docker',
    legacyDockerInstall: 'true',
  }), PRODUCTION_DEPLOYMENT_EDITION);
});

test('falls back through current environment and the legacy Docker flag', () => {
  assert.equal(resolveDeploymentEdition({
    currentEnvironment: 'community',
  }), STANDALONE_DEPLOYMENT_EDITION);
  assert.equal(resolveDeploymentEdition({
    currentEnvironment: 'development',
    legacyDockerInstall: 'true',
  }), STANDALONE_DEPLOYMENT_EDITION);
  assert.equal(resolveDeploymentEdition({
    currentEnvironment: 'development',
    legacyDockerInstall: 'false',
  }), PRODUCTION_DEPLOYMENT_EDITION);
});

test('defaults to production when no recognized edition signal is present', () => {
  assert.equal(resolveDeploymentEdition(), PRODUCTION_DEPLOYMENT_EDITION);
});
