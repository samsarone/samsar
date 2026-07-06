import express from 'express';

import {
  ensureAutomationBots,
  ensureAutomationSnapshot,
  incrementAutomationInteractions,
} from '../models/Automation.js';

const router = express.Router();

const extractSecret = (req) => {
  if (typeof req.query?.secret === 'string') {
    return req.query.secret;
  }
  if (typeof req.headers['x-internal-secret'] === 'string') {
    return req.headers['x-internal-secret'];
  }
  return null;
};

const parseCount = (raw) => {
  if (Array.isArray(raw)) {
    return parseCount(raw[0]);
  }
  const parsed = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
};

const pickRandomRecords = (records, count) => {
  if (!Array.isArray(records) || records.length === 0) {
    return [];
  }

  if (!Number.isFinite(count) || count <= 0 || count >= records.length) {
    return [...records];
  }

  const pool = [...records];
  const chosen = [];

  while (pool.length > 0 && chosen.length < count) {
    const index = Math.floor(Math.random() * pool.length);
    const [record] = pool.splice(index, 1);
    chosen.push(record);
  }

  return chosen;
};

router.post('/create_or_return_bots', async (req, res) => {
  try {
    const secret = extractSecret(req);
    if (!secret || secret !== process.env.INTERNAL_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const desiredCount = parseCount(req.query?.numBots ?? req.body?.numBots);
    if (desiredCount <= 0) {
      return res.status(400).json({ error: 'numBots must be a positive integer.' });
    }

    const allBots = await ensureAutomationBots(desiredCount);
    const selectedBots = pickRandomRecords(allBots, desiredCount);
    const snapshot = await ensureAutomationSnapshot(selectedBots);

    res.json({ items: snapshot });
  } catch (error) {
    console.error('Failed to create or return automation bots:', error);
    res.status(500).json({ error: 'Failed to create or return automation bots.' });
  }
});

router.post('/automation/interactions', async (req, res) => {
  try {
    const secret = extractSecret(req);
    if (!secret || secret !== process.env.INTERNAL_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const updatesRaw = req.body?.updates ?? req.body?.update ?? req.body;
    const updates = Array.isArray(updatesRaw) ? updatesRaw : [updatesRaw];

    const normalizedUpdates = updates
      .map((update) => {
        if (!update || typeof update !== 'object') {
          return null;
        }
        const id = update.id ?? update._id;
        const deltaRaw = update.delta ?? update.count ?? update.value ?? 1;
        const delta = Number.isFinite(deltaRaw) ? Math.floor(deltaRaw) : 0;
        if (!id || delta === 0) {
          return null;
        }
        return { id, delta };
      })
      .filter(Boolean);

    if (normalizedUpdates.length === 0) {
      return res.status(400).json({ error: 'No valid interaction updates provided.' });
    }

    const result = await incrementAutomationInteractions(normalizedUpdates);
    res.json(result);
  } catch (error) {
    console.error('Failed to update automation interactions:', error);
    res.status(500).json({ error: 'Failed to update automation interactions.' });
  }
});

export default router;
