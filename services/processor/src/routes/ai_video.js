
import express from 'express';
import { getUserAIVideoLibrary } from '../models/ai_video/index.js';
import { verifyUserAuth } from '../models/Auth.js';
import 'dotenv/config';

const router = express.Router();



router.get('/user_video_library', async function(req, res) {

  const userId = verifyUserAuth(req.headers);

  if (!userId) {
    res.status(401).send({ error: 'Unauthorized' });
    return;
  }

  const query = req.query;

  try {
    const data = await getUserAIVideoLibrary(userId, query);
    res.json(data);
  } catch (error) {
    console.error('Error getting user video library:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }


})
// You can add more session-related routes here

export default router;
