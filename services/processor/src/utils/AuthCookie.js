function normalizeString(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isIpv4Address(value) {
  const parts = value.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

export function normalizeAuthCookieDomain(value) {
  const normalized = normalizeString(value);
  if (!normalized) return '';

  const hostname = normalized.replace(/^\./, '');
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.includes(':') ||
    hostname.includes('/') ||
    hostname.includes('\\') ||
    hostname.includes('..') ||
    isIpv4Address(hostname) ||
    hostname.length > 253
  ) {
    return '';
  }

  const labels = hostname.split('.');
  if (
    labels.length < 2 ||
    labels.some((label) => (
      !label ||
      label.length > 63 ||
      !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    ))
  ) {
    return '';
  }

  return normalized.startsWith('.') ? `.${hostname}` : hostname;
}

export function getAuthCookieDomain(env = process.env) {
  return normalizeAuthCookieDomain(
    env?.SAMSAR_AUTH_COOKIE_DOMAIN || env?.AUTH_COOKIE_DOMAIN,
  );
}
