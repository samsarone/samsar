// DBString.js
import 'dotenv/config';
import mongoose from 'mongoose';

// Optional: fail fast instead of buffering queries for 10s.
// Remove these two lines if you prefer Mongoose's default buffering.
mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

let connectPromise = null;
let connectionListenersInstalled = false;

let MONGO_CONNECTION_STRING;

function getNonNegativeIntegerEnv(name, fallback) {
  const parsedValue = Number(process.env[name]);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return fallback;
  }
  return Math.floor(parsedValue);
}

if (process.env.MONGO_URL) {
  MONGO_CONNECTION_STRING = process.env.MONGO_URL;
} else if (
  process.env.DATABASE_PROVIDER === 'cosmos' ||
  (process.env.CURRENT_ENV === 'production' && process.env.SAMSAR_RUNTIME !== 'docker')
) {
  const user = encodeURIComponent(process.env.COSMOS_DB_USERNAME);
  const pass = encodeURIComponent(process.env.COSMOS_DB_PASSWORD);
  const DB_NAME = 'SamsarOne';
  const BASE = `mongodb+srv://${user}:${pass}@samsaroneproduction.global.mongocluster.cosmos.azure.com`;
  const OPTS = {
    tls: true,
    authMechanism: 'SCRAM-SHA-256',
    retryWrites: false,
    maxIdleTimeMS: 120000,
  };
  const qs = Object.entries(OPTS).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  MONGO_CONNECTION_STRING = `${BASE}/${DB_NAME}?${qs}`;
} else if (
  process.env.CURRENT_ENV === 'staging' ||
  process.env.CURRENT_ENV === 'docker' ||
  process.env.CURRENT_ENV === 'standalone' ||
  process.env.SAMSAR_RUNTIME === 'docker'
) {
  MONGO_CONNECTION_STRING = 'mongodb://mongo:27017/SamsarOne';
} else {
  MONGO_CONNECTION_STRING = 'mongodb://localhost:27017/SamsarOne';
}

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
