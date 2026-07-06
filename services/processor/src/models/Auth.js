
import jwt from 'jsonwebtoken';

const DEFAULT_LOGIN_TOKEN_TTL_SECONDS = 10 * 60;
const DEFAULT_OAUTH_AUTH_TOKEN_TTL_SECONDS = 10 * 24 * 60 * 60;
const resolveLoginTokenTtlSeconds = () => {
  const secondsRaw = process.env.LOGIN_TOKEN_TTL_SECONDS;
  const minutesRaw = process.env.LOGIN_TOKEN_TTL_MINUTES;
  const raw = secondsRaw || minutesRaw;
  if (!raw) {
    return DEFAULT_LOGIN_TOKEN_TTL_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LOGIN_TOKEN_TTL_SECONDS;
  }

  if (minutesRaw && !secondsRaw) {
    return parsed * 60;
  }

  return parsed;
};

const LOGIN_TOKEN_TTL_SECONDS = resolveLoginTokenTtlSeconds();

const resolveOAuthAuthTokenTtlSeconds = () => {
  const raw =
    process.env.OAUTH_AUTH_TOKEN_TTL_SECONDS ||
    process.env.SAMSAR_OAUTH_AUTH_TOKEN_TTL_SECONDS;
  if (!raw) {
    return DEFAULT_OAUTH_AUTH_TOKEN_TTL_SECONDS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_OAUTH_AUTH_TOKEN_TTL_SECONDS;
  }

  return parsed;
};

const OAUTH_AUTH_TOKEN_TTL_SECONDS = resolveOAuthAuthTokenTtlSeconds();


export function generateAuthToken(userId) {
  const SECRET_KEY = process.env.TOKEN_SECRET;
  if (!SECRET_KEY || SECRET_KEY.trim().length === 0) {
    throw new Error('TOKEN_SECRET environment variable must be set to generate auth tokens');
  }
  const token = jwt.sign({ _id: userId },
    SECRET_KEY,
    { expiresIn: 60 * 60 * 24 * 30 });
  return token;
}

export function generateOAuthAuthToken(userId, claims = {}) {
  const SECRET_KEY = process.env.TOKEN_SECRET;
  if (!SECRET_KEY || SECRET_KEY.trim().length === 0) {
    throw new Error('TOKEN_SECRET environment variable must be set to generate auth tokens');
  }

  const expiresInSeconds = OAUTH_AUTH_TOKEN_TTL_SECONDS;
  const expiryDate = new Date(Date.now() + expiresInSeconds * 1000);
  const token = jwt.sign(
    {
      _id: userId,
      tokenUse: 'access',
      authFlow: 'v2_user_recharge',
      ...claims,
    },
    SECRET_KEY,
    { expiresIn: expiresInSeconds },
  );

  return {
    authToken: token,
    expiresInSeconds,
    expiryDate,
  };
}

export function verifyAuthToken(authToken) {
  const SECRET_KEY = process.env.TOKEN_SECRET;
  const decoded = jwt.verify(authToken, SECRET_KEY);
  if (decoded?.type) {
    const error = new Error('Non-standard tokens cannot be used as auth tokens');
    error.name = 'JsonWebTokenError';
    error.code = 'INVALID_AUTH_TOKEN';
    error.status = 401;
    throw error;
  }
  return decoded;

}

export function generateExternalAuthToken({ internalUserId, externalUserId, externalIdentityKey = null }) {
  const SECRET_KEY = process.env.TOKEN_SECRET;
  if (!SECRET_KEY || SECRET_KEY.trim().length === 0) {
    throw new Error('TOKEN_SECRET environment variable must be set to generate auth tokens');
  }

  return jwt.sign(
    {
      _id: internalUserId,
      type: 'external_auth',
      externalUserId,
      externalIdentityKey,
    },
    SECRET_KEY,
    { expiresIn: 60 * 60 * 24 * 30 },
  );
}

export function generateLoginToken(userId) {
  const SECRET_KEY = process.env.TOKEN_SECRET;
  if (!SECRET_KEY || SECRET_KEY.trim().length === 0) {
    throw new Error('TOKEN_SECRET environment variable must be set to generate login tokens');
  }
  const token = jwt.sign({ _id: userId, type: 'login' }, SECRET_KEY, {
    expiresIn: LOGIN_TOKEN_TTL_SECONDS,
  });
  return token;
}

export function generateExternalLoginToken({
  internalUserId,
  externalUserId,
  externalIdentityKey = null,
}) {
  const SECRET_KEY = process.env.TOKEN_SECRET;
  if (!SECRET_KEY || SECRET_KEY.trim().length === 0) {
    throw new Error('TOKEN_SECRET environment variable must be set to generate login tokens');
  }

  return jwt.sign(
    {
      _id: internalUserId,
      type: 'external_login',
      externalUserId,
      externalIdentityKey,
    },
    SECRET_KEY,
    {
      expiresIn: LOGIN_TOKEN_TTL_SECONDS,
    },
  );
}

export function verifyLoginToken(loginToken) {
  const SECRET_KEY = process.env.TOKEN_SECRET;
  const decoded = jwt.verify(loginToken, SECRET_KEY);
  if (!decoded || (decoded.type !== 'login' && decoded.type !== 'external_login')) {
    throw new Error('Invalid login token');
  }
  return decoded;
}

export function getLoginTokenTtlSeconds() {
  return LOGIN_TOKEN_TTL_SECONDS;
}

export function getOAuthAuthTokenTtlSeconds() {
  return OAUTH_AUTH_TOKEN_TTL_SECONDS;
}


export async function verifyUserAuthentication(reqHeaders) {
  try {
    const SECRET_KEY = process.env.TOKEN_SECRET;
    const tokenString = reqHeaders.authorization;
    const token = tokenString?.split("Bearer ")[1];
    if (!token) throw new Error("Missing token");

    const decoded = jwt.verify(token, SECRET_KEY);
    if (decoded?.type) {
      throw new Error("Invalid or missing token");
    }
    return decoded._id;
  } catch (e) {
    console.error("Token verification failed:", e);
    throw new Error("Invalid or missing token");
  }
}




export function verifyUserAuth(reqHeaders) {
  try {
    const SECRET_KEY = process.env.TOKEN_SECRET;
    const tokenString = reqHeaders.authorization;
    const token = tokenString.split("Bearer ")[1];
    const decoded = jwt.verify(token, SECRET_KEY);
    if (decoded?.type) {
      return;
    }
    return decoded._id;
  } catch (e) {

  }
}

export async function verifyUserAuthAndGetUser(reqHeaders) {

  const SECRET_KEY = process.env.TOKEN_SECRET;
  const tokenString = reqHeaders.authorization;
  if (!tokenString) throw new Error("No token provided");
  const token = tokenString.split("Bearer ")[1];
  const decoded = jwt.verify(token, SECRET_KEY);
  if (decoded?.type) {
    throw new Error("Invalid or missing token");
  }
  const userId = decoded._id;
  try {
    const UserModel = require('./User');
    const userData = await UserModel.getUserById(userId);
    return userData;
  } catch (e) {
    console.error("ERROR", e);
  }
}
