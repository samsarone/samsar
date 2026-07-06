import User from '../schema/User.js';
import UserPayment from '../schema/UserPayment.js';

import Stripe from 'stripe';
import { getDBConnectionString } from './DBString.js';
import CouponCode from '../schema/CouponCode.js';
import {
  buildAppUrl,
  resolveTrustedAppBaseUrl,
} from './BillingPortal.js';
import { generateAPIKey } from '../utils/ApiKeyUtils.js';

const PROCESSOR_URL = process.env.PROCESSOR_URL;




const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const CLIENT_APP = process.env.CLIENT_APP || 'https://app.samsar.one';
const LANDING_APP = process.env.LANDING_APP || 'https://www.samsar.one';
const ANONYMOUS_CREDIT_PURCHASE_INTENT = 'anonymous_credit_purchase';
const DEFAULT_CREDITS_PER_DOLLAR = 100;

function isCouponLimitReached(couponData) {
  const limit = Number(couponData?.redemptionLimit);
  if (!Number.isFinite(limit) || limit <= 0) return false;
  return Number(couponData?.redemptionCount || 0) >= limit;
}

const resolveCheckoutAppBaseUrl = (payload = {}) => {
  const requestedBaseUrl =
    payload?.redirectBaseUrl ||
    payload?.returnBaseUrl ||
    payload?.appBaseUrl;

  return resolveTrustedAppBaseUrl(requestedBaseUrl, CLIENT_APP);
};

const buildPaymentSuccessUrl = (stripeCustomerId, appBaseUrl = CLIENT_APP) => {
  const baseUrl = buildAppUrl(appBaseUrl, '/payment_success');
  if (!stripeCustomerId) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set('stripeCustomerId', stripeCustomerId);
  return url.toString();
};

const buildPaymentCancelUrl = (appBaseUrl = CLIENT_APP) =>
  buildAppUrl(appBaseUrl, '/payment_cancel');

const buildStripeCustomerPayload = (userData) => {
  const payload = {};
  if (userData?.email) {
    payload.email = userData.email;
  }
  if (userData?.username) {
    payload.name = userData.username;
  }
  return payload;
};

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildUsernameFromEmail(email) {
  const localPart = normalizeEmail(email).split('@')[0] || 'customer';
  const safeLocalPart = localPart.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-');
  return safeLocalPart ? `api-${safeLocalPart}` : `api-customer-${Date.now()}`;
}

function getCreditsPerDollar() {
  const parsed = Number(process.env.SAMSAR_CREDITS_PER_DOLLAR);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CREDITS_PER_DOLLAR;
}

function normalizeCheckoutAmountCents(payload = {}) {
  const amountCentsRaw =
    payload.amountCents ??
    payload.amount_cents ??
    payload.priceCents ??
    payload.price_cents;
  const amountUsdRaw =
    payload.amountUsd ??
    payload.amount_usd ??
    payload.amount ??
    payload.dollars;
  const parsedAmountCents = Number(amountCentsRaw);
  const parsedAmountUsd = Number(amountUsdRaw);
  const amountCents = Number.isFinite(parsedAmountCents)
    ? Math.round(parsedAmountCents)
    : Math.round(parsedAmountUsd * 100);

  const maxAmountCents = Number(process.env.ANONYMOUS_CREDIT_CHECKOUT_MAX_CENTS || 1000000);
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Amount is required to purchase credits');
  }
  if (Number.isFinite(maxAmountCents) && maxAmountCents > 0 && amountCents > maxAmountCents) {
    throw new Error('Amount exceeds the maximum checkout amount');
  }
  return amountCents;
}

function buildAnonymousCreditMetadata(payload, amountCents, credits) {
  const metadata = {
    intent: ANONYMOUS_CREDIT_PURCHASE_INTENT,
    sourceProject: 'superreferrer',
    creditsRequested: String(credits),
    originalAmountCents: String(amountCents),
    productSummary: `Purchase ${credits} Samsar Processor credits`,
  };

  if (payload.metadata && typeof payload.metadata === 'object') {
    Object.entries(payload.metadata).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      metadata[key] = String(value);
    });
  }

  return metadata;
}

const ensureStripeCustomerForUser = async (userData) => {
  let customerId = userData?.stripeCustomerId;
  const payload = buildStripeCustomerPayload(userData);
  let needsNewCustomer = !customerId;

  if (customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      if (!customer || customer.deleted) {
        needsNewCustomer = true;
      }
    } catch (err) {
      if (err?.code === 'resource_missing' || err?.statusCode === 404) {
        needsNewCustomer = true;
      } else {
        throw err;
      }
    }
  }

  if (needsNewCustomer) {
    const customer = await stripe.customers.create(payload);
    customerId = customer.id;
    if (customerId) {
      await User.updateOne({ _id: userData._id }, { stripeCustomerId: customerId });
    }
  }

  return customerId;
};

export function isAnonymousCreditPurchaseSession(session) {
  return session?.metadata?.intent === ANONYMOUS_CREDIT_PURCHASE_INTENT;
}

export async function createAnonymousCreditCheckoutSession(payload = {}) {
  const amountCents = normalizeCheckoutAmountCents(payload);
  const credits = Math.max(1, Math.round((amountCents / 100) * getCreditsPerDollar()));
  const checkoutAppBaseUrl = resolveCheckoutAppBaseUrl(payload);
  const successPath = payload.successPath || payload.success_path || '/payment_success';
  const cancelPath = payload.cancelPath || payload.cancel_path || '/payment_cancel';
  const metadata = buildAnonymousCreditMetadata(payload, amountCents, credits);

  const sessionPayload = {
    payment_method_types: ['card'],
    mode: 'payment',
    customer_creation: 'always',
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: metadata.productSummary,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    success_url: buildAppUrl(checkoutAppBaseUrl, successPath, {
      source: 'samsar_processor_credits',
    }),
    cancel_url: buildAppUrl(checkoutAppBaseUrl, cancelPath, {
      source: 'samsar_processor_credits',
    }),
    metadata,
    payment_intent_data: {
      metadata,
    },
  };

  if (typeof payload.clientReferenceId === 'string' && payload.clientReferenceId.trim()) {
    sessionPayload.client_reference_id = payload.clientReferenceId.trim();
  }

  const session = await stripe.checkout.sessions.create(sessionPayload);

  return {
    url: session.url,
    checkoutSessionId: session.id,
    amountCents,
    credits,
    currency: 'usd',
  };
}

export async function resolveAnonymousCreditPurchaseUserFromSession(session) {
  if (!isAnonymousCreditPurchaseSession(session)) {
    return null;
  }

  await getDBConnectionString();

  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : session.customer?.id || null;
  let email = normalizeEmail(
    session.customer_details?.email ||
    session.customer_email ||
    session.metadata?.customerEmail
  );

  if (!email && customerId) {
    try {
      const customer = await stripe.customers.retrieve(customerId);
      email = normalizeEmail(customer?.email);
    } catch (error) {
      console.error('Failed to resolve Stripe customer email for anonymous credit purchase', error?.message || error);
    }
  }

  if (!email) {
    throw new Error('Stripe checkout did not include a customer email');
  }

  let user = await User.findOne({ stripePaymentId: session.id });
  if (!user && customerId) {
    user = await User.findOne({ stripeCustomerId: customerId });
  }
  if (!user) {
    user = await User.findOne({
      email: new RegExp(`^${escapeRegExp(email)}$`, 'i'),
    });
  }

  let created = false;
  if (!user) {
    user = new User({
      email,
      username: buildUsernameFromEmail(email),
      isPremiumUser: false,
      hasFreeTrialClaimed: false,
      generationCredits: 0,
      userApiKeys: [],
      userType: 'api_customer',
      isTempUser: false,
    });
    created = true;
  }

  user.email = user.email || email;
  user.stripePaymentId = session.id;
  if (customerId) {
    user.stripeCustomerId = customerId;
  }

  if (!Array.isArray(user.userApiKeys)) {
    user.userApiKeys = [];
  }

  const hasApiKey = user.userApiKeys.length > 0;
  if (!hasApiKey) {
    user.userApiKeys.push({
      apiKey: generateAPIKey(),
      expiresAt: null,
      userId: user._id?.toString(),
    });
  }

  await user.save();
  return { user, created, apiKeyCreated: !hasApiKey };
}




export async function upgradePlan(userId, payload) {
  let email = payload.email;

  await getDBConnectionString();
  let userData = await User.findOne({ _id: userId });

  const paymentPlan = payload.plan;
  const couponCode = payload.couponCode;
  const redemptionType = payload.redemptionType;

  let redemptionMonths;
  let couponCodeData;




  if (couponCode && couponCode.length > 0) {
    couponCodeData = await CouponCode.findOne({ couponCode: couponCode });

    if (!couponCodeData) {
      throw new Error('Invalid coupon code');
    }
    if (!couponCodeData.redemptionActive) {
      throw new Error('Coupon code is not active');
    }
    if (couponCodeData.redemptionStartDate && couponCodeData.redemptionStartDate > new Date()) {
      throw new Error('Coupon code is not active yet');
    }
    if (isCouponLimitReached(couponCodeData)) {
      throw new Error('Coupon code has reached its redemption limit');
    }
    if (couponCodeData.redemptionEndDate && couponCodeData.redemptionEndDate < new Date()) {
      throw new Error('Coupon code has expired');
    }
    if (couponCodeData.issuedForUserId && couponCodeData.issuedForUserId !== userId) {
      throw new Error('This coupon code is not assigned to this user');
    }

    const userAlreadyRedeemed = (couponCodeData.redeemedUsers || []).includes(userId);
    if (userAlreadyRedeemed) {
      throw new Error('User has already redeemed this coupon code');
    }

    await CouponCode.updateOne(
      { couponCode: couponCode },
      { $push: { redeemedUsers: userId }, $inc: { redemptionCount: 1 } }
    );

    if (redemptionType === 'subscription') {
      redemptionMonths = couponCodeData.redemptionMonths;
    }
  }

  let customer;
  const userEmail = userData.email;
  const userName = userData.username;
  let customerPayload = {};

  if (userEmail) {
    customerPayload.email = userEmail;
  }
  if (userName) {
    customerPayload.name = userName;
  }

  let stripeCustomerExistedBefore = false;

  if (userData.stripeCustomerId) {
    customer = await stripe.customers.retrieve(userData.stripeCustomerId);
    if (!customer) {
      customer = await stripe.customers.create(customerPayload);
    } else {
      stripeCustomerExistedBefore = true;
    }
  } else {
    customer = await stripe.customers.create(customerPayload);
  }

  if (!stripeCustomerExistedBefore && customer.id) {
    await User.updateOne({ _id: userId }, { stripeCustomerId: customer.id });
  }

  const checkoutAppBaseUrl = resolveCheckoutAppBaseUrl(payload);
  const successUrl = buildPaymentSuccessUrl(customer.id, checkoutAppBaseUrl);
  const cancelUrl = buildPaymentCancelUrl(checkoutAppBaseUrl);
  let PAYMENT_ID = process.env.STRIPE_PREMIUM_PAYMENT_ID;

  if (paymentPlan === 'premium') {
    PAYMENT_ID = process.env.STRIPE_PREMIUM_PAYMENT_ID;
  } else if (paymentPlan === 'professional') {
    PAYMENT_ID = process.env.STRIPE_PROFESSIONAL_PAYMENT_ID;
  } else if (paymentPlan === 'creator') {
    PAYMENT_ID = process.env.STRIPE_CREATOR_PAYMENT_ID;
  }



  let sessionPayload = {
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [
      {
        price: PAYMENT_ID, // Replace with your price ID from Stripe Dashboard
        quantity: 1,
      },
    ],
    customer: customer.id,
    success_url: successUrl,
    cancel_url: cancelUrl,
  };

  // Add trial period if coupon is active and has redemptionMonths
  if (couponCodeData && redemptionMonths) {
    sessionPayload.subscription_data = {
      trial_period_days: redemptionMonths * 30, // Convert months to days
    };
  }

  // Handle percent discount by retrieving or creating a promotion code in Stripe
  if (couponCodeData && couponCodeData.redemptionType === 'percentage') {
    let promotionCode;

    // Check if a promotion code with this coupon ID already exists
    const existingPromotionCodes = await stripe.promotionCodes.list({
      code: couponCode,
      active: true,
    });

    if (existingPromotionCodes.data.length > 0) {
      promotionCode = existingPromotionCodes.data[0].id;
    } else {
      // Create a new promotion code with the discount coupon
      const stripeCoupon = await stripe.coupons.create({
        percent_off: couponCodeData.redemptionPercentage,
        duration: 'once',
      });

      const newPromotionCode = await stripe.promotionCodes.create({
        coupon: stripeCoupon.id,
        code: couponCode,
      });

      promotionCode = newPromotionCode.id;
    }

    sessionPayload.discounts = [
      {
        promotion_code: promotionCode,
      },
    ];
  }

  // Create a new subscription session for the customer
  const session = await stripe.checkout.sessions.create(sessionPayload);

  userData.stripePaymentId = session.id;

  userData.pendingPlanType = paymentPlan;

  await userData.save();

  return session;
}






export async function paymentSucceeded() {

}

export async function processStripePaymentWebhook(req) {
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);


  } catch (err) {
    console.error(' Webhook signature verification failed.', err.message);
    throw err;
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      // Handle successful checkout session
      handleCheckoutSessionCompleted(session);
      break;
    // Add additional event types here
    default:
      console.error(`Unhandled event type ${event.type}`);
  }

}



export async function generateStripeDiscountCoupon(payload) {
  await getDBConnectionString();

  // Generate a new coupon code if one is not provided
  const couponCode = payload.couponCode || generateCouponCode();
  const redemptionType = 'discount';
  const discountPercentage = 50;
  const discountRedemptionLimit = payload.redemptionLimit || 250; // Optional limit

  try {
    // Step 1: Create a 50% discount coupon in Stripe
    const stripeCoupon = await stripe.coupons.create({
      percent_off: discountPercentage,
      duration: 'once', // 'once', 'repeating', or 'forever' depending on your requirements
      id: couponCode,   // Use the generated code as the Stripe coupon ID
    });

    // Step 2: Create a promotion code with an optional redemption limit
    const promotionCodeData = {
      coupon: stripeCoupon.id,
      code: couponCode,
    };

    if (discountRedemptionLimit) {
      promotionCodeData.max_redemptions = discountRedemptionLimit;
    }



    const promotionCode = await stripe.promotionCodes.create(promotionCodeData);

    return promotionCode.code; // Return the generated coupon code
  } catch (error) {
    console.error('Error creating Stripe discount coupon:', error);
    throw new Error('Could not create discount coupon');
  }
}






function generateCouponCode() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}




export async function purchaseCreditsForUser(userId, payload = {}) {
  const amountCentsRaw = payload.amountCents ?? payload.amount_cents;
  const parsedAmountCents = Number(amountCentsRaw);
  const parsedAmountUsd = Number(payload.amount);
  const amountCents = Number.isFinite(parsedAmountCents)
    ? Math.round(parsedAmountCents)
    : Math.round(parsedAmountUsd * 100);

  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('Amount is required to purchase credits');
  }

  await getDBConnectionString();

  const userData = await User.findById(userId);
  if (!userData) {
    throw new Error('User not found');
  }

  const stripeCustomerId = await ensureStripeCustomerForUser(userData);
  const amountOfCreditsToPurchase = amountCents;

  const checkoutAppBaseUrl = resolveCheckoutAppBaseUrl(payload);
  const successUrl = buildPaymentSuccessUrl(stripeCustomerId, checkoutAppBaseUrl);
  const cancelUrl = buildPaymentCancelUrl(checkoutAppBaseUrl);

  const productSummary =
    payload.productSummary || `Purchase ${amountOfCreditsToPurchase} credits`;
  const metadataPayload = {};
  if (payload.metadata && typeof payload.metadata === 'object') {
    Object.entries(payload.metadata).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      metadataPayload[key] = String(value);
    });
  }
  if (!metadataPayload.productSummary) {
    metadataPayload.productSummary = productSummary;
  }
  if (!metadataPayload.creditsRequested) {
    metadataPayload.creditsRequested = amountOfCreditsToPurchase.toString();
  }
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [
      {
        price_data: {
          currency: 'usd',
          product_data: {
            name: productSummary,
          },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer: stripeCustomerId,
    metadata: metadataPayload,
  });

  await User.updateOne({ _id: userId }, { stripePaymentId: session.id });

  return {
    url: session.url,
    checkoutSessionId: session.id,
    paymentIntentId: session.payment_intent || null,
  };
}


export async function cancelSubscription(userId) {
  await getDBConnectionString();

  const userData = await User.findById(userId);
  if (!userData) {
    throw new Error('User not found');
  }

  if (!userData.stripeCustomerId) {
    throw new Error('User does not have a Stripe customer ID');
  }

  // Retrieve all subscriptions for the customer
  const subscriptions = await stripe.subscriptions.list({
    customer: userData.stripeCustomerId,
    status: 'all',
  });

  if (subscriptions.data.length === 0) {
    throw new Error('No active subscription found for this user');
  }

  // Assuming the user has only one active subscription, get the first one
  const subscriptionId = subscriptions.data[0].id;

  // Cancel the subscription
  const deletedSubscription = await stripe.subscriptions.cancel(subscriptionId);

  // Update the user data to reflect the cancellation
  await User.updateOne({ _id: userId }, {
    isPremiumUser: false,
    stripeSubscriptionId: null, // or remove the field if you prefer
  });

  return deletedSubscription;

}

export async function createPaymentPlanWithFreeTrial(userId) {

  // 1. Connect to the database
  await getDBConnectionString();

  // 2. Find the user
  const userData = await User.findById(userId);
  if (!userData) {
    throw new Error('User not found');
  }

  // 3. Prepare to create or fetch a Stripe customer
  let customer;
  let stripeCustomerExistedBefore = false;

  const customerPayload = {};
  if (userData.email) {
    customerPayload.email = userData.email;
  }
  if (userData.username) {
    customerPayload.name = userData.username;
  }

  // 4. Check if user already has a Stripe customer; if not, create one
  if (userData.stripeCustomerId) {
    try {
      customer = await stripe.customers.retrieve(userData.stripeCustomerId);
      if (!customer || customer.deleted) {
        // If the existing customer record is invalid or deleted, create a new one
        customer = await stripe.customers.create(customerPayload);
      } else {
        stripeCustomerExistedBefore = true;
      }
    } catch (err) {
      // If retrieve fails for any reason, create a new customer
      customer = await stripe.customers.create(customerPayload);
    }
  } else {
    // No existing Stripe customer ID, so create a new customer
    customer = await stripe.customers.create(customerPayload);
  }

  // 5. Update user with Stripe customer ID if it's newly created
  if (!stripeCustomerExistedBefore && customer.id) {
    userData.stripeCustomerId = customer.id;
  }

  // 6. Build the checkout session for a subscription with a 15-day trial
  const checkoutAppBaseUrl = resolveTrustedAppBaseUrl(null, CLIENT_APP);
  const successUrl = buildPaymentSuccessUrl(customer.id, checkoutAppBaseUrl);
  const cancelUrl = buildPaymentCancelUrl(checkoutAppBaseUrl);

  // Use your "creator" plan’s Price ID from Stripe
  const CREATOR_PRICE_ID = process.env.STRIPE_CREATOR_PAYMENT_ID;

  const sessionPayload = {
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [
      {
        price: CREATOR_PRICE_ID,
        quantity: 1,
      },
    ],
    customer: customer.id,
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: {
      // Set a 15-day free trial
      trial_period_days: 15,
    },
  };


  // 7. Create the Stripe Checkout Session
  const session = await stripe.checkout.sessions.create(sessionPayload);

  // 8. Store session info on the user for reference

  const stripePaymentId = session.id;
  userData.stripePaymentId = stripePaymentId;


  userData.pendingPlanType = 'creator';


  await userData.save();

  // 9. Return the session object (your frontend will need session.url for redirection)
  return session;
}



const handleCheckoutSessionCompleted = (session) => {
  // Fulfill the purchase

  // Here, you can update your database, send emails, etc.
};


export async function createUserPaymentRecord(payload = {}) {
  await getDBConnectionString();

  if (!payload.stripeInvoiceId && !payload.paymentIntentId) {
    console.error('createUserPaymentRecord called without invoice or payment intent id');
  }

  let resolvedUserId = payload.userId;

  if (!resolvedUserId && payload.stripeCustomerId) {
    const userRecord = await User.findOne({ stripeCustomerId: payload.stripeCustomerId }).select('_id');
    if (userRecord?._id) {
      resolvedUserId = userRecord._id;
    }
  }

  if (!resolvedUserId) {
    console.error(`Unable to resolve user for payment record. stripeCustomerId=${payload.stripeCustomerId}`);
    return null;
  }

  const paymentDate = payload.paymentDate ? new Date(payload.paymentDate) : new Date();

  const recordPayload = {
    userId: resolvedUserId,
    ...(payload.stripeCustomerId ? { stripeCustomerId: payload.stripeCustomerId } : {}),
    ...(payload.stripeInvoiceId ? { stripeInvoiceId: payload.stripeInvoiceId } : {}),
    ...(payload.stripeInvoiceNumber ? { stripeInvoiceNumber: payload.stripeInvoiceNumber } : {}),
    ...(payload.paymentIntentId ? { paymentIntentId: payload.paymentIntentId } : {}),
    amountPaidCents: payload.amountPaidCents ?? payload.amount ?? 0,
    currency: (payload.currency || 'usd').toLowerCase(),
    paymentType: payload.paymentType || payload.billingReason || 'invoice',
    paymentStatus: payload.paymentStatus,
    billingReason: payload.billingReason,
    productSummary: payload.productSummary,
    paymentDate,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    creditsApplied: payload.creditsApplied ?? 0,
    invoicePdfUrl: payload.invoicePdfUrl,
    hostedInvoiceUrl: payload.hostedInvoiceUrl,
    receiptUrl: payload.receiptUrl,
    receiptS3Key: payload.receiptS3Key,
    receiptS3Bucket: payload.receiptS3Bucket,
    metadata: payload.metadata,
  };

  const filter = {};
  if (recordPayload.stripeInvoiceId) {
    filter.stripeInvoiceId = recordPayload.stripeInvoiceId;
  } else if (recordPayload.paymentIntentId) {
    filter.paymentIntentId = recordPayload.paymentIntentId;
  }

  if (Object.keys(filter).length === 0) {
    const paymentRecord = new UserPayment(recordPayload);
    await paymentRecord.save();
    return paymentRecord;
  }

  const updatedRecord = await UserPayment.findOneAndUpdate(
    filter,
    { $set: recordPayload },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  return updatedRecord;
}

export async function getUserPaymentHistory(userId, options = {}) {
  await getDBConnectionString();

  const limitNumber = parseInt(options.limit ?? 25, 10);
  const limit = Number.isNaN(limitNumber) ? 25 : Math.min(Math.max(limitNumber, 1), 100);

  const paymentRecords = await UserPayment
    .find({ userId })
    .sort({ paymentDate: -1, createdAt: -1 })
    .limit(limit)
    .lean();

  return paymentRecords.map((payment) => ({
    id: payment._id,
    amountPaidCents: payment.amountPaidCents ?? 0,
    currency: payment.currency?.toUpperCase() ?? 'USD',
    paymentType: payment.paymentType,
    paymentStatus: payment.paymentStatus,
    billingReason: payment.billingReason,
    creditsApplied: payment.creditsApplied ?? 0,
    paymentDate: payment.paymentDate || payment.createdAt,
    stripeInvoiceId: payment.stripeInvoiceId,
    stripeInvoiceNumber: payment.stripeInvoiceNumber,
    invoicePdfUrl: payment.invoicePdfUrl,
    hostedInvoiceUrl: payment.hostedInvoiceUrl,
    receiptUrl: payment.receiptUrl || payment.invoicePdfUrl || payment.hostedInvoiceUrl,
    receiptAvailable: !!(
      payment.receiptS3Key ||
      payment.receiptUrl ||
      payment.invoicePdfUrl ||
      payment.hostedInvoiceUrl
    ),
    productSummary: payment.productSummary,
    periodStart: payment.periodStart,
    periodEnd: payment.periodEnd,
  }));
}
