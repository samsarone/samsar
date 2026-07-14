import fetch from 'node-fetch';
import { GoogleAuth } from 'google-auth-library';

import User from '../../schema/User.js';
import { getDBConnectionString } from '../DBString.js';
import { resolveRequestActorFromAuthHeaders } from '../external/User.js';
import { validateAlibabaCloudCredential } from '../../inference/AlibabaEndpointValidator.js';

const GOOGLE_CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const RUNWAY_ORGANIZATION_URL = 'https://api.dev.runwayml.com/v1/organization';

export const DEPLOYMENT_PROVIDER_CAPABILITIES = Object.freeze({
  samsar: {
    label: 'Samsar API Key',
    requiredFor: ['All models', 'All actions'],
    models: ['gpt-5.6-sol', 'gemini-3.1-pro', 'QWEN3.7', 'GPTIMAGE2', 'RUNWAYML', 'VEO3.1I2V', 'LYRIA3', 'OPENAI_TTS', 'GOOGLE_TTS', 'MMAUDIO', 'LATENT_SYNC'],
    actions: ['chat', 'assistant', 'image', 'video', 'audio', 'lip_sync', 'sound_effect'],
  },
  openai: {
    label: 'OpenAI',
    requiredFor: ['GPT 5.6 Sol', 'assistant', 'vision', 'moderation', 'OpenAI image', 'OpenAI TTS'],
    models: ['gpt-5.6-sol', 'GPTIMAGE2', 'OPENAI_TTS'],
    actions: ['chat', 'assistant', 'moderation', 'image', 'audio'],
  },
  googleCloud: {
    label: 'Google Cloud',
    requiredFor: ['Gemini 3.1 Pro', 'moderation', 'Veo', 'Lyria', 'Google TTS'],
    models: ['gemini-3.1-pro', 'VEO3.1I2V', 'VEO3.1I2VFAST', 'LYRIA3', 'GOOGLE_TTS'],
    actions: ['chat', 'assistant', 'moderation', 'video', 'audio'],
  },
  alibabaCloud: {
    label: 'Alibaba Cloud',
    requiredFor: ['Qwen 3.7 text inference', 'Qwen 3.7 vision'],
    models: ['QWEN3.7'],
    actions: ['chat', 'assistant'],
  },
  fal: {
    label: 'FAL',
    requiredFor: ['FAL image models', 'FAL audio models', 'lip sync', 'sound effects'],
    models: ['NANOBANANA2', 'NANOBANANAPRO', 'MMAUDIO', 'LATENT_SYNC'],
    actions: ['image', 'audio', 'lip_sync', 'sound_effect'],
  },
  runway: {
    label: 'RunwayML',
    requiredFor: ['Runway video generation', 'image-to-video'],
    models: ['RUNWAYML'],
    actions: ['video'],
  },
});

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = normalizeString(value).toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
}

function providerResult(provider, status, extra = {}) {
  return {
    provider,
    status,
    ok: status === 'valid' || status === 'format_valid',
    ...extra,
  };
}

export function buildAvailableDeploymentModels(providerStatus = {}) {
  const enabledProviders = Object.entries(providerStatus)
    .filter(([, value]) => Boolean(value?.ok || value === true))
    .map(([provider]) => provider);
  const enabledProviderSet = new Set(enabledProviders);
  const modelSet = new Set();
  const actionSet = new Set();

  for (const provider of enabledProviderSet) {
    const capability = DEPLOYMENT_PROVIDER_CAPABILITIES[provider];
    if (!capability) {
      continue;
    }
    capability.models.forEach((model) => modelSet.add(model));
    capability.actions.forEach((action) => actionSet.add(action));
  }

  return {
    providers: enabledProviders,
    models: [...modelSet].sort(),
    actions: [...actionSet].sort(),
  };
}

export async function validateSamsarApiKeyHeaders(headers = {}) {
  const authContext = await resolveRequestActorFromAuthHeaders(headers);
  await getDBConnectionString();

  const user = await User.findById(authContext.internalUserId)
    .select('email username displayName generationCredits')
    .lean();
  if (!user) {
    const error = new Error('User not found for API key.');
    error.status = 401;
    throw error;
  }

  return {
    valid: true,
    authType: authContext.authType,
    email: user.email || null,
    username: user.username || null,
    displayName: user.displayName || null,
    remainingCredits: Number(user.generationCredits) || 0,
  };
}

export async function validateDeploymentProviderCredentials(payload = {}, options = {}) {
  const providerResults = {};

  if (normalizeString(payload.samsarApiKey || payload.samsar_api_key)) {
    providerResults.samsar = await validateSamsarApiKeyHeaders({
      authorization: `Bearer ${normalizeString(payload.samsarApiKey || payload.samsar_api_key)}`,
    }).then(
      (result) => providerResult('samsar', 'valid', result),
      (error) => providerResult('samsar', 'invalid', { message: error?.message || 'Invalid Samsar API key.' }),
    );
  }

  if (normalizeString(payload.openaiApiKey || payload.openai_api_key)) {
    providerResults.openai = await validateOpenAIKey(normalizeString(payload.openaiApiKey || payload.openai_api_key));
  }

  const alibabaApiKey = normalizeString(
    payload.dashscopeApiKey ||
    payload.dashscope_api_key ||
    payload.alibabaCloudApiKey ||
    payload.alibaba_cloud_api_key ||
    payload.alibabaApiKey ||
    payload.alibaba_api_key ||
    payload.qwenApiKey ||
    payload.qwen_api_key,
  );
  if (alibabaApiKey) {
    providerResults.alibabaCloud = await validateAlibabaCloudCredential(
      {
        apiKey: alibabaApiKey,
        baseUrl:
          payload.dashscopeBaseUrl ||
          payload.dashscope_base_url ||
          payload.alibabaCloudBaseUrl ||
          payload.alibaba_cloud_base_url ||
          payload.qwenBaseUrl ||
          payload.qwen_base_url,
        apiHost:
          payload.alibabaApiHost ||
          payload.alibaba_api_host,
      },
      {
        fetchImpl: options.fetchImpl || fetch,
        ...(options.dnsLookup ? { dnsLookup: options.dnsLookup } : {}),
        ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      },
    );
  }

  if (normalizeString(payload.runwayApiKey || payload.runway_api_key)) {
    providerResults.runway = await validateRunwayKey(normalizeString(payload.runwayApiKey || payload.runway_api_key));
  }

  if (normalizeString(payload.falApiKey || payload.fal_api_key)) {
    providerResults.fal = await validateFalKey({
      apiKey: normalizeString(payload.falApiKey || payload.fal_api_key),
      remoteValidation: normalizeBoolean(payload.validateFalRemotely || payload.validate_fal_remotely),
    });
  }

  const googleCredentials =
    payload.googleCredentialsJson ||
    payload.google_credentials_json ||
    payload.googleCredentialsJsonB64 ||
    payload.google_credentials_json_b64;
  if (normalizeString(googleCredentials)) {
    providerResults.googleCloud = await validateGoogleCloudCredentials({
      rawCredentials: normalizeString(googleCredentials),
      isBase64: Boolean(payload.googleCredentialsJsonB64 || payload.google_credentials_json_b64),
      projectId: payload.googleProjectId || payload.google_project_id,
    });
  }

  return {
    providers: providerResults,
    available: buildAvailableDeploymentModels(providerResults),
  };
}

async function validateOpenAIKey(apiKey) {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return providerResult('openai', 'invalid', {
        statusCode: response.status,
        message: 'OpenAI rejected the API key.',
      });
    }

    return providerResult('openai', 'valid');
  } catch (error) {
    return providerResult('openai', 'error', {
      message: error?.message || 'Unable to validate OpenAI API key.',
    });
  }
}

async function validateRunwayKey(apiKey) {
  try {
    const response = await fetch(RUNWAY_ORGANIZATION_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
    });

    if (!response.ok) {
      return providerResult('runway', 'invalid', {
        statusCode: response.status,
        message: 'Runway rejected the API key.',
      });
    }

    return providerResult('runway', 'valid');
  } catch (error) {
    return providerResult('runway', 'error', {
      message: error?.message || 'Unable to validate Runway API key.',
    });
  }
}

async function validateFalKey({ apiKey, remoteValidation = false }) {
  if (!remoteValidation) {
    return providerResult('fal', 'format_valid', {
      validationMode: 'format_only',
      message: 'FAL does not expose a zero-cost key introspection endpoint; remote validation is skipped by default.',
    });
  }

  try {
    const response = await fetch('https://fal.run/fal-ai/flux/schnell', {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt: 'credential validation' }),
    });

    if (!response.ok) {
      return providerResult('fal', 'invalid', {
        statusCode: response.status,
        message: 'FAL rejected the API key.',
      });
    }

    return providerResult('fal', 'valid', { validationMode: 'remote_model_request' });
  } catch (error) {
    return providerResult('fal', 'error', {
      message: error?.message || 'Unable to validate FAL API key.',
    });
  }
}

async function validateGoogleCloudCredentials({ rawCredentials, isBase64 = false, projectId }) {
  try {
    const decodedCredentials = isBase64
      ? Buffer.from(rawCredentials, 'base64').toString('utf8')
      : rawCredentials;
    const credentials = JSON.parse(decodedCredentials);
    const auth = new GoogleAuth({
      credentials,
      projectId: normalizeString(projectId) || credentials.project_id,
      scopes: [GOOGLE_CLOUD_SCOPE],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
    if (!token) {
      return providerResult('googleCloud', 'invalid', {
        message: 'Google credentials did not produce an access token.',
      });
    }
    return providerResult('googleCloud', 'valid', {
      projectId: normalizeString(projectId) || credentials.project_id || null,
      clientEmail: credentials.client_email || null,
    });
  } catch (error) {
    return providerResult('googleCloud', 'invalid', {
      message: error?.message || 'Unable to validate Google Cloud credentials.',
    });
  }
}
