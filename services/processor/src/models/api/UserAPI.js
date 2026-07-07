import User from '../../schema/User.js';
import { getDBConnectionString } from '../DBString.js';
import { ensureDefaultTextModelsForUser, verifyUserToken } from '../User.js';
import { getTeamAuthClaimsForUser } from '../Team.js';
import {
  generateAuthToken,
  generateLoginToken,
  getLoginTokenTtlSeconds,
  verifyLoginToken,
} from '../Auth.js';
import {
  createExternalAuthTokenForUser,
  resolveExternalUserFromAuthToken,
} from '../external/User.js';

export function createLoginTokenForUser(userId) {
  if (!userId) {
    throw new Error('User ID is required to create a login token');
  }

  const loginToken = generateLoginToken(userId);
  const expiresInSeconds = getLoginTokenTtlSeconds();
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  return {
    loginToken,
    expiresInSeconds,
    expiresAt,
  };
}

export async function authenticateWithLoginToken(loginToken) {
  if (!loginToken || typeof loginToken !== 'string') {
    throw new Error('loginToken is required');
  }

  const decoded = verifyLoginToken(loginToken.trim());
  const userId = decoded?._id;
  if (!userId) {
    throw new Error('Invalid login token');
  }

  await getDBConnectionString();

  if (decoded?.type === 'external_login') {
    const externalUser = await resolveExternalUserFromAuthToken(
      createExternalAuthTokenForUser({
        _id: decoded.externalUserId,
        internalUserId: userId,
        externalIdentityKey: decoded.externalIdentityKey || null,
      }),
    );

    if (!externalUser) {
      throw new Error('External user not found');
    }

    const authToken = createExternalAuthTokenForUser(externalUser);

    return {
      user: externalUser,
      authToken,
      actorType: 'external',
      externalUser,
    };
  }

  const user = await User.findById(userId);

  if (!user) {
    throw new Error('User not found');
  }

  await ensureDefaultTextModelsForUser(user);
  const authToken = generateAuthToken(userId.toString(), getTeamAuthClaimsForUser(user));

  return {
    user,
    authToken,
    actorType: 'user',
    externalUser: null,
  };
}

export async function authenticateWithAuthToken(authToken) {
  if (!authToken || typeof authToken !== 'string') {
    throw new Error('authToken is required');
  }

  const externalUser = await resolveExternalUserFromAuthToken(authToken.trim());
  if (externalUser) {
    return {
      user: externalUser,
      authToken: authToken.trim(),
      actorType: 'external',
      externalUser,
    };
  }

  const user = await verifyUserToken({ authToken: authToken.trim() });
  if (!user) {
    throw new Error('User not found');
  }

  return {
    user,
    authToken: authToken.trim(),
    actorType: 'user',
    externalUser: null,
  };
}
