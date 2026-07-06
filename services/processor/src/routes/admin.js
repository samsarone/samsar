
import express from 'express';
import { deleteAllRows } from '../models/Admin.js';
import { updateIntroSessionss } from '../models/IntroSession.js';
import { updateEpressGenerationStatus } from '../models/Admin.js';

import 'dotenv/config';

const router = express.Router();


router.get('/delete_all_rows', async function (req, res) {
  const secret = req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    res.status(401).send('Unauthorized');
    return;
  } else {
    const payload = req.body;
    const sessionData = await deleteAllRows();
    res.json(sessionData);
  }
});

router.post('/update_intro_sessions', async function(req, res) {
  const secret = req.query.secret;
  const payload = req.body;
  if (secret !== process.env.ADMIN_SECRET) {
    res.status(401).send('Unauthorized');
    return;
  } else {
    const updatedIntroSessions = await updateIntroSessionss(payload);
    res.json(updatedIntroSessions);
  }

});


router.post('/set_express_generation_status', async function(req, res) {
  const secret = req.query.secret;
  const payload = req.body;
  if (secret !== process.env.ADMIN_SECRET) {
    res.status(401).send('Unauthorized');
    return;
  } else {
    const updatedStatus = await updateEpressGenerationStatus(payload);
    res.json(updatedStatus);
  }

});

router.post('/veify_video_watermark', async function(req, res) {
  const secret = req.query.secret;
  const payload = req.body;

  consloe.log(payload);
  
});



// You can add more session-related routes here

export default router;
