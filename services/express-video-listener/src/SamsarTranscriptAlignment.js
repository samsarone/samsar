import fs from 'fs';
import path from 'path';
import SamsarClient from 'samsar-js';
import { isStandaloneEdition } from './utils/EnvironmentUtils.js';

const DEFAULT_SAMSAR_API_BASE_URL = 'https://api.samsar.one/v1';
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

let cachedClient = null;
let cachedClientKey = '';
let cachedBaseUrl = '';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}
function normalizeBaseUrl(value) {
  return (normalizeString(value) || DEFAULT_SAMSAR_API_BASE_URL).replace(/\/+$/, '');
}

function getAudioContentType(audioFilePath) {
  switch (path.extname(audioFilePath).toLowerCase()) {
    case '.wav': return 'audio/wav';
    case '.m4a': return 'audio/mp4';
    case '.mp4': return 'audio/mp4';
    case '.mpeg': return 'audio/mpeg';
    case '.mpga': return 'audio/mpeg';
    case '.ogg': return 'audio/ogg';
    case '.webm': return 'audio/webm';
    default: return 'audio/mpeg';
  }
}

function getSamsarClient() {
  const apiKey = normalizeString(process.env.SAMSAR_API_KEY);
  if (!apiKey) {
    const error = new Error('SAMSAR_API_KEY is required for delegated transcript alignment.');
    error.code = 'SAMSAR_TRANSCRIPT_ALIGNMENT_NOT_CONFIGURED';
    error.status = 503;
    throw error;
  }

  const baseUrl = normalizeBaseUrl(process.env.SAMSAR_JS_API_URL || process.env.SAMSAR_API_URL);
  if (!cachedClient || cachedClientKey !== apiKey || cachedBaseUrl !== baseUrl) {
    cachedClient = new SamsarClient({
      apiKey,
      baseUrl,
      timeoutMs: Number(process.env.SAMSAR_TRANSCRIPT_ALIGN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
    });
    cachedClientKey = apiKey;
    cachedBaseUrl = baseUrl;
  }
  return cachedClient;
}

export function shouldUseSamsarTranscriptAlignment(env = process.env) {
  return isStandaloneEdition(env) &&
    !normalizeString(env?.OPENAI_API_KEY) &&
    Boolean(normalizeString(env?.SAMSAR_API_KEY));
}

export async function requestSamsarTranscriptAlignment(
  audioFilePath,
  transcriptionPayload = {},
  audioDurationSeconds = null,
  options = {},
) {
  const readFile = options.readFile || fs.promises.readFile;
  const audioBuffer = await readFile(audioFilePath);
  const client = options.samsarClient || getSamsarClient();
  const input = {
    model: transcriptionPayload.model || 'whisper-1',
    response_format: transcriptionPayload.response_format || 'verbose_json',
    timestamp_granularities: transcriptionPayload.timestamp_granularities || ['word'],
    file: {
      data: audioBuffer.toString('base64'),
      filename: path.basename(audioFilePath) || 'speech.mp3',
      content_type: getAudioContentType(audioFilePath),
    },
  };
  if (transcriptionPayload.language) input.language = transcriptionPayload.language;
  if (transcriptionPayload.prompt) input.prompt = transcriptionPayload.prompt;
  if (Number.isFinite(Number(audioDurationSeconds)) && Number(audioDurationSeconds) > 0) {
    input.audio_duration_seconds = Number(audioDurationSeconds);
  }

  const result = await client.requestV2ExternalAudioRoute('transcript_align', { input });
  return result?.data ?? result;
}
