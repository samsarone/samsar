import { getDBConnectionString } from './DBString.js';
import GenerationCreditTransaction from '../schema/GenerationCreditTransaction.js';
import User from '../schema/User.js';
import { maybeTriggerAutoRecharge } from './AutoRecharge.js';
import { getCurrentAPIKeyUsageContext, normalizeAPIKeyUsageContext } from './api/RequestAuthContext.js';
import { API_KEY_USAGE_LIMIT_PERIODS } from './User.js';
import mongoose from 'mongoose';

function toMongoObjectId(value) {
  const normalized = value?.toString?.();
  return normalized && mongoose.Types.ObjectId.isValid(normalized)
    ? new mongoose.Types.ObjectId(normalized)
    : value;
}

function resolveAPIKeyUsageContext(options = {}) {
  const source = options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {};

  return (
    normalizeAPIKeyUsageContext(source) ||
    normalizeAPIKeyUsageContext(source.metadata?.apiKeyUsage) ||
    normalizeAPIKeyUsageContext(getCurrentAPIKeyUsageContext())
  );
}

function getCurrentMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function buildAPIKeyUsageLimitError({ usageLimit, usageLimitPeriod, currentUsage, attemptedCredits }) {
  const periodLabel = usageLimitPeriod === API_KEY_USAGE_LIMIT_PERIODS.MONTHLY ? 'monthly' : 'total';
  const error = new Error(
    `API key ${periodLabel} credit limit reached. Limit: ${usageLimit}; used: ${currentUsage}; requested: ${attemptedCredits}.`
  );
  error.code = 'API_KEY_USAGE_LIMIT_EXCEEDED';
  error.status = 402;
  error.usageLimit = usageLimit;
  error.usageLimitPeriod = usageLimitPeriod;
  error.currentUsage = currentUsage;
  error.attemptedCredits = attemptedCredits;
  return error;
}

async function getAPIKeyLimitConfig({ userId, apiKeyId }) {
  if (!userId || !apiKeyId) {
    return null;
  }

  const userData = await User.findOne(
    {
      _id: userId,
      'userApiKeys._id': apiKeyId,
    },
    { 'userApiKeys.$': 1 },
  ).lean();

  const apiKey = userData?.userApiKeys?.[0];
  const usageLimit = Number(apiKey?.usageLimit);
  const usageLimitPeriod =
    typeof apiKey?.usageLimitPeriod === 'string'
      ? apiKey.usageLimitPeriod.trim().toLowerCase()
      : null;

  if (
    !Number.isFinite(usageLimit) ||
    usageLimit <= 0 ||
    !Object.values(API_KEY_USAGE_LIMIT_PERIODS).includes(usageLimitPeriod)
  ) {
    return null;
  }

  return {
    apiKeyId: apiKey._id?.toString?.() || apiKeyId,
    usageLimit,
    usageLimitPeriod,
  };
}

async function getAPIKeyNetUsage({ userId, apiKeyId, usageLimitPeriod }) {
  const match = {
    userId: toMongoObjectId(userId),
    apiKeyId: toMongoObjectId(apiKeyId),
    direction: 'debit',
  };

  if (usageLimitPeriod === API_KEY_USAGE_LIMIT_PERIODS.MONTHLY) {
    match.createdAt = { $gte: getCurrentMonthStart() };
  }

  const result = await GenerationCreditTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        total: {
          $sum: '$amount',
        },
      },
    },
  ]);

  return Math.max(0, Number(result?.[0]?.total) || 0);
}

async function assertAPIKeyUsageLimitAllowsDebit({ userId, amount, apiKeyUsageContext }) {
  if (!apiKeyUsageContext?.apiKeyId) {
    return null;
  }

  const limitConfig = await getAPIKeyLimitConfig({
    userId,
    apiKeyId: apiKeyUsageContext.apiKeyId,
  });
  if (!limitConfig) {
    return {
      apiKeyId: apiKeyUsageContext.apiKeyId,
    };
  }

  const currentUsage = await getAPIKeyNetUsage({
    userId,
    apiKeyId: limitConfig.apiKeyId,
    usageLimitPeriod: limitConfig.usageLimitPeriod,
  });
  const nextUsage = currentUsage + amount;

  if (nextUsage > limitConfig.usageLimit) {
    throw buildAPIKeyUsageLimitError({
      usageLimit: limitConfig.usageLimit,
      usageLimitPeriod: limitConfig.usageLimitPeriod,
      currentUsage,
      attemptedCredits: amount,
    });
  }

  return {
    ...limitConfig,
    currentUsage,
    nextUsage,
  };
}

export async function assertAPIKeyUsageLimitForDebit(userId, amount, { metadata, apiKeyId } = {}) {
  const creditCost = Number(amount);
  if (!userId || !Number.isFinite(creditCost) || creditCost <= 0) {
    return null;
  }

  await getDBConnectionString();
  const apiKeyUsageContext = resolveAPIKeyUsageContext({ metadata, apiKeyId });
  return assertAPIKeyUsageLimitAllowsDebit({
    userId,
    amount: creditCost,
    apiKeyUsageContext,
  });
}

async function recordGenerationCreditTransaction({
  userId,
  apiKeyId,
  amount,
  direction,
  source,
  metadata,
  balanceAfter,
}) {
  if (!userId || typeof amount !== 'number' || !direction) {
    return null;
  }

  await getDBConnectionString();
  const transaction = new GenerationCreditTransaction({
    userId,
    apiKeyId: apiKeyId || null,
    amount,
    direction,
    source,
    metadata,
    balanceAfter,
  });

  await transaction.save();
  return transaction;
}

export async function deductGenerationCredits(userId, amount, { source, metadata, apiKeyId } = {}) {
  const creditCost = Number(amount);

  if (!userId) {
    throw new Error('User ID is required to deduct credits');
  }

  if (!Number.isFinite(creditCost) || creditCost <= 0) {
    return { remainingCredits: null };
  }

  await getDBConnectionString();
  const apiKeyUsageContext = resolveAPIKeyUsageContext({ metadata, apiKeyId });
  const apiKeyLimitCheck = await assertAPIKeyUsageLimitForDebit(userId, creditCost, { metadata, apiKeyId });
  const updatedUser = await User.findOneAndUpdate(
    { _id: userId, generationCredits: { $gte: creditCost } },
    { $inc: { generationCredits: -creditCost } },
    { new: true, projection: { generationCredits: 1 } }
  );

  if (!updatedUser) {
    const err = new Error('Insufficient credits');
    err.code = 'INSUFFICIENT_CREDITS';
    throw err;
  }

  await recordGenerationCreditTransaction({
    userId,
    apiKeyId: apiKeyLimitCheck?.apiKeyId || apiKeyUsageContext?.apiKeyId || null,
    amount: creditCost,
    direction: 'debit',
    source,
    metadata: {
      ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
      ...(apiKeyLimitCheck?.usageLimit
        ? {
          apiKeyUsageLimit: apiKeyLimitCheck.usageLimit,
          apiKeyUsageLimitPeriod: apiKeyLimitCheck.usageLimitPeriod,
          apiKeyUsageBefore: apiKeyLimitCheck.currentUsage,
          apiKeyUsageAfter: apiKeyLimitCheck.nextUsage,
        }
        : {}),
    },
    balanceAfter: updatedUser.generationCredits,
  });

  // Fire-and-forget auto-recharge attempt so low balances can top up.
  try {
    await maybeTriggerAutoRecharge(userId);
  } catch {
  }

  return {
    remainingCredits: updatedUser.generationCredits,
  };
}

export async function creditGenerationCredits(userId, amount, { source, metadata, apiKeyId } = {}) {
  const creditAmount = Number(amount);

  if (!userId) {
    throw new Error('User ID is required to credit credits');
  }

  if (!Number.isFinite(creditAmount) || creditAmount <= 0) {
    return { remainingCredits: null };
  }

  await getDBConnectionString();
  const apiKeyUsageContext = resolveAPIKeyUsageContext({ metadata, apiKeyId });
  const updatedUser = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { generationCredits: creditAmount } },
    { new: true, projection: { generationCredits: 1 } }
  );

  await recordGenerationCreditTransaction({
    userId,
    apiKeyId: apiKeyUsageContext?.apiKeyId || null,
    amount: creditAmount,
    direction: 'credit',
    source,
    metadata,
    balanceAfter: updatedUser?.generationCredits,
  });

  return {
    remainingCredits: updatedUser?.generationCredits ?? null,
  };
}

export async function recordCreditTransaction(params) {
  return recordGenerationCreditTransaction(params);
}
