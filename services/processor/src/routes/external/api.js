import express from 'express';

import audioApiRouter from '../api/audio.js';
import imageApiRouter from '../api/image.js';
import videoApiRouter from '../api/video.js';
import { resolveRequestActorFromAuthHeaders } from '../../models/external/User.js';
import {
  DEPLOYMENT_PROVIDER_CAPABILITIES,
  validateDeploymentProviderCredentials,
  validateSamsarApiKeyHeaders,
} from '../../models/api/DeploymentProviderAPI.js';
import {
  createExternalChatCompletion,
  createExternalChatCompletionRequest,
  getExternalChatCompletionRequest,
  getExternalChatTimeoutMs,
  isExternalChatPollingRequested,
} from '../../models/api/ExternalChatAPI.js';
import { createExternalEmbeddingVectors } from '../../models/api/ExternalEmbeddingAPI.js';
import {
  createExternalModeration,
  getExternalModerationTimeoutMs,
  mapExternalModerationError,
} from '../../models/api/ExternalModerationAPI.js';

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
    next();
  } catch (error) {
    if (error?.code === 'API_KEY_EXPIRED' || error?.code === 'APP_KEY_EXPIRED') {
      return res.status(401).json({
        message: error.message,
      });
    }
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while validating API key.',
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

router.get('/providers/capabilities', (req, res) => {
  res.status(200).json({
    providers: DEPLOYMENT_PROVIDER_CAPABILITIES,
  });
});

router.post('/providers/validate', async (req, res) => {
  try {
    const result = await validateDeploymentProviderCredentials(req.body || {});
    res.status(200).json(result);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || 500;
    res.status(statusCode).json({
      message: error?.message || 'Internal server error while validating provider credentials.',
    });
  }
});

router.get('/api_key/validate', async (req, res) => {
  try {
    const result = await validateSamsarApiKeyHeaders(req.headers);
    res.status(200).json(result);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || 401;
    res.status(statusCode).json({
      valid: false,
      message: error?.message || 'Invalid Samsar API key.',
    });
  }
});

async function handleExternalChatCompletion(req, res) {
  try {
    if (isExternalChatPollingRequested(req.body || {})) {
      const request = await createExternalChatCompletionRequest({
        userId: req.userId,
        payload: req.body || {},
      });
      return res.status(202).json(request);
    }

    const timeoutMs = getExternalChatTimeoutMs(req.body || {});
    req.setTimeout(timeoutMs + 30000);
    res.setTimeout(timeoutMs + 30000);
    const result = await createExternalChatCompletion({
      userId: req.userId,
      payload: req.body || {},
    });
    setCreditHeaders(res, result.creditsCharged, result.remainingCredits);
    res.status(200).json(result.response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: 'Insufficient credits or no credits remaining.',
      });
    }
    const statusCode = error?.statusCode || error?.status || error?.response?.status || 500;
    res.status(statusCode).json({
      message: error?.message || 'Internal server error while creating external chat completion.',
    });
  }
}

router.post('/chat', validateAPIKeyAndUserId, handleExternalChatCompletion);
router.post('/chat/completions', validateAPIKeyAndUserId, handleExternalChatCompletion);
router.post('/assistant', validateAPIKeyAndUserId, handleExternalChatCompletion);
router.post('/assistant/completions', validateAPIKeyAndUserId, handleExternalChatCompletion);

async function handleExternalChatCompletionStatus(req, res) {
  try {
    const requestId =
      req.query.request_id ||
      req.query.requestId ||
      req.query.id;
    const clientRequestId =
      req.query.client_request_id ||
      req.query.clientRequestId;
    const result = await getExternalChatCompletionRequest({
      userId: req.userId,
      requestId,
      clientRequestId,
    });
    setCreditHeaders(res, result.creditsCharged, result.remainingCredits);
    return res.status(200).json(result);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || 500;
    return res.status(statusCode).json({
      message: error?.message || 'Internal server error while reading external assistant status.',
    });
  }
}

router.get(
  ['/chat/status', '/chat/completions/status', '/assistant/status'],
  validateAPIKeyAndUserId,
  handleExternalChatCompletionStatus,
);

async function handleExternalEmbeddings(req, res) {
  try {
    const result = await createExternalEmbeddingVectors({
      userId: req.userId,
      payload: req.body || {},
    });
    setCreditHeaders(res, result.creditsCharged, result.remainingCredits);
    return res.status(200).json(result.response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: 'Insufficient credits or no credits remaining.',
      });
    }
    const statusCode = error?.statusCode || error?.status || error?.response?.status || 500;
    return res.status(statusCode).json({
      message: error?.message || 'Internal server error while creating external embeddings.',
    });
  }
}

router.post('/embeddings', validateAPIKeyAndUserId, handleExternalEmbeddings);

async function handleExternalModeration(req, res) {
  try {
    const timeoutMs = getExternalModerationTimeoutMs();
    req.setTimeout(timeoutMs + 5000);
    res.setTimeout(timeoutMs + 5000);
    const result = await createExternalModeration({
      userId: req.userId,
      payload: req.body || {},
      timeoutMs,
    });
    return res.status(200).json(result.response);
  } catch (error) {
    const mappedError = mapExternalModerationError(error);
    return res.status(mappedError.statusCode).json({
      message: mappedError.message,
    });
  }
}

router.post(['/moderation', '/moderations'], validateAPIKeyAndUserId, handleExternalModeration);

router.use('/image', imageApiRouter);
router.use('/video', videoApiRouter);
router.use('/audio', audioApiRouter);

export default router;
