import { createHash } from 'node:crypto';

export const creditOperationHash = key => createHash('sha256').update(String(key)).digest('hex');
const conflict = () => Object.assign(new Error('Credit operation does not match its original wallet mutation.'), {
  code: 'CREDIT_OPERATION_CONFLICT', status: 409,
});

// The balance and permanent operation marker are a single Mongo document write.
// In particular, a failed ledger/receipt write must never undo this marker.
export async function mutateWalletOnce({ Model, id, operationId, delta, increments = {}, set = {} }) {
  const hash = creditOperationHash(operationId);
  const path = `creditOperationMarkers.${hash}`;
  const read = () => Model.findById(id).select(`generationCredits +creditOperationMarkers`).lean();
  let account = await read();
  if (!account) throw new Error('Credit account not found.');
  let marker = account.creditOperationMarkers?.[hash];
  if (!marker) {
    account = await Model.findOneAndUpdate({ _id: id, [path]: { $exists: false },
      ...(delta < 0 ? { generationCredits: { $gte: -delta } } : {}),
    }, { $inc: { ...(Object.hasOwn(set, 'generationCredits') ? {} : { generationCredits: delta }), ...increments }, $set: {
      ...set, [path]: { operationId, delta, createdAt: new Date() },
    } }, { new: true }).select(`generationCredits +creditOperationMarkers`).lean();
    if (!account) account = await read();
    marker = account?.creditOperationMarkers?.[hash];
  }
  if (!marker) throw Object.assign(new Error('Insufficient credits'), { code: 'INSUFFICIENT_CREDITS', status: 402 });
  if (marker.operationId !== operationId || marker.delta !== delta) throw conflict();
  return account;
}

export async function recordCreditOperationOnce(Ledger, operationId, entry) {
  const _id = creditOperationHash(operationId).slice(0, 24);
  try {
    await Ledger.updateOne({ _id }, { $setOnInsert: { ...entry, idempotencyKey: operationId } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
  const saved = await Ledger.findById(_id).lean();
  if (!saved || saved.idempotencyKey !== operationId || saved.amount !== entry.amount ||
      saved.direction !== entry.direction || String(saved.userId || saved.externalUserId) !== String(entry.userId || entry.externalUserId)) {
    throw conflict();
  }
  return saved;
}
