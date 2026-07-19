import OpenAI, { toFile } from 'openai';
import path from 'path';

import { deductGenerationCredits } from '../GenerationCredits.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const TRANSCRIPT_ALIGN_PRICING_MULTIPLIER = 1.5;
const SAMSAR_CREDITS_PER_USD = 100;
const configuredWhisperUsdPerMinute = Number(process.env.OPENAI_WHISPER_USD_PER_MINUTE);
const WHISPER_USD_PER_MINUTE = Number.isFinite(configuredWhisperUsdPerMinute) &&
  configuredWhisperUsdPerMinute > 0
  ? configuredWhisperUsdPerMinute
  : 0.006;
const configuredMaxTranscriptAudioBytes = Number(process.env.TRANSCRIPT_ALIGN_MAX_AUDIO_BYTES);
const MAX_TRANSCRIPT_AUDIO_BYTES = Number.isFinite(configuredMaxTranscriptAudioBytes) &&
  configuredMaxTranscriptAudioBytes > 0
  ? Math.floor(configuredMaxTranscriptAudioBytes)
  : 25 * 1024 * 1024;

function buildError(message, statusCode = 400, code = null) {
  const error = new Error(message);
  error.status = statusCode;
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeInputPayload(payload = {}) {
  return payload?.input && typeof payload.input === 'object' && !Array.isArray(payload.input)
    ? payload.input
    : payload;
}

function decodeBase64Audio(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const dataUrlMatch = normalized.match(/^data:([^;,]+)?;base64,(.+)$/s);
  const encoded = dataUrlMatch ? dataUrlMatch[2] : normalized;
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded.replace(/\s+/g, ''))) {
    throw buildError('file data must be base64 encoded.', 400, 'INVALID_TRANSCRIPT_AUDIO');
  }
  return {
    buffer: Buffer.from(encoded, 'base64'),
    contentType: dataUrlMatch?.[1] || '',
  };
}

function normalizeAudioFile(input = {}) {
  const file = input.file ?? input.audio_file ?? input.audioFile ?? input.audio;
  let decoded = null;
  let fileName = '';
  let contentType = '';

  if (typeof file === 'string') {
    decoded = decodeBase64Audio(file);
  } else if (file && typeof file === 'object' && !Array.isArray(file)) {
    decoded = decodeBase64Audio(
      file.data ?? file.base64 ?? file.audio_data ?? file.audioData ?? file.data_url ?? file.dataUrl,
    );
    fileName = normalizeString(file.filename ?? file.file_name ?? file.name);
    contentType = normalizeString(file.content_type ?? file.contentType ?? file.mime_type ?? file.mimeType ?? file.type);
  }

  if (!decoded?.buffer?.length) {
    throw buildError(
      'file is required as a base64 string or { data, filename, content_type } object.',
      400,
      'TRANSCRIPT_AUDIO_REQUIRED',
    );
  }
  if (decoded.buffer.length > MAX_TRANSCRIPT_AUDIO_BYTES) {
    throw buildError(
      `file must be ${MAX_TRANSCRIPT_AUDIO_BYTES} bytes or smaller.`,
      413,
      'TRANSCRIPT_AUDIO_TOO_LARGE',
    );
  }

  return {
    buffer: decoded.buffer,
    fileName: path.basename(fileName || normalizeString(input.file_name ?? input.fileName) || 'speech.mp3'),
    contentType: contentType || decoded.contentType || 'audio/mpeg',
  };
}

function normalizeTimestampGranularities(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeString).filter(Boolean);
  }
  const normalized = normalizeString(value);
  if (!normalized) return ['word'];
  try {
    const parsed = JSON.parse(normalized);
    if (Array.isArray(parsed)) return parsed.map(normalizeString).filter(Boolean);
  } catch {
    // Accept form-style comma-separated values below.
  }
  return normalized.split(',').map((item) => item.trim()).filter(Boolean);
}

function resolveDurationSeconds(response = {}, input = {}) {
  const candidates = [
    response?.duration,
    response?.usage?.type === 'duration' ? response.usage.seconds : null,
    input.audio_duration_seconds,
    input.audioDurationSeconds,
    input.duration_seconds,
    input.durationSeconds,
    input.duration,
  ];
  for (const candidate of candidates) {
    const duration = Number(candidate);
    if (Number.isFinite(duration) && duration > 0) return duration;
  }
  throw buildError(
    'OpenAI did not return audio duration; audio_duration_seconds is required for metering.',
    502,
    'TRANSCRIPT_DURATION_REQUIRED',
  );
}

export function calculateTranscriptAlignmentCharge({ durationSeconds } = {}) {
  const normalizedDuration = Number(durationSeconds);
  if (!Number.isFinite(normalizedDuration) || normalizedDuration <= 0) {
    throw buildError('durationSeconds must be a positive number.');
  }
  const costUsd = (normalizedDuration / 60) * WHISPER_USD_PER_MINUTE;
  return {
    durationSeconds: normalizedDuration,
    underlyingCostUsd: costUsd,
    pricingMultiplier: TRANSCRIPT_ALIGN_PRICING_MULTIPLIER,
    costUsd: costUsd * TRANSCRIPT_ALIGN_PRICING_MULTIPLIER,
    credits: costUsd * TRANSCRIPT_ALIGN_PRICING_MULTIPLIER * SAMSAR_CREDITS_PER_USD,
    usdPerMinute: WHISPER_USD_PER_MINUTE,
  };
}

export async function createExternalTranscriptAlignment({
  userId,
  payload = {},
  openaiClient = openai,
  deductCredits = deductGenerationCredits,
} = {}) {
  if (!userId) throw buildError('User ID is required.', 401);
  if (!normalizeString(process.env.OPENAI_API_KEY) && openaiClient === openai) {
    throw buildError(
      'OpenAI transcription is not configured on this deployment.',
      503,
      'OPENAI_TRANSCRIPTION_NOT_CONFIGURED',
    );
  }

  const input = normalizeInputPayload(payload);
  const model = normalizeString(input.model) || 'whisper-1';
  if (!model.toLowerCase().startsWith('whisper-1')) {
    throw buildError(
      'transcript_align requires whisper-1 for word-level timestamps.',
      400,
      'TRANSCRIPT_ALIGN_MODEL_NOT_SUPPORTED',
    );
  }
  const audioFile = normalizeAudioFile(input);
  const responseFormat = normalizeString(input.response_format ?? input.responseFormat) || 'verbose_json';
  const timestampGranularities = normalizeTimestampGranularities(
    input.timestamp_granularities ?? input.timestampGranularities,
  );
  if (responseFormat !== 'verbose_json' || !timestampGranularities.includes('word')) {
    throw buildError(
      'transcript_align requires response_format=verbose_json and word timestamp granularity.',
      400,
      'TRANSCRIPT_ALIGN_WORD_TIMESTAMPS_REQUIRED',
    );
  }
  const request = {
    file: await toFile(audioFile.buffer, audioFile.fileName, { type: audioFile.contentType }),
    model,
    response_format: responseFormat,
    timestamp_granularities: timestampGranularities,
  };
  const language = normalizeString(input.language);
  const prompt = normalizeString(input.prompt);
  if (language) request.language = language;
  if (prompt) request.prompt = prompt;

  const response = await openaiClient.audio.transcriptions.create(request);
  const durationSeconds = resolveDurationSeconds(response, input);
  const billing = calculateTranscriptAlignmentCharge({ durationSeconds });
  const deduction = await deductCredits(userId, billing.credits, {
    source: 'external_audio_transcript_align',
    metadata: {
      requestType: 'API',
      category: 'external_audio',
      route: 'transcript_align',
      provider: 'openai',
      model,
      ...billing,
    },
  });

  return {
    response,
    creditsCharged: billing.credits,
    remainingCredits: deduction?.remainingCredits ?? null,
    pricing: billing,
  };
}

export const __testOnly__ = {
  normalizeAudioFile,
  normalizeTimestampGranularities,
  resolveDurationSeconds,
};
