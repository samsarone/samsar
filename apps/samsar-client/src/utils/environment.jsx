import {
  STANDALONE_DEPLOYMENT_EDITION,
  resolveDeploymentEdition,
} from './deploymentEdition.mjs';

export const SAMSAR_DEPLOYMENT_EDITION = resolveDeploymentEdition({
  deploymentEdition: import.meta.env.VITE_SAMSAR_DEPLOYMENT_EDITION,
  currentEnvironment: import.meta.env.VITE_CURRENT_ENV,
  legacyDockerInstall: import.meta.env.VITE_DOCKER_INSTALL,
});

export const IS_STANDALONE_DEPLOYMENT =
  SAMSAR_DEPLOYMENT_EDITION === STANDALONE_DEPLOYMENT_EDITION;

export function getDeploymentEdition() {
  return SAMSAR_DEPLOYMENT_EDITION;
}

// Kept as a compatibility export for consumers outside this source tree.
export function getSessionType() {
  return getDeploymentEdition();
}
