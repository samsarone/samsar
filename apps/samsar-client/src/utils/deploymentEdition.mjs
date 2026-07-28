export const PRODUCTION_DEPLOYMENT_EDITION = 'production';
export const STANDALONE_DEPLOYMENT_EDITION = 'standalone';

const PRODUCTION_ALIASES = new Set([
  PRODUCTION_DEPLOYMENT_EDITION,
  'hosted',
]);

const STANDALONE_ALIASES = new Set([
  STANDALONE_DEPLOYMENT_EDITION,
  'community',
  'docker',
]);

function normalizeString(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeDeploymentEdition(value) {
  const normalizedValue = normalizeString(value);
  if (PRODUCTION_ALIASES.has(normalizedValue)) {
    return PRODUCTION_DEPLOYMENT_EDITION;
  }
  if (STANDALONE_ALIASES.has(normalizedValue)) {
    return STANDALONE_DEPLOYMENT_EDITION;
  }
  return null;
}

export function resolveDeploymentEdition({
  deploymentEdition,
  currentEnvironment,
  legacyDockerInstall,
} = {}) {
  return normalizeDeploymentEdition(deploymentEdition)
    || normalizeDeploymentEdition(currentEnvironment)
    || (normalizeString(legacyDockerInstall) === 'true'
      ? STANDALONE_DEPLOYMENT_EDITION
      : PRODUCTION_DEPLOYMENT_EDITION);
}

export function isStandaloneDeploymentEdition(value) {
  return normalizeDeploymentEdition(value) === STANDALONE_DEPLOYMENT_EDITION;
}
