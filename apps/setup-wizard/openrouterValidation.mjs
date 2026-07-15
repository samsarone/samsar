import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const OPENROUTER_KEY_VALIDATION_URL = 'https://openrouter.ai/api/v1/key';
export const OPENROUTER_PROVIDER_VALIDATION_TTL_MS = 60 * 60 * 1000;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildCredentialFingerprint(apiKey) {
  return createHash('sha256').update(normalizeString(apiKey)).digest('hex');
}

export function createOpenRouterValidationRegistry({
  ttlMs = OPENROUTER_PROVIDER_VALIDATION_TTL_MS,
  now = () => Date.now(),
  tokenFactory = () => randomBytes(32).toString('hex'),
} = {}) {
  const validations = new Map();

  function pruneExpired(currentTime = now()) {
    for (const [token, validation] of validations.entries()) {
      if (validation.expiresAt <= currentTime) {
        validations.delete(token);
      }
    }
  }

  return {
    register(apiKey) {
      pruneExpired();
      const token = normalizeString(tokenFactory());
      if (!token) {
        throw new Error('Unable to create an OpenRouter validation token.');
      }
      validations.set(token, {
        fingerprint: buildCredentialFingerprint(apiKey),
        expiresAt: now() + ttlMs,
      });
      return token;
    },

    consume(token, apiKey) {
      pruneExpired();
      const normalizedToken = normalizeString(token);
      const validation = validations.get(normalizedToken);
      if (!validation) {
        return false;
      }

      validations.delete(normalizedToken);
      const expectedFingerprint = Buffer.from(validation.fingerprint, 'hex');
      const actualFingerprint = Buffer.from(buildCredentialFingerprint(apiKey), 'hex');
      return (
        expectedFingerprint.length === actualFingerprint.length &&
        timingSafeEqual(expectedFingerprint, actualFingerprint)
      );
    },
  };
}

export async function validateOpenRouterProviderCredential(
  credentials = {},
  { fetchImpl = globalThis.fetch, endpoint = OPENROUTER_KEY_VALIDATION_URL } = {},
) {
  const apiKey = normalizeString(
    credentials.openrouterApiKey ||
    credentials.openrouter_api_key ||
    credentials.apiKey,
  );
  if (!apiKey) {
    return { providers: {} };
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('OpenRouter credential validation is unavailable in this runtime.');
  }

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });
  } catch (error) {
    throw new Error(`Unable to reach OpenRouter for credential validation: ${error?.message || error}`);
  }

  if (!response.ok) {
    const authenticationFailure = response.status === 401 || response.status === 403;
    throw new Error(
      authenticationFailure
        ? 'OpenRouter rejected the API key.'
        : `OpenRouter credential validation failed with status ${response.status}.`,
    );
  }

  const body = await response.json().catch(() => null);
  if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    throw new Error('OpenRouter returned an invalid key-validation response.');
  }
  if (body.data.is_management_key === true) {
    throw new Error('OpenRouter management keys cannot be used for inference.');
  }

  return {
    providers: {
      openrouter: {
        provider: 'openrouter',
        status: 'valid',
        ok: true,
        validationMode: 'remote_key',
      },
    },
  };
}
