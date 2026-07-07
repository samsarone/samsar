import mongoose from 'mongoose';

const ProviderUsageLogSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  teamOwnerUserId: { type: String, index: true },
  teamMemberUserId: { type: String, index: true },
  teamMemberName: { type: String },
  teamMemberEmail: { type: String, index: true },
  sessionId: { type: String, index: true },
  layerId: { type: String },
  audioLayerId: { type: String },
  localRequestId: { type: String, index: true },
  providerRequestId: { type: String },
  idempotencyKey: { type: String, index: true },
  requestType: { type: String, index: true },
  callType: { type: String },
  jobType: { type: String },
  provider: { type: String, index: true },
  authorizationProvider: { type: String },
  model: { type: String },
  status: { type: String, default: 'requested' },
  source: { type: String },
  service: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, {
  timestamps: true,
  strict: false,
  collection: 'provider_usage_logs',
});

ProviderUsageLogSchema.index({ userId: 1, createdAt: -1 });
ProviderUsageLogSchema.index({ userId: 1, teamMemberEmail: 1, createdAt: -1 });
ProviderUsageLogSchema.index({ sessionId: 1, createdAt: -1 });

export default mongoose.models.ProviderUsageLog ||
  mongoose.model('ProviderUsageLog', ProviderUsageLogSchema);
