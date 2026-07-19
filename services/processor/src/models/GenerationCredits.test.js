import assert from 'node:assert/strict';
import test from 'node:test';
import mongoose from 'mongoose';

import GenerationCreditTransaction from '../schema/GenerationCreditTransaction.js';
import User from '../schema/User.js';
import { deductGenerationCreditsIdempotently } from './GenerationCredits.js';

function setConnectionReadyForTest(t) {
  const originalReadyState = mongoose.connection.readyState;
  mongoose.connection.readyState = 1;
  t.after(() => {
    mongoose.connection.readyState = originalReadyState;
  });
}

function emptyTransactionQuery() {
  return { sort: async () => null };
}

test('idempotent debit stores the balance marker with the decrement and completes it after ledger save', async (t) => {
  setConnectionReadyForTest(t);
  const userId = '507f191e810c19729de860ea';
  const updates = [];
  let debitFilter = null;
  let debitUpdate = null;
  let savedTransaction = null;

  t.mock.method(GenerationCreditTransaction, 'findOne', emptyTransactionQuery);
  t.mock.method(User, 'findOne', () => ({ lean: async () => null }));
  t.mock.method(User, 'findOneAndUpdate', async (filter, update) => {
    debitFilter = filter;
    debitUpdate = update;
    return { generationCredits: 9 };
  });
  t.mock.method(GenerationCreditTransaction.prototype, 'save', async function save() {
    savedTransaction = this;
    return this;
  });
  t.mock.method(User, 'updateOne', async (filter, update) => {
    updates.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(User, 'findById', async () => ({
    _id: userId,
    generationCredits: 9,
    autoRechargeEnabled: false,
  }));

  const result = await deductGenerationCreditsIdempotently(userId, 1, {
    source: 'external_narrative_create_single',
    idempotencyKey: 'narrative:create_single:request-1',
    metadata: { narrativeRequestId: 'request-1' },
  });

  const reservationPath = Object.keys(debitUpdate.$set)[0];
  assert.match(reservationPath, /^generationCreditDebitReservations\.[a-f0-9]{64}$/);
  assert.deepEqual(debitFilter[reservationPath], { $exists: false });
  assert.deepEqual(debitUpdate.$inc, { generationCredits: -1 });
  assert.equal(debitUpdate.$set[reservationPath].amount, 1);
  assert.equal(savedTransaction.idempotencyKey, 'narrative:create_single:request-1');
  assert.equal(savedTransaction.balanceAfter, 9);
  assert.equal(result.remainingCredits, 9);
  assert.ok(result.transactionId);
  assert.equal(result.reused, false);
  const completion = updates.find(({ update }) => update.$set?.[reservationPath]);
  assert.equal(completion.update.$set[reservationPath].status, 'COMPLETED');
  assert.equal(completion.update.$set[reservationPath].amount, 1);
  assert.ok(completion.update.$set[reservationPath].transactionId);
});

test('idempotent debit resumes a balance marker without decrementing the user twice', async (t) => {
  setConnectionReadyForTest(t);
  const userId = '507f191e810c19729de860ea';
  let savedTransaction = null;
  const completionUpdates = [];
  let reservationPath = null;

  t.mock.method(GenerationCreditTransaction, 'findOne', emptyTransactionQuery);
  const debitMock = t.mock.method(User, 'findOneAndUpdate', async () => null);
  t.mock.method(User, 'findOne', (filter) => {
    reservationPath = Object.keys(filter).find((key) => (
      key.startsWith('generationCreditDebitReservations.')
    ));
    const reservationId = reservationPath.split('.')[1];
    return {
      lean: async () => ({
        generationCredits: 7,
        generationCreditDebitReservations: {
          [reservationId]: {
            idempotencyKey: 'narrative:create_single:request-2',
            amount: 3,
          },
        },
      }),
    };
  });
  t.mock.method(GenerationCreditTransaction.prototype, 'save', async function save() {
    savedTransaction = this;
    return this;
  });
  t.mock.method(User, 'updateOne', async (filter, update) => {
    completionUpdates.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  });
  t.mock.method(User, 'findById', async () => ({
    _id: userId,
    generationCredits: 7,
    autoRechargeEnabled: false,
  }));

  const result = await deductGenerationCreditsIdempotently(userId, 3, {
    source: 'external_narrative_create_single',
    idempotencyKey: 'narrative:create_single:request-2',
  });

  assert.equal(debitMock.mock.callCount(), 0);
  assert.equal(savedTransaction.amount, 3);
  assert.equal(savedTransaction.balanceAfter, 7);
  assert.equal(result.remainingCredits, 7);
  assert.ok(result.transactionId);
  assert.equal(result.reused, false);
  assert.ok(completionUpdates.some(({ update }) => (
    update.$set?.[reservationPath]?.status === 'COMPLETED'
  )));
});

test('post-usage settlement records the full debit even when it crosses below zero', async (t) => {
  setConnectionReadyForTest(t);
  const userId = '507f191e810c19729de860ea';
  let debitFilter = null;
  let debitUpdate = null;
  let savedTransaction = null;

  t.mock.method(GenerationCreditTransaction, 'findOne', emptyTransactionQuery);
  t.mock.method(User, 'findOne', () => ({ lean: async () => null }));
  t.mock.method(User, 'findOneAndUpdate', async (filter, update) => {
    debitFilter = filter;
    debitUpdate = update;
    return { generationCredits: -4 };
  });
  t.mock.method(GenerationCreditTransaction.prototype, 'save', async function save() {
    savedTransaction = this;
    return this;
  });
  t.mock.method(User, 'updateOne', async () => ({ matchedCount: 1, modifiedCount: 1 }));
  t.mock.method(User, 'findById', async () => ({
    _id: userId,
    generationCredits: -4,
    autoRechargeEnabled: false,
  }));

  const result = await deductGenerationCreditsIdempotently(userId, 5, {
    source: 'external_narrative_create_single',
    idempotencyKey: 'narrative:create_single:request-postpaid',
    settleIncurredUsage: true,
  });

  const reservationPath = Object.keys(debitUpdate.$set)[0];
  assert.equal(Object.hasOwn(debitFilter, 'generationCredits'), false);
  assert.equal(debitUpdate.$set[reservationPath].settleIncurredUsage, true);
  assert.deepEqual(debitUpdate.$inc, { generationCredits: -5 });
  assert.equal(savedTransaction.balanceAfter, -4);
  assert.equal(result.remainingCredits, -4);
});

test('an existing idempotent debit leaves a completed tombstone without touching the balance', async (t) => {
  setConnectionReadyForTest(t);
  const userId = '507f191e810c19729de860ea';
  const transactionId = '507f1f77bcf86cd799439016';
  const completionUpdates = [];

  t.mock.method(GenerationCreditTransaction, 'findOne', () => ({
    sort: async () => ({
      _id: transactionId,
      amount: 3,
      balanceAfter: 7,
    }),
  }));
  const reservationLookupMock = t.mock.method(User, 'findOne', () => {
    throw new Error('the durable ledger must win before reservation lookup');
  });
  const debitMock = t.mock.method(User, 'findOneAndUpdate', async () => {
    throw new Error('the durable ledger must not debit the user again');
  });
  t.mock.method(User, 'updateOne', async (filter, update) => {
    completionUpdates.push({ filter, update });
    return { matchedCount: 1, modifiedCount: 1 };
  });

  const result = await deductGenerationCreditsIdempotently(userId, 3, {
    source: 'external_narrative_create_single',
    idempotencyKey: 'narrative:create_single:request-3',
  });

  assert.equal(reservationLookupMock.mock.callCount(), 0);
  assert.equal(debitMock.mock.callCount(), 0);
  assert.deepEqual(result, {
    remainingCredits: 7,
    transactionId,
    reused: true,
  });
  assert.equal(completionUpdates.length, 1);
  const completionPath = Object.keys(completionUpdates[0].update.$set)[0];
  assert.match(completionPath, /^generationCreditDebitReservations\.[a-f0-9]{64}$/);
  assert.equal(completionUpdates[0].update.$set[completionPath].status, 'COMPLETED');
  assert.equal(completionUpdates[0].update.$set[completionPath].transactionId, transactionId);
});

test('generation credit transaction schema enforces sparse debit idempotency keys', () => {
  const idempotencyIndex = GenerationCreditTransaction.schema.indexes().find(
    ([fields]) => fields.idempotencyKey === 1,
  );

  assert.ok(idempotencyIndex);
  assert.equal(idempotencyIndex[1].unique, true);
  assert.deepEqual(idempotencyIndex[1].partialFilterExpression, {
    idempotencyKey: { $type: 'string' },
  });
  assert.equal(User.schema.paths.generationCreditDebitReservations.instance, 'Mixed');
});
