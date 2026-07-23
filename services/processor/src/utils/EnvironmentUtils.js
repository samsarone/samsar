export const DEPLOYMENT_EDITION = Object.freeze({
  PRODUCTION: 'production',
  STANDALONE: 'standalone',
});

export const DEPLOYMENT_RUNTIME = Object.freeze({
  CONTAINER: 'container',
  HOST: 'host',
});

function normalizeString(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function normalizeDeploymentEdition(value) {
  const normalized = normalizeString(value);
  if (normalized === DEPLOYMENT_EDITION.PRODUCTION) {
    return DEPLOYMENT_EDITION.PRODUCTION;
  }
  if (['standalone', 'community', 'docker'].includes(normalized)) {
    return DEPLOYMENT_EDITION.STANDALONE;
  }
  return '';
}

export function getDeploymentEdition(env = process.env) {
  const candidates = [
    env?.SAMSAR_DEPLOYMENT_EDITION,
    env?.SAMSAR_EDITION,
    env?.CURRENT_ENV,
  ];
  for (const candidate of candidates) {
    const edition = normalizeDeploymentEdition(candidate);
    if (edition) {
      return edition;
    }
  }

  // Preserve the historic hosted/development behavior unless an installation
  // explicitly opts into the standalone product edition.
  return DEPLOYMENT_EDITION.PRODUCTION;
}

export function isStandaloneEdition(env = process.env) {
  return getDeploymentEdition(env) === DEPLOYMENT_EDITION.STANDALONE;
}

export function isProductionEdition(env = process.env) {
  return getDeploymentEdition(env) === DEPLOYMENT_EDITION.PRODUCTION;
}

export function normalizeDeploymentRuntime(value) {
  const normalized = normalizeString(value);
  if (['container', 'docker', 'compose', 'kubernetes', 'k8s'].includes(normalized)) {
    return DEPLOYMENT_RUNTIME.CONTAINER;
  }
  if (['host', 'server', 'native', 'local'].includes(normalized)) {
    return DEPLOYMENT_RUNTIME.HOST;
  }
  return '';
}

export function getDeploymentRuntime(env = process.env) {
  const explicitRuntime = normalizeDeploymentRuntime(env?.SAMSAR_RUNTIME);
  if (explicitRuntime) {
    return explicitRuntime;
  }

  // Backward compatibility for existing Compose installations. New
  // deployments should set SAMSAR_RUNTIME=docker explicitly.
  const legacyEnvironment = normalizeString(env?.CURRENT_ENV);
  if (['docker', 'community', 'standalone', 'staging'].includes(legacyEnvironment)) {
    return DEPLOYMENT_RUNTIME.CONTAINER;
  }

  // Existing production Compose files already declare mounted roots. Treat
  // those explicit capabilities as a container signal during migration.
  if (normalizeString(env?.SAMSAR_ASSETS_ROOT) || normalizeString(env?.SAMSAR_ASSETS_V2_ROOT)) {
    return DEPLOYMENT_RUNTIME.CONTAINER;
  }

  return DEPLOYMENT_RUNTIME.HOST;
}

export function isContainerRuntime(env = process.env) {
  return getDeploymentRuntime(env) === DEPLOYMENT_RUNTIME.CONTAINER;
}

export function getCurrentEnvironment(env = process.env) {
  return isContainerRuntime(env) ? 'docker' : 'server';
}

export function isPublicRegistrationEnabled(env = process.env) {
  return isProductionEdition(env);
}

export function isGoogleLoginEnabled(env = process.env) {
  return isProductionEdition(env);
}

export function isSetupAdminBootstrapEnabled(env = process.env) {
  return isStandaloneEdition(env);
}

export function shouldBypassGenerationCredits(env = process.env) {
  return isStandaloneEdition(env);
}

export function shouldDefaultProviderUsageAuditEnabled(env = process.env) {
  return isStandaloneEdition(env);
}
