import { buildElevenLabsMusicInput } from './ElevenLabsMusicPayload.js';

export const FAL_LYRIA_MODEL = 'google/lyria-3.5';
const ELEVENLABS_ENDPOINTS = {
  music_v1: 'fal-ai/elevenlabs/music',
  music_v2: 'elevenlabs/music/v2',
  music_v2_5: 'elevenlabs/music/v2.5',
};

export function buildFalElevenLabsMusicRequest(payload) {
  const { model_id, ...input } = buildElevenLabsMusicInput(payload);
  const endpoint = ELEVENLABS_ENDPOINTS[model_id];
  if (!endpoint) throw new Error(`Unsupported Fal ElevenLabs music model: ${model_id}`);
  return { endpoint, input };
}

// Jobs submitted before the upgrade have no saved endpoint and must finish
// against their original queue. New submissions always save the endpoint.
export function resolvePendingFalMusicEndpoint(payload, family) {
  return payload.generationMeta?.falMusicEndpoint
    || (family === 'lyria' ? 'fal-ai/lyria2' : ELEVENLABS_ENDPOINTS.music_v1);
}

export function buildFalLyriaMusicInput(payload = {}) {
  const prompt = typeof payload.prompt === 'string' && payload.prompt.trim()
    ? payload.prompt.trim()
    : 'Create a beautiful and serene backing track for a generative video composition.';
  const requestedDuration = Number(payload.duration);
  const duration = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? Math.min(requestedDuration, 180) : 10;
  // Lyria 3.5 takes duration and instrumental instructions in the prompt;
  // the Lyria 2 negative_prompt field is no longer supported.
  return { prompt: `${prompt}\n\nCreate an instrumental track with no vocals or singing. Target duration: ${duration} seconds.` };
}
