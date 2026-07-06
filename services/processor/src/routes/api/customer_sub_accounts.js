import express from 'express';

import { resolveRequestActorFromAuthHeaders } from '../../models/external/User.js';
import {
  ensureCustomerSubAccountInternalApiKey,
  formatCustomerSubAccount,
  getCustomerSubAccountCreditSnapshot,
  upsertCustomerSubAccount,
} from '../../models/external/CustomerSubAccount.js';

const router = express.Router();

async function authenticateCustomerSubAccountProvisioningRequest(req, res, next) {
  try {
    const authContext = await resolveRequestActorFromAuthHeaders(req.headers);

    if (
      authContext.authType === 'external_auth' ||
      authContext.authType === 'customer_sub_account_api_key'
    ) {
      return res.status(403).json({
        message: 'Use the parent customer Samsar API key or auth token to provision customer sub-account keys.',
      });
    }

    req.userId = authContext.internalUserId;
    req.authType = authContext.authType;
    next();
  } catch (error) {
    if (
      error?.code === 'API_KEY_EXPIRED' ||
      error?.code === 'CUSTOMER_SUB_ACCOUNT_API_KEY_EXPIRED'
    ) {
      return res.status(401).json({ message: error.message });
    }

    return res.status(error?.status || 500).json({
      message: error?.message || 'Internal server error while validating customer API key or auth token.',
    });
  }
}

async function handlePullInternalApiKey(req, res, { forceRotate = false } = {}) {
  const customerSubAccount = await upsertCustomerSubAccount({
    internalUserId: req.userId,
    payload: req.body?.input ?? req.body ?? {},
  });
  const customerSubAccountWithKey = await ensureCustomerSubAccountInternalApiKey(
    customerSubAccount,
    { forceRotate },
  );
  const creditSnapshot = await getCustomerSubAccountCreditSnapshot(customerSubAccountWithKey);

  return res.status(200).json({
    internal_api_key: customerSubAccountWithKey.internalApiKey,
    internal_api_key_expires_at: customerSubAccountWithKey.internalApiKeyExpiresAt,
    internal_api_key_rotation_days: customerSubAccountWithKey.internalApiKeyRotationDays,
    remainingCredits: creditSnapshot.remainingCredits,
    accountRemainingCredits: creditSnapshot.accountRemainingCredits,
    subAccountRemainingCredits: creditSnapshot.subAccountRemainingCredits,
    isCreditLimitEnforced: creditSnapshot.isCreditLimitEnforced,
    activation: {
      canActivate: creditSnapshot.remainingCredits > 0,
      reason: creditSnapshot.remainingCredits > 0
        ? null
        : 'Customer sub-account has no Samsar Processor credits.',
    },
    customer_sub_account: formatCustomerSubAccount(
      customerSubAccountWithKey,
      { includeInternalApiKey: false },
    ),
  });
}

router.post(
  '/internal_api_key',
  authenticateCustomerSubAccountProvisioningRequest,
  async (req, res) => {
    try {
      return await handlePullInternalApiKey(req, res);
    } catch (error) {
      return res.status(error?.status || 500).json({
        message: error?.message || 'Internal server error while pulling customer sub-account API key.',
      });
    }
  },
);

router.post(
  '/session',
  authenticateCustomerSubAccountProvisioningRequest,
  async (req, res) => {
    try {
      return await handlePullInternalApiKey(req, res);
    } catch (error) {
      return res.status(error?.status || 500).json({
        message: error?.message || 'Internal server error while creating customer sub-account session.',
      });
    }
  },
);

router.post(
  '/rotate',
  authenticateCustomerSubAccountProvisioningRequest,
  async (req, res) => {
    try {
      return await handlePullInternalApiKey(req, res, { forceRotate: true });
    } catch (error) {
      return res.status(error?.status || 500).json({
        message: error?.message || 'Internal server error while rotating customer sub-account API key.',
      });
    }
  },
);

export default router;
