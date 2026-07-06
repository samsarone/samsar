import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { getGoogleAccessToken } from './GoogleADC.js';

const GOOGLE_TTS_API_BASE_URL =
  process.env.GOOGLE_TTS_API_BASE_URL || 'https://texttospeech.googleapis.com/v1';
const GOOGLE_TTS_PREVIEW_TEXT =
  process.env.GOOGLE_TTS_PREVIEW_TEXT || 'This is a preview of this Google text to speech voice.';
const GOOGLE_TTS_AUDIO_ENCODING = 'MP3';
const GOOGLE_TTS_PROVIDER = 'GOOGLE';
const GOOGLE_TTS_VOICE_CACHE_PATH =
  process.env.GOOGLE_TTS_VOICE_CACHE_PATH ||
  path.join(process.cwd(), 'assets', 'cache', 'google-tts-voices.json');

let googleVoiceCatalogCache = null;

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getVoiceType(voiceName = '') {
  const normalizedVoiceName = normalizeString(voiceName);
  if (!normalizedVoiceName) {
    return 'Google TTS';
  }

  const parts = normalizedVoiceName.split('-');
  if (parts.length <= 2) {
    return 'Google TTS';
  }

  return parts.slice(2, -1).join(' ') || parts[2] || 'Google TTS';
}

function abbreviateVoiceType(voiceType = '') {
  return normalizeString(voiceType)
    .replace(/\bStandard\b/i, 'Std')
    .replace(/\bWaveNet\b/i, 'Wave')
    .replace(/\bNeural2\b/i, 'N2')
    .replace(/\bChirp\s+HD\b/i, 'Chirp')
    .replace(/\s+/g, ' ')
    .trim();
}

function getVoiceLabel(voice = {}, languageCode = '') {
  const name = normalizeString(voice.name);
  const language = normalizeString(languageCode) || normalizeString(voice.languageCodes?.[0]);
  const voiceType = getVoiceType(name);
  const suffix = name.split('-').pop();

  return [language, voiceType, suffix]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || name;
}

function getVoiceShortLabel(voice = {}, languageCode = '') {
  const existingShortLabel = normalizeString(voice.shortLabel);
  if (existingShortLabel) {
    return existingShortLabel;
  }

  const name = normalizeString(voice.name || voice.voiceId || voice.value);
  const language = normalizeString(languageCode) || normalizeString(voice.languageCode) || normalizeString(voice.languageCodes?.[0]);
  const voiceType = abbreviateVoiceType(voice.voiceType || getVoiceType(name));
  const suffix = name.split('-').pop();

  return [language, voiceType, suffix]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || name;
}

function getPreviewPath(voiceName, languageCode) {
  const params = new URLSearchParams({
    voice: voiceName,
    languageCode,
  });
  return `/v1/tts/google/preview?${params.toString()}`;
}

function getVoiceKey(voice = {}) {
  return normalizeString(voice.value || voice.voiceId || voice.name);
}

function filterVoicesByLanguage(voices = [], languageCode = '') {
  const normalizedLanguageCode = normalizeString(languageCode);
  if (!normalizedLanguageCode) {
    return voices;
  }

  return voices.filter((voice) => (
    voice.languageCode === normalizedLanguageCode ||
    (Array.isArray(voice.languageCodes) && voice.languageCodes.includes(normalizedLanguageCode))
  ));
}

function buildVoiceMap(voices = []) {
  return voices.reduce((voiceMap, voice) => {
    const key = getVoiceKey(voice);
    if (key) {
      voiceMap[key] = voice;
    }
    return voiceMap;
  }, {});
}

function buildVoiceCatalog({ voices = [], source = 'live', generatedAt = new Date().toISOString(), error = null } = {}) {
  const displayVoices = voices.map((voice) => ({
    ...voice,
    label: normalizeString(voice.label) || getVoiceLabel(voice, voice.languageCode),
    shortLabel: getVoiceShortLabel(voice, voice.languageCode),
  }));

  return {
    voices: displayVoices,
    voiceMap: buildVoiceMap(displayVoices),
    count: displayVoices.length,
    source,
    generatedAt,
    ...(error ? { error } : {}),
  };
}

async function readVoiceCatalogCache() {
  if (googleVoiceCatalogCache) {
    return googleVoiceCatalogCache;
  }

  try {
    const rawCache = await fs.promises.readFile(GOOGLE_TTS_VOICE_CACHE_PATH, 'utf8');
    const parsedCache = JSON.parse(rawCache);
    if (Array.isArray(parsedCache?.voices)) {
      googleVoiceCatalogCache = parsedCache;
      return googleVoiceCatalogCache;
    }
  } catch {
    // Cache misses should not block live Google voice discovery.
  }

  return null;
}

async function writeVoiceCatalogCache(voices = []) {
  const catalog = buildVoiceCatalog({
    voices,
    source: 'cache',
    generatedAt: new Date().toISOString(),
  });
  googleVoiceCatalogCache = catalog;

  try {
    await fs.promises.mkdir(path.dirname(GOOGLE_TTS_VOICE_CACHE_PATH), { recursive: true });
    await fs.promises.writeFile(
      GOOGLE_TTS_VOICE_CACHE_PATH,
      JSON.stringify(catalog, null, 2),
      'utf8'
    );
  } catch (error) {
    console.error('Unable to write Google TTS voice cache:', error?.message || error);
  }

  return catalog;
}

async function googleTTSFetch(path, options = {}) {
  const token = await getGoogleAccessToken();
  const response = await fetch(`${GOOGLE_TTS_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google TTS request failed (${response.status}): ${errorBody}`);
  }

  return response;
}

export function normalizeGoogleVoice(voice = {}, languageCodeOverride = '') {
  const name = normalizeString(voice.name);
  const languageCodes = Array.isArray(voice.languageCodes)
    ? voice.languageCodes.map(normalizeString).filter(Boolean)
    : [];
  const languageCode = normalizeString(languageCodeOverride) || languageCodes[0] || '';

  return {
    provider: GOOGLE_TTS_PROVIDER,
    value: name,
    voiceId: name,
    name,
    label: getVoiceLabel(voice, languageCode),
    shortLabel: getVoiceShortLabel(voice, languageCode),
    languageCode,
    languageCodes,
    gender: normalizeString(voice.ssmlGender).toLowerCase(),
    Gender: normalizeString(voice.ssmlGender),
    naturalSampleRateHertz: voice.naturalSampleRateHertz || null,
    voiceType: getVoiceType(name),
    previewURL: getPreviewPath(name, languageCode),
    previewRequiresAuth: true,
  };
}

export async function listGoogleTTSVoices({ languageCode } = {}) {
  const query = normalizeString(languageCode)
    ? `?${new URLSearchParams({ languageCode: normalizeString(languageCode) }).toString()}`
    : '';
  const response = await googleTTSFetch(`/voices${query}`);
  const body = await response.json();
  const voices = Array.isArray(body.voices) ? body.voices : [];

  return voices
    .filter((voice) => normalizeString(voice.name))
    .map((voice) => normalizeGoogleVoice(voice, languageCode))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function listGoogleTTSVoiceCatalog({ languageCode, refresh = false } = {}) {
  const normalizedLanguageCode = normalizeString(languageCode);

  if (!refresh && !normalizedLanguageCode) {
    const cachedCatalog = await readVoiceCatalogCache();
    if (cachedCatalog?.voices?.length) {
      return buildVoiceCatalog({
        voices: cachedCatalog.voices,
        source: cachedCatalog.source || 'cache',
        generatedAt: cachedCatalog.generatedAt,
      });
    }
  }

  try {
    const voices = await listGoogleTTSVoices({ languageCode: normalizedLanguageCode });
    if (!normalizedLanguageCode) {
      await writeVoiceCatalogCache(voices);
    }
    return buildVoiceCatalog({
      voices,
      source: 'live',
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const cachedCatalog = await readVoiceCatalogCache();
    if (cachedCatalog?.voices?.length) {
      const cachedVoices = filterVoicesByLanguage(cachedCatalog.voices, normalizedLanguageCode);
      return buildVoiceCatalog({
        voices: cachedVoices,
        source: 'cache',
        generatedAt: cachedCatalog.generatedAt,
        error: error?.message || 'Unable to refresh Google TTS voices; using cached catalog.',
      });
    }
    throw error;
  }
}

export async function synthesizeGoogleTTSAudio({
  text,
  voice,
  languageCode,
  speakingRate,
  pitch,
} = {}) {
  const voiceName = normalizeString(voice);
  const resolvedLanguageCode = normalizeString(languageCode);
  const inputText = normalizeString(text) || GOOGLE_TTS_PREVIEW_TEXT;

  if (!voiceName) {
    throw new Error('Google TTS voice name is required.');
  }

  if (!resolvedLanguageCode) {
    throw new Error('Google TTS languageCode is required.');
  }

  const audioConfig = {
    audioEncoding: GOOGLE_TTS_AUDIO_ENCODING,
  };

  const parsedSpeakingRate = Number(speakingRate);
  if (Number.isFinite(parsedSpeakingRate) && parsedSpeakingRate > 0) {
    audioConfig.speakingRate = parsedSpeakingRate;
  }

  const parsedPitch = Number(pitch);
  if (Number.isFinite(parsedPitch)) {
    audioConfig.pitch = parsedPitch;
  }

  const response = await googleTTSFetch('/text:synthesize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input: { text: inputText },
      voice: {
        languageCode: resolvedLanguageCode,
        name: voiceName,
      },
      audioConfig,
    }),
  });
  const body = await response.json();
  const audioContent = normalizeString(body.audioContent);

  if (!audioContent) {
    throw new Error('Google TTS response did not include audioContent.');
  }

  return Buffer.from(audioContent, 'base64');
}

export async function synthesizeGoogleTTSPreview({ voice, languageCode, text } = {}) {
  return synthesizeGoogleTTSAudio({
    text: normalizeString(text) || GOOGLE_TTS_PREVIEW_TEXT,
    voice,
    languageCode,
  });
}
