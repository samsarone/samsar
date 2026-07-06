import { useEffect, useState } from 'react';
import axios from 'axios';
import { getHeaders } from '../utils/web.jsx';

const PROCESSOR_API_URL = import.meta.env.VITE_PROCESSOR_API || '';
const GOOGLE_TTS_PROVIDER = 'GOOGLE';
const GOOGLE_TTS_LOCAL_STORAGE_KEY = 'samsar_google_tts_voice_catalog_v1';

const googleVoiceCache = {
  voices: null,
  voiceMap: null,
  generatedAt: null,
  source: null,
  promise: null,
};

function readLocalVoiceCatalog() {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawCatalog = window.localStorage.getItem(GOOGLE_TTS_LOCAL_STORAGE_KEY);
    if (!rawCatalog) {
      return null;
    }
    const parsedCatalog = JSON.parse(rawCatalog);
    if (!Array.isArray(parsedCatalog?.voices)) {
      return null;
    }
    return parsedCatalog;
  } catch {
    return null;
  }
}

function writeLocalVoiceCatalog(catalog = {}) {
  if (typeof window === 'undefined' || !Array.isArray(catalog.voices)) {
    return;
  }

  try {
    window.localStorage.setItem(
      GOOGLE_TTS_LOCAL_STORAGE_KEY,
      JSON.stringify({
        voices: catalog.voices,
        voiceMap: catalog.voiceMap || buildGoogleTTSVoiceMap(catalog.voices),
        generatedAt: catalog.generatedAt || new Date().toISOString(),
        source: catalog.source || 'client-cache',
      })
    );
  } catch {
    // Storage limits should not block voice selection.
  }
}

function normalizeProcessorUrl(path = '') {
  if (/^(blob:|data:|https?:\/\/)/i.test(path)) {
    return path;
  }

  const baseUrl = PROCESSOR_API_URL.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path.replace(/^\/+/, '')}`;
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

function normalizeGoogleSpeakerGender(rawGender = '') {
  const normalized = typeof rawGender === 'string' ? rawGender.trim().toLowerCase() : '';
  if (normalized === 'm' || normalized === 'male') {
    return { code: 'M', label: 'Male' };
  }
  if (normalized === 'f' || normalized === 'female') {
    return { code: 'F', label: 'Female' };
  }
  if (normalized) {
    return {
      code: null,
      label: normalized.replace(/\b\w/g, (char) => char.toUpperCase()),
    };
  }
  return { code: null, label: 'Unspecified' };
}

function getGoogleTTSVoiceType(voiceName = '') {
  const normalizedVoiceName = typeof voiceName === 'string' ? voiceName.trim() : '';
  const parts = normalizedVoiceName.split('-').filter(Boolean);

  if (parts.length <= 2) {
    return '';
  }

  return parts.slice(2, -1).join(' ') || parts[2] || '';
}

function abbreviateGoogleTTSVoiceType(voiceType = '') {
  const normalizedVoiceType = typeof voiceType === 'string' ? voiceType.trim() : '';

  return normalizedVoiceType
    .replace(/\bStandard\b/i, 'Std')
    .replace(/\bWaveNet\b/i, 'Wave')
    .replace(/\bNeural2\b/i, 'N2')
    .replace(/\bNews\b/i, 'News')
    .replace(/\bStudio\b/i, 'Studio')
    .replace(/\bChirp\s+HD\b/i, 'Chirp')
    .replace(/\s+/g, ' ')
    .trim();
}

function getGoogleTTSShortLabel(voice = {}, value = '') {
  if (typeof voice.shortLabel === 'string' && voice.shortLabel.trim()) {
    return voice.shortLabel.trim();
  }

  const voiceName =
    (typeof voice.name === 'string' && voice.name.trim())
    || (typeof voice.voiceId === 'string' && voice.voiceId.trim())
    || value;
  const languageCode =
    (typeof voice.languageCode === 'string' && voice.languageCode.trim())
    || (Array.isArray(voice.languageCodes)
      ? voice.languageCodes.find((languageCode) => typeof languageCode === 'string' && languageCode.trim())
      : '')
    || '';
  const suffix = typeof voiceName === 'string' ? voiceName.split('-').pop() : '';
  const voiceType = abbreviateGoogleTTSVoiceType(voice.voiceType || getGoogleTTSVoiceType(voiceName));

  return [languageCode, voiceType, suffix]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || voiceName;
}

function normalizeGoogleTTSSpeaker(voice = {}) {
  const value = typeof voice.value === 'string' && voice.value.trim()
    ? voice.value.trim()
    : typeof voice.name === 'string'
      ? voice.name.trim()
      : '';
  const gender = normalizeGoogleSpeakerGender(voice.Gender || voice.gender || voice.ssmlGender);
  const previewURL = typeof voice.previewURL === 'string' && voice.previewURL.trim()
    ? normalizeProcessorUrl(voice.previewURL.trim())
    : '';

  return {
    ...voice,
    provider: GOOGLE_TTS_PROVIDER,
    value,
    voiceId: typeof voice.voiceId === 'string' && voice.voiceId.trim() ? voice.voiceId.trim() : value,
    name: typeof voice.name === 'string' && voice.name.trim() ? voice.name.trim() : value,
    label: typeof voice.label === 'string' && voice.label.trim() ? voice.label.trim() : value,
    shortLabel: getGoogleTTSShortLabel(voice, value),
    languageCode:
      typeof voice.languageCode === 'string' && voice.languageCode.trim()
        ? voice.languageCode.trim()
        : Array.isArray(voice.languageCodes)
          ? voice.languageCodes.find((languageCode) => typeof languageCode === 'string' && languageCode.trim()) || ''
          : '',
    languageCodes: Array.isArray(voice.languageCodes)
      ? voice.languageCodes.filter((languageCode) => typeof languageCode === 'string' && languageCode.trim())
      : [],
    previewURL,
    previewRequiresAuth: voice.previewRequiresAuth !== false,
    Gender: gender.code,
    genderCode: gender.code,
    genderLabel: gender.label,
  };
}

function buildGoogleTTSVoiceMap(voices = []) {
  return voices.reduce((voiceMap, voice) => {
    const normalizedSpeaker = normalizeGoogleTTSSpeaker(voice);
    if (normalizedSpeaker.value) {
      voiceMap[normalizedSpeaker.value] = normalizedSpeaker;
    }
    return voiceMap;
  }, {});
}

export function getGoogleTTSVoiceDetails(speaker = {}) {
  const normalizedSpeaker = normalizeGoogleTTSSpeaker(speaker);
  return {
    provider: GOOGLE_TTS_PROVIDER,
    value: normalizedSpeaker.value,
    voiceId: normalizedSpeaker.voiceId,
    name: normalizedSpeaker.name,
    label: normalizedSpeaker.label,
    shortLabel: normalizedSpeaker.shortLabel,
    languageCode: normalizedSpeaker.languageCode,
    languageCodes: normalizedSpeaker.languageCodes,
    Gender: normalizedSpeaker.Gender,
    genderLabel: normalizedSpeaker.genderLabel,
    naturalSampleRateHertz: normalizedSpeaker.naturalSampleRateHertz || null,
    voiceType: normalizedSpeaker.voiceType || '',
    previewURL: normalizedSpeaker.previewURL,
    previewRequiresAuth: normalizedSpeaker.previewRequiresAuth,
  };
}

async function fetchGoogleTTSSpeakers() {
  if (googleVoiceCache.voices) {
    return googleVoiceCache.voices;
  }

  const localCatalog = readLocalVoiceCatalog();
  if (localCatalog?.voices?.length) {
    googleVoiceCache.voices = localCatalog.voices.map(normalizeGoogleTTSSpeaker).filter((voice) => voice.value);
    googleVoiceCache.voiceMap = localCatalog.voiceMap || buildGoogleTTSVoiceMap(googleVoiceCache.voices);
    googleVoiceCache.generatedAt = localCatalog.generatedAt || null;
    googleVoiceCache.source = 'client-cache';
  }

  if (!googleVoiceCache.promise) {
    googleVoiceCache.promise = axios
      .get(normalizeProcessorUrl('/v1/tts/google/voices'), getHeaders())
      .then((response) => {
        const voices = Array.isArray(response?.data?.voices)
          ? response.data.voices.map(normalizeGoogleTTSSpeaker).filter((voice) => voice.value)
          : [];
        const voiceMap = response?.data?.voiceMap && typeof response.data.voiceMap === 'object'
          ? Object.fromEntries(
              Object.entries(response.data.voiceMap).map(([key, voice]) => [key, normalizeGoogleTTSSpeaker(voice)])
            )
          : buildGoogleTTSVoiceMap(voices);
        googleVoiceCache.voices = voices;
        googleVoiceCache.voiceMap = voiceMap;
        googleVoiceCache.generatedAt = response?.data?.generatedAt || new Date().toISOString();
        googleVoiceCache.source = response?.data?.source || 'live';
        writeLocalVoiceCatalog({
          voices,
          voiceMap,
          generatedAt: googleVoiceCache.generatedAt,
          source: googleVoiceCache.source,
        });
        return voices;
      })
      .catch((error) => {
        if (googleVoiceCache.voices?.length) {
          return googleVoiceCache.voices;
        }
        throw error;
      })
      .finally(() => {
        googleVoiceCache.promise = null;
      });
  }

  return googleVoiceCache.promise;
}

export function mergeGoogleTTSSpeakers(baseSpeakers = [], googleSpeakers = []) {
  const merged = [...baseSpeakers];
  const seen = new Set(
    merged.map((speaker) => `${speaker?.provider || ''}:${speaker?.value || ''}`)
  );

  googleSpeakers.forEach((speaker) => {
    const normalizedSpeaker = normalizeGoogleTTSSpeaker(speaker);
    const key = `${normalizedSpeaker.provider}:${normalizedSpeaker.value}`;
    if (!normalizedSpeaker.value || seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(normalizedSpeaker);
  });

  return merged;
}

export async function fetchGoogleTTSPreviewBlobUrl(speaker = {}) {
  const normalizedSpeaker = normalizeGoogleTTSSpeaker(speaker);
  if (!normalizedSpeaker.previewURL) {
    throw new Error('Google TTS preview URL is unavailable.');
  }

  const response = await axios.get(normalizedSpeaker.previewURL, {
    ...(getHeaders() || {}),
    responseType: 'blob',
  });
  return URL.createObjectURL(response.data);
}

export function useGoogleTTSSpeakers({ enabled = true } = {}) {
  const [googleSpeakers, setGoogleSpeakers] = useState(() => googleVoiceCache.voices || []);
  const [googleVoiceMap, setGoogleVoiceMap] = useState(() => googleVoiceCache.voiceMap || {});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(() => googleVoiceCache.source || null);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    let cancelled = false;
    setIsLoading(true);
    fetchGoogleTTSSpeakers()
      .then((voices) => {
        if (!cancelled) {
          setGoogleSpeakers(voices);
          setGoogleVoiceMap(googleVoiceCache.voiceMap || buildGoogleTTSVoiceMap(voices));
          setSource(googleVoiceCache.source || null);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { googleSpeakers, googleVoiceMap, isLoading, error, source };
}
