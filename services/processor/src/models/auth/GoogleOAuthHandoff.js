import { createHash, randomBytes } from 'node:crypto';
import GoogleOAuthHandoffCode from '../../schema/GoogleOAuthHandoffCode.js';
import { getDBConnectionString } from '../DBString.js';

const DEFAULT_HANDOFF_TTL_SECONDS = 90;
const HANDOFF_CODE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export class GoogleOAuthHandoffError extends Error {
  constructor(message = 'Google login handoff is invalid or has expired.') {
    super(message);
    this.name = 'GoogleOAuthHandoffError';
    this.code = 'INVALID_GOOGLE_OAUTH_HANDOFF';
    this.status = 400;
    this.statusCode = 400;
  }
}

function getHandoffTtlSeconds(env = process.env) {
  const parsed = Number.parseInt(env.SAMSAR_GOOGLE_OAUTH_HANDOFF_TTL_SECONDS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HANDOFF_TTL_SECONDS;
}

function hashValue(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new GoogleOAuthHandoffError(`Google OAuth ${label} is invalid.`);
  }
  return value;
}

function validateCode(value) {
  const code = typeof value === 'string' ? value.trim() : '';
  if (!HANDOFF_CODE_PATTERN.test(code)) {
    throw new GoogleOAuthHandoffError();
  }
  return code;
}

export async function issueGoogleOAuthHandoff({
  userId,
  nonceHash,
  redirect,
  isNewUser = false,
}, {
  model = GoogleOAuthHandoffCode,
  connect = getDBConnectionString,
  now = () => new Date(),
  randomBytesImpl = randomBytes,
  env = process.env,
} = {}) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : userId?.toString?.();
  if (!normalizedUserId || typeof redirect !== 'string' || !redirect) {
    throw new GoogleOAuthHandoffError('Google OAuth handoff data is incomplete.');
  }
  validateHash(nonceHash, 'nonce binding');

  await connect();
  const code = randomBytesImpl(32).toString('base64url');
  const issuedAt = now();
  const expiresAt = new Date(issuedAt.getTime() + getHandoffTtlSeconds(env) * 1000);
  await model.create({
    codeHash: hashValue(code),
    nonceHash,
    userId: normalizedUserId,
    redirect,
    isNewUser: isNewUser === true,
    expiresAt,
  });

  return { code, expiresAt };
}

export async function consumeGoogleOAuthHandoff({ code, nonce }, {
  model = GoogleOAuthHandoffCode,
  connect = getDBConnectionString,
  now = () => new Date(),
} = {}) {
  const normalizedCode = validateCode(code);
  const normalizedNonce = validateCode(nonce);
  await connect();

  const record = await model.findOneAndDelete({
    codeHash: hashValue(normalizedCode),
    nonceHash: hashValue(normalizedNonce),
    expiresAt: { $gt: now() },
  }).lean();

  if (!record) {
    throw new GoogleOAuthHandoffError();
  }

  return {
    userId: record.userId,
    redirect: record.redirect,
    isNewUser: record.isNewUser === true,
  };
}

export const _test = {
  DEFAULT_HANDOFF_TTL_SECONDS,
  HANDOFF_CODE_PATTERN,
  hashValue,
};
