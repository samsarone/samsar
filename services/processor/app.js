import './src/config/loadEnv.js';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

import videoSessionsRouter from './src/routes/video_sessions.js';
import imageSessionsRouter from './src/routes/image_sessions.js';

import usersRouter from './src/routes/users.js';
import adminRouter from './src/routes/admin.js';
import utilsRouter from './src/routes/utils.js';
import interactionsRouter from './src/routes/interaction.js';
import paymentsRouter from './src/routes/payments.js';
import webhooksRouter from './src/routes/webhooks.js';
import audioRouter from './src/routes/audio.js';
import assistantsRouter from './src/routes/assistants.js';
import quickSessionRouter from './src/routes/quick_session.js';
import accountsRouter from './src/routes/account.js';
import aiVideoRouter from './src/routes/ai_video.js';
import vidGPTRouter from './src/routes/vidgpt.js';
import adminUsersRouter from './src/routes/admin/users.js';
import adminEmailRouter from './src/routes/admin/email.js';
import contentRouter from './src/routes/content.js';
import videApiRouter from './src/routes/api/video.js';
import chatApiRouter from './src/routes/api/chat.js';
import assistantApiRouter from './src/routes/api/assistant.js';
import imageApiRouter from './src/routes/api/image.js';
import supportApiRouter from './src/routes/api/support.js';
import externalUsersApiRouter from './src/routes/api/external_users.js';
import customerSubAccountsApiRouter from './src/routes/api/customer_sub_accounts.js';
import receiptTemplateCompatApiRouter from './src/routes/api/receipt_template_compat.js';
import v2ApiRouter from './src/routes/api/v2.js';
import movieGenRouter from './src/routes/moviegen.js';
import newsletterRouter from './src/routes/newsletter.js';

import internalAudioRouter from './src/routes/internal/audio.js';
import internalBotRouter from './src/routes/internal/bots.js';

import externalApiRouter from './src/routes/external/api.js';
import externalUsersRouter from './src/routes/external/users.js';
import externalSessionsRouter from './src/routes/external/session.js';


import contentUserRouter from './src/routes/content/user.js';
import contentPublicationRouter from './src/routes/content/publication.js';

import adMakerRouter from './src/routes/admaker.js';
import publicationRouter from './src/routes/publications.js';
import interactivePublicationRouter from './src/routes/interactive_publications.js';
import galleryRouter from './src/routes/gallery.js';
import automationRouter from './src/routes/automation.js';
import apiIndexRouter from './src/routes/api/index.js';
import { installStructuredLogger } from './src/utils/StructuredLogger.js';
import { withRequestContext } from './src/models/api/RequestAuthContext.js';

import { ensureSupportedFontSamples } from './src/utils/SupportedFontSamples.js';

// admin routes
import adminCouponRouter from './src/routes/admin/coupon.js';
import publicVideosRouter from './src/routes/public_videos.js';

const app = express();
const SERVICE_NAME = process.env.SERVICE_NAME || 'samsar_processor';
const TERMINAL_STATUS_VALUES = new Set([
  'COMPLETED',
  'COMPLETE',
  'SUCCEEDED',
  'SUCCESS',
  'FAILED',
  'FAIL',
  'ERROR',
  'CANCELLED',
  'CANCELED',
  'REJECTED',
  'TIMED_OUT',
  'TIMEOUT',
  'DONE',
]);

installStructuredLogger({
  serviceName: SERVICE_NAME,
  component: 'http_api',
});

function resolveRequestId(req) {
  const header = req?.headers?.['x-request-id'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  return randomUUID();
}

function writeStructuredLog(level, payload) {
  if (level !== 'error') {
    return;
  }

  const entry = JSON.stringify({
    level,
    service: SERVICE_NAME,
    timestamp: new Date().toISOString(),
    ...payload,
  });

  console.error(entry);
}

function shouldLogRoute(pathname) {
  return (
    pathname.startsWith('/v1')
    || pathname.startsWith('/api/v1')
    || pathname.startsWith('/v2')
    || pathname.startsWith('/api/v2')
    || pathname.startsWith('/internal')
    || pathname.startsWith('/external')
    || pathname.startsWith('/webhooks')
  );
}

function normalizePathname(requestPath) {
  if (typeof requestPath !== 'string' || !requestPath) {
    return '';
  }

  const queryIndex = requestPath.indexOf('?');
  return queryIndex >= 0 ? requestPath.slice(0, queryIndex) : requestPath;
}

function isStatusEndpoint(pathname) {
  return pathname.endsWith('/status');
}

function normalizeAsyncStatus(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function shouldLogStatusEndpointRequest({ statusCode, asyncStatus }) {
  if (statusCode >= 400) {
    return true;
  }

  if (!asyncStatus) {
    return false;
  }

  return TERMINAL_STATUS_VALUES.has(asyncStatus);
}

ensureSupportedFontSamples().catch((error) => {
  console.error('[supported_fonts] sample generation failed', error?.message || error);
});

// Middleware to handle raw body for Stripe webhooks
const rawBodyMiddleware = (req, res, next) => {
  if (req.originalUrl === '/webhooks/stripe_payment_webhook') {
    express.raw({ type: 'application/json' })(req, res, next);
  } else {
    express.json({ limit: '50mb', extended: true })(req, res, next);
  }
};

// Apply the middleware
app.use(rawBodyMiddleware);

// CORS options
const corsOptions = {
  origin: '*', // Adjust this to be more restrictive according to your needs
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], // Adjust as needed
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'api_key',
    'API_KEY',
    'Range',
    'range',
    'x-external-user-api-key',
    'x-customer-sub-account-api-key',
    'x-customer-subaccount-api-key',
    'x-samsar-customer-sub-account-api-key',
    'x-samsar-sub-account-api-key',
  ],
  exposedHeaders: [
    'Accept-Ranges',
    'Content-Disposition',
    'Content-Length',
    'Content-Range',
    'Content-Type',
    'x-credits-charged',
    'x-credits-remaining',
  ],
  optionsSuccessStatus: 200,
  credentials: false, // This is important for setting `crossOrigin` to "anonymous"
};

// Apply CORS middleware to all requests
app.use(cors(corsOptions));
app.use(withRequestContext);

app.use((req, res, next) => {
  const requestPath = req.originalUrl || req.url || '';
  const requestPathname = normalizePathname(requestPath);
  const statusEndpointRequest = isStatusEndpoint(requestPathname);

  if (!shouldLogRoute(requestPathname)) {
    return next();
  }

  const requestId = resolveRequestId(req);
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const statusCode = res.statusCode;
    const asyncStatus = normalizeAsyncStatus(res.locals?.statusEndpointStatus);

    if (statusEndpointRequest && !shouldLogStatusEndpointRequest({ statusCode, asyncStatus })) {
      return;
    }

    if (statusCode < 500) {
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const responseSize = res.getHeader('content-length');
    const payload = {
      event: 'http_request',
      requestId,
      method: req.method,
      path: requestPath,
      statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      responseSize: responseSize ? Number(responseSize) : null,
      userAgent: req.headers['user-agent'] || null,
    };

    if (statusEndpointRequest && asyncStatus) {
      payload.asyncStatus = asyncStatus;
    }

    writeStructuredLog('error', payload);
  });

  next();
});

app.use('/users', usersRouter);


app.use('/admin', adminRouter);
app.use('/utils', utilsRouter);
app.use('/interactions', interactionsRouter);
app.use('/video_sessions', videoSessionsRouter);
app.use('/video_session', videoSessionsRouter);
app.use('/image_sessions', imageSessionsRouter);
app.use('/payments', paymentsRouter);
app.use('/webhooks', webhooksRouter);
app.use('/audio', audioRouter);
app.use('/assistants', assistantsRouter);
app.use('/quick_session', quickSessionRouter);
app.use('/accounts', accountsRouter);
app.use('/ai_video', aiVideoRouter);
app.use('/vidgpt', vidGPTRouter);
app.use('/vidgenie', vidGPTRouter);

app.use('/moviegen', movieGenRouter);
app.use('/content', contentRouter);
app.use('/newsletter', newsletterRouter);

app.use('/admin/users', adminUsersRouter);
app.use('/admin/email', adminEmailRouter);


app.use('/admaker', adMakerRouter);

app.use('/v1/video', videApiRouter);
app.use('/v1/chat', chatApiRouter);
app.use('/v1/assistant', assistantApiRouter);
app.use('/v1/image', imageApiRouter);
app.use('/v1/support', supportApiRouter);
app.use('/v1/external_users', externalUsersApiRouter);
app.use('/v1/customer_sub_accounts', customerSubAccountsApiRouter);
app.use('/v1/publications', publicationRouter);
app.use('/v1/interactive_publications', interactivePublicationRouter);
app.use('/v1/gallery', galleryRouter);
app.use('/v1', receiptTemplateCompatApiRouter);
app.use('/v1', apiIndexRouter);

app.use('/api/v1/assistant', assistantApiRouter);
app.use('/api/v1/external_users', externalUsersApiRouter);
app.use('/api/v1/customer_sub_accounts', customerSubAccountsApiRouter);

app.use('/v2/gallery', galleryRouter);
app.use('/v2', v2ApiRouter);
app.use('/api/v2', v2ApiRouter);
app.use('/external', externalApiRouter);

app.use('/videos', publicVideosRouter);
app.use('/publication', publicationRouter);
app.use('/publications', publicationRouter);
app.use('/interactive_publications', interactivePublicationRouter);
app.use('/gallery', galleryRouter);
app.use('/', automationRouter);

const setCustomHeaders = (res, filePath) => {
  if (filePath.endsWith('.mp4')) {
    res.set('Content-Type', 'video/mp4');
    res.set('Content-Disposition', `attachment; filename="${filePath.split('/').pop()}"`);
  } else if (filePath.endsWith('.json')) {
    res.set('Content-Type', 'application/json');
  }
};

let assetsPath = 'assets';
let assetsV2Path = 'assets_v2';
if (process.env.SAMSAR_ASSETS_ROOT) {
  assetsPath = process.env.SAMSAR_ASSETS_ROOT;
} else if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
  assetsPath = '/assets';
}
if (process.env.SAMSAR_ASSETS_V2_ROOT) {
  assetsV2Path = process.env.SAMSAR_ASSETS_V2_ROOT;
} else if (process.env.CURRENT_ENV === 'staging' || process.env.CURRENT_ENV === 'docker') {
  assetsV2Path = '/assets_v2';
}

app.use('/assets_v2', express.static(assetsV2Path, { setHeaders: setCustomHeaders }));
app.use(express.static(assetsPath, { setHeaders: setCustomHeaders }));


app.use('/internal/audio', internalAudioRouter);
app.use('/internal/bots', internalBotRouter);


// external routes for apps
app.use('/external/users', externalUsersRouter);
app.use('/external/session', externalSessionsRouter);


app.use('/content/user', contentUserRouter);
app.use('/content/publication', contentPublicationRouter);


// admin routes
app.use('/admin/coupon', adminCouponRouter);

app.use((err, req, res, next) => {
  const requestId = req?.requestId || resolveRequestId(req);
  const statusCode = err?.statusCode || err?.status || 500;

  if (!res.headersSent) {
    res.setHeader('x-request-id', requestId);
  }

  writeStructuredLog('error', {
    event: 'http_internal_error',
    requestId,
    method: req?.method || null,
    path: req?.originalUrl || req?.url || null,
    statusCode,
    errorName: err?.name || 'Error',
    errorMessage: err?.message || String(err),
    errorStack: err?.stack || null,
  });

  next(err);
});

export default app;
