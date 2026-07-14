import dns from 'node:dns/promises';
import net from 'node:net';

const DEFAULT_ALIBABA_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function providerResult(status, extra = {}) {
  return {
    provider: 'alibabaCloud',
    status,
    ok: status === 'valid',
    ...extra,
  };
}

export function normalizeAlibabaCompatibleBaseUrl({ baseUrl, apiHost } = {}) {
  const configuredValue = normalizeString(baseUrl) || normalizeString(apiHost);
  if (!configuredValue) {
    return DEFAULT_ALIBABA_BASE_URL;
  }

  const withProtocol = /^https?:\/\//i.test(configuredValue)
    ? configuredValue
    : `https://${configuredValue}`;
  const withoutTrailingSlash = withProtocol.replace(/\/+$/, '');

  if (/\/compatible-mode\/v1$/i.test(withoutTrailingSlash)) {
    return withoutTrailingSlash;
  }
  if (/\/compatible-mode$/i.test(withoutTrailingSlash)) {
    return `${withoutTrailingSlash}/v1`;
  }
  return `${withoutTrailingSlash}/compatible-mode/v1`;
}

function isAlibabaCloudHostname(hostname) {
  const normalizedHostname = normalizeString(hostname).toLowerCase().replace(/\.$/, '');
  return normalizedHostname === 'aliyuncs.com' || normalizedHostname.endsWith('.aliyuncs.com');
}

function isNonPublicIpv4(address) {
  const octets = address.split('.').map((value) => Number.parseInt(value, 10));
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return true;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isNonPublicIpAddress(address) {
  const normalizedAddress = normalizeString(address).toLowerCase().replace(/^\[|\]$/g, '');
  const addressType = net.isIP(normalizedAddress);
  if (addressType === 4) {
    return isNonPublicIpv4(normalizedAddress);
  }
  if (addressType !== 6) {
    return true;
  }

  if (normalizedAddress.startsWith('::ffff:')) {
    return isNonPublicIpv4(normalizedAddress.slice('::ffff:'.length));
  }

  return (
    normalizedAddress === '::' ||
    normalizedAddress === '::1' ||
    /^f[cd][0-9a-f]{2}:/.test(normalizedAddress) ||
    /^fe[89ab][0-9a-f]:/.test(normalizedAddress) ||
    normalizedAddress.startsWith('ff')
  );
}

function normalizeAndValidateUrl({ baseUrl, apiHost } = {}) {
  const normalizedBaseUrl = normalizeAlibabaCompatibleBaseUrl({ baseUrl, apiHost });
  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedBaseUrl);
  } catch {
    throw new Error('Alibaba Cloud API host must be a valid URL or hostname.');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Alibaba Cloud API endpoint must use HTTPS.');
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error('Alibaba Cloud API endpoint cannot contain credentials, query parameters, or a fragment.');
  }
  if (parsedUrl.port && parsedUrl.port !== '443') {
    throw new Error('Alibaba Cloud API endpoint must use the standard HTTPS port.');
  }
  if (!isAlibabaCloudHostname(parsedUrl.hostname)) {
    throw new Error('Alibaba Cloud API endpoint must use an official aliyuncs.com hostname.');
  }

  return {
    baseUrl: parsedUrl.toString().replace(/\/$/, ''),
    hostname: parsedUrl.hostname,
  };
}

async function assertPublicResolution(hostname, dnsLookup) {
  let addresses;
  try {
    addresses = await dnsLookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new Error(`Alibaba Cloud API hostname could not be resolved: ${error?.message || String(error)}`);
  }

  const normalizedAddresses = Array.isArray(addresses) ? addresses : [addresses];
  if (
    normalizedAddresses.length === 0 ||
    normalizedAddresses.some((entry) => isNonPublicIpAddress(entry?.address || entry))
  ) {
    throw new Error('Alibaba Cloud API hostname must resolve only to public network addresses.');
  }
}

async function cancelResponseBody(response) {
  try {
    if (typeof response?.body?.cancel === 'function') {
      await response.body.cancel();
    } else if (typeof response?.body?.destroy === 'function') {
      response.body.destroy();
    }
  } catch {
    // The response body is intentionally ignored for credential validation.
  }
}

export async function validateAlibabaCloudCredential(
  { apiKey, baseUrl, apiHost } = {},
  {
    fetchImpl = globalThis.fetch,
    dnsLookup = dns.lookup,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {},
) {
  const normalizedApiKey = normalizeString(apiKey);
  if (!normalizedApiKey) {
    return providerResult('invalid', {
      validationMode: 'remote_models',
      message: 'Alibaba Cloud API key is required.',
    });
  }

  let endpoint;
  try {
    endpoint = normalizeAndValidateUrl({ baseUrl, apiHost });
    await assertPublicResolution(endpoint.hostname, dnsLookup);
  } catch (error) {
    return providerResult('invalid', {
      validationMode: 'sandboxed_endpoint',
      message: error?.message || 'Invalid Alibaba Cloud API endpoint.',
    });
  }

  if (typeof fetchImpl !== 'function') {
    return providerResult('error', {
      validationMode: 'remote_models',
      baseUrl: endpoint.baseUrl,
      message: 'Alibaba Cloud endpoint validation is unavailable in this runtime.',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint.baseUrl}/models`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${normalizedApiKey}`,
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    await cancelResponseBody(response);

    if (response.ok) {
      return providerResult('valid', {
        validationMode: 'remote_models',
        baseUrl: endpoint.baseUrl,
        statusCode: response.status,
        message: 'Alibaba Cloud endpoint and credentials verified.',
      });
    }

    if (response.status === 401 || response.status === 403) {
      return providerResult('invalid', {
        validationMode: 'remote_models',
        baseUrl: endpoint.baseUrl,
        statusCode: response.status,
        message: 'Alibaba Cloud rejected the API key for this endpoint.',
      });
    }

    if (response.status === 429) {
      return providerResult('error', {
        validationMode: 'remote_models',
        baseUrl: endpoint.baseUrl,
        statusCode: response.status,
        message: 'Alibaba Cloud rate limited the validation request. Wait briefly and validate again.',
      });
    }

    return providerResult('error', {
      validationMode: 'remote_models',
      baseUrl: endpoint.baseUrl,
      statusCode: response.status,
      message: `Alibaba Cloud endpoint validation returned HTTP ${response.status}.`,
    });
  } catch (error) {
    return providerResult('error', {
      validationMode: 'remote_models',
      baseUrl: endpoint.baseUrl,
      message: error?.name === 'AbortError'
        ? 'Alibaba Cloud endpoint validation timed out.'
        : `Unable to reach the Alibaba Cloud endpoint: ${error?.message || String(error)}`,
    });
  } finally {
    clearTimeout(timeout);
  }
}
