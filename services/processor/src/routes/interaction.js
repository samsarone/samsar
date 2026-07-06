
import express from 'express';
import { createInteraction, getInteractionsForPost, getInteractionsForUser } from '../models/Interaction.js';

import 'dotenv/config';

const router = express.Router();


router.post('/create_interaction', async function(req, res) {
  const payload = req.body;
  const response = await createInteraction(payload);
  res.json(response);
});

router.get('/get_interactions', async function(req, res) {
  const publicationId = req.query.publicationId;
  const response = await getInteractionsForPost(publicationId);
  res.json(response);
})

router.get('/get_interactions_for_user', async function(req, res) {
  const userId = req.query.userId;
  const publicationId = req.query.publicationId;
  const response = await getInteractionsForUser(userId, publicationId);

  
  res.json(response);
});


// You can add more session-related routes here

export default router;
