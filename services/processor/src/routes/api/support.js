import express from 'express';
import { sendSupportRequestEmail } from '../../models/SupportMailer.js';
import 'dotenv/config';

const router = express.Router();

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/=\s]+$/;
const SUPPORT_TO_ADDRESS =
  process.env.SUPPORT_TO_ADDRESS ||
  process.env.SES_REPLY_TO_ADDRESS ||
  process.env.SES_FROM_ADDRESS ||
  'noreply@samsar.one';

router.post('/request', async (req, res) => {
  const { email, message, attachment } = req.body || {};
  const trimmedEmail = typeof email === 'string' ? email.trim() : '';
  const trimmedMessage = typeof message === 'string' ? message.trim() : '';

  if (!EMAIL_PATTERN.test(trimmedEmail)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  if (!trimmedMessage) {
    return res.status(400).json({ error: 'A message is required.' });
  }

  if (trimmedMessage.length > 10000) {
    return res.status(400).json({ error: 'Message must be 10,000 characters or less.' });
  }

  let attachmentPayload = null;

  if (attachment) {
    const fileName = typeof attachment?.fileName === 'string' ? attachment.fileName.trim() : '';
    const contentType = typeof attachment?.contentType === 'string' ? attachment.contentType.trim() : '';
    const contentBase64 =
      typeof attachment?.contentBase64 === 'string' ? attachment.contentBase64.replace(/\s+/g, '') : '';

    if (!fileName || !contentBase64 || !BASE64_PATTERN.test(contentBase64)) {
      return res.status(400).json({ error: 'Attachment data is invalid.' });
    }

    const content = Buffer.from(contentBase64, 'base64');

    if (!content.length || content.length > MAX_ATTACHMENT_BYTES) {
      return res.status(400).json({ error: 'Attachment must be 5 MB or smaller.' });
    }

    attachmentPayload = {
      fileName,
      contentType: contentType || 'application/octet-stream',
      content,
    };
  }

  try {
    await sendSupportRequestEmail({
      toEmail: SUPPORT_TO_ADDRESS,
      senderEmail: trimmedEmail,
      message: trimmedMessage,
      attachment: attachmentPayload,
    });

    return res.status(200).json({
      message: 'Support request sent successfully.',
    });
  } catch (error) {
    console.error('Failed to send support request email:', error);
    return res.status(500).json({
      error: 'Unable to send support request right now.',
    });
  }
});

export default router;
