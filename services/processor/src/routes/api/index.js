import express from 'express';
import { randomUUID } from 'crypto';
import fetch from 'node-fetch';
import { getGoogleADCStatusWithTimeout } from '../../inference/GoogleADC.js';
import { listGoogleTTSVoiceCatalog, synthesizeGoogleTTSPreview } from '../../inference/GoogleTTS.js';
import { getDBConnectionString } from '../../models/DBString.js';
import GlobalSession from '../../schema/GlobalSession.js';
import ImageGeneration from '../../schema/ImageGeneration.js';
import VideoSession from '../../schema/VideoSession.js';
import User from '../../schema/User.js';
import UserPayment from '../../schema/UserPayment.js';
import { purchaseCreditsForUser } from '../../models/Payment.js';
import { getSupportedSubtitleFontsByLanguage } from '../../models/api/IndexAPI.js';
import { createLoginTokenForUser } from '../../models/api/UserAPI.js';
import { resolveRequestActorFromAuthHeaders } from '../../models/external/User.js';
import { saveAutoRechargeSettings, updateAutoRechargeThreshold } from '../../models/AutoRecharge.js';
import { getBillingPortalUrl } from '../../models/BillingPortal.js';
import { buildVideoStatusResponse } from '../../models/api/StatusAPI.js';
import mongoose from 'mongoose';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const router = express.Router();
const BILLING_PORTAL_URL = getBillingPortalUrl();
const ENABLE_AUTORECHARGE_ENDPOINT = '/v1/enable_autorecharge';
const PAYMENT_STATUS_ENDPOINT = '/v1/payment_status';
const MONGOOSE_READY_STATES = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};
const DEPENDENCY_TIMEOUT_MS = Number.parseInt(process.env.DEPENDENCY_HEALTH_TIMEOUT_MS || '2000', 10);
const MONGO_HEALTH_TIMEOUT_MS = Number.parseInt(process.env.MONGO_HEALTH_TIMEOUT_MS || `${DEPENDENCY_TIMEOUT_MS}`, 10);
const GOOGLE_ADC_HEALTH_TIMEOUT_MS = Number.parseInt(
  process.env.GOOGLE_ADC_HEALTH_TIMEOUT_MS || `${DEPENDENCY_TIMEOUT_MS}`,
  10
);
const LOGGER_HEALTH_TARGETS = [
  {
    name: 'loki',
    url: process.env.LOKI_HEALTH_URL || 'http://127.0.0.1:4100/ready',
  },
  {
    name: 'grafana',
    url: process.env.GRAFANA_HEALTH_URL || 'http://127.0.0.1:4000/api/health',
  },
];

function resolveTraceId(req) {
  const header = req?.headers?.['x-request-id'];
  if (typeof header === 'string' && header.trim()) {
    return header.trim();
  }
  return randomUUID();
}

function buildBaseHealthPayload(service = 'samsar_processor') {
  return {
    service,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
  };
}

function getMongoHealthSnapshot() {
  const readyState = mongoose.connection?.readyState ?? 0;
  return {
    ready: readyState === 1,
    readyState,
    state: MONGOOSE_READY_STATES[readyState] || 'unknown',
    host: mongoose.connection?.host || null,
    database: mongoose.connection?.name || null,
  };
}

function timeoutAfter(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error(`timeout after ${ms}ms`));
    }, ms);
  });
}

async function probeMongoReadiness() {
  const timeout = Number.isFinite(MONGO_HEALTH_TIMEOUT_MS) && MONGO_HEALTH_TIMEOUT_MS > 0
    ? MONGO_HEALTH_TIMEOUT_MS
    : 2000;
  let probeError = null;

  try {
    await Promise.race([
      getDBConnectionString(),
      timeoutAfter(timeout),
    ]);
  } catch (error) {
    probeError = error;
  }

  const mongo = getMongoHealthSnapshot();
  if (!mongo.ready && probeError) {
    mongo.error = probeError?.message || 'connection probe failed';
  }
  return mongo;
}

async function probeGoogleADCReadiness() {
  const timeout = Number.isFinite(GOOGLE_ADC_HEALTH_TIMEOUT_MS) && GOOGLE_ADC_HEALTH_TIMEOUT_MS > 0
    ? GOOGLE_ADC_HEALTH_TIMEOUT_MS
    : 2000;

  return getGoogleADCStatusWithTimeout({ timeoutMs: timeout });
}

async function probeDependency({ name, url }) {
  const controller = new AbortController();
  const timeout = Number.isFinite(DEPENDENCY_TIMEOUT_MS) && DEPENDENCY_TIMEOUT_MS > 0
    ? DEPENDENCY_TIMEOUT_MS
    : 2000;
  const timeoutHandle = setTimeout(() => controller.abort(), timeout);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    return {
      name,
      url,
      ok: response.ok,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      name,
      url,
      ok: false,
      statusCode: null,
      durationMs: Date.now() - startedAt,
      error: error?.name === 'AbortError'
        ? `timeout after ${timeout}ms`
        : (error?.message || 'request failed'),
    };
  } finally {
    clearTimeout(timeoutHandle);
  }
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

const formatCreditTopUp = (payment) => {
  if (!payment) return null;
  const receiptUrl = payment.receiptUrl || payment.invoicePdfUrl || payment.hostedInvoiceUrl || null;
  return {
    id: payment._id?.toString(),
    amountPaidCents: payment.amountPaidCents ?? 0,
    currency: payment.currency?.toUpperCase() ?? 'USD',
    paymentType: payment.paymentType,
    paymentStatus: payment.paymentStatus,
    billingReason: payment.billingReason,
    creditsApplied: payment.creditsApplied ?? 0,
    paymentDate: payment.paymentDate || payment.createdAt || null,
    stripeInvoiceId: payment.stripeInvoiceId,
    stripeInvoiceNumber: payment.stripeInvoiceNumber,
    invoicePdfUrl: payment.invoicePdfUrl,
    hostedInvoiceUrl: payment.hostedInvoiceUrl,
    receiptUrl,
    receiptAvailable: !!(
      payment.receiptS3Key ||
      payment.receiptUrl ||
      payment.invoicePdfUrl ||
      payment.hostedInvoiceUrl
    ),
    productSummary: payment.productSummary,
  };
};

const normalizeAutoRechargePayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    return { enabled: true };
  }

  const thresholdCredits =
    payload.thresholdCredits ??
    payload.threshold_credits ??
    payload.autoRechargeThreshold ??
    payload.rechargeBelowThreshold ??
    payload.recharge_below_threshold ??
    payload.threshold ??
    payload.rechargeThreshold ??
    payload.recharge_threshold;

  const amountUsd =
    payload.amountUsd ??
    payload.amount_usd ??
    payload.autoRechargeAmountUsd ??
    payload.rechargeAmountUsd ??
    payload.recharge_amount_usd ??
    payload.amount ??
    payload.amount_to_recharge ??
    payload.amountToRecharge;

  const creditsAmount =
    payload.credits ??
    payload.credits_to_recharge ??
    payload.creditsToRecharge ??
    payload.amountCredits ??
    payload.amount_credits;

  const maxMonthlyUsd =
    payload.maxMonthlyUsd ??
    payload.maxMonthlyAmountUsd ??
    payload.autoRechargeMaxMonthlyUsd ??
    payload.autoRechargeMaxMonthlyAmountUsd ??
    payload.maxMonthlyTopupUsd ??
    payload.maxMonthlyTopUpUsd ??
    payload.maxMonthlyTopupAmountUsd ??
    payload.maxMonthlyTopUpAmountUsd ??
    payload.maxMonthlyRechargeUsd ??
    payload.maxMonthlyRechargeAmountUsd ??
    payload.monthlyCapUsd ??
    payload.monthlyCap ??
    payload.maxTopupPerMonthUsd ??
    payload.maxTopupPerMonth ??
    payload.max_topup_per_month;

  const maxMonthlyCredits =
    payload.maxMonthlyCredits ??
    payload.maxMonthlyCreditsToRecharge ??
    payload.maxMonthlyTopupCredits ??
    payload.maxMonthlyTopUpCredits ??
    payload.max_topup_per_month_credits;

  let resolvedAmountUsd = amountUsd;
  if (resolvedAmountUsd == null && creditsAmount != null) {
    const creditsNumber = Number(creditsAmount);
    if (Number.isFinite(creditsNumber)) {
      // Auto-recharge pricing is 100 credits per USD.
      resolvedAmountUsd = creditsNumber / 100;
    }
  }

  let resolvedMaxMonthlyUsd = maxMonthlyUsd;
  if (resolvedMaxMonthlyUsd == null && maxMonthlyCredits != null) {
    const creditsNumber = Number(maxMonthlyCredits);
    if (Number.isFinite(creditsNumber)) {
      resolvedMaxMonthlyUsd = creditsNumber / 100;
    }
  }

  const requestSetupSession =
    payload.requestSetupSession ??
    payload.request_setup_session ??
    payload.setupSession ??
    payload.setup_session ??
    payload.requireSetup ??
    payload.require_setup;

  const paymentMethodId =
    payload.paymentMethodId ??
    payload.payment_method_id ??
    payload.stripePaymentMethodId ??
    payload.stripe_payment_method_id;

  const enabledPayload =
    payload.enabled ??
    payload.enable ??
    payload.autoRechargeEnabled ??
    payload.auto_recharge_enabled;

  const normalized = {
    enabled: enabledPayload === undefined ? true : !!enabledPayload,
  };

  if (thresholdCredits !== undefined) {
    normalized.thresholdCredits = thresholdCredits;
  }
  if (resolvedAmountUsd !== undefined) {
    normalized.amountUsd = resolvedAmountUsd;
  }
  if (requestSetupSession !== undefined) {
    normalized.requestSetupSession = requestSetupSession;
  }
  if (paymentMethodId !== undefined) {
    normalized.paymentMethodId = paymentMethodId;
  }
  if (resolvedMaxMonthlyUsd !== undefined) {
    normalized.maxMonthlyUsd = resolvedMaxMonthlyUsd;
  }

  return normalized;
};

const normalizePaymentStatusPayload = (payload = {}) => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const checkoutSessionId =
    payload.checkoutSessionId ??
    payload.checkout_session_id ??
    payload.checkoutSessionID ??
    payload.sessionId ??
    payload.session_id ??
    payload.paymentSessionId ??
    payload.payment_session_id;

  const paymentIntentId =
    payload.paymentIntentId ??
    payload.payment_intent_id ??
    payload.paymentIntent ??
    payload.payment_intent;

  const setupIntentId =
    payload.setupIntentId ??
    payload.setup_intent_id ??
    payload.setupIntent ??
    payload.setup_intent;

  const normalizeString = (value) => {
    if (Array.isArray(value)) {
      return typeof value[0] === 'string' ? value[0].trim() : undefined;
    }
    return typeof value === 'string' ? value.trim() : undefined;
  };

  return {
    checkoutSessionId: normalizeString(checkoutSessionId),
    paymentIntentId: normalizeString(paymentIntentId),
    setupIntentId: normalizeString(setupIntentId),
  };
};

router.get('/heartbeat', (req, res) => {
  res.status(200).json({
    status: 'ok',
    ...buildBaseHealthPayload(),
  });
});

router.get('/health/live', (req, res) => {
  res.status(200).json({
    status: 'ok',
    ...buildBaseHealthPayload(),
  });
});

router.get('/health/ready', async (req, res) => {
  const mongo = await probeMongoReadiness();
  const status = mongo.ready ? 'ready' : 'not_ready';

  res.status(mongo.ready ? 200 : 503).json({
    status,
    ...buildBaseHealthPayload(),
    dependencies: {
      mongodb: mongo,
    },
  });
});

router.get('/health/google-adc', async (req, res) => {
  const googleADC = await probeGoogleADCReadiness();
  const status = googleADC.ok ? 'ready' : 'not_ready';

  res.status(googleADC.ok ? 200 : 503).json({
    status,
    ...buildBaseHealthPayload(),
    dependencies: {
      googleADC,
    },
  });
});

router.get('/tts/google/voices', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const catalog = await listGoogleTTSVoiceCatalog({
      languageCode: typeof req.query.languageCode === 'string' ? req.query.languageCode : '',
      refresh: req.query.refresh === 'true',
    });

    return res.status(200).json(catalog);
  } catch (error) {
    return res.status(502).json({
      message: error?.message || 'Unable to list Google TTS voices.',
    });
  }
});

router.get('/tts/google/preview', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const audioBuffer = await synthesizeGoogleTTSPreview({
      voice: req.query.voice,
      languageCode: req.query.languageCode,
      text: req.query.text,
    });

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    return res.status(200).send(audioBuffer);
  } catch (error) {
    return res.status(502).json({
      message: error?.message || 'Unable to synthesize Google TTS preview.',
    });
  }
});

router.get('/health/dependencies', async (req, res) => {
  const [mongo, loggerChecks] = await Promise.all([
    probeMongoReadiness(),
    Promise.all(LOGGER_HEALTH_TARGETS.map(probeDependency)),
  ]);
  const allLoggerHealthy = loggerChecks.every((entry) => entry.ok);
  const isHealthy = mongo.ready && allLoggerHealthy;

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'ok' : 'degraded',
    ...buildBaseHealthPayload(),
    dependencies: {
      mongodb: mongo,
      logger: loggerChecks,
    },
  });
});

router.get('/health', (req, res) => {
  const mongo = getMongoHealthSnapshot();
  res.status(200).json({
    status: 'ok',
    ...buildBaseHealthPayload(),
    readiness: mongo.ready ? 'ready' : 'not_ready',
    dependencies: {
      mongodb: mongo,
    },
  });
});

router.get('/supported_fonts', (req, res) => {
  res.status(200).json({
    fontsByLanguage: getSupportedSubtitleFontsByLanguage(),
  });
});

async function handleCreateLoginToken(req, res) {
  try {
    const result = createLoginTokenForUser(req.userId);
    const redirectRaw =
      (typeof req.query.redirect === 'string' ? req.query.redirect : null)
      || (typeof req.body?.redirect === 'string' ? req.body.redirect : null)
      || (typeof req.body?.input?.redirect === 'string' ? req.body.input.redirect : null);
    const redirectPath =
      typeof redirectRaw === 'string'
      && redirectRaw.startsWith('/')
      && !redirectRaw.startsWith('//')
        ? redirectRaw
        : null;
    const clientAppBase = (process.env.CLIENT_APP || 'https://app.samsar.one').replace(/\/$/, '');
    const loginUrl = `${clientAppBase}/verify?loginToken=${encodeURIComponent(result.loginToken)}${
      redirectPath ? `&redirect=${encodeURIComponent(redirectPath)}` : ''
    }`;

    return res.status(200).json({
      ...result,
      loginUrl,
    });
  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error while creating login token.',
    });
  }
}

router.post('/create_login_token', validateAPIKeyAndUserId, handleCreateLoginToken);
router.get('/create_login_token', validateAPIKeyAndUserId, handleCreateLoginToken);

router.get('/credits', validateAPIKeyAndUserId, async (req, res) => {
  try {
    await getDBConnectionString();

    const user = await User.findById(req.userId).select('generationCredits');
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    const lastTopUpPayment = await UserPayment.findOne({
      userId: req.userId,
      creditsApplied: { $gt: 0 },
    })
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();

    const remainingCredits = Number(user.generationCredits) || 0;
    const responsePayload = {
      remainingCredits,
      lastTopUp: formatCreditTopUp(lastTopUpPayment),
    };

    res.set('x-credits-remaining', remainingCredits.toString());
    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({
      message: 'Internal server error while fetching credits.',
    });
  }
});

router.post('/credits/recharge', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const payload = req.body?.input ?? req.body ?? {};
    const creditsRaw =
      payload.credits ?? payload.credits_to_recharge ?? payload.creditsToRecharge;
    const parsedCredits = Number(creditsRaw);

    if (!Number.isFinite(parsedCredits) || parsedCredits <= 0) {
      return res.status(400).json({
        message: 'credits is required and must be a positive number.',
      });
    }

    if (!Number.isInteger(parsedCredits)) {
      return res.status(400).json({
        message: 'credits must be an integer.',
      });
    }

    const amountCents = Math.round(parsedCredits);
    const amountUsd = Number((amountCents / 100).toFixed(2));

    const session = await purchaseCreditsForUser(req.userId, {
      amount: amountUsd,
      amountCents,
      productSummary: `Purchase ${amountCents} credits`,
      metadata: {
        creditsRequested: amountCents,
      },
    });

    return res.status(200).json({
      url: session.url,
      checkoutSessionId: session.checkoutSessionId || session.sessionId || session.id || null,
      paymentIntentId: session.paymentIntentId || null,
      paymentStatusEndpoint: PAYMENT_STATUS_ENDPOINT,
      credits: amountCents,
      amountUsd,
      amountCents,
      currency: 'USD',
    });
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    return res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while creating recharge link.',
    });
  }
});

router.post('/enable_autorecharge', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const payload = req.body?.input ?? req.body ?? {};
    const normalizedPayload = normalizeAutoRechargePayload(payload);
    const result = await saveAutoRechargeSettings(req.userId, normalizedPayload);

    return res.status(200).json({
      ...result,
      url: result.setupSessionUrl || null,
      checkoutSessionId: result.setupSessionId || null,
      setupIntentId: result.setupIntentId || null,
      paymentStatusEndpoint: PAYMENT_STATUS_ENDPOINT,
    });
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    return res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while enabling auto-recharge.',
    });
  }
});

router.post('/auto_recharge/threshold', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const payload = req.body?.input ?? req.body ?? {};
    const result = await updateAutoRechargeThreshold(req.userId, payload);
    return res.status(200).json(result);
  } catch (error) {
    if (error?.code === 'AUTO_RECHARGE_DISABLED') {
      return res.status(400).json({
        message:
          `Auto-recharge is not enabled. Please call ${ENABLE_AUTORECHARGE_ENDPOINT} ` +
          `or visit ${BILLING_PORTAL_URL} to enable auto-recharge.`,
      });
    }
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    return res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while updating auto-recharge threshold.',
    });
  }
});

async function handlePaymentStatusRequest(req, res) {
  try {
    const payloadSource = req.method === 'GET' ? req.query : (req.body?.input ?? req.body ?? {});
    const { checkoutSessionId, paymentIntentId, setupIntentId } =
      normalizePaymentStatusPayload(payloadSource);

    if (!checkoutSessionId && !paymentIntentId && !setupIntentId) {
      return res.status(400).json({
        message: 'checkoutSessionId (or paymentIntentId/setupIntentId) is required.',
      });
    }

    await getDBConnectionString();
    const user = await User.findById(req.userId).select('stripeCustomerId').lean();
    if (!user || !user.stripeCustomerId) {
      return res.status(404).json({ message: 'Stripe customer not found for user.' });
    }

    let responsePayload = {};

    if (checkoutSessionId) {
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId, {
        expand: ['payment_intent', 'setup_intent'],
      });

      if (session?.customer && session.customer !== user.stripeCustomerId) {
        return res.status(403).json({ message: 'Checkout session does not belong to this user.' });
      }

      const paymentIntent = session.payment_intent;
      const setupIntent = session.setup_intent;

      const paymentIntentIdResolved =
        typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null;
      const paymentIntentStatus =
        typeof paymentIntent === 'string' ? null : paymentIntent?.status || null;

      const setupIntentIdResolved =
        typeof setupIntent === 'string' ? setupIntent : setupIntent?.id || null;
      const setupIntentStatus =
        typeof setupIntent === 'string' ? null : setupIntent?.status || null;

      const mode = session.mode || null;
      const sessionStatus = session.status || null;
      const paymentStatus = session.payment_status || null;

      let status = 'pending';
      if (mode === 'payment') {
        if (paymentStatus === 'paid' || paymentIntentStatus === 'succeeded') {
          status = 'succeeded';
        } else if (sessionStatus === 'expired' || paymentIntentStatus === 'canceled') {
          status = 'failed';
        }
      } else if (mode === 'setup') {
        if (setupIntentStatus === 'succeeded') {
          status = 'succeeded';
        } else if (setupIntentStatus === 'canceled' || sessionStatus === 'expired') {
          status = 'failed';
        }
      }

      responsePayload = {
        status,
        mode,
        checkoutSessionId: session.id,
        sessionStatus,
        paymentStatus,
        paymentIntentId: paymentIntentIdResolved,
        paymentIntentStatus,
        setupIntentId: setupIntentIdResolved,
        setupIntentStatus,
        amountCents: session.amount_total ?? null,
        currency: session.currency ?? null,
      };
    } else if (paymentIntentId) {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (paymentIntent?.customer && paymentIntent.customer !== user.stripeCustomerId) {
        return res.status(403).json({ message: 'Payment intent does not belong to this user.' });
      }

      let status = 'pending';
      if (paymentIntent.status === 'succeeded') {
        status = 'succeeded';
      } else if (paymentIntent.status === 'canceled') {
        status = 'failed';
      }

      responsePayload = {
        status,
        mode: 'payment',
        paymentIntentId: paymentIntent.id,
        paymentIntentStatus: paymentIntent.status,
        amountCents: paymentIntent.amount ?? null,
        currency: paymentIntent.currency ?? null,
      };
    } else if (setupIntentId) {
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      if (setupIntent?.customer && setupIntent.customer !== user.stripeCustomerId) {
        return res.status(403).json({ message: 'Setup intent does not belong to this user.' });
      }

      let status = 'pending';
      if (setupIntent.status === 'succeeded') {
        status = 'succeeded';
      } else if (setupIntent.status === 'canceled') {
        status = 'failed';
      }

      responsePayload = {
        status,
        mode: 'setup',
        setupIntentId: setupIntent.id,
        setupIntentStatus: setupIntent.status,
      };
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status;
    return res.status(statusCode || 500).json({
      message: error?.message || 'Internal server error while fetching payment status.',
    });
  }
}

router.get('/payment_status', validateAPIKeyAndUserId, handlePaymentStatusRequest);
router.post('/payment_status', validateAPIKeyAndUserId, handlePaymentStatusRequest);

router.get('/status', async (req, res) => {
  const traceId = resolveTraceId(req);
  const rawRequestId = req.query.request_id || req.query.session_id;
  const requestId = typeof rawRequestId === 'string' ? rawRequestId.trim() : '';
  const sendStatusResponse = (statusCode, payload) => {
    res.locals.statusEndpointStatus = payload?.status || null;
    return res.status(statusCode).json(payload);
  };

  try {
    if (!requestId) {
      return sendStatusResponse(400, { message: 'request_id (or session_id) query param is required.' });
    }

    const authContext = await resolveRequestActorFromAuthHeaders(req.headers);
    if (!['api_key', 'auth_token', 'app_key'].includes(authContext.authType)) {
      return sendStatusResponse(403, {
        message: 'Use a Samsar API key, user auth token, or APP_KEY for this route.',
      });
    }

    req.userId = authContext.internalUserId;
    req.authType = authContext.authType;
    const normalizedUserId = req.userId?.toString?.() || req.userId;

    await getDBConnectionString();

    if (mongoose.Types.ObjectId.isValid(requestId.toString())) {
      const directVideoDoc = await VideoSession.findOne({
        _id: requestId.toString(),
        userId: normalizedUserId,
      }).select('_id').lean();

      if (directVideoDoc) {
        const videoStatus = await buildVideoStatusResponse({
          sessionId: directVideoDoc._id,
          requestId: requestId.toString(),
          provider: null,
          req,
        });

        if (!videoStatus) {
          return sendStatusResponse(404, { message: 'Request not found.' });
        }

        return sendStatusResponse(200, videoStatus);
      }
    }

    let globalSession = await GlobalSession.findOne({ sessionId: requestId.toString() });

    if (!globalSession) {
      globalSession = await GlobalSession.findOne({ requestId: requestId.toString() });
    }

    if (!globalSession) {
      // Fallback: try to infer from existing ImageGeneration/VideoSession
      if (mongoose.Types.ObjectId.isValid(requestId.toString())) {
        const imageDoc = await ImageGeneration.findOne({ _id: requestId.toString() });
        if (imageDoc) {
          const inferredStatus = imageDoc.operationType === 'EDIT'
            ? (imageDoc.editStatus || imageDoc.apiEditStatus || 'PENDING')
            : (imageDoc.generationStatus || imageDoc.apiGenerationStatus || 'PENDING');

          const responsePayload = {
            session_id: requestId.toString(),
            request_id: requestId.toString(),
            status: inferredStatus,
            type: 'image',
          };
          return sendStatusResponse(200, responsePayload);
        }
      }

      if (mongoose.Types.ObjectId.isValid(requestId.toString())) {
        const videoDoc = await VideoSession.findOne({
          _id: requestId.toString(),
          userId: normalizedUserId,
        }).select('_id').lean();
        if (videoDoc) {
          const videoStatus = await buildVideoStatusResponse({
            sessionId: videoDoc._id,
            requestId: requestId.toString(),
            provider: null,
            req,
          });

          if (!videoStatus) {
            return sendStatusResponse(404, { message: 'Request not found.' });
          }

          return sendStatusResponse(200, videoStatus);
        }
      }

      return sendStatusResponse(404, { message: 'Request not found.' });
    }

    if (globalSession.sessionType === 'video') {
      const videoStatus = await buildVideoStatusResponse({
        sessionId: globalSession.sessionId,
        requestId: globalSession.requestId || requestId.toString(),
        provider: globalSession.provider || null,
        req,
        defaultResultUrl: globalSession.resultUrl,
        defaultResultUrls: globalSession.resultUrls,
      });

      if (!videoStatus) {
        return sendStatusResponse(404, { message: 'Request not found.' });
      }

      return sendStatusResponse(200, videoStatus);
    }

    let status = globalSession.status || 'PENDING';
    const resultUrls = Array.isArray(globalSession.resultUrls) ? globalSession.resultUrls : [];
    let resultUrl = globalSession.resultUrl || resultUrls[0] || null;
    let message = globalSession.errorMessage || null;

    if (globalSession.sessionType === 'image') {
      const sessionId = globalSession.sessionId?.toString();
      if (sessionId && mongoose.Types.ObjectId.isValid(sessionId)) {
        const imageDoc = await ImageGeneration.findOne({ _id: sessionId });
        if (imageDoc) {
          if (imageDoc.operationType === 'EDIT') {
            status = imageDoc.editStatus || imageDoc.apiEditStatus || status;
          } else {
            status = imageDoc.generationStatus || imageDoc.apiGenerationStatus || status;
          }
        }
      }
    }

    const responsePayload = {
      session_id: globalSession.sessionId,
      request_id: globalSession.requestId || globalSession.sessionId,
      status: status || 'PENDING',
      type: globalSession.sessionType,
      provider: globalSession.provider || null,
    };

    if (resultUrl) {
      responsePayload.result_url = resultUrl;
    }
    if (resultUrls.length) {
      responsePayload.result_urls = resultUrls;
    }
    if (globalSession.thumbnailUrl) {
      responsePayload.thumbnail_url = globalSession.thumbnailUrl;
    }
    if (message) {
      responsePayload.message = message;
    }

    const normalizedStatus = (responsePayload.status || 'PENDING').toString().toUpperCase();

    if (
      globalSession.sessionSubType === 'rollup_banner_enhance' &&
      normalizedStatus === 'COMPLETED'
    ) {
      const inputImageUrls = Array.isArray(globalSession?.metadata?.inputImageUrls)
        ? globalSession.metadata.inputImageUrls.filter(Boolean)
        : Array.isArray(globalSession?.inputUrls)
          ? globalSession.inputUrls.filter(Boolean)
          : [];
      if (inputImageUrls.length) {
        responsePayload.input_image_urls = inputImageUrls;
      }
    }
    return sendStatusResponse(200, responsePayload);
  } catch (error) {
    if (error?.code === 'API_KEY_EXPIRED' || error?.code === 'APP_KEY_EXPIRED') {
      return sendStatusResponse(401, {
        message: error.message,
      });
    }
    if (error?.status && error.status < 500) {
      return sendStatusResponse(error.status, {
        message: error.message,
      });
    }
    console.error('[api][status] failed', {
      traceId,
      sessionId: requestId || null,
      error: error?.message || error,
    });
    return sendStatusResponse(500, { message: 'Internal server error while getting status.' });
  }
});

export default router;
