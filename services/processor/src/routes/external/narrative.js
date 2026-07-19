import express from 'express';

import { createBranchingNarrativeRequest } from '../../models/api/BranchingNarrativeAPI.js';
import { createSingleNarrativeRequest } from '../../models/api/NarrativeAPI.js';
import { getNarrativeRequest } from '../../models/api/NarrativeStatusAPI.js';
import { resolveRequestActorFromAuthHeaders } from '../../models/external/User.js';

const router = express.Router();

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
    req.authContext = authContext;
    return next();
  } catch (error) {
    if (error?.code === 'API_KEY_EXPIRED' || error?.code === 'APP_KEY_EXPIRED') {
      return res.status(401).json({ message: error.message });
    }
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while validating API key.',
    });
  }
}

function setCreditHeaders(res, result) {
  const creditsCharged = result?.creditsCharged ?? result?.billing?.credits_charged;
  const remainingCredits = result?.remainingCredits ?? result?.billing?.remaining_credits;
  if (creditsCharged !== undefined && creditsCharged !== null) {
    res.set('x-credits-charged', creditsCharged.toString());
  }
  if (remainingCredits !== undefined && remainingCredits !== null) {
    res.set('x-credits-remaining', remainingCredits.toString());
  }
}

async function handleCreateSingleNarrative(req, res) {
  try {
    const result = await createSingleNarrativeRequest({
      userId: req.userId,
      payload: req.body || {},
      authContext: req.authContext,
    });
    return res.status(202).json(result);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: error?.message || 'Internal server error while creating narrative request.',
    });
  }
}

async function handleCreateBranchingNarrative(req, res) {
  try {
    const result = await createBranchingNarrativeRequest({
      userId: req.userId,
      payload: req.body || {},
      authContext: req.authContext,
    });
    return res.status(202).json(result);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: error?.message || 'Internal server error while creating branching narrative request.',
    });
  }
}

async function handleNarrativeStatus(req, res) {
  try {
    const result = await getNarrativeRequest({
      userId: req.userId,
      requestId:
        req.params?.request_id ||
        req.query?.request_id ||
        req.query?.requestId ||
        req.query?.id,
    });
    res.locals.statusEndpointStatus = result.status;
    setCreditHeaders(res, result);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || 500;
    return res.status(statusCode).json({
      message: error?.message || 'Internal server error while reading narrative status.',
    });
  }
}

router.post('/create_single', validateAPIKeyAndUserId, handleCreateSingleNarrative);
router.post('/create_branching', validateAPIKeyAndUserId, handleCreateBranchingNarrative);
router.get(
  [
    '/status',
    '/create_single/status',
    '/create_branching/status',
    '/:request_id/status',
    '/create_single/:request_id/status',
    '/create_branching/:request_id/status',
  ],
  validateAPIKeyAndUserId,
  handleNarrativeStatus,
);

export default router;
