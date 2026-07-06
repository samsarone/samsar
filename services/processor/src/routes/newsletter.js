import express from 'express';
import { unsubscribeUserFromWeeklyNewsletter } from '../models/Newsletter.js';

const router = express.Router();

router.post('/unsubscribe', async (req, res) => {
  try {
    const result = await unsubscribeUserFromWeeklyNewsletter({
      token: req.body?.token || req.query?.token,
      reason: req.body?.reason,
      details: req.body?.details,
    });

    res.json(result);
  } catch (error) {
    res.status(error?.statusCode || 400).json({
      error: error?.message || 'Unable to unsubscribe from the newsletter.',
    });
  }
});

export default router;
