import { getDBConnectionString } from "./DBString.js";
import axios from 'axios';
import ExternalUser from "./schema/ExternalUser.js";
import ExternalUserRequest from "./schema/ExternalUserRequest.js";
import VideoSession from "./schema/VideoSession.js";

const API_SERVER = process.env.API_SERVER;

function normalizeExternalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function resolveSessionResultUrl(sessionData) {
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

  const resolvedResultUrl = status === 'COMPLETED'
    ? normalizeExternalString(resolveSessionResultUrl(sessionData)) || requestRecord.resultUrl || null
    : requestRecord.resultUrl || null;
  const resolvedErrorMessage = status === 'FAILED' || status === 'CANCELLED'
    ? normalizeExternalString(errorMessage) || requestRecord.errorMessage || 'Video generation failed'
    : null;

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
        responsePayload: {
          ...(requestRecord.responsePayload || {}),
          status,
          ...(resolvedResultUrl ? { result_url: resolvedResultUrl } : {}),
          ...(resolvedErrorMessage ? { message: resolvedErrorMessage } : {}),
        },
      },
    },
    { new: true },
  );
}

export async function processSessionCompletionSuccess(sessionId) {


  await getDBConnectionString();

  const sessionData = await VideoSession.findOne({ _id: sessionId });
  if (!sessionData) {
    return;
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
  });

  if (sessionData.externalWebhook) {
    // send POST request to externalWebhook

    const externalWebhookUrl = sessionData.externalWebhook;
    const videoURL = resolveSessionResultUrl(sessionData);

    const webhookPayload = {
      request_id: sessionId,
      session_id: sessionId,
      status: 'COMPLETED',
      result_url: videoURL,
      video: {
        url: videoURL,
        request_id: sessionId,
        session_id: sessionId,
      }
    }


    await deliverExternalWebhook(externalWebhookUrl, webhookPayload, sessionId);


  }

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
    const webhookPayload = {
      request_id: sessionId,
      session_id: sessionId,
      status: 'FAILED',
      video: {
        url: null,
        request_id: sessionId,
        session_id: sessionId,
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
