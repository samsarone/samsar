import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';

import { extractMetaForMovieResourceList } from '../agent/MetaCreatorAgent.js';
import { getDBConnectionString } from '../DBString.js';
import {
  completeGenerationCreditDebitReservation,
  deductGenerationCreditsIdempotently,
} from '../GenerationCredits.js';
import {
  isBranchedVideoSession,
  isInteractiveSessionReadyForPublication,
} from '../interactive/InteractivePublicationManifest.js';
import {
  resolvePublicationMetadataInferenceModel,
} from '../publication/InferenceModel.js';
import { resolvePublicationOriginalPrompt } from '../publication/Transcript.js';
import PublicationMetadataRequest from '../../schema/PublicationMetadataRequest.js';
import GenerationCreditTransaction from '../../schema/GenerationCreditTransaction.js';
import User from '../../schema/User.js';
import VideoSession from '../../schema/VideoSession.js';
import { calculateAssistantCreditsFromUsage } from './AssistantBilling.js';
import { normalizeAPIKeyUsageContext } from './RequestAuthContext.js';

const MAX_PROMPT_LENGTH = 4000;
const MAX_IDEMPOTENCY_KEY_LENGTH = 500;
const BILLING_SOURCE = 'interactive_publication_metadata';
const PUBLICATION_METADATA_PRICING_MULTIPLIER = 1.5;
// Publication metadata uses xhigh reasoning for OpenAI-backed sessions. Keep
// the lease longer than the provider's normal request window so a live call is
// never reclaimed while it is still producing a response.
const DEFAULT_WORKER_LEASE_MS = 15 * 60 * 1000;
const modelIndexPromises = new WeakMap();

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.statusCode = status;
  error.code = code;
  return error;
}

function getWorkerLeaseMs() {
  const configured = Number(process.env.PUBLICATION_METADATA_WORKER_LEASE_MS);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : DEFAULT_WORKER_LEASE_MS;
}

async function ensureModelIndexes(model) {
  if (!model || typeof model.createIndexes !== 'function') return;

  let indexesPromise = modelIndexPromises.get(model);
  if (!indexesPromise) {
    indexesPromise = Promise.resolve()
      .then(() => model.createIndexes())
      .catch((error) => {
        modelIndexPromises.delete(model);
        throw buildError(
          `Publication metadata billing indexes are unavailable: ${error?.message || String(error)}`,
          503,
          'PUBLICATION_METADATA_INDEX_UNAVAILABLE',
        );
      });
    modelIndexPromises.set(model, indexesPromise);
  }

  await indexesPromise;
}

async function ensurePublicationMetadataIndexes(requestModel, transactionModel) {
  await Promise.all([
    ensureModelIndexes(requestModel),
    ensureModelIndexes(transactionModel),
  ]);
}

function deepCloneJson(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      if (value[key] !== undefined) result[key] = stableJsonValue(value[key]);
      return result;
    }, {});
}

function hashValue(value) {
  return createHash('sha256')
    .update(typeof value === 'string' ? value : JSON.stringify(stableJsonValue(value)))
    .digest('hex');
}

async function resolveQuery(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

async function resolveSelectedQuery(query, projection) {
  const selected = typeof query?.select === 'function' ? query.select(projection) : query;
  return resolveQuery(selected);
}

function getDocumentId(value) {
  return normalizeString(value?._id?.toString?.() || value?._id);
}

function resolveSessionId(payload = {}) {
  return normalizeString(
    payload.session_id || payload.sessionId || payload.request_id || payload.requestId,
  );
}

function resolveClientRequestId(payload = {}, idempotencyKey = null) {
  return normalizeString(
    idempotencyKey || payload.client_request_id || payload.clientRequestId,
  );
}

/**
 * Resolve the first/default rendered leaf as the metadata "happy path".
 * The branching generator does not currently persist an emotional happy-path
 * label, so the same canonical default used by playback/publication is used.
 */
export function buildDefaultBranchMovieResourceList(session = {}) {
  if (!isBranchedVideoSession(session)) {
    throw buildError(
      'Publication metadata is only available for branched video sessions.',
      422,
      'BRANCHED_SESSION_REQUIRED',
    );
  }

  const tree = session?.movieResourceList?.movieResourceList || session?.movieResourceList;
  if (
    !tree ||
    tree.structureType !== 'branched' ||
    !Array.isArray(tree.nodes) ||
    tree.nodes.length === 0
  ) {
    throw buildError(
      'The branched narrative tree is unavailable for this session.',
      409,
      'BRANCHED_NARRATIVE_UNAVAILABLE',
    );
  }

  const storedDefaultPathId = normalizeString(session.defaultBranchPathId);
  const timelineDefaultPathId = normalizeString(
    session?.branchingTimeline?.defaultPathId || session?.branchingTimeline?.default_path_id,
  );
  if (
    storedDefaultPathId &&
    timelineDefaultPathId &&
    storedDefaultPathId !== timelineDefaultPathId
  ) {
    throw buildError(
      'The default branch path does not match the persisted render timeline.',
      409,
      'DEFAULT_BRANCH_PATH_MISMATCH',
    );
  }

  const defaultPathId = storedDefaultPathId || timelineDefaultPathId;
  if (!defaultPathId) {
    throw buildError(
      'The default branch path is unavailable for this session.',
      409,
      'DEFAULT_BRANCH_PATH_UNAVAILABLE',
    );
  }

  const declaredLeafIds = Array.isArray(session?.branchingMeta?.leafNodeIds)
    ? session.branchingMeta.leafNodeIds.map(normalizeString).filter(Boolean)
    : [];
  if (declaredLeafIds.length > 0 && !declaredLeafIds.includes(defaultPathId)) {
    throw buildError(
      'The default branch path is not a declared narrative leaf.',
      409,
      'DEFAULT_BRANCH_PATH_MISMATCH',
    );
  }

  const renderPaths = Array.isArray(session.branchRenderPaths) ? session.branchRenderPaths : [];
  if (
    renderPaths.length > 0 &&
    !renderPaths.some((path) => normalizeString(path?.pathId || path?.path_id) === defaultPathId)
  ) {
    throw buildError(
      'The default branch path is missing from the render plan.',
      409,
      'DEFAULT_BRANCH_PATH_MISMATCH',
    );
  }

  const leafNode = tree.nodes.find((node) => normalizeString(node?.nodeId) === defaultPathId);
  const childNodeIds = Array.isArray(leafNode?.childNodeIds)
    ? leafNode.childNodeIds.map(normalizeString).filter(Boolean)
    : [];
  const declaredLevel = Number(tree.numLevels);
  const nodeLevel = Number(leafNode?.level);
  if (
    !leafNode ||
    childNodeIds.length > 0 ||
    (Number.isInteger(declaredLevel) && Number.isInteger(nodeLevel) && nodeLevel !== declaredLevel)
  ) {
    throw buildError(
      'The default branch path does not resolve to a narrative leaf.',
      409,
      'DEFAULT_BRANCH_PATH_MISMATCH',
    );
  }
  if (!Array.isArray(leafNode.scenes) || leafNode.scenes.length === 0) {
    throw buildError(
      'The default branch path has no narrative scenes.',
      409,
      'DEFAULT_BRANCH_NARRATIVE_EMPTY',
    );
  }

  return {
    defaultPathId,
    movieResourceList: {
      scenes: deepCloneJson(leafNode.scenes),
      sounds: Array.isArray(leafNode.sounds) ? deepCloneJson(leafNode.sounds) : [],
    },
  };
}

function validateBillingReceipt(receipt = {}) {
  const billing = calculateAssistantCreditsFromUsage({
    model: receipt.model,
    usage: receipt.usage,
    pricingMultiplier: PUBLICATION_METADATA_PRICING_MULTIPLIER,
  });
  const billableTokens = Number(billing?.usage?.inputTokens || 0) +
    Number(billing?.usage?.outputTokens || 0);
  if (!billing.pricingModel || billableTokens <= 0 || !(billing.credits > 0)) {
    throw buildError(
      'Publication metadata usage could not be priced safely.',
      502,
      'PUBLICATION_METADATA_BILLING_UNAVAILABLE',
    );
  }
  return billing;
}

function serializeCompletedRequest(request = {}, { reused = false } = {}) {
  return {
    title: normalizeString(request.title),
    description: normalizeString(request.description),
    defaultPathId: normalizeString(request.defaultPathId),
    creditsCharged: Number(request?.billing?.credits) || 0,
    remainingCredits: Number.isFinite(Number(request.remainingCredits))
      ? Number(request.remainingCredits)
      : null,
    reused,
  };
}

function getUpdateMatchedCount(result) {
  return Number(result?.matchedCount ?? result?.n ?? result?.modifiedCount ?? 0);
}

function buildBillingSnapshot(billing = {}) {
  return {
    credits: billing.credits,
    costUsd: billing.costUsd,
    pricingModel: billing.pricingModel,
    pricingMultiplier: billing.pricingMultiplier,
    creditsPerDollar: billing.creditsPerDollar,
    usage: billing.usage,
    tokenPricingUsdPerMillion: billing.tokenPricingUsdPerMillion,
  };
}

function buildSafeInferenceReceipt(receipt = {}) {
  return {
    stage: normalizeString(receipt.stage) || 'publication_metadata_generation',
    attempt: Number.isSafeInteger(Number(receipt.attempt)) ? Number(receipt.attempt) : 1,
    model: normalizeString(receipt.model),
    usage: receipt?.usage && typeof receipt.usage === 'object'
      ? deepCloneJson(receipt.usage)
      : null,
  };
}

function assertWorkerUpdateMatched(result) {
  if (getUpdateMatchedCount(result) > 0) return;
  throw buildError(
    'Publication metadata generation lost its worker lease.',
    409,
    'PUBLICATION_METADATA_WORKER_LEASE_LOST',
  );
}

async function markUnbillableRequestFailed({
  requestModel,
  requestId,
  workerLeaseId,
  error,
}) {
  if (!requestId) return;
  const result = await requestModel.updateOne(
    { _id: requestId, status: 'PROCESSING', workerLeaseId },
    {
      $set: {
        status: 'FAILED',
        billingStatus: 'FAILED',
        generationSucceeded: false,
        errorCode: normalizeString(error?.code) || 'PUBLICATION_METADATA_GENERATION_FAILED',
        errorMessage: normalizeString(error?.message) || 'Publication metadata generation failed.',
        errorStatus: Number(error?.status || error?.statusCode) || 500,
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      },
    },
  );
  assertWorkerUpdateMatched(result);
}

async function persistInferenceReceipt({
  requestModel,
  requestId,
  workerLeaseId,
  receipt,
}) {
  const safeReceipt = buildSafeInferenceReceipt(receipt);
  const billing = validateBillingReceipt(safeReceipt);
  const billingSnapshot = buildBillingSnapshot(billing);
  const result = await requestModel.updateOne(
    { _id: requestId, status: 'PROCESSING', workerLeaseId },
    {
      $set: {
        inferenceReceipt: safeReceipt,
        billing: billingSnapshot,
        billingStatus: 'PENDING',
        workerLeaseExpiresAt: new Date(Date.now() + getWorkerLeaseMs()),
      },
    },
  );
  assertWorkerUpdateMatched(result);
  return { safeReceipt, billingSnapshot };
}

async function transitionRequestToBillable({
  requestModel,
  requestId,
  workerLeaseId,
  title = null,
  description = null,
  generationSucceeded,
  error = null,
}) {
  const result = await requestModel.updateOne(
    { _id: requestId, status: 'PROCESSING', workerLeaseId },
    {
      $set: {
        status: 'BILLABLE',
        title,
        description,
        generationSucceeded: generationSucceeded === true,
        errorCode: error
          ? normalizeString(error?.code) || 'PUBLICATION_METADATA_GENERATION_FAILED'
          : null,
        errorMessage: error
          ? normalizeString(error?.message) || 'Publication metadata generation failed.'
          : null,
        errorStatus: error ? Number(error?.status || error?.statusCode) || 502 : null,
        workerLeaseId: null,
        workerLeaseExpiresAt: null,
      },
    },
  );
  assertWorkerUpdateMatched(result);
}

function getBillingIdempotencyKey(requestId) {
  return `${BILLING_SOURCE}:${requestId}`;
}

async function findExistingCharge(transactionModel, userId, requestId) {
  const query = transactionModel.findOne({
    userId,
    direction: 'debit',
    idempotencyKey: getBillingIdempotencyKey(requestId),
  });
  const sorted = typeof query?.sort === 'function' ? query.sort({ createdAt: -1 }) : query;
  return resolveQuery(sorted);
}

function assertChargeMatchesBilling(transaction, billing) {
  const charged = Number(transaction?.amount);
  const expected = Number(billing?.credits);
  if (
    Number.isFinite(charged) &&
    Number.isFinite(expected) &&
    Math.abs(charged - expected) <= 0.0001
  ) {
    return transaction;
  }
  throw buildError(
    'The existing publication metadata debit does not match the calculated usage.',
    409,
    'PUBLICATION_METADATA_BILLING_IDEMPOTENCY_CONFLICT',
  );
}

function throwStoredGenerationFailure(request, charge = {}) {
  const error = buildError(
    normalizeString(request.errorMessage) || 'Publication metadata generation failed.',
    Number(request.errorStatus) || 502,
    normalizeString(request.errorCode) || 'PUBLICATION_METADATA_GENERATION_FAILED',
  );
  error.creditsCharged = Number(charge.creditsCharged ?? request?.billing?.credits) || 0;
  error.remainingCredits = Number.isFinite(Number(charge.remainingCredits ?? request.remainingCredits))
    ? Number(charge.remainingCredits ?? request.remainingCredits)
    : null;
  throw error;
}

async function settleBillableRequest({
  request,
  userId,
  authContext,
  requestModel,
  deductCredits,
  transactionModel,
  completeDebitReservation,
}) {
  const requestId = getDocumentId(request);
  const credits = Number(request?.billing?.credits);
  if (!requestId || request.status !== 'BILLABLE' || !(credits > 0)) {
    throw buildError(
      'The publication metadata charge is not ready to settle.',
      409,
      'PUBLICATION_METADATA_NOT_READY',
    );
  }

  const apiKeyUsage = normalizeAPIKeyUsageContext(authContext);
  let existingTransaction = await findExistingCharge(transactionModel, userId, requestId);
  let chargeResult;
  if (existingTransaction) {
    assertChargeMatchesBilling(existingTransaction, request.billing);
    await completeDebitReservation(userId, getBillingIdempotencyKey(requestId), {
      amount: existingTransaction.amount,
      transactionId: existingTransaction._id,
      balanceAfter: existingTransaction.balanceAfter,
    });
    chargeResult = {
      creditsCharged: Number(existingTransaction.amount),
      remainingCredits: existingTransaction.balanceAfter ?? null,
      transactionId: existingTransaction._id,
      reused: true,
    };
  } else {
    const now = new Date();
    const billingClaim = await requestModel.updateOne(
      {
        _id: requestId,
        status: 'BILLABLE',
        $or: [
          { billingStatus: { $in: ['PENDING', 'FAILED'] } },
          { billingStatus: 'CHARGING', billingLeaseExpiresAt: { $lte: now } },
        ],
      },
      {
        $set: {
          billingStatus: 'CHARGING',
          billingLeaseExpiresAt: new Date(now.getTime() + getWorkerLeaseMs()),
        },
      },
    );
    if (getUpdateMatchedCount(billingClaim) === 0) {
      existingTransaction = await findExistingCharge(transactionModel, userId, requestId);
      if (!existingTransaction) {
        throw buildError(
          'Publication metadata billing is already being settled.',
          409,
          'PUBLICATION_METADATA_BILLING_IN_PROGRESS',
        );
      }
      assertChargeMatchesBilling(existingTransaction, request.billing);
      await completeDebitReservation(userId, getBillingIdempotencyKey(requestId), {
        amount: existingTransaction.amount,
        transactionId: existingTransaction._id,
        balanceAfter: existingTransaction.balanceAfter,
      });
      chargeResult = {
        creditsCharged: Number(existingTransaction.amount),
        remainingCredits: existingTransaction.balanceAfter ?? null,
        transactionId: existingTransaction._id,
        reused: true,
      };
    } else {
      const debit = await deductCredits(userId, credits, {
        source: BILLING_SOURCE,
        idempotencyKey: getBillingIdempotencyKey(requestId),
        settleIncurredUsage: true,
        apiKeyId: apiKeyUsage?.apiKeyId || null,
        metadata: {
          requestType: 'API',
          category: 'publication_metadata',
          sessionId: request.sessionId?.toString?.() || request.sessionId,
          publicationMetadataRequestId: requestId,
          defaultPathId: request.defaultPathId,
          inferenceModel: request.inferenceModel,
          pricingModel: request.billing.pricingModel,
          pricingMultiplier: request.billing.pricingMultiplier,
          underlyingCostUsd: request.billing.costUsd,
          usage: request.billing.usage,
          creditsCharged: credits,
          ...(apiKeyUsage ? { apiKeyUsage } : {}),
        },
      });
      if (debit?.reused === true) {
        existingTransaction = await findExistingCharge(transactionModel, userId, requestId);
        assertChargeMatchesBilling(existingTransaction, request.billing);
      }
      chargeResult = {
        creditsCharged: credits,
        remainingCredits: debit?.remainingCredits ?? existingTransaction?.balanceAfter ?? null,
        transactionId: debit?.transactionId ?? existingTransaction?._id ?? null,
        reused: debit?.reused === true,
      };
    }
  }

  const remainingCredits = Number.isFinite(Number(chargeResult.remainingCredits))
    ? Number(chargeResult.remainingCredits)
    : null;
  const finalStatus = request.generationSucceeded === true ? 'COMPLETED' : 'FAILED';
  const completion = await requestModel.updateOne(
    { _id: requestId, status: 'BILLABLE' },
    {
      $set: {
        status: finalStatus,
        billingStatus: 'CHARGED',
        billingTransactionId: chargeResult.transactionId || null,
        remainingCredits,
        billingLeaseExpiresAt: null,
        ...(finalStatus === 'COMPLETED'
          ? { errorCode: null, errorMessage: null, errorStatus: null }
          : {}),
      },
    },
  );
  assertWorkerUpdateMatched(completion);

  const settledRequest = {
    ...request,
    status: finalStatus,
    billingStatus: 'CHARGED',
    billingTransactionId: chargeResult.transactionId || null,
    remainingCredits,
  };
  if (finalStatus === 'FAILED') {
    throwStoredGenerationFailure(settledRequest, chargeResult);
  }
  return serializeCompletedRequest(settledRequest, { reused: chargeResult.reused === true });
}

async function createOrLoadRequest(requestModel, requestData) {
  try {
    return { request: await requestModel.create(requestData), created: true };
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await resolveQuery(requestModel.findOne({
      userId: requestData.userId,
      requestKeyHash: requestData.requestKeyHash,
    }));
    if (!existing) throw error;
    return { request: existing, created: false };
  }
}

async function claimExpiredProcessingRequest(requestModel, request) {
  const now = new Date();
  const workerLeaseId = randomUUID();
  const claimed = await resolveQuery(requestModel.findOneAndUpdate(
    {
      _id: request._id,
      status: 'PROCESSING',
      workerLeaseExpiresAt: { $lte: now },
    },
    {
      $set: {
        workerLeaseId,
        workerLeaseExpiresAt: new Date(now.getTime() + getWorkerLeaseMs()),
        errorCode: null,
        errorMessage: null,
        errorStatus: null,
      },
      $inc: { attempts: 1 },
    },
    { new: true },
  ));
  return claimed ? { ...claimed, workerLeaseId } : null;
}

export async function generateInteractivePublicationMetadata(
  userId,
  payload = {},
  {
    authContext = null,
    idempotencyKey = null,
    connectToDatabase = getDBConnectionString,
    videoSessionModel = VideoSession,
    userModel = User,
    requestModel = PublicationMetadataRequest,
    generateMetadata = extractMetaForMovieResourceList,
    deductCredits = deductGenerationCreditsIdempotently,
    transactionModel = GenerationCreditTransaction,
    completeDebitReservation = completeGenerationCreditDebitReservation,
  } = {},
) {
  const normalizedUserId = normalizeString(userId?.toString?.() || userId);
  const sessionId = resolveSessionId(payload);
  const clientRequestId = resolveClientRequestId(payload, idempotencyKey);
  if (!normalizedUserId) {
    throw buildError('Authenticated user is required.', 401, 'AUTHENTICATION_REQUIRED');
  }
  if (!sessionId || !mongoose.Types.ObjectId.isValid(sessionId)) {
    throw buildError(
      'A valid video session id is required.',
      400,
      'VIDEO_SESSION_ID_REQUIRED',
    );
  }
  if (!clientRequestId) {
    throw buildError(
      'Idempotency-Key or client_request_id is required.',
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }
  if (clientRequestId.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw buildError(
      `Idempotency-Key cannot exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`,
      400,
      'IDEMPOTENCY_KEY_TOO_LONG',
    );
  }

  await connectToDatabase();
  await ensurePublicationMetadataIndexes(requestModel, transactionModel);
  const session = await resolveSelectedQuery(
    videoSessionModel.findOne({ _id: sessionId, userId: normalizedUserId }),
    {
      userId: 1,
      narrativeType: 1,
      sourceNarrativeType: 1,
      movieResourceList: 1,
      defaultBranchPathId: 1,
      branchingTimeline: 1,
      branchingMeta: 1,
      branchRenderPaths: 1,
      branchRenderCompletionFinalized: 1,
      inputPrompt: 1,
      expressInputPrompt: 1,
      promptList: 1,
      promptlist: 1,
      inferenceModel: 1,
      expressGenerationInferenceModel: 1,
      selectedInferenceModel: 1,
      expressStepGeneration: 1,
      expressGenerationBuilder: 1,
      metadata: 1,
    },
  );
  if (!session) {
    throw buildError('Video session not found.', 404, 'VIDEO_SESSION_NOT_FOUND');
  }
  if (!isInteractiveSessionReadyForPublication(session)) {
    throw buildError(
      'Every interactive video path must finish rendering before metadata can be generated.',
      409,
      'INTERACTIVE_RENDER_NOT_COMPLETE',
    );
  }

  const { defaultPathId, movieResourceList } = buildDefaultBranchMovieResourceList(session);
  const originalPrompt = resolvePublicationOriginalPrompt({}, session);
  if (!originalPrompt) {
    throw buildError(
      'The original video prompt is unavailable for this session.',
      409,
      'PUBLICATION_PROMPT_UNAVAILABLE',
    );
  }
  if (originalPrompt.length > MAX_PROMPT_LENGTH) {
    throw buildError(
      `The original video prompt cannot exceed ${MAX_PROMPT_LENGTH.toLocaleString()} characters.`,
      422,
      'PUBLICATION_PROMPT_TOO_LONG',
    );
  }

  const user = await resolveSelectedQuery(
    userModel.findById(normalizedUserId),
    { generationCredits: 1, selectedInferenceModel: 1 },
  );
  if (!user) {
    throw buildError('Authenticated user was not found.', 401, 'AUTHENTICATION_REQUIRED');
  }
  const inferenceModel = resolvePublicationMetadataInferenceModel(
    session,
    user.selectedInferenceModel,
  );
  const payloadHash = hashValue({
    sessionId,
    defaultPathId,
    originalPrompt,
    inferenceModel,
    movieResourceList,
  });
  const workerLeaseId = randomUUID();
  const requestData = {
    userId: normalizedUserId,
    sessionId,
    requestKeyHash: hashValue(clientRequestId),
    payloadHash,
    status: 'PROCESSING',
    workerLeaseId,
    workerLeaseExpiresAt: new Date(Date.now() + getWorkerLeaseMs()),
    attempts: 1,
    defaultPathId,
    originalPrompt,
    inferenceModel,
  };
  const { request, created } = await createOrLoadRequest(requestModel, requestData);
  let activeRequest = request;
  if (!created) {
    if (request.payloadHash !== payloadHash) {
      throw buildError(
        'This idempotency key was already used for different publication metadata input.',
        409,
        'PUBLICATION_METADATA_IDEMPOTENCY_CONFLICT',
      );
    }
    if (request.status === 'COMPLETED') {
      return serializeCompletedRequest(request, { reused: true });
    }
    if (request.status === 'BILLABLE') {
      return settleBillableRequest({
        request,
        userId: normalizedUserId,
        authContext,
        requestModel,
        deductCredits,
        transactionModel,
        completeDebitReservation,
      });
    }
    if (request.status === 'FAILED') {
      if (request.billingStatus === 'CHARGED') {
        throwStoredGenerationFailure(request);
      }
      throw buildError(
        'This publication metadata request failed; retry with a new idempotency key.',
        409,
        'PUBLICATION_METADATA_REQUEST_FAILED',
      );
    }
    if (request.status === 'PROCESSING') {
      activeRequest = await claimExpiredProcessingRequest(requestModel, request);
      if (!activeRequest) {
        throw buildError(
          'Publication metadata generation is already in progress.',
          409,
          'PUBLICATION_METADATA_IN_PROGRESS',
        );
      }
    } else {
      throw buildError(
        'This publication metadata request is in an unsupported state.',
        409,
        'PUBLICATION_METADATA_REQUEST_INVALID',
      );
    }
  }

  const requestId = getDocumentId(activeRequest);
  const activeWorkerLeaseId = normalizeString(activeRequest.workerLeaseId || workerLeaseId);
  if (activeRequest.inferenceReceipt && activeRequest.billing) {
    const interruptedError = buildError(
      'Publication metadata generation was interrupted after provider usage was recorded.',
      502,
      'PUBLICATION_METADATA_GENERATION_INTERRUPTED',
    );
    await transitionRequestToBillable({
      requestModel,
      requestId,
      workerLeaseId: activeWorkerLeaseId,
      generationSucceeded: false,
      error: interruptedError,
    });
    return settleBillableRequest({
      request: {
        ...activeRequest,
        _id: requestId,
        status: 'BILLABLE',
        generationSucceeded: false,
        errorCode: interruptedError.code,
        errorMessage: interruptedError.message,
        errorStatus: interruptedError.status,
      },
      userId: normalizedUserId,
      authContext,
      requestModel,
      deductCredits,
      transactionModel,
      completeDebitReservation,
    });
  }
  if (!(Number(user.generationCredits) > 0)) {
    const insufficientError = buildError(
      'Insufficient credits.',
      402,
      'INSUFFICIENT_CREDITS',
    );
    await markUnbillableRequestFailed({
      requestModel,
      requestId,
      workerLeaseId: activeWorkerLeaseId,
      error: insufficientError,
    });
    throw insufficientError;
  }

  let persistedInference = null;
  let metadata;
  try {
    metadata = await generateMetadata(movieResourceList, {
      originalPrompt,
      inferenceModel,
      onInferenceResponse: async (receipt) => {
        persistedInference = await persistInferenceReceipt({
          requestModel,
          requestId,
          workerLeaseId: activeWorkerLeaseId,
          receipt,
        });
      },
    });
  } catch (error) {
    if (!persistedInference) {
      await markUnbillableRequestFailed({
        requestModel,
        requestId,
        workerLeaseId: activeWorkerLeaseId,
        error,
      });
      throw error;
    }
    await transitionRequestToBillable({
      requestModel,
      requestId,
      workerLeaseId: activeWorkerLeaseId,
      generationSucceeded: false,
      error,
    });
    return settleBillableRequest({
      request: {
        ...requestData,
        _id: requestId,
        status: 'BILLABLE',
        generationSucceeded: false,
        billing: persistedInference.billingSnapshot,
        inferenceReceipt: persistedInference.safeReceipt,
        errorCode: normalizeString(error?.code) || 'PUBLICATION_METADATA_GENERATION_FAILED',
        errorMessage: normalizeString(error?.message) || 'Publication metadata generation failed.',
        errorStatus: Number(error?.status || error?.statusCode) || 502,
      },
      userId: normalizedUserId,
      authContext,
      requestModel,
      deductCredits,
      transactionModel,
      completeDebitReservation,
    });
  }

  if (!persistedInference) {
    const missingUsageError = buildError(
      'Publication metadata generation returned no billable usage.',
      502,
      'PUBLICATION_METADATA_BILLING_UNAVAILABLE',
    );
    await markUnbillableRequestFailed({
      requestModel,
      requestId,
      workerLeaseId: activeWorkerLeaseId,
      error: missingUsageError,
    });
    throw missingUsageError;
  }

  const title = normalizeString(metadata?.title);
  const description = normalizeString(metadata?.description);
  if (!title || !description || title.length > 160 || description.length > 2000) {
    const invalidMetadataError = buildError(
      'The generated publication metadata is invalid.',
      502,
      'PUBLICATION_METADATA_INVALID',
    );
    await transitionRequestToBillable({
      requestModel,
      requestId,
      workerLeaseId: activeWorkerLeaseId,
      generationSucceeded: false,
      error: invalidMetadataError,
    });
    return settleBillableRequest({
      request: {
        ...requestData,
        _id: requestId,
        status: 'BILLABLE',
        generationSucceeded: false,
        billing: persistedInference.billingSnapshot,
        inferenceReceipt: persistedInference.safeReceipt,
        errorCode: invalidMetadataError.code,
        errorMessage: invalidMetadataError.message,
        errorStatus: invalidMetadataError.status,
      },
      userId: normalizedUserId,
      authContext,
      requestModel,
      deductCredits,
      transactionModel,
      completeDebitReservation,
    });
  }

  await transitionRequestToBillable({
    requestModel,
    requestId,
    workerLeaseId: activeWorkerLeaseId,
    title,
    description,
    generationSucceeded: true,
  });
  return settleBillableRequest({
    request: {
      ...requestData,
      _id: requestId,
      status: 'BILLABLE',
      title,
      description,
      generationSucceeded: true,
      billing: persistedInference.billingSnapshot,
      inferenceReceipt: persistedInference.safeReceipt,
    },
    userId: normalizedUserId,
    authContext,
    requestModel,
    deductCredits,
    transactionModel,
    completeDebitReservation,
  });
}

export const __testOnly__ = {
  ensurePublicationMetadataIndexes,
  hashValue,
  getWorkerLeaseMs,
  resolveClientRequestId,
  validateBillingReceipt,
};
