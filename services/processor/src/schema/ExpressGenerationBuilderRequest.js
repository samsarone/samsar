import mongoose from 'mongoose';

const { Schema } = mongoose;

const expressGenerationBuilderRequestSchema = new Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, required: true, index: true },
  routeType: { type: String, default: 'text_to_video', required: true },
  sessionSubType: { type: String, default: 'video_create', required: true },
  status: {
    type: String,
    enum: ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'],
    default: 'QUEUED',
    index: true,
  },
  payload: { type: Schema.Types.Mixed, required: true },
  webhookUrl: { type: String, default: null },
  leaseOwner: { type: String, default: null },
  leaseExpiresAt: { type: Date, default: null, index: true },
  lastHeartbeatAt: { type: Date, default: null },
  attempts: { type: Number, default: 0 },
  startedAt: { type: Date, default: null },
  completedAt: { type: Date, default: null },
  failedAt: { type: Date, default: null },
  error: { type: Schema.Types.Mixed, default: null },
}, { timestamps: true });

expressGenerationBuilderRequestSchema.index({ status: 1, leaseExpiresAt: 1 });

const ExpressGenerationBuilderRequest = mongoose.models.ExpressGenerationBuilderRequest || mongoose.model(
  'ExpressGenerationBuilderRequest',
  expressGenerationBuilderRequestSchema,
);

export default ExpressGenerationBuilderRequest;
