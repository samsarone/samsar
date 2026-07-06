import crypto from 'crypto';

const ID_FIELD_NAMES = new Set([
  'id',
  '_id',
  'uuid',
  'uid',
  'identifier',
  'record_id',
  'item_id',
  'object_id',
]);

const MAX_SAMPLE_VALUES = 50;
const MAX_CATEGORICAL_UNIQUE = 50;
const MAX_CATEGORY_STRING_LENGTH = 80;
const NUMERIC_RATIO_THRESHOLD = 0.6;
const BOOLEAN_RATIO_THRESHOLD = 0.6;
const DATE_RATIO_THRESHOLD = 0.6;
const STRING_RATIO_THRESHOLD = 0.6;
const ARRAY_RATIO_THRESHOLD = 0.6;
const OBJECT_RATIO_THRESHOLD = 0.6;

function looksLikeIdKey(key) {
  if (!key || typeof key !== 'string') {
    return false;
  }
  const trimmed = key.trim();
  const lower = trimmed.toLowerCase();
  if (ID_FIELD_NAMES.has(lower)) {
    return true;
  }
  if (lower.endsWith('_id')) {
    return true;
  }
  if (trimmed.endsWith('Id') || trimmed.endsWith('ID')) {
    return true;
  }
  return false;
}

export function isIdField(key) {
  return looksLikeIdKey(key);
}

function isPrimitive(value) {
  return (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Date
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.prototype.toString.call(value) === '[object Object]';
}

function mergeFlattenedValue(result, key, value) {
  if (!Object.prototype.hasOwnProperty.call(result, key)) {
    result[key] = value;
    return;
  }
  const existing = result[key];
  const merged = [];
  if (Array.isArray(existing)) {
    merged.push(...existing);
  } else {
    merged.push(existing);
  }
  if (Array.isArray(value)) {
    merged.push(...value);
  } else {
    merged.push(value);
  }
  result[key] = merged;
}

function flattenArrayEntries(entries, path, result) {
  entries.forEach((entry) => {
    if (entry === undefined) {
      return;
    }
    if (entry === null || isPrimitive(entry)) {
      mergeFlattenedValue(result, path, entry);
      return;
    }
    if (Array.isArray(entry)) {
      flattenArrayEntries(entry, path, result);
      return;
    }
    if (isPlainObject(entry)) {
      flattenRecord(entry, path, result);
      return;
    }
    mergeFlattenedValue(result, path, String(entry));
  });
}

export function flattenRecord(record, prefix = '', result = {}) {
  if (!record || typeof record !== 'object') {
    return result;
  }

  Object.entries(record).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value === undefined) {
      return;
    }
    if (value === null || isPrimitive(value)) {
      mergeFlattenedValue(result, path, value);
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) {
        mergeFlattenedValue(result, path, []);
        return;
      }
      if (value.every((entry) => entry === null || entry === undefined || isPrimitive(entry))) {
        mergeFlattenedValue(result, path, value);
        return;
      }
      flattenArrayEntries(value, path, result);
      return;
    }
    if (isPlainObject(value)) {
      flattenRecord(value, path, result);
      return;
    }
    mergeFlattenedValue(result, path, String(value));
  });

  return result;
}

function parseNumericString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) {
    return null;
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateString(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const isIsoLike = /^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(trimmed);
  const isSlashDate = /^\d{4}\/\d{2}\/\d{2}$/.test(trimmed);
  if (!isIsoLike && !isSlashDate) {
    return null;
  }
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed);
}

function updateScalarStats(stats, value) {
  if (value instanceof Date) {
    stats.dateCount += 1;
    stats.valueCount += 1;
    stats.sampleValues = pushSampleValue(stats.sampleValues, value.toISOString());
    return;
  }

  const valueType = typeof value;

  if (valueType === 'number') {
    stats.numberCount += 1;
    stats.valueCount += 1;
    stats.minNumber = Math.min(stats.minNumber, value);
    stats.maxNumber = Math.max(stats.maxNumber, value);
    stats.sampleValues = pushSampleValue(stats.sampleValues, value);
    stats.uniqueValues.add(String(value));
    return;
  }

  if (valueType === 'boolean') {
    stats.booleanCount += 1;
    stats.valueCount += 1;
    stats.sampleValues = pushSampleValue(stats.sampleValues, value);
    stats.uniqueValues.add(String(value));
    return;
  }

  if (valueType === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    stats.stringCount += 1;
    stats.valueCount += 1;
    stats.maxStringLength = Math.max(stats.maxStringLength, trimmed.length);
    stats.stringLengthTotal += trimmed.length;
    stats.uniqueValues.add(trimmed.toLowerCase());
    const numericValue = parseNumericString(trimmed);
    if (numericValue !== null) {
      stats.numericStringCount += 1;
      stats.minNumber = Math.min(stats.minNumber, numericValue);
      stats.maxNumber = Math.max(stats.maxNumber, numericValue);
      stats.sampleValues = pushSampleValue(stats.sampleValues, numericValue);
      return;
    }
    const dateValue = parseDateString(trimmed);
    if (dateValue) {
      stats.dateStringCount += 1;
      stats.sampleValues = pushSampleValue(stats.sampleValues, dateValue.toISOString());
      return;
    }
    stats.sampleValues = pushSampleValue(stats.sampleValues, trimmed);
    return;
  }

  if (valueType === 'bigint') {
    stats.valueCount += 1;
    const numericValue = Number(value);
    if (Number.isFinite(numericValue)) {
      stats.numberCount += 1;
      stats.minNumber = Math.min(stats.minNumber, numericValue);
      stats.maxNumber = Math.max(stats.maxNumber, numericValue);
      stats.sampleValues = pushSampleValue(stats.sampleValues, numericValue);
      stats.uniqueValues.add(String(numericValue));
    } else {
      const asString = value.toString();
      stats.sampleValues = pushSampleValue(stats.sampleValues, asString);
      stats.uniqueValues.add(asString);
    }
    return;
  }

  if (isPlainObject(value)) {
    stats.objectCount += 1;
    stats.valueCount += 1;
    return;
  }

  stats.objectCount += 1;
  stats.valueCount += 1;
}

function collectArrayStats(stats, value) {
  stats.arrayCount += 1;
  if (!Array.isArray(value) || value.length === 0) {
    return;
  }

  const flattened = [];
  const stack = [...value];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (Array.isArray(entry)) {
      stack.push(...entry);
    } else {
      flattened.push(entry);
    }
  }

  const primitiveOnly = flattened.every(
    (entry) => entry === null || entry === undefined || isPrimitive(entry),
  );
  if (primitiveOnly) {
    stats.arrayPrimitiveCount += 1;
  }

  flattened.forEach((entry) => {
    if (entry === null || entry === undefined) {
      return;
    }
    updateScalarStats(stats, entry);
  });
}

function updateStats(stats, value) {
  stats.count += 1;

  if (value === null || value === undefined) {
    stats.nullCount += 1;
    return;
  }

  stats.nonNullCount += 1;

  if (Array.isArray(value)) {
    collectArrayStats(stats, value);
    return;
  }

  updateScalarStats(stats, value);
}

function pushSampleValue(sampleValues, value) {
  if (sampleValues.length >= MAX_SAMPLE_VALUES) {
    return sampleValues;
  }
  return [...sampleValues, value];
}

function initStats() {
  return {
    count: 0,
    nonNullCount: 0,
    nullCount: 0,
    valueCount: 0,
    numberCount: 0,
    booleanCount: 0,
    stringCount: 0,
    numericStringCount: 0,
    dateCount: 0,
    dateStringCount: 0,
    arrayCount: 0,
    arrayPrimitiveCount: 0,
    objectCount: 0,
    maxStringLength: 0,
    stringLengthTotal: 0,
    minNumber: Number.POSITIVE_INFINITY,
    maxNumber: Number.NEGATIVE_INFINITY,
    uniqueValues: new Set(),
    sampleValues: [],
  };
}

function getLastPathSegment(path) {
  if (!path || typeof path !== 'string') {
    return '';
  }
  const parts = path.split('.');
  return parts[parts.length - 1] || '';
}

function shouldForceStringType(key) {
  const last = getLastPathSegment(key).toLowerCase();
  if (!last) {
    return false;
  }
  if (last === 'country_code') {
    return true;
  }
  return last.includes('address');
}

function isAddressField(key) {
  const last = getLastPathSegment(key).toLowerCase();
  if (!last) {
    return false;
  }
  return last.includes('address');
}

function determineStructuredType(stats, key = '') {
  const effectiveCount = stats.valueCount || stats.nonNullCount || 0;
  if (effectiveCount === 0) {
    return null;
  }

  const objectRatio = stats.objectCount / effectiveCount;
  if (objectRatio >= OBJECT_RATIO_THRESHOLD) {
    return 'object';
  }

  const forceString = shouldForceStringType(key);
  if (
    forceString &&
    (stats.stringCount > 0 || stats.numericStringCount > 0 || stats.numberCount > 0)
  ) {
    return 'string';
  }

  const numericRatio = (stats.numberCount + stats.numericStringCount) / effectiveCount;
  if (!forceString && numericRatio >= NUMERIC_RATIO_THRESHOLD) {
    return 'number';
  }

  const booleanRatio = stats.booleanCount / effectiveCount;
  if (!forceString && booleanRatio >= BOOLEAN_RATIO_THRESHOLD) {
    return 'boolean';
  }

  const dateRatio = (stats.dateCount + stats.dateStringCount) / effectiveCount;
  if (dateRatio >= DATE_RATIO_THRESHOLD) {
    return 'date';
  }

  const arrayRatio = stats.arrayPrimitiveCount / Math.max(stats.arrayCount, 1);
  if (
    stats.arrayCount > 0 &&
    arrayRatio >= ARRAY_RATIO_THRESHOLD &&
    stats.uniqueValues.size > 0 &&
    stats.uniqueValues.size <= MAX_CATEGORICAL_UNIQUE &&
    stats.maxStringLength <= MAX_CATEGORY_STRING_LENGTH
  ) {
    return 'array';
  }

  const stringRatio = stats.stringCount / effectiveCount;
  if (
    stringRatio >= STRING_RATIO_THRESHOLD &&
    stats.uniqueValues.size > 0 &&
    stats.uniqueValues.size <= MAX_CATEGORICAL_UNIQUE &&
    stats.maxStringLength <= MAX_CATEGORY_STRING_LENGTH
  ) {
    return 'string';
  }

  return null;
}

export function analyzeRecords(records, options = {}) {
  const fieldStats = new Map();
  const flattenedRecords = records.map((record) => flattenRecord(record));
  const includeField = typeof options.includeField === 'function' ? options.includeField : null;
  const isFieldSearchable = typeof options.isFieldSearchable === 'function'
    ? options.isFieldSearchable
    : null;
  const isFieldFilterable = typeof options.isFieldFilterable === 'function'
    ? options.isFieldFilterable
    : null;

  const shouldIncludeField = (path) => {
    if (!path || isIdField(path)) {
      return false;
    }
    if (includeField && !includeField(path)) {
      return false;
    }
    return true;
  };

  const collectArrayNestedFields = (entries, basePath) => {
    entries.forEach((entry) => {
      if (entry === null || entry === undefined) {
        return;
      }
      if (Array.isArray(entry)) {
        collectArrayNestedFields(entry, basePath);
        return;
      }
      if (isPlainObject(entry)) {
        Object.entries(entry).forEach(([key, value]) => {
          const nextPath = `${basePath}.${key}`;
          collectFieldStats(value, nextPath);
        });
      }
    });
  };

  const collectFieldStats = (value, path) => {
    if (!shouldIncludeField(path)) {
      return;
    }
    if (!fieldStats.has(path)) {
      fieldStats.set(path, initStats());
    }
    updateStats(fieldStats.get(path), value);
    if (value === null || value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      collectArrayNestedFields(value, path);
      return;
    }
    if (isPlainObject(value)) {
      Object.entries(value).forEach(([key, entry]) => {
        const nextPath = `${path}.${key}`;
        collectFieldStats(entry, nextPath);
      });
    }
  };

  records.forEach((record) => {
    if (!record || typeof record !== 'object') {
      return;
    }
    Object.entries(record).forEach(([key, value]) => {
      collectFieldStats(value, key);
    });
  });

  const structuredFields = [];
  const unstructuredFields = [];

  [...fieldStats.entries()].forEach(([key, stats]) => {
    const effectiveCount = stats.valueCount || stats.nonNullCount || 0;
    if (effectiveCount === 0) {
      return;
    }
    const structuredType = determineStructuredType(stats, key);
    const statsSnapshot = {
      count: stats.count,
      nonNullCount: stats.nonNullCount,
      nullCount: stats.nullCount,
      minNumber: Number.isFinite(stats.minNumber) ? stats.minNumber : null,
      maxNumber: Number.isFinite(stats.maxNumber) ? stats.maxNumber : null,
      uniqueCount: stats.uniqueValues.size,
      maxStringLength: stats.maxStringLength,
    };

    const shouldFilter = isFieldFilterable ? isFieldFilterable(key) : true;
    const shouldSearch = isFieldSearchable ? isFieldSearchable(key) : true;
    if (structuredType && shouldFilter) {
      structuredFields.push({
        key,
        type: structuredType,
        sampleValues: stats.sampleValues,
        stats: statsSnapshot,
      });
    } else if (shouldSearch) {
      unstructuredFields.push(key);
    }
  });

  return {
    structuredFields,
    unstructuredFields,
    fieldStats,
    flattenedRecords,
  };
}

export function buildSearchDocument(flatRecord, options = {}) {
  const isFieldSearchable = typeof options.isFieldSearchable === 'function'
    ? options.isFieldSearchable
    : null;
  const parts = [];
  Object.entries(flatRecord).forEach(([key, value]) => {
    if (isIdField(key)) {
      return;
    }
    if (isFieldSearchable && !isFieldSearchable(key)) {
      return;
    }
    const valueString = stringifyValue(value);
    if (!valueString) {
      return;
    }
    parts.push(`${key}: ${valueString}`);
  });
  return parts.join(' | ');
}

function stringifyValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyValue(entry)).filter(Boolean).join(', ');
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function extractRecordId(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const directKeys = ['id', '_id', 'uuid', 'uid', 'identifier', 'record_id', 'item_id'];
  for (const key of directKeys) {
    if (record[key] !== undefined && record[key] !== null) {
      return String(record[key]);
    }
  }

  const fallbackKey = Object.keys(record).find((key) => looksLikeIdKey(key));
  if (fallbackKey && record[fallbackKey] !== undefined && record[fallbackKey] !== null) {
    return String(record[fallbackKey]);
  }

  return null;
}

function normalizeStructuredValue(value, type) {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const normalizedArray = value
      .map((entry) => normalizeStructuredValue(entry, type))
      .filter((entry) => entry !== undefined);
    return normalizedArray.length ? normalizedArray : undefined;
  }

  if (type === 'object') {
    return undefined;
  }

  if (type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = parseNumericString(value);
      return parsed !== null ? parsed : undefined;
    }
    return undefined;
  }

  if (type === 'boolean') {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', 'yes', '1'].includes(normalized)) {
        return true;
      }
      if (['false', 'no', '0'].includes(normalized)) {
        return false;
      }
    }
    return undefined;
  }

  if (type === 'date') {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      const parsed = parseDateString(value);
      if (parsed) {
        return parsed.toISOString();
      }
    }
    return undefined;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized.length ? normalized : undefined;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return value;
}

export function buildStructuredFilters(flatRecord, structuredFields) {
  const structuredMap = new Map(structuredFields.map((field) => [field.key, field]));
  const filters = {};

  Object.entries(flatRecord).forEach(([key, value]) => {
    if (!structuredMap.has(key)) {
      return;
    }
    const normalized = normalizeStructuredValue(value, structuredMap.get(key).type);
    if (normalized !== undefined) {
      filters[key] = normalized;
    }
  });

  return filters;
}

export function buildStructuredFilterQuery(filters, structuredFields) {
  if (!filters || typeof filters !== 'object') {
    return {};
  }

  const fieldMap = new Map(structuredFields.map((field) => [field.key, field]));
  const query = {};

  Object.entries(filters).forEach(([key, value]) => {
    if (!fieldMap.has(key) || value === undefined || value === null) {
      return;
    }
    const field = fieldMap.get(key);
    const path = `structuredFilters.${key}`;
    if (typeof value === 'object' && !Array.isArray(value)) {
      const rangeQuery = {};
      if (value.min !== undefined || value.gte !== undefined) {
        rangeQuery.$gte = value.min ?? value.gte;
      }
      if (value.max !== undefined || value.lte !== undefined) {
        rangeQuery.$lte = value.max ?? value.lte;
      }
      if (Object.keys(rangeQuery).length > 0) {
        query[path] = rangeQuery;
        return;
      }
    }

    const normalizedValue = normalizeStructuredValue(value, field.type);
    if (normalizedValue === undefined) {
      return;
    }
    if (field.type === 'string' && isAddressField(field.key)) {
      if (typeof normalizedValue === 'string' && normalizedValue.length > 0) {
        query[path] = { $regex: escapeRegExp(normalizedValue), $options: 'i' };
        return;
      }
    }
    if (Array.isArray(normalizedValue)) {
      if (normalizedValue.length > 0) {
        query[path] = { $in: normalizedValue };
      }
      return;
    }
    query[path] = normalizedValue;
  });

  return query;
}

export function extractStructuredFiltersFromQuery(searchTerm, structuredFields) {
  if (!searchTerm || typeof searchTerm !== 'string') {
    return {};
  }

  const normalized = searchTerm.toLowerCase();
  const filters = {};

  structuredFields.forEach((field) => {
    const keyLower = field.key.toLowerCase();
    if (field.type === 'number') {
      const regex = new RegExp(`${escapeRegExp(keyLower)}\\s*[:=]?\\s*(-?\\d+(?:\\.\\d+)?)`, 'i');
      const match = normalized.match(regex);
      if (match) {
        filters[field.key] = Number(match[1]);
      }
      return;
    }

    if (field.type === 'boolean') {
      const regex = new RegExp(`${escapeRegExp(keyLower)}\\s*[:=]?\\s*(true|false|yes|no|1|0)`, 'i');
      const match = normalized.match(regex);
      if (match) {
        const normalizedValue = match[1].toLowerCase();
        filters[field.key] = ['true', 'yes', '1'].includes(normalizedValue);
      }
      return;
    }

    const sampleValues = Array.isArray(field.sampleValues) ? field.sampleValues : [];
    for (const value of sampleValues) {
      if (typeof value !== 'string') {
        continue;
      }
      const valueLower = value.toLowerCase();
      if (valueLower && normalized.includes(valueLower)) {
        if (field.type === 'array') {
          filters[field.key] = filters[field.key] || [];
          filters[field.key].push(value);
        } else {
          filters[field.key] = value;
        }
        break;
      }
    }
  });

  return filters;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeFingerprintKey(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return String(value);
  } catch {
    return '';
  }
}

export function createSchemaFingerprint(structuredFields, unstructuredFields) {
  const normalized = {
    structured: [...structuredFields]
      .map((field) => ({ key: normalizeFingerprintKey(field?.key), type: field?.type || null }))
      .filter((field) => field.key)
      .sort((a, b) => a.key.localeCompare(b.key)),
    unstructured: [...unstructuredFields]
      .map((field) => normalizeFingerprintKey(field))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
  };

  return JSON.stringify(normalized);
}

export function createTemplateHash(schemaFingerprint) {
  return crypto.createHash('sha256').update(schemaFingerprint).digest('hex');
}
