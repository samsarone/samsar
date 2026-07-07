import { Schema, model } from 'mongoose';

const globalSessionSchema = new Schema({
  sessionId: { type: String, required: true, unique: true },
  sessionType: { type: String, enum: ['image', 'video', 'audio'], required: true },
  requestId: { type: String },
  provider: { type: String },
  userId: { type: String },
  metadata: { type: Schema.Types.Mixed, default: {} },
  status: { type: String, default: 'PENDING' },
  errorMessage: { type: String },
  resultUrl: { type: String },
  resultUrls: { type: [String], default: [] },
  thumbnailUrl: { type: String },
  inputUrl: { type: String },
  inputUrls: { type: [String], default: [] },
  requestType: { type: String, enum: ['API', 'APP'], default: null },
  sessionSubType: { type: String },
  apiSessionId: { type: String },
}, { timestamps: true });

const GlobalSession = model('GlobalSession', globalSessionSchema);
export default GlobalSession;
