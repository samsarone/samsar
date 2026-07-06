import { randomBytes, randomUUID, createHmac } from 'crypto';
import bcrypt from 'bcrypt';

import AppKey from '../../schema/AppKey.js';
import User from '../../schema/User.js';
import { getDBConnectionString } from '../DBString.js';

export const APP_KEY_PREFIX = 'sapp_';
const DEFAULT_APP_KEY_TTL_DAYS = 365;
const APP_SECRET_MIN_LENGTH = 32;
const APP_SECRET_MAX_LENGTH = 1024;
const BCRYPT_ROUNDS = 12;
const APP_KEY_HEADER_NAMES = [
  'x-app-key',
  'x-samsar-app-key',
  'app-key',
  'app_key',
  'APP_KEY',
];
const APP_SECRET_HEADER_NAMES = [
  'x-app-secret',
  'x-samsar-app-secret',
  'app-secret',
  'app_secret',
  'APP_SECRET',
];

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function getHeaderValue(headers = {}, headerName) {
  const directValue = headers?.[headerName];
  if (typeof directValue === 'string' && directValue.trim()) {
    return directValue.trim();
  }

  const foundHeaderName = Object.keys(headers || {}).find(
    (key) => key.toLowerCase() === headerName.toLowerCase(),
  );
  const foundValue = foundHeaderName ? headers[foundHeaderName] : null;
  return typeof foundValue === 'string' && foundValue.trim() ? foundValue.trim() : null;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((result, [key, entryValue]) => {
    if (entryValue === undefined) {
      return result;
    }
    result[key] = entryValue;
    return result;
  }, {});
}

function getHashSecret() {
  const secret =
    process.env.APP_KEY_HASH_SECRET ||
    process.env.SAMSAR_APP_KEY_HASH_SECRET ||
    process.env.TOKEN_SECRET;

  if (!secret || !secret.trim()) {
    const error = new Error('APP_KEY_HASH_SECRET or TOKEN_SECRET must be configured for app key hashing.');
    error.status = 500;
    throw error;
  }

  return secret;
}

function hashAppKey(appKey) {
  return createHmac('sha256', getHashSecret()).update(appKey).digest('hex');
}

function resolveAppKeyTtlDays() {
  const raw =
    process.env.APP_KEY_TTL_DAYS ||
    process.env.SAMSAR_APP_KEY_TTL_DAYS;
  if (!raw) {
    return DEFAULT_APP_KEY_TTL_DAYS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_APP_KEY_TTL_DAYS;
  }

  return Math.min(3650, Math.max(1, parsed));
}

function buildExpiresAt(now = new Date()) {
  return new Date(now.getTime() + resolveAppKeyTtlDays() * 24 * 60 * 60 * 1000);
}

function buildAppKey() {
  return `${APP_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

function buildAppKeyId() {
  return `appkey_${randomUUID().replace(/-/g, '')}`;
}

function validateUserId(userId) {
  const normalized = normalizeString(userId?.toString?.() || userId);
  if (!normalized) {
    const error = new Error('User id is required.');
    error.status = 400;
    throw error;
  }
  return normalized;
}

function validateAppSecret(secret) {
  const normalized = normalizeString(secret);
  if (!normalized) {
    const error = new Error('secret is required.');
    error.status = 400;
    throw error;
  }

  if (normalized.length < APP_SECRET_MIN_LENGTH) {
    const error = new Error(`secret must be at least ${APP_SECRET_MIN_LENGTH} characters.`);
    error.status = 400;
    throw error;
  }

  if (normalized.length > APP_SECRET_MAX_LENGTH) {
    const error = new Error(`secret must be ${APP_SECRET_MAX_LENGTH} characters or fewer.`);
    error.status = 400;
    throw error;
  }

  return normalized;
}

function getAuthorizationCredentials(headers = {}) {
  const authorizationHeader = getHeaderValue(headers, 'authorization');
  if (!authorizationHeader) {
    return {};
  }

  const [scheme, credential] = authorizationHeader.split(/\s+/, 2);
  if (!scheme || !credential) {
    return {};
  }

  if (scheme.toLowerCase() === 'appkey') {
    return { appKey: normalizeString(credential) };
  }

  if (scheme.toLowerCase() === 'bearer' && credential.startsWith(APP_KEY_PREFIX)) {
    return { appKey: normalizeString(credential) };
  }

  if (scheme.toLowerCase() === 'basic') {
    try {
      const decoded = Buffer.from(credential, 'base64').toString('utf8');
      const separatorIndex = decoded.indexOf(':');
      if (separatorIndex > 0) {
        return {
          appKey: normalizeString(decoded.slice(0, separatorIndex)),
          secret: normalizeString(decoded.slice(separatorIndex + 1)),
        };
      }
    } catch {
      return {};
    }
  }

  return {};
}

export function getAppKeyCredentialsFromAuthHeaders(headers = {}) {
  const authorizationCredentials = getAuthorizationCredentials(headers);
  const appKeyFromHeader = APP_KEY_HEADER_NAMES
    .map((headerName) => getHeaderValue(headers, headerName))
    .find(Boolean);
  const secretFromHeader = APP_SECRET_HEADER_NAMES
    .map((headerName) => getHeaderValue(headers, headerName))
    .find(Boolean);

  return {
    appKey: appKeyFromHeader || authorizationCredentials.appKey || null,
    secret: secretFromHeader || authorizationCredentials.secret || null,
  };
}

export function hasAppKeyAuthHeaders(headers = {}) {
  const credentials = getAppKeyCredentialsFromAuthHeaders(headers);
  return Boolean(credentials.appKey || credentials.secret);
}

function formatAppKeyRecord(appKeyRecord, { includeSecretHints = true } = {}) {
  if (!appKeyRecord) {
    return null;
  }

  const plain = appKeyRecord.toObject?.() || appKeyRecord;
  return {
    id: plain.appKeyId,
    userId: plain.userId,
    appKeyPrefix: plain.appKeyPrefix || null,
    appKeyLast4: plain.appKeyLast4 || null,
    status: plain.status,
    expiresAt: plain.expiresAt || null,
    lastUsedAt: plain.lastUsedAt || null,
    refreshedAt: plain.refreshedAt || null,
    revokedAt: plain.revokedAt || null,
    rotationCount: plain.rotationCount || 0,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null,
    ...(includeSecretHints
      ? {
          authScheme: 'AppKey',
          authHeader: 'Authorization: AppKey <APP_KEY>',
          secretHeader: 'x-app-secret',
        }
      : {}),
  };
}

export async function createAppKeyForUser({
  userId,
  secret,
  authType = null,
  metadata = {},
} = {}) {
  await getDBConnectionString();

  const normalizedUserId = validateUserId(userId);
  const normalizedSecret = validateAppSecret(secret);
  const user = await User.findById(normalizedUserId).select('_id').lean();
  if (!user?._id) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const existing = await AppKey.findOne({
    userId: normalizedUserId,
    status: 'active',
    revokedAt: null,
  }).lean();
  if (existing) {
    const error = new Error('An active APP_KEY already exists for this user.');
    error.status = 409;
    error.code = 'APP_KEY_EXISTS';
    throw error;
  }

  const now = new Date();
  const appKey = buildAppKey();
  let appKeyRecord;
  try {
    appKeyRecord = await AppKey.create({
      appKeyId: buildAppKeyId(),
      userId: normalizedUserId,
      appKeyHash: hashAppKey(appKey),
      appKeyPrefix: appKey.slice(0, 10),
      appKeyLast4: appKey.slice(-4),
      appSecretHash: await bcrypt.hash(normalizedSecret, BCRYPT_ROUNDS),
      status: 'active',
      expiresAt: buildExpiresAt(now),
      createdByAuthType: normalizeString(authType),
      metadata: normalizeMetadata(metadata),
    });
  } catch (error) {
    if (error?.code === 11000) {
      const duplicateError = new Error('An active APP_KEY already exists for this user.');
      duplicateError.status = 409;
      duplicateError.code = 'APP_KEY_EXISTS';
      throw duplicateError;
    }
    throw error;
  }

  return {
    appKey,
    tokenType: 'AppKey',
    expiresAt: appKeyRecord.expiresAt,
    appKeyRecord: formatAppKeyRecord(appKeyRecord),
  };
}

export async function getActiveAppKeyForUser(userId) {
  await getDBConnectionString();

  const normalizedUserId = validateUserId(userId);
  const appKeyRecord = await AppKey.findOne({
    userId: normalizedUserId,
    status: 'active',
    revokedAt: null,
  }).lean();

  return formatAppKeyRecord(appKeyRecord);
}

async function resolveAppKeyCredentials({
  appKey,
  secret,
  allowExpired = false,
  updateLastUsed = true,
} = {}) {
  await getDBConnectionString();

  const normalizedAppKey = normalizeString(appKey);
  if (!normalizedAppKey) {
    const error = new Error('APP_KEY is required.');
    error.status = 400;
    throw error;
  }
  if (!normalizedAppKey.startsWith(APP_KEY_PREFIX)) {
    const error = new Error('Invalid APP_KEY.');
    error.status = 401;
    throw error;
  }

  const normalizedSecret = validateAppSecret(secret);
  const appKeyRecord = await AppKey.findOne({
    appKeyHash: hashAppKey(normalizedAppKey),
    status: 'active',
    revokedAt: null,
  });

  if (!appKeyRecord) {
    const error = new Error('Invalid APP_KEY.');
    error.status = 401;
    throw error;
  }

  const isSecretValid = await bcrypt.compare(normalizedSecret, appKeyRecord.appSecretHash);
  if (!isSecretValid) {
    const error = new Error('Invalid APP_SECRET.');
    error.status = 401;
    throw error;
  }

  const now = new Date();
  if (appKeyRecord.expiresAt && new Date(appKeyRecord.expiresAt).getTime() <= now.getTime()) {
    if (!allowExpired) {
      const error = new Error('APP_KEY has expired. Refresh it with APP_KEY and APP_SECRET.');
      error.status = 401;
      error.code = 'APP_KEY_EXPIRED';
      throw error;
    }
  }

  if (updateLastUsed) {
    appKeyRecord.lastUsedAt = now;
    await appKeyRecord.save();
  }

  return {
    appKeyRecord,
    internalUserId: appKeyRecord.userId?.toString?.() || appKeyRecord.userId,
  };
}

export async function resolveAppKeyFromAuthHeaders(headers = {}) {
  if (!hasAppKeyAuthHeaders(headers)) {
    return null;
  }

  const credentials = getAppKeyCredentialsFromAuthHeaders(headers);
  const { appKeyRecord, internalUserId } = await resolveAppKeyCredentials({
    appKey: credentials.appKey,
    secret: credentials.secret,
  });

  return {
    authType: 'app_key',
    externalUser: null,
    internalUserId,
    appKey: formatAppKeyRecord(appKeyRecord),
  };
}

export async function refreshAppKey({
  appKey,
  secret,
} = {}) {
  const { appKeyRecord } = await resolveAppKeyCredentials({
    appKey,
    secret,
    allowExpired: true,
    updateLastUsed: false,
  });

  const now = new Date();
  const newAppKey = buildAppKey();
  appKeyRecord.appKeyHash = hashAppKey(newAppKey);
  appKeyRecord.appKeyPrefix = newAppKey.slice(0, 10);
  appKeyRecord.appKeyLast4 = newAppKey.slice(-4);
  appKeyRecord.expiresAt = buildExpiresAt(now);
  appKeyRecord.refreshedAt = now;
  appKeyRecord.lastUsedAt = null;
  appKeyRecord.rotationCount = (Number(appKeyRecord.rotationCount) || 0) + 1;
  await appKeyRecord.save();

  return {
    appKey: newAppKey,
    tokenType: 'AppKey',
    expiresAt: appKeyRecord.expiresAt,
    appKeyRecord: formatAppKeyRecord(appKeyRecord),
  };
}

export async function revokeAppKeyForUser(userId) {
  await getDBConnectionString();

  const normalizedUserId = validateUserId(userId);
  const now = new Date();
  const appKeyRecord = await AppKey.findOneAndUpdate(
    {
      userId: normalizedUserId,
      status: 'active',
      revokedAt: null,
    },
    {
      $set: {
        status: 'revoked',
        revokedAt: now,
      },
    },
    { new: true },
  );

  if (!appKeyRecord) {
    const error = new Error('Active APP_KEY not found for this user.');
    error.status = 404;
    throw error;
  }

  return formatAppKeyRecord(appKeyRecord);
}
