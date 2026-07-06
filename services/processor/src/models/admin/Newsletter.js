import { getDBConnectionString } from '../DBString.js';
import NotificationMailer from '../../schema/NotificationMailer.js';

const DEFAULT_NEWSLETTER_TEST_EMAIL = process.env.NEWSLETTER_ADMIN_EMAIL || 'roy@samsar.one';

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function assertValidEmail(email) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid test recipient email is required.');
  }
}

export async function requestWeeklyNewsletterTestEmail(payload = {}) {
  await getDBConnectionString();

  const recipientEmail = normalizeEmail(payload.recipientEmail || payload.email || DEFAULT_NEWSLETTER_TEST_EMAIL);
  assertValidEmail(recipientEmail);

  const notification = await NotificationMailer.create({
    notificationType: 'WEEKLY_NEWSLETTER_TEST',
    status: 'PENDING',
    sendTime: new Date(),
    recipientEmail,
  });

  return {
    message: 'Newsletter test email queued',
    notificationId: notification._id,
    recipientEmail,
  };
}
