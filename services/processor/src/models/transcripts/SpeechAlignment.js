import fs from 'fs';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });
const TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-transcribe';
const WORD_TIMESTAMP_TRANSCRIPTION_MODEL =
  process.env.OPENAI_WORD_TIMESTAMP_TRANSCRIPTION_MODEL || 'whisper-1';

const CJK_CHARACTER_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;

function sanitizeTranscriptForAlignment(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    return '';
  }
  return rawText
    .replace(/[^\p{L}\p{M}\p{N}_\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSegmenterLocale(languageCode) {
  const normalizedLanguage = typeof languageCode === 'string'
    ? languageCode.trim().toLowerCase().replace(/_/g, '-')
    : '';
  const locale = normalizedLanguage === 'cn' ? 'zh' : normalizedLanguage;

  if (
    !locale ||
    typeof Intl === 'undefined' ||
    typeof Intl.getCanonicalLocales !== 'function'
  ) {
    return undefined;
  }

  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}

function normalizeTranscriptionLanguageCode(languageCode) {
  if (typeof languageCode !== 'string') {
    return undefined;
  }
  const baseLanguage = languageCode.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  if (!baseLanguage || baseLanguage === 'auto') {
    return undefined;
  }
  // `cn` appears in legacy Samsar sessions as the Chinese language code, while
  // OpenAI transcription expects ISO-639-1 `zh`.
  return baseLanguage === 'cn' ? 'zh' : baseLanguage;
}

/**
 * Produces alignment-sized text units without assuming that words are separated
 * by spaces. Intl.Segmenter gives Chinese (and other unspaced scripts) useful
 * lexical units; the grapheme fallback prevents an entire CJK sentence from
 * becoming one synthetic timing entry on runtimes without segmentation data.
 */
export function tokenizeTranscriptForAlignment(rawText, languageCode) {
  const cleanedTranscript = sanitizeTranscriptForAlignment(rawText);
  if (!cleanedTranscript) {
    return [];
  }

  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(normalizeSegmenterLocale(languageCode), {
        granularity: 'word',
      });
      const segmentedWords = Array.from(segmenter.segment(cleanedTranscript))
        .filter((entry) => entry?.isWordLike)
        .map((entry) => entry.segment.trim())
        .filter(Boolean);
      if (segmentedWords.length > 0) {
        return segmentedWords;
      }
    } catch {
      // Continue to deterministic whitespace/grapheme tokenization below.
    }
  }

  const whitespaceTokens = cleanedTranscript.split(/\s+/).filter(Boolean);
  if (
    whitespaceTokens.length === 1 &&
    CJK_CHARACTER_REGEX.test(whitespaceTokens[0])
  ) {
    return Array.from(whitespaceTokens[0]).filter((character) =>
      /[\p{L}\p{M}\p{N}_']/u.test(character));
  }
  return whitespaceTokens;
}

/**
 * Resolves the portion of a layer-length character audio file that contains
 * the original speech. Character generation preserves the unpadded audio
 * metadata in `previousAudioData`; a shorter previous duration is what proves
 * that the current file has been padded.
 */
export function resolvePaddedSpeechTimingWindow(audioLayer = {}) {
  const previousAudioData = audioLayer?.previousAudioData;
  if (!previousAudioData || typeof previousAudioData !== 'object') {
    return null;
  }

  const audioDurationSeconds = Number(audioLayer?.duration);
  const speechDurationSeconds = Number(previousAudioData?.duration);
  if (
    !Number.isFinite(audioDurationSeconds) ||
    audioDurationSeconds <= 0 ||
    !Number.isFinite(speechDurationSeconds) ||
    speechDurationSeconds <= 0
  ) {
    return null;
  }

  const totalPaddingSeconds = audioDurationSeconds - speechDurationSeconds;
  if (totalPaddingSeconds <= 0.01) {
    return null;
  }

  const currentStartTimeValue = audioLayer?.startTime;
  const previousStartTimeValue = previousAudioData?.startTime;
  const currentStartTime = Number(currentStartTimeValue);
  const previousStartTime = Number(previousStartTimeValue);
  const derivedStartSeconds = previousStartTime - currentStartTime;
  const hasValidDerivedStart =
    currentStartTimeValue != null &&
    previousStartTimeValue != null &&
    Number.isFinite(currentStartTime) &&
    Number.isFinite(previousStartTime) &&
    derivedStartSeconds >= -0.01 &&
    derivedStartSeconds <= totalPaddingSeconds + 0.01;
  const startSeconds = hasValidDerivedStart
    ? Math.min(totalPaddingSeconds, Math.max(0, derivedStartSeconds))
    : totalPaddingSeconds / 2;

  return {
    startSeconds,
    endSeconds: startSeconds + speechDurationSeconds,
  };
}

function buildTimedWordAlignment(
  wordsList,
  audioDurationSeconds,
  caseLabel,
  speechTimingWindow = null,
) {
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

  const requestedStartSeconds = Number(speechTimingWindow?.startSeconds);
  const requestedEndSeconds = Number(speechTimingWindow?.endSeconds);
  const hasValidSpeechTimingWindow =
    Number.isFinite(requestedStartSeconds) &&
    Number.isFinite(requestedEndSeconds) &&
    requestedStartSeconds >= 0 &&
    requestedEndSeconds > requestedStartSeconds &&
    requestedEndSeconds <= durationSeconds;
  const startSeconds = hasValidSpeechTimingWindow ? requestedStartSeconds : 0;
  const endSeconds = hasValidSpeechTimingWindow ? requestedEndSeconds : durationSeconds;
  const step = (endSeconds - startSeconds) / Math.max(tokens.length, 1);

  return tokens.map((word, idx) => {
    const start = idx === 0
      ? startSeconds
      : Math.round((startSeconds + idx * step) * 1000) / 1000;
    const end = idx === tokens.length - 1
      ? endSeconds
      : Math.round(Math.min(endSeconds, startSeconds + (idx + 1) * step) * 1000) / 1000;
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
    start: wordInfo?.start == null ? NaN : Number(wordInfo.start),
    end: wordInfo?.end == null ? NaN : Number(wordInfo.end),
    case: wordInfo?.case,
  };
}

function getRawWordText(wordInfo = {}) {
  return typeof wordInfo?.word === 'string'
    ? wordInfo.word
    : (typeof wordInfo?.text === 'string' ? wordInfo.text : '');
}

/**
 * Synthetic timing remains useful for rendering, but must not be treated as a
 * reusable audio alignment. A reusable alignment requires every nonempty entry
 * to carry finite, increasing provider timestamps and no fallback marker.
 */
export function hasAuthoritativeWordTimings(rawWords) {
  if (!Array.isArray(rawWords)) {
    return false;
  }

  const nonemptyWords = rawWords.filter((wordInfo) => getRawWordText(wordInfo).trim());
  return nonemptyWords.length > 0 && nonemptyWords.every((wordInfo) => {
    const start = wordInfo?.start;
    const end = wordInfo?.end;
    const timingCase = typeof wordInfo?.case === 'string' ? wordInfo.case : 'success';
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      start >= 0 &&
      end > start &&
      timingCase === 'success'
    );
  });
}

function hasExplicitWordTimings(response = {}) {
  if (Array.isArray(response?.words) && response.words.length > 0) {
    return hasAuthoritativeWordTimings(response.words);
  }
  if (Array.isArray(response?.segments)) {
    const contentSegments = response.segments.filter((segment) => {
      const segmentText = typeof segment?.text === 'string' ? segment.text.trim() : '';
      return segmentText || (Array.isArray(segment?.words) && segment.words.length > 0);
    });
    return contentSegments.length > 0 && contentSegments.every((segment) =>
      hasAuthoritativeWordTimings(segment.words));
  }
  return false;
}

function collectRawWordsFromResponse(response = {}, languageCode) {
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

      const segmentWords = tokenizeTranscriptForAlignment(segmentText, languageCode);
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

function normalizeModelName(model) {
  return typeof model === 'string' ? model.trim().toLowerCase() : '';
}

/**
 * `true`/`false` means the model is known to support/not support the OpenAI
 * verbose word timestamp contract. `null` leaves room for configured custom or
 * future models, which are tried once before the known timestamp fallback.
 */
export function getWordTimestampCapability(model) {
  const normalizedModel = normalizeModelName(model);
  if (!normalizedModel) {
    return false;
  }
  if (normalizedModel === 'whisper-1' || normalizedModel.startsWith('whisper-1-')) {
    return true;
  }
  if (
    normalizedModel.includes('gpt-4o-transcribe') ||
    normalizedModel.includes('gpt-4o-mini-transcribe')
  ) {
    return false;
  }
  return null;
}

export function buildTranscriptionAttempts(
  transcriptionModel = TRANSCRIPTION_MODEL,
  wordTimestampModel = WORD_TIMESTAMP_TRANSCRIPTION_MODEL,
) {
  const configuredModel = typeof transcriptionModel === 'string'
    ? transcriptionModel.trim()
    : '';
  const alignmentModel = typeof wordTimestampModel === 'string'
    ? wordTimestampModel.trim()
    : '';
  const attempts = [];

  const addTimestampAttempt = (model) => {
    if (!model || getWordTimestampCapability(model) === false) {
      return;
    }
    if (attempts.some((attempt) =>
      normalizeModelName(attempt.model) === normalizeModelName(model) &&
      attempt.response_format === 'verbose_json')) {
      return;
    }
    attempts.push({
      model,
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
      requiresExplicitWordTimings: true,
    });
  };

  // Prefer the configured model when it is timestamp-capable (or is a custom
  // model whose capability is not yet known), then fall through to whisper-1.
  // Known incompatible GPT-4o transcription models skip the rejected verbose
  // request entirely.
  addTimestampAttempt(configuredModel);
  addTimestampAttempt(alignmentModel);

  if (configuredModel) {
    attempts.push({
      model: configuredModel,
      response_format: 'json',
      requiresExplicitWordTimings: false,
    });
  }

  return attempts;
}

export async function transcribeWithOpenAI(
  audioFilePath,
  transcriptText,
  languageCode,
  audioDurationSeconds = null,
  options = {},
) {
  try {
    const transcriptionModel = options.transcriptionModel || TRANSCRIPTION_MODEL;
    const wordTimestampModel = options.wordTimestampModel || WORD_TIMESTAMP_TRANSCRIPTION_MODEL;
    const transcriptionClient = options.openaiClient || openai;
    const createReadStream = options.createReadStream || fs.createReadStream;

    const requestPayloadBase = {
      language: normalizeTranscriptionLanguageCode(languageCode),
      prompt: transcriptText && transcriptText.trim() ? transcriptText : undefined,
    };

    const attempts = buildTranscriptionAttempts(transcriptionModel, wordTimestampModel);

    let response = null;
    let responseHasAuthoritativeTimings = false;
    let lastError = null;

    for (const attempt of attempts) {
      const fileStream = createReadStream(audioFilePath);
      const {
        requiresExplicitWordTimings,
        ...requestAttempt
      } = attempt;
      const payload = { ...requestPayloadBase, ...requestAttempt, file: fileStream };
      try {
        const candidateResponse = await transcriptionClient.audio.transcriptions.create(payload);
        if (requiresExplicitWordTimings) {
          try {
            if (!hasExplicitWordTimings(candidateResponse)) {
              lastError = new Error(
                `OpenAI transcription model ${attempt.model} returned no explicit word timestamps`,
              );
              continue;
            }
          } catch (parseErr) {
            lastError = parseErr;
            console.warn('Failed to parse timestamped transcription; trying the next alignment model', {
              model: attempt.model,
              responseFormat: attempt.response_format,
              error: parseErr?.message || parseErr,
            });
            continue;
          }
        }
        response = candidateResponse;
        responseHasAuthoritativeTimings = requiresExplicitWordTimings;
        break;
      } catch (err) {
        lastError = err;
        if (requiresExplicitWordTimings) {
          console.warn('OpenAI timestamped transcription failed; trying the next alignment model', {
            model: attempt.model,
            responseFormat: attempt.response_format,
            error: err?.response?.data || err?.message || err,
          });
        }
      } finally {
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
    const rawWords = collectRawWordsFromResponse(response, languageCode);

    const contentWords = rawWords.filter((wordInfo) =>
      typeof wordInfo?.word === 'string' && wordInfo.word.trim() !== '');
    const rawWordsHaveUsableTimings = contentWords.length > 0 && contentWords.every((wordInfo) =>
      Number.isFinite(wordInfo.start) &&
      Number.isFinite(wordInfo.end) &&
      wordInfo.start >= 0 &&
      wordInfo.end > wordInfo.start);

    // Provider word and segment timestamps keep their original positions. The
    // padded speech window is only for deterministic timing when timestamps
    // are missing or invalid.
    let words = rawWordsHaveUsableTimings
      ? contentWords.map((wordInfo) => ({
        alignedWord: wordInfo.word,
        word: wordInfo.word,
        start: wordInfo.start,
        end: wordInfo.end,
        case: responseHasAuthoritativeTimings ? 'success' : 'fallback',
      }))
      : [];

    if (!words.length) {
      const rawWordTranscript = contentWords.map((wordInfo) => wordInfo.word).join(' ');
      const fallbackTranscript = transcriptText?.trim()
        ? transcriptText
        : (openAiTranscript || rawWordTranscript);
      if (fallbackTranscript) {
        words = buildTimedWordAlignment(
          tokenizeTranscriptForAlignment(fallbackTranscript, languageCode),
          effectiveDurationSeconds,
          'fallback',
          options.speechTimingWindow,
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
    const words = buildTimedWordAlignment(
      tokenizeTranscriptForAlignment(fallbackTranscript, languageCode),
      audioDurationSeconds,
      'fallback_error',
      options.speechTimingWindow,
    );

    return { words: normalizeAlignedWords(words, audioDurationSeconds), transcriptText: fallbackTranscript };
  }
}
