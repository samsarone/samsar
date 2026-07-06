import { Schema, model } from 'mongoose';

const userAPIChatSchema = new Schema({
  userId: { type: String, required: true },
  metadata: Schema.Types.Mixed,
  inputMessage: String,
  responseMessage: String,
  inferenceModel: String,
  model: String,
  creditsCharged: { type: Number, default: 0 },
  status: { type: String, enum: ['success', 'error'], default: 'success' },
  errorMessage: String,
}, { timestamps: true });

const UserAPIChats = model('UserAPIChats', userAPIChatSchema);
export default UserAPIChats;
