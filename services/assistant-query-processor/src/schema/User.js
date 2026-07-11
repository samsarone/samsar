
import { Schema,model } from 'mongoose';


const UserAPIKey = new Schema({
  apiKey: String,
  expiresAt: Date,
  userId: String,
}, { timestamps: true });


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

  premiumUserType: String, // premium professionaL or enterprise

  stripePaymentId: String,

  stripeCustomerId: String,

  couponCodeRedemptionRetries: {type: Number, default: 0},
  couponCodeRedemptionRetriesLastUpdated: Date,

  totalAudioInLibrary: {type: Number, default: 0},

  contentFilterRating: { type: Number, default: 3},

  isAdminUser: {type: Boolean, default: false},

  pendingPlanType: String,

  userApiKeys: [UserAPIKey],

  selectedInferenceModel: {type: String, default: 'gpt-5.6-sol'},
  selectedInferenceModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  selectedAssistantModel: {type: String, default: 'gpt-5.6-sol'},
  selectedAssistantModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.
  assistantSystemPrompt: { type: String, default: null },

  selectedNotifyOnCompletion: {type: Boolean, default: false},
  
}, { timestamps: true });

// 3. Create a Model.
const User = model('User', userSchema);

export default User;
