import { Schema, model } from 'mongoose';

const videoSessionEditLogSchema = new Schema({
  sessionId: { type: Schema.Types.ObjectId, ref: 'VideoSession', required: true, index: true },
  sessionOwnerId: { type: String, default: null, index: true },
  userId: { type: String, default: null, index: true },
  operation: { type: String, required: true, index: true },
  category: { type: String, default: 'update', index: true },
  route: { type: String, default: null },
  shareMode: { type: String, enum: ['owner', 'editable_link', 'shared'], default: 'shared', index: true },
  payloadSummary: { type: Object, default: {} },
  metadata: { type: Object, default: {} },
}, { timestamps: true, strict: false });

videoSessionEditLogSchema.index({ sessionId: 1, createdAt: -1 });

const VideoSessionEditLog = model('VideoSessionEditLog', videoSessionEditLogSchema);

export default VideoSessionEditLog;
