import 'dotenv/config';
import mongoose from 'mongoose';

import { isDockerRuntime, isStandaloneEdition } from './utils/DeploymentEnvironment.js';

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

let connectPromise = null;
export function buildMongoConnectionString(env = process.env) {
  const explicitMongoUrl = typeof env.MONGO_URL === 'string' ? env.MONGO_URL.trim() : '';
  if (explicitMongoUrl) {
    return explicitMongoUrl;
  }

  if (
    env.DATABASE_PROVIDER === 'cosmos' ||
    (env.CURRENT_ENV === 'production' && !isDockerRuntime(env) && !isStandaloneEdition(env))
  ) {
    if (!env.COSMOS_DB_USERNAME || !env.COSMOS_DB_PASSWORD) {
      throw new Error('Missing COSMOS_DB_USERNAME or COSMOS_DB_PASSWORD for production MongoDB connection');
    }

    const user = encodeURIComponent(env.COSMOS_DB_USERNAME);
    const pass = encodeURIComponent(env.COSMOS_DB_PASSWORD);
    const DB_NAME = 'SamsarOne';
    const BASE = `mongodb+srv://${user}:${pass}@samsaroneproduction.global.mongocluster.cosmos.azure.com`;
    const OPTS = {
      tls: true,
      authMechanism: 'SCRAM-SHA-256',
      retryWrites: false,
      maxIdleTimeMS: 120000,
    };
    const qs = Object.entries(OPTS).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return `${BASE}/${DB_NAME}?${qs}`;
  }

  if (
    env.CURRENT_ENV === 'staging' ||
    env.CURRENT_ENV === 'docker' ||
    env.CURRENT_ENV === 'standalone' ||
    isDockerRuntime(env) ||
    isStandaloneEdition(env)
  ) {
    throw new Error(
      'MONGO_URL is required for deployed MongoDB connections; refusing the unauthenticated Compose fallback',
    );
  }

  return 'mongodb://localhost:27017/SamsarOne';
}

const MONGO_CONNECTION_STRING = buildMongoConnectionString();

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

// Primitive that guarantees a live connection (or waits for in-flight connect)
export async function ensureDbConnected() {
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

// Backward-compatible shim: now it waits until connected
export async function getDBConnectionString() {
  await ensureDbConnected();
  return mongoose;
}

export async function getDatabase() {
  await ensureDbConnected();
  return mongoose.connection.db;
}
