
import { getDBConnectionString } from '../DBString.js';
import NotificationMailer from '../schema/NotificationMailer.js';
import { isStandaloneEdition } from './DeploymentEnvironment.js';
import {
  sendVideoCompletedEmailDirectly,
  shouldSendVideoCompletionEmailDirectly,
} from './VideoCompletionMailer.js';

function normalizeBaseUrl(value, fallback) {
  const candidate = typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return candidate.replace(/\/+$/, '');
}

function resolveSessionLink(sessionId) {
  const baseUrl = normalizeBaseUrl(process.env.CLIENT_APP, 'https://app.samsar.one');
  return `${baseUrl}/video/${encodeURIComponent(String(sessionId || ''))}`;
}

function resolveDownloadLink(downloadLink) {
  const trimmed = typeof downloadLink === 'string' ? downloadLink.trim() : '';
  if (!trimmed || /^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const baseUrl = normalizeBaseUrl(
    process.env.PROCESSOR_API || process.env.PROCESSOR_URL || process.env.API_SERVER,
    'https://api.samsar.one'
  );
  return `${baseUrl}/${trimmed.replace(/^\/+/, '')}`;
}

export async function updateSendCompletionNotificationToUser(payload) {
  const {
    sessionId,
    recipientEmail,
    downloadLink,
    userName
  } = payload;

  const sessionLink = resolveSessionLink(sessionId);
  const finalDownloadLink = resolveDownloadLink(downloadLink);
  const mailPayload = {
    sessionId,
    recipientEmail,
    downloadLink: finalDownloadLink,
    userName,
    sessionLink
  };

  if (shouldSendVideoCompletionEmailDirectly()) {
    return sendVideoCompletedEmailDirectly(mailPayload);
  }

  if (isStandaloneEdition()) {
    return { skipped: true, reason: 'mail_not_configured' };
  }

  await getDBConnectionString();

  const notificationMailer = new NotificationMailer({
    sessionId,
    notificationType: 'VIDEO_COMPLETED',
    status: 'PENDING',
    sendTime: new Date(),
    recipientEmail,
    downloadLink: finalDownloadLink,
    userName,
    sessionLink
  });

  
  await notificationMailer.save();

  return notificationMailer;


}
