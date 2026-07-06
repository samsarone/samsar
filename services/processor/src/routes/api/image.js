import express from 'express';
import Busboy from 'busboy';
import { resolveRequestActorFromAuthHeaders } from '../../models/external/User.js';
import {
  removeBrandingFromImage,
  updateImageSet,
  enhanceImage,
  generateTextToImage,
  getImageStatus,
  listImageSessions,
  createRollupBanner,
  enhanceAndGenerateRollupBanner,
} from '../../models/api/ImageAPI.js';
import { assignTitleToImage } from '../../models/api/ImageTitleAPI.js';
import {
  createReceiptTemplate,
  getReceiptTemplateJson,
  queryReceiptAgainstTemplate,
} from '../../models/api/ReceiptTemplateAPI.js';
import { getBillingPortalUrl } from '../../models/BillingPortal.js';

const router = express.Router();
const BILLING_PORTAL_URL = getBillingPortalUrl();
const PURCHASE_CREDITS_ENDPOINT = '/v1/credits/recharge';
const INSUFFICIENT_CREDITS_MESSAGE =
  `Insufficient credits or no credits remaining. Please call ${PURCHASE_CREDITS_ENDPOINT} ` +
  `or visit ${BILLING_PORTAL_URL} to purchase credits with a one-time top-up. ` +
  `If auto-recharge is enabled, update the threshold via /v1/auto_recharge/threshold or the billing page.`;
const ASSIGN_TITLE_MAX_IMAGE_BYTES = Number.isFinite(Number(process.env.IMAGE_ASSIGN_TITLE_MAX_IMAGE_BYTES))
  ? Math.max(1024, Math.floor(Number(process.env.IMAGE_ASSIGN_TITLE_MAX_IMAGE_BYTES)))
  : 50 * 1024 * 1024;
const ASSIGN_TITLE_IMAGE_FIELD_NAMES = new Set(['image', 'file', 'image_file', 'imageFile']);
const ASSIGN_TITLE_SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'image-api',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

function parseBooleanQuery(value) {
  if (typeof value !== 'string') {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'n'].includes(normalized)) {
    return false;
  }
  return false;
}

function stringifyJsonResponse(res, value) {
  const app = res?.app;
  const escape = app?.get?.('json escape');
  const replacer = app?.get?.('json replacer');
  const spaces = app?.get?.('json spaces');

  let json = replacer || spaces
    ? JSON.stringify(value, replacer, spaces)
    : JSON.stringify(value);

  if (escape && typeof json === 'string') {
    json = json.replace(/[<>&]/g, (char) => {
      switch (char.charCodeAt(0)) {
        case 0x3c:
          return '\\u003c';
        case 0x3e:
          return '\\u003e';
        case 0x26:
          return '\\u0026';
        default:
          return char;
      }
    });
  }

  return json;
}

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

router.get('/status', validateAPIKeyAndUserId, async (req, res) => {
  const rawRequestId = req.query.request_id || req.query.session_id;
  const requestId = typeof rawRequestId === 'string' ? rawRequestId.trim() : '';
  const sendStatusResponse = ({ statusCode, payload, status = null }) => {
    res.locals.statusEndpointStatus = status || null;
    if (!res.get('Content-Type')) {
      res.set('Content-Type', 'application/json');
    }
    return res.status(statusCode).send(payload);
  };

  try {
    if (!requestId) {
      const errorPayload = stringifyJsonResponse(res, {
        message: 'request_id (or session_id) query param is required.',
      });
      return sendStatusResponse({ statusCode: 400, payload: errorPayload });
    }

    const response = await getImageStatus({
      requestId,
      userId: req.userId,
    });

    const responsePayload = stringifyJsonResponse(res, response);
    return sendStatusResponse({
      statusCode: 200,
      payload: responsePayload,
      status: response?.status || null,
    });
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    const errorResponse = {
      message: error?.message || 'Internal server error while fetching image status.',
    };
    const errorPayload = stringifyJsonResponse(res, errorResponse);
    console.error('[api][image][status] failed', {
      sessionId: requestId || null,
      userId: req.userId,
      error: error?.message || error,
    });
    return sendStatusResponse({ statusCode: statusCode || 500, payload: errorPayload });
  }
});

router.get('/list', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const caseType = typeof req.query.case_type === 'string' ? req.query.case_type.trim() : null;
    const rollupReadyParamProvided = Object.prototype.hasOwnProperty.call(req.query, 'rollup_ready');
    const rollupReadyOnly = rollupReadyParamProvided
      ? parseBooleanQuery(req.query.rollup_ready)
      : caseType === 'image_enhance';
    const includeRollupReady = parseBooleanQuery(req.query.include_rollup_ready);
    const sessions = await listImageSessions({
      userId: req.userId,
      limit: req.query.limit,
      caseType,
      rollupReadyOnly,
      includeRollupReady,
    });

    res.status(200).json({ sessions });
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while listing image sessions.',
    });
  }
});

router.post('/add_image_set', validateAPIKeyAndUserId, handleAddImageSet);
router.post(['/text_to_image', '/generate', '/generations'], validateAPIKeyAndUserId, handleTextToImageRequest);

function resolveStringField(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function resolveReceiptTemplateImageUrl(body) {
  if (!body || typeof body !== 'object') {
    return null;
  }
  return (
    resolveStringField(body.image_url)
    || resolveStringField(body.receipt_url)
    || resolveStringField(body.template_url)
  );
}

function resolveHost(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }
  try {
    return new URL(value).host || null;
  } catch {
    return null;
  }
}

async function handleCreateReceiptTemplate(req, res) {
  try {
    const startedAt = Date.now();
    const imageUrl = resolveReceiptTemplateImageUrl(req.body || {});
    const template_name = resolveStringField(req.body?.template_name)
      || resolveStringField(req.body?.templateName);


    if (!imageUrl) {
      return res.status(400).json({
        message: 'image_url (or receipt_url/template_url) is required.',
      });
    }

    const response = await createReceiptTemplate({
      userId: req.userId,
      image_url: imageUrl,
      template_name: template_name || null,
    });


    res.status(200).json(response);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    console.error('[api][receipt_template][create] failed', {
      userId: req.userId,
      statusCode: statusCode || 500,
      message: error?.message || error,
    });
    res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while creating receipt template.',
    });
  }
}

async function handleQueryReceiptTemplate(req, res) {
  try {
    const startedAt = Date.now();
    const imageUrl = resolveReceiptTemplateImageUrl(req.body || {});
    const templateId = resolveStringField(req.body?.template_id)
      || resolveStringField(req.body?.templateId)
      || resolveStringField(req.body?.receipt_template_id)
      || resolveStringField(req.body?.receiptTemplateId);


    if (!imageUrl) {
      return res.status(400).json({
        message: 'image_url (or receipt_url) is required.',
      });
    }

    if (!templateId) {
      return res.status(400).json({
        message: 'template_id is required.',
      });
    }

    const response = await queryReceiptAgainstTemplate({
      userId: req.userId,
      image_url: imageUrl,
      template_id: templateId,
    });


    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    console.error('[api][receipt_template][query] failed', {
      userId: req.userId,
      statusCode: statusCode || 500,
      message: error?.message || error,
    });
    res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while querying receipt template.',
    });
  }
}

async function handleGetReceiptTemplateJson(req, res) {
  try {
    const startedAt = Date.now();
    const templateId = resolveStringField(req.query?.template_id)
      || resolveStringField(req.query?.templateId)
      || resolveStringField(req.query?.receipt_template_id)
      || resolveStringField(req.query?.receiptTemplateId)
      || resolveStringField(req.query?.id);


    if (!templateId) {
      return res.status(400).json({
        message: 'template_id query param is required.',
      });
    }

    const response = await getReceiptTemplateJson({
      userId: req.userId,
      template_id: templateId,
    });


    return res.status(200).json(response);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    console.error('[api][receipt_template][template_json] failed', {
      userId: req.userId,
      statusCode: statusCode || 500,
      message: error?.message || error,
    });
    return res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while fetching receipt template JSON.',
    });
  }
}

router.get(
  ['/template_json', '/receipt_templates/template_json'],
  validateAPIKeyAndUserId,
  handleGetReceiptTemplateJson,
);

router.post(
  ['/receipt_templates/create', '/create-receipt-template'],
  validateAPIKeyAndUserId,
  handleCreateReceiptTemplate,
);

router.post(
  ['/receipt_templates/query', '/verify-against-template'],
  validateAPIKeyAndUserId,
  handleQueryReceiptTemplate,
);

router.post('/assign_title', validateAPIKeyAndUserId, parseAssignTitleRequest, handleAssignTitleRequest);

async function handleAssignTitleRequest(req, res) {
  try {
    const requestPayload = req.assignTitlePayload || req.body || {};
    const response = await assignTitleToImage({
      ...requestPayload,
      metadata: requestPayload.metadata ?? requestPayload.metadata_json ?? requestPayload.metadataJson,
      userId: req.userId,
    });

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    return res.status(200).json({ content: response.title });
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }

    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    console.error('[api][image][assign_title] failed', {
      userId: req.userId,
      statusCode: statusCode || 500,
      message: error?.message || error,
    });

    return res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while assigning image title.',
    });
  }
}

function parseAssignTitleRequest(req, res, next) {
  if (isMultipartRequest(req)) {
    parseMultipartAssignTitleRequest(req)
      .then((payload) => {
        req.assignTitlePayload = payload;
        next();
      })
      .catch((error) => {
        const statusCode = error?.statusCode || error?.status || 400;
        res.status(statusCode).json({
          message: error?.message || 'Unable to parse assign_title multipart request.',
        });
      });
    return;
  }

  if (isRawImageRequest(req)) {
    parseRawImageAssignTitleRequest(req)
      .then((payload) => {
        req.assignTitlePayload = payload;
        next();
      })
      .catch((error) => {
        const statusCode = error?.statusCode || error?.status || 400;
        res.status(statusCode).json({
          message: error?.message || 'Unable to parse assign_title image request.',
        });
      });
    return;
  }

  req.assignTitlePayload = req.body || {};
  next();
}

function parseMultipartAssignTitleRequest(req) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fileSize: ASSIGN_TITLE_MAX_IMAGE_BYTES,
          fields: 25,
          parts: 30,
        },
      });
    } catch (error) {
      reject(buildAssignTitleRouteError(error?.message || 'Invalid multipart request.', 400));
      return;
    }

    const fields = {};
    let imageFile = null;
    let fileError = null;
    let sawFile = false;

    parser.on('field', (name, value) => {
      if (typeof name === 'string') {
        fields[name] = value;
      }
    });

    parser.on('file', (fieldName, file, info = {}) => {
      const shouldUseFile = !sawFile || ASSIGN_TITLE_IMAGE_FIELD_NAMES.has(fieldName);
      if (!shouldUseFile) {
        file.resume();
        return;
      }

      sawFile = true;
      const mimeType = normalizeAssignTitleMimeType(info.mimeType);
      const chunks = [];
      let byteLength = 0;

      if (!mimeType) {
        fileError = buildAssignTitleRouteError('image file must be PNG, JPEG, WEBP, or non-animated GIF.', 400);
        file.resume();
        return;
      }

      file.on('data', (chunk) => {
        byteLength += chunk.length;
        chunks.push(chunk);
      });

      file.on('limit', () => {
        fileError = buildAssignTitleRouteError(
          `image file must be ${ASSIGN_TITLE_MAX_IMAGE_BYTES} bytes or smaller.`,
          413,
        );
      });

      file.on('end', () => {
        if (fileError) {
          return;
        }

        const buffer = Buffer.concat(chunks, byteLength);
        if (buffer.length === 0) {
          fileError = buildAssignTitleRouteError('image file must not be empty.', 400);
          return;
        }

        imageFile = {
          imageDataUrl: bufferToAssignTitleDataUrl(buffer, mimeType),
          mimeType,
          fileName: typeof info.filename === 'string' ? info.filename : null,
        };
      });
    });

    parser.on('error', (error) => {
      reject(buildAssignTitleRouteError(error?.message || 'Invalid multipart request.', 400));
    });

    parser.on('finish', () => {
      if (fileError) {
        reject(fileError);
        return;
      }

      if (!imageFile) {
        reject(buildAssignTitleRouteError('image file is required.', 400));
        return;
      }

      resolve({
        ...fields,
        ...imageFile,
      });
    });

    req.pipe(parser);
  });
}

function parseRawImageAssignTitleRequest(req) {
  return new Promise((resolve, reject) => {
    const mimeType = normalizeAssignTitleMimeType(req.headers['content-type']);
    if (!mimeType) {
      reject(buildAssignTitleRouteError('Content-Type must be PNG, JPEG, WEBP, or non-animated GIF.', 400));
      return;
    }

    const chunks = [];
    let byteLength = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) {
        return;
      }
      byteLength += chunk.length;
      if (byteLength > ASSIGN_TITLE_MAX_IMAGE_BYTES) {
        settled = true;
        reject(buildAssignTitleRouteError(
          `image file must be ${ASSIGN_TITLE_MAX_IMAGE_BYTES} bytes or smaller.`,
          413,
        ));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) {
        return;
      }
      const buffer = Buffer.concat(chunks, byteLength);
      if (buffer.length === 0) {
        reject(buildAssignTitleRouteError('image file must not be empty.', 400));
        return;
      }
      resolve({
        imageDataUrl: bufferToAssignTitleDataUrl(buffer, mimeType),
        mimeType,
        metadata: req.query?.metadata ?? req.headers['x-image-metadata'] ?? undefined,
      });
    });

    req.on('error', (error) => {
      if (!settled) {
        reject(buildAssignTitleRouteError(error?.message || 'Unable to read image request body.', 400));
      }
    });
  });
}

function isMultipartRequest(req) {
  return typeof req.headers['content-type'] === 'string' &&
    req.headers['content-type'].toLowerCase().startsWith('multipart/form-data');
}

function isRawImageRequest(req) {
  return typeof req.headers['content-type'] === 'string' &&
    req.headers['content-type'].toLowerCase().startsWith('image/');
}

function normalizeAssignTitleMimeType(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.split(';')[0].trim().toLowerCase();
  const mimeType = normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  return ASSIGN_TITLE_SUPPORTED_MIME_TYPES.has(mimeType) ? mimeType : null;
}

function bufferToAssignTitleDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function buildAssignTitleRouteError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

router.post('/create_rollup_banner', validateAPIKeyAndUserId, async (req, res) => {
  const payload = { ...(req.body || {}), userId: req.userId };

  try {
    const response = await createRollupBanner(payload);

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    console.error('[api][create_rollup_banner] failed', {
      userId: req.userId,
      error: error?.message || error,
    });
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while creating rollup banner.',
    });
  }
});

router.post('/enhance_and_generate_rollup_banner', validateAPIKeyAndUserId, async (req, res) => {
  const payload = { ...(req.body || {}), userId: req.userId };

  try {
    const response = await enhanceAndGenerateRollupBanner(payload);

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    console.error('[api][enhance_and_generate_rollup_banner] failed', {
      userId: req.userId,
      error: error?.message || error,
    });
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while enhancing and creating rollup banner.',
    });
  }
});

router.post('/enhance', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const { image_url, resolution, aspect_ratio } = req.body || {};

    if (!image_url || typeof image_url !== 'string' || image_url.trim() === '') {
      return res.status(400).json({
        message: 'image_url is required.',
      });
    }

    const allowedResolutions = ['0.5k', '1k', '2k', '4k'];
    const normalizedResolution = typeof resolution === 'string' && resolution.trim().length > 0
      ? resolution.trim().toLowerCase()
      : '1k';

    if (aspect_ratio !== undefined && typeof aspect_ratio !== 'string') {
      return res.status(400).json({
        message: 'aspect_ratio must be a string when provided.',
      });
    }

    const normalizedAspectRatio = typeof aspect_ratio === 'string' && aspect_ratio.trim().length > 0
      ? aspect_ratio.trim()
      : '16:9';
    const aspectRatioPattern = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;

    if (!aspectRatioPattern.test(normalizedAspectRatio)) {
      return res.status(400).json({
        message: "aspect_ratio must be in the format '<number>:<number>', e.g., '16:9', '9:16', or '1:1'.",
      });
    }

    if (resolution !== undefined && typeof resolution !== 'string') {
      return res.status(400).json({
        message: 'resolution must be a string when provided.',
      });
    }

    if (!allowedResolutions.includes(normalizedResolution)) {
      return res.status(400).json({
        message: "resolution must be one of '0.5k', '1k', '2k', or '4k'.",
      });
    }

    const payload = {
      image_url: image_url.trim(),
      resolution: normalizedResolution,
      aspect_ratio: normalizedAspectRatio,
      userId: req.userId,
      mode: 'NANOBANANA2EDIT',
    };

    const response = await enhanceImage(payload);

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    const statusCode = error?.status || error?.response?.status;
    res.status(statusCode || 500).json({
      message: 'Internal server error while enhancing image.',
    });
  }
});

router.post('/remove_branding', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const { image_url } = req.body || {};

    if (!image_url || typeof image_url !== 'string' || image_url.trim() === '') {
      return res.status(400).json({
        message: 'image_url is required.',
      });
    }

    const payload = {
      image_url: image_url.trim(),
      userId: req.userId,
      mode: 'NANOBANANA2EDIT',
    };

    const response = await removeBrandingFromImage(payload);

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    const statusCode = error?.status || error?.response?.status;
    res.status(statusCode || 500).json({
      message: 'Internal server error while removing branding from image.',
    });
  }
});

export default router;

async function handleTextToImageRequest(req, res) {
  try {
    const body = req.body?.input && typeof req.body.input === 'object'
      ? req.body.input
      : req.body || {};
    const {
      prompt,
      aspect_ratio,
      aspectRatio,
      model,
      mode,
      num_images,
      numImages,
      metadata,
    } = body;

    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return res.status(400).json({
        message: 'prompt is required.',
      });
    }

    const normalizedAspectRatio = aspect_ratio ?? aspectRatio;
    if (normalizedAspectRatio !== undefined && typeof normalizedAspectRatio !== 'string') {
      return res.status(400).json({
        message: 'aspect_ratio must be a string when provided.',
      });
    }

    const payload = {
      prompt: prompt.trim(),
      aspect_ratio: normalizedAspectRatio,
      model: model || mode,
      num_images,
      numImages,
      metadata,
      userId: req.userId,
    };

    const response = await generateTextToImage(payload);

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    const statusCode = error?.status || error?.response?.status;
    res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while generating image.',
    });
  }
}

async function handleAddImageSet(req, res) {
  try {
    const { image_urls, metadata, prompt, num_images, aspect_ratio } = req.body || {};

    if (!Array.isArray(image_urls) || image_urls.length === 0 || image_urls.some((url) => typeof url !== 'string' || url.trim() === '')) {
      return res.status(400).json({
        message: 'image_urls must be a non-empty array of strings.',
      });
    }

    if (prompt !== undefined && typeof prompt !== 'string') {
      return res.status(400).json({
        message: 'prompt must be a string if provided.',
      });
    }

    if (aspect_ratio !== undefined && typeof aspect_ratio !== 'string') {
      return res.status(400).json({
        message: 'aspect_ratio must be a string when provided.',
      });
    }

    if (num_images === undefined) {
      return res.status(400).json({
        message: 'num_images is required.',
      });
    }

    if (Number.isNaN(Number(num_images)) || Number(num_images) <= 0) {
      return res.status(400).json({
        message: 'num_images must be a positive number.',
      });
    }

    const normalizedAspectRatio = typeof aspect_ratio === 'string' && aspect_ratio.trim().length > 0
      ? aspect_ratio.trim()
      : '1:1';
    const aspectRatioPattern = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/;

    if (!aspectRatioPattern.test(normalizedAspectRatio)) {
      return res.status(400).json({
        message: "aspect_ratio must be in the format '<number>:<number>', e.g., '16:9', '9:16', or '1:1'.",
      });
    }

    const payload = {
      image_urls,
      metadata,
      prompt,
      num_images,
      aspect_ratio: normalizedAspectRatio,
      userId: req.userId,
      mode: 'NANOBANANA2EDIT',
    };

    const response = await updateImageSet(payload);

    if (response?.creditsCharged !== undefined) {
      res.set('x-credits-charged', response.creditsCharged.toString());
    }
    if (response?.remainingCredits !== undefined && response?.remainingCredits !== null) {
      res.set('x-credits-remaining', response.remainingCredits.toString());
    }

    res.status(200).json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }
    const statusCode = error?.status || error?.response?.status;
    res.status(statusCode || 500).json({
      message: 'Internal server error while updating image set.',
    });
  }
}
