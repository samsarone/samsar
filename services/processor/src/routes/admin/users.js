
import express from 'express';

import 'dotenv/config';
import { listUsers, markUsersAsVerified , lowercaseUserEmails} from '../../models/admin/Users.js';
import { markAllSessionsAsNotPending } from '../../models/admin/Session.js';


const router = express.Router();




router.post('/list', async function (req, res) {
  try {
    const {
      page = 1,
      pageSize = 10,
      search = "",
      sortBy = "createdAt",
      sortOrder = "desc",
    } = req.body || {};
    const data = await listUsers({ page, pageSize, search, sortBy, sortOrder });
    res.json(data);
  } catch (err) {
    console.error('Error in /admin/users/list:', err);
    res.status(500).json({ error: 'An error occurred while listing users' });
  }
});


router.post('/mark_verified', async function (req, res) {
  try {
    const data = await markUsersAsVerified();
    res.json(data);
  } catch (err) {
    console.error('Error in /admin/users/mark-verified:', err);
    res.status(500).json({ error: 'An error occurred while marking users as verified' });
  }
});

router.post('/lowercase_emails', async function (req, res) {
  try {
    const data = await lowercaseUserEmails();
    res.json(data);
  } catch (err) {
    console.error('Error in /admin/users/lowercase-emails:', err);
    res.status(500).json({ error: 'An error occurred while lowercasing emails' });
  }


});


router.post('/mark_sessions_not_pending', async function (req, res) {
  try {
    const data = await markAllSessionsAsNotPending();
    res.json(data);
  } catch (err) {
    console.error('Error in /admin/users/mark-sessions-not-pending:', err);
    res.status(500).json({ error: 'An error occurred while marking sessions as not pending' });
  }
});


export default router;
