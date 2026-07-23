import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { DEPLOYMENT_EDITION, normalizeDeploymentEdition } from '../utils/EnvironmentUtils.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '../..');

const explicitEnvFile =
  process.env.SAMSAR_PROCESSOR_ENV_FILE ||
  process.env.DOTENV_CONFIG_PATH ||
  null;

const productionLike =
  process.env.NODE_ENV === 'production' ||
  normalizeDeploymentEdition(
    process.env.SAMSAR_DEPLOYMENT_EDITION ||
    process.env.SAMSAR_EDITION ||
    process.env.CURRENT_ENV
  ) === DEPLOYMENT_EDITION.PRODUCTION;

const envFile = explicitEnvFile || (productionLike ? '.env.production' : '.env');
const envPath = path.isAbsolute(envFile) ? envFile : path.resolve(projectRoot, envFile);

dotenv.config({ path: envPath, override: true });
