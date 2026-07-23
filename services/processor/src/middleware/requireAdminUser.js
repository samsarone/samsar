import { verifyUserToken } from '../models/User.js';

export function getBearerToken(req) {
  const authorization = req?.headers?.authorization;
  if (typeof authorization !== 'string') {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || null;
}

export function createRequireAdminUser({ verifyToken = verifyUserToken } = {}) {
  return async function requireAdminUser(req, res, next) {
    const authToken = getBearerToken(req);
    if (!authToken) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    try {
      const user = await verifyToken({ authToken });
      if (!user) {
        return res.status(401).json({ error: 'Invalid authentication token.' });
      }
      if (user.isAdminUser !== true) {
        return res.status(403).json({ error: 'Administrator privileges required.' });
      }

      req.adminUser = user;
      next();
    } catch (_) {
      return res.status(401).json({ error: 'Invalid or expired authentication token.' });
    }
  };
}

export const requireAdminUser = createRequireAdminUser();
