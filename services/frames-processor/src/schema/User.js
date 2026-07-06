import { Schema, model } from 'mongoose';
import { DEFAULT_LATIN_SUBTITLE_FONT, getSubtitleFontsForLanguage } from '../consts/SubtitleFonts.js';

const UserAPIKey = new Schema({
  apiKey: String,
  expiresAt: Date,
  userId: String,
}, { timestamps: true });

const AppUserData = new Schema({
  appUserId: String,
  appUserEmail: String,
  isGoldUser: { type: Boolean, default: false },
  goldUserAdded: Date,
  videoGenerationRequestTime: Date,
});

const SUPPORTED_LANGUAGE_CODES = ['en', 'es', 'fr', 'ja', 'th', 'zh', 'bn', 'hi', 'sa', 'la'];

const buildDefaultFontPreferences = () => {
  const defaults = {};
  SUPPORTED_LANGUAGE_CODES.forEach((languageCode) => {
    const fonts = getSubtitleFontsForLanguage(languageCode);
    const defaultFont = (Array.isArray(fonts) && fonts[0]) ? fonts[0] : DEFAULT_LATIN_SUBTITLE_FONT;
    defaults[languageCode] = {
      expressGenerationTextFont: defaultFont,
      expressGenerationSpeakerFont: defaultFont,
    };
  });
  return defaults;
};

// 2. Create a Schema corresponding to the document interface.
const userSchema = new Schema({
  fid: String,
  userId: String,

  email: String,
  password: String,

  verificationCode: String,
  verificationCodeExpiresAt: Date,
  isEmailVerified: { type: Boolean, default: false },

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

  isPremiumUser: { type: Boolean, default: false },
  premiumUserAdded: Date,
  premiumUserCreditsLastUpdated: Date,
  generationCredits: { type: Number, default: 0 },

  premiumUserType: String, // premium professionaL or enterprise. Deprecated

  userType: String, // Free or Creator

  stripePaymentId: String,

  stripeCustomerId: String,

  stripeSubscriptionStatus: String,

  couponCodeRedemptionRetries: { type: Number, default: 0 },
  couponCodeRedemptionRetriesLastUpdated: Date,

  totalAudioInLibrary: { type: Number, default: 0 },

  contentFilterRating: { type: Number, default: 3 },

  isAdminUser: { type: Boolean, default: false },

  pendingPlanType: String,

  userApiKeys: [UserAPIKey],

  selectedInferenceModel: { type: String, default: 'gpt-5.5' },

  selectedAssistantModel: { type: String, default: 'gpt-5.5' },

  selectedNotifyOnCompletion: { type: Boolean, default: false },

  isAppUser: { type: Boolean, default: false },

  userPreferenceTags: Array,
  preferenceTagsAdded: { type: Boolean, default: false },

  // app user data
  appData: AppUserData,

  hasUserChosenPaymentMethod: { type: Boolean, default: false },
  hasFreeTrialClaimed: { type: Boolean, default: false },

  isPartnerUser: { type: Boolean, default: false },

  expressGenerationSpeakerFont: { type: String, default: 'Rampart One' },

  expressGenerationTextFont: { type: String, default: DEFAULT_LATIN_SUBTITLE_FONT },

  fontPreferences: { type: Schema.Types.Mixed, default: buildDefaultFontPreferences },

  backingTrackModel: { type: String, default: 'LYRIA3' },

  agentVideoModel: { type: String, default: 'RUNWAYML' },

  agentImageModel: { type: String, default: 'IMAGEN4' },

  defaultAgentDuration: { type: Number, default: 30 }, // in seconds

  agentSoundEffectModel: { type: String, default: 'MIRELOAI' },

}, { timestamps: true });

// 3. Create a Model.
const User = model('User', userSchema);

export default User;
