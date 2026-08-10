import crypto from 'crypto';
import User from '../schema/User.js';
import { getDBConnectionString } from './DBString.js';
import { sendNewsletterSubscriptionAdminEmail } from './Mailer.js';
import { getTokenSecret, validateRuntimeSecret } from '../utils/RuntimeSecrets.js';

const NEWSLETTER_UNSUBSCRIBE_TOKEN_VERSION = 1;
const NEWSLETTER_ADMIN_EMAIL = process.env.NEWSLETTER_ADMIN_EMAIL || 'roy@samsar.one';
const UNSUBSCRIBE_REASONS = new Set([
  'too_many_emails',
  'not_relevant',
  'did_not_sign_up',
  'only_wanted_product_updates',
  'other',
]);

export function getNewsletterSecret() {
  if (process.env.NEWSLETTER_UNSUBSCRIBE_SECRET) {
    return validateRuntimeSecret(
      'NEWSLETTER_UNSUBSCRIBE_SECRET',
      process.env.NEWSLETTER_UNSUBSCRIBE_SECRET,
    );
  }

  return getTokenSecret();
}

function toBase64Url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signPayload(payload) {
  return crypto
    .createHmac('sha256', getNewsletterSecret())
    .update(payload)
    .digest('base64url');
}

function safeTimingEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function trimToLength(value, maxLength) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

export function normalizeNewsletterPreference(value, defaultValue = false) {
  if (value === undefined || value === null) {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['false', '0', 'no', 'off', 'unchecked'].includes(normalized)) {
      return false;
    }
    if (['true', '1', 'yes', 'on', 'checked'].includes(normalized)) {
      return true;
    }
  }

  return defaultValue;
}

export function generateNewsletterUnsubscribeToken(user) {
  const userId = user?._id?.toString?.() || user?.id?.toString?.() || '';
  const email = normalizeEmail(user?.email);

  if (!userId || !email) {
    throw new Error('Cannot generate newsletter unsubscribe token without user id and email.');
  }

  const payload = toBase64Url({
    version: NEWSLETTER_UNSUBSCRIBE_TOKEN_VERSION,
    userId,
    email,
  });

  return `${payload}.${signPayload(payload)}`;
}

export async function findUserByNewsletterToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) {
    return null;
  }

  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeTimingEqual(signPayload(payload), signature)) {
    return null;
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (_) {
    return null;
  }

  if (decoded?.version !== NEWSLETTER_UNSUBSCRIBE_TOKEN_VERSION || !decoded?.userId) {
    return null;
  }

  await getDBConnectionString();
  const user = await User.findOne({ _id: decoded.userId });
  if (!user || normalizeEmail(user.email) !== normalizeEmail(decoded.email)) {
    return null;
  }

  return user;
}

export function prepareUserForVerifiedNewsletterSubscription(user, { source = 'email_verification' } = {}) {
  if (!user || user.weeklyNewsletterSubscribed !== true) {
    return false;
  }

  const shouldNotifyAdmin = !user.weeklyNewsletterAdminNotifiedAt;
  user.weeklyNewsletterSubscribed = true;
  user.weeklyNewsletterSubscribedAt = user.weeklyNewsletterSubscribedAt || new Date();
  user.weeklyNewsletterSubscriptionSource = user.weeklyNewsletterSubscriptionSource || source;
  user.weeklyNewsletterUnsubscribedAt = null;
  user.weeklyNewsletterUnsubscribeReason = null;
  user.weeklyNewsletterUnsubscribeDetails = null;

  return shouldNotifyAdmin;
}

export async function notifyAdminForNewsletterSubscription(user) {
  if (!user?._id) {
    return;
  }

  await getDBConnectionString();
  const currentUser = await User.findOne({ _id: user._id });
  if (
    !currentUser ||
    !currentUser.isEmailVerified ||
    currentUser.weeklyNewsletterSubscribed === false ||
    currentUser.weeklyNewsletterAdminNotifiedAt
  ) {
    return;
  }

  try {
    await sendNewsletterSubscriptionAdminEmail({
      adminEmail: NEWSLETTER_ADMIN_EMAIL,
      userEmail: currentUser.email,
      userName: currentUser.username || currentUser.displayName || currentUser.email,
      source: currentUser.weeklyNewsletterSubscriptionSource || 'registration',
    });

    currentUser.weeklyNewsletterAdminNotifiedAt = new Date();
    await currentUser.save();
  } catch (error) {
    console.error('Failed to notify admin about newsletter subscription:', error);
  }
}

export async function unsubscribeUserFromWeeklyNewsletter({ token, reason, details }) {
  const user = await findUserByNewsletterToken(token);
  if (!user) {
    const error = new Error('Invalid or expired unsubscribe link.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedReason = UNSUBSCRIBE_REASONS.has(reason) ? reason : 'other';
  user.weeklyNewsletterSubscribed = false;
  user.weeklyNewsletterUnsubscribedAt = new Date();
  user.weeklyNewsletterUnsubscribeReason = normalizedReason;
  user.weeklyNewsletterUnsubscribeDetails = trimToLength(details, 1000);

  await user.save();

  return {
    success: true,
    email: user.email,
  };
}
