import assert from 'node:assert/strict';
import test from 'node:test';

import {
  __testOnly__,
  buildDefaultBranchMovieResourceList,
  generateInteractivePublicationMetadata,
} from './InteractivePublicationMetadataAPI.js';

const USER_ID = '507f1f77bcf86cd799439011';
const SESSION_ID = '507f1f77bcf86cd799439012';
const REQUEST_ID = '507f1f77bcf86cd799439013';
const TRANSACTION_ID = '507f1f77bcf86cd799439014';

const PROVIDER_RECEIPT = Object.freeze({
  model: 'gpt-5.6-luna',
  usage: Object.freeze({ input_tokens: 1000, output_tokens: 100 }),
});

const SAFE_RECEIPT = Object.freeze({
  stage: 'publication_metadata_generation',
  attempt: 1,
  model: 'gpt-5.6-luna',
  usage: PROVIDER_RECEIPT.usage,
});

const BILLING_SNAPSHOT = Object.freeze({
  credits: 0.24,
  costUsd: 0.0016,
  pricingModel: 'gpt-5.6-luna',
  pricingMultiplier: 1.5,
  creditsPerDollar: 100,
  usage: Object.freeze({
    inputTokens: 1000,
    outputTokens: 100,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  }),
  tokenPricingUsdPerMillion: Object.freeze({
    input: 1,
    cachedInput: 0.1,
    output: 6,
  }),
});

function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function queryResult(value) {
  return {
    select() {
      return this;
    },
    sort() {
      return this;
    },
    async lean() {
      return cloneValue(value);
    },
  };
}

function buildCompletedSession(overrides = {}) {
  return {
    _id: SESSION_ID,
    userId: USER_ID,
    narrativeType: 'branched',
    sourceNarrativeType: 'branched',
    inputPrompt: 'A traveler follows a signal through a luminous forest.',
    expressGenerationInferenceModel: 'gpt-5.6-sol',
    defaultBranchPathId: 'root.1',
    branchRenderCompletionFinalized: true,
    branchingMeta: { leafNodeIds: ['root.1', 'root.2'] },
    branchingTimeline: { defaultPathId: 'root.1' },
    branchRenderPaths: [
      {
        pathId: 'root.1',
        videoGenerationStatus: 'COMPLETED',
        remoteURL: 'https://cdn.example.com/root.1.mp4',
      },
      {
        pathId: 'root.2',
        videoGenerationStatus: 'COMPLETED',
        remoteURL: 'https://cdn.example.com/root.2.mp4',
      },
    ],
    movieResourceList: {
      structureType: 'branched',
      numLevels: 1,
      nodes: [
        {
          nodeId: 'root',
          level: 0,
          childNodeIds: ['root.1', 'root.2'],
          scenes: [{ sceneIndex: 0, visual: 'Shared opening', duration: 5 }],
          sounds: [],
        },
        {
          nodeId: 'root.1',
          level: 1,
          childNodeIds: [],
          scenes: [{ sceneIndex: 0, visual: 'The traveler reaches dawn.', duration: 5 }],
          sounds: [{ type: 'speech', sceneIndex: 0, audio: 'We made it.' }],
        },
        {
          nodeId: 'root.2',
          level: 1,
          childNodeIds: [],
          scenes: [{ sceneIndex: 0, visual: 'The signal disappears.', duration: 5 }],
          sounds: [{ type: 'speech', sceneIndex: 0, audio: 'It is gone.' }],
        },
      ],
    },
    ...overrides,
  };
}

function valuesEqual(actual, expected) {
  if (actual instanceof Date || expected instanceof Date) {
    return new Date(actual).getTime() === new Date(expected).getTime();
  }
  return actual?.toString?.() === expected?.toString?.();
}

function matchesCondition(actual, expected) {
  if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
    if (Array.isArray(expected.$in)) {
      return expected.$in.some((candidate) => valuesEqual(actual, candidate));
    }
    if (expected.$lte !== undefined) {
      return new Date(actual).getTime() <= new Date(expected.$lte).getTime();
    }
  }
  return valuesEqual(actual, expected);
}

function matchesFilter(document, filter = {}) {
  if (!document) return false;
  return Object.entries(filter).every(([key, expected]) => {
    if (key === '$or') {
      return Array.isArray(expected) && expected.some((candidate) => (
        matchesFilter(document, candidate)
      ));
    }
    return matchesCondition(document[key], expected);
  });
}

function applyUpdate(document, update = {}) {
  if (update.$set) Object.assign(document, cloneValue(update.$set));
  Object.entries(update.$inc || {}).forEach(([key, amount]) => {
    document[key] = Number(document[key] || 0) + Number(amount);
  });
}

function createRequestStore(existingRequest = null) {
  let document = existingRequest ? cloneValue(existingRequest) : null;
  const creates = [];
  const writes = [];
  const claims = [];

  return {
    creates,
    writes,
    claims,
    getDocument: () => cloneValue(document),
    model: {
      async create(data) {
        creates.push(cloneValue(data));
        if (document) {
          throw Object.assign(new Error('duplicate request'), { code: 11000 });
        }
        document = { _id: REQUEST_ID, ...cloneValue(data) };
        return cloneValue(document);
      },
      findOne() {
        return queryResult(document);
      },
      findOneAndUpdate(filter, update) {
        claims.push({ filter: cloneValue(filter), update: cloneValue(update) });
        if (!matchesFilter(document, filter)) return queryResult(null);
        applyUpdate(document, update);
        return queryResult(document);
      },
      async updateOne(filter, update) {
        writes.push({ filter: cloneValue(filter), update: cloneValue(update) });
        if (!matchesFilter(document, filter)) return { matchedCount: 0 };
        applyUpdate(document, update);
        return { matchedCount: 1 };
      },
    },
  };
}

function buildPayloadHash(session) {
  const { defaultPathId, movieResourceList } = buildDefaultBranchMovieResourceList(session);
  return __testOnly__.hashValue({
    sessionId: SESSION_ID,
    defaultPathId,
    originalPrompt: session.inputPrompt,
    inferenceModel: 'gpt-5.6-sol',
    movieResourceList,
  });
}

function buildStoredRequest(clientRequestId, overrides = {}, session = buildCompletedSession()) {
  return {
    _id: REQUEST_ID,
    userId: USER_ID,
    sessionId: SESSION_ID,
    requestKeyHash: __testOnly__.hashValue(clientRequestId),
    payloadHash: buildPayloadHash(session),
    status: 'PROCESSING',
    workerLeaseId: 'original-worker',
    workerLeaseExpiresAt: new Date(Date.now() + 60_000),
    attempts: 1,
    defaultPathId: 'root.1',
    originalPrompt: session.inputPrompt,
    inferenceModel: 'gpt-5.6-sol',
    inferenceReceipt: null,
    billing: null,
    billingStatus: 'PENDING',
    generationSucceeded: null,
    ...cloneValue(overrides),
  };
}

function createHarness({
  session = buildCompletedSession(),
  generationCredits = 20,
  existingRequest = null,
  existingTransaction = null,
  generateMetadata = null,
  deductResult = null,
} = {}) {
  const requestStore = createRequestStore(existingRequest);
  const charges = [];
  const reservations = [];
  const transactionQueries = [];
  const counters = { connect: 0, inference: 0 };
  const metadataImplementation = generateMetadata || (async (_movieResourceList, options) => {
    await options.onInferenceResponse(PROVIDER_RECEIPT);
    return {
      title: 'Signal at Dawn',
      description: 'Choose a route through the forest.',
    };
  });

  const dependencies = {
    authContext: { authType: 'auth_token', internalUserId: USER_ID },
    connectToDatabase: async () => {
      counters.connect += 1;
    },
    videoSessionModel: {
      findOne(query) {
        assert.deepEqual(query, { _id: SESSION_ID, userId: USER_ID });
        return queryResult(session);
      },
    },
    userModel: {
      findById(id) {
        assert.equal(id, USER_ID);
        return queryResult({ generationCredits, selectedInferenceModel: 'gpt-5.6-sol' });
      },
    },
    requestModel: requestStore.model,
    transactionModel: {
      findOne(query) {
        transactionQueries.push(cloneValue(query));
        return queryResult(existingTransaction);
      },
    },
    completeDebitReservation: async (...args) => {
      reservations.push(cloneValue(args));
    },
    generateMetadata: async (...args) => {
      counters.inference += 1;
      return metadataImplementation(...args);
    },
    deductCredits: async (userId, credits, options) => {
      charges.push({ userId, credits, options: cloneValue(options) });
      if (typeof deductResult === 'function') {
        return deductResult(userId, credits, options);
      }
      return deductResult || {
        remainingCredits: 19.76,
        transactionId: TRANSACTION_ID,
        reused: false,
      };
    },
  };

  return {
    charges,
    counters,
    dependencies,
    requestStore,
    reservations,
    session,
    transactionQueries,
  };
}

test('extracts only the canonical default leaf for branched publication metadata', () => {
  const session = buildCompletedSession();
  const result = buildDefaultBranchMovieResourceList(session);

  assert.equal(result.defaultPathId, 'root.1');
  assert.deepEqual(result.movieResourceList, {
    scenes: [{ sceneIndex: 0, visual: 'The traveler reaches dawn.', duration: 5 }],
    sounds: [{ type: 'speech', sceneIndex: 0, audio: 'We made it.' }],
  });
  assert.notEqual(
    result.movieResourceList.scenes,
    session.movieResourceList.nodes[1].scenes,
    'metadata input must not share mutable tree arrays',
  );
  assert.equal(JSON.stringify(result).includes('The signal disappears'), false);
});

test('rejects a default path that disagrees with the persisted render timeline', () => {
  assert.throws(
    () => buildDefaultBranchMovieResourceList(buildCompletedSession({
      branchingTimeline: { defaultPathId: 'root.2' },
    })),
    (error) => error?.code === 'DEFAULT_BRANCH_PATH_MISMATCH' && error?.status === 409,
  );
});

test('initializes idempotency-critical indexes once per model', async () => {
  let requestIndexCalls = 0;
  let transactionIndexCalls = 0;
  const requestModel = {
    async createIndexes() {
      requestIndexCalls += 1;
    },
  };
  const transactionModel = {
    async createIndexes() {
      transactionIndexCalls += 1;
    },
  };

  await __testOnly__.ensurePublicationMetadataIndexes(requestModel, transactionModel);
  await __testOnly__.ensurePublicationMetadataIndexes(requestModel, transactionModel);

  assert.equal(requestIndexCalls, 1);
  assert.equal(transactionIndexCalls, 1);
});

test('fails closed when publication metadata indexes are unavailable and permits a retry', async () => {
  let attempts = 0;
  const requestModel = {
    async createIndexes() {
      attempts += 1;
      if (attempts === 1) throw new Error('index build failed');
    },
  };

  await assert.rejects(
    __testOnly__.ensurePublicationMetadataIndexes(requestModel, {}),
    (error) => error?.code === 'PUBLICATION_METADATA_INDEX_UNAVAILABLE' && error?.status === 503,
  );
  await __testOnly__.ensurePublicationMetadataIndexes(requestModel, {});
  assert.equal(attempts, 2);
});

test('generates, meters, and durably settles default-path publication metadata', async () => {
  const harness = createHarness();
  let inferenceInput = null;
  const originalGenerateMetadata = harness.dependencies.generateMetadata;
  harness.dependencies.generateMetadata = async (...args) => {
    inferenceInput = { movieResourceList: args[0], options: args[1] };
    return originalGenerateMetadata(...args);
  };

  const result = await generateInteractivePublicationMetadata(
    USER_ID,
    { session_id: SESSION_ID, client_request_id: 'meta-click-1' },
    harness.dependencies,
  );

  assert.deepEqual(inferenceInput.movieResourceList, {
    scenes: [{ sceneIndex: 0, visual: 'The traveler reaches dawn.', duration: 5 }],
    sounds: [{ type: 'speech', sceneIndex: 0, audio: 'We made it.' }],
  });
  assert.equal(inferenceInput.options.originalPrompt, harness.session.inputPrompt);
  assert.equal(inferenceInput.options.inferenceModel, 'gpt-5.6-sol');
  assert.equal(harness.charges.length, 1);
  assert.equal(harness.charges[0].userId, USER_ID);
  assert.equal(harness.charges[0].credits, 0.24);
  assert.equal(harness.charges[0].options.metadata.pricingMultiplier, 1.5);
  assert.equal(harness.charges[0].options.metadata.pricingModel, 'gpt-5.6-luna');
  assert.equal(harness.charges[0].options.settleIncurredUsage, true);
  assert.equal(
    harness.charges[0].options.idempotencyKey,
    `interactive_publication_metadata:${REQUEST_ID}`,
  );
  assert.equal(harness.requestStore.writes.length, 4);
  assert.deepEqual(harness.requestStore.writes[0].update.$set.inferenceReceipt, SAFE_RECEIPT);
  assert.equal(harness.requestStore.writes[0].update.$set.billingStatus, 'PENDING');
  assert.equal(harness.requestStore.writes[1].update.$set.status, 'BILLABLE');
  assert.equal(harness.requestStore.writes[1].update.$set.generationSucceeded, true);
  assert.equal(harness.requestStore.writes[2].update.$set.billingStatus, 'CHARGING');
  assert.equal(harness.requestStore.writes[3].update.$set.status, 'COMPLETED');
  assert.equal(harness.requestStore.writes[3].update.$set.billingStatus, 'CHARGED');
  assert.equal(harness.requestStore.creates[0].status, 'PROCESSING');
  assert.equal(harness.requestStore.creates[0].defaultPathId, 'root.1');
  assert.deepEqual(result, {
    title: 'Signal at Dawn',
    description: 'Choose a route through the forest.',
    defaultPathId: 'root.1',
    creditsCharged: 0.24,
    remainingCredits: 19.76,
    reused: false,
  });
});

test('replays a completed metadata request without inference or a second debit', async () => {
  const harness = createHarness();

  await generateInteractivePublicationMetadata(
    USER_ID,
    { session_id: SESSION_ID, client_request_id: 'stable-meta-request' },
    harness.dependencies,
  );

  const writesBeforeReplay = harness.requestStore.writes.length;
  const replay = await generateInteractivePublicationMetadata(
    USER_ID,
    { session_id: SESSION_ID, client_request_id: 'stable-meta-request' },
    harness.dependencies,
  );

  assert.equal(harness.counters.inference, 1);
  assert.equal(harness.charges.length, 1);
  assert.equal(harness.requestStore.writes.length, writesBeforeReplay);
  assert.equal(replay.reused, true);
  assert.equal(replay.creditsCharged, 0.24);
});

test('charges persisted usage and then fails when structured metadata is malformed', async () => {
  const harness = createHarness({
    generateMetadata: async (_movieResourceList, options) => {
      await options.onInferenceResponse(PROVIDER_RECEIPT);
      throw new SyntaxError('Malformed structured metadata');
    },
  });

  await assert.rejects(
    generateInteractivePublicationMetadata(
      USER_ID,
      { session_id: SESSION_ID, client_request_id: 'malformed-meta' },
      harness.dependencies,
    ),
    (error) => {
      assert.equal(error?.code, 'PUBLICATION_METADATA_GENERATION_FAILED');
      assert.equal(error?.status, 502);
      assert.equal(error?.creditsCharged, 0.24);
      assert.equal(error?.remainingCredits, 19.76);
      return true;
    },
  );

  assert.equal(harness.charges.length, 1);
  assert.equal(harness.charges[0].credits, 0.24);
  assert.equal(harness.requestStore.getDocument().status, 'FAILED');
  assert.equal(harness.requestStore.getDocument().billingStatus, 'CHARGED');
  assert.equal(harness.requestStore.getDocument().generationSucceeded, false);
});

test('fails closed without a debit when provider usage is missing', async () => {
  const harness = createHarness({
    generateMetadata: async () => ({
      title: 'Signal at Dawn',
      description: 'Choose a route through the forest.',
    }),
  });

  await assert.rejects(
    generateInteractivePublicationMetadata(
      USER_ID,
      { session_id: SESSION_ID, client_request_id: 'missing-usage' },
      harness.dependencies,
    ),
    (error) => error?.code === 'PUBLICATION_METADATA_BILLING_UNAVAILABLE' && error?.status === 502,
  );

  assert.equal(harness.charges.length, 0);
  assert.equal(harness.transactionQueries.length, 0);
  assert.equal(harness.requestStore.getDocument().status, 'FAILED');
  assert.equal(harness.requestStore.getDocument().billingStatus, 'FAILED');
});

test('fails closed without a debit when provider usage cannot be priced', async () => {
  const harness = createHarness({
    generateMetadata: async (_movieResourceList, options) => {
      await options.onInferenceResponse({
        model: 'unsupported-metadata-model',
        usage: { input_tokens: 1000, output_tokens: 100 },
      });
      return { title: 'Unused', description: 'Unused' };
    },
  });

  await assert.rejects(
    generateInteractivePublicationMetadata(
      USER_ID,
      { session_id: SESSION_ID, client_request_id: 'unpriceable-usage' },
      harness.dependencies,
    ),
    (error) => error?.code === 'PUBLICATION_METADATA_BILLING_UNAVAILABLE' && error?.status === 502,
  );

  assert.equal(harness.charges.length, 0);
  assert.equal(harness.requestStore.writes.length, 1);
  assert.equal(harness.requestStore.getDocument().inferenceReceipt ?? null, null);
  assert.equal(harness.requestStore.getDocument().status, 'FAILED');
});

test('stale processing recovery charges a persisted receipt without rerunning inference', async () => {
  const clientRequestId = 'stale-with-receipt';
  const existingRequest = buildStoredRequest(clientRequestId, {
    workerLeaseExpiresAt: new Date(Date.now() - 60_000),
    inferenceReceipt: SAFE_RECEIPT,
    billing: BILLING_SNAPSHOT,
  });
  const harness = createHarness({
    existingRequest,
    generateMetadata: async () => {
      throw new Error('inference must not be called during receipt recovery');
    },
  });

  await assert.rejects(
    generateInteractivePublicationMetadata(
      USER_ID,
      { session_id: SESSION_ID, client_request_id: clientRequestId },
      harness.dependencies,
    ),
    (error) => {
      assert.equal(error?.code, 'PUBLICATION_METADATA_GENERATION_INTERRUPTED');
      assert.equal(error?.creditsCharged, 0.24);
      return true;
    },
  );

  assert.equal(harness.counters.inference, 0);
  assert.equal(harness.charges.length, 1);
  assert.equal(harness.requestStore.claims.length, 1);
  assert.equal(harness.requestStore.getDocument().attempts, 2);
  assert.equal(harness.requestStore.getDocument().status, 'FAILED');
  assert.equal(harness.requestStore.getDocument().billingStatus, 'CHARGED');
});

test('rejects an existing debit whose amount differs from persisted billing', async () => {
  const clientRequestId = 'mismatched-existing-debit';
  const existingRequest = buildStoredRequest(clientRequestId, {
    status: 'BILLABLE',
    workerLeaseId: null,
    workerLeaseExpiresAt: null,
    inferenceReceipt: SAFE_RECEIPT,
    billing: BILLING_SNAPSHOT,
    billingStatus: 'PENDING',
    generationSucceeded: true,
    title: 'Signal at Dawn',
    description: 'Choose a route through the forest.',
  });
  const harness = createHarness({
    existingRequest,
    existingTransaction: {
      _id: TRANSACTION_ID,
      amount: 0.25,
      balanceAfter: 19.75,
    },
  });

  await assert.rejects(
    generateInteractivePublicationMetadata(
      USER_ID,
      { session_id: SESSION_ID, client_request_id: clientRequestId },
      harness.dependencies,
    ),
    (error) => (
      error?.code === 'PUBLICATION_METADATA_BILLING_IDEMPOTENCY_CONFLICT' &&
      error?.status === 409
    ),
  );

  assert.equal(harness.counters.inference, 0);
  assert.equal(harness.charges.length, 0);
  assert.equal(harness.reservations.length, 0);
  assert.equal(harness.requestStore.writes.length, 0);
});

test('rejects the same idempotency key when the session payload has changed', async () => {
  const clientRequestId = 'same-key-new-payload';
  const originalSession = buildCompletedSession();
  const existingRequest = buildStoredRequest(clientRequestId, {
    status: 'COMPLETED',
    billing: BILLING_SNAPSHOT,
    billingStatus: 'CHARGED',
    generationSucceeded: true,
    title: 'Original title',
    description: 'Original description',
  }, originalSession);
  const harness = createHarness({
    existingRequest,
    session: buildCompletedSession({ inputPrompt: 'A materially different prompt.' }),
  });

  await assert.rejects(
    generateInteractivePublicationMetadata(
      USER_ID,
      { session_id: SESSION_ID, client_request_id: clientRequestId },
      harness.dependencies,
    ),
    (error) => error?.code === 'PUBLICATION_METADATA_IDEMPOTENCY_CONFLICT' && error?.status === 409,
  );

  assert.equal(harness.counters.inference, 0);
  assert.equal(harness.charges.length, 0);
});

test('rejects insufficient credits before inference and records an unbillable failure', async () => {
  const harness = createHarness({ generationCredits: 0 });

  await assert.rejects(
    generateInteractivePublicationMetadata(
      USER_ID,
      { session_id: SESSION_ID, client_request_id: 'no-credits' },
      harness.dependencies,
    ),
    (error) => error?.code === 'INSUFFICIENT_CREDITS' && error?.status === 402,
  );

  assert.equal(harness.counters.inference, 0);
  assert.equal(harness.charges.length, 0);
  assert.equal(harness.requestStore.writes.length, 1);
  assert.equal(harness.requestStore.getDocument().status, 'FAILED');
  assert.equal(harness.requestStore.getDocument().billingStatus, 'FAILED');
  assert.equal(harness.requestStore.getDocument().errorCode, 'INSUFFICIENT_CREDITS');
});

test('rejects an overlong idempotency key before database or inference work', async () => {
  const harness = createHarness();

  await assert.rejects(
    generateInteractivePublicationMetadata(
      USER_ID,
      { session_id: SESSION_ID, client_request_id: 'x'.repeat(501) },
      harness.dependencies,
    ),
    (error) => error?.code === 'IDEMPOTENCY_KEY_TOO_LONG' && error?.status === 400,
  );

  assert.equal(harness.counters.connect, 0);
  assert.equal(harness.counters.inference, 0);
  assert.equal(harness.requestStore.creates.length, 0);
  assert.equal(harness.charges.length, 0);
});

test('ownership-scoped lookup hides another user session', async () => {
  const harness = createHarness({ session: null });

  await assert.rejects(
    generateInteractivePublicationMetadata(
      USER_ID,
      { session_id: SESSION_ID, client_request_id: 'not-owned' },
      harness.dependencies,
    ),
    (error) => error?.code === 'VIDEO_SESSION_NOT_FOUND' && error?.status === 404,
  );

  assert.equal(harness.requestStore.creates.length, 0);
  assert.equal(harness.counters.inference, 0);
});
