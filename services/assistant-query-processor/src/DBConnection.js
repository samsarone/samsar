import 'dotenv/config';

import mongoose from 'mongoose';

const DB_NAME = 'SamsarOne';
const COSMOS_HOST = 'samsaroneproduction.global.mongocluster.cosmos.azure.com';

export const DEFAULT_MONGOOSE_CONNECT_OPTIONS = Object.freeze({
  serverSelectionTimeoutMS: 30000,
  socketTimeoutMS: 60000,
  maxPoolSize: 20,
  minPoolSize: 2,
  heartbeatFrequencyMS: 10000,
  family: 4,
});

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

let connectPromise = null;
let connectionEventsBound = false;
let mongoConnectionString = null;

const normalizeEnvironmentValue = (value) => (
  typeof value === 'string' ? value.trim().toLowerCase() : ''
);

const isProtectedMongoRuntime = (env) => {
  const runtime = normalizeEnvironmentValue(env.SAMSAR_RUNTIME || env.SAMSAR_DEPLOYMENT_RUNTIME);
  const currentEnvironment = normalizeEnvironmentValue(env.CURRENT_ENV);
  const edition = normalizeEnvironmentValue(
    env.SAMSAR_DEPLOYMENT_EDITION || env.SAMSAR_EDITION,
  );
  return ['docker', 'container', 'compose', 'kubernetes', 'k8s'].includes(runtime) ||
    ['staging', 'docker', 'container', 'compose', 'kubernetes', 'k8s', 'standalone', 'community']
      .includes(currentEnvironment) ||
    ['standalone', 'community'].includes(edition);
};

export function optionsToQueryString(options) {
  return Object.entries(options)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

export function buildMongoConnectionString(env = process.env) {
  const explicitMongoUrl = typeof env.MONGO_URL === 'string' ? env.MONGO_URL.trim() : '';
  if (explicitMongoUrl) {
    return explicitMongoUrl;
  }

  const useCosmos =
    normalizeEnvironmentValue(env.DATABASE_PROVIDER) === 'cosmos' ||
    (normalizeEnvironmentValue(env.CURRENT_ENV) === 'production' && !isProtectedMongoRuntime(env));

  if (useCosmos) {
    if (!env.COSMOS_DB_USERNAME || !env.COSMOS_DB_PASSWORD) {
      throw new Error('Missing COSMOS_DB_USERNAME or COSMOS_DB_PASSWORD for production MongoDB connection');
    }

    const encodedUsername = encodeURIComponent(env.COSMOS_DB_USERNAME);
    const encodedPassword = encodeURIComponent(env.COSMOS_DB_PASSWORD);
    const options = optionsToQueryString({
      tls: true,
      authMechanism: 'SCRAM-SHA-256',
      retryWrites: false,
      maxIdleTimeMS: 120000,
    });

    return `mongodb+srv://${encodedUsername}:${encodedPassword}@${COSMOS_HOST}/${DB_NAME}?${options}`;
  }

  if (isProtectedMongoRuntime(env)) {
    throw new Error(
      'MONGO_URL is required for deployed MongoDB connections; refusing the unauthenticated Compose fallback',
    );
  }

  return `mongodb://localhost:27017/${DB_NAME}`;
}

export function isTransientMongoConnectionError(error) {
  const hasErrorLabel =
    hasMongoErrorLabel(error, 'HandshakeError') || hasMongoErrorLabel(error, 'ResetPool');

  const isCosmosInternalAuthError =
    error?.code === 18 &&
    (error?.message === 'Internal error' || error?.errorResponse?.errmsg === 'Internal error');

  return hasErrorLabel || isCosmosInternalAuthError;
}

function hasMongoErrorLabel(error, label) {
  if (typeof error?.hasErrorLabel === 'function' && error.hasErrorLabel(label)) {
    return true;
  }

  if (Array.isArray(error?.errorLabels)) {
    return error.errorLabels.includes(label);
  }

  if (typeof error?.errorLabels?.has === 'function') {
    return error.errorLabels.has(label);
  }

  return false;
}

function getMongoConnectionString() {
  if (!mongoConnectionString) {
    mongoConnectionString = buildMongoConnectionString();
  }

  return mongoConnectionString;
}

function summarizeMongoError(error) {
  return {
    name: error?.name,
    message: error?.message,
    code: error?.code,
    codeName: error?.codeName,
    labels: getMongoErrorLabels(error),
  };
}

function getMongoErrorLabels(error) {
  if (Array.isArray(error?.errorLabels)) {
    return error.errorLabels;
  }

  if (typeof error?.errorLabels?.values === 'function') {
    return Array.from(error.errorLabels.values());
  }

  return undefined;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function connectWithRetry(uri, options, attempts = 5, delayMs = 3000) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await mongoose.connect(uri, options);
    } catch (error) {
      lastError = error;

      if (!isTransientMongoConnectionError(error) || attempt === attempts) {
        throw error;
      }

      const retryDelayMs = delayMs * attempt;
      console.warn(
        `[assistant-query-processor] MongoDB handshake failed; retrying in ${retryDelayMs}ms`,
        summarizeMongoError(error),
      );
      await sleep(retryDelayMs);
    }
  }

  throw lastError;
}

function bindConnectionEventsOnce() {
  if (connectionEventsBound) {
    return;
  }

  connectionEventsBound = true;

  mongoose.connection.on('disconnected', () => {
    connectPromise = null;
  });

  mongoose.connection.on('error', () => {
    connectPromise = null;
  });
}

export async function ensureDbConnected() {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!connectPromise) {
    connectPromise = connectWithRetry(getMongoConnectionString(), DEFAULT_MONGOOSE_CONNECT_OPTIONS)
      .then((connection) => {
        bindConnectionEventsOnce();
        return connection;
      })
      .catch((error) => {
        connectPromise = null;
        throw error;
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
