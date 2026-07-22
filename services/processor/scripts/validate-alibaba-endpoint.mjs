import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_ALIBABA_COMPATIBLE_BASE_URL =
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const DEFAULT_VALIDATION_TIMEOUT_MS = 20000;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function getAlibabaEndpointType(value) {
  let hostname;
  try {
    hostname = new URL(value).hostname.toLowerCase();
  } catch {
    return 'unknown';
  }

  if (hostname.includes('token-plan')) {
    return 'token_plan';
  }
  if (hostname === 'coding.dashscope.aliyuncs.com' ||
    hostname === 'coding-intl.dashscope.aliyuncs.com') {
    return 'coding_plan';
  }
  return 'pay_as_you_go';
}

export function getAlibabaKeyType(apiKey, baseUrl) {
  const endpointType = getAlibabaEndpointType(baseUrl);
  if (endpointType !== 'pay_as_you_go') {
    return endpointType;
  }
  return normalizeString(apiKey).startsWith('sk-sp-') ? 'plan' : 'pay_as_you_go';
}

export function getAlibabaCompatibleBaseUrl(value) {
  const configured = normalizeString(value);
  if (!configured) {
    return DEFAULT_ALIBABA_COMPATIBLE_BASE_URL;
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(configured)
    ? configured
    : `https://${configured}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== 'https:') {
    throw new Error('Alibaba Cloud API host must use HTTPS.');
  }

  const normalizedPath = parsed.pathname.replace(/\/+$/, '');
  const compatiblePathMatch = normalizedPath.match(/^(.*\/compatible-mode)(?:\/v1)?(?:\/.*)?$/i);
  if (compatiblePathMatch) {
    return `${parsed.origin}${compatiblePathMatch[1]}/v1`;
  }

  return `${parsed.origin}/compatible-mode/v1`;
}

function buildValidationResult(status, extra = {}) {
  return {
    provider: 'alibabaCloud',
    ok: status === 'valid',
    status,
    validationMode: 'remote_models',
    ...extra,
  };
}

function summarizeModels(body = {}) {
  const modelIds = Array.isArray(body?.data)
    ? body.data
      .map((model) => normalizeString(model?.id || model?.model))
      .filter(Boolean)
    : [];
  const normalizedModelIds = new Set(modelIds.map((model) => model.toLowerCase()));
  return {
    modelCount: modelIds.length,
    qwen38MaxPreviewAvailable: normalizedModelIds.has('qwen3.8-max-preview'),
    qwen37MaxAvailable: normalizedModelIds.has('qwen3.7-max'),
    qwen37PlusAvailable: normalizedModelIds.has('qwen3.7-plus'),
  };
}

export async function validateAlibabaEndpoint({
  apiKey,
  apiHost,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_VALIDATION_TIMEOUT_MS,
} = {}) {
  const normalizedApiKey = normalizeString(apiKey);
  if (!normalizedApiKey) {
    return buildValidationResult('invalid', {
      message: 'Alibaba Cloud Model Studio API key is required.',
    });
  }
  let baseUrl;
  try {
    baseUrl = getAlibabaCompatibleBaseUrl(apiHost);
  } catch {
    return buildValidationResult('invalid', {
      message: 'Alibaba Cloud API host or endpoint is invalid.',
    });
  }
  const endpointType = getAlibabaEndpointType(baseUrl);
  const keyType = getAlibabaKeyType(normalizedApiKey, baseUrl);

  if (typeof fetchImpl !== 'function') {
    return buildValidationResult('error', {
      baseUrl,
      message: 'This Node.js runtime does not support endpoint validation.',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Number(timeoutMs) || DEFAULT_VALIDATION_TIMEOUT_MS),
  );

  try {
    const response = await fetchImpl(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${normalizedApiKey}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      return buildValidationResult('invalid', {
        baseUrl,
        statusCode: response.status,
        message: 'Alibaba Cloud rejected the API key or endpoint.',
      });
    }
    if (!Array.isArray(body?.data)) {
      return buildValidationResult('invalid', {
        baseUrl,
        message: 'Alibaba Cloud endpoint did not return an OpenAI-compatible model listing.',
      });
    }

    return buildValidationResult('valid', {
      baseUrl,
      billingMode: keyType,
      keyType,
      endpointType,
      ...summarizeModels(body),
    });
  } catch (error) {
    return buildValidationResult('error', {
      baseUrl,
      message: error?.name === 'AbortError'
        ? 'Alibaba Cloud endpoint validation timed out.'
        : 'Unable to reach the Alibaba Cloud endpoint.',
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const result = await validateAlibabaEndpoint({
    apiKey: process.env.SAMSAR_VALIDATION_ALIBABA_API_KEY,
    apiHost: process.env.SAMSAR_VALIDATION_ALIBABA_API_HOST,
  });
  process.stdout.write(JSON.stringify(result));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  await main();
}
