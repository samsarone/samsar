const PRODUCTION_ENVIRONMENT = 'production';
const SHARED_AUTH_COOKIE_NAME = 'authToken';
const HOST_ONLY_AUTH_COOKIE_NAME = 'samsarHostAuthToken';
const SHARED_AUTH_COOKIE_DOMAIN = '.samsar.one';

function isSamsarProductionHost(hostname) {
  const normalizedHostname = String(hostname || '').trim().toLowerCase();
  return normalizedHostname === 'samsar.one' || normalizedHostname.endsWith('.samsar.one');
}

export function getAuthCookiePolicy(currentEnvironment, hostname) {
  const isRemoteProduction =
    String(currentEnvironment || '').trim().toLowerCase() === PRODUCTION_ENVIRONMENT &&
    isSamsarProductionHost(hostname);

  if (isRemoteProduction) {
    return {
      cookieName: SHARED_AUTH_COOKIE_NAME,
      domain: SHARED_AUTH_COOKIE_DOMAIN,
      isSharedAcrossSubdomains: true,
    };
  }

  return {
    cookieName: HOST_ONLY_AUTH_COOKIE_NAME,
    domain: null,
    isSharedAcrossSubdomains: false,
  };
}
