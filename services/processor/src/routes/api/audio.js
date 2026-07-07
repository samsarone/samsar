import express from 'express';

import {
  AUDIO_ROUTE_TEXT_TO_MUSIC,
  AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT,
  AUDIO_ROUTE_TEXT_TO_SPEECH,
  createExternalAudioRequest,
  getExternalAudioStatus,
} from '../../models/api/ExternalAudioAPI.js';
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
    next();
  } catch (error) {
    if (error?.code === 'API_KEY_EXPIRED' || error?.code === 'APP_KEY_EXPIRED') {
      return res.status(401).json({ message: error.message });
    }
    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while validating API key.',
    });
  }
}

function setCreditHeaders(res, result = {}) {
  if (result.creditsCharged !== undefined && result.creditsCharged !== null) {
    res.set('x-credits-charged', result.creditsCharged.toString());
  }
  if (result.remainingCredits !== undefined && result.remainingCredits !== null) {
    res.set('x-credits-remaining', result.remainingCredits.toString());
  }
}

function getRequestPayload(req) {
  return req.body?.input ?? req.body ?? {};
}

async function handleCreateExternalAudio(req, res, route) {
  try {
    const result = await createExternalAudioRequest({
      userId: req.userId,
      route,
      payload: req.body || {},
    });
    setCreditHeaders(res, result);
    res.status(200).json(result);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(402).json({
        message: 'Insufficient credits or no credits remaining.',
      });
    }
    const statusCode = error?.statusCode || error?.status || error?.response?.status || 500;
    res.status(statusCode).json({
      message: error?.message || 'Internal server error while creating external audio request.',
    });
  }
}

async function handleStatus(req, res) {
  try {
    const payload = getRequestPayload(req);
    const requestId = req.query?.request_id ||
      req.query?.session_id ||
      payload.request_id ||
      payload.requestId ||
      payload.session_id ||
      payload.sessionId;
    const result = await getExternalAudioStatus({
      requestId: typeof requestId === 'string' ? requestId.trim() : requestId?.toString?.(),
      userId: req.userId,
    });
    res.status(200).json(result);
  } catch (error) {
    const statusCode = error?.statusCode || error?.status || error?.response?.status || 500;
    res.status(statusCode).json({
      message: error?.message || 'Internal server error while fetching external audio status.',
    });
  }
}

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'audio-api',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

router.get('/status', validateAPIKeyAndUserId, handleStatus);
router.post('/status', validateAPIKeyAndUserId, handleStatus);

router.post(
  ['/text_to_speech', '/speech', '/tts'],
  validateAPIKeyAndUserId,
  (req, res) => handleCreateExternalAudio(req, res, AUDIO_ROUTE_TEXT_TO_SPEECH),
);

router.post(
  ['/text_to_music', '/music'],
  validateAPIKeyAndUserId,
  (req, res) => handleCreateExternalAudio(req, res, AUDIO_ROUTE_TEXT_TO_MUSIC),
);

router.post(
  ['/text_to_sound_effect', '/sound_effect', '/sound'],
  validateAPIKeyAndUserId,
  (req, res) => handleCreateExternalAudio(req, res, AUDIO_ROUTE_TEXT_TO_SOUND_EFFECT),
);

export default router;
