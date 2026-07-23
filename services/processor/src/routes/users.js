import express from 'express';
import {
  setUserData, getUserData, verifyUserSession,
  verifyUserToken, verifyEmail, requestApplyCreditsCoupon,
  updateUserDetails, startFreeTrial,
  deleteUser, deleteProjects, deleteGenerations,
  getAPIKeysForUser, createAPIKeyForUser, deleteUserAPIKey, deleteAllAPIKeysForUser,
  updateUserAPIKeyLimit,
  updateAppUserPreferences, updateUserPreferredLanguage,
  formatUserClientProfile,
  bootstrapDockerAdminUser,
} from '../models/User.js';
import { authenticateWithAuthToken, authenticateWithLoginToken, createLoginTokenForUser } from '../models/api/UserAPI.js';
import { formatExternalUserClientProfile } from '../models/external/User.js';

import { verifyUserAuthentication } from '../models/Auth.js';
import {
  loginUserByEmail, registerUserByEmail, sendForgotPasswordEmail,
  resetUserPassword, updateUserPassword
} from '../models/auth/User.js';

import {
  upgradePlan, purchaseCreditsForUser, cancelSubscription, getUserPaymentHistory
} from '../models/Payment.js';
import UserPayment from '../schema/UserPayment.js';
import { getObjectStreamFromS3 } from '../models/AWS.js';
import { getUserUsageLogs } from '../models/Usage.js';
import {
  checkAndTriggerAutoRecharge,
  createAutoRechargeSetupSession,
  saveAutoRechargeSettings,
  updateAutoRechargeThreshold,
  cancelAutoRecharge,
} from '../models/AutoRecharge.js';
import { getBillingPortalUrl } from '../models/BillingPortal.js';

import { getGoogleLogin, loginGoogleClient } from '../models/auth/Google.js';
import { sendEnterpriseAdminWelcomeEmail } from '../models/Mailer.js';
import {
  isGoogleLoginEnabled,
  isPublicRegistrationEnabled,
  isSetupAdminBootstrapEnabled,
} from '../utils/EnvironmentUtils.js';
import { getAuthCookieDomain } from '../utils/AuthCookie.js';

import('dotenv/config');

const CLIENT_APP = process.env.CLIENT_APP;
const BILLING_PORTAL_URL = getBillingPortalUrl();

const router = express.Router();

function setNoStoreAuthHeaders(res) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
}

function verifyDockerSetupSecret(req) {
  const expectedSecret = process.env.DOCKER_SETUP_SECRET;
  const providedSecret =
    req.headers['x-docker-setup-secret'] ||
    req.body?.setupSecret ||
    req.query?.setupSecret;

  return Boolean(expectedSecret && providedSecret && providedSecret === expectedSecret);
}

router.post('/verify', async (req, res) => {
  try {
    const userData = await verifyUserSession(req.body);
    res.send(formatUserClientProfile(userData, { authToken: userData?.authToken }));
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.get('/verify_token', async (req, res) => {
  setNoStoreAuthHeaders(res);

  try {
    const authToken = req.query.authToken || req.headers.authorization?.split('Bearer ')[1];
    const loginToken =
      req.query.loginToken ||
      req.headers['x-login-token'] ||
      req.headers['login_token'];

    if (loginToken) {
      const { user, authToken: resolvedAuthToken, actorType } = await authenticateWithLoginToken(loginToken);
      const payload = actorType === 'external'
        ? formatExternalUserClientProfile(user, { authToken: resolvedAuthToken })
        : formatUserClientProfile(user, { authToken: resolvedAuthToken });
      res.send(payload);
      return;
    }

    if (!authToken) {
      return res.status(400).send({ error: 'Missing authToken or loginToken.' });
    }

    const { user, actorType } = await authenticateWithAuthToken(authToken);
    if (actorType === 'external') {
      res.send(formatExternalUserClientProfile(user, { authToken }));
      return;
    }

    const userData = await verifyUserToken({ authToken });
    res.send(formatUserClientProfile(userData));
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.get('/profile', async (req, res) => {
  try {
    const session = await getUserData(req.query.fid);
    res.send(formatUserClientProfile(session));
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

router.get('/google_login', async (req, res) => {
  try {
    if (!isGoogleLoginEnabled()) {
      return res.status(403).send({ error: 'Google login is disabled for standalone deployments. Use the configured admin account.' });
    }
    const loginUrl = await getGoogleLogin(req.query);
    const responseMode = typeof req.query?.responseMode === 'string'
      ? req.query.responseMode.trim().toLowerCase()
      : '';
    if (responseMode === 'redirect') {
      res.redirect(loginUrl);
      return;
    }
    res.json({ loginUrl });
  } catch (e) {
    console.error('Failed to generate Google login URL', e);
    res.status(500).send({ error: e?.message || 'Failed to generate Google login URL' });
  }
});

function decodeGoogleOAuthState(state) {
  if (typeof state !== 'string' || !state.trim()) {
    return null;
  }

  const normalizedState = state.trim();
  const decodeAttempts = [
    () => Buffer.from(normalizedState, 'base64url').toString(),
    () => Buffer.from(normalizedState, 'base64').toString(),
  ];

  for (const decodeAttempt of decodeAttempts) {
    try {
      const decoded = decodeAttempt();
      return JSON.parse(decoded);
    } catch (_) {
      // Try the next decoder.
    }
  }

  return null;
}

router.get('/google_login_callback', async (req, res) => {
  try {
    if (!isGoogleLoginEnabled()) {
      return res.status(403).send({ error: 'Google login is disabled for standalone deployments. Use the configured admin account.' });
    }
    const { state, code } = req.query;
    const defaultOriginDomain = CLIENT_APP || 'https://app.samsar.one';
    let originDomain = defaultOriginDomain;
    let cookieConsent = null;
    let redirectPath = null;
    let decodedState = null;

    try {
      decodedState = decodeGoogleOAuthState(state);
      originDomain = decodedState?.origin || originDomain;
      cookieConsent = decodedState?.cookieConsent || null;
      redirectPath = decodedState?.redirect || null;
    } catch (_) {}

    const { authToken, isNewUser } = await loginGoogleClient({
      code,
      subscribeToWeeklyNewsletter: decodedState?.subscribeToWeeklyNewsletter,
    });

    const shouldSetCookie = cookieConsent ? cookieConsent === 'accepted' : true;
    if (shouldSetCookie) {
      const cookieOptions = {
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      };
      const cookieDomain = getAuthCookieDomain();
      if (cookieDomain) cookieOptions.domain = cookieDomain;
      res.cookie('authToken', authToken, cookieOptions);
    }

    const safeRedirect =
      typeof redirectPath === 'string' &&
      redirectPath.startsWith('/') &&
      !redirectPath.startsWith('//')
        ? `&redirect=${encodeURIComponent(redirectPath)}`
        : '';
    const newUserParam = isNewUser ? '&newUser=true' : '';

    res.redirect(`${originDomain}/verify?authToken=${authToken}${safeRedirect}${newUserParam}`);
  } catch (e) {
    console.error('Google login failed', e);
    res.status(500).send({ error: e?.message || 'Google login failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const session = await loginUserByEmail(req.body);
    res.send(session);
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/docker_setup_admin', async (req, res) => {
  if (!isSetupAdminBootstrapEnabled()) {
    return res.status(404).send({ error: 'Not found' });
  }
  if (!verifyDockerSetupSecret(req)) {
    return res.status(403).send({ error: 'Invalid Docker setup secret.' });
  }

  try {
    const user = await bootstrapDockerAdminUser(req.body || {});
    let welcomeEmail = { skipped: true };

    if (process.env.SAMSAR_MAIL_CONFIGURED === 'true') {
      try {
        welcomeEmail = await sendEnterpriseAdminWelcomeEmail({
          adminEmail: user.email,
          organizationName: req.body?.organizationName,
        });
      } catch (mailError) {
        console.error('Failed to send standalone admin welcome email:', mailError);
        welcomeEmail = {
          sent: false,
          error: mailError?.message || 'Unable to send welcome email.',
        };
      }
    }

    const { loginToken, expiresInSeconds, expiresAt } = createLoginTokenForUser(user._id.toString());
    const redirectParam = encodeURIComponent('/vidgenie');
    const loginUrl = `${CLIENT_APP}/verify?loginToken=${encodeURIComponent(loginToken)}&redirect=${redirectParam}`;

    res.send({
      user: formatUserClientProfile(user),
      loginToken,
      expiresInSeconds,
      expiresAt,
      loginUrl,
      welcomeEmail,
    });
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/register', async (req, res) => {
  try {
    if (!isPublicRegistrationEnabled()) {
      return res.status(403).send({ error: 'Registration is disabled for standalone deployments. Use the admin account configured in setup.' });
    }
    
    const session = await registerUserByEmail(req.body);
    res.send(session);
  } catch (e) {
    res.status(400).send({ error: e.message, message: e.message });
  }
});

async function getUserIdOrReject(req, res) {
  const userId = await verifyUserAuthentication(req.headers);


  if (!userId) res.status(401).send("Unauthorized");
  return userId;
}

router.post('/upgrade_plan', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const session = await upgradePlan(userId, req.body);
    res.send(session);
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/purchase_credits', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const session = await purchaseCreditsForUser(userId, req.body);
    res.send(session);
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/cancel_membership', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const session = await cancelSubscription(userId);
    res.send(session);
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/auto_recharge/settings', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const result = await saveAutoRechargeSettings(userId, req.body || {});
    res.send(result);
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/auto_recharge/threshold', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const result = await updateAutoRechargeThreshold(userId, req.body || {});
    res.send(result);
  } catch (e) {
    const statusCode = e?.statusCode || e?.status;
    const message =
      e?.code === 'AUTO_RECHARGE_DISABLED'
        ? `Auto-recharge is not enabled. Please visit ${BILLING_PORTAL_URL} to enable auto-recharge.`
        : e?.message;
    res.status(statusCode || 400).send({ error: message || 'Unable to update auto-recharge threshold.' });
  }
});

router.post('/auto_recharge/start_setup', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const session = await createAutoRechargeSetupSession(userId, req.body || {});
    res.send({ url: session.url });
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/auto_recharge/trigger', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const result = await checkAndTriggerAutoRecharge(userId, req.body || {});
    res.send(result);
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/auto_recharge/cancel', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const result = await cancelAutoRecharge(userId);
    res.send(result);
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.get('/billing/history', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const payments = await getUserPaymentHistory(userId, { limit: req.query.limit });
    res.send({ payments });
  } catch (e) {
    res.status(500).send({ error: 'Unable to fetch billing history' });
  }
});

router.get('/billing/receipt/:paymentId', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;

    const payment = await UserPayment.findOne({
      _id: req.params.paymentId,
      userId,
    }).lean();

    if (!payment) {
      return res.status(404).send({ error: 'Receipt not found' });
    }

    if (payment.receiptS3Key && payment.receiptS3Bucket) {
      const stream = await getObjectStreamFromS3({
        bucketName: payment.receiptS3Bucket,
        key: payment.receiptS3Key,
      });

      const fileName = payment.stripeInvoiceNumber
        ? `receipt-${payment.stripeInvoiceNumber}.pdf`
        : `receipt-${payment.stripeInvoiceId || payment._id}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

      if (stream && typeof stream.pipe === 'function') {
        stream.on('error', (err) => {
          console.error('Receipt stream error:', err.message);
          res.status(500).end();
        });
        return stream.pipe(res);
      }

      return res.send(stream);
    }

    const receiptUrl = payment.receiptUrl || payment.invoicePdfUrl || payment.hostedInvoiceUrl;
    if (!receiptUrl) {
      return res.status(404).send({ error: 'Receipt not available' });
    }

    return res.redirect(receiptUrl);
  } catch (e) {
    console.error('Failed to fetch receipt:', e.message);
    return res.status(500).send({ error: 'Unable to fetch receipt' });
  }
});

router.get('/usage/logs', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;

    const { page, pageSize, limit } = req.query;
    const usage = await getUserUsageLogs(userId, { page, pageSize: pageSize ?? limit });

    res.send(usage);
  } catch (e) {
    res.status(500).send({ error: 'Unable to fetch usage logs' });
  }
});

router.post('/verify_email', async (req, res) => {
  try {
    const session = await verifyEmail(req.body);
    res.send(session);
  } catch (e) {
    res.status(400).send({ message: "Error verifying email" });
  }
});

router.post('/apply_credits_coupon', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const userData = await requestApplyCreditsCoupon(userId, req.body);
    res.send(userData);
  } catch (e) {
    res.status(400).send({ message: "Error applying coupon" });
  }
});

router.post('/update', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const session = await updateUserDetails(userId, req.body);
    res.send(formatUserClientProfile(session));
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/update_user', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const { preferredLanguage } = req.body || {};
    const session = await updateUserPreferredLanguage(userId, preferredLanguage);
    res.send({ preferredLanguage: session.preferredLanguage });
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/delete_user', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    await deleteUser(userId);
    res.send({});
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/delete_projects', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    await deleteProjects(userId);
    res.send({});
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/delete_generations', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    await deleteGenerations(userId);
    res.send({});
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.post('/forgot_password', async (req, res) => {
  try {
    const session = await sendForgotPasswordEmail(req.body);
    res.send(session);
  } catch (e) {
    res.status(400).send({ error: e.message });
  }
});

router.get('/api_keys', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const apiKeys = await getAPIKeysForUser(userId);
    res.send({ apiKeys });
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

router.post('/api_keys', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const { expiresAt = null } = req.body || {};
    const apiKey = await createAPIKeyForUser(userId, expiresAt, req.body || {});
    res.send({ apiKey });
  } catch (e) {
    res.status(e.status || 500).send({ error: e.message });
  }
});

router.patch('/api_keys/:keyId/limit', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const apiKey = await updateUserAPIKeyLimit(userId, req.params.keyId, req.body || {});
    res.send({ apiKey });
  } catch (e) {
    res.status(e.status || 500).send({ error: e.message });
  }
});

router.put('/api_keys/:keyId', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const apiKey = await updateUserAPIKeyLimit(userId, req.params.keyId, req.body || {});
    res.send({ apiKey });
  } catch (e) {
    res.status(e.status || 500).send({ error: e.message });
  }
});

router.delete('/api_keys/:keyId', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    await deleteUserAPIKey(userId, req.params.keyId);
    res.send({ success: true });
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

router.delete('/api_keys', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    await deleteAllAPIKeysForUser(userId);
    res.send({ success: true });
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

router.post('/start_free_trial', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const userData = await startFreeTrial(userId);
    res.send(userData);
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

router.post('/update_preferences', async (req, res) => {
  try {
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const userData = await updateAppUserPreferences(userId, req.body);
    res.send(userData);
  } catch (e) {
    res.status(500).send({ error: e.message });
  }
});

router.post('/submit_reset_password', async (req, res) => {
  const { email, code, password } = req.body;
  if (!email || !code || !password) {
    return res.status(400).send({ error: 'Email, code, and password are required' });
  }

  try {
    const result = await resetUserPassword(req.body);
    res.send(result);
  } catch (e) {
    res.status(500).send({ error: 'Failed to reset password' });
  }
});

router.post('/update_password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = await getUserIdOrReject(req, res);
    if (!userId) return;
    const result = await updateUserPassword(userId, { currentPassword, newPassword });
    res.send(result);
  } catch (e) {
    res.status(500).send({ error: 'Failed to update password' });
  }
});

export default router;
