// Only call on a destination copy. Billing and request identities never travel
// with reused media. Omit fields from $set so a destination's own admission or
// external-request linkage cannot be overwritten by an asynchronous copy job.
export function stripInheritedBilling(session) {
  for (const field of ['hostedAgentBilling', 'postProcessingBilling', 'sessionReceipt',
    'expressGenerationCreditCharges', 'finalVideoDurationSeconds', 'refundSettlement',
    'legacyProvisionalRefund', 'externalRequestUserId', 'externalRequestId',
    'externalRequestIdentityKey', 'isExternalUserRequest', 'videoBillingAPIKeyUsage']) delete session[field];
  session.expressGenerationPaused = false;
  session.expressGenerationCancelled = false;
  session.expressGenerationPausedAt = null;
  session.isStepVideoGeneration = false;
  session.expressStepGeneration = {};
  session.provisionalCredits = 0;
  session.expressGenerationBillingDurationSeconds = 0;
  session.expressGenerationPricingRateClass = 'studio';
  session.videoBillingDebits = {};
  session.videoCreditsCharged = 0;
  session.videoBillingPolicy = 'pipeline';
  return session;
}

export function postProcessingReceipt(billing, status = 'PENDING') {
  const charged = Number(billing.creditsCharged) || 0;
  const refunded = Math.min(charged, Number(billing.creditsRefunded) || 0);
  return { billingType: 'post_processing', stageBilling: false, status,
    operation: billing.operation, totalCharged: charged - refunded,
    finalChargedCredits: charged - refunded, totalDebited: charged, refunded,
    priceCredits: billing.priceCredits, billingMode: billing.mode };
}
