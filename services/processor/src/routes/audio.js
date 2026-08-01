
import express from 'express';
import { createGenerateAudioRequest, getAudioGenerationStatus , getUserMusicLibrary, getLayeredAudioGenerationStatus } from '../models/audio/Audio.js';
import {
  addAudioTrackToSession,
  addAudioTrackListToSession,
  assertVideoSessionEditableAccess,
  logSharedSessionEditOperation,
} from '../models/VideoSession.js';
import { verifyUserAuth } from '../models/Auth.js';
import {
  getAudioStudioJoinStatus,
  getAudioStudioLibraryPage,
  getStudioAudioGenerationStatus,
  requestAudioStudioJoin,
  requestStudioAudioGeneration,
} from '../models/audio/AudioStudio.js';
import 'dotenv/config';

const router = express.Router();

function requireAuthenticatedUser(req, res) {
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return null;
  }
  return userId;
}

router.post('/studio/generate', async function(req, res) {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  try {
    const response = await requestStudioAudioGeneration(userId, req.body || {});
    res.status(202).json(response);
  } catch (error) {
    res.status(error?.statusCode || error?.status || 400).json({
      error: error?.message || 'Unable to request audio generation.',
      code: error?.code,
    });
  }
});

router.get('/studio/status', async function(req, res) {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  try {
    const response = await getStudioAudioGenerationStatus(
      userId,
      req.query.requestId || req.query.request_id
    );
    res.json(response);
  } catch (error) {
    res.status(error?.statusCode || error?.status || 400).json({
      error: error?.message || 'Unable to fetch audio generation status.',
      code: error?.code,
    });
  }
});

router.get('/studio/library', async function(req, res) {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  try {
    const response = await getAudioStudioLibraryPage(userId, req.query || {});
    res.json(response);
  } catch (error) {
    res.status(error?.statusCode || error?.status || 400).json({
      error: error?.message || 'Unable to fetch the Audio Studio library.',
      code: error?.code,
    });
  }
});

router.post('/join', async function(req, res) {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  try {
    const response = await requestAudioStudioJoin(userId, req.body || {});
    res.status(202).json(response);
  } catch (error) {
    console.error('Error joining Audio Studio items:', error);
    res.status(error?.statusCode || error?.status || 400).json({
      error: error?.message || 'Unable to join the selected audio items.',
      code: error?.code,
    });
  }
});

router.get('/join/status', async function(req, res) {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  try {
    const response = await getAudioStudioJoinStatus(
      userId,
      req.query.requestId || req.query.request_id
    );
    res.json(response);
  } catch (error) {
    res.status(error?.statusCode || error?.status || 400).json({
      error: error?.message || 'Unable to fetch the audio join status.',
      code: error?.code,
    });
  }
});


router.post('/request_generate_audio', async function(req, res) {
  const payload = req.body;
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
    await assertVideoSessionEditableAccess(userId, payload);
    const response = await createGenerateAudioRequest(userId, payload);
    await logSharedSessionEditOperation(userId, payload, {
      operation: 'request_generate_audio',
      category: 'generation',
      route: '/audio/request_generate_audio',
    });
    res.json(response);
  } catch (error) {
    res.status(error?.status || 400).send({ error: error?.message || 'Unable to request audio generation.' });
  }
});



router.get('/generate_status', async function(req, res) {
  const sessionId = req.query.sessionId
  try {
  const audioGenerationResponse = await getAudioGenerationStatus(sessionId);
  res.send(audioGenerationResponse);
  } catch (e) {
    console.error(e);
    res.status(500).send({ error: e });
  }
});

router.get('/layered_speech_generate_status', async function(req, res) {
  const { sessionId, numLayers } = req.query;

  try {

    let numLayersInt = parseInt(numLayers);
    if (isNaN(numLayersInt)) {
      res.status(400).send({ error: 'Invalid numLayers' });
      return;
    }
    const audioGenerationResponse = await getLayeredAudioGenerationStatus(sessionId, numLayersInt);

    res.send(audioGenerationResponse);
  }
  catch (e) {
    console.error(e);
    res.status(500).send({ error: e });
  }

});


router.post('/add_track_to_project', async function(req, res) {
  const payload = req.body;
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }

  
  try {
  await assertVideoSessionEditableAccess(userId, payload);
  const response = await addAudioTrackToSession(payload);
  await logSharedSessionEditOperation(userId, payload, {
    operation: 'add_track_to_project',
    category: 'update',
    route: '/audio/add_track_to_project',
  });
  res.json(response);
  } catch (e) {
    res.status(500).send({ error: e });
  }
});

router.post('/add_track_list_to_project', async function(req, res) {
  const payload = req.body;
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }
  try {
  await assertVideoSessionEditableAccess(userId, payload);
  const response = await addAudioTrackListToSession(payload);
  await logSharedSessionEditOperation(userId, payload, {
    operation: 'add_track_list_to_project',
    category: 'update',
    route: '/audio/add_track_list_to_project',
  });

  
  res.json(response);
  } catch (e) {
    res.status(500).send({ error: e });
  }
});


router.get('/user_music_library', async function(req, res) {

  const userId = verifyUserAuth(req.headers);

  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }

  const query = req.query;

  try {
    const data = await getUserMusicLibrary(userId, query);
    res.json(data);
  } catch (error) {
    console.error('Error getting user music library:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
})
// You can add more session-related routes here

export default router;
