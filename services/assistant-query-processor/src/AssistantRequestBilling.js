import { createHash, randomUUID } from 'node:crypto';
import { assertAssistantTariffAvailable, calculateAssistantRequestBilling } from './AssistantBilling.js';

function error(message, code, status = 409) {
  return Object.assign(new Error(message), { code, status, statusCode: status });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

export function assistantRequestIdentity(userId, scope, payload = {}, idempotencyKey) {
  const requestedKey = payload.client_request_id || payload.clientRequestId || idempotencyKey;
  if (requestedKey && (typeof requestedKey !== 'string' || requestedKey.length > 512)) {
    throw error('Assistant request keys must be strings of at most 512 characters.', 'ASSISTANT_INVALID_REQUEST_KEY', 400);
  }
  const key = requestedKey?.trim() || randomUUID();
  const id = createHash('sha256').update(`${userId}:${scope}:${key}`).digest('hex');
  const fingerprintPayload = { ...payload };
  for (const field of ['async', 'async_mode', 'asyncMode', 'poll', 'polling', 'response_mode', 'responseMode',
    'client_request_id', 'clientRequestId', 'client_session_id', 'clientSessionId',
    'internal_session_id', 'internalSessionId', 'client_request_key', 'clientRequestKey',
    'timeout', 'timeoutMs', 'stream', 'stream_options']) delete fingerprintPayload[field];
  return { id, fingerprint: createHash('sha256').update(JSON.stringify(canonical(fingerprintPayload))).digest('hex') };
}

export function isAssistantProviderOutcomeUncertain(error) {
  const visited = new Set();
  for (let cause = error; cause && !visited.has(cause); cause = cause.cause) {
    visited.add(cause);
    const status = Number(cause.status ?? cause.statusCode ?? cause.response?.status);
    if (status === 408 || status === 504) return true;
    if (['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET',
      'EXTERNAL_INFERENCE_TIMEOUT', 'ASSISTANT_STREAM_INTERRUPTED'].includes(cause.code)) return true;
    if (/timeout|timed out|fetch failed|socket hang up|network error/i.test(`${cause.name || ''} ${cause.message || ''}`)) return true;
  }
  return false;
}

export function createMongoAssistantRequestStore(Model) {
  return {
    async ensure(id, data) {
      try {
        return await Model.findOneAndUpdate({ _id: id }, { $setOnInsert: data },
          { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
      } catch (e) {
        if (e.code !== 11000) throw e;
        return Model.findById(id).lean();
      }
    },
    get: id => Model.findById(id).lean(),
    // A late original provider can still hand off its one receipt after losing
    // the lease. It cannot overwrite a saved result or perform settlement.
    retainResponse: (id, providerResponse) => Model.updateOne({ _id: id, dispatchStarted: true,
      providerResponse: null, status: { $nin: ['COMPLETED', 'FAILED'] } },
    { $set: { providerResponse } }),
    claim: (id, leaseMs) => Model.findOneAndUpdate({ _id: id, status: { $nin: ['COMPLETED', 'FAILED'] },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lte: new Date() } }] },
    { $set: { leaseUntil: new Date(Date.now() + leaseMs), leaseToken: randomUUID(), status: 'PROCESSING' } }, { new: true }).lean(),
    renew: (id, leaseToken, leaseMs) => Model.updateOne({ _id: id, leaseToken, status: { $nin: ['COMPLETED', 'FAILED'] } },
      { $set: { leaseUntil: new Date(Date.now() + leaseMs) } }),
    save: (id, fields, leaseToken) => Model.findOneAndUpdate({ _id: id, status: { $ne: 'COMPLETED' }, ...(leaseToken ? { leaseToken } : {}) },
      { $set: fields }, { new: true }).lean(),
  };
}

/** Persist provider usage before settlement. Replays settle the same receipt;
 * they never infer again or turn missing usage into a word-based/free charge. */
export async function runAssistantRequest({ id, fingerprint, userId, scope, store,
  generate, charge, admit = async () => {}, finalize, model, waived = false, context = {},
  leaseMs = 11 * 60 * 1000 }) {
  let receipt = await store.ensure(id, { fingerprint, userId: String(userId), scope,
    status: 'PENDING', providerResponse: null, leaseUntil: null, context,
    pricingTimestampMs: Date.now() });
  if (receipt.fingerprint !== fingerprint) throw error('Request key was already used with a different payload.', 'ASSISTANT_IDEMPOTENCY_CONFLICT');
  if (receipt.status === 'COMPLETED') return receipt.result;
  if (receipt.status === 'FAILED') throw error(receipt.errorMessage, receipt.errorCode, receipt.errorStatus || 502);
  receipt = await store.claim(id, leaseMs);
  if (!receipt) {
    const latest = await store.get(id);
    if (latest?.status === 'COMPLETED') return latest.result;
    if (latest?.status === 'FAILED') throw error(latest.errorMessage, latest.errorCode, latest.errorStatus || 502);
    throw error('Assistant request is already processing. Retry with the same request key.', 'ASSISTANT_REQUEST_IN_PROGRESS');
  }
  const save = async (fields) => {
    const saved = await store.save(id, fields, receipt.leaseToken);
    if (!saved) throw error('Assistant request ownership changed. Retry with the same key.', 'ASSISTANT_REQUEST_IN_PROGRESS');
    return saved;
  };
  const heartbeat = store.renew && receipt.leaseToken ? setInterval(() => {
    Promise.resolve(store.renew(id, receipt.leaseToken, leaseMs)).catch(() => {});
  }, Math.max(1000, Math.min(30000, Math.floor(leaseMs / 3)))) : null;
  heartbeat?.unref?.();
  let response = receipt.providerResponse;
  let generating = false;
  let dispatched = Boolean(receipt.dispatchStarted);
  let providerReturned = false;
  try {
    if (!response) {
      // A crash while dispatching cannot safely be repaired by silently making
      // another billable provider request. Keep it available for reconciliation.
      if (receipt.dispatchStarted) throw error('The provider outcome needs reconciliation; inference was not repeated.', 'ASSISTANT_PROVIDER_OUTCOME_UNKNOWN', 503);
      if (!waived && model) assertAssistantTariffAvailable(model);
      await admit();
      await save({ dispatchStarted: true });
      dispatched = true;
      generating = true;
      response = await generate(id);
      providerReturned = true;
      generating = false;
      await save({ providerResponse: response, status: 'BILLING_PENDING' });
    }
    const billing = receipt.billing || calculateAssistantRequestBilling(response, {
      model, waived, pricingTimestampMs: receipt.pricingTimestampMs,
    });
    await save({ billing });
    const debit = billing.credits > 0
      ? await charge(billing.credits, { idempotencyKey: `assistant:${id}`, billing, response, requestContext: receipt.context || context })
      : { remainingCredits: null, creditsCharged: 0 };
    const result = finalize
      ? await finalize(response, billing, debit, id)
      : { response, creditsCharged: billing.credits, remainingCredits: debit.remainingCredits ?? null };
    await save({ status: 'COMPLETED', result, leaseUntil: null, errorMessage: null, errorCode: null });
    return result;
  } catch (e) {
    if (e.code === 'ASSISTANT_REQUEST_IN_PROGRESS') {
      if (response && store.retainResponse) await store.retainResponse(id, response);
      throw e;
    }
    const uncertain = (providerReturned && !response) || e.code === 'ASSISTANT_PROVIDER_OUTCOME_UNKNOWN' ||
      (generating && isAssistantProviderOutcomeUncertain(e));
    await save({ ...(response ? { providerResponse: response } : {}), status: response || uncertain ? 'BILLING_PENDING' : dispatched ? 'FAILED' : 'PENDING',
      leaseUntil: null, errorMessage: e.message, errorCode: e.code || 'ASSISTANT_REQUEST_FAILED',
      errorStatus: e.statusCode || e.status || 502 });
    throw e;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}

/** The marker and balance decrement are one atomic document update. A ledger
 * outage is recoverable without repeating the decrement, including concurrent
 * retries and independent assistant requests against the same account. */
export async function debitAssistantOwnerOnce({ Owner, ownerId, credits, idempotencyKey,
  Ledger, ledger = {}, increment = {}, debitBalance = true }) {
  if (!Number.isFinite(credits) || credits <= 0 || !idempotencyKey || !ownerId) {
    throw error('A positive amount and stable billing identity are required.', 'ASSISTANT_BILLING_INVALID_DEBIT', 400);
  }
  const hash = createHash('sha256').update(idempotencyKey).digest('hex');
  const path = `generationCreditDebitReservations.${hash}`;
  const update = { $set: { [path]: { amount: credits, idempotencyKey, status: 'DEBITED' } },
    $inc: { ...(debitBalance ? { generationCredits: -credits } : {}), ...increment } };
  if (!Object.keys(update.$inc).length) delete update.$inc;
  let owner = await Owner.findOneAndUpdate({ _id: ownerId, [path]: { $exists: false } }, update,
    { new: true, projection: { generationCredits: 1, [path]: 1 } });
  if (!owner) owner = await Owner.findOne({ _id: ownerId }, { generationCredits: 1, [path]: 1 }).lean();
  if (!owner) throw error('Billing account no longer exists.', 'ASSISTANT_BILLING_ACCOUNT_MISSING', 404);
  const reservation = owner.generationCreditDebitReservations?.[hash];
  if (!reservation || Math.abs(Number(reservation.amount) - credits) > 0.00000001) {
    throw error('Assistant debit conflicts with its recorded amount.', 'ASSISTANT_BILLING_AMOUNT_CONFLICT');
  }
  if (Ledger) {
    try {
      await Ledger.updateOne({ idempotencyKey }, { $setOnInsert: { ...ledger,
        amount: credits, direction: 'debit', idempotencyKey, balanceAfter: ledger.balanceAfter ?? owner.generationCredits } }, { upsert: true });
    } catch (e) {
      if (e.code !== 11000) throw e;
    }
  }
  return { remainingCredits: owner.generationCredits, creditsCharged: credits };
}
