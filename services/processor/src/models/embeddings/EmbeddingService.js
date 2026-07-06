import crypto from 'crypto';
import mongoose from 'mongoose';
import OpenAI from 'openai';
import { getDBConnectionString } from '../DBString.js';
import { creditGenerationCredits, deductGenerationCredits } from '../GenerationCredits.js';
import { creditExternalUserCredits, deductExternalUserCredits } from '../external/User.js';
import EmbeddingTemplate from '../../schema/embeddings/EmbeddingTemplate.js';
import EmbeddingRecord from '../../schema/embeddings/EmbeddingRecord.js';
import {
  analyzeRecords,
  buildSearchDocument,
  buildStructuredFilters,
  buildStructuredFilterQuery,
  createSchemaFingerprint,
  createTemplateHash,
  flattenRecord,
  extractRecordId,
  isIdField,
  extractStructuredFiltersFromQuery,
} from './SchemaAnalyzer.js';
import { countTokensForTexts, countTokensPerText } from './TokenCounter.js';
import { cleanEmbeddingSourceText, stripHtmlToText } from '../../utils/EmbeddingTextCleanup.js';

const EMBEDDING_MODEL = 'text-embedding-3-large';
const DEFAULT_VECTOR_INDEX = process.env.COSMOS_VECTOR_INDEX || 'embedding_vector_index';
const RERANK_MODEL = process.env.OPENAI_RERANK_MODEL || 'gpt-4o-mini';
const MAX_EMBEDDING_INPUT_CHARS = 6000;
const EMBEDDING_BATCH_SIZE = 50;
const RERANK_LIMIT = 50;
const MAX_EMBEDDING_BATCH_TOKENS = Number.parseInt(
  process.env.EMBEDDING_BATCH_TOKENS || '',
  10,
) || 200000;
const MAX_EMBEDDING_RETRIES = 5;
const USD_PER_MILLION_TOKENS = 1;
const CREDITS_PER_DOLLAR = 100;
const DEFAULT_EMBEDDING_PRICING_MULTIPLIER = 1;
const URL_EMBEDDING_PRICING_MULTIPLIER = 2.5;
const PLAIN_TEXT_EMBEDDING_PRICING_MULTIPLIER = 2.5;
const DEFAULT_URL_CRAWL_LEVELS = 2;
const MAX_URL_CRAWL_LEVELS = 3;
const MAX_URL_SEEDS_PER_REQUEST = 50;
const MAX_URL_CRAWL_LINKS_PER_REQUEST = 5;
const FIRECRAWL_USD_PER_CREDIT = 0.009;
const FIRECRAWL_CREDITS_PER_URL = 1;
const FIRECRAWL_API_URL = 'https://api.firecrawl.dev';
const FIRECRAWL_BATCH_POLL_INTERVAL_SECONDS = Number.parseInt(
  process.env.FIRECRAWL_BATCH_POLL_INTERVAL_SECONDS || '',
  10,
) || 5;
const FIRECRAWL_BATCH_TIMEOUT_SECONDS = 120;
const FIRECRAWL_REQUEST_TIMEOUT_MS = 30000;
const FIRECRAWL_MAX_PAGINATION_PAGES = 100;
const FIRECRAWL_MIN_REQUEST_INTERVAL_MS = Number.parseInt(
  process.env.FIRECRAWL_MIN_REQUEST_INTERVAL_MS || '',
  10,
) || 500;
const FIRECRAWL_MIN_JOB_START_INTERVAL_MS = Number.parseInt(
  process.env.FIRECRAWL_MIN_JOB_START_INTERVAL_MS || '',
  10,
) || 8000;
const FIRECRAWL_MAX_RATE_LIMIT_RETRIES = Number.parseInt(
  process.env.FIRECRAWL_MAX_RATE_LIMIT_RETRIES || '',
  10,
) || 8;
const FIRECRAWL_RETRY_DELAY_BUFFER_MS = Number.parseInt(
  process.env.FIRECRAWL_RETRY_DELAY_BUFFER_MS || '',
  10,
) || 1000;
const RELATED_SECTION_PATTERN =
  /\b(related|related links|see also|further reading|additional resources|learn more|next steps)\b/i;
const EXCLUDED_SECTION_PATTERN =
  /\b(nav|navigation|menu|footer|header|breadcrumb|legal|privacy|terms|cookie|social|share)\b/i;
const IMPORTANT_LINK_PATTERN =
  /\b(overview|introduction|quickstart|getting started|guide|tutorial|reference|api|configuration|setup|install|example|examples|concept|concepts|architecture|details|faq|troubleshooting)\b/i;
const DEPRIORITIZED_LINK_PATTERN =
  /\b(sign in|signin|log in|login|register|sign up|signup|pricing|billing|blog|news|press|careers|contact|support|privacy|terms|cookie|cookies|legal|facebook|twitter|linkedin|youtube|github)\b/i;
const NON_HTML_PATH_PATTERN =
  /\.(?:png|jpe?g|gif|svg|webp|ico|pdf|zip|gz|tgz|mp4|mp3|mov|avi|pptx?|docx?|xlsx?)$/i;
const FILTER_MATCH_BOOST = 0.1;
const DEFAULT_SIMILAR_LIMIT = 25;
const DEFAULT_SIMILAR_MIN_RESULTS = 25;
const DEFAULT_SIMILAR_NUM_CANDIDATES = 200;
const DEFAULT_SOFT_FILTER_KEYS = ['min_participants', 'max_participants'];
const MAX_EMBEDDING_TTL_MINUTES = Number.parseInt(
  process.env.MAX_EMBEDDING_TTL_MINUTES || '',
  10,
) || 60 * 24 * 365;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || '' });

function ensureOpenAIKey() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set');
  }
}

function ensureFirecrawlKey() {
  if (!process.env.FIRECRAWL_API_KEY) {
    const error = new Error('FIRECRAWL_API_KEY is not set');
    error.statusCode = 500;
    throw error;
  }
}

function getDefaultUrlEmbeddingFieldOptions() {
  return {
    source_type: { filterable: true, searchable: false },
    crawl_provider: { filterable: true, searchable: false },
    url: { searchable: true, retrievable: true },
    hostname: { filterable: true, searchable: true },
    pathname: { filterable: true, searchable: true },
    title: { searchable: true },
    description: { searchable: true },
    language: { filterable: true, searchable: true },
    status_code: { filterable: true, searchable: false },
    content_length: { filterable: true, searchable: false },
    published_time: { filterable: true, searchable: true },
    modified_time: { filterable: true, searchable: true },
    content: { searchable: true, retrievable: true },
  };
}

function getDefaultPlainTextEmbeddingFieldOptions() {
  return {
    source_type: { filterable: true, searchable: false },
    url: { searchable: true, retrievable: true },
    hostname: { filterable: true, searchable: true },
    pathname: { filterable: true, searchable: true },
    title: { searchable: true },
    description: { searchable: true },
    language: { filterable: true, searchable: true },
    content_length: { filterable: true, searchable: false },
    content: { searchable: true, retrievable: true },
  };
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeDateValue(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeEmbeddingTtlMinutes(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = typeof value === 'string' ? Number(value.trim()) : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error('ttl_minutes must be a positive integer number of minutes.');
    error.statusCode = 400;
    throw error;
  }

  if (!Number.isSafeInteger(parsed) || parsed > MAX_EMBEDDING_TTL_MINUTES) {
    const error = new Error(
      `ttl_minutes must be less than or equal to ${MAX_EMBEDDING_TTL_MINUTES}.`,
    );
    error.statusCode = 400;
    throw error;
  }

  return parsed;
}

function resolveEmbeddingExpiration(ttlMinutes) {
  if (!ttlMinutes) {
    return null;
  }

  const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
  if (Number.isNaN(expiresAt.getTime())) {
    const error = new Error('Failed to resolve embedding expiration time.');
    error.statusCode = 500;
    throw error;
  }

  return expiresAt;
}

function createExpiredEmbeddingTemplateError({ templateId, template }) {
  const error = new Error('Embedding template has expired and was deleted.');
  error.statusCode = 410;
  error.code = 'EMBEDDING_TEMPLATE_EXPIRED';
  error.details = {
    template_id: templateId,
    ttl_minutes: template?.ttlMinutes ?? null,
    expires_at: normalizeDateValue(template?.expiresAt)?.toISOString() || null,
  };
  return error;
}

async function purgeExpiredEmbeddingTemplates({
  userId = null,
  templateIds = null,
  now = new Date(),
} = {}) {
  const normalizedNow = normalizeDateValue(now) || new Date();
  const query = {
    expiresAt: { $ne: null, $lte: normalizedNow },
  };

  if (userId) {
    query.userId = userId;
  }

  if (Array.isArray(templateIds) && templateIds.length > 0) {
    query._id = { $in: templateIds };
  }

  const expiredTemplates = await EmbeddingTemplate.find(query, {
    _id: 1,
    userId: 1,
    ttlMinutes: 1,
    expiresAt: 1,
  }).lean();

  if (expiredTemplates.length === 0) {
    return [];
  }

  const expiredTemplateIds = expiredTemplates.map((template) => template._id.toString());
  const recordDeleteQuery = {
    templateId: { $in: expiredTemplateIds },
  };

  if (userId) {
    recordDeleteQuery.userId = userId;
  }

  const templateDeleteQuery = {
    _id: { $in: expiredTemplateIds },
  };

  if (userId) {
    templateDeleteQuery.userId = userId;
  }

  await Promise.all([
    EmbeddingRecord.deleteMany(recordDeleteQuery),
    EmbeddingTemplate.deleteMany(templateDeleteQuery),
  ]);

  return expiredTemplates.map((template) => ({
    templateId: template._id.toString(),
    ttlMinutes: template.ttlMinutes ?? null,
    expiresAt: normalizeDateValue(template.expiresAt)?.toISOString() || null,
  }));
}

function normalizeUrlValue(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeUrlList(urls) {
  const values = Array.isArray(urls) ? urls : [urls];
  const normalized = [];
  const invalid = [];
  const seen = new Set();

  values.forEach((value) => {
    const normalizedUrl = normalizeUrlValue(value);
    if (!normalizedUrl) {
      invalid.push(value);
      return;
    }
    if (seen.has(normalizedUrl)) {
      return;
    }
    seen.add(normalizedUrl);
    normalized.push(normalizedUrl);
  });

  if (normalized.length === 0) {
    const error = new Error('urls must contain at least one valid URL.');
    error.statusCode = 400;
    throw error;
  }

  if (invalid.length > 0) {
    const invalidList = invalid
      .filter((value) => typeof value === 'string' && value.trim())
      .slice(0, 5)
      .join(', ');
    const error = new Error(
      invalidList
        ? `Invalid URL values: ${invalidList}`
        : 'urls contains invalid URL values.',
    );
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function resolveUrlValue(value, baseUrl = null) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function upsertPrioritizedLinkCandidate(candidates, candidate) {
  if (!candidate) {
    return;
  }

  const existing = candidates.get(candidate.url);
  if (!existing || candidate.score > existing.score) {
    candidates.set(candidate.url, candidate);
  }
}

function isAllowedCrawlCandidateUrl(seedUrl, candidateUrl) {
  try {
    const seed = new URL(seedUrl);
    const candidate = new URL(candidateUrl);

    if (seed.toString() === candidate.toString()) {
      return false;
    }

    if (seed.hostname !== candidate.hostname) {
      return false;
    }

    if (NON_HTML_PATH_PATTERN.test(candidate.pathname)) {
      return false;
    }

    if (
      DEPRIORITIZED_LINK_PATTERN.test(candidate.pathname) ||
      DEPRIORITIZED_LINK_PATTERN.test(candidate.search)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function scorePrioritizedLinkCandidate({
  seedUrl,
  candidateUrl,
  source,
  anchorText = null,
  sectionHeading = null,
}) {
  if (!isAllowedCrawlCandidateUrl(seedUrl, candidateUrl)) {
    return null;
  }

  const seed = new URL(seedUrl);
  const candidate = new URL(candidateUrl);
  const normalizedAnchorText = normalizeOptionalString(anchorText)?.toLowerCase() || '';
  const normalizedSectionHeading = normalizeOptionalString(sectionHeading)?.toLowerCase() || '';
  const comparableText =
    `${normalizedAnchorText} ${normalizedSectionHeading} ${candidate.pathname}`.trim();
  let score = source === 'related'
    ? 300
    : source === 'main'
      ? 200
      : 100;

  if (candidate.pathname.startsWith(seed.pathname.replace(/[^/]+$/, ''))) {
    score += 30;
  }

  if (IMPORTANT_LINK_PATTERN.test(comparableText)) {
    score += 25;
  }

  if (RELATED_SECTION_PATTERN.test(normalizedSectionHeading)) {
    score += 40;
  }

  if (DEPRIORITIZED_LINK_PATTERN.test(comparableText)) {
    score -= 120;
  }

  if (candidate.search) {
    score -= 5;
  }

  return {
    url: candidate.toString(),
    source,
    score,
  };
}

function extractMarkdownLinkCandidates(seedUrl, markdown) {
  const candidates = new Map();
  const lines = markdown.split(/\r?\n/);
  let currentHeading = null;

  lines.forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      return;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmedLine);
    if (headingMatch) {
      currentHeading = headingMatch[2]?.trim() || null;
      return;
    }

    const matches = trimmedLine.matchAll(
      /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    );

    for (const match of matches) {
      const resolvedUrl = resolveUrlValue(match[2], seedUrl);
      if (!resolvedUrl) {
        continue;
      }

      const source = currentHeading && RELATED_SECTION_PATTERN.test(currentHeading)
        ? 'related'
        : currentHeading && !EXCLUDED_SECTION_PATTERN.test(currentHeading)
          ? 'main'
          : 'generic';

      upsertPrioritizedLinkCandidate(
        candidates,
        scorePrioritizedLinkCandidate({
          seedUrl,
          candidateUrl: resolvedUrl,
          source,
          anchorText: match[1],
          sectionHeading: currentHeading,
        }),
      );
    }
  });

  return candidates;
}

function selectPrioritizedChildLinks(seedUrl, document, maxLinks) {
  if (maxLinks <= 0) {
    return [];
  }

  const candidates = new Map();
  const markdown = typeof document?.markdown === 'string' ? document.markdown : '';

  if (markdown.trim()) {
    extractMarkdownLinkCandidates(seedUrl, markdown).forEach((candidate, url) => {
      candidates.set(url, candidate);
    });
  }

  const discoveredLinks = Array.isArray(document?.links) ? document.links : [];
  discoveredLinks.forEach((link) => {
    const resolvedUrl = resolveUrlValue(link, seedUrl);
    if (!resolvedUrl) {
      return;
    }

    upsertPrioritizedLinkCandidate(
      candidates,
      scorePrioritizedLinkCandidate({
        seedUrl,
        candidateUrl: resolvedUrl,
        source: 'generic',
      }),
    );
  });

  return [...candidates.values()]
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))
    .slice(0, maxLinks)
    .map((candidate) => candidate.url);
}

function normalizeUrlCrawlLevels(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_URL_CRAWL_LEVELS;
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_URL_CRAWL_LEVELS) {
    const error = new Error(
      `levels must be an integer between 1 and ${MAX_URL_CRAWL_LEVELS}.`,
    );
    error.statusCode = 400;
    throw error;
  }

  return parsed;
}

function normalizeSourceIdentifier(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function getPlainTextValueFromEntry(entry) {
  if (typeof entry === 'string') {
    return entry;
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }
  return (
    entry.plain_text ??
    entry.plainText ??
    entry.cleaned_text ??
    entry.cleanedText ??
    entry.content ??
    entry.text ??
    entry.body ??
    entry.markdown ??
    null
  );
}

function getPlainTextInputList(plainTextData) {
  if (typeof plainTextData === 'string') {
    return [plainTextData];
  }
  if (Array.isArray(plainTextData)) {
    return plainTextData;
  }
  if (plainTextData && typeof plainTextData === 'object') {
    return [plainTextData];
  }
  const error = new Error(
    'plain_text must be a non-empty string, object, or array of cleaned plain text entries.',
  );
  error.statusCode = 400;
  throw error;
}

function buildPlainTextEmbeddingRecord(entry, index) {
  const contentValue = getPlainTextValueFromEntry(entry);
  const normalizedContent = truncateText(
    cleanEmbeddingSourceText(
      typeof contentValue === 'string' ? contentValue : '',
    ),
  );

  if (!normalizedContent) {
    return null;
  }

  if (typeof entry === 'string') {
    return {
      id: generateRecordId(),
      source_type: 'plain_text',
      content_length: normalizedContent.length,
      content: normalizedContent,
    };
  }

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const sourceUrl = normalizeUrlValue(
    entry.url ??
    entry.source_url ??
    entry.sourceUrl ??
    entry.page_url ??
    entry.pageUrl ??
    null,
  );
  const parsedUrl = sourceUrl ? new URL(sourceUrl) : null;
  const record = {
    id:
      normalizeSourceIdentifier(
        entry.id ??
        entry._id ??
        entry.source_id ??
        entry.sourceId ??
        entry.record_id ??
        entry.recordId,
      ) ||
      sourceUrl ||
      `plain_text_${index + 1}`,
    source_type: 'plain_text',
    ...(sourceUrl
      ? {
          url: sourceUrl,
          hostname: parsedUrl?.hostname || null,
          pathname: parsedUrl?.pathname || '/',
        }
      : {}),
    ...(normalizeOptionalString(entry.title) ? { title: normalizeOptionalString(entry.title) } : {}),
    ...(normalizeOptionalString(entry.description)
      ? { description: normalizeOptionalString(entry.description) }
      : {}),
    ...(normalizeOptionalString(entry.language) ? { language: normalizeOptionalString(entry.language) } : {}),
    content_length: normalizedContent.length,
    content: normalizedContent,
  };

  const consumedKeys = new Set([
    'id',
    '_id',
    'source_id',
    'sourceId',
    'record_id',
    'recordId',
    'plain_text',
    'plainText',
    'cleaned_text',
    'cleanedText',
    'content',
    'text',
    'body',
    'markdown',
    'url',
    'source_url',
    'sourceUrl',
    'page_url',
    'pageUrl',
    'title',
    'description',
    'language',
  ]);

  Object.entries(entry).forEach(([key, value]) => {
    if (consumedKeys.has(key) || value === undefined) {
      return;
    }
    record[key] = value;
  });

  return record;
}

function normalizePlainTextRecords(plainTextData) {
  const entries = getPlainTextInputList(plainTextData);
  if (!entries.length) {
    const error = new Error('plain_text must contain at least one entry.');
    error.statusCode = 400;
    throw error;
  }

  const records = [];
  const invalidIndexes = [];

  entries.forEach((entry, index) => {
    const record = buildPlainTextEmbeddingRecord(entry, index);
    if (!record) {
      invalidIndexes.push(index);
      return;
    }
    records.push(record);
  });

  if (invalidIndexes.length > 0) {
    const error = new Error(
      `plain_text contains invalid or empty entries at indexes: ${invalidIndexes.slice(0, 10).join(', ')}`,
    );
    error.statusCode = 400;
    throw error;
  }

  if (!records.length) {
    const error = new Error('plain_text must contain at least one valid cleaned text entry.');
    error.statusCode = 400;
    throw error;
  }

  return records;
}

function generateRecordId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return crypto.randomBytes(16).toString('hex');
}

function truncateText(text, maxChars = MAX_EMBEDDING_INPUT_CHARS) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(0, maxChars);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.prototype.toString.call(value) === '[object Object]';
}

function normalizeFlagValue(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n'].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function normalizeFieldOptions(fieldOptions) {
  if (!fieldOptions) {
    return {};
  }

  const normalized = {};
  const assignOption = (key, value) => {
    if (!key || typeof key !== 'string') {
      return;
    }
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return;
    }
    const entry = {
      searchable: normalizeFlagValue(value.searchable),
      filterable: normalizeFlagValue(value.filterable),
      retrievable: normalizeFlagValue(value.retrievable),
    };
    const rawFilterMode =
      value.filterMode ||
      value.filter_mode ||
      value.filterStrategy ||
      value.filter_strategy ||
      value.filterType ||
      value.filter_type;
    if (typeof rawFilterMode === 'string') {
      const trimmed = rawFilterMode.trim();
      if (trimmed) {
        entry.filterMode = trimmed;
      }
    }
    if (
      entry.searchable === undefined &&
      entry.filterable === undefined &&
      entry.retrievable === undefined &&
      entry.filterMode === undefined
    ) {
      return;
    }
    normalized[normalizedKey] = entry;
  };

  if (Array.isArray(fieldOptions)) {
    fieldOptions.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const key =
        entry.key ||
        entry.field ||
        entry.name ||
        entry.path ||
        entry.column_name ||
        entry.columnName;
      assignOption(key, entry);
    });
    return normalized;
  }

  if (isPlainObject(fieldOptions)) {
    Object.entries(fieldOptions).forEach(([key, value]) => {
      assignOption(key, value);
    });
  }

  return normalized;
}

function mergeFieldOptionsMap(baseOptions, nextOptions) {
  const merged = { ...baseOptions };
  if (!nextOptions) {
    return merged;
  }
  Object.entries(nextOptions).forEach(([path, options]) => {
    if (!options || typeof options !== 'object') {
      return;
    }
    const hasFlags =
      options.searchable !== undefined ||
      options.filterable !== undefined ||
      options.retrievable !== undefined ||
      options.filterMode !== undefined;
    if (!hasFlags) {
      return;
    }
    if (!merged[path]) {
      merged[path] = {};
    }
    mergeRecordFieldOptions(merged, path, options);
  });
  return merged;
}

function mergeRecordFieldOptions(target, path, nextOptions) {
  if (!target || !path) {
    return;
  }
  if (!target[path]) {
    target[path] = {};
  }
  const entry = target[path];
  ['searchable', 'filterable', 'retrievable'].forEach((key) => {
    if (nextOptions[key] === undefined) {
      return;
    }
    if (nextOptions[key] === false) {
      entry[key] = false;
      return;
    }
    if (entry[key] !== false) {
      entry[key] = true;
    }
  });
  if (typeof nextOptions.filterMode === 'string' && nextOptions.filterMode.trim()) {
    entry.filterMode = nextOptions.filterMode.trim();
  }
}

function isFieldFlagWrapper(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  const hasFlag = ['searchable', 'filterable', 'retrievable']
    .some((key) => Object.prototype.hasOwnProperty.call(value, key));
  if (!hasFlag) {
    return false;
  }
  return (
    Object.prototype.hasOwnProperty.call(value, 'value') ||
    Object.prototype.hasOwnProperty.call(value, 'data')
  );
}

function unwrapRecordValue(value, path = '', fieldOptions = null) {
  if (isFieldFlagWrapper(value)) {
    const options = {
      searchable: normalizeFlagValue(value.searchable),
      filterable: normalizeFlagValue(value.filterable),
      retrievable: normalizeFlagValue(value.retrievable),
    };
    const hasFlags =
      options.searchable !== undefined ||
      options.filterable !== undefined ||
      options.retrievable !== undefined;
    if (fieldOptions && path && hasFlags) {
      mergeRecordFieldOptions(fieldOptions, path, options);
    }
    const inner = Object.prototype.hasOwnProperty.call(value, 'value') ? value.value : value.data;
    return unwrapRecordValue(inner, path, fieldOptions);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => unwrapRecordValue(entry, path, fieldOptions));
  }
  if (isPlainObject(value)) {
    const next = {};
    Object.entries(value).forEach(([key, entry]) => {
      const nextPath = path ? `${path}.${key}` : key;
      next[key] = unwrapRecordValue(entry, nextPath, fieldOptions);
    });
    return next;
  }
  return value;
}

function unwrapRecords(records, collectOptions = false) {
  const fieldOptions = collectOptions ? {} : null;
  const unwrapped = records.map((record) => unwrapRecordValue(record, '', fieldOptions));
  return {
    records: unwrapped,
    fieldOptions: fieldOptions || {},
  };
}

function hasFieldOptions(fieldOptions) {
  return fieldOptions && Object.keys(fieldOptions).length > 0;
}

function hasFlagValue(fieldOptions, flag, value) {
  if (!fieldOptions) {
    return false;
  }
  return Object.values(fieldOptions).some((entry) => entry && entry[flag] === value);
}

function isFieldAllowed(fieldOptions, path, flag) {
  if (!fieldOptions || !path) {
    return true;
  }
  const normalizedPath = String(path);
  const parts = normalizedPath.split('.');
  for (let i = parts.length; i >= 1; i -= 1) {
    const candidate = parts.slice(0, i).join('.');
    const options = fieldOptions[candidate];
    if (options && options[flag] === false) {
      return false;
    }
  }
  return true;
}

function createFieldPredicate(fieldOptions, flag) {
  if (!hasFieldOptions(fieldOptions)) {
    return () => true;
  }
  return (path) => isFieldAllowed(fieldOptions, path, flag);
}

function pruneRecordByFlag(record, fieldOptions, flag, path = '') {
  if (path && !isFieldAllowed(fieldOptions, path, flag)) {
    return undefined;
  }
  if (Array.isArray(record)) {
    return record
      .map((entry) => pruneRecordByFlag(entry, fieldOptions, flag, path))
      .filter((entry) => entry !== undefined);
  }
  if (isPlainObject(record)) {
    const next = {};
    Object.entries(record).forEach(([key, value]) => {
      const nextPath = path ? `${path}.${key}` : key;
      const pruned = pruneRecordByFlag(value, fieldOptions, flag, nextPath);
      if (pruned !== undefined) {
        next[key] = pruned;
      }
    });
    return next;
  }
  return record;
}

function stripStructuredFilterPrefix(key) {
  const prefix = 'structuredFilters.';
  if (typeof key !== 'string') {
    return '';
  }
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

function setNestedFilterValue(target, path, value) {
  if (!path || typeof path !== 'string') {
    return;
  }
  const parts = path.split('.').filter(Boolean);
  if (parts.length === 0) {
    return;
  }
  let current = target;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (i === parts.length - 1) {
      current[part] = value;
      return;
    }
    const existing = current[part];
    if (!isPlainObject(existing)) {
      current[part] = {};
    }
    current = current[part];
  }
}

function nestStructuredFilters(filters) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return filters;
  }
  const nested = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (!key || typeof key !== 'string') {
      return;
    }
    if (!key.includes('.')) {
      nested[key] = value;
      return;
    }
    setNestedFilterValue(nested, key, value);
  });
  return nested;
}

function getStructuredFilterValue(filters, key) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(filters, key)) {
    return filters[key];
  }
  if (!key || typeof key !== 'string' || !key.includes('.')) {
    return undefined;
  }
  const parts = key.split('.').filter(Boolean);
  let current = filters;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

const FILTER_OPERATOR_KEYS = new Set([
  'min',
  'max',
  'gte',
  'lte',
  'gt',
  'lt',
  'eq',
  'ne',
  'in',
  'nin',
  '$gte',
  '$lte',
  '$gt',
  '$lt',
  '$eq',
  '$ne',
  '$in',
  '$nin',
]);

function isOperatorObject(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }
  return keys.every((key) => FILTER_OPERATOR_KEYS.has(key) || key.startsWith('$'));
}

function mergeFlattenedFilterValue(target, key, value) {
  if (!Object.prototype.hasOwnProperty.call(target, key)) {
    target[key] = value;
    return;
  }
  const existing = target[key];
  if (Array.isArray(existing)) {
    if (Array.isArray(value)) {
      target[key] = [...existing, ...value];
    } else {
      existing.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    target[key] = [existing, ...value];
    return;
  }
  target[key] = [existing, value];
}

function flattenFilterPayload(payload) {
  if (!isPlainObject(payload)) {
    return payload;
  }
  const flattened = {};
  const walk = (value, path) => {
    if (value === undefined) {
      return;
    }
    if (value === null || typeof value !== 'object' || value instanceof Date) {
      if (path) {
        mergeFlattenedFilterValue(flattened, path, value);
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        if (path) {
          mergeFlattenedFilterValue(flattened, path, value);
        }
        return;
      }
      const hasObjectEntries = value.some((entry) => isPlainObject(entry));
      if (!hasObjectEntries) {
        if (path) {
          mergeFlattenedFilterValue(flattened, path, value);
        }
        return;
      }
      value.forEach((entry) => {
        if (entry === undefined) {
          return;
        }
        if (Array.isArray(entry)) {
          walk(entry, path);
          return;
        }
        if (isPlainObject(entry)) {
          if (isOperatorObject(entry)) {
            if (path) {
              mergeFlattenedFilterValue(flattened, path, entry);
            }
            return;
          }
          Object.entries(entry).forEach(([key, nested]) => {
            const nextPath = path ? `${path}.${key}` : key;
            walk(nested, nextPath);
          });
          return;
        }
        if (path) {
          mergeFlattenedFilterValue(flattened, path, entry);
        }
      });
      return;
    }
    if (isPlainObject(value)) {
      if (isOperatorObject(value)) {
        if (path) {
          mergeFlattenedFilterValue(flattened, path, value);
        }
        return;
      }
      const entries = Object.entries(value);
      if (entries.length === 0) {
        if (path) {
          mergeFlattenedFilterValue(flattened, path, value);
        }
        return;
      }
      entries.forEach(([key, nested]) => {
        const nextPath = path ? `${path}.${key}` : key;
        walk(nested, nextPath);
      });
    }
  };

  Object.entries(payload).forEach(([key, value]) => {
    walk(value, key);
  });

  return flattened;
}

function normalizeFilterPayload(payload, structuredFields) {
  if (!isPlainObject(payload)) {
    return null;
  }
  const flattenedPayload = flattenFilterPayload(payload);
  const filterQuery = buildStructuredFilterQuery(flattenedPayload, structuredFields);
  const normalized = {};
  Object.entries(filterQuery).forEach(([key, value]) => {
    const normalizedKey = stripStructuredFilterPrefix(key);
    if (!normalizedKey) {
      return;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (Object.prototype.hasOwnProperty.call(value, '$in')) {
        const values = Array.isArray(value.$in) ? value.$in : [];
        if (values.length) {
          normalized[normalizedKey] = values;
        }
        return;
      }
      const hasLower = Object.prototype.hasOwnProperty.call(value, '$gte');
      const hasUpper = Object.prototype.hasOwnProperty.call(value, '$lte');
      if (hasLower || hasUpper) {
        const range = {};
        if (hasLower) {
          range.min = value.$gte;
        }
        if (hasUpper) {
          range.max = value.$lte;
        }
        if (Object.keys(range).length) {
          normalized[normalizedKey] = range;
        }
        return;
      }
    }
    normalized[normalizedKey] = value;
  });
  return Object.keys(normalized).length ? normalized : null;
}

function compareFilterValues(a, b) {
  const coerceNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || !/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'bigint') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const aNumber = coerceNumber(a);
  const bNumber = coerceNumber(b);
  if (aNumber !== null && bNumber !== null) {
    return aNumber - bNumber;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b);
  }
  return null;
}

function valuesMatch(a, b) {
  if (a === b) {
    return true;
  }
  const coerceNumber = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed || !/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (typeof value === 'bigint') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const aNumber = coerceNumber(a);
  const bNumber = coerceNumber(b);
  if (aNumber !== null && bNumber !== null) {
    return aNumber === bNumber;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.toLowerCase() === b.toLowerCase();
  }
  return false;
}

function coerceRegexCondition(condition) {
  if (!condition) {
    return null;
  }
  if (condition instanceof RegExp) {
    return condition;
  }
  if (typeof condition !== 'object') {
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(condition, '$regex')) {
    const pattern = condition.$regex;
    if (pattern instanceof RegExp) {
      return pattern;
    }
    if (typeof pattern !== 'string') {
      return null;
    }
    const flags = typeof condition.$options === 'string' ? condition.$options : 'i';
    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }
  return null;
}

function scoreStructuredFilterMatch(recordValue, filterCondition) {
  if (recordValue === undefined || recordValue === null) {
    return 0;
  }
  const recordValues = Array.isArray(recordValue) ? recordValue : [recordValue];

  if (filterCondition && typeof filterCondition === 'object' && !Array.isArray(filterCondition)) {
    const regexCondition = coerceRegexCondition(filterCondition);
    if (regexCondition) {
      const matched = recordValues.some(
        (entry) => typeof entry === 'string' && regexCondition.test(entry),
      );
      return matched ? 1 : 0;
    }

    if (Object.prototype.hasOwnProperty.call(filterCondition, '$in')) {
      const expected = Array.isArray(filterCondition.$in) ? filterCondition.$in : [];
      if (expected.length === 0) {
        return 0;
      }
      const matches = expected.filter((expectedValue) =>
        recordValues.some((entry) => {
          const regex = coerceRegexCondition(expectedValue);
          if (regex) {
            return typeof entry === 'string' && regex.test(entry);
          }
          return valuesMatch(entry, expectedValue);
        }),
      ).length;
      return matches > 0 ? matches / expected.length : 0;
    }

    if (
      Object.prototype.hasOwnProperty.call(filterCondition, '$gte') ||
      Object.prototype.hasOwnProperty.call(filterCondition, '$lte')
    ) {
      const lower = filterCondition.$gte ?? null;
      const upper = filterCondition.$lte ?? null;
      const recordValueSingle = recordValues[0];
      if (lower !== null) {
        const compare = compareFilterValues(recordValueSingle, lower);
        if (compare === null || compare < 0) {
          return 0;
        }
      }
      if (upper !== null) {
        const compare = compareFilterValues(recordValueSingle, upper);
        if (compare === null || compare > 0) {
          return 0;
        }
      }
      return 1;
    }
  }

  const regexCondition = coerceRegexCondition(filterCondition);
  if (regexCondition) {
    return recordValues.some(
      (entry) => typeof entry === 'string' && regexCondition.test(entry),
    ) ? 1 : 0;
  }

  return recordValues.some((entry) => valuesMatch(entry, filterCondition)) ? 1 : 0;
}

function applyStructuredFilterBoost(results, structuredFilterQuery) {
  if (!structuredFilterQuery || typeof structuredFilterQuery !== 'object') {
    return { results, applied: false };
  }

  const filterEntries = Object.entries(structuredFilterQuery)
    .map(([key, value]) => [stripStructuredFilterPrefix(key), value])
    .filter(([key]) => key);

  if (filterEntries.length === 0) {
    return { results, applied: false };
  }

  const boosted = results.map((result) => {
    const recordFilters = result?.structuredFilters || {};
    const total = filterEntries.length;
    const matchedScore = filterEntries.reduce((score, [key, condition]) => {
      const recordValue = getStructuredFilterValue(recordFilters, key);
      return score + scoreStructuredFilterMatch(recordValue, condition);
    }, 0);
    const matchRatio = total > 0 ? matchedScore / total : 0;
    if (!matchRatio) {
      return result;
    }
    const baseScore = typeof result.score === 'number' ? result.score : 0;
    return {
      ...result,
      score: baseScore + matchRatio * FILTER_MATCH_BOOST,
    };
  });

  return { results: boosted, applied: true };
}

function normalizeKeyForMatch(key) {
  if (!key || typeof key !== 'string') {
    return '';
  }
  const withUnderscores = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2');
  return withUnderscores
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function normalizeConfigKeyList(value) {
  if (!value) {
    return [];
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean);
  }
  return [];
}

function dedupeStringList(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set();
  const deduped = [];
  values.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    deduped.push(trimmed);
  });
  return deduped;
}

function normalizeFilterConfig(filterConfig) {
  if (!isPlainObject(filterConfig)) {
    return null;
  }
  const softFilterKeys = normalizeConfigKeyList(
    filterConfig.soft_filter_keys ||
      filterConfig.softFilterKeys ||
      filterConfig.post_filter_keys ||
      filterConfig.postFilterKeys,
  );
  const availabilityDateKeyFields = normalizeConfigKeyList(
    filterConfig.availability_date_key_fields ||
      filterConfig.availabilityDateKeyFields ||
      filterConfig.availability_date_key_field ||
      filterConfig.availabilityDateKeyField,
  );
  const availabilityFieldRoots = normalizeConfigKeyList(
    filterConfig.availability_field_roots ||
      filterConfig.availabilityFieldRoots ||
      filterConfig.availability_fields ||
      filterConfig.availabilityFields,
  );
  return {
    softFilterKeys,
    availabilityDateKeyFields,
    availabilityFieldRoots,
  };
}

function extractSoftFilterKeysFromFieldOptions(fieldOptions) {
  if (!fieldOptions || typeof fieldOptions !== 'object') {
    return [];
  }
  const keys = [];
  Object.entries(fieldOptions).forEach(([key, options]) => {
    if (!options || typeof options !== 'object') {
      return;
    }
    const mode = typeof options.filterMode === 'string'
      ? options.filterMode.trim().toLowerCase()
      : '';
    if (!mode) {
      return;
    }
    if (['soft', 'post', 'post_filter', 'boost', 'loose'].includes(mode)) {
      keys.push(key);
    }
  });
  return keys;
}

function resolveSoftFilterKeys(filterConfig, fieldOptions) {
  const normalizedConfig = normalizeFilterConfig(filterConfig);
  const configKeys = dedupeStringList(normalizedConfig?.softFilterKeys || []);
  if (configKeys.length > 0) {
    return new Set(configKeys);
  }
  const optionKeys = dedupeStringList(extractSoftFilterKeysFromFieldOptions(fieldOptions));
  if (optionKeys.length > 0) {
    return new Set(optionKeys);
  }
  return new Set(DEFAULT_SOFT_FILTER_KEYS);
}

function isAvailabilityDateKeyCandidate(normalizedKey) {
  if (!normalizedKey) {
    return false;
  }
  const hasAvailability = normalizedKey.includes('availability') || normalizedKey.includes('available');
  if (!hasAvailability) {
    return false;
  }
  return normalizedKey.includes('date') && normalizedKey.includes('key');
}

function isAvailabilitySummaryCandidate(normalizedKey) {
  if (!normalizedKey) {
    return false;
  }
  const hasAvailability = normalizedKey.includes('availability') || normalizedKey.includes('available');
  if (!hasAvailability) {
    return false;
  }
  if (!normalizedKey.includes('date')) {
    return false;
  }
  return !normalizedKey.includes('key');
}

function scoreAvailabilityDateKeyField(key) {
  const normalized = normalizeKeyForMatch(key);
  let score = 0;
  if (normalized.includes('availability')) {
    score += 3;
  }
  if (normalized.includes('available')) {
    score += 2;
  }
  if (normalized.includes('date')) {
    score += 2;
  }
  if (normalized.includes('key')) {
    score += 2;
  }
  if (!key.includes('.')) {
    score += 1;
  }
  return score;
}

function selectAvailabilityDateKeyField(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    return null;
  }
  const scored = fields
    .map((field) => ({ field, score: scoreAvailabilityDateKeyField(field), length: field.length }))
    .sort((a, b) => (b.score - a.score) || (a.length - b.length));
  return scored[0]?.field || null;
}

function resolveAvailabilityConfig(structuredFields, filterConfig) {
  const normalizedConfig = normalizeFilterConfig(filterConfig);
  const dateKeyFields = [];
  const availabilityRoots = [];
  const preferredDateKeys = normalizedConfig
    ? dedupeStringList(normalizedConfig.availabilityDateKeyFields)
    : [];
  if (normalizedConfig) {
    dateKeyFields.push(...normalizedConfig.availabilityDateKeyFields);
    availabilityRoots.push(...normalizedConfig.availabilityFieldRoots);
  }
  (structuredFields || []).forEach((field) => {
    const key = field?.key;
    if (!key || typeof key !== 'string') {
      return;
    }
    const normalizedKey = normalizeKeyForMatch(key);
    if (isAvailabilityDateKeyCandidate(normalizedKey)) {
      dateKeyFields.push(key);
    }
    if (isAvailabilitySummaryCandidate(normalizedKey)) {
      const root = key.split('.')[0];
      if (root) {
        availabilityRoots.push(root);
      }
    }
  });
  const dedupedDateKeyFields = dedupeStringList(dateKeyFields);
  const dedupedAvailabilityRoots = dedupeStringList(availabilityRoots);
  return {
    dateKeyField: preferredDateKeys[0] || selectAvailabilityDateKeyField(dedupedDateKeyFields),
    dateKeyFields: dedupedDateKeyFields,
    availabilityFieldRoots: dedupedAvailabilityRoots,
  };
}

function splitStructuredFilters(filters, options = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return { strictFilters: filters, postFilters: null };
  }
  const softFilterKeys = options.softFilterKeys;
  const softFilterSet = softFilterKeys instanceof Set
    ? softFilterKeys
    : new Set(Array.isArray(softFilterKeys) ? softFilterKeys : DEFAULT_SOFT_FILTER_KEYS);
  const strictFilters = {};
  const postFilters = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (!key) {
      return;
    }
    if (softFilterSet.has(key)) {
      postFilters[key] = value;
    } else {
      strictFilters[key] = value;
    }
  });
  return {
    strictFilters: Object.keys(strictFilters).length ? strictFilters : null,
    postFilters: Object.keys(postFilters).length ? postFilters : null,
  };
}

function applyStructuredFilterPostFilter(results, structuredFilterQuery) {
  if (!structuredFilterQuery || typeof structuredFilterQuery !== 'object') {
    return results;
  }

  const filterEntries = Object.entries(structuredFilterQuery)
    .map(([key, value]) => [stripStructuredFilterPrefix(key), value])
    .filter(([key]) => key);

  if (filterEntries.length === 0) {
    return results;
  }

  return results.filter((result) => {
    const recordFilters = result?.structuredFilters || {};
    const rawRecord = result?.raw && typeof result.raw === 'object' ? result.raw : null;
    return filterEntries.every(([key, condition]) => {
      let recordValue = getStructuredFilterValue(recordFilters, key);
      if (
        recordValue === undefined &&
        rawRecord &&
        Object.prototype.hasOwnProperty.call(rawRecord, key)
      ) {
        recordValue = rawRecord[key];
      }
      return scoreStructuredFilterMatch(recordValue, condition) > 0;
    });
  });
}

function normalizeSearchDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function normalizeDateKey(value) {
  if (!value) {
    return '';
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    const splitOn = trimmed.indexOf('T');
    if (splitOn > 0) {
      return trimmed.slice(0, splitOn);
    }
    const spaceIndex = trimmed.indexOf(' ');
    if (spaceIndex > 0) {
      return trimmed.slice(0, spaceIndex);
    }
    return trimmed;
  }
  return '';
}

function parseEmbeddedJson(value) {
  if (typeof value !== 'string') {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const payload = trimmed.startsWith('__json__:') ? trimmed.slice('__json__:'.length) : trimmed;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function normalizeAvailabilitySummaries(value) {
  const parsed = parseEmbeddedJson(value);
  if (Array.isArray(parsed)) {
    return parsed.filter((entry) => isPlainObject(entry));
  }
  if (isPlainObject(parsed)) {
    return [parsed];
  }
  return [];
}

function normalizeAvailabilityRanges(value) {
  const parsed = parseEmbeddedJson(value);
  if (Array.isArray(parsed)) {
    return parsed.filter((entry) => isPlainObject(entry));
  }
  if (isPlainObject(parsed)) {
    return [parsed];
  }
  return [];
}

function normalizeAvailabilityDateList(value) {
  const parsed = parseEmbeddedJson(value);
  if (typeof parsed === 'string') {
    const normalized = normalizeDateKey(parsed);
    return normalized ? [normalized] : [];
  }
  if (Array.isArray(parsed)) {
    return parsed
      .filter((entry) => typeof entry === 'string')
      .map((entry) => normalizeDateKey(entry))
      .filter(Boolean);
  }
  return [];
}

function isDateInRange(dateKey, range) {
  const start = typeof range.start_date === 'string' ? normalizeDateKey(range.start_date) : '';
  const end = typeof range.end_date === 'string' ? normalizeDateKey(range.end_date) : '';
  if (!start || !end) {
    return false;
  }
  return start <= dateKey && dateKey <= end;
}

function isDateInRanges(dateKey, ranges) {
  return ranges.some((range) => isDateInRange(dateKey, range));
}

function isDateAvailableForSummary(summary, dateKey) {
  const blockedRanges = normalizeAvailabilityRanges(
    summary.unavailable_ranges ?? summary.unavailableRanges ?? [],
  );
  if (blockedRanges.length > 0 && isDateInRanges(dateKey, blockedRanges)) {
    return false;
  }
  const blockedDates = normalizeAvailabilityDateList(
    summary.unavailable_date_keys ?? summary.unavailableDateKeys ?? [],
  );
  if (blockedDates.includes(dateKey)) {
    return false;
  }

  const summaryKeys = normalizeAvailabilityDateList(
    summary.available_date_keys ?? summary.availableDateKeys ?? [],
  );
  if (summaryKeys.includes(dateKey)) {
    return true;
  }

  const ranges = normalizeAvailabilityRanges(
    summary.available_ranges ?? summary.availableRanges ?? [],
  );
  if (ranges.length > 0 && isDateInRanges(dateKey, ranges)) {
    return true;
  }

  const summaryDates = normalizeAvailabilityDateList(
    summary.availability_dates ?? summary.availabilityDates ?? [],
  );
  if (summaryDates.includes(dateKey)) {
    return true;
  }

  const directRange = {
    start_date: typeof summary.start_date === 'string' ? summary.start_date : null,
    end_date: typeof summary.end_date === 'string' ? summary.end_date : null,
  };
  if (directRange.start_date && directRange.end_date && isDateInRange(dateKey, directRange)) {
    return true;
  }
  return false;
}

function isDateAvailableForRecord(record, dateKey, availabilityConfig) {
  if (!record || typeof record !== 'object') {
    return false;
  }
  const recordKeys = Object.keys(record);
  const dateKeyFields = dedupeStringList([
    ...(availabilityConfig?.dateKeyFields || []),
    ...recordKeys.filter((key) => isAvailabilityDateKeyCandidate(normalizeKeyForMatch(key))),
  ]);
  const aggregatedDateKeys = [];
  dateKeyFields.forEach((field) => {
    const value = getStructuredFilterValue(record, field);
    const keys = normalizeAvailabilityDateList(value);
    if (keys.length > 0) {
      aggregatedDateKeys.push(...keys);
    }
  });
  if (aggregatedDateKeys.length > 0) {
    return aggregatedDateKeys.includes(dateKey);
  }

  const availabilityRoots = dedupeStringList([
    ...(availabilityConfig?.availabilityFieldRoots || []),
    ...recordKeys.filter((key) => isAvailabilitySummaryCandidate(normalizeKeyForMatch(key))),
  ]);
  if (availabilityRoots.length === 0) {
    return false;
  }
  for (const root of availabilityRoots) {
    const availabilityValue = getStructuredFilterValue(record, root);
    if (!availabilityValue) {
      continue;
    }
    const summaries = normalizeAvailabilitySummaries(availabilityValue);
    if (summaries.length === 0) {
      const directDates = normalizeAvailabilityDateList(availabilityValue);
      if (directDates.includes(dateKey)) {
        return true;
      }
      continue;
    }
    if (summaries.some((summary) => isDateAvailableForSummary(summary, dateKey))) {
      return true;
    }
  }
  return false;
}

function applyAvailabilityDatePostFilter(results, searchDateKey, availabilityConfig) {
  if (!searchDateKey) {
    return results;
  }
  if (!Array.isArray(results) || results.length === 0) {
    return results;
  }
  return results.filter((result) => {
    const rawRecord = result?.raw;
    const record =
      rawRecord && typeof rawRecord === 'string'
        ? parseEmbeddedJson(rawRecord)
        : rawRecord;
    if (!record || typeof record !== 'object') {
      return false;
    }
    return isDateAvailableForRecord(record, searchDateKey, availabilityConfig);
  });
}

function stripAvailabilityFilters(filters, availabilityConfig, options = {}) {
  if (!filters || typeof filters !== 'object' || Array.isArray(filters)) {
    return filters;
  }
  const removeDateKeys = options?.removeDateKeys === true;
  const availabilityRoots = new Set(availabilityConfig?.availabilityFieldRoots || []);
  const dateKeyFields = new Set(availabilityConfig?.dateKeyFields || []);
  const stripped = {};
  Object.entries(filters).forEach(([key, value]) => {
    if (!key) {
      return;
    }
    if (dateKeyFields.has(key)) {
      if (removeDateKeys) {
        return;
      }
      stripped[key] = value;
      return;
    }
    const root = key.split('.')[0];
    if (availabilityRoots.has(root)) {
      return;
    }
    if (availabilityRoots.size === 0) {
      const normalizedKey = normalizeKeyForMatch(key);
      if (isAvailabilitySummaryCandidate(normalizedKey)) {
        return;
      }
    }
    stripped[key] = value;
  });
  return stripped;
}

function sanitizeEmbeddingRecord(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }
  if (!isPlainObject(record)) {
    return { value: record };
  }
  const entries = Object.entries(record).filter(([, value]) => value !== undefined);
  if (!entries.length) {
    return null;
  }
  return Object.fromEntries(entries);
}

function sanitizeEmbeddingRecords(records) {
  if (!Array.isArray(records)) {
    return [];
  }
  const sanitized = [];
  records.forEach((record) => {
    const cleaned = sanitizeEmbeddingRecord(record);
    if (cleaned) {
      sanitized.push(cleaned);
    }
  });
  return sanitized;
}

function safeStringify(value) {
  if (value === undefined) {
    return '';
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? '' : serialized;
  } catch {
    try {
      return String(value);
    } catch {
      return '';
    }
  }
}

function coerceRecordValue(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return String(value);
  } catch {
    return undefined;
  }
}

function normalizeEmbeddingRecords(records) {
  const sanitized = sanitizeEmbeddingRecords(records);
  if (sanitized.length === 0) {
    return [];
  }

  const nonIdKeys = new Set();
  sanitized.forEach((record) => {
    if (!record || typeof record !== 'object') {
      return;
    }
    Object.keys(record).forEach((key) => {
      const normalizedKey = String(key);
      if (!isIdField(normalizedKey)) {
        nonIdKeys.add(normalizedKey);
      }
    });
  });

  const normalizedKeys = Array.from(nonIdKeys).sort((a, b) => a.localeCompare(b));
  return sanitized.map((record) => {
    const normalizedRecord = {};
    if (record && typeof record === 'object') {
      Object.keys(record).forEach((key) => {
        const normalizedKey = String(key);
        if (isIdField(normalizedKey)) {
          normalizedRecord[normalizedKey] = record[key];
        }
      });
    }
    normalizedKeys.forEach((key) => {
      const value = record && typeof record === 'object' && Object.prototype.hasOwnProperty.call(record, key)
        ? record[key]
        : undefined;
      normalizedRecord[key] = coerceRecordValue(value);
    });
    return normalizedRecord;
  });
}

function normalizeEmbeddingText(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return truncateText(text);
}

function normalizeEmbeddingInputs(texts) {
  if (!Array.isArray(texts)) {
    return [];
  }
  return texts.map((text) => normalizeEmbeddingText(text));
}

function formatEmbeddingError(error) {
  const message = error?.message ?? String(error);
  return {
    message,
    code: error?.code,
    name: error?.name,
    stack: error?.stack,
  };
}

function prepareEmbeddingInputs(texts) {
  const normalized = normalizeEmbeddingInputs(texts);
  const tokenCounts = countTokensPerText(normalized, EMBEDDING_MODEL);
  const tokenCount = tokenCounts.reduce((total, value) => total + value, 0);
  return { normalized, tokenCount, tokenCounts };
}

function calculateCreditsFromUsd(costUsd, pricingMultiplier = DEFAULT_EMBEDDING_PRICING_MULTIPLIER) {
  const normalizedCostUsd = Number.isFinite(costUsd) ? Math.max(0, costUsd) : 0;
  const normalizedMultiplier = Number.isFinite(pricingMultiplier) && pricingMultiplier > 0
    ? pricingMultiplier
    : DEFAULT_EMBEDDING_PRICING_MULTIPLIER;
  return normalizedCostUsd * CREDITS_PER_DOLLAR * normalizedMultiplier;
}

function calculateEmbeddingCostUsd(tokenCount) {
  const normalizedTokens = Number.isFinite(tokenCount) ? Math.max(0, tokenCount) : 0;
  return (normalizedTokens / 1_000_000) * USD_PER_MILLION_TOKENS;
}

function calculateFirecrawlCostUsd(firecrawlCreditsUsed) {
  const normalizedCredits = Number.isFinite(firecrawlCreditsUsed)
    ? Math.max(0, firecrawlCreditsUsed)
    : 0;
  return normalizedCredits * FIRECRAWL_USD_PER_CREDIT;
}

function calculateFirecrawlBillingCredits(
  firecrawlCreditsUsed,
  pricingMultiplier = URL_EMBEDDING_PRICING_MULTIPLIER,
) {
  return calculateCreditsFromUsd(
    calculateFirecrawlCostUsd(firecrawlCreditsUsed),
    pricingMultiplier,
  );
}

function normalizeFirecrawlCreditsUsed(value, fallbackValue = 0) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  const fallback = Number(fallbackValue);
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

function buildSearchInputFromRecord(record, structuredFields, options = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return null;
  }
  const flatRecord = flattenRecord(record);
  const isFieldSearchable = typeof options.isFieldSearchable === 'function'
    ? options.isFieldSearchable
    : null;
  const applySearchableFilter = options.applySearchableFilter === true;
  let searchDoc = buildSearchDocument(flatRecord, { isFieldSearchable });
  if (!searchDoc && !applySearchableFilter) {
    searchDoc = JSON.stringify(record);
  }
  if (!searchDoc) {
    return null;
  }
  const structured = buildStructuredFilters(flatRecord, structuredFields || []);
  return {
    searchDoc,
    structuredFilters: structured,
  };
}

function calculateCreditsForTokens(
  tokenCount,
  pricingMultiplier = DEFAULT_EMBEDDING_PRICING_MULTIPLIER,
) {
  return calculateCreditsFromUsd(calculateEmbeddingCostUsd(tokenCount), pricingMultiplier);
}

async function resolveEmbeddingTemplate({ userId, templateId }) {
  if (!templateId || typeof templateId !== 'string') {
    return null;
  }

  const normalized = templateId.trim();
  if (!normalized) {
    return null;
  }

  const finalizeResolvedTemplate = async (template) => {
    if (!template) {
      return null;
    }

    const expiresAt = normalizeDateValue(template.expiresAt);
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      const resolvedTemplateId = template._id.toString();
      await purgeExpiredEmbeddingTemplates({
        userId,
        templateIds: [resolvedTemplateId],
      });
      throw createExpiredEmbeddingTemplateError({
        templateId: resolvedTemplateId,
        template,
      });
    }

    return { template, templateId: template._id.toString() };
  };

  if (mongoose.Types.ObjectId.isValid(normalized)) {
    const template = await EmbeddingTemplate.findById(normalized);
    if (template) {
      if (template.userId !== userId) {
        const error = new Error('Unauthorized');
        error.statusCode = 403;
        throw error;
      }
      return finalizeResolvedTemplate(template);
    }
  }

  const template = await EmbeddingTemplate.findOne({ userId, name: normalized })
    .sort({ updatedAt: -1 });
  if (!template) {
    return null;
  }

  return finalizeResolvedTemplate(template);
}

function buildBillingMetadata({
  tokenCount,
  operation,
  pricingMultiplier = DEFAULT_EMBEDDING_PRICING_MULTIPLIER,
  inputType = 'json',
  extraMetadata = null,
}) {
  return {
    requestType: 'API',
    category: 'embedding',
    operation,
    model: EMBEDDING_MODEL,
    inputType,
    inputTokens: tokenCount,
    pricingMultiplier,
    usdPerMillionTokens: USD_PER_MILLION_TOKENS,
    costUsd: calculateEmbeddingCostUsd(tokenCount),
    ...(extraMetadata && typeof extraMetadata === 'object' ? extraMetadata : {}),
  };
}

async function chargeEmbeddingTokens({
  userId,
  externalUser = null,
  tokenCount,
  source,
  operation,
  pricingMultiplier = DEFAULT_EMBEDDING_PRICING_MULTIPLIER,
  inputType = 'json',
  extraMetadata = null,
  countAsRequest = false,
}) {
  const creditsToCharge = calculateCreditsForTokens(tokenCount, pricingMultiplier);
  if (!creditsToCharge) {
    return { creditsCharged: 0, remainingCredits: null };
  }

  const billingMetadata = {
    ...buildBillingMetadata({
      tokenCount,
      operation,
      pricingMultiplier,
      inputType,
      extraMetadata,
    }),
    creditsCharged: creditsToCharge,
  };
  const deduction = externalUser?._id
    ? await deductExternalUserCredits({
        externalUser,
        credits: creditsToCharge,
        countAsRequest,
      })
    : await deductGenerationCredits(userId, creditsToCharge, {
        source,
        metadata: billingMetadata,
      });

  return {
    creditsCharged: creditsToCharge,
    remainingCredits: deduction?.remainingCredits ?? null,
  };
}

async function refundEmbeddingTokens({
  userId,
  externalUser = null,
  tokenCount,
  source,
  operation,
  pricingMultiplier = DEFAULT_EMBEDDING_PRICING_MULTIPLIER,
  inputType = 'json',
  extraMetadata = null,
}) {
  const creditsToRefund = calculateCreditsForTokens(tokenCount, pricingMultiplier);
  if (!creditsToRefund) {
    return { remainingCredits: null };
  }

  const billingMetadata = {
    ...buildBillingMetadata({
      tokenCount,
      operation,
      pricingMultiplier,
      inputType,
      extraMetadata,
    }),
    creditsRefunded: creditsToRefund,
  };
  const credit = externalUser?._id
    ? await creditExternalUserCredits({
        externalUser,
        credits: creditsToRefund,
      })
    : await creditGenerationCredits(userId, creditsToRefund, {
        source,
        metadata: billingMetadata,
      });

  return {
    creditsRefunded: creditsToRefund,
    remainingCredits: credit?.remainingCredits ?? null,
  };
}

function buildUrlCrawlBillingMetadata({
  urlCount,
  firecrawlCreditsUsed,
  phase = 'crawl',
  jobId = null,
  extraMetadata = null,
}) {
  return {
    requestType: 'API',
    category: 'embedding',
    operation: 'create',
    inputType: 'url',
    phase,
    provider: 'firecrawl',
    urlCount,
    firecrawlCreditsUsed,
    firecrawlUsdPerCredit: FIRECRAWL_USD_PER_CREDIT,
    firecrawlCostUsd: calculateFirecrawlCostUsd(firecrawlCreditsUsed),
    pricingMultiplier: URL_EMBEDDING_PRICING_MULTIPLIER,
    ...(jobId ? { jobId } : {}),
    ...(extraMetadata && typeof extraMetadata === 'object' ? extraMetadata : {}),
  };
}

async function chargeUrlCrawlCredits({
  userId,
  urlCount,
  firecrawlCreditsUsed,
  source,
  phase = 'crawl',
  jobId = null,
  extraMetadata = null,
}) {
  const creditsToCharge = calculateFirecrawlBillingCredits(firecrawlCreditsUsed);
  if (!creditsToCharge) {
    return { creditsCharged: 0, remainingCredits: null };
  }

  const deduction = await deductGenerationCredits(userId, creditsToCharge, {
    source,
    metadata: {
      ...buildUrlCrawlBillingMetadata({
        urlCount,
        firecrawlCreditsUsed,
        phase,
        jobId,
        extraMetadata,
      }),
      creditsCharged: creditsToCharge,
    },
  });

  return {
    creditsCharged: creditsToCharge,
    remainingCredits: deduction?.remainingCredits ?? null,
  };
}

async function refundUrlCrawlCredits({
  userId,
  urlCount,
  firecrawlCreditsUsed,
  source,
  phase = 'crawl_refund',
  jobId = null,
  extraMetadata = null,
}) {
  const creditsToRefund = calculateFirecrawlBillingCredits(firecrawlCreditsUsed);
  if (!creditsToRefund) {
    return { creditsRefunded: 0, remainingCredits: null };
  }

  const credit = await creditGenerationCredits(userId, creditsToRefund, {
    source,
    metadata: {
      ...buildUrlCrawlBillingMetadata({
        urlCount,
        firecrawlCreditsUsed,
        phase,
        jobId,
        extraMetadata,
      }),
      creditsRefunded: creditsToRefund,
    },
  });

  return {
    creditsRefunded: creditsToRefund,
    remainingCredits: credit?.remainingCredits ?? null,
  };
}

function getErrorMessage(error) {
  if (!error) {
    return '';
  }
  return (
    error?.message ||
    error?.error?.message ||
    error?.response?.data?.error?.message ||
    ''
  );
}

function isPayloadTooLargeError(error) {
  const status = error?.status || error?.statusCode || error?.response?.status;
  if (status === 413) {
    return true;
  }
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('maximum context length') ||
    message.includes('too many tokens') ||
    message.includes('context length') ||
    message.includes('input is too large') ||
    message.includes('max input') ||
    message.includes('maximum input')
  );
}

function isRetryableOpenAIError(error) {
  const status = error?.status || error?.statusCode || error?.response?.status;
  if ([408, 409, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }
  const code = error?.code;
  if (['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return true;
  }
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('rate limit') ||
    message.includes('timeout') ||
    message.includes('temporarily') ||
    message.includes('overloaded')
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let firecrawlThrottleQueue = Promise.resolve();
let firecrawlNextRequestAt = 0;
let firecrawlNextJobStartAt = 0;

async function requestEmbeddingsWithRetry(inputs, attempt = 0) {
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: inputs,
    });
    const sorted = [...response.data].sort((a, b) => a.index - b.index);
    return sorted.map((item) => item.embedding);
  } catch (error) {
    if (isPayloadTooLargeError(error) && inputs.length > 1) {
      const midpoint = Math.ceil(inputs.length / 2);
      const first = await requestEmbeddingsWithRetry(inputs.slice(0, midpoint), attempt);
      const second = await requestEmbeddingsWithRetry(inputs.slice(midpoint), attempt);
      return [...first, ...second];
    }

    if (isRetryableOpenAIError(error) && attempt < MAX_EMBEDDING_RETRIES) {
      const delayMs = Math.min(8000, 500 * (2 ** attempt)) + Math.floor(Math.random() * 200);
      await sleep(delayMs);
      return requestEmbeddingsWithRetry(inputs, attempt + 1);
    }

    throw error;
  }
}

async function createEmbeddingsForDocs(docs, options = {}) {
  ensureOpenAIKey();
  const normalizedDocs = Array.isArray(options.normalizedDocs)
    ? options.normalizedDocs
    : normalizeEmbeddingInputs(docs);
  if (!normalizedDocs.length) {
    return [];
  }

  const tokenCounts = Array.isArray(options.tokenCounts) &&
    options.tokenCounts.length === normalizedDocs.length
    ? options.tokenCounts
    : countTokensPerText(normalizedDocs, EMBEDDING_MODEL);

  const batches = [];
  let currentBatch = [];
  let currentTokens = 0;

  normalizedDocs.forEach((doc, index) => {
    const docTokens = tokenCounts[index] || 0;
    const wouldExceedTokens =
      currentBatch.length > 0 && (currentTokens + docTokens) > MAX_EMBEDDING_BATCH_TOKENS;
    const wouldExceedSize = currentBatch.length >= EMBEDDING_BATCH_SIZE;

    if (wouldExceedTokens || wouldExceedSize) {
      batches.push([...currentBatch]);
      currentBatch = [];
      currentTokens = 0;
    }

    currentBatch.push(doc);
    currentTokens += docTokens;
  });

  if (currentBatch.length) {
    batches.push([...currentBatch]);
  }

  const embeddings = [];
  for (const batch of batches) {
    const batchEmbeddings = await requestEmbeddingsWithRetry(batch);
    embeddings.push(...batchEmbeddings);
  }

  return embeddings;
}

function createFirecrawlError(message, options = {}) {
  const error = new Error(message);
  if (options.statusCode !== undefined) {
    error.statusCode = options.statusCode;
  }
  if (options.code) {
    error.code = options.code;
  }
  if (options.details !== undefined) {
    error.details = options.details;
  }
  if (options.jobId) {
    error.jobId = options.jobId;
  }
  if (options.retryAfterMs !== undefined) {
    error.retryAfterMs = options.retryAfterMs;
  }
  return error;
}

function resolveFirecrawlUrl(pathOrUrl) {
  if (typeof pathOrUrl !== 'string' || !pathOrUrl.trim()) {
    return `${FIRECRAWL_API_URL}/v2`;
  }
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl.trim();
  }
  return `${FIRECRAWL_API_URL}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
}

function isFirecrawlJobStartRequest(method, url) {
  if (String(method || 'GET').toUpperCase() !== 'POST') {
    return false;
  }

  const normalizedUrl = resolveFirecrawlUrl(url);
  return normalizedUrl.endsWith('/v2/crawl') || normalizedUrl.endsWith('/v2/batch/scrape');
}

function parseRetryAfterHeaderMs(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const trimmed = value.trim();
  const seconds = Number.parseFloat(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const parsedDate = Date.parse(trimmed);
  if (Number.isFinite(parsedDate)) {
    return Math.max(0, parsedDate - Date.now());
  }

  return null;
}

function parseRetryAfterMessageMs(message) {
  if (typeof message !== 'string' || !message.trim()) {
    return null;
  }

  const retryAfterMatch = message.match(/retry after\s+(\d+)\s*s/i);
  if (retryAfterMatch) {
    const seconds = Number.parseInt(retryAfterMatch[1], 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }

  const resetAtMatch = message.match(/resets at\s+(.+)$/i);
  if (resetAtMatch) {
    const resetAt = Date.parse(resetAtMatch[1].trim());
    if (Number.isFinite(resetAt)) {
      return Math.max(0, resetAt - Date.now());
    }
  }

  return null;
}

function getFirecrawlRetryDelayMs({ response, payload, error, attempt = 0 }) {
  const retryAfterHeader = response?.headers?.get?.('retry-after');
  const headerDelayMs = parseRetryAfterHeaderMs(retryAfterHeader);
  const messageDelayMs = parseRetryAfterMessageMs(
    payload?.message ||
    payload?.error ||
    error?.message,
  );
  const hintedDelayMs = Math.max(headerDelayMs || 0, messageDelayMs || 0);
  const exponentialDelayMs = Math.min(60000, 1000 * (2 ** attempt));
  const baseDelayMs = Math.max(hintedDelayMs, exponentialDelayMs);
  return baseDelayMs + FIRECRAWL_RETRY_DELAY_BUFFER_MS;
}

async function waitForFirecrawlRequestSlot(method, url) {
  const run = firecrawlThrottleQueue.then(async () => {
    const isJobStart = isFirecrawlJobStartRequest(method, url);
    const now = Date.now();
    const waitUntil = Math.max(
      firecrawlNextRequestAt,
      isJobStart ? firecrawlNextJobStartAt : 0,
    );
    const delayMs = Math.max(0, waitUntil - now);

    if (delayMs > 0) {
      await sleep(delayMs);
    }

    const scheduledAt = Date.now();
    firecrawlNextRequestAt = scheduledAt + Math.max(0, FIRECRAWL_MIN_REQUEST_INTERVAL_MS);
    if (isJobStart) {
      firecrawlNextJobStartAt = scheduledAt + Math.max(
        FIRECRAWL_MIN_REQUEST_INTERVAL_MS,
        FIRECRAWL_MIN_JOB_START_INTERVAL_MS,
      );
    }
  });

  firecrawlThrottleQueue = run.catch(() => {});
  await run;
}

function registerFirecrawlRateLimitBackoff(method, url, retryAfterMs) {
  const normalizedRetryAfterMs = Math.max(0, Number.parseInt(String(retryAfterMs || 0), 10) || 0);
  if (normalizedRetryAfterMs <= 0) {
    return;
  }

  const backoffUntil = Date.now() + normalizedRetryAfterMs;
  firecrawlNextRequestAt = Math.max(firecrawlNextRequestAt, backoffUntil);
  if (isFirecrawlJobStartRequest(method, url)) {
    firecrawlNextJobStartAt = Math.max(firecrawlNextJobStartAt, backoffUntil);
  }
}

async function firecrawlRequest(pathOrUrl, options = {}) {
  ensureFirecrawlKey();

  const method = options.method || 'GET';
  const url = resolveFirecrawlUrl(pathOrUrl);

  for (let attempt = 0; attempt <= FIRECRAWL_MAX_RATE_LIMIT_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FIRECRAWL_REQUEST_TIMEOUT_MS);

    try {
      await waitForFirecrawlRequestSlot(method, url);

      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const rawText = await response.text();
      let payload = {};
      if (rawText) {
        try {
          payload = JSON.parse(rawText);
        } catch {
          payload = { message: rawText };
        }
      }

      if (!response.ok || payload?.success === false) {
        const retryAfterMs = response.status === 429
          ? getFirecrawlRetryDelayMs({ response, payload, attempt })
          : undefined;
        const error = createFirecrawlError(
          payload?.error ||
          payload?.message ||
          `Firecrawl request failed with status ${response.status}.`,
          {
            statusCode: response.status || 502,
            code: payload?.code || (response.status === 429 ? 'FIRECRAWL_RATE_LIMIT' : 'FIRECRAWL_ERROR'),
            details: payload?.details ?? payload,
            jobId: payload?.id,
            retryAfterMs,
          },
        );

        if (response.status === 429 && attempt < FIRECRAWL_MAX_RATE_LIMIT_RETRIES) {
          registerFirecrawlRateLimitBackoff(method, url, retryAfterMs);
          await sleep(retryAfterMs);
          continue;
        }

        throw error;
      }

      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw createFirecrawlError(
          `Firecrawl request timed out after ${FIRECRAWL_REQUEST_TIMEOUT_MS} ms.`,
          {
            statusCode: 504,
            code: 'FIRECRAWL_TIMEOUT',
          },
        );
      }

      const normalizedError = normalizeFirecrawlError(error, 'Firecrawl request failed.');
      const shouldRetryRateLimit = normalizedError?.statusCode === 429 &&
        attempt < FIRECRAWL_MAX_RATE_LIMIT_RETRIES;

      if (shouldRetryRateLimit) {
        const retryDelayMs = getFirecrawlRetryDelayMs({
          error: normalizedError,
          attempt,
        });
        registerFirecrawlRateLimitBackoff(method, url, retryDelayMs);
        await sleep(
          retryDelayMs,
        );
        continue;
      }

      throw normalizedError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw createFirecrawlError('Firecrawl request exceeded retry attempts.', {
    statusCode: 429,
    code: 'FIRECRAWL_RATE_LIMIT',
  });
}

async function scrapeUrlWithFirecrawl(url, options = {}) {
  const payload = await firecrawlRequest('/v2/scrape', {
    method: 'POST',
    body: {
      url,
      formats: Array.isArray(options.formats) && options.formats.length > 0
        ? options.formats
        : ['markdown'],
      onlyMainContent: options.onlyMainContent ?? true,
    },
  });

  return payload?.data || {};
}

async function startFirecrawlBatchScrape(urls, options = {}) {
  const payload = await firecrawlRequest('/v2/batch/scrape', {
    method: 'POST',
    body: {
      urls,
      formats: Array.isArray(options.formats) && options.formats.length > 0
        ? options.formats
        : ['markdown'],
      onlyMainContent: options.onlyMainContent ?? true,
    },
  });

  return {
    id: payload?.id,
    url: payload?.url,
    invalidURLs: Array.isArray(payload?.invalidURLs) ? payload.invalidURLs : [],
  };
}

async function getFirecrawlBatchScrapeStatus(jobId) {
  const initialPayload = await firecrawlRequest(`/v2/batch/scrape/${jobId}`);
  const aggregatedData = Array.isArray(initialPayload?.data) ? [...initialPayload.data] : [];
  let nextUrl = typeof initialPayload?.next === 'string' ? initialPayload.next : null;
  let pageCount = 0;

  while (nextUrl && pageCount < FIRECRAWL_MAX_PAGINATION_PAGES) {
    const nextPayload = await firecrawlRequest(nextUrl);
    if (Array.isArray(nextPayload?.data)) {
      aggregatedData.push(...nextPayload.data);
    }
    nextUrl = typeof nextPayload?.next === 'string' ? nextPayload.next : null;
    pageCount += 1;
  }

  return {
    id: jobId,
    status: initialPayload?.status,
    completed: initialPayload?.completed ?? 0,
    total: initialPayload?.total ?? 0,
    creditsUsed: initialPayload?.creditsUsed,
    expiresAt: initialPayload?.expiresAt,
    next: nextUrl,
    data: aggregatedData,
  };
}

async function waitForFirecrawlBatchScrapeCompletion(jobId) {
  const startedAt = Date.now();

  while (true) {
    const job = await getFirecrawlBatchScrapeStatus(jobId);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return job;
    }

    if ((Date.now() - startedAt) > FIRECRAWL_BATCH_TIMEOUT_SECONDS * 1000) {
      const error = new Error(
        `Firecrawl batch scrape job ${jobId} did not complete within ${FIRECRAWL_BATCH_TIMEOUT_SECONDS} seconds.`,
      );
      error.code = 'FIRECRAWL_TIMEOUT';
      error.statusCode = 504;
      error.jobId = jobId;
      throw error;
    }

    await new Promise((resolve) => setTimeout(
      resolve,
      Math.max(1000, FIRECRAWL_BATCH_POLL_INTERVAL_SECONDS * 1000),
    ));
  }
}

async function getFirecrawlBatchScrapeErrors(jobId) {
  try {
    const payload = await firecrawlRequest(`/v2/batch/scrape/${jobId}/errors`);
    const data = isPlainObject(payload?.data) ? payload.data : payload;
    return {
      errors: Array.isArray(data?.errors) ? data.errors : [],
      robotsBlocked: Array.isArray(data?.robotsBlocked) ? data.robotsBlocked : [],
    };
  } catch {
    return { errors: [], robotsBlocked: [] };
  }
}

async function startFirecrawlCrawl({ url, maxDiscoveryDepth, limit }) {
  const payload = await firecrawlRequest('/v2/crawl', {
    method: 'POST',
    body: {
      url,
      limit,
      maxDiscoveryDepth,
      sitemap: 'skip',
      crawlEntireDomain: true,
      allowExternalLinks: false,
      allowSubdomains: false,
      ignoreQueryParameters: true,
      scrapeOptions: {
        formats: ['markdown'],
        onlyMainContent: true,
      },
    },
  });

  return {
    id: payload?.id,
    url: payload?.url,
  };
}

async function getFirecrawlCrawlStatus(jobId) {
  const initialPayload = await firecrawlRequest(`/v2/crawl/${jobId}`);
  const aggregatedData = Array.isArray(initialPayload?.data) ? [...initialPayload.data] : [];
  let nextUrl = typeof initialPayload?.next === 'string' ? initialPayload.next : null;
  let pageCount = 0;

  while (nextUrl && pageCount < FIRECRAWL_MAX_PAGINATION_PAGES) {
    const nextPayload = await firecrawlRequest(nextUrl);
    if (Array.isArray(nextPayload?.data)) {
      aggregatedData.push(...nextPayload.data);
    }
    nextUrl = typeof nextPayload?.next === 'string' ? nextPayload.next : null;
    pageCount += 1;
  }

  return {
    id: jobId,
    status: initialPayload?.status,
    completed: initialPayload?.completed ?? 0,
    total: initialPayload?.total ?? 0,
    creditsUsed: initialPayload?.creditsUsed,
    expiresAt: initialPayload?.expiresAt,
    next: nextUrl,
    data: aggregatedData,
  };
}

async function waitForFirecrawlCrawlCompletion(jobId) {
  const startedAt = Date.now();

  while (true) {
    const job = await getFirecrawlCrawlStatus(jobId);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      return job;
    }

    if ((Date.now() - startedAt) > FIRECRAWL_BATCH_TIMEOUT_SECONDS * 1000) {
      const error = new Error(
        `Firecrawl crawl job ${jobId} did not complete within ${FIRECRAWL_BATCH_TIMEOUT_SECONDS} seconds.`,
      );
      error.code = 'FIRECRAWL_TIMEOUT';
      error.statusCode = 504;
      error.jobId = jobId;
      throw error;
    }

    await new Promise((resolve) => setTimeout(
      resolve,
      Math.max(1000, FIRECRAWL_BATCH_POLL_INTERVAL_SECONDS * 1000),
    ));
  }
}

async function getFirecrawlCrawlErrors(jobId) {
  try {
    const payload = await firecrawlRequest(`/v2/crawl/${jobId}/errors`);
    const data = isPlainObject(payload?.data) ? payload.data : payload;
    return {
      errors: Array.isArray(data?.errors) ? data.errors : [],
      robotsBlocked: Array.isArray(data?.robotsBlocked) ? data.robotsBlocked : [],
    };
  } catch {
    return { errors: [], robotsBlocked: [] };
  }
}

function getFirecrawlCreditsUsedFromJob(job) {
  return normalizeFirecrawlCreditsUsed(
    job?.creditsUsed,
    Array.isArray(job?.data) ? job.data.length : (job?.completed ?? 0),
  );
}

function buildFirecrawlErrorEntry(entry, fallbackUrl = null) {
  return {
    url: normalizeUrlValue(entry?.url) || entry?.url || fallbackUrl || null,
    message: entry?.error || entry?.message || 'Firecrawl failed to crawl URL.',
    code: entry?.code || null,
    job_id: entry?.jobId || entry?.job_id || null,
  };
}

async function batchScrapeUrlsWithFirecrawl(urls, options = {}) {
  const start = await startFirecrawlBatchScrape(urls, options);
  try {
    const job = await waitForFirecrawlBatchScrapeCompletion(start.id);
    const crawlErrors = await getFirecrawlBatchScrapeErrors(start.id);

    return {
      jobId: start.id,
      jobIds: [start.id],
      job,
      crawlErrors,
    };
  } catch (error) {
    const normalizedError = normalizeFirecrawlError(
      error,
      'Failed to crawl URLs with Firecrawl.',
    );
    normalizedError.jobId = normalizedError.jobId || start.id;
    throw normalizedError;
  }
}

async function scrapePrimaryDocumentWithFirecrawl(url) {
  try {
    return await scrapeUrlWithFirecrawl(url, {
      formats: ['markdown', 'links'],
      onlyMainContent: true,
    });
  } catch {
    return null;
  }
}

async function crawlSeedUrlWithFallback(url, { levels, limit }) {
  const genericCrawl = async () => {
    const startedJob = await startFirecrawlCrawl({
      url,
      maxDiscoveryDepth: Math.max(0, levels - 1),
      limit,
    });
    const job = await waitForFirecrawlCrawlCompletion(startedJob.id);
    const errors = await getFirecrawlCrawlErrors(startedJob.id);

    return {
      startedJob,
      job,
      errors,
    };
  };

  if (levels !== 2 || limit <= 1) {
    return genericCrawl();
  }

  const primaryDocument = await scrapePrimaryDocumentWithFirecrawl(url);
  if (!primaryDocument) {
    return genericCrawl();
  }

  const childUrls = selectPrioritizedChildLinks(
    url,
    primaryDocument,
    Math.max(0, limit - 1),
  );

  if (childUrls.length === 0) {
    return genericCrawl();
  }

  try {
    const batchResult = await batchScrapeUrlsWithFirecrawl(childUrls, {
      formats: ['markdown'],
      onlyMainContent: true,
    });
    const childDocuments = Array.isArray(batchResult?.job?.data)
      ? batchResult.job.data
      : [];

    return {
      startedJob: {
        id: batchResult.jobId,
        url,
      },
      job: {
        id: batchResult.jobId,
        status: batchResult?.job?.status || (childDocuments.length > 0 ? 'completed' : 'failed'),
        completed: childDocuments.length + 1,
        total: childDocuments.length + 1,
        creditsUsed: 1 + getFirecrawlCreditsUsedFromJob(batchResult?.job),
        data: [primaryDocument, ...childDocuments],
      },
      errors: batchResult?.crawlErrors || {
        errors: [],
        robotsBlocked: [],
      },
    };
  } catch {
    return genericCrawl();
  }
}

async function deepCrawlUrlsWithFirecrawl(urls, { levels, maxLinks }) {
  const crawlErrors = {
    errors: [],
    robotsBlocked: [],
  };
  const jobs = [];
  const aggregatedDocuments = [];
  let remainingLinks = maxLinks;

  for (let index = 0; index < urls.length && remainingLinks > 0; index += 1) {
    const url = urls[index];
    const remainingSeedUrls = urls.length - index;
    const crawlLimit = levels === 1
      ? 1
      : Math.max(1, Math.ceil(remainingLinks / remainingSeedUrls));
    let startedJob = null;

    try {
      const crawlResult = await crawlSeedUrlWithFallback(url, {
        levels,
        limit: crawlLimit,
      });
      startedJob = crawlResult.startedJob;
      const job = crawlResult.job;
      const errors = crawlResult.errors;
      const creditsUsed = getFirecrawlCreditsUsedFromJob(job);

      remainingLinks = Math.max(0, remainingLinks - creditsUsed);
      jobs.push({
        id: startedJob.id,
        url,
        status: job?.status || null,
        creditsUsed,
        documents: Array.isArray(job?.data) ? job.data : [],
      });

      if (Array.isArray(job?.data) && job.data.length > 0) {
        aggregatedDocuments.push(...job.data);
      }

      if (Array.isArray(errors?.errors)) {
        crawlErrors.errors.push(
          ...errors.errors.map((entry) => buildFirecrawlErrorEntry(entry, url)),
        );
      }
      if (Array.isArray(errors?.robotsBlocked)) {
        crawlErrors.robotsBlocked.push(
          ...errors.robotsBlocked.map((entry) => buildFirecrawlErrorEntry(entry, url)),
        );
      }

      if (job?.status === 'failed' || job?.status === 'cancelled') {
        crawlErrors.errors.push({
          url,
          message: `Firecrawl crawl ${job.status} for seed URL.`,
          code: `FIRECRAWL_${String(job.status).toUpperCase()}`,
          job_id: startedJob.id,
        });
      }
    } catch (error) {
      crawlErrors.errors.push({
        url,
        message: error?.message || 'Firecrawl failed to crawl URL.',
        code: error?.code || 'FIRECRAWL_ERROR',
        job_id: error?.jobId || startedJob?.id || null,
      });
      jobs.push({
        id: error?.jobId || startedJob?.id || null,
        url,
        status: 'failed',
        creditsUsed: 0,
        documents: [],
      });
    }
  }

  return {
    jobId: jobs.length === 1 ? jobs[0]?.id || null : null,
    jobIds: jobs.map((job) => job.id).filter(Boolean),
    job: {
      status: aggregatedDocuments.length > 0 ? 'completed' : 'failed',
      completed: aggregatedDocuments.length,
      total: aggregatedDocuments.length,
      creditsUsed: jobs.reduce(
        (total, job) => total + normalizeFirecrawlCreditsUsed(job?.creditsUsed, 0),
        0,
      ),
      data: aggregatedDocuments,
      jobs,
    },
    crawlErrors,
  };
}

function getFirecrawlDocumentSourceUrl(document, fallbackUrl = null) {
  const candidates = getFirecrawlDocumentUrlCandidates(document, fallbackUrl);
  return candidates[0] || null;
}

function getFirecrawlDocumentUrlCandidates(document, fallbackUrl = null) {
  const metadata = isPlainObject(document?.metadata) ? document.metadata : {};
  const candidates = [
    metadata.sourceURL,
    metadata.sourceUrl,
    metadata.url,
    document?.sourceURL,
    document?.sourceUrl,
    document?.url,
    fallbackUrl,
  ];
  const normalized = [];
  const seen = new Set();

  candidates.forEach((candidate) => {
    const normalizedUrl = normalizeUrlValue(candidate);
    if (!normalizedUrl || seen.has(normalizedUrl)) {
      return;
    }
    seen.add(normalizedUrl);
    normalized.push(normalizedUrl);
  });

  return normalized;
}

function extractFirecrawlDocumentText(document) {
  const markdown = typeof document?.markdown === 'string' ? document.markdown : '';
  if (markdown.trim()) {
    return markdown;
  }

  const summary = typeof document?.summary === 'string' ? document.summary : '';
  if (summary.trim()) {
    return summary;
  }

  const html = typeof document?.html === 'string'
    ? document.html
    : typeof document?.rawHtml === 'string'
      ? document.rawHtml
      : '';
  return stripHtmlToText(html);
}

function buildFirecrawlDocumentSection(document, fallbackUrl = null) {
  const sourceUrl = getFirecrawlDocumentSourceUrl(document, fallbackUrl);
  if (!sourceUrl) {
    return null;
  }

  const metadata = isPlainObject(document?.metadata) ? document.metadata : {};
  const rawText = extractFirecrawlDocumentText(document).trim();
  const title = typeof metadata.title === 'string' ? metadata.title.trim() : '';
  const description = typeof metadata.description === 'string' ? metadata.description.trim() : '';
  const parts = [];

  if (title) {
    parts.push(title);
  }
  if (description && description.toLowerCase() !== title.toLowerCase()) {
    parts.push(description);
  }
  if (rawText) {
    parts.push(rawText);
  }

  const sectionText = parts.join('\n\n').trim();
  if (!sectionText) {
    return null;
  }

  const publishedTime = typeof metadata.publishedTime === 'string'
    ? metadata.publishedTime.trim()
    : '';
  const modifiedTime = typeof metadata.modifiedTime === 'string'
    ? metadata.modifiedTime.trim()
    : '';
  const statusCode = Number(metadata.statusCode);

  return {
    sourceUrl,
    title: title || null,
    description: description || null,
    language: typeof metadata.language === 'string' ? metadata.language.trim() || null : null,
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
    publishedTime: publishedTime || null,
    modifiedTime: modifiedTime || null,
    sectionText,
  };
}

function buildUrlEmbeddingAggregateRecord(seedUrl, documents, primaryDocument = null) {
  const skippedUrlMap = new Map();
  const sections = [];
  const seenUrls = new Set();
  const candidateDocuments = primaryDocument
    ? [primaryDocument, ...documents]
    : [...documents];
  let hasPrimarySection = false;

  candidateDocuments.forEach((document, index) => {
    const fallbackUrl = index === 0 && primaryDocument ? seedUrl : null;
    const section = buildFirecrawlDocumentSection(document, fallbackUrl);
    const resolvedUrl = getFirecrawlDocumentSourceUrl(document, fallbackUrl) || fallbackUrl;
    const matchesSeedUrl = getFirecrawlDocumentUrlCandidates(document, fallbackUrl).includes(seedUrl);

    if (!section) {
      if (resolvedUrl) {
        skippedUrlMap.set(
          resolvedUrl,
          document?.metadata?.error || 'Firecrawl returned no extractable text for the URL.',
        );
      }
      return;
    }

    if (seenUrls.has(section.sourceUrl)) {
      if (matchesSeedUrl) {
        hasPrimarySection = true;
      }
      return;
    }

    seenUrls.add(section.sourceUrl);
    skippedUrlMap.delete(section.sourceUrl);

    if (matchesSeedUrl) {
      hasPrimarySection = true;
      sections.unshift(section);
      return;
    }

    sections.push(section);
  });

  const combinedSectionText = sections.map((section) => section.sectionText).join('\n\n');
  const content = truncateText(cleanEmbeddingSourceText(combinedSectionText));

  if (!content) {
    return {
      record: null,
      processedPageCount: sections.length,
      hasPrimarySection,
      skippedUrlMap,
    };
  }

  const primarySection =
    sections.find((section) => section.sourceUrl === seedUrl) ||
    sections[0] ||
    null;
  const parsedUrl = new URL(seedUrl);

  return {
    record: {
      id: seedUrl,
      source_type: 'url',
      crawl_provider: 'firecrawl',
      url: seedUrl,
      hostname: parsedUrl.hostname,
      pathname: parsedUrl.pathname || '/',
      ...(primarySection?.title ? { title: primarySection.title } : {}),
      ...(primarySection?.description ? { description: primarySection.description } : {}),
      ...(primarySection?.language ? { language: primarySection.language } : {}),
      status_code: primarySection?.statusCode ?? null,
      content_length: content.length,
      published_time: primarySection?.publishedTime ?? null,
      modified_time: primarySection?.modifiedTime ?? null,
      content,
    },
    processedPageCount: sections.length,
    hasPrimarySection,
    skippedUrlMap,
  };
}

function buildSeedDocumentsMap(normalizedUrls, crawlLevels, job) {
  const map = new Map(normalizedUrls.map((url) => [url, []]));

  if (crawlLevels === 1) {
    const documents = Array.isArray(job?.data) ? job.data : [];
    documents.forEach((document, index) => {
      const fallbackUrl = normalizedUrls[index] || null;
      const matchedSeedUrl = normalizedUrls.find((url) =>
        getFirecrawlDocumentUrlCandidates(document, fallbackUrl).includes(url)
      ) || fallbackUrl;
      if (!matchedSeedUrl || !map.has(matchedSeedUrl)) {
        return;
      }
      map.get(matchedSeedUrl).push(document);
    });
    return map;
  }

  const jobs = Array.isArray(job?.jobs) ? job.jobs : [];
  jobs.forEach((entry) => {
    const seedUrl = normalizeUrlValue(entry?.url);
    if (!seedUrl || !map.has(seedUrl)) {
      return;
    }
    map.set(seedUrl, Array.isArray(entry?.documents) ? entry.documents : []);
  });

  if (
    normalizedUrls.length === 1 &&
    Array.isArray(job?.data) &&
    job.data.length > 0 &&
    (map.get(normalizedUrls[0]) || []).length === 0
  ) {
    map.set(normalizedUrls[0], job.data);
  }

  return map;
}

function normalizeFirecrawlError(error, fallbackMessage) {
  if (error?.statusCode || error?.status) {
    return error;
  }

  const normalized = new Error(error?.message || fallbackMessage);
  normalized.statusCode = 502;
  normalized.code = error?.code || 'FIRECRAWL_ERROR';
  if (error?.jobId) {
    normalized.jobId = error.jobId;
  }
  return normalized;
}

async function crawlUrlsWithFirecrawl(urls, { levels, maxLinks } = {}) {
  const normalizedLevels = normalizeUrlCrawlLevels(levels);
  const normalizedMaxLinks = Math.max(
    1,
    Math.min(
      MAX_URL_CRAWL_LINKS_PER_REQUEST,
      Number.parseInt(String(maxLinks || MAX_URL_CRAWL_LINKS_PER_REQUEST), 10) || MAX_URL_CRAWL_LINKS_PER_REQUEST,
    ),
  );

  if (normalizedLevels === 1) {
    return batchScrapeUrlsWithFirecrawl(urls);
  }

  return deepCrawlUrlsWithFirecrawl(urls, {
    levels: normalizedLevels,
    maxLinks: normalizedMaxLinks,
  });
}

function buildSearchDocPayloads(records, structuredFields, options = {}) {
  const isFieldSearchable = typeof options.isFieldSearchable === 'function'
    ? options.isFieldSearchable
    : null;
  const applySearchableFilter = options.applySearchableFilter === true;
  const payloads = [];
  records.forEach((record) => {
    if (!record || typeof record !== 'object') {
      return;
    }
    const rawRecord = record._raw ?? record;
    const storedRawRecord = record._rawStored ?? rawRecord;
    const flatRecord = record._flat && typeof record._flat === 'object' ? record._flat : {};
    let searchDoc = buildSearchDocument(flatRecord, { isFieldSearchable });
    if (!searchDoc && !applySearchableFilter) {
      searchDoc = safeStringify(rawRecord);
    }
    if (!searchDoc) {
      return;
    }
    const recordId = extractRecordId(rawRecord) || generateRecordId();
    const structuredFilters = buildStructuredFilters(flatRecord, structuredFields);
    const storedStructuredFilters = nestStructuredFilters(structuredFilters);
    payloads.push({
      sourceId: recordId,
      searchDoc,
      structuredFilters: storedStructuredFilters,
      raw: storedRawRecord,
    });
  });
  return payloads;
}

function dedupePayloads(payloads) {
  const seen = new Set();
  return payloads.filter((payload) => {
    if (seen.has(payload.sourceId)) {
      return false;
    }
    seen.add(payload.sourceId);
    return true;
  });
}

function attachFlattenedRecords(records, flattenedRecords, storedRecords = null) {
  return records.map((record, index) => ({
    _raw: record,
    _rawStored: storedRecords ? storedRecords[index] : undefined,
    _flat: flattenedRecords[index] || {},
  }));
}

function mergeTemplateSchema(template, analysis, options = {}) {
  const isFieldFilterable = typeof options.isFieldFilterable === 'function'
    ? options.isFieldFilterable
    : null;
  const isFieldSearchable = typeof options.isFieldSearchable === 'function'
    ? options.isFieldSearchable
    : null;
  const structuredMap = new Map(
    (template.structuredFields || [])
      .filter((field) => !isFieldFilterable || isFieldFilterable(field.key))
      .map((field) => [field.key, field]),
  );
  const unstructuredSet = new Set(
    (template.unstructuredFields || [])
      .filter((field) => !isFieldSearchable || isFieldSearchable(field)),
  );

  analysis.structuredFields.forEach((field) => {
    if (isFieldFilterable && !isFieldFilterable(field.key)) {
      return;
    }
    if (structuredMap.has(field.key)) {
      const existing = structuredMap.get(field.key);
      const mergedSamples = [...(existing.sampleValues || [])];
      (field.sampleValues || []).forEach((value) => {
        if (mergedSamples.length >= 50) {
          return;
        }
        if (!mergedSamples.includes(value)) {
          mergedSamples.push(value);
        }
      });
      structuredMap.set(field.key, {
        ...existing,
        type: existing.type || field.type,
        sampleValues: mergedSamples,
        stats: field.stats || existing.stats,
      });
    } else {
      structuredMap.set(field.key, field);
    }
    unstructuredSet.delete(field.key);
  });

  analysis.unstructuredFields.forEach((field) => {
    if (isFieldSearchable && !isFieldSearchable(field)) {
      return;
    }
    if (!structuredMap.has(field)) {
      unstructuredSet.add(field);
    }
  });

  return {
    structuredFields: [...structuredMap.values()],
    unstructuredFields: [...unstructuredSet.values()],
  };
}

async function createEmbeddingsFromRecords({
  userId,
  externalUser = null,
  name,
  records,
  fieldOptions,
  ttlMinutes = null,
  pricingMultiplier = DEFAULT_EMBEDDING_PRICING_MULTIPLIER,
  billingMetadata = null,
}) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error('records must be a non-empty array');
  }

  const resolvedInputType = typeof billingMetadata?.inputType === 'string' &&
    billingMetadata.inputType.trim()
    ? billingMetadata.inputType.trim()
    : 'json';
  const extraBillingMetadata = billingMetadata && typeof billingMetadata === 'object'
    ? { ...billingMetadata }
    : null;
  if (extraBillingMetadata && Object.prototype.hasOwnProperty.call(extraBillingMetadata, 'inputType')) {
    delete extraBillingMetadata.inputType;
  }

  const normalizedFieldOptions = normalizeFieldOptions(fieldOptions);
  const normalizedTtlMinutes = normalizeEmbeddingTtlMinutes(ttlMinutes);
  const expiresAt = resolveEmbeddingExpiration(normalizedTtlMinutes);
  const { records: unwrappedRecords, fieldOptions: derivedFieldOptions } = unwrapRecords(
    records,
    true,
  );
  const resolvedFieldOptions = hasFieldOptions(normalizedFieldOptions)
    ? mergeFieldOptionsMap(normalizedFieldOptions, derivedFieldOptions)
    : hasFieldOptions(derivedFieldOptions)
      ? derivedFieldOptions
      : {};

  const normalizedRecords = normalizeEmbeddingRecords(unwrappedRecords);
  if (normalizedRecords.length === 0) {
    throw new Error('records must contain objects');
  }

  await getDBConnectionString();

  const isFieldSearchable = createFieldPredicate(resolvedFieldOptions, 'searchable');
  const isFieldFilterable = createFieldPredicate(resolvedFieldOptions, 'filterable');
  const applySearchableFilter = hasFlagValue(resolvedFieldOptions, 'searchable', false);
  const applyRetrievableFilter = hasFlagValue(resolvedFieldOptions, 'retrievable', false);
  const analysis = analyzeRecords(normalizedRecords, {
    includeField: (key) => isFieldSearchable(key) || isFieldFilterable(key),
    isFieldSearchable,
    isFieldFilterable,
  });
  const schemaFingerprint = createSchemaFingerprint(
    analysis.structuredFields,
    analysis.unstructuredFields,
  );
  const templateHash = createTemplateHash(schemaFingerprint);
  const storedRecords = applyRetrievableFilter
    ? normalizedRecords.map((record) =>
        pruneRecordByFlag(record, resolvedFieldOptions, 'retrievable'),
      )
    : normalizedRecords;
  const enrichedRecords = attachFlattenedRecords(
    normalizedRecords,
    analysis.flattenedRecords,
    storedRecords,
  );
  const payloads = dedupePayloads(
    buildSearchDocPayloads(enrichedRecords, analysis.structuredFields, {
      isFieldSearchable,
      applySearchableFilter,
    }),
  );
  const docs = payloads.map((payload) => payload.searchDoc);
  const { normalized: normalizedDocs, tokenCount, tokenCounts } = prepareEmbeddingInputs(docs);
  let creditsCharged = 0;
  let remainingCredits = null;
  let charged = false;

  try {
    const billing = await chargeEmbeddingTokens({
      userId,
      externalUser,
      tokenCount,
      source: 'embedding_create',
      operation: 'create',
      pricingMultiplier,
      inputType: resolvedInputType,
      extraMetadata: extraBillingMetadata,
      countAsRequest: Boolean(externalUser?._id),
    });
    creditsCharged = billing.creditsCharged;
    remainingCredits = billing.remainingCredits;
    charged = true;
  } catch (error) {
    throw error;
  }

  let template = null;
  let embeddings;
  try {
    template = await EmbeddingTemplate.create({
      userId,
      name: name || null,
      hash: templateHash,
      hashLink: `embedding_template:${templateHash}`,
      structuredFields: analysis.structuredFields,
      unstructuredFields: analysis.unstructuredFields,
      fieldOptions: resolvedFieldOptions,
      schemaFingerprint,
      embeddingModel: EMBEDDING_MODEL,
      vectorIndex: DEFAULT_VECTOR_INDEX,
      recordCount: normalizedRecords.length,
      ttlMinutes: normalizedTtlMinutes,
      expiresAt,
    });
    embeddings = await createEmbeddingsForDocs(normalizedDocs, {
      normalizedDocs,
      tokenCounts,
    });
  } catch (error) {
    if (charged) {
      await refundEmbeddingTokens({
        userId,
        externalUser,
        tokenCount,
        source: 'embedding_create_refund',
        operation: 'create',
        pricingMultiplier,
        inputType: resolvedInputType,
        extraMetadata: extraBillingMetadata,
      });
    }
    throw error;
  }

  const embeddingRecords = payloads.map((payload, index) => ({
    templateId: template._id.toString(),
    templateHash: templateHash,
    userId,
    sourceId: payload.sourceId,
    searchDoc: payload.searchDoc,
    structuredFilters: payload.structuredFilters,
    raw: payload.raw,
    embeddingModel: EMBEDDING_MODEL,
    embedding: embeddings[index],
    expiresAt,
  }));

  const inserted = embeddingRecords.length > 0
    ? await EmbeddingRecord.insertMany(embeddingRecords, { ordered: false })
    : [];
  await EmbeddingTemplate.findByIdAndUpdate(template._id, {
    recordCount: inserted.length,
  });

  return {
    templateId: template._id.toString(),
    templateHash,
    hashLink: template.hashLink,
    structuredFields: analysis.structuredFields,
    unstructuredFields: analysis.unstructuredFields,
    recordCount: inserted.length,
    ttlMinutes: normalizedTtlMinutes,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    creditsCharged,
    remainingCredits,
    inputTokens: tokenCount,
  };
}

export async function createEmbeddingsFromJsonArray({
  userId,
  name,
  records,
  fieldOptions,
  ttlMinutes = null,
}) {
  return createEmbeddingsFromRecords({
    userId,
    name,
    records,
    fieldOptions,
    ttlMinutes,
  });
}

export async function createEmbeddingsFromPlainText({
  userId,
  externalUser = null,
  name,
  plainTextData,
  fieldOptions,
  ttlMinutes = null,
}) {
  const records = normalizePlainTextRecords(plainTextData);
  const resolvedFieldOptions = mergeFieldOptionsMap(
    getDefaultPlainTextEmbeddingFieldOptions(),
    normalizeFieldOptions(fieldOptions),
  );

  return createEmbeddingsFromRecords({
    userId,
    externalUser,
    name,
    records,
    fieldOptions: resolvedFieldOptions,
    ttlMinutes,
    pricingMultiplier: PLAIN_TEXT_EMBEDDING_PRICING_MULTIPLIER,
    billingMetadata: {
      inputType: 'plain_text',
      sourceType: 'plain_text',
      inputRecordCount: records.length,
    },
  });
}

export async function createEmbeddingsFromUrls({
  userId,
  name,
  urls,
  fieldOptions,
  levels,
  ttlMinutes = null,
}) {
  const normalizedTtlMinutes = normalizeEmbeddingTtlMinutes(ttlMinutes);
  const normalizedUrls = normalizeUrlList(urls);
  const crawlLevels = normalizeUrlCrawlLevels(levels);
  if (normalizedUrls.length > MAX_URL_SEEDS_PER_REQUEST) {
    const error = new Error(
      `urls may contain at most ${MAX_URL_SEEDS_PER_REQUEST} seed URLs per request.`,
    );
    error.statusCode = 400;
    throw error;
  }

  const estimatedFirecrawlCredits = crawlLevels === 1
    ? normalizedUrls.length * FIRECRAWL_CREDITS_PER_URL
    : MAX_URL_CRAWL_LINKS_PER_REQUEST * FIRECRAWL_CREDITS_PER_URL;
  let crawlCreditsCharged = 0;
  let remainingCredits = null;
  let crawlJobId = null;
  let crawlJobIds = [];

  const initialCrawlCharge = await chargeUrlCrawlCredits({
    userId,
    urlCount: normalizedUrls.length,
    firecrawlCreditsUsed: estimatedFirecrawlCredits,
    source: 'embedding_create',
    phase: 'crawl_estimate',
    extraMetadata: {
      crawlLevels,
      maxLinks: MAX_URL_CRAWL_LINKS_PER_REQUEST,
    },
  });
  crawlCreditsCharged = initialCrawlCharge.creditsCharged;
  remainingCredits = initialCrawlCharge.remainingCredits;

  let crawlResult;
  try {
    crawlResult = await crawlUrlsWithFirecrawl(normalizedUrls, {
      levels: crawlLevels,
      maxLinks: MAX_URL_CRAWL_LINKS_PER_REQUEST,
    });
    crawlJobId = crawlResult.jobId;
    crawlJobIds = Array.isArray(crawlResult.jobIds) ? crawlResult.jobIds : [];
  } catch (error) {
    const normalizedError = normalizeFirecrawlError(
      error,
      'Failed to crawl URLs with Firecrawl.',
    );
    if (!normalizedError.jobId && estimatedFirecrawlCredits > 0) {
      const refund = await refundUrlCrawlCredits({
        userId,
        urlCount: normalizedUrls.length,
        firecrawlCreditsUsed: estimatedFirecrawlCredits,
        source: 'embedding_create_refund',
        phase: 'crawl_start_failed',
        extraMetadata: {
          crawlLevels,
          maxLinks: MAX_URL_CRAWL_LINKS_PER_REQUEST,
        },
      });
      crawlCreditsCharged -= refund.creditsRefunded || 0;
      remainingCredits = refund.remainingCredits ?? remainingCredits;
    }
    throw normalizedError;
  }

  const { job, crawlErrors } = crawlResult;
  let firecrawlCreditsUsed = normalizeFirecrawlCreditsUsed(
    job?.creditsUsed,
    estimatedFirecrawlCredits,
  );

  const crawlErrorList = [];
  const appendCrawlErrors = (errorGroup) => {
    if (!Array.isArray(errorGroup?.errors)) {
      return;
    }
    errorGroup.errors.forEach((entry) => {
      const resolvedUrl = normalizeUrlValue(entry?.url) || entry?.url || null;
      crawlErrorList.push({
        url: resolvedUrl,
        message: entry?.error || entry?.message || 'Firecrawl failed to crawl URL.',
        code: entry?.code || null,
      });
    });
  };
  appendCrawlErrors(crawlErrors);
  const seedDocumentsMap = buildSeedDocumentsMap(normalizedUrls, crawlLevels, job);
  const aggregateBuildResults = new Map();

  normalizedUrls.forEach((seedUrl) => {
    aggregateBuildResults.set(
      seedUrl,
      buildUrlEmbeddingAggregateRecord(seedUrl, seedDocumentsMap.get(seedUrl) || []),
    );
  });

  const missingSeedUrls = normalizedUrls.filter(
    (url) => !aggregateBuildResults.get(url)?.hasPrimarySection,
  );

  if (missingSeedUrls.length > 0) {
    try {
      const seedScrapeResult = await batchScrapeUrlsWithFirecrawl(missingSeedUrls);
      const seedScrapeJobIds = Array.isArray(seedScrapeResult?.jobIds)
        ? seedScrapeResult.jobIds.filter(Boolean)
        : [];
      if (seedScrapeJobIds.length > 0) {
        crawlJobIds = Array.from(new Set([...crawlJobIds, ...seedScrapeJobIds]));
        crawlJobId = crawlJobIds.length === 1 ? crawlJobIds[0] : crawlJobId;
      }
      firecrawlCreditsUsed += getFirecrawlCreditsUsedFromJob(seedScrapeResult?.job);
      appendCrawlErrors(seedScrapeResult?.crawlErrors);

      const seedScrapeDocuments = Array.isArray(seedScrapeResult?.job?.data)
        ? seedScrapeResult.job.data
        : [];
      const seedScrapeDocumentMap = buildSeedDocumentsMap(
        missingSeedUrls,
        1,
        { data: seedScrapeDocuments },
      );

      missingSeedUrls.forEach((seedUrl) => {
        const primaryDocument = (seedScrapeDocumentMap.get(seedUrl) || [])[0] || null;
        aggregateBuildResults.set(
          seedUrl,
          buildUrlEmbeddingAggregateRecord(
            seedUrl,
            seedDocumentsMap.get(seedUrl) || [],
            primaryDocument,
          ),
        );
      });
    } catch (error) {
      missingSeedUrls.forEach((url) => {
        crawlErrorList.push({
          url,
          message: error?.message || 'Failed to scrape the seed URL with Firecrawl.',
          code: error?.code || 'FIRECRAWL_SEED_SCRAPE_FAILED',
        });
      });
    }
  }

  const crawlCreditDelta = firecrawlCreditsUsed - estimatedFirecrawlCredits;
  if (crawlCreditDelta > 0) {
    const extraCharge = await chargeUrlCrawlCredits({
      userId,
      urlCount: normalizedUrls.length,
      firecrawlCreditsUsed: crawlCreditDelta,
      source: 'embedding_create',
      phase: 'crawl_adjustment',
      jobId: crawlJobId,
      extraMetadata: {
        crawlLevels,
        maxLinks: MAX_URL_CRAWL_LINKS_PER_REQUEST,
        ...(crawlJobIds.length > 1 ? { jobIds: crawlJobIds } : {}),
      },
    });
    crawlCreditsCharged += extraCharge.creditsCharged;
    remainingCredits = extraCharge.remainingCredits ?? remainingCredits;
  } else if (crawlCreditDelta < 0) {
    const refund = await refundUrlCrawlCredits({
      userId,
      urlCount: normalizedUrls.length,
      firecrawlCreditsUsed: Math.abs(crawlCreditDelta),
      source: 'embedding_create_refund',
      phase: 'crawl_adjustment_refund',
      jobId: crawlJobId,
      extraMetadata: {
        crawlLevels,
        maxLinks: MAX_URL_CRAWL_LINKS_PER_REQUEST,
        ...(crawlJobIds.length > 1 ? { jobIds: crawlJobIds } : {}),
      },
    });
    crawlCreditsCharged -= refund.creditsRefunded || 0;
    remainingCredits = refund.remainingCredits ?? remainingCredits;
  }

  const skippedUrlMap = new Map(
    crawlErrorList
      .filter((entry) => entry.url)
      .map((entry) => [entry.url, entry.message]),
  );
  const records = [];
  let processedUrlCount = 0;

  normalizedUrls.forEach((url) => {
    const buildResult = aggregateBuildResults.get(url);
    if (!buildResult) {
      return;
    }

    buildResult.skippedUrlMap.forEach((message, skippedUrl) => {
      skippedUrlMap.set(skippedUrl, message);
    });

    if (buildResult.hasPrimarySection) {
      skippedUrlMap.delete(url);
    } else if (!skippedUrlMap.has(url)) {
      skippedUrlMap.set(
        url,
        'Firecrawl did not return extractable text for the source URL.',
      );
    }

    if (buildResult.record) {
      records.push(buildResult.record);
      processedUrlCount += buildResult.processedPageCount;
    }
  });

  const skippedUrls = Array.from(skippedUrlMap.entries()).map(([url, message]) => ({
    url,
    message,
  }));

  if (job?.status === 'failed' || job?.status === 'cancelled') {
    const error = new Error(
      crawlErrorList[0]?.message || `Firecrawl URL crawl ${job.status}.`,
    );
    error.statusCode = 502;
    error.code = 'FIRECRAWL_CRAWL_FAILED';
    error.jobId = crawlJobId;
    error.details = {
      firecrawl_job_id: crawlJobId,
      firecrawl_job_ids: crawlJobIds,
      crawl_errors: crawlErrorList,
      skipped_urls: skippedUrls,
    };
    throw error;
  }

  if (records.length === 0) {
    const error = new Error(
      crawlErrorList[0]?.message ||
      'Firecrawl returned no extractable text for the provided URLs.',
    );
    error.statusCode = 422;
    error.code = 'NO_URL_CONTENT';
    error.details = {
      firecrawl_job_id: crawlJobId,
      crawl_errors: crawlErrorList,
      skipped_urls: skippedUrls,
    };
    throw error;
  }

  const resolvedFieldOptions = mergeFieldOptionsMap(
    getDefaultUrlEmbeddingFieldOptions(),
    normalizeFieldOptions(fieldOptions),
  );
  const result = await createEmbeddingsFromRecords({
    userId,
    name,
    records,
    fieldOptions: resolvedFieldOptions,
    ttlMinutes: normalizedTtlMinutes,
    pricingMultiplier: URL_EMBEDDING_PRICING_MULTIPLIER,
    billingMetadata: {
      inputType: 'url',
      provider: 'firecrawl',
      urlCount: normalizedUrls.length,
      crawlLevels,
      maxLinks: MAX_URL_CRAWL_LINKS_PER_REQUEST,
      firecrawlCreditsUsed,
      firecrawlUsdPerCredit: FIRECRAWL_USD_PER_CREDIT,
      firecrawlCostUsd: calculateFirecrawlCostUsd(firecrawlCreditsUsed),
      firecrawlJobId: crawlJobId,
      ...(crawlJobIds.length > 1 ? { firecrawlJobIds: crawlJobIds } : {}),
    },
  });

  return {
    ...result,
    creditsCharged: crawlCreditsCharged + result.creditsCharged,
    remainingCredits: result.remainingCredits ?? remainingCredits,
    inputUrlCount: normalizedUrls.length,
    processedUrlCount,
    crawlLevels,
    maxLinks: MAX_URL_CRAWL_LINKS_PER_REQUEST,
    firecrawlCreditsUsed,
    firecrawlJobId: crawlJobId,
    firecrawlJobIds: crawlJobIds,
    skippedUrls,
    crawlErrors: crawlErrorList,
  };
}

export async function updateEmbeddingsForTemplate({
  userId,
  templateId,
  records,
  fieldOptions,
}) {
  let stage = 'validate_request';
  try {
    if (!templateId || typeof templateId !== 'string') {
      throw new Error('template_id is required');
    }
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('records must be a non-empty array');
    }

    stage = 'normalize_records';
    const normalizedFieldOptions = normalizeFieldOptions(fieldOptions);
    const { records: unwrappedRecords, fieldOptions: derivedFieldOptions } = unwrapRecords(
      records,
      true,
    );
    const normalizedRecords = normalizeEmbeddingRecords(unwrappedRecords);
    if (normalizedRecords.length === 0) {
      throw new Error('records must contain objects');
    }

    stage = 'resolve_template';
    await getDBConnectionString();
    const resolvedTemplate = await resolveEmbeddingTemplate({ userId, templateId });

    if (!resolvedTemplate) {
      const error = new Error('Embedding template not found');
      error.statusCode = 404;
      throw error;
    }
    const { template } = resolvedTemplate;
    const resolvedTemplateId = resolvedTemplate.templateId;
    const templateExpiresAt = normalizeDateValue(template.expiresAt);

    stage = 'analyze_records';
    const templateFieldOptions = normalizeFieldOptions(template.fieldOptions);
    const resolvedFieldOptions = hasFieldOptions(normalizedFieldOptions)
      ? mergeFieldOptionsMap(normalizedFieldOptions, derivedFieldOptions)
      : hasFieldOptions(templateFieldOptions)
        ? mergeFieldOptionsMap(templateFieldOptions, derivedFieldOptions)
        : hasFieldOptions(derivedFieldOptions)
          ? derivedFieldOptions
          : templateFieldOptions;
    const isFieldSearchable = createFieldPredicate(resolvedFieldOptions, 'searchable');
    const isFieldFilterable = createFieldPredicate(resolvedFieldOptions, 'filterable');
    const applySearchableFilter = hasFlagValue(resolvedFieldOptions, 'searchable', false);
    const applyRetrievableFilter = hasFlagValue(resolvedFieldOptions, 'retrievable', false);
    const analysis = analyzeRecords(normalizedRecords, {
      includeField: (key) => isFieldSearchable(key) || isFieldFilterable(key),
      isFieldSearchable,
      isFieldFilterable,
    });
    stage = 'merge_schema';
    const merged = mergeTemplateSchema(template, analysis, {
      isFieldSearchable,
      isFieldFilterable,
    });
    const schemaFingerprint = createSchemaFingerprint(
      merged.structuredFields,
      merged.unstructuredFields,
    );
    const templateHash = createTemplateHash(schemaFingerprint);

    stage = 'build_payloads';
    const storedRecords = applyRetrievableFilter
      ? normalizedRecords.map((record) =>
          pruneRecordByFlag(record, resolvedFieldOptions, 'retrievable'),
        )
      : normalizedRecords;
    const enrichedRecords = attachFlattenedRecords(
      normalizedRecords,
      analysis.flattenedRecords,
      storedRecords,
    );
    const payloads = dedupePayloads(
      buildSearchDocPayloads(enrichedRecords, merged.structuredFields, {
        isFieldSearchable,
        applySearchableFilter,
      }),
    );
    const docs = payloads.map((payload) => payload.searchDoc);
    const { normalized: normalizedDocs, tokenCount, tokenCounts } = prepareEmbeddingInputs(docs);
    let creditsCharged = 0;
    let remainingCredits = null;
    let charged = false;

    stage = 'charge_tokens';
    try {
      const billing = await chargeEmbeddingTokens({
        userId,
        tokenCount,
        source: 'embedding_update',
        operation: 'update',
      });
      creditsCharged = billing.creditsCharged;
      remainingCredits = billing.remainingCredits;
      charged = true;
    } catch (error) {
      throw error;
    }

    stage = 'create_embeddings';
    let embeddings;
    try {
      embeddings = await createEmbeddingsForDocs(normalizedDocs, {
        normalizedDocs,
        tokenCounts,
      });
    } catch (error) {
      if (charged) {
        await refundEmbeddingTokens({
          userId,
          tokenCount,
          source: 'embedding_update_refund',
          operation: 'update',
        });
      }
      throw error;
    }

    stage = 'upsert_records';
    const embeddingRecords = payloads.map((payload, index) => ({
      templateId: resolvedTemplateId,
      templateHash,
      userId,
      sourceId: payload.sourceId,
      searchDoc: payload.searchDoc,
      structuredFilters: payload.structuredFilters,
      raw: payload.raw,
      embeddingModel: EMBEDDING_MODEL,
      embedding: embeddings[index],
      expiresAt: templateExpiresAt,
    }));

    if (embeddingRecords.length > 0) {
      const sourceIds = embeddingRecords.map((record) => record.sourceId);
      const deleteResult = await EmbeddingRecord.deleteMany({
        templateId: resolvedTemplateId,
        sourceId: { $in: sourceIds },
      });
      await EmbeddingRecord.insertMany(embeddingRecords, { ordered: false });
    }

    stage = 'update_template';
    const recordCount = await EmbeddingRecord.countDocuments({ templateId: resolvedTemplateId });
    await EmbeddingTemplate.findByIdAndUpdate(resolvedTemplateId, {
      structuredFields: merged.structuredFields,
      unstructuredFields: merged.unstructuredFields,
      fieldOptions: resolvedFieldOptions,
      schemaFingerprint,
      hash: templateHash,
      hashLink: `embedding_template:${templateHash}`,
      recordCount,
    });

    stage = 'complete';
    return {
      templateId: resolvedTemplateId,
      templateHash,
      recordCount,
      structuredFields: merged.structuredFields,
      unstructuredFields: merged.unstructuredFields,
      creditsCharged,
      remainingCredits,
      inputTokens: tokenCount,
    };
  } catch (error) {
    throw error;
  }
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (!normA || !normB) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function performVectorSearch({
  templateId,
  userId,
  queryVector,
  limit,
  numCandidates,
  structuredFilterQuery,
  vectorIndex,
}) {
  const filterQuery = {
    templateId,
    userId,
    ...structuredFilterQuery,
  };

  const pipeline = [
    {
      $vectorSearch: {
        index: vectorIndex || DEFAULT_VECTOR_INDEX,
        queryVector,
        path: 'embedding',
        numCandidates,
        limit,
        filter: filterQuery,
      },
    },
    {
      $project: {
        sourceId: 1,
        searchDoc: 1,
        structuredFilters: 1,
        raw: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ];

  try {
    return await EmbeddingRecord.aggregate(pipeline);
  } catch (error) {
    const records = await EmbeddingRecord.find(filterQuery, {
      sourceId: 1,
      searchDoc: 1,
      structuredFilters: 1,
      raw: 1,
      embedding: 1,
    }).lean();

    const scored = records.map((record) => ({
      sourceId: record.sourceId,
      searchDoc: record.searchDoc,
      structuredFilters: record.structuredFilters,
      raw: record.raw,
      score: cosineSimilarity(queryVector, record.embedding),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}

async function rerankResultsWithLLM(query, results) {
  if (!query || !results.length) {
    return results;
  }

  ensureOpenAIKey();

  const candidates = results.slice(0, RERANK_LIMIT).map((result, index) => ({
    index,
    id: result.sourceId,
    text: truncateText(result.searchDoc || '', 400),
  }));

  const messages = [
    {
      role: 'system',
      content:
        'You rank candidates by relevance to a query. Return only a JSON array of ids in best-to-worst order.',
    },
    {
      role: 'user',
      content: `Query: ${query}\nCandidates:\n${JSON.stringify(candidates)}`,
    },
  ];

  try {
    const response = await openai.chat.completions.create({
      model: RERANK_MODEL,
      messages,
      temperature: 0,
    });
    const content = response?.choices?.[0]?.message?.content || '';
    const parsedIds = extractJsonArray(content);
    if (!Array.isArray(parsedIds) || parsedIds.length === 0) {
      return results;
    }
    const order = new Map(parsedIds.map((id, idx) => [String(id), idx]));
    const reranked = [...results].sort((a, b) => {
      const aIdx = order.has(String(a.sourceId)) ? order.get(String(a.sourceId)) : Number.MAX_SAFE_INTEGER;
      const bIdx = order.has(String(b.sourceId)) ? order.get(String(b.sourceId)) : Number.MAX_SAFE_INTEGER;
      return aIdx - bIdx;
    });
    return reranked;
  } catch {
    return results;
  }
}

function extractJsonArray(content) {
  if (!content || typeof content !== 'string') {
    return null;
  }
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export async function searchEmbeddings({
  userId,
  templateId,
  searchTerm,
  searchRecord,
  searchDate,
  filterConfig,
  limit = 10,
  minResults,
  numCandidates = 50,
  structuredFilters,
  filterPayload,
  rerank = false,
  includeRaw = true,
  billingSource = 'embedding_search',
  billingOperation = 'search',
  useStrictFilters = true,
  applyFilterWeighting = true,
}) {
  await getDBConnectionString();
  const resolvedTemplate = await resolveEmbeddingTemplate({ userId, templateId });

  if (!resolvedTemplate) {
    const error = new Error('Embedding template not found');
    error.statusCode = 404;
    throw error;
  }
  const { template } = resolvedTemplate;
  const resolvedTemplateId = resolvedTemplate.templateId;

  const templateFieldOptions = normalizeFieldOptions(template.fieldOptions);
  const isFieldSearchable = createFieldPredicate(templateFieldOptions, 'searchable');
  const applySearchableFilter = hasFlagValue(templateFieldOptions, 'searchable', false);
  const normalizedFilterConfig = normalizeFilterConfig(filterConfig);
  const availabilityConfig = resolveAvailabilityConfig(
    template.structuredFields || [],
    normalizedFilterConfig,
  );
  const softFilterKeys = resolveSoftFilterKeys(normalizedFilterConfig, templateFieldOptions);
  const normalizedSearchDate = normalizeSearchDate(searchDate);
  const searchDateIso = normalizedSearchDate ? normalizedSearchDate.toISOString() : null;
  const searchDateKey = normalizedSearchDate ? normalizedSearchDate.toISOString().slice(0, 10) : null;
  const availabilityDateKeyField = availabilityConfig?.dateKeyField || null;
  const availabilityDateFilterValues = dedupeStringList(
    [searchDateIso, searchDateKey].filter((value) => typeof value === 'string' && value.trim().length > 0),
  );
  const availabilityDateFilter = availabilityDateKeyField && availabilityDateFilterValues.length > 0
    ? { [availabilityDateKeyField]: availabilityDateFilterValues }
    : null;
  const validatedFilterPayload = normalizeFilterPayload(filterPayload, template.structuredFields || []);
  const mergedExplicitFilters = validatedFilterPayload
    ? structuredFilters && typeof structuredFilters === 'object' && !Array.isArray(structuredFilters)
      ? { ...validatedFilterPayload, ...structuredFilters }
      : validatedFilterPayload
    : structuredFilters;
  const cleanedExplicitFilters = searchDateIso
    ? stripAvailabilityFilters(mergedExplicitFilters, availabilityConfig, { removeDateKeys: true })
    : mergedExplicitFilters;
  const effectiveExplicitFilters = cleanedExplicitFilters;
  const recordSearch = searchRecord
    ? buildSearchInputFromRecord(
        unwrapRecordValue(searchRecord, '', null),
        template.structuredFields || [],
        { isFieldSearchable, applySearchableFilter },
      )
    : null;
  const resolvedQuery = (() => {
    if (recordSearch?.searchDoc && searchTerm) {
      return `${searchTerm} | ${recordSearch.searchDoc}`;
    }
    if (recordSearch?.searchDoc) {
      return recordSearch.searchDoc;
    }
    return searchTerm;
  })();

  if (!resolvedQuery || typeof resolvedQuery !== 'string' || resolvedQuery.trim().length === 0) {
    throw new Error('search_term is required');
  }

  const { normalized: normalizedQuery, tokenCount, tokenCounts } = prepareEmbeddingInputs([resolvedQuery]);
  let creditsCharged = 0;
  let remainingCredits = null;
  let charged = false;

  try {
    const billing = await chargeEmbeddingTokens({
      userId,
      tokenCount,
      source: billingSource,
      operation: billingOperation,
    });
    creditsCharged = billing.creditsCharged;
    remainingCredits = billing.remainingCredits;
    charged = true;
  } catch (error) {
    throw error;
  }

  let queryEmbedding;
  try {
    queryEmbedding = await createEmbeddingsForDocs(normalizedQuery, {
      normalizedDocs: normalizedQuery,
      tokenCounts,
    });
  } catch (error) {
    if (charged) {
      await refundEmbeddingTokens({
        userId,
        tokenCount,
        source: `${billingSource}_refund`,
        operation: billingOperation,
      });
    }
    throw error;
  }
  const hasExplicitFilters = effectiveExplicitFilters && Object.keys(effectiveExplicitFilters).length > 0;
  const inferredFilters = hasExplicitFilters
    ? effectiveExplicitFilters
    : recordSearch?.structuredFilters && Object.keys(recordSearch.structuredFilters).length
      ? recordSearch.structuredFilters
      : extractStructuredFiltersFromQuery(resolvedQuery, template.structuredFields || []);
  const { strictFilters, postFilters } = splitStructuredFilters(inferredFilters, {
    softFilterKeys,
  });
  const shouldApplyStrictFilters = hasExplicitFilters ? true : useStrictFilters;
  const structuredFilterQuery = shouldApplyStrictFilters
    ? buildStructuredFilterQuery(
        strictFilters,
        template.structuredFields || [],
      )
    : {};
  const structuredFilterBoostQuery = applyFilterWeighting
    ? buildStructuredFilterQuery(
        inferredFilters,
        template.structuredFields || [],
      )
    : {};
  const structuredPostFilterQuery = postFilters
    ? buildStructuredFilterQuery(postFilters, template.structuredFields || [])
    : null;
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 100));
  const parsedMinResults = Number(minResults);
  const normalizedMinResults = Number.isFinite(parsedMinResults) && parsedMinResults > 0
    ? Math.min(parsedMinResults, 100)
    : null;
  const effectiveLimit = normalizedMinResults
    ? Math.max(normalizedLimit, normalizedMinResults)
    : normalizedLimit;
  const normalizedCandidates = Math.max(
    effectiveLimit,
    Math.min(Number(numCandidates) || effectiveLimit * 5, 500),
  );

  let results = await performVectorSearch({
    templateId: resolvedTemplateId,
    userId,
    queryVector: queryEmbedding[0],
    limit: effectiveLimit,
    numCandidates: normalizedCandidates,
    structuredFilterQuery,
    vectorIndex: template.vectorIndex,
  });

  if (structuredPostFilterQuery) {
    results = applyStructuredFilterPostFilter(results, structuredPostFilterQuery);
  }

  if (searchDateKey) {
    results = applyAvailabilityDatePostFilter(results, searchDateKey, availabilityConfig);
  }

  if (rerank) {
    results = await rerankResultsWithLLM(resolvedQuery, results);
  }

  const boosted = applyStructuredFilterBoost(results, structuredFilterBoostQuery);
  results = boosted.results;
  if (boosted.applied && !rerank) {
    results = [...results].sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  return {
    templateId: resolvedTemplateId,
    templateName: template.name || null,
    structuredFilters: inferredFilters,
    results: results.map((result) => ({
      id: result.sourceId,
      score: result.score,
      structured_filters: result.structuredFilters,
      record: includeRaw ? result.raw : undefined,
    })),
    creditsCharged,
    remainingCredits,
    inputTokens: tokenCount,
  };
}

export async function similarToEmbeddings({
  userId,
  templateId,
  searchTerm,
  searchRecord,
  searchDate,
  filterConfig,
  limit,
  minResults,
  numCandidates,
  structuredFilters,
  filterPayload,
}) {
  const hasLimit = limit !== undefined && limit !== null;
  const hasMinResults = minResults !== undefined && minResults !== null;
  const hasNumCandidates = numCandidates !== undefined && numCandidates !== null;
  const resolvedLimit = hasLimit ? limit : DEFAULT_SIMILAR_LIMIT;
  const resolvedMinResults = hasMinResults
    ? minResults
    : hasLimit
      ? undefined
      : DEFAULT_SIMILAR_MIN_RESULTS;
  const resolvedNumCandidates = hasNumCandidates
    ? numCandidates
    : hasLimit || hasMinResults
      ? undefined
      : DEFAULT_SIMILAR_NUM_CANDIDATES;

  const response = await searchEmbeddings({
    userId,
    templateId,
    searchTerm,
    searchRecord,
    searchDate,
    filterConfig,
    limit: resolvedLimit,
    minResults: resolvedMinResults,
    numCandidates: resolvedNumCandidates,
    structuredFilters,
    filterPayload,
    rerank: false,
    includeRaw: false,
    useStrictFilters: false,
    applyFilterWeighting: true,
    billingSource: 'embedding_similar',
    billingOperation: 'similar',
  });

  return {
    templateId: response.templateId,
    structuredFilters: response.structuredFilters,
    matches: response.results.map((result) => ({
      id: result.id,
      score: result.score,
    })),
    creditsCharged: response.creditsCharged,
    remainingCredits: response.remainingCredits,
    inputTokens: response.inputTokens,
  };
}

export async function listEmbeddingTemplates({
  userId,
  limit = 50,
  offset = 0,
}) {
  await getDBConnectionString();
  await purgeExpiredEmbeddingTemplates({ userId });
  const parsedLimit = Number.isFinite(Number(limit)) ? Number(limit) : 50;
  const parsedOffset = Number.isFinite(Number(offset)) ? Number(offset) : 0;
  const safeLimit = Math.max(1, Math.min(parsedLimit, 100));
  const safeOffset = Math.max(0, parsedOffset);

  const [templates, total] = await Promise.all([
    EmbeddingTemplate.find({ userId })
      .sort({ createdAt: -1 })
      .skip(safeOffset)
      .limit(safeLimit)
      .lean(),
    EmbeddingTemplate.countDocuments({ userId }),
  ]);

  return {
    templates: templates.map((template) => ({
      template_id: template._id?.toString(),
      name: template.name || null,
      template_hash: template.hash || null,
      hash_link: template.hashLink || null,
      record_count: template.recordCount ?? 0,
      structured_fields: template.structuredFields || [],
      unstructured_fields: template.unstructuredFields || [],
      embedding_model: template.embeddingModel || EMBEDDING_MODEL,
      ttl_minutes: template.ttlMinutes ?? null,
      expires_at: normalizeDateValue(template.expiresAt)?.toISOString() || null,
      created_at: template.createdAt || null,
      updated_at: template.updatedAt || null,
    })),
    pagination: {
      total,
      limit: safeLimit,
      offset: safeOffset,
      has_more: safeOffset + templates.length < total,
    },
  };
}

export async function checkEmbeddingStatus({
  userId,
  templateId,
}) {
  if (!templateId || typeof templateId !== 'string') {
    throw new Error('template_id is required');
  }

  await getDBConnectionString();
  const resolvedTemplate = await resolveEmbeddingTemplate({ userId, templateId });

  if (!resolvedTemplate) {
    const error = new Error('Embedding template not found');
    error.statusCode = 404;
    throw error;
  }
  const resolvedTemplateId = resolvedTemplate.templateId;

  const recordCount = await EmbeddingRecord.countDocuments({ templateId: resolvedTemplateId, userId });
  const hasEmbeddings = recordCount > 0;

  return {
    template_id: resolvedTemplateId,
    has_embeddings: hasEmbeddings,
    record_count: recordCount,
    status: hasEmbeddings ? 'ready' : 'empty',
    ttl_minutes: resolvedTemplate.template.ttlMinutes ?? null,
    expires_at: normalizeDateValue(resolvedTemplate.template.expiresAt)?.toISOString() || null,
  };
}

export async function deleteEmbeddingsForTemplate({
  userId,
  templateId,
}) {
  if (!templateId || typeof templateId !== 'string') {
    throw new Error('template_id is required');
  }

  await getDBConnectionString();
  const resolvedTemplate = await resolveEmbeddingTemplate({ userId, templateId });

  if (!resolvedTemplate) {
    const error = new Error('Embedding template not found');
    error.statusCode = 404;
    throw error;
  }

  const resolvedTemplateId = resolvedTemplate.templateId;
  const deleteResult = await EmbeddingRecord.deleteMany({
    templateId: resolvedTemplateId,
    userId,
  });
  const recordCount = await EmbeddingRecord.countDocuments({
    templateId: resolvedTemplateId,
    userId,
  });

  await EmbeddingTemplate.findByIdAndUpdate(resolvedTemplateId, {
    recordCount,
  });

  return {
    templateId: resolvedTemplateId,
    deletedCount: deleteResult?.deletedCount ?? 0,
    recordCount,
  };
}

export async function deleteEmbeddingRecordsForTemplate({
  userId,
  templateId,
  sourceIds,
}) {
  if (!templateId || typeof templateId !== 'string') {
    throw new Error('template_id is required');
  }

  if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
    throw new Error('source_id is required');
  }

  const normalizedIds = sourceIds
    .map((value) => (typeof value === 'number' || typeof value === 'string' ? String(value).trim() : ''))
    .filter((value) => value);

  if (normalizedIds.length === 0) {
    throw new Error('source_id is required');
  }

  await getDBConnectionString();
  const resolvedTemplate = await resolveEmbeddingTemplate({ userId, templateId });

  if (!resolvedTemplate) {
    const error = new Error('Embedding template not found');
    error.statusCode = 404;
    throw error;
  }

  const resolvedTemplateId = resolvedTemplate.templateId;
  const deleteResult = await EmbeddingRecord.deleteMany({
    templateId: resolvedTemplateId,
    userId,
    sourceId: { $in: normalizedIds },
  });
  const recordCount = await EmbeddingRecord.countDocuments({
    templateId: resolvedTemplateId,
    userId,
  });

  await EmbeddingTemplate.findByIdAndUpdate(resolvedTemplateId, {
    recordCount,
  });

  return {
    templateId: resolvedTemplateId,
    deletedCount: deleteResult?.deletedCount ?? 0,
    recordCount,
  };
}
