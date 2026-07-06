import {
  getConfiguredMailFromAddress,
  getConfiguredMailReplyToAddress,
  sendConfiguredEmail,
  shouldUseDirectDockerMail,
} from './MailTransport.js';
import {
  getRenderCompleteMailBody,
  getRenderCompleteMailSubject,
  getRenderCompleteMailText,
} from './RenderCompleteMail.js';

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(value, fallback) {
  const candidate = normalizeString(value) || fallback;
  return candidate.replace(/\/+$/, '');
}

function resolveSessionLink(sessionId) {
  if (!sessionId) {
    return '';
  }
  const baseUrl = normalizeBaseUrl(process.env.CLIENT_APP, 'https://app.samsar.one');
  return `${baseUrl}/video/${encodeURIComponent(String(sessionId))}`;
}

function resolveDownloadLink(downloadLink) {
  const trimmed = normalizeString(downloadLink);
  if (!trimmed) {
    return '';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  const baseUrl = normalizeBaseUrl(
    process.env.PROCESSOR_API || process.env.PROCESSOR_URL || process.env.API_SERVER,
    'https://api.samsar.one'
  );
  return `${baseUrl}/${trimmed.replace(/^\/+/, '')}`;
}

export function shouldSendVideoCompletionEmailDirectly() {
  return shouldUseDirectDockerMail();
}

export async function sendVideoCompletedEmailDirectly(payload = {}) {
  const recipientEmail = normalizeString(payload.recipientEmail);
  if (!recipientEmail) {
    throw new Error('Recipient email is missing for video completion notification');
  }

  const mailPayload = {
    ...payload,
    recipientEmail,
    userName: normalizeString(payload.userName) || recipientEmail,
    sessionLink: normalizeString(payload.sessionLink) || resolveSessionLink(payload.sessionId),
    downloadLink: resolveDownloadLink(payload.downloadLink),
  };

  const subject = getRenderCompleteMailSubject(mailPayload);
  const htmlBody = getRenderCompleteMailBody(mailPayload);
  const textBody = getRenderCompleteMailText(mailPayload);
  const replyTo = getConfiguredMailReplyToAddress();

  const result = await sendConfiguredEmail({
    Destination: {
      ToAddresses: [recipientEmail],
    },
    Message: {
      Body: {
        Html: {
          Charset: 'UTF-8',
          Data: htmlBody,
        },
        Text: {
          Charset: 'UTF-8',
          Data: textBody,
        },
      },
      Subject: {
        Charset: 'UTF-8',
        Data: subject,
      },
    },
    Source: getConfiguredMailFromAddress(),
    ReplyToAddresses: replyTo ? [replyTo] : [],
  }, 'video completion email');

  return {
    sent: !result?.skipped,
    skipped: Boolean(result?.skipped),
    reason: result?.reason,
    result,
  };
}
