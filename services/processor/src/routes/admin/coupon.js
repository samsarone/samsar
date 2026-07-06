
import express from 'express';

import 'dotenv/config';
import { createCoupon } from '../../models/admin/Coupon.js';


const router = express.Router();




router.post('/create', async function(req, res) {
  const secret = req.query.secret;
  const payload = req.body;


  
  if (secret !== process.env.ADMIN_SECRET) {
    res.status(401).send('Unauthorized');
    return;
  } else {
    const newCoupon = await createCoupon(payload);

    res.json(newCoupon);
  }
});




export default router;
