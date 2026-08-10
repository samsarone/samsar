// DBString.js
import 'dotenv/config';
import mongoose from 'mongoose';

import { isStandaloneEdition } from './utils/EnvironmentUtils.js';

// Optional: fail fast instead of buffering queries for 10s.
// Remove these two lines if you prefer Mongoose's default buffering.
mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

let connectPromise = null;
let connectionListenersInstalled = false;

function getNonNegativeIntegerEnv(name, fallback) {
  const parsedValue = Number(process.env[name]);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return fallback;
  }
  return Math.floor(parsedValue);
}

function normalizeEnvironmentValue(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isContainerMongoRuntime(env = process.env) {
  const runtime = normalizeEnvironmentValue(env.SAMSAR_RUNTIME || env.SAMSAR_DEPLOYMENT_RUNTIME);
  if (runtime) {
    return ['docker', 'container', 'compose', 'kubernetes', 'k8s'].includes(runtime);
  }
  return ['docker', 'standalone', 'community', 'staging'].includes(
    normalizeEnvironmentValue(env.CURRENT_ENV),
  );
}

export function resolveMongoConnectionString(env = process.env) {
  const explicitMongoUrl = typeof env.MONGO_URL === 'string' ? env.MONGO_URL.trim() : '';
  if (explicitMongoUrl) {
    return explicitMongoUrl;
  }

  const standaloneEdition = isStandaloneEdition(env);
  const useCosmos = normalizeEnvironmentValue(env.DATABASE_PROVIDER) === 'cosmos' || (
    normalizeEnvironmentValue(env.CURRENT_ENV) === 'production' &&
    !standaloneEdition &&
    !isContainerMongoRuntime(env)
  );
  if (useCosmos) {
    const mongoUsername = typeof env.COSMOS_DB_USERNAME === 'string'
      ? env.COSMOS_DB_USERNAME.trim()
      : '';
    const mongoPassword = typeof env.COSMOS_DB_PASSWORD === 'string'
      ? env.COSMOS_DB_PASSWORD
      : '';
    if (!mongoUsername || !mongoPassword.trim()) {
      throw new Error(
        'COSMOS_DB_USERNAME and COSMOS_DB_PASSWORD are required when DATABASE_PROVIDER=cosmos or hosted production MongoDB is selected.',
      );
    }

    const user = encodeURIComponent(mongoUsername);
    const pass = encodeURIComponent(mongoPassword);
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

  if (isContainerMongoRuntime(env) || standaloneEdition) {
    throw new Error(
      'MONGO_URL must be explicitly configured for standalone or container deployments.',
    );
  }

  return 'mongodb://localhost:27017/SamsarOne';
}

const MONGO_CONNECTION_STRING = resolveMongoConnectionString();

export async function ensureDbConnected() {
  installConnectionLifecycleListeners();

  // 0 = disconnected, 1 = connected, 2 = connecting, 3 = disconnecting
  if (mongoose.connection.readyState === 1) return mongoose;

  if (!connectPromise) {
    connectPromise = mongoose.connect(MONGO_CONNECTION_STRING, {
      // Modern Mongoose defaults; no need for useNewUrlParser/useUnifiedTopology
      serverSelectionTimeoutMS: 30000, // helps on cold boots / DNS
      connectTimeoutMS: 30000,
      socketTimeoutMS: 60000,
      maxPoolSize: 20,
      minPoolSize: getNonNegativeIntegerEnv('MONGO_MIN_POOL_SIZE', 0),
      maxConnecting: 2,
      heartbeatFrequencyMS: 10000,
      family: 4, // prefer IPv4 (helps with some SRV/IPv6 setups on Azure)
    })
    .then(conn => conn)
    .catch(err => {
      connectPromise = null;
      throw err;
    });
  }

  return await connectPromise;
}

function installConnectionLifecycleListeners() {
  if (connectionListenersInstalled) {
    return;
  }

  const resetConnectPromise = () => {
    connectPromise = null;
  };

  mongoose.connection.on('disconnected', resetConnectPromise);
  mongoose.connection.on('close', resetConnectPromise);
  connectionListenersInstalled = true;
}

export function isMongoConnectivityError(error) {
  const name = typeof error?.name === 'string' ? error.name : '';
  const message = typeof error?.message === 'string' ? error.message : String(error || '');

  return (
    name === 'MongoNetworkTimeoutError' ||
    name === 'MongoServerSelectionError' ||
    name === 'MongoNetworkError' ||
    message.includes('server selection timed out') ||
    message.includes("Socket 'secureConnect' timed out") ||
    message.includes('connect ETIMEDOUT') ||
    message.includes('ECONNRESET') ||
    message.includes('ENOTFOUND')
  );
}

export async function resetDbConnection() {
  connectPromise = null;

  if (mongoose.connection.readyState === 0) {
    return;
  }

  try {
    await mongoose.disconnect();
  } catch {
    // Best-effort cleanup after transient network failures.
  } finally {
    connectPromise = null;
  }
}

// Backward-compatible names:
export async function getDBConnectionString() {
  await ensureDbConnected();     // <-- now blocks until connected
  return mongoose;
}

export async function getDatabase() {
  await ensureDbConnected();
  return mongoose.connection.db;
}
