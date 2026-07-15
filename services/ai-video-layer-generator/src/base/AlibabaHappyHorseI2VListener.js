import axios from 'axios';

const DEFAULT_ALIBABA_VIDEO_BASE_URL = 'https://dashscope-intl.aliyuncs.com';
const HAPPY_HORSE_MODEL = 'happyhorse-1.1-i2v';
const HAPPY_HORSE_DURATION_OPTIONS = Object.freeze([5, 10, 15]);
const HAPPY_HORSE_REQUEST_PREFIX = 'alibaba-happyhorse:';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getConfiguredAlibabaVideoHost(env = process.env) {
  return normalizeString(
    env?.ALIBABA_VIDEO_BASE_URL ||
    env?.DASHSCOPE_VIDEO_BASE_URL ||
    env?.ALIBABA_API_HOST ||
    env?.DASHSCOPE_BASE_URL ||
    env?.ALIBABA_CLOUD_BASE_URL,
  );
}

function normalizeAlibabaVideoBaseUrl(value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    return DEFAULT_ALIBABA_VIDEO_BASE_URL;
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(normalized)
    ? normalized
    : `https://${normalized}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'https:') {
      throw new Error('Alibaba Model Studio endpoints must use HTTPS.');
    }
    return parsed.origin;
  } catch {
    throw new Error('ALIBABA_API_HOST must be a valid HTTPS Alibaba Model Studio host or URL.');
  }
}

function getAlibabaErrorMessage(data = {}, fallback) {
  return normalizeString(data?.output?.message) ||
    normalizeString(data?.message) ||
    normalizeString(data?.output?.code) ||
    normalizeString(data?.code) ||
    fallback;
}

function buildAlibabaProviderStatus(data = {}) {
  return {
    requestId: data?.request_id || null,
    taskId: data?.output?.task_id || null,
    taskStatus: data?.output?.task_status || null,
    code: data?.output?.code || data?.code || null,
    message: data?.output?.message || data?.message || null,
    usage: data?.usage || null,
  };
}

function throwAlibabaResponseError(data = {}, fallbackMessage, status, headers) {
  const error = new Error(getAlibabaErrorMessage(data, fallbackMessage));
  error.name = 'AlibabaHappyHorseError';
  error.code = data?.output?.code || data?.code || null;
  error.status = status || null;
  error.headers = headers || {};
  error.body = buildAlibabaProviderStatus(data);
  throw error;
}

function throwAlibabaAxiosResponseError(error, fallbackMessage) {
  if (!error?.response) {
    throw error;
  }

  const responseData = error.response.data;
  const data = responseData && typeof responseData === 'object'
    ? responseData
    : { message: normalizeString(responseData) };
  throwAlibabaResponseError(
    data,
    fallbackMessage,
    error.response.status,
    error.response.headers,
  );
}

export function getAlibabaHappyHorseApiKey(env = process.env) {
  return normalizeString(
    env?.DASHSCOPE_API_KEY ||
    env?.ALIBABA_CLOUD_API_KEY ||
    env?.ALIBABA_API_KEY ||
    env?.QWEN_API_KEY,
  );
}

export function hasAlibabaHappyHorseCredential(env = process.env) {
  return Boolean(getAlibabaHappyHorseApiKey(env));
}

export function getAlibabaHappyHorseBaseUrl(env = process.env) {
  return normalizeAlibabaVideoBaseUrl(getConfiguredAlibabaVideoHost(env));
}

export function getAlibabaHappyHorseSubmitUrl(env = process.env) {
  return `${getAlibabaHappyHorseBaseUrl(env)}/api/v1/services/aigc/video-generation/video-synthesis`;
}

export function getAlibabaHappyHorseTaskUrl(taskId, env = process.env) {
  const normalizedTaskId = normalizeString(taskId);
  if (!normalizedTaskId) {
    throw new Error('Alibaba Happy Horse polling requires a task id.');
  }
  return `${getAlibabaHappyHorseBaseUrl(env)}/api/v1/tasks/${encodeURIComponent(normalizedTaskId)}`;
}

export function normalizeAlibabaHappyHorseDuration(duration) {
  const parsedDuration = Number(duration);
  if (!Number.isFinite(parsedDuration)) {
    return HAPPY_HORSE_DURATION_OPTIONS[0];
  }

  return HAPPY_HORSE_DURATION_OPTIONS.find((unit) => unit >= parsedDuration) ||
    HAPPY_HORSE_DURATION_OPTIONS[HAPPY_HORSE_DURATION_OPTIONS.length - 1];
}

export function buildAlibabaHappyHorseI2VPayload(payload = {}) {
  const startImage = normalizeString(
    payload.startImage ||
    payload.imageUrl ||
    payload.imageURL ||
    payload.image_url ||
    payload.start_image_url,
  );
  if (!startImage) {
    throw new Error('Alibaba Happy Horse image-to-video requires a first-frame image.');
  }

  const input = {
    media: [{ type: 'first_frame', url: startImage }],
  };
  const prompt = normalizeString(payload.prompt);
  if (prompt) {
    input.prompt = prompt;
  }

  // Native Happy Horse I2V derives the output ratio from the first frame and
  // rejects a ratio parameter, so the upstream ratio-shaped image is sufficient.
  return {
    model: HAPPY_HORSE_MODEL,
    input,
    parameters: {
      resolution: '720P',
      duration: normalizeAlibabaHappyHorseDuration(payload.duration),
      watermark: false,
    },
  };
}

export function encodeAlibabaHappyHorseGenerationId(taskId) {
  const normalizedTaskId = normalizeString(taskId);
  if (!normalizedTaskId) {
    throw new Error('Alibaba Happy Horse submit returned no task id.');
  }
  return `${HAPPY_HORSE_REQUEST_PREFIX}${normalizedTaskId}`;
}

export function isAlibabaHappyHorseGenerationId(generationId) {
  return normalizeString(generationId).startsWith(HAPPY_HORSE_REQUEST_PREFIX);
}

export function getAlibabaHappyHorseTaskId(generationId) {
  const normalizedGenerationId = normalizeString(generationId);
  if (!normalizedGenerationId.startsWith(HAPPY_HORSE_REQUEST_PREFIX)) {
    return '';
  }
  return normalizedGenerationId.slice(HAPPY_HORSE_REQUEST_PREFIX.length);
}

export function parseAlibabaHappyHorseTask(data = {}) {
  if (data?.code || (!data?.output && data?.message)) {
    throwAlibabaResponseError(data, 'Alibaba Happy Horse polling failed.');
  }

  const taskStatus = normalizeString(data?.output?.task_status).toUpperCase();
  if (taskStatus === 'SUCCEEDED') {
    const remoteUrl = normalizeString(data?.output?.video_url);
    if (!remoteUrl) {
      return {
        responseStatus: 'FAILED',
        providerFailureMessage: 'Alibaba Happy Horse completed without a video URL.',
        providerStatus: buildAlibabaProviderStatus(data),
      };
    }
    return {
      responseStatus: 'COMPLETED',
      remoteUrl,
      providerStatus: buildAlibabaProviderStatus(data),
    };
  }

  if (taskStatus === 'PENDING' || taskStatus === 'RUNNING') {
    return {
      responseStatus: 'PENDING',
      providerStatus: buildAlibabaProviderStatus(data),
    };
  }

  if (['FAILED', 'CANCELED', 'UNKNOWN'].includes(taskStatus)) {
    return {
      responseStatus: 'FAILED',
      providerFailureMessage: getAlibabaErrorMessage(
        data,
        `Alibaba Happy Horse task ended with status ${taskStatus}.`,
      ),
      providerStatus: buildAlibabaProviderStatus(data),
    };
  }

  return {
    responseStatus: 'FAILED',
    providerFailureMessage: taskStatus
      ? `Alibaba Happy Horse returned unsupported task status ${taskStatus}.`
      : 'Alibaba Happy Horse returned no task status.',
    providerStatus: buildAlibabaProviderStatus(data),
  };
}

function getAlibabaHeaders({ includeAsyncHeader = false } = {}) {
  const apiKey = getAlibabaHappyHorseApiKey();
  if (!apiKey) {
    throw new Error(
      'DASHSCOPE_API_KEY (or ALIBABA_CLOUD_API_KEY/ALIBABA_API_KEY/QWEN_API_KEY) is required for native Alibaba Happy Horse video generation.',
    );
  }

  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(includeAsyncHeader ? { 'X-DashScope-Async': 'enable' } : {}),
  };
}

export async function generateAlibabaHappyHorseImgToVideoLayer(payload = {}) {
  let response;
  try {
    response = await axios.post(
      getAlibabaHappyHorseSubmitUrl(),
      buildAlibabaHappyHorseI2VPayload(payload),
      {
        headers: getAlibabaHeaders({ includeAsyncHeader: true }),
        timeout: Number(process.env.ALIBABA_VIDEO_SUBMIT_TIMEOUT_MS) || 120000,
      },
    );
  } catch (error) {
    throwAlibabaAxiosResponseError(error, 'Alibaba Happy Horse task submission failed.');
  }

  if (response?.data?.code) {
    throwAlibabaResponseError(
      response.data,
      'Alibaba Happy Horse task submission failed.',
      response.status,
    );
  }

  return encodeAlibabaHappyHorseGenerationId(response?.data?.output?.task_id);
}

export async function listenToPendingAlibabaHappyHorseImgToVidRequests(payload = {}) {
  const taskId = getAlibabaHappyHorseTaskId(payload.generationId);
  if (!taskId) {
    throw new Error('Alibaba Happy Horse polling called without an Alibaba generation id.');
  }

  let response;
  try {
    response = await axios.get(getAlibabaHappyHorseTaskUrl(taskId), {
      headers: getAlibabaHeaders(),
      timeout: Number(process.env.ALIBABA_VIDEO_POLL_TIMEOUT_MS) || 30000,
    });
  } catch (error) {
    throwAlibabaAxiosResponseError(error, 'Alibaba Happy Horse task polling failed.');
  }

  return parseAlibabaHappyHorseTask(response?.data);
}
