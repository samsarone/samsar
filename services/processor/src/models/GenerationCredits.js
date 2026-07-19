import { createHash } from 'node:crypto';
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
  idempotencyKey,
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
    idempotencyKey: idempotencyKey || null,
    metadata,
    balanceAfter,
  });

  await transaction.save();
  return transaction;
}

function normalizeDebitIdempotencyKey(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, 500)
    : '';
}

function getDebitReservationPath(idempotencyKey) {
  const reservationId = createHash('sha256').update(idempotencyKey).digest('hex');
  return {
    reservationId,
    reservationPath: `generationCreditDebitReservations.${reservationId}`,
  };
}

function buildInsufficientCreditsError() {
  const error = new Error('Insufficient credits');
  error.code = 'INSUFFICIENT_CREDITS';
  error.status = 402;
  error.statusCode = 402;
  return error;
}

async function findIdempotentDebit(idempotencyKey, userId) {
  if (!idempotencyKey) return null;
  return GenerationCreditTransaction.findOne({
    idempotencyKey,
    direction: 'debit',
    ...(userId ? { userId } : {}),
  }).sort({ createdAt: -1 });
}

async function completeDebitReservation(
  userId,
  reservationPath,
  { idempotencyKey, amount, transactionId, balanceAfter } = {},
) {
  // Keep the completed marker permanently. Removing it after writing the ledger
  // reopens a race where a worker that read the old state can debit the balance
  // after another worker has already completed the same idempotent charge.
  await User.updateOne(
    { _id: userId },
    {
      $set: {
        [reservationPath]: {
          idempotencyKey,
          amount: Number(amount) || 0,
          status: 'COMPLETED',
          transactionId: transactionId || null,
          balanceAfter: Number.isFinite(Number(balanceAfter)) ? Number(balanceAfter) : null,
          completedAt: new Date(),
        },
      },
    },
  );
}

export async function completeGenerationCreditDebitReservation(
  userId,
  idempotencyKey,
  { amount, transactionId, balanceAfter } = {},
) {
  const normalizedIdempotencyKey = normalizeDebitIdempotencyKey(idempotencyKey);
  if (!userId || !normalizedIdempotencyKey) return;
  const { reservationPath } = getDebitReservationPath(normalizedIdempotencyKey);
  await getDBConnectionString();
  await completeDebitReservation(userId, reservationPath, {
    idempotencyKey: normalizedIdempotencyKey,
    amount,
    transactionId,
    balanceAfter,
  });
}

async function findDebitReservation(userId, reservationId, reservationPath) {
  const reservedUser = await User.findOne(
    { _id: userId, [reservationPath]: { $exists: true } },
    { generationCredits: 1, [reservationPath]: 1 },
  ).lean();
  return {
    reservedUser,
    reservation: reservedUser?.generationCreditDebitReservations?.[reservationId] || null,
  };
}

function assertDebitReservationAmount(reservation, creditCost) {
  if (Math.abs((Number(reservation?.amount) || 0) - creditCost) <= 0.0001) return;
  const error = new Error('The idempotent debit amount does not match its reservation.');
  error.code = 'GENERATION_CREDIT_IDEMPOTENCY_CONFLICT';
  error.status = 409;
  error.statusCode = 409;
  throw error;
}

/**
 * Atomically records the debit on the User document together with a durable
 * idempotency marker, then writes the audit ledger. If the process dies between
 * those writes, the next attempt sees the marker and creates the missing ledger
 * without decrementing the balance a second time. This works on standalone
 * Mongo deployments where multi-document transactions are unavailable.
 */
export async function deductGenerationCreditsIdempotently(
  userId,
  amount,
  {
    source,
    metadata,
    apiKeyId,
    idempotencyKey,
    settleIncurredUsage = false,
  } = {},
) {
  const creditCost = Number(amount);
  const normalizedIdempotencyKey = normalizeDebitIdempotencyKey(idempotencyKey);
  if (!normalizedIdempotencyKey) {
    return deductGenerationCredits(userId, amount, { source, metadata, apiKeyId });
  }
  if (!userId) {
    throw new Error('User ID is required to deduct credits');
  }
  if (!Number.isFinite(creditCost) || creditCost <= 0) {
    return { remainingCredits: null, transactionId: null, reused: false };
  }

  await getDBConnectionString();
  const { reservationId, reservationPath } = getDebitReservationPath(
    normalizedIdempotencyKey,
  );
  const existingTransaction = await findIdempotentDebit(normalizedIdempotencyKey, userId);
  if (existingTransaction) {
    await completeDebitReservation(userId, reservationPath, {
      idempotencyKey: normalizedIdempotencyKey,
      amount: existingTransaction.amount,
      transactionId: existingTransaction._id,
      balanceAfter: existingTransaction.balanceAfter,
    });
    return {
      remainingCredits: existingTransaction.balanceAfter ?? null,
      transactionId: existingTransaction._id,
      reused: true,
    };
  }

  const apiKeyUsageContext = resolveAPIKeyUsageContext({ metadata, apiKeyId });
  let apiKeyLimitCheck = null;
  let { reservedUser, reservation } = await findDebitReservation(
    userId,
    reservationId,
    reservationPath,
  );
  let updatedUser = reservedUser;

  if (reservation) {
    // A prior attempt already decremented the balance. Reconcile its ledger
    // without rerunning admission checks that may have changed since the debit.
    assertDebitReservationAmount(reservation, creditCost);
  } else {
    // A provider call cannot be un-incurred after its exact token cost is
    // known. Serialized narrative requests use this path to settle that usage
    // in full; fresh work still performs its balance and API-key admission
    // checks before dispatching any inference.
    if (!settleIncurredUsage) {
      apiKeyLimitCheck = await assertAPIKeyUsageLimitForDebit(
        userId,
        creditCost,
        { metadata, apiKeyId },
      );
    }
    const reservationData = {
      idempotencyKey: normalizedIdempotencyKey,
      amount: creditCost,
      status: 'PENDING',
      settleIncurredUsage: Boolean(settleIncurredUsage),
      createdAt: new Date(),
      apiKeyId: apiKeyLimitCheck?.apiKeyId || apiKeyUsageContext?.apiKeyId || null,
      apiKeyUsageLimit: apiKeyLimitCheck?.usageLimit ?? null,
      apiKeyUsageLimitPeriod: apiKeyLimitCheck?.usageLimitPeriod ?? null,
      apiKeyUsageBefore: apiKeyLimitCheck?.currentUsage ?? null,
      apiKeyUsageAfter: apiKeyLimitCheck?.nextUsage ?? null,
    };
    updatedUser = await User.findOneAndUpdate(
      {
        _id: userId,
        ...(!settleIncurredUsage
          ? { generationCredits: { $gte: creditCost } }
          : {}),
        [reservationPath]: { $exists: false },
      },
      {
        $inc: { generationCredits: -creditCost },
        $set: {
          [reservationPath]: reservationData,
        },
      },
      { new: true, projection: { generationCredits: 1, [reservationPath]: 1 } },
    );

    if (!updatedUser) {
      const racedTransaction = await findIdempotentDebit(normalizedIdempotencyKey, userId);
      if (racedTransaction) {
        await completeDebitReservation(userId, reservationPath, {
          idempotencyKey: normalizedIdempotencyKey,
          amount: racedTransaction.amount,
          transactionId: racedTransaction._id,
          balanceAfter: racedTransaction.balanceAfter,
        });
        return {
          remainingCredits: racedTransaction.balanceAfter ?? null,
          transactionId: racedTransaction._id,
          reused: true,
        };
      }

      ({ reservedUser, reservation } = await findDebitReservation(
        userId,
        reservationId,
        reservationPath,
      ));
      if (!reservation) throw buildInsufficientCreditsError();
      assertDebitReservationAmount(reservation, creditCost);
      updatedUser = reservedUser;
    } else {
      reservation = reservationData;
    }
  }

  const reservedLimitMetadata = reservation?.apiKeyUsageLimit
    ? {
      apiKeyUsageLimit: reservation.apiKeyUsageLimit,
      apiKeyUsageLimitPeriod: reservation.apiKeyUsageLimitPeriod,
      apiKeyUsageBefore: reservation.apiKeyUsageBefore,
      apiKeyUsageAfter: reservation.apiKeyUsageAfter,
    }
    : null;
  let transaction;
  try {
    transaction = await recordGenerationCreditTransaction({
      userId,
      apiKeyId: reservation?.apiKeyId || apiKeyLimitCheck?.apiKeyId ||
        apiKeyUsageContext?.apiKeyId || null,
      amount: creditCost,
      direction: 'debit',
      source,
      idempotencyKey: normalizedIdempotencyKey,
      metadata: {
        ...(metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}),
        ...(reservedLimitMetadata || (apiKeyLimitCheck?.usageLimit
          ? {
            apiKeyUsageLimit: apiKeyLimitCheck.usageLimit,
            apiKeyUsageLimitPeriod: apiKeyLimitCheck.usageLimitPeriod,
            apiKeyUsageBefore: apiKeyLimitCheck.currentUsage,
            apiKeyUsageAfter: apiKeyLimitCheck.nextUsage,
          }
          : {})),
      },
      balanceAfter: updatedUser.generationCredits,
    });
  } catch (error) {
    const racedTransaction = await findIdempotentDebit(normalizedIdempotencyKey, userId)
      .catch(() => null);
    if (!racedTransaction) {
      try {
        error.generationCreditDebitReserved = true;
        error.code ||= 'GENERATION_CREDIT_LEDGER_FAILED';
      } catch {
        // Preserve non-extensible database errors.
      }
      throw error;
    }
    transaction = racedTransaction;
  }

  await completeDebitReservation(userId, reservationPath, {
    idempotencyKey: normalizedIdempotencyKey,
    amount: transaction.amount ?? creditCost,
    transactionId: transaction._id,
    balanceAfter: transaction.balanceAfter ?? updatedUser.generationCredits,
  });
  try {
    await maybeTriggerAutoRecharge(userId);
  } catch {
  }

  return {
    remainingCredits: transaction.balanceAfter ?? updatedUser.generationCredits ?? null,
    transactionId: transaction._id || null,
    reused: false,
  };
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
    throw buildInsufficientCreditsError();
  }

  const transaction = await recordGenerationCreditTransaction({
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
    transactionId: transaction?._id || null,
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
