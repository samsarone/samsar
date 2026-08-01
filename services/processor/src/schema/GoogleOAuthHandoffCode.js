import mongoose, { Schema, model } from 'mongoose';

const googleOAuthHandoffCodeSchema = new Schema({
  codeHash: { type: String, required: true },
  nonceHash: { type: String, required: true },
  userId: { type: String, required: true },
  redirect: { type: String, required: true },
  isNewUser: { type: Boolean, default: false },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

googleOAuthHandoffCodeSchema.index({ codeHash: 1 }, { unique: true });
googleOAuthHandoffCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const GoogleOAuthHandoffCode = mongoose.models.GoogleOAuthHandoffCode || model(
  'GoogleOAuthHandoffCode',
  googleOAuthHandoffCodeSchema,
);

export default GoogleOAuthHandoffCode;
