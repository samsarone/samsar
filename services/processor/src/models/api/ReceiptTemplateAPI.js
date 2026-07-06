import { createHash, randomUUID } from 'crypto';
import fetch from 'node-fetch';
import OpenAI from 'openai';
import sharp from 'sharp';
import { getDBConnectionString } from '../DBString.js';
import { deductGenerationCredits } from '../GenerationCredits.js';
import { createCompatibleChatCompletion } from '../ai_utils/OpenAICompat.js';
import { getExtractReceiptTemplateQueryPricing } from '../../consts/pricing/ApiPricing.js';
import ReceiptTemplate from '../../schema/ReceiptTemplate.js';

const RECEIPT_TEMPLATE_MODEL = process.env.RECEIPT_TEMPLATE_MODEL || 'gpt-5.1';
const RECEIPT_QUERY_MODEL = process.env.RECEIPT_QUERY_MODEL || RECEIPT_TEMPLATE_MODEL;
const RECEIPT_QUERY_IMAGE_MAX_WIDTH = Number.isFinite(Number(process.env.RECEIPT_QUERY_IMAGE_MAX_WIDTH))
  ? Math.max(800, Math.floor(Number(process.env.RECEIPT_QUERY_IMAGE_MAX_WIDTH)))
  : 1600;
const RECEIPT_TEMPLATE_IMAGE_MAX_WIDTH = Number.isFinite(Number(process.env.RECEIPT_TEMPLATE_IMAGE_MAX_WIDTH))
  ? Math.max(800, Math.floor(Number(process.env.RECEIPT_TEMPLATE_IMAGE_MAX_WIDTH)))
  : 1800;
const RECEIPT_MIN_WORKING_WIDTH = Number.isFinite(Number(process.env.RECEIPT_MIN_WORKING_WIDTH))
  ? Math.max(600, Math.floor(Number(process.env.RECEIPT_MIN_WORKING_WIDTH)))
  : 1200;
const RECEIPT_FETCH_TIMEOUT_MS = Number.isFinite(Number(process.env.RECEIPT_FETCH_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.RECEIPT_FETCH_TIMEOUT_MS)))
  : 45000;
const RECEIPT_OPENAI_TIMEOUT_MS = Number.isFinite(Number(process.env.RECEIPT_OPENAI_TIMEOUT_MS))
  ? Math.max(5000, Math.floor(Number(process.env.RECEIPT_OPENAI_TIMEOUT_MS)))
  : 90000;
const RECEIPT_MAX_ROIS = 8;
const RECEIPT_QUERY_PRICING = getExtractReceiptTemplateQueryPricing();
const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const TEMPLATE_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['template_name', 'merchant_hint', 'language_hint', 'currency_hint', 'rois', 'fields', 'sample_receipt', 'validation_rules'],
  properties: {
    template_name: { type: ['string', 'null'] },
    merchant_hint: { type: ['string', 'null'] },
    language_hint: { type: ['string', 'null'] },
    currency_hint: { type: ['string', 'null'] },
    rois: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'label', 'purpose', 'left', 'top', 'width', 'height'],
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          purpose: { type: 'string' },
          left: { type: 'number' },
          top: { type: 'number' },
          width: { type: 'number' },
          height: { type: 'number' },
        },
      },
    },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'label', 'type', 'required', 'roi_id', 'description'],
        properties: {
          key: { type: 'string' },
          label: { type: 'string' },
          type: { type: 'string' },
          required: { type: 'boolean' },
          roi_id: { type: ['string', 'null'] },
          description: { type: 'string' },
        },
      },
    },
    sample_receipt: {
      type: 'object',
      additionalProperties: true,
    },
    validation_rules: {
      type: 'object',
      additionalProperties: true,
    },
  },
};

const QUERY_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['normalized_fields', 'standardized_receipt', 'items', 'unreadable_fields', 'confidence'],
  properties: {
    normalized_fields: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
          { type: 'array', items: {} },
          { type: 'object', additionalProperties: true },
        ],
      },
    },
    standardized_receipt: {
      type: 'object',
      additionalProperties: false,
      required: ['merchant_name', 'transaction_date', 'transaction_time', 'transaction_id', 'currency', 'subtotal', 'tax', 'fee', 'discount', 'total', 'payment_method', 'from_account', 'to_account'],
      properties: {
        merchant_name: { type: ['string', 'null'] },
        transaction_date: { type: ['string', 'null'] },
        transaction_time: { type: ['string', 'null'] },
        transaction_id: { type: ['string', 'null'] },
        currency: { type: ['string', 'null'] },
        subtotal: { type: ['number', 'null'] },
        tax: { type: ['number', 'null'] },
        fee: { type: ['number', 'null'] },
        discount: { type: ['number', 'null'] },
        total: { type: ['number', 'null'] },
        payment_method: { type: ['string', 'null'] },
        from_account: { type: ['string', 'null'] },
        to_account: { type: ['string', 'null'] },
      },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'qty', 'unit_price', 'amount'],
        properties: {
          description: { type: 'string' },
          qty: { type: ['number', 'null'] },
          unit_price: { type: ['number', 'null'] },
          amount: { type: ['number', 'null'] },
        },
      },
    },
    unreadable_fields: {
      type: 'array',
      items: { type: 'string' },
    },
    confidence: { type: 'number' },
  },
};

const RETRY_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['normalized_fields', 'unreadable_fields', 'confidence'],
  properties: {
    normalized_fields: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' },
          { type: 'array', items: {} },
          { type: 'object', additionalProperties: true },
        ],
      },
    },
    unreadable_fields: {
      type: 'array',
      items: { type: 'string' },
    },
    confidence: { type: 'number' },
  },
};

const SUPPORTED_FIELD_TYPES = new Set([
  'string',
  'number',
  'currency',
  'date',
  'datetime',
  'boolean',
  'array',
  'object',
]);

const DEFAULT_TEMPLATE_FIELDS = Object.freeze([
  { key: 'merchant_name', label: 'Merchant Name', type: 'string', required: true, roi_id: null, description: 'Store, bank, or issuer name.' },
  { key: 'transaction_date', label: 'Transaction Date', type: 'date', required: true, roi_id: null, description: 'Date of the transaction.' },
  { key: 'transaction_time', label: 'Transaction Time', type: 'string', required: false, roi_id: null, description: 'Time of transaction if present.' },
  { key: 'transaction_id', label: 'Transaction ID', type: 'string', required: false, roi_id: null, description: 'Receipt/transaction reference number.' },
  { key: 'currency', label: 'Currency', type: 'string', required: true, roi_id: null, description: 'ISO code or symbol-derived currency.' },
  { key: 'subtotal', label: 'Subtotal', type: 'currency', required: false, roi_id: null, description: 'Subtotal before tax/fees/discounts.' },
  { key: 'tax', label: 'Tax', type: 'currency', required: false, roi_id: null, description: 'Tax amount.' },
  { key: 'fee', label: 'Fee', type: 'currency', required: false, roi_id: null, description: 'Additional fee/charges.' },
  { key: 'discount', label: 'Discount', type: 'currency', required: false, roi_id: null, description: 'Discount amount.' },
  { key: 'total', label: 'Total', type: 'currency', required: true, roi_id: null, description: 'Final charged amount.' },
  { key: 'payment_method', label: 'Payment Method', type: 'string', required: false, roi_id: null, description: 'Card/cash/transfer etc.' },
  { key: 'from_account', label: 'From Account', type: 'string', required: false, roi_id: null, description: 'Source account details when available.' },
  { key: 'to_account', label: 'To Account', type: 'string', required: false, roi_id: null, description: 'Destination account details when available.' },
]);

const DEFAULT_TEMPLATE_ROIS = Object.freeze([
  { id: 'meta_header', label: 'Header and Meta', purpose: 'merchant/date/transaction id', left: 0.0, top: 0.0, width: 1.0, height: 0.35 },
  { id: 'line_items', label: 'Line Items/Table', purpose: 'line items table', left: 0.0, top: 0.28, width: 1.0, height: 0.5 },
  { id: 'totals', label: 'Totals', purpose: 'subtotal/tax/fees/total area', left: 0.45, top: 0.70, width: 0.55, height: 0.30 },
]);

export async function createReceiptTemplate(payload = {}) {
  const userId = normalizeNonEmptyString(payload.userId);
  const imageUrl = normalizeNonEmptyString(
    payload.image_url
    || payload.imageUrl
    || payload.receipt_url
    || payload.receiptUrl
    || payload.template_url
    || payload.templateUrl,
  );
  const templateName = normalizeNonEmptyString(payload.template_name || payload.templateName) || null;
  const startedAt = Date.now();

  if (!userId) {
    const error = new Error('userId is required.');
    error.statusCode = 401;
    throw error;
  }
  if (!imageUrl || !isLikelyHttpUrl(imageUrl)) {
    const error = new Error('image_url must be a valid http(s) URL.');
    error.statusCode = 400;
    throw error;
  }


  ensureOpenAIClient();
  await getDBConnectionString();

  const sourceImageBuffer = await fetchRemoteImageBuffer(imageUrl);
  const normalizedImageBuffer = await preprocessReceiptImage(sourceImageBuffer, {
    maxWidth: RECEIPT_TEMPLATE_IMAGE_MAX_WIDTH,
  });
  const imageDataUrl = bufferToDataUrl(normalizedImageBuffer, 'image/jpeg');

  const templateExtraction = await requestTemplateFromVision({
    imageDataUrl,
    imageUrl,
    templateName,
  });

  const normalizedTemplate = normalizeTemplatePayload(templateExtraction);
  const sampleReceipt = normalizeSampleReceipt(templateExtraction?.sample_receipt || {});
  const resolvedTemplateName =
    templateName ||
    normalizeNonEmptyString(templateExtraction?.template_name) ||
    normalizedTemplate.merchant_hint ||
    'Receipt Template';

  const templateHash = createTemplateHash({
    userId,
    normalizedTemplate,
    sampleReceipt,
    sourceImageUrl: imageUrl,
  });
  const templateId = `receipt_tpl_${randomUUID().replace(/-/g, '').slice(0, 24)}`;

  const doc = await ReceiptTemplate.create({
    userId,
    templateId,
    templateHash,
    name: resolvedTemplateName,
    sourceImageUrl: imageUrl,
    normalizedTemplate,
    sampleReceipt,
    provider: {
      model: RECEIPT_TEMPLATE_MODEL,
      source: 'openai_vision',
    },
  });


  return {
    template_id: doc.templateId,
    template_hash: doc.templateHash,
    template_name: doc.name,
    normalized_template: doc.normalizedTemplate,
    sample_receipt: doc.sampleReceipt,
    created_at: doc.createdAt,
  };
}

export async function queryReceiptAgainstTemplate(payload = {}) {
  const userId = normalizeNonEmptyString(payload.userId);
  const imageUrl = normalizeNonEmptyString(
    payload.image_url
    || payload.imageUrl
    || payload.receipt_url
    || payload.receiptUrl,
  );
  const templateId = normalizeNonEmptyString(
    payload.template_id
    || payload.templateId
    || payload.receipt_template_id
    || payload.receiptTemplateId,
  );
  const startedAt = Date.now();

  if (!userId) {
    const error = new Error('userId is required.');
    error.statusCode = 401;
    throw error;
  }
  if (!templateId) {
    const error = new Error('template_id is required.');
    error.statusCode = 400;
    throw error;
  }
  if (!imageUrl || !isLikelyHttpUrl(imageUrl)) {
    const error = new Error('image_url must be a valid http(s) URL.');
    error.statusCode = 400;
    throw error;
  }


  ensureOpenAIClient();
  await getDBConnectionString();

  const template = await ReceiptTemplate.findOne({
    userId,
    templateId,
  }).lean();

  if (!template) {
    const error = new Error('Template not found for this API key.');
    error.statusCode = 404;
    throw error;
  }

  const creditResult = await deductGenerationCredits(userId, RECEIPT_QUERY_PRICING.credits, {
    source: 'image_receipt_template_query',
    metadata: {
      requestType: 'API',
      pricing: RECEIPT_QUERY_PRICING,
      templateId,
      imageUrl,
    },
  });

  const sourceImageBuffer = await fetchRemoteImageBuffer(imageUrl);
  const normalizedImageBuffer = await preprocessReceiptImage(sourceImageBuffer, {
    maxWidth: RECEIPT_QUERY_IMAGE_MAX_WIDTH,
  });
  const fullImageDataUrl = bufferToDataUrl(normalizedImageBuffer, 'image/jpeg');
  const roiCrops = await buildRoiCrops(normalizedImageBuffer, template?.normalizedTemplate?.rois || []);

  let visionResult = await requestReceiptExtractionFromVision({
    fullImageDataUrl,
    roiCrops,
    template,
  });

  let normalizedResult = normalizeExtractionResult(visionResult, template);
  let validation = validateExtractedReceipt({
    normalizedFields: normalizedResult.normalized_fields,
    standardizedReceipt: normalizedResult.standardized_receipt,
    items: normalizedResult.items,
    template,
  });

  let attempts = 1;
  if (!validation.is_valid) {
    const retryFieldKeys = collectRetryFieldKeys(validation);
    if (retryFieldKeys.length > 0) {
      attempts += 1;
      const retryResult = await requestFieldRetryFromVision({
        fullImageDataUrl,
        roiCrops,
        template,
        retryFieldKeys,
      });
      normalizedResult = mergeRetryIntoResult(normalizedResult, retryResult, template);
      validation = validateExtractedReceipt({
        normalizedFields: normalizedResult.normalized_fields,
        standardizedReceipt: normalizedResult.standardized_receipt,
        items: normalizedResult.items,
        template,
      });
    }
  }

  const responsePayload = {
    template_id: template.templateId,
    template_hash: template.templateHash,
    template_name: template.name,
    normalized_template: template.normalizedTemplate,
    receipt_json: normalizedResult.normalized_fields,
    standardized_receipt: normalizedResult.standardized_receipt,
    items: normalizedResult.items,
    unreadable_fields: normalizedResult.unreadable_fields,
    confidence: normalizedResult.confidence,
    validation,
    attempts,
    creditsCharged: RECEIPT_QUERY_PRICING.credits,
    remainingCredits: creditResult?.remainingCredits ?? null,
  };


  return responsePayload;
}

export async function getReceiptTemplateJson(payload = {}) {
  const userId = normalizeNonEmptyString(payload.userId);
  const templateId = normalizeNonEmptyString(
    payload.template_id
    || payload.templateId
    || payload.receipt_template_id
    || payload.receiptTemplateId
    || payload.id,
  );

  if (!userId) {
    const error = new Error('userId is required.');
    error.statusCode = 401;
    throw error;
  }
  if (!templateId) {
    const error = new Error('template_id is required.');
    error.statusCode = 400;
    throw error;
  }

  await getDBConnectionString();

  const template = await ReceiptTemplate.findOne({
    userId,
    templateId,
  }).lean();

  if (!template) {
    const error = new Error('Template not found for this API key.');
    error.statusCode = 404;
    throw error;
  }

  return {
    template_id: template.templateId,
    template_hash: template.templateHash,
    template_name: template.name,
    source_image_url: template.sourceImageUrl,
    normalized_template: template.normalizedTemplate || {},
    template_json: template.normalizedTemplate || {},
    sample_receipt: template.sampleReceipt || {},
    provider: template.provider || null,
    created_at: template.createdAt || null,
    updated_at: template.updatedAt || null,
  };
}

async function requestTemplateFromVision({
  imageDataUrl,
  imageUrl,
  templateName,
}) {
  const startedAt = Date.now();
  const messages = [
    {
      role: 'developer',
      content:
        'You build a deterministic receipt extraction template from one sample receipt. ' +
        'Only return JSON that matches the schema. ' +
        'Use normalized coordinates (0-1) for ROI boxes. ' +
        'Field keys must be snake_case. ' +
        'Prefer a cost-effective extraction design: include focused ROIs for line items and totals.',
    },
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            `Build a reusable template for receipt extraction.\n` +
            `image_url: ${imageUrl}\n` +
            `template_name_hint: ${templateName || 'null'}\n` +
            `Requirements:\n` +
            `1) Identify ROIs for metadata/header, table/line-items, totals.\n` +
            `2) Define normalized fields for standardized extraction.\n` +
            `3) Provide one sample_receipt JSON extracted from this image.\n` +
            `4) Include arithmetic validation rule hints for subtotal/tax/discount/fee/total.\n` +
            `If a field is unreadable, set null and do not guess.\n`,
        },
        {
          type: 'image_url',
          image_url: {
            url: imageDataUrl,
            detail: 'high',
          },
        },
      ],
    },
  ];

  const completion = await withTimeout(
    createCompatibleChatCompletion(openaiClient, {
      model: RECEIPT_TEMPLATE_MODEL,
      temperature: 0,
      messages,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_template_builder',
          strict: false,
          schema: TEMPLATE_RESPONSE_SCHEMA,
        },
      },
    }),
    RECEIPT_OPENAI_TIMEOUT_MS,
    'receipt template builder'
  );


  return parseJsonFromCompletion(completion);
}

async function requestReceiptExtractionFromVision({
  fullImageDataUrl,
  roiCrops,
  template,
}) {
  const startedAt = Date.now();
  const fieldList = Array.isArray(template?.normalizedTemplate?.fields)
    ? template.normalizedTemplate.fields
    : [];

  const content = [
    {
      type: 'text',
      text:
        'Extract receipt values using this template. ' +
        'Return JSON only. ' +
        'Do not guess; set unreadable values to null. ' +
        `Template fields: ${JSON.stringify(fieldList)}. ` +
        `Validation hints: ${JSON.stringify(template?.normalizedTemplate?.validation_rules || {})}.`,
    },
  ];

  if (roiCrops.length > 0) {
    roiCrops.forEach((roi) => {
      content.push({
        type: 'text',
        text: `ROI ${roi.id} (${roi.label}): ${roi.purpose || 'general'}`,
      });
      content.push({
        type: 'image_url',
        image_url: {
          url: roi.dataUrl,
          detail: 'high',
        },
      });
    });
  } else {
    content.push({
      type: 'text',
      text: 'No ROI crops were available, using the full receipt image.',
    });
    content.push({
      type: 'image_url',
      image_url: {
        url: fullImageDataUrl,
        detail: 'high',
      },
    });
  }

  const completion = await withTimeout(
    createCompatibleChatCompletion(openaiClient, {
      model: RECEIPT_QUERY_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'developer',
          content:
            'You are a high-accuracy receipt extraction system. Return only strict JSON. ' +
            'Use normalized fields from template and standardized receipt fields. ' +
            'Never output prose.',
        },
        {
          role: 'user',
          content,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_extraction_result',
          strict: false,
          schema: QUERY_RESPONSE_SCHEMA,
        },
      },
    }),
    RECEIPT_OPENAI_TIMEOUT_MS,
    'receipt extraction'
  );


  return parseJsonFromCompletion(completion);
}

async function requestFieldRetryFromVision({
  fullImageDataUrl,
  roiCrops,
  template,
  retryFieldKeys,
}) {
  const startedAt = Date.now();
  const content = [
    {
      type: 'text',
      text:
        `Re-read only these fields from the receipt and return updated normalized_fields: ${JSON.stringify(retryFieldKeys)}. ` +
        'Use null for unreadable values and do not guess.',
    },
  ];

  const totalsCrop = roiCrops.find((item) => item.id === 'totals');
  if (totalsCrop) {
    content.push({
      type: 'text',
      text: 'Totals ROI',
    });
    content.push({
      type: 'image_url',
      image_url: { url: totalsCrop.dataUrl, detail: 'high' },
    });
  }

  content.push({
    type: 'text',
    text: 'Full image context',
  });
  content.push({
    type: 'image_url',
    image_url: { url: fullImageDataUrl, detail: 'high' },
  });

  const completion = await withTimeout(
    createCompatibleChatCompletion(openaiClient, {
      model: RECEIPT_QUERY_MODEL,
      temperature: 0,
      messages: [
        {
          role: 'developer',
          content:
            'You are a strict JSON field re-reader for receipt extraction. ' +
            `Template fields: ${JSON.stringify(template?.normalizedTemplate?.fields || [])}.`,
        },
        {
          role: 'user',
          content,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'receipt_extraction_retry',
          strict: false,
          schema: RETRY_RESPONSE_SCHEMA,
        },
      },
    }),
    RECEIPT_OPENAI_TIMEOUT_MS,
    'receipt extraction retry'
  );


  return parseJsonFromCompletion(completion);
}

function normalizeTemplatePayload(rawTemplate) {
  const rois = normalizeTemplateRois(rawTemplate?.rois || []);
  const roiById = new Set(rois.map((roi) => roi.id));
  const fields = normalizeTemplateFields(rawTemplate?.fields || [], roiById);
  const normalizedFields = ensureDefaultTemplateFields(fields);

  return {
    schema_version: '1.0',
    merchant_hint: normalizeNullableString(rawTemplate?.merchant_hint),
    language_hint: normalizeNullableString(rawTemplate?.language_hint),
    currency_hint: normalizeCurrencyCode(rawTemplate?.currency_hint),
    rois,
    fields: normalizedFields,
    validation_rules: normalizeValidationRules(rawTemplate?.validation_rules),
  };
}

function normalizeTemplateRois(input) {
  const source = Array.isArray(input) ? input : [];
  const normalized = [];
  const seen = new Set();

  for (const roi of source) {
    if (!roi || typeof roi !== 'object') {
      continue;
    }
    const idBase = normalizeNonEmptyString(roi.id) || normalizeKey(roi.label) || `roi_${normalized.length + 1}`;
    const id = dedupeKey(idBase, seen);
    const label = normalizeNonEmptyString(roi.label) || id;
    const purpose = normalizeNonEmptyString(roi.purpose) || '';
    const left = clamp01(roi.left, 0);
    const top = clamp01(roi.top, 0);
    const width = clamp01(roi.width, 1);
    const height = clamp01(roi.height, 1);

    if (width <= 0 || height <= 0) {
      continue;
    }
    if (left + width > 1.0 || top + height > 1.0) {
      continue;
    }

    normalized.push({
      id,
      label,
      purpose,
      left,
      top,
      width,
      height,
    });
    if (normalized.length >= RECEIPT_MAX_ROIS) {
      break;
    }
  }

  if (!normalized.length) {
    return DEFAULT_TEMPLATE_ROIS.map((roi) => ({ ...roi }));
  }

  return normalized;
}

function normalizeTemplateFields(input, roiById = new Set()) {
  const source = Array.isArray(input) ? input : [];
  const normalized = [];
  const seenKeys = new Set();

  for (const field of source) {
    if (!field || typeof field !== 'object') {
      continue;
    }

    const keyBase = normalizeKey(field.key);
    if (!keyBase) {
      continue;
    }
    const key = dedupeKey(keyBase, seenKeys);
    const label = normalizeNonEmptyString(field.label) || startCaseFromSnakeCase(key);
    const type = normalizeFieldType(field.type);
    const required = Boolean(field.required);
    const roiId = normalizeNonEmptyString(field.roi_id);
    const description = normalizeNonEmptyString(field.description) || '';

    normalized.push({
      key,
      label,
      type,
      required,
      roi_id: roiId && roiById.has(roiId) ? roiId : null,
      description,
    });
  }

  return normalized;
}

function ensureDefaultTemplateFields(fields) {
  const normalized = Array.isArray(fields) ? [...fields] : [];
  const existing = new Set(normalized.map((field) => field.key));

  DEFAULT_TEMPLATE_FIELDS.forEach((field) => {
    if (!existing.has(field.key)) {
      normalized.push({ ...field });
    }
  });

  return normalized;
}

function normalizeValidationRules(validationRules) {
  const source = isPlainObject(validationRules) ? validationRules : {};
  const hasArithmetic = source.arithmetic !== undefined
    ? Boolean(source.arithmetic)
    : true;
  const amountTolerance = Number.isFinite(Number(source.amount_tolerance))
    ? Math.max(0, Number(source.amount_tolerance))
    : 0.05;
  return {
    arithmetic: hasArithmetic,
    amount_tolerance: amountTolerance,
    ...source,
  };
}

function normalizeSampleReceipt(sampleReceipt) {
  if (!isPlainObject(sampleReceipt)) {
    return {};
  }
  return sampleReceipt;
}

function normalizeExtractionResult(rawResult, template) {
  const fieldDefs = Array.isArray(template?.normalizedTemplate?.fields)
    ? template.normalizedTemplate.fields
    : ensureDefaultTemplateFields([]);
  const standardized = normalizeStandardizedReceipt(rawResult?.standardized_receipt || {});
  const rawItems = Array.isArray(rawResult?.items) ? rawResult.items : [];
  const items = rawItems.map(normalizeItem).filter(Boolean);
  const inputFields = isPlainObject(rawResult?.normalized_fields) ? rawResult.normalized_fields : {};

  const normalizedFields = {};
  fieldDefs.forEach((field) => {
    const valueFromInput = Object.prototype.hasOwnProperty.call(inputFields, field.key)
      ? inputFields[field.key]
      : inferFieldFromStandardized(field.key, standardized, items);
    normalizedFields[field.key] = normalizeValueByType(valueFromInput, field.type);
  });

  const unreadableFields = Array.isArray(rawResult?.unreadable_fields)
    ? [...new Set(rawResult.unreadable_fields.map((value) => normalizeKey(value)).filter(Boolean))]
    : [];
  const confidence = Number.isFinite(Number(rawResult?.confidence))
    ? clampNumber(Number(rawResult.confidence), 0, 1)
    : 0.6;

  const standardizedReceipt = rebuildStandardizedReceiptFromNormalizedFields({
    normalizedFields,
    fallbackStandardized: standardized,
    items,
  });

  return {
    normalized_fields: normalizedFields,
    standardized_receipt: standardizedReceipt,
    items,
    unreadable_fields: unreadableFields,
    confidence,
  };
}

function mergeRetryIntoResult(currentResult, retryResult, template) {
  const fieldDefs = Array.isArray(template?.normalizedTemplate?.fields)
    ? template.normalizedTemplate.fields
    : [];
  const merged = {
    ...currentResult,
    normalized_fields: {
      ...(currentResult?.normalized_fields || {}),
    },
  };

  const retryFields = isPlainObject(retryResult?.normalized_fields) ? retryResult.normalized_fields : {};
  fieldDefs.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(retryFields, field.key)) {
      return;
    }
    merged.normalized_fields[field.key] = normalizeValueByType(retryFields[field.key], field.type);
  });

  const retryUnreadable = Array.isArray(retryResult?.unreadable_fields)
    ? retryResult.unreadable_fields.map((item) => normalizeKey(item)).filter(Boolean)
    : [];
  const currentUnreadable = Array.isArray(currentResult?.unreadable_fields)
    ? currentResult.unreadable_fields
    : [];
  merged.unreadable_fields = [...new Set([...currentUnreadable, ...retryUnreadable])];

  const retryConfidence = Number.isFinite(Number(retryResult?.confidence))
    ? clampNumber(Number(retryResult.confidence), 0, 1)
    : currentResult?.confidence;
  merged.confidence = Number.isFinite(Number(retryConfidence))
    ? Number(retryConfidence)
    : 0.6;

  merged.standardized_receipt = rebuildStandardizedReceiptFromNormalizedFields({
    normalizedFields: merged.normalized_fields,
    fallbackStandardized: currentResult?.standardized_receipt || {},
    items: currentResult?.items || [],
  });

  return merged;
}

function validateExtractedReceipt({
  normalizedFields,
  standardizedReceipt,
  items,
  template,
}) {
  const fieldDefs = Array.isArray(template?.normalizedTemplate?.fields)
    ? template.normalizedTemplate.fields
    : [];
  const validationRules = isPlainObject(template?.normalizedTemplate?.validation_rules)
    ? template.normalizedTemplate.validation_rules
    : {};
  const tolerance = Number.isFinite(Number(validationRules.amount_tolerance))
    ? Number(validationRules.amount_tolerance)
    : 0.05;

  const missingRequired = [];
  const typeWarnings = [];

  fieldDefs.forEach((field) => {
    const value = normalizedFields?.[field.key];
    if (field.required && isEmptyValue(value)) {
      missingRequired.push(field.key);
    }
    if (!isEmptyValue(value) && !matchesExpectedType(value, field.type)) {
      typeWarnings.push(field.key);
    }
  });

  const subtotal = coerceToNullableNumber(firstDefined(
    normalizedFields?.subtotal,
    standardizedReceipt?.subtotal,
  ));
  const tax = coerceToNullableNumber(firstDefined(
    normalizedFields?.tax,
    standardizedReceipt?.tax,
  ));
  const fee = coerceToNullableNumber(firstDefined(
    normalizedFields?.fee,
    standardizedReceipt?.fee,
  ));
  const discount = coerceToNullableNumber(firstDefined(
    normalizedFields?.discount,
    standardizedReceipt?.discount,
  ));
  const total = coerceToNullableNumber(firstDefined(
    normalizedFields?.total,
    standardizedReceipt?.total,
  ));
  const itemAmountSum = computeItemAmountSum(items);
  const expectedTotal = (subtotal ?? 0) + (tax ?? 0) + (fee ?? 0) - (discount ?? 0);

  const arithmeticIssues = [];
  if (validationRules.arithmetic !== false) {
    if (subtotal !== null && itemAmountSum !== null && !closeEnough(subtotal, itemAmountSum, tolerance)) {
      arithmeticIssues.push('subtotal_mismatch_with_items');
    }
    if (total !== null && subtotal !== null) {
      if (!closeEnough(total, expectedTotal, tolerance)) {
        arithmeticIssues.push('total_mismatch_with_breakdown');
      }
    }
  }

  const issues = [
    ...missingRequired.map((field) => `missing_required:${field}`),
    ...typeWarnings.map((field) => `type_mismatch:${field}`),
    ...arithmeticIssues,
  ];

  return {
    is_valid: issues.length === 0,
    issues,
    missing_required_fields: missingRequired,
    type_mismatch_fields: typeWarnings,
    arithmetic: {
      subtotal,
      item_amount_sum: itemAmountSum,
      expected_total: Number.isFinite(expectedTotal) ? roundToTwo(expectedTotal) : null,
      total,
      tolerance,
      passed: arithmeticIssues.length === 0,
      issues: arithmeticIssues,
    },
  };
}

function collectRetryFieldKeys(validation) {
  if (!validation || typeof validation !== 'object') {
    return [];
  }
  const keys = [];
  const missing = Array.isArray(validation.missing_required_fields)
    ? validation.missing_required_fields
    : [];
  const typeMismatch = Array.isArray(validation.type_mismatch_fields)
    ? validation.type_mismatch_fields
    : [];
  keys.push(...missing, ...typeMismatch);
  if (Array.isArray(validation?.arithmetic?.issues) && validation.arithmetic.issues.length > 0) {
    keys.push('subtotal', 'tax', 'fee', 'discount', 'total');
  }
  return [...new Set(keys.map((key) => normalizeKey(key)).filter(Boolean))];
}

async function fetchRemoteImageBuffer(imageUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RECEIPT_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'user-agent': 'samsar-receipt-parser/1.0',
      },
    });
    if (!response.ok) {
      const error = new Error(`Unable to fetch image_url. Upstream status ${response.status}.`);
      error.statusCode = 400;
      throw error;
    }
    const contentType = `${response.headers.get('content-type') || ''}`.toLowerCase();
    if (!contentType.includes('image/')) {
      const error = new Error('image_url must point to an image resource.');
      error.statusCode = 400;
      throw error;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      const error = new Error('image_url returned an empty image.');
      error.statusCode = 400;
      throw error;
    }
    return buffer;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Timed out while fetching image_url.');
      timeoutError.statusCode = 408;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function preprocessReceiptImage(buffer, { maxWidth }) {
  const image = sharp(buffer, { failOnError: false });
  const metadata = await image.metadata();
  const sourceWidth = Number.isFinite(metadata?.width) ? metadata.width : null;

  let targetWidth = sourceWidth || maxWidth;
  if (sourceWidth && sourceWidth > maxWidth) {
    targetWidth = maxWidth;
  } else if (sourceWidth && sourceWidth < RECEIPT_MIN_WORKING_WIDTH) {
    targetWidth = RECEIPT_MIN_WORKING_WIDTH;
  }

  const processed = await image
    .flatten({ background: '#ffffff' })
    .resize({
      width: targetWidth,
      withoutEnlargement: !(sourceWidth && sourceWidth < RECEIPT_MIN_WORKING_WIDTH),
      fit: 'inside',
    })
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.15, m1: 0.6, m2: 1.3 })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  return processed;
}

async function buildRoiCrops(imageBuffer, rois) {
  const normalizedRois = normalizeTemplateRois(rois);
  if (!normalizedRois.length) {
    return [];
  }

  const metadata = await sharp(imageBuffer).metadata();
  const width = Number.isFinite(metadata?.width) ? metadata.width : null;
  const height = Number.isFinite(metadata?.height) ? metadata.height : null;
  if (!width || !height) {
    return [];
  }

  const crops = [];
  for (const roi of normalizedRois) {
    const left = Math.max(0, Math.floor(roi.left * width));
    const top = Math.max(0, Math.floor(roi.top * height));
    const cropWidth = Math.max(20, Math.floor(roi.width * width));
    const cropHeight = Math.max(20, Math.floor(roi.height * height));

    const safeWidth = Math.min(cropWidth, width - left);
    const safeHeight = Math.min(cropHeight, height - top);
    if (safeWidth < 20 || safeHeight < 20) {
      continue;
    }

    try {
      const cropBuffer = await sharp(imageBuffer)
        .extract({
          left,
          top,
          width: safeWidth,
          height: safeHeight,
        })
        .resize({
          width: Math.min(RECEIPT_QUERY_IMAGE_MAX_WIDTH, 1400),
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 84, mozjpeg: true })
        .toBuffer();

      crops.push({
        id: roi.id,
        label: roi.label,
        purpose: roi.purpose,
        dataUrl: bufferToDataUrl(cropBuffer, 'image/jpeg'),
      });
    } catch (error) {
      console.error('[receipt_template][roi_crop] failed', {
        roi: roi.id,
        error: error?.message || error,
      });
    }
  }

  return crops;
}

function safeHost(url) {
  if (typeof url !== 'string' || !url) {
    return null;
  }
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

async function withTimeout(promise, timeoutMs, label) {
  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.statusCode = 504;
      reject(error);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function parseJsonFromCompletion(completion) {
  const content = completion?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    const parsed = parseJsonLoose(content);
    if (parsed) {
      return parsed;
    }
  }
  if (isPlainObject(content)) {
    return content;
  }
  const error = new Error('Vision response was not valid JSON.');
  error.statusCode = 502;
  throw error;
}

function parseJsonLoose(input) {
  if (typeof input !== 'string') {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1]);
    } catch {
    }
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
    }
  }
  return null;
}

function rebuildStandardizedReceiptFromNormalizedFields({
  normalizedFields,
  fallbackStandardized,
  items,
}) {
  const source = isPlainObject(normalizedFields) ? normalizedFields : {};
  const fallback = normalizeStandardizedReceipt(fallbackStandardized || {});

  const standardizedReceipt = {
    merchant_name: normalizeNullableString(firstDefined(source.merchant_name, fallback.merchant_name)),
    transaction_date: normalizeDate(firstDefined(source.transaction_date, fallback.transaction_date)),
    transaction_time: normalizeNullableString(firstDefined(source.transaction_time, fallback.transaction_time)),
    transaction_id: normalizeNullableString(firstDefined(source.transaction_id, fallback.transaction_id)),
    currency: normalizeCurrencyCode(firstDefined(source.currency, fallback.currency)),
    subtotal: coerceToNullableNumber(firstDefined(source.subtotal, fallback.subtotal)),
    tax: coerceToNullableNumber(firstDefined(source.tax, fallback.tax)),
    fee: coerceToNullableNumber(firstDefined(source.fee, fallback.fee)),
    discount: coerceToNullableNumber(firstDefined(source.discount, fallback.discount)),
    total: coerceToNullableNumber(firstDefined(source.total, fallback.total)),
    payment_method: normalizeNullableString(firstDefined(source.payment_method, fallback.payment_method)),
    from_account: normalizeNullableString(firstDefined(source.from_account, fallback.from_account)),
    to_account: normalizeNullableString(firstDefined(source.to_account, fallback.to_account)),
    items: Array.isArray(items) ? items : [],
  };

  return standardizedReceipt;
}

function normalizeStandardizedReceipt(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    merchant_name: normalizeNullableString(source.merchant_name),
    transaction_date: normalizeDate(source.transaction_date),
    transaction_time: normalizeNullableString(source.transaction_time),
    transaction_id: normalizeNullableString(source.transaction_id),
    currency: normalizeCurrencyCode(source.currency),
    subtotal: coerceToNullableNumber(source.subtotal),
    tax: coerceToNullableNumber(source.tax),
    fee: coerceToNullableNumber(source.fee),
    discount: coerceToNullableNumber(source.discount),
    total: coerceToNullableNumber(source.total),
    payment_method: normalizeNullableString(source.payment_method),
    from_account: normalizeNullableString(source.from_account),
    to_account: normalizeNullableString(source.to_account),
  };
}

function normalizeItem(item) {
  if (!isPlainObject(item)) {
    return null;
  }
  const description = normalizeNonEmptyString(item.description) || '';
  if (!description) {
    return null;
  }
  return {
    description,
    qty: coerceToNullableNumber(item.qty),
    unit_price: coerceToNullableNumber(item.unit_price),
    amount: coerceToNullableNumber(item.amount),
  };
}

function inferFieldFromStandardized(key, standardized, items) {
  if (!key || !isPlainObject(standardized)) {
    return null;
  }
  if (key === 'items') {
    return Array.isArray(items) ? items : [];
  }
  if (Object.prototype.hasOwnProperty.call(standardized, key)) {
    return standardized[key];
  }
  return null;
}

function normalizeValueByType(value, type) {
  if (isEmptyValue(value)) {
    return null;
  }

  const normalizedType = normalizeFieldType(type);
  if (normalizedType === 'number' || normalizedType === 'currency') {
    return coerceToNullableNumber(value);
  }
  if (normalizedType === 'date') {
    return normalizeDate(value);
  }
  if (normalizedType === 'datetime') {
    return normalizeDateTime(value);
  }
  if (normalizedType === 'boolean') {
    return normalizeBoolean(value);
  }
  if (normalizedType === 'array') {
    return Array.isArray(value) ? value : [value];
  }
  if (normalizedType === 'object') {
    return isPlainObject(value) ? value : null;
  }
  return normalizeNullableString(value);
}

function normalizeFieldType(type) {
  const normalized = normalizeNonEmptyString(type)?.toLowerCase() || '';
  if (SUPPORTED_FIELD_TYPES.has(normalized)) {
    return normalized;
  }
  return 'string';
}

function matchesExpectedType(value, type) {
  const normalizedType = normalizeFieldType(type);
  if (isEmptyValue(value)) {
    return true;
  }
  if (normalizedType === 'number' || normalizedType === 'currency') {
    return typeof value === 'number' && Number.isFinite(value);
  }
  if (normalizedType === 'boolean') {
    return typeof value === 'boolean';
  }
  if (normalizedType === 'array') {
    return Array.isArray(value);
  }
  if (normalizedType === 'object') {
    return isPlainObject(value);
  }
  if (normalizedType === 'date') {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }
  if (normalizedType === 'datetime') {
    return typeof value === 'string' && value.length >= 10;
  }
  return typeof value === 'string';
}

function createTemplateHash({
  userId,
  normalizedTemplate,
  sampleReceipt,
  sourceImageUrl,
}) {
  const hashPayload = JSON.stringify({
    userId,
    normalizedTemplate,
    sampleReceipt,
    sourceImageUrl,
  });
  return createHash('sha256').update(hashPayload).digest('hex');
}

function normalizeDate(value) {
  const raw = normalizeNonEmptyString(value);
  if (!raw) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const slashDate = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashDate) {
    const day = Number(slashDate[1]);
    const month = Number(slashDate[2]);
    const year = Number(slashDate[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
        .toString()
        .padStart(2, '0')}`;
    }
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const iso = new Date(parsed).toISOString();
  return iso.slice(0, 10);
}

function normalizeDateTime(value) {
  const raw = normalizeNonEmptyString(value);
  if (!raw) {
    return null;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return raw;
  }
  return new Date(parsed).toISOString();
}

function normalizeCurrencyCode(value) {
  const raw = normalizeNonEmptyString(value);
  if (!raw) {
    return null;
  }
  const normalized = raw.toUpperCase();
  if (/^[A-Z]{3}$/.test(normalized)) {
    return normalized;
  }
  if (normalized.includes('฿') || normalized.includes('BAHT') || normalized === 'THB') {
    return 'THB';
  }
  if (normalized.includes('$') || normalized.includes('USD')) {
    return 'USD';
  }
  if (normalized.includes('EUR') || normalized.includes('€')) {
    return 'EUR';
  }
  return normalized.slice(0, 8);
}

function coerceToNullableNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? roundToTwo(value) : null;
  }
  if (typeof value === 'string') {
    const stripped = value
      .replace(/[,\s]/g, '')
      .replace(/[^\d.\-]/g, '');
    if (!stripped) {
      return null;
    }
    const parsed = Number(stripped);
    return Number.isFinite(parsed) ? roundToTwo(parsed) : null;
  }
  return null;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') {
    return value;
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
  return Boolean(value);
}

function bufferToDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function normalizeNullableString(value) {
  const normalized = normalizeNonEmptyString(value);
  return normalized || null;
}

function normalizeNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function normalizeKey(value) {
  const raw = normalizeNonEmptyString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return raw || '';
}

function dedupeKey(base, seen) {
  let candidate = base;
  let idx = 2;
  while (seen.has(candidate)) {
    candidate = `${base}_${idx}`;
    idx += 1;
  }
  seen.add(candidate);
  return candidate;
}

function startCaseFromSnakeCase(value) {
  return normalizeNonEmptyString(value)
    .split('_')
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part))
    .join(' ')
    .trim();
}

function isLikelyHttpUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isEmptyValue(value) {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string' && value.trim().length === 0) {
    return true;
  }
  if (Array.isArray(value) && value.length === 0) {
    return true;
  }
  return false;
}

function clamp01(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function computeItemAmountSum(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }
  const values = items
    .map((item) => coerceToNullableNumber(item?.amount))
    .filter((value) => value !== null);
  if (!values.length) {
    return null;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return roundToTwo(sum);
}

function closeEnough(a, b, tolerance = 0.05) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  return Math.abs(a - b) <= tolerance;
}

function roundToTwo(value) {
  return Math.round(value * 100) / 100;
}

function ensureOpenAIClient() {
  if (!openaiClient) {
    const error = new Error('OPENAI_API_KEY is not configured for receipt extraction.');
    error.statusCode = 500;
    throw error;
  }
}
