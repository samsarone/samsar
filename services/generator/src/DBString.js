import 'dotenv/config';
import mongoose from 'mongoose';

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

let connectPromise = null;
let MONGO_CONNECTION_STRING;

if (process.env.MONGO_URL) {
  MONGO_CONNECTION_STRING = process.env.MONGO_URL;
} else if (
  process.env.DATABASE_PROVIDER === 'cosmos' ||
  (process.env.CURRENT_ENV === 'production' && process.env.SAMSAR_RUNTIME !== 'docker')
) {
  const MONGO_USERNAME = process.env.COSMOS_DB_USERNAME;
  const MONGO_PASSWORD = process.env.COSMOS_DB_PASSWORD;
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
  MONGO_CONNECTION_STRING = `${MONGO_BASE_CONNECTION_STRING}/${DB_NAME}?${optionsToQueryString(MONGO_OPTIONS)}`;
} else if (
  process.env.CURRENT_ENV === 'staging' ||
  process.env.CURRENT_ENV === 'docker' ||
  process.env.CURRENT_ENV === 'standalone' ||
  process.env.SAMSAR_RUNTIME === 'docker'
) {
  MONGO_CONNECTION_STRING = 'mongodb://mongo:27017/SamsarOne';
} else {
  MONGO_CONNECTION_STRING = `mongodb://localhost:27017/SamsarOne`;
}

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
