
import 'dotenv/config';

import * as mongoose from 'mongoose';

let db;

const CONTAINER_RUNTIMES = new Set(['docker', 'container', 'compose', 'kubernetes', 'k8s']);
const DEPLOYED_ENVIRONMENTS = new Set(['staging', 'docker', 'standalone', 'community']);

const normalizeEnvironmentValue = (value) => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const isProtectedMongoRuntime = (env) => {
  const runtime = normalizeEnvironmentValue(env.SAMSAR_RUNTIME || env.SAMSAR_DEPLOYMENT_RUNTIME);
  const currentEnvironment = normalizeEnvironmentValue(env.CURRENT_ENV);
  const deploymentEdition = normalizeEnvironmentValue(
    env.SAMSAR_DEPLOYMENT_EDITION || env.SAMSAR_EDITION,
  );
  return CONTAINER_RUNTIMES.has(runtime) ||
    DEPLOYED_ENVIRONMENTS.has(currentEnvironment) ||
    ['standalone', 'community'].includes(deploymentEdition);
};

const buildCosmosConnectionString = (env) => {
  const username = env.COSMOS_DB_USERNAME?.trim();
  const password = env.COSMOS_DB_PASSWORD;
  if (!username || !password?.trim()) {
    throw new Error('COSMOS_DB_USERNAME and COSMOS_DB_PASSWORD are required for Cosmos DB');
  }
  const encodedUsername = encodeURIComponent(username);
  const encodedPassword = encodeURIComponent(password);
  const mongoBaseConnectionString = `mongodb+srv://${encodedUsername}:${encodedPassword}@samsaroneproduction.global.mongocluster.cosmos.azure.com`;
  const mongoOptions = {
    tls: true,
    authMechanism: 'SCRAM-SHA-256',
    retryWrites: false,
    maxIdleTimeMS: 120000,
  };
  const optionsQueryString = Object.entries(mongoOptions)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');

  return `${mongoBaseConnectionString}/SamsarOne?${optionsQueryString}`;
};

export function resolveMongoConnectionString(env = process.env) {
  const configuredMongoUrl = env.MONGO_URL?.trim();
  if (configuredMongoUrl) {
    return configuredMongoUrl;
  }

  if (
    normalizeEnvironmentValue(env.DATABASE_PROVIDER) === 'cosmos' ||
    (
      normalizeEnvironmentValue(env.CURRENT_ENV) === 'production' &&
      !isProtectedMongoRuntime(env)
    )
  ) {
    return buildCosmosConnectionString(env);
  }

  if (isProtectedMongoRuntime(env)) {
    throw new Error('MONGO_URL is required for standalone, staging, and container runtimes');
  }

  return 'mongodb://localhost:27017/SamsarGG';
}

export async function getDBConnectionString() {
  if (db) {
    return db;
  }
  const connectionString = resolveMongoConnectionString();


  
  mongoose.connect(`${connectionString}`, { useNewUrlParser: true, useUnifiedTopology: true });


  db = mongoose;

  return db;
}





export async function getDatabase() {
  const dbConnection = await getDBConnectionString();
  return dbConnection.connection.db;
}
