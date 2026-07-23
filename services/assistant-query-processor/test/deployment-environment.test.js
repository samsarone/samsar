import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDeploymentEdition,
  isDockerRuntime,
  isStandaloneEdition,
} from '../src/DeploymentEnvironment.js';

test('separates deployment edition from container runtime', () => {
  const env = {
    SAMSAR_DEPLOYMENT_EDITION: 'production',
    CURRENT_ENV: 'production',
    SAMSAR_RUNTIME: 'docker',
  };
  assert.equal(getDeploymentEdition(env), 'production');
  assert.equal(isStandaloneEdition(env), false);
  assert.equal(isDockerRuntime(env), true);
});

test('maps legacy docker and community editions to standalone', () => {
  assert.equal(getDeploymentEdition({ CURRENT_ENV: 'docker' }), 'standalone');
  assert.equal(getDeploymentEdition({ SAMSAR_EDITION: 'community' }), 'standalone');
  assert.equal(isStandaloneEdition({ SAMSAR_DEPLOYMENT_EDITION: 'standalone' }), true);
});
