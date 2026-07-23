
import express from 'express';

import 'dotenv/config';
import { createCoupon } from '../../models/admin/Coupon.js';


const router = express.Router();




router.post('/create', async function(req, res) {
  const payload = req.body;
  const newCoupon = await createCoupon(payload);
  res.json(newCoupon);
});




export default router;
