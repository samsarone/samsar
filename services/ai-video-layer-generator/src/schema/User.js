
import { Schema,model } from 'mongoose';


const UserAPIKey = new Schema({
  apiKey: String,
  expiresAt: Date,
  userId: String,
}, { timestamps: true });

const AppUserData = new Schema({
  appUserId: String,
  appUserEmail: String,
  isGoldUser: {type: Boolean, default: false},
  goldUserAdded: Date,
  videoGenerationRequestTime: Date,
});

const CustomAdapters = new Schema({
  api_key: String,
  base_url: String,
  text_to_video: String,
  text_to_video_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  image_to_video: String,
  image_to_video_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_image: String,
  text_to_image_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_speech: String,
  text_to_speech_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_music: String,
  text_to_music_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  text_to_sound_effect: String,
  text_to_sound_effect_authorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses the configured provider key; deployed routes through Samsar external APIs.
  custom_endpoints: { type: [Object], default: undefined },
}, { _id: false, strict: false });


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

  premiumUserType: String, // premium professionaL or enterprise. Deprecated

  userType: String, // Free or Creator

  stripePaymentId: String,
  
  stripeCustomerId: String,

  stripeSubscriptionStatus: String,

  couponCodeRedemptionRetries: {type: Number, default: 0},
  couponCodeRedemptionRetriesLastUpdated: Date,

  totalAudioInLibrary: {type: Number, default: 0},

  contentFilterRating: { type: Number, default: 3},

  isAdminUser: {type: Boolean, default: false},

  pendingPlanType: String,

  userApiKeys: [UserAPIKey],

  selectedInferenceModel: {type: String, default: 'gpt-5.6-sol'},
  selectedInferenceEffort: { type: String, enum: ['high', 'xhigh'], default: 'high' },
  selectedInferenceModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  selectedAssistantModel: {type: String, default: 'gpt-5.6-sol'},
  selectedAssistantModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  selectedNotifyOnCompletion: {type: Boolean, default: false},

  videoFramesPerSecond: { type: Number, enum: [16, 24, 30], default: 24 },

  isAppUser: {type: Boolean, default: false},

  userPreferenceTags: Array,
  preferenceTagsAdded: {type: Boolean, default: false},

  // app user data
  appData: AppUserData,

  hasUserChosenPaymentMethod: {type: Boolean, default: false},
  hasFreeTrialClaimed: {type: Boolean, default: false},

  isPartnerUser: {type: Boolean, default: false},

  expressGenerationSpeakerFont: { type: String, default: 'Rampart One'},

  expressGenerationTextFont: { type: String, default: 'Montserrat'},

  backingTrackModel: { type: String, default: 'LYRIA3'},
  backingTrackModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  agentVideoModel: { type: String, default: 'RUNWAYML'},
  agentVideoModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  agentImageModel: { type: String, default: 'GPTIMAGE2'},
  agentImageModelAuthorization: { type: String, enum: ['native', 'deployed'], default: 'native' }, // native uses local provider credentials; deployed uses Samsar API key fallback.

  custom_adapters: { type: CustomAdapters, default: null },

  
  
}, { timestamps: true });

// 3. Create a Model.
const User = model('User', userSchema);

export default User;
