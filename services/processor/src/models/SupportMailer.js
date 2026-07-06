import { randomBytes } from 'crypto';
import dotenv from 'dotenv';
import { sendConfiguredRawEmail } from './MailTransport.js';

dotenv.config();

const SES_DEFAULT_FROM_ADDRESS =
  process.env.SUPPORT_FROM_ADDRESS ||
  process.env.SES_FROM_ADDRESS ||
  process.env.SES_REPLY_TO_ADDRESS ||
  'noreply@samsar.one';

function sanitizeHeaderValue(value = '') {
  return value.toString().replace(/[\r\n]+/g, ' ').trim();
}

function sanitizeFileName(value = 'attachment') {
  const sanitized = value
    .toString()
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/["\\/\r\n]+/g, '_')
    .trim();

  return sanitized || 'attachment';
}

function encodeSubject(value) {
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function chunkBase64(value) {
  return value.replace(/.{1,76}/g, '$&\n').trim();
}

function buildSupportBody({ senderEmail, message, attachment }) {
  const sections = [
    'New support request received.',
    '',
    `From: ${senderEmail}`,
    `Submitted at: ${new Date().toISOString()}`,
  ];

  if (attachment) {
    sections.push(
      `Attachment: ${attachment.fileName} (${attachment.contentType}, ${attachment.content.length} bytes)`
    );
  }

  sections.push('', 'Message:', message);

  return sections.join('\n');
}

export async function sendSupportRequestEmail({ toEmail, senderEmail, message, attachment = null }) {
  const safeSenderEmail = sanitizeHeaderValue(senderEmail);
  const safeToEmail = sanitizeHeaderValue(toEmail);
  const safeFromEmail = sanitizeHeaderValue(SES_DEFAULT_FROM_ADDRESS);
  const subject = `Support request from ${safeSenderEmail}`;
  const mixedBoundary = `samsar-support-${randomBytes(12).toString('hex')}`;
  const lines = [
    `From: ${safeFromEmail}`,
    `To: ${safeToEmail}`,
    `Reply-To: ${safeSenderEmail}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
    '',
    `--${mixedBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    buildSupportBody({ senderEmail: safeSenderEmail, message, attachment }),
    '',
  ];

  if (attachment) {
    const safeFileName = sanitizeFileName(attachment.fileName);
    const safeContentType = sanitizeHeaderValue(attachment.contentType || 'application/octet-stream');

    lines.push(
      `--${mixedBoundary}`,
      `Content-Type: ${safeContentType}; name="${safeFileName}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${safeFileName}"`,
      '',
      chunkBase64(attachment.content.toString('base64')),
      ''
    );
  }

  lines.push(`--${mixedBoundary}--`, '');

  const rawMessage = Buffer.from(lines.join('\n'), 'utf8');

  return sendConfiguredRawEmail({
    Source: safeFromEmail,
    Destinations: [safeToEmail],
    ReplyToAddresses: [safeSenderEmail],
    RawMessage: {
      Data: rawMessage,
    },
  }, 'support request email');
}
