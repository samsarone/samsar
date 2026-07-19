import { getDBConnectionString } from "./DBString.js";
import axios from 'axios';
import ExternalUser from "./schema/ExternalUser.js";
import ExternalUserRequest from "./schema/ExternalUserRequest.js";
import VideoSession from "./schema/VideoSession.js";
import {
  buildBranchDeliveryFields,
  getDefaultBranchResult,
  isCompleteBranchDelivery,
  isBranchedVideoSession,
} from './utils/BranchRenderPaths.js';

const API_SERVER = process.env.API_SERVER;

function normalizeExternalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

export function buildExternalRequestIdentityFields(sessionData = {}, sessionId = null) {
  const upstreamSessionId = normalizeExternalString(
    typeof sessionId === 'string' ? sessionId : sessionId?.toString?.(),
  );
  const externalRequestId = normalizeExternalString(sessionData?.externalRequestId);
  const publicRequestId = externalRequestId || upstreamSessionId;
  if (!publicRequestId) {
    return {};
  }

  return {
    request_id: publicRequestId,
    session_id: publicRequestId,
    ...(externalRequestId
      ? {
        external_request_id: externalRequestId,
        external_session_id: externalRequestId,
        ...(upstreamSessionId ? { upstream_session_id: upstreamSessionId } : {}),
      }
      : {}),
  };
}

export function normalizeBranchDeliveryFieldsForTerminalStatus(
  branchDeliveryFields,
  status,
) {
  if (!branchDeliveryFields) {
    return null;
  }

  const normalizedFields = { ...branchDeliveryFields };
  if (status !== 'COMPLETED') {
    delete normalizedFields.result_urls;
  }
  return normalizedFields;
}

export function buildExternalSettlementResponsePayload({
  previousResponsePayload = {},
  status,
  resolvedResultUrl = null,
  resolvedErrorMessage = null,
  branchDeliveryFields = null,
  branchedSession = false,
}) {
  const normalizedBranchDeliveryFields = normalizeBranchDeliveryFieldsForTerminalStatus(
    branchDeliveryFields,
    status,
  );
  const responsePayload = {
    ...(previousResponsePayload || {}),
    status,
    ...(resolvedResultUrl ? { result_url: resolvedResultUrl } : {}),
    ...(normalizedBranchDeliveryFields || {}),
    ...(resolvedErrorMessage ? { message: resolvedErrorMessage } : {}),
  };

  if (branchedSession) {
    if (status === 'COMPLETED') {
      delete responsePayload.message;
      delete responsePayload.error;
    } else {
      delete responsePayload.result_url;
      delete responsePayload.result_urls;
      delete responsePayload.videoLink;
      delete responsePayload.video_link;
      delete responsePayload.remoteURL;
      delete responsePayload.remote_url;
    }
  }

  return responsePayload;
}

function resolveSessionResultUrl(sessionData) {
  if (isBranchedVideoSession(sessionData)) {
    return getDefaultBranchResult(sessionData, { apiServer: API_SERVER })?.result_url || null;
  }

  if (sessionData?.remoteURL) {
    return sessionData.remoteURL;
  }

  if (sessionData?.videoVideoLink) {
    return `${API_SERVER}/${sessionData.videoVideoLink}`;
  }

  if (sessionData?.videoLink) {
    return `${API_SERVER}/${sessionData.videoLink}`;
  }

  return null;
}

async function syncExternalRequestSettlement({
  sessionData,
  sessionId,
  status,
  creditsRefunded = 0,
  errorMessage = null,
  branchDeliveryFields: suppliedBranchDeliveryFields = null,
}) {
  if (!sessionData?.isExternalUserRequest || !sessionData?.externalRequestUserId) {
    return null;
  }

  const normalizedSessionId = normalizeExternalString(sessionId);
  const normalizedExternalRequestId = normalizeExternalString(sessionData.externalRequestId);
  if (!normalizedSessionId && !normalizedExternalRequestId) {
    return null;
  }

  const requestRecord = await ExternalUserRequest.findOne(
    normalizedExternalRequestId
      ? { externalRequestId: normalizedExternalRequestId }
      : {
          upstreamSessionId: normalizedSessionId,
          externalUserId: sessionData.externalRequestUserId,
        },
  );

  if (!requestRecord) {
    return null;
  }

  const now = new Date();
  const normalizedRefundTarget = Number.isFinite(Number(creditsRefunded))
    ? Math.max(0, Number(creditsRefunded))
    : 0;
  const currentRefund = Number(requestRecord.creditsRefunded) || 0;
  const refundDelta = Math.max(0, normalizedRefundTarget - currentRefund);

  let externalUser = null;
  if (refundDelta > 0) {
    externalUser = await ExternalUser.findByIdAndUpdate(
      sessionData.externalRequestUserId,
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
  } else {
    externalUser = await ExternalUser.findByIdAndUpdate(
      sessionData.externalRequestUserId,
      {
        $set: {
          lastActivityAt: now,
        },
      },
      { new: true },
    );
  }

  const branchedSession = isBranchedVideoSession(sessionData);
  const resolvedResultUrl = status === 'COMPLETED'
    ? normalizeExternalString(resolveSessionResultUrl(sessionData)) || requestRecord.resultUrl || null
    : branchedSession
      ? null
      : requestRecord.resultUrl || null;
  const resolvedErrorMessage = status === 'FAILED' || status === 'CANCELLED'
    ? normalizeExternalString(errorMessage) || requestRecord.errorMessage || 'Video generation failed'
    : null;
  const branchDeliveryFields = suppliedBranchDeliveryFields || buildBranchDeliveryFields(
    sessionData,
    { apiServer: API_SERVER },
  );
  const responsePayload = buildExternalSettlementResponsePayload({
    previousResponsePayload: requestRecord.responsePayload,
    status,
    resolvedResultUrl,
    resolvedErrorMessage,
    branchDeliveryFields,
    branchedSession,
  });

  return ExternalUserRequest.findByIdAndUpdate(
    requestRecord._id,
    {
      $set: {
        status,
        resultUrl: resolvedResultUrl,
        creditsRefunded: Math.max(currentRefund, normalizedRefundTarget),
        remainingCreditsSnapshot:
          externalUser?.generationCredits === undefined || externalUser?.generationCredits === null
            ? requestRecord.remainingCreditsSnapshot ?? null
            : Number(externalUser.generationCredits),
        errorMessage: resolvedErrorMessage,
        responsePayload,
      },
    },
    { new: true },
  );
}

export async function processSessionCompletionSuccess(sessionId) {


  await getDBConnectionString();

  const sessionData = await VideoSession.findOne({ _id: sessionId });
  if (!sessionData) {
    return { ok: false, reason: 'SESSION_NOT_FOUND' };
  }
  const branchDeliveryFields = buildBranchDeliveryFields(
    sessionData,
    { apiServer: API_SERVER },
  );
  if (isBranchedVideoSession(sessionData) && !isCompleteBranchDelivery(branchDeliveryFields)) {
    return { ok: false, deferred: true, reason: 'BRANCH_OUTPUTS_NOT_READY' };
  }

  const existingReceipt = sessionData.sessionReceipt || {};
  const stageCharges = sessionData.expressGenerationCreditCharges || {};
  const totalCharged = Number(stageCharges.totalCharged) || 0;
  const finalizedAt = new Date();

  await VideoSession.findByIdAndUpdate(sessionId, {
    $set: {
      provisionalCredits: 0,
      sessionReceipt: {
        ...existingReceipt,
        stageBilling: true,
        status: 'COMPLETED',
        finalChargedCredits: totalCharged,
        totalCharged,
        refunded: Number(existingReceipt.refunded) || 0,
        expressGenerationCreditCharges: stageCharges,
        finalizedAt,
      },
    },
  });

  await syncExternalRequestSettlement({
    sessionData,
    sessionId,
    status: 'COMPLETED',
    creditsRefunded: 0,
    branchDeliveryFields,
  });

  if (sessionData.externalWebhook) {
    // send POST request to externalWebhook

    const externalWebhookUrl = sessionData.externalWebhook;
    const videoURL = resolveSessionResultUrl(sessionData);
    const requestIdentity = buildExternalRequestIdentityFields(sessionData, sessionId);

    const webhookPayload = {
      ...requestIdentity,
      status: 'COMPLETED',
      result_url: videoURL,
      ...(branchDeliveryFields || {}),
      video: {
        url: videoURL,
        ...requestIdentity,
      }
    }


    await deliverExternalWebhook(externalWebhookUrl, webhookPayload, sessionId);


  }

  return { ok: true };

}

export async function processSessionCompletionFailure(sessionId) {


  await getDBConnectionString();

  const sessionData = await VideoSession.findOne({ _id: sessionId });
  if (!sessionData) {
    return;
  }

  const existingReceipt = sessionData.sessionReceipt || {};
  const stageCharges = sessionData.expressGenerationCreditCharges || {};
  const totalCharged = Number(stageCharges.totalCharged) || 0;
  const failedAt = new Date();

  await VideoSession.findByIdAndUpdate(sessionId, {
    $set: {
      provisionalCredits: 0,
      sessionReceipt: {
        ...existingReceipt,
        stageBilling: true,
        status: 'FAILED',
        finalChargedCredits: totalCharged,
        totalCharged,
        refunded: Number(existingReceipt.refunded) || 0,
        expressGenerationCreditCharges: stageCharges,
        failedAt,
      },
    },
  });

  await syncExternalRequestSettlement({
    sessionData,
    sessionId,
    status: 'FAILED',
    creditsRefunded: 0,
    errorMessage: sessionData.expressGenerationError || 'Video generation failed',
  });

  if (sessionData.externalWebhook) {
    // send POST request to externalWebhook

    const externalWebhookUrl = sessionData.externalWebhook;
    const errorMessage = sessionData.expressGenerationError || 'Video generation failed';
    const branchDeliveryFields = buildBranchDeliveryFields(
      sessionData,
      { apiServer: API_SERVER },
    );
    const failureBranchDeliveryFields = normalizeBranchDeliveryFieldsForTerminalStatus(
      branchDeliveryFields,
      'FAILED',
    );
    const requestIdentity = buildExternalRequestIdentityFields(sessionData, sessionId);
    const webhookPayload = {
      ...requestIdentity,
      status: 'FAILED',
      ...(failureBranchDeliveryFields || {}),
      video: {
        url: null,
        ...requestIdentity,
      },
      error: {
        message: errorMessage,
      }
    };

    await deliverExternalWebhook(externalWebhookUrl, webhookPayload, sessionId);



  }
}

async function deliverExternalWebhook(externalWebhookUrl, webhookPayload, sessionId) {
  try {
    await axios.post(externalWebhookUrl, webhookPayload);
  } catch (error) {
    console.error('[external_webhook] delivery failed', {
      sessionId,
      externalWebhookUrl,
      status: error?.response?.status,
      response: error?.response?.data,
      message: error?.message || String(error),
    });
  }
}
