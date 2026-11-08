const amount = value => Math.max(0, Number(value) || 0);

// Refund arguments are cumulative targets, never repeated increments. A durable
// pending operation serializes increases; wallet/ledger callbacks are idempotent.
export function createCappedRefund({ Record, initialize, applyRefund }) {
  return async function refund(recordId, targetCredits, fields = {}) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const record = await Record.findById(recordId).lean();
      if (!record) return null;
      let state = record.refundSettlement;
      if (!state) {
        const initial = await initialize(record);
        const target = Math.min(amount(initial.ceiling), Math.max(amount(initial.refunded),
          targetCredits == null ? amount(initial.ceiling) : amount(targetCredits)));
        const pendingOperation = target > amount(initial.refunded) ? {
          id: `request-refund:${recordId}:1`, target, delta: target - amount(initial.refunded), fields, createdAt: new Date(),
        } : null;
        await Record.updateOne({ _id: recordId, refundSettlement: { $exists: false } }, { $set: {
          refundSettlement: { ...initial, revision: pendingOperation ? 1 : 0, pendingOperation },
        } });
        continue;
      }
      if (state.pendingOperation) {
        const operation = state.pendingOperation;
        const result = await applyRefund(record, operation);
        await Record.updateOne({ _id: recordId, 'refundSettlement.pendingOperation.id': operation.id }, { $set: {
          ...operation.fields,
          'refundSettlement.refunded': operation.target,
          'refundSettlement.pendingOperation': null,
          creditsRefunded: operation.target,
          creditsCharged: Math.max(0, state.ceiling - operation.target),
          remainingCreditsSnapshot: result?.remainingCredits ?? record.remainingCreditsSnapshot ?? null,
        } });
        continue;
      }
      const target = Math.min(amount(state.ceiling), Math.max(amount(state.refunded),
        targetCredits == null ? amount(state.ceiling) : amount(targetCredits)));
      if (target <= amount(state.refunded)) {
        if (Object.keys(fields).length) await Record.updateOne({ _id: recordId,
          'refundSettlement.revision': state.revision, 'refundSettlement.pendingOperation': null,
        }, { $set: fields });
        return Record.findById(recordId).lean();
      }
      const revision = state.revision + 1;
      const operation = { id: `request-refund:${recordId}:${revision}`, target,
        delta: target - amount(state.refunded), fields, createdAt: new Date() };
      await Record.updateOne({ _id: recordId, 'refundSettlement.revision': state.revision,
        'refundSettlement.pendingOperation': null,
      }, { $set: { 'refundSettlement.revision': revision, 'refundSettlement.pendingOperation': operation } });
    }
    throw Object.assign(new Error('Refund settlement changed concurrently; retry.'), { code: 'REFUND_PENDING', status: 409 });
  };
}
