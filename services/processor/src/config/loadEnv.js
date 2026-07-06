import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '../..');

const explicitEnvFile =
  process.env.SAMSAR_PROCESSOR_ENV_FILE ||
  process.env.DOTENV_CONFIG_PATH ||
  null;

const productionLike =
  process.env.NODE_ENV === 'production' ||
  process.env.CURRENT_ENV === 'production';

const envFile = explicitEnvFile || (productionLike ? '.env.production' : '.env');
const envPath = path.isAbsolute(envFile) ? envFile : path.resolve(projectRoot, envFile);

dotenv.config({ path: envPath, override: true });
