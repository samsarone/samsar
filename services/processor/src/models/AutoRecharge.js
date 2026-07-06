import Stripe from 'stripe';
import 'dotenv/config';

import User from '../schema/User.js';
import UserPayment from '../schema/UserPayment.js';
import { getDBConnectionString } from './DBString.js';
import { createUserPaymentRecord } from './Payment.js';
import { createInvoiceNotificationFromInvoice } from './InvoiceNotification.js';
import { storeStripeReceiptPdf } from './Receipt.js';
import { creditGenerationCredits } from './GenerationCredits.js';
import {
  buildAppUrl,
  getBillingPortalUrl,
  resolveBillingPathForApp,
  resolveTrustedAppBaseUrl,
  sanitizeInternalPath,
} from './BillingPortal.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const CLIENT_APP_DEFAULT = 'http://localhost:5173';
const CLIENT_APP = process.env.CLIENT_APP || process.env.CLIENT_APP_LOCAL || CLIENT_APP_DEFAULT;
const BILLING_PORTAL_URL = getBillingPortalUrl();
const ENABLE_AUTORECHARGE_ENDPOINT = '/v1/enable_autorecharge';
const UPDATE_AUTORECHARGE_THRESHOLD_ENDPOINT = '/v1/auto_recharge/threshold';

// Business rule: auto-recharge grants 100 credits per USD.
const AUTO_RECHARGE_CREDITS_PER_DOLLAR = 100;
const AUTO_RECHARGE_CREDITS_PER_CENT = AUTO_RECHARGE_CREDITS_PER_DOLLAR / 100;

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed)) return parsed;
  return fallback;
};

const centsToCredits = (amountPaidCents = 0) => {
  const cents = toNumber(amountPaidCents, 0);
  return Math.max(0, Math.floor(cents * AUTO_RECHARGE_CREDITS_PER_CENT));
};

const isAutoRechargeMetadata = (metadata) =>
  metadata?.autoRecharge === 'true' || metadata?.autoRecharge === true;

const buildAutoRechargeSkipMessage = (reason) => {
  if (reason === 'disabled') {
    return `Auto-recharge is disabled. Please call ${ENABLE_AUTORECHARGE_ENDPOINT} or visit ${BILLING_PORTAL_URL} to enable auto-recharge.`;
  }
  if (reason === 'threshold_not_met') {
    return `Auto-recharge threshold not reached. Please call ${UPDATE_AUTORECHARGE_THRESHOLD_ENDPOINT} or visit ${BILLING_PORTAL_URL} to update your auto-recharge threshold.`;
  }
  if (reason === 'monthly_cap_reached') {
    return `Auto-recharge monthly cap reached. Please call ${ENABLE_AUTORECHARGE_ENDPOINT} or visit ${BILLING_PORTAL_URL} to update auto-recharge settings.`;
  }
  if (reason === 'auto_recharge_in_progress') {
    return 'Auto-recharge already in progress. Please retry shortly.';
  }
  return null;
};

const clearPendingAutoRechargeItems = async (customerId) => {
  try {
    let startingAfter;
    do {
      const response = await stripe.invoiceItems.list({
        customer: customerId,
        pending: true,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      const itemsToDelete = response.data.filter((item) => isAutoRechargeMetadata(item?.metadata));
      if (itemsToDelete.length > 0) {
        await Promise.all(itemsToDelete.map((item) => stripe.invoiceItems.del(item.id)));
      }
      if (!response.has_more) break;
      startingAfter = response.data[response.data.length - 1]?.id;
    } while (startingAfter);
  } catch (err) {
    console.error('Failed to clear pending auto-recharge items:', err.message);
  }
};

const buildCustomerPayload = (user) => {
  const payload = {};
  if (user.email) payload.email = user.email;
  if (user.username) payload.name = user.username;
  return payload;
};

const ensureStripeCustomerForUser = async (user) => {
  let customerId = user.stripeCustomerId;
  const payload = buildCustomerPayload(user);

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
    await User.updateOne({ _id: user._id }, { stripeCustomerId: customerId });
  }

  return customerId;
};

const getClientAppUrl = () => resolveTrustedAppBaseUrl(CLIENT_APP, CLIENT_APP_DEFAULT);

export async function createAutoRechargeSetupSession(userOrUserId, options = {}) {
  await getDBConnectionString();
  const user =
    typeof userOrUserId === 'string'
      ? await User.findById(userOrUserId)
      : userOrUserId;

  if (!user) {
    throw new Error('User not found');
  }

  const customerId = await ensureStripeCustomerForUser(user);

  const requestedBaseUrl = options?.redirectBaseUrl || options?.returnBaseUrl || options?.appBaseUrl;
  const clientAppUrl = resolveTrustedAppBaseUrl(requestedBaseUrl, getClientAppUrl());
  const fallbackBillingPath = resolveBillingPathForApp(clientAppUrl);
  const billingReturnPath = sanitizeInternalPath(
    options?.billingReturnPath || options?.returnPath || options?.redirectPath,
    fallbackBillingPath
  );
  const successUrl = buildAppUrl(clientAppUrl, billingReturnPath, { setup: 'success' });
  const cancelUrl = buildAppUrl(clientAppUrl, billingReturnPath, { setup: 'cancel' });

  const session = await stripe.checkout.sessions.create({
    mode: 'setup',
    payment_method_types: ['card'],
    customer: customerId,
    client_reference_id: user._id.toString(),
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      intent: 'auto_recharge_setup',
      userId: user._id.toString(),
    },
  });

  return session;
}

export async function saveAutoRechargeSettings(userId, payload = {}) {
  await getDBConnectionString();
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const thresholdCredits = Math.max(0, toNumber(payload.thresholdCredits ?? payload.autoRechargeThreshold, 0));
  const amountUsd = Math.max(0, toNumber(payload.amountUsd ?? payload.autoRechargeAmountUsd, 0));
  const maxMonthlyUsdInput =
    payload.maxMonthlyUsd ??
    payload.maxMonthlyAmountUsd ??
    payload.autoRechargeMaxMonthlyUsd ??
    payload.autoRechargeMaxMonthlyAmountUsd ??
    payload.maxMonthlyTopupUsd ??
    payload.maxMonthlyTopUpUsd ??
    payload.maxMonthlyTopupAmountUsd ??
    payload.maxMonthlyTopUpAmountUsd ??
    payload.maxMonthlyRechargeUsd ??
    payload.maxMonthlyRechargeAmountUsd ??
    payload.monthlyCapUsd ??
    payload.monthlyCap;
  const maxMonthlyCreditsInput =
    payload.maxMonthlyCredits ??
    payload.maxMonthlyCreditsToRecharge ??
    payload.maxMonthlyTopupCredits ??
    payload.maxMonthlyTopUpCredits;
  let maxMonthlyUsd = toNumber(maxMonthlyUsdInput, Number.NaN);
  if (!Number.isFinite(maxMonthlyUsd) && maxMonthlyCreditsInput != null) {
    const creditsValue = toNumber(maxMonthlyCreditsInput, Number.NaN);
    if (Number.isFinite(creditsValue)) {
      maxMonthlyUsd = creditsValue / 100;
    }
  }
  maxMonthlyUsd = Math.max(0, Number.isFinite(maxMonthlyUsd) ? maxMonthlyUsd : 0);
  const enabledInput = payload.enabled ?? payload.autoRechargeEnabled;
  const enabled = enabledInput === undefined ? user.autoRechargeEnabled : !!enabledInput;
  const requestSetupSession = !!payload.requestSetupSession;
  const paymentMethodId = payload.paymentMethodId;

  const stripeCustomerId = await ensureStripeCustomerForUser(user);

  if (paymentMethodId) {
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
    user.autoRechargePaymentMethodId = paymentMethodId;
    user.autoRechargeSetupAt = new Date();
  }

  user.autoRechargeThreshold = thresholdCredits;
  user.autoRechargeAmountUsd = amountUsd;
  user.autoRechargeMaxMonthlyUsd = maxMonthlyUsd;
  user.autoRechargeEnabled = enabled && !!user.autoRechargePaymentMethodId;

  await user.save();

  let setupSessionUrl = null;
  let setupSessionId = null;
  let setupIntentId = null;
  if (requestSetupSession || (enabled && !user.autoRechargePaymentMethodId)) {
    const session = await createAutoRechargeSetupSession(user, {
      redirectBaseUrl: payload.redirectBaseUrl || payload.returnBaseUrl || payload.appBaseUrl,
      billingReturnPath: payload.billingReturnPath || payload.returnPath || payload.redirectPath,
    });
    setupSessionUrl = session.url;
    setupSessionId = session.id || null;
    setupIntentId = session.setup_intent || null;
  }

  let autoRechargeRun = null;
  const shouldAttemptAutoRecharge =
    user.autoRechargeEnabled &&
    user.autoRechargePaymentMethodId &&
    amountUsd > 0 &&
    !setupSessionUrl;

  if (shouldAttemptAutoRecharge) {
    try {
      autoRechargeRun = await checkAndTriggerAutoRecharge(userId, {
        thresholdCredits,
        amountUsd,
      });
    } catch (err) {
      autoRechargeRun = { status: 'error', reason: err.message };
    }
  }

  return {
    autoRechargeEnabled: user.autoRechargeEnabled,
    autoRechargeAmountUsd: user.autoRechargeAmountUsd,
    autoRechargeThreshold: user.autoRechargeThreshold,
    autoRechargeMaxMonthlyUsd: user.autoRechargeMaxMonthlyUsd,
    stripeCustomerId,
    setupSessionUrl,
    setupSessionId,
    setupIntentId,
    hasPaymentMethod: !!user.autoRechargePaymentMethodId,
    autoRechargeRun,
  };
}

export async function updateAutoRechargeThreshold(userId, payload = {}) {
  await getDBConnectionString();
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  if (!user.autoRechargeEnabled) {
    const err = new Error('Auto-recharge is not enabled.');
    err.code = 'AUTO_RECHARGE_DISABLED';
    err.statusCode = 400;
    throw err;
  }

  const thresholdRaw =
    payload.thresholdCredits ??
    payload.threshold_credits ??
    payload.autoRechargeThreshold ??
    payload.rechargeBelowThreshold ??
    payload.recharge_below_threshold ??
    payload.threshold ??
    payload.rechargeThreshold ??
    payload.recharge_threshold;

  const parsedThreshold = Number(thresholdRaw);
  if (!Number.isFinite(parsedThreshold) || parsedThreshold < 0) {
    const err = new Error('thresholdCredits is required and must be a non-negative number.');
    err.code = 'INVALID_THRESHOLD';
    err.statusCode = 400;
    throw err;
  }

  user.autoRechargeThreshold = Math.max(0, parsedThreshold);
  await user.save();

  return {
    autoRechargeEnabled: user.autoRechargeEnabled,
    autoRechargeThreshold: user.autoRechargeThreshold,
    autoRechargeAmountUsd: user.autoRechargeAmountUsd,
    autoRechargeMaxMonthlyUsd: user.autoRechargeMaxMonthlyUsd,
  };
}

export async function checkAndTriggerAutoRecharge(userId, options = {}) {
  await getDBConnectionString();
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const force = !!options.force;
  const thresholdCredits = Math.max(0, toNumber(options.thresholdCredits ?? user.autoRechargeThreshold, 0));
  const configuredAmountUsd = Math.max(0, toNumber(user.autoRechargeAmountUsd, 0));
  const requestedAmountUsd = Math.max(0, toNumber(options.amountUsd ?? configuredAmountUsd, 0));
  let amountUsd = configuredAmountUsd > 0
    ? Math.min(requestedAmountUsd, configuredAmountUsd)
    : requestedAmountUsd;

  if (!force && !user.autoRechargeEnabled) {
    return {
      status: 'skipped',
      reason: 'disabled',
      message: buildAutoRechargeSkipMessage('disabled'),
    };
  }

  if (!force && thresholdCredits > 0 && (user.generationCredits ?? 0) >= thresholdCredits) {
    return {
      status: 'skipped',
      reason: 'threshold_not_met',
      message: buildAutoRechargeSkipMessage('threshold_not_met'),
    };
  }

  if (!amountUsd) {
    throw new Error('Auto-recharge amount is required');
  }

  if (!user.autoRechargePaymentMethodId) {
    throw new Error('Add a payment method to enable auto-recharge.');
  }

  const maxMonthlyUsd = Math.max(0, toNumber(options.maxMonthlyUsd ?? user.autoRechargeMaxMonthlyUsd, 0));
  if (maxMonthlyUsd > 0) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const monthRange = { $gte: monthStart, $lt: nextMonthStart };
    const monthlyTotals = await UserPayment.aggregate([
      {
        $match: {
          userId: user._id,
          paymentType: 'auto_recharge',
          $or: [
            { paymentDate: monthRange },
            { paymentDate: { $exists: false }, createdAt: monthRange },
            { paymentDate: null, createdAt: monthRange },
          ],
        },
      },
      { $group: { _id: null, total: { $sum: '$amountPaidCents' } } },
    ]);
    const monthPaidCents = Math.max(0, Math.round(monthlyTotals?.[0]?.total || 0));
    const maxMonthlyCents = Math.max(0, Math.round(maxMonthlyUsd * 100));
    const remainingCents = maxMonthlyCents - monthPaidCents;
    if (remainingCents <= 0) {
      return {
        status: 'skipped',
        reason: 'monthly_cap_reached',
        message: buildAutoRechargeSkipMessage('monthly_cap_reached'),
        maxMonthlyUsd,
        monthlyTotalUsd: Number((monthPaidCents / 100).toFixed(2)),
      };
    }
    const requestedCents = Math.round(amountUsd * 100);
    if (requestedCents > remainingCents) {
      amountUsd = remainingCents / 100;
      if (amountUsd <= 0) {
        return {
          status: 'skipped',
          reason: 'monthly_cap_reached',
          message: buildAutoRechargeSkipMessage('monthly_cap_reached'),
          maxMonthlyUsd,
          monthlyTotalUsd: Number((monthPaidCents / 100).toFixed(2)),
        };
      }
    }
  }

  const now = new Date();
  const lockUntil = new Date(Date.now() + 5 * 60 * 1000);
  const lockResult = await User.updateOne(
    {
      _id: user._id,
      $or: [
        { autoRechargeLockUntil: { $exists: false } },
        { autoRechargeLockUntil: null },
        { autoRechargeLockUntil: { $lte: now } },
      ],
    },
    { autoRechargeLockUntil: lockUntil }
  );
  if (!force && lockResult.matchedCount === 0) {
    return {
      status: 'skipped',
      reason: 'auto_recharge_in_progress',
      message: buildAutoRechargeSkipMessage('auto_recharge_in_progress'),
    };
  }

  try {
    const stripeCustomerId = await ensureStripeCustomerForUser(user);

    await clearPendingAutoRechargeItems(stripeCustomerId);

    const amountCents = Math.round(amountUsd * 100);
    const creditsToAdd = Math.max(0, Math.round(amountUsd * AUTO_RECHARGE_CREDITS_PER_DOLLAR));
    const metadata = {
      autoRecharge: 'true',
      userId: user._id.toString(),
      autoRechargeAmountUsd: amountUsd.toString(),
      creditsToAdd: creditsToAdd.toString(),
    };

    const description = options.description || `Auto-recharge ${creditsToAdd} credits`;

    let invoice = await stripe.invoices.create({
      customer: stripeCustomerId,
      collection_method: 'charge_automatically',
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      metadata,
      description,
    });

    await stripe.invoiceItems.create({
      customer: stripeCustomerId,
      amount: amountCents,
      currency: 'usd',
      description,
      metadata,
      invoice: invoice.id,
    });

    if (invoice.status === 'draft') {
      invoice = await stripe.invoices.finalizeInvoice(invoice.id);
    }

    if (invoice.status !== 'paid') {
      invoice = await stripe.invoices.pay(invoice.id, {
        payment_method: user.autoRechargePaymentMethodId,
        off_session: true,
      });
    }

    await User.updateOne(
      { _id: user._id },
      {
        autoRechargeLastRunAt: new Date(),
        autoRechargeLastInvoiceId: invoice.id,
        autoRechargeLockUntil: null,
      }
    );

    return {
      status: invoice.status,
      invoiceId: invoice.id,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
      creditsToAdd,
    };
  } catch (err) {
    await User.updateOne({ _id: user._id }, { autoRechargeLockUntil: null });
    throw err;
  }
}

export async function cancelAutoRecharge(userId) {
  await getDBConnectionString();
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  user.autoRechargeEnabled = false;
  user.autoRechargeLockUntil = null;
  user.autoRechargePaymentMethodId = null;
  user.autoRechargeSetupAt = null;
  user.autoRechargeLastRunAt = null;
  user.autoRechargeLastInvoiceId = null;
  await user.save();

  return {
    autoRechargeEnabled: false,
    autoRechargeLockUntil: null,
    autoRechargePaymentMethodId: null,
  };
}

export async function handleAutoRechargeInvoicePayment(invoice, user) {
  await getDBConnectionString();

  const amountPaidCents = Math.max(0, Math.round(toNumber(invoice?.amount_paid, 0)));
  const amountUsdFromMetadata = invoice?.metadata?.autoRechargeAmountUsd;
  const expectedAmountCents = amountUsdFromMetadata != null
    ? Math.max(0, Math.round(toNumber(amountUsdFromMetadata, 0) * 100))
    : null;
  const creditedAmountCents =
    expectedAmountCents != null
      ? Math.min(amountPaidCents, expectedAmountCents)
      : amountPaidCents;
  const creditsToAdd = centsToCredits(creditedAmountCents);

  const existingPayment = await UserPayment.findOne({ stripeInvoiceId: invoice.id })
    .select('creditsApplied')
    .lean();
  const creditsAlreadyApplied = existingPayment?.creditsApplied > 0;
  const creditsForRecord = invoice?.status === 'paid' ? creditsToAdd : 0;
  const shouldApplyCredits =
    creditsForRecord > 0 && !creditsAlreadyApplied;

  const invoicePdfUrl = invoice?.invoice_pdf || null;
  const hostedInvoiceUrl = invoice?.hosted_invoice_url || null;
  let receiptUrl = invoicePdfUrl || hostedInvoiceUrl;
  if (invoice?.charge) {
    try {
      const charge = await stripe.charges.retrieve(invoice.charge);
      if (charge?.receipt_url) {
        receiptUrl = charge.receipt_url;
      }
    } catch (err) {
      console.error('Failed to load Stripe charge receipt URL:', err.message);
    }
  }
  const receiptStorage = await storeStripeReceiptPdf({
    receiptUrl: invoicePdfUrl || hostedInvoiceUrl,
    receiptId: invoice.id,
  });

  const invoicePaymentIntentId =
    typeof invoice.payment_intent === 'string'
      ? invoice.payment_intent
      : invoice.payment_intent?.id || null;

  const paymentRecord = await createUserPaymentRecord({
    userId: user._id,
    stripeCustomerId: invoice.customer,
    stripeInvoiceId: invoice.id,
    stripeInvoiceNumber: invoice.number,
    paymentIntentId: invoicePaymentIntentId,
    amountPaidCents: invoice.amount_paid,
    currency: invoice.currency,
    paymentType: 'auto_recharge',
    paymentStatus: invoice.status,
    billingReason: invoice.billing_reason || 'auto_recharge',
    productSummary: invoice.lines?.data?.[0]?.description || 'Auto-recharge credits',
    paymentDate: new Date(),
    creditsApplied: creditsAlreadyApplied ? existingPayment.creditsApplied : 0,
    invoicePdfUrl,
    hostedInvoiceUrl,
    receiptUrl,
    receiptS3Key: receiptStorage.receiptS3Key,
    receiptS3Bucket: receiptStorage.receiptS3Bucket,
    metadata: invoice.metadata,
  });

  let creditsApplied = creditsAlreadyApplied ? existingPayment.creditsApplied : 0;
  if (shouldApplyCredits && paymentRecord?._id) {
    const creditResult = await applyCreditsOnceForInvoice({
      userId: user._id,
      paymentRecordId: paymentRecord._id,
      creditsToApply: creditsForRecord,
      metadata: {
        stripeInvoiceId: invoice.id,
        paymentIntentId: invoicePaymentIntentId,
        amountPaidCents,
        creditedAmountCents,
      },
    });
    if (creditResult.applied) {
      creditsApplied = creditsForRecord;
    }
  }

  const updatePayload = {
    $set: {
      autoRechargeLockUntil: null,
      autoRechargeLastInvoiceId: invoice.id,
      autoRechargeLastRunAt: new Date(),
    },
  };

  await User.updateOne({ _id: user._id }, updatePayload);

  try {
    await createInvoiceNotificationFromInvoice({
      invoice,
      user,
      creditsApplied,
      paymentType: 'auto_recharge',
      receiptUrl,
      receiptS3Key: receiptStorage.receiptS3Key,
      receiptS3Bucket: receiptStorage.receiptS3Bucket,
    });
  } catch (err) {
    console.error('Failed to create invoice notification:', err.message);
  }

  return creditsToAdd;
}

async function applyCreditsOnceForInvoice({ userId, paymentRecordId, creditsToApply, metadata }) {
  const credits = Number(creditsToApply);
  if (!userId || !paymentRecordId || !Number.isFinite(credits) || credits <= 0) {
    return { applied: false };
  }

  const claimResult = await UserPayment.updateOne(
    { _id: paymentRecordId, creditsApplied: { $lte: 0 } },
    { $set: { creditsApplied: credits } }
  );

  if (!claimResult || claimResult.modifiedCount === 0) {
    return { applied: false };
  }

  try {
    await creditGenerationCredits(userId, credits, {
      source: 'auto_recharge',
      metadata,
    });
    return { applied: true, creditsApplied: credits };
  } catch (err) {
    try {
      await UserPayment.updateOne(
        { _id: paymentRecordId, creditsApplied: credits },
        { $set: { creditsApplied: 0 } }
      );
    } catch (rollbackErr) {
      console.error('Failed to roll back creditsApplied after credit error:', rollbackErr.message);
    }
    throw err;
  }
}

export async function maybeTriggerAutoRecharge(userId) {
  try {
    const result = await checkAndTriggerAutoRecharge(userId, { force: false });
    return result;
  } catch (err) {
    console.error(`Auto-recharge check failed for user ${userId}: ${err.message}`);
    return { status: 'error', reason: err.message };
  }
}
