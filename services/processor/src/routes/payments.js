import bodyParser from 'body-parser';
import 'dotenv/config';
import express from 'express';
import {
  createAnonymousCreditCheckoutSession,
  processStripePaymentWebhook,
} from '../models/Payment.js';

import { getDBConnectionString } from '../models/DBString.js';
import GenerationCreditTransaction from '../schema/GenerationCreditTransaction.js';
import User from '../schema/User.js';
import UserPayment from '../schema/UserPayment.js';
import Stripe from 'stripe';
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);



const router = express.Router();

const formatPaymentSummary = (payment) => {
  if (!payment) return null;
  return {
    creditsApplied: payment.creditsApplied ?? 0,
    amountPaidCents: payment.amountPaidCents ?? 0,
    currency: payment.currency?.toUpperCase?.() ?? 'USD',
    paymentDate: payment.paymentDate || payment.createdAt || null,
    paymentStatus: payment.paymentStatus || null,
    productSummary: payment.productSummary || payment.billingReason || null,
  };
};


router.get('/payment_success', async function(req, res) {
  const reqQuery = req.query;

  res.json({
    'message': 'success'
  });
});


router.get('/payment_cancel', async function(req, res) {
  const reqQuery = req.query;

  res.json({
    'message': 'cancel'
  });
});

router.get('/summary', async function(req, res) {
  const stripeCustomerId =
    typeof req.query.stripeCustomerId === 'string'
      ? req.query.stripeCustomerId.trim()
      : typeof req.query.stripe_customer_id === 'string'
        ? req.query.stripe_customer_id.trim()
        : '';

  if (!stripeCustomerId) {
    return res.status(400).json({ error: 'stripeCustomerId is required.' });
  }

  try {
    await getDBConnectionString();

    const user = await User.findOne({ stripeCustomerId })
      .select('_id generationCredits stripeCustomerId')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'Customer not found.' });
    }

    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

    const creditsUsedPromise = GenerationCreditTransaction.aggregate([
      {
        $match: {
          userId: user._id,
          direction: 'debit',
          createdAt: { $gte: monthStart, $lt: nextMonthStart },
        },
      },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    let lastTopUpPayment = await UserPayment.findOne({
      userId: user._id,
      creditsApplied: { $gt: 0 },
    })
      .sort({ paymentDate: -1, createdAt: -1 })
      .lean();

    if (!lastTopUpPayment) {
      lastTopUpPayment = await UserPayment.findOne({ userId: user._id })
        .sort({ paymentDate: -1, createdAt: -1 })
        .lean();
    }

    const creditsUsedAggregation = await creditsUsedPromise;

    const formattedTopUp = formatPaymentSummary(lastTopUpPayment);
    const creditsUsedThisMonth = creditsUsedAggregation?.[0]?.total ?? 0;
    const totalCredits = Number(user.generationCredits) || 0;

    return res.status(200).json({
      stripeCustomerId: user.stripeCustomerId,
      totalCredits,
      creditsUsedThisMonth,
      creditsRecharged: formattedTopUp?.creditsApplied ?? 0,
      lastTopUp: formattedTopUp,
    });
  } catch (error) {
    console.error('Failed to fetch payment summary:', error?.message || error);
    return res.status(500).json({ error: 'Unable to fetch payment summary.' });
  }
});

router.post('/purchase_credits_for_user', async function(req, res) {
  const reqBody = req.body;

  res.json({
    'message': 'purchase_credits_for_user'
  });
  
});

router.post('/anonymous_credit_checkout', async function(req, res) {
  try {
    const session = await createAnonymousCreditCheckoutSession(req.body || {});
    res.status(200).json(session);
  } catch (error) {
    res.status(400).json({
      error: error?.message || 'Unable to create anonymous credit checkout session',
    });
  }
});


export default router;
