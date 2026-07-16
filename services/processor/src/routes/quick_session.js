
import express from 'express';
import {
  createQuickSession, getQuickSessionGenerationStatus,
  getQuickSessionDetails, setSessionQuickGenerationPending, setQuickGenerationTheme,
  updateQuickGenerationTheme, updatePrimaryJsonTheme, updateDerivedJsonTheme,
  setQuickGenerationPaused,

} from '../models/QuickSession.js';
import { verifyUserAuth } from '../models/Auth.js';
import { markNarrativeModerationFailure } from '../models/moderation/ModerationFailureState.js';

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
   await setSessionQuickGenerationPending(userId, payload);

    void createQuickSession(userId, payload).catch(async (error) => {
      console.error(`Quick session generation failed for session ${payload?.sessionId || 'unknown'}`, error);
      if (error?.message === 'Content moderation failed') {
        try {
          await markNarrativeModerationFailure(payload?.sessionId, {
            message: error.message,
          });
        } catch (markError) {
          console.error(`Failed to mark quick session ${payload?.sessionId || 'unknown'} as failed`, markError);
        }
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
