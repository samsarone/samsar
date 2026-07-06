import express from 'express';
import { resolveRequestActorFromAuthHeaders } from '../../models/external/User.js';
import {
  CHAT_CREDIT_COST,
  chargeCreditsForChat,
  refundCreditsForChat,
  requestChatEnhance,
  saveUserAPIChatSession,
} from '../../models/api/ChatAPI.js';
import {
  createEmbeddingsFromJsonArray,
  createEmbeddingsFromPlainText,
  createEmbeddingsFromUrls,
  listEmbeddingTemplates,
  searchEmbeddings,
  checkEmbeddingStatus,
  similarToEmbeddings,
  updateEmbeddingsForTemplate,
  deleteEmbeddingsForTemplate,
  deleteEmbeddingRecordsForTemplate,
} from '../../models/embeddings/EmbeddingService.js';
import { getBillingPortalUrl } from '../../models/BillingPortal.js';

const router = express.Router();
const BILLING_PORTAL_URL = getBillingPortalUrl();
const PURCHASE_CREDITS_ENDPOINT = '/v1/credits/recharge';
const INSUFFICIENT_CREDITS_MESSAGE =
  `Insufficient credits or no credits remaining. Please call ${PURCHASE_CREDITS_ENDPOINT} ` +
  `or visit ${BILLING_PORTAL_URL} to purchase credits with a one-time top-up. ` +
  `If auto-recharge is enabled, update the threshold via /v1/auto_recharge/threshold or the billing page.`;

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'chat-api',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

async function validateAPIKeyAndUserId(req, res, next) {
  try {
    const authContext = await resolveRequestActorFromAuthHeaders(req.headers);
    if (!['api_key', 'auth_token', 'app_key'].includes(authContext.authType)) {
      return res.status(403).json({
        message: 'Use a Samsar API key, user auth token, or APP_KEY for this route.',
      });
    }

    req.userId = authContext.internalUserId;
    req.authType = authContext.authType;
    next();
  } catch (error) {
    if (error?.code === 'API_KEY_EXPIRED' || error?.code === 'APP_KEY_EXPIRED') {
      return res.status(401).json({
        message: error.message,
      });
    }
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while validating API_KEY, auth token, or APP_KEY.',
    });
  }
}


async function handleEnhanceRequest(req, res) {
  try {
    const { metadata, message, language, maxwords, maxWords } = req.body || {};

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        message: 'message is required.',
      });
    }

    const userId = req.userId;

    let charged = false;
    let chargeResult;

    try {
      chargeResult = await chargeCreditsForChat(userId, CHAT_CREDIT_COST);
      charged = true;
    } catch (chargeError) {
      if (chargeError.code === 'INSUFFICIENT_CREDITS') {
        return res.status(402).json({
          message: INSUFFICIENT_CREDITS_MESSAGE,
        });
      }
      throw chargeError;
    }

    const payload = {
      metadata,
      message: message.trim(),
      userId,
      language,
      maxwords: maxwords ?? maxWords,
    };

    try {
      const { openaiResponse, enhancedMessage } = await requestChatEnhance(payload);

      res.set('x-credits-charged', CHAT_CREDIT_COST.toString());
      if (chargeResult?.remainingCredits !== undefined) {
        res.set('x-credits-remaining', chargeResult.remainingCredits.toString());
      }
      const content = enhancedMessage || openaiResponse?.choices?.[0]?.message?.content || '';
      res.status(200).json({ content });
    } catch (error) {
      console.error('[api][chat][enhance] requestChatEnhance failed', {
        userId,
        status: error?.status || error?.response?.status || null,
        messageLength: typeof message === 'string' ? message.trim().length : 0,
        metadataKeys: metadata && typeof metadata === 'object' ? Object.keys(metadata) : [],
        openaiError: summarizeOpenAIError(error),
      });

      if (charged) {
        await refundCreditsForChat(userId, CHAT_CREDIT_COST);
      }

      await saveUserAPIChatSession({
        userId,
        metadata,
        inputMessage: message.trim(),
        responseMessage: null,
        inferenceModel: null,
        model: null,
        creditsCharged: charged ? CHAT_CREDIT_COST : 0,
        status: 'error',
        errorMessage: error?.message,
      });
      const statusCode = error?.status || error?.response?.status;
      res.status(statusCode || 500).json({
        message: 'Internal server error while enhancing chat.',
      });
    }
  } catch (error) {
    console.error('[api][chat][enhance] failed', {
      userId: req.userId ?? null,
      status: error?.status || error?.response?.status || null,
      openaiError: summarizeOpenAIError(error),
    });
    res.status(500).json({
      message: 'Internal server error while enhancing chat.',
    });
  }
}

router.post('/enhance', validateAPIKeyAndUserId, handleEnhanceRequest);

function summarizeOpenAIError(error) {
  if (!error) {
    return null;
  }

  const apiError = error?.error;
  const headers = error?.headers || error?.response?.headers;
  const requestId =
    error?.request_id ||
    error?.requestId ||
    headers?.['x-request-id'] ||
    headers?.['x-request_id'] ||
    headers?.['x-openai-request-id'] ||
    headers?.['x-openai-request_id'] ||
    null;

  return {
    name: error?.name,
    message: error?.message,
    status: error?.status ?? error?.response?.status ?? null,
    code: error?.code ?? apiError?.code ?? null,
    type: error?.type ?? apiError?.type ?? null,
    param: error?.param ?? apiError?.param ?? null,
    requestId,
  };
}

function getRecordsFromBody(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const records =
    body.records ||
    body.data ||
    body.items ||
    body.json ||
    body.json_array ||
    body.documents;
  return Array.isArray(records) ? records : null;
}

function getUrlsFromBody(body) {
  if (typeof body === 'string' && body.trim()) {
    return [body.trim()];
  }

  if (!body || typeof body !== 'object') {
    return null;
  }

  const candidate =
    body.urls ||
    body.url_list ||
    body.urlList ||
    body.source_urls ||
    body.sourceUrls ||
    body.url ||
    null;

  if (Array.isArray(candidate)) {
    return candidate;
  }

  if (typeof candidate === 'string' && candidate.trim()) {
    return [candidate.trim()];
  }

  return null;
}

function getUrlCrawlLevelsFromRequest(req) {
  const body = req?.body && typeof req.body === 'object' ? req.body : null;
  const query = req?.query && typeof req.query === 'object' ? req.query : null;

  return (
    query?.levels ??
    query?.level ??
    query?.crawl_levels ??
    query?.crawlLevels ??
    body?.levels ??
    body?.level ??
    body?.crawl_levels ??
    body?.crawlLevels ??
    body?.max_depth ??
    body?.maxDepth ??
    undefined
  );
}

function getFieldOptionsFromBody(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  return (
    body.field_options ||
    body.fieldOptions ||
    body.field_config ||
    body.fieldConfig ||
    body.field_flags ||
    body.fieldFlags ||
    body.column_types ||
    body.columnTypes
  );
}

function getEmbeddingTtlMinutesFromBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const rawValue = body.ttl_minutes ?? body.ttlMinutes;
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return null;
  }

  const parsed = typeof rawValue === 'string' ? Number(rawValue.trim()) : Number(rawValue);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error('ttl_minutes must be a positive integer number of minutes.');
    error.statusCode = 400;
    throw error;
  }

  return parsed;
}

function getPlainTextDataFromBody(body) {
  if (typeof body === 'string' || Array.isArray(body)) {
    return body;
  }

  if (!body || typeof body !== 'object') {
    return null;
  }

  const candidate =
    body.plain_text ??
    body.plainText ??
    body.plain_texts ??
    body.plainTexts ??
    body.texts ??
    body.documents ??
    body.items ??
    body.entries;

  if (candidate !== undefined && candidate !== null) {
    return candidate;
  }

  if (
    typeof body.content === 'string' ||
    typeof body.text === 'string' ||
    typeof body.markdown === 'string' ||
    typeof body.cleaned_text === 'string' ||
    typeof body.cleanedText === 'string'
  ) {
    return body;
  }

  return null;
}

function getEmbeddingSourceIdsFromBody(body) {
  if (!body || typeof body !== 'object') {
    return [];
  }
  const ids = [];
  const pushIds = (value) => {
    if (Array.isArray(value)) {
      ids.push(...value);
      return;
    }
    if (value !== undefined && value !== null) {
      ids.push(value);
    }
  };
  pushIds(
    body.source_ids ||
      body.sourceIds ||
      body.ids ||
      body.record_ids ||
      body.recordIds,
  );
  pushIds(
    body.source_id ||
      body.sourceId ||
      body.id ||
      body.record_id ||
      body.recordId,
  );
  const normalized = ids
    .map((value) => (typeof value === 'number' || typeof value === 'string' ? String(value).trim() : ''))
    .filter((value) => value);
  return [...new Set(normalized)];
}

function getSearchRecordFromBody(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const candidate =
    body.search_json ||
    body.searchJson ||
    body.search_record ||
    body.searchRecord ||
    body.record ||
    body.json ||
    body.payload;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  return candidate;
}

function getSearchFilterPayloadFromBody(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const candidate =
    body.search_params ||
    body.searchParams ||
    body.search_param ||
    body.searchParam ||
    body.search_filters ||
    body.searchFilters ||
    body.filter_payload ||
    body.filterPayload ||
    body.pre_filter ||
    body.preFilter ||
    body.prefilter;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  return candidate;
}

function getFilterConfigFromBody(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  const candidate =
    body.filter_config ||
    body.filterConfig ||
    body.filter_options ||
    body.filterOptions;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return null;
  }
  return candidate;
}

function normalizeBoolean(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }
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

function setCreditHeaders(res, creditsCharged, remainingCredits) {
  if (creditsCharged !== undefined && creditsCharged !== null) {
    res.set('x-credits-charged', creditsCharged.toString());
  }
  if (remainingCredits !== undefined && remainingCredits !== null) {
    res.set('x-credits-remaining', remainingCredits.toString());
  }
}

function handleEmbeddingError(req, res, endpoint, error, message) {
  if (error?.code === 'INSUFFICIENT_CREDITS') {
    return res.status(402).json({
      message: INSUFFICIENT_CREDITS_MESSAGE,
    });
  }
  const statusCode = error?.statusCode || error?.status || error?.response?.status;
  const payload = {
    message: error?.message || message,
  };
  if (error?.code) {
    payload.code = error.code;
  }
  if (error?.details) {
    payload.details = error.details;
  }
  if (error?.jobId) {
    payload.job_id = error.jobId;
  }
  res.status(statusCode || 500).json(payload);
}

function respondWithEmbeddingValidationError(req, res, endpoint, message) {
  return res.status(400).json({ message });
}

async function handleSearchAgainstEmbeddingRequest(req, res, endpoint) {
  try {
    const templateId = req.body?.template_id || req.body?.templateId;
    const searchTerm = req.body?.search_term || req.body?.searchTerm || req.body?.query;
    const filterPayload = getSearchFilterPayloadFromBody(req.body);
    const filterConfig = getFilterConfigFromBody(req.body);
    const searchDate = req.body?.search_date || req.body?.searchDate;
    const structuredFilters = req.body?.structured_filters || req.body?.filters;
    if (!templateId || typeof templateId !== 'string') {
      return respondWithEmbeddingValidationError(req, res, endpoint, 'template_id is required.');
    }
    if (!searchTerm || typeof searchTerm !== 'string') {
      return respondWithEmbeddingValidationError(req, res, endpoint, 'search_term is required.');
    }

    const result = await searchEmbeddings({
      userId: req.userId,
      templateId,
      searchTerm,
      searchDate,
      filterConfig,
      limit: req.body?.limit,
      numCandidates: req.body?.num_candidates || req.body?.numCandidates,
      structuredFilters,
      filterPayload,
      rerank: normalizeBoolean(req.body?.rerank),
      includeRaw: normalizeBoolean(req.body?.include_raw, true),
    });

    setCreditHeaders(res, result.creditsCharged, result.remainingCredits);
    const responsePayload = {
      template_id: result.templateId,
      template_name: result.templateName,
      structured_filters: result.structuredFilters,
      results: result.results,
    };
    res.status(200).json(responsePayload);
  } catch (error) {
    handleEmbeddingError(req, res, endpoint, error, 'Internal server error while searching embeddings.');
  }
}

async function handleSimilarToEmbeddingRequest(req, res, endpoint) {
  try {
    const templateId = req.body?.template_id || req.body?.templateId;
    const searchTerm = req.body?.search_term || req.body?.searchTerm || req.body?.query;
    const searchRecord = getSearchRecordFromBody(req.body);
    const filterPayload = getSearchFilterPayloadFromBody(req.body);
    const filterConfig = getFilterConfigFromBody(req.body);
    const searchDate = req.body?.search_date || req.body?.searchDate;
    if (!templateId || typeof templateId !== 'string') {
      return respondWithEmbeddingValidationError(req, res, endpoint, 'template_id is required.');
    }
    if ((!searchTerm || typeof searchTerm !== 'string') && !searchRecord) {
      return respondWithEmbeddingValidationError(req, res, endpoint, 'search_term or search_json is required.');
    }

    const result = await similarToEmbeddings({
      userId: req.userId,
      templateId,
      searchTerm,
      searchRecord,
      searchDate,
      filterConfig,
      limit: req.body?.limit,
      minResults: req.body?.min_results || req.body?.minResults,
      numCandidates: req.body?.num_candidates || req.body?.numCandidates,
      structuredFilters: req.body?.structured_filters || req.body?.filters,
      filterPayload,
    });

    setCreditHeaders(res, result.creditsCharged, result.remainingCredits);
    const responsePayload = {
      template_id: result.templateId,
      structured_filters: result.structuredFilters,
      matches: result.matches,
    };
    res.status(200).json(responsePayload);
  } catch (error) {
    handleEmbeddingError(
      req,
      res,
      endpoint,
      error,
      'Internal server error while finding similar embeddings.',
    );
  }
}

async function handleDeleteEmbeddingsRequest(req, res) {
  try {
    const templateId = req.body?.template_id || req.body?.templateId;
    if (!templateId || typeof templateId !== 'string') {
      return respondWithEmbeddingValidationError(
        req,
        res,
        '/chat/delete_embeddings',
        'template_id is required.',
      );
    }

    const result = await deleteEmbeddingsForTemplate({
      userId: req.userId,
      templateId,
    });

    const responsePayload = {
      template_id: result.templateId,
      deleted_count: result.deletedCount,
      record_count: result.recordCount,
      status: result.recordCount > 0 ? 'ready' : 'empty',
    };
    res.status(200).json(responsePayload);
  } catch (error) {
    handleEmbeddingError(
      req,
      res,
      '/chat/delete_embeddings',
      error,
      'Internal server error while deleting embeddings.',
    );
  }
}

async function handleDeleteEmbeddingRecordRequest(req, res, endpoint) {
  try {
    const templateId = req.body?.template_id || req.body?.templateId;
    if (!templateId || typeof templateId !== 'string') {
      return respondWithEmbeddingValidationError(
        req,
        res,
        endpoint,
        'template_id is required.',
      );
    }
    const sourceIds = getEmbeddingSourceIdsFromBody(req.body);
    if (!sourceIds.length) {
      return respondWithEmbeddingValidationError(
        req,
        res,
        endpoint,
        'source_id or source_ids is required.',
      );
    }

    const result = await deleteEmbeddingRecordsForTemplate({
      userId: req.userId,
      templateId,
      sourceIds,
    });

    const responsePayload = {
      template_id: result.templateId,
      deleted_count: result.deletedCount,
      record_count: result.recordCount,
      status: result.recordCount > 0 ? 'ready' : 'empty',
    };
    res.status(200).json(responsePayload);
  } catch (error) {
    handleEmbeddingError(
      req,
      res,
      endpoint,
      error,
      'Internal server error while deleting embedding.',
    );
  }
}

router.post('/create_embedding', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const records = getRecordsFromBody(req.body);
    const urls = getUrlsFromBody(req.body);
    const hasRecords = Array.isArray(records) && records.length > 0;
    if (!hasRecords && !urls) {
      return respondWithEmbeddingValidationError(
        req,
        res,
        '/chat/create_embedding',
        'records must be a non-empty array or urls must contain at least one URL.',
      );
    }

    const fieldOptions = getFieldOptionsFromBody(req.body);
    const ttlMinutes = getEmbeddingTtlMinutesFromBody(req.body);
    const levels = getUrlCrawlLevelsFromRequest(req);
    const name =
      req.body?.name ||
      req.body?.embedding_name ||
      req.body?.template_name ||
      null;

    const result = hasRecords
      ? await createEmbeddingsFromJsonArray({
        userId: req.userId,
        name,
        records,
        fieldOptions,
        ttlMinutes,
      })
      : await createEmbeddingsFromUrls({
        userId: req.userId,
        name,
        urls,
        fieldOptions,
        levels,
        ttlMinutes,
      });

    setCreditHeaders(res, result.creditsCharged, result.remainingCredits);
    const responsePayload = {
      template_id: result.templateId,
      template_hash: result.templateHash,
      hash_link: result.hashLink,
      record_count: result.recordCount,
      structured_fields: result.structuredFields,
      unstructured_fields: result.unstructuredFields,
    };
    if (result.inputUrlCount !== undefined) {
      responsePayload.input_url_count = result.inputUrlCount;
      responsePayload.processed_url_count = result.processedUrlCount;
      responsePayload.firecrawl_credits_used = result.firecrawlCreditsUsed;
      responsePayload.crawl_levels = result.crawlLevels;
      responsePayload.max_links = result.maxLinks;
      if (Array.isArray(result.skippedUrls) && result.skippedUrls.length > 0) {
        responsePayload.skipped_urls = result.skippedUrls;
      }
      if (Array.isArray(result.crawlErrors) && result.crawlErrors.length > 0) {
        responsePayload.crawl_errors = result.crawlErrors;
      }
    }
    if (result.ttlMinutes !== null && result.ttlMinutes !== undefined) {
      responsePayload.ttl_minutes = result.ttlMinutes;
      responsePayload.expires_at = result.expiresAt;
    }
    res.status(200).json(responsePayload);
  } catch (error) {
    handleEmbeddingError(
      req,
      res,
      '/chat/create_embedding',
      error,
      'Internal server error while creating embeddings.',
    );
  }
});

router.post('/create_embedding_from_url', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const urls = getUrlsFromBody(req.body);
    if (!urls) {
      return respondWithEmbeddingValidationError(
        req,
        res,
        '/chat/create_embedding_from_url',
        'urls must contain at least one URL.',
      );
    }

    const fieldOptions = getFieldOptionsFromBody(req.body);
    const ttlMinutes = getEmbeddingTtlMinutesFromBody(req.body);
    const levels = getUrlCrawlLevelsFromRequest(req);
    const name =
      req.body?.name ||
      req.body?.embedding_name ||
      req.body?.template_name ||
      null;

    const result = await createEmbeddingsFromUrls({
      userId: req.userId,
      name,
      urls,
      fieldOptions,
      levels,
      ttlMinutes,
    });

    setCreditHeaders(res, result.creditsCharged, result.remainingCredits);
    const responsePayload = {
      template_id: result.templateId,
      template_hash: result.templateHash,
      hash_link: result.hashLink,
      record_count: result.recordCount,
      structured_fields: result.structuredFields,
      unstructured_fields: result.unstructuredFields,
      input_url_count: result.inputUrlCount,
      processed_url_count: result.processedUrlCount,
      firecrawl_credits_used: result.firecrawlCreditsUsed,
      crawl_levels: result.crawlLevels,
      max_links: result.maxLinks,
    };
    if (Array.isArray(result.skippedUrls) && result.skippedUrls.length > 0) {
      responsePayload.skipped_urls = result.skippedUrls;
    }
    if (Array.isArray(result.crawlErrors) && result.crawlErrors.length > 0) {
      responsePayload.crawl_errors = result.crawlErrors;
    }
    if (result.ttlMinutes !== null && result.ttlMinutes !== undefined) {
      responsePayload.ttl_minutes = result.ttlMinutes;
      responsePayload.expires_at = result.expiresAt;
    }
    res.status(200).json(responsePayload);
  } catch (error) {
    handleEmbeddingError(
      req,
      res,
      '/chat/create_embedding_from_url',
      error,
      'Internal server error while creating embeddings from URLs.',
    );
  }
});

router.post('/generate_embeddings_from_plain_text', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const plainTextData = getPlainTextDataFromBody(req.body);
    if (plainTextData === null || plainTextData === undefined) {
      return respondWithEmbeddingValidationError(
        req,
        res,
        '/chat/generate_embeddings_from_plain_text',
        'plain_text must contain at least one cleaned plain text entry.',
      );
    }

    const fieldOptions = getFieldOptionsFromBody(req.body);
    const ttlMinutes = getEmbeddingTtlMinutesFromBody(req.body);
    const name =
      req.body?.name ||
      req.body?.embedding_name ||
      req.body?.template_name ||
      null;

    const result = await createEmbeddingsFromPlainText({
      userId: req.userId,
      name,
      plainTextData,
      fieldOptions,
      ttlMinutes,
    });

    setCreditHeaders(res, result.creditsCharged, result.remainingCredits);
    const responsePayload = {
      template_id: result.templateId,
      template_hash: result.templateHash,
      hash_link: result.hashLink,
      record_count: result.recordCount,
      structured_fields: result.structuredFields,
      unstructured_fields: result.unstructuredFields,
    };
    if (result.ttlMinutes !== null && result.ttlMinutes !== undefined) {
      responsePayload.ttl_minutes = result.ttlMinutes;
      responsePayload.expires_at = result.expiresAt;
    }
    res.status(200).json(responsePayload);
  } catch (error) {
    handleEmbeddingError(
      req,
      res,
      '/chat/generate_embeddings_from_plain_text',
      error,
      'Internal server error while creating embeddings from plain text.',
    );
  }
});

router.post('/update_embedding', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const records = getRecordsFromBody(req.body);
    const templateId = req.body?.template_id || req.body?.templateId;
    if (!templateId || typeof templateId !== 'string') {
      return respondWithEmbeddingValidationError(
        req,
        res,
        '/chat/update_embedding',
        'template_id is required.',
      );
    }
    if (!records) {
      return respondWithEmbeddingValidationError(
        req,
        res,
        '/chat/update_embedding',
        'records must be a non-empty array.',
      );
    }

    const fieldOptions = getFieldOptionsFromBody(req.body);
    const result = await updateEmbeddingsForTemplate({
      userId: req.userId,
      templateId,
      records,
      fieldOptions,
    });

    setCreditHeaders(res, result.creditsCharged, result.remainingCredits);
    const responsePayload = {
      template_id: result.templateId,
      template_hash: result.templateHash,
      record_count: result.recordCount,
      structured_fields: result.structuredFields,
      unstructured_fields: result.unstructuredFields,
    };
    res.status(200).json(responsePayload);
  } catch (error) {
    handleEmbeddingError(
      req,
      res,
      '/chat/update_embedding',
      error,
      'Internal server error while updating embeddings.',
    );
  }
});

router.post('/search_against_embedding', validateAPIKeyAndUserId, async (req, res) => {
  await handleSearchAgainstEmbeddingRequest(req, res, '/chat/search_against_embedding');
});

router.post('/search_against_embeddings', validateAPIKeyAndUserId, async (req, res) => {
  await handleSearchAgainstEmbeddingRequest(req, res, '/chat/search_against_embeddings');
});

router.post('/delete_embeddings', validateAPIKeyAndUserId, async (req, res) => {
  await handleDeleteEmbeddingsRequest(req, res);
});

router.post('/delete_embedding', validateAPIKeyAndUserId, async (req, res) => {
  await handleDeleteEmbeddingRecordRequest(req, res, '/chat/delete_embedding');
});

router.post('/similar_to_embedding', validateAPIKeyAndUserId, async (req, res) => {
  await handleSimilarToEmbeddingRequest(req, res, '/chat/similar_to_embedding');
});

router.post('/similar_to_embeddings', validateAPIKeyAndUserId, async (req, res) => {
  await handleSimilarToEmbeddingRequest(req, res, '/chat/similar_to_embeddings');
});

router.get('/embedding_templates', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const limit = req.query?.limit;
    const offset = req.query?.offset;

    const result = await listEmbeddingTemplates({
      userId: req.userId,
      limit,
      offset,
    });

    res.status(200).json(result);
  } catch (error) {
    handleEmbeddingError(
      req,
      res,
      '/chat/embedding_templates',
      error,
      'Internal server error while listing embeddings.',
    );
  }
});

router.get('/embedding_status', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const templateId = req.query?.template_id || req.query?.templateId;
    if (!templateId || typeof templateId !== 'string') {
      return respondWithEmbeddingValidationError(
        req,
        res,
        '/chat/embedding_status',
        'template_id is required.',
      );
    }

    const result = await checkEmbeddingStatus({
      userId: req.userId,
      templateId,
    });

    res.status(200).json(result);
  } catch (error) {
    handleEmbeddingError(
      req,
      res,
      '/chat/embedding_status',
      error,
      'Internal server error while checking embedding status.',
    );
  }
});


export default router;
