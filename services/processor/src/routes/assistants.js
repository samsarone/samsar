import { openAssistantWorkspace } from '../models/AssistantWorkspace.js';
import { serveAssistantSnapshots } from '../utils/ServerSentEvents.js';

import express from 'express';
import {
  createAssistantQueryRequest,
  deleteAssistantSessionMessage,
  getAssistantQueryGenerationStatus,
  getAssistantStreamSnapshot,
  resetAssistantSessionMessages,
} from '../models/Assistant.js';
import {
  applySceneActionToSessionLayer,
  listSceneActions,
} from '../models/SceneActions.js';
import { logSharedSessionEditOperation } from '../models/VideoSession.js';

import { verifyUserAuth } from '../models/Auth.js';
import 'dotenv/config';

const router = express.Router();


router.post('/workspace', async (req, res) => {
  const userId = verifyUserAuth(req.headers);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try { res.json(await openAssistantWorkspace(userId, req.body)); }
  catch (error) { res.status(error.status || 500).json({ error: error.message }); }
});

router.post('/submit_assistant_query', async function(req, res) {
  const payload = { ...req.body, client_request_id: req.body?.client_request_id || req.get('Idempotency-Key') };
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    const response = await createAssistantQueryRequest(userId, payload);
    if (!payload.workspace) await logSharedSessionEditOperation(userId, payload, {
      operation: 'submit_assistant_query',
      category: 'generation',
      route: '/assistants/submit_assistant_query',
    });
    res.json(response);
  } catch (error) {
    if (error?.code === 'INSUFFICIENT_CREDITS') {
      res.status(402).send({ error: error.message });
      return;
    }
    res.status(error?.statusCode || error?.status || 500).send({ error: error.message || 'Internal Server Error' });
  }
});



router.get('/assistant_query_status', async function(req, res) {
  try {
    if (req.query.include_messages === 'true') {
      const userId = verifyUserAuth(req.headers);
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const snapshot = await getAssistantStreamSnapshot(userId, req.query);
      return res.json({ status: snapshot.sessionMessageGenerationPending ? 'PENDING' : 'COMPLETED', sessionDetails: snapshot });
    }
    // Preserve the existing REST response for callers that do not opt in.
    res.send(await getAssistantQueryGenerationStatus(req.query.id));
  } catch (error) {
    res.status(error.status || error.statusCode || 500).send({ error: error.message });
  }
});

router.get('/assistant_query_stream', async (req, res) => {
  const userId = verifyUserAuth(req.headers);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await serveAssistantSnapshots(res, () => getAssistantStreamSnapshot(userId, req.query));
  } catch (error) {
    if (!res.headersSent) res.status(error.status || error.statusCode || 500).json({ error: error.message });
  }
});

router.get('/scene_actions', async function(req, res) {
  try {
    res.json(await listSceneActions());
  } catch (error) {
    res.status(500).send({ error: error.message || 'Internal Server Error' });
  }
});

router.post('/apply_scene_action', async function(req, res) {
  const payload = req.body;
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }

  try {
    const response = await applySceneActionToSessionLayer(userId, payload);
    if (!payload.workspace) await logSharedSessionEditOperation(userId, payload, {
      operation: 'apply_scene_action',
      category: 'update',
      route: '/assistants/apply_scene_action',
    });
    res.json(response);
  } catch (error) {
    res.status(400).send({ error: error.message || 'Error applying scene action' });
  }
});

router.post('/delete_session_message', async function(req, res) {
  const payload = req.body;
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }

  try {
    const response = await deleteAssistantSessionMessage(userId, payload);
    if (!payload.workspace) await logSharedSessionEditOperation(userId, payload, {
      operation: 'delete_assistant_session_message',
      category: 'update',
      route: '/assistants/delete_session_message',
    });
    res.json(response);
  } catch (error) {
    res.status(error?.statusCode || error?.status || (error?.message === 'Unauthorized' ? 403 : 500)).send({
      error: error?.message || 'Internal Server Error',
    });
  }
});

router.post('/reset_session_messages', async function(req, res) {
  const payload = req.body;
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }

  try {
    const response = await resetAssistantSessionMessages(userId, payload);
    if (!payload.workspace) await logSharedSessionEditOperation(userId, payload, {
      operation: 'reset_assistant_session_messages',
      category: 'update',
      route: '/assistants/reset_session_messages',
    });
    res.json(response);
  } catch (error) {
    res.status(error?.statusCode || error?.status || (error?.message === 'Unauthorized' ? 403 : 500)).send({
      error: error?.message || 'Internal Server Error',
    });
  }
});



// You can add more session-related routes here

export default router;
