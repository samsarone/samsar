import 'dotenv/config';
import mongoose from 'mongoose';
import { isContainerRuntime, isProductionEdition } from '../utils/EnvironmentUtils.js';

mongoose.set('bufferCommands', false);
mongoose.set('bufferTimeoutMS', 0);

let connectPromise = null;

export function resolveMongoConnectionString(env = process.env) {
  const explicitMongoUrl = typeof env?.MONGO_URL === 'string' ? env.MONGO_URL.trim() : '';
  if (explicitMongoUrl) {
    return explicitMongoUrl;
  }

  const mongoUsername = typeof env?.COSMOS_DB_USERNAME === 'string'
    ? env.COSMOS_DB_USERNAME.trim()
    : '';
  const mongoPassword = typeof env?.COSMOS_DB_PASSWORD === 'string'
    ? env.COSMOS_DB_PASSWORD
    : '';
  if (isProductionEdition(env) && mongoUsername && mongoPassword) {
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

  const databaseName = env?.MONGO_DATABASE || 'SamsarOne';
  return isContainerRuntime(env)
    ? `mongodb://mongo:27017/${databaseName}`
    : `mongodb://localhost:27017/${databaseName}`;
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
