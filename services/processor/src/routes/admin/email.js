
import express from 'express';

import { requestSendAdminEmails } from '../../models/admin/Email.js';
import { requestWeeklyNewsletterTestEmail } from '../../models/admin/Newsletter.js';
import 'dotenv/config';


const router = express.Router();


router.get('/test', async function (req, res) { 
  res.json({ message: 'Hello from /admin/email/test' });
});

router.post('/request_admin_emails', async function (req, res) {
  const payload = req.body;
  try {
    const resData = await requestSendAdminEmails(payload);
    res.json(resData);
  } catch (err) {
    console.error('Error in /admin/email/request_admin_emails:', err);
    res.status(500).json({ error: 'An error occurred while requesting admin emails' });
  }
});

router.post('/request_newsletter_test_email', async function (req, res) {
  try {
    const resData = await requestWeeklyNewsletterTestEmail(req.body || {});
    res.json(resData);
  } catch (err) {
    console.error('Error in /admin/email/request_newsletter_test_email:', err);
    res.status(400).json({
      error: err?.message || 'An error occurred while queueing the newsletter test email',
    });
  }
});

export default router;
