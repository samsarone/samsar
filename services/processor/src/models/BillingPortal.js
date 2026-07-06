const DEFAULT_CLIENT_APP = 'https://app.samsar.one';
const DEFAULT_LANDING_APP = 'https://www.samsar.one';
const APP_BASE_ENV_KEYS = [
  'CLIENT_APP',
  'CLIENT_APP_LOCAL',
  'LANDING_APP',
  'LANDING_APP_LOCAL',
  'SUPERREFERRER_APP',
  'SUPERREFERRER_APP_LOCAL',
  'SUPERREFERRER_ADMIN_APP',
];

const normalizeBaseUrl = (value) => {
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
};

const getAllowedAppBaseUrls = () => {
  const defaults = [
    DEFAULT_CLIENT_APP,
    DEFAULT_LANDING_APP,
    'https://samsar.one',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://localhost:3010',
  ];

  const values = [...defaults];
  for (const key of APP_BASE_ENV_KEYS) {
    values.push(process.env[key]);
  }

  const normalized = new Set();
  values.forEach((value) => {
    const nextValue = normalizeBaseUrl(value);
    if (nextValue) normalized.add(nextValue);
  });

  return normalized;
};

export function sanitizeInternalPath(path, fallback = '/') {
  if (typeof path !== 'string') return fallback;
  const trimmed = path.trim();
  if (!trimmed) return fallback;

  if (trimmed.startsWith('//')) return fallback;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return fallback;

  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export function resolveTrustedAppBaseUrl(candidate, fallbackCandidate = DEFAULT_CLIENT_APP) {
  const allowedBases = getAllowedAppBaseUrls();
  const normalizedFallback =
    normalizeBaseUrl(fallbackCandidate) ||
    normalizeBaseUrl(process.env.CLIENT_APP) ||
    DEFAULT_CLIENT_APP;

  const normalizedCandidate = normalizeBaseUrl(candidate);
  if (normalizedCandidate && allowedBases.has(normalizedCandidate)) {
    return normalizedCandidate;
  }

  return normalizedFallback;
}

export function resolveBillingPathForApp(appBaseUrl) {
  const normalizedBase = resolveTrustedAppBaseUrl(appBaseUrl, DEFAULT_CLIENT_APP);
  return normalizedBase.includes('app.samsar.one') ? '/account/billing' : '/billing';
}

export function buildAppUrl(appBaseUrl, path = '/', query = {}) {
  const normalizedBase = resolveTrustedAppBaseUrl(appBaseUrl, DEFAULT_CLIENT_APP);
  const normalizedPath = sanitizeInternalPath(path, '/');
  const url = new URL(normalizedPath, `${normalizedBase}/`);

  if (query && typeof query === 'object') {
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '') return;
      url.searchParams.set(key, String(value));
    });
  }

  return url.toString();
}

export function getBillingPortalUrl() {
  const explicitPortalUrl = process.env.BILLING_PORTAL_URL;
  if (typeof explicitPortalUrl === 'string' && explicitPortalUrl.trim()) {
    try {
      const parsed = new URL(explicitPortalUrl.trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      // Ignore invalid configured URL and fall back to derived billing URL.
    }
  }

  const landingBase = resolveTrustedAppBaseUrl(process.env.LANDING_APP, DEFAULT_LANDING_APP);
  return buildAppUrl(landingBase, '/billing');
}
