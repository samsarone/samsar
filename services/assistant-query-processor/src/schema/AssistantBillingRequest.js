import mongoose from 'mongoose';

const schema = new mongoose.Schema({
  _id: String,
  userId: { type: String, index: true },
  scope: String,
  context: mongoose.Schema.Types.Mixed,
  fingerprint: String,
  status: { type: String, default: 'PENDING', index: true },
  leaseUntil: Date,
  leaseToken: String,
  streamState: mongoose.Schema.Types.Mixed,
  dispatchStarted: Boolean,
  pricingTimestampMs: Number,
  providerResponse: mongoose.Schema.Types.Mixed,
  billing: mongoose.Schema.Types.Mixed,
  result: mongoose.Schema.Types.Mixed,
  errorMessage: String,
  errorCode: String,
  errorStatus: Number,
}, { timestamps: true, collection: 'assistant_billing_requests' });

export default mongoose.models.AssistantBillingRequest || mongoose.model('AssistantBillingRequest', schema);
