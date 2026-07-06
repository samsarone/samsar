import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

import ExternalUser from '../../schema/ExternalUser.js';
import ExternalUserGenerationCreditTransaction from '../../schema/ExternalUserGenerationCreditTransaction.js';
import ExternalUserPayment from '../../schema/ExternalUserPayment.js';
import ExternalUserRequest from '../../schema/ExternalUserRequest.js';
import UserPayment from '../../schema/UserPayment.js';
import VideoSession from '../../schema/VideoSession.js';
import { generateAPIKey } from '../../utils/ApiKeyUtils.js';
import { getDBConnectionString } from '../DBString.js';
import {
  creditGenerationCredits,
  deductGenerationCredits,
} from '../GenerationCredits.js';
import { getAPIKeyAuthContextFromAPIKey, verifyUserToken } from '../User.js';
import User from '../../schema/User.js';
import {
  generateExternalAuthToken,
  generateExternalLoginToken,
  getLoginTokenTtlSeconds,
} from '../Auth.js';
import { resolveAppKeyFromAuthHeaders } from '../api/AppKeyAPI.js';
import { setRequestAuthContext } from '../api/RequestAuthContext.js';
import {
  creditCustomerSubAccountCredits,
  deductCustomerSubAccountCredits,
  getCustomerSubAccountCreditSnapshot,
  resolveCustomerSubAccountFromAuthHeaders,
} from './CustomerSubAccount.js';

const EXTERNAL_USER_API_KEY_HEADER_NAMES = [
  'x-external-user-api-key',
  'external_user_api_key',
  'external-user-api-key',
  'EXTERNAL_USER_API_KEY',
];
const EXTERNAL_INTERNAL_SENSITIVE_FIELD_NAMES = new Set([
  'api_key',
  'api_token',
  'auth_header',
  'auth_headers',
  'auth_token',
  'authorization',
  'bearer_token',
  'credits_remaining',
  'external_api_key',
  'external_api_key_created_at',
  'external_api_key_last_used_at',
  'generation_credits',
  'has_external_api_key',
  'internal_api_key',
  'internal_user_id',
  'internal_credits_remaining',
  'internal_remaining_credits',
  'customer_sub_account_internal_api_key',
  'login_token',
  'remaining_credits',
  'refresh_token',
  'token',
  'upstream_request_id',
  'upstream_session_id',
]);
const EXTERNAL_STORED_SENSITIVE_FIELD_NAMES = new Set([
  ...EXTERNAL_INTERNAL_SENSITIVE_FIELD_NAMES,
  'session_id',
  'session_ids',
  'source_session_id',
  'source_session_ids',
  'upstream_request_id',
  'upstream_session_id',
  'video_session_id',
  'video_session_ids',
]);
const INTERNAL_EXTERNAL_USER_PROVIDER = 'samsar_internal';
const INTERNAL_EXTERNAL_USER_TYPE = 'internal_user';

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeFieldName(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

function normalizeStringArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => normalizeString(value))
    .filter(Boolean);
}

function getExternalRequestLookupIds(requestId) {
  const normalizedRequestId = normalizeString(requestId);
  if (!normalizedRequestId) {
    return [];
  }

  const lookupIds = [normalizedRequestId];
  if (/^[a-f0-9]{32}$/i.test(normalizedRequestId)) {
    lookupIds.push(`extreq_${normalizedRequestId.toLowerCase()}`);
  }

  return [...new Set(lookupIds)];
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  const sanitizedValue = sanitizeExternalFacingPayload(value);
  if (!sanitizedValue || typeof sanitizedValue !== 'object' || Array.isArray(sanitizedValue)) {
    return {};
  }

  return sanitizedValue;
}

function normalizeBrowserInstallation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  return Object.entries(value).reduce((result, [key, entryValue]) => {
    if (typeof entryValue === 'string') {
      const normalized = normalizeString(entryValue);
      if (normalized) {
        result[key] = normalized;
      }
      return result;
    }

    if (
      typeof entryValue === 'number' ||
      typeof entryValue === 'boolean' ||
      (entryValue && typeof entryValue === 'object' && !Array.isArray(entryValue))
    ) {
      result[key] = entryValue;
    }

    return result;
  }, {});
}

export function sanitizeExternalFacingPayload(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeExternalFacingPayload(entry));
  }

  if (!value || typeof value !== 'object' || value instanceof Date) {
    return value;
  }

  const sourceValue = value?.toObject?.() || value;
  if (!sourceValue || typeof sourceValue !== 'object' || sourceValue instanceof Date) {
    return sourceValue;
  }

  return Object.entries(sourceValue).reduce((result, [key, entryValue]) => {
    const normalizedKey = normalizeFieldName(key);
    if (normalizedKey && EXTERNAL_INTERNAL_SENSITIVE_FIELD_NAMES.has(normalizedKey)) {
      return result;
    }

    result[key] = sanitizeExternalFacingPayload(entryValue);
    return result;
  }, {});
}

function sanitizeStoredExternalPayload(value) {
  const sanitizedValue = sanitizeExternalFacingPayload(value);
  if (Array.isArray(sanitizedValue)) {
    return sanitizedValue;
  }

  if (!sanitizedValue || typeof sanitizedValue !== 'object' || sanitizedValue instanceof Date) {
    return sanitizedValue;
  }

  return Object.entries(sanitizedValue).reduce((result, [key, entryValue]) => {
    const normalizedKey = normalizeFieldName(key);
    if (normalizedKey && EXTERNAL_STORED_SENSITIVE_FIELD_NAMES.has(normalizedKey)) {
      return result;
    }

    result[key] = sanitizeStoredExternalPayload(entryValue);
    return result;
  }, {});
}

function getExternalUserApiKeyFromHeaders(headers = {}) {
  for (const headerName of EXTERNAL_USER_API_KEY_HEADER_NAMES) {
    const headerValue = normalizeString(headers?.[headerName]);
    if (headerValue) {
      return headerValue;
    }
  }

  return null;
}

function buildExternalUserApiKey() {
  return `sxu_${generateAPIKey()}`;
}

function isInternalBillingExternalUser(externalUser) {
  if (!externalUser) {
    return false;
  }

  return (
    normalizeString(externalUser.provider) === INTERNAL_EXTERNAL_USER_PROVIDER
    || normalizeString(externalUser.userType) === INTERNAL_EXTERNAL_USER_TYPE
    || Boolean(externalUser.customerSubAccountId || externalUser.customerSubAccountPublicId)
    || normalizeString(externalUser.metadata?.billingMode) === 'customer_sub_account'
    || normalizeString(externalUser.metadata?.billingMode) === 'internal'
  );
}

function customerSubAccountObjectId(customerSubAccount) {
  return customerSubAccount?._id || customerSubAccount?.id || null;
}

function customerSubAccountPublicId(customerSubAccount) {
  return normalizeString(customerSubAccount?.customerSubAccountId);
}

function customerSubAccountExternalId(customerSubAccount) {
  return normalizeString(customerSubAccount?.externalCustomerId);
}

function scopeExternalUserToCustomerSubAccount(normalized, customerSubAccount) {
  if (!customerSubAccount) {
    return normalized;
  }

  const publicId = customerSubAccountPublicId(customerSubAccount);
  const externalCustomerId = customerSubAccountExternalId(customerSubAccount);
  const externalAppId =
    normalizeString(normalized.externalAppId) ||
    externalCustomerId ||
    publicId ||
    normalizeString(customerSubAccount.externalAppId);
  const externalAccountId =
    normalizeString(normalized.externalAccountId) ||
    publicId ||
    externalCustomerId;

  return {
    ...normalized,
    externalAppId,
    externalAccountId,
    metadata: {
      ...(normalized.metadata || {}),
      billingMode: 'customer_sub_account',
      customerSubAccountAppId: normalizeString(customerSubAccount.externalAppId),
      customerSubAccountId: publicId,
      customerSubAccountExternalId: externalCustomerId,
    },
  };
}

function buildInternalExternalIdentityKey(internalUserId) {
  return buildExternalIdentityKey({
    provider: INTERNAL_EXTERNAL_USER_PROVIDER,
    externalUserId: internalUserId,
  });
}

function normalizeInternalExternalUserOverrides(payloadSource = {}) {
  const normalizedPayload = normalizeExternalUserPayload(payloadSource);
  return {
    email: normalizeString(normalizedPayload.email) || normalizeString(payloadSource.email),
    username: normalizeString(normalizedPayload.username) || normalizeString(payloadSource.username),
    displayName:
      normalizeString(normalizedPayload.displayName)
      || normalizeString(payloadSource.displayName)
      || normalizeString(payloadSource.display_name),
    avatarUrl:
      normalizeString(normalizedPayload.avatarUrl)
      || normalizeString(payloadSource.avatarUrl)
      || normalizeString(payloadSource.avatar_url),
    browserInstallation:
      normalizedPayload.browserInstallation
      || normalizeBrowserInstallation(payloadSource.browserInstallation)
      || normalizeBrowserInstallation(payloadSource.browser_installation),
    metadata: normalizeMetadata(
      normalizedPayload.metadata
      || payloadSource.metadata
      || payloadSource.external_metadata
      || payloadSource.externalMetadata,
    ),
  };
}

export async function ensureInternalMappedExternalUser({
  internalUserId,
  externalUserPayload = {},
} = {}) {
  await getDBConnectionString();

  const normalizedInternalUserId = normalizeString(internalUserId);
  if (!normalizedInternalUserId) {
    const error = new Error('Internal user ID is required.');
    error.status = 400;
    throw error;
  }

  const user = await User.findById(normalizedInternalUserId)
    .select('email username displayName pfpUrl generationCredits')
    .lean();

  if (!user) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const overrides = normalizeInternalExternalUserOverrides(externalUserPayload);
  const externalIdentityKey = buildInternalExternalIdentityKey(normalizedInternalUserId);
  const now = new Date();
  const metadata = {
    ...overrides.metadata,
    billingMode: 'internal',
    internalUserId: normalizedInternalUserId,
  };

  return ExternalUser.findOneAndUpdate(
    { externalIdentityKey },
    {
      $set: {
        internalUserId: normalizedInternalUserId,
        provider: INTERNAL_EXTERNAL_USER_PROVIDER,
        externalUserId: normalizedInternalUserId,
        uniqueKey: normalizedInternalUserId,
        externalAppId: null,
        externalCompanyId: null,
        externalAccountId: null,
        email: overrides.email || normalizeString(user.email),
        username: overrides.username || normalizeString(user.username),
        displayName:
          overrides.displayName
          || normalizeString(user.displayName)
          || normalizeString(user.username)
          || normalizeString(user.email)
          || 'Samsar user',
        avatarUrl: overrides.avatarUrl || normalizeString(user.pfpUrl),
        userType: INTERNAL_EXTERNAL_USER_TYPE,
        browserInstallation: overrides.browserInstallation,
        metadata,
        generationCredits: Number(user.generationCredits) || 0,
        lastActivityAt: now,
      },
      $setOnInsert: {
        externalIdentityKey,
      },
    },
    {
      new: true,
      upsert: true,
    },
  );
}

async function syncInternalExternalUserBalance(
  externalUser,
  remainingCredits,
  {
    increment = {},
    set = {},
  } = {},
) {
  if (!externalUser?._id) {
    return null;
  }

  const nextGenerationCredits = Number.isFinite(Number(remainingCredits))
    ? Math.max(0, Number(remainingCredits))
    : Number(externalUser.generationCredits) || 0;
  const incEntries = Object.entries(increment).filter(([, value]) => Number(value) !== 0);
  const update = {
    $set: {
      generationCredits: nextGenerationCredits,
      lastActivityAt: new Date(),
      ...set,
    },
  };

  if (incEntries.length > 0) {
    update.$inc = Object.fromEntries(incEntries);
  }

  return ExternalUser.findByIdAndUpdate(externalUser._id, update, { new: true });
}

function buildExternalCreditAuditMetadata(externalUser, metadata = {}) {
  return {
    ...normalizeMetadata(metadata),
    externalIdentityKey: externalUser?.externalIdentityKey ?? null,
    externalProvider: externalUser?.provider ?? null,
    externalUserId: externalUser?._id?.toString?.() || externalUser?.id || null,
    externalUserExternalId: externalUser?.externalUserId ?? null,
    customerSubAccountId: externalUser?.customerSubAccountPublicId ?? null,
    customerSubAccountExternalId: externalUser?.customerSubAccountExternalId ?? null,
  };
}

function getExternalUserCustomerSubAccountRef(externalUser) {
  return externalUser?.customerSubAccountId ?? null;
}

async function debitInternalAndCustomerSubAccountCredits({
  externalUser,
  credits,
  source,
  metadata = {},
}) {
  const customerSubAccountRef = getExternalUserCustomerSubAccountRef(externalUser);
  const subAccountDebit = customerSubAccountRef
    ? await deductCustomerSubAccountCredits(customerSubAccountRef, credits, { source, metadata })
    : { enforced: false, remainingCredits: null };

  try {
    const internalDebit = await deductGenerationCredits(externalUser.internalUserId, credits, {
      source,
      metadata,
    });

    return {
      internalDebit,
      subAccountDebit,
      remainingCredits: subAccountDebit.enforced
        ? subAccountDebit.remainingCredits
        : internalDebit?.remainingCredits,
    };
  } catch (error) {
    if (subAccountDebit.enforced) {
      try {
        await creditCustomerSubAccountCredits(
          customerSubAccountRef,
          credits,
          { countAsRefund: false, reverseUsage: true },
        );
      } catch {
      }
    }
    throw error;
  }
}

async function creditInternalAndCustomerSubAccountCredits({
  externalUser,
  credits,
  source,
  metadata = {},
}) {
  const internalCredit = await creditGenerationCredits(externalUser.internalUserId, credits, {
    source,
    metadata,
  });
  const customerSubAccountRef = getExternalUserCustomerSubAccountRef(externalUser);
  const subAccountCredit = customerSubAccountRef
    ? await creditCustomerSubAccountCredits(customerSubAccountRef, credits)
    : { enforced: false, remainingCredits: null };

  return {
    internalCredit,
    subAccountCredit,
    remainingCredits: subAccountCredit.enforced
      ? subAccountCredit.remainingCredits
      : internalCredit?.remainingCredits,
  };
}

async function recordExternalUserCreditTransaction({
  externalUser,
  amount,
  direction,
  source,
  metadata = {},
  balanceAfter = null,
}) {
  const normalizedAmount = Number(amount);
  if (
    !externalUser?._id
    || !externalUser?.internalUserId
    || !Number.isFinite(normalizedAmount)
    || normalizedAmount <= 0
    || !direction
  ) {
    return null;
  }

  await getDBConnectionString();
  const transaction = new ExternalUserGenerationCreditTransaction({
    internalUserId: externalUser.internalUserId?.toString?.() || externalUser.internalUserId,
    externalUserId: externalUser._id,
    externalIdentityKey: externalUser.externalIdentityKey ?? null,
    externalProvider: externalUser.provider ?? null,
    externalUserExternalId: externalUser.externalUserId ?? null,
    customerSubAccountId: externalUser.customerSubAccountId ?? null,
    customerSubAccountPublicId: externalUser.customerSubAccountPublicId ?? null,
    customerSubAccountExternalId: externalUser.customerSubAccountExternalId ?? null,
    amount: normalizedAmount,
    direction,
    source,
    metadata: buildExternalCreditAuditMetadata(externalUser, metadata),
    balanceAfter,
  });

  await transaction.save();
  return transaction;
}

function formatCreditTopUp(payment) {
  if (!payment) {
    return null;
  }

  const receiptUrl = payment.receiptUrl || payment.invoicePdfUrl || payment.hostedInvoiceUrl || null;
  return {
    id: payment._id?.toString(),
    amountPaidCents: payment.amountPaidCents ?? 0,
    currency: payment.currency?.toUpperCase?.() ?? 'USD',
    paymentType: payment.paymentType ?? null,
    paymentStatus: payment.paymentStatus ?? null,
    billingReason: payment.billingReason ?? null,
    creditsApplied: payment.creditsApplied ?? 0,
    paymentDate: payment.paymentDate ?? payment.createdAt ?? null,
    stripeInvoiceId: payment.stripeInvoiceId ?? null,
    stripeInvoiceNumber: payment.stripeInvoiceNumber ?? null,
    invoicePdfUrl: payment.invoicePdfUrl ?? null,
    hostedInvoiceUrl: payment.hostedInvoiceUrl ?? null,
    receiptUrl,
    receiptAvailable: Boolean(receiptUrl),
    productSummary: payment.productSummary ?? null,
  };
}

export function buildExternalIdentityKey({
  provider,
  externalUserId,
  externalAppId,
  externalCompanyId,
  externalAccountId,
}) {
  const normalizedProvider = normalizeString(provider)?.toLowerCase();
  const normalizedExternalUserId = normalizeString(externalUserId);
  if (!normalizedProvider || !normalizedExternalUserId) {
    return null;
  }

  return [
    normalizedProvider,
    normalizeString(externalAppId) ||
      normalizeString(externalCompanyId) ||
      normalizeString(externalAccountId) ||
      'default',
    normalizedExternalUserId,
  ].join(':');
}

export function normalizeExternalUserPayload(payloadSource = {}) {
  const externalUser = payloadSource?.external_user ?? payloadSource?.externalUser ?? payloadSource ?? {};
  const browserInstallation =
    normalizeBrowserInstallation(externalUser.browser_installation) ||
    normalizeBrowserInstallation(externalUser.browserInstallation) ||
    normalizeBrowserInstallation(payloadSource.browser_installation) ||
    normalizeBrowserInstallation(payloadSource.browserInstallation) ||
    normalizeBrowserInstallation(payloadSource.browser_installer) ||
    normalizeBrowserInstallation(payloadSource.browserInstaller);

  const provider =
    normalizeString(externalUser.provider) ||
    normalizeString(payloadSource.provider) ||
    normalizeString(payloadSource.external_provider) ||
    normalizeString(payloadSource.externalProvider);
  const externalUserId =
    normalizeString(externalUser.external_user_id) ||
    normalizeString(externalUser.externalUserId) ||
    normalizeString(externalUser.user_id) ||
    normalizeString(externalUser.userId) ||
    normalizeString(payloadSource.external_user_id) ||
    normalizeString(payloadSource.externalUserId) ||
    normalizeString(payloadSource.provider_user_id) ||
    normalizeString(payloadSource.providerUserId);
  const uniqueKey =
    normalizeString(externalUser.unique_key) ||
    normalizeString(externalUser.uniqueKey) ||
    normalizeString(payloadSource.unique_key) ||
    normalizeString(payloadSource.uniqueKey) ||
    externalUserId;

  return {
    provider,
    externalUserId: externalUserId || uniqueKey,
    uniqueKey,
    externalAppId:
      normalizeString(externalUser.external_app_id) ||
      normalizeString(externalUser.externalAppId) ||
      normalizeString(payloadSource.external_app_id) ||
      normalizeString(payloadSource.externalAppId),
    externalCompanyId:
      normalizeString(externalUser.external_company_id) ||
      normalizeString(externalUser.externalCompanyId) ||
      normalizeString(payloadSource.external_company_id) ||
      normalizeString(payloadSource.externalCompanyId),
    externalAccountId:
      normalizeString(externalUser.external_account_id) ||
      normalizeString(externalUser.externalAccountId) ||
      normalizeString(payloadSource.external_account_id) ||
      normalizeString(payloadSource.externalAccountId),
    email:
      normalizeString(externalUser.email) ||
      normalizeString(payloadSource.email),
    username:
      normalizeString(externalUser.username) ||
      normalizeString(payloadSource.username),
    displayName:
      normalizeString(externalUser.display_name) ||
      normalizeString(externalUser.displayName) ||
      normalizeString(payloadSource.display_name) ||
      normalizeString(payloadSource.displayName),
    avatarUrl:
      normalizeString(externalUser.avatar_url) ||
      normalizeString(externalUser.avatarUrl) ||
      normalizeString(payloadSource.avatar_url) ||
      normalizeString(payloadSource.avatarUrl),
    userType:
      normalizeString(externalUser.user_type) ||
      normalizeString(externalUser.userType) ||
      normalizeString(payloadSource.user_type) ||
      normalizeString(payloadSource.userType),
    browserInstallation,
    metadata: normalizeMetadata(
      externalUser.metadata ??
      externalUser.profile ??
      payloadSource.external_metadata ??
      payloadSource.externalMetadata,
    ),
  };
}

export function formatExternalUser(externalUser) {
  if (!externalUser) {
    return null;
  }

  return {
    id: externalUser._id?.toString?.() || externalUser.id || null,
    provider: externalUser.provider,
    external_user_id: externalUser.externalUserId,
    unique_key: externalUser.uniqueKey ?? externalUser.externalUserId ?? null,
    external_app_id: externalUser.externalAppId ?? null,
    external_company_id: externalUser.externalCompanyId ?? null,
    external_account_id: externalUser.externalAccountId ?? null,
    customer_sub_account_id: externalUser.customerSubAccountPublicId ?? null,
    customer_sub_account_external_id: externalUser.customerSubAccountExternalId ?? null,
    email: externalUser.email ?? null,
    username: externalUser.username ?? null,
    display_name: externalUser.displayName ?? null,
    avatar_url: externalUser.avatarUrl ?? null,
    user_type: externalUser.userType ?? null,
    browser_installation: externalUser.browserInstallation ?? null,
    generation_credits: Number(externalUser.generationCredits) || 0,
    has_external_api_key: Boolean(externalUser.externalApiKey),
    external_api_key_created_at: externalUser.externalApiKeyCreatedAt ?? null,
    external_api_key_last_used_at: externalUser.externalApiKeyLastUsedAt ?? null,
    total_requests: externalUser.totalRequests ?? 0,
    total_credits_used: externalUser.totalCreditsUsed ?? 0,
    total_credits_refunded: externalUser.totalCreditsRefunded ?? 0,
    total_credits_purchased: externalUser.totalCreditsPurchased ?? 0,
    last_request_at: externalUser.lastRequestAt ?? null,
    last_purchase_at: externalUser.lastPurchaseAt ?? null,
    last_activity_at: externalUser.lastActivityAt ?? null,
    created_at: externalUser.createdAt ?? null,
    updated_at: externalUser.updatedAt ?? null,
  };
}

export function formatExternalUserClientProfile(externalUser, { authToken = null } = {}) {
  if (!externalUser) {
    return null;
  }

  return {
    _id: externalUser._id?.toString?.() || externalUser.id || null,
    authToken: authToken || undefined,
    isExternalUser: true,
    provider: externalUser.provider ?? null,
    externalUserId: externalUser.externalUserId ?? null,
    uniqueKey: externalUser.uniqueKey ?? externalUser.externalUserId ?? null,
    externalAppId: externalUser.externalAppId ?? null,
    externalCompanyId: externalUser.externalCompanyId ?? null,
    externalAccountId: externalUser.externalAccountId ?? null,
    customerSubAccountId: externalUser.customerSubAccountPublicId ?? null,
    customerSubAccountExternalId: externalUser.customerSubAccountExternalId ?? null,
    email: externalUser.email ?? null,
    username: externalUser.username ?? null,
    displayName: externalUser.displayName ?? null,
    avatarUrl: externalUser.avatarUrl ?? null,
    userType: externalUser.userType ?? null,
    browserInstallation: externalUser.browserInstallation ?? null,
    generationCredits: Number(externalUser.generationCredits) || 0,
    totalRequests: Number(externalUser.totalRequests) || 0,
    totalCreditsUsed: Number(externalUser.totalCreditsUsed) || 0,
    totalCreditsRefunded: Number(externalUser.totalCreditsRefunded) || 0,
    totalCreditsPurchased: Number(externalUser.totalCreditsPurchased) || 0,
    lastRequestAt: externalUser.lastRequestAt ?? null,
    lastPurchaseAt: externalUser.lastPurchaseAt ?? null,
    lastActivityAt: externalUser.lastActivityAt ?? null,
    createdAt: externalUser.createdAt ?? null,
    updatedAt: externalUser.updatedAt ?? null,
  };
}

export function createExternalAuthTokenForUser(externalUser) {
  if (!externalUser?._id || !externalUser?.internalUserId) {
    throw new Error('External user is required to create an auth token.');
  }

  return generateExternalAuthToken({
    internalUserId: externalUser.internalUserId?.toString?.() || externalUser.internalUserId,
    externalUserId: externalUser._id?.toString?.() || externalUser._id,
    externalIdentityKey: externalUser.externalIdentityKey ?? null,
  });
}

export function createExternalLoginTokenForUser(externalUser) {
  if (!externalUser?._id || !externalUser?.internalUserId) {
    throw new Error('External user is required to create a login token.');
  }

  const loginToken = generateExternalLoginToken({
    internalUserId: externalUser.internalUserId?.toString?.() || externalUser.internalUserId,
    externalUserId: externalUser._id?.toString?.() || externalUser._id,
    externalIdentityKey: externalUser.externalIdentityKey ?? null,
  });
  const expiresInSeconds = getLoginTokenTtlSeconds();
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  return {
    loginToken,
    expiresInSeconds,
    expiresAt,
  };
}

export async function resolveExternalUserFromAuthToken(authToken) {
  if (!authToken || typeof authToken !== 'string') {
    return null;
  }

  let decoded;
  try {
    const secret = process.env.TOKEN_SECRET;
    decoded = jwt.verify(authToken, secret);
  } catch (error) {
    const authErrorNames = new Set(['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError']);
    if (authErrorNames.has(error?.name)) {
      return null;
    }
    throw error;
  }

  if (decoded?.type !== 'external_auth') {
    return null;
  }

  await getDBConnectionString();

  const externalUserId = normalizeString(decoded.externalUserId);
  const internalUserId = normalizeString(decoded._id);
  if (!externalUserId || !internalUserId) {
    return null;
  }

  const externalUser = await ExternalUser.findOne({
    _id: externalUserId,
    internalUserId,
  });

  return externalUser || null;
}

function extractExternalRequestVideoUrl(requestRecord) {
  const responsePayload = requestRecord?.responsePayload || {};
  const resultUrls = Array.isArray(responsePayload?.result_urls) ? responsePayload.result_urls : [];

  return (
    normalizeString(requestRecord?.resultUrl) ||
    normalizeString(responsePayload?.result_url) ||
    normalizeString(resultUrls.find((value) => typeof value === 'string')) ||
    normalizeString(responsePayload?.remoteURL) ||
    normalizeString(responsePayload?.videoLink) ||
    null
  );
}

function extractExternalRequestPrompt(requestRecord) {
  const requestPayload = requestRecord?.requestPayload || {};
  const prompt = (
    normalizeString(requestPayload?.prompt) ||
    normalizeString(requestPayload?.videoGenerationPrompt) ||
    null
  );

  if (prompt) {
    return prompt;
  }

  const routeKey = normalizeString(requestRecord?.routeKey)?.toLowerCase();
  if (routeKey === 'translate_video') {
    const language =
      normalizeString(requestPayload?.target_language) ||
      normalizeString(requestPayload?.language) ||
      normalizeString(requestPayload?.language_code);
    return language ? `Retranslated to ${language.toUpperCase()}` : 'Retranslated video';
  }

  if (routeKey === 'join_videos') {
    const sourceSessionIds = normalizeStringArray(
      requestPayload?.source_request_ids ||
      requestPayload?.request_ids ||
      requestPayload?.source_session_ids ||
      requestPayload?.session_ids,
    );
    if (sourceSessionIds.length > 0) {
      return `Joined ${sourceSessionIds.length} videos`;
    }
    return 'Joined video';
  }

  return null;
}

function extractExternalRequestImageCount(requestRecord) {
  const requestPayload = requestRecord?.requestPayload || {};
  return Array.isArray(requestPayload?.image_urls) ? requestPayload.image_urls.length : 0;
}

function toRequestObject(requestRecord) {
  return requestRecord?.toObject?.() || requestRecord || {};
}

function getRequestExternalUserId(requestRecord) {
  const requestPayload = toRequestObject(requestRecord);
  const externalUserId = requestPayload?.externalUserId;

  if (!externalUserId) {
    return null;
  }

  return (
    externalUserId?._id?.toString?.() ||
    externalUserId?.toString?.() ||
    null
  );
}

function mergeExternalRequestRecords(baseRecord, updatedRecord) {
  if (!updatedRecord) {
    return baseRecord;
  }

  const basePayload = toRequestObject(baseRecord);
  const updatedPayload = toRequestObject(updatedRecord);

  return {
    ...basePayload,
    ...updatedPayload,
    externalUserId: basePayload.externalUserId ?? updatedPayload.externalUserId ?? null,
  };
}

function buildStatusReqLike(req) {
  if (req && typeof req.get === 'function') {
    return req;
  }

  return {
    get() {
      return null;
    },
    protocol: 'https',
  };
}

function formatPublishedSessionFields(sessionData) {
  if (!sessionData) {
    return {
      is_published: false,
      published_title: null,
      published_description: null,
      published_tags: [],
      published_at: null,
      published_video_url: null,
      published_publication_id: null,
      has_subtitles: null,
      language: null,
    };
  }

  const normalizedTags = Array.isArray(sessionData.publishedTags)
    ? sessionData.publishedTags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter(Boolean)
    : [];

  return {
    is_published: Boolean(sessionData.ispublishedVideo),
    published_title: normalizeString(sessionData.publishedTitle),
    published_description: normalizeString(sessionData.publishedDescription),
    published_tags: normalizedTags,
    published_at: sessionData.publishedAt ?? null,
    published_video_url:
      normalizeString(sessionData.publishedVideoURL) ||
      normalizeString(sessionData.remoteURL) ||
      normalizeString(sessionData.videoLink) ||
      null,
    published_publication_id: normalizeString(sessionData.publishedPublicationId),
    has_subtitles:
      typeof sessionData.hasSubtitles === 'boolean'
        ? sessionData.hasSubtitles
        : typeof sessionData.has_subtitles === 'boolean'
          ? sessionData.has_subtitles
          : typeof sessionData.enableSubtitles === 'boolean'
            ? sessionData.enableSubtitles
            : null,
    language:
      normalizeString(sessionData.sessionLanguage) ||
      normalizeString(sessionData.language) ||
      null,
  };
}

async function getUpstreamSessionForExternalRequest(requestRecord) {
  const requestPayload = toRequestObject(requestRecord);
  const upstreamSessionId =
    normalizeString(requestPayload.upstreamSessionId) ||
    normalizeString(requestPayload.upstreamRequestId);

  if (!upstreamSessionId) {
    return null;
  }

  return VideoSession.findById(upstreamSessionId).lean();
}

export function formatExternalRequestSummary(requestRecord, sessionData = null) {
  if (!requestRecord) {
    return null;
  }

  const requestPayload = toRequestObject(requestRecord)?.requestPayload || {};

  return {
    request_id: requestRecord.externalRequestId,
    external_request_id: requestRecord.externalRequestId,
    route_key: requestRecord.routeKey || null,
    status: requestRecord.status || 'PENDING',
    prompt: extractExternalRequestPrompt(requestRecord),
    video_url: extractExternalRequestVideoUrl(requestRecord),
    image_count: extractExternalRequestImageCount(requestRecord),
    credits_charged: Number(requestRecord.creditsCharged) || 0,
    credits_refunded: Number(requestRecord.creditsRefunded) || 0,
    express_generation_credit_charges: sessionData?.expressGenerationCreditCharges || null,
    target_language:
      normalizeString(requestPayload?.target_language) ||
      normalizeString(requestPayload?.language) ||
      normalizeString(requestPayload?.language_code) ||
      null,
    source_request_ids: normalizeStringArray(requestPayload?.source_request_ids),
    created_at: requestRecord.createdAt ?? null,
    updated_at: requestRecord.updatedAt ?? null,
    ...formatPublishedSessionFields(sessionData),
  };
}

export async function resolveRequestActorFromAuthHeaders(headers = {}) {
  const authorizationHeader = headers.authorization || headers.Authorization;
  const bearerToken = authorizationHeader?.split(' ')[1];
  const apiKeyHeader = headers.api_key || headers.API_KEY;
  const customerSubAccount = await resolveCustomerSubAccountFromAuthHeaders(headers);
  const rememberAuthContext = (authContext) => {
    setRequestAuthContext(authContext);
    return authContext;
  };

  if (customerSubAccount?.internalUserId) {
    return rememberAuthContext({
      authType: 'customer_sub_account_api_key',
      externalUser: null,
      internalUserId: customerSubAccount.internalUserId?.toString?.() || customerSubAccount.internalUserId,
      customerSubAccount,
    });
  }

  const appKeyContext = await resolveAppKeyFromAuthHeaders(headers);
  if (appKeyContext?.internalUserId) {
    return rememberAuthContext(appKeyContext);
  }

  if (!bearerToken && !apiKeyHeader) {
    const error = new Error('API_KEY, auth token, or APP_KEY header is missing or empty.');
    error.status = 400;
    throw error;
  }

  if (bearerToken) {
    const externalUser = await resolveExternalUserFromAuthToken(bearerToken);
    if (externalUser?.internalUserId) {
      return rememberAuthContext({
        authType: 'external_auth',
        externalUser,
        internalUserId: externalUser.internalUserId?.toString?.() || externalUser.internalUserId,
      });
    }

    const tokenParts = bearerToken.split('.');
    const looksLikeJwt = tokenParts.length === 3 && tokenParts.every(Boolean);

    if (looksLikeJwt) {
      try {
        const userData = await verifyUserToken({ authToken: bearerToken });
        const userId = userData?._id?.toString();
        if (!userId) {
          const error = new Error('Invalid auth token. User not found.');
          error.status = 401;
          throw error;
        }

        return rememberAuthContext({
          authType: 'auth_token',
          externalUser: null,
          internalUserId: userId,
        });
      } catch (error) {
        const authErrorNames = new Set(['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError']);
        if (authErrorNames.has(error?.name)) {
          const authError = new Error('Invalid auth token. User not found.');
          authError.status = 401;
          throw authError;
        }

        throw error;
      }
    }

    const apiKeyContext = await getAPIKeyAuthContextFromAPIKey(bearerToken);
    if (!apiKeyContext?.userId) {
      const error = new Error('Invalid API_KEY. User not found.');
      error.status = 401;
      throw error;
    }

    return rememberAuthContext({
      authType: 'api_key',
      externalUser: null,
      internalUserId: apiKeyContext.userId,
      apiKeyId: apiKeyContext.apiKeyId,
      apiKeyUsageLimit: apiKeyContext.apiKeyUsageLimit,
      apiKeyUsageLimitPeriod: apiKeyContext.apiKeyUsageLimitPeriod,
    });
  }

  const apiKeyContext = await getAPIKeyAuthContextFromAPIKey(apiKeyHeader);
  if (!apiKeyContext?.userId) {
    const error = new Error('Invalid API_KEY. User not found.');
    error.status = 401;
    throw error;
  }

  return rememberAuthContext({
    authType: 'api_key',
    externalUser: null,
    internalUserId: apiKeyContext.userId,
    apiKeyId: apiKeyContext.apiKeyId,
    apiKeyUsageLimit: apiKeyContext.apiKeyUsageLimit,
    apiKeyUsageLimitPeriod: apiKeyContext.apiKeyUsageLimitPeriod,
  });
}

export async function resolveInternalUserIdFromAuthHeaders(headers = {}) {
  const context = await resolveRequestActorFromAuthHeaders(headers);
  return context.internalUserId;
}

export async function upsertExternalUser({
  internalUserId,
  externalUserPayload,
  customerSubAccount = null,
}) {
  await getDBConnectionString();

  const normalized = scopeExternalUserToCustomerSubAccount(
    normalizeExternalUserPayload(externalUserPayload),
    customerSubAccount,
  );
  if (!normalized.provider) {
    const error = new Error('external_user.provider is required.');
    error.status = 400;
    throw error;
  }
  if (!normalized.externalUserId) {
    const error = new Error('external_user.external_user_id is required.');
    error.status = 400;
    throw error;
  }

  const externalIdentityKey = buildExternalIdentityKey(normalized);
  if (!externalIdentityKey) {
    const error = new Error('Unable to build external user identity.');
    error.status = 400;
    throw error;
  }

  const now = new Date();
  const customerSubAccountFields = customerSubAccount
    ? {
        customerSubAccountId: customerSubAccountObjectId(customerSubAccount),
        customerSubAccountPublicId: customerSubAccountPublicId(customerSubAccount),
        customerSubAccountExternalId: customerSubAccountExternalId(customerSubAccount),
      }
    : {};
  const doc = await ExternalUser.findOneAndUpdate(
    { externalIdentityKey },
    {
      $set: {
        internalUserId,
        provider: normalized.provider.toLowerCase(),
        externalUserId: normalized.externalUserId,
        uniqueKey: normalized.uniqueKey || normalized.externalUserId,
        externalAppId: normalized.externalAppId,
        externalCompanyId: normalized.externalCompanyId,
        externalAccountId: normalized.externalAccountId,
        ...customerSubAccountFields,
        email: normalized.email,
        username: normalized.username,
        displayName: normalized.displayName,
        avatarUrl: normalized.avatarUrl,
        userType: normalized.userType,
        browserInstallation: normalized.browserInstallation,
        metadata: normalized.metadata,
        lastActivityAt: now,
      },
      $setOnInsert: {
        externalIdentityKey,
      },
    },
    {
      new: true,
      upsert: true,
    },
  );

  return doc;
}

export async function ensureExternalUserApiKey(externalUser, { rotate = false } = {}) {
  await getDBConnectionString();

  if (!externalUser?._id) {
    return null;
  }

  if (!rotate && normalizeString(externalUser.externalApiKey)) {
    return externalUser;
  }

  const now = new Date();
  let nextApiKey = buildExternalUserApiKey();
  let attemptsRemaining = 5;

  while (attemptsRemaining > 0) {
    try {
      const updatedExternalUser = await ExternalUser.findByIdAndUpdate(
        externalUser._id,
        {
          $set: {
            externalApiKey: nextApiKey,
            externalApiKeyCreatedAt: now,
            lastActivityAt: now,
          },
        },
        { new: true },
      );

      return updatedExternalUser;
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }

      attemptsRemaining -= 1;
      nextApiKey = buildExternalUserApiKey();
    }
  }

  const keyError = new Error('Unable to generate external user API key.');
  keyError.status = 500;
  throw keyError;
}

export async function createExternalAssistantSession({
  externalUser,
  sessionName = null,
  metadata = null,
} = {}) {
  await getDBConnectionString();

  if (!externalUser?._id || !externalUser?.internalUserId) {
    const error = new Error('External user is required to create an assistant session.');
    error.status = 400;
    throw error;
  }

  const { createNewBlankQuickSession } = await import('../QuickSession.js');
  const sessionId = await createNewBlankQuickSession(externalUser.internalUserId);
  const now = new Date();
  const sessionMetadata = {
    ...(externalUser?.browserInstallation ? { browserInstallation: externalUser.browserInstallation } : {}),
    ...(externalUser?.userType ? { userType: externalUser.userType } : {}),
    ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
    externalAssistantSession: true,
  };

  const session = await VideoSession.findByIdAndUpdate(
    sessionId,
    {
      $set: {
        sessionName: normalizeString(sessionName) || 'External assistant session',
        sessionType: 'assistant',
        externalRequestUserId: externalUser._id.toString(),
        externalRequestIdentityKey: externalUser.externalIdentityKey,
        metadata: sessionMetadata,
        lastActivityAt: now,
      },
    },
    { new: true },
  );

  return {
    session_id: session?._id?.toString?.() || sessionId,
    request_id: session?._id?.toString?.() || sessionId,
    session_type: session?.sessionType || 'assistant',
    session_name: session?.sessionName || 'External assistant session',
    created_at: session?.createdAt ?? now,
    updated_at: session?.updatedAt ?? now,
    metadata: session?.metadata ?? sessionMetadata,
    external_user: formatExternalUser(externalUser),
  };
}

export async function resolveExternalUserFromAuthHeaders({
  internalUserId,
  headers = {},
}) {
  await getDBConnectionString();

  const authorizationHeader = headers.authorization || headers.Authorization;
  const bearerToken = authorizationHeader?.split(' ')[1];
  if (bearerToken) {
    const externalUserFromToken = await resolveExternalUserFromAuthToken(bearerToken);
    if (externalUserFromToken) {
      if (
        internalUserId &&
        (externalUserFromToken.internalUserId?.toString?.() || externalUserFromToken.internalUserId) !==
          internalUserId?.toString?.()
      ) {
        const error = new Error('Invalid external user auth token.');
        error.status = 401;
        throw error;
      }

      const now = new Date();
      await ExternalUser.updateOne(
        { _id: externalUserFromToken._id },
        {
          $set: {
            lastActivityAt: now,
          },
        },
      );

      externalUserFromToken.lastActivityAt = now;
      return externalUserFromToken;
    }
  }

  const externalApiKey = getExternalUserApiKeyFromHeaders(headers);
  if (!externalApiKey) {
    return null;
  }

  const externalUser = await ExternalUser.findOne({
    internalUserId,
    externalApiKey,
  });

  if (!externalUser) {
    const error = new Error('Invalid external user API key.');
    error.status = 401;
    throw error;
  }

  const now = new Date();
  await ExternalUser.updateOne(
    { _id: externalUser._id },
    {
      $set: {
        externalApiKeyLastUsedAt: now,
        lastActivityAt: now,
      },
    },
  );

  externalUser.externalApiKeyLastUsedAt = now;
  externalUser.lastActivityAt = now;
  return externalUser;
}

export async function createExternalRequestRecord({
  externalUser,
  routeKey,
  requestPayload,
  webhookUrl = null,
  metadata = {},
}) {
  await getDBConnectionString();

  const externalRequestId = `extreq_${randomUUID().replace(/-/g, '')}`;
  const sanitizedRequestPayload = sanitizeStoredExternalPayload(requestPayload);
  const record = await ExternalUserRequest.create({
    externalRequestId,
    internalUserId: externalUser.internalUserId,
    externalUserId: externalUser._id,
    externalIdentityKey: externalUser.externalIdentityKey,
    customerSubAccountId: externalUser.customerSubAccountId ?? null,
    customerSubAccountPublicId: externalUser.customerSubAccountPublicId ?? null,
    customerSubAccountExternalId: externalUser.customerSubAccountExternalId ?? null,
    routeKey,
    status: 'PENDING',
    requestPayload:
      sanitizedRequestPayload &&
      typeof sanitizedRequestPayload === 'object' &&
      !Array.isArray(sanitizedRequestPayload)
        ? sanitizedRequestPayload
        : {},
    webhookUrl,
    metadata: normalizeMetadata(metadata),
  });

  return record;
}

function normalizeCreditAmount(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  return Math.floor(numericValue);
}

async function applyExternalChargeTargetByRequest({
  requestRecord,
  targetCreditsCharged,
  enforceAvailableBalance = false,
  auditSource = null,
  auditMetadata = null,
}) {
  await getDBConnectionString();

  if (!requestRecord?._id || !requestRecord.externalUserId) {
    return {
      requestRecord,
      externalUser: null,
    };
  }

  const normalizedTarget = normalizeCreditAmount(targetCreditsCharged);
  const currentCreditsCharged = normalizeCreditAmount(requestRecord.creditsCharged);
  const creditsDelta = normalizedTarget - currentCreditsCharged;
  const now = new Date();
  const auditSourceBase =
    normalizeString(auditSource) ||
    `external_request_${normalizeString(requestRecord.routeKey) || 'unknown'}`;
  const baseAuditMetadata = {
    routeKey: requestRecord.routeKey || null,
    externalRequestId: requestRecord.externalRequestId || null,
    upstreamRequestId: requestRecord.upstreamRequestId || null,
    upstreamSessionId: requestRecord.upstreamSessionId || null,
    creditsDelta,
    targetCreditsCharged: normalizedTarget,
    currentCreditsCharged,
    enforceAvailableBalance,
    ...(auditMetadata && typeof auditMetadata === 'object' && !Array.isArray(auditMetadata)
      ? auditMetadata
      : {}),
  };
  const scopedExternalUser = await ExternalUser.findById(requestRecord.externalUserId);
  const usesInternalCredits = isInternalBillingExternalUser(scopedExternalUser);

  let updatedExternalUser = scopedExternalUser;

  if (creditsDelta > 0) {
    if (usesInternalCredits && scopedExternalUser?.internalUserId) {
      const deduction = await debitInternalAndCustomerSubAccountCredits({
        externalUser: scopedExternalUser,
        credits: creditsDelta,
        source: `${auditSourceBase}_charge`,
        metadata: baseAuditMetadata,
      });
      updatedExternalUser = await syncInternalExternalUserBalance(
        scopedExternalUser,
        deduction?.remainingCredits,
        {
          increment: {
            totalCreditsUsed: creditsDelta,
          },
        },
      );
    } else {
      const debitUpdate = {
        $inc: {
          generationCredits: -creditsDelta,
          totalCreditsUsed: creditsDelta,
        },
        $set: {
          lastActivityAt: now,
        },
      };

      updatedExternalUser = enforceAvailableBalance
        ? await ExternalUser.findOneAndUpdate(
          {
            _id: requestRecord.externalUserId,
            generationCredits: { $gte: creditsDelta },
          },
          debitUpdate,
          { new: true },
        )
        : await ExternalUser.findByIdAndUpdate(requestRecord.externalUserId, debitUpdate, { new: true });

      if (!updatedExternalUser && enforceAvailableBalance) {
        const error = new Error('Insufficient credits');
        error.code = 'INSUFFICIENT_CREDITS';
        error.status = 402;
        throw error;
      }
    }
  } else if (creditsDelta < 0) {
    const refundDelta = Math.abs(creditsDelta);
    if (usesInternalCredits && scopedExternalUser?.internalUserId) {
      const credit = await creditInternalAndCustomerSubAccountCredits({
        externalUser: scopedExternalUser,
        credits: refundDelta,
        source: `${auditSourceBase}_refund`,
        metadata: baseAuditMetadata,
      });
      updatedExternalUser = await syncInternalExternalUserBalance(
        scopedExternalUser,
        credit?.remainingCredits,
        {
          increment: {
            totalCreditsRefunded: refundDelta,
          },
        },
      );
    } else {
      updatedExternalUser = await ExternalUser.findByIdAndUpdate(
        requestRecord.externalUserId,
        {
          $inc: {
            generationCredits: refundDelta,
            totalCreditsRefunded: refundDelta,
          },
          $set: {
            lastActivityAt: now,
          },
        },
        { new: true },
      );
    }
  } else {
    updatedExternalUser = await ExternalUser.findByIdAndUpdate(
      requestRecord.externalUserId,
      {
        $set: {
          lastActivityAt: now,
        },
      },
      { new: true },
    );
  }

  const resolvedRemainingCredits =
    updatedExternalUser?.generationCredits === undefined || updatedExternalUser?.generationCredits === null
      ? (requestRecord.remainingCreditsSnapshot ?? null)
      : Number(updatedExternalUser.generationCredits);

  const updatedRequestRecord = await ExternalUserRequest.findByIdAndUpdate(
    requestRecord._id,
    {
      $set: {
        creditsCharged: normalizedTarget,
        remainingCreditsSnapshot: resolvedRemainingCredits,
      },
    },
    { new: true },
  );

  if (updatedExternalUser && creditsDelta !== 0) {
    await recordExternalUserCreditTransaction({
      externalUser: updatedExternalUser,
      amount: Math.abs(creditsDelta),
      direction: creditsDelta > 0 ? 'debit' : 'credit',
      source: creditsDelta > 0 ? `${auditSourceBase}_charge` : `${auditSourceBase}_refund`,
      metadata: baseAuditMetadata,
      balanceAfter: Number(updatedExternalUser?.generationCredits) || 0,
    });
  }

  return {
    requestRecord: updatedRequestRecord,
    externalUser: updatedExternalUser,
  };
}

export async function reserveExternalRequestCredits({
  externalRequestId,
  creditsToReserve,
  auditSource = null,
  auditMetadata = null,
}) {
  await getDBConnectionString();

  const normalizedExternalRequestId = normalizeString(externalRequestId);
  if (!normalizedExternalRequestId) {
    return null;
  }

  const requestRecord = await ExternalUserRequest.findOne({
    externalRequestId: normalizedExternalRequestId,
  });
  if (!requestRecord) {
    return null;
  }

  const { requestRecord: updatedRequestRecord } = await applyExternalChargeTargetByRequest({
    requestRecord,
    targetCreditsCharged: creditsToReserve,
    enforceAvailableBalance: true,
    auditSource,
    auditMetadata,
  });

  return updatedRequestRecord;
}

export async function refundExternalRequestCredits({
  externalRequestId,
  creditsToRefund,
  reason = null,
  status = 'FAILED',
  responsePayload = null,
}) {
  await getDBConnectionString();

  const normalizedExternalRequestId = normalizeString(externalRequestId);
  if (!normalizedExternalRequestId) {
    return null;
  }

  const requestRecord = await ExternalUserRequest.findOne({
    externalRequestId: normalizedExternalRequestId,
  });
  if (!requestRecord) {
    return null;
  }

  const currentCreditsCharged = normalizeCreditAmount(requestRecord.creditsCharged);
  const requestedRefund = normalizeCreditAmount(creditsToRefund);
  const refundAmount = requestedRefund > 0 ? Math.min(currentCreditsCharged, requestedRefund) : currentCreditsCharged;
  const nextCreditsCharged = Math.max(0, currentCreditsCharged - refundAmount);
  const sanitizedResponsePayload = sanitizeExternalFacingPayload(responsePayload);

  const { requestRecord: updatedRequestRecord } = await applyExternalChargeTargetByRequest({
    requestRecord,
    targetCreditsCharged: nextCreditsCharged,
    enforceAvailableBalance: false,
  });

  return ExternalUserRequest.findByIdAndUpdate(
    updatedRequestRecord?._id || requestRecord._id,
    {
      $set: {
        status: normalizeString(status) || requestRecord.status || 'FAILED',
        errorMessage: normalizeString(reason) || requestRecord.errorMessage || 'Credits refunded.',
        creditsRefunded: Math.max(Number(requestRecord.creditsRefunded) || 0, refundAmount),
        ...(sanitizedResponsePayload ? { responsePayload: sanitizedResponsePayload } : {}),
      },
    },
    { new: true },
  );
}

export async function linkExternalRequestToSession({
  externalRequestId,
  upstreamSessionId,
  externalUser,
}) {
  await getDBConnectionString();

  const normalizedSessionId = normalizeString(upstreamSessionId);
  if (!normalizedSessionId || !externalUser?._id) {
    return null;
  }

  return VideoSession.findByIdAndUpdate(
    normalizedSessionId,
    {
      $set: {
        isExternalUserRequest: true,
        externalRequestUserId: externalUser._id.toString(),
        externalRequestId: normalizeString(externalRequestId),
        externalRequestIdentityKey: externalUser.externalIdentityKey,
      },
    },
    { new: true },
  );
}

export async function markExternalRequestAccepted({
  externalRequestId,
  upstreamRequestId,
  upstreamSessionId,
  responsePayload,
  creditsCharged = null,
  remainingCredits = null,
  resultUrl = null,
}) {
  await getDBConnectionString();

  const record = await ExternalUserRequest.findOne({ externalRequestId });
  if (!record) {
    return null;
  }

  const now = new Date();
  const shouldCountAsRequest = record.routeKey !== 'upload_image_data';
  const isFirstAcceptance =
    !normalizeString(record.upstreamRequestId) &&
    !normalizeString(record.upstreamSessionId);
  const sanitizedResponsePayload = sanitizeExternalFacingPayload(responsePayload);
  const sanitizedResponsePayloadObject =
    sanitizedResponsePayload &&
    typeof sanitizedResponsePayload === 'object' &&
    !Array.isArray(sanitizedResponsePayload)
      ? sanitizedResponsePayload
      : {};

  const hasExplicitCreditsCharged = creditsCharged !== null && creditsCharged !== undefined;
  const normalizedCreditsCharged = hasExplicitCreditsCharged && Number.isFinite(Number(creditsCharged))
    ? Math.max(0, Number(creditsCharged))
    : normalizeCreditAmount(record.creditsCharged);
  const chargeUpdate = await applyExternalChargeTargetByRequest({
    requestRecord: record,
    targetCreditsCharged: normalizedCreditsCharged,
    enforceAvailableBalance: false,
  });

  let updatedExternalUser = chargeUpdate.externalUser;
  if (shouldCountAsRequest && isFirstAcceptance) {
    updatedExternalUser = await ExternalUser.findByIdAndUpdate(
      record.externalUserId,
      {
        $inc: {
          totalRequests: 1,
        },
        $set: {
          lastRequestAt: now,
          lastActivityAt: now,
        },
      },
      { new: true },
    );
  }

  const resolvedRemainingCredits =
    updatedExternalUser?.generationCredits === undefined || updatedExternalUser?.generationCredits === null
      ? (
        chargeUpdate.requestRecord?.remainingCreditsSnapshot ??
        (remainingCredits === null || remainingCredits === undefined ? null : Number(remainingCredits))
      )
      : Number(updatedExternalUser.generationCredits);

  const updatedRecord = await ExternalUserRequest.findOneAndUpdate(
    { externalRequestId },
    {
      $set: {
        upstreamRequestId: normalizeString(upstreamRequestId),
        upstreamSessionId: normalizeString(upstreamSessionId),
        responsePayload: {
          ...(record.responsePayload || {}),
          ...sanitizedResponsePayloadObject,
        },
        status: 'PENDING',
        creditsCharged: normalizedCreditsCharged,
        remainingCreditsSnapshot: resolvedRemainingCredits,
        resultUrl: normalizeString(resultUrl) || record.resultUrl || null,
      },
    },
    { new: true },
  );

  return updatedRecord;
}

export async function syncExternalRequestChargeBySessionId({
  externalRequestId = null,
  sessionId,
  creditsCharged,
  responsePayload = null,
}) {
  await getDBConnectionString();

  const normalizedSessionId = normalizeString(sessionId);
  const normalizedExternalRequestId = normalizeString(externalRequestId);
  if (!normalizedSessionId && !normalizedExternalRequestId) {
    return null;
  }

  const requestRecord = await ExternalUserRequest.findOne({
    ...(normalizedExternalRequestId
      ? { externalRequestId: normalizedExternalRequestId }
      : { upstreamSessionId: normalizedSessionId }),
  });

  if (!requestRecord) {
    return null;
  }

  return markExternalRequestAccepted({
    externalRequestId: requestRecord.externalRequestId,
    upstreamRequestId: requestRecord.upstreamRequestId || normalizedSessionId,
    upstreamSessionId: normalizedSessionId || requestRecord.upstreamSessionId,
    responsePayload,
    creditsCharged,
  });
}

export async function markExternalRequestFailed({
  externalRequestId,
  errorMessage,
  status = 'FAILED',
  responsePayload = null,
}) {
  await getDBConnectionString();
  const sanitizedResponsePayload = sanitizeExternalFacingPayload(responsePayload);

  return ExternalUserRequest.findOneAndUpdate(
    { externalRequestId },
    {
      $set: {
        status,
        errorMessage: normalizeString(errorMessage),
        ...(sanitizedResponsePayload ? { responsePayload: sanitizedResponsePayload } : {}),
      },
    },
    { new: true },
  );
}

export async function syncExternalRequestStatus({
  externalRequestId,
  status,
  resultUrl = null,
  responsePayload = null,
  errorMessage = null,
}) {
  await getDBConnectionString();
  const sanitizedResponsePayload = sanitizeExternalFacingPayload(responsePayload);

  return ExternalUserRequest.findOneAndUpdate(
    { externalRequestId },
    {
      $set: {
        ...(normalizeString(status) ? { status: normalizeString(status) } : {}),
        ...(normalizeString(resultUrl) ? { resultUrl: normalizeString(resultUrl) } : {}),
        ...(sanitizedResponsePayload ? { responsePayload: sanitizedResponsePayload } : {}),
        ...(errorMessage !== null ? { errorMessage: normalizeString(errorMessage) } : {}),
      },
    },
    { new: true },
  );
}

export async function findExternalRequestForInternalUser({
  internalUserId,
  requestId,
  externalUserId = null,
}) {
  await getDBConnectionString();

  const normalizedRequestId = normalizeString(requestId);
  if (!normalizedRequestId) {
    return null;
  }
  const lookupIds = getExternalRequestLookupIds(normalizedRequestId);

  const query = {
    internalUserId,
    ...(externalUserId ? { externalUserId } : {}),
    $or: [
      { externalRequestId: { $in: lookupIds } },
      { upstreamRequestId: normalizedRequestId },
      { upstreamSessionId: normalizedRequestId },
    ],
  };

  return ExternalUserRequest.findOne(query).populate('externalUserId');
}

export async function findExternalRequestsForInternalUser({
  internalUserId,
  requestIds = [],
  externalUserId = null,
}) {
  await getDBConnectionString();

  const normalizedRequestIds = [...new Set(normalizeStringArray(requestIds))];
  if (!normalizedRequestIds.length) {
    return [];
  }
  const externalRequestLookupIds = [
    ...new Set(normalizedRequestIds.flatMap((requestId) => getExternalRequestLookupIds(requestId))),
  ];

  return ExternalUserRequest.find({
    internalUserId,
    ...(externalUserId ? { externalUserId } : {}),
    $or: [
      { externalRequestId: { $in: externalRequestLookupIds } },
      { upstreamRequestId: { $in: normalizedRequestIds } },
      { upstreamSessionId: { $in: normalizedRequestIds } },
    ],
  }).populate('externalUserId');
}

export async function getTextToVideoCreditSnapshot({
  upstreamSessionId,
}) {
  await getDBConnectionString();

  const session = await VideoSession.findById(upstreamSessionId)
    .select('expressGenerationCreditCharges provisionalCredits')
    .lean();
  const stagedCreditsCharged = Number(session?.expressGenerationCreditCharges?.totalCharged) || 0;

  return {
    creditsCharged: stagedCreditsCharged || Number(session?.provisionalCredits) || 0,
  };
}

export async function applyExternalRequestRefundBySessionId({
  internalUserId,
  sessionId,
  creditsRefunded,
  reason,
  externalUserId = null,
}) {
  await getDBConnectionString();

  const normalizedSessionId = normalizeString(sessionId);
  const normalizedRefund = Number(creditsRefunded);
  if (!normalizedSessionId || !Number.isFinite(normalizedRefund) || normalizedRefund <= 0) {
    return null;
  }

  const requestRecord = await ExternalUserRequest.findOne({
    internalUserId,
    ...(externalUserId ? { externalUserId } : {}),
    upstreamSessionId: normalizedSessionId,
  });

  if (!requestRecord) {
    return null;
  }

  const currentRefund = Number(requestRecord.creditsRefunded) || 0;
  const refundDelta = Math.max(0, normalizedRefund - currentRefund);
  if (refundDelta <= 0) {
    return requestRecord;
  }

  const now = new Date();
  const scopedExternalUser = await ExternalUser.findById(requestRecord.externalUserId);
  const updatedExternalUser =
    isInternalBillingExternalUser(scopedExternalUser) && scopedExternalUser?.internalUserId
      ? await (async () => {
        const creditResult = await creditGenerationCredits(
          scopedExternalUser.internalUserId,
          refundDelta,
          {
            source: `external_request_${normalizeString(requestRecord.routeKey) || 'unknown'}_refund`,
            metadata: {
              routeKey: requestRecord.routeKey || null,
              externalRequestId: requestRecord.externalRequestId || null,
              upstreamRequestId: requestRecord.upstreamRequestId || null,
              upstreamSessionId: requestRecord.upstreamSessionId || null,
              reason: normalizeString(reason) || null,
              creditsRefunded: normalizedRefund,
              refundDelta,
            },
          },
        );
        return syncInternalExternalUserBalance(
          scopedExternalUser,
          creditResult?.remainingCredits,
          {
            increment: {
              totalCreditsRefunded: refundDelta,
            },
            set: { lastActivityAt: now },
          },
        );
      })()
      : await ExternalUser.findByIdAndUpdate(
        requestRecord.externalUserId,
        {
          $inc: {
            generationCredits: refundDelta,
            totalCreditsRefunded: refundDelta,
          },
          $set: { lastActivityAt: now },
        },
        { new: true },
      );

  await recordExternalUserCreditTransaction({
    externalUser: updatedExternalUser || {
      _id: requestRecord.externalUserId,
      internalUserId: requestRecord.internalUserId,
      externalIdentityKey: requestRecord.externalIdentityKey,
    },
    amount: refundDelta,
    direction: 'credit',
    source: `external_request_${normalizeString(requestRecord.routeKey) || 'unknown'}_refund`,
    metadata: {
      routeKey: requestRecord.routeKey || null,
      externalRequestId: requestRecord.externalRequestId || null,
      upstreamRequestId: requestRecord.upstreamRequestId || null,
      upstreamSessionId: requestRecord.upstreamSessionId || null,
      reason: normalizeString(reason) || null,
      creditsRefunded: normalizedRefund,
      refundDelta,
    },
    balanceAfter: Number(updatedExternalUser?.generationCredits) || 0,
  });

  const updatedRecord = await ExternalUserRequest.findByIdAndUpdate(
    requestRecord._id,
    {
      $set: {
        creditsRefunded: normalizedRefund,
        status: 'FAILED',
        errorMessage: normalizeString(reason) || requestRecord.errorMessage || 'Credits refunded.',
        remainingCreditsSnapshot:
          updatedExternalUser?.generationCredits === undefined || updatedExternalUser?.generationCredits === null
            ? requestRecord.remainingCreditsSnapshot ?? null
            : Number(updatedExternalUser.generationCredits),
      },
    },
    { new: true },
  );

  return updatedRecord;
}

export async function syncExternalRequestWithUpstreamStatus({
  requestRecord,
  req = null,
}) {
  const requestPayload = toRequestObject(requestRecord);
  const sessionId = requestPayload.upstreamSessionId || requestPayload.upstreamRequestId || null;
  const requestId = requestPayload.upstreamRequestId || requestPayload.upstreamSessionId || null;

  if (!sessionId && !requestId) {
    return {
      externalRequest: requestRecord,
      upstreamStatus: null,
    };
  }

  const { buildVideoStatusResponse } = await import('../api/StatusAPI.js');
  const upstreamStatus = await buildVideoStatusResponse({
    sessionId,
    requestId,
    provider: null,
    req: buildStatusReqLike(req),
    defaultResultUrl:
      normalizeString(requestPayload.resultUrl) ||
      normalizeString(requestPayload?.responsePayload?.result_url) ||
      undefined,
    defaultResultUrls: Array.isArray(requestPayload?.responsePayload?.result_urls)
      ? requestPayload.responsePayload.result_urls
      : undefined,
  });

  if (!upstreamStatus) {
    return {
      externalRequest: requestRecord,
      upstreamStatus: null,
    };
  }

  let latestExternalRequest = requestRecord;
  const usesExpressStageBilling = Boolean(
    upstreamStatus.expressGenerationCreditCharges ||
    upstreamStatus.express_generation_credit_charges,
  );

  if (upstreamStatus.status === 'COMPLETED') {
    const updatedRequest = await syncExternalRequestStatus({
      externalRequestId: requestPayload.externalRequestId,
      status: 'COMPLETED',
      resultUrl:
        normalizeString(upstreamStatus.result_url) ||
        normalizeString(requestPayload.resultUrl) ||
        null,
      responsePayload: {
        ...(requestPayload.responsePayload || {}),
        ...upstreamStatus,
      },
    });
    latestExternalRequest = mergeExternalRequestRecords(requestRecord, updatedRequest);
  } else if (
    (upstreamStatus.status === 'FAILED' || upstreamStatus.status === 'CANCELLED') &&
    !usesExpressStageBilling &&
    (Number(requestPayload.creditsCharged) || 0) > (Number(requestPayload.creditsRefunded) || 0)
  ) {
    const updatedRequest = await applyExternalRequestRefundBySessionId({
      internalUserId: requestPayload.internalUserId,
      sessionId,
      creditsRefunded: Number(requestPayload.creditsCharged) || 0,
      reason:
        upstreamStatus.message || upstreamStatus.expressGenerationError || upstreamStatus.status,
      externalUserId: getRequestExternalUserId(requestRecord),
    });
    latestExternalRequest = mergeExternalRequestRecords(requestRecord, updatedRequest);
  } else if (
    upstreamStatus.status === 'FAILED' ||
    upstreamStatus.status === 'CANCELLED' ||
    normalizeString(requestPayload.status) !== normalizeString(upstreamStatus.status)
  ) {
    const updatedRequest = await syncExternalRequestStatus({
      externalRequestId: requestPayload.externalRequestId,
      status: upstreamStatus.status,
      responsePayload: {
        ...(requestPayload.responsePayload || {}),
        ...upstreamStatus,
      },
      errorMessage:
        upstreamStatus.status === 'FAILED' || upstreamStatus.status === 'CANCELLED'
          ? upstreamStatus.message || upstreamStatus.expressGenerationError || upstreamStatus.status
          : null,
    });
    latestExternalRequest = mergeExternalRequestRecords(requestRecord, updatedRequest);
  }

  return {
    externalRequest: latestExternalRequest,
    upstreamStatus,
  };
}

export function buildExternalStatusResponse({
  externalRequest,
  upstreamStatus,
  sessionData = null,
}) {
  const requestPayload = externalRequest?.toObject?.() || externalRequest || {};
  const sanitizedUpstreamStatus = sanitizeExternalFacingPayload(upstreamStatus) || {};

  return {
    ...sanitizedUpstreamStatus,
    request_id: requestPayload.externalRequestId,
    session_id: requestPayload.externalRequestId,
    external_request_id: requestPayload.externalRequestId,
    external_session_id: requestPayload.externalRequestId,
    creditsCharged: requestPayload.creditsCharged ?? 0,
    creditsRefunded: requestPayload.creditsRefunded ?? 0,
    ...formatPublishedSessionFields(sessionData),
  };
}

export async function getExternalCreditsBalance({
  externalUser,
}) {
  await getDBConnectionString();

  let resolvedExternalUser = externalUser;
  let lastTopUpPayment;

  if (isInternalBillingExternalUser(externalUser)) {
    if (externalUser?.customerSubAccountId) {
      const creditSnapshot = await getCustomerSubAccountCreditSnapshot(externalUser.customerSubAccountId);
      resolvedExternalUser = await syncInternalExternalUserBalance(
        externalUser,
        creditSnapshot.remainingCredits,
      );
    } else {
      resolvedExternalUser = await ensureInternalMappedExternalUser({
        internalUserId: externalUser.internalUserId,
        externalUserPayload: externalUser,
      });
    }
    lastTopUpPayment = await UserPayment.findOne({
      userId: externalUser.internalUserId,
      creditsApplied: { $gt: 0 },
    })
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();
  } else {
    lastTopUpPayment = await ExternalUserPayment.findOne({
      internalUserId: externalUser.internalUserId,
      externalUserId: externalUser._id,
      creditsApplied: { $gt: 0 },
    })
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();
  }

  return {
    remainingCredits: Number(resolvedExternalUser?.generationCredits) || 0,
    lastTopUp: formatCreditTopUp(lastTopUpPayment),
    externalUser: formatExternalUser(resolvedExternalUser),
  };
}

export async function listExternalUserRequests({
  externalUser,
  limit = 12,
  req = null,
}) {
  await getDBConnectionString();

  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 12, 48));
  const requests = await ExternalUserRequest.find({
    externalUserId: externalUser._id,
    routeKey: { $in: ['text_to_video', 'image_list_to_video', 'translate_video', 'join_videos'] },
    status: { $ne: 'ARCHIVED' },
  })
    .sort({ createdAt: -1, updatedAt: -1 })
    .limit(normalizedLimit);

  const syncedRequests = await Promise.all(
    requests.map(async (requestRecord) => {
      const hasVideoUrl = Boolean(extractExternalRequestVideoUrl(requestRecord));
      const status = normalizeString(requestRecord?.status)?.toUpperCase() || 'PENDING';
      const shouldSync =
        !hasVideoUrl ||
        status === 'PENDING' ||
        status === 'PROCESSING' ||
        status === 'IN_PROGRESS';

      if (!shouldSync) {
        return toRequestObject(requestRecord);
      }

      const { externalRequest } = await syncExternalRequestWithUpstreamStatus({
        requestRecord,
        req,
      });
      return toRequestObject(externalRequest);
    }),
  );

  const enrichedRequests = await Promise.all(
    syncedRequests.map(async (requestRecord) => ({
      requestRecord,
      sessionData: await getUpstreamSessionForExternalRequest(requestRecord),
    })),
  );

  return enrichedRequests
    .map(({ requestRecord, sessionData }) => formatExternalRequestSummary(requestRecord, sessionData))
    .filter(Boolean);
}

export async function archiveExternalUserRequest({
  internalUserId,
  externalUser,
  requestId,
}) {
  await getDBConnectionString();

  const requestRecord = await findExternalRequestForInternalUser({
    internalUserId,
    requestId,
    externalUserId: externalUser?._id ?? null,
  });

  if (!requestRecord) {
    const error = new Error('External request not found.');
    error.status = 404;
    throw error;
  }

  const upstreamSessionId =
    normalizeString(requestRecord.upstreamSessionId) ||
    normalizeString(requestRecord.upstreamRequestId);

  let refreshedSession = null;
  if (upstreamSessionId) {
    const sessionData = await VideoSession.findById(upstreamSessionId);
    if (sessionData) {
      if (sessionData.ispublishedVideo || sessionData.publishedPublicationId || sessionData.publishedVideoURL) {
        const { unpublishSessionVideo } = await import('../Publication.js');
        await unpublishSessionVideo(internalUserId, { sessionId: upstreamSessionId });
      }
      refreshedSession = await VideoSession.findById(upstreamSessionId).lean();
    }
  }

  const archivedRequest = await ExternalUserRequest.findByIdAndUpdate(
    requestRecord._id,
    {
      $set: {
        status: 'ARCHIVED',
        archivedAt: new Date(),
        lastArchivedAt: new Date(),
        responsePayload: {
          ...(requestRecord.responsePayload || {}),
          archived: true,
        },
      },
    },
    { new: true },
  );

  return {
    request: formatExternalRequestSummary(archivedRequest, refreshedSession),
    external_user: formatExternalUser(externalUser),
  };
}

export async function publishExternalUserRequest({
  internalUserId,
  externalUser,
  requestId,
  payload = {},
}) {
  await getDBConnectionString();

  const requestRecord = await findExternalRequestForInternalUser({
    internalUserId,
    requestId,
    externalUserId: externalUser?._id ?? null,
  });

  if (!requestRecord) {
    const error = new Error('External request not found.');
    error.status = 404;
    throw error;
  }

  const upstreamSessionId =
    normalizeString(requestRecord.upstreamSessionId) ||
    normalizeString(requestRecord.upstreamRequestId);

  if (!upstreamSessionId) {
    const error = new Error('Upstream session is missing for this external request.');
    error.status = 409;
    throw error;
  }

  const sessionData = await VideoSession.findById(upstreamSessionId);
  if (!sessionData) {
    const error = new Error('Video session not found.');
    error.status = 404;
    throw error;
  }

  if (!sessionData.remoteURL && !sessionData.videoLink && !sessionData.publishedVideoURL) {
    const error = new Error('Video is not ready to publish yet.');
    error.status = 409;
    throw error;
  }

  const publishPayload = {
    id: upstreamSessionId,
    title: normalizeString(payload.title) || extractExternalRequestPrompt(requestRecord) || undefined,
    description: normalizeString(payload.description) || undefined,
    tags: Array.isArray(payload.tags)
      ? payload.tags
      : (typeof payload.tags === 'string' ? payload.tags : undefined),
    aspectRatio: normalizeString(payload.aspectRatio) || normalizeString(sessionData.aspectRatio) || undefined,
    sessionLanguage:
      normalizeString(payload.sessionLanguage) ||
      normalizeString(sessionData.sessionLanguage) ||
      normalizeString(sessionData.language) ||
      undefined,
    languageString:
      normalizeString(payload.languageString) ||
      normalizeString(sessionData.languageString) ||
      undefined,
    hasSubtitles:
      typeof payload.hasSubtitles === 'boolean'
        ? payload.hasSubtitles
        : typeof payload.has_subtitles === 'boolean'
          ? payload.has_subtitles
          : typeof sessionData.hasSubtitles === 'boolean'
            ? sessionData.hasSubtitles
            : typeof sessionData.has_subtitles === 'boolean'
              ? sessionData.has_subtitles
              : typeof sessionData.enableSubtitles === 'boolean'
                ? sessionData.enableSubtitles
                : undefined,
  };

  const { createPublicationForSessionVideo } = await import('../Publication.js');
  const publication = await createPublicationForSessionVideo(internalUserId, publishPayload);
  const refreshedSession = await VideoSession.findById(upstreamSessionId).lean();

  return {
    request: formatExternalRequestSummary(requestRecord, refreshedSession),
    publication: publication?.toObject?.() || publication || null,
    external_user: formatExternalUser(externalUser),
  };
}

export async function grantExternalUserCredits({
  internalUserId,
  externalUser,
  credits,
  source = 'manual_grant',
  metadata = {},
}) {
  await getDBConnectionString();

  const normalizedCredits = Number(credits);
  if (!Number.isFinite(normalizedCredits) || normalizedCredits <= 0) {
    const error = new Error('credits must be a positive number.');
    error.status = 400;
    throw error;
  }

  const grantedCredits = Math.floor(normalizedCredits);
  if (grantedCredits <= 0) {
    const error = new Error('credits must be at least 1.');
    error.status = 400;
    throw error;
  }

  const creditResult = await creditGenerationCredits(internalUserId, grantedCredits, {
    source,
    metadata: {
      ...normalizeMetadata(metadata),
      externalIdentityKey: externalUser.externalIdentityKey,
      externalProvider: externalUser.provider,
      externalUserId: externalUser._id?.toString?.() || externalUser.id || null,
      externalUserExternalId: externalUser.externalUserId,
    },
  });

  const updatedExternalUser = isInternalBillingExternalUser(externalUser)
    ? await syncInternalExternalUserBalance(
      externalUser,
      creditResult?.remainingCredits,
      {
        increment: source === 'manual_grant' ? {} : { totalCreditsPurchased: grantedCredits },
        set: source === 'manual_grant' ? {} : { lastPurchaseAt: new Date() },
      },
    )
    : await ExternalUser.findByIdAndUpdate(
      externalUser._id,
      {
        $inc: {
          generationCredits: grantedCredits,
          ...(source === 'manual_grant' ? {} : { totalCreditsPurchased: grantedCredits }),
        },
        $set: {
          ...(source === 'manual_grant' ? {} : { lastPurchaseAt: new Date() }),
          lastActivityAt: new Date(),
        },
      },
      { new: true },
    );

  await recordExternalUserCreditTransaction({
    externalUser: updatedExternalUser || externalUser,
    amount: grantedCredits,
    direction: 'credit',
    source,
    metadata: {
      ...normalizeMetadata(metadata),
      countAsPurchase: source !== 'manual_grant',
    },
    balanceAfter: Number(updatedExternalUser?.generationCredits) || 0,
  });

  return {
    creditsGranted: grantedCredits,
    remainingCredits: Number(updatedExternalUser?.generationCredits) || 0,
    externalUser: formatExternalUser(updatedExternalUser),
  };
}

export async function creditExternalUserCredits({
  externalUser,
  credits,
  countAsRefund = true,
  source = 'external_credit',
  metadata = {},
} = {}) {
  await getDBConnectionString();

  if (!externalUser?._id) {
    const error = new Error('External user is required to credit credits.');
    error.status = 400;
    throw error;
  }

  const normalizedCredits = Math.max(0, Math.ceil(Number(credits) || 0));
  if (normalizedCredits <= 0) {
    return {
      creditsRefunded: 0,
      remainingCredits: Number(externalUser?.generationCredits) || 0,
      externalUser: formatExternalUser(externalUser),
    };
  }

  const billingMetadata = {
    ...normalizeMetadata(metadata),
    countAsRefund,
    externalIdentityKey: externalUser.externalIdentityKey,
    externalProvider: externalUser.provider,
    externalUserId: externalUser._id?.toString?.() || externalUser.id || null,
    externalUserExternalId: externalUser.externalUserId,
  };

  const internalCreditResult = isInternalBillingExternalUser(externalUser)
    ? await creditInternalAndCustomerSubAccountCredits({
        externalUser,
        credits: normalizedCredits,
        source,
        metadata: billingMetadata,
      })
    : null;

  const updatedExternalUser = isInternalBillingExternalUser(externalUser)
    ? await syncInternalExternalUserBalance(
      externalUser,
      internalCreditResult?.remainingCredits,
      {
        increment: countAsRefund ? { totalCreditsRefunded: normalizedCredits } : {},
      },
    )
    : await ExternalUser.findByIdAndUpdate(
      externalUser._id,
      {
        $inc: {
          generationCredits: normalizedCredits,
          ...(countAsRefund ? { totalCreditsRefunded: normalizedCredits } : {}),
        },
        $set: {
          lastActivityAt: new Date(),
        },
      },
      { new: true },
    );

  await recordExternalUserCreditTransaction({
    externalUser: updatedExternalUser || externalUser,
    amount: normalizedCredits,
    direction: 'credit',
    source,
    metadata: {
      ...normalizeMetadata(metadata),
      countAsRefund,
    },
    balanceAfter: Number(updatedExternalUser?.generationCredits) || 0,
  });

  return {
    creditsRefunded: normalizedCredits,
    remainingCredits:
      internalCreditResult?.remainingCredits ??
      (Number(updatedExternalUser?.generationCredits) || 0),
    externalUser: formatExternalUser(updatedExternalUser),
  };
}

export async function deductExternalUserCredits({
  externalUser,
  credits,
  countAsRequest = true,
  source = 'external_debit',
  metadata = {},
} = {}) {
  await getDBConnectionString();

  if (!externalUser?._id) {
    const error = new Error('External user is required to deduct credits.');
    error.status = 400;
    throw error;
  }

  const normalizedCredits = Math.max(0, Math.ceil(Number(credits) || 0));
  const now = new Date();
  const query = {
    _id: externalUser._id,
  };

  if (normalizedCredits > 0) {
    query.generationCredits = { $gte: normalizedCredits };
  }

  const billingMetadata = {
    ...normalizeMetadata(metadata),
    countAsRequest,
    externalIdentityKey: externalUser.externalIdentityKey,
    externalProvider: externalUser.provider,
    externalUserId: externalUser._id?.toString?.() || externalUser.id || null,
    externalUserExternalId: externalUser.externalUserId,
  };

  const internalDeductionResult = isInternalBillingExternalUser(externalUser)
    ? await debitInternalAndCustomerSubAccountCredits({
        externalUser,
        credits: normalizedCredits,
        source,
        metadata: billingMetadata,
      })
    : null;

  const updatedExternalUser = isInternalBillingExternalUser(externalUser)
    ? await syncInternalExternalUserBalance(
      externalUser,
      internalDeductionResult?.remainingCredits,
      {
        increment: {
          ...(normalizedCredits > 0 ? { totalCreditsUsed: normalizedCredits } : {}),
          ...(countAsRequest ? { totalRequests: 1 } : {}),
        },
        set: {
          ...(countAsRequest ? { lastRequestAt: now } : {}),
        },
      },
    )
    : await ExternalUser.findOneAndUpdate(
      query,
      {
        ...(normalizedCredits > 0 || countAsRequest
          ? {
              $inc: {
                ...(normalizedCredits > 0
                  ? {
                      generationCredits: -normalizedCredits,
                      totalCreditsUsed: normalizedCredits,
                    }
                  : {}),
                ...(countAsRequest ? { totalRequests: 1 } : {}),
              },
            }
          : {}),
        $set: {
          lastActivityAt: now,
          ...(countAsRequest ? { lastRequestAt: now } : {}),
        },
      },
      { new: true },
    );

  if (!updatedExternalUser) {
    const error = new Error('Insufficient credits');
    error.code = 'INSUFFICIENT_CREDITS';
    error.status = 402;
    throw error;
  }

  await recordExternalUserCreditTransaction({
    externalUser: updatedExternalUser,
    amount: normalizedCredits,
    direction: 'debit',
    source,
    metadata: {
      ...normalizeMetadata(metadata),
      countAsRequest,
    },
    balanceAfter: Number(updatedExternalUser?.generationCredits) || 0,
  });

  return {
    creditsCharged: normalizedCredits,
    remainingCredits:
      internalDeductionResult?.remainingCredits ??
      (Number(updatedExternalUser?.generationCredits) || 0),
    externalUser: formatExternalUser(updatedExternalUser),
  };
}

export async function createExternalPaymentRecord({
  externalUser,
  creditsRequested,
  amountCents,
  amountUsd,
  currency = 'USD',
  checkoutSessionId = null,
  paymentIntentId = null,
  setupIntentId = null,
  responsePayload = {},
  metadata = {},
}) {
  await getDBConnectionString();
  const sanitizedResponsePayload = sanitizeExternalFacingPayload(responsePayload);

  const externalPaymentId = `extpay_${randomUUID().replace(/-/g, '')}`;
  return ExternalUserPayment.create({
    externalPaymentId,
    internalUserId: externalUser.internalUserId,
    externalUserId: externalUser._id,
    externalIdentityKey: externalUser.externalIdentityKey,
    customerSubAccountId: externalUser.customerSubAccountId ?? null,
    customerSubAccountPublicId: externalUser.customerSubAccountPublicId ?? null,
    customerSubAccountExternalId: externalUser.customerSubAccountExternalId ?? null,
    checkoutSessionId,
    paymentIntentId,
    setupIntentId,
    status: 'pending',
    creditsRequested,
    creditsApplied: 0,
    amountCents,
    amountUsd,
    currency,
    responsePayload: sanitizedResponsePayload,
    metadata: normalizeMetadata(metadata),
  });
}

export async function findExternalPaymentForInternalUser({
  internalUserId,
  externalPaymentId,
  checkoutSessionId,
  paymentIntentId,
  setupIntentId,
  externalUserId = null,
}) {
  await getDBConnectionString();

  const lookup = [];
  const normalizedExternalPaymentId = normalizeString(externalPaymentId);
  const normalizedCheckoutSessionId = normalizeString(checkoutSessionId);
  const normalizedPaymentIntentId = normalizeString(paymentIntentId);
  const normalizedSetupIntentId = normalizeString(setupIntentId);

  if (normalizedExternalPaymentId) {
    lookup.push({ externalPaymentId: normalizedExternalPaymentId });
  }
  if (normalizedCheckoutSessionId) {
    lookup.push({ checkoutSessionId: normalizedCheckoutSessionId });
  }
  if (normalizedPaymentIntentId) {
    lookup.push({ paymentIntentId: normalizedPaymentIntentId });
  }
  if (normalizedSetupIntentId) {
    lookup.push({ setupIntentId: normalizedSetupIntentId });
  }

  if (!lookup.length) {
    return null;
  }

  return ExternalUserPayment.findOne({
    internalUserId,
    ...(externalUserId ? { externalUserId } : {}),
    $or: lookup,
  }).populate('externalUserId');
}

export async function markExternalPaymentResolved({
  internalUserId = null,
  externalPaymentId = null,
  checkoutSessionId = null,
  paymentIntentId = null,
  setupIntentId = null,
  status,
  creditsApplied = 0,
  responsePayload = {},
}) {
  await getDBConnectionString();
  const sanitizedResponsePayload = sanitizeExternalFacingPayload(responsePayload);

  const lookup = [];
  if (normalizeString(externalPaymentId)) {
    lookup.push({ externalPaymentId: normalizeString(externalPaymentId) });
  }
  if (normalizeString(checkoutSessionId)) {
    lookup.push({ checkoutSessionId: normalizeString(checkoutSessionId) });
  }
  if (normalizeString(paymentIntentId)) {
    lookup.push({ paymentIntentId: normalizeString(paymentIntentId) });
  }
  if (normalizeString(setupIntentId)) {
    lookup.push({ setupIntentId: normalizeString(setupIntentId) });
  }

  if (!lookup.length) {
    return null;
  }

  const query = internalUserId
    ? { internalUserId, $or: lookup }
    : { $or: lookup };
  const existing = await ExternalUserPayment.findOne(query);
  if (!existing) {
    return null;
  }

  const normalizedCreditsApplied = Number.isFinite(Number(creditsApplied))
    ? Math.max(0, Number(creditsApplied))
    : 0;
  const previousCreditsApplied = Number(existing.creditsApplied) || 0;
  const creditDelta =
    status === 'succeeded'
      ? Math.max(0, normalizedCreditsApplied - previousCreditsApplied)
      : 0;

  const updated = await ExternalUserPayment.findByIdAndUpdate(
    existing._id,
    {
      $set: {
        status: normalizeString(status) || existing.status,
        checkoutSessionId: normalizeString(checkoutSessionId) || existing.checkoutSessionId,
        paymentIntentId: normalizeString(paymentIntentId) || existing.paymentIntentId,
        setupIntentId: normalizeString(setupIntentId) || existing.setupIntentId,
        creditsApplied:
          status === 'succeeded'
            ? Math.max(previousCreditsApplied, normalizedCreditsApplied)
            : previousCreditsApplied,
        responsePayload: sanitizedResponsePayload && typeof sanitizedResponsePayload === 'object'
          ? sanitizedResponsePayload
          : existing.responsePayload,
      },
    },
    { new: true },
  );

  if (creditDelta > 0) {
    const scopedExternalUser = await ExternalUser.findById(existing.externalUserId);

    if (isInternalBillingExternalUser(scopedExternalUser) && scopedExternalUser?.internalUserId) {
      const internalUser = await User.findById(scopedExternalUser.internalUserId)
        .select('generationCredits')
        .lean();
      await syncInternalExternalUserBalance(
        scopedExternalUser,
        internalUser?.generationCredits,
        {
          increment: {
            totalCreditsPurchased: creditDelta,
          },
          set: {
            lastPurchaseAt: new Date(),
          },
        },
      );
    } else {
      await ExternalUser.updateOne(
        { _id: existing.externalUserId },
        {
          $inc: {
            totalCreditsPurchased: creditDelta,
            generationCredits: creditDelta,
          },
          $set: {
            lastPurchaseAt: new Date(),
            lastActivityAt: new Date(),
          },
        },
      );
    }
  }

  return updated;
}
