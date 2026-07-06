import { encoding_for_model, get_encoding } from 'tiktoken';

const FALLBACK_ENCODING = 'cl100k_base';
let cachedEncoding = null;
let cachedModel = null;

function resolveEncoding(model) {
  if (cachedEncoding && cachedModel === model) {
    return cachedEncoding;
  }

  try {
    cachedEncoding = encoding_for_model(model);
    cachedModel = model;
    return cachedEncoding;
  } catch (error) {
    try {
      cachedEncoding = get_encoding(FALLBACK_ENCODING);
      cachedModel = FALLBACK_ENCODING;
      return cachedEncoding;
    } catch (fallbackError) {
      throw new Error('Failed to load tokenizer for embedding inputs.');
    }
  }
}

export function countTokensPerText(texts, model) {
  if (!Array.isArray(texts)) {
    return [];
  }

  const encoding = resolveEncoding(model);
  return texts.map((value) => {
    const text = value === null || value === undefined ? '' : String(value);
    return encoding.encode(text).length;
  });
}

export function countTokensForTexts(texts, model) {
  const counts = countTokensPerText(texts, model);
  return counts.reduce((total, value) => total + value, 0);
}
