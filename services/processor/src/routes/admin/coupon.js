
import express from 'express';

import 'dotenv/config';
import { createCoupon } from '../../models/admin/Coupon.js';


const router = express.Router();




router.post('/create', async function(req, res) {
  try {
    const newCoupon = await createCoupon(req.body);
    res.json(newCoupon);
  } catch (error) {
    console.error('Error in /admin/coupon/create:', error);
    res.status(500).json({ error: 'Unable to create the coupon.' });
  }
});




export default router;
