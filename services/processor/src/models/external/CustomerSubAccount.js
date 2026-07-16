import { randomUUID } from 'crypto';

import CustomerSubAccount from '../../schema/CustomerSubAccount.js';
import User from '../../schema/User.js';
import { generateAPIKeySecret } from '../../utils/ApiKeyUtils.js';
import { getDBConnectionString } from '../DBString.js';

const DEFAULT_ROTATION_DAYS = 30;
const CUSTOMER_SUB_ACCOUNT_API_KEY_PREFIX = 'scsa_';
const CUSTOMER_SUB_ACCOUNT_API_KEY_HEADER_NAMES = [
  'x-customer-sub-account-api-key',
  'x-customer-subaccount-api-key',
  'x-samsar-customer-sub-account-api-key',
  'x-samsar-sub-account-api-key',
  'customer-sub-account-api-key',
  'customer_sub_account_api_key',
];

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((result, [key, entryValue]) => {
    if (entryValue === undefined) {
      return result;
    }
    result[key] = entryValue;
    return result;
  }, {});
}

function getRawRequestedGenerationCredits(payloadSource = {}) {
  const source =
    payloadSource?.customer_sub_account ??
    payloadSource?.customerSubAccount ??
    payloadSource?.sub_account ??
    payloadSource?.subAccount ??
    payloadSource ??
    {};

  return (
    source.requested_generation_credits ??
    source.requestedGenerationCredits ??
    source.generation_credits ??
    source.generationCredits ??
    payloadSource.requested_generation_credits ??
    payloadSource.requestedGenerationCredits ??
    payloadSource.generation_credits ??
    payloadSource.generationCredits
  );
}

export function normalizeCustomerSubAccountRequestedGenerationCredits(payloadSource = {}) {
  const rawCredits = getRawRequestedGenerationCredits(payloadSource);
  const normalizedRawCredits =
    typeof rawCredits === 'string' ? rawCredits.trim() : rawCredits;

  if (
    normalizedRawCredits === undefined ||
    normalizedRawCredits === null ||
    normalizedRawCredits === ''
  ) {
    return null;
  }

  const parsed = Number(normalizedRawCredits);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    const error = new Error('requested generation credits must be a non-negative integer.');
    error.status = 400;
    throw error;
  }

  return parsed;
}

function hasFiniteCreditBalance(customerSubAccount) {
  if (
    customerSubAccount?.generationCredits === undefined ||
    customerSubAccount?.generationCredits === null
  ) {
    return false;
  }

  return Number.isFinite(Number(customerSubAccount.generationCredits));
}

function normalizeRotationDays(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_ROTATION_DAYS;
  }

  return Math.max(1, Math.floor(parsed));
}

function rotationExpiresAt(createdAt, rotationDays = DEFAULT_ROTATION_DAYS) {
  const startedAt = createdAt instanceof Date ? createdAt : new Date(createdAt || Date.now());
  return new Date(startedAt.getTime() + normalizeRotationDays(rotationDays) * 24 * 60 * 60 * 1000);
}

function isApiKeyExpired(customerSubAccount, now = new Date()) {
  if (!customerSubAccount?.internalApiKey) {
    return true;
  }

  const expiresAt = customerSubAccount.internalApiKeyExpiresAt
    ? new Date(customerSubAccount.internalApiKeyExpiresAt)
    : rotationExpiresAt(
      customerSubAccount.internalApiKeyCreatedAt,
      customerSubAccount.internalApiKeyRotationDays,
    );

  return expiresAt.getTime() <= now.getTime();
}

function buildCustomerSubAccountId() {
  return `csa_${randomUUID().replace(/-/g, '')}`;
}

function buildCustomerSubAccountInternalApiKey() {
  return `${CUSTOMER_SUB_ACCOUNT_API_KEY_PREFIX}${generateAPIKeySecret()}`;
}

function getHeaderValue(headers = {}, headerName) {
  const directValue = headers?.[headerName];
  if (typeof directValue === 'string' && directValue.trim()) {
    return directValue.trim();
  }

  const foundHeaderName = Object.keys(headers || {}).find(
    (key) => key.toLowerCase() === headerName.toLowerCase(),
  );
  const foundValue = foundHeaderName ? headers[foundHeaderName] : null;
  return typeof foundValue === 'string' && foundValue.trim() ? foundValue.trim() : null;
}

export function getCustomerSubAccountInternalApiKeyFromHeaders(headers = {}) {
  for (const headerName of CUSTOMER_SUB_ACCOUNT_API_KEY_HEADER_NAMES) {
    const headerValue = getHeaderValue(headers, headerName);
    if (headerValue) {
      return headerValue;
    }
  }

  const authorizationHeader = getHeaderValue(headers, 'authorization');
  const bearerToken = authorizationHeader?.split(' ')[1];
  if (bearerToken?.startsWith(CUSTOMER_SUB_ACCOUNT_API_KEY_PREFIX)) {
    return bearerToken;
  }

  return null;
}

export function normalizeCustomerSubAccountPayload(payloadSource = {}) {
  const source =
    payloadSource?.customer_sub_account ??
    payloadSource?.customerSubAccount ??
    payloadSource?.sub_account ??
    payloadSource?.subAccount ??
    payloadSource ??
    {};

  const metadata = normalizeMetadata(
    source.metadata ??
    payloadSource.metadata,
  );

  return {
    externalCustomerId:
      normalizeString(source.external_customer_id) ||
      normalizeString(source.externalCustomerId) ||
      normalizeString(source.customer_id) ||
      normalizeString(source.customerId) ||
      normalizeString(source.sub_account_id) ||
      normalizeString(source.subAccountId),
    externalAppId:
      normalizeString(source.external_app_id) ||
      normalizeString(source.externalAppId) ||
      normalizeString(source.app_id) ||
      normalizeString(source.appId) ||
      normalizeString(source.sourceProject) ||
      normalizeString(metadata.sourceProject) ||
      'default',
    name:
      normalizeString(source.name) ||
      normalizeString(source.customer_name) ||
      normalizeString(source.customerName),
    email:
      normalizeString(source.email) ||
      normalizeString(source.customer_email) ||
      normalizeString(source.customerEmail),
    metadata,
  };
}

export function formatCustomerSubAccount(
  customerSubAccount,
  { includeInternalApiKey = false } = {},
) {
  if (!customerSubAccount) {
    return null;
  }

  const expiresAt = customerSubAccount.internalApiKeyExpiresAt ??
    (customerSubAccount.internalApiKeyCreatedAt
      ? rotationExpiresAt(
        customerSubAccount.internalApiKeyCreatedAt,
        customerSubAccount.internalApiKeyRotationDays,
      )
      : null);

  return {
    id: customerSubAccount._id?.toString?.() || customerSubAccount.id || null,
    customer_sub_account_id: customerSubAccount.customerSubAccountId,
    external_customer_id: customerSubAccount.externalCustomerId,
    external_app_id: customerSubAccount.externalAppId,
    name: customerSubAccount.name ?? null,
    email: customerSubAccount.email ?? null,
    status: customerSubAccount.status ?? 'active',
    metadata: customerSubAccount.metadata ?? {},
    has_internal_api_key: Boolean(customerSubAccount.internalApiKey),
    internal_api_key_created_at: customerSubAccount.internalApiKeyCreatedAt ?? null,
    internal_api_key_expires_at: expiresAt,
    internal_api_key_last_used_at: customerSubAccount.internalApiKeyLastUsedAt ?? null,
    internal_api_key_rotation_days:
      customerSubAccount.internalApiKeyRotationDays ?? DEFAULT_ROTATION_DAYS,
    last_pulled_at: customerSubAccount.lastPulledAt ?? null,
    last_activity_at: customerSubAccount.lastActivityAt ?? null,
    generation_credits: hasFiniteCreditBalance(customerSubAccount)
      ? Number(customerSubAccount.generationCredits)
      : null,
    total_credits_allocated: Number(customerSubAccount.totalCreditsAllocated) || 0,
    total_credits_used: Number(customerSubAccount.totalCreditsUsed) || 0,
    total_credits_refunded: Number(customerSubAccount.totalCreditsRefunded) || 0,
    is_credit_limit_enforced: hasFiniteCreditBalance(customerSubAccount),
    created_at: customerSubAccount.createdAt ?? null,
    updated_at: customerSubAccount.updatedAt ?? null,
    ...(includeInternalApiKey ? { internal_api_key: customerSubAccount.internalApiKey ?? null } : {}),
  };
}

export async function upsertCustomerSubAccount({
  internalUserId,
  payload,
}) {
  await getDBConnectionString();

  const normalizedInternalUserId = normalizeString(internalUserId);
  if (!normalizedInternalUserId) {
    const error = new Error('Internal user ID is required.');
    error.status = 400;
    throw error;
  }

  const normalized = normalizeCustomerSubAccountPayload(payload);
  if (!normalized.externalCustomerId) {
    const error = new Error('customer_sub_account.external_customer_id is required.');
    error.status = 400;
    throw error;
  }

  const now = new Date();
  const requestedGenerationCredits = normalizeCustomerSubAccountRequestedGenerationCredits(payload);
  return CustomerSubAccount.findOneAndUpdate(
    {
      internalUserId: normalizedInternalUserId,
      externalAppId: normalized.externalAppId,
      externalCustomerId: normalized.externalCustomerId,
    },
    {
      $set: {
        name: normalized.name,
        email: normalized.email,
        metadata: normalized.metadata,
        status: 'active',
        lastPulledAt: now,
        lastActivityAt: now,
      },
      $setOnInsert: {
        customerSubAccountId: buildCustomerSubAccountId(),
        internalUserId: normalizedInternalUserId,
        externalAppId: normalized.externalAppId,
        externalCustomerId: normalized.externalCustomerId,
        ...(requestedGenerationCredits !== null
          ? {
              generationCredits: requestedGenerationCredits,
              totalCreditsAllocated: requestedGenerationCredits,
              lastCreditAllocationAt: requestedGenerationCredits > 0 ? now : null,
            }
          : {}),
        internalApiKeyRotationDays: DEFAULT_ROTATION_DAYS,
      },
    },
    {
      new: true,
      upsert: true,
    },
  );
}

export async function ensureCustomerSubAccountInternalApiKey(
  customerSubAccount,
  { forceRotate = false } = {},
) {
  await getDBConnectionString();

  if (!customerSubAccount?._id) {
    return null;
  }

  if (!forceRotate && !isApiKeyExpired(customerSubAccount)) {
    return customerSubAccount;
  }

  let attemptsRemaining = 5;
  let nextApiKey = buildCustomerSubAccountInternalApiKey();

  while (attemptsRemaining > 0) {
    const now = new Date();
    const rotationDays = normalizeRotationDays(customerSubAccount.internalApiKeyRotationDays);
    try {
      return await CustomerSubAccount.findByIdAndUpdate(
        customerSubAccount._id,
        {
          $set: {
            internalApiKey: nextApiKey,
            internalApiKeyCreatedAt: now,
            internalApiKeyExpiresAt: rotationExpiresAt(now, rotationDays),
            internalApiKeyRotationDays: rotationDays,
            lastPulledAt: now,
            lastActivityAt: now,
          },
        },
        { new: true },
      );
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }

      attemptsRemaining -= 1;
      nextApiKey = buildCustomerSubAccountInternalApiKey();
    }
  }

  const keyError = new Error('Unable to generate customer sub-account internal API key.');
  keyError.status = 500;
  throw keyError;
}

export async function resolveCustomerSubAccountFromAuthHeaders(headers = {}) {
  await getDBConnectionString();

  const internalApiKey = getCustomerSubAccountInternalApiKeyFromHeaders(headers);
  if (!internalApiKey) {
    return null;
  }

  const customerSubAccount = await CustomerSubAccount.findOne({
    internalApiKey,
    status: 'active',
  });

  if (!customerSubAccount) {
    const error = new Error('Invalid customer sub-account internal API key.');
    error.status = 401;
    throw error;
  }

  if (isApiKeyExpired(customerSubAccount)) {
    const error = new Error('Customer sub-account internal API key has expired. Pull the rotated key with the parent customer API key.');
    error.code = 'CUSTOMER_SUB_ACCOUNT_API_KEY_EXPIRED';
    error.status = 401;
    throw error;
  }

  const now = new Date();
  await CustomerSubAccount.updateOne(
    { _id: customerSubAccount._id },
    {
      $set: {
        internalApiKeyLastUsedAt: now,
        lastActivityAt: now,
      },
    },
  );

  customerSubAccount.internalApiKeyLastUsedAt = now;
  customerSubAccount.lastActivityAt = now;
  return customerSubAccount;
}

function getCustomerSubAccountObjectId(customerSubAccountOrId) {
  return (
    customerSubAccountOrId?._id ??
    customerSubAccountOrId?.id ??
    customerSubAccountOrId ??
    null
  );
}

export async function deductCustomerSubAccountCredits(
  customerSubAccountOrId,
  amount,
  { source = null, metadata = {} } = {},
) {
  await getDBConnectionString();

  const normalizedAmount = Number(amount);
  const customerSubAccountId = getCustomerSubAccountObjectId(customerSubAccountOrId);
  if (!customerSubAccountId || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return {
      enforced: false,
      remainingCredits: null,
      customerSubAccount: null,
    };
  }

  const currentCustomerSubAccount =
    customerSubAccountOrId?._id
      ? customerSubAccountOrId
      : await CustomerSubAccount.findById(customerSubAccountId);

  if (!hasFiniteCreditBalance(currentCustomerSubAccount)) {
    return {
      enforced: false,
      remainingCredits: null,
      customerSubAccount: currentCustomerSubAccount,
    };
  }

  const updatedCustomerSubAccount = await CustomerSubAccount.findOneAndUpdate(
    {
      _id: customerSubAccountId,
      generationCredits: { $gte: normalizedAmount },
    },
    {
      $inc: {
        generationCredits: -normalizedAmount,
        totalCreditsUsed: normalizedAmount,
      },
      $set: {
        lastActivityAt: new Date(),
      },
    },
    { new: true },
  );

  if (!updatedCustomerSubAccount) {
    const error = new Error('Insufficient customer sub-account credits');
    error.code = 'INSUFFICIENT_CREDITS';
    error.status = 402;
    error.metadata = metadata;
    error.source = source;
    throw error;
  }

  return {
    enforced: true,
    remainingCredits: Number(updatedCustomerSubAccount.generationCredits) || 0,
    customerSubAccount: updatedCustomerSubAccount,
  };
}

export async function creditCustomerSubAccountCredits(
  customerSubAccountOrId,
  amount,
  { countAsRefund = true, reverseUsage = false } = {},
) {
  await getDBConnectionString();

  const normalizedAmount = Number(amount);
  const customerSubAccountId = getCustomerSubAccountObjectId(customerSubAccountOrId);
  if (!customerSubAccountId || !Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    return {
      enforced: false,
      remainingCredits: null,
      customerSubAccount: null,
    };
  }

  const currentCustomerSubAccount =
    customerSubAccountOrId?._id
      ? customerSubAccountOrId
      : await CustomerSubAccount.findById(customerSubAccountId);

  if (!hasFiniteCreditBalance(currentCustomerSubAccount)) {
    return {
      enforced: false,
      remainingCredits: null,
      customerSubAccount: currentCustomerSubAccount,
    };
  }

  const updatedCustomerSubAccount = await CustomerSubAccount.findByIdAndUpdate(
    customerSubAccountId,
    {
      $inc: {
        generationCredits: normalizedAmount,
        ...(countAsRefund ? { totalCreditsRefunded: normalizedAmount } : {}),
        ...(reverseUsage ? { totalCreditsUsed: -normalizedAmount } : {}),
      },
      $set: {
        lastActivityAt: new Date(),
      },
    },
    { new: true },
  );

  return {
    enforced: true,
    remainingCredits: Number(updatedCustomerSubAccount?.generationCredits) || 0,
    customerSubAccount: updatedCustomerSubAccount,
  };
}

export async function getCustomerSubAccountCreditSnapshot(customerSubAccount) {
  await getDBConnectionString();

  const resolvedCustomerSubAccount =
    (customerSubAccount?._id || customerSubAccount?.internalUserId)
      ? customerSubAccount
      : await CustomerSubAccount.findById(customerSubAccount);

  if (!resolvedCustomerSubAccount?.internalUserId) {
    return {
      remainingCredits: 0,
      accountRemainingCredits: 0,
      subAccountRemainingCredits: hasFiniteCreditBalance(resolvedCustomerSubAccount)
        ? Number(resolvedCustomerSubAccount.generationCredits) || 0
        : null,
      isCreditLimitEnforced: hasFiniteCreditBalance(resolvedCustomerSubAccount),
    };
  }

  const user = await User.findById(resolvedCustomerSubAccount.internalUserId)
    .select('generationCredits')
    .lean();
  const accountRemainingCredits = Number(user?.generationCredits) || 0;
  const isCreditLimitEnforced = hasFiniteCreditBalance(resolvedCustomerSubAccount);
  const subAccountRemainingCredits = isCreditLimitEnforced
    ? Number(resolvedCustomerSubAccount.generationCredits) || 0
    : null;

  return {
    remainingCredits: isCreditLimitEnforced
      ? Math.min(accountRemainingCredits, subAccountRemainingCredits)
      : accountRemainingCredits,
    accountRemainingCredits,
    subAccountRemainingCredits,
    isCreditLimitEnforced,
  };
}
