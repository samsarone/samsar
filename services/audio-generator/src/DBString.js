import 'dotenv/config';
import mongoose from 'mongoose';

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

let connectPromise = null;
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
  const MONGO_USERNAME = env.COSMOS_DB_USERNAME?.trim();
  const MONGO_PASSWORD = env.COSMOS_DB_PASSWORD;
  if (!MONGO_USERNAME || !MONGO_PASSWORD?.trim()) {
    throw new Error('COSMOS_DB_USERNAME and COSMOS_DB_PASSWORD are required for Cosmos DB');
  }
  const encodedUsername = encodeURIComponent(MONGO_USERNAME);
  const encodedPassword = encodeURIComponent(MONGO_PASSWORD);
  const DB_NAME = 'SamsarOne';
  const MONGO_BASE_CONNECTION_STRING = `mongodb+srv://${encodedUsername}:${encodedPassword}@samsaroneproduction.global.mongocluster.cosmos.azure.com`;
  const MONGO_OPTIONS = {
    tls: true,
    authMechanism: 'SCRAM-SHA-256',
    retryWrites: false,
    maxIdleTimeMS: 120000,
  };
  const optionsToQueryString = (options) => {
    return Object.entries(options)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
  };
  return `${MONGO_BASE_CONNECTION_STRING}/${DB_NAME}?${optionsToQueryString(MONGO_OPTIONS)}`;
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

  return 'mongodb://localhost:27017/SamsarOne';
}

const MONGO_CONNECTION_STRING = resolveMongoConnectionString();

const isTransientAuthError = (err) => {
  return err?.code === 18 || err?.errorLabels?.has?.('HandshakeError') || err?.errorLabels?.has?.('ResetPool');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectWithRetry(uri, opts, attempts = 5, delayMs = 3000) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await mongoose.connect(uri, opts);
    } catch (err) {
      lastErr = err;
      if (!isTransientAuthError(err) || i === attempts - 1) {
        throw err;
      }
      await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

async function ensureDbConnected() {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!connectPromise) {
    connectPromise = connectWithRetry(MONGO_CONNECTION_STRING, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      maxPoolSize: 20,
      minPoolSize: 2,
      heartbeatFrequencyMS: 10000,
      family: 4,
    })
      .then((conn) => {
        mongoose.connection.on('disconnected', () => {
          connectPromise = null;
        });
        mongoose.connection.on('error', () => {
          connectPromise = null;
        });
        return conn;
      })
      .catch((err) => {
        connectPromise = null;
        throw err;
      });
  }

  return await connectPromise;
}

export async function getDBConnectionString() {
  await ensureDbConnected();
  return mongoose;
}

export async function getDatabase() {
  await ensureDbConnected();
  return mongoose.connection.db;
}
