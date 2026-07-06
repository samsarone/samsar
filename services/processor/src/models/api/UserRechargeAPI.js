import { createHash, randomBytes } from 'crypto';
import fetch from 'node-fetch';
import Stripe from 'stripe';
import validator from 'validator';
import hat from 'hat';
import dayjs from 'dayjs';

import User from '../../schema/User.js';
import { getDBConnectionString } from '../DBString.js';
import { generateOAuthAuthToken } from '../Auth.js';
import { sendProgrammaticCheckoutWelcomeEmail } from '../Mailer.js';

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

export const V2_USER_RECHARGE_INTENT = 'v2_user_recharge_credits';
const DEFAULT_CREDITS_PER_DOLLAR = 100;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 90;
const DEFAULT_MAX_RECHARGE_CENTS = 1000000;
const DEFAULT_MIN_RECHARGE_CENTS = 50;
const CALLBACK_TIMEOUT_MS = Number.parseInt(
  process.env.V2_USER_RECHARGE_CALLBACK_TIMEOUT_MS || '8000',
  10,
);

function normalizeString(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function buildValidationError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeEmail(value) {
  const email = normalizeString(value).toLowerCase();
  if (!email || !validator.isEmail(email)) {
    throw buildValidationError('email is required and must be a valid email address.');
  }
  return email;
}

function parseHttpsUrl(value, fieldName = 'redirect_url') {
  const raw = normalizeString(value);
  if (!raw) {
    throw buildValidationError(`${fieldName} is required.`);
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw buildValidationError(`${fieldName} must be a valid HTTPS URL.`);
  }

  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    throw buildValidationError(`${fieldName} must be a valid HTTPS URL.`);
  }

  return url.toString();
}

function getMaxRechargeCents() {
  const parsed = Number(
    process.env.V2_USER_RECHARGE_MAX_CENTS ||
    process.env.ANONYMOUS_CREDIT_CHECKOUT_MAX_CENTS,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_RECHARGE_CENTS;
}

function getMinRechargeCents() {
  const parsed = Number(process.env.V2_USER_RECHARGE_MIN_CENTS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_RECHARGE_CENTS;
}

function getCreditsPerDollar() {
  const parsed = Number(process.env.SAMSAR_CREDITS_PER_DOLLAR);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CREDITS_PER_DOLLAR;
}

function normalizeRechargeAmount(payload = {}) {
  const rawAmount = payload.amount ?? payload.amount_usd ?? payload.amountUsd;
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw buildValidationError('amount is required and must be a positive dollar amount.');
  }

  const amountCents = Math.round(amount * 100);
  const minAmountCents = getMinRechargeCents();
  const maxAmountCents = getMaxRechargeCents();

  if (amountCents < minAmountCents) {
    throw buildValidationError(
      `amount must be at least ${(minAmountCents / 100).toFixed(2)} USD.`,
    );
  }
  if (amountCents > maxAmountCents) {
    throw buildValidationError('amount exceeds the maximum checkout amount.');
  }

  return {
    amount,
    amountCents,
    credits: Math.max(1, Math.round(amount * getCreditsPerDollar())),
  };
}

function normalizeRechargePayload(payload = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw buildValidationError('Request body must be an object.');
  }

  const { amount, amountCents, credits } = normalizeRechargeAmount(payload);
  const email = normalizeEmail(payload.email);
  const redirectUrl = parseHttpsUrl(
    payload.redirect_url ?? payload.redirectUrl ?? payload.webhook_url ?? payload.webhookUrl,
    'redirect_url',
  );

  if (redirectUrl.length > 500) {
    throw buildValidationError('redirect_url must be 500 characters or fewer.');
  }

  return {
    amount,
    amountCents,
    credits,
    email,
    redirectUrl,
  };
}

function buildUrlWithParams(rawUrl, params = {}) {
  const url = new URL(rawUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
}

function buildUsernameFromEmail(email) {
  const localPart = normalizeString(email).split('@')[0] || 'customer';
  const safeLocalPart = localPart.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  return safeLocalPart ? `api-${safeLocalPart}` : `api-customer-${Date.now()}`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getRefreshTokenTtlDays() {
  const parsed = Number.parseInt(process.env.SAMSAR_OAUTH_REFRESH_TOKEN_TTL_DAYS || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_REFRESH_TOKEN_TTL_DAYS;
}

function getRefreshTokenExpiryDate() {
  return dayjs().add(getRefreshTokenTtlDays(), 'day').toDate();
}

function createRefreshToken() {
  return `srf_${randomBytes(48).toString('base64url')}`;
}

function hashRefreshToken(refreshToken) {
  return createHash('sha256').update(refreshToken).digest('hex');
}

export function isV2UserRechargeCheckoutSession(session) {
  return session?.metadata?.intent === V2_USER_RECHARGE_INTENT;
}

export async function createV2UserRechargeCheckoutSession(payload = {}) {
  const normalized = normalizeRechargePayload(payload);
  const productSummary = `Recharge ${normalized.credits} Samsar credits`;
  const metadata = {
    intent: V2_USER_RECHARGE_INTENT,
    apiVersion: 'v2',
    route: '/v2/user/recharge_credits',
    authFlow: 'oauth2_refresh_token',
    customerEmail: normalized.email,
    redirectUrl: normalized.redirectUrl,
    creditsRequested: String(normalized.credits),
    originalAmountCents: String(normalized.amountCents),
    productSummary,
  };

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    customer_creation: 'always',
    customer_email: normalized.email,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: productSummary,
          },
          unit_amount: normalized.amountCents,
        },
        quantity: 1,
      },
    ],
    success_url: buildUrlWithParams(normalized.redirectUrl, {
      samsarCheckoutStatus: 'success',
      checkoutSessionId: '{CHECKOUT_SESSION_ID}',
    }),
    cancel_url: buildUrlWithParams(normalized.redirectUrl, {
      samsarCheckoutStatus: 'cancelled',
    }),
    metadata,
    payment_intent_data: {
      metadata,
    },
  });

  return {
    url: session.url,
    checkoutSessionId: session.id,
    amount: normalized.amount,
    amountCents: normalized.amountCents,
    credits: normalized.credits,
    currency: 'USD',
    redirectUrl: normalized.redirectUrl,
  };
}

export async function ensureV2UserRechargeUserFromSession(session) {
  if (!isV2UserRechargeCheckoutSession(session)) {
    return null;
  }

  await getDBConnectionString();

  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id || null;
  const email = normalizeEmail(
    session.metadata?.customerEmail ||
    session.customer_details?.email ||
    session.customer_email,
  );

  let user = null;
  if (customerId) {
    user = await User.findOne({ stripeCustomerId: customerId });
  }
  if (!user) {
    user = await User.findOne({
      email: new RegExp(`^${escapeRegExp(email)}$`, 'i'),
    });
  }

  let created = false;
  let verificationCode = null;
  if (!user) {
    verificationCode = hat();
    user = new User({
      email,
      username: buildUsernameFromEmail(email),
      generationCredits: 0,
      userApiKeys: [],
      oauthRefreshTokens: [],
      userType: 'api_customer',
      isTempUser: false,
      isEmailVerified: false,
      verificationCode,
      verificationCodeExpiresAt: dayjs().add(24, 'hour').toDate(),
    });
    created = true;
  }

  if (!user.email) {
    user.email = email;
  }
  user.stripePaymentId = session.id;
  if (customerId && !user.stripeCustomerId) {
    user.stripeCustomerId = customerId;
  }
  if (!Array.isArray(user.oauthRefreshTokens)) {
    user.oauthRefreshTokens = [];
  }

  await user.save();

  if (created && verificationCode) {
    try {
      await sendProgrammaticCheckoutWelcomeEmail({
        userEmail: email,
        userName: user.username,
        verificationCode,
      });
    } catch (error) {
      console.error('[v2_user_recharge] failed to send welcome email', {
        checkoutSessionId: session.id,
        email,
        error: error?.message || error,
      });
    }
  }

  return {
    user,
    created,
    email,
  };
}

export async function issueProgrammaticOAuthTokensForUser(user, metadata = {}) {
  if (!user?._id) {
    throw buildValidationError('User is required to issue auth tokens.', 500);
  }

  const refreshToken = createRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const refreshTokenExpiresAt = getRefreshTokenExpiryDate();
  const userId = user._id.toString();
  const { authToken, expiresInSeconds, expiryDate } = generateOAuthAuthToken(userId, {
    checkoutSessionId: metadata.checkoutSessionId || undefined,
  });

  await User.updateOne(
    { _id: user._id },
    {
      $pull: {
        oauthRefreshTokens: {
          expiresAt: { $lte: new Date() },
        },
      },
    },
  );
  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        oauthRefreshTokens: {
          $each: [
            {
              tokenHash,
              expiresAt: refreshTokenExpiresAt,
              checkoutSessionId: metadata.checkoutSessionId || null,
              source: metadata.source || V2_USER_RECHARGE_INTENT,
            },
          ],
          $slice: -20,
        },
      },
    },
  );

  return {
    tokenType: 'Bearer',
    authToken,
    refreshToken,
    expiryDate,
    expiresInSeconds,
    refreshTokenExpiresAt,
  };
}

export async function refreshProgrammaticAuthToken(refreshToken) {
  const token = normalizeString(refreshToken);
  if (!token) {
    throw buildValidationError('refreshToken is required.');
  }

  await getDBConnectionString();

  const tokenHash = hashRefreshToken(token);
  const now = new Date();
  const user = await User.findOne({
    oauthRefreshTokens: {
      $elemMatch: {
        tokenHash,
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: now } },
        ],
      },
    },
  });

  if (!user) {
    throw buildValidationError('Invalid or expired refreshToken.', 401);
  }

  const storedRefreshToken = (user.oauthRefreshTokens || []).find(
    (entry) => entry?.tokenHash === tokenHash,
  );
  const claimResult = await User.updateOne(
    {
      _id: user._id,
      oauthRefreshTokens: {
        $elemMatch: {
          tokenHash,
          $or: [
            { expiresAt: { $exists: false } },
            { expiresAt: null },
            { expiresAt: { $gt: now } },
          ],
        },
      },
    },
    {
      $pull: {
        oauthRefreshTokens: { tokenHash },
      },
    },
  );

  if (!claimResult || claimResult.modifiedCount === 0) {
    throw buildValidationError('Invalid or expired refreshToken.', 401);
  }

  const newRefreshToken = createRefreshToken();
  const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
  const newRefreshTokenExpiresAt = getRefreshTokenExpiryDate();
  const checkoutSessionId = storedRefreshToken?.checkoutSessionId || undefined;
  const source = storedRefreshToken?.source || V2_USER_RECHARGE_INTENT;
  const { authToken, expiresInSeconds, expiryDate } = generateOAuthAuthToken(
    user._id.toString(),
    {
      checkoutSessionId,
    },
  );

  await User.updateOne(
    { _id: user._id },
    {
      $pull: {
        oauthRefreshTokens: {
          expiresAt: { $lte: now },
        },
      },
    },
  );
  await User.updateOne(
    { _id: user._id },
    {
      $push: {
        oauthRefreshTokens: {
          $each: [
            {
              tokenHash: newRefreshTokenHash,
              expiresAt: newRefreshTokenExpiresAt,
              lastUsedAt: now,
              checkoutSessionId: checkoutSessionId || null,
              source,
            },
          ],
          $slice: -20,
        },
      },
    },
  );

  return {
    tokenType: 'Bearer',
    authToken,
    refreshToken: newRefreshToken,
    expiryDate,
    expiresInSeconds,
    refreshTokenExpiresAt: newRefreshTokenExpiresAt,
  };
}

export async function deliverV2UserRechargeSuccessCallback({
  session,
  user,
  creditsApplied,
  amountPaidCents,
  paymentIntentId,
}) {
  const redirectUrl = parseHttpsUrl(session?.metadata?.redirectUrl, 'redirect_url');
  const tokens = await issueProgrammaticOAuthTokensForUser(user, {
    checkoutSessionId: session.id,
    source: V2_USER_RECHARGE_INTENT,
  });
  const expiryDate = tokens.expiryDate.toISOString();
  const callbackUrl = buildUrlWithParams(redirectUrl, {
    authToken: tokens.authToken,
    refreshToken: tokens.refreshToken,
    expiryDate,
  });
  const callbackBody = {
    tokenType: tokens.tokenType,
    authToken: tokens.authToken,
    refreshToken: tokens.refreshToken,
    expiryDate,
    expiresInSeconds: tokens.expiresInSeconds,
    refreshTokenExpiresAt: tokens.refreshTokenExpiresAt.toISOString(),
    checkoutSessionId: session.id,
    paymentIntentId,
    email: user.email || session.metadata?.customerEmail || null,
    creditsApplied,
    amountPaidCents,
    currency: session.currency || 'usd',
  };

  const controller = new AbortController();
  const timeoutMs = Number.isFinite(CALLBACK_TIMEOUT_MS) && CALLBACK_TIMEOUT_MS > 0
    ? CALLBACK_TIMEOUT_MS
    : 8000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const getResponse = await fetch(callbackUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });

    if (getResponse.status !== 404) {
      return {
        delivered: getResponse.ok,
        method: 'GET',
        status: getResponse.status,
      };
    }

    const postResponse = await fetch(callbackUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(callbackBody),
      signal: controller.signal,
    });

    return {
      delivered: postResponse.ok,
      method: 'POST',
      status: postResponse.status,
    };
  } finally {
    clearTimeout(timeout);
  }
}
