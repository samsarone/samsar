import { randomBytes } from 'crypto';

import { getDBConnectionString } from './DBString.js';
import { generateAuthToken } from './Auth.js';
import User from '../schema/User.js';

const MAX_ATTEMPTS = 3;
const USERNAME_MAX_LENGTH = 32;
const DISPLAY_NAME_MAX_LENGTH = 64;
const AUTH_KEY_BYTE_LENGTH = 32;

const slugify = (value) => {
  if (!value || typeof value !== 'string') {
    return 'samsar-bot';
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!normalized) {
    return 'samsar-bot';
  }

  return normalized.slice(0, USERNAME_MAX_LENGTH);
};

const withAttemptSuffix = (baseUsername, attempt) => {
  if (attempt === 0) {
    return baseUsername;
  }

  const suffix = `_${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;

  const maxBaseLength = Math.max(1, USERNAME_MAX_LENGTH - suffix.length);
  return `${baseUsername.slice(0, maxBaseLength)}${suffix}`;
};

const sanitizeDisplayName = (value, fallback) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed.slice(0, DISPLAY_NAME_MAX_LENGTH);
    }
  }

  return fallback;
};

const generateAuthenticationKey = () => randomBytes(AUTH_KEY_BYTE_LENGTH).toString('hex');

export async function ensureBotUser(username, displayName) {
  await getDBConnectionString();

  const baseUsername = slugify(username);
  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const candidateUsername = withAttemptSuffix(baseUsername, attempt);
    const candidateDisplayName = sanitizeDisplayName(displayName, candidateUsername);

    try {
      const existingUser = await User.findOne({ username: candidateUsername }).exec();

      if (existingUser) {
        if (!existingUser.isBotUser) {
          continue;
        }

        const updates = {};
        const safeDisplayName = sanitizeDisplayName(
          displayName,
          existingUser.displayName || candidateUsername
        );

        if (!existingUser.isAppUser) {
          updates.isAppUser = true;
        }

        if (!existingUser.isEmailVerified) {
          updates.isEmailVerified = true;
        }

        if (safeDisplayName && existingUser.displayName !== safeDisplayName) {
          updates.displayName = safeDisplayName;
        }

        let authenticationKey =
          typeof existingUser.authenticationKey === 'string' &&
          existingUser.authenticationKey.trim().length > 0
            ? existingUser.authenticationKey.trim()
            : null;

        if (!authenticationKey) {
          authenticationKey = generateAuthenticationKey();
          updates.authenticationKey = authenticationKey;
        }

        if (Object.keys(updates).length > 0) {
          await User.updateOne(
            { _id: existingUser._id },
            { $set: updates }
          ).exec();
        }

        const authToken = generateAuthToken(existingUser._id.toString());

        return {
          id: existingUser._id.toString(),
          username: existingUser.username ?? candidateUsername,
          displayName: safeDisplayName || existingUser.displayName || candidateUsername,
          authToken,
          authenticationKey,
          wasCreated: false,
        };
      }

      const authenticationKey = generateAuthenticationKey();
      const botUser = await User.create({
        username: candidateUsername,
        displayName: candidateDisplayName,
        isBotUser: true,
        isAppUser: true,
        isEmailVerified: true,
        userType: 'Free',
        authenticationKey,
      });

      const authToken = generateAuthToken(botUser._id.toString());

      return {
        id: botUser._id.toString(),
        username: botUser.username ?? candidateUsername,
        displayName: botUser.displayName ?? candidateDisplayName ?? candidateUsername,
        authToken,
        authenticationKey,
        wasCreated: true,
      };
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error('Unable to provision bot user.');
}
