import { AsyncLocalStorage } from 'async_hooks';

const requestContextStorage = new AsyncLocalStorage();

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = value?.toString?.().trim?.() || '';
  return normalized || null;
}

export function normalizeAPIKeyUsageContext(context = {}) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null;
  }

  const apiKeyId = normalizeOptionalString(context.apiKeyId);
  if (!apiKeyId) {
    return null;
  }

  return {
    apiKeyId,
    apiKeyUsageLimit:
      context.apiKeyUsageLimit ?? context.usageLimit ?? context.limit ?? null,
    apiKeyUsageLimitPeriod:
      normalizeOptionalString(
        context.apiKeyUsageLimitPeriod ?? context.usageLimitPeriod ?? context.limitPeriod,
      ),
  };
}

export function withRequestContext(req, res, next) {
  requestContextStorage.run({ authContext: null }, next);
}

export function setRequestAuthContext(authContext = null) {
  const store = requestContextStorage.getStore();
  if (!store) {
    return;
  }

  store.authContext = authContext;
}

export function getRequestAuthContext() {
  return requestContextStorage.getStore()?.authContext || null;
}

export function getCurrentAPIKeyUsageContext() {
  const authContext = getRequestAuthContext();
  if (authContext?.authType !== 'api_key') {
    return null;
  }

  return normalizeAPIKeyUsageContext(authContext);
}
