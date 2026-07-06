import fs from 'fs';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe';

function sanitizeTranscriptForAlignment(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return '';
  }
  return rawText
    .replace(/[^\p{L}\p{N}_\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildTimedWordAlignment(wordsList, audioDurationSeconds, caseLabel) {
  const tokens = Array.isArray(wordsList)
    ? wordsList.map((word) => (typeof word === 'string' ? word.trim() : '')).filter(Boolean)
    : [];

  if (!tokens.length) {
    return [];
  }

  let durationSeconds = Number(audioDurationSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    durationSeconds = (0.5 * tokens.length) || 0.5;
  }

  const step = durationSeconds / Math.max(tokens.length, 1);
  return tokens.map((word, idx) => {
    const start = Math.round(idx * step * 1000) / 1000;
    const end = Math.round(Math.min(durationSeconds, (idx + 1) * step) * 1000) / 1000;
    return {
      alignedWord: word,
      word,
      start,
      end,
      case: caseLabel,
    };
  });
}

export function normalizeAlignedWords(rawWords, maxDurationSeconds = null) {
  if (!Array.isArray(rawWords) || rawWords.length === 0) {
    return [];
  }

  const durationLimit = Number(maxDurationSeconds);
  const hasLimit = Number.isFinite(durationLimit) && durationLimit > 0;

  return rawWords
    .map((wordInfo) => {
      const rawWord = typeof wordInfo?.word === 'string' ? wordInfo.word : '';
      if (!rawWord.trim()) {
        return null;
      }

      const start = Number(wordInfo?.start);
      const end = Number(wordInfo?.end);

      const safeStart = Number.isFinite(start) ? Math.max(start, 0) : 0;
      let safeEnd = Number.isFinite(end) ? end : (safeStart + 0.5);

      if (!Number.isFinite(safeEnd) || safeEnd <= safeStart) {
        safeEnd = safeStart + 0.5;
      }

      if (hasLimit) {
        if (safeStart >= durationLimit) {
          return null;
        }
        safeEnd = Math.min(safeEnd, durationLimit);
      }

      return {
        alignedWord: rawWord,
        word: rawWord,
        start: safeStart,
        end: safeEnd,
        case: wordInfo?.case || 'success',
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function normalizeRawWordEntry(wordInfo = {}) {
  const rawWord = typeof wordInfo?.word === 'string'
    ? wordInfo.word
    : (typeof wordInfo?.text === 'string' ? wordInfo.text : '');
  return {
    word: rawWord,
    start: Number(wordInfo?.start),
    end: Number(wordInfo?.end),
    case: wordInfo?.case,
  };
}

function hasExplicitWordTimings(response = {}) {
  if (Array.isArray(response?.words) && response.words.length > 0) {
    return true;
  }
  if (Array.isArray(response?.segments)) {
    return response.segments.some(
      (segment) => Array.isArray(segment?.words) && segment.words.length > 0,
    );
  }
  return false;
}

function collectRawWordsFromResponse(response = {}) {
  const rawWords = Array.isArray(response?.words)
    ? response.words.map(normalizeRawWordEntry)
    : [];

  if (!rawWords.length && Array.isArray(response?.segments)) {
    response.segments.forEach((segment) => {
      if (!segment) return;
      if (Array.isArray(segment.words) && segment.words.length > 0) {
        rawWords.push(...segment.words.map(normalizeRawWordEntry));
        return;
      }

      const segmentText = typeof segment.text === 'string' ? segment.text.trim() : '';
      const segmentStart = Number(segment.start);
      const segmentEnd = Number(segment.end);
      if (!segmentText || !Number.isFinite(segmentStart) || !Number.isFinite(segmentEnd) || segmentEnd <= segmentStart) {
        return;
      }

      const segmentWords = segmentText.split(/\s+/).filter(Boolean);
      if (!segmentWords.length) {
        return;
      }

      const duration = segmentEnd - segmentStart;
      const step = duration / segmentWords.length;
      segmentWords.forEach((word, idx) => {
        rawWords.push({
          word,
          start: segmentStart + idx * step,
          end: segmentStart + (idx + 1) * step,
        });
      });
    });
  }

  return rawWords;
}

export async function transcribeWithOpenAI(audioFilePath, transcriptText, languageCode, audioDurationSeconds = null) {
  try {
    const normalizedModel = TRANSCRIPTION_MODEL.toLowerCase();
    const isGpt4oTranscribe = normalizedModel.includes('gpt-4o') && normalizedModel.includes('transcribe');

    const requestPayloadBase = {
      model: TRANSCRIPTION_MODEL,
      language: languageCode || undefined,
      prompt: transcriptText && transcriptText.trim() ? transcriptText : undefined,
    };

    const attemptPayloads = isGpt4oTranscribe
      ? [
          {
            response_format: 'verbose_json',
            timestamp_granularities: ['word'],
          },
          {
            response_format: 'json',
          },
        ]
      : [
          {
            response_format: 'verbose_json',
            timestamp_granularities: ['word'],
          },
          {
            response_format: 'json',
          },
        ];

    let response = null;
    let lastError = null;

    for (const attempt of attemptPayloads) {
      const fileStream = fs.createReadStream(audioFilePath);
      const payload = { ...requestPayloadBase, ...attempt, file: fileStream };
      try {
        response = await openai.audio.transcriptions.create(payload);
        if (attempt.response_format === 'verbose_json') {
          try {
            if (!hasExplicitWordTimings(response)) {
              response = null;
              continue;
            }
          } catch (parseErr) {
            console.error('Failed to parse verbose_json transcription; falling back to json response', {
              model: TRANSCRIPTION_MODEL,
              responseFormat: attempt.response_format,
              error: parseErr?.message || parseErr,
            });
            response = null;
            continue;
          }
        }
        break;
      } catch (err) {
        lastError = err;
        if (attempt.response_format === 'verbose_json') {
          console.error('OpenAI transcription verbose_json failed; falling back to json response', {
            model: TRANSCRIPTION_MODEL,
            responseFormat: attempt.response_format,
            error: err?.response?.data || err?.message || err,
          });
        }
        if (fileStream && typeof fileStream.destroy === 'function') {
          fileStream.destroy();
        }
      }
    }

    if (!response) {
      throw lastError || new Error('OpenAI transcription failed');
    }

    const durationSeconds = (() => {
      if (!response || typeof response !== 'object') {
        return null;
      }
      const direct = Number(response.duration);
      if (Number.isFinite(direct) && direct > 0) {
        return direct;
      }
      const usage = response.usage;
      const seconds = usage && typeof usage === 'object' && usage.type === 'duration' ? Number(usage.seconds) : NaN;
      if (Number.isFinite(seconds) && seconds > 0) {
        return seconds;
      }
      return null;
    })();

    const effectiveDurationSeconds = (Number.isFinite(durationSeconds) && durationSeconds > 0)
      ? durationSeconds
      : audioDurationSeconds;

    const openAiTranscript = (typeof response === 'string') ? response : (response?.text || '');
    const rawWords = collectRawWordsFromResponse(response);

    let words = rawWords
      .map((w) => {
        const rawWord = typeof w.word === 'string' ? w.word : (typeof w.text === 'string' ? w.text : '');
        const start = Number(w.start);
        const end = Number(w.end);
        const safeStart = Number.isFinite(start) ? start : 0;
        const safeEnd = Number.isFinite(end) ? end : safeStart + 0.5;
        return {
          alignedWord: rawWord,
          word: rawWord,
          start: safeStart,
          end: safeEnd,
          case: 'success',
        };
      })
      .filter((w) => w.word.trim() !== '');

    if (!words.length) {
      const fallbackTranscript = transcriptText?.trim() ? transcriptText : openAiTranscript;
      if (fallbackTranscript) {
        const cleanedTranscript = sanitizeTranscriptForAlignment(fallbackTranscript);
        words = buildTimedWordAlignment(
          cleanedTranscript ? cleanedTranscript.split(' ') : [],
          effectiveDurationSeconds,
          'fallback',
        );
      }
    }

    return {
      words: normalizeAlignedWords(words, effectiveDurationSeconds),
      transcriptText: transcriptText && transcriptText.trim() ? transcriptText : openAiTranscript,
    };
  } catch (err) {
    console.error('OpenAI transcription failed', err?.response?.data || err?.message || err);

    const fallbackTranscript = transcriptText?.trim() ? transcriptText : '';
    const cleanedTranscript = sanitizeTranscriptForAlignment(fallbackTranscript);
    const words = buildTimedWordAlignment(
      cleanedTranscript ? cleanedTranscript.split(' ') : [],
      audioDurationSeconds,
      'fallback_error',
    );

    return { words: normalizeAlignedWords(words, audioDurationSeconds), transcriptText: fallbackTranscript };
  }
}
