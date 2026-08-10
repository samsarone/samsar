import 'dotenv/config';
import mongoose from 'mongoose';
import {
  isContainerRuntime,
  isStandaloneEdition,
} from '../utils/EnvironmentUtils.js';

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

let connectPromise = null;

export function resolveMongoConnectionString(env = process.env) {
  const explicitMongoUrl = typeof env?.MONGO_URL === 'string' ? env.MONGO_URL.trim() : '';
  if (explicitMongoUrl) {
    return explicitMongoUrl;
  }

  const databaseProvider = typeof env?.DATABASE_PROVIDER === 'string'
    ? env.DATABASE_PROVIDER.trim().toLowerCase()
    : '';
  const explicitlyHostedProduction = [
    env?.SAMSAR_DEPLOYMENT_EDITION,
    env?.SAMSAR_EDITION,
    env?.CURRENT_ENV,
  ].some((value) => typeof value === 'string' && value.trim().toLowerCase() === 'production');
  const standaloneEdition = isStandaloneEdition(env);
  const useCosmos = databaseProvider === 'cosmos' || (
    explicitlyHostedProduction && !standaloneEdition && !isContainerRuntime(env)
  );
  const mongoUsername = typeof env?.COSMOS_DB_USERNAME === 'string'
    ? env.COSMOS_DB_USERNAME.trim()
    : '';
  const mongoPassword = typeof env?.COSMOS_DB_PASSWORD === 'string'
    ? env.COSMOS_DB_PASSWORD
    : '';
  if (useCosmos) {
    if (!mongoUsername || !mongoPassword.trim()) {
      throw new Error(
        'COSMOS_DB_USERNAME and COSMOS_DB_PASSWORD are required when DATABASE_PROVIDER=cosmos or hosted production MongoDB is selected.',
      );
    }
    const encodedUsername = encodeURIComponent(mongoUsername);
    const encodedPassword = encodeURIComponent(mongoPassword);
    const databaseName = env?.MONGO_DATABASE || 'SamsarOne';
    const mongoBaseConnectionString = `mongodb+srv://${encodedUsername}:${encodedPassword}@samsaroneproduction.global.mongocluster.cosmos.azure.com`;
    const mongoOptions = {
      tls: true,
      authMechanism: 'SCRAM-SHA-256',
      retryWrites: false,
      maxIdleTimeMS: 120000,
    };
    const optionsQuery = Object.entries(mongoOptions)
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join('&');
    return `${mongoBaseConnectionString}/${databaseName}?${optionsQuery}`;
  }

  if (isContainerRuntime(env) || standaloneEdition) {
    throw new Error(
      'MONGO_URL must be explicitly configured for standalone or container deployments.',
    );
  }

  const databaseName = env?.MONGO_DATABASE || 'SamsarOne';
  return `mongodb://localhost:27017/${databaseName}`;
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
