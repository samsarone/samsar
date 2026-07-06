
import { Schema,model } from 'mongoose';
// 2. Create a Schema corresponding to the document interface.
const userSchema = new Schema({
  fid: String,
  userId: String,

  email: String,
  password: String,

  verificationCode: String,
  verificationCodeExpiresAt: Date,
  isEmailVerified: {type: Boolean, default: false},

  bio: String,
  custody: String,

  displayName: String,
  message: String,
  nonce: String,
  pfpUrl: String,
  signature: String,
  state: String,
  username: String,
  verifications: Array,
  twitterId: String,

  isPremiumUser: {type: Boolean, default: false},
  premiumUserAdded: Date,
  premiumUserCreditsLastUpdated: Date,
  generationCredits: {type: Number, default: 0},

  stripePaymentId: String,

  stripeCustomerId: String,

  couponCodeRedemptionRetries: {type: Number, default: 0},
  couponCodeRedemptionRetriesLastUpdated: Date,

  totalAudioInLibrary: {type: Number, default: 0},
  

}, { timestamps: true });

// 3. Create a Model.
const User = model('User', userSchema);

export default User;
