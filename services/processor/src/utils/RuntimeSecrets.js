import { createHash, timingSafeEqual } from 'node:crypto';

const MIN_RUNTIME_SECRET_BYTES = 32;

const KNOWN_PUBLIC_SECRET_VALUES = new Set([
  'change-me-in-production',
  'local-development-only-secret',
  'replace-with-at-least-32-random-characters',
  'samsar-newsletter-unsubscribe',
]);
const SECRET_CONTROL_CHARACTERS = /[\0\r\n]/;

export function isKnownPublicRuntimeSecret(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return (
    KNOWN_PUBLIC_SECRET_VALUES.has(normalized) ||
    normalized.startsWith('samsar-local-')
  );
}

export function validateRuntimeSecret(name, value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} environment variable must be explicitly configured.`);
  }

  const secret = value.trim();
  if (SECRET_CONTROL_CHARACTERS.test(value)) {
    throw new Error(`${name} must not contain NUL, carriage-return, or newline characters.`);
  }
  if (isKnownPublicRuntimeSecret(secret)) {
    throw new Error(`${name} must not use a known public/default value.`);
  }
  if (Buffer.byteLength(secret, 'utf8') < MIN_RUNTIME_SECRET_BYTES) {
    throw new Error(`${name} must contain at least ${MIN_RUNTIME_SECRET_BYTES} bytes.`);
  }

  return secret;
}

export function getTokenSecret(env = process.env) {
  return validateRuntimeSecret('TOKEN_SECRET', env.TOKEN_SECRET);
}

export function getCustomAdapterSecret(env = process.env) {
  return validateRuntimeSecret(
    'CUSTOM_ADAPTER_SECRET_KEY',
    env.CUSTOM_ADAPTER_SECRET_KEY,
  );
}

export function runtimeSecretMatches(name, candidate, env = process.env) {
  if (typeof candidate !== 'string' || !candidate) {
    return false;
  }

  let expected;
  try {
    expected = validateRuntimeSecret(name, env[name]);
  } catch {
    return false;
  }

  const expectedDigest = createHash('sha256').update(expected).digest();
  const candidateDigest = createHash('sha256').update(candidate).digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}
