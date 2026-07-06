import axios from 'axios';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const DEFAULT_REALTIME_MODEL =
  process.env.OPENAI_REALTIME_MODEL || 'gpt-4o-realtime-preview';
const DEFAULT_REALTIME_ENDPOINT =
  process.env.OPENAI_REALTIME_SESSION_URL ||
  'https://api.openai.com/v1/realtime/sessions';
const DEFAULT_REALTIME_VOICE =
  process.env.OPENAI_REALTIME_VOICE || 'alloy';
const DEFAULT_MODALITIES = process.env.OPENAI_REALTIME_MODALITIES
  ? process.env.OPENAI_REALTIME_MODALITIES.split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  : ['text'];
const DEFAULT_TRANSCRIPTION_MODEL =
  process.env.OPENAI_REALTIME_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe';

function buildRealtimePayload({
  model,
  voice,
  modalities,
  ...additional
} = {}) {
  const payload = {
    model: model || DEFAULT_REALTIME_MODEL,
    voice: voice || DEFAULT_REALTIME_VOICE,
    ...additional,
  };

  const normalizedModalities = Array.isArray(modalities)
    ? modalities.filter(Boolean)
    : null;

  if (normalizedModalities?.length) {
    payload.modalities = normalizedModalities;
  } else if (DEFAULT_MODALITIES?.length) {
    payload.modalities = DEFAULT_MODALITIES;
  }

  if (!payload.input_audio_transcription && DEFAULT_TRANSCRIPTION_MODEL) {
    payload.input_audio_transcription = {
      model: DEFAULT_TRANSCRIPTION_MODEL,
    };
  }

  return payload;
}

export async function createRealtimeTranscriptionSession({
  model,
  voice,
  modalities,
  sessionParams,
} = {}) {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  const payload = buildRealtimePayload({
    model,
    voice,
    modalities,
    ...(sessionParams || {}),
  });

  const headers = {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'realtime=v1',
  };

  const { data } = await axios.post(
    DEFAULT_REALTIME_ENDPOINT,
    payload,
    { headers },
  );

  return data;
}

export default {
  createRealtimeTranscriptionSession,
};
