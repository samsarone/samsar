
import express from 'express';
import { deleteAllRows } from '../models/Admin.js';
import { updateIntroSessionss } from '../models/IntroSession.js';
import { updateEpressGenerationStatus } from '../models/Admin.js';

import 'dotenv/config';

const router = express.Router();


router.get('/delete_all_rows', async function (req, res) {
  const sessionData = await deleteAllRows();
  res.json(sessionData);
});

router.post('/update_intro_sessions', async function(req, res) {
  const payload = req.body;
  const updatedIntroSessions = await updateIntroSessionss(payload);
  res.json(updatedIntroSessions);
});


router.post('/set_express_generation_status', async function(req, res) {
  const payload = req.body;
  const updatedStatus = await updateEpressGenerationStatus(payload);
  res.json(updatedStatus);
});

router.post('/veify_video_watermark', async function(_req, res) {
  res.status(501).json({ error: 'Video watermark verification is not implemented.' });
});



// You can add more session-related routes here

export default router;
