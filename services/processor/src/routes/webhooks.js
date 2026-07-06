import express from 'express';
import 'dotenv/config';
import { processStripePaymentWebhook } from '../models/Payment.js';
import Stripe from 'stripe';
import User from '../schema/User.js';
import UserPayment from '../schema/UserPayment.js';
import {
  createUserPaymentRecord,
  isAnonymousCreditPurchaseSession,
  resolveAnonymousCreditPurchaseUserFromSession,
} from '../models/Payment.js';
import { creditGenerationCredits } from '../models/GenerationCredits.js';
import { handleAutoRechargeInvoicePayment, checkAndTriggerAutoRecharge } from '../models/AutoRecharge.js';
import NotificationMailer from '../schema/NotificationMailer.js';
import { storeStripeReceiptPdf } from '../models/Receipt.js';

import { getDBConnectionString } from '../models/DBString.js';
import GenerationCreditTransaction from '../schema/GenerationCreditTransaction.js';
import {
  findExternalPaymentForInternalUser,
  markExternalPaymentResolved,
} from '../models/external/User.js';
import {
  deliverV2UserRechargeSuccessCallback,
  ensureV2UserRechargeUserFromSession,
  isV2UserRechargeCheckoutSession,
} from '../models/api/UserRechargeAPI.js';


const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();
const AUTO_RECHARGE_INTENT = 'auto_recharge_setup';
const SEND_RECEIPT_EMAILS = process.env.SAMSAR_SEND_RECEIPT_EMAILS === 'true';
const CREDIT_PURCHASE_ADMIN_EMAIL =
  process.env.SAMSAR_CREDIT_PURCHASE_ADMIN_EMAIL ||
  process.env.SAMSAR_ADMIN_EMAIL ||
  process.env.NEWSLETTER_ADMIN_EMAIL ||
  'roy@samsar.one';

// Use express.raw for the webhook endpoint
router.post('/stripe_payment_webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  await getDBConnectionString();

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;

      const { customer_details, mode } = session;

      const email = customer_details.email;
      const stripePaymentId = session.id;

      if (mode === 'subscription') {
        try {
          let currentUser = await User.findOne({ stripePaymentId });

          const userPendingPlanType = currentUser.pendingPlanType;






          if (!currentUser) {
            return res.status(404).send("User not found");
          }

          let amountPaid = parseInt(session.amount_total); // This is in cents

          let amountSubtotal = parseInt(session.amount_subtotal); // This is in cents

          if (amountSubtotal > amountPaid) {
            amountPaid = amountSubtotal;
          }

          let premiumUserType = 'creator';
          let creditsToAdd = 0;

          let updateData = {

          };


          updateData = {
            ...updateData,
            premiumUserCreditsLastUpdated: new Date(),
            premiumUserType: premiumUserType,
            pendingPlanType: null,
          };



          if (!currentUser.isPremiumUser) {
            updateData.isPremiumUser = true;
            updateData.premiumUserAdded = new Date();
          }

          if (!currentUser.email) {
            updateData.email = email;
          }

          await User.updateOne({ _id: currentUser._id }, { $set: updateData });

          if (creditsToAdd > 0) {
            const existingCredit = await hasCreditTransaction({
              userId: currentUser._id,
              source: 'subscription_signup',
              metadataKey: 'checkoutSessionId',
              metadataValue: session.id,
            });
            if (!existingCredit) {
              await creditGenerationCredits(currentUser._id, creditsToAdd, {
                source: 'subscription_signup',
                metadata: {
                  checkoutSessionId: session.id,
                  paymentType: 'subscription',
                  amountPaidCents: amountPaid,
                },
              });
            }
          }

          // Handle successful checkout session
          await handleCheckoutSessionCompleted(session);
        } catch (err) {
          console.error('Error handling checkout.session.completed:', err.message);
          return res.status(500).send(`Error: ${err.message}`);
        }
      } else if (mode === 'payment') {
        try {


          let currentUser = await User.findOne({ stripePaymentId });

          const customerMetadata = event.data.object.metadata;
          const isAnonymousCreditPurchase = isAnonymousCreditPurchaseSession(session);
          const isV2UserRecharge = isV2UserRechargeCheckoutSession(session);


          let newUserCreatedForCheckout = false;

          if (isV2UserRecharge) {
            const resolvedUser = await ensureV2UserRechargeUserFromSession(session);
            currentUser = resolvedUser?.user || currentUser;
            newUserCreatedForCheckout = Boolean(resolvedUser?.created);
          }

          if (isAnonymousCreditPurchase) {
            const resolvedUser = await resolveAnonymousCreditPurchaseUserFromSession(session);
            currentUser = resolvedUser?.user || currentUser;
            newUserCreatedForCheckout = Boolean(resolvedUser?.created);
          }

          const amountPaid = parseInt(session.amount_total); // This is in cents
          const metadataCredits = Number(customerMetadata?.creditsRequested);
          const credits = (isAnonymousCreditPurchase || isV2UserRecharge)
            && Number.isFinite(metadataCredits) && metadataCredits > 0
            ? Math.round(metadataCredits)
            : Math.max(0, Math.round(amountPaid));



          if (!currentUser) {
            return res.status(404).send("User not found");
          }

          const paymentDate = session.created ? new Date(session.created * 1000) : new Date();
          const receiptDetails = await resolveCheckoutReceiptDetails(session);
          const receiptUrl = receiptDetails.receiptUrl;
          const sessionPaymentIntentId =
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id || null;
          const paymentIntentId =
            receiptDetails.paymentIntentId || sessionPaymentIntentId || null;
          const existingPayment = await findExistingPaymentRecord({
            stripeInvoiceId: receiptDetails.stripeInvoiceId,
            paymentIntentId,
          });
          const existingExternalPayment = await findExternalPaymentForInternalUser({
            internalUserId: currentUser._id?.toString?.() || currentUser._id,
            checkoutSessionId: session.id,
            paymentIntentId,
          });
          const isExternalTopUp = Boolean(
            existingExternalPayment ||
            session?.metadata?.billingScope === 'external_user' ||
            session?.metadata?.externalIdentityKey ||
            session?.metadata?.externalUserId ||
            session?.metadata?.externalUserExternalId,
          );
          const creditsAlreadyApplied = isExternalTopUp
            ? (Number(existingExternalPayment?.creditsApplied) || 0) > 0
            : existingPayment?.creditsApplied > 0;
          const existingExternalCreditsApplied = Number(existingExternalPayment?.creditsApplied) || 0;
          const creditsForRecord = session.payment_status === 'paid' ? credits : 0;
          if (
            creditsForRecord > 0 &&
            !receiptDetails.stripeInvoiceId &&
            !paymentIntentId
          ) {
            console.error('Missing Stripe payment identifiers for checkout session credits', {
              sessionId: session.id,
            });
            return res.status(500).send('Missing Stripe payment identifiers');
          }

          if (!currentUser.email && email) {
            await User.updateOne(
              { _id: currentUser._id },
              { $set: { email } },
            );
          }
          const receiptStorage = await storeStripeReceiptPdf({
            receiptUrl,
            receiptId: receiptDetails.receiptId || paymentIntentId || session.id,
          });

          const paymentRecord = await createUserPaymentRecord({
            userId: currentUser._id,
            stripeCustomerId: session.customer,
            stripeInvoiceId: receiptDetails.stripeInvoiceId,
            stripeInvoiceNumber: receiptDetails.stripeInvoiceNumber,
            paymentIntentId,
            amountPaidCents: amountPaid,
            currency: session.currency,
            paymentType: 'one_time',
            paymentStatus: session.payment_status,
            billingReason: 'one_time',
            productSummary: session.metadata?.productSummary || 'Credit purchase',
            paymentDate,
            creditsApplied:
              !isExternalTopUp && creditsAlreadyApplied
                ? existingPayment.creditsApplied
                : 0,
            invoicePdfUrl: receiptDetails.invoicePdfUrl,
            hostedInvoiceUrl: receiptDetails.hostedInvoiceUrl,
            receiptUrl,
            receiptS3Key: receiptStorage.receiptS3Key,
            receiptS3Bucket: receiptStorage.receiptS3Bucket,
            metadata: session.metadata,
          });

          let creditsApplied = isExternalTopUp
            ? Number(existingExternalPayment?.creditsApplied) || 0
            : (creditsAlreadyApplied ? existingPayment.creditsApplied : 0);
          const creditPurchaseSource = isAnonymousCreditPurchase
            ? 'anonymous_credit_purchase'
            : (isV2UserRecharge ? 'v2_user_recharge' : 'topup');

          if (!isExternalTopUp && !creditsAlreadyApplied && creditsForRecord > 0 && paymentRecord?._id) {
            const creditResult = await applyCreditsOnce({
              userId: currentUser._id,
              paymentRecordId: paymentRecord._id,
              creditsToApply: creditsForRecord,
              source: creditPurchaseSource,
              metadata: {
                paymentIntentId,
                stripeInvoiceId: receiptDetails.stripeInvoiceId,
                paymentType: 'one_time',
                amountPaidCents: amountPaid,
                intent: customerMetadata?.intent,
              },
            });
            if (creditResult.applied) {
              creditsApplied = creditsForRecord;
              await queueCreditPurchaseAdminAlert({
                user: currentUser,
                customerEmail: email,
                amountPaidCents: amountPaid,
                currency: session.currency,
                paymentDate,
                creditsApplied,
                productSummary: session.metadata?.productSummary || 'Credit purchase',
                paymentStatus: session.payment_status,
                checkoutSessionId: session.id,
                stripeCustomerId:
                  typeof session.customer === 'string' ? session.customer : session.customer?.id,
                stripeInvoiceId: receiptDetails.stripeInvoiceId,
                stripeInvoiceNumber: receiptDetails.stripeInvoiceNumber,
                paymentIntentId,
                source: creditPurchaseSource,
                newUserCreatedForCheckout,
              });
            }
          }
          if (isExternalTopUp && creditsForRecord > 0) {
            creditsApplied = Number(existingExternalPayment?.creditsApplied) || creditsForRecord;
          }

          await queuePaymentReceiptEmail({
            user: currentUser,
            recipientEmail: currentUser.email || email,
            chargeType: 'one_time_purchase',
            paymentType: 'one_time',
            amountPaidCents: amountPaid,
            currency: session.currency,
            paymentDate,
            billingReason: 'one_time',
            productSummary: session.metadata?.productSummary || 'Credit purchase',
            creditsApplied,
            paymentStatus: session.payment_status,
            stripeInvoiceId: receiptDetails.stripeInvoiceId,
            stripeInvoiceNumber: receiptDetails.stripeInvoiceNumber,
            paymentIntentId,
            receiptUrl,
            receiptS3Key: receiptStorage.receiptS3Key,
            receiptS3Bucket: receiptStorage.receiptS3Bucket,
            hostedInvoiceUrl: receiptDetails.hostedInvoiceUrl,
            invoicePdfUrl: receiptDetails.invoicePdfUrl,
          });

          const resolvedExternalPayment = await markExternalPaymentResolved({
            internalUserId: currentUser._id?.toString?.() || currentUser._id,
            checkoutSessionId: session.id,
            paymentIntentId,
            status: session.payment_status === 'paid' ? 'succeeded' : 'pending',
            creditsApplied: creditsForRecord,
            responsePayload: {
              status: session.payment_status === 'paid' ? 'succeeded' : 'pending',
              mode: 'payment',
              checkoutSessionId: session.id,
              paymentIntentId,
              paymentStatus: session.payment_status,
              amountCents: amountPaid,
              currency: session.currency,
            },
          });

          if (isExternalTopUp && session.payment_status === 'paid') {
            const resolvedExternalCreditsApplied = Number(resolvedExternalPayment?.creditsApplied) || 0;
            creditsApplied = resolvedExternalCreditsApplied || creditsForRecord;
            const newlyAppliedExternalCredits = Math.max(
              0,
              resolvedExternalCreditsApplied - existingExternalCreditsApplied,
            );

            if (newlyAppliedExternalCredits > 0) {
              await queueCreditPurchaseAdminAlert({
                user: currentUser,
                customerEmail: email,
                amountPaidCents: amountPaid,
                currency: session.currency,
                paymentDate,
                creditsApplied: newlyAppliedExternalCredits,
                productSummary: session.metadata?.productSummary || 'External user credit purchase',
                paymentStatus: session.payment_status,
                checkoutSessionId: session.id,
                stripeCustomerId:
                  typeof session.customer === 'string' ? session.customer : session.customer?.id,
                stripeInvoiceId: receiptDetails.stripeInvoiceId,
                stripeInvoiceNumber: receiptDetails.stripeInvoiceNumber,
                paymentIntentId,
                source: 'external_user_topup',
                newUserCreatedForCheckout: false,
              });
            }
          }

          if (isV2UserRecharge && session.payment_status === 'paid') {
            try {
              const delivery = await deliverV2UserRechargeSuccessCallback({
                session,
                user: currentUser,
                creditsApplied,
                amountPaidCents: amountPaid,
                paymentIntentId,
              });

              if (!delivery.delivered) {
                console.error('[v2_user_recharge] callback delivery failed', {
                  checkoutSessionId: session.id,
                  method: delivery.method,
                  status: delivery.status,
                  creditsApplied,
                });
              }
            } catch (callbackError) {
              console.error('[v2_user_recharge] callback delivery error', {
                checkoutSessionId: session.id,
                creditsApplied,
                error: callbackError?.message || callbackError,
              });
            }
          }
        } catch (err) {
          console.error('Error handling one-time payment:', {
            checkoutSessionId: session?.id,
            paymentIntentId:
              typeof session?.payment_intent === 'string'
                ? session.payment_intent
                : session?.payment_intent?.id || null,
            customerId:
              typeof session?.customer === 'string'
                ? session.customer
                : session?.customer?.id || null,
            customerEmail: email,
            paymentStatus: session?.payment_status,
            intent: session?.metadata?.intent || null,
            error: err?.message || err,
            stack: err?.stack,
          });
          return res.status(500).send(`Error: ${err.message}`);
        }
      } else if (mode === 'setup') {
        try {
          const customerId = session.customer;
          const setupIntentId = session.setup_intent;
          const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
          const paymentMethodId = setupIntent.payment_method;
          const isAutoRechargeSetup = session?.metadata?.intent === AUTO_RECHARGE_INTENT;

          let currentUser = await User.findOne({ stripeCustomerId: customerId });
          if (!currentUser && session.client_reference_id) {
            currentUser = await User.findById(session.client_reference_id);
          }

          if (!currentUser) {
            return res.status(404).send('User not found for setup session');
          }

          if (paymentMethodId) {
            await stripe.customers.update(customerId, {
              invoice_settings: { default_payment_method: paymentMethodId },
            });
          }

          if (isAutoRechargeSetup) {
            await markAutoRechargeSetupSuccess({
              userId: currentUser._id,
              customerId,
              paymentMethodId,
            });
          }
        } catch (err) {
          console.error('Error handling setup session completion:', err.message);
          return res.status(500).send(`Error: ${err.message}`);
        }
      }
      break;

    case 'customer.subscription.deleted':
      try {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const user = await User.findOne({ stripeCustomerId: customerId });

        if (!user) {
          return res.status(404).send("User not found");
        }

        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              isPremiumUser: false,
              premiumUserType: null,
              pendingPlanType: null,
              stripeCustomerId: null,
              stripePaymentId: null,
              stripeSubscriptionId: null,
              stripeSubscriptionStatus: null,
            }
          }
        );

      } catch (err) {
        console.error('Error handling customer.subscription.deleted:', err.message);
        return res.status(500).send(`Error: ${err.message}`);
      }
      break;

    case 'invoice.payment_succeeded':
      try {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const user = await User.findOne({ stripeCustomerId: customerId });

        if (!user) {
          return res.status(404).send("User not found");
        }

        const isAutoRecharge =
          invoice.metadata?.autoRecharge === 'true' || invoice.metadata?.autoRecharge === true;

        if (isAutoRecharge) {
          await handleAutoRechargeInvoicePayment(invoice, user);
          break;
        }

        const amountPaid = parseInt(invoice.amount_paid); // cents
        const invoicePaidAt = invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000)
          : new Date(invoice.created * 1000);
        const billingReason = invoice.billing_reason;
        const primaryLine = invoice.lines?.data?.[0];
        const productSummary = primaryLine?.description || primaryLine?.price?.nickname;
        const periodStart = invoice.period_start ? new Date(invoice.period_start * 1000) : null;
        const periodEnd = invoice.period_end ? new Date(invoice.period_end * 1000) : null;

        let creditsToAdd = 0;
        if (user.premiumUserType === 'creator') {
          creditsToAdd = 5000;
        }

        const paymentType =
          billingReason && billingReason.includes('subscription') ? 'subscription' : 'invoice';
        const invoicePdfUrl = invoice.invoice_pdf || null;
        const hostedInvoiceUrl = invoice.hosted_invoice_url || null;
        let receiptUrl = invoicePdfUrl || hostedInvoiceUrl;
        if (invoice.charge) {
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
        const existingPayment = await findExistingPaymentRecord({
          stripeInvoiceId: invoice.id,
          paymentIntentId: invoicePaymentIntentId,
        });
        const creditsAlreadyApplied = existingPayment?.creditsApplied > 0;
        const shouldApplyCredits = creditsToAdd > 0 && !creditsAlreadyApplied;

        const userPaymentPayload = {
          userId: user._id,
          amountPaidCents: amountPaid,
          stripeCustomerId: customerId,
          stripeInvoiceId: invoice.id,
          stripeInvoiceNumber: invoice.number,
          paymentIntentId: invoicePaymentIntentId,
          currency: invoice.currency,
          paymentType,
          paymentStatus: invoice.status,
          billingReason,
          productSummary,
          paymentDate: invoicePaidAt,
          periodStart,
          periodEnd,
          creditsApplied: creditsAlreadyApplied ? existingPayment.creditsApplied : 0,
          invoicePdfUrl,
          hostedInvoiceUrl,
          receiptUrl,
          receiptS3Key: receiptStorage.receiptS3Key,
          receiptS3Bucket: receiptStorage.receiptS3Bucket,
          metadata: invoice.metadata,
        };

        const paymentRecord = await createUserPaymentRecord(userPaymentPayload);
        let creditsApplied = creditsAlreadyApplied ? existingPayment.creditsApplied : 0;
        if (shouldApplyCredits && paymentRecord?._id) {
          const creditResult = await applyCreditsOnce({
            userId: user._id,
            paymentRecordId: paymentRecord._id,
            creditsToApply: creditsToAdd,
            source: paymentType === 'subscription' ? 'subscription' : 'invoice',
            metadata: {
              stripeInvoiceId: invoice.id,
              paymentIntentId: invoicePaymentIntentId,
              billingReason,
              amountPaidCents: amountPaid,
            },
          });
          if (creditResult.applied) {
            creditsApplied = creditsToAdd;
          }
        }
        await queuePaymentReceiptEmail({
          user,
          recipientEmail: user.email,
          chargeType: paymentType === 'subscription' ? 'creators_program' : 'recurring_billing',
          paymentType,
          amountPaidCents: amountPaid,
          currency: invoice.currency,
          paymentDate: invoicePaidAt,
          billingReason,
          productSummary,
          creditsApplied,
          paymentStatus: invoice.status,
          stripeInvoiceId: invoice.id,
          stripeInvoiceNumber: invoice.number,
          paymentIntentId: invoicePaymentIntentId,
          receiptUrl,
          receiptS3Key: receiptStorage.receiptS3Key,
          receiptS3Bucket: receiptStorage.receiptS3Bucket,
          hostedInvoiceUrl,
          invoicePdfUrl,
        });

        const currentDate = new Date();
        const updateData = { $set: {} };

        if (paymentType === 'subscription') {
          updateData.$set.premiumUserCreditsLastUpdated = currentDate;
          updateData.$set.isPremiumUser = true;
        }

        if (Object.keys(updateData.$set).length === 0) {
          delete updateData.$set;
        }

        if (updateData.$inc || updateData.$set) {
          await User.updateOne({ _id: user._id }, updateData);
        }

      } catch (err) {
        console.error('Error handling invoice.payment_succeeded:', err.message);
        return res.status(500).send(`Error: ${err.message}`);
      }
      break;

    case 'invoice.payment_failed':
      try {
        const invoice = event.data.object;
        const customerId = invoice.customer;
        const subscriptionId = invoice.subscription;
        const user = await User.findOne({ stripeCustomerId: customerId });

        if (!user) {
          break;
        }

        const isAutoRecharge =
          invoice.metadata?.autoRecharge === 'true' || invoice.metadata?.autoRecharge === true;

        if (isAutoRecharge) {
          await User.updateOne(
            { _id: user._id },
            {
              $set: {
                autoRechargeEnabled: false,
                autoRechargeLockUntil: null,
              },
            }
          );
          break;
        }

        if (subscriptionId) {
          await stripe.subscriptions.del(subscriptionId);

          await User.updateOne(
            { _id: user._id },
            {
              $set: {
                isPremiumUser: false,
                premiumUserType: null,
                pendingPlanType: null,
                stripeSubscriptionId: null,
                stripeSubscriptionStatus: 'canceled',
              },
            }
          );

        }
      } catch (err) {
        console.error('Error handling invoice.payment_failed:', err.message);
        return res.status(500).send(`Error: ${err.message}`);
      }

      break;

    case 'payment_intent.payment_failed':
      break;

    case 'customer.subscription.updated':
      break;

    case 'setup_intent.succeeded':
      try {
        const setupIntent = event.data.object;
        const isAutoRechargeSetup = setupIntent?.metadata?.intent === AUTO_RECHARGE_INTENT;
        if (!isAutoRechargeSetup) {
          break;
        }

        const paymentMethodId = setupIntent.payment_method;
        const customerId = setupIntent.customer;
        const userIdFromMetadata = setupIntent?.metadata?.userId;

        await markAutoRechargeSetupSuccess({
          customerId,
          paymentMethodId,
          userId: userIdFromMetadata,
        });
      } catch (err) {
        console.error('Error handling setup_intent.succeeded:', err.message);
        return res.status(500).send(`Error: ${err.message}`);
      }
      break;

    default:
  }

  res.status(200).send('Success');
});

export default router;

async function findExistingPaymentRecord({ stripeInvoiceId, paymentIntentId }) {
  const lookup = [];
  if (stripeInvoiceId) {
    lookup.push({ stripeInvoiceId });
  }
  if (paymentIntentId) {
    lookup.push({ paymentIntentId });
  }
  if (!lookup.length) {
    return null;
  }
  return UserPayment.findOne({ $or: lookup })
    .select('creditsApplied paymentStatus')
    .lean();
}

async function hasCreditTransaction({ userId, source, metadataKey, metadataValue }) {
  if (!userId || !source || !metadataKey || metadataValue === undefined || metadataValue === null) {
    return null;
  }

  return GenerationCreditTransaction.findOne({
    userId,
    source,
    [`metadata.${metadataKey}`]: metadataValue,
  })
    .select('_id')
    .lean();
}

async function applyCreditsOnce({ userId, paymentRecordId, creditsToApply, source, metadata }) {
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
    await creditGenerationCredits(userId, credits, { source, metadata });
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

// Ensure you have a proper function to handle the checkout session
async function handleCheckoutSessionCompleted(session) {

  // Here, you can update your database, send emails, etc.
}

async function resolveCheckoutReceiptDetails(session) {
  let hydratedSession = session;
  if (!session.payment_intent && !session.invoice) {
    try {
      hydratedSession = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['payment_intent', 'invoice', 'payment_intent.charges'],
      });
    } catch (err) {
      console.error('Failed to reload Stripe checkout session:', err.message);
    }
  }

  const details = {
    receiptUrl: null,
    invoicePdfUrl: null,
    hostedInvoiceUrl: null,
    stripeInvoiceId: null,
    stripeInvoiceNumber: null,
    paymentIntentId: null,
    receiptId: null,
  };

  const invoiceRef = hydratedSession.invoice;
  const invoiceId = typeof invoiceRef === 'string' ? invoiceRef : invoiceRef?.id || null;
  if (invoiceId) {
    details.stripeInvoiceId = invoiceId;
  }
  if (invoiceRef && typeof invoiceRef === 'object') {
    details.receiptUrl = invoiceRef.invoice_pdf || invoiceRef.hosted_invoice_url || null;
    details.invoicePdfUrl = invoiceRef.invoice_pdf || null;
    details.hostedInvoiceUrl = invoiceRef.hosted_invoice_url || null;
    details.stripeInvoiceNumber = invoiceRef.number;
    details.receiptId = invoiceRef.id;
  } else if (invoiceId) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId);
      details.receiptUrl = invoice.invoice_pdf || invoice.hosted_invoice_url || null;
      details.invoicePdfUrl = invoice.invoice_pdf || null;
      details.hostedInvoiceUrl = invoice.hosted_invoice_url || null;
      details.stripeInvoiceId = invoice.id;
      details.stripeInvoiceNumber = invoice.number;
      details.receiptId = invoice.id;
      return details;
    } catch (err) {
      console.error('Failed to load Stripe invoice for checkout receipt:', err.message);
    }
  }

  const paymentIntentRef = hydratedSession.payment_intent;
  const paymentIntentId =
    typeof paymentIntentRef === 'string' ? paymentIntentRef : paymentIntentRef?.id || null;
  if (paymentIntentId) {
    details.paymentIntentId = paymentIntentId;
  }

  if (paymentIntentRef && typeof paymentIntentRef === 'object') {
    const charge = paymentIntentRef?.charges?.data?.[0];
    details.receiptUrl = charge?.receipt_url || details.receiptUrl;
    details.paymentIntentId = paymentIntentRef?.id || details.paymentIntentId;
    details.receiptId = details.receiptId || paymentIntentRef?.id;
    return details;
  }

  if (paymentIntentId) {
    try {
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['charges'],
      });
      const charge = paymentIntent?.charges?.data?.[0];
      details.receiptUrl = charge?.receipt_url || details.receiptUrl;
      details.paymentIntentId = paymentIntent?.id || details.paymentIntentId;
      details.receiptId = details.receiptId || paymentIntent?.id || paymentIntentId;
    } catch (err) {
      console.error('Failed to load Stripe payment intent receipt:', err.message);
    }
  }

  return details;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAmountCents(amountCents, currency = 'usd') {
  const amount = Number(amountCents || 0) / 100;
  const currencyLabel = String(currency || 'usd').toUpperCase();
  return `${currencyLabel} ${amount.toFixed(2)}`;
}

function formatAlertDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function buildAdminAlertRows(payload) {
  const user = payload.user || {};
  const userId = user._id?.toString?.() || user._id || '';
  const userEmail = user.email || payload.customerEmail || '';
  const userName = user.username || user.userName || '';

  return [
    ['User email', userEmail],
    ['User name', userName],
    ['User ID', userId],
    ['New user created', payload.newUserCreatedForCheckout ? 'yes' : 'no'],
    ['Credits purchased', payload.creditsApplied],
    ['Amount paid', formatAmountCents(payload.amountPaidCents, payload.currency)],
    ['Payment date', formatAlertDate(payload.paymentDate)],
    ['Product', payload.productSummary],
    ['Source', payload.source],
    ['Payment status', payload.paymentStatus],
    ['Stripe customer', payload.stripeCustomerId],
    ['Checkout session', payload.checkoutSessionId],
    ['Payment intent', payload.paymentIntentId],
    ['Invoice', payload.stripeInvoiceNumber || payload.stripeInvoiceId],
  ].filter(([, value]) => value !== undefined && value !== null && value !== '');
}

async function queueCreditPurchaseAdminAlert(payload) {
  const creditsApplied = Number(payload?.creditsApplied || 0);
  if (!CREDIT_PURCHASE_ADMIN_EMAIL || !Number.isFinite(creditsApplied) || creditsApplied <= 0) {
    return;
  }

  try {
    const amountLabel = formatAmountCents(payload.amountPaidCents, payload.currency);
    const subject = `Samsar credit purchase: ${creditsApplied} credits`;
    const rows = buildAdminAlertRows({ ...payload, creditsApplied });
    const textBody = [
      'A Stripe credit purchase was completed and credits were applied.',
      '',
      ...rows.map(([label, value]) => `${label}: ${value}`),
    ].join('\n');
    const htmlRows = rows.map(([label, value]) => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px;">${escapeHtml(label)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #1e293b;color:#e2e8f0;font-size:13px;">${escapeHtml(value)}</td>
      </tr>
    `).join('');

    await NotificationMailer.create({
      notificationType: 'CUSTOM_ADMIN',
      status: 'INIT',
      sendTime: new Date(),
      recipientEmail: CREDIT_PURCHASE_ADMIN_EMAIL,
      subject,
      message: textBody,
      textBody,
      htmlBody: `
        <p style="margin:0 0 16px;color:#cbd5e1;font-size:15px;line-height:1.65;">
          A Stripe credit purchase was completed and ${escapeHtml(creditsApplied)} credits were applied.
        </p>
        <table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;border:1px solid #1e293b;border-radius:6px;overflow:hidden;">
          ${htmlRows}
        </table>
      `,
      userName: payload.user?.username,
      chargeType: 'admin_credit_purchase_alert',
      paymentType: 'one_time',
      paymentStatus: payload.paymentStatus,
      amountPaidCents: payload.amountPaidCents,
      currency: payload.currency,
      paymentDate: payload.paymentDate,
      billingReason: 'one_time',
      productSummary: payload.productSummary || `Credit purchase ${amountLabel}`,
      creditsApplied,
      stripeInvoiceId: payload.stripeInvoiceId,
      stripeInvoiceNumber: payload.stripeInvoiceNumber,
      paymentIntentId: payload.paymentIntentId,
      checkoutSessionId: payload.checkoutSessionId,
      stripeCustomerId: payload.stripeCustomerId,
      adminAlertType: 'stripe_credit_purchase',
      purchaseSource: payload.source,
      userId: payload.user?._id?.toString?.() || payload.user?._id,
      customerEmail: payload.customerEmail,
      newUserCreatedForCheckout: payload.newUserCreatedForCheckout,
    });
  } catch (err) {
    console.error('Failed to queue credit purchase admin alert:', err.message);
  }
}

async function queuePaymentReceiptEmail(payload) {
  if (!SEND_RECEIPT_EMAILS) return;
  if (!payload?.recipientEmail) return;

  try {
    const receiptLookup = {
      notificationType: 'PAYMENT_RECEIPT',
      $or: [],
    };
    if (payload.stripeInvoiceId) {
      receiptLookup.$or.push({ stripeInvoiceId: payload.stripeInvoiceId });
    }
    if (payload.paymentIntentId) {
      receiptLookup.$or.push({ paymentIntentId: payload.paymentIntentId });
    }
    if (receiptLookup.$or.length > 0) {
      const existing = await NotificationMailer.findOne(receiptLookup).select('_id');
      if (existing?._id) return;
    }

    await NotificationMailer.create({
      notificationType: 'PAYMENT_RECEIPT',
      status: 'INIT',
      sendTime: new Date(),
      recipientEmail: payload.recipientEmail,
      userName: payload.user?.username,
      chargeType: payload.chargeType,
      paymentType: payload.paymentType,
      paymentStatus: payload.paymentStatus,
      amountPaidCents: payload.amountPaidCents,
      currency: payload.currency,
      paymentDate: payload.paymentDate,
      billingReason: payload.billingReason,
      productSummary: payload.productSummary,
      creditsApplied: payload.creditsApplied,
      stripeInvoiceId: payload.stripeInvoiceId,
      stripeInvoiceNumber: payload.stripeInvoiceNumber,
      paymentIntentId: payload.paymentIntentId,
      receiptUrl: payload.receiptUrl,
      receiptS3Key: payload.receiptS3Key,
      receiptS3Bucket: payload.receiptS3Bucket,
      hostedInvoiceUrl: payload.hostedInvoiceUrl,
      invoicePdfUrl: payload.invoicePdfUrl,
    });
  } catch (err) {
    console.error('Failed to queue payment receipt mailer:', err.message);
  }
}

async function markAutoRechargeSetupSuccess({ userId, customerId, paymentMethodId }) {
  if (!customerId && !userId) {
    console.error('Auto-recharge setup: missing customerId and userId');
    return;
  }

  const userLookup = customerId
    ? { stripeCustomerId: customerId }
    : { _id: userId };

  let currentUser = await User.findOne(userLookup);
  if (!currentUser && userId) {
    currentUser = await User.findById(userId).catch(() => null);
  }

  if (!currentUser) {
    console.error('Auto-recharge setup: user not found');
    return;
  }

  const updateData = {
    $set: {
      autoRechargePaymentMethodId: paymentMethodId,
      autoRechargeEnabled: true,
      autoRechargeSetupAt: new Date(),
    },
  };

  if (customerId) {
    updateData.$set.stripeCustomerId = customerId;
  }

  await User.updateOne({ _id: currentUser._id }, updateData);

  const autoRechargeAmountUsd = currentUser.autoRechargeAmountUsd || 0;
  const autoRechargeThreshold = currentUser.autoRechargeThreshold || 0;

  if (autoRechargeAmountUsd > 0) {
    try {
      await checkAndTriggerAutoRecharge(currentUser._id, {
        thresholdCredits: autoRechargeThreshold,
        amountUsd: autoRechargeAmountUsd,
      });
    } catch (err) {
      console.error(
        `Auto-recharge trigger after setup failed for user ${currentUser._id}: ${err.message}`
      );
    }
  }

  try {
    await NotificationMailer.create({
      notificationType: 'AUTO_RECHARGE_ENABLED',
      status: 'INIT',
      recipientEmail: currentUser.email,
      userName: currentUser.username,
    });
    await NotificationMailer.create({
      notificationType: 'AUTO_RECHARGE_ENABLED',
      status: 'INIT',
      recipientEmail: 'contact@samsar.one',
      userName: currentUser.username,
    });
  } catch (err) {
    console.error('Failed to queue auto-recharge mailers', err.message);
  }
}
