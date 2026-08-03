
import express from 'express';

import {
  requestRedeemCouponCode,
  requestUserGenerationsGallery,
  requestUserImageGenerations,
  requestUserMusicGenerations,
} from '../models/Account.js';

import 'dotenv/config';
import { verifyUserAuth, } from '../models/Auth.js';

const router = express.Router();


router.get('/delete_all_rows', async function (req, res) {
  const secret = req.query.secret;
  if (secret !== process.env.ADMIN_SECRET) {
    res.status(401).send('Unauthorized');
    return;
  } else {
    const payload = req.body;
    const sessionData = await deleteAllRows();
    res.json(sessionData);
  }
});


router.get('/user_image_generations', async function (req, res) {
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  try {
    const { page, pageSize, limit, finalOnly } = req.query;
    const response = await requestUserImageGenerations(userId, {
      page,
      pageSize: pageSize ?? limit,
      finalOnly: finalOnly === 'true' || finalOnly === '1',
    });
    const items = Array.isArray(response?.items) ? response.items : [];
    const pagination = response?.pagination ?? {};

    res.json({
      items,
      pagination: {
        page: pagination.page ?? (page ? Number.parseInt(page, 10) || 1 : 1),
        pageSize: pagination.pageSize ?? (pageSize ? Number.parseInt(pageSize, 10) || 20 : 20),
        totalItems: pagination.totalItems ?? items.length,
        totalPages: pagination.totalPages ?? 1,
        hasNextPage: pagination.hasNextPage ?? false,
        hasPreviousPage: pagination.hasPreviousPage ?? false,
      },
    });
  } catch (err) {
    console.error('Failed to fetch user image generations', err);
    res.status(500).send("Internal Server Error");
  }
});

router.get('/generations_gallery', async function (req, res) {
  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const { page, pageSize, search } = req.query;
    const response = await requestUserGenerationsGallery(userId, {
      page,
      pageSize,
      search,
    });
    res.json(response);
  } catch (err) {
    console.error('Failed to fetch generations gallery', err);
    res.status(500).send("Internal Server Error");
  }
});



router.get('/user_music_generations', async function (req, res) {

});


router.get('/user_video_generations', async function (req, res) {

});


router.post('/redeem_coupon_code', async function (req, res) {

  const payload = req.body;



  const userId = verifyUserAuth(req.headers);
  if (!userId) {
    res.status(401).send("Unauthorized");
    return;
  }
  try {
  const response = await requestRedeemCouponCode(userId, payload);
  res.json(response);
  } catch (err) {
    res.send(500, err);
  }
});

// You can add more session-related routes here

export default router;
