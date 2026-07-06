import 'dotenv/config';
import mongoose from 'mongoose';

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

let connectPromise = null;
let MONGO_CONNECTION_STRING;
let connectionEventHandlersAttached = false;

if (process.env.CURRENT_ENV === 'production') {
  const MONGO_USERNAME = encodeURIComponent(process.env.COSMOS_DB_USERNAME);
  const MONGO_PASSWORD = encodeURIComponent(process.env.COSMOS_DB_PASSWORD);
  const DB_NAME = 'SamsarOne';
  const MONGO_BASE = `mongodb+srv://${MONGO_USERNAME}:${MONGO_PASSWORD}@samsaroneproduction.global.mongocluster.cosmos.azure.com`;
  const OPTS = {
    tls: true,
    authMechanism: 'SCRAM-SHA-256',
    retryWrites: false,
    maxIdleTimeMS: 120000,
  };
  const qs = Object.entries(OPTS).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  MONGO_CONNECTION_STRING = `${MONGO_BASE}/${DB_NAME}?${qs}`;
} else if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
  MONGO_CONNECTION_STRING = process.env.MONGO_URL || 'mongodb://mongo:27017/SamsarOne';
} else {
  MONGO_CONNECTION_STRING = 'mongodb://localhost:27017/SamsarOne';
}

const TRANSIENT_MONGO_ERROR_NAMES = new Set([
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoServerSelectionError',
  'MongoTimeoutError',
  'MongooseServerSelectionError',
]);

const TRANSIENT_MONGO_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EPIPE',
  'ENETUNREACH',
  'EAI_AGAIN',
  'ESOCKETTIMEDOUT',
]);

const TRANSIENT_MONGO_ERROR_LABELS = [
  'HandshakeError',
  'ResetPool',
  'InterruptInUseConnections',
  'RetryableWriteError',
];

const TRANSIENT_MONGO_MESSAGE_PATTERNS = [
  'connection timed out',
  'server selection timed out',
  'connection closed',
  'connection pool',
  'timed out',
];

const getNumberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const connectRetryAttempts = getNumberFromEnv('MONGO_CONNECT_RETRY_ATTEMPTS', 5);
const connectRetryDelayMs = getNumberFromEnv('MONGO_CONNECT_RETRY_DELAY_MS', 3000);
const operationRetryAttempts = getNumberFromEnv('MONGO_OPERATION_RETRY_ATTEMPTS', 3);
const operationRetryDelayMs = getNumberFromEnv('MONGO_OPERATION_RETRY_DELAY_MS', 1000);

function hasMongoErrorLabel(err, label) {
  return Boolean(
    err?.errorLabels?.has?.(label) ||
    (typeof err?.hasErrorLabel === 'function' && err.hasErrorLabel(label))
  );
}

export function isTransientMongoError(err, seen = new Set()) {
  if (!err || typeof err !== 'object' || seen.has(err)) {
    return false;
  }
  seen.add(err);

  if (err.code === 18) {
    return true;
  }

  if (TRANSIENT_MONGO_ERROR_NAMES.has(err.name)) {
    return true;
  }

  if (typeof err.code === 'string' && TRANSIENT_MONGO_ERROR_CODES.has(err.code)) {
    return true;
  }

  if (TRANSIENT_MONGO_ERROR_LABELS.some((label) => hasMongoErrorLabel(err, label))) {
    return true;
  }

  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  if (TRANSIENT_MONGO_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))) {
    return true;
  }

  return isTransientMongoError(err.cause, seen) || isTransientMongoError(err.reason, seen);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getRetryDelayMs(baseDelayMs, attemptIndex) {
  const exponentialDelayMs = baseDelayMs * (2 ** attemptIndex);
  const jitterMs = Math.floor(Math.random() * Math.min(baseDelayMs, 1000));
  return exponentialDelayMs + jitterMs;
}

async function connectWithRetry(uri, opts, attempts = connectRetryAttempts, delayMs = connectRetryDelayMs) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await mongoose.connect(uri, opts);
    } catch (err) {
      lastErr = err;
      if (!isTransientMongoError(err) || i === attempts - 1) {
        throw err;
      }
      await sleep(getRetryDelayMs(delayMs, i));
    }
  }
  throw lastErr;
}

function attachConnectionEventHandlers() {
  if (connectionEventHandlersAttached) {
    return;
  }

  connectionEventHandlersAttached = true;
  mongoose.connection.on('disconnected', () => {
    connectPromise = null;
  });
  mongoose.connection.on('error', () => {
    connectPromise = null;
  });
}

// One place to ensure we are actually connected before returning
export async function ensureDbConnected() {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!connectPromise) {
    connectPromise = connectWithRetry(MONGO_CONNECTION_STRING, {
      serverSelectionTimeoutMS: 30000,
      connectTimeoutMS: 15000,
      socketTimeoutMS: 60000,
      maxPoolSize: 20,
      minPoolSize: 2,
      heartbeatFrequencyMS: 10000,
      family: 4,
    })
      .then((conn) => {
        attachConnectionEventHandlers();
        return conn;
      })
      .catch((err) => {
        connectPromise = null;
        throw err;
      });
  }

  return await connectPromise;
}

export async function resetDbConnection() {
  connectPromise = null;

  if (mongoose.connection.readyState === 0) {
    return;
  }

  try {
    await mongoose.disconnect();
  } catch {
    // Best-effort pool reset. The next operation will reconnect.
  }
}

export async function withDbRetry(operation, {
  attempts = operationRetryAttempts,
  delayMs = operationRetryDelayMs,
  operationName = 'mongo operation',
} = {}) {
  let lastErr;

  for (let i = 0; i < attempts; i++) {
    try {
      await ensureDbConnected();
      return await operation();
    } catch (err) {
      lastErr = err;
      if (!isTransientMongoError(err) || i === attempts - 1) {
        throw err;
      }

      console.error(`Transient MongoDB error during ${operationName}; resetting connection before retry ${i + 2}/${attempts}`, {
        name: err?.name,
        message: err?.message,
      });
      await resetDbConnection();
      await sleep(getRetryDelayMs(delayMs, i));
    }
  }

  throw lastErr;
}

// Backward-compatible wrapper: now waits until connected
export async function getDBConnectionString() {
  await ensureDbConnected();
  return mongoose;
}

export async function getDatabase() {
  await ensureDbConnected();
  return mongoose.connection.db;
}
