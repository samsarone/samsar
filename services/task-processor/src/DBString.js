
import 'dotenv/config';

import * as mongoose from 'mongoose';

let db;



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

const MONGO_CONNECTION_STRING = `${MONGO_BASE_CONNECTION_STRING}/${DB_NAME}?${optionsToQueryString(MONGO_OPTIONS)}`;





export async function getDBConnectionString() {
  if (db) {
    return db;
  }
  let connectionString = `mongodb://localhost:27017/SamsarGG`;
  if (process.env.MONGO_URL) {
    connectionString = process.env.MONGO_URL;
  } else if (
    process.env.DATABASE_PROVIDER === 'cosmos' ||
    (process.env.CURRENT_ENV === 'production' && process.env.SAMSAR_RUNTIME !== 'docker')
  ) {
    connectionString = MONGO_CONNECTION_STRING;
  } else if (
    process.env.CURRENT_ENV === 'staging' ||
    process.env.CURRENT_ENV === 'docker' ||
    process.env.CURRENT_ENV === 'standalone' ||
    process.env.SAMSAR_RUNTIME === 'docker'
  ) {
    connectionString = `mongodb://mongo:27017/SamsarOne`;
  }


  
  mongoose.connect(`${connectionString}`, { useNewUrlParser: true, useUnifiedTopology: true });


  db = mongoose;

  return db;
}





export async function getDatabase() {
  const dbConnection = await getDBConnectionString();
  return dbConnection.connection.db;
}
