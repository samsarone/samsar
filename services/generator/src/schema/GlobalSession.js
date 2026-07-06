import { Schema, model } from 'mongoose';

const globalSessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true },
  sessionType: { type: String, enum: ['image', 'video'], required: true },
  requestId: { type: String },
  provider: { type: String },
  userId: { type: String },
  metadata: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, default: 'PENDING' },
  errorMessage: { type: String },
  resultUrl: { type: String },
  resultUrls: { type: [String], default: [] },
  inputUrl: { type: String },
  inputUrls: { type: [String], default: [] },
}, { timestamps: true });

const GlobalSession = model('GlobalSession', globalSessionSchema);
export default GlobalSession;
