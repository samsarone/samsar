
import express from 'express';
import {
  createQuickSession, getQuickSessionGenerationStatus, markQuickPreparationFailed,
  getQuickSessionDetails, setSessionQuickGenerationPending, setQuickGenerationTheme,
  updateQuickGenerationTheme, updatePrimaryJsonTheme, updateDerivedJsonTheme,
  setQuickGenerationPaused,

} from '../models/QuickSession.js';
import { verifyUserAuth } from '../models/Auth.js';

const router = express.Router();


router.post('/create', async function (req, res) {
  const payload = req.body;
  const headers = req.headers;

  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }


  try {
    const renderRequestedAt = await setSessionQuickGenerationPending(userId, payload, { awaitingPreparation: true });

    void createQuickSession(userId, payload, renderRequestedAt).catch(async (error) => {
      console.error(`Quick session generation failed for session ${payload?.sessionId || 'unknown'}`, error);
      try {
        await markQuickPreparationFailed(userId, payload.sessionId, renderRequestedAt, error);
      } catch (markError) {
        console.error(`Failed to mark quick session ${payload.sessionId} as failed`, markError);
      }
    });
    res.json({});
  } catch (error) {
    res.status(500).json({ error: error.message });
  }


});

router.post('/pause', async function (req, res) {
  const payload = req.body;
  const headers = req.headers;

  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const quickGenResponse = await setQuickGenerationPaused(userId, payload);

    res.json(quickGenResponse);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }

});


router.get('/status', async function (req, res) {

  const sessionId = req.query.sessionId;
  const headers = req.headers;
  res.setHeader('Cache-Control', 'private, no-store');

  const generationStatusData = await getQuickSessionGenerationStatus(sessionId);

  if (generationStatusData.status === 'COMPLETED') {

    const userId = verifyUserAuth(headers);

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    res.json(generationStatusData);
  } else {
    res.json(generationStatusData);
  }
});


router.get('/details', async function (req, res) {
  const sessionId = req.query.sessionId;
  const headers = req.headers;

  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  res.setHeader('Cache-Control', 'private, no-store');
  const sessionData = await getQuickSessionDetails(sessionId);
  res.json(sessionData);


});

router.post('/set_base_theme', async function (req, res) {
  const payload = req.body;
  const headers = req.headers;

  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const quickGenResponse = await setQuickGenerationTheme(userId, payload);

    res.json(quickGenResponse);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/update_primary_json', async function (req, res) {
  const payload = req.body;
  const headers = req.headers;

  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const quickGenResponse = await updatePrimaryJsonTheme(userId, payload);

    res.json(quickGenResponse);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/update_derived_json', async function (req, res) {
  const payload = req.body;
  const headers = req.headers;

  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const quickGenResponse = await updateDerivedJsonTheme(userId, payload);

    res.json(quickGenResponse);

  }
  catch (error) {
    res.status(500).json({ error: error.message });
  }

});


router.post('/set_derived_theme', async function (req, res) {
  const payload = req.body;
  const headers = req.headers;

  const userId = verifyUserAuth(headers);

  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const quickGenResponse = await updateQuickGenerationTheme(userId, payload);

    res.json(quickGenResponse);

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// You can add more session-related routes here

export default router;
