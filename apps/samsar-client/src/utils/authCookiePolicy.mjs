const PRODUCTION_ENVIRONMENT = 'production';
const SHARED_AUTH_COOKIE_NAME = 'authToken';
const HOST_ONLY_AUTH_COOKIE_NAME = 'samsarHostAuthToken';

function normalizeHostname(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

export function normalizeAuthCookieDomain(value) {
  const normalized = normalizeHostname(value).replace(/^\./, '');
  if (!normalized || !normalized.includes('.')) return null;
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(normalized)) return null;
  if (normalized.split('.').some((label) => !label || label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
    return null;
  }

  return `.${normalized}`;
}

export function resolveAuthCookieDomain(configuredDomain, hostname) {
  const domain = normalizeAuthCookieDomain(configuredDomain);
  if (!domain) return null;

  const normalizedHostname = normalizeHostname(hostname);
  const domainHostname = domain.slice(1);
  const belongsToDomain =
    normalizedHostname === domainHostname
    || normalizedHostname.endsWith(`.${domainHostname}`);

  return belongsToDomain ? domain : null;
}

export function getAuthCookiePolicy(currentEnvironment, hostname, configuredDomain) {
  const isProduction =
    String(currentEnvironment || '').trim().toLowerCase() === PRODUCTION_ENVIRONMENT;
  const sharedDomain = isProduction
    ? resolveAuthCookieDomain(configuredDomain, hostname)
    : null;

  if (isProduction) {
    return {
      cookieName: SHARED_AUTH_COOKIE_NAME,
      domain: sharedDomain,
      isSharedAcrossSubdomains: Boolean(sharedDomain),
    };
  }

  return {
    cookieName: HOST_ONLY_AUTH_COOKIE_NAME,
    domain: null,
    isSharedAcrossSubdomains: false,
  };
}
