import { randomBytes } from 'crypto';

import express from 'express';

import { ensureBotUser } from '../../models/BotUser.js';
import { generateAuthToken } from '../../models/Auth.js';
import { getDBConnectionString } from '../../models/DBString.js';
import User from '../../schema/User.js';
import { requestHasValidRuntimeSecret } from '../../utils/RuntimeSecretRequestAuth.js';

const router = express.Router();

const AUTH_KEY_BYTE_LENGTH = 32;

const generateAuthenticationKey = () => randomBytes(AUTH_KEY_BYTE_LENGTH).toString('hex');

const ensureAuthenticationKey = async (user) => {
  if (
    typeof user.authenticationKey === 'string' &&
    user.authenticationKey.trim().length > 0
  ) {
    return user.authenticationKey.trim();
  }

  const authenticationKey = generateAuthenticationKey();
  await User.updateOne(
    { _id: user._id },
    { $set: { authenticationKey } }
  ).exec();

  return authenticationKey;
};

router.post('/users', async (req, res) => {
  try {
    if (!requestHasValidRuntimeSecret(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { username, displayName } = req.body ?? {};
    if (typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ error: 'Username is required.' });
    }

    const result = await ensureBotUser(username, displayName);

    res.status(result.wasCreated ? 201 : 200).json({
      id: result.id,
      username: result.username,
      displayName: result.displayName,
      authToken: result.authToken,
      authenticationKey: result.authenticationKey,
      wasCreated: result.wasCreated,
    });
  } catch (error) {
    console.error('Failed to provision bot user:', error);
    res.status(500).json({ error: 'Failed to provision bot user.' });
  }
});

router.get('/users', async (req, res) => {
  try {
    if (!process.env.BOT_USER_AUTH_SECRET) {
      return res.status(500).json({ error: 'Bot authentication is not configured.' });
    }

    if (!requestHasValidRuntimeSecret(req, {
        environmentName: 'BOT_USER_AUTH_SECRET',
        headerName: 'x-bot-auth-secret',
        queryName: 'botSecret',
    })) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await getDBConnectionString();

    const limitRaw = Array.isArray(req.query.limit) ? req.query.limit[0] : req.query.limit;
    let limit = Number.parseInt(limitRaw ?? '', 10);
    if (!Number.isFinite(limit) || limit <= 0) {
      limit = 50;
    }
    limit = Math.min(limit, 200);

    const bots = await User.find({ isBotUser: true })
      .select({ username: 1, displayName: 1, authenticationKey: 1 })
      .limit(limit)
      .lean()
      .exec();

    const items = [];
    for (const bot of bots) {
      if (!bot?._id) {
        continue;
      }
      const authenticationKey = await ensureAuthenticationKey(bot);

      items.push({
        id: bot._id.toString(),
        username:
          typeof bot.username === 'string' && bot.username.trim().length > 0
            ? bot.username.trim()
            : '',
        displayName:
          typeof bot.displayName === 'string' && bot.displayName.trim().length > 0
            ? bot.displayName.trim()
            : '',
        authenticationKey,
      });
    }

    res.json({ items });
  } catch (error) {
    console.error('Failed to list bot users:', error);
    res.status(500).json({ error: 'Failed to load bot users.' });
  }
});

router.post('/authenticate', async (req, res) => {
  try {
    if (!process.env.BOT_USER_AUTH_SECRET) {
      return res.status(500).json({ error: 'Bot authentication is not configured.' });
    }

    if (!requestHasValidRuntimeSecret(req, {
        environmentName: 'BOT_USER_AUTH_SECRET',
        headerName: 'x-bot-auth-secret',
        queryName: 'botSecret',
    })) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { authenticationKey } = req.body ?? {};
    if (typeof authenticationKey !== 'string' || authenticationKey.trim().length === 0) {
      return res.status(400).json({ error: 'authenticationKey is required.' });
    }

    await getDBConnectionString();

    const normalizedKey = authenticationKey.trim();

    const user = await User.findOne({
      isBotUser: true,
      authenticationKey: normalizedKey,
    })
      .select({ username: 1, displayName: 1 })
      .lean()
      .exec();

    if (!user?._id) {
      return res.status(404).json({ error: 'Bot user not found.' });
    }

    const authToken = generateAuthToken(user._id.toString());

    res.json({
      id: user._id.toString(),
      username:
        typeof user.username === 'string' && user.username.trim().length > 0
          ? user.username.trim()
          : '',
      displayName:
        typeof user.displayName === 'string' && user.displayName.trim().length > 0
          ? user.displayName.trim()
          : user.username ?? '',
      authToken,
    });
  } catch (error) {
    console.error('Failed to authenticate bot user:', error);
    res.status(500).json({ error: 'Failed to authenticate bot user.' });
  }
});

export default router;
