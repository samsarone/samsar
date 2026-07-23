function normalize(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function getDeploymentEdition(env = process.env) {
  const edition = normalize(
    env.SAMSAR_DEPLOYMENT_EDITION || env.SAMSAR_EDITION || env.CURRENT_ENV,
  );
  if (edition === 'docker' || edition === 'community' || edition === 'standalone') {
    return 'standalone';
  }
  return edition || 'development';
}

export function isStandaloneEdition(env = process.env) {
  return getDeploymentEdition(env) === 'standalone';
}

export function isDockerRuntime(env = process.env) {
  const runtime = normalize(env.SAMSAR_RUNTIME || env.SAMSAR_DEPLOYMENT_RUNTIME);
  if (runtime) return runtime === 'docker';
  return ['docker', 'standalone', 'staging'].includes(normalize(env.CURRENT_ENV));
}

export function usesLocalAssetStorage(env = process.env) {
  return Boolean(env.SAMSAR_ASSETS_ROOT || env.SAMSAR_ASSETS_V2_ROOT) || isDockerRuntime(env);
}
