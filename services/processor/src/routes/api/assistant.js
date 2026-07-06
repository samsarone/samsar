import express from 'express';
import { resolveRequestActorFromAuthHeaders } from '../../models/external/User.js';
import {
  createAssistantCompletion,
  setAssistantSystemPromptForUser,
} from '../../models/api/AssistantAPI.js';
import { getBillingPortalUrl } from '../../models/BillingPortal.js';

const router = express.Router();
const BILLING_PORTAL_URL = getBillingPortalUrl();
const PURCHASE_CREDITS_ENDPOINT = '/v1/credits/recharge';
const INSUFFICIENT_CREDITS_MESSAGE =
  `Insufficient credits or no credits remaining. Please call ${PURCHASE_CREDITS_ENDPOINT} ` +
  `or visit ${BILLING_PORTAL_URL} to purchase credits with a one-time top-up. ` +
  `If auto-recharge is enabled, update the threshold via /v1/auto_recharge/threshold or the billing page.`;

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'assistant-api',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

async function validateAPIKeyAndUserId(req, res, next) {
  try {
    const authContext = await resolveRequestActorFromAuthHeaders(req.headers);
    if (!['api_key', 'auth_token', 'app_key'].includes(authContext.authType)) {
      return res.status(403).json({
        message: 'Use a Samsar API key, user auth token, or APP_KEY for this route.',
      });
    }

    req.userId = authContext.internalUserId;
    req.authType = authContext.authType;
    next();
  } catch (error) {
    if (error?.code === 'API_KEY_EXPIRED' || error?.code === 'APP_KEY_EXPIRED') {
      return res.status(401).json({
        message: error.message,
      });
    }
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while validating API_KEY, auth token, or APP_KEY.',
    });
  }
}

function setCreditHeaders(res, creditsCharged, remainingCredits) {
  if (creditsCharged !== undefined && creditsCharged !== null) {
    res.set('x-credits-charged', creditsCharged.toString());
  }
  if (remainingCredits !== undefined && remainingCredits !== null) {
    res.set('x-credits-remaining', remainingCredits.toString());
  }
}

router.post('/set_system_prompt', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const response = await setAssistantSystemPromptForUser(req.userId, req.body || {});
    res.status(200).json(response);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || 500;
    res.status(statusCode).json({
      message: error?.message || 'Internal server error while updating assistant system prompt.',
    });
  }
});

router.post('/completion', validateAPIKeyAndUserId, async (req, res) => {
  try {
    const result = await createAssistantCompletion(req.userId, req.body || {});
    setCreditHeaders(res, result.creditsCharged, result.remainingCredits);
    res.status(200).json(result.openaiResponse);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: INSUFFICIENT_CREDITS_MESSAGE,
      });
    }

    const statusCode = error?.statusCode || error?.status || error?.response?.status || 500;
    res.status(statusCode).json({
      message: error?.message || 'Internal server error while creating assistant completion.',
    });
  }
});

export default router;
