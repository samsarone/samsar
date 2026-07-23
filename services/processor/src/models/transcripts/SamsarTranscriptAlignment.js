import fs from 'fs';
import path from 'path';

import { createDeployedSamsarClient } from '../api/DeployedSamsarClient.js';
import { isStandaloneEdition } from '../../utils/EnvironmentUtils.js';

const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000;

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
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
  const client = options.samsarClient || await createDeployedSamsarClient({
    apiKey: process.env.SAMSAR_API_KEY,
    baseUrl: process.env.SAMSAR_JS_API_URL || process.env.SAMSAR_API_URL,
    timeoutMs: Number(process.env.SAMSAR_TRANSCRIPT_ALIGN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  });

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
