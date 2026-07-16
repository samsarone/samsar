
import crypto from 'crypto';

export const API_KEY_PREFIX = 'sk_live_';

export function generateAPIKeySecret() {
  return crypto.randomBytes(20).toString('hex');
}

export function generateAPIKey() {
  return `${API_KEY_PREFIX}${generateAPIKeySecret()}`;
}
