
import crypto from 'crypto';

export function generateAPIKey() {
  // Generates a random 40-character hexadecimal string
  return crypto.randomBytes(20).toString('hex');
}

