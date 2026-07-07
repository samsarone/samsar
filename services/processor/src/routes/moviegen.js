import bodyParser from 'body-parser';
import 'dotenv/config';
import express from 'express';

import { verifyUserAuth,  } from '../models/Auth.js';

import { createMovieGenSession } from '../models/MovieGenerator.js';


const router = express.Router();



router.post('/create', async function(req, res) {
  const headers = req.headers;
  const payload = req.body;
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  
  const session = await createMovieGenSession(userId, payload);
  res.status(200).send(session);
});




export default router;
